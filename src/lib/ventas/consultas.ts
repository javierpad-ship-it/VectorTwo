import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { cargaCaducada, esEstadoCarga } from "./cargas";
import { recortarPeriodo } from "./periodo";
import type { MedidasCarga } from "./tipos";
import type {
  CargaApi,
  CargaEnCursoResumen,
  CargaPublicadaResumen,
  HuellaStock,
  LimpiarRespuesta,
} from "./tipos-api";

/**
 * Lecturas y escrituras compartidas de M5 (solo servidor). ÚNICO archivo de
 * `src/` que menciona la tabla de hechos (`venta_stock_mensual`): toda lectura
 * del histórico va a la vista `venta_stock_vigente` o a una función SQL, y las
 * escrituras de tandas y la limpieza pasan por aquí (regla 33).
 *
 * Regla de oro: ninguna lectura del histórico trae filas a Node. Lo que agrega
 * (totales, verificación, huellas) se hace en SQL o con conteos `head`.
 *
 * `supabase gen types` tipa la vista bajo `Database["public"]["Views"]`, no
 * bajo `Tables<…>`, así que aquí se declara el alias de fila.
 */

type Db = SupabaseClient<Database>;

/** Fila de la vista `venta_stock_vigente`. */
export type VentaStockVigente = Database["public"]["Views"]["venta_stock_vigente"]["Row"];

export type CargaFila = Omit<Tables<"cargas_venta_stock">, "reporte">;

const COLUMNAS_CARGA =
  "id, periodo, estado, archivo_nombre, perfil_id, usuario_nombre, filas, unidades, venta_soles, costo_vendido, stock_unidades, stock_valorizado, publicada_at, limpiada_at, created_at, updated_at";

/** Selección de una carga con el `incompleto` del reporte (sin traer el reporte entero, que puede pesar 200 KB). */
export const SELECT_CARGA = `${COLUMNAS_CARGA}, incompleto:reporte->incompleto`;

export type CargaLeida = CargaFila & { incompleto: Json | null };

/** `{ porcentaje }` si el reporte lo marcó incompleto; `null` si no. */
export function leerIncompleto(valor: Json | null | undefined): { porcentaje: number | null } | null {
  if (valor === null || valor === undefined || valor === false) return null;
  if (typeof valor === "object" && !Array.isArray(valor)) {
    const p = valor.porcentaje;
    return { porcentaje: typeof p === "number" ? p : null };
  }
  return { porcentaje: null };
}

export function aCargaApi(c: CargaLeida): CargaApi {
  return {
    id: c.id,
    periodo: recortarPeriodo(c.periodo),
    estado: esEstadoCarga(c.estado) ? c.estado : "fallida",
    archivo_nombre: c.archivo_nombre,
    usuario_nombre: c.usuario_nombre,
    filas: c.filas,
    unidades: c.unidades,
    venta_soles: c.venta_soles,
    costo_vendido: c.costo_vendido,
    stock_unidades: c.stock_unidades,
    stock_valorizado: c.stock_valorizado,
    publicada_at: c.publicada_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
    incompleto: leerIncompleto(c.incompleto),
  };
}

export function aResumenPublicada(c: CargaFila): CargaPublicadaResumen {
  return {
    id: c.id,
    publicada_at: c.publicada_at,
    usuario_nombre: c.usuario_nombre,
    filas: c.filas ?? 0,
    unidades: c.unidades ?? 0,
    venta_soles: c.venta_soles ?? 0,
    costo_vendido: c.costo_vendido ?? 0,
    stock_unidades: c.stock_unidades ?? 0,
    stock_valorizado: c.stock_valorizado ?? 0,
  };
}

export function aEnCurso(c: Pick<CargaFila, "id" | "usuario_nombre" | "created_at" | "updated_at">, ahora: Date = new Date()): CargaEnCursoResumen {
  return {
    id: c.id,
    usuario_nombre: c.usuario_nombre,
    created_at: c.created_at,
    updated_at: c.updated_at,
    caducada: cargaCaducada(c.updated_at, ahora),
  };
}

