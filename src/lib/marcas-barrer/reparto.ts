import { listarMeses } from "@/lib/ventas/periodo";
import { repartirProporcional } from "./resto";
import { temporadaDe } from "./temporadas";
import {
  FUENTES,
  MIN_MESES_TEMPORADA,
  TEMPORADAS,
  TEMPORADAS_DEFECTO,
  TOLERANCIA_SUMA,
  VENTANA_DEFECTO,
  type AlcanceApi,
  type AvisoBarrer,
  type FuenteReparto,
  type ModoEntrada,
  type Temporada,
  type TemporadasConfig,
} from "./tipos-api";
import type { ClaveG, LlaveVector, Mes } from "./tipos";

/**
 * Reparto `p2` de una marca a las unidades `g` (ficha 12, reglas 3, 4 y 10). Puro.
 *
 *   p2_{B,g,T} = Σ_{m∈W, T(m)=T} ũ_{B,g,m} ÷ Σ_{g∈G_A} Σ_{m∈W, T(m)=T} ũ_{B,g,m},   Σ_g p2 = 1
 *
 * con `ũ` las unidades de la parte al barrer normalizadas por el Niño y `G_A` las `g` del alcance con venta al barrer en `W`.
 */

/** `ũ` por mes de una `g` (ya dividido entre el factor del Niño). */
export type SerieNormalizada = ReadonlyMap<Mes, number>;
export type SeriesNormalizadas = ReadonlyMap<ClaveG, SerieNormalizada>;

// ─── Regla 3: alcance ───

export type ConIdsGml = { genero_id: string; mundo_id: string; linea_id: string };

/** Vacío (las tres listas) = todo. Una lista vacía de un eje no limita ese eje. */
export function alcanceVacio(a: AlcanceApi): boolean {
  return a.generos.length === 0 && a.mundos.length === 0 && a.lineas.length === 0;
}

export function enAlcance(g: ConIdsGml, a: AlcanceApi): boolean {
  return (
    (a.generos.length === 0 || a.generos.includes(g.genero_id)) &&
    (a.mundos.length === 0 || a.mundos.includes(g.mundo_id)) &&
    (a.lineas.length === 0 || a.lineas.includes(g.linea_id))
  );
}

/** Parte las filas entre las que el alcance deja dentro y las que deja fuera (no entran en el denominador). */
export function aplicarAlcance<T extends ConIdsGml>(filas: readonly T[], alcance: AlcanceApi): { dentro: T[]; fuera: T[] } {
  const dentro: T[] = [];
  const fuera: T[] = [];
  for (const f of filas) (enAlcance(f, alcance) ? dentro : fuera).push(f);
  return { dentro, fuera };
}

/** Normaliza el alcance de entrada (claves opcionales, ids repetidos) a una forma ordenada y sin duplicados. */
export function normalizarAlcance(a: { generos?: readonly string[]; mundos?: readonly string[]; lineas?: readonly string[] } | null | undefined): AlcanceApi {
  const limpio = (xs: readonly string[] | undefined) => [...new Set(xs ?? [])].sort();
  return { generos: limpio(a?.generos), mundos: limpio(a?.mundos), lineas: limpio(a?.lineas) };
}

// ─── Regla 4: vectores ───

export type MesesPorTemporada = Record<Temporada, number>;

/** Cuántos meses de cada temporada hay en una lista de meses `aaaa-mm`. */
export function contarMesesPorTemporada(meses: readonly Mes[], temporadas: TemporadasConfig): MesesPorTemporada {
  const r: MesesPorTemporada = { verano: 0, invierno: 0 };
  for (const m of meses) r[temporadaDe(Number(m.slice(5, 7)), temporadas)] += 1;
  return r;
}

function sumaEnMeses(serie: SerieNormalizada, meses: readonly Mes[]): number {
  let s = 0;
  for (const m of meses) s += serie.get(m) ?? 0;
  return s;
}

/** Vector `p2` sobre `meses`: solo las `g` en `claves` con suma positiva; `null` si ninguna vende. Redondeo solo al presentar. */
export function vectorSobre(series: SeriesNormalizadas, claves: Iterable<ClaveG>, meses: readonly Mes[]): Map<ClaveG, number> | null {
  const sumas = new Map<ClaveG, number>();
  let total = 0;
  for (const c of claves) {
    const s = series.get(c);
    if (!s) continue;
    const x = sumaEnMeses(s, meses);
    if (x > 0) {
      sumas.set(c, x);
      total += x;
    }
  }
  if (!(total > 0)) return null;
  const v = new Map<ClaveG, number>();
  for (const [c, x] of sumas) v.set(c, x / total);
  return v;
}

export type ResultadoVectores = {
  modo_efectivo: ModoEntrada;
  /** `anual` en modo anual (o con `temporada_corta`); `verano` e `invierno` en `por_temporada`. `null` = sin venta en ese conjunto de meses. */
  vectores: Map<LlaveVector, Map<ClaveG, number> | null>;
  meses_por_temporada: MesesPorTemporada;
  avisos: AvisoBarrer[];
};

