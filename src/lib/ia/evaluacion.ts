import { repartirEntero } from "@/lib/proyeccion/reparto";
import type {
  BootstrapApi,
  GrupoGeneroIa,
  MetricasNaturalApi,
  MetricasRepartoApi,
  PliegueIa,
  ReglaVeredictoIa,
  ResultadosEvaluacionApi,
  RivalIa,
  VeredictoEvaluacionApi,
} from "./tipos-api";

/**
 * Evaluación (backtest) y veredicto de encendido (ficha 07e, §5.4; R22 puro, ejemplo D). Puro: recibe lo predicho por el método, por la
 * regla de tendencia y por la IA para las filas libres de cada pliegue y calcula las métricas y el veredicto de `distribucion_y1`.
 * El reparto lo mide con una meta ORÁCULO (`Σ real` del GM); el natural nunca ve la meta.
 */

// ─── Constantes (se guardan en `ia_evaluaciones.parametros`) ───

export const SEMILLA_BOOTSTRAP = 20261030;
export const REMUESTREOS_BOOTSTRAP = 1000;
export const MIN_FILAS_D25 = 50;
export const MIN_FILAS_GM_MAYORIA = 5;
/** Primera versión de prompt evaluada (cualquier modelo) y desde la segunda. */
export const MEJORA_MIN_PRIMERA = 0.05;
export const MEJORA_MIN_DESDE_SEGUNDA = 0.1;
/** Ningún género (HOMBRE, MUJER, Resto) puede quedar más de un 10 % relativo peor que el mejor rival; `D24` igual frente al método. */
export const TOLERANCIA_PEOR_RELATIVA = 0.1;
export const COBERTURA_MIN = 0.98;
export const ESTABILIDAD_MAX = 0.05;
export const TENDENCIA_MIN_PCT = -50;
export const TENDENCIA_MAX_PCT = 100;
export const MAX_EVALUACIONES_MES = 3;
export const PLIEGUES_DEFECTO: readonly PliegueIa[] = ["D25", "E25", "D24"];

/** Corte de cada pliegue: la entrada se arma SOLO con datos hasta el corte; `predice` es el año que se mide (años reales: nunca salen al proveedor). */
export const DEFINICION_PLIEGUE: Readonly<Record<PliegueIa, { corte: string; anio_en_curso: number; k: number; predice: number }>> = {
  D25: { corte: "2024-12", anio_en_curso: 2024, k: 12, predice: 2025 },
  E25: { corte: "2024-12", anio_en_curso: 2024, k: 12, predice: 2025 },
  D24: { corte: "2023-12", anio_en_curso: 2023, k: 12, predice: 2024 },
  N26: { corte: "2025-12", anio_en_curso: 2025, k: 12, predice: 2026 },
};

/** `MEJORA_MIN` de una evaluación: 0,05 para la primera versión de prompt evaluada y 0,10 desde la segunda (`evaluadasEnOrden`: versiones distintas, en orden de su primera evaluación). */
export function mejoraMinima(versionPrompt: string, evaluadasEnOrden: readonly string[]): number {
  const posicion = evaluadasEnOrden.indexOf(versionPrompt);
  const indice = posicion === -1 ? evaluadasEnOrden.length : posicion;
  return indice === 0 ? MEJORA_MIN_PRIMERA : MEJORA_MIN_DESDE_SEGUNDA;
}

/** ¿El periodo (`aaaa-mm`) es posterior al corte? Un pliegue no puede ver meses posteriores. */
export const posteriorAlCorte = (periodo: string, corte: string): boolean => periodo.slice(0, 7) > corte.slice(0, 7);

export function recortarAlCorte<T extends { anio: number; mes: number }>(registros: readonly T[], corte: string): T[] {
  const tope = Number(corte.slice(0, 4)) * 12 + Number(corte.slice(5, 7));
  return registros.filter((r) => r.anio * 12 + r.mes <= tope);
}

// ─── Predicciones de los rivales ───

