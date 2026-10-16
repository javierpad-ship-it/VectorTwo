import { formatearPuntos } from "@/lib/formato";
import {
  compararFormaAgrupacion,
  compararFormaAnio,
  compararFormaParcial,
  imputarHuecos,
  pocosAniosNormales,
  referencia as referenciaDe,
  temporadaSugeridaDistinta,
  tratamientoEfectivo,
  type ComparacionForma,
} from "./atipicos";
import { MESES_ANIO, clasificarAnio, mesDe, participacion, redondear, sumar } from "./anios";
import { backtest, eat as calcularEat, promediarPliegues, validacionParcial } from "./backtesting";
import { calcularCandidatas, marcarIguales, curvaA, type AnioAjuste } from "./candidatas";
import { armarExplicacionF, curvaF, explicarF, rhoDe } from "./avanzada";
import { efectoAtipicoCorrida, medirVolumen, referenciaVolumen, resumirFormaPorTemporada, type GrupoParaEfecto, type SerieParaVolumen } from "./efecto";
import { cvMensual, mesesEnLiquidacion } from "./liquidacion";
import { diagnosticarTiendas, tiendasComunes, tiendasQueEntran } from "./red";
import {
  EMPATE_EAT,
  MODELOS_PROPIOS,
  TEMPORADAS_AGRUPACION,
  type AgrupacionResultado,
  type AnioAgrupacion,
  type AvisoCurva,
  type CandidataApi,
  type ClaseAnioCurva,
  type CodigoAviso,
  type ComparacionRecomendacion,
  type EfectoAtipicoAgrupacion,
  type EfectoAtipicoCorrida,
  type EfectoFormaAgrupacion,
  type FormaAnio,
  type FormaAnioCompleto,
  type ModeloCurva,
  type MotivoTratamiento,
  type ModeloPropio,
  type MotivoRecomendacion,
  type ParametrosCurvas,
  type PorTiendaAnio,
  type RedAnio,
  type ResultadoCorrida,
  type TemporadaAgrupacion,
  type TemporadaAnio,
  type TemporadaResultado,
  type TratamientoAnio,
  type VeredictoForma,
  type VolumenAnioAgrupacion,
} from "./tipos-api";
import type { SerieAnual, TiendaMaestro } from "./tipos";

/**
 * Modelo de M6 (docs/modulos/06-curvas-estacionalidad.md, "El modelo" y reglas
 * 17 a 23): clasifica los años, mide el efecto del Niño en volumen y forma,
 * propone las candidatas `A` a `E` (+ `T` prestada), las compara con
 * backtesting y recomienda una por agrupación. TypeScript puro y determinista:
 * sin base, sin HTTP, sin reloj. SQL solo agrega.
 */

// ─── Entrada ───

/**
 * Versión de las fórmulas del modelo. Sube cuando cambia una fórmula o un valor por
 * defecto que altera el resultado con la misma entrada. Entra en la huella del
 * cálculo y se guarda en la foto (`version_modelo`): una foto con una versión menor
 * recibe el aviso `modelo_anterior`.
 *
 * `2` (06c): una candidata nueva (`F`) y `T` compitiendo con EAT cambian el resultado con la misma entrada.
 */
export const VERSION_MODELO = 2;

export type EntradaAgrupacion = {
  agrupacion_id: string;
  temporada: TemporadaAgrupacion;
  composicion: { equivalencias: number; huella: string };
  /** Sumadas sobre la red comparable de cada año; ceros desde los meses publicados. Un elemento por año de la corrida. */
  unidades: SerieAnual[];
  venta: SerieAnual[];
  costo: SerieAnual[];
  /** Solo tiendas de la red de cada año. */
  por_tienda: { tienda_id: string; unidades: SerieAnual[] }[];
  atipicos: ReadonlySet<string>;
  /** `null` cuando las líneas no informan (I5). */
  temporada_sugerida: TemporadaAgrupacion | null;
  /** Las líneas de sus equivalencias son de más de una temporada. */
  temporadas_mezcladas: boolean;
  /** Meses `aaaa-mm` que sumaron negativo sobre la red y se truncaron a 0. */
  meses_negativos: string[];
  /** `sinVenta` (anios.ts, regla 50): sin unidades positivas en ningún mes publicado, sobre la venta cruda (antes de la red). */
  sin_venta: boolean;
};

/**
 * Serie agregada de una temporada entera (06b): la suma de TODAS sus agrupaciones
 * activas sobre la red comparable de cada año, tal como la lee
 * `venta_estacionalidad_agrupacion` (`temporadas`). Con ella `T` y el control del
 * Niño no dependen de qué agrupaciones se calculen en esta llamada.
 */
export type EntradaTemporada = {
  temporada: TemporadaAgrupacion;
  /** Agrupaciones ACTIVAS de la temporada (para `TemporadaResultado.agrupaciones` y "N agrupaciones"). */
  agrupaciones: number;
  /** Un elemento por año de la corrida. */
  unidades: SerieAnual[];
  /** Solo tiendas de la red de cada año. */
  por_tienda: { tienda_id: string; unidades: SerieAnual[] }[];
  /** `mesesAtipicos(periodos, { temporada })`. */
  atipicos: ReadonlySet<string>;
};

export type EntradaCorrida = {
  hasta_periodo: string;
  /** `aaaa-mm` publicados en M5 (hasta el último). */
  meses_publicados: string[];
  agrupaciones: EntradaAgrupacion[];
  redes: RedAnio[];
  /** Para nombrar tiendas en los avisos. */
  tiendas: TiendaMaestro[];
  /**
   * Series agregadas por temporada (06b). Con ellas, `calcularCorrida` recorre las
   * temporadas PRESENTES aquí (aunque ninguna agrupación calculada sea de esa
   * temporada) y no suma las de `agrupaciones`; sin ellas, como en la 0.9.6
   * (suma de las agrupaciones de la entrada).
   */
  series_temporada?: EntradaTemporada[];
};

export type SalidaCorrida = {
  resultado: ResultadoCorrida;
  efecto_atipico: EfectoAtipicoCorrida;
  resumen: {
    agrupaciones_activas: number;
    propias: number;
    prestadas: number;
    /** Agrupaciones con `sin_venta` (regla 50): ningún mes con unidades positivas (venta cruda). */
    sin_venta: number;
    con_avisos: number;
    anios_por_clase: Record<ClaseAnioCurva, number>;
  };
};

// ─── Textos ───

const porcentaje = (peso: number) => `${Math.round(peso * 100)} %`;

// ─── Regla 18: estabilidad y banda ───

/** `1 − Σ_m sd_m` de la participación entre años de ajuste (desviación típica poblacional); `null` con menos de dos. */
export function estabilidad(aniosAjuste: ReadonlyArray<readonly number[]>): number | null {
  const n = aniosAjuste.length;
  if (n < 2) return null;
  let suma = 0;
  for (let m = 0; m < MESES_ANIO; m++) {
    const media = sumar(aniosAjuste.map((p) => p[m])) / n;
    suma += Math.sqrt(sumar(aniosAjuste.map((p) => (p[m] - media) ** 2)) / n);
  }
  return redondear(Math.max(0, Math.min(1, 1 - suma)), 6);
}

export const UMBRAL_ESTABILIDAD_ALTA = 0.85;
export const UMBRAL_ESTABILIDAD_MEDIA = 0.7;

