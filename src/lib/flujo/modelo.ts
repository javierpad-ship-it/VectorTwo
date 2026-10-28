import type { Mes } from "@/lib/compras/tipos";
import type { CompraRegistro, EntregaRegistro, LineaRegistro, RecepcionRegistro, RepartoRegistro } from "@/lib/compras/tipos";
import { aplicable, armarPctDirectoObservado } from "@/lib/intercompany/reglas";
import type { ParticipacionFilaCerrada } from "@/lib/intercompany/tipos-api";
import { VERSION_METODO_MIN_M8 } from "@/lib/proyeccion/tipos-api";
import {
  conciliarFila,
  pctDirectoObservado,
  pctDirectoObservado12m,
  posibleDobleConteo,
  reclasificacionProbable,
  sugerenciasDeFila,
  type MesConciliado,
  type Umbrales,
} from "./conciliacion";
import {
  avisosDeDemanda,
  comoParticipacionFila,
  demandaDeFila,
  filasFlujo,
  mesesEntre,
  sumarMes,
  type ClaveFila,
  type FilaBase,
  type FilaCerradaFlujo,
} from "./filas";
import { extenderDemanda, fueraDeRango, imi, peorSenal, vpm } from "./imi";
import { ingresosDeFila, ingresosDeMarca, ingresosPorFila, type EntregaCandidata, type ResolverMarcas } from "./ingresos";
import { esMia, type Combinacion } from "./mio";
import { stockDelFlujo, ventaDeCadena, type StockMes } from "./stock";
import { indexarReglas, proyectarFilaConSubflujos, subflujosDeFila, type MesProyectado, type ProyeccionFila, type SubflujoProyectado } from "./subflujo";
import type { RelojFlujo } from "./tipos";
import {
  CARACTER_SENAL,
  CARACTER_SENAL_K,
  type AvisoConciliacion,
  type AvisoFila,
  type AvisoFlujo,
  type CatalogoFlujoApi,
  type CatalogoHuecosApi,
  type ConciliacionApi,
  type ConciliacionFilaApi,
  type EntradaCatalogoHuecosApi,
  type EntregaDetalleApi,
  type FilaFlujoApi,
  type FilaFlujoDetalleApi,
  type FilaFlujoListaApi,
  type MesFlujoApi,
  type NodoHuecosApi,
  type ParametrosFlujoApi,
  type ReglaFlujoApi,
  type ResumenFilaApi,
  type ResumenListaApi,
  type Senal,
  type SerieFlujoApi,
  type SoloConciliacion,
  type SubflujoApi,
  type TarjetaHuecoApi,
  type TotalesConciliacionApi,
} from "./tipos-api";

/**
 * `calcularFlujo`: el flujo de M8 a demanda (ficha 08, §3, §5 y reglas 1–9). TS puro, determinista y sin reloj (`k'`, `k` y `hoy`
 * entran en `reloj`); nada de Supabase. El servicio (T3b) lee, arma esta entrada, cachea el resultado por huella y serializa con los
 * `a*Api` de este archivo (que redondean al serializar: unidades a entero, IMI a un decimal; el cálculo va en flotante, §0.15).
 */

// ─── Entrada ───

export type ParametrosCalculo = Pick<
  ParametrosFlujoApi,
  "imi_min" | "imi_max" | "meses_tarjeta" | "extender_horizonte" | "umbral_conciliacion_u" | "umbral_conciliacion_pct"
>;

/** Lo que el flujo necesita de cada nodo género-mundo-línea (el servicio lo arma desde 02b). */
export type NodoFlujo = { genero_id: string; mundo_id: string; linea_id: string };

export type RegistrosCompras = {
  compras: readonly CompraRegistro[];
  lineas: readonly LineaRegistro[];
  entregas: readonly EntregaRegistro[];
  repartos: readonly RepartoRegistro[];
  recepciones: readonly RecepcionRegistro[];
};

export type EntradaCalculoFlujo = {
  reloj: RelojFlujo;
  /** `k'+1 … H` (de `planHorizonte`). */
  horizonte: { desde: Mes; hasta: Mes };
  cubre: "en_curso" | "siguiente";
  parametros: ParametrosCalculo;
  cerrada: {
    filas: readonly FilaCerradaFlujo[];
    version_metodo: number;
    /** `proyecciones.huella_flujo` de la cerrada. */
    huella_flujo: string | null;
    periodo_referencia: { desde: Mes; hasta: Mes } | null;
  };
  /** `huellaFlujo(construirConfigFlujo(...))` de HOY. */
  huella_flujo_hoy: string | null;
  /** Stock de los meses `k'−12 … k'` ya repartido en filas (`stockPorFila`); un mes ausente o no publicado no se concilia. */
  stock: ReadonlyMap<Mes, StockMes>;
  compras: RegistrosCompras;
  /** Reglas de M13 (`leerVigentes`), reducidas. */
  reglas: readonly ReglaFlujoApi[];
  resolver: ResolverMarcas;
  nodos: ReadonlyMap<string, NodoFlujo>;
  mis_combinaciones: readonly Combinacion[];
};

// ─── Salida ───

export type ConciliacionMarcaCalculada = {
  marca_id: string;
  regla_id: string;
  /** `pct_directo` de la regla (puntos 0–100). */
  pct_directo_regla: number;
  meses: (MesConciliado & { pct_directo_observado: number | null })[];
};

export type FilaCalculada = ClaveFila & {
  clave: string;
  mia: boolean;
  /** CD + tiendas activas (sin negativos). */
  stock_k: { cd: number; tiendas: number; total: number };
  /** Venta real de `k'` (cadena). */
  venta_k: number;
  vpm_real_k: number | null;
  ingreso_inferido_k: number | null;
  salida_inferida_k: number | null;
  recepciones_k: number;
  proyeccion: ProyeccionFila;
  /** Los meses publicados de `k'−11 … k'`. */
  historia: { periodo: Mes; venta: number; stock_fin: number; ingreso_inferido: number | null }[];
  conciliacion: MesConciliado[];
  conciliacion_marcas: ConciliacionMarcaCalculada[];
  /** `D_m × part_barrido` por marca al barrer, del horizonte. */
  al_barrer: { periodo: Mes; marcas: { marca_id: string; unidades: number }[] }[];
  /** Entregas pendientes que caen en la fila (vencidas y futuras). */
  entregas: EntregaCandidata[];
  avisos: AvisoFila[];
  sin_curva: boolean;
  venta_anual: number;
  unidades_sin_curva: number;
  /** Pendiente de entregas vencidas (§0.5). */
  por_confirmar: number;
  /** Unidades de sus sugerencias (el inventario ya las muestra y el flujo las sigue esperando). */
  posible_doble_conteo: number;
  tiene_subflujos: boolean;
};

