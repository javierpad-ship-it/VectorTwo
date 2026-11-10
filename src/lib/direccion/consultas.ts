import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { leerTodo } from "@/lib/arbol/consultas";
import { conMensajeLecturaLenta, plazoLectura } from "@/lib/api/plazos";
import type { Database, Tables } from "@/lib/supabase/database.types";
import type {
  FilaAprobacionSql,
  ParamsRegistrarAprobacionSql,
  ParamsTableroProyeccionSql,
  ParamsTableroVentaSql,
  ResultadoAprobacion,
  ResultadoRegistrarAprobacionSql,
  TableroProyeccionSql,
  TableroVentaSql,
  TableroVentaTendenciaSql,
} from "./tipos-api";

/**
 * Entrada y salida de datos del tablero de dirección (ficha 14, §3). ÚNICO archivo de `src/` que nombra las funciones `tablero_venta`,
 * `tablero_proyeccion`, `huella_proyeccion` y `registrar_aprobacion_direccion` y la tabla `aprobaciones_direccion` (prueba estática). Solo servidor.
 *
 * Todo es lectura salvo `registrarAprobacion`, que llama a la única función que escribe (`registrar_aprobacion_direccion`): aquí no hay
 * `insert`, `update`, `upsert` ni `delete`.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export const MENSAJE_TABLERO_LENTO = "El tablero tardó demasiado en leerse. Vuelve a intentarlo en un minuto (la segunda vez suele salir de la caché).";

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

// ─── Funciones de la 0041 ───

/** La huella de cifras de una proyección (32 hexadecimales), o `null` si no existe. */
export async function leerHuella(db: Db, proyeccionId: string): Promise<Resultado<string | null>> {
  const { data, error } = await db.rpc("huella_proyeccion", { p_proyeccion_id: proyeccionId });
  return { data: typeof data === "string" ? data : null, error };
}

/** Lo proyectado de una proyección, agregado para el tablero (con su huella, calculada en la misma sentencia). `null` si la proyección no existe. */
export async function leerTableroProyeccion(db: Db, proyeccionId: string, p: ParamsTableroProyeccionSql): Promise<Resultado<TableroProyeccionSql | null>> {
  const { data, error } = await db.rpc("tablero_proyeccion", { p_proyeccion_id: proyeccionId, p }).abortSignal(plazoLectura());
  if (error) return { data: null, error: conMensajeLecturaLenta(error, MENSAJE_TABLERO_LENTO) };
  if (!esObjeto(data) || typeof data.huella !== "string" || !Array.isArray(data.anios)) return { data: null, error: null };
  return { data: data as unknown as TableroProyeccionSql, error: null };
}

/** La única llamada a la función de venta (con su plazo de lectura): la usan el documento del recorte y el de la tendencia. */
async function rpcVenta(db: Db, p: ParamsTableroVentaSql | (Pick<ParamsTableroVentaSql, "desde" | "hasta" | "k_prima"> & { solo_tendencia: true })): Promise<Resultado<Record<string, unknown> | null>> {
  const { data, error } = await db.rpc("tablero_venta", { p }).abortSignal(plazoLectura());
  if (error) return { data: null, error: conMensajeLecturaLenta(error, MENSAJE_TABLERO_LENTO) };
  return { data: esObjeto(data) ? data : null, error: null };
}

/** La venta publicada agregada para el tablero (sin `solo_tendencia`). */
export async function leerTableroVenta(db: Db, p: ParamsTableroVentaSql): Promise<Resultado<TableroVentaSql | null>> {
  const { data, error } = await rpcVenta(db, { ...p, solo_tendencia: false });
  if (error || data === null || !Array.isArray(data.tiendas) || !Array.isArray(data.por_tienda)) return { data: null, error };
  return { data: data as unknown as TableroVentaSql, error: null };
}

/** La tendencia por género × mundo y tienda (`solo_tendencia`): sin filtros, de toda la empresa. */
export async function leerTendenciaVenta(db: Db, p: Pick<ParamsTableroVentaSql, "desde" | "hasta" | "k_prima">): Promise<Resultado<TableroVentaTendenciaSql | null>> {
  const { data, error } = await rpcVenta(db, { ...p, solo_tendencia: true });
  if (error || data === null || !Array.isArray(data.tiendas) || !Array.isArray(data.tendencia_gm)) return { data: null, error };
  return { data: data as unknown as TableroVentaTendenciaSql, error: null };
}

