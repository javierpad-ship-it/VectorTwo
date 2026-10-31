import type { EstimacionApi, PreciosIa, UsoTokensIa } from "./tipos-api";

/**
 * Costo de las llamadas: cálculo, estimación previa y topes (ficha 07e, §3.9; R14, ejemplo G). Puro.
 *
 *   costo_usd = (T_ent × p_ent + T_cache × p_cache + T_sal × p_sal) ÷ 10⁶
 *
 * `T_ent` y `T_cache` son disjuntos (la entrada servida desde la caché del proveedor no cuenta dos veces). Ningún precio vive en el código.
 *
 * La estimación es deliberadamente generosa y SIN caché (decisión 74): cada llamada cuenta el texto fijo, el bloque y el sufijo como
 * entrada y nada como `entrada_cache`; si el proveedor cachea el prefijo, el gasto real queda por debajo. La salida (`85 × filas`
 * natural, `110 × filas` reparto, `150 × llamada`) domina el costo; el margen de 1,2 cubre reintentos.
 */

export const TOKENS_SISTEMA = 5000;
export const BYTES_POR_TOKEN = 3;
export const MARGEN_ESTIMACION = 1.2;
const SALIDA_NATURAL_POR_FILA = 85;
const SALIDA_REPARTO_POR_FILA = 110;
const SALIDA_LINEAS_POR_LINEA = 110;
const SALIDA_POR_LLAMADA = 150;
const ENTRADA_SUFIJO_NATURAL = 60;
const ENTRADA_SUFIJO_REPARTO_BASE = 200;
const ENTRADA_SUFIJO_REPARTO_POR_FILA = 12;

/** Redondeo a 4 decimales (`numeric(10,4)`). */
export const redondearUsd = (x: number): number => Math.round(x * 10000) / 10000;

/** USD de un uso de tokens con los precios por millón. Sin redondear. */
export function costoUsd(uso: UsoTokensIa, precios: PreciosIa): number {
  return (uso.entrada * precios.entrada + uso.entrada_cache * precios.entrada_cache + uso.salida * precios.salida) / 1e6;
}

export const tokensDeBytes = (bytes: number): number => Math.ceil(Math.max(0, bytes) / BYTES_POR_TOKEN);

const USO_CERO: UsoTokensIa = { entrada: 0, entrada_cache: 0, salida: 0 };

const sumarUso = (a: UsoTokensIa, b: UsoTokensIa): UsoTokensIa => ({
  entrada: a.entrada + b.entrada,
  entrada_cache: a.entrada_cache + b.entrada_cache,
  salida: a.salida + b.salida,
});

export type LlamadaParaEstimar =
  | { tipo: "natural"; tokens_bloque: number; filas_libres: number }
  | { tipo: "reparto"; tokens_bloque: number; filas_libres: number }
  | { tipo: "lineas"; tokens_entrada: number; lineas: number };

/** Uso esperado de UNA llamada (sin margen, sin caché): sirve a la estimación previa y a la comprobación antes de cada llamada. */
export function estimarUsoLlamada(l: LlamadaParaEstimar): UsoTokensIa {
  if (l.tipo === "natural") {
    return {
      entrada: TOKENS_SISTEMA + l.tokens_bloque + ENTRADA_SUFIJO_NATURAL,
      entrada_cache: 0,
      salida: SALIDA_NATURAL_POR_FILA * l.filas_libres + SALIDA_POR_LLAMADA,
    };
  }
  if (l.tipo === "reparto") {
    return {
      entrada: TOKENS_SISTEMA + l.tokens_bloque + ENTRADA_SUFIJO_REPARTO_BASE + ENTRADA_SUFIJO_REPARTO_POR_FILA * l.filas_libres,
      entrada_cache: 0,
      salida: SALIDA_REPARTO_POR_FILA * l.filas_libres + SALIDA_POR_LLAMADA,
    };
  }
  return { entrada: TOKENS_SISTEMA + l.tokens_entrada, entrada_cache: 0, salida: SALIDA_LINEAS_POR_LINEA * l.lineas + SALIDA_POR_LLAMADA };
}

export type GMParaEstimar = {
  /** Bytes del bloque de cada lote y filas libres de cada uno (mismo orden). */
  lotes: { bytes_bloque: number; filas_libres: number }[];
  /** Solo jerárquico: bytes de la entrada `lineas` y cuántas líneas lleva. */
  lineas?: { bytes: number; lineas: number };
  /** Una propuesta vigente con la misma huella: se reusa sin llamar. */
  reusable?: boolean;
};