export type TotalesCalculados = {
  /** Índice 0 = `k'`. */
  demanda: number[];
  ingresos: number[];
  reposicion: number[] | null;
  stock: number[];
  imi: (number | null)[];
  saldo: number[];
  exceso: number[];
  senal: Senal[];
  fuera_de_rango: boolean[];
};

export type ResultadoFlujo = {
  k_prima: Mes;
  k: Mes;
  horizonte: { desde: Mes; hasta: Mes };
  /** `[k', k'+1 … H]`. */
  periodos: Mes[];
  avisos: AvisoFlujo[];
  stock_excluido: { stock: number; unidades: number };
  stock_sin_clave: number;
  por_confirmar: { entregas: number; unidades: number; con_respaldo_entregas: number; con_respaldo_unidades: number };
  filas_sin_curva: { filas: number; venta_anual: number; stock: number };
  filas: FilaCalculada[];
  /** El IMI sin las filas sin curva (§0.10). */
  totales: TotalesCalculados;
  /** Meses de `k'−12 … k'` publicados (para `mes_anterior_publicado`). */
  meses_publicados: Set<Mes>;
  parametros: ParametrosCalculo;
  /** Líneas de lote confirmadas sin reparto: no cuentan (se listan). */
  lineas_sin_reparto: string[];
  fuera_de_horizonte: number;
};

// ─── Redondeo al serializar (§0.15) ───

const u = (x: number): number => Math.round(x) || 0;
const r1 = (x: number): number => Math.round(x * 10) / 10 || 0;
const r1n = (x: number | null): number | null => (x === null ? null : r1(x));

// ─── Cálculo ───

function cargarAvisos(avisos: Set<AvisoFlujo>): AvisoFlujo[] {
  const orden: AvisoFlujo[] = [
    "cerrada_atrasada",
    "horizonte_corto",
    "cerrada_sin_periodo",
    "cerrada_metodo_anterior",
    "config_cambiada",
    "stock_en_tiendas_inactivas",
    "stock_sin_clave",
    "entregas_sin_confirmar",
    "filas_sin_curva",
  ];
  return orden.filter((a) => avisos.has(a));
}

