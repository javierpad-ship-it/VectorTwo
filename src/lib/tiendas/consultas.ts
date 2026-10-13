import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { esTipoTienda, estadoTienda } from "./estado";
import type { EstadoImportacionTiendas } from "./importar";
import type { TiendaFila } from "./tipos";

/**
 * Lecturas compartidas de M4 (solo servidor). Como en el árbol, todo se lee
 * con `leerTodo` aunque la tabla tenga una docena de filas: el patrón es el
 * mismo y no cuesta nada.
 */

type Db = SupabaseClient<Database>;

/** Anexa el `estado` calculado a la fecha `hoy`. `tipo` sale del `check` de la base, así que siempre es válido. */
export function aTiendaFila(fila: Tables<"tiendas">, hoy: string): TiendaFila {
  return {
    ...fila,
    tipo: esTipoTienda(fila.tipo) ? fila.tipo : "Tienda",
    venta_esperada_promedio: fila.venta_esperada_promedio === null ? null : Number(fila.venta_esperada_promedio),
    estado: estadoTienda(fila, hoy),
  };
}

/** Tiendas por `codigo` (y `id` para que el orden sea estable). Por defecto solo activas. */
export function leerTiendas(db: Db, opciones: { soloActivas?: boolean } = {}) {
  const soloActivas = opciones.soloActivas ?? true;
  return leerTodo<Tables<"tiendas">>((d, h) => {
    let consulta = db.from("tiendas").select("*");
    if (soloActivas) consulta = consulta.eq("activo", true);
    return consulta.order("codigo").order("id").range(d, h);
  });
}

/**
 * Ubicaciones ignoradas (M5c) por `nombre` (y `id` para que el orden sea
 * estable). Por defecto solo `activo = true`: una fila con `activo = false` se
 * lee como si no existiera. ÚNICO lugar que toca la tabla.
 */
export function leerUbicacionesIgnoradas(db: Db, opciones: { soloActivas?: boolean } = {}) {
  const soloActivas = opciones.soloActivas ?? true;
  return leerTodo<Tables<"ubicaciones_ignoradas">>((d, h) => {
    let consulta = db.from("ubicaciones_ignoradas").select("*");
    if (soloActivas) consulta = consulta.eq("activo", true);
    return consulta.order("nombre").order("id").range(d, h);
  });
}

/** Una ubicación ignorada por id (`data: null` si no existe). */
export function buscarUbicacionIgnorada(db: Db, id: string) {
  return db.from("ubicaciones_ignoradas").select("*").eq("id", id).maybeSingle();
}

export function crearUbicacionIgnorada(db: Db, nueva: TablesInsert<"ubicaciones_ignoradas">) {
  return db.from("ubicaciones_ignoradas").insert(nueva).select("*").single();
}

export function editarUbicacionIgnorada(db: Db, id: string, cambio: TablesUpdate<"ubicaciones_ignoradas">) {
  return db.from("ubicaciones_ignoradas").update(cambio).eq("id", id).select("*").single();
}

/** Borra la fila: la baja de una ubicación ignorada no deja rastro (nada cuelga de ella). */
export function eliminarUbicacionIgnorada(db: Db, id: string) {
  return db.from("ubicaciones_ignoradas").delete().eq("id", id);
}

/** La tabla completa (activas e inactivas) para el importador. */
export async function cargarEstadoTiendas(
  db: Db
): Promise<{ estado: EstadoImportacionTiendas; error: null } | { estado: null; error: PostgrestError }> {
  const { data, error } = await leerTiendas(db, { soloActivas: false });
  if (error) return { estado: null, error };
  return { estado: { tiendas: data }, error: null };
}
