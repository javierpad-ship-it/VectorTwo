// Series del gráfico de curvas de M6 a partir del resultado de una corrida.
// Pura, sin React: arma las `SerieGrafico` (contrato de `src/lib/curvas/grafico.ts`,
// que calcula la geometría) de cada año, de la propuesta, de la vigente y de la
// curva `T`, con los metadatos que la pantalla necesita para encenderlas,
// apagarlas y marcarlas. La prueba vitest con datos sintéticos.

import { MESES_CORTOS, colorAnio } from "@/lib/reportes/histograma";
import type { SerieGrafico } from "@/lib/curvas/grafico";
import type { AnioAgrupacion, TemporadaResultado } from "@/lib/curvas/tipos-api";

export type ModoGrafico = "participacion" | "unidades";

/** Una serie del gráfico con lo que la pantalla necesita para encenderla, apagarla y marcarla. */
export type SerieConMeta = SerieGrafico & {
  /** Año al que pertenece (las series de curva no lo tienen). */
  anio?: number;
  /**
   * ¿Se dibuja encendida al abrir? DECISIÓN DEL DUEÑO (2026-10-15): todos los años se ven al abrir, también los
   * descartados por tratamiento o excluidos a mano (en gris y tenues), para que ninguno «desaparezca» (Q1); el
   * planner puede apagarlos en la leyenda. Solo la curva `T` empieza apagada. (La ficha 06b, regla 47, decía
   * `porDefecto = false` para los descartados: no se sigue.)
   */
  porDefecto: boolean;
  /** Meses 1-12 atípicos del año. */
  mesesAtipicos: number[];
  /** Meses 1-12 en liquidación. */
  mesesLiquidacion: number[];
};

export const COLOR_PROPUESTA = "var(--marca-oscura)";
export const COLOR_VIGENTE = "var(--tinta)";
export const COLOR_TEMPORADA = "#8b5cf6";
export const COLOR_DESCARTADO = "#9aa1ab";
export const COLOR_LIQUIDACION = "#f59e0b";
/** 06c: la curva del usuario («Mi curva»), con trazo discontinuo grueso. */
export const COLOR_USUARIO = "#0f766e";
export const CLAVE_USUARIO = "usuario";
/** 06c: colores de los GML marcados «ver en el gráfico», por posición (se repiten si hay más). */
export const COLORES_GML = ["#7c3aed", "#db2777", "#ea580c", "#0891b2", "#65a30d", "#4f46e5", "#b45309", "#be123c"] as const;
export const claveGml = (gmlId: string) => `gml-${gmlId}`;

/** Una serie añadida al gráfico (Mi curva, un GML marcado): participación mensual (12), encendida al abrir. */
export type SerieExtra = {
  clave: string;
  etiqueta: string;
  valores: readonly number[];
  color: string;
  trazo?: SerieGrafico["trazo"];
  grosor?: number;
};

/** `aaaa-mm` → mes 1-12. */
function mesDe(periodo: string): number {
  return Number(periodo.slice(5, 7));
}

/** Texto de la serie de un año para leyenda y lectura: `2023 (atípico completo, descartado)`, `2026 (parcial, ene–set)`. */
export function etiquetaSerieAnio(a: Pick<AnioAgrupacion, "anio" | "clase" | "tratamiento" | "escaso" | "meses_atipicos" | "meses_cargados">): string {
  if (a.clase === "en_curso") {
    const ultimo = MESES_CORTOS[Math.max(0, Math.min(11, a.meses_cargados - 1))].toLowerCase();
    return `${a.anio} (parcial, ene–${ultimo})`;
  }
  const notas: string[] = [];
  if (a.clase === "atipico_completo") notas.push("atípico completo");
  else if (a.clase === "con_huecos") notas.push(`${a.meses_atipicos} ${a.meses_atipicos === 1 ? "mes atípico" : "meses atípicos"}`);
  else if (a.clase === "incompleto") notas.push("incompleto");
  if (a.tratamiento === "descartado") notas.push("descartado");
  else if (a.tratamiento === "imputado") notas.push("imputado");
  if (a.escaso) notas.push("escaso");
  return notas.length === 0 ? String(a.anio) : `${a.anio} (${notas.join(", ")})`;
}

/** Año del Niño: clase atípica (completo o con meses atípicos). Se dibuja con otro trazo (guion y punto). */
export function esAnioNino(a: Pick<AnioAgrupacion, "clase">): boolean {
  return a.clase === "atipico_completo" || a.clase === "con_huecos";
}

/**
 * Serie de un año. En participación usa la participación usada (la imputada si
 * el año se imputó; la parcial, solo con los meses cargados, en el año en curso) y,
 * si el año no tiene (descartado por el tratamiento o excluido a mano), su curva
 * REAL (`participacion_real`): un año descartado sigue dibujado, en gris y tenue (regla 47);
 * en unidades, las unidades de la red por mes. `null` si no hay nada que dibujar
 * (año sin red, sin volumen o incompleto).
 */
