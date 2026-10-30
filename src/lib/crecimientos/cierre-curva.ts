import { mesesDelAnio, redondear } from "@/lib/curvas/anios";
import { medirPeriodo, type SerieParaVolumen } from "@/lib/curvas/efecto";
import type { RedAnio } from "@/lib/curvas/tipos-api";
import { correccionMaterial, estadoFactorY, type FactorParaEstado, type HoyFactor } from "@/lib/proyeccion/factor-nino";
import type { DiagnosticoFactorApi, TemporadaFactor } from "@/lib/proyeccion/tipos-api";
import { agruparPorAgrupacion, tiendasConVenta, unidades, type Phi, type SerieGM } from "./series";
import type { CierreAgrupacionApi, CierreGMApi, DiagnosticoVeranoGMApi, FactorYApi, MotivoNuloReferencia } from "./tipos-api";

/**
 * Cierre del año en curso por curva de un género × mundo (ficha 06e §5.1, D10). Lógica PURA: sin base, sin HTTP, sin reloj. Para un
 * conjunto de tiendas `S` (`C(Y)`, las del %, o `M(Y+1)`, las que tendrá el año siguiente) y cada agrupación de estacionalidad `a` del GM:
 *
 *   v_{a,m} = max(0, Σ_{t∈S} U(a,t,Y,m))   m ≤ k           V_a = Σ v      V'_a = Σ v ÷ φ_{a,Y,m}
 *   T'_a    = V'_a ÷ C_{k,a}                                 C_{k,a} = Σ_{m≤k} c_{a,m} de la curva vigente de `a`
 *   p_{a,m} = T'_a c_{a,m} φ_{a,Y,m}   p'_{a,m} = T'_a c_{a,m}   m > k
 *   K_a = V_a + Σ p      K'_a = V'_a + Σ p'
 *
 * Una agrupación sin curva vigente (o con `C_k = 0`, o sin agrupación activa) se cierra con la curva COMPUESTA del GM
 * `c̄ = Σ w_b c_b ÷ Σ w_b` (`w_b = U'_b(Y−1)`, o `V'_b` si `Y−1` no tiene venta) y deja el aviso `sin_curva`. Sin redondeos intermedios:
 * quien muestra redondea.
 */

export const UMBRAL_AVANCE_BAJO = 0.3;
/** Del GM: `avance_bajo` también si las agrupaciones con avance bajo suman al menos esta parte de `Σ T'`. */
export const UMBRAL_PESO_AVANCE_BAJO = 0.2;

const MESES = 12;
const r2 = (n: number) => redondear(n, 2);
const r2n = (n: number | null) => (n === null ? null : r2(n));
const suma = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const NOMBRE_SIN_AGRUPACION = "Sin agrupación activa";

/** La curva vigente de una agrupación (`curvaDeFila` de M6: doce pesos que suman 1). */
export type CurvaDeAgrupacion = { id: string; version: number; c: readonly number[] };

export type EntradaCierre = {
  /** Las series del GM (o del Resto) con su agrupación `a`. */
  entradas: readonly SerieGM[];
  y: number;
  /** Último mes cerrado de `Y` (1 a 12); `null` si `Y` no tiene meses cerrados. */
  k: number | null;
  /** Meses publicados y cerrados (`aaaa-mm`). */
  publicados: ReadonlySet<string>;
  /** `S`: `C(Y)` o `M(Y+1)`. */
  tiendas: ReadonlySet<string>;
  phi: Phi;
  /** `agrupacion_id → curva vigente`. */
  curvas: ReadonlyMap<string, CurvaDeAgrupacion>;
  /** `agrupacion_id → nombre`. */
  nombres: ReadonlyMap<string, string>;
};

