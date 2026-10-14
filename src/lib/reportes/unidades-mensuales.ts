import { aCentimos, centimosASoles, redondear2 } from "@/lib/ventas/numeros";
import type { MesUnidades, UnidadesMensuales } from "./tipos-unidades";

/**
 * Arma la respuesta de "unidades vendidas por mes" (M11, histograma del
 * Resumen) a partir de las filas de la función SQL `unidades_mensuales`. Pura:
 * no toca la base ni nombra tablas.
 *
 * PostgREST puede devolver `bigint` y `numeric` como número o como texto según
 * su tamaño, y `date` como `YYYY-MM-DD`; aquí todo se normaliza.
 */

export type FilaUnidadesMensuales = {
  periodo: string;
  unidades: number | string;
  venta_soles: number | string;
};

const PERIODO = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

function aNumero(valor: number | string, campo: string): number {
  const n = typeof valor === "string" ? (valor.trim() === "" ? Number.NaN : Number(valor)) : valor;
  if (!Number.isFinite(n)) throw new Error(`unidades_mensuales: ${campo} no es un número (${String(valor)})`);
  return n;
}

function aPeriodo(valor: string): string {
  const m = PERIODO.exec(valor);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`unidades_mensuales: periodo inválido (${valor})`);
  return `${m[1]}-${m[2]}`;
}

/**
 * Agrupa por mes (por si la base devolviera dos filas del mismo mes), ordena de
 * más antiguo a más reciente y calcula los totales. Los soles se suman en
 * céntimos enteros para no arrastrar ruido de coma flotante.
 *
 * `equivalencias`: nº de ids pedidos (sin repetidos); `null` = todas.
 */
export function armarUnidadesMensuales(
  filas: readonly FilaUnidadesMensuales[],
  equivalencias: number | null
): UnidadesMensuales {
  const porMes = new Map<string, { unidades: number; centimos: number }>();
  for (const f of filas) {
    const periodo = aPeriodo(f.periodo);
    const acumulado = porMes.get(periodo) ?? { unidades: 0, centimos: 0 };
    acumulado.unidades += aNumero(f.unidades, "unidades");
    acumulado.centimos += aCentimos(aNumero(f.venta_soles, "venta_soles"));
    porMes.set(periodo, acumulado);
  }

  const meses: MesUnidades[] = [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([periodo, v]) => ({ periodo, unidades: v.unidades, venta_soles: centimosASoles(v.centimos) }));

  const totalUnidades = meses.reduce((s, m) => s + m.unidades, 0);
  const totalCentimos = [...porMes.values()].reduce((s, v) => s + v.centimos, 0);

  return {
    meses,
    total_unidades: totalUnidades,
    total_venta_soles: redondear2(centimosASoles(totalCentimos)),
    equivalencias,
  };
}

/** Respuesta sin consultar la base: se pidió una lista vacía de equivalencias. */
export const UNIDADES_MENSUALES_VACIAS: UnidadesMensuales = {
  meses: [],
  total_unidades: 0,
  total_venta_soles: 0,
  equivalencias: 0,
};
