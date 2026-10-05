import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import type { EstadoImportacionMarcas } from "./importar";
import { marcaVigente } from "./reglas";
import type { AgrupacionMarcaEmbebida, MarcaFila } from "./tipos";

/**
 * Lecturas compartidas de M2 (solo servidor). Como en el árbol, todo lo que
 * pueda crecer se lee con `leerTodo` (PostgREST corta en 1000 filas).
 */

type Db = SupabaseClient<Database>;

/** `select` de una marca con su agrupación embebida; lo usan GET, POST y PATCH de `/api/marcas`. */
export const SELECT_MARCA_CON_AGRUPACION = "*, agrupacion_marca:agrupaciones_marca(id, codigo, nombre, orden, activo)";

/** Fila de `marcas` con la agrupación embebida, tal como la devuelve `SELECT_MARCA_CON_AGRUPACION`. */
export type MarcaLeida = Omit<MarcaFila, "agrupacion_marca" | "vigente"> & {
  agrupacion_marca: AgrupacionMarcaEmbebida | null;
};

/** Anexa `vigente` (= `activo ∧ agrupacion.activo`). La FK es `not null`, así que la agrupación siempre viene. */
export function aMarcaFila(m: MarcaLeida): MarcaFila {
  const agrupacion = m.agrupacion_marca ?? { id: m.agrupacion_marca_id, codigo: "", nombre: "", orden: 0, activo: false };
  return { ...m, agrupacion_marca: agrupacion, vigente: marcaVigente(m, agrupacion) };
}

export function leerAgrupacionesMarca(db: Db) {
  return leerTodo<Tables<"agrupaciones_marca">>((d, h) =>
    db.from("agrupaciones_marca").select("*").order("orden").order("nombre").order("id").range(d, h)
  );
}

export function leerMarcas(db: Db) {
  return leerTodo<Tables<"marcas">>((d, h) => db.from("marcas").select("*").order("id").range(d, h));
}

/** Las dos tablas completas (activas e inactivas) para el importador. */
export async function cargarEstadoMarcas(
  db: Db
): Promise<{ estado: EstadoImportacionMarcas; error: null } | { estado: null; error: PostgrestError }> {
  const [agrupaciones, marcas] = await Promise.all([leerAgrupacionesMarca(db), leerMarcas(db)]);
  const fallo = agrupaciones.error ?? marcas.error;
  if (fallo) return { estado: null, error: fallo };
  return { estado: { agrupaciones: agrupaciones.data, marcas: marcas.data }, error: null };
}
