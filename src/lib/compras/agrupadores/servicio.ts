import "server-only";
import type { NextResponse } from "next/server";
import { normalizarRol } from "@/lib/auth/roles";
import { errorConCodigo } from "@/lib/api/respuestas";
import { leerRepartosPorId } from "@/lib/marcas-barrer/servicio";
import { falla, fallaDb, fallaMensaje, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { hoyLima } from "@/lib/tiendas/estado";
import { kPrimaDe, nombresDeCatalogo, rutaLegible, type EvaluacionAgrupadoresCompras, type GanchosAgrupadoresCompras, type NombresCatalogo, type UsuarioCompras } from "@/lib/compras/servicio";
import { mesDe } from "@/lib/compras/reglas";
import {
  DESTINOS_COMPRA,
  ESTADOS_COMPRA,
  MONEDAS,
  ORIGENES_COMPRA,
  ORIGENES_ENTREGA,
  ORIGENES_RECEPCION,
  TALLAS_COMPRA,
  TIPOS_LINEA,
  type CompraRegistro,
  type EntregaRegistro,
  type LineaRegistro,
  type RecepcionRegistro,
  type RepartoRegistro,
} from "@/lib/compras/tipos";
import {
  leerAgrupadores,
  leerAsignacionesDeEntregas,
  leerComprasPorId,
  leerEmbarquePorId,
  leerEntregasDeLineas,
  leerEventosAgrupador,
  leerLineasPorClave,
  leerMundoAlcanzado,
  leerMundoCompleto,
  leerPaquetePorId,
  leerRepartosDeLineas,
  leerResumenHitos,
  leerViajePorId,
  rpcAplicarMovimientoAgrupador,
  rpcAsignarViajeCompras,
  rpcCambiarEstadoAgrupador,
  rpcGuardarEmbarque,
  rpcGuardarPaquete,
  rpcGuardarViaje,
  rpcImportarAgrupadores,
  type EmbarqueDb,
  type MundoDb,
  type RespuestaRpc,
  type Semillas,
  type ViajeDb,
} from "./consultas";
import { avisosEmbarque, avisosPaquete, avisosViaje, type AsignacionParaAviso } from "./avisos";
import type { AhoraLima } from "./fechas";
import { hitosDeEmbarque, proximoHitoEmbarque, reprogramacionesTotal, tieneHitoVencido, type ResumenHito } from "./hitos";
import type {
  EditarEmbarque,
  EditarViaje,
  AsignarViaje,
  CambiarEstado,
  CambiarFechas,
  EmbarquesQuery,
  GuardarEmbarque,
  GuardarPaquete,
  GuardarViaje,
  HistorialQuery,
  ImportarAgrupadores,
  IngresoPaquete,
  SinAsignarQuery,
  ViajeActivoCuerpo,
  ViajesQuery,
} from "./esquemas";
import { deduplicarComprasViaje } from "./esquemas";
import { accionAdmitidaPorTipo, validarGuardarEmbarqueFechas } from "./estados";
import {
  argsImportarAgrupadores,
  evaluarAgrupadoresDeFilaCompra,
  loteVacio,
  previsualizarImportacionAgrupadores,
  reporteAplicado,
  type CatalogoAgrupadoresCompra,
  type EstadoImportacionAgrupadores,
  type PerfilConCorreo,
} from "./importar";
import {
  cambiaAlgunMes,
  clasificarAsignacion,
  estimarPendientesAsignaciones,
  mesDeDestino,
  periodoLlegada,
  planCambiarFechas,
  planIngresoPaquete,
  type EntradaCambiarFechas,
  planificarMovimiento,
  puedeReintentar,
  type ResultadoPlanFechas,
  type ResultadoPlanMovimiento,
  type ContextoMovimiento,
  type PendienteAsignacion,
  type SolicitudMovimiento,
} from "./movimiento";
import { esAsignable, esMio, responsableEfectivo, type ResponsableCalculado } from "./responsable";
import {
  ESTADO_HTTP_ERROR_AGRUPADOR,
  MENSAJE_ERROR_AGRUPADOR,
  type AsignableApi,
  type AsignacionApi,
  type AvisoDetalleApi,
  type CodigoErrorAgrupador,
  type CompraDeViajeApi,
  type CompraSinViajeApi,
  type CostoPorMonedaApi,
  type EmbarqueApi,
  type EmbarqueDetalleApi,
  type EntregaSinEmbarqueApi,
  type EventoAgrupadorApi,
  type OpcionesAgrupadoresApi,
  type PaqueteApi,
  type PersonaFechaApi,
  type PlanFechasApi,
  type PlanMovimientoApi,
  type ReporteImportacionAgrupadoresApi,
  type RespuestaAsignarViajeApi,
  type RespuestaMovimientoApi,
  type RespuestaViajesApi,
  type SinAgrupadorApi,
  type ViajeApi,
  type ViajeDetalleApi,
  type AgrupadorImportacionCompraApi,
} from "./tipos-api";
import {
  AVISOS_AGRUPADOR,
  ESTADOS_EMBARQUE,
  ESTADOS_PAQUETE,
  ESTADOS_VIAJE,
  HITOS_CONFIRMABLES,
  TIPOS_EMBARQUE,
  type ActorAgrupador,
  type EmbarqueRegistro,
  type PaqueteRegistro,
  type RecepcionEmbarque,
  type TipoAgrupador,
  type ViajeRegistro,
  type AsignacionRegistro,
} from "./tipos";
import { VIAJE_ACTIVO_SIN_VIAJE, VIAJE_ACTIVO_TODOS, validarViajeActivo } from "./viaje-activo";

/**
 * Servicio de los agrupadores de compras (solo servidor; ficha 08b, §2.9, §3 y §5). Lee con `consultas.ts`, arma las respuestas de la API
 * con las funciones puras de este directorio y escribe SOLO con las funciones `rpc` de `0032` (una transacción por llamada). Las reglas
 * de negocio viven en `movimiento.ts`, `estados.ts`, `responsable.ts`, `avisos.ts` e `importar.ts`; aquí solo se orquestan: leer lo
 * necesario, llamar a la regla pura, llamar a la función de la base y traducir el resultado (`{ ok: false, motivo }`) al `404`/`409` de la
 * API. La base vuelve a comprobarlo todo bajo candado y es la última barrera.
 *
 * NO importa nada de `src/lib/flujo/` (los agrupadores no dependen del flujo): lo que necesita de compras (`k'`, nombres del catálogo)
 * lo toma de `src/lib/compras/servicio.ts`.
 */

// ─── Quién llama ───

export type UsuarioAgrupadores = UsuarioCompras;

export const actorDe = (u: UsuarioAgrupadores): ActorAgrupador => ({ perfil_id: u.id, nombre: u.nombre });

/** El usuario del guard como lo piden las funciones de este servicio (sin nombre, firma con el correo). */
export const usuarioDe = (perfil: { id: string; nombre: string | null; email: string }, rol: UsuarioAgrupadores["rol"]): UsuarioAgrupadores => ({ id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol });

// ─── Respuestas de error ───

/** Motivos que la base añadió a los de la ficha (validaciones que zod ya hace antes; si llegan, son `400`). */
const MOTIVOS_DE_VALIDACION: Readonly<Record<string, string>> = {
  fecha_requerida: "Falta una fecha obligatoria.",
  fin_antes_de_inicio: "La fecha de fin no puede ser anterior a la de inicio.",
};

/** Motivos en que el detalle del plan puro («Solo hay 120 u sin asignar en esta entrega.») ayuda a la persona. */
const MOTIVOS_CON_DETALLE: ReadonlySet<string> = new Set(["excede_entrega", "max_entregas", "reparto_sin_vector", "compra_no_asignable", "saldo_cerrado", "sin_pendientes"]);

const esCodigoConocido = (m: string): m is CodigoErrorAgrupador => Object.hasOwn(ESTADO_HTTP_ERROR_AGRUPADOR, m);

/** El motivo de una función de escritura (o de un plan puro) como respuesta HTTP: `404` o `409` con el mismo código y texto en castellano. */
export function respuestaDeMotivo(motivo: unknown, detalle?: string): NextResponse {
  const m = typeof motivo === "string" ? motivo : "";
  const codigo = m === "clave_existente" ? "vuelve_a_previsualizar" : m;
  if (esCodigoConocido(codigo)) {
    const base = MENSAJE_ERROR_AGRUPADOR[codigo];
    return errorConCodigo(detalle && MOTIVOS_CON_DETALLE.has(codigo) ? `${base} ${detalle}` : base, ESTADO_HTTP_ERROR_AGRUPADOR[codigo], codigo);
  }
  if (Object.hasOwn(MOTIVOS_DE_VALIDACION, m)) return errorConCodigo(MOTIVOS_DE_VALIDACION[m], 400, m);
  console.error("agrupadores: motivo desconocido de una función de la base:", m);
  return errorConCodigo("No se pudo completar la operación. Inténtalo de nuevo.", 500, "error_interno");
}

const fallaMotivo = (motivo: unknown, detalle?: string): Salida<never> => falla(respuestaDeMotivo(motivo, detalle));

const esRegistro = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Un error de Postgres al llamar a una función de agrupadores. `40P01` (interbloqueo) y `55P03` (el candado no llegó a tiempo) no
 * escribieron nada: `409 conflicto_reintentar`, para que la pantalla reenvíe la misma petición. El resto, a `traducirErrorDb`.
 */
function fallaErrorRpc(e: Parameters<typeof fallaDb>[0], contexto: string): Salida<never> {
  if (e.code === "40P01" || e.code === "55P03") return fallaMensaje("Otra persona estaba cambiando lo mismo. Vuelve a intentarlo.", 409, "conflicto_reintentar");
  return fallaDb(e, contexto);
}

/**
 * Lo que dice una función de la base: `ok` con sus datos, o el `motivo` traducido. Un error de Postgres (incluido `AG002`, el fallo de
 * invariante que delata un plan mal armado) se traduce con `traducirErrorDb` y acaba en `500`: se ve, no se oculta como un `409`.
 */
function leerRpc(r: RespuestaRpc, contexto: string): Salida<Record<string, unknown>> {
  if (r.error) return fallaErrorRpc(r.error, contexto);
  if (!esRegistro(r.data) || typeof r.data.ok !== "boolean") {
    console.error(`${contexto}: respuesta inesperada de la función de la base`);
    return fallaMensaje("No se pudo completar la operación. Inténtalo de nuevo.", 500, "error_interno");
  }
  if (!r.data.ok) return fallaMotivo(r.data.motivo);
  return listo(r.data);
}

const noEncontrado = (): Salida<never> => fallaMotivo("no_encontrado");

// ─── Utilidades ───

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function elegir<T extends string>(permitidos: readonly T[], valor: unknown, defecto: T): T {
  return typeof valor === "string" && (permitidos as readonly string[]).includes(valor) ? (valor as T) : defecto;
}

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
const contiene = (texto: string, q: string) => sinAcentos(texto).includes(sinAcentos(q.trim()));
const costoCero = (): CostoPorMonedaApi => ({ PEN: 0, USD: 0 });
const redondear = (n: number) => Math.round(n * 100) / 100;

function agrupar<T>(items: readonly T[], clave: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = clave(it);
    if (k === null) continue;
    const l = m.get(k);
    if (l) l.push(it);
    else m.set(k, [it]);
  }
  return m;
}

// ─── El mundo: filas de la base → registros que usan las funciones puras ───

type Mundo = {
  viajes: ViajeRegistro[];
  embarques: EmbarqueRegistro[];
  paquetes: PaqueteRegistro[];
  asignaciones: AsignacionRegistro[];
  compras: CompraRegistro[];
  lineas: LineaRegistro[];
  entregas: EntregaRegistro[];
  recepciones: RecepcionRegistro[];
  perfiles: PerfilConCorreo[];
  /** `compras.viaje_id` por compra. */
  viaje_de_compra: Record<string, string | null>;
  viajeDb: ReadonlyMap<string, ViajeDb>;
  embarqueDb: ReadonlyMap<string, EmbarqueDb>;
};

const numeroONulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function alcanceDe(v: unknown): LineaRegistro["alcance"] {
  const o = esRegistro(v) ? v : {};
  const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : []);
  const salida: LineaRegistro["alcance"] = {};
  if (Array.isArray(o.generos)) salida.generos = ids(o.generos);
  if (Array.isArray(o.mundos)) salida.mundos = ids(o.mundos);
  if (Array.isArray(o.lineas)) salida.lineas = ids(o.lineas);
  return salida;
}

function armarMundo(db: MundoDb): Mundo {
  const proveedor = new Map(db.proveedores.map((p) => [p.id, p.nombre]));
  return {
    viajes: db.viajes.map((v) => ({
      id: v.id,
      codigo: v.codigo,
      nombre: v.nombre,
      destino: v.destino,
      fecha_inicio: v.fecha_inicio,
      fecha_fin: v.fecha_fin,
      responsable_id: v.responsable_id,
      estado: elegir(ESTADOS_VIAJE, v.estado, "abierto"),
      nota: v.nota,
      revision: v.revision,
    })),
    embarques: db.embarques.map((e) => ({
      id: e.id,
      codigo: e.codigo,
      nombre: e.nombre,
      tipo: elegir(TIPOS_EMBARQUE, e.tipo, "importacion"),
      viaje_id: e.viaje_id,
      responsable_id: e.responsable_id,
      referencia_logistica: e.referencia_logistica,
      puerto_embarque: e.puerto_embarque,
      fecha_salida_estimada: e.fecha_salida_estimada,
      fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
      fecha_llegada_estimada: e.fecha_llegada_estimada,
      fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
      hora_inicio_operativo: e.hora_inicio_operativo?.slice(0, 5) ?? null,
      fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
      fecha_llegada_real: e.fecha_llegada_real,
      // La misma regla que la columna generada `periodo_llegada` (revisión B2; desde la 0038 lee el ingreso al stock).
      periodo_llegada: periodoLlegada(e.fecha_llegada_real, e.fecha_ingreso_estimada, e.fecha_llegada_estimada),
      hito_confirmado: HITOS_CONFIRMABLES.find((h) => h === e.hito_confirmado) ?? null,
      origen: e.origen ?? null,
      estado: elegir(ESTADOS_EMBARQUE, e.estado, "planificado"),
      nota: e.nota,
      revision: e.revision,
    })),
    paquetes: db.paquetes.map((p) => ({ id: p.id, embarque_id: p.embarque_id, codigo: p.codigo, nombre: p.nombre, responsable_id: p.responsable_id, estado: elegir(ESTADOS_PAQUETE, p.estado, "abierto"), nota: p.nota, fecha_ingreso_estimada: p.fecha_ingreso_estimada ?? null, periodo_ingreso: p.periodo_ingreso ? mesDe(p.periodo_ingreso) : null })),
    asignaciones: db.asignaciones.map((a) => ({ id: a.id, entrega_id: a.entrega_id, embarque_id: a.embarque_id, paquete_id: a.paquete_id, unidades: a.unidades })),
    compras: db.compras.map((c) => ({
      id: c.id,
      numero: c.numero,
      proveedor_id: c.proveedor_id,
      proveedor_nombre: proveedor.get(c.proveedor_id) ?? "—",
      origen: elegir(ORIGENES_COMPRA, c.origen, "comprador"),
      estado: elegir(ESTADOS_COMPRA, c.estado, "confirmada"),
      fecha_compra: c.fecha_compra.slice(0, 10),
      moneda: elegir(MONEDAS, c.moneda, "PEN"),
      cancelada_at: c.cancelada_at,
      revision: c.revision,
    })),
    lineas: db.lineas.map((l) => ({
      id: l.id,
      compra_id: l.compra_id,
      tipo: elegir(TIPOS_LINEA, l.tipo, "especifica"),
      genero_mundo_linea_id: l.genero_mundo_linea_id,
      equivalencia_id: l.equivalencia_id,
      marca_id: l.marca_id,
      agrupacion_marca_id: l.agrupacion_marca_id,
      tallas: elegir(TALLAS_COMPRA, l.tallas, "ambas"),
      unidades: l.unidades,
      unidades_recibidas: l.unidades_recibidas,
      unidades_canceladas: l.unidades_canceladas,
      costo_unitario: numeroONulo(l.costo_unitario),
      destino: elegir(DESTINOS_COMPRA, l.destino, "cd"),
      tienda_id: l.tienda_id,
      alcance: alcanceDe(l.alcance),
      activo: l.activo,
    })),
    entregas: db.entregas.map((e) => ({ id: e.id, linea_id: e.linea_id, periodo: mesDe(e.periodo), unidades: e.unidades, origen: elegir(ORIGENES_ENTREGA, e.origen, "manual") })),
    recepciones: db.recepciones.map((r) => ({ id: r.id, linea_id: r.linea_id, recibida_periodo: mesDe(r.recibida_periodo), unidades: r.unidades, fecha_recepcion: r.fecha_recepcion, origen: elegir(ORIGENES_RECEPCION, r.origen, "manual") })),
    perfiles: db.perfiles.map((p) => ({ id: p.id, nombre: p.nombre ?? p.email, rol: normalizarRol(p.rol), activo: p.activo, email: p.email })),
    viaje_de_compra: Object.fromEntries(db.compras.map((c) => [c.id, c.viaje_id])),
    viajeDb: new Map(db.viajes.map((v) => [v.id, v])),
    embarqueDb: new Map(db.embarques.map((e) => [e.id, e])),
  };
}

/** Índices del mundo, armados una vez por petición. */
type Ix = {
  m: Mundo;
  viaje: Map<string, ViajeRegistro>;
  embarque: Map<string, EmbarqueRegistro>;
  paquete: Map<string, PaqueteRegistro>;
  compra: Map<string, CompraRegistro>;
  linea: Map<string, LineaRegistro>;
  entrega: Map<string, EntregaRegistro>;
  perfil: Map<string, PerfilConCorreo>;
  /** Nombre de cada proveedor que aparece en una compra. */
  proveedor: Map<string, string>;
  asigDeEmbarque: Map<string, AsignacionRegistro[]>;
  asigDeEntrega: Map<string, AsignacionRegistro[]>;
  entregasDeLinea: Map<string, EntregaRegistro[]>;
  lineasDeCompra: Map<string, LineaRegistro[]>;
  pend: Map<string, PendienteAsignacion>;
  hoy: string;
  /** `agrupador_hitos_resumen` por embarque (08b-1b): vacío salvo que la lectura lo pida (`cargarResumenes`). */
  resumenes: Map<string, ResumenHito[]>;
};

function indexar(m: Mundo, hoy: string): Ix {
  const ix: Ix = {
    m,
    viaje: new Map(m.viajes.map((x) => [x.id, x])),
    embarque: new Map(m.embarques.map((x) => [x.id, x])),
    paquete: new Map(m.paquetes.map((x) => [x.id, x])),
    compra: new Map(m.compras.map((x) => [x.id, x])),
    linea: new Map(m.lineas.map((x) => [x.id, x])),
    entrega: new Map(m.entregas.map((x) => [x.id, x])),
    perfil: new Map(m.perfiles.map((x) => [x.id, x])),
    proveedor: new Map(m.compras.map((c) => [c.proveedor_id, c.proveedor_nombre])),
    asigDeEmbarque: agrupar(m.asignaciones, (a) => a.embarque_id),
    asigDeEntrega: agrupar(m.asignaciones, (a) => a.entrega_id),
    entregasDeLinea: agrupar(m.entregas, (e) => e.linea_id),
    lineasDeCompra: agrupar(m.lineas, (l) => l.compra_id),
    pend: new Map(),
    hoy,
    resumenes: new Map(),
  };
  ix.pend = pendientesDe(ix);
  return ix;
}

/**
 * Lee `agrupador_hitos_resumen` de los embarques del mundo (fecha original, reprogramaciones y última causa de cada hito; 08b-1b §2.9) y lo
 * deja en el índice. Solo lo piden las lecturas que muestran hitos (lista, detalle y viaje), no los planes de movimiento.
 */
async function cargarResumenes(d: Db, ix: Ix, embarqueIds: readonly string[] = ix.m.embarques.map((e) => e.id)): Promise<Salida<null>> {
  const r = await leerResumenHitos(d, embarqueIds);
  if (r.error) return fallaDb(r.error, "agrupadores: leer el resumen de hitos");
  for (const f of r.data) {
    const fila: ResumenHito = { hito: f.hito as ResumenHito["hito"], paquete_id: f.paquete_id, fecha_original: f.fecha_original, reprogramaciones: Number(f.reprogramaciones), ultima_causa: f.ultima_causa };
    const l = ix.resumenes.get(f.embarque_id);
    if (l) l.push(fila);
    else ix.resumenes.set(f.embarque_id, [fila]);
  }
  return listo(null);
}

/**
 * Pendiente de cada asignación (estimado con el FIFO de M8; 08b-1). `estimarPendientesAsignaciones` recorre todas las líneas del
 * contexto contra TODAS las recepciones; con miles de líneas eso es cuadrático, así que se llama línea a línea con un contexto mínimo
 * (la línea, su compra, sus entregas, recepciones y asignaciones, y los embarques y paquetes para ordenar).
 */
function pendientesDe(ix: Ix): Map<string, PendienteAsignacion> {
  const salida = new Map<string, PendienteAsignacion>();
  const recepcionesDeLinea = agrupar(ix.m.recepciones, (r) => r.linea_id);
  const lineasConAsignacion = new Set<string>();
  for (const a of ix.m.asignaciones) {
    const linea = ix.entrega.get(a.entrega_id)?.linea_id;
    if (linea) lineasConAsignacion.add(linea);
  }
  for (const lineaId of lineasConAsignacion) {
    const linea = ix.linea.get(lineaId);
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (!linea || !compra) continue;
    const entregas = ix.entregasDeLinea.get(lineaId) ?? [];
    const asignaciones = entregas.flatMap((e) => ix.asigDeEntrega.get(e.id) ?? []);
    const ctx: ContextoMovimiento = {
      k_prima: null,
      viajes: [],
      embarques: ix.m.embarques,
      paquetes: ix.m.paquetes,
      asignaciones,
      compras: [compra],
      lineas: [linea],
      entregas,
      repartos: [],
      recepciones: recepcionesDeLinea.get(lineaId) ?? [],
      viaje_de_compra: {},
      repartos_por_id: new Map(),
      nodos: new Map(),
    };
    for (const [id, p] of estimarPendientesAsignaciones(ctx)) salida.set(id, p);
  }
  return salida;
}

// ─── Armar los objetos de la API ───

const persona = (nombre: string | null, at: string): PersonaFechaApi => ({ nombre, at });

function etiquetaDeLinea(l: LineaRegistro, n: NombresCatalogo): string {
  if (l.tipo === "especifica") {
    const base = (l.genero_mundo_linea_id ? n.nodos.get(l.genero_mundo_linea_id)?.linea : undefined) ?? "Línea";
    const marca = l.marca_id ? n.marcas.get(l.marca_id) : l.agrupacion_marca_id ? n.agrupaciones.get(l.agrupacion_marca_id) : undefined;
    return marca ? `${base} · ${marca}` : base;
  }
  const marca = l.marca_id ? n.marcas.get(l.marca_id) : undefined;
  return marca ? `Lote ${marca}` : "Lote";
}

function lineaApi(l: LineaRegistro, compra: CompraRegistro, n: NombresCatalogo): AsignacionApi["linea"] {
  return {
    id: l.id,
    tipo: l.tipo,
    gml: l.tipo === "especifica" ? rutaLegible(n, l.genero_mundo_linea_id, l.equivalencia_id) : null,
    marca: l.marca_id ? (n.marcas.get(l.marca_id) ?? null) : null,
    agrupacion_marca: l.agrupacion_marca_id ? (n.agrupaciones.get(l.agrupacion_marca_id) ?? null) : null,
    tallas: l.tallas,
    costo_unitario: l.costo_unitario,
    moneda: compra.moneda,
  };
}

function compraApi(ix: Ix, c: CompraRegistro): AsignacionApi["compra"] {
  return { id: c.id, numero: c.numero, revision: c.revision, estado: c.estado, proveedor: { id: c.proveedor_id, nombre: c.proveedor_nombre }, viaje_id: ix.m.viaje_de_compra[c.id] ?? null, fecha_compra: c.fecha_compra };
}

