import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { leerNodos, leerTodo } from "../consultas";
import { TANDA_IN, enTandas } from "../importar";
import type { EstadoImportacionNivel } from "./importar";
import type { NivelPlanificacion } from "../tipos";

/**
 * Lecturas y escrituras del nivel de planificación (solo servidor). Se lee solo
 * lo que hace falta (géneros, mundos, líneas y nodos: sin equivalencias, que en
 * el árbol real pasan de 1 900 filas) y se escribe con `update … in (ids)` en
 * tandas de `TANDA_IN` (los ids viajan en la URL).
 */

type Db = SupabaseClient<Database>;

export async function cargarEstadoNivel(
  db: Db
): Promise<{ estado: EstadoImportacionNivel; error: null } | { estado: null; error: PostgrestError }> {
  const [generos, mundos, lineas, nodos] = await Promise.all([
    db.from("generos").select("id, codigo, nombre, activo").order("orden").order("nombre"),
    db.from("mundos").select("id, codigo, nombre, activo").order("orden").order("nombre"),
    leerTodo<Pick<Tables<"lineas">, "id" | "codigo" | "nombre" | "activo">>((d, h) =>
      db.from("lineas").select("id, codigo, nombre, activo").order("nombre").order("id").range(d, h)
    ),
    leerNodos(db),
  ]);
  const fallo = generos.error ?? mundos.error ?? lineas.error ?? nodos.error;
  if (fallo) return { estado: null, error: fallo };
  return {
    estado: { generos: generos.data ?? [], mundos: mundos.data ?? [], lineas: lineas.data, nodos: nodos.data },
    error: null,
  };
}

/** Escribe `nivel_planificacion` en los nodos dados, por tandas. Devuelve cuántos se escribieron. */
export async function escribirNivel(
  db: Db,
  nodoIds: readonly string[],
  nivel: NivelPlanificacion
): Promise<{ escritos: number; error: PostgrestError | null }> {
  let escritos = 0;
  for (const tanda of enTandas([...nodoIds], TANDA_IN)) {
    const { data, error } = await db
      .from("genero_mundo_linea")
      .update({ nivel_planificacion: nivel })
      .in("id", tanda)
      .select("id");
    if (error) return { escritos, error };
    escritos += data?.length ?? 0;
  }
  return { escritos, error: null };
}