export type CierreAgrupacionCalculo = {
  agrupacion_id: string | null;
  nombre: string;
  temporada: string;
  /** `null` = se cerró con la curva compuesta. */
  curva: { id: string; version: number } | null;
  /** `C_{k,a}` de la curva usada (la propia o la compuesta); `null` si no hubo curva. */
  avance: number | null;
  avance_bajo: boolean;
  /** `φ_{a,Y,m}`, doce valores. */
  factor_meses: number[];
  vendido: number;
  vendido_corregido: number;
  /** `T'_a`; `null` si no se pudo cerrar. */
  tope: number | null;
  cierre: number | null;
  cierre_corregido: number | null;
  meses: (number | null)[];
  meses_corregidos: (number | null)[];
  /** Cerrada con la curva compuesta. */
  compuesta: boolean;
  /** `U(Y) + U(Y−1)` sobre `S`: para dejar fuera las agrupaciones sin actividad. */
  actividad: number;
};

export type CierreConjunto = {
  k: number | null;
  motivo_nulo: Extract<MotivoNuloReferencia, "meses_faltantes" | "sin_venta" | "sin_curva"> | null;
  agrupaciones: CierreAgrupacionCalculo[];
  vendido: number;
  vendido_corregido: number;
  /** `K` y `K'` del conjunto; `null` si `motivo_nulo`. */
  cierre: number | null;
  cierre_corregido: number | null;
  /** Doce posiciones: `≤ k` real, `> k` proyectado; todo `null` si `motivo_nulo`. */
  meses: (number | null)[];
  meses_corregidos: (number | null)[];
  /** `Σ V' ÷ Σ T'`. */
  avance: number | null;
  avance_bajo: boolean;
  agrupaciones_avance_bajo: string[];
  /** % del vendido corregido cerrado con la compuesta; `null` si ninguna agrupación la usó. */
  sin_curva_pct: number | null;
  /** Alguna agrupación con venta en `Y` tiene meses atípicos sin factor del Niño (`φ = 1` con aviso). */
  sin_factor: boolean;
};

type Grupo = { id: string | null; nombre: string; temporada: string; entradas: SerieGM[] };

const gruposDe = (entradas: readonly SerieGM[], nombres: ReadonlyMap<string, string>): Grupo[] =>
  [...agruparPorAgrupacion(entradas).entries()].map(([id, g]) => ({ id, nombre: id === null ? NOMBRE_SIN_AGRUPACION : (nombres.get(id) ?? id), temporada: g.temporada, entradas: g.entradas }));

const acumulada = (c: readonly number[], k: number): number => suma(c.slice(0, k));

/** Venta mensual de `Y` de una agrupación sobre `S`, `max(0, ·)` mes a mes. */
function mensualPositiva(g: Grupo, y: number, tiendas: ReadonlySet<string>): number[] {
  return Array.from({ length: MESES }, (_, i) => Math.max(0, unidades(g.entradas, y, { tiendas, desde: i + 1, hasta: i + 1 })));
}

/** `Σ v ÷ φ` mes a mes (`φ ≤ 0` no divide). */
const normalizada = (v: readonly number[], phi: readonly number[]): number[] => v.map((x, i) => ((phi[i] as number) > 0 ? x / (phi[i] as number) : x));

