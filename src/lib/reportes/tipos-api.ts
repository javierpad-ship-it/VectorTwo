/**
 * Contrato de la API de M11 (docs/modulos/11-reporte-agrupacion-gmle.md,
 * "Contratos de API"): `GET /api/reportes/agrupacion-gmle`. Describe el JSON
 * que viaja, no las filas de la base. Autocontenido: solo importa tipos, así
 * que lo usan igual el servidor y la pantalla.
 */
import type { TemporadaAgrupacion } from "@/lib/curvas/tipos-api";

export type { TemporadaAgrupacion };

/** Nivel de planificación del nodo (02b). */
export type NivelGmle = "GML" | "GMLE";

/** Agrupación del nodo GML: una sola, dos o más, o ninguna. `null` en los nodos `GMLE`. */
export type AgrupacionNodoGmle = "unica" | "mixta" | "sin";

/** Qué es la fila para M7: el nodo entero, la equivalencia suelta o nada (no vigente). */
export type UnidadGmle = "nodo" | "equivalencia" | "ninguna";

// ─── Anomalías ───

/** Los seis avisos de revisión. Ninguno es un error del sistema. */
export type AnomaliaGmle =
  | "sin_agrupacion"
  | "genero_no_incluido"
  | "generica_discrepante"
  | "nodo_gml_mixto"
  | "linea_partida"
  | "agrupacion_vacia";

/** Orden fijo (de mayor a menor prioridad) en que salen los códigos de cada fila. */
export const ANOMALIAS_GMLE: readonly AnomaliaGmle[] = [
  "sin_agrupacion",
  "genero_no_incluido",
  "generica_discrepante",
  "nodo_gml_mixto",
  "linea_partida",
  "agrupacion_vacia",
];

export type PrioridadAnomaliaGmle = "alta" | "media" | "baja";

export const PRIORIDAD_ANOMALIA_GMLE: Record<AnomaliaGmle, PrioridadAnomaliaGmle> = {
  sin_agrupacion: "alta",
  genero_no_incluido: "alta",
  generica_discrepante: "media",
  nodo_gml_mixto: "media",
  linea_partida: "baja",
  agrupacion_vacia: "baja",
};

export const ETIQUETA_ANOMALIA_GMLE: Record<AnomaliaGmle, string> = {
  sin_agrupacion: "Sin agrupación",
  genero_no_incluido: "Género no incluido",
  generica_discrepante: "Genérica discrepante",
  nodo_gml_mixto: "Nodo GML mixto",
  linea_partida: "Línea partida",
  agrupacion_vacia: "Agrupación vacía",
};

// ─── Respuesta ───

/** Cuántas filas del grano de cada código hay (líneas, nodos, equivalencias o agrupaciones), no equivalencias propagadas. */
export type ConteoAnomaliasGmle = Record<AnomaliaGmle, number>;

/** Todo sobre el universo vigente (equivalencia activa en nodo vigente). */
export type ResumenGmle = {
  /** Todas las agrupaciones, activas o no. */
  agrupaciones: number;
  agrupaciones_activas: number;
  /** Nodos vigentes. */
  nodos: number;
  nodos_gml: number;
  nodos_gmle: number;
  nodos_gml_mixtos: number;
  /** Σ `nodos[].unidades`. */
  unidades: number;
  /** Equivalencias vigentes. */
  equivalencias: number;
  /** De las anteriores, las genéricas. */
  genericas: number;
  anomalias: ConteoAnomaliasGmle;
};

export type GeneroDeAgrupacionGmle = { id: string; nombre: string };

export type AgrupacionGmle = {
  id: string;
  codigo: string;
  nombre: string;
  temporada: TemporadaAgrupacion;
  activo: boolean;
  /** Por `orden, nombre` del género; vacío = "sin género". */
  generos: GeneroDeAgrupacionGmle[];
  /** Nodos `GML` vigentes cuya agrupación es `unica` y es esta. */
  nodos_gml: number;
  /** Nodos `GML` mixtos cuyo reparto incluye esta agrupación. */
  nodos_gml_mixtos: number;
  /** Equivalencias vigentes de nodos `GMLE` con esta agrupación. */
  unidades_gmle: number;
  /** Equivalencias vigentes con esta agrupación (aunque esté inactiva). */
  equivalencias: number;
  /** De las anteriores, las genéricas. */
  genericas: number;
  /** Líneas distintas de esas equivalencias. */
  lineas: number;
  /** `[]` o `["agrupacion_vacia"]`. */
  anomalias: AnomaliaGmle[];
};

/** Una entrada del reparto de un nodo; `agrupacion_id: null` = sin agrupación activa. */
export type RepartoNodoGmle = { agrupacion_id: string | null; equivalencias: number };

export type NodoGmle = {
  id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  /** `"GÉNERO / MUNDO / LÍNEA"`. */
  ruta: string;
  /** El guardado, aunque el nodo esté inactivo. */
  nivel: NivelGmle;
  vigente: boolean;
  /** 1 (GML con equivalencias vigentes), una por equivalencia vigente (GMLE) o 0. */
  unidades: number;
  /** `null` solo en `GMLE`. */
  agrupacion_nodo: AgrupacionNodoGmle | null;
  /** Solo con `agrupacion_nodo: "unica"`. */
  agrupacion_id: string | null;
  /** La de más equivalencias vigentes reales; empate o nada: `null`. */
  mayoritaria_id: string | null;
  /** Por equivalencias descendente, `null` (sin agrupación) al final. Vacío si no hay equivalencias vigentes. */
  reparto: RepartoNodoGmle[];
  /** `[]` o `["nodo_gml_mixto"]`. */
  anomalias: AnomaliaGmle[];
};

export type EquivalenciaGmle = {
  id: string;
  nodo_id: string;
  /** `null` = sin agrupación. */
  agrupacion_id: string | null;
  /** Nombre de la agrupación; cadena vacía si no tiene. */
  agrupacion: string;
  /** De la agrupación; `null` si no tiene. */
  temporada: TemporadaAgrupacion | null;
  genero: string;
  mundo: string;
  linea: string;
  nivel: NivelGmle;
  unidad: UnidadGmle;
  equivalencia: string;
  codigo: string;
  es_generica: boolean;
  activo: boolean;
  /** El nodo y sus padres están activos. */
  vigente: boolean;
  /** La agrupación existe y está activa. */
  agrupacion_activa: boolean;
  /** `[]` en las filas inactivas o no vigentes. */
  anomalias: AnomaliaGmle[];
};

export type AgrupacionDeLineaPartidaGmle = {
  id: string;
  nombre: string;
  equivalencias: number;
  /** Nombres de los mundos donde está, por `orden` del mundo. */
  mundos: string[];
};

export type LineaPartidaGmle = {
  genero_id: string;
  linea_id: string;
  genero: string;
  linea: string;
  /** Dos o más, por nombre. */
  agrupaciones: AgrupacionDeLineaPartidaGmle[];
};

export type CatalogoGmle = { id: string; nombre: string; orden: number; activo: boolean };

export type ReporteAgrupacionGmle = {
  resumen: ResumenGmle;
  /** Por nombre. */
  agrupaciones: AgrupacionGmle[];
  /** Por género, mundo, línea. */
  nodos: NodoGmle[];
  /** Por género, mundo, línea y, dentro del nodo, reales por nombre con la genérica al final. */
  equivalencias: EquivalenciaGmle[];
  /** Por género y línea. */
  lineas_partidas: LineaPartidaGmle[];
  catalogos: { generos: CatalogoGmle[]; mundos: CatalogoGmle[] };
};
