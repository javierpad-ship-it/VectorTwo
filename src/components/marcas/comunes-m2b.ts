import { normalizarNombre } from "@/lib/arbol/normalizar";
import { columnaModalidad, cuerpoModalidad, sinModalidadGuardada, type MarcaParaModalidad } from "@/lib/marcas/modalidad";

// Las pantallas no nombran la columna cruda: la leen y la escriben estos helpers de `@/lib/marcas/modalidad` (M12, 6.1).
export { columnaModalidad, cuerpoModalidad, sinModalidadGuardada };
import type { ArbolConNivel, CambioMarca, MarcaConGml, ModalidadDestino, ModalidadEfectiva, MotivoPendiente, NivelPlanificacion } from "./tipos-m2b";

/** Las tres marcas genéricas que M5 fija en MID VALUE: no entran en conjuntos ni se planifican aparte. */
const MARCAS_GENERICAS = new Set(["VARIOS", "OTROS", "SIN MARCA"]);

export function esMarcaGenerica(nombre: string): boolean {
  return MARCAS_GENERICAS.has(normalizarNombre(nombre));
}

/** M12: las tres modalidades que ve y elige el usuario (la `mixta` es `por_gml` con el resto al barrer, pero eso lo resuelve la API). */
export const ETIQUETA_MODALIDAD: Record<ModalidadEfectiva, string> = { por_gml: "Por GML", barrido: "Al barrer", mixta: "Mixta" };

export const MODALIDADES_ELEGIBLES: readonly ModalidadEfectiva[] = ["por_gml", "barrido", "mixta"];

/** Nivel de un nodo; un árbol anterior a `0010` no lo trae y se lee como GML. */
export function nivelDe(l: { nivel_planificacion?: NivelPlanificacion | null }): NivelPlanificacion {
  return l.nivel_planificacion === "GMLE" ? "GMLE" : "GML";
}

/** Un nodo género-mundo-línea aplanado, para filtrar y elegir sin recorrer el árbol en cada render. */
export type NodoPlano = {
  id: string;
  generoId: string;
  genero: string;
  mundoId: string;
  mundo: string;
  lineaId: string;
  linea: string;
  nivel: NivelPlanificacion;
  vigente: boolean;
  equivalencias: number;
};

export function aplanarNodos(arbol: ArbolConNivel | null, soloVigentes = true): NodoPlano[] {
  if (!arbol) return [];
  const nodos: NodoPlano[] = [];
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (soloVigentes && !l.vigente) continue;
        nodos.push({
          id: l.nodo_id,
          generoId: g.id,
          genero: g.nombre,
          mundoId: m.id,
          mundo: m.nombre,
          lineaId: l.linea_id,
          linea: l.nombre,
          nivel: nivelDe(l),
          vigente: l.vigente,
          equivalencias: l.equivalencias.length,
        });
      }
    }
  }
  return nodos;
}

export function rutaNodo(n: Pick<NodoPlano, "genero" | "mundo" | "linea">): string {
  return `${n.genero} · ${n.mundo} · ${n.linea}`;
}

/** La marca es miembro de un conjunto efectivo (su cabeza está activa): cuenta como la cabeza. */
export function esMiembroEfectivo(m: Pick<MarcaConGml, "conjunto">): boolean {
  return m.conjunto !== null && m.conjunto !== undefined && m.conjunto.activo;
}

/**
 * Misma regla que `motivoPendiente` de la API (regla 9), con lo que ya trae `GET /api/marcas`:
 * marcada y no miembro de un conjunto efectivo (la que cuenta es su cabeza); no vigente →
 * `marca_no_vigente`; modalidad nula → `sin_modalidad`; por GML con 0 GML vigentes → `sin_gml`; mixta con 0 GML
 * vigentes → `mixta_sin_gml` (M12: se comporta como al barrer). Al barrer nunca es pendiente.
 */