function asignacionApi(ix: Ix, a: AsignacionRegistro, n: NombresCatalogo): AsignacionApi | null {
  const entrega = ix.entrega.get(a.entrega_id);
  const linea = entrega ? ix.linea.get(entrega.linea_id) : undefined;
  const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
  if (!entrega || !linea || !compra) return null;
  const clase = clasificarAsignacion(compra, linea);
  const p = ix.pend.get(a.id);
  return {
    id: a.id,
    entrega_id: a.entrega_id,
    periodo: entrega.periodo,
    paquete_id: a.paquete_id,
    unidades: a.unidades,
    recibidas: p?.recibidas ?? 0,
    recibidas_estimadas: true,
    pendiente: clase.historica ? 0 : (p?.pendiente ?? a.unidades),
    historica: clase.historica,
    compra: compraApi(ix, compra),
    linea: lineaApi(linea, compra, n),
  };
}

type TotalesAsignaciones = { compras: Set<string>; lineas: Set<string>; unidades: number; recibidas: number; pendientes: number; historicas: number; costo: CostoPorMonedaApi; proveedores: Set<string> };

function totalesDe(ix: Ix, asignaciones: readonly AsignacionRegistro[]): TotalesAsignaciones {
  const t: TotalesAsignaciones = { compras: new Set(), lineas: new Set(), unidades: 0, recibidas: 0, pendientes: 0, historicas: 0, costo: costoCero(), proveedores: new Set() };
  for (const a of asignaciones) {
    const entrega = ix.entrega.get(a.entrega_id);
    const linea = entrega ? ix.linea.get(entrega.linea_id) : undefined;
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (!linea || !compra) continue;
    t.proveedores.add(compra.proveedor_id);
    if (clasificarAsignacion(compra, linea).historica) {
      t.historicas += a.unidades;
      continue;
    }
    const p = ix.pend.get(a.id);
    t.compras.add(compra.id);
    t.lineas.add(linea.id);
    t.unidades += a.unidades;
    t.recibidas += p?.recibidas ?? 0;
    t.pendientes += p?.pendiente ?? a.unidades;
    t.costo[compra.moneda] += a.unidades * (linea.costo_unitario ?? 0);
  }
  t.costo = { PEN: redondear(t.costo.PEN), USD: redondear(t.costo.USD) };
  return t;
}

function paraAviso(ix: Ix, asignaciones: readonly AsignacionRegistro[]): AsignacionParaAviso[] {
  const salida: AsignacionParaAviso[] = [];
  for (const a of asignaciones) {
    const entrega = ix.entrega.get(a.entrega_id);
    const linea = entrega ? ix.linea.get(entrega.linea_id) : undefined;
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (!entrega || !linea || !compra) continue;
    const clase = clasificarAsignacion(compra, linea);
    const e = ix.embarque.get(a.embarque_id);
    salida.push({
      periodo: entrega.periodo,
      historica: clase.historica,
      linea_recibida: clase.linea_recibida,
      paquete_id: a.paquete_id,
      // 08b-1b §2.4 bis: el mes de destino de la asignación (el de su paquete si tiene ingreso propio; si no, el del embarque).
      ...(e ? { periodo_destino: mesDeDestino(e, a.paquete_id ? ix.paquete.get(a.paquete_id) : null) } : {}),
    });
  }
  return salida;
}

function responsableDeEmbarque(ix: Ix, e: EmbarqueRegistro): ResponsableCalculado {
  const viaje = e.viaje_id ? ix.viaje.get(e.viaje_id) : undefined;
  return responsableEfectivo({ propio: e.responsable_id, viaje: viaje?.responsable_id ?? null }, ix.m.perfiles);
}

function recepcionDe(t: Pick<TotalesAsignaciones, "unidades" | "recibidas" | "pendientes">): RecepcionEmbarque {
  if (t.unidades === 0) return "vacio";
  if (t.recibidas === 0) return "sin_recibir";
  return t.pendientes === 0 ? "completa" : "parcial";
}

function paqueteApi(ix: Ix, p: PaqueteRegistro, e: EmbarqueRegistro): PaqueteApi {
  const asigs = (ix.asigDeEmbarque.get(e.id) ?? []).filter((a) => a.paquete_id === p.id);
  const t = totalesDe(ix, asigs);
  const viaje = e.viaje_id ? ix.viaje.get(e.viaje_id) : undefined;
  const responsable = responsableEfectivo({ propio: p.responsable_id, embarque: e.responsable_id, viaje: viaje?.responsable_id ?? null }, ix.m.perfiles);
  // Lotes al barrer con asignaciones activas en el paquete (una línea cuenta una vez).
  const lotes = new Set<string>();
  for (const a of asigs) {
    const linea = ix.entrega.get(a.entrega_id) ? ix.linea.get(ix.entrega.get(a.entrega_id)?.linea_id ?? "") : undefined;
    const compra = linea ? ix.compra.get(linea.compra_id) : undefined;
    if (linea && compra && linea.tipo !== "especifica" && !clasificarAsignacion(compra, linea).historica) lotes.add(linea.id);
  }
  return {
    id: p.id,
    embarque_id: p.embarque_id,
    codigo: p.codigo,
    nombre: p.nombre,
    estado: p.estado,
    nota: p.nota,
    fecha_ingreso: p.fecha_ingreso_estimada,
    periodo_ingreso: p.periodo_ingreso,
    ingreso_propio: p.fecha_ingreso_estimada !== null,
    lotes_al_barrer: lotes.size,
    responsable_efectivo: responsable.efectivo,
    totales: { asignaciones: asigs.length, compras: t.compras.size, lineas: t.lineas.size, unidades: t.unidades, recibidas: t.recibidas, pendientes: t.pendientes, historicas: t.historicas },
    avisos: avisosPaquete({ paquete: p, embarque: e, responsable, asignaciones: paraAviso(ix, asigs) }),
  };
}

function embarqueApi(ix: Ix, e: EmbarqueRegistro): EmbarqueApi {
  const db = ix.m.embarqueDb.get(e.id);
  const asigs = ix.asigDeEmbarque.get(e.id) ?? [];
  const t = totalesDe(ix, asigs);
  const viaje = e.viaje_id ? ix.viaje.get(e.viaje_id) : undefined;
  const responsable = responsableDeEmbarque(ix, e);
  const paquetes = ix.m.paquetes.filter((p) => p.embarque_id === e.id && p.estado !== "cancelado");
  const resumen = ix.resumenes.get(e.id) ?? [];
  const hitos = hitosDeEmbarque(e, ix.hoy, resumen);
  // `hito_vencido` (08b-1b §3.5): algún hito que no es el ingreso al stock está vencido (el ingreso lo cubre `atrasado`).
  const conHitoVencido = hitos.some((h) => h.estado === "vencido" && h.hito !== "ingreso_stock") && (e.estado === "planificado" || e.estado === "en_transito");
  const avisos = avisosEmbarque({ embarque: e, viaje: viaje ?? null, responsable, asignaciones: paraAviso(ix, asigs), hoy: ix.hoy });
  return {
    id: e.id,
    codigo: e.codigo,
    nombre: e.nombre,
    tipo: e.tipo,
    viaje: viaje ? { id: viaje.id, codigo: viaje.codigo, nombre: viaje.nombre, estado: viaje.estado } : null,
    referencia_logistica: e.referencia_logistica,
    puerto_embarque: e.puerto_embarque,
    puertos_habituales: [],
    fecha_salida_estimada: e.fecha_salida_estimada,
    fecha_puerto_estimada: e.fecha_puerto_estimada,
    fecha_llegada_estimada: e.fecha_llegada_estimada,
    fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada,
    hora_inicio_operativo: e.hora_inicio_operativo,
    fecha_ingreso_estimada: e.fecha_ingreso_estimada,
    hito_confirmado: e.hito_confirmado,
    origen: e.origen,
    hitos,
    reprogramaciones_total: reprogramacionesTotal(resumen),
    proximo_hito: proximoHitoEmbarque(hitos),
    fecha_llegada_real: e.fecha_llegada_real,
    periodo_llegada: e.periodo_llegada,
    estado: e.estado,
    recepcion: recepcionDe(t),
    revision: e.revision,
    nota: e.nota,
    responsable_efectivo: responsable.efectivo,
    totales: { paquetes: paquetes.length, compras: t.compras.size, lineas: t.lineas.size, unidades: t.unidades, recibidas: t.recibidas, pendientes: t.pendientes, historicas: t.historicas, costo: t.costo },
    proveedores: [...t.proveedores]
      .map((id) => ({ id, nombre: ix.proveedor.get(id) ?? "—" }))
      .sort((a, b) => comparar(a.nombre, b.nombre) || comparar(a.id, b.id)),
    avisos: conHitoVencido ? AVISOS_AGRUPADOR.filter((a) => a === "hito_vencido" || avisos.includes(a)) : avisos,
    creado_por: persona(db?.usuario_nombre ?? null, db?.created_at ?? ""),
    modificado_por: e.revision > 0 && db ? persona(db.updated_by_nombre, db.updated_at) : null,
  };
}

function embarqueDetalleApi(ix: Ix, e: EmbarqueRegistro, n: NombresCatalogo): EmbarqueDetalleApi {
  const paquetes = ix.m.paquetes.filter((p) => p.embarque_id === e.id).sort((a, b) => comparar(a.codigo, b.codigo) || comparar(a.id, b.id));
  const codigoPaquete = new Map(paquetes.map((p) => [p.id, p.codigo]));
  const asignaciones = (ix.asigDeEmbarque.get(e.id) ?? [])
    .map((a) => asignacionApi(ix, a, n))
    .filter((a): a is AsignacionApi => a !== null)
    .sort(
      (a, b) =>
        comparar(codigoPaquete.get(a.paquete_id ?? "") ?? "￿", codigoPaquete.get(b.paquete_id ?? "") ?? "￿") ||
        comparar(a.compra.numero, b.compra.numero) ||
        comparar(a.linea.id, b.linea.id) ||
        comparar(a.periodo, b.periodo) ||
        comparar(a.id, b.id),
    );
  return { ...embarqueApi(ix, e), paquetes: paquetes.map((p) => paqueteApi(ix, p, e)), asignaciones };
}

/** Compras activas (no canceladas) de un viaje, con sus unidades, costo y lo que falta asignar a un embarque. */
function compraDeViaje(ix: Ix, c: CompraRegistro): CompraDeViajeApi {
  let unidades = 0;
  let sinEmbarque = 0;
  const costo = costoCero();
  const esActiva = c.estado === "borrador" || c.estado === "confirmada";
  for (const l of ix.lineasDeCompra.get(c.id) ?? []) {
    if (!l.activo) continue;
    unidades += l.unidades;
    costo[c.moneda] += l.unidades * (l.costo_unitario ?? 0);
    if (!esActiva || l.unidades_recibidas + l.unidades_canceladas >= l.unidades) continue;
    for (const e of ix.entregasDeLinea.get(l.id) ?? []) {
      sinEmbarque += Math.max(0, e.unidades - (ix.asigDeEntrega.get(e.id) ?? []).reduce((s, a) => s + a.unidades, 0));
    }
  }
  return {
    id: c.id,
    numero: c.numero,
    revision: c.revision,
    estado: c.estado,
    proveedor: { id: c.proveedor_id, nombre: c.proveedor_nombre },
    fecha_compra: c.fecha_compra,
    unidades,
    costo: { PEN: redondear(costo.PEN), USD: redondear(costo.USD) },
    unidades_sin_embarque: sinEmbarque,
  };
}