export function calcularFlujo(e: EntradaCalculoFlujo): ResultadoFlujo {
  const kp = e.reloj.k_prima;
  const periodos = mesesEntre(e.horizonte.desde, e.horizonte.hasta);
  const n = periodos.length;
  const meses12 = mesesEntre(sumarMes(kp, -11), kp);
  const previos12 = meses12.map((m) => sumarMes(m, -1));
  const rango = { imi_min: e.parametros.imi_min, imi_max: e.parametros.imi_max };
  const umbrales: Umbrales = { u: e.parametros.umbral_conciliacion_u, pct: e.parametros.umbral_conciliacion_pct };
  const stockK = e.stock.get(kp);
  const stockKPublicado = stockK?.publicada ? stockK : undefined;

  const ing = ingresosPorFila({ ...e.compras, kPrima: kp, hasta: e.horizonte.hasta, resolver: e.resolver });

  // Universo: la cerrada, más lo que tiene stock o ingreso y no tiene fila (`fila_sin_proyeccion`).
  const actividad: ClaveFila[] = [];
  if (stockKPublicado) {
    for (const f of stockKPublicado.filas.values()) {
      if (f.negativo || f.cd + f.tiendas !== 0 || ventaDeCadena(f) > 0) actividad.push(f);
    }
  }
  for (const f of ing.filas.values()) if (f.por_mes.size > 0 || f.candidatas.length > 0) actividad.push(f);
  const base = filasFlujo(e.cerrada.filas, actividad, Number(e.horizonte.desde.slice(0, 4)));

  // Aplicabilidad de las reglas a nivel del nodo (M13): `part_B > 0` en alguna fila del nodo.
  const indiceReglas = indexarReglas(e.reglas);
  const particionesPorNodo = new Map<string, ParticipacionFilaCerrada[]>();
  for (const f of base) {
    const p = comoParticipacionFila(f);
    if (!p) continue;
    const l = particionesPorNodo.get(f.gml_id);
    if (l) l.push(p);
    else particionesPorNodo.set(f.gml_id, [p]);
  }
  const memoAplicable = new Map<string, boolean>();
  const aplicableEnNodo = (gmlId: string, marcaId: string): boolean => {
    const k = `${gmlId}|${marcaId}`;
    let v = memoAplicable.get(k);
    if (v === undefined) {
      v = aplicable({ marca_id: marcaId, genero_mundo_linea_id: gmlId }, particionesPorNodo.get(gmlId) ?? []).aplicable === true;
      memoAplicable.set(k, v);
    }
    return v;
  };

  const mesesPublicados = new Set<Mes>();
  for (const [mes, s] of e.stock) if (s.publicada) mesesPublicados.add(mes);

  const filas: FilaCalculada[] = base.map((fila) => calcularFila(fila));

  function calcularFila(fila: FilaBase): FilaCalculada {
    const sk = stockKPublicado?.filas.get(fila.clave);
    const stockFlujo = sk ? stockDelFlujo(sk) : 0;
    const ingFila = ing.filas.get(fila.clave);
    const demanda = demandaDeFila(fila, periodos);
    const ingresos = ingresosDeFila(ingFila, periodos);

    const { subflujos, avisos: avisosSub } = subflujosDeFila({
      gml_id: fila.gml_id,
      equivalencia_id: fila.equivalencia_id,
      participaciones: fila.participaciones,
      proyectada: fila.en_cerrada && !fila.sin_curva,
      indice: indiceReglas,
      periodos,
      aplicableEnNodo: (marcaId) => aplicableEnNodo(fila.gml_id, marcaId),
      stockDeMarca: (marcaId) => {
        const s = sk?.por_marca.get(marcaId);
        return s ? stockDelFlujo(s) : 0;
      },
      ingresosDeMarca: (marcaId) => ingresosDeMarca(ingFila, marcaId, periodos),
    });

    const proyeccion = proyectarFilaConSubflujos({
      periodos,
      demanda,
      extender: e.parametros.extender_horizonte,
      stock_k: stockFlujo,
      ingresos,
      rango,
      subflujos,
      sin_curva: fila.sin_curva,
      meses_tarjeta: e.parametros.meses_tarjeta,
    });

    // Conciliación de los doce meses cerrados, a nivel cadena (CD + tiendas activas e inactivas).
    const lectura = (clave: string, marcaId: string | null) => (mes: Mes) => {
      const s = e.stock.get(mes);
      if (!s || !s.publicada) return null;
      const f = s.filas.get(clave);
      const delaMarca = marcaId === null ? f : f?.por_marca.get(marcaId);
      return { stock: delaMarca?.cadena ?? 0, venta: delaMarca ? ventaDeCadena(delaMarca) : 0 };
    };
    const conciliacion = conciliarFila({ meses: meses12, previos: previos12, lectura: lectura(fila.clave, null), recepciones: ingFila?.recepciones_por_mes, entregas: ingFila?.entregas_por_mes, umbrales });
    const sugerencias = sugerenciasDeFila(conciliacion, ingFila?.candidatas ?? [], kp);
    for (const m of conciliacion) m.sugerencias = sugerencias.por_mes.get(m.periodo) ?? [];

    const conciliacion_marcas: ConciliacionMarcaCalculada[] = proyeccion.subflujos.map((s) => ({
      marca_id: s.marca_id,
      regla_id: s.regla.id,
      pct_directo_regla: s.regla.pct_directo,
      meses: conciliarFila({
        meses: meses12,
        previos: previos12,
        lectura: lectura(fila.clave, s.marca_id),
        recepciones: ingFila?.recepciones_por_marca.get(s.marca_id),
        entregas: undefined,
        umbrales,
      }).map((m) => ({ ...m, pct_directo_observado: m.ingreso_inferido === null ? null : pctDirectoObservado(m.ingreso_inferido, m.recepciones_registradas, m.venta) })),
    }));

    const historia = conciliacion.map((m) => ({ periodo: m.periodo, venta: m.venta, stock_fin: m.stock_fin, ingreso_inferido: m.ingreso_inferido }));
    // Los meses de `conciliacion` son los publicados de `k'−11 … k'`: de ahí salen la venta de `k'` y la venta real media de doce meses.
    const vpmReal = conciliacion.length === 0 ? null : conciliacion.reduce((a, m) => a + m.venta, 0) / 12;
    const mesK = conciliacion.find((m) => m.periodo === kp);

    const barrido = (fila.participaciones?.por_clave_flujo ?? []).filter((p) => p.clave_flujo?.startsWith("barrido:") && p.marca_id !== null && p.participacion > 0);
    const al_barrer = barrido.length === 0 ? [] : periodos.map((periodo, i) => ({ periodo, marcas: barrido.map((p) => ({ marca_id: p.marca_id as string, unidades: demanda[i] * p.participacion })) }));

    const avisos = new Set<AvisoFila>([...avisosDeDemanda(fila), ...avisosSub]);
    if (sk?.negativo || [...(sk?.por_marca.values() ?? [])].some((m) => m.negativo)) avisos.add("stock_negativo");
    if ((ingFila?.vencidas ?? 0) > 0) avisos.add("entregas_vencidas");
    if (sugerencias.posible_doble_conteo > 0) avisos.add("posible_doble_conteo");

    const nodo = e.nodos.get(fila.gml_id);
    return {
      ...fila,
      mia: nodo ? esMia({ genero_id: nodo.genero_id, mundo_id: nodo.mundo_id }, e.mis_combinaciones) : false,
      stock_k: { cd: sk?.cd ?? 0, tiendas: sk?.tiendas ?? 0, total: stockFlujo },
      venta_k: mesK?.venta ?? 0,
      vpm_real_k: vpmReal,
      ingreso_inferido_k: mesK?.ingreso_inferido ?? null,
      salida_inferida_k: mesK?.salida_inferida ?? null,
      recepciones_k: ingFila?.recepciones_por_mes.get(kp) ?? 0,
      proyeccion,
      historia,
      conciliacion,
      conciliacion_marcas,
      al_barrer,
      entregas: (ingFila?.candidatas ?? []).slice().sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : a.compra_numero < b.compra_numero ? -1 : a.compra_numero > b.compra_numero ? 1 : 0)),
      avisos: [...avisos],
      sin_curva: fila.sin_curva,
      venta_anual: fila.venta_anual,
      unidades_sin_curva: fila.unidades_sin_curva,
      por_confirmar: ingFila?.vencidas ?? 0,
      posible_doble_conteo: sugerencias.posible_doble_conteo,
      tiene_subflujos: proyeccion.subflujos.length > 0,
    };
  }

  // `reclasificacion_probable`: por mes y por línea, entre filas.
  const porMes = new Map<Mes, { clave: string; grupo: string; ingreso_bruto: number | null }[]>();
  for (const f of filas) {
    const grupo = e.nodos.get(f.gml_id)?.linea_id ?? f.gml_id;
    for (const m of f.conciliacion) {
      if (m.ingreso_bruto === null || m.ingreso_bruto === 0) continue;
      const l = porMes.get(m.periodo);
      if (l) l.push({ clave: f.clave, grupo, ingreso_bruto: m.ingreso_bruto });
      else porMes.set(m.periodo, [{ clave: f.clave, grupo, ingreso_bruto: m.ingreso_bruto }]);
    }
  }
  const marcadasPorMes = new Map<Mes, Set<string>>();
  for (const [mes, lista] of porMes) {
    const marcadas = reclasificacionProbable(lista);
    if (marcadas.size > 0) marcadasPorMes.set(mes, marcadas);
  }
  if (marcadasPorMes.size > 0) {
    for (const f of filas) {
      for (const m of f.conciliacion) {
        if (marcadasPorMes.get(m.periodo)?.has(f.clave) && !m.avisos.includes("reclasificacion_probable")) m.avisos.push("reclasificacion_probable");
      }
    }
  }

  // Cabecera.
  const sinCurva = filas.filter((f) => f.sin_curva);
  const vencidasUnicas = new Map<string, number>();
  const conRespaldo = new Set<string>();
  let conRespaldoUnidades = 0;
  for (const f of filas) {
    for (const c of f.entregas) if (c.vencida) vencidasUnicas.set(c.entrega_id, (vencidasUnicas.get(c.entrega_id) ?? 0) + c.pendiente);
    for (const m of f.conciliacion) {
      for (const s of m.sugerencias) {
        if (s.tipo === "vencida") {
          conRespaldo.add(s.entrega_id);
          conRespaldoUnidades += s.unidades;
        }
      }
    }
  }
  const porConfirmar = {
    entregas: vencidasUnicas.size,
    unidades: [...vencidasUnicas.values()].reduce((a, x) => a + x, 0),
    con_respaldo_entregas: conRespaldo.size,
    con_respaldo_unidades: conRespaldoUnidades,
  };
  const stockSinClave = stockKPublicado?.sin_clave ?? { stock: 0, unidades: 0 };
  const excluido = stockKPublicado?.excluido ?? { stock: 0, unidades: 0 };

  const avisos = new Set<AvisoFlujo>();
  if (kp > e.reloj.k) avisos.add("cerrada_atrasada");
  if (e.cubre === "siguiente") avisos.add("horizonte_corto");
  if (e.cerrada.periodo_referencia === null) avisos.add("cerrada_sin_periodo");
  if (e.cerrada.version_metodo < VERSION_METODO_MIN_M8) avisos.add("cerrada_metodo_anterior");
  if (e.cerrada.huella_flujo === null || e.cerrada.huella_flujo !== e.huella_flujo_hoy) avisos.add("config_cambiada");
  if (excluido.stock > 0 || excluido.unidades > 0) avisos.add("stock_en_tiendas_inactivas");
  if (stockSinClave.stock > 0 || stockSinClave.unidades > 0) avisos.add("stock_sin_clave");
  if (porConfirmar.entregas > 0) avisos.add("entregas_sin_confirmar");
  if (sinCurva.length > 0) avisos.add("filas_sin_curva");

  return {
    k_prima: kp,
    k: e.reloj.k,
    horizonte: e.horizonte,
    periodos: [kp, ...periodos],
    avisos: cargarAvisos(avisos),
    stock_excluido: excluido,
    stock_sin_clave: stockSinClave.stock,
    por_confirmar: porConfirmar,
    filas_sin_curva: { filas: sinCurva.length, venta_anual: sinCurva.reduce((a, f) => a + f.venta_anual, 0), stock: sinCurva.reduce((a, f) => a + f.stock_k.total, 0) },
    filas,
    totales: totalesDe(filas.filter((f) => !f.sin_curva), n, e.parametros),
    meses_publicados: mesesPublicados,
    parametros: e.parametros,
    lineas_sin_reparto: ing.sin_reparto,
    fuera_de_horizonte: ing.fuera_de_horizonte,
  };
}

