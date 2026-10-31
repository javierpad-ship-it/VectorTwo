import { BYTES_POR_TOKEN, type GMParaEstimar } from "./costo";
import { TOKENS_POR_FILA_BLOQUE, TOKENS_POR_LOTE_BLOQUE } from "./limites";

/**
 * Estimación previa de un GM por CONTEO de filas (ficha 07e, §3.9): no hace falta cargar la historia de cada GM para decirle al planner cuánto va a
 * costar. Supone ≈ 260 tokens por fila en el bloque y 500 por lote (medidas de la ficha), el modo directo hasta `max_filas_llamada` filas y el
 * jerárquico por encima. Pura. El gasto real lo mide cada llamada y los topes se comprueban antes de cada una.
 */

export type GMParaPlan = {
  gm_clave: string;
  /** Filas libres (las que se piden). */
  libres: number;
  /** Filas fijas que viajan como contexto (decididas o con % propio; la cola larga no viaja). */
  fijas: number;
  lineas_libres: number;
  max_filas_llamada: number;
  /** Hay una propuesta vigente al día con la misma terna: se reusa sin llamar. */
  reusable: boolean;
};

export type EstimacionGM = { modo: "directo" | "jerarquico"; llamadas: number; gm: GMParaEstimar };

const TOKENS_POR_LINEA = 120;
const TOKENS_BASE_LINEAS = 800;

export function armarEstimacionGM(p: GMParaPlan): EstimacionGM {
  const viajan = p.libres + p.fijas;
  const max = Math.max(1, p.max_filas_llamada);
  const bytes = (filas: number) => (TOKENS_POR_FILA_BLOQUE * filas + TOKENS_POR_LOTE_BLOQUE) * BYTES_POR_TOKEN;
  if (viajan <= max) return { modo: "directo", llamadas: 2, gm: { lotes: [{ bytes_bloque: bytes(viajan), filas_libres: p.libres }], reusable: p.reusable } };
  const k = Math.ceil(viajan / max);
  const lotes = Array.from({ length: k }, (_, i) => {
    const filas = Math.floor(viajan / k) + (i < viajan % k ? 1 : 0);
    const libres = Math.floor(p.libres / k) + (i < p.libres % k ? 1 : 0);
    return { bytes_bloque: bytes(filas), filas_libres: libres };
  });
  return {
    modo: "jerarquico",
    llamadas: 2 * k + 1,
    gm: { lotes, lineas: { bytes: (TOKENS_BASE_LINEAS + TOKENS_POR_LINEA * Math.max(1, p.lineas_libres)) * BYTES_POR_TOKEN, lineas: Math.max(1, p.lineas_libres) }, reusable: p.reusable },
  };
}