export function nivelEstabilidad(valor: number | null): "alta" | "media" | "baja" | null {
  if (valor === null) return null;
  return valor >= UMBRAL_ESTABILIDAD_ALTA ? "alta" : valor >= UMBRAL_ESTABILIDAD_MEDIA ? "media" : "baja";
}

/** Mínimo y máximo de `p_m` entre los años de ajuste (la incertidumbre por mes); `null` con menos de dos años. */
export function banda(aniosAjuste: ReadonlyArray<readonly number[]>): { min: number; max: number }[] | null {
  if (aniosAjuste.length < 2) return null;
  return Array.from({ length: MESES_ANIO }, (_, m) => {
    const v = aniosAjuste.map((p) => p[m]);
    return { min: Math.min(...v), max: Math.max(...v) };
  });
}

// ─── Regla 48: ruido entre años normales de una agrupación ───

/**
 * Ruido entre años normales (regla 8a) con el detalle de los pares: EAT entre las
 * participaciones REALES de los años `normal` completos, no escasos y no excluidos
 * a mano; `null` con menos de dos, y con tres o más el promedio de los pares. Se
 * calcula SIEMPRE que haya dos, exista o no periodo atípico (es la vara del margen
 * de empate de `recomendar`, no solo del veredicto de forma).
 */
export function ruidoNormalAgrupacion(
  normales: ReadonlyArray<{ anio: number; participacion: readonly number[] }>
): { ruido_normal: number | null; ruido_normal_detalle: { anios: [number, number]; eat: number }[] } {
  const ordenados = [...normales].sort((a, b) => a.anio - b.anio);
  const detalle: { anios: [number, number]; eat: number }[] = [];
  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      detalle.push({ anios: [ordenados[i].anio, ordenados[j].anio], eat: calcularEat(ordenados[i].participacion, ordenados[j].participacion) });
    }
  }
  if (detalle.length === 0) return { ruido_normal: null, ruido_normal_detalle: [] };
  return { ruido_normal: sumar(detalle.map((d) => d.eat)) / detalle.length, ruido_normal_detalle: detalle };
}

// ─── Regla 17: recomendación ───

export type CandidataParaRecomendar = {
  modelo: ModeloCurva;
  curva: readonly number[] | null;
  eat: number | null;
};

export type Recomendacion = {
  recomendada: ModeloCurva | null;
  motivo: MotivoRecomendacion | null;
  /** Puntos que otra candidata debe ganar a `A` para desbancarla; `null` sin propias. */
  margen: number | null;
  /** La mejor por EAT entre las propias con backtesting y `T` (06c: `T` compite). */
  mejor: ModeloPropio | "T" | null;
};

/**
 * Regla 17 (con `F` y `T` de la 06c). `mejor = argmin EAT` entre las propias con backtesting y `T` con
 * backtesting (empate: la primera en el orden `A, B, C, D, E, F, T`) y
 * `margen = max(EMPATE_EAT, margenRuido × (ruido ?? 0))`. Si `mejor` es `A`, se recomienda `A`
 * (`menor_error`). Si no, y `EAT_mejor > EAT_A − margen`, `A` con `sin_evidencia` ("sin evidencia para
 * apartarse del promedio"); si no, `mejor` con `menor_error` (con `T`, origen `prestada`). Sin propias con
 * EAT, `T` si tiene curva (`prestada`, como antes); sin nada, `null`. `F` con dos años de ajuste no tiene EAT
 * y no compite.
 */
export function recomendar(
  candidatas: readonly CandidataParaRecomendar[],
  ruido: number | null,
  margenRuido: number
): Recomendacion {
  const margen = Math.max(EMPATE_EAT, margenRuido * (ruido ?? 0));
  const conEat = (m: ModeloCurva) => {
    const c = candidatas.find((x) => x.modelo === m);
    return c && c.curva !== null && c.eat !== null ? (c as CandidataParaRecomendar & { eat: number }) : null;
  };
  const propias = MODELOS_PROPIOS.map(conEat).filter((c): c is CandidataParaRecomendar & { eat: number } => c !== null);
  if (propias.length === 0) {
    const t = candidatas.find((c) => c.modelo === "T" && c.curva !== null);
    return t
      ? { recomendada: "T", motivo: "prestada", margen: null, mejor: null }
      : { recomendada: null, motivo: null, margen: null, mejor: null };
  }
  const t = conEat("T");
  const competidoras = t ? [...propias, t] : propias;
  let mejor = competidoras[0];
  for (const c of competidoras) if (c.eat < mejor.eat) mejor = c;
  const mejorModelo = mejor.modelo as ModeloPropio | "T";
  const a = propias.find((c) => c.modelo === "A");
  if (!a || mejor.modelo === "A") {
    return { recomendada: mejorModelo, motivo: "menor_error", margen, mejor: mejorModelo };
  }
  if (mejor.eat > a.eat - margen) return { recomendada: "A", motivo: "sin_evidencia", margen, mejor: mejorModelo };
  return { recomendada: mejorModelo, motivo: "menor_error", margen, mejor: mejorModelo };
}

function fraseComparativa(
  rec: Recomendacion,
  candidatas: readonly CandidataApi[],
  ruido: number | null,
  margenRuido: number
): ComparacionRecomendacion | null {
  if (!rec.mejor || rec.margen === null) return null;
  const mejor = candidatas.find((c) => c.modelo === rec.mejor);
  const a = candidatas.find((c) => c.modelo === "A");
  if (!mejor || mejor.eat === null) return null;
  const pruebas = mejor.pliegues;
  let frase: string;
  if (rec.mejor === "A" || !a || a.eat === null) {
    frase = `${rec.mejor} se equivoca ${formatearPuntos(mejor.eat)} pp en ${pruebas} pruebas: es la de menor error.`;
  } else {
    const diferencia = a.eat - mejor.eat;
    const base = `${rec.mejor} se equivoca ${formatearPuntos(mejor.eat)} pp frente a ${formatearPuntos(a.eat)} de A en ${pruebas} pruebas; la diferencia (${formatearPuntos(diferencia)})`;
    if (rec.motivo === "sin_evidencia") {
      // El margen es `max(EMPATE_EAT, margen_ruido × ruido)`: el texto dice cuál de los dos manda y el porcentaje real del parámetro.
      const manda = ruido !== null && margenRuido * ruido > EMPATE_EAT;
      const origen = manda
        ? `${formatearPuntos(rec.margen)} = ${porcentaje(margenRuido)} del ruido entre años normales, ${formatearPuntos(ruido as number)}`
        : formatearPuntos(rec.margen);
      frase = `${base} no llega al margen${manda ? "" : " mínimo"} (${origen}): se recomienda A.`;
    } else {
      frase = `${base} supera el margen (${formatearPuntos(rec.margen)}): se recomienda ${rec.mejor}.`;
    }
  }
  return {
    mejor: rec.mejor,
    eat_mejor: mejor.eat,
    eat_a: a?.eat ?? null,
    margen: rec.margen,
    pliegues: pruebas,
    ruido_normal: ruido,
    margen_ruido: margenRuido,
    frase,
  };
}

// ─── Paso 1: clasificar los años y obtener las participaciones reales ───

export type Contexto = {
  anios: number[];
  publicados: string[];
  hasta: string;
  redes: Map<number, RedAnio>;
  parametros: ParametrosCurvas;
  tiendas: Map<string, TiendaMaestro>;
};

