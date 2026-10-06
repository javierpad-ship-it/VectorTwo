import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { cargarEstadoArbol, leerTodo, type EstadoArbol } from "@/lib/arbol/consultas";

/**
 * Lecturas compartidas de M3 (solo servidor). Como en el árbol, todo lo que
 * pueda crecer se lee con `leerTodo` (PostgREST corta en 1000 filas).
 *
 * `cargarEstadoArbol` (M1) se deja como está y aquí se expone la hermana
 * `cargarEstadoEstacionalidad`, que lee además `agrupaciones_estacionalidad`
 * completa (activas e inactivas: una equivalencia puede apuntar a una
 * inactiva y el árbol y los faltantes deben poder mostrarlo). La usan
 * `GET /api/arbol`, la lista plana, los faltantes y el importador.
 */

type Db = SupabaseClient<Database>;

export type EstadoEstacionalidad = EstadoArbol & { agrupaciones: Tables<"agrupaciones_estacionalidad">[] };

export function leerAgrupacionesEstacionalidad(db: Db) {
  return leerTodo<Tables<"agrupaciones_estacionalidad">>((d, h) =>
    db.from("agrupaciones_estacionalidad").select("*").order("orden").order("nombre").order("id").range(d, h)
  );
}

/** Las cinco tablas del árbol más las agrupaciones, completas (activas e inactivas). */
export async function cargarEstadoEstacionalidad(
  db: Db
): Promise<{ estado: EstadoEstacionalidad; error: null } | { estado: null; error: PostgrestError }> {
  const [arbol, agrupaciones] = await Promise.all([cargarEstadoArbol(db), leerAgrupacionesEstacionalidad(db)]);
  if (arbol.error) return { estado: null, error: arbol.error };
  if (agrupaciones.error) return { estado: null, error: agrupaciones.error };
  return { estado: { ...arbol.estado, agrupaciones: agrupaciones.data }, error: null };
}