/** Medidas de una carga publicada (sus totales guardados). */
export function medidasDeCarga(c: Pick<CargaFila, "filas" | "unidades" | "venta_soles" | "costo_vendido" | "stock_unidades" | "stock_valorizado">): MedidasCarga {
  return {
    filas: c.filas ?? 0,
    unidades: c.unidades ?? 0,
    venta_soles: c.venta_soles ?? 0,
    costo_vendido: c.costo_vendido ?? 0,
    stock_unidades: c.stock_unidades ?? 0,
    stock_valorizado: c.stock_valorizado ?? 0,
  };
}

// ─── Cargas ───

/** Cargas `publicada` y `en_curso` (las que se ven en "Cargas por mes"), por periodo. */
export function leerCargasVigentes(db: Db) {
  return leerTodo<CargaLeida>(async (d, h) => {
    const r = await db
      .from("cargas_venta_stock")
      .select(SELECT_CARGA)
      .in("estado", ["publicada", "en_curso"])
      .order("periodo")
      .order("created_at")
      .order("id")
      .range(d, h);
    return { data: r.data as CargaLeida[] | null, error: r.error };
  });
}

/** Todas las cargas de un mes (cualquier estado), de la más nueva a la más vieja. */
export function leerCargasDePeriodo(db: Db, periodoDb: string) {
  return leerTodo<CargaLeida>(async (d, h) => {
    const r = await db
      .from("cargas_venta_stock")
      .select(SELECT_CARGA)
      .eq("periodo", periodoDb)
      .order("created_at", { ascending: false })
      .order("id")
      .range(d, h);
    return { data: r.data as CargaLeida[] | null, error: r.error };
  });
}