type AnioPreparado = {
  anio: number;
  clase: ClaseAnioCurva;
  atipicos: string[];
  meses_cargados: number;
  serie: SerieAnual;
  total: number;
  sinRed: boolean;
  /** Participación real (sin imputar) de un año completo; `null` si no es completo o no tiene volumen. */
  pReal: number[] | null;
  /** Participación usada en el ajuste (tal cual o imputada). */
  p: number[] | null;
  tratamiento: TratamientoAnio | null;
  /** Solo con `tratamiento = 'descartado'`. */
  motivoTratamiento: MotivoTratamiento | null;
  /** El planner lo sacó del ajuste (`anios_excluidos`); solo en el análisis de la agrupación, nunca en `T` ni en el control. */
  excluidoManual: boolean;
  imputados: number[];
  pesoImputado: number | null;
  escaso: boolean;
  utilizable: boolean;
  enAjuste: boolean;
  forma: ComparacionForma | null;
};

type Preparacion = {
  anios: AnioPreparado[];
  referencia: number[] | null;
  ruido: number | null;
  /** Los pares que dan `ruido` (regla 48). */
  ruidoDetalle: { anios: [number, number]; eat: number }[];
  /** Años normales completos con red (sirven para el volumen, aunque sean escasos). */
  normalesVolumen: AnioPreparado[];
  /** Hay algún año atípico completo y no hay referencia. */
  sinReferencia: boolean;
};

const CLASES_COMPLETAS: readonly ClaseAnioCurva[] = ["normal", "con_huecos", "atipico_completo"];

/**
 * Paso 1. Clasifica cada año (regla 1), calcula la referencia `r` y el ruido con
 * los años normales no escasos, compara la forma de cada año atípico completo
 * (relativa al ruido, B1), fija el tratamiento efectivo (regla 8c), imputa los
 * huecos si toca (regla 7) y marca los años `escaso`. `anios_ajuste` son los
 * utilizables no escasos; el año en curso NUNCA entra. Con `conExclusiones`
 * (solo el análisis de la agrupación) los `anios_excluidos` quedan `descartado`
 * con motivo `excluido_manual`, fuera del ajuste y de la referencia y el ruido;
 * siguen en `normalesVolumen` (el volumen es diagnóstico).
 */
function prepararAnios(series: readonly SerieAnual[], atipicos: ReadonlySet<string>, ctx: Contexto, conExclusiones = false): Preparacion {
  const p = ctx.parametros;
  const excluidos = new Set(conExclusiones ? p.anios_excluidos : []);
  const base: AnioPreparado[] = series.map((serie) => {
    const c = clasificarAnio(serie.anio, ctx.publicados, atipicos, p.max_meses_hueco, ctx.hasta);
    const sinRed = ctx.redes.get(serie.anio)?.sin_red ?? true;
    const total = sumar(serie.meses);
    const completa = CLASES_COMPLETAS.includes(c.clase);
    const pReal = completa && !sinRed ? participacion(serie.meses) : null;
    return {
      anio: serie.anio,
      clase: c.clase,
      atipicos: c.meses_atipicos,
      meses_cargados: c.meses_cargados,
      serie,
      total,
      sinRed,
      pReal,
      p: null,
      tratamiento: null,
      imputados: [],
      pesoImputado: null,
      motivoTratamiento: null,
      excluidoManual: pReal !== null && excluidos.has(serie.anio),
      escaso: pReal !== null && total < p.min_unidades_ano,
      utilizable: false,
      enAjuste: false,
      forma: null,
    };
  });

  const normales = base.filter((a) => a.clase === "normal" && a.pReal !== null && !a.escaso && !a.excluidoManual);
  const referencia = referenciaDe(normales.map((a) => a.pReal as number[]));
  const { ruido_normal: ruido, ruido_normal_detalle: ruidoDetalle } = ruidoNormalAgrupacion(
    normales.map((a) => ({ anio: a.anio, participacion: a.pReal as number[] }))
  );

  for (const a of base) {
    if (a.pReal === null) continue;
    if (a.clase !== "normal") a.forma = compararFormaAnio(a.pReal, referencia, p.umbral_forma, ruido);
    if (a.excluidoManual) {
      a.tratamiento = "descartado";
      a.motivoTratamiento = "excluido_manual";
      continue;
    }
    if (a.clase === "normal") {
      a.tratamiento = "incluido";
      a.p = a.pReal;
    } else {
      a.tratamiento = tratamientoEfectivo(p.tratamiento_atipicos, (a.forma as ComparacionForma).veredicto, a.clase);
      if (a.tratamiento === "descartado") {
        a.motivoTratamiento =
          p.tratamiento_atipicos === "auto"
            ? "forma_cambia"
            : p.tratamiento_atipicos === "imputar" && a.clase === "con_huecos"
              ? "sin_referencia"
              : "parametro";
      }
      if (a.tratamiento === "incluido") a.p = a.pReal;
      if (a.tratamiento === "imputado" && referencia) {
        const meses = a.atipicos.map(mesDe);
        const imputado = imputarHuecos(a.serie.meses, meses, referencia);
        if (imputado) {
          a.p = imputado.participacion;
          a.imputados = meses;
          a.pesoImputado = imputado.pesoImputado;
        } else {
          a.tratamiento = "descartado";
          a.motivoTratamiento = "sin_referencia";
        }
      }
    }
    a.utilizable = a.p !== null && (a.tratamiento === "incluido" || a.tratamiento === "imputado");
    a.enAjuste = a.utilizable && !a.escaso;
  }

  return {
    anios: base,
    referencia,
    ruido,
    ruidoDetalle,
    normalesVolumen: base.filter((a) => a.clase === "normal" && a.serie.completo && !a.sinRed),
    sinReferencia: referencia === null && base.some((a) => a.clase === "con_huecos" || a.clase === "atipico_completo"),
  };
}

// ─── Candidatas con backtesting ───

type CandidatasCalculadas = {
  candidatas: CandidataApi[];
  recomendacion: Recomendacion;
  aniosAjuste: number[];
};

function aniosAjusteDe(
  prep: Preparacion,
  tiendasDeAnio: (anio: number) => ReadonlyArray<readonly number[]>
): AnioAjuste[] {
  return prep.anios
    .filter((a) => a.enAjuste && a.p)
    .map((a) => ({
      anio: a.anio,
      participacion: a.p as number[],
      unidades_total: a.total,
      tiendas: tiendasDeAnio(a.anio),
      normal: a.clase === "normal",
    }));
}

/**
 * 06c. `T` del pliegue: `A` sobre los años de ajuste de la temporada SIN el año de prueba (`excluir`). Sin
 * `excluir`, la `T` completa. `null` si no queda ningún año. Con ella `T` compite con backtesting honesto y
 * `F` contrae hacia una `T` que no ha visto el año que se va a medir.
 */
export function curvaTDe(aniosTemporada: readonly AnioAjuste[], excluir?: number): number[] | null {
  const base = excluir === undefined ? aniosTemporada : aniosTemporada.filter((a) => a.anio !== excluir);
  return base.length > 0 ? curvaA(base) : null;
}