export type EstimacionInterna = { llamadas: number; uso: UsoTokensIa; costo_usd: number };

/** Estimación de un GM sin margen y sin caché. */
export function estimarGM(gm: GMParaEstimar, precios: PreciosIa): EstimacionInterna {
  if (gm.reusable) return { llamadas: 0, uso: { ...USO_CERO }, costo_usd: 0 };
  let uso: UsoTokensIa = { ...USO_CERO };
  let llamadas = 0;
  for (const lote of gm.lotes) {
    const tokens = tokensDeBytes(lote.bytes_bloque);
    uso = sumarUso(uso, estimarUsoLlamada({ tipo: "natural", tokens_bloque: tokens, filas_libres: lote.filas_libres }));
    llamadas += 1;
  }
  if (gm.lineas) {
    uso = sumarUso(uso, estimarUsoLlamada({ tipo: "lineas", tokens_entrada: tokensDeBytes(gm.lineas.bytes), lineas: gm.lineas.lineas }));
    llamadas += 1;
  }
  for (const lote of gm.lotes) {
    uso = sumarUso(uso, estimarUsoLlamada({ tipo: "reparto", tokens_bloque: tokensDeBytes(lote.bytes_bloque), filas_libres: lote.filas_libres }));
    llamadas += 1;
  }
  return { llamadas, uso, costo_usd: costoUsd(uso, precios) };
}

/** Estimación de una corrida (con margen de 1,2 por reintentos) en la forma que muestra la pantalla. */
export function estimarCorrida(gms: readonly GMParaEstimar[], precios: PreciosIa, tope_usd: number): EstimacionApi {
  let uso: UsoTokensIa = { ...USO_CERO };
  let llamadas = 0;
  let filas = 0;
  let reusables = 0;
  for (const gm of gms) {
    if (gm.reusable) {
      reusables += 1;
      continue;
    }
    const e = estimarGM(gm, precios);
    uso = sumarUso(uso, e.uso);
    llamadas += e.llamadas;
    filas += gm.lotes.reduce((a, l) => a + l.filas_libres, 0);
  }
  return {
    gms: gms.length - reusables,
    llamadas,
    filas,
    tokens_entrada: Math.ceil((uso.entrada + uso.entrada_cache) * MARGEN_ESTIMACION),
    tokens_salida: Math.ceil(uso.salida * MARGEN_ESTIMACION),
    costo_usd: redondearUsd(costoUsd(uso, precios) * MARGEN_ESTIMACION),
    tope_usd,
    reusables,
  };
}

// ─── Topes ───

export type MotivoTope = "tope_corrida" | "tope_mensual" | "tope_dia";

export type TopesDisponibles = {
  tope_usd_corrida: number;
  /** Lo que queda del tope del mes (`tope_usd_mes − gasto del mes`, corridas y evaluaciones juntas). */
  restante_mes_usd: number;
  /** Lo que queda del tope del usuario en el día de Lima. */
  restante_dia_usuario_usd: number;
};

const centavos = (x: number): number => Math.round(x * 10000);

/** La corrida no arranca si la estimación (con margen) supera el tope de la corrida, lo que queda del mes o lo que queda del día del usuario. */
export function motivoNoArranca(estimacion_usd: number, t: TopesDisponibles): MotivoTope | null {
  const e = centavos(estimacion_usd);
  if (e > centavos(t.tope_usd_corrida)) return "tope_corrida";
  if (e > centavos(t.restante_mes_usd)) return "tope_mensual";
  if (e > centavos(t.restante_dia_usuario_usd)) return "tope_dia";
  return null;
}

/** Se detiene antes de una llamada si el gasto acumulado más la estimación de esa llamada pasa de cualquier tope. */
export function motivoDetencion(a: {
  gasto_corrida_usd: number;
  estimacion_llamada_usd: number;
  tope_usd_corrida: number;
  gasto_mes_usd: number;
  tope_usd_mes: number;
  gasto_dia_usuario_usd: number;
  tope_usd_dia_usuario: number;
}): MotivoTope | null {
  const e = centavos(a.estimacion_llamada_usd);
  if (centavos(a.gasto_corrida_usd) + e > centavos(a.tope_usd_corrida)) return "tope_corrida";
  if (centavos(a.gasto_mes_usd) + e > centavos(a.tope_usd_mes)) return "tope_mensual";
  if (centavos(a.gasto_dia_usuario_usd) + e > centavos(a.tope_usd_dia_usuario)) return "tope_dia";
  return null;
}
