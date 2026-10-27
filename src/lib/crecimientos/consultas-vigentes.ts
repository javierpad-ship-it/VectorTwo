import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import type { VigenteCrecimiento } from "./vigentes";

/**
 * Lectura de los crecimientos aprobados vigentes (ficha 06d §3.1). Junto con `consultas.ts` es el ÚNICO archivo de `src/` que nombra
 * `crecimientos_genero_mundo` y `venta_genero_mundo`. Solo servidor.
 */

type Db = SupabaseClient<Database>;

const COLUMNAS = "id,anio_aplicacion,alcance,genero_id,mundo_id,version,pct,usuario_nombre,aprobada_at";

/**
 * Las versiones vigentes de varios años en una sola lectura (M6). Orden estable por año, alcance, género, mundo e id. Sin años, no
 * lee nada. Los `numeric` de la base llegan como número desde PostgREST; se normalizan igual.
 */
export async function leerVigentes(db: Db, anios: readonly number[]): Promise<{ data: VigenteCrecimiento[]; error: PostgrestError | null }> {
  const distintos = [...new Set(anios)].sort((a, b) => a - b);
  if (distintos.length === 0) return { data: [], error: null };
  const r = await leerTodo((d, h) =>
    db
      .from("crecimientos_genero_mundo")
      .select(COLUMNAS)
      .eq("estado", "vigente")
      .in("anio_aplicacion", distintos)
      .order("anio_aplicacion")
      .order("alcance")
      .order("genero_id", { nullsFirst: true })
      .order("mundo_id", { nullsFirst: true })
      .order("id")
      .range(d, h)
  );
  return { data: r.data.map((f) => ({ ...f, pct: Number(f.pct) })), error: r.error };
}