/** Cierra un conjunto de tiendas: `cierre`/`cierre_corregido` por agrupación y del GM, con los motivos de `null`. */
export function cerrarConjunto(e: EntradaCierre): CierreConjunto {
  const grupos = gruposDe(e.entradas, e.nombres);
  const vacio = (motivo: CierreConjunto["motivo_nulo"]): CierreConjunto => ({
    k: e.k,
    motivo_nulo: motivo,
    agrupaciones: [],
    vendido: 0,
    vendido_corregido: 0,
    cierre: null,
    cierre_corregido: null,
    meses: Array.from({ length: MESES }, () => null),
    meses_corregidos: Array.from({ length: MESES }, () => null),
    avance: null,
    avance_bajo: false,
    agrupaciones_avance_bajo: [],
    sin_curva_pct: null,
    sin_factor: false,
  });
  if (e.k === null) return vacio("sin_venta");
  const k = e.k;
  const periodos = mesesDelAnio(e.y);
  const faltante = periodos.slice(0, k).some((p) => !e.publicados.has(p));

  // Venta de Y por agrupación (la misma con meses faltantes: sirve para mostrar lo vendido).
  const calculos = grupos.map((g) => {
    const phi = [...e.phi.de(g.temporada, e.y)];
    const v = mensualPositiva(g, e.y, e.tiendas);
    const hasta = v.slice(0, k);
    const vendido = suma(hasta);
    const vc = normalizada(v, phi);
    const vendidoCorregido = suma(vc.slice(0, k));
    const propia = g.id === null ? undefined : e.curvas.get(g.id);
    const usaPropia = propia !== undefined && acumulada(propia.c, k) > 0;
    const anterior = unidades(g.entradas, e.y - 1, { tiendas: e.tiendas, phi: e.phi });
    return { g, phi, v, vc, vendido, vendidoCorregido, propia: usaPropia ? propia : undefined, anteriorCorregido: anterior, actividad: unidades(g.entradas, e.y, { tiendas: e.tiendas }) + unidades(g.entradas, e.y - 1, { tiendas: e.tiendas }) };
  });

  // Curva compuesta: pesos `w_b = U'_b(Y−1)` (o `V'_b`) de las agrupaciones con curva.
  const conCurva = calculos.filter((c) => c.propia !== undefined);
  const usaAnterior = conCurva.some((c) => c.anteriorCorregido > 0);
  const pesos = conCurva.map((c) => Math.max(0, usaAnterior ? c.anteriorCorregido : c.vendidoCorregido));
  const sumaPesos = suma(pesos);
  const compuesta: number[] | null =
    sumaPesos > 0 && acumuladaCompuesta(conCurva.map((c) => (c.propia as CurvaDeAgrupacion).c), pesos, sumaPesos, k) > 0
      ? Array.from({ length: MESES }, (_, m) => conCurva.reduce((a, c, i) => a + (pesos[i] as number) * ((c.propia as CurvaDeAgrupacion).c[m] as number), 0) / sumaPesos)
      : null;

  const agrupaciones: CierreAgrupacionCalculo[] = calculos.map((c) => {
    const curva = c.propia ? [...c.propia.c] : compuesta;
    const compuestaUsada = c.propia === undefined && curva !== null;
    const avance = curva === null ? null : acumulada(curva, k);
    const tope = curva !== null && avance !== null && avance > 0 ? c.vendidoCorregido / avance : c.vendidoCorregido === 0 ? 0 : null;
    const meses: (number | null)[] = [];
    const corregidos: (number | null)[] = [];
    for (let m = 0; m < MESES; m++) {
      if (m < k) {
        meses.push(c.v[m] as number);
        corregidos.push(c.vc[m] as number);
      } else if (tope === null) {
        meses.push(null);
        corregidos.push(null);
      } else {
        const peso = curva === null ? 0 : (curva[m] as number);
        corregidos.push(tope * peso);
        meses.push(tope * peso * (c.phi[m] as number));
      }
    }
    const cerrada = tope !== null;
    return {
      agrupacion_id: c.g.id,
      nombre: c.g.nombre,
      temporada: c.g.temporada,
      curva: c.propia ? { id: c.propia.id, version: c.propia.version } : null,
      avance,
      avance_bajo: avance !== null && avance > 0 && avance < UMBRAL_AVANCE_BAJO && c.vendidoCorregido > 0,
      factor_meses: c.phi,
      vendido: c.vendido,
      vendido_corregido: c.vendidoCorregido,
      tope,
      cierre: cerrada ? suma(meses as number[]) : null,
      cierre_corregido: cerrada ? suma(corregidos as number[]) : null,
      meses,
      meses_corregidos: corregidos,
      compuesta: compuestaUsada && c.vendidoCorregido > 0,
      actividad: c.actividad,
    };
  });

  const sinCurva = agrupaciones.some((a) => a.tope === null);
  const vendido = suma(agrupaciones.map((a) => a.vendido));
  const vendidoCorregido = suma(agrupaciones.map((a) => a.vendido_corregido));
  const sinFactor = calculos.some((c) => c.vendido > 0 && e.phi.sinFactor(c.g.temporada, e.y));
  const motivo: CierreConjunto["motivo_nulo"] = faltante ? "meses_faltantes" : sinCurva ? "sin_curva" : null;

  const conTope = agrupaciones.filter((a) => a.tope !== null && a.tope > 0);
  const sumaTope = suma(conTope.map((a) => a.tope as number));
  const sumaVc = suma(conTope.map((a) => a.vendido_corregido));
  const bajas = agrupaciones.filter((a) => a.avance_bajo);
  const topeBajas = suma(bajas.map((a) => a.tope ?? 0));
  const avance = sumaTope > 0 ? sumaVc / sumaTope : null;
  const avanceBajo = avance !== null && (avance < UMBRAL_AVANCE_BAJO || topeBajas / sumaTope >= UMBRAL_PESO_AVANCE_BAJO - 1e-12);
  const conCompuesta = suma(agrupaciones.filter((a) => a.compuesta).map((a) => a.vendido_corregido));

  const base: CierreConjunto = {
    k,
    motivo_nulo: motivo,
    agrupaciones,
    vendido,
    vendido_corregido: vendidoCorregido,
    cierre: null,
    cierre_corregido: null,
    meses: Array.from({ length: MESES }, () => null),
    meses_corregidos: Array.from({ length: MESES }, () => null),
    avance,
    avance_bajo: avanceBajo,
    agrupaciones_avance_bajo: bajas.map((a) => a.nombre),
    sin_curva_pct: conCompuesta > 0 && vendidoCorregido > 0 ? (conCompuesta / vendidoCorregido) * 100 : null,
    sin_factor: sinFactor,
  };
  if (motivo !== null) return base;
  const meses = Array.from({ length: MESES }, (_, m) => suma(agrupaciones.map((a) => a.meses[m] as number)));
  const corregidos = Array.from({ length: MESES }, (_, m) => suma(agrupaciones.map((a) => a.meses_corregidos[m] as number)));
  return { ...base, cierre: suma(meses), cierre_corregido: suma(corregidos), meses, meses_corregidos: corregidos };
}

