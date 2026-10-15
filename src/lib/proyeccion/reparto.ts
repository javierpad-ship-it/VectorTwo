import type { OrigenMes } from "./tipos-api";

/**
 * Reparto entero de un total en meses (ficha 07, paso 3 y reglas 15 y 16). Puro.
 * Redondea siempre al final: la suma de los meses es exactamente el total.
 */

/**
 * `m_i = floor(total × w_i)` y el resto, de uno en uno, a los mayores restos fraccionarios
 * (empate: el mes más temprano). `total = 0` → ceros; pesos nulos → `null`; pesos que suman
 * cero → reparto plano.
 */
export function repartirEntero(total: number, pesos: readonly number[] | null): number[] | null {
  if (pesos === null || pesos.length === 0) return null;
  const n = pesos.length;
  const objetivo = Math.max(0, Math.round(total));
  if (objetivo === 0) return Array.from({ length: n }, () => 0);
  const limpios = pesos.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  let suma = limpios.reduce((a, b) => a + b, 0);
  const usados = suma > 0 ? limpios : Array.from({ length: n }, () => 1);
  if (suma <= 0) suma = n;

  const exactos = usados.map((w) => (objetivo * w) / suma);
  const base = exactos.map((x) => Math.floor(x + 1e-9));
  let falta = objetivo - base.reduce((a, b) => a + b, 0);
  if (falta > 0) {
    const orden = exactos
      .map((x, i) => ({ i, resto: x - base[i] }))
      .sort((a, b) => b.resto - a.resto || a.i - b.i);
    for (let j = 0; j < orden.length && falta > 0; j++) {
      base[orden[j].i] += 1;
      falta -= 1;
    }
  }
  // Si el redondeo de `floor(x + 1e-9)` se pasó (muy raro), se quita de los meses con menor resto.
  if (falta < 0) {
    const orden = exactos
      .map((x, i) => ({ i, resto: x - base[i] }))
      .sort((a, b) => a.resto - b.resto || b.i - a.i);
    for (let j = 0; j < orden.length && falta < 0; j++) {
      if (base[orden[j].i] > 0) {
        base[orden[j].i] -= 1;
        falta += 1;
      }
    }
  }
  return base;
}

export type ResultadoReparto = { meses: number[] | null; origen_meses: OrigenMes[] | null };

/**
 * Regla 16. Los meses `≤ k` son el real (`serieReal`, doce valores) y solo se reparte el resto
 * `total − V` entre los meses `> k` con `curva × φ`. Sin curva → `meses = null`. `k = 0` es un año
 * sin real (el siguiente): todo proyectado.
 */
export function repartirResto(
  total: number,
  serieReal: readonly number[],
  k: number,
  curva: readonly number[] | null,
  factoresMes?: readonly number[],
  pesosExtra?: readonly number[]
): ResultadoReparto {
  if (curva === null) return { meses: null, origen_meses: null };
  const n = curva.length;
  const real = Array.from({ length: n }, (_, i) => (i < k ? Math.max(0, Math.round(serieReal[i] ?? 0)) : 0));
  const vendido = real.reduce((a, b) => a + b, 0);
  const pesos = curva.map((c, i) => (i < k ? 0 : c * (factoresMes?.[i] ?? 1) * (pesosExtra?.[i] ?? 1)));
  const resto = Math.max(0, Math.round(total) - vendido);
  // Si la curva no pesa ningún mes restante, el resto se reparte parejo entre ellos.
  const pesosRestantes = pesos.some((p) => p > 0) ? pesos : pesos.map((_, i) => (i < k ? 0 : 1));
  const reparto: number[] =
    k >= n ? Array.from({ length: n }, () => 0) : (repartirEntero(resto, pesosRestantes) ?? Array.from({ length: n }, () => 0));
  const meses = real.map((v, i) => (i < k ? v : reparto[i]));
  const origen_meses: OrigenMes[] = meses.map((_, i) => (i < k ? "real" : "proyectado"));
  return { meses, origen_meses };
}

/** Los doce meses reales (primeros `k`) de una serie, con ceros después. */
export function soloReales(serie: readonly number[], k: number): number[] {
  return Array.from({ length: 12 }, (_, i) => (i < k ? (serie[i] ?? 0) : 0));
}
