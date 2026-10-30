import { VERSION_METODO_MIN_M8 } from "@/lib/proyeccion/tipos-api";
import { CARACTER_SENAL, CARACTER_SENAL_K, ORDEN_SENAL } from "@/lib/flujo/tipos-api";
import type {
  AvisoConciliacion,
  CatalogoFlujoApi,
  CatalogoHuecosApi,
  ConciliacionApi,
  ConciliacionFilaApi,
  DatosFlujoApi,
  FilaFlujoDetalleApi,
  FilaFlujoListaApi,
  FlujoApi,
  HuecosApi,
  MesFlujoApi,
  ParametrosFlujoApi,
  RepartoFlujoApi,
  ReglaFlujoApi,
  ResumenFilaApi,
  Senal,
  SerieFlujoApi,
  SubflujoApi,
  TarjetaHuecoApi,
} from "@/lib/flujo/tipos-api";
import { IMI_MAX, IMI_MIN, UMBRAL_CONCILIACION_PCT, UMBRAL_CONCILIACION_U } from "@/lib/flujo/tipos";
import { TEMPORADAS_DEFECTO } from "@/lib/marcas-barrer/tipos-api";
import {
  AGR_M8,
  COMPRA,
  EQ,
  K_PRIMA,
  MARCA_M8,
  NODO_M8,
  PERFIL,
  REPARTO_BETA_V2,
  RUTA,
  compraApiC12,
  compraApiC09Vencida,
} from "./compras.fixture";

/**
 * Casos sintéticos del flujo de M8 (ficha 08, sección 9; casos 1, 8, 9b, 19, 25 y 27) y generador de listas grandes para la regla 32
 * (tamaño). Todo inventado. `calcularSerieReferencia` es la aritmética de la sección 3 escrita de la forma más directa posible: sirve
 * para que los fixtures sean coherentes y como cifras de referencia para T2a (que no la importa: implementa `proyectarFila`).
 *
 * Los números del ejemplo de la ficha mezclan escalas (una demanda de 150 u por mes frente a una venta real de 1 410 u en set);
 * se conservan tal cual porque las reglas 4b, 5 y 6 se prueban con ellos.
 */

// ─── Meses ───

export function sumarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const indice = a * 12 + (m - 1) + n;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** `[k', k'+1 … k'+horizonte]`. */
export const periodosDe = (kPrima: string, horizonte: number): string[] => Array.from({ length: horizonte + 1 }, (_, i) => sumarMes(kPrima, i));

// ─── Aritmética de referencia (sección 3) ───

export type EntradaSerie = {
  stock_k: number;
  /** Demanda de `k'+1 … H`. */
  demanda: readonly number[];
  ingresos?: readonly number[];
  /** Reposición directa esperada `R^B_m` (solo subflujos). */
  reposicion?: readonly number[];
  imi_min?: number;
  imi_max?: number;
};

export type SerieReferencia = {
  stock_k: number;
  /** VPM de `k'`: la demanda de `k'+1 … k'+12`. */
  vpm_k: number | null;
  imi_k: number | null;
  demanda: number[];
  ingresos: number[];
  reposicion: number[];
  stock: number[];
  vpm: number[];
  imi: (number | null)[];
  objetivo_min: number[];
  tope: number[];
  saldo: number[];
  exceso: number[];
  senal: Senal[];
  fuera_de_rango: boolean[];
  extendido: boolean[];
};

export function calcularSerieReferencia(e: EntradaSerie): SerieReferencia {
  const min = e.imi_min ?? IMI_MIN;
  const max = e.imi_max ?? IMI_MAX;
  const n = e.demanda.length;
  const ext: number[] = [...e.demanda];
  for (let j = n; j < n + 12; j++) ext.push(n >= 12 ? ext[j - 12] : e.demanda[j % n]);
  const vpmEn = (i: number) => ext.slice(i + 1, i + 13).reduce((a, b) => a + b, 0) / 12;
  const sinDemanda = e.demanda.every((d) => d === 0);

  const s: SerieReferencia = {
    stock_k: e.stock_k,
    vpm_k: n === 0 ? null : vpmEn(-1),
    imi_k: null,
    demanda: [...e.demanda],
    ingresos: [],
    reposicion: [],
    stock: [],
    vpm: [],
    imi: [],
    objetivo_min: [],
    tope: [],
    saldo: [],
    exceso: [],
    senal: [],
    fuera_de_rango: [],
    extendido: [],
  };
  const imiDe = (stock: number, vpm: number) => (vpm <= 0 ? null : stock <= 0 ? 0 : stock / vpm);
  s.imi_k = s.vpm_k === null ? null : imiDe(e.stock_k, s.vpm_k);

  let stock = e.stock_k;
  let conCompras = e.stock_k;
  for (let i = 0; i < n; i++) {
    const ing = e.ingresos?.[i] ?? 0;
    const rep = e.reposicion?.[i] ?? 0;
    const vpm = vpmEn(i);
    const objetivo = min * vpm;
    const tope = max * vpm;
    stock = stock + ing + rep - e.demanda[i];
    const sinSugerir = conCompras + ing + rep - e.demanda[i];
    const saldo = vpm > 0 ? Math.max(0, objetivo - sinSugerir) : 0;
    conCompras = sinSugerir + saldo;
    const exceso = Math.max(0, stock - tope);
    const imi = imiDe(stock, vpm);
    s.ingresos.push(ing);
    s.reposicion.push(rep);
    s.stock.push(stock);
    s.vpm.push(vpm);
    s.imi.push(imi);
    s.objetivo_min.push(objetivo);
    s.tope.push(tope);
    s.saldo.push(saldo);
    s.exceso.push(exceso);
    s.senal.push(sinDemanda ? "sin_demanda" : stock < 0 ? "quiebre" : saldo > 0 ? "falta" : exceso > 0 ? "exceso" : "al_dia");
    s.fuera_de_rango.push(imi !== null && (imi < min || imi > max));
    s.extendido.push(i + 12 > n - 1);
  }
  return s;
}

// ─── Redondeo al serializar (§0.15) ───