export type FilaEvaluada = {
  id: string;
  /** Real del año predicho. */
  real: number;
  /** `B^s`. */
  base_s: number;
  /** `t` de la fila (`historico.tendencia`, en %); `null` = sin tendencia (cuenta como 0). */
  tendencia_pct: number | null;
  /** Reparto final de la IA (tras `asignarMeta`); `null` = el GM no tuvo respuesta. */
  reparto_ia: number | null;
  /** Natural de la IA; `null` = sin respuesta. */
  natural_ia: number | null;
};

export type GMEvaluado = {
  clave: string;
  grupo: GrupoGeneroIa;
  filas: readonly FilaEvaluada[];
  /** Meta oráculo; por defecto `Σ real`. */
  meta?: number;
};

const factorTendencia = (t: number | null): number => 1 + Math.min(TENDENCIA_MAX_PCT, Math.max(TENDENCIA_MIN_PCT, t ?? 0)) / 100;
const suma = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const porId = (a: FilaEvaluada, b: FilaEvaluada): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Método parejo: `repartirEntero(meta, B^s)`. */
export const repartoMetodo = (meta: number, filas: readonly FilaEvaluada[]): number[] => repartirEntero(meta, filas.map((f) => f.base_s)) ?? [];
/** Tendencia: `repartirEntero(meta, B^s × (1 + clamp(t, −50 %, +100 %)))`. */
export const repartoTendencia = (meta: number, filas: readonly FilaEvaluada[]): number[] => repartirEntero(meta, filas.map((f) => f.base_s * factorTendencia(f.tendencia_pct))) ?? [];
/** Natural del método: `B^s × (1 + g_real)` con `g_real = meta ÷ Σ B^s − 1` (sin redondear). */
export function naturalMetodo(meta: number, filas: readonly FilaEvaluada[]): number[] {
  const base = suma(filas.map((f) => f.base_s));
  const g = base > 0 ? meta / base - 1 : 0;
  return filas.map((f) => f.base_s * (1 + g));
}
/** Natural por tendencia: `B^s × (1 + clamp(t))` (sin redondear). */
export const naturalTendencia = (filas: readonly FilaEvaluada[]): number[] => filas.map((f) => f.base_s * factorTendencia(f.tendencia_pct));

// ─── Métricas ───

export const errorAbsoluto = (p: readonly number[], r: readonly number[]): number => p.reduce((a, x, i) => a + Math.abs(x - r[i]), 0);

/** `WAPE = Σ |p − r| ÷ Σ r`; `null` si `Σ r = 0`. */
export function wape(p: readonly number[], r: readonly number[]): number | null {
  const total = suma(r);
  return total > 0 ? errorAbsoluto(p, r) / total : null;
}

/** `EAT_reparto` en pp: `50 × Σ |p ÷ Σp − r ÷ Σr|`. */
export function eatPp(p: readonly number[], r: readonly number[]): number | null {
  const sp = suma(p);
  const sr = suma(r);
  if (!(sp > 0) || !(sr > 0)) return null;
  return 50 * p.reduce((a, x, i) => a + Math.abs(x / sp - r[i] / sr), 0);
}

/** `Σ |A¹ − A²| ÷ Σ A¹` entre dos corridas de la misma entrada (`D25` y `E25`), por clave de GM e id de fila. */
export function estabilidadEntre(a: readonly GMEvaluado[], b: readonly GMEvaluado[]): number | null {
  const segunda = new Map<string, number | null>();
  for (const gm of b) for (const f of gm.filas) segunda.set(`${gm.clave}|${f.id}`, f.reparto_ia);
  let num = 0;
  let den = 0;
  for (const gm of a) {
    for (const f of gm.filas) {
      const otra = segunda.get(`${gm.clave}|${f.id}`);
      if (f.reparto_ia === null || otra === undefined || otra === null) continue;
      num += Math.abs(f.reparto_ia - otra);
      den += f.reparto_ia;
    }
  }
  return den > 0 ? num / den : null;
}

type ErroresGM = {
  clave: string;
  grupo: GrupoGeneroIa;
  filas: number;
  real: number;
  e_metodo: number;
  e_tendencia: number;
  e_ia: number;
  n_metodo: number;
  n_tendencia: number;
  n_ia: number;
  eat_metodo: number | null;
  eat_ia: number | null;
  con_reparto: number;
  con_natural: number;
};