function acumuladaCompuesta(curvas: readonly (readonly number[])[], pesos: readonly number[], sumaPesos: number, k: number): number {
  return curvas.reduce((a, c, i) => a + ((pesos[i] as number) * acumulada(c, k)) / sumaPesos, 0);
}

// ─── Cierre de un GM: C(Y) y M(Y+1) juntos ───

export type EntradaCierreGM = {
  entradas: readonly SerieGM[];
  y: number;
  k: number | null;
  publicados: ReadonlySet<string>;
  /** `C(Y)`: las mismas tiendas del %. */
  cy: ReadonlySet<string>;
  /** `M(Y+1)`: las tiendas que tendrá el año siguiente. */
  mismas: ReadonlySet<string>;
  codigos: ReadonlyMap<string, string>;
  phi: Phi;
  curvas: ReadonlyMap<string, CurvaDeAgrupacion>;
  nombres: ReadonlyMap<string, string>;
};

export type ResultadoCierreGM = {
  api: CierreGMApi;
  por_agrupacion: CierreAgrupacionApi[];
  cy: CierreConjunto;
  m: CierreConjunto;
  /** Base 2027 por curva (`M(Y+1)`), doce meses; `null` si no se pudo cerrar. */
  serie_base_curva: { real: number[]; corregida: number[] } | null;
};

/**
 * Cierra el GM sobre `C(Y)` y sobre `M(Y+1)` y arma `CierreGMApi` y `CierreAgrupacionApi[]`. `hay_nino` sale de
 * `correccionMaterial(K_M, K'_M)`; el servicio lo reemplaza por `resumen.gm_con_nino` cuando hay proyección de referencia de método 5
 * (D8). `factor_parcial` lo completa el servicio (necesita las filas de `factores_volumen_atipico`).
 */