/** Suma las filas (sin las de sin curva) y calcula el IMI de la suma con la demanda total extendida (§0.10 e). */
function totalesDe(filas: readonly FilaCalculada[], n: number, parametros: ParametrosCalculo): TotalesCalculados {
  const demanda = new Array<number>(n).fill(0);
  const ingresos = new Array<number>(n).fill(0);
  const stock = new Array<number>(n).fill(0);
  const saldo = new Array<number>(n).fill(0);
  const exceso = new Array<number>(n).fill(0);
  const reposicion = new Array<number>(n).fill(0);
  let stockK = 0;
  let ventaK = 0;
  let ingresoK = 0;
  for (const f of filas) {
    stockK += f.stock_k.total;
    ventaK += f.venta_k;
    ingresoK += f.ingreso_inferido_k ?? 0;
    const meses = f.proyeccion.meses;
    for (let i = 0; i < n; i++) {
      const m = meses[i];
      demanda[i] += m.demanda;
      ingresos[i] += m.ingresos;
      stock[i] += m.stock;
      saldo[i] += m.saldo;
      exceso[i] += m.exceso;
      reposicion[i] += m.reposicion;
    }
  }
  const ext = extenderDemanda(demanda, parametros.extender_horizonte);
  const rango = { imi_min: parametros.imi_min, imi_max: parametros.imi_max };
  const imiK = imi(stockK, vpm(ext, -1));
  const imiMeses = stock.map((s, i) => imi(s, vpm(ext, i)));
  const sinDemanda = demanda.every((d) => d === 0);
  const senales = stock.map<Senal>((s, i) => (sinDemanda ? "sin_demanda" : s < 0 ? "quiebre" : saldo[i] > 0 ? "falta" : exceso[i] > 0 ? "exceso" : "al_dia"));
  return {
    demanda: [ventaK, ...demanda],
    ingresos: [ingresoK, ...ingresos],
    reposicion: reposicion.some((x) => x !== 0) ? [0, ...reposicion] : null,
    stock: [stockK, ...stock],
    imi: [imiK, ...imiMeses],
    saldo: [0, ...saldo],
    exceso: [0, ...exceso],
    senal: ["al_dia", ...senales],
    fuera_de_rango: [fueraDeRango(imiK, rango), ...imiMeses.map((x) => fueraDeRango(x, rango))],
  };
}

// ─── Tarjeta y resumen ───

/**
 * `resumenTarjeta(fila, n)`: el resumen de la fila para una tarjeta de Huecos con los próximos `n` meses. La señal es la peor de esos
 * `n` meses; el saldo, `Σ C_m` de ellos; `en_camino`, `Σ I_m` de todo el horizonte; los «primer mes» recorren todo el horizonte.
 */
/** El detalle de la tarjeta COMPLETO (con ceros y nulos); `tarjetaCompacta` le quita lo que no viaja. */
export type DetalleTarjetaCalculado = {
  saldo_primer_mes: number;
  exceso_primer_mes: number;
  en_camino_primer_mes: { periodo: Mes; unidades: number } | null;
  falta_desde: Mes | null;
};

export function resumenTarjeta(fila: FilaCalculada, n: number): { resumen: ResumenFilaApi; detalle: DetalleTarjetaCalculado } {
  const meses = fila.proyeccion.meses;
  const tarjeta = meses.slice(0, n);
  const primero = (pred: (m: MesProyectado) => boolean): Mes | null => meses.find(pred)?.periodo ?? null;
  const iFalta = meses.findIndex((m) => m.saldo > 0);
  const iExceso = meses.findIndex((m) => m.exceso > 0);
  const iCamino = meses.findIndex((m) => m.ingresos > 0);
  let faltaDesde: Mes | null = null;
  if (iFalta >= 0) {
    let hueco = false;
    for (let i = iFalta + 1; i < meses.length; i++) {
      if (meses[i].saldo <= 0) hueco = true;
      else if (hueco) {
        faltaDesde = meses[i].periodo;
        break;
      }
    }
  }
  const sinCurva = fila.sin_curva;
  return {
    resumen: {
      senal: sinCurva ? "sin_curva" : peorSenal(tarjeta.length === 0 ? ["sin_demanda"] : tarjeta.map((m) => m.senal)),
      imi_k: fila.proyeccion.imi_k === null ? null : r1(fila.proyeccion.imi_k),
      vpm_k: sinCurva || meses.length === 0 ? null : r1(fila.proyeccion.vpm_k),
      vpm_real_k: r1n(fila.vpm_real_k),
      saldo_n_meses: u(tarjeta.reduce((a, m) => a + m.saldo, 0)),
      en_camino: u(meses.reduce((a, m) => a + m.ingresos, 0)),
      primer_mes_falta: primero((m) => m.saldo > 0),
      exceso_desde: primero((m) => m.exceso > 0),
      primer_mes_fuera_de_rango: primero((m) => m.fuera_de_rango),
      por_confirmar: u(fila.por_confirmar),
      posible_doble_conteo: u(fila.posible_doble_conteo),
    },
    detalle: {
      saldo_primer_mes: iFalta < 0 ? 0 : u(meses[iFalta].saldo),
      exceso_primer_mes: iExceso < 0 ? 0 : u(meses[iExceso].exceso),
      en_camino_primer_mes: iCamino < 0 ? null : { periodo: meses[iCamino].periodo, unidades: u(meses[iCamino].ingresos) },
      falta_desde: faltaDesde,
    },
  };
}

