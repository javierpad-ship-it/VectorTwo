import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import type { LoteImportarAgrupadores } from "./importar";
import type { PlanAplicable } from "./movimiento";
import type { ActorAgrupador } from "./tipos";

/**
 * Acceso a datos de los agrupadores de compras (viajes, embarques y paquetes; ficha 08b, §2 y §3). ÚNICO archivo de
 * `src/lib/compras/agrupadores/` que habla con Supabase. LEE las tablas nuevas y las de compras con `leerTodo` (PostgREST corta en 1 000
 * filas), siempre con `order` estable, y por ids en tandas cuando solo hace falta un trozo. ESCRIBE únicamente con las funciones `rpc` de
 * `0032` (una transacción por llamada, con candado por `revision`, pertenencia y evento): aquí no hay `.insert(`, `.update(`, `.upsert(` ni
 * `.delete(` sobre ninguna tabla (lo vigila `tests/agrupadores.estatico.test.ts`, R16).
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type ViajeDb = Tables<"compra_viajes">;
export type EmbarqueDb = Tables<"compra_embarques">;
export type PaqueteDb = Tables<"compra_paquetes">;
export type AsignacionDb = Tables<"compra_entrega_asignaciones">;
export type EventoAgrupadorDb = Tables<"compra_agrupador_eventos">;
export type RepartoDb = Tables<"compra_linea_repartos">;

const COLUMNAS_COMPRA = "id, numero, proveedor_id, origen, estado, fecha_compra, moneda, cancelada_at, revision, viaje_id" as const;
const COLUMNAS_LINEA =
  "id, compra_id, tipo, genero_mundo_linea_id, equivalencia_id, marca_id, agrupacion_marca_id, tallas, unidades, unidades_recibidas, unidades_canceladas, costo_unitario, destino, tienda_id, alcance, activo, clave_importacion" as const;
const COLUMNAS_ENTREGA = "id, linea_id, periodo, unidades, origen" as const;
const COLUMNAS_RECEPCION = "id, linea_id, recibida_periodo, unidades, fecha_recepcion, origen" as const;
const COLUMNAS_PERFIL = "id, nombre, email, rol, activo" as const;

export type CompraLigeraDb = Pick<Tables<"compras">, "id" | "numero" | "proveedor_id" | "origen" | "estado" | "fecha_compra" | "moneda" | "cancelada_at" | "revision" | "viaje_id">;
export type LineaLigeraDb = Pick<
  Tables<"compra_lineas">,
  | "id"
  | "compra_id"
  | "tipo"
  | "genero_mundo_linea_id"
  | "equivalencia_id"
  | "marca_id"
  | "agrupacion_marca_id"
  | "tallas"
  | "unidades"
  | "unidades_recibidas"
  | "unidades_canceladas"
  | "costo_unitario"
  | "destino"
  | "tienda_id"
  | "alcance"
  | "activo"
  | "clave_importacion"
>;
export type EntregaLigeraDb = Pick<Tables<"compra_linea_entregas">, "id" | "linea_id" | "periodo" | "unidades" | "origen">;
export type RecepcionLigeraDb = Pick<Tables<"compra_linea_recepciones">, "id" | "linea_id" | "recibida_periodo" | "unidades" | "fecha_recepcion" | "origen">;
export type PerfilDb = Pick<Tables<"perfiles">, "id" | "nombre" | "email" | "rol" | "activo">;
export type ProveedorLigeroDb = Pick<Tables<"proveedores">, "id" | "nombre">;

/** Lo que se lee de la base para armar listas, detalles y planes: filas planas, sin interpretar. */
export type MundoDb = {
  viajes: ViajeDb[];
  embarques: EmbarqueDb[];
  paquetes: PaqueteDb[];
  asignaciones: AsignacionDb[];
  compras: CompraLigeraDb[];
  lineas: LineaLigeraDb[];
  entregas: EntregaLigeraDb[];
  recepciones: RecepcionLigeraDb[];
  proveedores: ProveedorLigeroDb[];
  perfiles: PerfilDb[];
};

const MUNDO_VACIO: MundoDb = { viajes: [], embarques: [], paquetes: [], asignaciones: [], compras: [], lineas: [], entregas: [], recepciones: [], proveedores: [], perfiles: [] };

// ─── Utilidades ───

/** Ids sin repetir y sin nulos. */
const unicos = (ids: Iterable<string | null | undefined>): string[] => [...new Set([...ids].filter((x): x is string => typeof x === "string"))];

