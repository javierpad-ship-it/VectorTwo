import "server-only";
import type { NextResponse } from "next/server";
import { errorConCodigo } from "@/lib/api/respuestas";
import { hastaPorDefecto } from "@/lib/curvas/anios";
import { leerVigentes } from "@/lib/intercompany/servicio";
import { construirConfigFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { huellaFlujo } from "@/lib/marcas-barrer/huellas";
import { leerRepartosVigentes } from "@/lib/marcas-barrer/servicio";
import { temporadasDeVersion } from "@/lib/marcas-barrer/reglas";
import { leerCerradaParaFlujo, type CerradaParaFlujo } from "@/lib/proyeccion/servicio";
import { falla, fallaDb, fallaMensaje, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { hoyLima } from "@/lib/tiendas/estado";
import { ESTADO_HTTP_ERROR_COMPRA } from "@/lib/compras/tipos-api";
import type { CompraRegistro, DestinoCompra, EntregaRegistro, LineaRegistro, Mes, RecepcionRegistro, RepartoRegistro, TipoLinea } from "@/lib/compras/tipos";
import { cacheResultado, cacheStock, contar, lecturaCacheada, type CacheLectura } from "./cache";
import { guardarParametrosDb, leerConfiguracion, leerHuellaBase, leerParametrosDb, leerRegistrosCompras, leerStockFlujo, type ConfiguracionLeida, type ParametrosDb } from "./consultas";
import type { ParametrosFlujo, ConciliacionQuery, FilaQuery, FlujoQuery } from "./esquemas";
import { claveDeFila, mesesEntre, planHorizonte, sumarMes, type ClaveFila, type PlanHorizonte } from "./filas";
import { clavesCache, huellaCalculoFlujo, type ClavesCache } from "./huella";
import { extenderDemanda, fueraDeRango, imi, vpm } from "./imi";
import type { ResolverMarcas } from "./ingresos";
import { validarAceptacion } from "./conciliacion";
import {
  aConciliacionFilaApi,
  aFilaDetalleApi,
  aFilaListaApi,
  aTarjetaHuecoApi,
  aTotalesApi,
  armarConciliacionApi,
  calcularFlujo,
  meses12De,
  ordenarTarjetas,
  resumenTarjeta,
  type EntradaCalculoFlujo,
  type FilaCalculada,
  type NodoFlujo,
  type NombresFlujo,
  type ParametrosCalculo,
  type RegistrosCompras,
  type ResultadoFlujo,
  type TotalesCalculados,
} from "./modelo";
import { esMia, type Combinacion } from "./mio";
import { stockPorFila, type StockMes } from "./stock";
import {
  IMI_MAX,
  IMI_MIN,
  MESES_TARJETA,
  PARALELO_STOCK,
  UMBRAL_CONCILIACION_PCT,
  UMBRAL_CONCILIACION_U,
  TEMPORADAS_DEFECTO,
  type HuellaBaseJson,
  type RelojFlujo,
  type StockFlujoJson,
} from "./tipos";
import {
  ESTADO_HTTP_ERROR_FLUJO,
  MENSAJE_ERROR_FLUJO,
  type CatalogoFlujoApi,
  type CodigoErrorFlujo,
  type ConciliacionApi,
  type ConciliacionFilaApi,
  type DatosFlujoApi,
  type FilaFlujoDetalleApi,
  type FlujoApi,
  type HuecosApi,
  type NodoCatalogoFlujoApi,
  type ParametrosFlujoApi,
  type RepartoFlujoApi,
  type ReglaFlujoApi,
  type SugerenciaApi,
} from "./tipos-api";

/**
 * Servicio del flujo de M8 (solo servidor; ficha 08, §0.2, §0.6, §3 y §5). Orquesta las lecturas (huella barata primero; después,
 * en paralelo, cerrada, stock, configuración, compras, reglas y repartos), arma la entrada de `calcularFlujo` y cachea el resultado
 * por huella. Nada aquí escribe compras: la única escritura es `flujo_parametros` (una fila). Las lecturas de M7, M12 y M13 van
 * SIEMPRE por sus servicios (`leerCerradaParaFlujo`, `leerRepartosVigentes`, `leerVigentes`): nunca por sus rutas (`requirePlanner`,
 * el comprador recibiría `403`) ni por sus tablas.
 *
 * El resultado cacheado es COMPARTIDO entre usuarios: se calcula sin «mis líneas» y la marca `mia` se pone por petición.
 */

// ─── Errores ───

/** La respuesta `{ error, codigo }` de un error del flujo, con su estado y su texto en castellano (lo usan también las rutas). */
export const respuestaDeErrorFlujo = (codigo: CodigoErrorFlujo, mensaje?: string): NextResponse =>
  errorConCodigo(mensaje ?? MENSAJE_ERROR_FLUJO[codigo], ESTADO_HTTP_ERROR_FLUJO[codigo], codigo);

const errorFlujo = (codigo: CodigoErrorFlujo, mensaje?: string): Salida<never> => falla(respuestaDeErrorFlujo(codigo, mensaje));

// ─── Parámetros ───

export const PARAMETROS_POR_DEFECTO: ParametrosFlujoApi = {
  imi_min: IMI_MIN,
  imi_max: IMI_MAX,
  meses_tarjeta: MESES_TARJETA,
  extender_horizonte: true,
  temporadas: TEMPORADAS_DEFECTO,
  umbral_conciliacion_u: UMBRAL_CONCILIACION_U,
  umbral_conciliacion_pct: UMBRAL_CONCILIACION_PCT,
  usuario_nombre: null,
  updated_at: null,
};

/** La fila de `flujo_parametros` en la forma de la API; sin fila (todavía no se guardó nada), los valores por defecto. */
export function aParametrosApi(fila: ParametrosDb | null): ParametrosFlujoApi {
  if (!fila) return { ...PARAMETROS_POR_DEFECTO, temporadas: temporadasDeVersion(null) };
  return {
    imi_min: Number(fila.imi_min),
    imi_max: Number(fila.imi_max),
    meses_tarjeta: fila.meses_tarjeta,
    extender_horizonte: fila.extender_horizonte,
    temporadas: temporadasDeVersion(fila.temporadas),
    umbral_conciliacion_u: fila.umbral_conciliacion_u,
    umbral_conciliacion_pct: Number(fila.umbral_conciliacion_pct),
    usuario_nombre: fila.usuario_nombre,
    updated_at: fila.updated_at,
  };
}

/** `GET /api/flujo/parametros`. */
export async function leerParametros(d: Db): Promise<Salida<ParametrosFlujoApi>> {
  const r = await leerParametrosDb(d);
  if (r.error) return fallaDb(r.error, "flujo: leer los parámetros");
  return listo(aParametrosApi(r.data));
}

export type ActorFlujo = { id: string; nombre: string | null };

/** `PUT /api/flujo/parametros`: reemplaza la fila única. Cambiar las temporadas deja obsoletos los repartos de M12 (su `huella_config`). */
export async function guardarParametros(d: Db, cuerpo: ParametrosFlujo, actor: ActorFlujo): Promise<Salida<ParametrosFlujoApi>> {
  const r = await guardarParametrosDb(d, { ...cuerpo, perfil_id: actor.id, usuario_nombre: actor.nombre });
  if (r.error) return fallaDb(r.error, "flujo: guardar los parámetros");
  return listo(aParametrosApi(r.data));
}

const aParametrosCalculo = (p: ParametrosFlujoApi): ParametrosCalculo => ({
  imi_min: p.imi_min,
  imi_max: p.imi_max,
  meses_tarjeta: p.meses_tarjeta,
  extender_horizonte: p.extender_horizonte,
  umbral_conciliacion_u: p.umbral_conciliacion_u,
  umbral_conciliacion_pct: p.umbral_conciliacion_pct,
});

// ─── Configuración (02b) y nombres ───

type Configuracion = ConfiguracionLeida & {
  config: ConfigFlujo;
  /** `huellaFlujo(config)` de HOY (para `config_cambiada`). */
  huella: string;
  nodos: Map<string, NodoFlujo>;
  resolver: ResolverMarcas;
  nombres: NombresFlujo;
  nombre_marca: Map<string, string>;
};

function construirNombres(c: ConfiguracionLeida): NombresFlujo {
  const nodos: Record<string, NodoCatalogoFlujoApi> = {};
  const indice = c.gml.estado.nodos;
  for (const n of indice.values()) {
    nodos[n.id] = {
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      genero: n.genero,
      mundo: n.mundo,
      linea: n.linea,
      equivalencia: null,
      nivel: n.nivel_planificacion === "GMLE" ? "GMLE" : "GML",
    };
  }
  for (const e of c.equivalencias) {
    const n = indice.get(e.genero_mundo_linea_id);
    if (!n) continue;
    nodos[e.id] = { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id, genero: n.genero, mundo: n.mundo, linea: n.linea, equivalencia: e.nombre, nivel: "GMLE" };
  }
  const responsables: CatalogoFlujoApi["responsables"] = {};
  for (const a of c.asignaciones) responsables[`${a.genero_id}|${a.mundo_id}`] = { perfil_id: a.perfil_id, nombre: c.perfiles.get(a.perfil_id) ?? "—" };
  return {
    nodos,
    agrupaciones: Object.fromEntries(c.gml.estado.agrupaciones.map((a) => [a.id, a.nombre])),
    responsables,
    marcas: Object.fromEntries(c.gml.estado.marcas.map((m) => [m.id, m.nombre])),
  };
}

function armarConfiguracion(c: ConfiguracionLeida): Configuracion {
  const config = construirConfigFlujo(c.gml.estado, c.equivalencias.map((e) => ({ id: e.id, genero_mundo_linea_id: e.genero_mundo_linea_id })));
  const unidadDe = (id: string) => config.unidadDe.get(id) ?? id;
  const nombres = construirNombres(c);
  return {
    ...c,
    config,
    huella: huellaFlujo(config),
    nodos: new Map([...c.gml.estado.nodos.values()].map((n) => [n.id, { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id }])),
    resolver: { unidadDeMarca: unidadDe, agrupacionDeMarca: (id) => config.marcas.get(unidadDe(id))?.agrupacion_marca_id ?? null },
    nombres,
    nombre_marca: new Map(Object.entries(nombres.marcas)),
  };
}

// ─── Lecturas cacheadas ───

/** Ejecuta `f` sobre cada elemento con a lo sumo `limite` en vuelo; conserva el orden. */
async function enParalelo<T, R>(items: readonly T[], limite: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(items.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= items.length) return;
      salida[i] = await f(items[i]);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

/** El JSON de `stock_flujo` de una carga: inmutable mientras siga publicada (LRU de 26 meses por `carga_id`). */
function stockDeCarga(d: Db, cargaId: string): Promise<Salida<StockFlujoJson>> {
  return cacheStock.obtener(cargaId, async () => {
    contar("stock");
    const r = await leerStockFlujo(d, cargaId);
    if (r.error || !r.data) return fallaDb(r.error as NonNullable<typeof r.error>, "flujo: leer el stock del mes");
    return listo(r.data);
  });
}

// ─── El flujo calculado ───

export type FlujoCalculado = {
  /** `huellaCalculoFlujo`: cambia si cambia cualquier cosa que el cálculo lea. */
  huella: string;
  k_prima: Mes;
  plan: PlanHorizonte;
  cerrada: CerradaParaFlujo;
  parametros: ParametrosFlujoApi;
  configuracion: Configuracion;
  entrada: EntradaCalculoFlujo;
  /** SIN «mis líneas» (`mia = false`): compartido entre usuarios. */
  resultado: ResultadoFlujo;
  repartos: RepartoFlujoApi[];
  reglas: ReglaFlujoApi[];
  por_clave: Map<string, FilaCalculada>;
  /** `compra_id → revision` de las compras que cuentan (para `SugerenciaApi.revision`). */
  revision_por_compra: Map<string, number>;
  /** `entrega_id →` la sugerencia de la conciliación (mes X y unidades). */
  sugerencias: Map<string, { periodo: Mes; unidades: number }>;
};

/** Texto de la clave del stock de filas: depende de las cargas publicadas, de la configuración de marcas y de `k'`. */
const claveStockFilas = (c: ClavesCache, kp: Mes) => `${c.cargas}|${c.config}|${kp}`;

/**
 * Una sola sugerencia por entrega para la pantalla de compras: la del mes más antiguo (en un lote, las unidades de ese mes se suman
 * entre sus filas).
 */
export function sugerenciasPorEntrega(filas: readonly FilaCalculada[]): Map<string, { periodo: Mes; unidades: number }> {
  const por = new Map<string, Map<Mes, number>>();
  for (const f of filas) {
    for (const m of f.conciliacion) {
      for (const s of m.sugerencias) {
        let meses = por.get(s.entrega_id);
        if (!meses) {
          meses = new Map();
          por.set(s.entrega_id, meses);
        }
        meses.set(m.periodo, (meses.get(m.periodo) ?? 0) + s.unidades);
      }
    }
  }
  const salida = new Map<string, { periodo: Mes; unidades: number }>();
  for (const [entrega, meses] of por) {
    const primero = [...meses.keys()].sort()[0];
    salida.set(entrega, { periodo: primero, unidades: meses.get(primero) ?? 0 });
  }
  return salida;
}

/**
 * El flujo calculado con los datos de hoy. `flujo_huella_base()` primero (≤ 0,15 s, sin caché); si nada cambió, sale de la caché del
 * resultado; si cambió algo, solo se releen las lecturas cuya parte de la huella cambió (p. ej. tras confirmar un ingreso, solo las
 * compras). En frío, las lecturas van en paralelo.
 */
export async function obtenerFlujo(d: Db): Promise<Salida<FlujoCalculado>> {
  const base = await leerHuellaBase(d);
  if (base.error || !base.data) return fallaDb(base.error as NonNullable<typeof base.error>, "flujo: leer la huella");
  const huellaBase = base.data;
  const hoy = hoyLima();
  const mesLima = hoy.slice(0, 7);
  const huella = huellaCalculoFlujo(huellaBase, mesLima);
  return (cacheResultado as CacheLectura<FlujoCalculado>).obtener(huella, () => calcular(d, huellaBase, huella, hoy));
}

async function calcular(d: Db, huellaBase: HuellaBaseJson, huella: string, hoy: string): Promise<Salida<FlujoCalculado>> {
  const claves = clavesCache(huellaBase);
  const mesLima = hoy.slice(0, 7);

  const publicados = huellaBase.cargas.map((c) => c.periodo);
  const kPrima = hastaPorDefecto(publicados, hoy);
  if (kPrima === null) return errorFlujo("sin_mes", "Todavía no hay meses publicados en Venta y stock.");
  const plan = planHorizonte(kPrima, huellaBase.cerradas.map((c) => c.anio_en_curso));
  if (plan === null) return errorFlujo("sin_cerrada");

  const meses13 = mesesEntre(sumarMes(kPrima, -12), kPrima);
  const cargaDe = new Map(huellaBase.cargas.map((c) => [c.periodo, c.carga_id]));
  const conCarga = meses13.filter((m) => cargaDe.has(m));

  const [cerrada, configuracion, compras, reglas, repartos, parametros, stockCrudo] = await Promise.all([
    lecturaCacheada<CerradaParaFlujo>("cerrada", `${claves.cerradas}|${plan.anio}`, async () => {
      contar("cerrada");
      return leerCerradaParaFlujo(plan.anio);
    }),
    lecturaCacheada<Configuracion>("configuracion", claves.config, async () => {
      contar("configuracion");
      const r = await leerConfiguracion(d);
      if (r.error || !r.data) return fallaDb(r.error as NonNullable<typeof r.error>, "flujo: leer la configuración de marcas");
      return listo(armarConfiguracion(r.data));
    }),
    lecturaCacheada<RegistrosCompras>("compras", claves.compras, async () => {
      contar("compras");
      const r = await leerRegistrosCompras(d);
      if (r.error || !r.data) return fallaDb(r.error as NonNullable<typeof r.error>, "flujo: leer las compras");
      return listo(r.data);
    }),
    lecturaCacheada<ReglaFlujoApi[]>("reglas", `${claves.reglas}|${kPrima}|${plan.horizonte.hasta}`, async () => {
      contar("reglas");
      const r = await leerVigentes(d, sumarMes(kPrima, -11), plan.horizonte.hasta);
      if (r.respuesta) return falla(r.respuesta);
      return listo(
        r.data.reglas.map((x) => ({
          id: x.id,
          marca_id: x.marca_id,
          marca: x.marca,
          gml_id: x.genero_mundo_linea_id,
          equivalencia_id: x.equivalencia_id,
          vigente_desde: x.vigente_desde,
          hasta_derivado: x.hasta_derivado,
          imi_min: x.imi_min,
          imi_max: x.imi_max,
          pct_directo: x.pct_directo,
        }))
      );
    }),
    lecturaCacheada<RepartoFlujoApi[]>("repartos", claves.repartos, async () => {
      contar("repartos");
      const r = await leerRepartosVigentes(d, null);
      if (r.respuesta) return falla(r.respuesta);
      return listo(
        r.data.repartos.map((x) => ({
          marca_id: x.marca_id,
          marca: "",
          reparto_id: x.reparto_id,
          version: x.version,
          // `por_mes` no se usa para repartir lotes: sus filas traen la temporada como las de `por_temporada`.
          modo: x.modo === "anual" ? ("anual" as const) : ("por_temporada" as const),
          alcance: x.alcance,
          error_reparto_pp: x.error_reparto_pp,
          temporadas_usadas: x.temporadas_usadas,
          filas: x.filas,
        }))
      );
    }),
    lecturaCacheada<ParametrosFlujoApi>("parametros", claves.parametros, async () => {
      contar("parametros");
      return leerParametros(d);
    }),
    enParalelo(conCarga, PARALELO_STOCK, (m) => stockDeCarga(d, cargaDe.get(m) as string)),
  ]);
  for (const r of [cerrada, configuracion, compras, reglas, repartos, parametros]) if (r.respuesta) return falla(r.respuesta);
  for (const r of stockCrudo) if (r.respuesta) return falla(r.respuesta);
  const cfg = configuracion.data as Configuracion;

  // El stock repartido en filas depende de la configuración de marcas: se cachea por (cargas, configuración, k').
  const stock = await lecturaCacheada<Map<Mes, StockMes>>("stock_filas", claveStockFilas(claves, kPrima), async () => {
    contar("stock_filas");
    const mapa = new Map<Mes, StockMes>();
    conCarga.forEach((mes, i) => {
      const json = stockCrudo[i].data as StockFlujoJson;
      mapa.set(mes, { ...stockPorFila(json, cfg.config), periodo: mes });
    });
    return listo(mapa);
  });
  if (stock.respuesta) return falla(stock.respuesta);

  const cerradaData = cerrada.data as CerradaParaFlujo;
  const parametrosApi = parametros.data as ParametrosFlujoApi;
  const repartosApi = (repartos.data as RepartoFlujoApi[]).map((x) => ({ ...x, marca: cfg.nombre_marca.get(x.marca_id) ?? x.marca_id }));
  const reglasApi = reglas.data as ReglaFlujoApi[];
  const registros = compras.data as RegistrosCompras;

  const reloj: RelojFlujo = { k_prima: kPrima, k: cerradaData.proyeccion.hasta_periodo, hoy_lima: mesLima };
  const entrada: EntradaCalculoFlujo = {
    reloj,
    horizonte: plan.horizonte,
    cubre: plan.cubre,
    parametros: aParametrosCalculo(parametrosApi),
    cerrada: { filas: cerradaData.filas, version_metodo: cerradaData.version_metodo, huella_flujo: cerradaData.huella_flujo, periodo_referencia: cerradaData.periodo_referencia },
    huella_flujo_hoy: cfg.huella,
    stock: stock.data as Map<Mes, StockMes>,
    compras: registros,
    reglas: reglasApi,
    resolver: cfg.resolver,
    nodos: cfg.nodos,
    mis_combinaciones: [],
  };
  contar("calculos");
  const resultado = calcularFlujo(entrada);

  return listo({
    huella,
    k_prima: kPrima,
    plan,
    cerrada: cerradaData,
    parametros: parametrosApi,
    configuracion: cfg,
    entrada,
    resultado,
    repartos: repartosApi,
    reglas: reglasApi,
    por_clave: new Map(resultado.filas.map((f) => [f.clave, f])),
    revision_por_compra: new Map(registros.compras.map((c) => [c.id, c.revision])),
    sugerencias: sugerenciasPorEntrega(resultado.filas),
  });
}

// ─── Por petición: «mis líneas», filtros y serialización ───

/** Mis combinaciones género × mundo (M1b): de las que soy responsable. */
export function combinacionesDe(f: FlujoCalculado, perfilId: string): Combinacion[] {
  const vistas = new Set<string>();
  const salida: Combinacion[] = [];
  for (const a of f.configuracion.asignaciones) {
    const k = `${a.genero_id}|${a.mundo_id}`;
    if (a.perfil_id !== perfilId || vistas.has(k)) continue;
    vistas.add(k);
    salida.push({ genero_id: a.genero_id, mundo_id: a.mundo_id });
  }
  return salida;
}

const esDelNodo = (f: FlujoCalculado, gmlId: string): NodoFlujo | undefined => f.configuracion.nodos.get(gmlId);

/** La fila con su marca `mia` para este usuario (el resultado cacheado no la lleva). */
function conMia(f: FlujoCalculado, fila: FilaCalculada, combos: readonly Combinacion[]): FilaCalculada {
  const nodo = esDelNodo(f, fila.gml_id);
  return { ...fila, mia: nodo ? esMia({ genero_id: nodo.genero_id, mundo_id: nodo.mundo_id }, combos) : false };
}

type FiltrosArbol = { genero_id?: string; mundo_id?: string; linea_id?: string; agrupacion_marca_id?: string; mio?: boolean };

function pasaArbol(f: FlujoCalculado, fila: FilaCalculada, filtros: FiltrosArbol): boolean {
  const nodo = esDelNodo(f, fila.gml_id);
  if (filtros.genero_id !== undefined && nodo?.genero_id !== filtros.genero_id) return false;
  if (filtros.mundo_id !== undefined && nodo?.mundo_id !== filtros.mundo_id) return false;
  if (filtros.linea_id !== undefined && nodo?.linea_id !== filtros.linea_id) return false;
  if (filtros.agrupacion_marca_id !== undefined && fila.agrupacion_marca_id !== filtros.agrupacion_marca_id) return false;
  if (filtros.mio === true && !fila.mia) return false;
  return true;
}

/** El chip «Solo» de Huecos y Flujo: por la peor señal de los próximos `n` meses («Falta» incluye el quiebre: en los dos hay que comprar). */
function pasaSolo(fila: FilaCalculada, solo: FlujoQuery["solo"], n: number): boolean {
  if (solo === undefined) return true;
  if (solo === "por_confirmar") return fila.por_confirmar > 0;
  const senal = resumenTarjeta(fila, n).resumen.senal;
  if (solo === "falta") return senal === "falta" || senal === "quiebre";
  return senal === solo;
}

/**
 * Los totales de las filas dadas (sin las filas sin curva, §0.10): la suma por mes y el IMI de la suma con la demanda total extendida.
 * Es la misma aritmética que `calcularFlujo` aplica a todas las filas (la prueba compara los dos con el conjunto completo); aquí se
 * repite para que los totales SIGAN AL FILTRO del servidor (`modelo.ts` solo calcula los de todas las filas).
 */
export function totalesDeFilas(filas: readonly FilaCalculada[], n: number, parametros: ParametrosCalculo): TotalesCalculados {
  const utiles = filas.filter((f) => !f.sin_curva);
  const demanda = new Array<number>(n).fill(0);
  const ingresos = new Array<number>(n).fill(0);
  const stock = new Array<number>(n).fill(0);
  const saldo = new Array<number>(n).fill(0);
  const exceso = new Array<number>(n).fill(0);
  const reposicion = new Array<number>(n).fill(0);
  let stockK = 0;
  let ventaK = 0;
  let ingresoK = 0;
  for (const f of utiles) {
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
  const sinDemanda = demanda.every((x) => x === 0);
  return {
    demanda: [ventaK, ...demanda],
    ingresos: [ingresoK, ...ingresos],
    reposicion: reposicion.some((x) => x !== 0) ? [0, ...reposicion] : null,
    stock: [stockK, ...stock],
    imi: [imiK, ...imiMeses],
    saldo: [0, ...saldo],
    exceso: [0, ...exceso],
    senal: ["al_dia", ...stock.map((s, i) => (sinDemanda ? ("sin_demanda" as const) : s < 0 ? ("quiebre" as const) : saldo[i] > 0 ? ("falta" as const) : exceso[i] > 0 ? ("exceso" as const) : ("al_dia" as const)))],
    fuera_de_rango: [fueraDeRango(imiK, rango), ...imiMeses.map((x) => fueraDeRango(x, rango))],
  };
}

const compararTexto = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Orden humano y estable de las filas: género, mundo, línea, equivalencia y agrupación de marca (por nombre). */
function ordenarFilas(f: FlujoCalculado, filas: readonly FilaCalculada[]): FilaCalculada[] {
  const n = f.configuracion.nombres;
  const nodo = (x: FilaCalculada) => n.nodos[x.equivalencia_id ?? x.gml_id] ?? n.nodos[x.gml_id];
  const llave = (x: FilaCalculada) => {
    const p = nodo(x);
    return `${p?.genero ?? ""}|${p?.mundo ?? ""}|${p?.linea ?? ""}|${p?.equivalencia ?? ""}|${n.agrupaciones[x.agrupacion_marca_id] ?? ""}|${x.clave}`;
  };
  return [...filas].sort((a, b) => compararTexto(llave(a), llave(b)));
}

function catalogoDe(f: FlujoCalculado, filas: readonly FilaCalculada[]): CatalogoFlujoApi {
  const n = f.configuracion.nombres;
  const nodos: Record<string, NodoCatalogoFlujoApi> = {};
  const agrupaciones: Record<string, string> = {};
  for (const fila of filas) {
    const llave = fila.equivalencia_id ?? fila.gml_id;
    const nodo = n.nodos[llave] ?? n.nodos[fila.gml_id];
    if (nodo) nodos[nodo === n.nodos[llave] ? llave : fila.gml_id] = nodo;
    const agr = n.agrupaciones[fila.agrupacion_marca_id];
    if (agr !== undefined) agrupaciones[fila.agrupacion_marca_id] = agr;
  }
  return { nodos, agrupaciones, responsables: n.responsables };
}

function datosDe(f: FlujoCalculado): DatosFlujoApi {
  const r = f.resultado;
  const c = f.cerrada;
  return {
    cerrada: {
      id: c.proyeccion.id,
      nombre: c.proyeccion.nombre,
      hasta_periodo: c.proyeccion.hasta_periodo,
      anio_en_curso: c.proyeccion.anio_en_curso,
      version_metodo: c.version_metodo,
      periodo_referencia: c.periodo_referencia,
    },
    k: r.k,
    k_prima: r.k_prima,
    horizonte: r.horizonte,
    periodos: r.periodos,
    parametros: f.parametros,
    avisos: r.avisos,
    stock_excluido: r.stock_excluido,
    stock_sin_clave: Math.round(r.stock_sin_clave),
    por_confirmar: r.por_confirmar,
    filas_sin_curva: { filas: r.filas_sin_curva.filas, venta_anual: Math.round(r.filas_sin_curva.venta_anual), stock: Math.round(r.filas_sin_curva.stock) },
    huella: f.huella,
  };
}

/** Añade `revision` (la de la compra de la línea) a las sugerencias: el navegador acepta sin una lectura más. */
function conRevision(f: FlujoCalculado, fila: ConciliacionFilaApi): ConciliacionFilaApi {
  if (fila.sugerencias.length === 0) return fila;
  return { ...fila, sugerencias: fila.sugerencias.map((s): SugerenciaApi => ({ ...s, revision: f.revision_por_compra.get(s.compra_id) })) };
}

// ─── GET /api/flujo ───

export async function leerFlujo(d: Db, perfilId: string, q: FlujoQuery): Promise<Salida<FlujoApi>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const combos = combinacionesDe(f, perfilId);
  const meses = q.meses ?? f.parametros.meses_tarjeta;
  const todas = f.resultado.filas.map((x) => conMia(f, x, combos));
  const elegidas = ordenarFilas(f, todas.filter((x) => pasaArbol(f, x, { ...q, mio: q.mio }) && pasaSolo(x, q.solo, meses)));
  const n = f.resultado.periodos.length - 1;
  return listo({
    datos: datosDe(f),
    catalogo: catalogoDe(f, elegidas),
    filas: elegidas.map((x) => aFilaListaApi(x, f.configuracion.nombres, meses)),
    totales: aTotalesApi(totalesDeFilas(elegidas, n, f.resultado.parametros)),
    repartos_vigentes: f.repartos,
    reglas_intercompany: f.reglas,
    mis_combinaciones: combos,
  });
}

// ─── GET /api/flujo/huecos ───

export async function leerHuecos(d: Db, perfilId: string, q: FlujoQuery): Promise<Salida<HuecosApi>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const combos = combinacionesDe(f, perfilId);
  const meses = q.meses ?? f.parametros.meses_tarjeta;
  const filas = f.resultado.filas.map((x) => conMia(f, x, combos)).filter((x) => pasaArbol(f, x, q) && pasaSolo(x, q.solo, meses));
  return listo({
    datos: datosDe(f),
    meses,
    tarjetas: ordenarTarjetas(filas.map((x) => aTarjetaHuecoApi(x, f.configuracion.nombres, meses))),
    mis_combinaciones: combos,
  });
}

// ─── GET /api/flujo/fila ───

export async function leerFilaDetalle(d: Db, perfilId: string, q: FilaQuery): Promise<Salida<FilaFlujoDetalleApi>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const clave = claveDeFila({ gml_id: q.gml_id, equivalencia_id: q.equivalencia_id ?? null, agrupacion_marca_id: q.agrupacion_marca_id });
  const fila = f.por_clave.get(clave);
  if (!fila) return errorFlujo("fila_no_encontrada");
  const detalle = aFilaDetalleApi(conMia(f, fila, combinacionesDe(f, perfilId)), f.resultado, f.configuracion.nombres);
  return listo({ ...detalle, conciliacion: detalle.conciliacion.map((c) => conRevision(f, c)) });
}

// ─── GET /api/flujo/conciliacion ───

export async function leerConciliacion(d: Db, perfilId: string, q: ConciliacionQuery): Promise<Salida<ConciliacionApi>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const periodo = q.periodo ?? f.k_prima;
  // Solo se concilian los doce meses `k'−11 … k'` que estén publicados.
  if (!meses12De(f.resultado).includes(periodo)) return errorFlujo("sin_mes");
  const combos = combinacionesDe(f, perfilId);
  const res: ResultadoFlujo = { ...f.resultado, filas: f.resultado.filas.map((x) => conMia(f, x, combos)) };
  const conciliacion = armarConciliacionApi(res, periodo, f.configuracion.nombres, {
    incluir: (fila) => pasaArbol(f, fila, { genero_id: q.genero_id, mundo_id: q.mundo_id, linea_id: q.linea_id, mio: q.mio }),
    solo: q.solo,
  });
  if (conciliacion === null) return errorFlujo("sin_mes");
  return listo({ ...conciliacion, filas: conciliacion.filas.map((x) => conRevision(f, x)) });
}