function erroresDeGM(gm: GMEvaluado, usarTendencia: boolean): ErroresGM {
  const filas = [...gm.filas].sort(porId);
  const r = filas.map((f) => f.real);
  const meta = gm.meta ?? suma(r);
  const m = repartoMetodo(meta, filas);
  const t = usarTendencia ? repartoTendencia(meta, filas) : m;
  // Sin respuesta, la IA no aporta nada: se le cuenta lo del método (así lo normaliza `asignarMeta` con pesos `P^GM`).
  const ia = filas.map((f, i) => f.reparto_ia ?? m[i]);
  const nm = naturalMetodo(meta, filas);
  const nt = usarTendencia ? naturalTendencia(filas) : nm;
  const ni = filas.map((f) => f.natural_ia ?? f.base_s);
  return {
    clave: gm.clave,
    grupo: gm.grupo,
    filas: filas.length,
    real: suma(r),
    e_metodo: errorAbsoluto(m, r),
    e_tendencia: errorAbsoluto(t, r),
    e_ia: errorAbsoluto(ia, r),
    n_metodo: errorAbsoluto(nm, r),
    n_tendencia: errorAbsoluto(nt, r),
    n_ia: errorAbsoluto(ni, r),
    eat_metodo: eatPp(m, r),
    eat_ia: eatPp(ia, r),
    con_reparto: filas.filter((f) => f.reparto_ia !== null).length,
    con_natural: filas.filter((f) => f.natural_ia !== null).length,
  };
}

const razon = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function mejorRival(wM: number | null, wT: number | null): { rival: RivalIa | null; wape: number | null } {
  if (wM === null && wT === null) return { rival: null, wape: null };
  if (wT === null || (wM !== null && wM <= wT)) return { rival: "metodo", wape: wM };
  return { rival: "tendencia", wape: wT };
}

function metricasReparto(gms: readonly ErroresGM[]): MetricasRepartoApi {
  const real = suma(gms.map((g) => g.real));
  const wM = razon(suma(gms.map((g) => g.e_metodo)), real);
  const wT = razon(suma(gms.map((g) => g.e_tendencia)), real);
  const wI = razon(suma(gms.map((g) => g.e_ia)), real);
  const { rival, wape: wR } = mejorRival(wM, wT);
  const ponderado = (campo: "eat_metodo" | "eat_ia"): number | null => {
    const validos = gms.filter((g) => g[campo] !== null && g.real > 0);
    const peso = suma(validos.map((g) => g.real));
    return peso > 0 ? suma(validos.map((g) => (g[campo] as number) * g.real)) / peso : null;
  };
  return {
    filas: suma(gms.map((g) => g.filas)),
    gms: gms.length,
    wape_metodo: wM,
    wape_tendencia: wT,
    wape_ia: wI,
    rival,
    wape_rival: wR,
    mejora: wI !== null && wR !== null && wR > 0 ? 1 - wI / wR : null,
    eat_metodo_pp: ponderado("eat_metodo"),
    eat_ia_pp: ponderado("eat_ia"),
  };
}

function metricasNatural(gms: readonly ErroresGM[]): MetricasNaturalApi {
  const real = suma(gms.map((g) => g.real));
  const wM = razon(suma(gms.map((g) => g.n_metodo)), real);
  const wT = razon(suma(gms.map((g) => g.n_tendencia)), real);
  const { rival, wape: wR } = mejorRival(wM, wT);
  return { filas: suma(gms.map((g) => g.filas)), wape_metodo: wM, wape_tendencia: wT, wape_ia: razon(suma(gms.map((g) => g.n_ia)), real), rival, wape_rival: wR };
}

// ─── Bootstrap por GM ───