/**
 * `F` de UN pliegue del backtesting, SOLO con lo que el entrenamiento permite (sin fuga): `ρ` es el ruido entre
 * los años normales de entrenamiento (`rhoDe`) y la `T` es la de la temporada sin el año de prueba
 * (`curvaTDe`). Con menos de dos años de entrenamiento no hay backtesting honesto: `null` (el pliegue se omite).
 * Es la única definición: la usan `proponer` y el backtest offline de las fotos.
 */
export function ajustarFPliegue(p: {
  ajuste: readonly AnioAjuste[];
  /** Años de ajuste de la temporada (`GrupoTemporada.anios_ajuste`). */
  aniosTemporada: readonly AnioAjuste[];
  /** Años de entrenamiento del pliegue. */
  entrenamiento: readonly number[];
  /** Año de prueba (el que queda fuera). */
  prueba: number;
  recencia: number;
}): ReturnType<typeof curvaF> {
  const entrenados = p.ajuste.filter((a) => p.entrenamiento.includes(a.anio));
  if (entrenados.length < 2) return null;
  return curvaF(entrenados, rhoDe(entrenados), curvaTDe(p.aniosTemporada, p.prueba), p.recencia);
}

/** EAT EN MUESTRA: la curva completa contra la participación usada de cada año de ajuste (promedio); `null` sin años. */
export function eatEnMuestra(curva: readonly number[], ajuste: readonly Pick<AnioAjuste, "participacion">[]): number | null {
  if (ajuste.length === 0) return null;
  return sumar(ajuste.map((a) => calcularEat(curva, a.participacion))) / ajuste.length;
}

function candidataVacia(modelo: ModeloCurva, motivo: string, prestada = false): CandidataApi {
  return {
    modelo,
    curva: null,
    motivo,
    eat: null,
    error_max: null,
    pruebas: 0,
    pliegues: 0,
    eat_por_pliegue: [],
    eat_parcial: null,
    igual_a: null,
    prestada,
    eat_en_muestra: null,
  };
}

function proponer(
  ajuste: readonly AnioAjuste[],
  prep: Preparacion,
  curvaT: number[] | null,
  aniosTemporada: readonly AnioAjuste[],
  temporada: TemporadaAgrupacion,
  enCurso: AnioPreparado | undefined,
  atipicos: ReadonlySet<string>,
  ctx: Contexto
): CandidatasCalculadas {
  const p = ctx.parametros;
  const nums = ajuste.map((a) => a.anio);
  const candidatas: CandidataApi[] = [];
  const realDe = (anio: number) => ajuste.find((a) => a.anio === anio)?.participacion.slice() ?? null;
  const parcialDe = (curva: readonly number[]) =>
    enCurso ? validacionParcial(curva, { anio: enCurso.anio, meses: enCurso.serie.meses, publicados: enCurso.serie.publicados }, atipicos) : null;
  const pruebaDe = (entrenamiento: readonly number[]) => nums.find((n) => !entrenamiento.includes(n));

  // `F` de un pliegue: SOLO con los años de entrenamiento (ρ y T del pliegue, sin el año de prueba). Con un solo
  // año de entrenamiento no hay backtesting honesto: no se ajusta (el pliegue se omite).
  const ajustarF = (entrenamiento: readonly number[]) => {
    const prueba = pruebaDe(entrenamiento);
    return prueba === undefined ? null : ajustarFPliegue({ ajuste, aniosTemporada, entrenamiento, prueba, recencia: p.recencia_f });
  };

  if (ajuste.length >= 2) {
    const crudas = calcularCandidatas(ajuste, p.min_unidades_ano, { recencia: p.recencia_f, t: curvaT, rho: rhoDe(ajuste) });
    const iguales = marcarIguales([...crudas.map((c) => ({ modelo: c.modelo as ModeloCurva, curva: c.curva })), { modelo: "T", curva: curvaT }]);
    for (const c of crudas) {
      if (!c.curva) {
        candidatas.push(candidataVacia(c.modelo, c.motivo ?? "sin_anos_ajuste"));
        continue;
      }
      const porPliegue = backtest(
        nums,
        (entrenamiento) =>
          c.modelo === "F"
            ? (ajustarF(entrenamiento)?.curva ?? null)
            : (calcularCandidatas(
                ajuste.filter((a) => entrenamiento.includes(a.anio)),
                p.min_unidades_ano
              ).find((x) => x.modelo === c.modelo)?.curva ?? null),
        realDe
      );
      const promedio = promediarPliegues(porPliegue);
      const candidata: CandidataApi = {
        modelo: c.modelo,
        curva: c.curva,
        motivo: c.modelo === "F" && porPliegue.length === 0 ? "sin_backtesting_honesto" : null,
        eat: promedio?.eat ?? null,
        error_max: promedio?.error_max ?? null,
        pruebas: porPliegue.length,
        pliegues: porPliegue.length,
        eat_por_pliegue: porPliegue,
        eat_parcial: parcialDe(c.curva),
        igual_a: iguales.get(c.modelo) ?? null,
        prestada: false,
        eat_en_muestra: eatEnMuestra(c.curva, ajuste),
      };
      if (c.modelo === "F" && c.detalle_f) {
        // Por pliegue: el ρ y el λ de ESE pliegue (solo con su entrenamiento) y el EAT medido en él.
        const por_pliegue = porPliegue.flatMap((pl) => {
          const r = ajustarF(nums.filter((n) => n !== pl.anio));
          return r ? [{ anio_prueba: pl.anio, rho: r.detalle.rho, lambda: r.detalle.lambda, eat: pl.eat }] : [];
        });
        candidata.detalle_f = { ...c.detalle_f, por_pliegue };
      }
      candidatas.push(candidata);
    }
  } else {
    for (const modelo of MODELOS_PROPIOS) candidatas.push(candidataVacia(modelo, "sin_anos_ajuste"));
  }

  // `T` compite con la misma mecánica: en cada pliegue, la `T` de la temporada SIN el año de prueba contra ese año.
  if (curvaT === null) {
    candidatas.push(candidataVacia("T", "sin_anos_utilizables", true));
  } else {
    const iguales = marcarIguales([...candidatas.map((c) => ({ modelo: c.modelo, curva: c.curva })).filter((c) => c.modelo !== "T"), { modelo: "T", curva: curvaT }]);
    const porPliegue = backtest(
      nums,
      (entrenamiento) => {
        const prueba = pruebaDe(entrenamiento);
        return prueba === undefined ? null : curvaTDe(aniosTemporada, prueba);
      },
      realDe
    );
    const promedio = promediarPliegues(porPliegue);
    candidatas.push({
      modelo: "T",
      curva: curvaT,
      motivo: null,
      eat: promedio?.eat ?? null,
      error_max: promedio?.error_max ?? null,
      pruebas: porPliegue.length,
      pliegues: porPliegue.length,
      eat_por_pliegue: porPliegue,
      eat_parcial: parcialDe(curvaT),
      igual_a: iguales.get("T") ?? null,
      prestada: true,
      eat_en_muestra: eatEnMuestra(curvaT, ajuste),
    });
  }

  // Nota: `eat` puede quedar nulo con curva (menos de dos pliegues, o `F` con dos años): `recomendar` solo mira las que tienen EAT.
  const recomendacion = recomendar(candidatas, prep.ruido, p.margen_ruido);

  // La explicación de `F` se cierra con lo que el backtesting dijo y lo que el sistema recomienda.
  const f = candidatas.find((c) => c.modelo === "F");
  if (f?.detalle_f) {
    const a = candidatas.find((c) => c.modelo === "A");
    const frase = explicarF(f.detalle_f, temporada, nums.length, {
      eat: f.eat,
      pruebas: f.pruebas,
      eat_a: a?.eat ?? null,
      margen: recomendacion.margen,
      recomendada: recomendacion.recomendada,
    });
    f.explicacion_f = armarExplicacionF(f.detalle_f, frase);
  }
  return { candidatas, recomendacion, aniosAjuste: nums };
}