const u = (x: number) => Math.round(x) || 0;
const r1 = (x: number) => Math.round(x * 10) / 10 || 0;

function peorSenal(senales: readonly Senal[]): Senal {
  return senales.reduce<Senal>((peor, s) => (ORDEN_SENAL[s] < ORDEN_SENAL[peor] ? s : peor), "sin_curva");
}

/** Serie de la lista: `[k', k'+1 … H]`, unidades enteras, IMI con un decimal y las señales como cadenas de un carácter. */
function serieDeLista(
  r: SerieReferencia,
  k: { venta_real: number; ingreso_inferido: number; senal_k?: string },
  sinCurva: boolean,
  conReposicion: boolean,
): SerieFlujoApi {
  const senales = sinCurva ? r.senal.map<Senal>(() => "sin_curva") : r.senal;
  return {
    demanda: [u(k.venta_real), ...r.demanda.map(u)],
    ingresos: [u(k.ingreso_inferido), ...r.ingresos.map(u)],
    reposicion: conReposicion ? [0, ...r.reposicion.map(u)] : null,
    stock: [u(r.stock_k), ...r.stock.map(u)],
    imi: [r.imi_k === null ? null : r1(r.imi_k), ...r.imi.map((x) => (x === null || sinCurva ? null : r1(x)))],
    saldo: [0, ...r.saldo.map(u)],
    exceso: [0, ...r.exceso.map(u)],
    senal: CARACTER_SENAL_K + senales.map((s) => CARACTER_SENAL[s]).join(""),
    fuera_de_rango: (r.imi_k !== null && (r.imi_k < IMI_MIN || r.imi_k > IMI_MAX) ? "1" : "0") + r.fuera_de_rango.map((x) => (x ? "1" : "0")).join(""),
  };
}

function resumenDeFila(r: SerieReferencia, periodos: readonly string[], opciones: { sinCurva: boolean; vpm_real_k: number | null; meses_tarjeta: number; por_confirmar?: number; doble?: number }): ResumenFilaApi {
  const horizonte = periodos.slice(1);
  const n = Math.min(opciones.meses_tarjeta, r.saldo.length);
  const primero = (pred: (i: number) => boolean) => {
    const i = r.saldo.findIndex((_, j) => pred(j));
    return i < 0 ? null : horizonte[i];
  };
  return {
    senal: opciones.sinCurva ? "sin_curva" : peorSenal(r.senal.slice(0, n).concat(r.senal.length === 0 ? ["sin_demanda"] : [])),
    imi_k: r.imi_k === null || opciones.sinCurva ? null : r1(r.imi_k),
    vpm_k: r.vpm_k === null || opciones.sinCurva ? null : r1(r.vpm_k),
    vpm_real_k: opciones.vpm_real_k === null ? null : r1(opciones.vpm_real_k),
    saldo_n_meses: u(r.saldo.slice(0, n).reduce((a, b) => a + b, 0)),
    en_camino: u(r.ingresos.reduce((a, b) => a + b, 0)),
    primer_mes_falta: primero((i) => r.saldo[i] > 0),
    exceso_desde: primero((i) => r.exceso[i] > 0),
    primer_mes_fuera_de_rango: primero((i) => r.fuera_de_rango[i]),
    por_confirmar: opciones.por_confirmar ?? 0,
    posible_doble_conteo: opciones.doble ?? 0,
  };
}

// ─── Parámetros, repartos y reglas ───

export const parametrosEjemplo = (): ParametrosFlujoApi => ({
  imi_min: IMI_MIN,
  imi_max: IMI_MAX,
  meses_tarjeta: 6,
  extender_horizonte: true,
  temporadas: TEMPORADAS_DEFECTO,
  umbral_conciliacion_u: UMBRAL_CONCILIACION_U,
  umbral_conciliacion_pct: UMBRAL_CONCILIACION_PCT,
  usuario_nombre: "Planner Uno",
  updated_at: "2026-10-01T09:00:00.000Z",
});

/** BETA, reparto v2 por temporada (verano: DENIM 0,59 · POLO 0,293 · SANDALIA 0,117; invierno: distinto), error 8 pp. */
export const repartosVigentesEjemplo = (): RepartoFlujoApi[] => [
  {
    marca_id: MARCA_M8.beta,
    marca: "BETA",
    reparto_id: REPARTO_BETA_V2,
    version: 2,
    modo: "por_temporada",
    alcance: { generos: [], mundos: [], lineas: [] },
    error_reparto_pp: 8,
    temporadas_usadas: TEMPORADAS_DEFECTO,
    filas: [
      { gml_id: NODO_M8.urbano, equivalencia_id: null, temporada: "verano", participacion: 0.59 },
      { gml_id: NODO_M8.polo, equivalencia_id: null, temporada: "verano", participacion: 0.293 },
      { gml_id: NODO_M8.sandalia, equivalencia_id: null, temporada: "verano", participacion: 0.117 },
      { gml_id: NODO_M8.urbano, equivalencia_id: null, temporada: "invierno", participacion: 0.45 },
      { gml_id: NODO_M8.polo, equivalencia_id: null, temporada: "invierno", participacion: 0.5 },
      { gml_id: NODO_M8.sandalia, equivalencia_id: null, temporada: "invierno", participacion: 0.05 },
    ],
  },
];

/** Regla de JH en CAMISA (caso 8): rango por defecto 4–8 y 80 % directo desde 2026-01. */
export const reglasIntercompanyEjemplo = (): ReglaFlujoApi[] => [
  { id: "10000000-0000-4000-8000-000000000001", marca_id: MARCA_M8.jh, marca: "JOHN HOLDEN", gml_id: NODO_M8.camisa, equivalencia_id: null, vigente_desde: "2026-01", hasta_derivado: null, imi_min: 4, imi_max: 8, pct_directo: 80 },
];

// ─── Filas de la ficha (casos 1 y 8) ───

