import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";

/**
 * Lecturas compartidas del árbol (solo servidor). PostgREST corta en 1000
 * filas por defecto, así que todo lo que pueda crecer se lee con `range()` en
 * bucle hasta que una página venga corta.
 */

export const TAMANO_PAGINA = 1000;

type Pagina<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * Lee todas las filas de una consulta paginando. `pagina(desde, hasta)` debe
 * construir la consulta con un `order` estable y aplicar `range(desde, hasta)`.
 */
export async function leerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<Pagina<T>>
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const todo: T[] = [];
  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await pagina(desde, desde + TAMANO_PAGINA - 1);
    if (error) return { data: todo, error };
    const filas = data ?? [];
    todo.push(...filas);
    if (filas.length < TAMANO_PAGINA) return { data: todo, error: null };
  }
}

export type EstadoArbol = {
  generos: Tables<"generos">[];
  mundos: Tables<"mundos">[];
  lineas: Tables<"lineas">[];
  nodos: Tables<"genero_mundo_linea">[];
  equivalencias: Tables<"equivalencias">[];
};

type Db = SupabaseClient<Database>;

export function leerLineas(db: Db) {
  return leerTodo<Tables<"lineas">>((d, h) => db.from("lineas").select("*").order("id").range(d, h));
}

export function leerNodos(db: Db) {
  return leerTodo<Tables<"genero_mundo_linea">>((d, h) =>
    db.from("genero_mundo_linea").select("*").order("id").range(d, h)
  );
}

export function leerEquivalencias(db: Db) {
  return leerTodo<Tables<"equivalencias">>((d, h) => db.from("equivalencias").select("*").order("id").range(d, h));
}

/** Las cinco tablas del árbol, completas (activas e inactivas). */
export async function cargarEstadoArbol(
  db: Db
): Promise<{ estado: EstadoArbol; error: null } | { estado: null; error: PostgrestError }> {
  const [generos, mundos, lineas, nodos, equivalencias] = await Promise.all([
    db.from("generos").select("*").order("orden").order("nombre"),
    db.from("mundos").select("*").order("orden").order("nombre"),
    leerLineas(db),
    leerNodos(db),
    leerEquivalencias(db),
  ]);

  const fallo = generos.error ?? mundos.error ?? lineas.error ?? nodos.error ?? equivalencias.error;
  if (fallo) return { estado: null, error: fallo };

  return {
    estado: {
      generos: generos.data ?? [],
      mundos: mundos.data ?? [],
      lineas: lineas.data,
      nodos: nodos.data,
      equivalencias: equivalencias.data,
    },
    error: null,
  };
}