// ─── Serialización (redondea aquí) ───

/** Nombres que el servicio arma una sola vez: nodos por `equivalencia_id ?? gml_id`, agrupaciones, marcas y responsables. */
export type NombresFlujo = CatalogoFlujoApi & { marcas: Record<string, string> };

const nodoDe = (nombres: NombresFlujo, f: ClaveFila) => nombres.nodos[f.equivalencia_id ?? f.gml_id] ?? nombres.nodos[f.gml_id];

/** «HOMBRE · FORMAL · CAMISA › MANGA LARGA» (la ruta de un nodo, con la equivalencia si la hay). */
export function rutaDe(nodo: { genero: string; mundo: string; linea: string; equivalencia: string | null }): string {
  return `${nodo.genero} · ${nodo.mundo} · ${nodo.linea}${nodo.equivalencia ? ` › ${nodo.equivalencia}` : ""}`;
}

/** Una serie de la lista: `[k', k'+1 … H]`, unidades enteras, IMI con un decimal, señales de un carácter por periodo. */
export function aSerieFlujoApi(fila: FilaCalculada): SerieFlujoApi {
  const p = fila.proyeccion;
  const k = {
    demanda: fila.venta_k,
    ingresos: fila.ingreso_inferido_k ?? 0,
  };
  return {
    demanda: [u(k.demanda), ...p.meses.map((m) => u(m.demanda))],
    ingresos: [u(k.ingresos), ...p.meses.map((m) => u(m.ingresos))],
    reposicion: fila.tiene_subflujos ? [0, ...p.meses.map((m) => u(m.reposicion))] : null,
    stock: [u(p.stock_k), ...p.meses.map((m) => u(m.stock))],
    imi: [r1n(p.imi_k), ...p.meses.map((m) => r1n(m.imi))],
    saldo: [0, ...p.meses.map((m) => u(m.saldo))],
    exceso: [0, ...p.meses.map((m) => u(m.exceso))],
    senal: CARACTER_SENAL_K + p.meses.map((m) => CARACTER_SENAL[m.senal]).join(""),
    fuera_de_rango: (p.fuera_de_rango_k ? "1" : "0") + p.meses.map((m) => (m.fuera_de_rango ? "1" : "0")).join(""),
  };
}

/** Las series de los totales (el IMI sin las filas sin curva). */
export function aTotalesApi(t: TotalesCalculados): SerieFlujoApi {
  return {
    demanda: t.demanda.map(u),
    ingresos: t.ingresos.map(u),
    reposicion: t.reposicion ? t.reposicion.map(u) : null,
    stock: t.stock.map(u),
    imi: t.imi.map(r1n),
    saldo: t.saldo.map(u),
    exceso: t.exceso.map(u),
    senal: CARACTER_SENAL_K + t.senal.slice(1).map((s) => CARACTER_SENAL[s]).join(""),
    fuera_de_rango: t.fuera_de_rango.map((x) => (x ? "1" : "0")).join(""),
  };
}

function aMesProyectadoApi(m: MesProyectado): MesFlujoApi {
  return {
    periodo: m.periodo,
    real: false,
    demanda: u(m.demanda),
    ingresos: u(m.ingresos),
    ingreso_inferido: null,
    salida_inferida: null,
    recepciones_registradas: null,
    stock_fin: u(m.stock),
    vpm: m.vpm > 0 ? r1(m.vpm) : null,
    imi: r1n(m.imi),
    objetivo_min: u(m.objetivo),
    tope: u(m.tope),
    saldo: u(m.saldo),
    exceso: u(m.exceso),
    senal: m.senal,
    fuera_de_rango: m.fuera_de_rango,
    extendido: m.extendido,
  };
}

/** El mes `k'` de una fila o de un componente: real, con el ingreso inferido y las recepciones de ese mes. */
function mesKApi(periodo: Mes, p: { stock_k: number; vpm_k: number; imi_k: number | null; fuera_de_rango_k: boolean; rango: { imi_min: number; imi_max: number } }, k: { venta: number; ingreso: number | null; salida: number | null; recepciones: number }): MesFlujoApi {
  return {
    periodo,
    real: true,
    demanda: u(k.venta),
    ingresos: u(k.ingreso ?? 0),
    ingreso_inferido: k.ingreso === null ? null : u(k.ingreso),
    salida_inferida: k.salida === null ? null : u(k.salida),
    recepciones_registradas: u(k.recepciones),
    stock_fin: u(p.stock_k),
    vpm: p.vpm_k > 0 ? r1(p.vpm_k) : null,
    imi: r1n(p.imi_k),
    objetivo_min: u(p.rango.imi_min * p.vpm_k),
    tope: u(p.rango.imi_max * p.vpm_k),
    saldo: 0,
    exceso: 0,
    senal: "al_dia",
    fuera_de_rango: p.fuera_de_rango_k,
    extendido: false,
  };
}

/** `MesFlujoApi[]` de la fila: `k'` (real) y el horizonte. */
export function aMesesApi(fila: FilaCalculada, rangoGeneral: { imi_min: number; imi_max: number }, kPrima: Mes): MesFlujoApi[] {
  const p = fila.proyeccion;
  return [
    mesKApi(kPrima, { ...p, rango: rangoGeneral }, { venta: fila.venta_k, ingreso: fila.ingreso_inferido_k, salida: fila.salida_inferida_k, recepciones: fila.recepciones_k }),
    ...p.meses.map(aMesProyectadoApi),
  ];
}