/** Lee por ids en tandas (los ids viajan en la URL) y junta todo. */
async function porIds<T>(ids: Iterable<string | null | undefined>, leer: (tanda: string[]) => Promise<Resultado<T[]>>): Promise<Resultado<T[]>> {
  const salida: T[] = [];
  for (const tanda of enTandas(unicos(ids), TANDA_IN)) {
    const r = await leer(tanda);
    if (r.error) return { data: salida, error: r.error };
    salida.push(...r.data);
  }
  return { data: salida, error: null };
}

const sinDuplicados = <T extends { id: string }>(l: readonly T[]): T[] => [...new Map(l.map((x) => [x.id, x])).values()];

// ─── Lecturas por tabla (todo, con orden estable) ───

const todosViajes = (db: Db) => leerTodo<ViajeDb>((d, h) => db.from("compra_viajes").select("*").order("id").range(d, h));
const todosEmbarques = (db: Db) => leerTodo<EmbarqueDb>((d, h) => db.from("compra_embarques").select("*").order("id").range(d, h));
const todosPaquetes = (db: Db) => leerTodo<PaqueteDb>((d, h) => db.from("compra_paquetes").select("*").order("id").range(d, h));
const todasAsignaciones = (db: Db) => leerTodo<AsignacionDb>((d, h) => db.from("compra_entrega_asignaciones").select("*").order("id").range(d, h));
const todasCompras = (db: Db) => leerTodo<CompraLigeraDb>((d, h) => db.from("compras").select(COLUMNAS_COMPRA).order("id").range(d, h));
const todasLineas = (db: Db) => leerTodo<LineaLigeraDb>((d, h) => db.from("compra_lineas").select(COLUMNAS_LINEA).order("id").range(d, h));
const todasEntregas = (db: Db) => leerTodo<EntregaLigeraDb>((d, h) => db.from("compra_linea_entregas").select(COLUMNAS_ENTREGA).order("id").range(d, h));
const todasRecepciones = (db: Db) => leerTodo<RecepcionLigeraDb>((d, h) => db.from("compra_linea_recepciones").select(COLUMNAS_RECEPCION).order("id").range(d, h));
const todosProveedores = (db: Db) => leerTodo<ProveedorLigeroDb>((d, h) => db.from("proveedores").select("id, nombre").order("id").range(d, h));

/** Todos los perfiles (id, nombre, correo, rol, activo): los responsables y los asignables se calculan con ellos. */
export const leerPerfilesDb = (db: Db) => leerTodo<PerfilDb>((d, h) => db.from("perfiles").select(COLUMNAS_PERFIL).order("id").range(d, h));

/**
 * Todo el mundo de los agrupadores y de las compras que tocan (de cualquier estado). Para las listas (viajes, embarques, sin agrupador),
 * que necesitan los totales de todos. Las lecturas van en paralelo.
 */
export async function leerMundoCompleto(db: Db): Promise<Resultado<MundoDb>> {
  const [viajes, embarques, paquetes, asignaciones, compras, lineas, entregas, recepciones, proveedores, perfiles] = await Promise.all([
    todosViajes(db),
    todosEmbarques(db),
    todosPaquetes(db),
    todasAsignaciones(db),
    todasCompras(db),
    todasLineas(db),
    todasEntregas(db),
    todasRecepciones(db),
    todosProveedores(db),
    leerPerfilesDb(db),
  ]);
  const fallo = viajes.error ?? embarques.error ?? paquetes.error ?? asignaciones.error ?? compras.error ?? lineas.error ?? entregas.error ?? recepciones.error ?? proveedores.error ?? perfiles.error;
  if (fallo) return { data: MUNDO_VACIO, error: fallo };
  return {
    data: {
      viajes: viajes.data,
      embarques: embarques.data,
      paquetes: paquetes.data,
      asignaciones: asignaciones.data,
      compras: compras.data,
      lineas: lineas.data,
      entregas: entregas.data,
      recepciones: recepciones.data,
      proveedores: proveedores.data,
      perfiles: perfiles.data,
    },
    error: null,
  };
}

/** Por dónde empezar a leer un trozo del mundo: cada semilla arrastra lo que necesita para calcular totales, pendientes y avisos. */
export type Semillas = {
  viajes?: readonly string[];
  embarques?: readonly string[];
  paquetes?: readonly string[];
  asignaciones?: readonly string[];
  compras?: readonly string[];
  entregas?: readonly string[];
  lineas?: readonly string[];
};

