/**
 * Tipos INTERNOS de la propuesta con IA (ficha 07e): el contrato de entrada con el proveedor (§3.5) y los datos con que se arma.
 * Las formas de la API y las constantes viven en `tipos-api.ts` (autocontenido, lo usa la pantalla) y se re-exportan aquí.
 */
import type { SenalIa } from "./tipos-api";

export * from "./tipos-api";

// ─── Contrato con el proveedor: la entrada (§3.5) ───

export type AnioRel = "A-3" | "A-2" | "A-1" | "A";
export const ANIOS_REL: readonly AnioRel[] = ["A-3", "A-2", "A-1", "A"];
export type AnioRelComparable = "A-2" | "A-1" | "A";
export type TemporadaIa = "invierno" | "verano" | "todo_el_ano" | "mixta";

export type FactorNinoEntradaIa = { anio: AnioRel; temporada: "invierno" | "verano"; meses: number[]; factor: number };

export type ContextoEntradaIa = {
  ultimo_mes_cerrado: number;
  objetivo: "A+1";
  objetivo_normal: true;
  nino: FactorNinoEntradaIa[];
  umbral_cola_larga: number;
};

export type GMEntradaIa = {
  id: "g1";
  genero: string;
  mundo: string;
  es_resto: boolean;
  historia: { anio: AnioRel; unidades: number; comparable_pct: number | null }[];
  fuera_de_meta: { aperturas_y1: number; cierres_y1: number };
  cola_larga: { filas: number; unidades_y1: number };
};

export type FilaEntradaIa = {
  f: string;
  l: string;
  linea: string;
  /** Nodo GMLE; `null` en un nodo GML. */
  equivalencia: string | null;
  agrupacion_marca: string;
  temporada: TemporadaIa;
  /** Fija: decidida en A+1 o con % propio (contexto; no se pide cifra). */
  estado: "libre" | "fija";
  /** Unidades de `M(Z)` de cada año; `A` con `ultimo_mes_cerrado` valores. */
  meses: Partial<Record<AnioRel, number[]>>;
  comparable_pct: Partial<Record<AnioRelComparable, number | null>>;
  y: { vendido: number; vigente: number | null; avance: number | null; metodo: "avance" | "plan_anterior" | "otro"; decidido: boolean };
  y1: { base: number | null; base_corregida: number | null; aporte_entrantes: number; aporte_salientes: number; fija_en: number | null; pedir: boolean };
  senales: { lista: SenalIa[]; meses_quiebre_w12: number; disponibilidad: number | null; meses_desde_primera_venta: number; meses_con_venta_24: number };
};

/** Idéntico en la llamada natural y en la de reparto del mismo lote: se cachea en el proveedor. */
export type BloqueGMIa = {
  version_entrada: 2;
  contexto: ContextoEntradaIa;
  gm: GMEntradaIa;
  lote: { n: number; de: number };
  filas: FilaEntradaIa[];
};

export type MetaEntradaIa = {
  pct: number;
  sobre: "corregida" | "bruta";
  total: number;
  fijas: number;
  libre: number;
  provisional: boolean;
  /** `libre` en modo directo; `Σ` sub-metas de las líneas del lote en jerárquico. */
  del_lote: number;
};

/** Solo en la llamada de reparto, después del bloque. */
export type SufijoRepartoIa = {
  tarea: "reparto";
  meta: MetaEntradaIa;
  naturales: { f: string; natural_y1: number | null }[];
};

/** La llamada natural no lleva meta ni nada derivado de ella (D9). */
export type SufijoNaturalIa = { tarea: "natural" };

export type LineaEntradaIa = {
  l: string;
  linea: string;
  filas_libres: number;
  historia: Partial<Record<AnioRel, number>>;
  comparable_pct: Partial<Record<AnioRelComparable, number | null>>;
  base_corregida: number;
  /** `Σ` naturales de sus filas libres. */
  natural_y1: number;
  fijas: number;
};

/** Modo jerárquico: una sola llamada por GM, después de todas las naturales. */
export type EntradaLineasIa = {
  version_entrada: 2;
  contexto: ContextoEntradaIa;
  gm: GMEntradaIa;
  meta: Omit<MetaEntradaIa, "del_lote">;
  lineas: LineaEntradaIa[];
};

/** Diccionario de ids cortos y alias de una entrada (`ia_entradas.diccionario`): ids, no nombres. */
export type DiccionarioEntradaIa = {
  f: Record<string, string>;
  l: Record<string, string>;
  e: Record<string, string>;
  alias: Record<string, { tipo: "marca" | "tienda" | "termino"; id: string | null }>;
};

export type PasoPlanIa = { id: string; tipo: "natural" | "lineas" | "reparto"; lote: number };
