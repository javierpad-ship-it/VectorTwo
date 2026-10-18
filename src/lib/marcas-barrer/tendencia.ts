import type { Mes } from "./tipos";

/**
 * Tendencia (ficha 12, regla 8): `A₂ ÷ A₁ − 1` entre los dos ÚLTIMOS años completos de la ventana. Con un solo año completo
 * (o con `A₁ = 0`) no hay tendencia (`null`). Informativa. Pura.
 */

const anioDe = (m: Mes) => Number(m.slice(0, 4));

/** Suma por año calendario de una serie mensual. */
export function sumaPorAnio(serie: ReadonlyMap<Mes, number>): Map<number, number> {
  const r = new Map<number, number>();
  for (const [m, u] of serie) r.set(anioDe(m), (r.get(anioDe(m)) ?? 0) + u);
  return r;
}

/** `A₂ ÷ A₁ − 1` de los dos últimos años de `completos` (ascendentes); `null` si hay menos de dos o `A₁ ≤ 0`. */
export function tendencia(serie: ReadonlyMap<Mes, number>, completos: readonly number[]): number | null {
  if (completos.length < 2) return null;
  const [a1, a2] = completos.slice(-2);
  const porAnio = sumaPorAnio(serie);
  const v1 = porAnio.get(a1) ?? 0;
  const v2 = porAnio.get(a2) ?? 0;
  return v1 > 0 ? v2 / v1 - 1 : null;
}