/**
 * El trozo del mundo que alcanzan las semillas, con lo necesario para que los cálculos den lo mismo que con todo leído:
 *  - de cada viaje: sus embarques y sus compras; de cada paquete o asignación: su embarque;
 *  - de cada embarque: todas sus asignaciones, y de ellas las entregas y las líneas;
 *  - de cada línea: TODAS sus entregas y recepciones y las asignaciones de esas entregas (en otros embarques también: el ajuste y el
 *    reparto de unidades entre embarques lo exigen), con esos embarques y sus paquetes (para ordenar y nombrar);
 *  - las compras de esas líneas, sus viajes y sus proveedores; los perfiles, todos (son pocos).
 * Nunca lee una tabla entera salvo `perfiles`.
 */
export async function leerMundoAlcanzado(db: Db, s: Semillas): Promise<Resultado<MundoDb>> {
  const vacio = (error: PostgrestError): Resultado<MundoDb> => ({ data: MUNDO_VACIO, error });

  // 1. Embarques de los viajes, paquetes y asignaciones nombrados.
  const [embDeViaje, paqPorId, asigPorId] = await Promise.all([
    porIds(s.viajes ?? [], (t) => leerTodo<EmbarqueDb>((d, h) => db.from("compra_embarques").select("*").in("viaje_id", t).order("id").range(d, h))),
    porIds(s.paquetes ?? [], (t) => leerTodo<PaqueteDb>((d, h) => db.from("compra_paquetes").select("*").in("id", t).order("id").range(d, h))),
    porIds(s.asignaciones ?? [], (t) => leerTodo<AsignacionDb>((d, h) => db.from("compra_entrega_asignaciones").select("*").in("id", t).order("id").range(d, h))),
  ]);
  const f1 = embDeViaje.error ?? paqPorId.error ?? asigPorId.error;
  if (f1) return vacio(f1);

  // 2. Los embarques base y todas sus asignaciones.
  const idsEmbarque = unicos([...(s.embarques ?? []), ...embDeViaje.data.map((e) => e.id), ...paqPorId.data.map((p) => p.embarque_id), ...asigPorId.data.map((a) => a.embarque_id)]);
  const asigDeEmbarques = await porIds(idsEmbarque, (t) => leerTodo<AsignacionDb>((d, h) => db.from("compra_entrega_asignaciones").select("*").in("embarque_id", t).order("id").range(d, h)));
  if (asigDeEmbarques.error) return vacio(asigDeEmbarques.error);

  // 3. Entregas de esas asignaciones y las semillas; de ahí, las líneas; más las compras del viaje y las nombradas.
  const asigBase = sinDuplicados([...asigPorId.data, ...asigDeEmbarques.data]);
  const [entregasBase, comprasSemilla] = await Promise.all([
    porIds([...(s.entregas ?? []), ...asigBase.map((a) => a.entrega_id)], (t) => leerTodo<EntregaLigeraDb>((d, h) => db.from("compra_linea_entregas").select(COLUMNAS_ENTREGA).in("id", t).order("id").range(d, h))),
    Promise.all([
      porIds(s.compras ?? [], (t) => leerTodo<CompraLigeraDb>((d, h) => db.from("compras").select(COLUMNAS_COMPRA).in("id", t).order("id").range(d, h))),
      porIds(s.viajes ?? [], (t) => leerTodo<CompraLigeraDb>((d, h) => db.from("compras").select(COLUMNAS_COMPRA).in("viaje_id", t).order("id").range(d, h))),
    ]),
  ]);
  const f3 = entregasBase.error ?? comprasSemilla[0].error ?? comprasSemilla[1].error;
  if (f3) return vacio(f3);
  const comprasBase = sinDuplicados([...comprasSemilla[0].data, ...comprasSemilla[1].data]);

  // 4. Líneas: las de las entregas, las nombradas y las de las compras base.
  const [lineasA, lineasB] = await Promise.all([
    porIds([...(s.lineas ?? []), ...entregasBase.data.map((e) => e.linea_id)], (t) => leerTodo<LineaLigeraDb>((d, h) => db.from("compra_lineas").select(COLUMNAS_LINEA).in("id", t).order("id").range(d, h))),
    porIds(comprasBase.map((c) => c.id), (t) => leerTodo<LineaLigeraDb>((d, h) => db.from("compra_lineas").select(COLUMNAS_LINEA).in("compra_id", t).order("id").range(d, h))),
  ]);
  const f4 = lineasA.error ?? lineasB.error;
  if (f4) return vacio(f4);
  const lineas = sinDuplicados([...lineasA.data, ...lineasB.data]);
  const idsLinea = lineas.map((l) => l.id);

  // 5. Todas las entregas y recepciones de esas líneas, y las compras que faltan.
  const [entregas, recepciones, comprasDeLineas] = await Promise.all([
    porIds(idsLinea, (t) => leerTodo<EntregaLigeraDb>((d, h) => db.from("compra_linea_entregas").select(COLUMNAS_ENTREGA).in("linea_id", t).order("id").range(d, h))),
    porIds(idsLinea, (t) => leerTodo<RecepcionLigeraDb>((d, h) => db.from("compra_linea_recepciones").select(COLUMNAS_RECEPCION).in("linea_id", t).order("id").range(d, h))),
    porIds(
      lineas.map((l) => l.compra_id).filter((id) => !comprasBase.some((c) => c.id === id)),
      (t) => leerTodo<CompraLigeraDb>((d, h) => db.from("compras").select(COLUMNAS_COMPRA).in("id", t).order("id").range(d, h)),
    ),
  ]);
  const f5 = entregas.error ?? recepciones.error ?? comprasDeLineas.error;
  if (f5) return vacio(f5);
  const compras = sinDuplicados([...comprasBase, ...comprasDeLineas.data]);

  // 6. Asignaciones de TODAS esas entregas (otros embarques incluidos), con sus embarques, paquetes, viajes y proveedores.
  const asigDeEntregas = await porIds(entregas.data.map((e) => e.id), (t) => leerTodo<AsignacionDb>((d, h) => db.from("compra_entrega_asignaciones").select("*").in("entrega_id", t).order("id").range(d, h)));
  if (asigDeEntregas.error) return vacio(asigDeEntregas.error);
  const asignaciones = sinDuplicados([...asigBase, ...asigDeEntregas.data]);
  const idsEmbarqueTodos = unicos([...idsEmbarque, ...asignaciones.map((a) => a.embarque_id)]);
  const embarques = await porIds(idsEmbarqueTodos, (t) => leerTodo<EmbarqueDb>((d, h) => db.from("compra_embarques").select("*").in("id", t).order("id").range(d, h)));
  if (embarques.error) return vacio(embarques.error);

  const [paquetesDeEmbarques, viajes, proveedores, perfiles] = await Promise.all([
    porIds(idsEmbarqueTodos, (t) => leerTodo<PaqueteDb>((d, h) => db.from("compra_paquetes").select("*").in("embarque_id", t).order("id").range(d, h))),
    porIds([...(s.viajes ?? []), ...embarques.data.map((e) => e.viaje_id), ...compras.map((c) => c.viaje_id)], (t) => leerTodo<ViajeDb>((d, h) => db.from("compra_viajes").select("*").in("id", t).order("id").range(d, h))),
    porIds(compras.map((c) => c.proveedor_id), (t) => leerTodo<ProveedorLigeroDb>((d, h) => db.from("proveedores").select("id, nombre").in("id", t).order("id").range(d, h))),
    leerPerfilesDb(db),
  ]);
  const f6 = paquetesDeEmbarques.error ?? viajes.error ?? proveedores.error ?? perfiles.error;
  if (f6) return vacio(f6);

  return {
    data: {
      viajes: viajes.data,
      embarques: embarques.data,
      paquetes: sinDuplicados([...paqPorId.data, ...paquetesDeEmbarques.data]),
      asignaciones,
      compras,
      lineas,
      entregas: entregas.data,
      recepciones: recepciones.data,
      proveedores: proveedores.data,
      perfiles: perfiles.data,
    },
    error: null,
  };
}

