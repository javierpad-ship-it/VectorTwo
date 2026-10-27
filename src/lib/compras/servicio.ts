import "server-only";
import type { IndiceNodos } from "@/lib/arbol/nivel/indice";
import type { Rol } from "@/lib/auth/roles";
import { describirErrorDb } from "@/lib/api/errores-db";
import { errorConCodigo } from "@/lib/api/respuestas";
import { hastaPorDefecto } from "@/lib/curvas/anios";
import { leerVigentes } from "@/lib/intercompany/servicio";
import type { ReglaBase } from "@/lib/intercompany/reglas";
import { modalidadEfectiva } from "@/lib/marcas/reglas";
import { temporadasDeVersion } from "@/lib/marcas-barrer/reglas";
import { leerRepartosVigentes } from "@/lib/marcas-barrer/servicio";
import { temporadaDe } from "@/lib/marcas-barrer/temporadas";
import type { TemporadasConfig } from "@/lib/marcas-barrer/tipos-api";
import { falla, fallaDb, fallaMensaje, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { hoyLima } from "@/lib/tiendas/estado";
import { argsCancelarCompra, validarCancelacion } from "./cancelar";
import {
  rpcCancelarCompra,
  rpcImportarCompra,
  rpcQuitarRecepcion,
  rpcRegistrarRecepciones,
  leerCatalogo,
  leerDatosCompras,
  leerDatosDeCompra,
  leerEventosDeCompra,
  leerLineaYEntrega,
  leerMesesPublicados,
  leerProveedoresDb,
  leerTemporadasConfiguradas,
  type CatalogoLeido,
  type CompraDb,
  type DatosCompras,
  type DatosDeCompra,
  type EntregaDb,
  type EventoDb,
  type LineaDb,
  type ProveedorDb,
  type RecepcionDb,
  type RepartoDb,
} from "./consultas";
import type { Cancelar, ComprasQuery, ImportarCompras, Recibir } from "./esquemas";
import { historial as ordenarHistorial } from "./eventos";
import {
  agregarAviso,
  argsImportarCompra,
  previsualizarImportacionCompras,
  reporteAplicado,
  type CompraExistente,
  type ContenidoLinea,
  type EstadoImportacionCompras,
  type LineaExistente,
  type ResultadoAplicacionCompra,
  type ResultadoPrevisualizacion,
} from "./importar";
import { compraEsMia, FUNCIONES_DISPONIBLES_0_13_0, puede, puedeImportar, type NodoGeneroMundo } from "./permisos";
import { pendientesPorEntrega, esEntregaVencida } from "./pendientes";
import { argsQuitarRecepcion, argsRegistrarRecepciones, avisosRecepcion, recepcionDeSugerencia, validarQuitarRecepcion, validarRecepciones } from "./recepciones";
import { hayRepartoCambio, sumarRepartos } from "./reparto";
import {
  errorDeMotivo,
  fundirEntregas,
  interpretarResultadoFuncion,
  mesDe,
  tieneSaldoCerrado,
  type ModeloCompra,
  type ErrorDeMotivo,
} from "./reglas";
import {
  DESTINOS_COMPRA,
  ESTADOS_COMPRA,
  ESTADOS_QUE_CUENTAN,
  MOTIVOS_FUNCION_COMPRA,
  ORIGENES_COMPRA,
  ORIGENES_ENTREGA,
  ORIGENES_RECEPCION,
  TALLAS_COMPRA,
  TIPOS_LINEA,
  type ActorCompra,
  type Mes,
  type MotivoFuncionCompra,
  type TipoLinea,
} from "./tipos";
import {
  ESTADO_HTTP_ERROR_COMPRA,
  MENSAJE_ERROR_COMPRA,
  type AvisoLineaCompra,
  type CompraApi,
  type EventoCompraApi,
  type LineaCompraApi,
  type ProveedorApi,
  type RepartoLineaApi,
  type ReporteImportacionComprasApi,
} from "./tipos-api";

/**
 * Servicio de las compras de M8 (solo servidor; ficha 08, §0.4–§0.5, §0.11–§0.13 y §5). Lee, arma `CompraApi` y escribe SOLO con las
 * cuatro funciones `rpc` de `0025` (una transacción por llamada). Antes de cada escritura valida con las reglas puras de este módulo
 * (`validarRecepciones`, `validarQuitarRecepcion`, `validarCancelacion`) con el MISMO orden que la función SQL: pertenencia,
 * `revision`, saldo; la base vuelve a comprobarlo bajo `for update` y manda si hay carrera.
 *
 * NO importa nada de `src/lib/flujo/` (regla de independencia, §0.8): lo que necesita del flujo (`k'` y la sugerencia de cada entrega)
 * lo recibe por parámetro (`ContextoFlujo`) y el aviso `exceso` del importador, por una función que le pasa quien llama.
 */

// ─── Contexto que llega del flujo (por parámetro) ───

/** `k'` y la sugerencia de la conciliación por entrega; sin flujo (no hay cerrada todavía) las compras siguen funcionando sin ellas. */
export type ContextoFlujo = { k_prima: Mes; sugerencias: ReadonlyMap<string, { periodo: Mes; unidades: number }> };

/** El contexto, ya calculado o una función que lo calcula cuando haga falta (las escrituras lo piden DESPUÉS de escribir); `null` = sin flujo. */
export type ProveedorDeFlujo = ContextoFlujo | null | undefined | (() => Promise<ContextoFlujo | null>);

async function resolverFlujo(f: ProveedorDeFlujo): Promise<ContextoFlujo | undefined> {
  if (typeof f === "function") return (await f()) ?? undefined;
  return f ?? undefined;
}

/** Quién llama: el perfil del guard y su rol. */
export type UsuarioCompras = { id: string; nombre: string; rol: Rol };

export const actorDe = (u: UsuarioCompras): ActorCompra => ({ perfil_id: u.id, nombre: u.nombre });

// ─── Respuestas de error ───

export const respuestaDeError = (e: ErrorDeMotivo, detalle?: string): Salida<never> =>
  falla(errorConCodigo(detalle ? `${e.mensaje} ${detalle}` : e.mensaje, e.status, e.codigo));

const noEncontrada = (): Salida<never> => fallaMensaje(MENSAJE_ERROR_COMPRA.compra_no_encontrada, 404, "compra_no_encontrada");

const esMotivoDeFuncion = (m: string): m is MotivoFuncionCompra => (MOTIVOS_FUNCION_COMPRA as readonly string[]).includes(m);

function elegir<T extends string>(permitidos: readonly T[], valor: unknown, defecto: T): T {
  return typeof valor === "string" && (permitidos as readonly string[]).includes(valor) ? (valor as T) : defecto;
}

// ─── Catálogo para los nombres (caché corta: solo se muestra; el importador lee fresco) ───

type Catalogo = {
  leido: CatalogoLeido;
  marcas: Map<string, string>;
  agrupaciones: Map<string, string>;
  generos: Map<string, string>;
  mundos: Map<string, string>;
  lineas: Map<string, string>;
  equivalencias: Map<string, string>;
  tiendas: Map<string, string>;
  nodos: IndiceNodos;
  nodoGeneroMundo: Map<string, NodoGeneroMundo>;
};

const TTL_CATALOGO_MS = 30_000;
let cacheCatalogo: { expira: number; valor: Catalogo } | null = null;

/** Vacía la caché del catálogo (las pruebas y nada más). */
export const reiniciarCacheCatalogo = (): void => {
  cacheCatalogo = null;
};

function armarCatalogo(c: CatalogoLeido): Catalogo {
  const nodos = c.gml.estado.nodos;
  return {
    leido: c,
    marcas: new Map(c.gml.estado.marcas.map((m) => [m.id, m.nombre])),
    agrupaciones: new Map(c.gml.estado.agrupaciones.map((a) => [a.id, a.nombre])),
    generos: new Map(c.gml.arbol.generos.map((g) => [g.id, g.nombre])),
    mundos: new Map(c.gml.arbol.mundos.map((m) => [m.id, m.nombre])),
    lineas: new Map(c.gml.arbol.lineas.map((l) => [l.id, l.nombre])),
    equivalencias: new Map(c.equivalencias.map((e) => [e.id, e.nombre])),
    tiendas: new Map(c.tiendas.map((t) => [t.id, t.codigo])),
    nodos,
    nodoGeneroMundo: new Map([...nodos.values()].map((n) => [n.id, { genero_id: n.genero_id, mundo_id: n.mundo_id }])),
  };
}

async function catalogoDeLectura(d: Db): Promise<Salida<Catalogo>> {
  const ahora = Date.now();
  if (cacheCatalogo && cacheCatalogo.expira > ahora) return listo(cacheCatalogo.valor);
  const r = await leerCatalogo(d);
  if (r.error || !r.data) return fallaDb(r.error as NonNullable<typeof r.error>, "compras: leer el catálogo");
  const valor = armarCatalogo(r.data);
  cacheCatalogo = { expira: ahora + TTL_CATALOGO_MS, valor };
  return listo(valor);
}

/** Último mes publicado y terminado (`k'`), o `null` si no hay ninguno. */
export async function kPrimaDe(d: Db): Promise<Salida<Mes | null>> {
  const r = await leerMesesPublicados(d);
  if (r.error) return fallaDb(r.error, "compras: leer los meses publicados");
  return listo(hastaPorDefecto(r.data, hoyLima()));
}

// ─── Contexto de lectura ───

type ContextoLectura = {
  catalogo: Catalogo;
  /** `"0000-00"` si no hay ningún mes publicado: ninguna entrega queda vencida ni «en mes cerrado». */
  k_prima: Mes;
  hoy: string;
  temporadas: TemporadasConfig;
  sugerencias: ReadonlyMap<string, { periodo: Mes; unidades: number }>;
  /** `marca (unidad) → reparto_id vigente`. */
  vigentePorMarca: Map<string, string>;
  rol: Rol;
  combinaciones: { genero_id: string; mundo_id: string }[];
};

async function armarContexto(d: Db, usuario: UsuarioCompras, flujo: ContextoFlujo | undefined, marcasDeLotes: readonly string[]): Promise<Salida<ContextoLectura>> {
  const [catalogo, k, temporadas, vigentes] = await Promise.all([
    catalogoDeLectura(d),
    flujo ? Promise.resolve(listo<Mes | null>(flujo.k_prima)) : kPrimaDe(d),
    leerTemporadasConfiguradas(d),
    marcasDeLotes.length === 0 ? Promise.resolve(listo({ repartos: [], sin_reparto: [] as string[] })) : leerRepartosVigentes(d, [...new Set(marcasDeLotes)]),
  ]);
  if (catalogo.respuesta) return falla(catalogo.respuesta);
  if (k.respuesta) return falla(k.respuesta);
  if (temporadas.error) return fallaDb(temporadas.error, "compras: leer las temporadas");
  if (vigentes.respuesta) return falla(vigentes.respuesta);
  return listo({
    catalogo: catalogo.data,
    k_prima: k.data ?? "0000-00",
    hoy: hoyLima(),
    temporadas: temporadasDeVersion(temporadas.data),
    sugerencias: flujo?.sugerencias ?? new Map(),
    vigentePorMarca: new Map(vigentes.data.repartos.map((r) => [r.marca_id, r.reparto_id])),
    rol: usuario.rol,
    combinaciones: catalogo.data.leido.asignaciones.filter((a) => a.perfil_id === usuario.id).map((a) => ({ genero_id: a.genero_id, mundo_id: a.mundo_id })),
  });
}

// ─── CompraApi ───

const AVISOS_LINEA: readonly AvisoLineaCompra[] = ["sin_reparto", "reparto_cambio", "exceso", "entrega_vencida", "entrega_pasada", "miembro_resuelto", "directo_con_regla", "directo_sin_regla"];

/** El número de la línea dentro de su referencia (la última parte de `clave_importacion`); sin clave, al final. */
function ordinalDe(l: LineaDb): number {
  const n = Number((l.clave_importacion ?? "").split("|").pop());
  return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rutaDeNodo(c: Catalogo, gmlId: string | null, equivalenciaId: string | null): string | null {
  if (gmlId === null) return null;
  const n = c.nodos.get(gmlId);
  if (!n) return null;
  const eq = equivalenciaId ? c.equivalencias.get(equivalenciaId) : undefined;
  return eq ? `${n.ruta} › ${eq}` : n.ruta;
}

function nombresDeAlcance(c: Catalogo, alcance: unknown): NonNullable<LineaCompraApi["alcance"]> {
  const o = alcance !== null && typeof alcance === "object" && !Array.isArray(alcance) ? (alcance as Record<string, unknown>) : {};
  const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  return {
    generos: ids(o.generos).map((id) => c.generos.get(id) ?? id),
    mundos: ids(o.mundos).map((id) => c.mundos.get(id) ?? id),
    lineas: ids(o.lineas).map((id) => c.lineas.get(id) ?? id),
  };
}

type PartesLinea = { linea: LineaDb; entregas: EntregaDb[]; recepciones: RecepcionDb[]; repartos: RepartoDb[] };

export function armarLineaApi(p: PartesLinea, compra: CompraDb, ctx: ContextoLectura): LineaCompraApi {
  const { linea: l } = p;
  const c = ctx.catalogo;
  const cuenta = ESTADOS_QUE_CUENTAN.includes(elegir(ESTADOS_COMPRA, compra.estado, "confirmada"));
  const entregasDb = [...p.entregas].sort((a, b) => comparar(a.periodo, b.periodo) || comparar(a.id, b.id));
  const pend = pendientesPorEntrega(
    { unidades: l.unidades, unidades_canceladas: l.unidades_canceladas },
    entregasDb.map((e) => ({ id: e.id, periodo: mesDe(e.periodo), unidades: e.unidades })),
    p.recepciones.map((r) => ({ id: r.id, recibida_periodo: mesDe(r.recibida_periodo), unidades: r.unidades, fecha_recepcion: r.fecha_recepcion }))
  );
  const esLote = l.tipo !== "especifica";
  const origenDe = new Map(entregasDb.map((e) => [e.id, elegir(ORIGENES_ENTREGA, e.origen, "manual")]));
  const temporadaGuardada = new Map(p.repartos.filter((r) => r.temporada === "verano" || r.temporada === "invierno").map((r) => [r.entrega_id, r.temporada as "verano" | "invierno"]));

  const entregas: LineaCompraApi["entregas"] = pend.entregas.map((e) => ({
    id: e.id,
    periodo: e.periodo,
    unidades: e.unidades,
    asignadas: e.asignadas,
    canceladas: e.canceladas,
    pendiente: e.pendiente,
    vencida: cuenta && esEntregaVencida(e, ctx.k_prima),
    sugerencia: ctx.sugerencias.get(e.id) ?? null,
    temporada: temporadaGuardada.get(e.id) ?? temporadaDe(Number(e.periodo.slice(5, 7)), ctx.temporadas),
    origen: origenDe.get(e.id) ?? "manual",
  }));

  const repartosOrdenados = [...p.repartos].sort((a, b) => comparar(a.id, b.id));
  const filaApi = (r: { marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number }): RepartoLineaApi => ({
    marca_id: r.marca_id,
    marca: c.marcas.get(r.marca_id) ?? "—",
    gml_id: r.genero_mundo_linea_id,
    equivalencia_id: r.equivalencia_id,
    ruta: rutaDeNodo(c, r.genero_mundo_linea_id, r.equivalencia_id) ?? "—",
    unidades: r.unidades,
  });
  const vigenteId = l.marca_id === null ? null : (ctx.vigentePorMarca.get(l.marca_id) ?? null);
  const reparto: LineaCompraApi["reparto"] =
    esLote && repartosOrdenados.length > 0
      ? {
          reparto_id: repartosOrdenados[0].reparto_id,
          version: repartosOrdenados[0].reparto_version,
          error_reparto_pp: repartosOrdenados[0].error_reparto_pp === null ? null : Number(repartosOrdenados[0].error_reparto_pp),
          vigente: !hayRepartoCambio(repartosOrdenados, vigenteId),
          por_entrega: entregasDb.map((e) => ({
            entrega_id: e.id,
            temporada: repartosOrdenados.find((r) => r.entrega_id === e.id)?.temporada ?? null,
            filas: repartosOrdenados.filter((r) => r.entrega_id === e.id).map(filaApi),
          })),
          filas: sumarRepartos(repartosOrdenados).map(filaApi),
        }
      : null;

  const guardados = Array.isArray(l.avisos) ? l.avisos.filter((a): a is AvisoLineaCompra => typeof a === "string" && (AVISOS_LINEA as readonly string[]).includes(a)) : [];
  const dinamicos: AvisoLineaCompra[] = [];
  if (cuenta && esLote && repartosOrdenados.length === 0) dinamicos.push("sin_reparto");
  if (reparto && !reparto.vigente) dinamicos.push("reparto_cambio");
  if (entregas.some((e) => e.vencida)) dinamicos.push("entrega_vencida");

  const saldoCerrado = compra.estado === "recibida" && compra.cancelada_at !== null;
  const tienda = l.tienda_id ? { id: l.tienda_id, codigo: c.tiendas.get(l.tienda_id) ?? "—" } : null;
  return {
    id: l.id,
    compra_id: l.compra_id,
    tipo: elegir(TIPOS_LINEA, l.tipo, "especifica"),
    gml_id: l.genero_mundo_linea_id,
    equivalencia_id: l.equivalencia_id,
    ruta: esLote ? null : rutaDeNodo(c, l.genero_mundo_linea_id, l.equivalencia_id),
    marca_id: l.marca_id,
    marca: l.marca_id ? (c.marcas.get(l.marca_id) ?? null) : null,
    agrupacion_marca_id: l.agrupacion_marca_id,
    agrupacion_marca: l.agrupacion_marca_id ? (c.agrupaciones.get(l.agrupacion_marca_id) ?? null) : null,
    tallas: elegir(TALLAS_COMPRA, l.tallas, "ambas"),
    unidades: l.unidades,
    unidades_recibidas: l.unidades_recibidas,
    unidades_canceladas: l.unidades_canceladas,
    costo_unitario: l.costo_unitario === null ? null : Number(l.costo_unitario),
    llegada_periodo: entregas[0]?.periodo ?? mesDe(l.llegada_periodo),
    destino: elegir(DESTINOS_COMPRA, l.destino, "cd"),
    tienda,
    alcance: l.tipo === "barrer_marca" ? nombresDeAlcance(c, l.alcance) : null,
    mezcla: null,
    entregas,
    reparto,
    recepciones: [...p.recepciones]
      .sort((a, b) => comparar(a.recibida_periodo, b.recibida_periodo) || comparar(a.created_at, b.created_at) || comparar(a.id, b.id))
      .map((r) => ({
        id: r.id,
        recibida_periodo: mesDe(r.recibida_periodo),
        unidades: r.unidades,
        fecha_recepcion: r.fecha_recepcion,
        origen: elegir(ORIGENES_RECEPCION, r.origen, "manual"),
        usuario_nombre: r.usuario_nombre,
        nota: r.nota,
        avisos: avisosRecepcion({ recibida_periodo: mesDe(r.recibida_periodo) }, ctx.k_prima, ctx.hoy, {
          sobre_saldo_cancelado: saldoCerrado && compra.cancelada_at !== null && r.created_at > compra.cancelada_at,
        }),
      })),
    nota: l.nota,
    avisos: [...new Set<AvisoLineaCompra>([...guardados, ...dinamicos])],
  };
}

const aEventoApi = (e: EventoDb): EventoCompraApi => ({
  id: e.id,
  linea_id: e.linea_id,
  accion: e.accion as EventoCompraApi["accion"],
  antes: e.antes,
  despues: e.despues,
  motivo: e.motivo,
  resumen: e.resumen,
  usuario_nombre: e.usuario_nombre,
  created_at: e.created_at,
});

type PartesCompra = {
  compra: CompraDb;
  proveedor: Pick<ProveedorDb, "id" | "nombre" | "es_intercompany"> | null;
  lineas: LineaDb[];
  entregas: ReadonlyMap<string, EntregaDb[]>;
  recepciones: ReadonlyMap<string, RecepcionDb[]>;
  repartos: ReadonlyMap<string, RepartoDb[]>;
  eventos: EventoDb[] | null;
};

export function armarCompraApi(p: PartesCompra, ctx: ContextoLectura): CompraApi {
  const { compra } = p;
  const estado = elegir(ESTADOS_COMPRA, compra.estado, "confirmada");
  const activas = p.lineas.filter((l) => l.activo).sort((a, b) => ordinalDe(a) - ordinalDe(b) || comparar(a.created_at, b.created_at) || comparar(a.id, b.id));
  const lineas = activas.map((l) =>
    armarLineaApi({ linea: l, entregas: p.entregas.get(l.id) ?? [], recepciones: p.recepciones.get(l.id) ?? [], repartos: p.repartos.get(l.id) ?? [] }, compra, ctx)
  );
  const periodos = lineas.flatMap((l) => l.entregas.map((e) => e.periodo)).sort();
  const conCosto = lineas.filter((l) => l.costo_unitario !== null);
  const recibidas = lineas.reduce((a, l) => a + l.unidades_recibidas, 0);
  const eventos = p.eventos === null ? null : ordenarHistorial(p.eventos.map(aEventoApi));
  const excede = Array.isArray(compra.excede_tope_al_confirmar) ? (compra.excede_tope_al_confirmar as CompraApi["excede_tope_al_confirmar"]) : [];
  const gmlDeRepartos = (id: string) => [...new Set((p.repartos.get(id) ?? []).map((r) => r.genero_mundo_linea_id))];
  const mia = compraEsMia(
    activas.map((l) => ({ genero_mundo_linea_id: l.genero_mundo_linea_id, reparto_gml_ids: gmlDeRepartos(l.id) })),
    ctx.combinaciones,
    ctx.catalogo.nodoGeneroMundo
  );
  return {
    id: compra.id,
    numero: compra.numero,
    proveedor: { id: compra.proveedor_id, nombre: p.proveedor?.nombre ?? "—", es_intercompany: p.proveedor?.es_intercompany ?? false },
    origen: elegir(ORIGENES_COMPRA, compra.origen, "comprador"),
    estado,
    saldo_cerrado: tieneSaldoCerrado({ estado, cancelada_at: compra.cancelada_at }),
    fecha_compra: compra.fecha_compra,
    referencia: compra.referencia,
    moneda: compra.moneda === "USD" ? "USD" : "PEN",
    nota: compra.nota,
    justificacion_exceso: compra.justificacion_exceso,
    excede_tope_al_confirmar: excede,
    creada_por: { nombre: compra.usuario_nombre, at: compra.created_at },
    modificada_por: compra.revision > 0 ? { nombre: compra.updated_by_nombre, at: compra.updated_at } : null,
    confirmada_por: compra.confirmada_at ? { nombre: compra.confirmada_por_nombre, at: compra.confirmada_at } : null,
    cancelada_por: compra.cancelada_at ? { nombre: compra.cancelada_por_nombre, at: compra.cancelada_at, motivo: compra.motivo_cancelacion ?? "" } : null,
    lineas,
    totales: { unidades: lineas.reduce((a, l) => a + l.unidades, 0), costo: conCosto.length === 0 ? null : conCosto.reduce((a, l) => a + (l.costo_unitario ?? 0) * l.unidades, 0), recibidas },
    llegadas: periodos.length > 0 ? { desde: periodos[0], hasta: periodos[periodos.length - 1], entregas: periodos.length } : null,
    mia,
    revision: compra.revision,
    puede: puede({ estado, cancelada_at: compra.cancelada_at, unidades_recibidas: recibidas, lineas_activas: activas.length }, { rol: ctx.rol }, { fase: "m8", disponibles: FUNCIONES_DISPONIBLES_0_13_0 }),
    historial: eventos ?? [],
    avisos: [...new Set(lineas.flatMap((l) => l.avisos))],
  };
}

function agrupar<T>(items: readonly T[], clave: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = clave(it);
    const l = m.get(k);
    if (l) l.push(it);
    else m.set(k, [it]);
  }
  return m;
}

// ─── Lecturas ───

const sinFiltros = (q: ComprasQuery) => q.q === undefined || q.q === "";

/** `GET /api/compras`: la lista con líneas y entregas (el historial va vacío). Los filtros se aplican aquí; el texto libre, también. */
export async function listarCompras(d: Db, usuario: UsuarioCompras, q: ComprasQuery, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi[]>> {
  const datos = await leerDatosCompras(d);
  if (datos.error) return fallaDb(datos.error, "compras: leer la lista");
  const flujoListo = await resolverFlujo(flujo);
  const marcasLote = datos.data.lineas.filter((l) => l.tipo !== "especifica" && l.marca_id !== null).map((l) => l.marca_id as string);
  const ctx = await armarContexto(d, usuario, flujoListo, marcasLote);
  if (ctx.respuesta) return falla(ctx.respuesta);

  const lineasDe = agrupar(datos.data.lineas, (l) => l.compra_id);
  const entregas = agrupar(datos.data.entregas, (e) => e.linea_id);
  const recepciones = agrupar(datos.data.recepciones, (r) => r.linea_id);
  const repartos = agrupar(datos.data.repartos, (r) => r.linea_id);
  const proveedores = new Map(datos.data.proveedores.map((p) => [p.id, p]));

  const salida: CompraApi[] = [];
  for (const compra of datos.data.compras) {
    if (q.estado !== undefined && compra.estado !== q.estado) continue;
    if (q.proveedor_id !== undefined && compra.proveedor_id !== q.proveedor_id) continue;
    if (q.origen !== undefined && compra.origen !== q.origen) continue;
    const api = armarCompraApi({ compra, proveedor: proveedores.get(compra.proveedor_id) ?? null, lineas: lineasDe.get(compra.id) ?? [], entregas, recepciones, repartos, eventos: null }, ctx.data);
    if (!cumpleFiltros(api, datos.data, q, ctx.data)) continue;
    salida.push(api);
  }
  salida.sort((a, b) => comparar(b.fecha_compra, a.fecha_compra) || comparar(b.numero, a.numero));
  return listo(salida);
}

/** Filtros que miran el contenido de la compra ya armada (mes de entrega, árbol, marca, «mis líneas», «por confirmar», texto). */
function cumpleFiltros(api: CompraApi, datos: DatosCompras, q: ComprasQuery, ctx: ContextoLectura): boolean {
  if (q.llegada_desde !== undefined || q.llegada_hasta !== undefined) {
    const desde = q.llegada_desde ?? "0000-00";
    const hasta = q.llegada_hasta ?? "9999-99";
    if (!api.lineas.some((l) => l.entregas.some((e) => e.periodo >= desde && e.periodo <= hasta))) return false;
  }
  if (q.genero_id !== undefined || q.mundo_id !== undefined || q.linea_id !== undefined) {
    const nodosDe = (l: LineaCompraApi): string[] => (l.gml_id !== null ? [l.gml_id] : (l.reparto?.filas ?? []).map((f) => f.gml_id));
    const coincide = api.lineas.some((l) =>
      nodosDe(l).some((id) => {
        const n = ctx.catalogo.nodos.get(id);
        return n !== undefined && (q.genero_id === undefined || n.genero_id === q.genero_id) && (q.mundo_id === undefined || n.mundo_id === q.mundo_id) && (q.linea_id === undefined || n.linea_id === q.linea_id);
      })
    );
    if (!coincide) return false;
  }
  if (q.marca_id !== undefined) {
    const marcasDe = (l: LineaCompraApi) => [l.marca_id, ...(l.reparto?.filas ?? []).map((f) => f.marca_id)];
    if (!api.lineas.some((l) => marcasDe(l).includes(q.marca_id as string))) return false;
  }
  if (q.mio && !api.mia) return false;
  if (q.por_confirmar && !api.lineas.some((l) => l.entregas.some((e) => e.vencida))) return false;
  if (!sinFiltros(q)) {
    const t = (q.q as string).toLocaleLowerCase("es");
    const texto = `${api.numero} ${api.proveedor.nombre} ${api.referencia ?? ""}`.toLocaleLowerCase("es");
    if (!texto.includes(t)) return false;
  }
  void datos;
  return true;
}

/** `GET /api/compras/[id]`: una compra con su historial. */
export async function leerCompra(d: Db, usuario: UsuarioCompras, id: string, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi>> {
  const datos = await leerDatosDeCompra(d, id);
  if (datos.error) return fallaDb(datos.error, "compras: leer la compra");
  if (!datos.data) return noEncontrada();
  const eventos = await leerEventosDeCompra(d, id);
  if (eventos.error) return fallaDb(eventos.error, "compras: leer el historial");
  return armarDeDatos(d, usuario, datos.data, eventos.data, flujo);
}

async function armarDeDatos(d: Db, usuario: UsuarioCompras, datos: DatosDeCompra, eventos: EventoDb[] | null, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi>> {
  const marcasLote = datos.lineas.filter((l) => l.tipo !== "especifica" && l.marca_id !== null).map((l) => l.marca_id as string);
  const ctx = await armarContexto(d, usuario, await resolverFlujo(flujo), marcasLote);
  if (ctx.respuesta) return falla(ctx.respuesta);
  return listo(
    armarCompraApi(
      { compra: datos.compra, proveedor: datos.proveedor, lineas: datos.lineas, entregas: agrupar(datos.entregas, (e) => e.linea_id), recepciones: agrupar(datos.recepciones, (r) => r.linea_id), repartos: agrupar(datos.repartos, (r) => r.linea_id), eventos },
      ctx.data
    )
  );
}

/** `GET /api/compras/[id]/historial`. */
export async function leerHistorial(d: Db, id: string): Promise<Salida<EventoCompraApi[]>> {
  const existe = await leerDatosDeCompra(d, id);
  if (existe.error) return fallaDb(existe.error, "compras: leer la compra");
  if (!existe.data) return noEncontrada();
  const eventos = await leerEventosDeCompra(d, id);
  if (eventos.error) return fallaDb(eventos.error, "compras: leer el historial");
  return listo(ordenarHistorial(eventos.data.map(aEventoApi)));
}

/** `GET /api/compras/proveedores`: con las compras no canceladas de cada uno. Los contactos llegan con M9a. */
export async function listarProveedores(d: Db): Promise<Salida<ProveedorApi[]>> {
  const [proveedores, compras] = await Promise.all([leerProveedoresDb(d), leerDatosCompras(d)]);
  if (proveedores.error) return fallaDb(proveedores.error, "compras: leer los proveedores");
  if (compras.error) return fallaDb(compras.error, "compras: leer las compras");
  const cuenta = new Map<string, number>();
  for (const c of compras.data.compras) if (c.estado !== "cancelada") cuenta.set(c.proveedor_id, (cuenta.get(c.proveedor_id) ?? 0) + 1);
  return listo(
    proveedores.data.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      pais: p.pais,
      ciudad: p.ciudad,
      identificacion: p.identificacion,
      es_intercompany: p.es_intercompany,
      nota: p.nota,
      activo: p.activo,
      compras: cuenta.get(p.id) ?? 0,
      contactos: [],
    }))
  );
}

// ─── Escrituras: validar con las reglas puras y llamar a la función de la base ───

/** El modelo mínimo de la compra que usan las validaciones puras (el mismo que `compra_recalcular_estado` y `compra_foto`). */
export function modeloDeDatos(d: DatosDeCompra): ModeloCompra {
  return {
    estado: elegir(ESTADOS_COMPRA, d.compra.estado, "confirmada"),
    revision: d.compra.revision,
    cancelada_at: d.compra.cancelada_at,
    fecha_compra: d.compra.fecha_compra,
    lineas: d.lineas.map((l) => ({ id: l.id, unidades: l.unidades, unidades_recibidas: l.unidades_recibidas, unidades_canceladas: l.unidades_canceladas, activo: l.activo })),
    recepciones: d.recepciones.map((r) => ({
      id: r.id,
      linea_id: r.linea_id,
      recibida_periodo: mesDe(r.recibida_periodo),
      unidades: r.unidades,
      fecha_recepcion: r.fecha_recepcion,
      origen: elegir(ORIGENES_RECEPCION, r.origen, "manual"),
    })),
  };
}

/** Lo que dice la función de la base: `ok` con la compra, o el `motivo` traducido al `404`/`409` de la API. */
function resultadoDeRpc(r: { data: unknown; error: Parameters<typeof fallaDb>[0] | null }, contexto: string): Salida<{ datos: Record<string, unknown> }> {
  if (r.error) return fallaDb(r.error, contexto);
  const i = interpretarResultadoFuncion(r.data);
  if (!i.ok) return respuestaDeError(errorDeMotivo(i.motivo));
  return listo({ datos: { ...i.datos, compra_id: i.compra_id, revision: i.revision } });
}

async function cargarParaEscribir(d: Db, id: string): Promise<Salida<DatosDeCompra>> {
  const datos = await leerDatosDeCompra(d, id);
  if (datos.error) return fallaDb(datos.error, "compras: leer la compra");
  if (!datos.data) return noEncontrada();
  return listo(datos.data);
}

/** `POST /api/compras/[id]/recibir`: «Confirmar ingreso» (`registrar_recepciones`). */
export async function confirmarIngreso(d: Db, usuario: UsuarioCompras, id: string, cuerpo: Recibir, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi>> {
  const previa = await cargarParaEscribir(d, id);
  if (previa.respuesta) return falla(previa.respuesta);
  const rechazo = validarRecepciones(modeloDeDatos(previa.data), cuerpo.revision, cuerpo.recepciones);
  if (rechazo) return respuestaDeError(errorDeMotivo(rechazo.motivo), rechazo.detalle);

  const args = argsRegistrarRecepciones({
    compra_id: id,
    revision: cuerpo.revision,
    recepciones: cuerpo.recepciones.map((r) => ({ linea_id: r.linea_id, recibida_periodo: r.recibida_periodo, unidades: r.unidades, fecha_recepcion: r.fecha_recepcion, nota: r.nota, origen: "manual" as const })),
    actor: actorDe(usuario),
    motivo: null,
  });
  const r = resultadoDeRpc(await rpcRegistrarRecepciones(d, args), "compras: confirmar el ingreso");
  if (r.respuesta) return falla(r.respuesta);
  return leerCompra(d, usuario, id, flujo);
}

/** `DELETE /api/compras/[id]/recepciones/[recepcionId]?revision=` (`quitar_recepcion`). */
export async function quitarIngreso(d: Db, usuario: UsuarioCompras, id: string, recepcionId: string, revision: number, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi>> {
  const previa = await cargarParaEscribir(d, id);
  if (previa.respuesta) return falla(previa.respuesta);
  const rechazo = validarQuitarRecepcion(modeloDeDatos(previa.data), revision, recepcionId);
  if (rechazo) return respuestaDeError(errorDeMotivo(rechazo.motivo), rechazo.detalle);

  const r = resultadoDeRpc(await rpcQuitarRecepcion(d, argsQuitarRecepcion({ compra_id: id, recepcion_id: recepcionId, revision, actor: actorDe(usuario) })), "compras: quitar el ingreso");
  if (r.respuesta) return falla(r.respuesta);
  return leerCompra(d, usuario, id, flujo);
}

/** `POST /api/compras/[id]/cancelar` (`cancelar_compra`): sin recepciones, `cancelada`; con ellas, cierra el saldo. */
export async function cancelarCompra(d: Db, usuario: UsuarioCompras, id: string, cuerpo: Cancelar, flujo?: ProveedorDeFlujo): Promise<Salida<CompraApi>> {
  const previa = await cargarParaEscribir(d, id);
  if (previa.respuesta) return falla(previa.respuesta);
  const rechazo = validarCancelacion(modeloDeDatos(previa.data), cuerpo.revision, cuerpo.motivo);
  if (rechazo) return respuestaDeError(errorDeMotivo(rechazo));

  const r = resultadoDeRpc(await rpcCancelarCompra(d, argsCancelarCompra({ compra_id: id, revision: cuerpo.revision, motivo: cuerpo.motivo, actor: actorDe(usuario) })), "compras: cancelar la compra");
  if (r.respuesta) return falla(r.respuesta);
  return leerCompra(d, usuario, id, flujo);
}

// ─── «Aceptar sugerencia»: la parte de compras ───

export type PertenenciaEntrega = { compra_id: string; tipo: TipoLinea };

/**
 * Pertenencia del pedido: la línea existe y la entrega es de esa línea; la compra se deriva de la línea. Si no, `404 no_pertenece`
 * (nunca se dice cuál de las dos falló). Devuelve el tipo de la línea para que quien llama decida si es un lote.
 */
export async function pertenenciaDeEntrega(d: Db, lineaId: string, entregaId: string): Promise<Salida<PertenenciaEntrega>> {
  const r = await leerLineaYEntrega(d, lineaId, entregaId);
  if (r.error) return fallaDb(r.error, "compras: comprobar la línea y la entrega");
  if (!r.data || !r.data.entrega) return respuestaDeError(errorDeMotivo("no_pertenece"));
  return listo({ compra_id: r.data.linea.compra_id, tipo: elegir(TIPOS_LINEA, r.data.linea.tipo, "especifica") });
}

/**
 * Registra la recepción que propone la sugerencia aceptada (`recibida_periodo = X`, fecha = último día de X, `origen = 'sugerencia'`,
 * a nombre de quien acepta) con `registrar_recepciones`; el evento lleva «sugerencia de conciliación oct-2026» como motivo.
 */
export async function registrarSugerenciaAceptada(
  d: Db,
  usuario: UsuarioCompras,
  p: { compra_id: string; linea_id: string; periodo: Mes; unidades: number; revision: number },
  flujo?: ProveedorDeFlujo
): Promise<Salida<CompraApi>> {
  const previa = await cargarParaEscribir(d, p.compra_id);
  if (previa.respuesta) return falla(previa.respuesta);
  const { recepcion, motivo } = recepcionDeSugerencia({ linea_id: p.linea_id, periodo: p.periodo, unidades: p.unidades });
  const rechazo = validarRecepciones(modeloDeDatos(previa.data), p.revision, [recepcion]);
  if (rechazo) return respuestaDeError(errorDeMotivo(rechazo.motivo), rechazo.detalle);

  const args = argsRegistrarRecepciones({ compra_id: p.compra_id, revision: p.revision, recepciones: [recepcion], actor: actorDe(usuario), motivo });
  const r = resultadoDeRpc(await rpcRegistrarRecepciones(d, args), "compras: aceptar la sugerencia");
  if (r.respuesta) return falla(r.respuesta);
  return leerCompra(d, usuario, p.compra_id, flujo);
}

// ─── Importador de carga inicial ───

/** La línea que el importador pretende crear, para que quien llama calcule el aviso `exceso` con el flujo (compras no importa el flujo). */
export type LineaParaFlujo = {
  fila: number;
  fecha_compra: string;
  tipo: TipoLinea;
  genero_mundo_linea_id: string | null;
  equivalencia_id: string | null;
  marca_id: string | null;
  agrupacion_marca_id: string | null;
  destino: "cd" | "tienda" | "intercompany_directo";
  unidades: number;
  entregas: { periodo: string; unidades: number }[];
  repartos: { entrega_periodo: string; marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number }[];
  recibidas: { recibida_periodo: string; unidades: number }[];
};

/** `fila → detalle` de las líneas que dejan algún mes sobre el tope; quien llama la arma con el flujo (y puede devolver vacío si no hay cerrada). */
export type CalculoExceso = (lineas: LineaParaFlujo[]) => Promise<ReadonlyMap<number, string>>;

/** Las líneas NUEVAS de la previsualización, en la forma que pide el cálculo del exceso. */
export function lineasParaFlujo(r: ResultadoPrevisualizacion): LineaParaFlujo[] {
  return r.compras.flatMap((c) =>
    c.lineas.map((l) => ({
      fila: l.fila,
      fecha_compra: c.fecha_compra,
      tipo: l.linea.tipo,
      genero_mundo_linea_id: l.linea.genero_mundo_linea_id,
      equivalencia_id: l.linea.equivalencia_id,
      marca_id: l.linea.marca_id,
      agrupacion_marca_id: l.linea.agrupacion_marca_id,
      destino: l.linea.destino,
      unidades: l.linea.unidades,
      entregas: l.linea.entregas.map((e) => ({ periodo: e.periodo, unidades: e.unidades })),
      repartos: l.linea.repartos.map((x) => ({ entrega_periodo: x.entrega_periodo, marca_id: x.marca_id, genero_mundo_linea_id: x.genero_mundo_linea_id, equivalencia_id: x.equivalencia_id, unidades: x.unidades })),
      recibidas: l.linea.recepciones.map((x) => ({ recibida_periodo: x.recibida_periodo, unidades: x.unidades })),
    }))
  );
}

/** El contenido de una línea ya importada, para decir QUÉ cambió cuando el archivo trae otro contenido para la misma clave. */
function contenidoDeLinea(l: LineaDb, compra: CompraDb, datos: DatosCompras): ContenidoLinea {
  const alcance = l.alcance !== null && typeof l.alcance === "object" && !Array.isArray(l.alcance) ? (l.alcance as Record<string, unknown>) : {};
  const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : []);
  return {
    tipo: elegir(TIPOS_LINEA, l.tipo, "especifica"),
    genero_mundo_linea_id: l.genero_mundo_linea_id,
    equivalencia_id: l.equivalencia_id,
    marca_id: l.marca_id,
    agrupacion_marca_id: l.agrupacion_marca_id,
    tallas: elegir(TALLAS_COMPRA, l.tallas, "ambas"),
    unidades: l.unidades,
    costo_unitario: l.costo_unitario === null ? null : Number(l.costo_unitario),
    destino: elegir(DESTINOS_COMPRA, l.destino, "cd"),
    tienda_id: l.tienda_id,
    alcance: { generos: ids(alcance.generos), mundos: ids(alcance.mundos), lineas: ids(alcance.lineas) },
    entregas: fundirEntregas(datos.entregas.filter((e) => e.linea_id === l.id).map((e) => ({ periodo: mesDe(e.periodo), unidades: e.unidades }))),
    // Lo que el archivo dijo en RECIBIDAS quedó como recepción `importada`; las que se confirmaron después no son del archivo.
    recibidas: datos.recepciones.filter((r) => r.linea_id === l.id && r.origen === "importada").reduce((a, r) => a + r.unidades, 0),
    nota: l.nota,
    moneda: compra.moneda === "USD" ? "USD" : "PEN",
    fecha_compra: compra.fecha_compra,
  };
}

/** El estado del mundo que necesita `previsualizarImportacionCompras`, leído FRESCO (nada de caché: se decide `igual` o `nueva` con él). */
async function estadoImportacion(d: Db): Promise<Salida<EstadoImportacionCompras>> {
  const [catalogo, datos, reglas] = await Promise.all([leerCatalogo(d), leerDatosCompras(d), leerVigentes(d, undefined, undefined)]);
  if (catalogo.error || !catalogo.data) return fallaDb(catalogo.error as NonNullable<typeof catalogo.error>, "compras: leer el catálogo");
  if (datos.error) return fallaDb(datos.error, "compras: leer las compras");
  if (reglas.respuesta) return falla(reglas.respuesta);
  const cat = catalogo.data;
  const marcas = cat.gml.marcas.map((m) => ({
    id: m.id,
    codigo: m.codigo,
    nombre: m.nombre,
    activo: m.activo,
    agrupacion_marca_id: m.agrupacion_marca_id,
    conjunto_marca_id: m.conjunto_marca_id ?? null,
    modalidad_efectiva: modalidadEfectiva(m),
  }));
  const conLote = marcas.filter((m) => m.modalidad_efectiva === "barrido" || m.modalidad_efectiva === "mixta").map((m) => m.id);
  const vigentes = conLote.length === 0 ? listo({ repartos: [], sin_reparto: [] as string[] }) : await leerRepartosVigentes(d, conLote);
  if (vigentes.respuesta) return falla(vigentes.respuesta);

  const compraPorId = new Map(datos.data.compras.map((c) => [c.id, c]));
  const lineasExistentes: LineaExistente[] = [];
  for (const l of datos.data.lineas) {
    const compra = compraPorId.get(l.compra_id);
    if (!compra || !l.clave_importacion) continue;
    lineasExistentes.push({
      clave: l.clave_importacion,
      huella: l.huella_importacion,
      compra_id: compra.id,
      compra_numero: compra.numero,
      compra_estado: elegir(ESTADOS_COMPRA, compra.estado, "confirmada"),
      contenido: contenidoDeLinea(l, compra, datos.data),
    });
  }
  const comprasExistentes: CompraExistente[] = datos.data.compras.map((c) => ({
    id: c.id,
    numero: c.numero,
    proveedor_id: c.proveedor_id,
    referencia: c.referencia,
    estado: elegir(ESTADOS_COMPRA, c.estado, "confirmada"),
    cancelada_at: c.cancelada_at,
  }));
  const reglasBase: ReglaBase[] = reglas.data.reglas.map((r) => ({ id: r.id, marca_id: r.marca_id, genero_mundo_linea_id: r.genero_mundo_linea_id, equivalencia_id: r.equivalencia_id, vigente_desde: r.vigente_desde, activo: true }));

  return listo({
    generos: cat.gml.arbol.generos,
    mundos: cat.gml.arbol.mundos,
    lineas: cat.gml.arbol.lineas,
    nodos: cat.gml.arbol.nodos.map((n) => ({
      id: n.id,
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      activo: n.activo,
      nivel_planificacion: n.nivel_planificacion === "GMLE" ? "GMLE" : "GML",
    })),
    equivalencias: cat.equivalencias.map((e) => ({ id: e.id, genero_mundo_linea_id: e.genero_mundo_linea_id, codigo: e.codigo, nombre: e.nombre, es_generica: e.es_generica, activo: e.activo })),
    marcas,
    agrupaciones: cat.gml.estado.agrupaciones.map((a) => ({ id: a.id, codigo: "codigo" in a && typeof a.codigo === "string" ? a.codigo : a.nombre, nombre: a.nombre, activo: a.activo })),
    tiendas: cat.tiendas.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, activo: t.activo })),
    proveedores: datos.data.proveedores.map((p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo, activo: p.activo, es_intercompany: p.es_intercompany })),
    compras: comprasExistentes,
    lineas_existentes: lineasExistentes,
    repartos: vigentes.data.repartos.map((r) => ({
      marca_id: r.marca_id,
      reparto_id: r.reparto_id,
      version: r.version,
      modo: r.modo,
      error_reparto_pp: r.error_reparto_pp,
      temporadas_usadas: r.temporadas_usadas,
      filas: r.filas,
    })),
    reglas: reglasBase,
  });
}