/**
 * Registra una aprobación de dirección. Es la ÚNICA escritura del módulo y la hace la función de la base (recalcula la huella y la compara con la
 * que vio el admin y con la del `resumen`). SIN plazo de cliente: abortar una escritura dejaría el resultado ambiguo. Los rechazos de regla vuelven
 * dentro de `data` (`{ error: "huella_distinta", … }`), no como error.
 */
export async function registrarAprobacion(db: Db, p: ParamsRegistrarAprobacionSql): Promise<Resultado<ResultadoRegistrarAprobacionSql | null>> {
  const { data, error } = await db.rpc("registrar_aprobacion_direccion", { p });
  if (error) return { data: null, error };
  return { data: esObjeto(data) ? (data as unknown as ResultadoRegistrarAprobacionSql) : null, error: null };
}

// ─── Tabla de aprobaciones (solo lectura) ───

const numero = (v: unknown): number => Number(v);

/**
 * De la fila generada (`estado_proyeccion`, `resultado`, `motivo` y `rol` son `string`, y `resumen` es `Json`) al contrato del módulo: los valores
 * los garantizan los `check` de la tabla y la función que la escribe. `resumen` llega como objeto; una fila rara (texto o nulo) no debe romper el tablero.
 */
function aFila(fila: Tables<"aprobaciones_direccion">): FilaAprobacionSql {
  const f = fila as FilaAprobacionSql;
  return { ...f, anio_en_curso: numero(f.anio_en_curso), resumen: esObjeto(f.resumen) ? f.resumen : ({} as FilaAprobacionSql["resumen"]) };
}

/** Todas las aprobaciones de una proyección, de la más reciente a la más antigua (con su `resumen`). */
export async function leerAprobacionesDeProyeccion(db: Db, proyeccionId: string): Promise<Resultado<FilaAprobacionSql[]>> {
  const r = await leerTodo<Tables<"aprobaciones_direccion">>((d, h) =>
    db.from("aprobaciones_direccion").select("*").eq("proyeccion_id", proyeccionId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(d, h)
  );
  return { data: r.data.map(aFila), error: r.error };
}

/** La aprobación más reciente con resultado `aprobada` o `con_observaciones`, de cualquier proyección (D6); `null` si no hay ninguna. */
export async function leerUltimaAprobada(db: Db): Promise<Resultado<FilaAprobacionSql | null>> {
  const { data, error } = await db
    .from("aprobaciones_direccion")
    .select("*")
    .neq("resultado", "rechazada")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  return { data: data && data.length > 0 ? aFila(data[0]) : null, error };
}

export type AprobacionLigera = { id: string; proyeccion_id: string; huella: string; resultado: ResultadoAprobacion; created_at: string };

/**
 * Lo mínimo de TODAS las aprobaciones (sin `resumen`), de la más reciente a la más antigua: para el estado de dirección de cada proyección de la
 * lista. La tabla crece una fila por acto de aprobación; se pagina igual.
 */
export async function leerAprobacionesLigeras(db: Db): Promise<Resultado<AprobacionLigera[]>> {
  const r = await leerTodo((d, h) =>
    db.from("aprobaciones_direccion").select("id, proyeccion_id, huella, resultado, created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).range(d, h)
  );
  // `resultado` es `string` en los tipos generados; el `check` de la tabla lo limita a los tres valores de `ResultadoAprobacion`.
  return { data: r.data.map((f) => ({ ...f, resultado: f.resultado as ResultadoAprobacion })), error: r.error };
}

// ─── La proyección no se elimina si tiene aprobaciones ───

/** SQLSTATE de una FK que impide borrar: `foreign_key_violation` y, desde PostgreSQL 18, `restrict_violation` para `on delete restrict`. */
const CODIGOS_FK = new Set(["23503", "23001"]);

/**
 * ¿El error de borrar una proyección es la FK `restrict` de `aprobaciones_direccion.proyeccion_id`? (R20). La usa el `DELETE` de proyecciones de M7
 * para responder `409 tiene_aprobaciones`: borrar una proyección no debe borrar el rastro de una decisión de dirección.
 */
export function esFkDeAprobaciones(err: { code?: string | null; message?: string | null; details?: string | null } | null | undefined): boolean {
  if (!err || !CODIGOS_FK.has(err.code ?? "")) return false;
  return `${err.message ?? ""} ${err.details ?? ""}`.includes("aprobaciones_direccion");
}

export const MENSAJE_TIENE_APROBACIONES = "Esta proyección tiene aprobaciones de dirección: archívala en lugar de eliminarla.";