/** PRNG determinista (mulberry32). */
export function crearAleatorio(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentil por rango más cercano sobre una muestra ordenada. */
const percentil = (ordenada: readonly number[], p: number): number => ordenada[Math.min(ordenada.length - 1, Math.max(0, Math.ceil(p * ordenada.length) - 1))];

/**
 * 1 000 remuestreos de GM con reemplazo y semilla fija; en cada uno, `min(WAPE_M, WAPE_T) − WAPE_IA` recalculado con los GM remuestreados.
 * IC 90 %: percentiles 5 y 95.
 */
export function bootstrapPorGM(gms: readonly Pick<ErroresGM, "real" | "e_metodo" | "e_tendencia" | "e_ia">[], remuestreos = REMUESTREOS_BOOTSTRAP, semilla = SEMILLA_BOOTSTRAP): BootstrapApi {
  const validos = gms.filter((g) => g.real > 0);
  if (validos.length === 0) return { remuestreos, semilla, p5: null, p95: null, media: null };
  const azar = crearAleatorio(semilla);
  const diferencias: number[] = [];
  for (let i = 0; i < remuestreos; i++) {
    let real = 0;
    let eM = 0;
    let eT = 0;
    let eI = 0;
    for (let j = 0; j < validos.length; j++) {
      const g = validos[Math.floor(azar() * validos.length)];
      real += g.real;
      eM += g.e_metodo;
      eT += g.e_tendencia;
      eI += g.e_ia;
    }
    diferencias.push(Math.min(eM / real, eT / real) - eI / real);
  }
  diferencias.sort((a, b) => a - b);
  return { remuestreos, semilla, p5: percentil(diferencias, 0.05), p95: percentil(diferencias, 0.95), media: suma(diferencias) / diferencias.length };
}

// ─── Pliegue ───

export type ResultadoPliegue = {
  reparto: MetricasRepartoApi;
  natural: MetricasNaturalApi;
  por_genero: Record<GrupoGeneroIa, MetricasRepartoApi>;
  /** GM con ≥ 5 filas libres en que la IA tuvo menor WAPE que el mejor rival, y cuántos GM así hubo. */
  gms_ganados: number;
  gms_evaluados: number;
  bootstrap: BootstrapApi;
  /** Celdas (fila × tarea) con respuesta válida ÷ celdas pedidas. */
  cobertura: { validas: number; pedidas: number };
};

/** Evalúa un pliegue. `usarTendencia = false` en `D24` (con un año de historia la tendencia no existe: el rival es el método). */
export function evaluarPliegue(gms: readonly GMEvaluado[], opciones: { usarTendencia?: boolean; remuestreos?: number; semilla?: number } = {}): ResultadoPliegue {
  const usar = opciones.usarTendencia ?? true;
  const e = gms.map((g) => erroresDeGM(g, usar));
  const grupos: GrupoGeneroIa[] = ["HOMBRE", "MUJER", "RESTO"];
  const grandes = e.filter((g) => g.filas >= MIN_FILAS_GM_MAYORIA);
  const ganados = grandes.filter((g) => {
    const rival = Math.min(g.e_metodo, g.e_tendencia);
    return g.e_ia < rival;
  }).length;
  const filas = suma(e.map((g) => g.filas));
  return {
    reparto: metricasReparto(e),
    natural: metricasNatural(e),
    por_genero: Object.fromEntries(grupos.map((gr) => [gr, metricasReparto(e.filter((g) => g.grupo === gr))])) as Record<GrupoGeneroIa, MetricasRepartoApi>,
    gms_ganados: ganados,
    gms_evaluados: grandes.length,
    bootstrap: bootstrapPorGM(e, opciones.remuestreos, opciones.semilla),
    cobertura: { validas: suma(e.map((g) => g.con_reparto + g.con_natural)), pedidas: 2 * filas },
  };
}

// ─── Veredicto ───

export type EntradaVeredicto = {
  d25: ResultadoPliegue | null;
  d24: ResultadoPliegue | null;
  /** `Σ |A¹ − A²| ÷ Σ A¹` entre `D25` y `E25`. */
  estabilidad: number | null;
  mejora_min: number;
};

const EPS = 1e-12;

/**
 * `distribucion_y1` gana solo si se cumplen todas (§5.4), en este orden: mejora sobre el mejor rival en el reparto de `D25`; percentil 5
 * del bootstrap > 0; gana en al menos la mitad de los GM con ≥ 5 filas libres; ningún género más de un 10 % peor; natural no peor que
 * ningún rival; `D24` no más de un 10 % peor que el método; cobertura ≥ 98 %; estabilidad ≤ 5 %. Con menos de 50 filas libres en `D25`
 * (o sin `D25`, `D24` o estabilidad), `sin_dato`.
 */
export function veredictoDistribucionY1(e: EntradaVeredicto): VeredictoEvaluacionApi {
  const d25 = e.d25;
  if (d25 === null || d25.reparto.filas < MIN_FILAS_D25 || e.d24 === null || e.estabilidad === null) return { distribucion_y1: "sin_dato", regla_que_fallo: "sin_dato" };
  const falla = (regla: ReglaVeredictoIa): VeredictoEvaluacionApi => ({ distribucion_y1: "no_gana", regla_que_fallo: regla });

  const mejora = d25.reparto.mejora;
  if (mejora === null || mejora + EPS < e.mejora_min) return falla("mejora");
  if (d25.bootstrap.p5 === null || !(d25.bootstrap.p5 > 0)) return falla("bootstrap");
  if (d25.gms_evaluados === 0 || d25.gms_ganados * 2 < d25.gms_evaluados) return falla("mayoria_gm");
  for (const g of Object.values(d25.por_genero)) {
    if (g.filas === 0 || g.wape_ia === null || g.wape_rival === null) continue;
    if (g.wape_ia > (1 + TOLERANCIA_PEOR_RELATIVA) * g.wape_rival + EPS) return falla("genero");
  }
  const nat = d25.natural;
  if (nat.wape_ia === null || nat.wape_rival === null || nat.wape_ia > nat.wape_rival + EPS) return falla("natural");
  const r24 = e.d24.reparto;
  if (r24.wape_ia === null || r24.wape_metodo === null || r24.wape_ia > (1 + TOLERANCIA_PEOR_RELATIVA) * r24.wape_metodo + EPS) return falla("contraste_d24");
  const pedidas = d25.cobertura.pedidas + e.d24.cobertura.pedidas;
  const validas = d25.cobertura.validas + e.d24.cobertura.validas;
  if (pedidas === 0 || validas / pedidas + EPS < COBERTURA_MIN) return falla("cobertura");
  if (e.estabilidad > ESTABILIDAD_MAX + EPS) return falla("estabilidad");
  return { distribucion_y1: "gana", regla_que_fallo: null };
}

/** Resultados y veredicto de una evaluación completa a partir de los pliegues evaluados. */
export function resultadosDeEvaluacion(args: { d25: readonly GMEvaluado[] | null; e25: readonly GMEvaluado[] | null; d24: readonly GMEvaluado[] | null; mejora_min: number; remuestreos?: number }): {
  resultados: ResultadosEvaluacionApi;
  veredicto: VeredictoEvaluacionApi;
} {
  const d25 = args.d25 ? evaluarPliegue(args.d25, { remuestreos: args.remuestreos }) : null;
  const d24 = args.d24 ? evaluarPliegue(args.d24, { usarTendencia: false, remuestreos: args.remuestreos }) : null;
  const estabilidad = args.d25 && args.e25 ? estabilidadEntre(args.d25, args.e25) : null;
  const pedidas = (d25?.cobertura.pedidas ?? 0) + (d24?.cobertura.pedidas ?? 0);
  const validas = (d25?.cobertura.validas ?? 0) + (d24?.cobertura.validas ?? 0);
  return {
    resultados: {
      d25: d25 && { reparto: d25.reparto, natural: d25.natural, por_genero: d25.por_genero, gms_ganados: d25.gms_ganados, gms_evaluados: d25.gms_evaluados, bootstrap: d25.bootstrap },
      d24: d24 && { reparto: d24.reparto, natural: d24.natural },
      estabilidad,
      cobertura: pedidas > 0 ? validas / pedidas : null,
    },
    veredicto: veredictoDistribucionY1({ d25, d24, estabilidad, mejora_min: args.mejora_min }),
  };
}