export function serieDeAnio(a: AnioAgrupacion, modo: ModoGrafico): SerieConMeta | null {
  const recortar = a.clase === "en_curso" || a.clase === "incompleto";
  let valores: (number | null)[];
  if (modo === "participacion") {
    const base = a.clase === "en_curso" ? a.participacion_parcial : (a.participacion ?? a.participacion_real);
    if (!base) return null;
    valores = [...base];
  } else {
    if (a.unidades <= 0 && a.meses.every((m) => m === 0)) return null;
    valores = [...a.meses];
  }
  if (recortar) valores = valores.map((v, i) => (i < a.meses_cargados ? v : null));
  if (valores.every((v) => v === null)) return null;
  const descartado = a.tratamiento === "descartado";
  return {
    clave: `anio-${a.anio}`,
    etiqueta: etiquetaSerieAnio(a),
    valores,
    color: descartado ? COLOR_DESCARTADO : colorAnio(a.anio),
    trazo: a.clase === "en_curso" ? "discontinuo" : esAnioNino(a) ? "punteado" : "continuo",
    grosor: 1.75,
    opacidad: a.escaso || descartado ? 0.45 : 1,
    imputados: modo === "participacion" ? a.imputados : [],
    anio: a.anio,
    // Todos visibles por defecto, descartados incluidos (decisión del dueño; ver `SerieConMeta.porDefecto`).
    porDefecto: true,
    mesesAtipicos: a.atipicos.map(mesDe).filter((m) => m >= 1 && m <= 12),
    mesesLiquidacion: a.liquidacion.map(mesDe).filter((m) => m >= 1 && m <= 12),
  };
}

export type OpcionesSeries = {
  modo: ModoGrafico;
  /** Candidata que se está mirando (curva en fracciones, 12). */
  propuesta?: { etiqueta: string; curva: readonly number[] } | null;
  vigente?: { etiqueta: string; curva: readonly number[] } | null;
  temporada?: Pick<TemporadaResultado, "curva_T"> | null;
  /** 06c, regla 78: Mi curva y los GML marcados; van después de la propuesta, encendidos al abrir y solo en participación. */
  extras?: readonly SerieExtra[];
};

/**
 * Todas las series, en orden de dibujo: años de más antiguo a más reciente y,
 * encima, `T`, la vigente, la propuesta y los extras (Mi curva, GML marcados). En unidades solo se dibujan los años
 * (las candidatas son participaciones).
 */
export function construirSeries(anios: readonly AnioAgrupacion[], o: OpcionesSeries): SerieConMeta[] {
  const series: SerieConMeta[] = [];
  for (const a of [...anios].sort((x, y) => x.anio - y.anio)) {
    const s = serieDeAnio(a, o.modo);
    if (s) series.push(s);
  }
  if (o.modo === "participacion") {
    const curva = (clave: string, etiqueta: string, color: string, grosor: number, valores: readonly number[] | null | undefined, porDefecto: boolean): SerieConMeta | null =>
      valores
        ? { clave, etiqueta, valores, color, trazo: "continuo", grosor, opacidad: 1, porDefecto, mesesAtipicos: [], mesesLiquidacion: [] }
        : null;
    for (const s of [
      curva("temporada", "Curva de la temporada (T)", COLOR_TEMPORADA, 1.5, o.temporada?.curva_T, false),
      curva("vigente", o.vigente?.etiqueta ?? "Vigente", COLOR_VIGENTE, 2.5, o.vigente?.curva, true),
      curva("propuesta", o.propuesta?.etiqueta ?? "Propuesta", COLOR_PROPUESTA, 3.5, o.propuesta?.curva, true),
    ])
      if (s) series.push(s);
    for (const e of o.extras ?? []) {
      if (e.valores.length !== 12) continue;
      series.push({ clave: e.clave, etiqueta: e.etiqueta, valores: e.valores, color: e.color, trazo: e.trazo ?? "continuo", grosor: e.grosor ?? 1.5, opacidad: 1, porDefecto: true, mesesAtipicos: [], mesesLiquidacion: [] });
    }
  }
  return series;
}

/** Años con meses atípicos entre las series (para el selector de sombreado), ascendentes. */
export function aniosConAtipicos(series: readonly SerieConMeta[]): number[] {
  return series
    .filter((s) => s.anio !== undefined && s.mesesAtipicos.length > 0)
    .map((s) => s.anio as number)
    .sort((a, b) => a - b);
}

/** Puntos de liquidación de las series dadas, en el formato de `calcularGeometriaCurvas`. */
export function puntosLiquidacion(series: readonly SerieConMeta[]): { clave: string; mes: number }[] {
  return series.flatMap((s) => s.mesesLiquidacion.map((mes) => ({ clave: s.clave, mes })));
}

/** Banda del resultado (`[{min,max}]`) en el formato de `calcularGeometriaCurvas`; `null` si no hay doce meses. */
export function bandaParaGrafico(banda: { min: number; max: number }[] | null | undefined): { min: number[]; max: number[] } | null {
  if (!banda || banda.length !== 12) return null;
  return { min: banda.map((b) => b.min), max: banda.map((b) => b.max) };
}
