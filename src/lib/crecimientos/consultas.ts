import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import type { MarcasArbol } from "./huellas";
import { comoVentaGeneroMundo, type VentaGeneroMundo } from "./series";

/**
 * Acceso a datos de 06d (solo servidor). Junto con `consultas-vigentes.ts` es el ÚNICO archivo de `src/` que nombra
 * `crecimientos_genero_mundo` y `venta_genero_mundo`. La venta se lee SOLO con la función `jsonb` (un solo estado de los datos; las
 * series superan el corte de 1 000 filas de PostgREST). Lo de M7 (proyecciones, filas, foto) se lee con `proyeccion/consultas.ts`.
 */

type Db = SupabaseClient<Database>;

export type VersionDb = Tables<"crecimientos_genero_mundo">;

/** `venta_genero_mundo(p_desde)`; `data` es `null` con error o con una respuesta que no tiene la forma esperada. */
export async function leerVentaGeneroMundo(db: Db, desde: string): Promise<{ data: VentaGeneroMundo | null; error: PostgrestError | null }> {
  const { data, error } = await db.rpc("venta_genero_mundo", { p_desde: desde });
  if (error) return { data: null, error };
  return { data: comoVentaGeneroMundo(data), error: null };
}

/**
 * Las tres marcas de tiempo de la clave de la caché (M1): `max(updated_at)` de `genero_mundo_linea`, de `equivalencias` y de
 * `agrupaciones_estacionalidad`; tres lecturas de una fila cada una.
 */
export async function leerMarcasArbol(db: Db): Promise<{ data: MarcasArbol; error: PostgrestError | null }> {
  const [nodos, equivalencias, agrupaciones] = await Promise.all([
    db.from("genero_mundo_linea").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    db.from("equivalencias").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    db.from("agrupaciones_estacionalidad").select("updated_at").order("updated_at", { ascending: false }).limit(1),
  ]);
  const marca = (r: { data: { updated_at: string }[] | null }) => r.data?.[0]?.updated_at ?? "";
  return {
    data: { nodos: marca(nodos), equivalencias: marca(equivalencias), agrupaciones: marca(agrupaciones) },
    error: nodos.error ?? equivalencias.error ?? agrupaciones.error,
  };
}

/** Todas las versiones de un año de aplicación (cualquier estado), en orden estable. */
export function leerVersionesDeAnio(db: Db, anio: number) {
  return leerTodo<VersionDb>((d, h) =>
    db
      .from("crecimientos_genero_mundo")
      .select("*")
      .eq("anio_aplicacion", anio)
      .order("alcance")
      .order("genero_id", { nullsFirst: true })
      .order("mundo_id", { nullsFirst: true })
      .order("version")
      .order("id")
      .range(d, h)
  );
}

/** Pasa la vigente a `reemplazada` solo si sigue vigente; `data` es `null` si otra persona la movió antes. */
export async function reemplazarVigente(db: Db, id: string) {
  const { data, error } = await db.from("crecimientos_genero_mundo").update({ estado: "reemplazada" }).eq("id", id).eq("estado", "vigente").select("id").maybeSingle();
  return { data, error };
}

/** Deshace `reemplazarVigente` (si el alta de la versión nueva falla). */
export async function restaurarVigente(db: Db, id: string) {
  const { error } = await db.from("crecimientos_genero_mundo").update({ estado: "vigente" }).eq("id", id).eq("estado", "reemplazada");
  return { error };
}

export async function insertarVersion(db: Db, fila: TablesInsert<"crecimientos_genero_mundo">) {
  return db.from("crecimientos_genero_mundo").insert(fila).select("*").single();
}