/** Demanda de DENIM × RECONOCIDO de oct-2026 a dic-2027 (caso 1): 150 × 3, 160 × 11 y 183. */
export const DEMANDA_DENIM = [150, 150, 150, ...Array.from({ length: 11 }, () => 160), 183];
export const VENTAS_DENIM_12M = [1500, 1450, 1520, 1480, 1390, 1460, 1510, 1550, 1600, 1580, 1410, 1410];
const ING_DENIM_12M = [260, 240, 250, 270, 230, 260, 290, 300, 310, 280, 120, 120];

function historiaDe(kPrima: string, ventas: readonly number[], ingresos: readonly number[], stockK: number) {
  const n = ventas.length;
  const stocks = new Array<number>(n);
  stocks[n - 1] = stockK;
  for (let i = n - 1; i > 0; i--) stocks[i - 1] = stocks[i] - ingresos[i] + ventas[i];
  return ventas.map((venta, i) => ({ periodo: sumarMes(kPrima, i - (n - 1)), venta, stock_fin: stocks[i], ingreso_inferido: ingresos[i] }));
}

function mesesDe(r: SerieReferencia, periodos: readonly string[], k: { venta_real: number; ingreso_inferido: number; recepciones: number }, minMax: [number, number], sinCurva = false): MesFlujoApi[] {
  const [min, max] = minMax;
  const mesK: MesFlujoApi = {
    periodo: periodos[0],
    real: true,
    demanda: k.venta_real,
    ingresos: k.ingreso_inferido,
    ingreso_inferido: k.ingreso_inferido,
    salida_inferida: 0,
    recepciones_registradas: k.recepciones,
    stock_fin: u(r.stock_k),
    vpm: r.vpm_k === null ? null : r1(r.vpm_k),
    imi: r.imi_k === null ? null : r1(r.imi_k),
    objetivo_min: u(min * (r.vpm_k ?? 0)),
    tope: u(max * (r.vpm_k ?? 0)),
    saldo: 0,
    exceso: 0,
    senal: "al_dia",
    fuera_de_rango: r.imi_k !== null && (r.imi_k < min || r.imi_k > max),
    extendido: false,
  };
  return [
    mesK,
    ...r.demanda.map<MesFlujoApi>((d, i) => ({
      periodo: periodos[i + 1],
      real: false,
      demanda: u(d),
      ingresos: u(r.ingresos[i]),
      ingreso_inferido: null,
      salida_inferida: null,
      recepciones_registradas: null,
      stock_fin: u(r.stock[i]),
      vpm: sinCurva ? null : r1(r.vpm[i]),
      imi: sinCurva || r.imi[i] === null ? null : r1(r.imi[i] as number),
      objetivo_min: u(r.objetivo_min[i]),
      tope: u(r.tope[i]),
      saldo: u(r.saldo[i]),
      exceso: u(r.exceso[i]),
      senal: sinCurva ? "sin_curva" : r.senal[i],
      fuera_de_rango: r.fuera_de_rango[i],
      extendido: r.extendido[i],
    })),
  ];
}

/** Una fila conciliada: `Ing = S_m − S_{m−1} + V_m`, `sin_registrar` y `sin_respaldo` con los umbrales por defecto (§4.3b). */
export function conciliarFilaReferencia(p: {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  ruta: string;
  agrupacion_marca: string;
  periodo: string;
  venta: number;
  stock_inicio: number | null;
  stock_fin: number;
  recepciones: number;
  entregas_programadas?: number;
  marca?: { id: string; nombre: string; pct_regla: number; venta: number } | null;
  mia?: boolean;
}): ConciliacionFilaApi {
  const ing = p.stock_inicio === null ? null : p.stock_fin - p.stock_inicio + p.venta;
  const ingreso = ing === null ? null : Math.max(0, ing);
  const salida = ing === null ? null : Math.max(0, -ing);
  const sinRegistrar = ingreso === null ? 0 : Math.max(0, ingreso - p.recepciones);
  const sinRespaldo = ingreso === null ? 0 : Math.max(0, p.recepciones - ingreso);
  const umbral = Math.max(UMBRAL_CONCILIACION_U, ((ingreso ?? 0) * UMBRAL_CONCILIACION_PCT) / 100);
  // La ficha dice que `recepcion_sin_respaldo` usa «el mismo umbral», pero su ejemplo (950 recibidas e Ing = 850 → aviso con 100 u de
  // diferencia) solo se cumple con el umbral absoluto: aquí se sigue el ejemplo (regla 4b, caso 9b). T2a lo confirma con el arquitecto.
  const avisos: AvisoConciliacion[] = [];
  if (ing === null) avisos.push("sin_mes_anterior");
  if (ing !== null && ing < 0) avisos.push("salida_neta");
  if (sinRegistrar >= umbral && sinRegistrar > 0) avisos.push("ingreso_sin_registrar");
  if (sinRespaldo >= UMBRAL_CONCILIACION_U && sinRespaldo > 0) avisos.push("recepcion_sin_respaldo");
  return {
    gml_id: p.gml_id,
    equivalencia_id: p.equivalencia_id,
    agrupacion_marca_id: p.agrupacion_marca_id,
    ruta: p.ruta,
    agrupacion_marca: p.agrupacion_marca,
    marca_id: p.marca?.id ?? null,
    marca: p.marca?.nombre ?? null,
    periodo: p.periodo,
    venta: p.venta,
    stock_inicio: p.stock_inicio,
    stock_fin: p.stock_fin,
    ingreso_inferido: ingreso,
    salida_inferida: salida,
    recepciones_registradas: p.recepciones,
    entregas_programadas: p.entregas_programadas ?? 0,
    sin_registrar: sinRegistrar,
    sin_respaldo: sinRespaldo,
    avisos,
    sugerencias: [],
    pct_directo_observado: p.marca && p.marca.venta > 0 ? { periodo: p.periodo, valor: Math.round((Math.max(0, (ingreso ?? 0) - p.recepciones) / p.marca.venta) * 10000) / 100 } : null,
    pct_directo_regla: p.marca?.pct_regla ?? null,
    mia: p.mia ?? false,
  };
}

const HIST_MESES = 12;

