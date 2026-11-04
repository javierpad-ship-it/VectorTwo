import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import type { Database, Json, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { conMensajeLecturaLenta, MENSAJES_LECTURA_LENTA, plazoLectura } from "@/lib/api/plazos";
import { periodoADb } from "@/lib/ventas/periodo";
import type { TerminoPrivado } from "./alias";
import type { VentaLineasIaApi } from "./entrada";

/**
 * Acceso a datos de la propuesta con IA (ficha 07e, §3). ÚNICO archivo de `src/lib/ia/` que nombra las tablas `ia_*`, la función
 * `venta_lineas_ia` y `registrar_propuesta_ia_gm` (las pantallas y M7 leen la traza de «Aceptar IA» por su lado, en `servicio-lectura.ts`). Solo
 * servidor, solo con `supabaseAdmin()` desde los handlers. Lo que puede crecer se lee paginado con `leerTodo` y orden estable.
 *
 * Nada de lo que se envía al proveedor pasa por aquí salvo la entrada canónica (`ia_entradas.contenido_gz`, comprimida), que es la traza
 * inmutable de la ficha (D13). Esta capa nunca escribe en los logs.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type ConfigDb = Tables<"ia_configuraciones">;
export type EvaluacionDb = Tables<"ia_evaluaciones">;
export type CorridaDb = Tables<"ia_corridas">;
export type CorridaGMDb = Tables<"ia_corrida_gms">;
export type EntradaDb = Tables<"ia_entradas">;
export type LlamadaDb = Tables<"ia_llamadas">;
export type PropuestaGMDb = Tables<"ia_propuestas_gm">;
export type PropuestaFilaDb = Tables<"ia_propuestas_filas">;
export type NuevoCorridaGM = TablesInsert<"ia_corrida_gms">;

// ─── Configuración ───

export function leerConfigVigente(db: Db) {
  return db.from("ia_configuraciones").select("*").eq("estado", "vigente").maybeSingle();
}

/** Todas las versiones de la configuración, la más reciente primero. */
export function leerConfiguraciones(db: Db) {
  return leerTodo<ConfigDb>((d, h) => db.from("ia_configuraciones").select("*").order("version", { ascending: false }).order("id").range(d, h));
}

export function leerConfigPorId(db: Db, id: string) {
  return db.from("ia_configuraciones").select("*").eq("id", id).maybeSingle();
}

/** Pasa la vigente a `reemplazada` (solo si sigue vigente: el patrón de 06d). Devuelve la fila si la cambió. */
export function reemplazarConfigVigente(db: Db, id: string) {
  return db.from("ia_configuraciones").update({ estado: "reemplazada" }).eq("id", id).eq("estado", "vigente").select("id").maybeSingle();
}

export function restaurarConfigVigente(db: Db, id: string) {
  return db.from("ia_configuraciones").update({ estado: "vigente" }).eq("id", id).select("id").maybeSingle();
}

export function insertarConfig(db: Db, fila: TablesInsert<"ia_configuraciones">) {
  return db.from("ia_configuraciones").insert(fila).select("*").single();
}

export async function maxVersionConfig(db: Db): Promise<Resultado<number>> {
  const { data, error } = await db.from("ia_configuraciones").select("version").order("version", { ascending: false }).limit(1);
  return { data: data?.[0]?.version ?? 0, error };
}

// ─── Evaluaciones ───

export function leerEvaluaciones(db: Db) {
  return leerTodo<EvaluacionDb>((d, h) => db.from("ia_evaluaciones").select("*").order("iniciada_at", { ascending: true }).order("id").range(d, h));
}

export function leerEvaluacion(db: Db, id: string) {
  return db.from("ia_evaluaciones").select("*").eq("id", id).maybeSingle();
}

export function leerEvaluacionEnCurso(db: Db) {
  return db.from("ia_evaluaciones").select("*").eq("estado", "en_curso").maybeSingle();
}

export function insertarEvaluacion(db: Db, fila: TablesInsert<"ia_evaluaciones">) {
  return db.from("ia_evaluaciones").insert(fila).select("*").single();
}

/** Actualiza una evaluación solo si sigue `en_curso` (una terminal no se toca). */
export function actualizarEvaluacionEnCurso(db: Db, id: string, cambio: Partial<TablesInsert<"ia_evaluaciones">>) {
  return db.from("ia_evaluaciones").update(cambio).eq("id", id).eq("estado", "en_curso").select("*").maybeSingle();
}

// ─── Corridas ───

export function insertarCorrida(db: Db, fila: TablesInsert<"ia_corridas">) {
  return db.from("ia_corridas").insert(fila).select("*").single();
}

export function leerCorrida(db: Db, id: string) {
  return db.from("ia_corridas").select("*").eq("id", id).maybeSingle();
}

export function leerCorridaEnCurso(db: Db, proyeccionId: string) {
  return db.from("ia_corridas").select("*").eq("proyeccion_id", proyeccionId).eq("estado", "en_curso").maybeSingle();
}

export function leerCorridaDeEvaluacion(db: Db, evaluacionId: string) {
  return db.from("ia_corridas").select("*").eq("evaluacion_id", evaluacionId).maybeSingle();
}

/** Cambia el estado de una corrida solo si sigue en el estado esperado (por defecto `en_curso`). */
export function actualizarCorrida(db: Db, id: string, cambio: Partial<TablesInsert<"ia_corridas">>, estadoEsperado: string | null = "en_curso") {
  let c = db.from("ia_corridas").update(cambio).eq("id", id);
  if (estadoEsperado !== null) c = c.eq("estado", estadoEsperado);
  return c.select("*").maybeSingle();
}

/** Corridas iniciadas en un rango (para «Uso»), las más recientes primero. */
export async function leerCorridasDelRango(db: Db, desdeIso: string, hastaIso: string, limite = 60): Promise<Resultado<CorridaDb[]>> {
  const { data, error } = await db
    .from("ia_corridas")
    .select("*")
    .gt("iniciada_at", antesDe(desdeIso))
    .lt("iniciada_at", hastaIso)
    .order("iniciada_at", { ascending: false })
    .order("id")
    .limit(limite);
  return { data: (data ?? []).filter((c) => c.iniciada_at >= desdeIso), error };
}

/** Las corridas más recientes de una proyección (para saber cómo terminó el último intento de cada GM). */
export async function leerCorridasDeProyeccion(db: Db, proyeccionId: string, limite = 5): Promise<Resultado<CorridaDb[]>> {
  const { data, error } = await db.from("ia_corridas").select("*").eq("proyeccion_id", proyeccionId).order("iniciada_at", { ascending: false }).order("id").limit(limite);
  return { data: data ?? [], error };
}

/** Las corridas de propuesta de una configuración (para vigilar el modelo efectivo, R34). */
export function leerCorridasDeConfig(db: Db, configuracionId: string) {
  return leerTodo<Pick<CorridaDb, "id">>((d, h) => db.from("ia_corridas").select("id").eq("configuracion_id", configuracionId).order("id").range(d, h));
}

// ─── GM de una corrida: plan, candado y parciales ───

export function insertarCorridaGMs(db: Db, filas: TablesInsert<"ia_corrida_gms">[]) {
  return db.from("ia_corrida_gms").insert(filas).select("*");
}

export function leerCorridaGMs(db: Db, corridaId: string) {
  return leerTodo<CorridaGMDb>((d, h) => db.from("ia_corrida_gms").select("*").eq("corrida_id", corridaId).order("pliegue").order("gm_clave").order("id").range(d, h));
}

export function leerCorridaGM(db: Db, corridaId: string, pliegue: string, gmClave: string) {
  return db.from("ia_corrida_gms").select("*").eq("corrida_id", corridaId).eq("pliegue", pliegue).eq("gm_clave", gmClave).maybeSingle();
}

export function leerCorridaGMPorId(db: Db, id: string) {
  return db.from("ia_corrida_gms").select("*").eq("id", id).maybeSingle();
}

/** Los GM de varias corridas (para contar avance en un listado), en tandas. */
export async function leerCorridaGMsDeCorridas(db: Db, corridaIds: readonly string[]): Promise<Resultado<CorridaGMDb[]>> {
  const salida: CorridaGMDb[] = [];
  for (const tanda of enTandas([...corridaIds], TANDA_IN)) {
    const r = await leerTodo<CorridaGMDb>((d, h) => db.from("ia_corrida_gms").select("*").in("corrida_id", tanda).order("id").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    salida.push(...r.data);
  }
  return { data: salida, error: null };
}

/**
 * Toma un paso del GM con UN solo `UPDATE` (I6): solo si está `pendiente` o `en_proceso` y su candado está libre o vencido (`limiteIso`).
 * Sin fila devuelta, otro tiene el paso: la API responde `409 gm_en_proceso`.
 */
export function tomarCandadoGM(db: Db, id: string, token: string, ahoraIso: string, limiteIso: string) {
  return db
    .from("ia_corrida_gms")
    .update({ estado: "en_proceso", candado_token: token, candado_desde: ahoraIso })
    .eq("id", id)
    .in("estado", ["pendiente", "en_proceso"])
    .or(`candado_token.is.null,candado_desde.lt.${limiteIso}`)
    .select("*")
    .maybeSingle();
}

/** Actualiza el GM solo si el token del candado sigue siendo el mío (un candado vencido y retomado por otro no se pisa). */
export function actualizarCorridaGMConToken(db: Db, id: string, token: string, cambio: Partial<TablesInsert<"ia_corrida_gms">>) {
  return db.from("ia_corrida_gms").update(cambio).eq("id", id).eq("candado_token", token).select("*").maybeSingle();
}

/** Actualiza el GM sin candado (preparar una evaluación, reintentar un fallido, cierres de corrida). */
export function actualizarCorridaGM(db: Db, id: string, cambio: Partial<TablesInsert<"ia_corrida_gms">>) {
  return db.from("ia_corrida_gms").update(cambio).eq("id", id).select("*").maybeSingle();
}

// ─── Entradas (lo enviado, canónico y comprimido) ───

/** `bytea` por PostgREST: texto hexadecimal con el prefijo `\x`. */
export const aByteaHex = (b: Buffer): string => `\\x${b.toString("hex")}`;
export const deByteaHex = (h: string): Buffer => Buffer.from(h.startsWith("\\x") ? h.slice(2) : h, "hex");

export const comprimirContenido = (contenido: string): Buffer => gzipSync(Buffer.from(contenido, "utf8"));
export const descomprimirContenido = (b: Buffer): string => gunzipSync(b).toString("utf8");

export type EntradaAGuardar = {
  corrida_id: string;
  tipo: "bloque" | "sufijo_reparto" | "lineas";
  huella: string;
  /** JSON canónico tal como se envía. */
  contenido: string;
  bytes: number;
  diccionario: Json;
};

/** Guarda una entrada (única por `(corrida_id, huella)`: un reintento reusa la fila). Devuelve su id. */
export async function guardarEntrada(db: Db, e: EntradaAGuardar): Promise<Resultado<string | null>> {
  const buscar = () => db.from("ia_entradas").select("id").eq("corrida_id", e.corrida_id).eq("huella", e.huella).maybeSingle();
  const previa = await buscar();
  if (previa.error) return { data: null, error: previa.error };
  if (previa.data) return { data: previa.data.id, error: null };
  const r = await db
    .from("ia_entradas")
    .insert({ corrida_id: e.corrida_id, tipo: e.tipo, huella: e.huella, contenido_gz: aByteaHex(comprimirContenido(e.contenido)), bytes: e.bytes, diccionario: e.diccionario })
    .select("id")
    .single();
  if (r.error?.code === "23505") {
    const otra = await buscar();
    return { data: otra.data?.id ?? null, error: otra.error };
  }
  return { data: r.data?.id ?? null, error: r.error };
}

export function leerEntrada(db: Db, id: string) {
  return db.from("ia_entradas").select("*").eq("id", id).maybeSingle();
}

/** Las entradas por id, en el orden pedido. */
export async function leerEntradas(db: Db, ids: readonly string[]): Promise<Resultado<EntradaDb[]>> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await db.from("ia_entradas").select("*").in("id", [...ids]);
  const porId = new Map((data ?? []).map((x) => [x.id, x]));
  return { data: ids.map((i) => porId.get(i)).filter((x): x is EntradaDb => x !== undefined), error };
}

// ─── Llamadas ───

export function insertarLlamada(db: Db, fila: TablesInsert<"ia_llamadas">) {
  return db.from("ia_llamadas").insert(fila).select("*").single();
}

/** Todas las llamadas de un GM (de todos sus pasos y reinicios), de la más antigua a la más reciente: para el tope de reintentos. */
export function leerLlamadasDeGM(db: Db, corridaGmId: string) {
  return leerTodo<LlamadaDb>((d, h) => db.from("ia_llamadas").select("*").eq("corrida_gm_id", corridaGmId).order("created_at").order("id").range(d, h));
}

/** Las llamadas de una corrida (columnas de gasto y modelo), de la más antigua a la más reciente. */
export function leerLlamadasDeCorrida(db: Db, corridaId: string) {
  return leerTodo<LlamadaDb>((d, h) => db.from("ia_llamadas").select("*").eq("corrida_id", corridaId).order("created_at").order("id").range(d, h));
}

/** La llamada más reciente de todo el servicio (para saber si el proveedor rechazó la clave). */
export async function leerUltimaLlamada(db: Db): Promise<Resultado<Pick<LlamadaDb, "estado" | "created_at"> | null>> {
  const { data, error } = await db.from("ia_llamadas").select("estado, created_at").order("created_at", { ascending: false }).limit(1);
  return { data: data?.[0] ?? null, error };
}

/** Un milisegundo antes de un instante ISO: el filtro del servidor es `>` de ese instante y el `>=` exacto se aplica al leer. */
const antesDe = (iso: string): string => new Date(Date.parse(iso) - 1).toISOString();

export type CostoLlamada = { costo_usd: number; created_at: string; corrida_id: string; perfil_id: string | null };

/** Costo de las llamadas creadas en `[desde, hasta)`; con `perfilId`, solo las de ese usuario. Paginado. */
export async function leerCostosDelRango(db: Db, desdeIso: string, hastaIso: string, perfilId: string | null = null): Promise<Resultado<CostoLlamada[]>> {
  const r = await leerTodo<{ costo_usd: number | string; created_at: string; corrida_id: string; perfil_id: string | null }>((d, h) => {
    let c = db.from("ia_llamadas").select("costo_usd, created_at, corrida_id, perfil_id").gt("created_at", antesDe(desdeIso)).lt("created_at", hastaIso);
    if (perfilId !== null) c = c.eq("perfil_id", perfilId);
    return c.order("created_at").order("id").range(d, h);
  });
  return { data: r.data.filter((x) => x.created_at >= desdeIso).map((x) => ({ costo_usd: Number(x.costo_usd), created_at: x.created_at, corrida_id: x.corrida_id, perfil_id: x.perfil_id })), error: r.error };
}

/** Costo de las llamadas de una o varias corridas (por corrida). */
export async function leerCostosPorCorrida(db: Db, corridaIds: readonly string[]): Promise<Resultado<Map<string, number>>> {
  const salida = new Map<string, number>();
  for (const tanda of enTandas([...corridaIds], TANDA_IN)) {
    const r = await leerTodo<{ corrida_id: string; costo_usd: number | string }>((d, h) => db.from("ia_llamadas").select("corrida_id, costo_usd").in("corrida_id", tanda).order("id").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    for (const x of r.data) salida.set(x.corrida_id, (salida.get(x.corrida_id) ?? 0) + Number(x.costo_usd));
  }
  return { data: salida, error: null };
}

/** Costo de las llamadas de uno o varios GM de corrida (por `corrida_gm_id`). */
export async function leerCostosPorCorridaGM(db: Db, corridaGmIds: readonly string[]): Promise<Resultado<Map<string, number>>> {
  const salida = new Map<string, number>();
  for (const tanda of enTandas([...corridaGmIds], TANDA_IN)) {
    const r = await leerTodo<{ corrida_gm_id: string; costo_usd: number | string }>((d, h) => db.from("ia_llamadas").select("corrida_gm_id, costo_usd").in("corrida_gm_id", tanda).order("id").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    for (const x of r.data) salida.set(x.corrida_gm_id, (salida.get(x.corrida_gm_id) ?? 0) + Number(x.costo_usd));
  }
  return { data: salida, error: null };
}

/** Los `modelo_respuesta` distintos de las llamadas `ok` de unas corridas (R34). */
export async function leerModelosRespondidos(db: Db, corridaIds: readonly string[]): Promise<Resultado<Set<string>>> {
  const salida = new Set<string>();
  for (const tanda of enTandas([...corridaIds], TANDA_IN)) {
    const r = await leerTodo<{ modelo_respuesta: string | null }>((d, h) => db.from("ia_llamadas").select("modelo_respuesta").in("corrida_id", tanda).eq("estado", "ok").order("id").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    for (const x of r.data) if (x.modelo_respuesta) salida.add(x.modelo_respuesta);
  }
  return { data: salida, error: null };
}

// ─── Propuestas ───

/** Forma del payload de `registrar_propuesta_ia_gm` (§2.11). */
export type PayloadRegistroIa = {
  corrida_gm_id: string;
  candado_token: string;
  reusa_propuesta_id?: string;
  huella_gm?: string;
  propuesta?: {
    genero_id: string;
    mundo_id: string;
    es_resto: boolean;
    capacidades: string[];
    modo: "directo" | "jerarquico";
    version_metodo: number;
    meta?: Json;
    huella_gm: string;
    huella_historia: string;
    razon_gm?: string;
    banderas_gm: string[];
    avisos: string[];
    filas_pedidas: number;
    filas_validas: number;
    desvio_suma_modelo?: number;
    perfil_id?: string;
    usuario_nombre?: string;
  };
  filas?: {
    fila_id?: string;
    fila_clave: string;
    estado_meta: string;
    base_al_generar?: number;
    base_corregida_al_generar?: number;
    p_gm_al_generar?: number;
    aporte_fijo_al_generar?: number;
    natural_y1?: number;
    razon_natural?: string;
    meta_y1_modelo?: number;
    meta_y1_al_generar?: number;
    razon?: string;
    banderas: string[];
    senales: string[];
    avisos: string[];
    confianza?: string;
  }[];
};

/** Graba la propuesta entera de un GM o nada (una transacción). Devuelve el id de la propuesta (o de la reusada). */
export async function registrarPropuestaIa(db: Db, payload: PayloadRegistroIa): Promise<Resultado<string | null>> {
  const { data, error } = await db.rpc("registrar_propuesta_ia_gm", { p: payload as unknown as Json });
  return { data: (data as string | null) ?? null, error };
}

export type ErrorRegistroIa = { status: number; codigo: string; mensaje: string };

/** SQLSTATE propios de `registrar_propuesta_ia_gm`: `IA001` candado, `IA002` corrida terminada, `IA003` propuesta no reusable. `null` = otro error. Pura. */
export function describirErrorRegistro(code: string | null | undefined): ErrorRegistroIa | null {
  if (code === "IA001") return { status: 409, codigo: "gm_en_proceso", mensaje: "Otro proceso está trabajando este género y mundo, o perdiste el turno. Vuelve a intentarlo en un momento." };
  if (code === "IA002") return { status: 409, codigo: "corrida_terminada", mensaje: "La corrida ya terminó: inicia una nueva." };
  if (code === "IA003") return { status: 409, codigo: "propuesta_no_reusable", mensaje: "La propuesta anterior ya no se puede reusar. Vuelve a generar este género y mundo." };
  return null;
}

/** Todas las propuestas de GM de una proyección, de la más reciente a la más antigua dentro de cada GM (`gm_clave`). Paginado. */
export function leerPropuestasDeProyeccion(db: Db, proyeccionId: string) {
  return leerTodo<PropuestaGMDb>((d, h) =>
    db.from("ia_propuestas_gm").select("*").eq("proyeccion_id", proyeccionId).order("gm_clave").order("created_at", { ascending: false }).order("id").range(d, h)
  );
}

/** La propuesta vigente de un GM en una proyección (la más reciente), sin sus filas. */
export async function leerPropuestaVigenteDeGM(db: Db, proyeccionId: string, gmClave: string): Promise<Resultado<PropuestaGMDb | null>> {
  const { data, error } = await db.from("ia_propuestas_gm").select("*").eq("proyeccion_id", proyeccionId).eq("gm_clave", gmClave).order("created_at", { ascending: false }).order("id").limit(1);
  return { data: data?.[0] ?? null, error };
}

export function leerPropuestaGM(db: Db, id: string) {
  return db.from("ia_propuestas_gm").select("*").eq("id", id).maybeSingle();
}

export function leerPropuestaFila(db: Db, id: string) {
  return db.from("ia_propuestas_filas").select("*").eq("id", id).maybeSingle();
}

/** Las filas de varias propuestas, en tandas y paginadas. */
export async function leerFilasDePropuestas(db: Db, propuestaIds: readonly string[]): Promise<Resultado<PropuestaFilaDb[]>> {
  const salida: PropuestaFilaDb[] = [];
  for (const tanda of enTandas([...propuestaIds], 20)) {
    const r = await leerTodo<PropuestaFilaDb>((d, h) => db.from("ia_propuestas_filas").select("*").in("propuesta_gm_id", tanda).order("propuesta_gm_id").order("fila_clave").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    salida.push(...r.data);
  }
  return { data: salida, error: null };
}

// ─── Venta y términos privados ───

/** La única lectura de venta del módulo (§2.10): unidades por fila × clave × mes, sin soles, costos ni stock. */
export async function leerVentaLineasIa(
  db: Db,
  args: { gmlIds: readonly string[]; grupos: Record<string, string>; desde: string; hasta: string }
): Promise<Resultado<VentaLineasIaApi | null>> {
  const { data, error } = await db
    .rpc("venta_lineas_ia", {
      p_gml_ids: [...args.gmlIds],
      p_grupos: args.grupos as Json,
      p_desde: periodoADb(args.desde),
      p_hasta: periodoADb(args.hasta),
    })
    .abortSignal(plazoLectura());
  if (error) return { data: null, error: conMensajeLecturaLenta(error, MENSAJES_LECTURA_LENTA.ventaLineasIa) };
  const v = data as unknown as Partial<VentaLineasIaApi> | null;
  if (!v || !v.dic || !Array.isArray(v.f) || !Array.isArray(v.u)) return { data: null, error: null };
  return { data: { dic: v.dic, f: v.f, c: v.c ?? [], p: v.p ?? [], u: v.u, cargas: v.cargas ?? {} }, error: null };
}

/**
 * Los términos que nunca salen al proveedor (§3.5): marcas (activas o no; nombre y código), tiendas (nombre, código, razón social y zona) y los
 * `terminos_extra` de la configuración (el nombre de la empresa: sin él, nada lo detiene; por eso guardar una configuración con la IA encendida
 * exige al menos uno). Se arman en tiempo de ejecución: nunca viven en el repo. La zona la comparten varias tiendas: su alias no apunta a ninguna
 * (`id: null`).
 */
export async function leerTerminosPrivados(db: Db, terminosExtra: readonly string[]): Promise<Resultado<TerminoPrivado[]>> {
  const [marcas, tiendas] = await Promise.all([
    leerTodo<{ id: string; nombre: string; codigo: string | null }>((d, h) => db.from("marcas").select("id, nombre, codigo").order("id").range(d, h)),
    leerTodo<{ id: string; nombre: string; codigo: string; razon_social: string | null; zona: string | null }>((d, h) => db.from("tiendas").select("id, nombre, codigo, razon_social, zona").order("id").range(d, h)),
  ]);
  const fallo = marcas.error ?? tiendas.error;
  const hay = (t: string | null | undefined): t is string => typeof t === "string" && t.trim() !== "";
  const terminos: TerminoPrivado[] = [
    ...marcas.data.flatMap((m): TerminoPrivado[] => [{ texto: m.nombre, tipo: "marca", id: m.id }, ...(hay(m.codigo) ? [{ texto: m.codigo, tipo: "marca" as const, id: m.id }] : [])]),
    ...tiendas.data.flatMap((t): TerminoPrivado[] => [
      { texto: t.nombre, tipo: "tienda", id: t.id },
      { texto: t.codigo, tipo: "tienda", id: t.id },
      ...(hay(t.razon_social) ? [{ texto: t.razon_social, tipo: "tienda" as const, id: t.id }] : []),
      ...(hay(t.zona) ? [{ texto: t.zona, tipo: "tienda" as const, id: null }] : []),
    ]),
    ...terminosExtra.map((t): TerminoPrivado => ({ texto: t, tipo: "termino", id: null })),
  ];
  return { data: terminos, error: fallo };
}
