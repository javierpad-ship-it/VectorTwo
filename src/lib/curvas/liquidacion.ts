import { recortarPeriodo } from "@/lib/ventas/periodo";
import { UMBRAL_LIQUIDACION } from "./tipos-api";

/**
 * Liquidación: el CV % como señal (docs/modulos/06-curvas-estacionalidad.md,
 * "Liquidación" y reglas 9 y 10). Funciones puras. En esta entrega la liquidación
 * solo se marca (gráfico, tabla y aviso `liquidacion_fuerte`); ninguna candidata
 * se deflacta por ella.
 */

/** Regla 10. CV % = `costo ÷ venta` a cuatro decimales; venta cero o negativa → `null`. */
export function cvMensual(venta: number, costo: number): number | null {
  if (!(venta > 0)) return null;
  return Math.round((costo / venta) * 1e4) / 1e4;
}

function mediana(valores: readonly number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
}

export const MIN_MESES_LIQUIDACION = 3;

/**
 * Regla 9. Meses de UN año en liquidación: su CV % supera la mediana de los
 * meses no atípicos del año en más de `umbral` (relativo: `cv > mediana × (1 + umbral)`).
 * Con menos de tres meses válidos (CV no nulo y no atípico) no marca nada.
 * `atipicos` son `aaaa-mm`.
 */
export function mesesEnLiquidacion(
  cvPorMes: ReadonlyArray<{ periodo: string; cv: number | null }>,
  atipicos: Iterable<string>,
  umbral: number = UMBRAL_LIQUIDACION
): string[] {
  const marcados = new Set<string>();
  for (const a of atipicos) marcados.add(recortarPeriodo(a));
  const validos = cvPorMes.filter(
    (m): m is { periodo: string; cv: number } => m.cv !== null && !marcados.has(recortarPeriodo(m.periodo))
  );
  if (validos.length < MIN_MESES_LIQUIDACION) return [];
  const referencia = mediana(validos.map((m) => m.cv));
  const tope = referencia * (1 + umbral);
  return cvPorMes.filter((m) => m.cv !== null && m.cv > tope).map((m) => recortarPeriodo(m.periodo));
}