/** DENIM × RECONOCIDO (caso 1) con la compra C-000012 de 500 u en nov (caso 2): `S_oct = 550`, `C_oct = 83,33`, `C_feb = 134,33`. */
export function filaDenimEjemplo(op: { ingresos?: readonly number[] } = {}): FilaFlujoDetalleApi {
  const periodos = periodosDe(K_PRIMA, DEMANDA_DENIM.length);
  const ingresos = op.ingresos ?? DEMANDA_DENIM.map((_, i) => (i === 1 ? 500 : 0));
  const r = calcularSerieReferencia({ stock_k: 700, demanda: DEMANDA_DENIM, ingresos });
  const historia = historiaDe(K_PRIMA, VENTAS_DENIM_12M, ING_DENIM_12M, 700);
  const conciliacion = historia.map((h, i) =>
    conciliarFilaReferencia({
      gml_id: NODO_M8.urbano,
      equivalencia_id: null,
      agrupacion_marca_id: AGR_M8.reconocido,
      ruta: RUTA.denim,
      agrupacion_marca: "RECONOCIDO",
      periodo: h.periodo,
      venta: h.venta,
      stock_inicio: i === 0 ? null : historia[i - 1].stock_fin,
      stock_fin: h.stock_fin,
      recepciones: i === HIST_MESES - 1 ? 0 : Math.max(0, h.ingreso_inferido - (i % 3 === 0 ? 10 : 0)),
      mia: true,
    }),
  );
  const c12 = compraApiC12().lineas[0];
  return {
    gml_id: NODO_M8.urbano,
    equivalencia_id: null,
    agrupacion_marca_id: AGR_M8.reconocido,
    genero: "HOMBRE",
    mundo: "URBANO",
    linea: "DENIM",
    equivalencia: null,
    agrupacion_marca: "RECONOCIDO",
    nivel: "GML",
    responsable: { perfil_id: PERFIL.comprador1, nombre: "Comprador Uno" },
    mia: true,
    stock_k: { cd: 300, tiendas: 400, total: 700 },
    meses: mesesDe(r, periodos, { venta_real: 1410, ingreso_inferido: 120, recepciones: 0 }, [IMI_MIN, IMI_MAX]),
    subflujos_resumen: [],
    resumen: resumenDeFila(r, periodos, { sinCurva: false, vpm_real_k: VENTAS_DENIM_12M.reduce((a, b) => a + b, 0) / 12, meses_tarjeta: 6 }),
    avisos: [],
    historia,
    al_barrer: [],
    subflujos: [],
    resto: null,
    conciliacion,
    entregas: [
      {
        compra_id: COMPRA.c12,
        numero: "C-000012",
        proveedor: "Proveedor Norte",
        linea_id: c12.id,
        entrega_id: c12.entregas[0].id,
        tipo: "especifica",
        marca: "ALFA",
        agrupacion_marca: "RECONOCIDO",
        tallas: "centrales",
        unidades: 500,
        pendiente: 500,
        periodo: "2026-11",
        vencida: false,
        estado: "confirmada",
      },
    ],
  };
}

/**
 * CAMISA › MANGA LARGA × RECONOCIDO con el subflujo de JH (casos 8 y 25): `D = 1 200`, JH `part = 0,40` y 80 % directo, stock 2 300
 * (JH 900). JH: `R = 384`, `S_oct = 804`, `imi = 1,675`, `C = 1 116`; resto: `D = 720`, `S = 680`. La fila es la suma (§0.9): su stock baja 816
 * por mes, no 1 200.
 */
export function filaCamisaJhEjemplo(): FilaFlujoDetalleApi {
  const n = DEMANDA_DENIM.length;
  const periodos = periodosDe(K_PRIMA, n);
  const plana = (v: number) => Array.from({ length: n }, () => v);
  const jh = calcularSerieReferencia({ stock_k: 900, demanda: plana(480), reposicion: plana(384) });
  const resto = calcularSerieReferencia({ stock_k: 1400, demanda: plana(720) });
  const total = calcularSerieReferencia({ stock_k: 2300, demanda: plana(1200), reposicion: plana(384) });
  // La fila es la suma de componentes: stock, saldo y exceso salen de ellos, el VPM de la demanda completa.
  const fila: SerieReferencia = {
    ...total,
    stock: total.stock.map((_, i) => resto.stock[i] + jh.stock[i]),
    saldo: total.saldo.map((_, i) => resto.saldo[i] + jh.saldo[i]),
    exceso: total.exceso.map((_, i) => resto.exceso[i] + jh.exceso[i]),
  };
  fila.imi = fila.stock.map((s, i) => (total.vpm[i] <= 0 ? null : s <= 0 ? 0 : s / total.vpm[i]));
  fila.senal = fila.stock.map((s, i) => (s < 0 ? "quiebre" : fila.saldo[i] > 0 ? "falta" : fila.exceso[i] > 0 ? "exceso" : "al_dia"));
  fila.fuera_de_rango = fila.senal.map((_, i) => resto.fuera_de_rango[i] || jh.fuera_de_rango[i]);

  const ventas = Array.from({ length: HIST_MESES }, () => 1200);
  const ingresosHist = [300, 280, 320, 290, 310, 300, 330, 350, 340, 330, 320, 384];
  const historia = historiaDe(K_PRIMA, ventas, ingresosHist, 2300);
  const jhMeses = mesesDe(jh, periodos, { venta_real: 480, ingreso_inferido: 384, recepciones: 0 }, [4, 8]).map((m, i) => ({
    ...m,
    reposicion_esperada: i === 0 ? 0 : 384,
  }));
  const subflujo: SubflujoApi = {
    marca_id: MARCA_M8.jh,
    marca: "JOHN HOLDEN",
    regla_id: reglasIntercompanyEjemplo()[0].id,
    imi_min: 4,
    imi_max: 8,
    pct_directo: 80,
    pct_directo_observado: { periodo: K_PRIMA, valor: 80 },
    pct_directo_observado_12m: { desde: sumarMes(K_PRIMA, -11), hasta: K_PRIMA, valor: 52 },
    part: 0.4,
    stock_k: 900,
    meses: jhMeses,
    resumen: { senal: "falta", imi_k: r1(jh.imi_k ?? 0), saldo_n_meses: u(jh.saldo.slice(0, 6).reduce((a, b) => a + b, 0)) },
  };
  const conciliacion = [
    conciliarFilaReferencia({
      gml_id: NODO_M8.camisa,
      equivalencia_id: EQ.larga,
      agrupacion_marca_id: AGR_M8.reconocido,
      ruta: RUTA.camisaLarga,
      agrupacion_marca: "RECONOCIDO",
      periodo: K_PRIMA,
      venta: 1200,
      stock_inicio: 3116,
      stock_fin: 2300,
      recepciones: 0,
    }),
    conciliarFilaReferencia({
      gml_id: NODO_M8.camisa,
      equivalencia_id: EQ.larga,
      agrupacion_marca_id: AGR_M8.reconocido,
      ruta: RUTA.camisaLarga,
      agrupacion_marca: "RECONOCIDO",
      periodo: K_PRIMA,
      venta: 480,
      stock_inicio: 996,
      stock_fin: 900,
      recepciones: 0,
      marca: { id: MARCA_M8.jh, nombre: "JOHN HOLDEN", pct_regla: 80, venta: 480 },
    }),
  ];
  return {
    gml_id: NODO_M8.camisa,
    equivalencia_id: EQ.larga,
    agrupacion_marca_id: AGR_M8.reconocido,
    genero: "HOMBRE",
    mundo: "FORMAL",
    linea: "CAMISA",
    equivalencia: "MANGA LARGA",
    agrupacion_marca: "RECONOCIDO",
    nivel: "GMLE",
    responsable: { perfil_id: PERFIL.comprador2, nombre: "Comprador Dos" },
    mia: false,
    stock_k: { cd: 1400, tiendas: 900, total: 2300 },
    meses: mesesDe(fila, periodos, { venta_real: 1200, ingreso_inferido: 384, recepciones: 950 }, [4, 8]),
    subflujos_resumen: [{ marca: "JOHN HOLDEN", senal: "falta", imi_k: r1(jh.imi_k ?? 0), rango: [4, 8] }],
    resumen: resumenDeFila(fila, periodos, { sinCurva: false, vpm_real_k: 1200, meses_tarjeta: 6 }),
    avisos: [],
    historia,
    al_barrer: [],
    subflujos: [subflujo],
    resto: { meses: mesesDe(resto, periodos, { venta_real: 720, ingreso_inferido: 0, recepciones: 0 }, [4, 8]) },
    conciliacion,
    entregas: [],
  };
}