function viajeApi(ix: Ix, v: ViajeRegistro): ViajeApi {
  const db = ix.m.viajeDb.get(v.id);
  const perfil = v.responsable_id ? ix.perfil.get(v.responsable_id) : undefined;
  const responsable = responsableEfectivo({ propio: v.responsable_id }, ix.m.perfiles);
  const compras = ix.m.compras.filter((c) => ix.m.viaje_de_compra[c.id] === v.id && c.estado !== "cancelada").map((c) => compraDeViaje(ix, c));
  const costo = costoCero();
  for (const c of compras) {
    costo.PEN += c.costo.PEN;
    costo.USD += c.costo.USD;
  }
  return {
    id: v.id,
    codigo: v.codigo,
    nombre: v.nombre,
    destino: v.destino,
    fecha_inicio: v.fecha_inicio,
    fecha_fin: v.fecha_fin,
    estado: v.estado,
    revision: v.revision,
    nota: v.nota,
    responsable: v.responsable_id ? { perfil_id: v.responsable_id, nombre: perfil?.nombre ?? null } : null,
    responsable_valido: esAsignable(perfil),
    totales: {
      compras: compras.length,
      unidades: compras.reduce((s, c) => s + c.unidades, 0),
      costo: { PEN: redondear(costo.PEN), USD: redondear(costo.USD) },
      embarques: ix.m.embarques.filter((e) => e.viaje_id === v.id && e.estado !== "cancelado").length,
      unidades_sin_embarque: compras.reduce((s, c) => s + c.unidades_sin_embarque, 0),
    },
    avisos: avisosViaje(responsable),
    creado_por: persona(db?.usuario_nombre ?? null, db?.created_at ?? ""),
    modificado_por: v.revision > 0 && db ? persona(db.updated_by_nombre, db.updated_at) : null,
  };
}

const ordenViajes = (a: ViajeApi, b: ViajeApi) => comparar(b.fecha_inicio, a.fecha_inicio) || comparar(b.codigo, a.codigo) || comparar(a.id, b.id);
const ordenEmbarques = (a: EmbarqueApi, b: EmbarqueApi) => comparar(b.fecha_llegada_estimada, a.fecha_llegada_estimada) || comparar(b.codigo, a.codigo) || comparar(a.id, b.id);

function asignables(perfiles: readonly PerfilConCorreo[]): AsignableApi[] {
  return perfiles
    .filter((p) => esAsignable(p))
    .map((p) => ({ perfil_id: p.id, nombre: p.nombre, email: p.email, rol: p.rol as AsignableApi["rol"] }))
    .sort((a, b) => comparar(sinAcentos(a.nombre ?? a.email), sinAcentos(b.nombre ?? b.email)) || comparar(a.perfil_id, b.perfil_id));
}

// ─── Lecturas ───

async function mundoCompleto(d: Db): Promise<Salida<Ix>> {
  const r = await leerMundoCompleto(d);
  if (r.error) return fallaDb(r.error, "agrupadores: leer los datos");
  return listo(indexar(armarMundo(r.data), hoyLima()));
}

async function mundoAlcanzado(d: Db, s: Semillas): Promise<Salida<Ix>> {
  const r = await leerMundoAlcanzado(d, s);
  if (r.error) return fallaDb(r.error, "agrupadores: leer los datos");
  return listo(indexar(armarMundo(r.data), hoyLima()));
}

/** `GET /api/compras/viajes`: todos los viajes con sus totales y los responsables posibles. Los filtros del navegador («Mis viajes», texto) también valen aquí. */
export async function listarViajes(d: Db, usuario: UsuarioAgrupadores, q: ViajesQuery): Promise<Salida<RespuestaViajesApi>> {
  const w = await mundoCompleto(d);
  if (w.respuesta) return falla(w.respuesta);
  const ix = w.data;
  const viajes = ix.m.viajes
    .filter((v) => (q.estado === undefined || v.estado === q.estado) && (q.responsable_id === undefined || v.responsable_id === q.responsable_id) && (!q.mio || v.responsable_id === usuario.id))
    .map((v) => viajeApi(ix, v))
    .filter((v) => q.q === undefined || q.q === "" || contiene(`${v.codigo} ${v.nombre} ${v.destino ?? ""}`, q.q))
    .sort(ordenViajes);
  return listo({ viajes, asignables: asignables(ix.m.perfiles) });
}

/** `GET /api/compras/viajes/[id]`: el viaje, sus compras (no canceladas) y sus embarques. */
export async function leerViaje(d: Db, id: string): Promise<Salida<ViajeDetalleApi>> {
  const w = await mundoAlcanzado(d, { viajes: [id] });
  if (w.respuesta) return falla(w.respuesta);
  const ix = w.data;
  const v = ix.viaje.get(id);
  if (!v) return noEncontrado();
  const compras = ix.m.compras
    .filter((c) => ix.m.viaje_de_compra[c.id] === id && c.estado !== "cancelada")
    .map((c) => compraDeViaje(ix, c))
    .sort((a, b) => comparar(a.numero, b.numero));
  const delViaje = ix.m.embarques.filter((e) => e.viaje_id === id);
  const resumenes = await cargarResumenes(d, ix, delViaje.map((e) => e.id));
  if (resumenes.respuesta) return falla(resumenes.respuesta);
  const embarques = delViaje.map((e) => embarqueApi(ix, e)).sort(ordenEmbarques);
  return listo({ viaje: viajeApi(ix, v), compras, embarques });
}

async function viajeFresco(d: Db, id: string): Promise<Salida<ViajeApi>> {
  const w = await mundoAlcanzado(d, { viajes: [id] });
  if (w.respuesta) return falla(w.respuesta);
  const v = w.data.viaje.get(id);
  return v ? listo(viajeApi(w.data, v)) : noEncontrado();
}

/** `GET /api/compras/embarques`: todos los embarques con totales, avisos y hitos (con su resumen de reprogramaciones), filtrados. */
export async function listarEmbarques(d: Db, usuario: UsuarioAgrupadores, q: EmbarquesQuery): Promise<Salida<{ embarques: EmbarqueApi[] }>> {
  const w = await mundoCompleto(d);
  if (w.respuesta) return falla(w.respuesta);
  const ix = w.data;
  const origenBuscado = q.origen === undefined || q.origen === "" ? null : sinAcentos(q.origen).trim();
  const candidatos = ix.m.embarques.filter((e) => {
    if (q.estado !== undefined && e.estado !== q.estado) return false;
    if (q.tipo !== undefined && e.tipo !== q.tipo) return false;
    if (q.viaje_id !== undefined && (q.viaje_id === "sin_viaje" ? e.viaje_id !== null : e.viaje_id !== q.viaje_id)) return false;
    if (q.desde !== undefined && e.periodo_llegada < q.desde) return false;
    if (q.hasta !== undefined && e.periodo_llegada > q.hasta) return false;
    if (origenBuscado !== null && sinAcentos(e.origen ?? "") !== origenBuscado) return false;
    return true;
  });
  const resumenes = await cargarResumenes(d, ix, candidatos.map((e) => e.id));
  if (resumenes.respuesta) return falla(resumenes.respuesta);
  const embarques = candidatos
    .map((e) => embarqueApi(ix, e))
    .filter((e) => {
      if (q.responsable_id !== undefined && e.responsable_efectivo?.perfil_id !== q.responsable_id) return false;
      if (q.mio && !esMio(e.responsable_efectivo, usuario.id)) return false;
      if (q.atrasados && !tieneHitoVencido(e.hitos ?? [])) return false;
      if (q.reprogramados && (e.reprogramaciones_total ?? 0) === 0) return false;
      if (q.q !== undefined && q.q !== "" && !contiene(`${e.codigo} ${e.nombre} ${e.puerto_embarque ?? ""} ${e.referencia_logistica ?? ""} ${e.origen ?? ""} ${e.viaje?.codigo ?? ""}`, q.q)) return false;
      return true;
    })
    .sort(ordenEmbarques);
  return listo({ embarques });
}

/** El detalle de un embarque ya leído: sus paquetes y todas sus asignaciones (las históricas, marcadas). */
async function detalleDe(d: Db, id: string): Promise<Salida<EmbarqueDetalleApi>> {
  const [w, nombres] = await Promise.all([mundoAlcanzado(d, { embarques: [id] }), nombresDeCatalogo(d)]);
  if (w.respuesta) return falla(w.respuesta);
  if (nombres.respuesta) return falla(nombres.respuesta);
  const e = w.data.embarque.get(id);
  if (!e) return noEncontrado();
  const resumenes = await cargarResumenes(d, w.data, [id]);
  if (resumenes.respuesta) return falla(resumenes.respuesta);
  return listo(embarqueDetalleApi(w.data, e, nombres.data));
}

/** `GET /api/compras/embarques/[id]`. */
export const leerEmbarque = detalleDe;

/** `GET /api/compras/agrupadores/opciones`: los selectores (viajes, embarques y paquetes vigentes, asignables y puertos ya usados). */
export async function leerOpciones(d: Db): Promise<Salida<OpcionesAgrupadoresApi>> {
  const r = await leerAgrupadores(d);
  if (r.error) return fallaDb(r.error, "agrupadores: leer las opciones");
  const ix = armarMundo({ viajes: r.data.viajes, embarques: r.data.embarques, paquetes: r.data.paquetes, asignaciones: [], compras: [], lineas: [], entregas: [], recepciones: [], proveedores: [], perfiles: r.data.perfiles });
  const embarquesVigentes = ix.embarques.filter((e) => e.estado !== "cancelado");
  const vigentes = new Set(embarquesVigentes.map((e) => e.id));
  return listo({
    viajes: ix.viajes
      .filter((v) => v.estado !== "cancelado")
      .map((v) => ({ id: v.id, codigo: v.codigo, nombre: v.nombre, estado: v.estado, fecha_inicio: v.fecha_inicio }))
      .sort((a, b) => comparar(b.fecha_inicio, a.fecha_inicio) || comparar(b.codigo, a.codigo)),
    embarques: embarquesVigentes
      .map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre, tipo: e.tipo, estado: e.estado, periodo_llegada: e.periodo_llegada, viaje_id: e.viaje_id, revision: e.revision }))
      .sort((a, b) => comparar(b.periodo_llegada, a.periodo_llegada) || comparar(b.codigo, a.codigo)),
    paquetes: ix.paquetes
      .filter((p) => p.estado === "abierto" && vigentes.has(p.embarque_id))
      .map((p) => ({ id: p.id, embarque_id: p.embarque_id, codigo: p.codigo, nombre: p.nombre, estado: p.estado }))
      .sort((a, b) => comparar(a.codigo, b.codigo) || comparar(a.id, b.id)),
    asignables: asignables(ix.perfiles),
    puertos: [...new Set(ix.embarques.map((e) => e.puerto_embarque).filter((p): p is string => p !== null && p.trim() !== ""))].sort((a, b) => comparar(sinAcentos(a), sinAcentos(b))),
  });
}

/**
 * `GET /api/compras/agrupadores/sin-asignar`: las entregas con unidades sin embarque (compras en borrador o confirmadas, líneas activas
 * y no recibidas por completo) y las compras sin viaje. Con `viaje_id`, las entregas son las de ese viaje (`sin_viaje`, las de compras sin
 * viaje); las compras sin viaje se devuelven siempre, porque son las candidatas a entrar al viaje.
 */
export async function leerSinAsignar(d: Db, q: SinAsignarQuery): Promise<Salida<SinAgrupadorApi>> {
  const [w, nombres] = await Promise.all([mundoCompleto(d), nombresDeCatalogo(d)]);
  if (w.respuesta) return falla(w.respuesta);
  if (nombres.respuesta) return falla(nombres.respuesta);
  const ix = w.data;
  const n = nombres.data;
  const coincideTexto = (c: CompraRegistro, extra = "") => q.q === undefined || q.q === "" || contiene(`${c.numero} ${c.proveedor_nombre} ${extra}`, q.q);

  const entregas: EntregaSinEmbarqueApi[] = [];
  for (const c of ix.m.compras) {
    if (c.estado !== "borrador" && c.estado !== "confirmada") continue;
    if (q.proveedor_id !== undefined && c.proveedor_id !== q.proveedor_id) continue;
    const viaje = ix.m.viaje_de_compra[c.id] ?? null;
    if (q.viaje_id !== undefined && (q.viaje_id === "sin_viaje" ? viaje !== null : viaje !== q.viaje_id)) continue;
    for (const l of ix.lineasDeCompra.get(c.id) ?? []) {
      if (!l.activo || l.unidades_recibidas + l.unidades_canceladas >= l.unidades) continue;
      if (!coincideTexto(c, etiquetaDeLinea(l, n))) continue;
      for (const e of ix.entregasDeLinea.get(l.id) ?? []) {
        if ((q.desde !== undefined && e.periodo < q.desde) || (q.hasta !== undefined && e.periodo > q.hasta)) continue;
        const sinAsignar = e.unidades - (ix.asigDeEntrega.get(e.id) ?? []).reduce((s, a) => s + a.unidades, 0);
        if (sinAsignar <= 0) continue;
        entregas.push({ entrega_id: e.id, periodo: e.periodo, unidades: e.unidades, sin_asignar: sinAsignar, compra: compraApi(ix, c), linea: lineaApi(l, c, n) });
      }
    }
  }
  entregas.sort((a, b) => comparar(a.periodo, b.periodo) || comparar(a.compra.numero, b.compra.numero) || comparar(a.linea.id, b.linea.id) || comparar(a.entrega_id, b.entrega_id));

  const comprasSinViaje: CompraSinViajeApi[] = ix.m.compras
    .filter((c) => c.estado !== "cancelada" && (ix.m.viaje_de_compra[c.id] ?? null) === null && (q.proveedor_id === undefined || c.proveedor_id === q.proveedor_id) && coincideTexto(c))
    .map((c) => ({ ...compraDeViaje(ix, c), origen: c.origen }))
    .sort((a, b) => comparar(b.fecha_compra, a.fecha_compra) || comparar(b.numero, a.numero));
  return listo({ entregas, compras_sin_viaje: comprasSinViaje });
}