// ─── Series por tienda ───

type PorTiendaPorAnio = Map<number, Map<string, number[]>>;

function indexarPorTienda(entrada: EntradaAgrupacion): PorTiendaPorAnio {
  const salida: PorTiendaPorAnio = new Map();
  for (const t of entrada.por_tienda) {
    for (const s of t.unidades) {
      const porTienda = salida.get(s.anio) ?? new Map<string, number[]>();
      porTienda.set(t.tienda_id, s.meses);
      salida.set(s.anio, porTienda);
    }
  }
  return salida;
}

function seriePara(a: AnioPreparado, porTienda: PorTiendaPorAnio): SerieParaVolumen {
  return {
    anio: a.anio,
    unidades: a.serie.meses,
    publicados: a.serie.publicados,
    por_tienda: porTienda.get(a.anio) ?? new Map<string, number[]>(),
  };
}

function sumarPorTienda(mapas: ReadonlyArray<ReadonlyMap<string, readonly number[]>>): Map<string, number[]> {
  const salida = new Map<string, number[]>();
  for (const mapa of mapas) {
    for (const [id, meses] of mapa) {
      const acumulado = salida.get(id) ?? Array.from({ length: MESES_ANIO }, () => 0);
      for (let m = 0; m < MESES_ANIO; m++) acumulado[m] += meses[m];
      salida.set(id, acumulado);
    }
  }
  return salida;
}

function sumarSeriesAnio(series: readonly SerieAnual[]): SerieAnual {
  const primera = series[0];
  const meses = Array.from({ length: MESES_ANIO }, (_, m) => sumar(series.map((s) => s.meses[m])));
  return { anio: primera.anio, meses, publicados: [...primera.publicados], completo: primera.completo };
}

// ─── Curva de la temporada (T) ───

type GrupoTemporada = {
  temporada: TemporadaAgrupacion;
  agrupaciones: EntradaAgrupacion[];
  /** Agrupaciones activas que suman la serie (con serie agregada, las de toda la temporada y no solo las calculadas). */
  nAgrupaciones: number;
  unidades: SerieAnual[];
  porTienda: PorTiendaPorAnio;
  atipicos: ReadonlySet<string>;
  prep: Preparacion;
  anios_ajuste: AnioAjuste[];
  curva_T: number[] | null;
};

/**
 * Regla 11b. `T`, la curva de la temporada: la serie es la suma de las
 * agrupaciones de la temporada sobre la red comparable de cada año, con la misma
 * clasificación de años (misma temporada → mismos meses atípicos) y el mismo
 * tratamiento; `T` es `A` sobre sus años de ajuste. Sin años de ajuste → `null`.
 * (Se suman las series ya truncadas de cada agrupación.) Con `agregada` (06b, las
 * series de la temporada entera que lee `venta_estacionalidad_agrupacion`) se usa
 * esa serie y sus meses atípicos en vez de sumar `agrupaciones`. `T` NO aplica
 * `anios_excluidos`: es la curva de la temporada, no la de una agrupación.
 */
function armarGrupoTemporada(
  temporada: TemporadaAgrupacion,
  agrupaciones: EntradaAgrupacion[],
  ctx: Contexto,
  agregada?: EntradaTemporada
): GrupoTemporada {
  let unidades: SerieAnual[];
  const porTienda: PorTiendaPorAnio = new Map();
  let atipicos: ReadonlySet<string>;
  let nAgrupaciones: number;
  if (agregada) {
    unidades = ctx.anios.map(
      (anio) =>
        agregada.unidades.find((s) => s.anio === anio) ??
        ({ anio, meses: Array.from({ length: MESES_ANIO }, () => 0), publicados: Array.from({ length: MESES_ANIO }, () => false), completo: false } satisfies SerieAnual)
    );
    for (const t of agregada.por_tienda) {
      for (const s of t.unidades) {
        const delAnio = porTienda.get(s.anio) ?? new Map<string, number[]>();
        delAnio.set(t.tienda_id, s.meses);
        porTienda.set(s.anio, delAnio);
      }
    }
    for (const anio of ctx.anios) if (!porTienda.has(anio)) porTienda.set(anio, new Map<string, number[]>());
    atipicos = agregada.atipicos;
    nAgrupaciones = agregada.agrupaciones;
  } else {
    unidades = ctx.anios.map((anio) =>
      sumarSeriesAnio(agrupaciones.map((a) => a.unidades.find((s) => s.anio === anio) as SerieAnual))
    );
    for (const anio of ctx.anios) {
      porTienda.set(
        anio,
        sumarPorTienda(agrupaciones.map((a) => indexarPorTienda(a).get(anio) ?? new Map<string, number[]>()))
      );
    }
    atipicos = agrupaciones[0]?.atipicos ?? new Set<string>();
    nAgrupaciones = agrupaciones.length;
  }
  const prep = prepararAnios(unidades, atipicos, ctx);
  const anios_ajuste = aniosAjusteDe(prep, () => []);
  const curva_T = anios_ajuste.length > 0 ? curvaA(anios_ajuste) : null;
  return { temporada, agrupaciones, nAgrupaciones, unidades, porTienda, atipicos, prep, anios_ajuste, curva_T };
}

/** Un conjunto de agrupaciones de la misma temporada comparte los meses atípicos (la unión de los periodos que aplican). */
export function curvaTemporada(
  temporada: TemporadaAgrupacion,
  agrupaciones: readonly EntradaAgrupacion[],
  ctx: Contexto
): number[] | null {
  if (agrupaciones.length === 0) return null;
  return armarGrupoTemporada(temporada, [...agrupaciones], ctx).curva_T;
}

// ─── Análisis de una agrupación ───

function pesoMayor(porTienda: readonly PorTiendaAnio[]): number | null {
  return porTienda.length === 0 ? null : Math.max(...porTienda.map((t) => t.peso));
}

