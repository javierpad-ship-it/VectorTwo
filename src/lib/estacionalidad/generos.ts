/**
 * Reglas de presentación del vínculo agrupación-género (M3): cada agrupación
 * pertenece a uno o más géneros y una equivalencia solo puede asignarse a una
 * agrupación que incluya su género. Funciones puras, sin React; se prueban en
 * `tests/estacionalidad.generos.test.ts`.
 *
 * Lo que decide el servidor (409) se repite aquí solo para no ofrecer en
 * pantalla destinos que se sabe que van a fallar.
 */

/** Lo mínimo de una agrupación para filtrar destinos. */
export type AgrupacionConGeneros = {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
  genero_ids: readonly string[];
};

/** Alfabético por nombre, sin acentos ni mayúsculas y con números naturales ("ASESORIA 1" antes de "ASESORIA 10"). */
export function compararPorNombre(a: { nombre: string }, b: { nombre: string }): number {
  return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base", numeric: true });
}

/**
 * Copia ordenada alfabéticamente por nombre: es el orden con que el usuario
 * ve las agrupaciones para elegir. El color de cada una NO sale de aquí (usa
 * la posición por `orden, nombre` de `colores.ts`).
 */
export function ordenarPorNombre<T extends { nombre: string }>(items: readonly T[]): T[] {
  return [...items].sort(compararPorNombre);
}

export function tieneGeneros(a: Pick<AgrupacionConGeneros, "genero_ids">): boolean {
  return a.genero_ids.length > 0;
}

export function incluyeGenero(a: Pick<AgrupacionConGeneros, "genero_ids">, generoId: string): boolean {
  return a.genero_ids.includes(generoId);
}

/** Ids de género distintos de las filas cuyo id está en `ids`, en el orden en que aparecen. */
export function generosDeSeleccion(
  equivalencias: readonly { id: string; genero_id: string }[],
  ids: ReadonlySet<string> | readonly string[]
): string[] {
  const elegidas = ids instanceof Set ? ids : new Set(ids);
  const vistos = new Set<string>();
  for (const e of equivalencias) if (elegidas.has(e.id)) vistos.add(e.genero_id);
  return [...vistos];
}

/**
 * Agrupaciones **activas, con género, que incluyen todos** los géneros dados,
 * por nombre. Sin géneros (`[]`) devuelve todas las activas con género.
 */
export function agrupacionesParaGeneros<A extends AgrupacionConGeneros>(agrupaciones: readonly A[], generoIds: readonly string[]): A[] {
  return ordenarPorNombre(agrupaciones.filter((a) => a.activo && tieneGeneros(a) && generoIds.every((g) => incluyeGenero(a, g))));
}

/** Destinos válidos para el filtro de género de la pantalla (`""` = todos los géneros). */
export function agrupacionesParaFiltro<A extends AgrupacionConGeneros>(agrupaciones: readonly A[], generoIdFiltro: string): A[] {
  return agrupacionesParaGeneros(agrupaciones, generoIdFiltro === "" ? [] : [generoIdFiltro]);
}

/**
 * Destinos válidos al combinar el filtro de género con la selección: la
 * intersección de lo que cubre el género filtrado y los géneros de las filas
 * seleccionadas. Con un género filtrado todas las filas son de ese género y
 * se reduce al filtro; con "Todos" manda la selección.
 */
export function agrupacionesDestino<A extends AgrupacionConGeneros>(
  agrupaciones: readonly A[],
  generoIdFiltro: string,
  generoIdsSeleccion: readonly string[]
): A[] {
  const requeridos = new Set(generoIdsSeleccion);
  if (generoIdFiltro !== "") requeridos.add(generoIdFiltro);
  return agrupacionesParaGeneros(agrupaciones, [...requeridos]);
}

/** Agrupaciones sin ningún género (por defecto solo las activas), por nombre: no aceptan asignaciones. */
export function agrupacionesSinGenero<A extends AgrupacionConGeneros>(agrupaciones: readonly A[], soloActivas = true): A[] {
  return ordenarPorNombre(agrupaciones.filter((a) => (!soloActivas || a.activo) && !tieneGeneros(a)));
}

export type SinDestinos = {
  /** `mezcla`: la selección abarca varios géneros y ninguna agrupación los cubre; `genero`: nadie incluye ese género; `ninguna`: no hay agrupaciones activas con género. */
  tipo: "mezcla" | "genero" | "ninguna";
  texto: string;
};

/**
 * Por qué no hay destinos (o `null` si los hay o si todavía no hace falta
 * explicarlo). `nombreGenero` resuelve el nombre de un género por su id.
 */
export function explicarSinDestinos(
  agrupaciones: readonly AgrupacionConGeneros[],
  generoIdFiltro: string,
  generoIdsSeleccion: readonly string[],
  nombreGenero: (id: string) => string
): SinDestinos | null {
  if (agrupacionesDestino(agrupaciones, generoIdFiltro, generoIdsSeleccion).length > 0) return null;
  const nombres = (ids: readonly string[]) =>
    ids
      .map(nombreGenero)
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
      .join(", ");

  const distintos = new Set(generoIdsSeleccion);
  if (generoIdFiltro !== "") distintos.add(generoIdFiltro);
  if (distintos.size > 1) {
    return {
      tipo: "mezcla",
      texto: `Ninguna agrupación incluye todos los géneros seleccionados (${nombres([...distintos])}). Filtra por género o asigna por partes.`,
    };
  }
  if (distintos.size === 1) {
    const [g] = [...distintos];
    return { tipo: "genero", texto: `Ninguna agrupación activa incluye el género ${nombreGenero(g)}. Añádelo a una en la pestaña Agrupaciones.` };
  }
  return { tipo: "ninguna", texto: "No hay agrupaciones activas con género. Asígnales géneros en la pestaña Agrupaciones." };
}

/** Texto del aviso de `no_permitidas`: "N equivalencias no se asignaron porque la agrupación no incluye su género: HOMBRE, MUJER". */
export function avisoNoPermitidas(noPermitidas: readonly { id: string; genero: string }[]): string | null {
  if (noPermitidas.length === 0) return null;
  const generos = [...new Set(noPermitidas.map((n) => n.genero))].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  const n = noPermitidas.length;
  return `${n.toLocaleString("es-PE")} ${n === 1 ? "equivalencia no se asignó" : "equivalencias no se asignaron"} porque la agrupación no incluye su género: ${generos.join(", ")}.`;
}