export function cierreDeGM(e: EntradaCierreGM): ResultadoCierreGM {
  const cy = cerrarConjunto({ ...e, tiendas: e.cy });
  const m = cerrarConjunto({ ...e, tiendas: e.mismas });

  const conVenta = tiendasConVenta(e.entradas);
  const tiendasCy = [...e.cy].filter((t) => conVenta.has(t));
  const tiendasM = [...e.mismas].filter((t) => conVenta.has(t));
  const fueraCy = tiendasM.filter((t) => !e.cy.has(t)).map((t) => e.codigos.get(t) ?? t).sort((a, b) => a.localeCompare(b));

  const anterior = e.k === null ? null : unidades(e.entradas, e.y - 1, { tiendas: e.cy });
  const anteriorCorregido = e.k === null ? null : unidades(e.entradas, e.y - 1, { tiendas: e.cy, phi: e.phi });
  const pct = cy.cierre !== null && anterior !== null && anterior > 0 ? (cy.cierre / anterior - 1) * 100 : null;
  const pctCorregido = cy.cierre_corregido !== null && anteriorCorregido !== null && anteriorCorregido > 0 ? (cy.cierre_corregido / anteriorCorregido - 1) * 100 : null;
  const correccion = m.cierre !== null && m.cierre_corregido !== null && m.cierre > 0 ? (m.cierre_corregido / m.cierre - 1) * 100 : null;
  const hayNino = m.cierre !== null && m.cierre_corregido !== null && correccionMaterial(m.cierre, m.cierre_corregido);

  const api: CierreGMApi = {
    k: e.k,
    tiendas: tiendasCy.length,
    vendido: r2(cy.vendido),
    vendido_corregido: r2(cy.vendido_corregido),
    cierre: r2n(cy.cierre),
    cierre_corregido: r2n(cy.cierre_corregido),
    anterior: r2n(anterior),
    anterior_corregido: r2n(anteriorCorregido),
    pct: r2n(pct),
    pct_corregido: r2n(pctCorregido),
    base_curva: e.k === null ? null : { tiendas: tiendasM.length, tiendas_fuera_cy: fueraCy, real: r2n(m.cierre), corregida: r2n(m.cierre_corregido) },
    avance: cy.avance === null ? null : redondear(cy.avance, 4),
    avance_bajo: cy.avance_bajo,
    agrupaciones_avance_bajo: cy.agrupaciones_avance_bajo,
    sin_curva_pct: r2n(cy.sin_curva_pct),
    hay_nino: hayNino,
    correccion_curva_pct: r2n(correccion),
    factor_parcial: false,
    sin_factor: cy.sin_factor,
    motivo_nulo: cy.motivo_nulo,
  };

  const porId = new Map(m.agrupaciones.map((a) => [a.agrupacion_id, a]));
  const por_agrupacion: CierreAgrupacionApi[] = cy.agrupaciones
    .filter((a) => a.actividad !== 0 || (porId.get(a.agrupacion_id)?.actividad ?? 0) !== 0)
    .map((a) => {
      const enM = porId.get(a.agrupacion_id);
      return {
        agrupacion_id: a.agrupacion_id,
        nombre: a.nombre,
        temporada: a.temporada,
        curva: a.curva,
        avance: a.avance === null ? null : redondear(a.avance, 4),
        avance_bajo: a.avance_bajo,
        vendido: r2(a.vendido),
        factor_meses: a.factor_meses.map((f) => redondear(f, 4)),
        vendido_corregido: r2(a.vendido_corregido),
        cierre: cy.motivo_nulo === null ? r2n(a.cierre) : null,
        cierre_corregido: cy.motivo_nulo === null ? r2n(a.cierre_corregido) : null,
        base_curva: m.motivo_nulo === null ? r2n(enM?.cierre ?? null) : null,
        base_curva_corregida: m.motivo_nulo === null ? r2n(enM?.cierre_corregido ?? null) : null,
        meses: cy.motivo_nulo === null ? a.meses.map(r2n) : a.meses.map((v, i) => (i < (e.k ?? 0) ? r2n(v) : null)),
        meses_corregidos: cy.motivo_nulo === null ? a.meses_corregidos.map(r2n) : a.meses_corregidos.map((v, i) => (i < (e.k ?? 0) ? r2n(v) : null)),
      };
    });

  const serie_base_curva = m.cierre !== null && m.motivo_nulo === null ? { real: (m.meses as number[]).map(r2), corregida: (m.meses_corregidos as number[]).map(r2) } : null;
  return { api, por_agrupacion, cy, m, serie_base_curva };
}