/** El reparto guardado de las entregas de unas líneas (solo lo necesitan los lotes al barrer). */
export function leerRepartosDeLineas(db: Db, lineaIds: readonly string[]): Promise<Resultado<RepartoDb[]>> {
  return porIds(lineaIds, (t) => leerTodo<RepartoDb>((d, h) => db.from("compra_linea_repartos").select("*").in("linea_id", t).order("id").range(d, h)));
}

// ─── Lecturas puntuales ───

/** Un viaje por id (`null` si no existe). Sirve para validar el viaje activo y para saber si un viaje existe. */
export async function leerViajePorId(db: Db, id: string): Promise<Resultado<ViajeDb | null>> {
  const r = await db.from("compra_viajes").select("*").eq("id", id).maybeSingle();
  return { data: r.data ?? null, error: r.error };
}

/** Un embarque por id (`null` si no existe). */
export async function leerEmbarquePorId(db: Db, id: string): Promise<Resultado<EmbarqueDb | null>> {
  const r = await db.from("compra_embarques").select("*").eq("id", id).maybeSingle();
  return { data: r.data ?? null, error: r.error };
}

/** Un paquete por id (`null` si no existe). */
export async function leerPaquetePorId(db: Db, id: string): Promise<Resultado<PaqueteDb | null>> {
  const r = await db.from("compra_paquetes").select("*").eq("id", id).maybeSingle();
  return { data: r.data ?? null, error: r.error };
}

