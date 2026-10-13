/**
 * Contrato de la API de M6 para el frontend (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API"), PASO 1: temporada de la agrupación, periodos atípicos y
 * la lectura de años atípicos que M7 consumirá. Describe el JSON que viaja, no
 * las filas de la base.
 *
 * Autocontenido a propósito: no importa nada (ni componentes, ni acceso a la
 * base, ni código de cliente), así que lo pueden usar tanto el servidor como la
 * pantalla.
 * Los nombres son parte del contrato: lo que M6 añada después irá en campos
 * nuevos, sin cambiar estos.
 *
 * Fechas: en la API los meses viajan como `aaaa-mm` (`"2023-03"`); la base
 * guarda el primer día del mes y el handler convierte en los dos sentidos.
 */

// ─── Temporada de la agrupación de estacionalidad ───

/**
 * Códigos (minúsculas con guion bajo), distintos de las etiquetas de
 * `lineas.temporada` de M1 (`Verano` / `Invierno` / `Todo el año`).
 */
export const TEMPORADAS_AGRUPACION = ["invierno", "verano", "todo_el_ano"] as const;
export type TemporadaAgrupacion = (typeof TEMPORADAS_AGRUPACION)[number];

/** Texto de pantalla de cada temporada ("Toda temporada" es la etiqueta de `todo_el_ano`). */
export const ETIQUETA_TEMPORADA: Record<TemporadaAgrupacion, string> = {
  invierno: "Invierno",
  verano: "Verano",
  todo_el_ano: "Toda temporada",
};

/**
 * Campos de temporada que lleva cada agrupación de estacionalidad en
 * `GET/POST/PATCH /api/agrupaciones-estacionalidad` (y, sin el aviso, en los
 * catálogos de la lista plana de M3).
 */
export type TemporadaDeAgrupacionApi = {
  /** La fija el planner; las agrupaciones existentes nacen `todo_el_ano`. */
  temporada: TemporadaAgrupacion;
  /**
   * Temporada mayoritaria de las líneas (M1) de sus equivalencias activas, por
   * número de equivalencias. Empate o sin equivalencias: `todo_el_ano`.
   */
  temporada_sugerida: TemporadaAgrupacion;
  /**
   * Aviso `temporada_sugerida_distinta`: verdadero si la agrupación tiene al
   * menos una equivalencia activa y su `temporada` no coincide con la sugerida.
   */
  temporada_sugerida_distinta: boolean;
};

// ─── Periodos atípicos (`/api/periodos-atipicos`) ───

/**
 * `invierno`: solo ajusta a las agrupaciones con `temporada = 'invierno'`.
 * `todas`: ajusta a todas las agrupaciones.
 */
export const ALCANCES_PERIODO = ["invierno", "todas"] as const;
export type AlcancePeriodo = (typeof ALCANCES_PERIODO)[number];

export const ETIQUETA_ALCANCE: Record<AlcancePeriodo, string> = {
  invierno: "Solo agrupaciones de invierno",
  todas: "Todas las agrupaciones",
};

/** Un periodo atípico tal como lo devuelven POST (`201`) y PATCH. */
export type PeriodoAtipicoApi = {
  id: string;
  /** Primer mes incluido, `aaaa-mm`. */
  desde: string;
  /** Último mes incluido, `aaaa-mm` (inclusive; `hasta >= desde`). */
  hasta: string;
  /** 1 a 120 caracteres, tal como se escribió (sin pasar a mayúsculas). */
  motivo: string;
  /** Hasta 500 caracteres; `null` si está vacía. */
  descripcion: string | null;
  alcance: AlcancePeriodo;
  /** Desactivar un periodo lo saca del cálculo sin perder el registro. */
  activo: boolean;
  created_at: string;
  updated_at: string;
};

/** Fila de `GET /api/periodos-atipicos` (`data` es un arreglo ordenado por `desde`). */
export type PeriodoAtipicoLista = PeriodoAtipicoApi & {
  /** Cuántos meses cubre (`desde = hasta` es 1). */
  meses: number;
  /**
   * Agrupaciones activas a las que afectaría: con alcance `invierno`, las de
   * `temporada = 'invierno'`; con `todas`, todas las activas.
   */
  agrupaciones_afectadas: number;
};

export type CrearPeriodoAtipicoCuerpo = {
  desde: string;
  hasta: string;
  motivo: string;
  descripcion?: string | null;
  /** Por defecto `invierno`. */
  alcance?: AlcancePeriodo;
};

export type EditarPeriodoAtipicoCuerpo = Partial<{
  desde: string;
  hasta: string;
  motivo: string;
  descripcion: string | null;
  alcance: AlcancePeriodo;
  activo: boolean;
}>;

/** `DELETE /api/periodos-atipicos/[id]`. */
export type EliminarPeriodoAtipicoRespuesta = { id: string };

// ─── Años atípicos (`claseDeAnio` y `GET /api/periodos-atipicos/anios`) ───

export type ClaseAnio = "normal" | "atipico";

/** Un periodo activo que aplica a la agrupación y cubre algún mes del año. */
export type PeriodoDeAnio = { id: string; motivo: string; alcance: AlcancePeriodo };

/** Lo que devuelve `claseDeAnio(anio, agrupacion, periodos, mesesPublicados)`. */
export type ClaseDeAnioApi = {
  anio: number;
  clase: ClaseAnio;
  /** Meses `aaaa-mm` del año dentro de un periodo atípico que aplica, en orden; pueden ser futuros. */
  meses_atipicos: string[];
  periodos: PeriodoDeAnio[];
  /** Los 12 meses del año están publicados en M5; un año en curso o con meses sin cargar es `false`. */
  completo: boolean;
};

/** Un año de `GET /api/periodos-atipicos/anios`. */
export type AnioAtipicidadApi = ClaseDeAnioApi & {
  /** De la última corrida, si existe y la agrupación tiene comparación; `null` si no (siempre `null` por temporada y en el paso 1). */
  ratio_volumen: number | null;
};

/** Lo que se evaluó: o una agrupación concreta (`agrupacion_id`) o una temporada (`agrupacion_id: null`). */
export type CriterioAnios = { agrupacion_id: string | null; temporada: TemporadaAgrupacion };

export type ResumenAnios = {
  /** Años con `clase = "atipico"`, ascendente. */
  anios_atipicos: number[];
  /** Años `normal` con `completo = true`, ascendente. */
  anios_normales_completos: number[];
};

/**
 * `data` de `GET /api/periodos-atipicos/anios`, con `?agrupacion_id=<uuid>` o
 * `?temporada=invierno|verano|todo_el_ano` (por defecto `invierno`) y,
 * opcional, `?desde=2023&hasta=2026` (años).
 */
export type AniosAtipicosRespuesta = {
  criterio: CriterioAnios;
  anios: AnioAtipicidadApi[];
  resumen: ResumenAnios;
};