function subflujosResumenApi(fila: FilaCalculada, nombres: NombresFlujo): FilaFlujoApi["subflujos_resumen"] {
  return fila.proyeccion.subflujos.map((s) => ({
    marca: nombres.marcas[s.marca_id] ?? s.marca_id,
    senal: s.senal_resumen,
    imi_k: r1n(s.componente.imi_k),
    rango: [s.regla.imi_min, s.regla.imi_max] as [number, number],
  }));
}

/** El resumen de la lista: el de la fila sin los campos que solo usan el detalle y las tarjetas (ver `ResumenListaApi`). */
function aResumenLista(r: ResumenFilaApi): ResumenListaApi {
  return {
    senal: r.senal,
    imi_k: r.imi_k,
    vpm_k: r.vpm_k,
    saldo_n_meses: r.saldo_n_meses,
    en_camino: r.en_camino,
    por_confirmar: r.por_confirmar,
    posible_doble_conteo: r.posible_doble_conteo,
  };
}

/** La fila de la lista: `serie` en lugar de `meses`, sin nombres (van en el `catalogo`). */
export function aFilaListaApi(fila: FilaCalculada, nombres: NombresFlujo, mesesTarjeta: number): FilaFlujoListaApi {
  return {
    gml_id: fila.gml_id,
    equivalencia_id: fila.equivalencia_id,
    agrupacion_marca_id: fila.agrupacion_marca_id,
    mia: fila.mia,
    stock_k: { cd: u(fila.stock_k.cd), tiendas: u(fila.stock_k.tiendas), total: u(fila.stock_k.total) },
    subflujos_resumen: subflujosResumenApi(fila, nombres),
    resumen: aResumenLista(resumenTarjeta(fila, mesesTarjeta).resumen),
    avisos: fila.avisos,
    serie: aSerieFlujoApi(fila),
  };
}

/** `FilaFlujoApi` completa (con `meses` y los nombres), la base del detalle y de las tarjetas. */
export function aFilaFlujoApi(fila: FilaCalculada, nombres: NombresFlujo, kPrima: Mes, parametros: ParametrosCalculo, mesesTarjeta = parametros.meses_tarjeta): FilaFlujoApi {
  const nodo = nodoDe(nombres, fila);
  return {
    gml_id: fila.gml_id,
    equivalencia_id: fila.equivalencia_id,
    agrupacion_marca_id: fila.agrupacion_marca_id,
    genero: nodo?.genero ?? "—",
    mundo: nodo?.mundo ?? "—",
    linea: nodo?.linea ?? "—",
    equivalencia: nodo?.equivalencia ?? null,
    agrupacion_marca: nombres.agrupaciones[fila.agrupacion_marca_id] ?? "—",
    nivel: nodo?.nivel ?? (fila.equivalencia_id === null ? "GML" : "GMLE"),
    responsable: nodo ? (nombres.responsables[`${nodo.genero_id}|${nodo.mundo_id}`] ?? null) : null,
    mia: fila.mia,
    stock_k: { cd: u(fila.stock_k.cd), tiendas: u(fila.stock_k.tiendas), total: u(fila.stock_k.total) },
    meses: aMesesApi(fila, { imi_min: parametros.imi_min, imi_max: parametros.imi_max }, kPrima),
    subflujos_resumen: subflujosResumenApi(fila, nombres),
    resumen: resumenTarjeta(fila, mesesTarjeta).resumen,
    avisos: fila.avisos,
  };
}

/** La tarjeta sin sus nombres: un campo en cero o nulo no viaja (ver `TarjetaHuecoApi`). */
function tarjetaCompacta(fila: FilaCalculada, resumen: ResumenFilaApi, detalle: DetalleTarjetaCalculado, nombres: NombresFlujo, nodo: number, agrupacion: number): TarjetaHuecoApi {
  const subflujos = subflujosResumenApi(fila, nombres);
  return {
    nodo,
    agrupacion,
    ...(fila.mia ? { mia: true as const } : {}),
    stock_k: { cd: u(fila.stock_k.cd), total: u(fila.stock_k.total) },
    resumen: {
      senal: resumen.senal,
      saldo_n_meses: resumen.saldo_n_meses,
      ...(resumen.imi_k === null ? {} : { imi_k: resumen.imi_k }),
      ...(resumen.en_camino === 0 ? {} : { en_camino: resumen.en_camino }),
      ...(resumen.primer_mes_falta === null ? {} : { primer_mes_falta: resumen.primer_mes_falta }),
      ...(resumen.exceso_desde === null ? {} : { exceso_desde: resumen.exceso_desde }),
      ...(resumen.por_confirmar === 0 ? {} : { por_confirmar: resumen.por_confirmar }),
      ...(resumen.posible_doble_conteo === 0 ? {} : { posible_doble_conteo: resumen.posible_doble_conteo }),
    },
    detalle: {
      ...(detalle.saldo_primer_mes === 0 ? {} : { saldo_primer_mes: detalle.saldo_primer_mes }),
      ...(detalle.exceso_primer_mes === 0 ? {} : { exceso_primer_mes: detalle.exceso_primer_mes }),
      ...(detalle.en_camino_primer_mes ? { en_camino_primer_mes: detalle.en_camino_primer_mes } : {}),
      ...(detalle.falta_desde ? { falta_desde: detalle.falta_desde } : {}),
    },
    ...(subflujos.length === 0 ? {} : { subflujos_resumen: subflujos }),
  };
}

/**
 * Las tarjetas de Huecos y su catálogo, ordenadas por saldo descendente (a igualdad, por ruta, para un orden estable) para los
 * próximos `n` meses. El catálogo trae solo lo que aparece en las tarjetas; `generos`, `mundos`, `lineas`, `nodos` y `agrupaciones`
 * se llenan en el orden de aparición, así que la salida es determinista.
 */