/** De qué agrupador se pide el historial: exactamente uno. */
export type FiltroHistorial = { tipo: "viaje" | "embarque" | "paquete"; id: string };

/**
 * Eventos de un agrupador, del más antiguo al más reciente (`created_at` y, a igual instante, `id`). El de un embarque incluye los de sus
 * paquetes (llevan su `embarque_id`); el de un viaje, los de sus embarques (llevan su `viaje_id`).
 */
export function leerEventosAgrupador(db: Db, f: FiltroHistorial): Promise<Resultado<EventoAgrupadorDb[]>> {
  const columna = f.tipo === "viaje" ? "viaje_id" : f.tipo === "embarque" ? "embarque_id" : "paquete_id";
  return leerTodo<EventoAgrupadorDb>((d, h) => db.from("compra_agrupador_eventos").select("*").eq(columna, f.id).order("created_at").order("id").range(d, h));
}

/** Las líneas de esas claves de importación (los agrupadores de una compra importada se asignan después de importarla). */
export function leerLineasPorClave(db: Db, claves: readonly string[]): Promise<Resultado<LineaLigeraDb[]>> {
  return porIds(claves, (t) => leerTodo<LineaLigeraDb>((d, h) => db.from("compra_lineas").select(COLUMNAS_LINEA).in("clave_importacion", t).order("id").range(d, h)));
}

/** Compras por id (con su `viaje_id` y su `revision` vigentes). */
export function leerComprasPorId(db: Db, ids: readonly string[]): Promise<Resultado<CompraLigeraDb[]>> {
  return porIds(ids, (t) => leerTodo<CompraLigeraDb>((d, h) => db.from("compras").select(COLUMNAS_COMPRA).in("id", t).order("id").range(d, h)));
}

/** Entregas de esas líneas. */
export function leerEntregasDeLineas(db: Db, lineaIds: readonly string[]): Promise<Resultado<EntregaLigeraDb[]>> {
  return porIds(lineaIds, (t) => leerTodo<EntregaLigeraDb>((d, h) => db.from("compra_linea_entregas").select(COLUMNAS_ENTREGA).in("linea_id", t).order("id").range(d, h)));
}

/** Asignaciones de esas entregas. */
export function leerAsignacionesDeEntregas(db: Db, entregaIds: readonly string[]): Promise<Resultado<AsignacionDb[]>> {
  return porIds(entregaIds, (t) => leerTodo<AsignacionDb>((d, h) => db.from("compra_entrega_asignaciones").select("*").in("entrega_id", t).order("id").range(d, h)));
}

/** Los viajes, embarques y paquetes que existen (todos los estados): el catálogo del importador de agrupadores y de las columnas de compras. */
export async function leerAgrupadores(db: Db): Promise<Resultado<Pick<MundoDb, "viajes" | "embarques" | "paquetes" | "perfiles">>> {
  const [viajes, embarques, paquetes, perfiles] = await Promise.all([todosViajes(db), todosEmbarques(db), todosPaquetes(db), leerPerfilesDb(db)]);
  const fallo = viajes.error ?? embarques.error ?? paquetes.error ?? perfiles.error;
  if (fallo) return { data: { viajes: [], embarques: [], paquetes: [], perfiles: [] }, error: fallo };
  return { data: { viajes: viajes.data, embarques: embarques.data, paquetes: paquetes.data, perfiles: perfiles.data }, error: null };
}

// ─── Escritura: SOLO las funciones de `0032` (una transacción por llamada) ───

/** Lo que devuelve una llamada `rpc`: el `jsonb` de la función o el error de Postgres (`AG002` = fallo interno: llega como error y se ve). */
export type RespuestaRpc = { data: unknown; error: PostgrestError | null };

