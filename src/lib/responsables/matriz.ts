import type { Tables } from "@/lib/supabase/database.types";
import { esRol, type Rol } from "@/lib/auth/roles";
import {
  compararNombre,
  compararOrdenNombre,
  nodoVigente,
  type GeneroEntrada,
  type LineaEntrada,
  type MundoEntrada,
  type NodoEntrada,
} from "@/lib/arbol/armar-arbol";
import {
  ROL_RESPONSABLE,
  type Celda,
  type CargaResponsable,
  type CatalogoMatriz,
  type Comprador,
  type MotivoFaltanteResponsable,
  type ReporteMatriz,
  type ResponsableCelda,
  type ResumenResponsables,
} from "./tipos";

/**
 * Matriz género × mundo (docs/modulos/01b-responsables.md, reglas 1–5).
 * Pura, sin I/O: `armarMatriz` recibe las tablas leídas planas y devuelve lo
 * que `GET /api/responsables` serializa (salvo `compradores`, que depende del
 * rol de quien pregunta y arma el handler con `compradoresAsignables`).
 */

export type PerfilEntrada = Pick<Tables<"perfiles">, "id" | "nombre" | "email" | "rol" | "activo">;
export type AsignacionEntrada = Pick<Tables<"responsables_genero_mundo">, "genero_id" | "mundo_id" | "perfil_id" | "activo">;
export type LineaMatrizEntrada = Pick<LineaEntrada, "id" | "activo">;

export type OpcionesMatriz = { incluirInactivos: boolean };

export type MatrizResponsables = Omit<ReporteMatriz, "compradores">;

/** Nombre con el que se nombra a un perfil en mensajes y orden: el nombre, o el correo si no tiene. */
export function etiquetaPerfil(perfil: { nombre: string | null; email: string }): string {
  return perfil.nombre?.trim() ? perfil.nombre : perfil.email;
}

/** Regla 2: combinación vigente = género activo y mundo activo. */
export function combinacionVigente(genero: Pick<GeneroEntrada, "activo">, mundo: Pick<MundoEntrada, "activo">): boolean {
  return genero.activo && mundo.activo;
}

/** Es lo único que `motivoFaltante` necesita saber de una celda. */
export type CeldaParaMotivo = {
  vigente: boolean;
  responsable: { activo: boolean; rol: string } | null;
};

/**
 * Regla 3: la única definición de faltante (la usan la matriz, el resumen, el
 * bloque, el filtro y el CSV). `null` = no es faltante: o no es vigente, o
 * tiene un responsable activo con rol comprador. Si coinciden desactivado y
 * no comprador, gana `responsable_inactivo`.
 */
export function motivoFaltante(celda: CeldaParaMotivo): MotivoFaltanteResponsable | null {
  if (!celda.vigente) return null;
  if (!celda.responsable) return "sin_responsable";
  if (!celda.responsable.activo) return "responsable_inactivo";
  if (celda.responsable.rol !== ROL_RESPONSABLE) return "responsable_no_comprador";
  return null;
}

/** Activo y comprador: el responsable cuenta como válido. */
export function responsableValido(responsable: { activo: boolean; rol: string }): boolean {
  return responsable.activo && responsable.rol === ROL_RESPONSABLE;
}

/**
 * Rol de la celda como `Rol`. La base lo garantiza con un `check`, así que un
 * valor desconocido no debería existir; si apareciera, NO se normaliza a
 * `comprador` (como hace `normalizarRol`, que elige el rol más restringido):
 * aquí eso lo volvería asignable. Se muestra como `planner` y cuenta como
 * "ya no es comprador".
 */
function rolDeCelda(valor: string): Rol {
  return esRol(valor) ? valor : "planner";
}

/** Los perfiles que pueden recibir una combinación: compradores activos, por nombre (o correo). */
export function compradoresAsignables(perfiles: PerfilEntrada[]): Comprador[] {
  return perfiles
    .filter((p) => p.activo && p.rol === ROL_RESPONSABLE)
    .map((p) => ({ id: p.id, nombre: p.nombre, email: p.email }))
    .sort((a, b) => compararNombre(etiquetaPerfil(a), etiquetaPerfil(b)) || (a.id < b.id ? -1 : 1));
}

function aCatalogo(c: Pick<CatalogoMatriz, "id" | "codigo" | "nombre" | "orden" | "activo">): CatalogoMatriz {
  return { id: c.id, codigo: c.codigo, nombre: c.nombre, orden: c.orden, activo: c.activo };
}

const clave = (generoId: string, mundoId: string) => `${generoId}|${mundoId}`;

/** Regla 5: nodos vigentes (nodo, línea, género y mundo activos) por pareja. */
function contarLineasPorPareja(
  generos: GeneroEntrada[],
  mundos: MundoEntrada[],
  nodos: NodoEntrada[],
  lineas: LineaMatrizEntrada[]
): Map<string, number> {
  const generoPorId = new Map(generos.map((g) => [g.id, g]));
  const mundoPorId = new Map(mundos.map((m) => [m.id, m]));
  const lineaPorId = new Map(lineas.map((l) => [l.id, l]));
  const conteo = new Map<string, number>();
  for (const nodo of nodos) {
    const genero = generoPorId.get(nodo.genero_id);
    const mundo = mundoPorId.get(nodo.mundo_id);
    const linea = lineaPorId.get(nodo.linea_id);
    if (!genero || !mundo || !linea) continue;
    if (!nodoVigente(nodo, genero, mundo, linea)) continue;
    const k = clave(nodo.genero_id, nodo.mundo_id);
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }
  return conteo;
}