export function motivoPendienteMarca(m: MarcaConGml): MotivoPendiente | null {
  if (!m.tratamiento_especial || esMiembroEfectivo(m)) return null;
  if (!m.vigente) return "marca_no_vigente";
  if (sinModalidadGuardada(m)) return "sin_modalidad";
  if (m.gml_vigentes === 0 && m.modalidad_efectiva === "por_gml") return "sin_gml";
  if (m.gml_vigentes === 0 && m.modalidad_efectiva === "mixta") return "mixta_sin_gml";
  return null;
}

/** Pendiente por cualquier motivo (lo mismo que `pendiente` en `GET /api/marcas/gml-especial`). */
export function estaPendiente(m: MarcaConGml): boolean {
  return motivoPendienteMarca(m) !== null;
}

export const TEXTO_PENDIENTE: Record<MotivoPendiente, string> = {
  sin_gml: "Pendiente: sin GML",
  sin_modalidad: "Pendiente: sin modalidad",
  mixta_sin_gml: "Pendiente: mixta sin GML",
  marca_no_vigente: "Pendiente: marca no vigente",
};

/**
 * Conteos del resumen, con los mismos criterios que `resumen` de `GET /api/marcas/gml-especial`:
 * los miembros de un conjunto efectivo no cuentan (su configuración propia está ignorada) y
 * `marcadas = por_gml + barrido + mixta + sin_modalidad` (M12). `pendientes` son las `sin_gml` y las `mixta_sin_gml` (coherente con
 * la fila; `pendientes_sin_gml` de la API solo cuenta las `sin_gml`). Recibe las marcas ya filtradas por activas (o no) por quien llama.
 */
export function resumenTratamiento(marcas: readonly MarcaConGml[]) {
  const r = { marcadas: 0, porGml: 0, barrido: 0, mixta: 0, sinModalidad: 0, pendientes: 0 };
  for (const m of marcas) {
    if (!m.tratamiento_especial || esMiembroEfectivo(m)) continue;
    r.marcadas++;
    if (sinModalidadGuardada(m)) r.sinModalidad++;
    else if (m.modalidad_efectiva === "por_gml") r.porGml++;
    else if (m.modalidad_efectiva === "mixta") r.mixta++;
    else r.barrido++;
    const motivo = motivoPendienteMarca(m);
    if (motivo === "sin_gml" || motivo === "mixta_sin_gml") r.pendientes++;
  }
  return r;
}

/** Qué le pasaría a la marca al hacerla relevante en un GML (`null` si ya es por GML o mixta). */
export function cambioMarcaDe(m: MarcaParaModalidad): CambioMarca["de"] | null {
  if (!m.tratamiento_especial) return "sin_tratamiento";
  if (m.modalidad_efectiva === "por_gml" || m.modalidad_efectiva === "mixta") return null;
  return sinModalidadGuardada(m) ? "sin_modalidad" : "barrido";
}

/**
 * M12 (I3): una marca al barrer (o marcada sin modalidad) no pasa a `por_gml` sin preguntar: la API exige `modalidad_destino`
 * (`409 modalidad_destino_requerida`). Las que hay que preguntar antes de escribir.
 */
export function marcasQueRequierenDestino<T extends MarcaParaModalidad>(marcas: readonly T[]): T[] {
  return marcas.filter((m) => {
    const de = cambioMarcaDe(m);
    return de === "barrido" || de === "sin_modalidad";
  });
}

export const ETIQUETA_DESTINO: Record<ModalidadDestino, string> = { por_gml: "Por GML", mixta: "Mixta" };

/** `a` es el destino elegido; sin él (marca sin tratamiento) la marca queda Por GML. */
export function textoCambioMarca(nombre: string, de: CambioMarca["de"], a: ModalidadDestino = "por_gml"): string {
  switch (de) {
    case "sin_tratamiento":
      return `${nombre} se marcará con tratamiento especial (Por GML)`;
    case "barrido":
      return `${nombre} pasará de Al barrer a ${ETIQUETA_DESTINO[a]}`;
    case "sin_modalidad":
      return `${nombre} (sin modalidad) pasará a ${ETIQUETA_DESTINO[a]}`;
  }
}

