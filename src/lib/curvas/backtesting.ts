import { recortarPeriodo } from "@/lib/ventas/periodo";
import { MIN_MESES_VALIDACION_PARCIAL } from "./tipos-api";
import { sumar } from "./anios";

/**
 * Backtesting: dejar un año fuera (docs/modulos/06-curvas-estacionalidad.md,
 * "Paso 3" y reglas 13 a 16). Funciones puras.
 *
 * La métrica es la EAT: `Σ_m |ĉ_m − p_m| × 100`, en puntos (0 a 200).
 */

// ─── Regla 13: EAT y error máximo ───

/** Error absoluto total, en puntos: 0 si son iguales, 200 si no comparten ningún mes. */
export function eat(curva: readonly number[], real: readonly number[]): number {
  let s = 0;
  const n = Math.max(curva.length, real.length);
  for (let m = 0; m < n; m++) s += Math.abs((curva[m] ?? 0) - (real[m] ?? 0));
  return s * 100;
}

/** Mayor diferencia absoluta mensual, en puntos. */
export function errorMax(curva: readonly number[], real: readonly number[]): number {
  let mayor = 0;
  const n = Math.max(curva.length, real.length);
  for (let m = 0; m < n; m++) mayor = Math.max(mayor, Math.abs((curva[m] ?? 0) - (real[m] ?? 0)));
  return mayor * 100;
}

// ─── Regla 14: pliegues ───

export type Pliegue = { prueba: number; entrenamiento: number[] };

/**
 * Un pliegue por año de ajuste: el año de prueba y los demás como
 * entrenamiento. Con menos de dos años no hay pliegues (no se puede dejar un
 * año fuera y entrenar con otro).
 */
export function pliegues(aniosAjuste: readonly number[]): Pliegue[] {
  const unicos = [...new Set(aniosAjuste)].sort((a, b) => a - b);
  if (unicos.length < 2) return [];
  return unicos.map((prueba) => ({ prueba, entrenamiento: unicos.filter((a) => a !== prueba) }));
}

export type EatPliegueCruda = { anio: number; eat: number; error_max: number };

/** Promedio de los pliegues (el `eat` y el `error_max` de la candidata). `null` sin pliegues. */
export function promediarPliegues(
  porPliegue: readonly EatPliegueCruda[]
): { eat: number; error_max: number } | null {
  if (porPliegue.length === 0) return null;
  return {
    eat: sumar(porPliegue.map((p) => p.eat)) / porPliegue.length,
    error_max: sumar(porPliegue.map((p) => p.error_max)) / porPliegue.length,
  };
}

/**
 * Regla 15. Ajusta una candidata en cada pliegue con `ajustar(entrenamiento)` y
 * la compara con la participación real del año de prueba (`realDe(anio)`, en
 * unidades). Los pliegues donde la candidata no se puede ajustar se omiten.
 */
export function backtest(
  aniosAjuste: readonly number[],
  ajustar: (entrenamiento: number[]) => number[] | null,
  realDe: (anio: number) => number[] | null
): EatPliegueCruda[] {
  const salida: EatPliegueCruda[] = [];
  for (const p of pliegues(aniosAjuste)) {
    const real = realDe(p.prueba);
    const curva = ajustar(p.entrenamiento);
    if (!real || !curva) continue;
    salida.push({ anio: p.prueba, eat: eat(curva, real), error_max: errorMax(curva, real) });
  }
  return salida;
}

// ─── Regla 16: validación parcial del año en curso ───

/**
 * EAT entre la participación real dentro de los meses cargados (excluyendo los
 * atípicos) y la candidata renormalizada a esos mismos meses. Se exige
 * `k − |A| ≥ minimoMeses` (6): con menos meses útiles devuelve `null`.
 *
 * `mesesEnCurso.meses` son las unidades por mes (12); `publicados[m]` dice si el
 * mes está cargado; `atipicos` son `aaaa-mm` que aplican a la agrupación.
 */
export function validacionParcial(
  curva: readonly number[],
  mesesEnCurso: { anio: number; meses: readonly number[]; publicados: readonly boolean[] },
  atipicos: Iterable<string>,
  minimoMeses: number = MIN_MESES_VALIDACION_PARCIAL
): number | null {
  const marcados = new Set<string>();
  for (const a of atipicos) marcados.add(recortarPeriodo(a));
  const utiles: number[] = [];
  for (let m = 0; m < 12; m++) {
    const periodo = `${String(mesesEnCurso.anio).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
    if (mesesEnCurso.publicados[m] && !marcados.has(periodo)) utiles.push(m);
  }
  if (utiles.length < minimoMeses) return null;

  const real = utiles.map((m) => mesesEnCurso.meses[m]);
  const totalReal = sumar(real);
  const totalCurva = sumar(utiles.map((m) => curva[m]));
  if (!(totalReal > 0) || !(totalCurva > 0)) return null;
  return eat(
    utiles.map((m) => curva[m] / totalCurva),
    real.map((u) => u / totalReal)
  );
}

// ─── Utilidades de círculo de meses ───

/** Corrimiento circular del pico: `pico − picoReferencia` en (−6, 5]; negativo = se adelanta. */
export function corrimientoCircular(pico: number, picoReferencia: number): number {
  const d = (((pico - picoReferencia) % 12) + 12) % 12;
  return d >= 6 ? d - 12 : d;
}

/** Mes (1 a 12) de mayor valor; `mesesValidos` limita la búsqueda. Empate: el primero. */
export function mesMayor(valores: readonly number[], mesesValidos?: readonly boolean[]): number {
  let mejor = -1;
  for (let m = 0; m < valores.length; m++) {
    if (mesesValidos && !mesesValidos[m]) continue;
    if (mejor < 0 || valores[m] > valores[mejor]) mejor = m;
  }
  return mejor + 1;
}
