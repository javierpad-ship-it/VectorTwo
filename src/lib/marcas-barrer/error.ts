import { temporadaDe } from "./temporadas";
import { repartoVectores, vectorSobre, type SeriesNormalizadas } from "./reparto";
import {
  ERR_ESTABLE,
  ERR_INESTABLE,
  TEMPORADAS,
  TEMPORADAS_DEFECTO,
  type AvisoBarrer,
  type ModoEntrada,
  type TemporadasConfig,
  type VeredictoError,
} from "./tipos-api";
import type { ClaveG, LlaveVector, Mes } from "./tipos";

/**
 * Error del reparto (ficha 12, regla 6): el backtesting de la mezcla. Cuánto se habría equivocado el reparto calculado con los
 * datos hasta el fin del año `A−1` (misma ventana recortada, mismo modo, mismo alcance) frente a la mezcla REAL de la parte
 * al barrer del año `A`. Puro.
 *
 * Años evaluables (ajuste a la ficha, que dice "último año completo" pero ilustra el caso con 24 meses a septiembre y el error
 * "2025→2026"): un año `A` se evalúa si la ventana trae al menos `MIN_MESES_ANIO_PRUEBA` meses de `A` (el año en curso cuenta
 * aunque no esté completo) y al menos `MIN_MESES_PREVIOS` meses ANTERIORES a enero de `A` con que calcular el reparto. Se toman
 * los dos últimos evaluables y el error es el promedio.
 */

export const MIN_MESES_ANIO_PRUEBA = 6;
export const MIN_MESES_PREVIOS = 12;

/** EAT del reparto en puntos porcentuales: `50 × Σ|p − q|` (0 si son iguales, 100 si no comparten ninguna `g`). */
export function eatPp(p: ReadonlyMap<ClaveG, number>, q: ReadonlyMap<ClaveG, number>): number {
  let s = 0;
  for (const c of new Set([...p.keys(), ...q.keys()])) s += Math.abs((p.get(c) ?? 0) - (q.get(c) ?? 0));
  return s * 50;
}

/** `estable` si `err ≤ ERR_ESTABLE`, `inestable` si `> ERR_INESTABLE`, `dudoso` entre medias; `null` sin error. */
export function veredictoError(pp: number | null): VeredictoError | null {
  if (pp === null) return null;
  if (pp <= ERR_ESTABLE) return "estable";
  if (pp > ERR_INESTABLE) return "inestable";
  return "dudoso";
}

const anioDe = (m: Mes) => Number(m.slice(0, 4));

/** Años de la ventana en que se puede hacer el backtesting (ascendente). */
export function aniosEvaluables(meses: readonly Mes[]): number[] {
  const anios = [...new Set(meses.map(anioDe))].sort((a, b) => a - b);
  return anios.filter((a) => {
    const enA = meses.filter((m) => anioDe(m) === a).length;
    const previos = meses.filter((m) => anioDe(m) < a).length;
    return enA >= MIN_MESES_ANIO_PRUEBA && previos >= MIN_MESES_PREVIOS;
  });
}

export type EntradaErrorReparto = {
  series: SeriesNormalizadas;
  /** Las `g` del alcance (con o sin venta en cada subventana). */
  claves: readonly ClaveG[];
  /** Los meses de la ventana, ascendentes. */
  meses: readonly Mes[];
  modo: ModoEntrada;
  temporadas?: TemporadasConfig;
};

export type ResultadoErrorReparto = {
  pp: number | null;
  veredicto: VeredictoError | null;
  anios: { anio: number; pp: number }[];
  avisos: AvisoBarrer[];
};

/** Regla 6. Sin ningún año evaluable → `pp = null` y aviso `sin_backtesting`. */
export function errorReparto(e: EntradaErrorReparto): ResultadoErrorReparto {
  const temporadas = e.temporadas ?? TEMPORADAS_DEFECTO;
  const evaluables = aniosEvaluables(e.meses).slice(-2);
  const anios: { anio: number; pp: number }[] = [];

  for (const A of evaluables) {
    const previos = e.meses.filter((m) => anioDe(m) < A);
    const delAnio = e.meses.filter((m) => anioDe(m) === A);
    const prev = repartoVectores(e.series, e.claves, previos, e.modo, temporadas);

    let suma = 0;
    let peso = 0;
    const llaves: LlaveVector[] = prev.modo_efectivo === "anual" ? ["anual"] : [...TEMPORADAS];
    for (const llave of llaves) {
      const esperado = prev.vectores.get(llave);
      const mesesLlave = llave === "anual" ? delAnio : delAnio.filter((m) => temporadaDe(Number(m.slice(5, 7)), temporadas) === llave);
      if (!esperado || mesesLlave.length === 0) continue;
      const real = vectorSobre(e.series, e.claves, mesesLlave);
      if (!real) continue;
      let w = 0;
      for (const c of e.claves) for (const m of mesesLlave) w += Math.max(0, e.series.get(c)?.get(m) ?? 0);
      suma += eatPp(esperado, real) * w;
      peso += w;
    }
    if (peso > 0) anios.push({ anio: A, pp: suma / peso });
  }

  if (anios.length === 0) return { pp: null, veredicto: null, anios: [], avisos: ["sin_backtesting"] };
  const pp = anios.reduce((a, b) => a + b.pp, 0) / anios.length;
  return { pp, veredicto: veredictoError(pp), anios, avisos: [] };
}
