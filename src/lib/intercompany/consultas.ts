import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { TANDA_IN, enTandas } from "@/lib/arbol/importar";

/**
 * Acceso a datos de M13 (solo servidor). ÚNICO archivo de `src/` que nombra la tabla `intercompany_reglas` (ficha 13, sección 7;
 * la vista `intercompany_vigente` no se lee: `hasta_derivado` se calcula en TypeScript con `hastaDerivado`, que es lo que prueba
 * la ficha). Las reglas son decenas de filas, pero se leen igual con `leerTodo` (PostgREST corta en 1000). Los handlers abren el
 * cliente con `supabaseAdmin()` y lo pasan.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type ReglaDb = Tables<"intercompany_reglas">;

/** Todas las reglas ACTIVAS, en orden estable (clave y luego `vigente_desde`; `id` desempata). `activo = false` se lee como ausente. */
export function leerReglasIntercompany(db: Db): Promise<Resultado<ReglaDb[]>> {
  return leerTodo<ReglaDb>((d, h) =>
    db
      .from("intercompany_reglas")
      .select("*")
      .eq("activo", true)
      .order("marca_id")
      .order("genero_mundo_linea_id")
      .order("equivalencia_id", { nullsFirst: true })
      .order("vigente_desde")
      .order("id")
      .range(d, h)
  );
}

/** Una regla activa por id, o `null`. */
export async function leerReglaPorId(db: Db, id: string): Promise<Resultado<ReglaDb | null>> {
  const { data, error } = await db.from("intercompany_reglas").select("*").eq("id", id).eq("activo", true).maybeSingle();
  return { data: data ?? null, error };
}

export type NuevaRegla = Omit<TablesInsert<"intercompany_reglas">, "id" | "created_at" | "updated_at" | "activo">;

export async function insertarRegla(db: Db, fila: NuevaRegla): Promise<Resultado<ReglaDb | null>> {
  const { data, error } = await db.from("intercompany_reglas").insert(fila).select("*").single();
  return { data: data ?? null, error };
}

export type CambiosRegla = Pick<TablesUpdate<"intercompany_reglas">, "cobertura_min_meses" | "cobertura_max_meses" | "pct_directo" | "nota" | "perfil_id" | "usuario_nombre">;

/** Actualiza una regla activa; `null` si ya no existe (la borró otra persona). */
export async function actualizarRegla(db: Db, id: string, cambios: CambiosRegla): Promise<Resultado<ReglaDb | null>> {
  const { data, error } = await db.from("intercompany_reglas").update(cambios).eq("id", id).eq("activo", true).select("*").maybeSingle();
  return { data: data ?? null, error };
}

/** Borra la fila (eliminar una regla no deja rastro: la anterior de la clave vuelve a regir). */
export async function eliminarReglaDb(db: Db, id: string): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from("intercompany_reglas").delete().eq("id", id);
  return { error };
}

export type EquivalenciaMinima = Pick<Tables<"equivalencias">, "id" | "genero_mundo_linea_id" | "nombre">;

/** Una equivalencia por id (para validar que pertenece al nodo), o `null`. */
export async function leerEquivalencia(db: Db, id: string): Promise<Resultado<(EquivalenciaMinima & Pick<Tables<"equivalencias">, "activo"> ) | null>> {
  const { data, error } = await db.from("equivalencias").select("id, genero_mundo_linea_id, nombre, activo").eq("id", id).maybeSingle();
  return { data: data ?? null, error };
}

/** Los nombres de las equivalencias pedidas (por tandas de ids: viajan en la URL). */
export async function leerEquivalenciasPorIds(db: Db, ids: readonly string[]): Promise<Resultado<EquivalenciaMinima[]>> {
  const filas: EquivalenciaMinima[] = [];
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const r = await leerTodo<EquivalenciaMinima>((d, h) =>
      db.from("equivalencias").select("id, genero_mundo_linea_id, nombre").in("id", tanda).order("id").range(d, h)
    );
    if (r.error) return { data: filas, error: r.error };
    filas.push(...r.data);
  }
  return { data: filas, error: null };
}