/** Una fila POLO × PREMIUM con la entrega de set de C-000009 vencida (caso 9b y 24): `posible_doble_conteo` y la sugerencia de 500 u en set. */
export function conciliacionEjemplo(): ConciliacionApi {
  const c09 = compraApiC09Vencida().lineas[0];
  const denim = conciliarFilaReferencia({ gml_id: NODO_M8.urbano, equivalencia_id: null, agrupacion_marca_id: AGR_M8.reconocido, ruta: RUTA.denim, agrupacion_marca: "RECONOCIDO", periodo: K_PRIMA, venta: 1410, stock_inicio: 1990, stock_fin: 700, recepciones: 0, mia: true });
  const polo = conciliarFilaReferencia({ gml_id: NODO_M8.polo, equivalencia_id: null, agrupacion_marca_id: AGR_M8.premium, ruta: RUTA.polo, agrupacion_marca: "PREMIUM", periodo: K_PRIMA, venta: 820, stock_inicio: 960, stock_fin: 940, recepciones: 300, entregas_programadas: 500 });
  polo.sugerencias = [
    { tipo: "vencida", linea_id: c09.id, compra_id: COMPRA.c09, compra_numero: "C-000009", entrega_id: c09.entregas[0].id, periodo_entrega: "2026-09", unidades: 500, boton: true },
  ];
  const camisa = conciliarFilaReferencia({ gml_id: NODO_M8.camisa, equivalencia_id: EQ.larga, agrupacion_marca_id: AGR_M8.reconocido, ruta: RUTA.camisaLarga, agrupacion_marca: "RECONOCIDO", periodo: K_PRIMA, venta: 1200, stock_inicio: 2300, stock_fin: 1950, recepciones: 950 });
  const jh = conciliarFilaReferencia({ gml_id: NODO_M8.camisa, equivalencia_id: EQ.larga, agrupacion_marca_id: AGR_M8.reconocido, ruta: RUTA.camisaLarga, agrupacion_marca: "RECONOCIDO", periodo: K_PRIMA, venta: 480, stock_inicio: 900, stock_fin: 804, recepciones: 0, marca: { id: MARCA_M8.jh, nombre: "JOHN HOLDEN", pct_regla: 80, venta: 480 } });
  const filas = [denim, polo, camisa, jh];
  const suma = (f: (x: ConciliacionFilaApi) => number) => filas.filter((x) => x.marca_id === null).reduce((a, x) => a + f(x), 0);
  return {
    periodo: K_PRIMA,
    mes_anterior_publicado: true,
    filas,
    totales: {
      venta: suma((x) => x.venta),
      ingreso_inferido: suma((x) => x.ingreso_inferido ?? 0),
      salida_inferida: suma((x) => x.salida_inferida ?? 0),
      recepciones_registradas: suma((x) => x.recepciones_registradas),
      entregas_programadas: suma((x) => x.entregas_programadas),
      sin_registrar: suma((x) => x.sin_registrar),
      sin_respaldo: suma((x) => x.sin_respaldo),
    },
    avisos: [
      { aviso: "sin_mes_anterior", filas: 2, unidades: null },
      { aviso: "salida_neta", filas: 1, unidades: -40 },
    ],
  };
}

// ─── Generador de listas grandes (regla 32) ───

function aleatorio(semilla: number) {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
}

const idDe = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export type OpcionesFlujo = {
  filas: number;
  /** Meses del horizonte (`k'+1 … H`): 15 es el típico, 24 el máximo. */
  horizonte: number;
  kPrima?: string;
  semilla?: number;
};