// ─── «Aceptar sugerencia» (la parte del flujo; §0.5) ───

export type PedidoAceptar = { periodo: Mes; linea_id: string; entrega_id: string; unidades: number };

/**
 * Recalcula la sugerencia de la fila de esa entrega con los datos de hoy (caché por huella) y la valida contra lo pedido (regla 23):
 * sin sugerencia para esa entrega en ese periodo o proponiendo menos → `409 sugerencia_vencida`; una sugerencia de lote (sin botón en
 * `0.13.0`) → `409 tipo_no_disponible`; más unidades de las que le faltan a la entrega → `409 excede_pendiente`. La pertenencia (línea
 * de la compra, entrega de la línea) la comprobó antes quien llama.
 */
export async function validarSugerenciaVigente(d: Db, pedido: PedidoAceptar): Promise<Salida<{ sugerencia: SugerenciaApi; clave: string }>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const filas = f.resultado.filas.filter((x) => x.entregas.some((c) => c.linea_id === pedido.linea_id && c.entrega_id === pedido.entrega_id));
  const vigente = filas.find((x) => x.conciliacion.some((m) => m.periodo === pedido.periodo && m.sugerencias.some((s) => s.entrega_id === pedido.entrega_id)));
  if (!vigente) return errorFlujo("sugerencia_vencida");

  const candidata = vigente.entregas.find((c) => c.entrega_id === pedido.entrega_id);
  if (candidata && pedido.unidades > candidata.pendiente) {
    return fallaMensaje(
      `A esa entrega le faltan ${Math.round(candidata.pendiente)} u por ingresar y se pidieron ${pedido.unidades}.`,
      ESTADO_HTTP_ERROR_COMPRA.excede_pendiente,
      "excede_pendiente"
    );
  }
  const delMes = vigente.conciliacion.find((m) => m.periodo === pedido.periodo)?.sugerencias ?? [];
  const v = validarAceptacion(delMes, pedido);
  if (!v.ok) return errorFlujo(v.motivo);
  return listo({ sugerencia: v.sugerencia, clave: vigente.clave });
}

