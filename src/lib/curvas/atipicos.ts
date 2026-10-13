import { aPeriodo, recortarPeriodo } from "@/lib/ventas/periodo";
import type {
  AlcancePeriodo,
  AnioAtipicidadApi,
  ClaseDeAnioApi,
  PeriodoDeAnio,
  ResumenAnios,
  TemporadaAgrupacion,
} from "./tipos-api";

/**
 * Periodos atípicos y temporada (docs/modulos/06-curvas-estacionalidad.md,
 * "Periodos atípicos", "Lectura para M7" y reglas 6, 6b y 8e). Funciones puras:
 * sin base, sin HTTP, sin importar nada de `@supabase/*` ni de componentes.
 *
 * `claseDeAnio` es el contrato que M7 importa tal cual (y que sirve a
 * `GET /api/periodos-atipicos/anios`): su forma de salida no cambia; lo que M6
 * añada irá en campos nuevos. Un test fija las claves y los tipos.
 *
 * Los meses viajan como `aaaa-mm`. Una agrupación solo aporta su `temporada`:
 *   - alcance `todas`: el periodo aplica a todas;
 *   - alcance `invierno`: aplica solo si la agrupación es de `invierno`
 *     (una `verano` o `todo_el_ano` NO recibe los de alcance `invierno`);
 *   - un periodo inactivo no aplica nunca; dos periodos solapados cuentan cada
 *     mes una vez (se toma la unión).
 */

/** Lo que estas funciones necesitan de un periodo (`PeriodoAtipicoApi` encaja). */
export type PeriodoParaClase = {
  id: string;
  desde: string;
  hasta: string;
  motivo: string;
  alcance: AlcancePeriodo;
  activo: boolean;
};

export type AgrupacionParaClase = { temporada: TemporadaAgrupacion };

// ─── Meses ───

/** Número de mes absoluto (`año × 12 + mes − 1`): permite comparar y recorrer rangos sin fechas. */
function indiceMes(periodo: string): number {
  const [anio, mes] = recortarPeriodo(periodo).split("-").map(Number);
  return anio * 12 + (mes - 1);
}

function periodoDeIndice(indice: number): string {
  return aPeriodo(Math.floor(indice / 12), (indice % 12) + 1);
}

/** `aaaa-mm` válido: mes 01 a 12. */
function mesBienFormado(valor: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

/** Regla del rango: ambos meses bien formados y `hasta >= desde` (un solo mes es `desde = hasta`). */
export function rangoValido(desde: string, hasta: string): boolean {
  return mesBienFormado(desde) && mesBienFormado(hasta) && hasta >= desde;
}

/** Cuántos meses cubre el rango (inclusive); 0 si está invertido. */
export function contarMeses(desde: string, hasta: string): number {
  return Math.max(0, indiceMes(hasta) - indiceMes(desde) + 1);
}

/** ¿Este periodo ajusta a una agrupación de esa temporada? Inactivo nunca. */
export function periodoAplica(periodo: Pick<PeriodoParaClase, "alcance" | "activo">, temporada: TemporadaAgrupacion): boolean {
  if (!periodo.activo) return false;
  return periodo.alcance === "todas" || (periodo.alcance === "invierno" && temporada === "invierno");
}

function mesesEnRango(desde: string, hasta: string, minIndice: number, maxIndice: number): string[] {
  const inicio = Math.max(indiceMes(desde), minIndice);
  const fin = Math.min(indiceMes(hasta), maxIndice);
  const meses: string[] = [];
  for (let i = inicio; i <= fin; i++) meses.push(periodoDeIndice(i));
  return meses;
}

// ─── Regla 6: meses atípicos de una agrupación ───

/** La unión de los rangos activos cuyo alcance aplica a la agrupación, como `aaaa-mm`. */
export function mesesAtipicos(periodos: readonly PeriodoParaClase[], agrupacion: AgrupacionParaClase): Set<string> {
  const meses = new Set<string>();
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    for (const m of mesesEnRango(p.desde, p.hasta, -Infinity, Infinity)) meses.add(m);
  }
  return meses;
}

// ─── Regla 6b: clase de un año (contrato para M7) ───

/**
 * Clase de un año para una agrupación:
 *   - `normal`: ningún mes del año cae en un periodo activo que aplica;
 *   - `atipico`: al menos uno, con la lista ordenada de esos meses y los
 *     periodos que los cubren (por `desde`, luego `id`).
 * `completo` solo si los 12 meses están publicados en M5. Un año en curso o con
 * meses sin cargar es `completo: false`, y sus meses atípicos pueden estar en
 * el futuro (un periodo de 2026 declarado antes de cargar diciembre ya cuenta).
 */
export function claseDeAnio(
  anio: number,
  agrupacion: AgrupacionParaClase,
  periodos: readonly PeriodoParaClase[],
  mesesPublicados: Iterable<string>
): ClaseDeAnioApi {
  const publicados = new Set<string>();
  for (const m of mesesPublicados) publicados.add(recortarPeriodo(m));

  const primero = anio * 12;
  const ultimo = anio * 12 + 11;
  const meses = new Set<string>();
  const cubren: PeriodoParaClase[] = [];
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    const delAnio = mesesEnRango(p.desde, p.hasta, primero, ultimo);
    if (delAnio.length === 0) continue;
    cubren.push(p);
    for (const m of delAnio) meses.add(m);
  }

  const orden = (a: PeriodoParaClase, b: PeriodoParaClase) =>
    recortarPeriodo(a.desde).localeCompare(recortarPeriodo(b.desde)) || a.id.localeCompare(b.id);
  const periodosDelAnio: PeriodoDeAnio[] = cubren
    .sort(orden)
    .map((p) => ({ id: p.id, motivo: p.motivo, alcance: p.alcance }));

  let completo = true;
  for (let m = 1; m <= 12; m++) {
    if (!publicados.has(aPeriodo(anio, m))) {
      completo = false;
      break;
    }
  }

  const mesesOrdenados = [...meses].sort();
  return {
    anio,
    clase: mesesOrdenados.length > 0 ? "atipico" : "normal",
    meses_atipicos: mesesOrdenados,
    periodos: periodosDelAnio,
    completo,
  };
}

