import { aPeriodo, recortarPeriodo, ultimoMesCerrado } from "@/lib/ventas/periodo";
import type { ClaseAnioCurva } from "./tipos-api";
import type { CampoMedida, SerieAnual } from "./tipos";

/**
 * Años, series y participaciones (docs/modulos/06-curvas-estacionalidad.md,
 * reglas 1 a 5). Funciones puras: sin base, sin HTTP.
 *
 * Los meses viajan como `aaaa-mm`; los arreglos de doce valores van de enero
 * (índice 0) a diciembre (índice 11).
 */

export const MESES_ANIO = 12;

export function anioDe(periodo: string): number {
  return Number(recortarPeriodo(periodo).slice(0, 4));
}

/** Mes 1 a 12 de un `aaaa-mm`. */
export function mesDe(periodo: string): number {
  return Number(recortarPeriodo(periodo).slice(5, 7));
}

/** Los doce `aaaa-mm` de un año. */
export function mesesDelAnio(anio: number): string[] {
  return Array.from({ length: MESES_ANIO }, (_, i) => aPeriodo(anio, i + 1));
}

export function redondear(valor: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round((valor + Number.EPSILON * Math.sign(valor)) * f) / f;
}

export function sumar(valores: readonly number[]): number {
  let s = 0;
  for (const v of valores) s += v;
  return s;
}

/**
 * Regla 50, la ÚNICA definición de `sin_venta`: la agrupación no tiene unidades
 * positivas en NINGÚN mes publicado (hasta `hasta`), medida sobre su venta cruda
 * (todas las tiendas, antes de aplicar la red comparable). Es la misma en el
 * prerrequisito, en el aviso del modelo y en el resumen. Una agrupación CON venta
 * pero sin años de ajuste suficientes NO es `sin_venta`: es `prestada` (`T`).
 */
export function sinVenta(
  filas: ReadonlyArray<{ periodo: string; unidades: number }>,
  mesesPublicados: Iterable<string>,
  hasta: string
): boolean {
  const publicados = new Set<string>();
  const tope = recortarPeriodo(hasta);
  for (const m of mesesPublicados) {
    const p = recortarPeriodo(m);
    if (p <= tope) publicados.add(p);
  }
  const porMes = new Map<string, number>();
  for (const f of filas) {
    const p = recortarPeriodo(f.periodo);
    if (publicados.has(p)) porMes.set(p, (porMes.get(p) ?? 0) + f.unidades);
  }
  for (const u of porMes.values()) if (u > 0) return false;
  return true;
}

// ─── Regla 1: clase de un año ───

export type ClasificacionAnio = {
  clase: ClaseAnioCurva;
  /** `aaaa-mm` atípicos que aplican (en el año en curso, solo los cargados). */
  meses_atipicos: string[];
  /** Meses publicados del año (hasta `hastaPeriodo` si se da). */
  meses_cargados: number;
};

/**
 * Regla 1. Con `hastaPeriodo`, el año de ese mes con menos de 12 meses es
 * `en_curso` (los atípicos se cuentan solo entre los cargados). Si no: algún mes
 * sin publicar → `incompleto`; los doce publicados y 0 atípicos → `normal`; de 1
 * a `maxHuecos` → `con_huecos`; MÁS de `maxHuecos` (12 incluidos) →
 * `atipico_completo` (I2). `descartado` no es una clase sino un tratamiento.
 */