/**
 * `POST /api/compras/importar` (`0.13.0`: solo la carga inicial). `previsualizar` clasifica cada línea (`nueva`, `igual`, `cambiada`) y
 * dice qué se omite y por qué; `aplicar` hace lo mismo y llama a `importar_compra` UNA vez por compra (todo o nada por compra): un
 * corte deja las compras ya aplicadas completas y las demás sin aplicar, y reimportar completa lo que falta (las aplicadas dan `igual`).
 * El aviso `exceso` lo calcula `calcularExceso` (con el flujo) si se pasa; sin él, no hay aviso.
 */
export async function importarCompras(d: Db, usuario: UsuarioCompras, cuerpo: ImportarCompras, calcularExceso?: CalculoExceso): Promise<Salida<ReporteImportacionComprasApi>> {
  if (!cuerpo.carga_inicial) return fallaMensaje(MENSAJE_ERROR_COMPRA.carga_inicial_requerida, ESTADO_HTTP_ERROR_COMPRA.carga_inicial_requerida, "carga_inicial_requerida");
  if (!puedeImportar(usuario.rol, cuerpo.carga_inicial)) return fallaMensaje("Tu rol es de solo lectura.", 403);

  const [estado, k] = await Promise.all([estadoImportacion(d), kPrimaDe(d)]);
  if (estado.respuesta) return falla(estado.respuesta);
  if (k.respuesta) return falla(k.respuesta);

  let resultado = previsualizarImportacionCompras(cuerpo.filas, cuerpo.mezcla, estado.data, { carga_inicial: cuerpo.carga_inicial, k_prima: k.data });
  if (calcularExceso) {
    const lineas = lineasParaFlujo(resultado);
    if (lineas.length > 0) {
      const excesos = await calcularExceso(lineas);
      for (const [fila, detalle] of excesos) resultado = agregarAviso(resultado, fila, "exceso", detalle);
    }
  }
  if (cuerpo.modo === "previsualizar") return listo(resultado.reporte);

  const respuestas: ResultadoAplicacionCompra[] = [];
  for (const compra of resultado.compras) {
    const r = await rpcImportarCompra(d, argsImportarCompra(compra, actorDe(usuario)));
    if (r.error) {
      // Un fallo de la base (no un motivo de negocio) corta: las que siguen quedan sin aplicar y se avisa; reimportar las completa.
      const { mensaje } = describirErrorDb(r.error.code, r.error.message, r.error.details);
      respuestas.push({ clave: compra.clave, ok: false, motivo: "error", mensaje });
      break;
    }
    const i = interpretarResultadoFuncion(r.data);
    if (i.ok) respuestas.push({ clave: compra.clave, ok: true, compra_id: i.compra_id, numero: typeof i.datos.numero === "string" ? i.datos.numero : "" });
    else respuestas.push({ clave: compra.clave, ok: false, motivo: esMotivoDeFuncion(i.motivo) ? i.motivo : "error", mensaje: errorDeMotivo(i.motivo).mensaje });
  }
  return listo(reporteAplicado(resultado, respuestas));
}