/** `GET /api/compras/agrupadores/historial`: los eventos de un viaje, embarque o paquete, del más antiguo al más reciente; `404` si no existe. */
export async function leerHistorial(d: Db, q: HistorialQuery): Promise<Salida<{ eventos: EventoAgrupadorApi[] }>> {
  const ref = q.viaje_id ? { tipo: "viaje" as const, id: q.viaje_id } : q.embarque_id ? { tipo: "embarque" as const, id: q.embarque_id } : { tipo: "paquete" as const, id: q.paquete_id as string };
  const existe = ref.tipo === "viaje" ? await leerViajePorId(d, ref.id) : ref.tipo === "embarque" ? await leerEmbarquePorId(d, ref.id) : await leerPaquetePorId(d, ref.id);
  if (existe.error) return fallaDb(existe.error, "agrupadores: leer el agrupador");
  if (!existe.data) return noEncontrado();
  const r = await leerEventosAgrupador(d, ref);
  if (r.error) return fallaDb(r.error, "agrupadores: leer el historial");
  const lista = (x: unknown): { compra_id: string; revision_nueva: number }[] =>
    Array.isArray(x) ? x.filter(esRegistro).map((c) => ({ compra_id: String(c.compra_id ?? ""), revision_nueva: Number(c.revision_nueva ?? 0) })) : [];
  return listo({
    eventos: r.data.map((e) => ({
      id: e.id,
      viaje_id: e.viaje_id,
      embarque_id: e.embarque_id,
      paquete_id: e.paquete_id,
      accion: e.accion as EventoAgrupadorApi["accion"],
      antes: e.antes,
      despues: e.despues,
      motivo: e.motivo,
      resumen: e.resumen,
      compras: lista(e.compras),
      usuario_nombre: e.usuario_nombre,
      created_at: e.created_at,
    })),
  });
}

// ─── Viaje activo (§3.8) ───

/**
 * Valida el valor de `PUT /api/compras/viaje-activo`: `todos` y `sin_viaje` valen siempre; un uuid, si es de un viaje que existe y no está
 * cancelado (`404 no_encontrado` si no). Devuelve el valor ya validado para la cookie. La API nunca la lee (R22).
 */
export async function validarViajeActivoSolicitado(d: Db, cuerpo: ViajeActivoCuerpo): Promise<Salida<string>> {
  if (cuerpo.viaje_id === VIAJE_ACTIVO_TODOS || cuerpo.viaje_id === VIAJE_ACTIVO_SIN_VIAJE) return listo(cuerpo.viaje_id);
  const v = await leerViajePorId(d, cuerpo.viaje_id);
  if (v.error) return fallaDb(v.error, "agrupadores: leer el viaje");
  const valido = v.data ? validarViajeActivo(cuerpo.viaje_id, [{ id: v.data.id, estado: elegir(ESTADOS_VIAJE, v.data.estado, "abierto"), fecha_inicio: v.data.fecha_inicio, responsable_id: v.data.responsable_id }]) : null;
  return valido === null ? noEncontrado() : listo(valido);
}

// ─── Escrituras: viajes ───

const recortarNulo = (v: string | null | undefined): string | null => (v === undefined || v === null || v.trim() === "" ? null : v.trim());

/** `POST /api/compras/viajes` (`id = null`) y `PATCH /api/compras/viajes/[id]` (guardar_viaje). Devuelve el viaje al día. */
export async function guardarViaje(d: Db, usuario: UsuarioAgrupadores, cuerpo: GuardarViaje | EditarViaje, id: string | null): Promise<Salida<{ viaje: ViajeApi }>> {
  const viaje: Record<string, string | null> = {
    ...(id ? { id } : {}),
    ...(id === null && cuerpo.codigo ? { codigo: cuerpo.codigo } : {}),
    nombre: cuerpo.nombre,
    destino: recortarNulo(cuerpo.destino),
    fecha_inicio: cuerpo.fecha_inicio,
    fecha_fin: cuerpo.fecha_fin ?? null,
    responsable_id: cuerpo.responsable_id,
    nota: recortarNulo(cuerpo.nota),
  };
  const r = leerRpc(await rpcGuardarViaje(d, { viaje, revision: id === null ? null : (cuerpo.revision ?? null), actor: actorDe(usuario) }), "agrupadores: guardar el viaje");
  if (r.respuesta) return falla(r.respuesta);
  const fresco = await viajeFresco(d, String(r.data.viaje_id));
  if (fresco.respuesta) return falla(fresco.respuesta);
  return listo({ viaje: fresco.data });
}

/** `POST /api/compras/viajes/[id]/estado`: cerrar, reabrir o cancelar (cambiar_estado_agrupador). */
export async function cambiarEstadoViaje(d: Db, usuario: UsuarioAgrupadores, id: string, cuerpo: CambiarEstado): Promise<Salida<{ viaje: ViajeApi }>> {
  if (!accionAdmitidaPorTipo("viaje", cuerpo.accion)) return fallaMotivo("transicion_invalida");
  const r = leerRpc(
    await rpcCambiarEstadoAgrupador(d, { tipo: "viaje", id, accion: cuerpo.accion, revision: cuerpo.revision, motivo: recortarNulo(cuerpo.motivo), actor: actorDe(usuario) }),
    "agrupadores: cambiar el estado del viaje",
  );
  if (r.respuesta) return falla(r.respuesta);
  const fresco = await viajeFresco(d, id);
  if (fresco.respuesta) return falla(fresco.respuesta);
  return listo({ viaje: fresco.data });
}

const avisoDeFuncion = (a: unknown): AvisoDetalleApi | null => {
  if (!esRegistro(a) || a.codigo !== "viaje_cerrado") return null;
  return { aviso: "viaje_cerrado", detalle: typeof a.viaje === "string" && a.viaje !== "" ? `El viaje ${a.viaje} está cerrado: igual se registra.` : "El viaje está cerrado: igual se registra." };
};

/**
 * `POST /api/compras/viajes/[id]/compras`: pone (`viaje_id` = el del `[id]`) o quita (`viaje_id` nulo) el viaje de unas compras
 * (asignar_viaje_compras). Quitar solo vale para compras que hoy son de ese viaje: si no, `404 no_pertenece` (R23). Un viaje cerrado se
 * acepta con el aviso `viaje_cerrado`; uno cancelado, no.
 */
export async function asignarComprasAViaje(d: Db, usuario: UsuarioAgrupadores, id: string, pedido: AsignarViaje): Promise<Salida<RespuestaAsignarViajeApi>> {
  if (pedido.viaje_id !== null && pedido.viaje_id !== id) return fallaMensaje("El viaje del cuerpo no es el de la ruta.", 400);
  // B2: una compra repetida se procesa una vez; el mismo id con dos revisiones distintas es una vista vencida (409).
  const sinRepetidas = deduplicarComprasViaje(pedido.compras);
  if (!sinRepetidas.ok) return fallaMotivo("compra_cambio");
  const cuerpo: AsignarViaje = { ...pedido, compras: sinRepetidas.compras };
  if (cuerpo.viaje_id === null) {
    const compras = await leerComprasPorId(d, cuerpo.compras.map((c) => c.id));
    if (compras.error) return fallaDb(compras.error, "agrupadores: leer las compras");
    const delViaje = new Map(compras.data.map((c) => [c.id, c.viaje_id]));
    if (cuerpo.compras.some((c) => delViaje.get(c.id) !== id)) {
      return fallaMensaje("El viaje cambió mientras lo mirabas: alguna de esas compras ya no es de él. Se vuelve a leer; revisa y repite la acción.", 404, "no_pertenece");
    }
  }
  const r = leerRpc(await rpcAsignarViajeCompras(d, { viaje_id: cuerpo.viaje_id, compras: cuerpo.compras, actor: actorDe(usuario) }), "agrupadores: asignar compras al viaje");
  if (r.respuesta) return falla(r.respuesta);
  const fresco = await viajeFresco(d, id);
  if (fresco.respuesta) return falla(fresco.respuesta);
  const compras = Array.isArray(r.data.compras) ? r.data.compras.filter(esRegistro).map((c) => ({ id: String(c.id), revision: Number(c.revision) })) : [];
  const avisos = (Array.isArray(r.data.avisos) ? r.data.avisos : []).map(avisoDeFuncion).filter((a): a is AvisoDetalleApi => a !== null);
  return listo({ viaje: fresco.data, compras, avisos });
}

// ─── Escrituras: embarques y paquetes ───

/**
 * `POST /api/compras/embarques` (`id = null`) y `PATCH /api/compras/embarques/[id]` (guardar_embarque). Antes de llamar a la base aplica
 * `validarGuardarEmbarqueFechas` (08b-1b §2.9; la base lo repite): al CREAR escribe los cinco hitos y el ingreso al stock; al EDITAR no
 * escribe ninguna fecha ni hora (van por `POST …/fechas`: una clave presente y distinta de lo guardado da `409 fecha_por_movimiento`) y
 * una clave AUSENTE conserva lo guardado (F22: antes un `PATCH` sin la salida la mandaba como `null` y la borraba). Devuelve el detalle.
 */
export async function guardarEmbarque(d: Db, usuario: UsuarioAgrupadores, cuerpo: GuardarEmbarque | EditarEmbarque, id: string | null): Promise<Salida<{ embarque: EmbarqueDetalleApi }>> {
  let vigente: EmbarqueDb | null = null;
  if (id !== null) {
    const e = await leerEmbarquePorId(d, id);
    if (e.error) return fallaDb(e.error, "agrupadores: leer el embarque");
    if (!e.data) return noEncontrado();
    vigente = e.data;
  }
  const motivo = validarGuardarEmbarqueFechas(
    {
      tipo: cuerpo.tipo,
      viaje_id: cuerpo.viaje_id,
      ...(cuerpo.fecha_salida_estimada === undefined ? {} : { fecha_salida_estimada: cuerpo.fecha_salida_estimada }),
      ...(cuerpo.fecha_puerto_estimada === undefined ? {} : { fecha_puerto_estimada: cuerpo.fecha_puerto_estimada }),
      ...(cuerpo.fecha_llegada_estimada === undefined ? {} : { fecha_llegada_estimada: cuerpo.fecha_llegada_estimada }),
      ...(cuerpo.fecha_inicio_operativo_estimada === undefined ? {} : { fecha_inicio_operativo_estimada: cuerpo.fecha_inicio_operativo_estimada }),
      ...(cuerpo.hora_inicio_operativo === undefined ? {} : { hora_inicio_operativo: cuerpo.hora_inicio_operativo }),
      ...(cuerpo.fecha_ingreso_estimada === undefined ? {} : { fecha_ingreso_estimada: cuerpo.fecha_ingreso_estimada }),
    },
    vigente === null ? null : { ...vigente, hito_confirmado: HITOS_CONFIRMABLES.find((h) => h === vigente.hito_confirmado) ?? null },
  );
  if (motivo !== null) return fallaMotivo(motivo);

  // Solo viajan las claves que el cuerpo trae: la función trata la ausente como «conserva» y la presente (`null` incluido) como valor.
  const embarque: Record<string, string | null> = {
    ...(id ? { id } : {}),
    ...(id === null && cuerpo.codigo ? { codigo: cuerpo.codigo } : {}),
    nombre: cuerpo.nombre,
    tipo: cuerpo.tipo,
    viaje_id: cuerpo.viaje_id,
    responsable_id: cuerpo.responsable_id,
    referencia_logistica: recortarNulo(cuerpo.referencia_logistica),
    puerto_embarque: recortarNulo(cuerpo.puerto_embarque),
    ...(cuerpo.origen === undefined ? {} : { origen: recortarNulo(cuerpo.origen) }),
    nota: recortarNulo(cuerpo.nota),
  };
  if (id === null) {
    const fechas: [string, string | null | undefined][] = [
      ["fecha_salida_estimada", cuerpo.fecha_salida_estimada],
      ["fecha_puerto_estimada", cuerpo.fecha_puerto_estimada],
      ["fecha_llegada_estimada", cuerpo.fecha_llegada_estimada],
      ["fecha_inicio_operativo_estimada", cuerpo.fecha_inicio_operativo_estimada],
      ["hora_inicio_operativo", cuerpo.hora_inicio_operativo],
      ["fecha_ingreso_estimada", cuerpo.fecha_ingreso_estimada],
    ];
    for (const [clave, valor] of fechas) if (valor !== undefined) embarque[clave] = valor;
  }
  const r = leerRpc(await rpcGuardarEmbarque(d, { embarque, revision: id === null ? null : (cuerpo.revision ?? null), actor: actorDe(usuario) }), "agrupadores: guardar el embarque");
  if (r.respuesta) return falla(r.respuesta);
  const detalle = await detalleDe(d, String(r.data.embarque_id));
  if (detalle.respuesta) return falla(detalle.respuesta);
  return listo({ embarque: detalle.data });
}