/** Regla 4 con los meses de la ventana ya elegidos. */
export function repartoVectores(
  series: SeriesNormalizadas,
  claves: readonly ClaveG[],
  meses: readonly Mes[],
  modo: ModoEntrada,
  temporadas: TemporadasConfig = TEMPORADAS_DEFECTO,
  minMeses: number = MIN_MESES_TEMPORADA
): ResultadoVectores {
  const conteo = contarMesesPorTemporada(meses, temporadas);
  const avisos: AvisoBarrer[] = [];
  const anual = vectorSobre(series, claves, meses);
  if (anual === null) avisos.push("sin_venta_barrer");

  if (modo === "anual") return { modo_efectivo: "anual", vectores: new Map([["anual", anual]]), meses_por_temporada: conteo, avisos };

  const porTemporada = new Map<LlaveVector, Map<ClaveG, number> | null>();
  let corta = false;
  for (const t of TEMPORADAS) {
    const mesesT = meses.filter((m) => temporadaDe(Number(m.slice(5, 7)), temporadas) === t);
    const v = conteo[t] >= minMeses ? vectorSobre(series, claves, mesesT) : null;
    // Una temporada con pocos meses o sin una sola unidad vendida no da un vector fiable: todo cae a `anual`.
    if (conteo[t] < minMeses || (v === null && anual !== null)) corta = true;
    porTemporada.set(t, v);
  }
  if (corta) {
    avisos.push("temporada_corta");
    return { modo_efectivo: "anual", vectores: new Map([["anual", anual]]), meses_por_temporada: conteo, avisos };
  }
  return { modo_efectivo: "por_temporada", vectores: porTemporada, meses_por_temporada: conteo, avisos };
}

/** `repartoAnual(u, φ)` de la ficha: el vector de toda la ventana. */
export function repartoAnual(series: SeriesNormalizadas, claves: readonly ClaveG[], meses: readonly Mes[]): Map<ClaveG, number> | null {
  return vectorSobre(series, claves, meses);
}

/** `repartoPorTemporada(u, φ, n)` de la ficha: los dos vectores (o `anual` con `temporada_corta`). */
export function repartoPorTemporada(
  series: SeriesNormalizadas,
  claves: readonly ClaveG[],
  meses: readonly Mes[],
  temporadas: TemporadasConfig = TEMPORADAS_DEFECTO
): ResultadoVectores {
  return repartoVectores(series, claves, meses, "por_temporada", temporadas);
}

/** Meses `aaaa-mm` de la ventana de `n` meses que termina en `hasta` (inclusive). */
export function mesesDeVentana(hasta: Mes, n: number): Mes[] {
  const [a, m] = hasta.split("-").map(Number);
  const fin = a * 12 + (m - 1);
  const ini = fin - (n - 1);
  const desde = `${String(Math.floor(ini / 12)).padStart(4, "0")}-${String((ini % 12) + 1).padStart(2, "0")}`;
  return listarMeses(desde, hasta);
}

// ─── Regla 10: ajuste y aprobación ───

/**
 * `renormalizarResto(valores, editadas)`: valores en PORCENTAJE (0–100, un decimal) de un vector. Las celdas editadas
 * se quedan como están y las demás se escalan proporcionalmente para que la suma sea 100,0 (método del mayor resto en décimas, de
 * modo que la suma da exactamente 100,0). Sin otras celdas, o con las editadas por encima de 100, no se toca nada. Si las no
 * editadas suman 0 se reparte parejo. Ej.: `[41, 30, 17, 12]` con la primera editada a 50 → `[50, 25,4, 14,4, 10,2]`.
 */
export function renormalizarResto(valores: readonly number[], editadas: readonly boolean[]): number[] {
  const out = valores.map((v) => Math.round(v * 10) / 10);
  const libres = out.map((_, i) => i).filter((i) => !editadas[i]);
  if (libres.length === 0) return out;
  const fijo = out.reduce((a, v, i) => (editadas[i] ? a + v : a), 0);
  const restante = 100 - fijo;
  if (restante < 0) return out;
  const reparto = repartirProporcional(
    restante,
    libres.map((i) => out[i]),
    1
  );
  libres.forEach((i, j) => {
    out[i] = reparto[j];
  });
  return out;
}

export type DatosAprobacion = {
  /** Los vectores del reparto a aprobar, por llave (`verano`/`invierno` o `anual`): participaciones vigentes en FRACCIÓN 0–1. */
  vectores: ReadonlyMap<LlaveVector, readonly number[]>;
  nota: string | null | undefined;
  hay_ajuste: boolean;
  ventana_meses: number;
  fuente: FuenteReparto;
  alcance_vacio: boolean;
};

export type MotivoNoAprobable = "sin_filas" | "suma_invalida" | "nota_requerida";

/**
 * `puedeAprobar`: cada vector suma 1 ± `TOLERANCIA_SUMA` (100,0 ± 0,05 puntos), hay al menos una fila con participación mayor que
 * cero y, si hay ajuste, ventana distinta de la por defecto, fuente `cerrada` o alcance, una nota no vacía (criterio 06b).
 * Devuelve `null` si se puede aprobar o el motivo (en el orden en que se evalúan).
 */
export function puedeAprobar(d: DatosAprobacion): MotivoNoAprobable | null {
  if (d.vectores.size === 0 || [...d.vectores.values()].every((v) => !v.some((x) => x > 0))) return "sin_filas";
  for (const v of d.vectores.values()) {
    if (v.length === 0 || !v.some((x) => x > 0)) return "sin_filas";
    const suma = v.reduce((a, b) => a + b, 0);
    if (Math.abs(suma - 1) > TOLERANCIA_SUMA) return "suma_invalida";
  }
  if (requiereNota(d) && !(typeof d.nota === "string" && d.nota.trim() !== "")) return "nota_requerida";
  return null;
}

/** La nota es obligatoria si hay ajuste, ventana no por defecto, fuente `cerrada` o alcance. */
export function requiereNota(d: Pick<DatosAprobacion, "hay_ajuste" | "ventana_meses" | "fuente" | "alcance_vacio">): boolean {
  return d.hay_ajuste || d.ventana_meses !== VENTANA_DEFECTO || d.fuente !== "historico" || !d.alcance_vacio;
}

export function esFuente(x: unknown): x is FuenteReparto {
  return typeof x === "string" && (FUENTES as readonly string[]).includes(x);
}

export { repartirProporcional };