function construirAnio(
  a: AnioPreparado,
  porTienda: PorTiendaPorAnio,
  ctx: Contexto,
  ruido: number | null,
  cv: { periodo: string; cv: number | null }[]
): { anio: AnioAgrupacion; unidadesTienda: Map<string, number[]> } {
  const red = ctx.redes.get(a.anio);
  const unidadesTienda = porTienda.get(a.anio) ?? new Map<string, number[]>();
  const entran = red ? [...tiendasQueEntran(red)].sort() : [];
  const tiendasLista = entran.map((id) => ({
    tienda_id: id,
    unidades: unidadesTienda.get(id) ?? Array.from({ length: MESES_ANIO }, () => 0),
  }));
  const pAgrupacion = participacion(a.serie.meses);
  const diag = diagnosticarTiendas(
    tiendasLista,
    pAgrupacion,
    ctx.parametros.umbral_forma,
    ruido,
    ctx.parametros.peso_minimo_diagnostico
  );
  const detalle: PorTiendaAnio[] = diag.map((d) => ({
    tienda_id: d.tienda.tienda_id,
    unidades: d.unidades,
    peso: d.peso,
    participacion: d.participacion,
    eat_vs_red: d.eat_vs_red,
    distinta: d.distinta,
  }));

  const liquidacion =
    a.sinRed || a.clase === "incompleto" ? [] : mesesEnLiquidacion(cv, a.atipicos, ctx.parametros.umbral_liquidacion);

  const parcial = a.clase === "en_curso" ? pAgrupacion : null;
  return {
    anio: {
      anio: a.anio,
      clase: a.clase,
      meses_atipicos: a.atipicos.length,
      atipicos: a.atipicos,
      tratamiento: a.tratamiento,
      tratamiento_motivo: a.motivoTratamiento,
      unidades: a.total,
      meses: a.serie.meses,
      escaso: a.escaso,
      en_ajuste: a.enAjuste,
      meses_cargados: a.meses_cargados,
      tiendas_en_red: entran.length,
      peso_tienda_mayor: pesoMayor(detalle),
      participacion: a.p,
      participacion_real: a.pReal,
      imputados: a.imputados,
      peso_imputado: a.pesoImputado,
      participacion_parcial: parcial,
      liquidacion,
      por_tienda: detalle,
    },
    unidadesTienda,
  };
}

function cvDelAnio(entrada: EntradaAgrupacion, a: AnioPreparado): { periodo: string; cv: number | null }[] {
  const venta = entrada.venta.find((s) => s.anio === a.anio);
  const costo = entrada.costo.find((s) => s.anio === a.anio);
  if (!venta || !costo) return [];
  const salida: { periodo: string; cv: number | null }[] = [];
  for (let m = 0; m < MESES_ANIO; m++) {
    if (!a.serie.publicados[m]) continue;
    salida.push({ periodo: `${String(a.anio).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`, cv: cvMensual(venta.meses[m], costo.meses[m]) });
  }
  return salida;
}

const unidad = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

type Analisis = {
  resultado: AgrupacionResultado;
  grupo: { porTienda: PorTiendaPorAnio; prep: Preparacion };
  veredicto: VeredictoForma | null;
};