/** `POST /api/compras/embarques/[id]/estado`: en tránsito, volver a planificado o cancelar (cambiar_estado_agrupador). */
export async function cambiarEstadoEmbarque(d: Db, usuario: UsuarioAgrupadores, id: string, cuerpo: CambiarEstado): Promise<Salida<{ embarque: EmbarqueDetalleApi }>> {
  if (!accionAdmitidaPorTipo("embarque", cuerpo.accion)) return fallaMotivo("transicion_invalida");
  const r = leerRpc(
    await rpcCambiarEstadoAgrupador(d, { tipo: "embarque", id, accion: cuerpo.accion, revision: cuerpo.revision, motivo: recortarNulo(cuerpo.motivo), actor: actorDe(usuario) }),
    "agrupadores: cambiar el estado del embarque",
  );
  if (r.respuesta) return falla(r.respuesta);
  const detalle = await detalleDe(d, id);
  if (detalle.respuesta) return falla(detalle.respuesta);
  return listo({ embarque: detalle.data });
}

/**
 * `POST /api/compras/embarques/[id]/paquetes` (`{ embarque_id }`) y `PATCH /api/compras/paquetes/[id]` (`{ paquete_id }`): crea o edita un
 * paquete (guardar_paquete). La revisión es la del EMBARQUE. Devuelve el detalle del embarque del paquete.
 */
export async function guardarPaquete(d: Db, usuario: UsuarioAgrupadores, destino: { embarque_id: string } | { paquete_id: string }, cuerpo: GuardarPaquete): Promise<Salida<{ embarque: EmbarqueDetalleApi }>> {
  const nuevo = "embarque_id" in destino;
  const paquete: Record<string, string | null> = {
    ...(nuevo ? { embarque_id: destino.embarque_id } : { id: destino.paquete_id }),
    ...(nuevo && cuerpo.codigo ? { codigo: cuerpo.codigo } : {}),
    nombre: cuerpo.nombre,
    responsable_id: cuerpo.responsable_id,
    nota: recortarNulo(cuerpo.nota),
  };
  const r = leerRpc(await rpcGuardarPaquete(d, { paquete, revision_embarque: cuerpo.revision_embarque, actor: actorDe(usuario) }), "agrupadores: guardar el paquete");
  if (r.respuesta) return falla(r.respuesta);
  const detalle = await detalleDe(d, String(r.data.embarque_id));
  if (detalle.respuesta) return falla(detalle.respuesta);
  return listo({ embarque: detalle.data });
}

/** `POST /api/compras/paquetes/[id]/estado`: cancelar un paquete (cambiar_estado_agrupador; `revision` es la del embarque). */
export async function cancelarPaquete(d: Db, usuario: UsuarioAgrupadores, id: string, cuerpo: CambiarEstado): Promise<Salida<{ embarque: EmbarqueDetalleApi }>> {
  if (!accionAdmitidaPorTipo("paquete", cuerpo.accion)) return fallaMotivo("transicion_invalida");
  const r = leerRpc(
    await rpcCambiarEstadoAgrupador(d, { tipo: "paquete", id, accion: cuerpo.accion, revision: cuerpo.revision, motivo: recortarNulo(cuerpo.motivo), actor: actorDe(usuario) }),
    "agrupadores: cancelar el paquete",
  );
  if (r.respuesta) return falla(r.respuesta);
  const detalle = await detalleDe(d, String(r.data.embarque_id));
  if (detalle.respuesta) return falla(detalle.respuesta);
  return listo({ embarque: detalle.data });
}

// ─── Movimientos de entregas (asignar, quitar, mover a paquete, cambiar fecha, pasar pendientes, mover un paquete) ───

type ContextoLeido = { ix: Ix; ctx: ContextoMovimiento };

function semillasDe(s: SolicitudMovimiento): Semillas {
  switch (s.operacion) {
    case "asignar":
      return { embarques: [s.embarque_id], entregas: s.items.map((i) => i.entrega_id), paquetes: s.paquete_id ? [s.paquete_id] : [] };
    case "quitar":
    case "cambiar_fecha":
      return { embarques: [s.embarque_id] };
    case "mover_a_paquete":
      return { embarques: [s.embarque_id], paquetes: s.paquete_id ? [s.paquete_id] : [] };
    case "mover_paquete":
      return { paquetes: [s.paquete_id], embarques: [s.embarque_destino_id] };
    case "pasar_pendientes":
      return { embarques: [s.embarque_id, s.embarque_destino_id], paquetes: s.paquete_destino_id ? [s.paquete_destino_id] : [] };
  }
}

const repartoRegistro = (r: { linea_id: string; entrega_id: string; marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number; reparto_id: string | null; reparto_version: number | null; temporada: string | null; error_reparto_pp: number | null }): RepartoRegistro => ({
  linea_id: r.linea_id,
  entrega_id: r.entrega_id,
  marca_id: r.marca_id,
  genero_mundo_linea_id: r.genero_mundo_linea_id,
  equivalencia_id: r.equivalencia_id,
  unidades: r.unidades,
  reparto_id: r.reparto_id,
  reparto_version: r.reparto_version,
  temporada: r.temporada,
  error_reparto_pp: numeroONulo(r.error_reparto_pp),
});

/**
 * Lee todo lo que necesitan los planes puros: el trozo del mundo que alcanzan las semillas, `k'`, los nombres del catálogo y, para los
 * lotes al barrer, su reparto guardado y las versiones de M12 con que se repartieron (`leerRepartosPorId`, sin filtrar por vigente: R6).
 */
async function contextoDe(d: Db, semillas: Semillas): Promise<Salida<ContextoLeido>> {
  const [w, k, nombres] = await Promise.all([mundoAlcanzado(d, semillas), kPrimaDe(d), nombresDeCatalogo(d)]);
  if (w.respuesta) return falla(w.respuesta);
  if (k.respuesta) return falla(k.respuesta);
  if (nombres.respuesta) return falla(nombres.respuesta);
  const ix = w.data;
  const lotes = ix.m.lineas.filter((l) => l.tipo !== "especifica").map((l) => l.id);
  const repartosDb = lotes.length === 0 ? { data: [], error: null } : await leerRepartosDeLineas(d, lotes);
  if (repartosDb.error) return fallaDb(repartosDb.error, "agrupadores: leer los repartos");
  const repartos = repartosDb.data.map(repartoRegistro);
  const versiones = await leerRepartosPorId(d, [...new Set(repartos.map((r) => r.reparto_id).filter((x): x is string => x !== null))]);
  if (versiones.respuesta) return falla(versiones.respuesta);
  const n = nombres.data;
  const ctx: ContextoMovimiento = {
    k_prima: k.data,
    viajes: ix.m.viajes,
    embarques: ix.m.embarques,
    paquetes: ix.m.paquetes,
    asignaciones: ix.m.asignaciones,
    compras: ix.m.compras,
    lineas: ix.m.lineas,
    entregas: ix.m.entregas,
    repartos,
    recepciones: ix.m.recepciones,
    viaje_de_compra: ix.m.viaje_de_compra,
    repartos_por_id: new Map(versiones.data.map((v) => [v.reparto_id, v])),
    nodos: n.nodos,
    etiquetas_linea: new Map(ix.m.lineas.map((l) => [l.id, etiquetaDeLinea(l, n)])),
  };
  return listo({ ix, ctx });
}

/** La solicitud con la revisión VIGENTE de cada compra (lo que cambia entre una vista previa y escribir; R19). */
function conRevisionesVigentes(s: SolicitudMovimiento, ix: Ix): SolicitudMovimiento {
  const revisionDeEntrega = (entregaId: string): number | null => {
    const e = ix.entrega.get(entregaId);
    const l = e ? ix.linea.get(e.linea_id) : undefined;
    return (l ? ix.compra.get(l.compra_id)?.revision : undefined) ?? null;
  };
  if (s.operacion === "asignar") return { ...s, items: s.items.map((i) => ({ ...i, compra_revision: revisionDeEntrega(i.entrega_id) ?? i.compra_revision })) };
  if (s.operacion === "quitar") {
    return { ...s, asignaciones: s.asignaciones.map((a) => ({ ...a, compra_revision: revisionDeEntrega(ix.m.asignaciones.find((x) => x.id === a.id)?.entrega_id ?? "") ?? a.compra_revision })) };
  }
  return s;
}

type PlanListo = Extract<ResultadoPlanMovimiento | ResultadoPlanFechas, { ok: true }>;

export type OpcionesMovimiento = { previsualizar: boolean; huella_plan?: string };

type ResultadoMovimiento = { tipo: "vista"; vista: PlanMovimientoApi } | { tipo: "aplicado"; plan: PlanListo; ctx: ContextoLeido; resultado: Record<string, unknown> };

/** Arma el plan sobre lo leído; `vigentes` pide rehacerlo con las revisiones vigentes de las compras (el reintento tras `compra_cambio`). */
type Planificar = (c: ContextoLeido, vigentes: boolean) => ResultadoPlanMovimiento | ResultadoPlanFechas;

/**
 * El núcleo de todo movimiento (§3, R19). Lee, arma el plan con la regla pura y, si no es una vista previa, lo aplica con
 * `aplicar_movimiento_agrupador`. Si la compra cambió (la regla pura o la función dicen `compra_cambio`): sin `huella_plan` no hay
 * reintento (`409 compra_cambio`); con ella, se relee, se rehace el plan con las revisiones vigentes y SOLO SI LA HUELLA NUEVA ES IDÉNTICA
 * se reintenta una vez; si no, `409 plan_cambio`. La revisión del EMBARQUE nunca se refresca (`agrupador_cambio`: recarga la pantalla).
 * `huellaSiCambiaMes` (08b-1b §2.10, F44): el plan mueve entregas de mes, así que exige la `huella_plan` de la vista previa y que coincida
 * con la del plan recalculado ahora (`409 plan_cambio`); si ningún mes cambia no se pide.
 */