// ─── Diagnóstico «cómo crece el verano atípicamente» del GM ───

/** Una serie anual de `SerieParaVolumen` (con su desglose por tienda y los meses publicados) a partir de las series de venta. */
export function serieParaVolumen(entradas: readonly SerieGM[], anio: number, publicados: ReadonlySet<string>): SerieParaVolumen {
  const periodos = mesesDelAnio(anio);
  const porTienda = new Map<string, number[]>();
  for (const s of entradas) {
    const u = porTienda.get(s.t) ?? Array.from({ length: MESES }, () => 0);
    for (let m = 0; m < MESES; m++) u[m] = (u[m] as number) + (s.u[periodos[m] as string] ?? 0);
    porTienda.set(s.t, u);
  }
  const unidadesMes = Array.from({ length: MESES }, (_, m) => suma([...porTienda.values()].map((u) => u[m] as number)));
  return { anio, unidades: unidadesMes, publicados: periodos.map((p) => publicados.has(p)), por_tienda: porTienda };
}

export type EntradaDiagnosticoVerano = {
  /** Las series de verano del GM (`temp = verano`). */
  entradasVerano: readonly SerieGM[];
  /** El control: la venta de TODA la red de `todo_el_ano`. */
  control: readonly SerieGM[];
  y: number;
  /** El año normal más cercano (`referenciaVolumen`); `null` sin normales. */
  anioRef: number | null;
  publicados: ReadonlySet<string>;
  /** Doce posiciones: el mes es atípico de verano en `Y`. */
  mesesPeriodo: readonly boolean[];
  redes: ReadonlyMap<number, RedAnio>;
};

/**
 * §5.2: para las agrupaciones de verano del GM sobre las tiendas comunes de `Y` y su año de referencia, mes a mes la venta de `Y`, la de
 * la referencia, `ρ_m` y la de la red (`κ_m`), y los dos excesos del periodo: sobre su propia tendencia (`ρ_P ÷ ratio_fuera`) y sobre
 * la red (`ρ_P ÷ κ_P`). Solo informativo: no escribe ningún factor. `null` sin venta de verano, sin referencia o sin meses del periodo.
 */
export function diagnosticoVeranoGM(e: EntradaDiagnosticoVerano): DiagnosticoVeranoGMApi {
  if (e.anioRef === null || e.entradasVerano.length === 0 || !e.mesesPeriodo.some(Boolean)) return null;
  const y = serieParaVolumen(e.entradasVerano, e.y, e.publicados);
  const ref = serieParaVolumen(e.entradasVerano, e.anioRef, e.publicados);
  const controlY = serieParaVolumen(e.control, e.y, e.publicados);
  const controlRef = serieParaVolumen(e.control, e.anioRef, e.publicados);
  const p = medirPeriodo({ y, referencia: ref, controlY, controlReferencia: controlRef, redes: e.redes, mesesPeriodo: e.mesesPeriodo });
  if (!p.meses.some((m) => m.u !== 0 || m.u_ref !== 0)) return null;
  const rho = p.ratio_volumen;
  return {
    meses: p.meses.map((m) => ({ m: m.m, en_periodo: m.en_periodo, u: r2(m.u), u_ref: r2(m.u_ref), ratio: m.ratio === null ? null : redondear(m.ratio, 4), control: m.control === null ? null : redondear(m.control, 4) })),
    ratio_fuera: p.ratio_fuera === null ? null : redondear(p.ratio_fuera, 4),
    exceso_propio: rho !== null && p.ratio_fuera !== null && p.ratio_fuera > 0 ? redondear(rho / p.ratio_fuera, 4) : null,
    exceso_red: p.relativo === null ? null : redondear(p.relativo, 4),
    meses_periodo_con_dato: p.meses_periodo_con_dato,
  };
}