/** Regla 4: resumen de las celdas vigentes. */
export function resumirCeldas(celdas: Celda[], perfiles: PerfilEntrada[]): ResumenResponsables {
  const vigentes = celdas.filter((c) => c.vigente);
  let sinResponsable = 0;
  let inactivo = 0;
  let noComprador = 0;
  let sinLineas = 0;
  const cargas = new Map<string, CargaResponsable>();
  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));

  for (const celda of vigentes) {
    if (celda.motivo_faltante === "sin_responsable") sinResponsable++;
    else if (celda.motivo_faltante === "responsable_inactivo") inactivo++;
    else if (celda.motivo_faltante === "responsable_no_comprador") noComprador++;
    if (celda.motivo_faltante !== null && celda.lineas === 0) sinLineas++;

    if (celda.responsable) {
      const existente = cargas.get(celda.responsable.id);
      if (existente) {
        existente.combinaciones++;
      } else {
        const perfil = perfilPorId.get(celda.responsable.id);
        cargas.set(celda.responsable.id, {
          perfil_id: celda.responsable.id,
          nombre: perfil?.nombre ?? celda.responsable.nombre,
          email: perfil?.email ?? celda.responsable.email,
          combinaciones: 1,
          valido: responsableValido(celda.responsable),
        });
      }
    }
  }

  const faltantes = sinResponsable + inactivo + noComprador;
  const por_responsable = [...cargas.values()].sort(
    (a, b) =>
      b.combinaciones - a.combinaciones ||
      compararNombre(etiquetaPerfil(a), etiquetaPerfil(b)) ||
      (a.perfil_id < b.perfil_id ? -1 : 1)
  );

  return {
    combinaciones: vigentes.length,
    con_responsable: vigentes.length - faltantes,
    faltantes,
    faltantes_sin_responsable: sinResponsable,
    faltantes_responsable_inactivo: inactivo,
    faltantes_responsable_no_comprador: noComprador,
    faltantes_sin_lineas: sinLineas,
    por_responsable,
  };
}

/**
 * Regla 1: el producto cartesiano. Devuelve exactamente `géneros × mundos`
 * celdas (8 × 5 = 40), haya o no asignaciones o nodos; sin `incluirInactivos`,
 * solo géneros y mundos activos. Orden por `orden, nombre` de género y luego
 * de mundo. Una asignación con `activo = false` (solo posible desde el SQL
 * Editor) cuenta como sin responsable. El `resumen` cuenta siempre solo las
 * combinaciones vigentes.
 */
export function armarMatriz(
  generos: GeneroEntrada[],
  mundos: MundoEntrada[],
  asignaciones: AsignacionEntrada[],
  perfiles: PerfilEntrada[],
  nodos: NodoEntrada[],
  lineas: LineaMatrizEntrada[],
  opciones: OpcionesMatriz
): MatrizResponsables {
  const generosVisibles = generos.filter((g) => opciones.incluirInactivos || g.activo).sort(compararOrdenNombre);
  const mundosVisibles = mundos.filter((m) => opciones.incluirInactivos || m.activo).sort(compararOrdenNombre);

  const perfilPorId = new Map(perfiles.map((p) => [p.id, p]));
  const perfilDeCelda = new Map<string, ResponsableCelda>();
  for (const a of asignaciones) {
    if (!a.activo) continue;
    const perfil = perfilPorId.get(a.perfil_id);
    if (!perfil) continue;
    perfilDeCelda.set(clave(a.genero_id, a.mundo_id), {
      id: perfil.id,
      nombre: perfil.nombre,
      email: perfil.email,
      rol: rolDeCelda(perfil.rol),
      activo: perfil.activo,
    });
  }

  const lineasPorPareja = contarLineasPorPareja(generos, mundos, nodos, lineas);

  const celdas: Celda[] = [];
  for (const genero of generosVisibles) {
    for (const mundo of mundosVisibles) {
      const k = clave(genero.id, mundo.id);
      const responsable = perfilDeCelda.get(k) ?? null;
      const vigente = combinacionVigente(genero, mundo);
      const motivo = motivoFaltante({ vigente, responsable });
      celdas.push({
        genero_id: genero.id,
        mundo_id: mundo.id,
        vigente,
        lineas: lineasPorPareja.get(k) ?? 0,
        responsable,
        faltante: motivo !== null,
        motivo_faltante: motivo,
      });
    }
  }

  return {
    generos: generosVisibles.map(aCatalogo),
    mundos: mundosVisibles.map(aCatalogo),
    celdas,
    resumen: resumirCeldas(celdas, perfiles),
  };
}