export function armarHuecosApi(filas: readonly FilaCalculada[], nombres: NombresFlujo, n: number): { catalogo: CatalogoHuecosApi; tarjetas: TarjetaHuecoApi[] } {
  const items = filas.map((fila) => {
    const nodo = nodoDe(nombres, fila);
    const { resumen, detalle } = resumenTarjeta(fila, n);
    const agrupacion = nombres.agrupaciones[fila.agrupacion_marca_id] ?? "—";
    const ruta = `${nodo?.genero ?? "—"}|${nodo?.mundo ?? "—"}|${nodo?.linea ?? "—"}|${nodo?.equivalencia ?? ""}|${agrupacion}`;
    return { fila, nodo, resumen, detalle, agrupacion, ruta };
  });
  items.sort((a, b) => b.resumen.saldo_n_meses - a.resumen.saldo_n_meses || (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));

  const generos: string[] = [];
  const mundos: string[] = [];
  const lineas: string[] = [];
  const nodosCat: NodoHuecosApi[] = [];
  const agrupaciones: EntradaCatalogoHuecosApi[] = [];
  const responsables: CatalogoHuecosApi["responsables"] = {};
  const indice = { nodos: new Map<string, number>(), agrupaciones: new Map<string, number>() };
  const posicion = (lista: string[], nombre: string): number => {
    const i = lista.indexOf(nombre);
    if (i >= 0) return i;
    lista.push(nombre);
    return lista.length - 1;
  };

  const tarjetas = items.map(({ fila, nodo, resumen, detalle, agrupacion }) => {
    const claveNodo = `${fila.gml_id}|${fila.equivalencia_id ?? ""}`;
    let iNodo = indice.nodos.get(claveNodo);
    if (iNodo === undefined) {
      const iGenero = posicion(generos, nodo?.genero ?? "—");
      const iMundo = posicion(mundos, nodo?.mundo ?? "—");
      nodosCat.push({
        gml_id: fila.gml_id,
        ...(fila.equivalencia_id === null ? {} : { equivalencia_id: fila.equivalencia_id }),
        genero: iGenero,
        mundo: iMundo,
        linea: posicion(lineas, nodo?.linea ?? "—"),
        ...(nodo?.equivalencia ? { equivalencia: nodo.equivalencia } : {}),
      });
      iNodo = nodosCat.length - 1;
      indice.nodos.set(claveNodo, iNodo);
      const resp = nodo ? nombres.responsables[`${nodo.genero_id}|${nodo.mundo_id}`] : undefined;
      if (resp) responsables[`${iGenero}|${iMundo}`] = resp;
    }
    let iAgr = indice.agrupaciones.get(fila.agrupacion_marca_id);
    if (iAgr === undefined) {
      agrupaciones.push({ id: fila.agrupacion_marca_id, nombre: agrupacion });
      iAgr = agrupaciones.length - 1;
      indice.agrupaciones.set(fila.agrupacion_marca_id, iAgr);
    }
    return tarjetaCompacta(fila, resumen, detalle, nombres, iNodo, iAgr);
  });
  return { catalogo: { generos, mundos, lineas, nodos: nodosCat, agrupaciones, responsables }, tarjetas };
}

function filaConciliacionApi(base: { gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string; ruta: string; agrupacion_marca: string; mia: boolean }, m: MesConciliado, marca: { id: string; nombre: string; pct_regla: number; pct_observado: number | null } | null): ConciliacionFilaApi {
  return {
    gml_id: base.gml_id,
    equivalencia_id: base.equivalencia_id,
    agrupacion_marca_id: base.agrupacion_marca_id,
    ruta: base.ruta,
    agrupacion_marca: base.agrupacion_marca,
    marca_id: marca?.id ?? null,
    marca: marca?.nombre ?? null,
    periodo: m.periodo,
    venta: u(m.venta),
    stock_inicio: m.stock_inicio === null ? null : u(m.stock_inicio),
    stock_fin: u(m.stock_fin),
    ingreso_inferido: m.ingreso_inferido === null ? null : u(m.ingreso_inferido),
    salida_inferida: m.salida_inferida === null ? null : u(m.salida_inferida),
    recepciones_registradas: u(m.recepciones_registradas),
    entregas_programadas: u(m.entregas_programadas),
    sin_registrar: u(m.sin_registrar),
    sin_respaldo: u(m.sin_respaldo),
    avisos: m.avisos,
    sugerencias: m.sugerencias,
    pct_directo_observado: marca ? armarPctDirectoObservado(m.periodo, marca.pct_observado) : null,
    pct_directo_regla: marca?.pct_regla ?? null,
    mia: base.mia,
  };
}

/** Las filas de conciliación de una fila (la completa y, debajo, la de cada marca con subflujo) de UN mes; vacío si el mes no se concilió. */
export function aConciliacionFilaApi(fila: FilaCalculada, periodo: Mes, nombres: NombresFlujo): ConciliacionFilaApi[] {
  const m = fila.conciliacion.find((x) => x.periodo === periodo);
  if (!m) return [];
  const nodo = nodoDe(nombres, fila);
  const base = {
    gml_id: fila.gml_id,
    equivalencia_id: fila.equivalencia_id,
    agrupacion_marca_id: fila.agrupacion_marca_id,
    ruta: nodo ? rutaDe(nodo) : "—",
    agrupacion_marca: nombres.agrupaciones[fila.agrupacion_marca_id] ?? "—",
    mia: fila.mia,
  };
  const salida = [filaConciliacionApi(base, m, null)];
  for (const cm of fila.conciliacion_marcas) {
    const mm = cm.meses.find((x) => x.periodo === periodo);
    if (!mm) continue;
    salida.push(filaConciliacionApi(base, { ...mm, sugerencias: [] }, { id: cm.marca_id, nombre: nombres.marcas[cm.marca_id] ?? cm.marca_id, pct_regla: cm.pct_directo_regla, pct_observado: mm.pct_directo_observado }));
  }
  return salida;
}

const sinActividad = (m: MesConciliado) => m.venta === 0 && m.stock_fin === 0 && (m.stock_inicio ?? 0) === 0 && m.recepciones_registradas === 0 && m.entregas_programadas === 0;

/**
 * `GET /api/flujo/conciliacion` de un mes: las filas con actividad (y las de marca de las filas con subflujo), los totales de las filas
 * completas y los avisos del mes. `null` si el mes no está publicado (`404 sin_mes`). `incluir` aplica los filtros de género, mundo,
 * línea y «mis líneas» que decide el servicio.
 */