/** Participación (0..1) como porcentaje legible. */
export function pct(x: number): string {
  return `${(x * 100).toLocaleString("es-PE", { maximumFractionDigits: 1 })} %`;
}

/**
 * Decide si un cambio de modalidad hecho desde la tabla de Marcas pide `confirm` y cuántos GML cambian de estado (los que
 * enumera `textoConfirmarModalidad`). Pura. Siempre se confirma al salir de Por GML o de Mixta hacia Al barrer (los GML
 * quedan ignorados y el reparto vigente y las proyecciones de M7 se desactualizan, aunque no haya GML), al llegar a Mixta y
 * al llegar a Por GML. Sin cambio de modalidad (`de === a`) no se pide. `gml`: al barrer desde Por GML, los asignados; desde
 * Mixta, los vigentes; a Mixta desde Al barrer, los asignados (hoy ignorados); en el resto 0.
 */
export function confirmacionCambioModalidad(
  m: Pick<MarcaConGml, "gml_asignados" | "gml_vigentes">,
  de: ModalidadEfectiva,
  a: ModalidadEfectiva
): { pide: boolean; gml: number } {
  if (de === a) return { pide: false, gml: 0 };
  if (a === "barrido") return { pide: true, gml: de === "mixta" ? m.gml_vigentes : m.gml_asignados };
  return { pide: true, gml: a === "mixta" && de === "barrido" ? m.gml_asignados : 0 };
}

/**
 * El `confirm` de un cambio de modalidad (ficha 12, paso 2): dice qué cambia, enumera los GML cuando se conocen por nombre (o
 * solo los cuenta), y avisa del reparto vigente de M12 (queda obsoleto: `config_cambiada`) y de las proyecciones en trabajo de
 * M7. `gml` son los GML cuyo estado cambia: al pasar de Al barrer a Mixta, los asignados (hoy ignorados); al pasar de Mixta a Al
 * barrer, los específicos (quedan ignorados). `tieneReparto`: `null` si quien lo pide no lo sabe (la pestaña Marcas). Pura.
 */
export function textoConfirmarModalidad(o: { nombre: string; de: ModalidadEfectiva; a: ModalidadEfectiva; gml: readonly string[] | number; tieneReparto: boolean | null }): string {
  const n = typeof o.gml === "number" ? o.gml : o.gml.length;
  const lista = typeof o.gml === "number" || o.gml.length === 0 ? "" : `:\n${o.gml.map((x) => `· ${x}`).join("\n")}`;
  const partes: string[] = [`¿Pasar ${o.nombre} de ${ETIQUETA_MODALIDAD[o.de]} a ${ETIQUETA_MODALIDAD[o.a]}?`];
  if (o.a === "mixta") {
    if (o.de === "barrido" && n > 0) partes.push(`Sus ${n} GML asignados (hoy ignorados) pasarán a ser sus GML específicos, con compras directas${lista}`);
    else if (o.de === "por_gml") partes.push("Su venta fuera de sus GML dejará de contar como «otras» y pasará al flujo al barrer, con el reparto estadístico.");
    else partes.push("No tiene GML asignados: quedará pendiente (mixta sin GML) y se comportará como al barrer hasta que le asignes alguno.");
  } else if (o.a === "barrido") {
    if (n > 0) partes.push(`Sus ${n} GML quedarán ignorados (no se borran) y toda su venta irá al flujo al barrer${lista}`);
    else partes.push("Toda su venta irá al flujo al barrer.");
  } else {
    partes.push("Dejará de analizarse en Marcas al barrer (no tiene parte al barrer) y se verá solo en los GML donde es relevante; su venta fuera de ellos contará como «otras».");
  }
  if (o.tieneReparto === true) partes.push("El reparto vigente quedará obsoleto (configuración cambiada): no se recalcula solo y habrá que aprobarlo de nuevo.");
  else if (o.tieneReparto === null) partes.push("Si tiene un reparto aprobado en Marcas al barrer, quedará obsoleto (configuración cambiada).");
  partes.push("Las proyecciones de M7 en trabajo quedarán marcadas como desactualizadas.");
  return partes.join("\n\n");
}
