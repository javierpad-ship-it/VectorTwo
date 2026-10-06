import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { cargarEstadoArbol, leerTodo, type EstadoArbol } from "@/lib/arbol/consultas";
import { anexarGeneroIds } from "./reglas";

/**
 * Lecturas compartidas de M3 (solo servidor). Como en el árbol, todo lo que
 * pueda crecer se lee con `leerTodo` (PostgREST corta en 1000 filas).
 *
 * `cargarEstadoArbol` (M1) se deja como está y aquí se expone la hermana
 * `cargarEstadoEstacionalidad`, que lee además `agrupaciones_estacionalidad`
 * completa (activas e inactivas: una equivalencia puede apuntar a una
 * inactiva y el árbol y los faltantes deben poder mostrarlo) y los vínculos
 * agrupación ↔ género (`agrupacion_estacionalidad_genero`). La usan
 * `GET /api/arbol`, la lista plana, los faltantes y el importador.
 */

type Db = SupabaseClient<Database>;

export type EstadoEstacionalidad = EstadoArbol & {
  agrupaciones: Tables<"agrupaciones_estacionalidad">[];
  /** Vínculos agrupación ↔ género, completos. `agrupacionesConGeneros` los pliega en cada agrupación. */
  agrupacion_generos: Tables<"agrupacion_estacionalidad_genero">[];
};

/** Vínculos agrupación ↔ género, completos y con orden estable. */
export function leerVinculosGenero(db: Db) {
  return leerTodo<Tables<"agrupacion_estacionalidad_genero">>((d, h) =>
    db.from("agrupacion_estacionalidad_genero").select("*").order("id").range(d, h)
  );
}

/** Las agrupaciones del estado con `genero_ids` (vacío en las heredadas "sin género"). */
export function agrupacionesConGeneros(estado: Pick<EstadoEstacionalidad, "agrupaciones" | "agrupacion_generos">) {
  return anexarGeneroIds(estado.agrupaciones, estado.agrupacion_generos);
}

export function leerAgrupacionesEstacionalidad(db: Db) {
  return leerTodo<Tables<"agrupaciones_estacionalidad">>((d, h) =>
    db.from("agrupaciones_estacionalidad").select("*").order("orden").order("nombre").order("id").range(d, h)
  );
}

/** Las cinco tablas del árbol, las agrupaciones y sus vínculos con géneros, completas (activas e inactivas). */
export async function cargarEstadoEstacionalidad(
  db: Db
): Promise<{ estado: EstadoEstacionalidad; error: null } | { estado: null; error: PostgrestError }> {
  const [arbol, agrupaciones, vinculos] = await Promise.all([
    cargarEstadoArbol(db),
    leerAgrupacionesEstacionalidad(db),
    leerVinculosGenero(db),
  ]);
  if (arbol.error) return { estado: null, error: arbol.error };
  if (agrupaciones.error) return { estado: null, error: agrupaciones.error };
  if (vinculos.error) return { estado: null, error: vinculos.error };
  return {
    estado: { ...arbol.estado, agrupaciones: agrupaciones.data, agrupacion_generos: vinculos.data },
    error: null,
  };
}