export function armarConciliacionApi(res: ResultadoFlujo, periodo: Mes, nombres: NombresFlujo, opciones: { incluir?: (fila: FilaCalculada) => boolean; solo?: SoloConciliacion } = {}): ConciliacionApi | null {
  if (!res.meses_publicados.has(periodo)) return null;
  const filtradas = res.filas.filter((f) => (opciones.incluir ? opciones.incluir(f) : true));
  const solo = opciones.solo;
  const filas: ConciliacionFilaApi[] = [];
  const completas: ConciliacionFilaApi[] = [];
  for (const f of filtradas) {
    const m = f.conciliacion.find((x) => x.periodo === periodo);
    if (!m || sinActividad(m)) continue;
    if (solo === "sin_registrar" && !m.avisos.includes("ingreso_sin_registrar")) continue;
    if (solo === "sin_respaldo" && !m.avisos.includes("recepcion_sin_respaldo")) continue;
    if (solo === "entregas_vencidas" && f.por_confirmar <= 0) continue;
    if (solo === "por_confirmar" && m.sugerencias.length === 0) continue;
    const api = aConciliacionFilaApi(f, periodo, nombres);
    completas.push(api[0]);
    filas.push(...api);
  }
  filas.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : a.agrupacion_marca < b.agrupacion_marca ? -1 : a.agrupacion_marca > b.agrupacion_marca ? 1 : (a.marca ?? "") < (b.marca ?? "") ? -1 : (a.marca ?? "") > (b.marca ?? "") ? 1 : 0));

  const suma = (f: (x: ConciliacionFilaApi) => number) => completas.reduce((a, x) => a + f(x), 0);
  const totales: TotalesConciliacionApi = {
    venta: suma((x) => x.venta),
    ingreso_inferido: suma((x) => x.ingreso_inferido ?? 0),
    salida_inferida: suma((x) => x.salida_inferida ?? 0),
    recepciones_registradas: suma((x) => x.recepciones_registradas),
    entregas_programadas: suma((x) => x.entregas_programadas),
    sin_registrar: suma((x) => x.sin_registrar),
    sin_respaldo: suma((x) => x.sin_respaldo),
  };
  const contar = (aviso: AvisoConciliacion) => completas.filter((x) => x.avisos.includes(aviso));
  const avisos: ConciliacionApi["avisos"] = [];
  for (const aviso of ["sin_mes_anterior", "salida_neta", "ingreso_sin_registrar", "recepcion_sin_respaldo", "reclasificacion_probable"] as const) {
    const filasConAviso = contar(aviso);
    if (filasConAviso.length === 0) continue;
    avisos.push({ aviso, filas: filasConAviso.length, unidades: aviso === "salida_neta" ? -filasConAviso.reduce((a, x) => a + (x.salida_inferida ?? 0), 0) : null });
  }
  return { periodo, mes_anterior_publicado: res.meses_publicados.has(sumarMes(periodo, -1)), filas, totales, avisos };
}

function subflujoApi(fila: FilaCalculada, s: SubflujoProyectado, res: ResultadoFlujo, nombres: NombresFlujo): SubflujoApi {
  const cm = fila.conciliacion_marcas.find((x) => x.marca_id === s.marca_id);
  const mesK = cm?.meses.find((x) => x.periodo === res.k_prima);
  const rango = { imi_min: s.regla.imi_min, imi_max: s.regla.imi_max };
  const meses = [
    {
      ...mesKApi(res.k_prima, { ...s.componente, rango }, { venta: mesK?.venta ?? 0, ingreso: mesK?.ingreso_inferido ?? null, salida: mesK?.salida_inferida ?? null, recepciones: mesK?.recepciones_registradas ?? 0 }),
      reposicion_esperada: 0,
    },
    ...s.componente.meses.map((m) => ({ ...aMesProyectadoApi(m), reposicion_esperada: u(m.reposicion) })),
  ];
  return {
    marca_id: s.marca_id,
    marca: nombres.marcas[s.marca_id] ?? s.marca_id,
    regla_id: s.regla.id,
    imi_min: s.regla.imi_min,
    imi_max: s.regla.imi_max,
    pct_directo: s.regla.pct_directo,
    pct_directo_observado: mesK ? armarPctDirectoObservado(mesK.periodo, mesK.pct_directo_observado) : null,
    pct_directo_observado_12m: cm ? pctDirectoObservado12m(cm.meses) : null,
    part: s.part,
    stock_k: u(s.stock_k),
    meses,
    resumen: { senal: s.senal_resumen, imi_k: r1n(s.componente.imi_k), saldo_n_meses: u(s.saldo_n_meses) },
  };
}

/** El detalle de una fila (`GET /api/flujo/fila`): historia de doce meses, al barrer, subflujos, resto, conciliación y entregas. */
export function aFilaDetalleApi(fila: FilaCalculada, res: ResultadoFlujo, nombres: NombresFlujo): FilaFlujoDetalleApi {
  const base = aFilaFlujoApi(fila, nombres, res.k_prima, res.parametros);
  const entregas: EntregaDetalleApi[] = fila.entregas.map((c) => ({
    compra_id: c.compra_id,
    numero: c.compra_numero,
    proveedor: c.proveedor_nombre,
    linea_id: c.linea_id,
    entrega_id: c.entrega_id,
    tipo: c.tipo,
    marca: c.marca_id ? (nombres.marcas[c.marca_id] ?? null) : null,
    agrupacion_marca: nombres.agrupaciones[c.agrupacion_marca_id ?? fila.agrupacion_marca_id] ?? nombres.agrupaciones[fila.agrupacion_marca_id] ?? "—",
    tallas: c.tallas,
    unidades: u(c.unidades),
    pendiente: u(c.pendiente),
    periodo: c.periodo,
    vencida: c.vencida,
    estado: c.estado,
  }));
  const conciliacion = meses12De(res).flatMap((m) => aConciliacionFilaApi(fila, m, nombres));
  return {
    ...base,
    historia: fila.historia.map((h) => ({ periodo: h.periodo, venta: u(h.venta), stock_fin: u(h.stock_fin), ingreso_inferido: h.ingreso_inferido === null ? null : u(h.ingreso_inferido) })),
    al_barrer: fila.al_barrer.map((a) => ({ periodo: a.periodo, marcas: a.marcas.map((m) => ({ marca_id: m.marca_id, marca: nombres.marcas[m.marca_id] ?? m.marca_id, unidades: u(m.unidades) })) })),
    subflujos: fila.proyeccion.subflujos.map((s) => subflujoApi(fila, s, res, nombres)),
    resto: fila.proyeccion.resto ? { meses: [mesKApi(res.k_prima, fila.proyeccion.resto, { venta: 0, ingreso: null, salida: null, recepciones: 0 }), ...fila.proyeccion.resto.meses.map(aMesProyectadoApi)] } : null,
    conciliacion,
    entregas,
  };
}

/** `k'−11 … k'` del resultado. */
export const meses12De = (res: Pick<ResultadoFlujo, "k_prima">): Mes[] => mesesEntre(sumarMes(res.k_prima, -11), res.k_prima);

/** Las demandas totales del horizonte de una fila (útil para pesar «Distribuir por estacionalidad» en `0.13.1`). */
export const demandaDeLaFila = (fila: FilaCalculada): { periodo: Mes; demanda: number }[] => fila.proyeccion.meses.map((m) => ({ periodo: m.periodo, demanda: m.demanda }));

export { posibleDobleConteo };
