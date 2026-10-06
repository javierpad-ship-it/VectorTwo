import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
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

/** La tabla completa (activas e inactivas) para el importador. */
export async function cargarEstadoTiendas(
  db: Db
): Promise<{ estado: EstadoImportacionTiendas; error: null } | { estado: null; error: PostgrestError }> {
  const { data, error } = await leerTiendas(db, { soloActivas: false });
  if (error) return { estado: null, error };
  return { estado: { tiendas: data }, error: null };
}