// ─── Factores de Y que tocan al GM ───

/** Lo que `armarFactorY` necesita de una fila de `factores_volumen_atipico` (las columnas de `0.14.0` pueden venir `null`). */
export type FilaFactor = FactorParaEstado & {
  anio: number;
  temporada: string;
  ratio_volumen: number | null;
  ratio_control: number | null;
  diagnostico: unknown;
};

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numeroONulo = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** El `jsonb` `diagnostico` de un factor a su forma tipada; `null` si no tiene la forma esperada (doce meses). */
export function comoDiagnostico(crudo: unknown): DiagnosticoFactorApi | null {
  if (!esObjeto(crudo) || !Array.isArray(crudo.meses) || crudo.meses.length !== MESES) return null;
  const meses: DiagnosticoFactorApi["meses"] = [];
  for (const m of crudo.meses as unknown[]) {
    if (!esObjeto(m) || typeof m.m !== "number" || typeof m.en_periodo !== "boolean" || typeof m.u !== "number" || typeof m.u_ref !== "number") return null;
    meses.push({ m: m.m, en_periodo: m.en_periodo, u: m.u, u_ref: m.u_ref, ratio: numeroONulo(m.ratio), control: numeroONulo(m.control), relativo: numeroONulo(m.relativo) });
  }
  return {
    meses,
    ratio_fuera: numeroONulo(crudo.ratio_fuera),
    meses_periodo: numeroONulo(crudo.meses_periodo) ?? 0,
    meses_periodo_con_dato: numeroONulo(crudo.meses_periodo_con_dato) ?? 0,
  };
}

/**
 * Un factor de `Y` para la pantalla de GM: sus valores, el estado (`estadoFactorY`, B2) y el diagnóstico guardado. Sin fila, el factor es
 * `faltante` con todo en `null` (la temporada tiene meses atípicos en `Y` pero nadie lo calculó ni lo escribió).
 */
export function armarFactorY(f: FilaFactor | undefined, anio: number, temporada: TemporadaFactor, mesesPeriodo: number, hoy: HoyFactor): FactorYApi {
  if (!f) {
    return { anio, temporada, efectivo: null, origen: null, ratio_volumen: null, ratio_control: null, ratio_calculado: null, ratio_aplicado: null, meses_periodo: mesesPeriodo, meses_periodo_con_dato: 0, parcial: false, estado: "faltante", diagnostico: null };
  }
  const efectivo = f.ratio_aplicado ?? f.ratio_calculado;
  const diagnostico = comoDiagnostico(f.diagnostico);
  return {
    anio,
    temporada,
    efectivo,
    origen: f.ratio_aplicado !== null ? "aplicado" : f.ratio_calculado !== null ? "calculado" : null,
    ratio_volumen: f.ratio_volumen,
    ratio_control: f.ratio_control,
    ratio_calculado: f.ratio_calculado,
    ratio_aplicado: f.ratio_aplicado,
    meses_periodo: mesesPeriodo,
    meses_periodo_con_dato: diagnostico?.meses_periodo_con_dato ?? 0,
    parcial: f.parcial,
    estado: estadoFactorY(f, hoy).estado,
    diagnostico,
  };
}

/** `|K'_M(φ hoy) ÷ K'_M(φ foto) − 1|` como fracción; `null` si alguno no se pudo calcular (R14, M3). */
export function variacionCierre(hoy: number | null, foto: number | null): number | null {
  if (hoy === null || foto === null || !(foto > 0)) return null;
  return Math.abs(hoy / foto - 1);
}