/** Una carga con su reporte completo (solo el detalle lo pide). */
export async function leerCargaConReporte(db: Db, id: string) {
  const { data, error } = await db.from("cargas_venta_stock").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

// ─── Maestros que usa `previsualizar` ───

export async function leerCodigosTalla(
  db: Db
): Promise<{ data: { CENTRALES: string; EXTREMAS: string } | null; error: PostgrestError | null }> {
  const { data, error } = await db.from("agrupaciones_talla").select("id, codigo, activo");
  if (error) return { data: null, error };
  const id = (codigo: string) => data?.find((t) => t.codigo.toUpperCase() === codigo)?.id;
  const centrales = id("CENTRALES");
  const extremas = id("EXTREMAS");
  if (!centrales || !extremas) return { data: null, error: null };
  return { data: { CENTRALES: centrales, EXTREMAS: extremas }, error: null };
}

// ─── Huellas de stock (conteos head, sin traer filas) ───

const CONCURRENCIA_HUELLAS = 6;

/**
 * Huella de stock de las cargas publicadas: filas con `stock <> 0` (un conteo
 * `head` por la vista, que entra por el prefijo `carga_id` de la clave
 * primaria) más las sumas que la carga ya guardó al publicarse.
 */
export async function leerHuellasStock(
  db: Db,
  publicadas: readonly Pick<CargaFila, "id" | "periodo" | "stock_unidades" | "stock_valorizado">[]
): Promise<{ data: HuellaStock[]; error: PostgrestError | null }> {
  const huellas: HuellaStock[] = [];
  for (let i = 0; i < publicadas.length; i += CONCURRENCIA_HUELLAS) {
    const lote = publicadas.slice(i, i + CONCURRENCIA_HUELLAS);
    const resultados = await Promise.all(
      lote.map((c) =>
        db
          .from("venta_stock_vigente")
          .select("carga_id", { count: "exact", head: true })
          .eq("carga_id", c.id)
          .or("stock_unidades.neq.0,stock_valorizado.neq.0")
      )
    );
    for (let j = 0; j < lote.length; j++) {
      const r = resultados[j];
      if (r.error) return { data: huellas, error: r.error };
      huellas.push({
        periodo: recortarPeriodo(lote[j].periodo),
        filas_con_stock: r.count ?? 0,
        stock_unidades: lote[j].stock_unidades ?? 0,
        stock_valorizado: lote[j].stock_valorizado ?? 0,
      });
    }
  }
  return { data: huellas.sort((a, b) => a.periodo.localeCompare(b.periodo)), error: null };
}

// ─── Funciones SQL ───

export type TotalCargaMedido = {
  carga_id: string;
  periodo: string;
  filas: number;
  unidades: number;
  venta_soles: number;
  costo_vendido: number;
  stock_unidades: number;
  stock_valorizado: number;
};

export async function leerTotalesPublicadas(db: Db) {
  const { data, error } = await db.rpc("totales_cargas_publicadas");
  return { data: (data ?? []) as TotalCargaMedido[], error };
}

export async function leerPendientesLimpieza(db: Db) {
  const { data, error } = await db.rpc("cargas_pendientes_limpieza");
  return { data: data ?? [], error };
}

// ─── Hechos (únicos accesos a la tabla) ───

export type HechoInsert = TablesInsert<"venta_stock_mensual">;

export const CLAVE_HECHOS = "carga_id,tienda_id,equivalencia_id,marca_id,agrupacion_talla_id";

/**
 * Escribe una tanda: `upsert … ignoreDuplicates` sobre la clave primaria, así
 * que reenviarla no duplica ni falla (la publicación sigue siendo quien
 * detecta una tanda perdida). Sin `select` después (Vector-One devolvía las
 * filas con sus joins y reventaba con lotes grandes).
 */
export async function insertarHechos(db: Db, filas: HechoInsert[]) {
  return db.from("venta_stock_mensual").upsert(filas, { onConflict: CLAVE_HECHOS, ignoreDuplicates: true });
}

/** Un `delete` por carga: entra por el prefijo de la clave primaria. Devuelve cuántas filas borró. */
export async function borrarHechosDeCarga(db: Db, cargaId: string) {
  const { count, error } = await db.from("venta_stock_mensual").delete({ count: "exact" }).eq("carga_id", cargaId);
  return { borradas: count ?? 0, error };
}

export type ColumnaHechos = "marca_id" | "tienda_id" | "equivalencia_id" | "agrupacion_talla_id";

/**
 * Cuántas filas de hechos (de cualquier carga: la FK las cuenta todas) cuelgan
 * de una marca, tienda, equivalencia o agrupación de talla. Marca y
 * equivalencia usan su índice (instantáneo); tienda escanea la tabla
 * (≈ 0,5 a 2 s, solo al intentar eliminar).
 */
export async function contarHechos(db: Db, columna: ColumnaHechos, id: string) {
  const { count, error } = await db
    .from("venta_stock_mensual")
    .select("carga_id", { count: "exact", head: true })
    .eq(columna, id);
  return { cuenta: count ?? 0, error };
}

/**
 * ¿Hay al menos una fila de hechos de esta marca? Una existencia (`limit 1`) por
 * el índice `(marca_id, carga_id)`, más barata que `contarHechos` cuando solo
 * importa saber si "vende" (conjuntos de 02b).
 */
export async function existenHechosDeMarca(db: Db, marcaId: string) {
  const { data, error } = await db.from("venta_stock_mensual").select("carga_id").eq("marca_id", marcaId).limit(1);
  return { existe: (data?.length ?? 0) > 0, error };
}

/**
 * Limpieza (regla de la ficha): borra las filas de las cargas terminales que
 * todavía las tienen y marca `limpiada_at`. Nunca toca `publicada` ni
 * `en_curso` (la función SQL no las devuelve). Idempotente.
 */
export async function limpiarPendientes(
  db: Db
): Promise<{ data: LimpiarRespuesta; error: null } | { data: null; error: PostgrestError }> {
  const { data: pendientes, error } = await leerPendientesLimpieza(db);
  if (error) return { data: null, error };

  let limpiadas = 0;
  let borradas = 0;
  for (const p of pendientes) {
    const r = await borrarHechosDeCarga(db, p.carga_id);
    if (r.error) {
      console.error("[db] limpiar carga", p.carga_id, r.error.message);
      continue;
    }
    borradas += r.borradas;
    limpiadas += 1;
    const u = await db.from("cargas_venta_stock").update({ limpiada_at: new Date().toISOString() }).eq("id", p.carga_id);
    if (u.error) console.error("[db] limpiada_at", p.carga_id, u.error.message);
  }

  const { data: restantes, error: errRestantes } = await leerPendientesLimpieza(db);
  return {
    data: {
      cargas_limpiadas: limpiadas,
      filas_borradas: borradas,
      pendientes: errRestantes ? Math.max(0, pendientes.length - limpiadas) : restantes.length,
    },
    error: null,
  };
}

// ─── Mapeos de combinación (M5b) ───
//
// ÚNICO archivo de `src/` que nombra la tabla de mapeos. Son cientos de filas:
// se leen enteros (paginando) y la lógica pura (`mapeos.ts`) trabaja en memoria.

export type MapeoDb = Tables<"mapeos_combinacion">;
export type MapeoInsert = TablesInsert<"mapeos_combinacion">;
export type MapeoUpdate = TablesUpdate<"mapeos_combinacion">;

/** Único natural del mapeo: el origen completo. */
export const CLAVE_MAPEOS = "origen_genero,origen_mundo,origen_linea,origen_equivalencia";

/** Todos los mapeos (activos o no), del más reciente al más viejo; `id` desempata. */
export function leerMapeos(db: Db) {
  return leerTodo<MapeoDb>((d, h) =>
    db.from("mapeos_combinacion").select("*").order("updated_at", { ascending: false }).order("id").range(d, h)
  );
}

/** Solo los activos: los que aplica el resolutor de `previsualizar`. */
export function leerMapeosActivos(db: Db) {
  return leerTodo<MapeoDb>((d, h) => db.from("mapeos_combinacion").select("*").eq("activo", true).order("id").range(d, h));
}

export async function leerMapeoPorId(db: Db, id: string) {
  const { data, error } = await db.from("mapeos_combinacion").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/** `insert` estricto (un origen repetido es `23505`): una sola sentencia, todo o nada. */
export async function insertarMapeos(db: Db, filas: MapeoInsert[]) {
  return db.from("mapeos_combinacion").insert(filas).select("*");
}

/** `upsert` sobre el único del origen: actualiza destino, nota y estado de los que ya existían. Una sola sentencia. */
export async function upsertMapeos(db: Db, filas: MapeoInsert[]) {
  return db.from("mapeos_combinacion").upsert(filas, { onConflict: CLAVE_MAPEOS, ignoreDuplicates: false }).select("*");
}

/** Tanda idempotente de la importación: lo que ya existe no se toca; devuelve solo las filas realmente insertadas. */
export async function insertarMapeosSiNoExisten(db: Db, filas: MapeoInsert[]) {
  return db
    .from("mapeos_combinacion")
    .upsert(filas, { onConflict: CLAVE_MAPEOS, ignoreDuplicates: true })
    .select("id");
}

export async function actualizarMapeo(db: Db, id: string, cambio: MapeoUpdate) {
  return db.from("mapeos_combinacion").update(cambio).eq("id", id).select("*").single();
}

export async function borrarMapeo(db: Db, id: string) {
  return db.from("mapeos_combinacion").delete().eq("id", id);
}

/**
 * `true` si el error es el choque del único del origen (`23505` sobre
 * `mapeos_combinacion_origen_uniq`): otra persona guardó el mismo origen entre
 * la lectura y la escritura. El alta lo devuelve como `409 origen_repetido`.
 */
export function esConflictoOrigenMapeo(err: Pick<PostgrestError, "code" | "message" | "details">): boolean {
  return err.code === "23505" && `${err.message} ${err.details ?? ""}`.includes("mapeos_combinacion_origen_uniq");
}