const GENEROS = ["HOMBRE", "MUJER", "NIÑO"];
const MUNDOS = ["URBANO", "CASUAL", "FORMAL", "RI", "DEPORTE", "ACCESORIOS"];
const AGRUPACIONES = ["RECONOCIDO", "PREMIUM", "VALOR", "JUVENIL", "BASICO", "OUTLET", "IMPORTADO", "LICENCIA", "OTRAS"];
const TOTAL_NODOS = 170;

/**
 * Una lista de `FlujoApi` con `filas` filas distintas (nodo × equivalencia × agrupación), series calculadas con
 * `calcularSerieReferencia` y redondeadas como al serializar. Con `filas ≥ 2`, `k' = 2026-09` y 15 meses de horizonte, las dos
 * primeras son las de la ficha (DENIM y CAMISA con JH).
 */
export function construirFlujo(op: OpcionesFlujo): FlujoApi {
  const kPrima = op.kPrima ?? K_PRIMA;
  const periodos = periodosDe(kPrima, op.horizonte);
  const azar = aleatorio(op.semilla ?? 7);

  // Catálogo: 170 nodos, uno de cada seis se abre en dos equivalencias; hay de sobra para 1 600 filas distintas.
  const nodos: FlujoApi["catalogo"]["nodos"] = {};
  const unidades: { gml: string; eq: string | null; nodo: string }[] = [];
  for (let k = 0; k < TOTAL_NODOS; k++) {
    const gml = idDe("d", 100 + k);
    const generoId = idDe("a", 1 + (k % GENEROS.length));
    const mundoId = idDe("b", 1 + (Math.floor(k / GENEROS.length) % MUNDOS.length));
    const base = { genero_id: generoId, mundo_id: mundoId, genero: GENEROS[k % GENEROS.length], mundo: MUNDOS[Math.floor(k / GENEROS.length) % MUNDOS.length], linea: `LINEA ${String(k).padStart(3, "0")}` };
    if (k % 6 === 0) {
      for (const [j, nombre] of ["MANGA LARGA", "MANGA CORTA"].entries()) {
        const eq = idDe("e", 100 + k * 2 + j);
        nodos[eq] = { ...base, equivalencia: nombre, nivel: "GMLE" };
        unidades.push({ gml, eq, nodo: eq });
      }
    } else {
      nodos[gml] = { ...base, equivalencia: null, nivel: "GML" };
      unidades.push({ gml, eq: null, nodo: gml });
    }
  }
  const agrupaciones: Record<string, string> = {};
  AGRUPACIONES.forEach((a, i) => (agrupaciones[idDe("9", 100 + i)] = a));
  const agrIds = Object.keys(agrupaciones);
  const responsables: FlujoApi["catalogo"]["responsables"] = {};
  for (let g = 0; g < GENEROS.length; g++) {
    for (let m = 0; m < MUNDOS.length; m++) {
      responsables[`${idDe("a", 1 + g)}|${idDe("b", 1 + m)}`] = { perfil_id: idDe("6", 1 + ((g + m) % 3)), nombre: `Comprador ${1 + ((g + m) % 3)}` };
    }
  }
  const catalogo: CatalogoFlujoApi = { nodos, agrupaciones, responsables };

  const ejemplos = op.filas >= 2 && kPrima === K_PRIMA && op.horizonte === DEMANDA_DENIM.length;
  const filas: FilaFlujoListaApi[] = [];
  const sumas = { demanda: new Array<number>(op.horizonte).fill(0), ingresos: new Array<number>(op.horizonte).fill(0), stock_k: 0, saldo: new Array<number>(op.horizonte).fill(0), exceso: new Array<number>(op.horizonte).fill(0), venta_k: 0 };

  const sumarAlTotal = (r: SerieReferencia, ventaK: number) => {
    r.demanda.forEach((d, i) => {
      sumas.demanda[i] += d;
      sumas.ingresos[i] += r.ingresos[i];
      sumas.saldo[i] += r.saldo[i];
      sumas.exceso[i] += r.exceso[i];
    });
    sumas.stock_k += r.stock_k;
    sumas.venta_k += ventaK;
  };

  const aLista = (d: FilaFlujoDetalleApi, serie: SerieFlujoApi): FilaFlujoListaApi => ({
    gml_id: d.gml_id,
    equivalencia_id: d.equivalencia_id,
    agrupacion_marca_id: d.agrupacion_marca_id,
    mia: d.mia,
    stock_k: d.stock_k,
    subflujos_resumen: d.subflujos_resumen,
    resumen: d.resumen,
    avisos: d.avisos,
    serie,
  });

  const serieDeDetalle = (d: FilaFlujoDetalleApi, reposicion: boolean): SerieFlujoApi => ({
    demanda: d.meses.map((m) => m.demanda),
    ingresos: d.meses.map((m) => m.ingresos),
    reposicion: reposicion ? d.meses.map((_, i) => (i === 0 ? 0 : 384)) : null,
    stock: d.meses.map((m) => m.stock_fin),
    imi: d.meses.map((m) => m.imi),
    saldo: d.meses.map((m) => m.saldo),
    exceso: d.meses.map((m) => m.exceso),
    senal: CARACTER_SENAL_K + d.meses.slice(1).map((m) => CARACTER_SENAL[m.senal]).join(""),
    fuera_de_rango: d.meses.map((m) => (m.fuera_de_rango ? "1" : "0")).join(""),
  });

  let inicio = 0;
  if (ejemplos) {
    const denim = filaDenimEjemplo();
    const camisa = filaCamisaJhEjemplo();
    filas.push(aLista(denim, serieDeDetalle(denim, false)), aLista(camisa, serieDeDetalle(camisa, true)));
    for (const d of [denim, camisa]) {
      d.meses.slice(1).forEach((m, i) => {
        sumas.demanda[i] += m.demanda;
        sumas.ingresos[i] += m.ingresos;
        sumas.saldo[i] += m.saldo;
        sumas.exceso[i] += m.exceso;
      });
      sumas.stock_k += d.stock_k.total;
      sumas.venta_k += d.meses[0].demanda;
    }
    inicio = 2;
  }

  let sinCurva = { filas: 0, venta_anual: 0, stock: 0 };
  for (let i = inicio; i < op.filas; i++) {
    const unidad = unidades[i % unidades.length];
    const agr = agrIds[Math.floor(i / unidades.length) % agrIds.length];
    const base = 20 + Math.floor(azar() ** 3 * 600);
    const estacional = (mes: number) => 1 + 0.35 * Math.sin((mes / 12) * 2 * Math.PI);
    const demanda = Array.from({ length: op.horizonte }, (_, j) => Math.round(base * estacional(Number(sumarMes(kPrima, j + 1).slice(5, 7)))));
    const stockK = azar() < 0.1 ? 0 : Math.round(base * (2 + azar() * 12));
    const ingresos = demanda.map((_, j) => (azar() < 0.03 && j > 0 ? Math.round(base * (1 + azar() * 4)) : 0));
    const conSubflujo = i % 40 === 0;
    const sinCurvaFila = i % 20 === 7;
    const reposicion = conSubflujo ? demanda.map((d) => Math.round(d * 0.4 * 0.8)) : undefined;
    const r = calcularSerieReferencia({ stock_k: stockK, demanda: sinCurvaFila ? demanda.map(() => 0) : demanda, ingresos, reposicion });
    const ventaK = Math.round(base * estacional(Number(kPrima.slice(5, 7))));
    const cd = Math.round(stockK * 0.59);
    const vencida = azar() < 0.02 ? Math.round(base) : 0;
    const resumen = resumenDeFila(r, periodos, { sinCurva: sinCurvaFila, vpm_real_k: ventaK, meses_tarjeta: 6, por_confirmar: vencida, doble: vencida > 0 && azar() < 0.5 ? vencida : 0 });
    const jh = conSubflujo ? [{ marca: "JOHN HOLDEN", senal: "falta" as Senal, imi_k: r1((r.imi_k ?? 0) * 0.4), rango: [4, 8] as [number, number] }] : [];
    filas.push({
      gml_id: unidad.gml,
      equivalencia_id: unidad.eq,
      agrupacion_marca_id: agr,
      mia: i % 7 === 0,
      stock_k: { cd, tiendas: stockK - cd, total: stockK },
      subflujos_resumen: jh,
      resumen,
      avisos: sinCurvaFila ? ["sin_curva"] : vencida > 0 ? ["entregas_vencidas"] : [],
      serie: serieDeLista(r, { venta_real: ventaK, ingreso_inferido: Math.round(base * 0.5) }, sinCurvaFila, conSubflujo),
    });
    if (sinCurvaFila) {
      sinCurva = { filas: sinCurva.filas + 1, venta_anual: sinCurva.venta_anual + base * 12, stock: sinCurva.stock + stockK };
    } else {
      sumarAlTotal(r, ventaK);
    }
  }

  const rTotal = calcularSerieReferencia({ stock_k: sumas.stock_k, demanda: sumas.demanda, ingresos: sumas.ingresos });
  rTotal.saldo = sumas.saldo;
  rTotal.exceso = sumas.exceso;
  const totales = serieDeLista(rTotal, { venta_real: sumas.venta_k, ingreso_inferido: Math.round(sumas.venta_k * 0.1) }, false, false);

  const datos: DatosFlujoApi = {
    cerrada: { id: idDe("8", 1), nombre: "Proyección 2026–2027", hasta_periodo: "2026-09", anio_en_curso: 2026, version_metodo: VERSION_METODO_MIN_M8, periodo_referencia: { desde: "2025-10", hasta: "2026-09" } },
    k: "2026-09",
    k_prima: kPrima,
    horizonte: { desde: periodos[1], hasta: periodos[periodos.length - 1] },
    periodos,
    parametros: parametrosEjemplo(),
    avisos: ejemplos ? ["entregas_sin_confirmar", "filas_sin_curva"] : [],
    stock_excluido: { stock: 0, unidades: 0 },
    stock_sin_clave: 0,
    por_confirmar: {
      entregas: filas.filter((f) => f.resumen.por_confirmar > 0).length,
      unidades: filas.reduce((a, f) => a + f.resumen.por_confirmar, 0),
      con_respaldo_entregas: filas.filter((f) => f.resumen.posible_doble_conteo > 0).length,
      con_respaldo_unidades: filas.reduce((a, f) => a + f.resumen.posible_doble_conteo, 0),
    },
    filas_sin_curva: sinCurva,
    huella: "0".repeat(64),
  };

  if (ejemplos) {
    catalogo.nodos[NODO_M8.urbano] = { genero_id: idDe("a", 1), mundo_id: idDe("b", 4), genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", equivalencia: null, nivel: "GML" };
    catalogo.nodos[EQ.larga] = { genero_id: idDe("a", 1), mundo_id: idDe("b", 1), genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA LARGA", nivel: "GMLE" };
    catalogo.agrupaciones[AGR_M8.reconocido] = "RECONOCIDO";
    catalogo.responsables[`${idDe("a", 1)}|${idDe("b", 4)}`] = { perfil_id: PERFIL.comprador1, nombre: "Comprador Uno" };
    catalogo.responsables[`${idDe("a", 1)}|${idDe("b", 1)}`] = { perfil_id: PERFIL.comprador2, nombre: "Comprador Dos" };
  }

  return {
    datos,
    catalogo,
    filas,
    totales,
    mis_combinaciones: [{ genero_id: idDe("a", 1), mundo_id: idDe("b", 4) }],
  };
}

/** Un flujo pequeño y legible (12 filas, `k' = 2026-09`, 15 meses de horizonte) para las pantallas. */
export const flujoEjemplo = (): FlujoApi => construirFlujo({ filas: 12, horizonte: DEMANDA_DENIM.length });

/**
 * `HuecosApi` (contrato compacto: tarjetas con índices a un `catalogo`, sin campos en cero o nulos) a partir de la lista, ordenada por
 * saldo descendente. Lo mismo que arma `armarHuecosApi` del servidor, escrito aparte para que las pruebas no se comparen contra sí mismas.
 */
export function huecosDesdeFlujo(flujo: FlujoApi, meses = flujo.datos.parametros.meses_tarjeta): HuecosApi {
  const periodos = flujo.datos.periodos;
  const catalogo: CatalogoHuecosApi = { generos: [], mundos: [], lineas: [], nodos: [], agrupaciones: [], responsables: {} };
  const posicion = (lista: string[], nombre: string): number => {
    const i = lista.indexOf(nombre);
    if (i >= 0) return i;
    lista.push(nombre);
    return lista.length - 1;
  };
  const posicionAgrupacion = (id: string): number => {
    const i = catalogo.agrupaciones.findIndex((x) => x.id === id);
    if (i >= 0) return i;
    catalogo.agrupaciones.push({ id, nombre: flujo.catalogo.agrupaciones[id] });
    return catalogo.agrupaciones.length - 1;
  };
  const crudas = flujo.filas.map((f) => {
    const nodo = flujo.catalogo.nodos[f.equivalencia_id ?? f.gml_id];
    const s = f.serie;
    const idx = (pred: (i: number) => boolean) => {
      for (let i = 1; i < periodos.length; i++) if (pred(i)) return i;
      return -1;
    };
    const iFalta = idx((i) => s.saldo[i] > 0);
    const iExceso = idx((i) => s.exceso[i] > 0);
    const iCamino = idx((i) => s.ingresos[i] > 0);
    let faltaDesde: string | null = null;
    if (iFalta > 0) {
      let hueco = false;
      for (let i = iFalta + 1; i < periodos.length; i++) {
        if (s.saldo[i] <= 0) hueco = true;
        else if (hueco) {
          faltaDesde = periodos[i];
          break;
        }
      }
    }
    const saldoN = s.saldo.slice(1, 1 + meses).reduce((a, b) => a + b, 0);
    return { f, nodo, iFalta, iExceso, iCamino, faltaDesde, saldoN, ruta: `${nodo.genero}|${nodo.mundo}|${nodo.linea}|${nodo.equivalencia ?? ""}|${flujo.catalogo.agrupaciones[f.agrupacion_marca_id]}` };
  });
  crudas.sort((a, b) => b.saldoN - a.saldoN || (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  const tarjetas: TarjetaHuecoApi[] = crudas.map(({ f, nodo, iFalta, iExceso, iCamino, faltaDesde, saldoN }) => {
    let iNodo = catalogo.nodos.findIndex((n) => n.gml_id === f.gml_id && (n.equivalencia_id ?? null) === f.equivalencia_id);
    if (iNodo < 0) {
      catalogo.nodos.push({
        gml_id: f.gml_id,
        ...(f.equivalencia_id === null ? {} : { equivalencia_id: f.equivalencia_id }),
        genero: posicion(catalogo.generos, nodo.genero),
        mundo: posicion(catalogo.mundos, nodo.mundo),
        linea: posicion(catalogo.lineas, nodo.linea),
        ...(nodo.equivalencia === null ? {} : { equivalencia: nodo.equivalencia }),
      });
      iNodo = catalogo.nodos.length - 1;
      const resp = flujo.catalogo.responsables[`${nodo.genero_id}|${nodo.mundo_id}`];
      if (resp) catalogo.responsables[`${catalogo.nodos[iNodo].genero}|${catalogo.nodos[iNodo].mundo}`] = resp;
    }
    const r = f.resumen;
    const saldoPrimer = iFalta < 0 ? 0 : f.serie.saldo[iFalta];
    const excesoPrimer = iExceso < 0 ? 0 : f.serie.exceso[iExceso];
    return {
      nodo: iNodo,
      agrupacion: posicionAgrupacion(f.agrupacion_marca_id),
      ...(f.mia ? { mia: true as const } : {}),
      stock_k: { cd: f.stock_k.cd, total: f.stock_k.total },
      resumen: {
        senal: r.senal,
        saldo_n_meses: saldoN,
        ...(r.imi_k === null ? {} : { imi_k: r.imi_k }),
        ...(r.en_camino === 0 ? {} : { en_camino: r.en_camino }),
        ...(iFalta < 0 ? {} : { primer_mes_falta: periodos[iFalta] }),
        ...(iExceso < 0 ? {} : { exceso_desde: periodos[iExceso] }),
        ...(r.por_confirmar === 0 ? {} : { por_confirmar: r.por_confirmar }),
        ...(r.posible_doble_conteo === 0 ? {} : { posible_doble_conteo: r.posible_doble_conteo }),
      },
      detalle: {
        ...(saldoPrimer === 0 ? {} : { saldo_primer_mes: saldoPrimer }),
        ...(excesoPrimer === 0 ? {} : { exceso_primer_mes: excesoPrimer }),
        ...(iCamino < 0 ? {} : { en_camino_primer_mes: { periodo: periodos[iCamino], unidades: f.serie.ingresos[iCamino] } }),
        ...(faltaDesde === null ? {} : { falta_desde: faltaDesde }),
      },
      ...(f.subflujos_resumen.length === 0 ? {} : { subflujos_resumen: f.subflujos_resumen }),
    };
  });
  return { datos: flujo.datos, meses, catalogo, tarjetas, mis_combinaciones: flujo.mis_combinaciones };
}

export const huecosEjemplo = (): HuecosApi => huecosDesdeFlujo(flujoEjemplo());

/** Una tarjeta de Huecos con sus índices resueltos contra el catálogo (lo que la pantalla necesita: ids de enlace, nombres y responsable). */
export function resolverTarjeta(h: Pick<HuecosApi, "catalogo">, t: TarjetaHuecoApi) {
  const c = h.catalogo;
  const nodo = c.nodos[t.nodo];
  const agrupacion = c.agrupaciones[t.agrupacion];
  return {
    gml_id: nodo.gml_id,
    equivalencia_id: nodo.equivalencia_id ?? null,
    agrupacion_marca_id: agrupacion.id,
    genero: c.generos[nodo.genero],
    mundo: c.mundos[nodo.mundo],
    linea: c.lineas[nodo.linea],
    equivalencia: nodo.equivalencia ?? null,
    agrupacion_marca: agrupacion.nombre,
    responsable: c.responsables[`${nodo.genero}|${nodo.mundo}`] ?? null,
  };
}