async function ejecutar(d: Db, usuario: UsuarioAgrupadores, planificar: Planificar, semillas: Semillas, opciones: OpcionesMovimiento, huellaSiCambiaMes = false): Promise<Salida<ResultadoMovimiento>> {
  const c1 = await contextoDe(d, semillas);
  if (c1.respuesta) return falla(c1.respuesta);
  const plan1 = planificar(c1.data, false);
  if (opciones.previsualizar) return plan1.ok ? listo({ tipo: "vista" as const, vista: plan1.vista }) : fallaMotivo(plan1.motivo, plan1.detalle);
  if (plan1.ok && huellaSiCambiaMes && cambiaAlgunMes(plan1.aplicable) && !puedeReintentar(opciones.huella_plan, plan1.vista.huella_plan)) return fallaMotivo("plan_cambio");

  let obsoleto = !plan1.ok && plan1.motivo === "compra_cambio";
  if (plan1.ok) {
    const r1 = await rpcAplicarMovimientoAgrupador(d, { plan: plan1.aplicable, actor: actorDe(usuario) });
    if (r1.error || !esRegistro(r1.data) || r1.data.ok === true || r1.data.motivo !== "compra_cambio") {
      const leido = leerRpc(r1, "agrupadores: aplicar el movimiento");
      return leido.respuesta ? falla(leido.respuesta) : listo({ tipo: "aplicado" as const, plan: plan1, ctx: c1.data, resultado: leido.data });
    }
    obsoleto = true;
  }
  if (!obsoleto) return plan1.ok ? fallaMensaje("No se pudo completar la operación.", 500, "error_interno") : fallaMotivo(plan1.motivo, plan1.detalle);

  // La compra cambió: sin huella no hay reintento.
  if (opciones.huella_plan === undefined) return fallaMotivo("compra_cambio");
  const c2 = await contextoDe(d, semillas);
  if (c2.respuesta) return falla(c2.respuesta);
  const plan2 = planificar(c2.data, true);
  if (!plan2.ok) return fallaMotivo(plan2.motivo, plan2.detalle);
  if (!puedeReintentar(opciones.huella_plan, plan2.vista.huella_plan)) return fallaMotivo("plan_cambio");
  const r2 = await rpcAplicarMovimientoAgrupador(d, { plan: plan2.aplicable, actor: actorDe(usuario) });
  const leido = leerRpc(r2, "agrupadores: aplicar el movimiento");
  if (leido.respuesta) {
    // Cambió otra vez entre la relectura y escribir: la vista previa ya no vale.
    if (!r2.error && esRegistro(r2.data) && r2.data.motivo === "compra_cambio") return fallaMotivo("plan_cambio");
    return falla(leido.respuesta);
  }
  return listo({ tipo: "aplicado" as const, plan: plan2, ctx: c2.data, resultado: leido.data });
}

/**
 * Ejecuta un movimiento. `embarqueRespuesta` es el embarque cuyo detalle se devuelve al escribir (el de la ruta; en `mover_paquete`, el de
 * destino, donde el paquete vive ahora). Con `previsualizar`, devuelve el `PlanMovimientoApi` sin escribir nada.
 */
export async function moverEntregas(
  d: Db,
  usuario: UsuarioAgrupadores,
  solicitud: SolicitudMovimiento,
  opciones: OpcionesMovimiento,
): Promise<Salida<PlanMovimientoApi | RespuestaMovimientoApi>> {
  const r = await ejecutar(d, usuario, (c, vigentes) => planificarMovimiento(vigentes ? conRevisionesVigentes(solicitud, c.ix) : solicitud, c.ctx), semillasDe(solicitud), opciones);
  if (r.respuesta) return falla(r.respuesta);
  if (r.data.tipo === "vista") return listo(r.data.vista);

  const embarqueRespuesta = solicitud.operacion === "mover_paquete" ? solicitud.embarque_destino_id : solicitud.embarque_id;
  return respuestaDeAplicado(d, r.data, embarqueRespuesta);
}

/** La respuesta de un movimiento aplicado: el detalle del embarque pedido, los otros embarques tocados (con su revisión nueva) y las compras tocadas. */
async function respuestaDeAplicado(d: Db, aplicado: Extract<ResultadoMovimiento, { tipo: "aplicado" }>, embarqueRespuesta: string): Promise<Salida<RespuestaMovimientoApi>> {
  const { plan, ctx, resultado } = aplicado;
  const detalle = await detalleDe(d, embarqueRespuesta);
  if (detalle.respuesta) return falla(detalle.respuesta);
  const revisiones = new Map((Array.isArray(resultado.embarques) ? resultado.embarques.filter(esRegistro) : []).map((e) => [String(e.id), Number(e.revision)]));
  const tocados = plan.aplicable.embarques
    .filter((e) => e.id !== embarqueRespuesta)
    .map((e) => ({ id: e.id, codigo: ctx.ix.embarque.get(e.id)?.codigo ?? "—", revision: revisiones.get(e.id) ?? e.revision + 1 }));
  // Solo las compras TOCADAS (0034): puede ser `[]`. Las demás del plan conservan su revisión, así que no se inventa ninguna.
  const compras = Array.isArray(resultado.compras) ? resultado.compras.filter(esRegistro).map((c) => ({ id: String(c.id), revision: Number(c.revision) })) : [];
  return listo({ embarque: detalle.data, embarques_tocados: tocados, compras, avisos: plan.vista.avisos });
}

/** Ahora mismo en Lima (`aaaa-mm-dd` y `hh:mm`), para la integridad de los hitos que ya ocurrieron (I7). */
export function ahoraEnLima(ahora: Date = new Date()): AhoraLima {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ahora);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "00";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: `${v("hour")}:${v("minute")}` };
}

/** Los campos de `CambiarFechas` que el plan puro entiende (clave ausente = no cambia). */
function entradaDeFechas(embarqueId: string, c: CambiarFechas, ahora: AhoraLima): EntradaCambiarFechas {
  return {
    embarque_id: embarqueId,
    revision: c.revision,
    ...(c.fecha_zarpe === undefined ? {} : { fecha_zarpe: c.fecha_zarpe }),
    ...(c.fecha_arribo === undefined ? {} : { fecha_arribo: c.fecha_arribo }),
    ...(c.fecha_ingreso_cd === undefined ? {} : { fecha_ingreso_cd: c.fecha_ingreso_cd }),
    ...(c.inicio_operativo === undefined ? {} : { inicio_operativo: c.inicio_operativo }),
    ...(c.fecha_ingreso_stock === undefined ? {} : { fecha_ingreso_stock: c.fecha_ingreso_stock }),
    ...(c.hito_confirmado === undefined ? {} : { hito_confirmado: c.hito_confirmado }),
    ...(c.motivo === undefined ? {} : { motivo: c.motivo }),
    ...(c.causa === undefined ? {} : { causa: c.causa }),
    ahora,
  };
}

/**
 * `POST /api/compras/embarques/[id]/fechas` (08b-1b §3.2): cambia cualquier hito del embarque. Con `previsualizar` devuelve el `PlanFechasApi`
 * sin escribir. La `huella_plan` solo se exige si algún mes cambia (F44); motivo y causa, solo si reprograma (los pide el plan puro).
 */
export async function cambiarFechasEmbarque(d: Db, usuario: UsuarioAgrupadores, id: string, cuerpo: CambiarFechas, opciones: { previsualizar: boolean }): Promise<Salida<PlanFechasApi | RespuestaMovimientoApi>> {
  const ahora = ahoraEnLima();
  const r = await ejecutar(d, usuario, (c) => planCambiarFechas(entradaDeFechas(id, cuerpo, ahora), c.ctx), { embarques: [id] }, { previsualizar: opciones.previsualizar, huella_plan: cuerpo.huella_plan }, true);
  if (r.respuesta) return falla(r.respuesta);
  if (r.data.tipo === "vista") return listo(r.data.vista as PlanFechasApi);
  return respuestaDeAplicado(d, r.data, id);
}

/**
 * `POST /api/compras/paquetes/[id]/ingreso` (08b-1b §3.2): fija, cambia o suelta (`null`) el ingreso al stock propio de un paquete. Tras leer
 * (y antes de planificar) comprueba que el paquete SIGUE en el embarque de la revisión que trae el cuerpo: si lo movieron mientras tanto,
 * `409 agrupador_cambio`. Si queda antes de la llegada del embarque, el plan lo sube al piso y avisa `ingreso_paquete_ajustado`.
 */
export async function ingresoDePaquete(d: Db, usuario: UsuarioAgrupadores, paqueteId: string, cuerpo: IngresoPaquete, opciones: { previsualizar: boolean }): Promise<Salida<PlanFechasApi | RespuestaMovimientoApi>> {
  const p = await leerPaquetePorId(d, paqueteId);
  if (p.error) return fallaDb(p.error, "agrupadores: leer el paquete");
  if (!p.data) return noEncontrado();
  const embarqueId = p.data.embarque_id;
  const ahora = ahoraEnLima();
  const planificar: Planificar = (c) => {
    // El candado de la función ya fue tomado por la lectura vigente: si el paquete cambió de embarque, el plan de otro embarque no vale.
    const vigente = c.ctx.paquetes.find((x) => x.id === paqueteId);
    if (vigente && vigente.embarque_id !== embarqueId) return { ok: false, motivo: "agrupador_cambio", detalle: `El paquete ${vigente.codigo} ya no es de este embarque.` };
    return planIngresoPaquete({ paquete_id: paqueteId, revision_embarque: cuerpo.revision_embarque, fecha_ingreso_stock: cuerpo.fecha_ingreso_stock, ...(cuerpo.motivo === undefined ? {} : { motivo: cuerpo.motivo }), ...(cuerpo.causa === undefined ? {} : { causa: cuerpo.causa }), ahora }, c.ctx);
  };
  const r = await ejecutar(d, usuario, planificar, { embarques: [embarqueId], paquetes: [paqueteId] }, { previsualizar: opciones.previsualizar, huella_plan: cuerpo.huella_plan }, true);
  if (r.respuesta) return falla(r.respuesta);
  if (r.data.tipo === "vista") return listo(r.data.vista as PlanFechasApi);
  return respuestaDeAplicado(d, r.data, embarqueId);
}

// ─── Importador de agrupadores (§3.11) ───

function estadoDeImportacion(ag: { viajes: ViajeDb[]; embarques: EmbarqueDb[]; paquetes: MundoDb["paquetes"]; perfiles: MundoDb["perfiles"] }): EstadoImportacionAgrupadores {
  const m = armarMundo({ viajes: ag.viajes, embarques: ag.embarques, paquetes: ag.paquetes, asignaciones: [], compras: [], lineas: [], entregas: [], recepciones: [], proveedores: [], perfiles: ag.perfiles });
  return { viajes: m.viajes, embarques: m.embarques, paquetes: m.paquetes, perfiles: m.perfiles };
}

/**
 * `POST /api/compras/agrupadores/importar`: previsualizar o aplicar la hoja única de §3.11. Solo crea. Aplicar es todo o nada
 * (importar_agrupadores) y se lee el estado FRESCO; si alguien creó una de las claves entre previsualizar y aplicar, `409
 * vuelve_a_previsualizar`. Un lote sin nada nuevo no llama a la base.
 */
export async function importarAgrupadores(d: Db, usuario: UsuarioAgrupadores, cuerpo: ImportarAgrupadores): Promise<Salida<ReporteImportacionAgrupadoresApi>> {
  const ag = await leerAgrupadores(d);
  if (ag.error) return fallaDb(ag.error, "agrupadores: leer lo que ya existe");
  const previo = previsualizarImportacionAgrupadores(cuerpo.filas, estadoDeImportacion(ag.data), { archivo_nombre: cuerpo.archivo_nombre });
  if (cuerpo.modo === "previsualizar") return listo(previo.reporte);
  if (loteVacio(previo.lote)) return listo(reporteAplicado(previo.reporte, []));

  const r = await rpcImportarAgrupadores(d, argsImportarAgrupadoresAjustado(previo.lote, usuario));
  const leido = leerRpc(r, "agrupadores: importar");
  if (leido.respuesta) return falla(leido.respuesta);
  const creados = (Array.isArray(leido.data.creados) ? leido.data.creados : [])
    .filter(esRegistro)
    .map((c) => ({ tipo: c.tipo as TipoAgrupador, fila: Number(c.fila), id: String(c.id), codigo: String(c.codigo) }));
  return listo(reporteAplicado(previo.reporte, creados));
}

const argsImportarAgrupadoresAjustado = (lote: Parameters<typeof argsImportarAgrupadores>[0], usuario: UsuarioAgrupadores) => {
  const { p_lote, p_actor } = argsImportarAgrupadores(lote, actorDe(usuario));
  return { lote: p_lote, actor: p_actor };
};

// ─── Columnas VIAJE, EMBARQUE y PAQUETE del importador de compras (§3.9) ───