/**
 * Una fila de `agrupador_hitos_resumen` (0038, 08b-1b §2.9): por embarque y hito (`zarpe`, `arribo`, `ingreso_cd`, `inicio_operativo`,
 * `ingreso_stock`, y `ingreso_paquete` con su `paquete_id`), la fecha original, las reprogramaciones y la última causa.
 */
export type ResumenHitoDb = {
  embarque_id: string;
  paquete_id: string | null;
  hito: string;
  fecha_original: string | null;
  reprogramaciones: number;
  ultima_causa: string | null;
};

/** Embarques por llamada: la función devuelve 5 filas por embarque (más una por paquete con ingreso propio) y PostgREST corta en 1 000 sin avisar. */
const TANDA_RESUMEN_HITOS = 100;

/**
 * `agrupador_hitos_resumen` (solo lectura): fecha original, reprogramaciones y última causa por embarque y hito. Se llama en tandas de
 * `TANDA_RESUMEN_HITOS` embarques para que ninguna respuesta pase de 1 000 filas.
 */
export async function leerResumenHitos(db: Db, embarqueIds: readonly string[]): Promise<Resultado<ResumenHitoDb[]>> {
  const salida: ResumenHitoDb[] = [];
  for (const tanda of enTandas(unicos(embarqueIds), TANDA_RESUMEN_HITOS)) {
    const r = await db.rpc("agrupador_hitos_resumen", { p_embarques: tanda });
    if (r.error) return { data: salida, error: r.error };
    salida.push(...((r.data ?? []) as unknown as ResumenHitoDb[]));
  }
  return { data: salida, error: null };
}

/** `guardar_viaje`: crea (sin `id`, `p_revision` nulo) o edita (con `id` y la revisión vigente). */
export function rpcGuardarViaje(db: Db, a: { viaje: Record<string, Json | undefined>; revision: number | null; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("guardar_viaje", { p_viaje: a.viaje as Json, p_revision: a.revision, p_actor: a.actor }));
}

/** `guardar_embarque`: crea o edita todo menos `fecha_llegada_estimada` (que va por movimiento). */
export function rpcGuardarEmbarque(db: Db, a: { embarque: Record<string, Json | undefined>; revision: number | null; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("guardar_embarque", { p_embarque: a.embarque as Json, p_revision: a.revision, p_actor: a.actor }));
}

/** `guardar_paquete`: la revisión es la del EMBARQUE (la cubre). */
export function rpcGuardarPaquete(db: Db, a: { paquete: Record<string, Json | undefined>; revision_embarque: number; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("guardar_paquete", { p_paquete: a.paquete as Json, p_revision_embarque: a.revision_embarque, p_actor: a.actor }));
}

/** `cambiar_estado_agrupador`: cerrar, reabrir, cancelar, en tránsito, volver a planificado. En un paquete, `revision` es la del embarque. */
export function rpcCambiarEstadoAgrupador(
  db: Db,
  a: { tipo: "viaje" | "embarque" | "paquete"; id: string; accion: string; revision: number; motivo: string | null; actor: ActorAgrupador },
): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("cambiar_estado_agrupador", { p_tipo: a.tipo, p_id: a.id, p_accion: a.accion, p_revision: a.revision, p_motivo: a.motivo, p_actor: a.actor }));
}

/** `asignar_viaje_compras`: pone (viaje) o quita (`null`) el viaje de compras `[{ id, revision }]`. */
export function rpcAsignarViajeCompras(db: Db, a: { viaje_id: string | null; compras: { id: string; revision: number }[]; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("asignar_viaje_compras", { p_viaje: a.viaje_id, p_compras: a.compras, p_actor: a.actor }));
}

/** `aplicar_movimiento_agrupador`: recibe exactamente el `PlanAplicable` que arma `movimiento.ts`. */
export function rpcAplicarMovimientoAgrupador(db: Db, a: { plan: PlanAplicable; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("aplicar_movimiento_agrupador", { p_plan: a.plan as unknown as Json, p_actor: a.actor }));
}

/** `importar_agrupadores`: aplica el lote del importador en una sola transacción (todo o nada). */
export function rpcImportarAgrupadores(db: Db, a: { lote: LoteImportarAgrupadores; actor: ActorAgrupador }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("importar_agrupadores", { p_lote: a.lote as unknown as Json, p_actor: a.actor }));
}