/**
 * Años que evalúa `GET /api/periodos-atipicos/anios`.
 *   - Con `desde` y `hasta`: todos los años de ese rango (inclusive).
 *   - Si no: del año del primer mes publicado al del último, más los años de los
 *     meses de periodos activos que aplican y caen DESPUÉS del último mes
 *     publicado (un periodo de 2026 o 2027 declarado antes de cargar esos meses).
 *     Sin ningún mes publicado, los años de los periodos que aplican. Si solo
 *     viene un extremo, recorta ese conjunto por defecto.
 */
export function aniosAEvaluar(entrada: {
  agrupacion: AgrupacionParaClase;
  periodos: readonly PeriodoParaClase[];
  mesesPublicados: Iterable<string>;
  desde?: number;
  hasta?: number;
}): number[] {
  const { agrupacion, periodos, desde, hasta } = entrada;
  if (desde !== undefined && hasta !== undefined) {
    const anios: number[] = [];
    for (let a = desde; a <= hasta; a++) anios.push(a);
    return anios;
  }

  const publicados = [...entrada.mesesPublicados].map(recortarPeriodo).sort();
  const anios = new Set<number>();
  let ultimoPublicado = -Infinity;
  if (publicados.length > 0) {
    const primerAnio = Number(publicados[0].slice(0, 4));
    const ultimoAnio = Number(publicados[publicados.length - 1].slice(0, 4));
    for (let a = primerAnio; a <= ultimoAnio; a++) anios.add(a);
    ultimoPublicado = indiceMes(publicados[publicados.length - 1]);
  }
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    for (const m of mesesEnRango(p.desde, p.hasta, ultimoPublicado + 1, Infinity)) anios.add(Number(m.slice(0, 4)));
  }

  return [...anios]
    .filter((a) => (desde === undefined || a >= desde) && (hasta === undefined || a <= hasta))
    .sort((a, b) => a - b);
}

/** Los años evaluados con su clase y el resumen. `ratio_volumen` es `null` hasta que exista una corrida (paso 2). */
export function aniosAtipicidad(entrada: {
  agrupacion: AgrupacionParaClase;
  periodos: readonly PeriodoParaClase[];
  mesesPublicados: Iterable<string>;
  desde?: number;
  hasta?: number;
}): { anios: AnioAtipicidadApi[]; resumen: ResumenAnios } {
  const publicados = [...entrada.mesesPublicados].map(recortarPeriodo);
  const anios = aniosAEvaluar({ ...entrada, mesesPublicados: publicados }).map(
    (anio): AnioAtipicidadApi => ({
      ...claseDeAnio(anio, entrada.agrupacion, entrada.periodos, publicados),
      ratio_volumen: null,
    })
  );
  return {
    anios,
    resumen: {
      anios_atipicos: anios.filter((a) => a.clase === "atipico").map((a) => a.anio),
      anios_normales_completos: anios.filter((a) => a.clase === "normal" && a.completo).map((a) => a.anio),
    },
  };
}

// ─── Regla 8e: temporada sugerida desde las líneas de M1 ───

const TEMPORADA_DE_LINEA: Readonly<Record<string, TemporadaAgrupacion>> = {
  Verano: "verano",
  Invierno: "invierno",
  "Todo el año": "todo_el_ano",
};

/** `lineas.temporada` de M1 (`Verano` / `Invierno` / `Todo el año`) a su código; lo desconocido es `todo_el_ano`. */
export function temporadaDeLinea(temporada: string): TemporadaAgrupacion {
  return TEMPORADA_DE_LINEA[temporada] ?? "todo_el_ano";
}

/**
 * Temporada mayoritaria por conteo entre las líneas de las equivalencias de
 * una agrupación (una entrada por equivalencia: la `temporada` de su línea).
 * Empate por el primer lugar o lista vacía: `todo_el_ano`.
 */
export function temporadaSugerida(lineas: ReadonlyArray<string | { temporada: string }>): TemporadaAgrupacion {
  const conteo = new Map<TemporadaAgrupacion, number>();
  for (const l of lineas) {
    const t = temporadaDeLinea(typeof l === "string" ? l : l.temporada);
    conteo.set(t, (conteo.get(t) ?? 0) + 1);
  }
  let mejor: TemporadaAgrupacion = "todo_el_ano";
  let max = 0;
  let empate = false;
  for (const [t, n] of conteo) {
    if (n > max) {
      mejor = t;
      max = n;
      empate = false;
    } else if (n === max) {
      empate = true;
    }
  }
  return empate ? "todo_el_ano" : mejor;
}

/**
 * Aviso `temporada_sugerida_distinta`: la fijada no coincide con la sugerida.
 * Sin equivalencias activas no hay nada que sugerir (la sugerida es solo el
 * valor neutro), así que no avisa.
 */
export function temporadaSugeridaDistinta(
  temporada: TemporadaAgrupacion,
  sugerida: TemporadaAgrupacion,
  equivalenciasActivas: number
): boolean {
  return equivalenciasActivas > 0 && temporada !== sugerida;
}