function analizarAgrupacion(entrada: EntradaAgrupacion, grupoT: GrupoTemporada | undefined, ctx: Contexto): Analisis {
  const p = ctx.parametros;
  const prep = prepararAnios(entrada.unidades, entrada.atipicos, ctx, true);
  const porTienda = indexarPorTienda(entrada);
  const enCurso = prep.anios.find((a) => a.clase === "en_curso");
  const nombreTienda = (id: string) => ctx.tiendas.get(id)?.codigo ?? id;

  // Años (con CV, liquidación y desglose por tienda).
  const anios: AnioAgrupacion[] = [];
  const cvMensualTodo: { periodo: string; cv: number | null }[] = [];
  for (const a of prep.anios) {
    const cv = cvDelAnio(entrada, a);
    if (!a.sinRed && a.clase !== "incompleto") cvMensualTodo.push(...cv);
    anios.push(construirAnio(a, porTienda, ctx, prep.ruido, cv).anio);
  }

  // Efecto del Niño: volumen.
  const atipicosAnio = (a: AnioPreparado) =>
    a.atipicos.length > 0 && (a.clase === "con_huecos" || a.clase === "atipico_completo" || a.clase === "en_curso");
  const normalesVol = prep.normalesVolumen;
  const volumen: VolumenAnioAgrupacion[] = [];
  for (const a of prep.anios.filter(atipicosAnio)) {
    const ref = referenciaVolumen(a.anio, normalesVol.map((n) => n.anio));
    const medido = medirVolumen(
      seriePara(a, porTienda),
      ref,
      normalesVol.map((n) => seriePara(n, porTienda)),
      ctx.redes
    );
    volumen.push({
      anio: a.anio,
      clase: a.clase,
      ratio_volumen: medido.ratio_volumen,
      meses_comparados: medido.meses_comparados,
      anio_referencia: medido.anio_referencia,
      por_anio_normal: medido.por_anio_normal,
      tiendas_comunes: medido.tiendas_comunes,
      unidades: medido.unidades,
      unidades_referencia: medido.unidades_referencia,
      ratio_mensual: medido.ratio_mensual,
    });
  }

  // Efecto del Niño: forma.
  const porAnioForma: FormaAnio[] = [];
  const veredictos: VeredictoForma[] = [];
  for (const a of prep.anios) {
    if (a.forma && (a.clase === "con_huecos" || a.clase === "atipico_completo")) {
      veredictos.push(a.forma.veredicto);
      const f: FormaAnioCompleto = {
        anio: a.anio,
        parcial: false,
        diferencia_anio: a.forma.diferencia_anio ?? 0,
        pico: a.forma.pico,
        pico_referencia: a.forma.pico_referencia ?? a.forma.pico,
        corrimiento_pico: a.forma.corrimiento_pico ?? 0,
        mes_mayor_diferencia: a.forma.mes_mayor_diferencia ?? 0,
        veredicto: a.forma.veredicto,
        tratamiento_aplicado: a.tratamiento,
      };
      porAnioForma.push(f);
    } else if (a.clase === "en_curso" && a.atipicos.length > 0) {
      const ref = referenciaVolumen(a.anio, normalesVol.map((n) => n.anio));
      const redY = ctx.redes.get(a.anio);
      const redN = ref === null ? undefined : ctx.redes.get(ref);
      const comunes = ref === null ? new Set<string>() : tiendasComunes(redY, redN);
      const meses = Array.from({ length: MESES_ANIO }, () => 0);
      const delAnio = porTienda.get(a.anio) ?? new Map<string, number[]>();
      for (const id of comunes) {
        const u = delAnio.get(id);
        if (u) for (let m = 0; m < MESES_ANIO; m++) meses[m] += u[m];
      }
      porAnioForma.push(
        compararFormaParcial(
          a.anio,
          prep.referencia,
          a.serie.publicados,
          participacion(a.serie.meses),
          comunes.size > 0 ? { participacion: participacion(meses), tiendas: comunes.size } : null
        )
      );
    }
  }

  const hayAtipico = prep.anios.some(atipicosAnio);
  let forma: EfectoFormaAgrupacion | null = null;
  let veredicto: VeredictoForma | null = null;
  if (hayAtipico) {
    veredicto = compararFormaAgrupacion(veredictos);
    const umbralEfectivo = Math.max(p.umbral_forma, prep.ruido ?? 0);
    const conjuntoInc = prep.anios.filter((a) => a.pReal !== null && !a.escaso && CLASES_COMPLETAS.includes(a.clase));
    const conjuntoSin = conjuntoInc.filter((a) => a.clase === "normal");
    const cInc = referenciaDe(conjuntoInc.map((a) => a.pReal as number[]));
    const cSin = referenciaDe(conjuntoSin.map((a) => a.pReal as number[]));
    forma = {
      veredicto,
      umbral: p.umbral_forma,
      ruido_normal: prep.ruido,
      umbral_efectivo: umbralEfectivo,
      diferencia_forma: cInc && cSin ? calcularEat(cInc, cSin) : null,
      c_inc: cInc,
      c_sin: cSin,
      por_anio: porAnioForma,
    };
  }
  const efecto: EfectoAtipicoAgrupacion = { volumen, forma };

  // Candidatas.
  const ajuste = aniosAjusteDe(prep, (anio) => [...(porTienda.get(anio)?.values() ?? [])]);
  const propuesta = proponer(ajuste, prep, grupoT?.curva_T ?? null, grupoT?.anios_ajuste ?? [], entrada.temporada, enCurso, entrada.atipicos, ctx);
  const { candidatas, recomendacion } = propuesta;
  const estab = estabilidad(ajuste.map((a) => a.participacion));
  const bandaMes = banda(ajuste.map((a) => a.participacion));

  const origen: "propia" | "prestada" | null =
    recomendacion.recomendada === null ? null : recomendacion.recomendada === "T" ? "prestada" : "propia";

  // Avisos.
  const avisos: AvisoCurva[] = [];
  const avisar = (codigo: CodigoAviso, detalle: string) => avisos.push({ codigo, detalle });
  const utilizables = prep.anios.filter((a) => a.utilizable);

  if (entrada.sin_venta) avisar("sin_venta", "Sin ventas en ningún mes publicado.");
  if (utilizables.length === 0) avisar("sin_anos_utilizables", "No hay ningún año completo utilizable.");
  // Con años excluidos a mano, "no queda ninguno" también es "pocos años de ajuste": el planner ve por qué la curva es prestada.
  if (ajuste.length < 2 && (utilizables.length > 0 || prep.anios.some((a) => a.excluidoManual)))
    avisar("pocos_anos_ajuste", `${unidad(ajuste.length, "año de ajuste", "años de ajuste")} (hacen falta dos): sin curva propia.`);
  const escasos = prep.anios.filter((a) => a.escaso);
  if (escasos.length > 0)
    avisar("escaso", `Años con menos de ${p.min_unidades_ano} unidades: ${escasos.map((a) => `${a.anio} (${a.total})`).join(", ")}.`);
  const utilizablesOrden = [...utilizables].sort((a, b) => a.anio - b.anio);
  for (let i = 1; i < utilizablesOrden.length; i++) {
    const antes = utilizablesOrden[i - 1];
    const ahora = utilizablesOrden[i];
    if (antes.total > 0 && ahora.total > 0) {
      const cociente = ahora.total / antes.total;
      if (cociente > p.umbral_cambio_volumen || cociente < 1 / p.umbral_cambio_volumen) {
        avisar("cambio_volumen_extremo", `${antes.anio} a ${ahora.anio}: de ${antes.total} a ${ahora.total} unidades (×${formatearPuntos(cociente)}).`);
      }
    }
  }
  for (const a of prep.anios.filter((x) => x.excluidoManual)) {
    avisar("anio_excluido", `${a.anio}: excluido del ajuste a mano; se dibuja pero no entra en las candidatas.`);
  }
  const incompletos = prep.anios.filter((a) => a.clase === "incompleto" && !a.sinRed);
  if (incompletos.length > 0)
    avisar("meses_sin_cargar", `Años con meses sin cargar: ${incompletos.map((a) => a.anio).join(", ")}.`);
  if (entrada.meses_negativos.length > 0)
    avisar("mes_negativo", `La suma de la red fue negativa y se tomó como 0 en ${entrada.meses_negativos.join(", ")}.`);
  if (veredicto === "forma_cambia") avisar("forma_cambia", "La forma de algún año atípico se aparta más que el ruido entre años normales.");
  if (prep.sinReferencia) avisar("sin_referencia", "Hay años atípicos pero ningún año normal con qué compararlos.");
  if (volumen.some((v) => v.ratio_volumen === null))
    avisar("sin_referencia_volumen", `Sin tiendas comunes o sin referencia para medir el volumen de ${volumen.filter((v) => v.ratio_volumen === null).map((v) => v.anio).join(", ")}.`);
  if (utilizables.length > 0 && pocosAniosNormales(prep.anios)) {
    const normales = prep.anios.filter((a) => a.clase === "normal");
    avisar("pocos_anos_normales", `${unidad(normales.length, "año normal", "años normales")}${normales.length ? ` (${normales.map((a) => a.anio).join(", ")})` : ""}.`);
  }
  for (const a of prep.anios.filter((x) => x.clase === "atipico_completo")) {
    avisar("ano_atipico_completo", `${a.anio}: ${unidad(a.atipicos.length, "mes atípico", "meses atípicos")}, tratamiento ${a.tratamiento ?? "sin tratar"}.`);
  }
  if (entrada.temporada_sugerida && temporadaSugeridaDistinta(entrada.temporada, entrada.temporada_sugerida, entrada.composicion.equivalencias))
    avisar("temporada_sugerida_distinta", `Las líneas sugieren ${entrada.temporada_sugerida}; la agrupación está en ${entrada.temporada}.`);
  if (entrada.temporadas_mezcladas) avisar("temporadas_mezcladas", "Sus equivalencias pertenecen a líneas de más de una temporada.");
  if (anios.some((a) => a.liquidacion.length > 3)) {
    const fuertes = anios.filter((a) => a.liquidacion.length > 3);
    avisar("liquidacion_fuerte", `Más de tres meses en liquidación en ${fuertes.map((a) => a.anio).join(", ")}.`);
  }
  for (const a of anios) {
    if (a.peso_tienda_mayor !== null && a.peso_tienda_mayor > p.umbral_tienda_dominante) {
      const mayor = [...a.por_tienda].sort((x, y) => y.peso - x.peso)[0];
      avisar("tienda_dominante", `${a.anio}: la tienda ${nombreTienda(mayor.tienda_id)} pesa ${porcentaje(a.peso_tienda_mayor)} de la agrupación.`);
    }
    for (const t of a.por_tienda.filter((x) => x.distinta)) {
      avisar("tienda_distinta", `${a.anio}: tienda ${nombreTienda(t.tienda_id)}, ${formatearPuntos(t.eat_vs_red ?? 0)} pp, peso ${porcentaje(t.peso)}.`);
    }
  }
  const sinRed = prep.anios.filter((a) => a.sinRed);
  if (sinRed.length > 0) avisar("sin_red_comparable", `Sin red comparable en ${sinRed.map((a) => a.anio).join(", ")}.`);
  if (origen === "prestada") {
    avisar(
      "prestada",
      recomendacion.motivo === "prestada"
        ? "Sin años suficientes: se propone la curva de su temporada."
        : "La curva de su temporada se equivoca menos que las propias en el backtesting: se propone la curva de su temporada."
    );
  }

  const resultado: AgrupacionResultado = {
    agrupacion_id: entrada.agrupacion_id,
    temporada: entrada.temporada,
    temporada_sugerida: entrada.temporada_sugerida,
    origen,
    composicion: entrada.composicion,
    efecto_atipico: efecto,
    anios,
    candidatas,
    recomendada: recomendacion.recomendada,
    motivo_recomendacion: recomendacion.motivo,
    margen: recomendacion.margen,
    comparacion: fraseComparativa(recomendacion, candidatas, prep.ruido, p.margen_ruido),
    ruido_normal: prep.ruido,
    ruido_normal_detalle: prep.ruidoDetalle,
    estabilidad: estab,
    nivel_estabilidad: nivelEstabilidad(estab),
    banda: bandaMes,
    cv_mensual: cvMensualTodo,
    avisos,
  };
  return { resultado, grupo: { porTienda, prep }, veredicto };
}