export function clasificarAnio(
  anio: number,
  mesesPublicados: Iterable<string>,
  atipicosQueAplican: Iterable<string>,
  maxHuecos: number,
  hastaPeriodo?: string
): ClasificacionAnio {
  const publicados = new Set<string>();
  for (const m of mesesPublicados) publicados.add(recortarPeriodo(m));
  const atipicos = new Set<string>();
  for (const m of atipicosQueAplican) atipicos.add(recortarPeriodo(m));

  const hasta = hastaPeriodo === undefined ? null : recortarPeriodo(hastaPeriodo);
  const delAnio = mesesDelAnio(anio).filter((m) => hasta === null || m <= hasta);
  const cargados = delAnio.filter((m) => publicados.has(m));
  const atipicosDelAnio = delAnio.filter((m) => atipicos.has(m));

  const esAnioDeHasta = hasta !== null && anioDe(hasta) === anio;
  if (esAnioDeHasta && delAnio.length < MESES_ANIO) {
    return {
      clase: cargados.length === 0 ? "incompleto" : "en_curso",
      meses_atipicos: atipicosDelAnio,
      meses_cargados: cargados.length,
    };
  }
  if (cargados.length < MESES_ANIO) {
    return { clase: "incompleto", meses_atipicos: atipicosDelAnio, meses_cargados: cargados.length };
  }
  const n = atipicosDelAnio.length;
  const clase: ClaseAnioCurva = n === 0 ? "normal" : n <= maxHuecos ? "con_huecos" : "atipico_completo";
  return { clase, meses_atipicos: atipicosDelAnio, meses_cargados: cargados.length };
}

// ─── Regla 2: participación, normalización y curva acumulada ───

/** `p_m = u_m ÷ Σ u`; con suma ≤ 0 (año sin volumen) → `null`. Sin redondear. */
export function participacion(meses: readonly number[]): number[] | null {
  const total = sumar(meses);
  if (!(total > 0)) return null;
  return meses.map((u) => u / total);
}

/**
 * Regla 3. Redondea a seis decimales y ajusta el mes mayor para que la suma sea
 * EXACTAMENTE 1,000000 (el `check` de la base compara con tolerancia 0,0001).
 * Idempotente. Acepta un vector sin normalizar (lo divide por su suma); con suma
 * ≤ 0 devuelve ceros.
 */
export function normalizarCurva(valores: readonly number[]): number[] {
  const total = sumar(valores);
  if (!(total > 0)) return valores.map(() => 0);
  const micro = valores.map((v) => Math.round((v / total) * 1e6));
  let mayor = 0;
  for (let i = 1; i < micro.length; i++) if (micro[i] > micro[mayor]) mayor = i;
  micro[mayor] += 1e6 - sumar(micro);
  return micro.map((m) => m / 1e6);
}

/** `C_m = Σ_{k≤m} p_k` (seis decimales; el último valor es exactamente 1 si la curva suma 1). */
export function curvaAcumulada(curva: readonly number[]): number[] {
  const micro: number[] = [];
  let acumulado = 0;
  for (const p of curva) {
    acumulado += Math.round(p * 1e6);
    micro.push(acumulado);
  }
  return micro.map((m) => m / 1e6);
}

// ─── Regla 2b: serie de una agrupación sobre la red de un año ───

type FilaSerie = { tienda_id: string; periodo: string } & Partial<Record<CampoMedida, number>>;

/**
 * Regla 2b. Un valor por MES PUBLICADO (0 si la agrupación no tiene filas ese
 * mes: nunca a partir de las filas que existan). Suma solo las tiendas de la
 * `red` y TRUNCA A 0 DESPUÉS DE SUMAR (una tienda con −5 y otra con +20 dan 15;
 * si la suma de la red sigue negativa se trunca y el mes se devuelve en
 * `negativos`, para el aviso `mes_negativo`).
 */
export function serieDeAgrupacion(
  filas: readonly FilaSerie[],
  mesesPublicados: Iterable<string>,
  red: ReadonlySet<string>,
  campo: CampoMedida = "unidades"
): { valores: Record<string, number>; negativos: string[] } {
  const valores: Record<string, number> = {};
  for (const m of mesesPublicados) valores[recortarPeriodo(m)] = 0;
  for (const f of filas) {
    if (!red.has(f.tienda_id)) continue;
    const periodo = recortarPeriodo(f.periodo);
    if (!(periodo in valores)) continue;
    valores[periodo] += f[campo] ?? 0;
  }
  const negativos: string[] = [];
  for (const periodo of Object.keys(valores).sort()) {
    if (valores[periodo] < 0) {
      negativos.push(periodo);
      valores[periodo] = 0;
    }
  }
  return { valores, negativos };
}

