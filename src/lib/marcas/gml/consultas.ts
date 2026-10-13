import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { TANDA_IN, enTandas } from "@/lib/arbol/importar";
import { TAMANO_PAGINA, leerTodo } from "@/lib/arbol/consultas";
import type { FilaSugerenciaSql } from "./sugerencias";

/**
 * Lecturas y escrituras de las marcas relevantes por GML (02b, solo servidor).
 * ÚNICO archivo de `src/` que toca la tabla `marca_gml_especial` y que nombra
 * la función SQL de sugerencias (lo vigila un test estático). Todo lo que pueda crecer se lee con
 * `leerTodo`; las escrituras van en tandas (`upsert` de 500, `in (ids)` de 150).
 */

type Db = SupabaseClient<Database>;

export type AsignacionDb = Tables<"marca_gml_especial">;

/** Todas las asignaciones (incluidas las ignoradas; `activo = false` se filtra al armar la vista). */
export function leerAsignaciones(db: Db) {
  return leerTodo<AsignacionDb>((d, h) => db.from("marca_gml_especial").select("*").order("id").range(d, h));
}

export async function leerAsignacionPorId(db: Db, id: string) {
  const { data, error } = await db.from("marca_gml_especial").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/** El par marca × nodo, si existe (activo o no: el único no distingue). */
export async function leerAsignacionDePar(db: Db, marcaId: string, nodoId: string) {
  const { data, error } = await db
    .from("marca_gml_especial")
    .select("*")
    .eq("marca_id", marcaId)
    .eq("genero_mundo_linea_id", nodoId)
    .maybeSingle();
  return { data, error };
}

export async function insertarAsignacion(db: Db, fila: TablesInsert<"marca_gml_especial">) {
  const { data, error } = await db.from("marca_gml_especial").insert(fila).select("*").single();
  return { data, error };
}

export async function actualizarNotaAsignacion(db: Db, id: string, nota: string | null) {
  const { data, error } = await db.from("marca_gml_especial").update({ nota }).eq("id", id).select("*").single();
  return { data, error };
}

export async function borrarAsignacion(db: Db, id: string) {
  const { error } = await db.from("marca_gml_especial").delete().eq("id", id);
  return { error };
}

/** Cuántas asignaciones tiene una marca (lo que se llevará la cascada al eliminarla). */
export async function contarAsignacionesDeMarca(db: Db, marcaId: string) {
  const { count, error } = await db
    .from("marca_gml_especial")
    .select("id", { count: "exact", head: true })
    .eq("marca_id", marcaId);
  return { cuenta: count ?? 0, error };
}

/**
 * Inserta pares nuevos con `upsert … onConflict: "marca_id,genero_mundo_linea_id",
 * ignoreDuplicates` en tandas de 500 y cuenta lo REALMENTE insertado (un par
 * que otro usuario creó en medio se ignora). Sin transacción.
 */
export async function insertarAsignacionesSiNoExisten(
  db: Db,
  filas: readonly TablesInsert<"marca_gml_especial">[]
): Promise<{ insertadas: number; error: PostgrestError | null }> {
  let insertadas = 0;
  for (const tanda of enTandas([...filas], 500)) {
    const { data, error } = await db
      .from("marca_gml_especial")
      .upsert(tanda, { onConflict: "marca_id,genero_mundo_linea_id", ignoreDuplicates: true })
      .select("id");
    if (error) return { insertadas, error };
    insertadas += data?.length ?? 0;
  }
  return { insertadas, error: null };
}

/** Borra asignaciones por id, en tandas de 150, y cuenta las realmente borradas. */
export async function borrarAsignaciones(
  db: Db,
  ids: readonly string[]
): Promise<{ borradas: number; error: PostgrestError | null }> {
  let borradas = 0;
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { data, error } = await db.from("marca_gml_especial").delete().in("id", tanda).select("id");
    if (error) return { borradas, error };
    borradas += data?.length ?? 0;
  }
  return { borradas, error: null };
}

// ─── Función SQL de sugerencias ───

/**
 * Llama a la función SQL de sugerencias v2 (agrega la venta publicada entre
 * `desde` y `hasta`, primeros días de mes `aaaa-mm-01`, por GML, unidad de marca
 * y agrupación de la unidad). El orden por `medida`, la participación sobre el
 * total completo de la agrupación y los filtros `rango <= top` y `participacion
 * >= minParticipacion` se aplican DENTRO de SQL, así que devuelve pocas filas
 * (casi siempre una sola página). El `range` queda solo como red de seguridad si
 * alguna vez pasara de las 1000 filas que PostgREST entrega de una vez. Nunca
 * escribe.
 */
export async function sugerirMarcasRelevantes(
  db: Db,
  args: {
    desde: string;
    hasta: string;
    top: number;
    excluir: readonly string[];
    medida: "venta_soles" | "unidades";
    minParticipacion: number;
  }
): Promise<{ data: FilaSugerenciaSql[]; error: PostgrestError | null }> {
  const todas: FilaSugerenciaSql[] = [];
  for (let n = 0; ; n++) {
    const { data, error } = await db
      .rpc("sugerir_marcas_relevantes_v2", {
        p_desde: args.desde,
        p_hasta: args.hasta,
        p_top: args.top,
        p_excluir: [...args.excluir],
        p_medida: args.medida,
        p_min_participacion: args.minParticipacion,
      })
      .range(n * TAMANO_PAGINA, (n + 1) * TAMANO_PAGINA - 1);
    if (error) return { data: todas, error };
    const filas = data ?? [];
    todas.push(...filas);
    if (filas.length < TAMANO_PAGINA) return { data: todas, error: null };
  }
}
