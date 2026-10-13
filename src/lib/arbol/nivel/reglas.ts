import type { GeneroArbol, NivelPlanificacion } from "../tipos";

/**
 * Reglas del nivel de planificación (docs/modulos/02b-marcas-tratamiento-gml.md,
 * reglas 1 a 3). Funciones puras, sin I/O ni imports de la base: las usan
 * `armarArbol`, los handlers de nivel y, más adelante, M7 y M8.
 */

/** Lo que una unidad de planificación identifica: el nodo y, si está abierto a GMLE, la equivalencia. */
export type UnidadPlanificacion = { gml_id: string; equivalencia_id: string | null };

type NodoNivel = { id: string; nivel_planificacion: NivelPlanificacion; vigente: boolean };
type EquivalenciaNivel = { id: string; activo: boolean };

/**
 * Regla 1. Una unidad por nodo `GML`; una por equivalencia activa (la genérica
 * incluida) en un nodo `GMLE`; ninguna si el nodo no es vigente.
 */
export function unidadesDeNodo(nodo: NodoNivel, equivalencias: readonly EquivalenciaNivel[]): UnidadPlanificacion[] {
  if (!nodo.vigente) return [];
  if (nodo.nivel_planificacion === "GML") return [{ gml_id: nodo.id, equivalencia_id: null }];
  return equivalencias.filter((e) => e.activo).map((e) => ({ gml_id: nodo.id, equivalencia_id: e.id }));
}

/** Regla 1: nodos abiertos a GMLE y sus equivalencias activas, solo sobre nodos vigentes del árbol dado. */
export function resumenNiveles(arbol: { generos: GeneroArbol[] }): { nodos_gmle: number; equivalencias_en_gmle: number } {
  let nodos = 0;
  let equivalencias = 0;
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (!l.vigente || l.nivel_planificacion !== "GMLE") continue;
        nodos += 1;
        equivalencias += l.equivalencias.filter((e) => e.activo).length;
      }
    }
  }
  return { nodos_gmle: nodos, equivalencias_en_gmle: equivalencias };
}

export type ResultadoNivelBloque = {
  nivel: NivelPlanificacion;
  /** Ids que hay que escribir (los que tienen otro nivel). */
  ids_a_cambiar: string[];
  cambiados: number;
  sin_cambio: number;
  no_encontrados: string[];
};

/**
 * Regla 2. Deduplica; inexistentes → `no_encontrados`; igual nivel →
 * `sin_cambio`; el resto → `cambiados`. `|ids| = cambiados + sin_cambio +
 * |no_encontrados|` y repetir da `cambiados = 0` (idempotente).
 */
export function planificarNivelBloque(
  nodoIds: readonly string[],
  nivel: NivelPlanificacion,
  nodos: readonly { id: string; nivel_planificacion: NivelPlanificacion }[]
): ResultadoNivelBloque {
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const ids_a_cambiar: string[] = [];
  const no_encontrados: string[] = [];
  let sin_cambio = 0;
  for (const id of new Set(nodoIds)) {
    const nodo = porId.get(id);
    if (!nodo) no_encontrados.push(id);
    else if (nodo.nivel_planificacion === nivel) sin_cambio += 1;
    else ids_a_cambiar.push(id);
  }
  return { nivel, ids_a_cambiar, cambiados: ids_a_cambiar.length, sin_cambio, no_encontrados };
}

/** Sinónimos del archivo (regla 3): `GML`, `GMLE`, `LINEA` (= GML) y `EQUIVALENCIA` (= GMLE), sin distinguir caja. */
const SINONIMOS: Readonly<Record<string, NivelPlanificacion>> = {
  GML: "GML",
  LINEA: "GML",
  GMLE: "GMLE",
  EQUIVALENCIA: "GMLE",
};

/** `null` si el valor no se reconoce; el llamador distingue el vacío antes. */
export function leerNivel(valor: string): NivelPlanificacion | null {
  return SINONIMOS[valor.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()] ?? null;
}