/**
 * Los doce valores de un año a partir de `serieDeAgrupacion` (`valores` por
 * `aaaa-mm`). Un mes sin publicar (o posterior a `hastaPeriodo`) vale 0 y consta
 * como no publicado en `publicados`.
 */
export function armarSerieAnual(
  anio: number,
  valores: Readonly<Record<string, number>>,
  mesesPublicados: Iterable<string>,
  hastaPeriodo?: string
): SerieAnual {
  const publicados = new Set<string>();
  for (const m of mesesPublicados) publicados.add(recortarPeriodo(m));
  const hasta = hastaPeriodo === undefined ? null : recortarPeriodo(hastaPeriodo);
  const meses = mesesDelAnio(anio);
  const habilitado = meses.map((m) => publicados.has(m) && (hasta === null || m <= hasta));
  return {
    anio,
    meses: meses.map((m, i) => (habilitado[i] ? (valores[m] ?? 0) : 0)),
    publicados: habilitado,
    completo: habilitado.every(Boolean),
  };
}

/** Suma de series del mismo año (mes a mes); los publicados son los de la primera. */
export function sumarSeries(series: readonly SerieAnual[], anio: number): SerieAnual {
  const meses = Array.from({ length: MESES_ANIO }, () => 0);
  let publicados: boolean[] = Array.from({ length: MESES_ANIO }, () => false);
  let primera = true;
  for (const s of series) {
    if (s.anio !== anio) continue;
    if (primera) {
      publicados = [...s.publicados];
      primera = false;
    }
    for (let m = 0; m < MESES_ANIO; m++) meses[m] += s.meses[m];
  }
  return { anio, meses, publicados, completo: publicados.every(Boolean) };
}

// ─── Regla 5: hasta por defecto y años de la corrida ───

/**
 * Último mes publicado que además está cerrado en Lima (`hoyLima` es
 * `aaaa-mm-dd`); `null` si ninguno cumple.
 */
export function hastaPorDefecto(mesesPublicados: Iterable<string>, hoyLima: string): string | null {
  const cerrado = ultimoMesCerrado(hoyLima);
  let mejor: string | null = null;
  for (const m of mesesPublicados) {
    const p = recortarPeriodo(m);
    if (p <= cerrado && (mejor === null || p > mejor)) mejor = p;
  }
  return mejor;
}

/** Años de la corrida: del año del primer mes publicado al del `hastaPeriodo` (inclusive). */
export function aniosDeCorrida(mesesPublicados: Iterable<string>, hastaPeriodo: string): number[] {
  const hasta = recortarPeriodo(hastaPeriodo);
  let primero: string | null = null;
  for (const m of mesesPublicados) {
    const p = recortarPeriodo(m);
    if (p <= hasta && (primero === null || p < primero)) primero = p;
  }
  if (primero === null) return [];
  const anios: number[] = [];
  for (let a = anioDe(primero); a <= anioDe(hasta); a++) anios.push(a);
  return anios;
}

/** Meses publicados que faltan entre el primero y `hasta` (huecos en la serie). */
export function mesesFaltantes(mesesPublicados: Iterable<string>, hastaPeriodo: string): string[] {
  const publicados = new Set<string>();
  for (const m of mesesPublicados) publicados.add(recortarPeriodo(m));
  const hasta = recortarPeriodo(hastaPeriodo);
  const ordenados = [...publicados].filter((p) => p <= hasta).sort();
  if (ordenados.length === 0) return [];
  const faltan: string[] = [];
  let [a, m] = [anioDe(ordenados[0]), mesDe(ordenados[0])];
  for (;;) {
    const p = aPeriodo(a, m);
    if (p > hasta) break;
    if (!publicados.has(p)) faltan.push(p);
    if (m === 12) {
      a += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return faltan;
}