/**
 * La fila de conciliación (la completa, no la de una marca) de la fila de `clave` en `periodo`, recalculada con los datos de hoy:
 * así la diferencia baja sin recargar todo. Se llama DESPUÉS de escribir la recepción (la huella cambió: solo se releen las compras).
 */
export async function conciliacionDeFila(d: Db, perfilId: string, clave: string, periodo: Mes): Promise<Salida<ConciliacionFilaApi>> {
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;
  const fila = f.por_clave.get(clave);
  if (!fila) return errorFlujo("fila_no_encontrada");
  const api = aConciliacionFilaApi(conMia(f, fila, combinacionesDe(f, perfilId)), periodo, f.configuracion.nombres);
  if (api.length === 0) return errorFlujo("sin_mes");
  return listo(conRevision(f, api[0]));
}

// ─── Lo que las compras necesitan del flujo ───

/** Contexto que `src/lib/compras/servicio.ts` recibe por parámetro (no lo importa): `k'` y la sugerencia de cada entrega. */
export type ContextoParaCompras = { k_prima: Mes; sugerencias: ReadonlyMap<string, { periodo: Mes; unidades: number }> };

/**
 * `k'` y las sugerencias de la conciliación para pintar las compras. Si el flujo no se puede calcular (p. ej. todavía no hay una cerrada)
 * devuelve `null` y las compras siguen funcionando sin sugerencias: una lectura de compras nunca cae por el flujo.
 */