// ─── Corrida completa ───

function aTemporadaAnio(a: AnioAgrupacion): TemporadaAnio {
  const { por_tienda: _porTienda, participacion_real: _real, liquidacion: _liq, ...resto } = a;
  void _porTienda;
  void _real;
  void _liq;
  return resto;
}

/** Redondea todos los números de un JSON a `decimales` (las curvas ya vienen a 6 y no cambian). */
export function redondearJson<T>(valor: T, decimales = 6): T {
  if (typeof valor === "number") return (Number.isFinite(valor) ? redondear(valor, decimales) : valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => redondearJson(v, decimales)) as T;
  if (valor && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = redondearJson(v, decimales);
    return salida as T;
  }
  return valor;
}

/**
 * Regla 19. Calcula una corrida entera a partir de la entrada ya armada
 * (series por agrupación sobre la red comparable de cada año): clasificación,
 * efecto atípico, candidatas con backtesting, recomendación, curva `T` por
 * temporada, diagnóstico por tienda, banda y avisos. Determinista; el año en
 * curso nunca entra en el ajuste.
 */
export function calcularCorrida(entrada: EntradaCorrida, parametros: ParametrosCurvas): SalidaCorrida {
  const anios = [...new Set(entrada.redes.map((r) => r.anio))].sort((a, b) => a - b);
  const ctx: Contexto = {
    anios,
    publicados: entrada.meses_publicados,
    hasta: entrada.hasta_periodo,
    redes: new Map(entrada.redes.map((r) => [r.anio, r])),
    parametros,
    tiendas: new Map(entrada.tiendas.map((t) => [t.id, t])),
  };

  // Temporadas (T) primero: las agrupaciones prestan su curva. Con series agregadas (06b) se recorren las
  // temporadas presentes en ellas, también las que no tienen ninguna agrupación en esta entrada (el control del Niño).
  const grupos = new Map<TemporadaAgrupacion, GrupoTemporada>();
  for (const t of TEMPORADAS_AGRUPACION) {
    const miembros = entrada.agrupaciones.filter((a) => a.temporada === t);
    if (entrada.series_temporada) {
      const agregada = entrada.series_temporada.find((x) => x.temporada === t);
      if (agregada) grupos.set(t, armarGrupoTemporada(t, miembros, ctx, agregada));
    } else if (miembros.length > 0) {
      grupos.set(t, armarGrupoTemporada(t, miembros, ctx));
    }
  }

  const analisis = entrada.agrupaciones.map((a) => analizarAgrupacion(a, grupos.get(a.temporada), ctx));
  const agrupaciones = analisis.map((a) => a.resultado);

  // Resultado por temporada.
  const temporadas: TemporadaResultado[] = [];
  for (const [temporada, g] of grupos) {
    const anioDeTemporada = g.prep.anios.map((a) => {
      const base = construirAnio(a, g.porTienda, ctx, g.prep.ruido, []).anio;
      return aTemporadaAnio(base);
    });
    temporadas.push({
      temporada,
      agrupaciones: g.nAgrupaciones,
      anios: anioDeTemporada,
      curva_T: g.curva_T,
      anios_ajuste: g.anios_ajuste.map((a) => a.anio),
    });
  }

  // Efecto a nivel de corrida (por temporada, control, relativo y crecimiento normal).
  const gruposEfecto: GrupoParaEfecto[] = [];
  for (const [temporada, g] of grupos) {
    gruposEfecto.push({
      temporada,
      agrupaciones: g.nAgrupaciones,
      anios: g.prep.anios.map((a) => ({
        ...seriePara(a, g.porTienda),
        clase: a.clase,
        meses_atipicos: a.atipicos.length,
      })),
    });
  }
  if (grupos.size > 0) {
    const todas = [...grupos.values()];
    gruposEfecto.push({
      temporada: "red",
      agrupaciones: sumar(todas.map((g) => g.nAgrupaciones)),
      anios: anios.map((anio) => {
        const delAnio = todas.map((g) => g.prep.anios.find((a) => a.anio === anio) as AnioPreparado);
        const porTienda = sumarPorTienda(todas.map((g) => g.porTienda.get(anio) ?? new Map<string, number[]>()));
        const serie = sumarSeriesAnio(delAnio.map((a) => a.serie));
        const clases = delAnio.map((a) => a.clase);
        const clase: ClaseAnioCurva = clases.includes("en_curso")
          ? "en_curso"
          : clases.includes("incompleto")
            ? "incompleto"
            : clases.every((c) => c === "normal")
              ? "normal"
              : "con_huecos";
        return {
          anio,
          unidades: serie.meses,
          publicados: serie.publicados,
          por_tienda: porTienda,
          clase,
          meses_atipicos: Math.max(0, ...delAnio.map((a) => a.atipicos.length)),
        };
      }),
    });
  }

  const avisosCorrida: AvisoCurva[] = [];
  for (const [temporada, g] of grupos) {
    const normales = g.prep.anios.filter((a) => a.clase === "normal");
    if (g.prep.anios.some((a) => a.utilizable) && pocosAniosNormales(g.prep.anios)) {
      avisosCorrida.push({
        codigo: "pocos_anos_normales",
        detalle: `${temporada}: ${unidad(normales.length, "año normal", "años normales")}${normales.length ? ` (${normales.map((a) => a.anio).join(", ")})` : ""}.`,
      });
    }
    for (const a of g.prep.anios.filter((x) => x.clase === "atipico_completo")) {
      avisosCorrida.push({ codigo: "ano_atipico_completo", detalle: `${temporada} ${a.anio}: ${unidad(a.atipicos.length, "mes atípico", "meses atípicos")}.` });
    }
  }

  const forma = resumirFormaPorTemporada(
    analisis.map((a) => ({
      temporada: a.resultado.temporada,
      veredicto: a.veredicto,
      ruido_normal: a.resultado.efecto_atipico.forma?.ruido_normal ?? null,
    }))
  );
  const efecto = efectoAtipicoCorrida(gruposEfecto, entrada.redes, { umbral_forma: parametros.umbral_forma, margen_ruido: parametros.margen_ruido }, { forma, avisos: avisosCorrida });
  for (const fila of efecto.por_temporada) {
    if (fila.ratio_volumen === null) {
      avisosCorrida.push({ codigo: "sin_referencia_volumen", detalle: `${fila.temporada} ${fila.anio}: sin tiendas comunes o sin año normal de referencia.` });
    }
  }

  const aniosPorClase: Record<ClaseAnioCurva, number> = { normal: 0, con_huecos: 0, atipico_completo: 0, incompleto: 0, en_curso: 0 };
  for (const a of agrupaciones) for (const x of a.anios) aniosPorClase[x.clase] += 1;

  const resultado: ResultadoCorrida = { agrupaciones, temporadas };
  return {
    resultado: redondearJson(resultado),
    efecto_atipico: redondearJson(efecto),
    resumen: {
      agrupaciones_activas: agrupaciones.length,
      propias: agrupaciones.filter((a) => a.origen === "propia").length,
      prestadas: agrupaciones.filter((a) => a.origen === "prestada").length,
      sin_venta: entrada.agrupaciones.filter((a) => a.sin_venta).length,
      con_avisos: agrupaciones.filter((a) => a.avisos.length > 0).length,
      anios_por_clase: aniosPorClase,
    },
  };
}