type ItemPendienteCompra = {
  fila: number;
  /** `clave_importacion` de la línea (para hallarla tras importarla). */
  clave_linea: string;
  compra_clave: string;
  /** Compra y línea que ya existían (`igual` o línea nueva en una compra existente); nulos en una compra nueva. */
  compra_id: string | null;
  linea_id: string | null;
  aplicar: { viaje_id: string | null; embarque_id: string | null; paquete_id: string | null };
};

type PendienteCompras = { items: ItemPendienteCompra[] };

/** El código y el texto de un rechazo ya armado como respuesta HTTP (`{ error, codigo }`), para anotarlo en el reporte de una fila. */
async function detalleDeFallo(r: Salida<unknown>): Promise<{ motivo: string; mensaje: string }> {
  try {
    const cuerpo = (await r.respuesta?.clone().json()) as { error?: unknown; codigo?: unknown } | undefined;
    return { motivo: typeof cuerpo?.codigo === "string" ? cuerpo.codigo : "error", mensaje: typeof cuerpo?.error === "string" ? cuerpo.error : "No se pudo asignar: reimporta el archivo." };
  } catch {
    return { motivo: "error", mensaje: "No se pudo asignar: reimporta el archivo." };
  }
}

/**
 * Los ganchos con que el importador de compras (`importarCompras`) aplica las columnas `VIAJE`, `EMBARQUE` y `PAQUETE`:
 *  - `evaluar` (tras clasificar como M8): lee los agrupadores y aplica `evaluarAgrupadoresDeFilaCompra` a cada fila que trae alguna;
 *    las omitidas salen del plan. Solo a `nueva` e `igual` sin asignación (§3.9, punto 2); a una `igual` ya asignada a otro embarque,
 *    `agrupador_distinto` y no se toca. Si una compra trae varios `VIAJE`, vale el de la primera fila.
 *  - `aplicar` (tras las `importar_compra`): por compra, `asignar_viaje_compras` y después un `aplicar_movimiento_agrupador` (asignar)
 *    por embarque y paquete, cada uno en su transacción. Un corte deja la compra sin agrupador y el reporte lo dice; reimportar completa.
 */
export function ganchosAgrupadoresCompras(d: Db, usuario: UsuarioAgrupadores): GanchosAgrupadoresCompras {
  return {
    async evaluar({ filas, resultado }) {
      const conColumnas = filas
        .map((f, i) => ({ f, fila: i + 1 }))
        .filter(({ f }) => [f.viaje, f.embarque, f.paquete].some((c) => (c ?? "").trim() !== ""));
      const vacio = listo<EvaluacionAgrupadoresCompras>({ omisiones: [], filas: [], pendiente: { items: [] } satisfies PendienteCompras });
      if (conColumnas.length === 0) return vacio;

      const ag = await leerAgrupadores(d);
      if (ag.error) return fallaDb(ag.error, "agrupadores: leer los agrupadores");
      const estado = estadoDeImportacion(ag.data);
      const catalogo: CatalogoAgrupadoresCompra = { viajes: estado.viajes, embarques: estado.embarques, paquetes: estado.paquetes };

      const lineaPorFila = new Map(resultado.reporte.lineas.map((l) => [l.fila, l]));
      // Las líneas que ya existen (`igual`, `cambiada`): su compra, su viaje y a qué embarques están asignadas.
      const existentes = await leerLineasPorClave(
        d,
        conColumnas.flatMap(({ fila }) => {
          const l = lineaPorFila.get(fila);
          return l && l.clasificacion !== "nueva" ? [l.clave] : [];
        }),
      );
      if (existentes.error) return fallaDb(existentes.error, "agrupadores: leer las líneas existentes");
      const lineaDeClave = new Map(existentes.data.map((l) => [l.clave_importacion ?? "", l]));
      const comprasDeNuevas = new Map(resultado.reporte.compras_a_crear.map((c) => [c.clave, c.existente?.compra_id ?? null]));
      const compraIds = [...existentes.data.map((l) => l.compra_id), ...[...comprasDeNuevas.values()].filter((x): x is string => x !== null)];
      const clasificacionDe = new Map(resultado.reporte.lineas.map((l) => [l.clave, l.clasificacion]));
      const [compras, entregas] = await Promise.all([
        leerComprasPorId(d, compraIds),
        leerEntregasDeLineas(d, existentes.data.filter((l) => clasificacionDe.get(l.clave_importacion ?? "") === "igual").map((l) => l.id)),
      ]);
      if (compras.error) return fallaDb(compras.error, "agrupadores: leer las compras");
      if (entregas.error) return fallaDb(entregas.error, "agrupadores: leer las entregas");
      const asignaciones = await leerAsignacionesDeEntregas(d, entregas.data.map((e) => e.id));
      if (asignaciones.error) return fallaDb(asignaciones.error, "agrupadores: leer las asignaciones");
      const viajeDeCompra = new Map(compras.data.map((c) => [c.id, c.viaje_id]));
      const entregasDe = agrupar(entregas.data, (e) => e.linea_id);
      const asignacionesDe = agrupar(asignaciones.data, (a) => a.entrega_id);

      const omisiones: EvaluacionAgrupadoresCompras["omisiones"] = [];
      const filasApi: AgrupadorImportacionCompraApi[] = [];
      const items: ItemPendienteCompra[] = [];
      const viajePorCompra = new Map<string, string>();
      for (const { f, fila } of conColumnas) {
        const l = lineaPorFila.get(fila);
        if (!l) continue; // M8 ya la omitió por otra razón: no se importa y no hay nada que asignar.
        const existente = lineaDeClave.get(l.clave);
        const compraId = l.clasificacion === "nueva" ? (comprasDeNuevas.get(l.compra_clave) ?? null) : (existente?.compra_id ?? null);
        const embarquesAsignados = [...new Set((entregasDe.get(existente?.id ?? "") ?? []).flatMap((e) => (asignacionesDe.get(e.id) ?? []).map((a) => a.embarque_id)))];
        const ev = evaluarAgrupadoresDeFilaCompra(
          {
            fila,
            viaje: f.viaje ?? "",
            embarque: f.embarque ?? "",
            paquete: f.paquete ?? "",
            clasificacion: l.clasificacion,
            entregas: l.entregas,
            compra_viaje_id: compraId ? (viajeDeCompra.get(compraId) ?? null) : null,
            embarques_asignados: embarquesAsignados,
          },
          catalogo,
        );
        if (!ev) continue;
        // Una compra con varias filas con VIAJE: vale el de la primera; las demás no lo repiten ni lo contradicen.
        if (ev.aplicar.viaje_id !== null) {
          const primero = viajePorCompra.get(l.compra_clave);
          if (primero === undefined) viajePorCompra.set(l.compra_clave, ev.aplicar.viaje_id);
          else {
            if (primero !== ev.aplicar.viaje_id && !ev.api.avisos.includes("agrupador_distinto")) ev.api.avisos.push("agrupador_distinto");
            ev.aplicar.viaje_id = null;
            if (ev.aplicar.embarque_id === null && ev.api.resultado === "asignado") ev.api.resultado = "sin_cambio";
          }
        }
        if (ev.omite_fila && ev.api.motivo) omisiones.push({ fila, motivo: ev.api.motivo });
        filasApi.push(ev.api);
        if (!ev.omite_fila && (ev.aplicar.viaje_id !== null || ev.aplicar.embarque_id !== null)) {
          items.push({ fila, clave_linea: l.clave, compra_clave: l.compra_clave, compra_id: compraId, linea_id: existente?.id ?? null, aplicar: ev.aplicar });
        }
      }
      return listo<EvaluacionAgrupadoresCompras>({ omisiones, filas: filasApi, pendiente: { items } satisfies PendienteCompras });
    },

    async aplicar(evaluacion, importadas) {
      const pendiente = evaluacion.pendiente as PendienteCompras;
      const resultados = new Map(evaluacion.filas.map((f) => [f.fila, { ...f, avisos: [...f.avisos] } as AgrupadorImportacionCompraApi]));
      const fallo = (fila: number, motivo: string, mensaje: string) => {
        const f = resultados.get(fila);
        if (f && !f.no_asignado) resultados.set(fila, { ...f, resultado: "sin_cambio", no_asignado: { motivo, mensaje } });
      };

      for (const [compraClave, delGrupo] of agrupar(pendiente.items, (i) => i.compra_clave)) {
        const compraId = delGrupo[0].compra_id ?? importadas.get(compraClave) ?? null;
        if (compraId === null) {
          for (const i of delGrupo) fallo(i.fila, "compra_no_importada", "La compra no se importó: reimporta el archivo.");
          continue;
        }
        // 1. El viaje de la compra.
        const viaje = delGrupo.find((i) => i.aplicar.viaje_id !== null);
        if (viaje) {
          const compra = await leerComprasPorId(d, [compraId]);
          const vigente = compra.data[0];
          if (compra.error || !vigente) {
            fallo(viaje.fila, "error", "No se pudo leer la compra: reimporta el archivo.");
          } else {
            const r = leerRpc(await rpcAsignarViajeCompras(d, { viaje_id: viaje.aplicar.viaje_id, compras: [{ id: compraId, revision: vigente.revision }], actor: actorDe(usuario) }), "agrupadores: asignar el viaje a la compra importada");
            if (r.respuesta) {
              const f = await detalleDeFallo(r);
              fallo(viaje.fila, f.motivo, f.mensaje);
            }
          }
        }
        // 2. El embarque (y paquete) de cada línea: un movimiento `asignar` por embarque y paquete.
        for (const [, deEmbarque] of agrupar(delGrupo.filter((i) => i.aplicar.embarque_id !== null), (i) => `${i.aplicar.embarque_id}|${i.aplicar.paquete_id ?? ""}`)) {
          const { embarque_id: embarqueId, paquete_id: paqueteId } = deEmbarque[0].aplicar;
          const lineas = await Promise.all(
            deEmbarque.map(async (i) => {
              if (i.linea_id) return i.linea_id;
              const l = await leerLineasPorClave(d, [i.clave_linea]);
              return l.data.find((x) => x.compra_id === compraId)?.id ?? null;
            }),
          );
          if (lineas.some((x) => x === null)) {
            for (const i of deEmbarque) fallo(i.fila, "linea_no_importada", "La línea no se importó: reimporta el archivo.");
            continue;
          }
          const entregas = await leerEntregasDeLineas(d, lineas as string[]);
          if (entregas.error) {
            for (const i of deEmbarque) fallo(i.fila, "error", "No se pudo leer las entregas: reimporta el archivo.");
            continue;
          }
          const r = await ejecutar(
            d,
            usuario,
            ({ ix, ctx }, vigentes) => {
              const e = ix.embarque.get(embarqueId as string);
              const items = entregas.data
                // 08b-1b §2.4 bis: la entrega debe estar en el MES DE DESTINO (el del ingreso propio del paquete de la fila, si lo tiene).
                .filter((x) => e !== undefined && mesDe(x.periodo) === mesDeDestino(e, paqueteId ? ix.paquete.get(paqueteId) : null))
                .map((x) => {
                  const libre = x.unidades - (ix.asigDeEntrega.get(x.id) ?? []).reduce((s, a) => s + a.unidades, 0);
                  const compra = ix.compra.get(ix.linea.get(x.linea_id)?.compra_id ?? "");
                  return { entrega_id: x.id, unidades: libre, compra_revision: compra?.revision ?? 0 };
                })
                .filter((x) => x.unidades > 0);
              const solicitud: SolicitudMovimiento = { operacion: "asignar", embarque_id: embarqueId as string, revision: e?.revision ?? 0, paquete_id: paqueteId, items };
              return planificarMovimiento(vigentes ? conRevisionesVigentes(solicitud, ix) : solicitud, ctx);
            },
            { embarques: [embarqueId as string], entregas: entregas.data.map((x) => x.id), paquetes: paqueteId ? [paqueteId] : [] },
            { previsualizar: false },
          );
          if (r.respuesta) {
            const f = await detalleDeFallo(r);
            for (const i of deEmbarque) fallo(i.fila, f.motivo, f.mensaje);
          }
        }
      }
      return evaluacion.filas.map((f) => resultados.get(f.fila) ?? f);
    },
  };
}