export async function contextoParaCompras(d: Db): Promise<ContextoParaCompras | null> {
  const r = await obtenerFlujo(d);
  if (r.respuesta) return null;
  return { k_prima: r.data.k_prima, sugerencias: r.data.sugerencias };
}

// ─── Aviso `exceso` del importador (informativo) ───

/** Una línea que el importador pretende crear (la forma la fija `src/lib/compras/servicio.ts`; aquí solo se lee). */
export type LineaHipotetica = {
  /** Número de fila del archivo: con él el importador pone el aviso en su línea. */
  fila: number;
  fecha_compra: string;
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  destino: DestinoCompra;
  unidades: number;
  entregas: { periodo: string; unidades: number }[];
  repartos: { entrega_periodo: string; marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number }[];
  recibidas: { recibida_periodo: string; unidades: number }[];
};

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;
const etiquetaMes = (mes: Mes) => `${MES_CORTO[Number(mes.slice(5, 7)) - 1] ?? "?"}-${mes.slice(0, 4)}`;
const enMiles = (n: number) => Math.round(n).toLocaleString("es-PE");

/**
 * Qué líneas nuevas dejan algún mes de su fila con MÁS exceso (stock sobre el tope de `imi_max` meses) que sin ellas: `fila → detalle`
 * («nov-2026: IMI 15,1 · exceso 1 127 u»). Calcula el flujo de hoy con las líneas añadidas como compras confirmadas (todas a la vez) y
 * lo compara con el flujo cacheado. Solo informa: la carga inicial no pide justificación (son compras ya hechas).
 */
