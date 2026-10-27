import { anioDe, mesesDelAnio, redondear } from "@/lib/curvas/anios";
import { claseDeAnio, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import { factoresMes, factorDe, type FactorProy } from "@/lib/proyeccion/nino";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import type { TemporadaFactor } from "@/lib/proyeccion/tipos-api";
import type { BandaNinoApi, OrigenMesGM, SerieAnioGMApi } from "./tipos-api";

/**
 * Series de venta por género × mundo (ficha 06d §2.4 y §4.1). Lógica PURA: sin base, sin HTTP, sin reloj. Parte de lo que devuelve
 * `venta_genero_mundo` (una fila por GM × temporada × tienda, con sus unidades por mes) y arma la curva mensual por año de las
 * mismas tiendas, con la versión «sin Niño» (`U' = U ÷ φ`, con `factoresMes` de M7) y la forma de cada año.
 */

/** Una fila de `series` de `venta_genero_mundo`. `u` va por `aaaa-mm`. */
export type SerieGM = {
  g: string;
  m: string;
  temp: string;
  t: string;
  u: Readonly<Record<string, number>>;
};

export type VentaGeneroMundo = {
  series: readonly SerieGM[];
  /** `aaaa-mm → carga_id` de los meses publicados (el mismo estado de datos que `series`). */
  cargas: Readonly<Record<string, string>>;
};

const MESES = 12;
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `jsonb` de la función a su forma tipada; `null` si no tiene la forma esperada (el servicio responde 500 con un mensaje claro). */
export function comoVentaGeneroMundo(crudo: unknown): VentaGeneroMundo | null {
  if (!esObjeto(crudo) || !Array.isArray(crudo.series) || !esObjeto(crudo.cargas)) return null;
  const series: SerieGM[] = [];
  for (const f of crudo.series as unknown[]) {
    if (!esObjeto(f) || typeof f.g !== "string" || typeof f.m !== "string" || typeof f.temp !== "string" || typeof f.t !== "string" || !esObjeto(f.u)) return null;
    const u: Record<string, number> = {};
    for (const [mes, valor] of Object.entries(f.u)) {
      const n = Number(valor);
      if (!Number.isFinite(n)) return null;
      u[recortarPeriodo(mes)] = n;
    }
    series.push({ g: f.g, m: f.m, temp: f.temp, t: f.t, u });
  }
  const cargas: Record<string, string> = {};
  for (const [mes, id] of Object.entries(crudo.cargas)) {
    if (typeof id !== "string") return null;
    cargas[recortarPeriodo(mes)] = id;
  }
  return { series, cargas };
}

/** Clave de un GM: `<genero_id>.<mundo_id>` (la de la ruta y de `FilaGMApi.clave`). */
export const claveRutaGM = (generoId: string, mundoId: string): string => `${generoId}.${mundoId}`;

/** Las filas de `series` por GM (`claveRutaGM`). */
export function agruparPorGM(series: readonly SerieGM[]): Map<string, SerieGM[]> {
  const grupos = new Map<string, SerieGM[]>();
  for (const s of series) {
    const k = claveRutaGM(s.g, s.m);
    const g = grupos.get(k);
    if (g) g.push(s);
    else grupos.set(k, [s]);
  }
  return grupos;
}

// ─── Factor del Niño por temporada y año ───

export type Phi = {
  /** `φ_{temporada,Z,m}`, doce valores. `todo_el_ano` y `sin_agrupacion` llevan unos. */
  de(temporada: string, anio: number): readonly number[];
  /** La temporada tiene meses atípicos en el año pero ningún factor: `φ = 1` con el aviso `sin_factor`. */
  sinFactor(temporada: string, anio: number): boolean;
};

const temporadaDePhi = (t: string): "invierno" | "verano" | "todo_el_ano" => (t === "invierno" || t === "verano" ? t : "todo_el_ano");

export function crearPhi(periodos: readonly PeriodoParaClase[], factores: readonly FactorProy[]): Phi {
  const memo = new Map<string, { factores: readonly number[]; sinFactor: boolean }>();
  const calcular = (temporada: string, anio: number) => {
    const t = temporadaDePhi(temporada);
    const k = `${t}|${anio}`;
    let r = memo.get(k);
    if (!r) {
      const res = factoresMes([{ agrupacion_id: "", temporada: t, peso: 1, curva: null }], periodos, factores, anio);
      r = { factores: res.factores, sinFactor: res.avisos.includes("sin_factor") };
      memo.set(k, r);
    }
    return r;
  };
  return { de: (t, a) => calcular(t, a).factores, sinFactor: (t, a) => calcular(t, a).sinFactor };
}

// ─── Sumas sobre las series ───

export type OpcionesSuma = {
  /** Solo estas tiendas; sin ella, todas. */
  tiendas?: ReadonlySet<string> | null;
  /** Mes inicial (1 a 12); por defecto 1. */
  desde?: number;
  /** Mes final (1 a 12); por defecto 12. */
  hasta?: number;
  /** Con `phi`, cada mes se divide por el factor de su temporada (versión sin Niño). */
  phi?: Phi;
};

/** Unidades de un conjunto de series en un año y un rango de meses. */
export function unidades(entradas: readonly SerieGM[], anio: number, o: OpcionesSuma = {}): number {
  const periodos = mesesDelAnio(anio);
  const desde = o.desde ?? 1;
  const hasta = o.hasta ?? MESES;
  let suma = 0;
  for (const e of entradas) {
    if (o.tiendas && !o.tiendas.has(e.t)) continue;
    const phi = o.phi ? o.phi.de(e.temp, anio) : null;
    for (let m = desde; m <= hasta; m++) {
      const u = e.u[periodos[m - 1] as string] ?? 0;
      if (u === 0) continue;
      const f = phi ? (phi[m - 1] as number) : 1;
      suma += f > 0 ? u / f : u;
    }
  }
  return suma;
}

/** Unidades por tienda (para la tienda mayor). */
export function unidadesPorTienda(entradas: readonly SerieGM[], anio: number, o: OpcionesSuma = {}): Map<string, number> {
  const porTienda = new Map<string, SerieGM[]>();
  for (const e of entradas) {
    if (o.tiendas && !o.tiendas.has(e.t)) continue;
    const g = porTienda.get(e.t);
    if (g) g.push(e);
    else porTienda.set(e.t, [e]);
  }
  const salida = new Map<string, number>();
  for (const [t, es] of porTienda) salida.set(t, unidades(es, anio, { ...o, tiendas: null }));
  return salida;
}

/** ¿Algún mes con venta del rango está afectado por un factor distinto de 1 (año Niño para este GM)? */
export function hayNino(entradas: readonly SerieGM[], anio: number, phi: Phi, o: Omit<OpcionesSuma, "phi"> = {}): boolean {
  const periodos = mesesDelAnio(anio);
  const desde = o.desde ?? 1;
  const hasta = o.hasta ?? MESES;
  for (const e of entradas) {
    if (o.tiendas && !o.tiendas.has(e.t)) continue;
    const f = phi.de(e.temp, anio);
    for (let m = desde; m <= hasta; m++) {
      if ((e.u[periodos[m - 1] as string] ?? 0) > 0 && Math.abs((f[m - 1] as number) - 1) > 1e-12) return true;
    }
  }
  return false;
}

/** Tiendas con venta en alguna de las series. */
export function tiendasConVenta(entradas: readonly SerieGM[]): Set<string> {
  const t = new Set<string>();
  for (const e of entradas) if (Object.values(e.u).some((v) => v !== 0)) t.add(e.t);
  return t;
}

// ─── Curva mensual por año ───

/** Lo proyectado del año `Y` por las filas base de la proyección de referencia (sin escalar): doce meses, bruto y sin Niño. */
export type ProyectadoAnio = { anio: number; meses: readonly number[]; mesesSinNino: readonly number[] };

export type EntradaSeries = {
  entradas: readonly SerieGM[];
  /** Mismas tiendas del gráfico: `C(Y)`. */
  tiendas: ReadonlySet<string>;
  /** Años a dibujar, ascendentes. */
  anios: readonly number[];
  /** Meses publicados y cerrados (`aaaa-mm`). */
  publicados: ReadonlySet<string>;
  /** Año `Y` y su último mes cerrado `k` (1 a 12); `k = null` si `Y` no tiene datos. */
  y: number;
  k: number | null;
  phi: Phi;
  /** Lo proyectado de `Y` (de la proyección de referencia); `null` sin proyección válida o sin filas base del GM. */
  proyectado: ProyectadoAnio | null;
};

const r2 = (n: number) => redondear(n, 2);

/**
 * Una serie por año. Un mes publicado lleva la suma de las mismas tiendas (puede ser 0: la tienda aún no abría); un mes sin publicar
 * es `null`, salvo los de `Y` posteriores a `k`, que se completan con lo proyectado de la referencia llevado a la base de las mismas
 * tiendas (se escala por `Σ real ene–k de C(Y) ÷ Σ de la proyección ene–k`). `forma` solo se calcula con los doce meses con dato.
 */
export function armarSeriesAnios(e: EntradaSeries): SerieAnioGMApi[] {
  let escala: number | null = null;
  if (e.proyectado && e.k !== null && e.k >= 1) {
    const real = unidades(e.entradas, e.y, { tiendas: e.tiendas, hasta: e.k });
    const proy = e.proyectado.meses.slice(0, e.k).reduce((a, b) => a + b, 0);
    escala = proy > 0 ? real / proy : null;
  }

  return e.anios.map((anio) => {
    const periodos = mesesDelAnio(anio);
    const meses: (number | null)[] = [];
    const sinNino: (number | null)[] = [];
    const origen: OrigenMesGM[] = [];
    for (let m = 1; m <= MESES; m++) {
      if (e.publicados.has(periodos[m - 1] as string)) {
        meses.push(r2(unidades(e.entradas, anio, { tiendas: e.tiendas, desde: m, hasta: m })));
        sinNino.push(r2(unidades(e.entradas, anio, { tiendas: e.tiendas, desde: m, hasta: m, phi: e.phi })));
        origen.push("real");
      } else if (anio === e.y && e.proyectado && escala !== null && e.k !== null && m > e.k) {
        meses.push(r2((e.proyectado.meses[m - 1] ?? 0) * escala));
        sinNino.push(r2((e.proyectado.mesesSinNino[m - 1] ?? 0) * escala));
        origen.push("proyectado");
      } else {
        meses.push(null);
        sinNino.push(null);
        origen.push(null);
      }
    }
    const total = r2(meses.reduce<number>((a, v) => a + (v ?? 0), 0));
    const totalSin = r2(sinNino.reduce<number>((a, v) => a + (v ?? 0), 0));
    const completo = meses.every((v) => v !== null);
    const forma = meses.map((v) => (completo && total > 0 && v !== null ? redondear((v / total) * 100, 4) : null));
    return {
      anio,
      meses,
      meses_sin_nino: sinNino,
      origen,
      incompleto: !completo || origen.some((o) => o === "proyectado"),
      total,
      total_sin_nino: totalSin,
      forma,
    };
  });
}

/**
 * Forma típica: promedio de las participaciones de los años completos, reales y normales (sin Niño para este GM). `null` si no hay
 * ninguno. Doce valores en % que suman 100.
 */
export function formaTipica(entradas: readonly SerieGM[], tiendas: ReadonlySet<string>, series: readonly SerieAnioGMApi[], phi: Phi): number[] | null {
  const formas: number[][] = [];
  for (const s of series) {
    if (s.incompleto || s.origen.some((o) => o !== "real") || s.total <= 0) continue;
    if (hayNino(entradas, s.anio, phi, { tiendas })) continue;
    formas.push(s.meses.map((v) => ((v ?? 0) / s.total) * 100));
  }
  if (formas.length === 0) return null;
  return Array.from({ length: MESES }, (_, m) => redondear(formas.reduce((a, f) => a + (f[m] as number), 0) / formas.length, 4));
}

// ─── Bandas del Niño ───

export type FactorConParcial = FactorProy & { parcial?: boolean };

/**
 * Una banda por año y temporada (invierno o verano, solo las que el GM tiene con venta) con meses atípicos: los meses, el factor
 * efectivo y si es parcial (el factor de `Y` cubre solo ene–`k`).
 */
export function bandasNino(
  entradas: readonly SerieGM[],
  anios: readonly number[],
  periodos: readonly PeriodoParaClase[],
  factores: readonly FactorConParcial[],
  publicados: Iterable<string>
): BandaNinoApi[] {
  const temporadas = new Set(entradas.filter((s) => Object.values(s.u).some((v) => v !== 0)).map((s) => s.temp));
  const pub = [...publicados];
  const bandas: BandaNinoApi[] = [];
  for (const anio of anios) {
    for (const temporada of ["invierno", "verano"] as TemporadaFactor[]) {
      if (!temporadas.has(temporada)) continue;
      const clase = claseDeAnio(anio, { temporada }, periodos, pub);
      if (clase.meses_atipicos.length === 0) continue;
      const fila = factores.find((f) => f.anio === anio && f.temporada === temporada);
      bandas.push({
        anio,
        temporada,
        meses: clase.meses_atipicos.map((m) => Number(m.slice(5, 7))),
        factor: factorDe(factores, anio, temporada),
        parcial: fila?.parcial === true,
      });
    }
  }
  return bandas;
}

/** Los meses publicados del año `anio` (para saber si está completo). */
export function mesesPublicadosDe(publicados: ReadonlySet<string>, anio: number): number {
  return mesesDelAnio(anio).filter((m) => publicados.has(m)).length;
}

/** Años con meses publicados, ascendentes. */
export function aniosPublicados(publicados: Iterable<string>): number[] {
  return [...new Set([...publicados].map(anioDe))].sort((a, b) => a - b);
}