export async function excesoDeLineasNuevas(d: Db, lineas: readonly LineaHipotetica[]): Promise<Salida<Map<number, string>>> {
  if (lineas.length === 0) return listo(new Map());
  const calculado = await obtenerFlujo(d);
  if (calculado.respuesta) return falla(calculado.respuesta);
  const f = calculado.data;

  const compras: CompraRegistro[] = [];
  const registros: LineaRegistro[] = [];
  const entregas: EntregaRegistro[] = [];
  const repartos: RepartoRegistro[] = [];
  const recepciones: RecepcionRegistro[] = [];
  const claves = new Map<number, Set<string>>();

  lineas.forEach((l, i) => {
    const compraId = `hip-c${i}`;
    const lineaId = `hip-l${i}`;
    compras.push({ id: compraId, numero: `(nueva ${l.fila})`, proveedor_id: "hip", proveedor_nombre: "(nueva)", origen: "carga_inicial", estado: "confirmada", fecha_compra: l.fecha_compra, moneda: "PEN", cancelada_at: null, revision: 0 });
    registros.push({
      id: lineaId,
      compra_id: compraId,
      tipo: l.tipo,
      genero_mundo_linea_id: l.genero_mundo_linea_id,
      equivalencia_id: l.equivalencia_id,
      marca_id: l.marca_id,
      agrupacion_marca_id: l.agrupacion_marca_id,
      tallas: "ambas",
      unidades: l.unidades,
      unidades_recibidas: l.recibidas.reduce((a, r) => a + r.unidades, 0),
      unidades_canceladas: 0,
      costo_unitario: null,
      destino: l.destino,
      tienda_id: null,
      alcance: {},
      activo: true,
    });
    const idEntrega = new Map<string, string>();
    l.entregas.forEach((e, j) => {
      const id = `hip-e${i}-${j}`;
      idEntrega.set(e.periodo.slice(0, 7), id);
      entregas.push({ id, linea_id: lineaId, periodo: e.periodo.slice(0, 7), unidades: e.unidades, origen: "importada" });
    });
    l.repartos.forEach((r) => {
      const entregaId = idEntrega.get(r.entrega_periodo.slice(0, 7));
      if (!entregaId) return;
      repartos.push({ linea_id: lineaId, entrega_id: entregaId, marca_id: r.marca_id, genero_mundo_linea_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, unidades: r.unidades, reparto_id: null, reparto_version: null, temporada: null, error_reparto_pp: null });
    });
    l.recibidas.forEach((r, j) => {
      recepciones.push({ id: `hip-r${i}-${j}`, linea_id: lineaId, recibida_periodo: r.recibida_periodo.slice(0, 7), unidades: r.unidades, fecha_recepcion: `${r.recibida_periodo.slice(0, 7)}-15`, origen: "importada" });
    });

    const afectadas = new Set<string>();
    const resolver = f.configuracion.resolver;
    if (l.tipo === "especifica") {
      const agr = l.agrupacion_marca_id ?? (l.marca_id ? resolver.agrupacionDeMarca(l.marca_id) : null);
      if (l.genero_mundo_linea_id && agr) afectadas.add(claveDeFila({ gml_id: l.genero_mundo_linea_id, equivalencia_id: l.equivalencia_id, agrupacion_marca_id: agr }));
    } else {
      for (const r of l.repartos) {
        const agr = resolver.agrupacionDeMarca(r.marca_id);
        if (agr) afectadas.add(claveDeFila({ gml_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, agrupacion_marca_id: agr }));
      }
    }
    claves.set(l.fila, afectadas);
  });

  const adicional: RegistrosCompras = {
    compras: [...f.entrada.compras.compras, ...compras],
    lineas: [...f.entrada.compras.lineas, ...registros],
    entregas: [...f.entrada.compras.entregas, ...entregas],
    repartos: [...f.entrada.compras.repartos, ...repartos],
    recepciones: [...f.entrada.compras.recepciones, ...recepciones],
  };
  const nuevo = calcularFlujo({ ...f.entrada, compras: adicional });
  const despues = new Map(nuevo.filas.map((x) => [x.clave, x]));

  const salida = new Map<number, string>();
  for (const [fila, afectadas] of claves) {
    for (const clave of afectadas) {
      const antes = f.por_clave.get(clave);
      const ahora = despues.get(clave);
      if (!ahora) continue;
      const i = ahora.proyeccion.meses.findIndex((m, j) => m.exceso > (antes?.proyeccion.meses[j]?.exceso ?? 0) + 0.5);
      if (i < 0) continue;
      const m = ahora.proyeccion.meses[i];
      salida.set(fila, `${etiquetaMes(m.periodo)}: IMI ${(Math.round((m.imi ?? 0) * 10) / 10).toLocaleString("es-PE")} · exceso ${enMiles(m.exceso)} u`);
      break;
    }
  }
  return listo(salida);
}

export type { ClaveFila };
