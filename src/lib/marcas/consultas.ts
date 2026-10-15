import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { TANDA_IN, enTandas } from "@/lib/arbol/importar";
import { leerTodo } from "@/lib/arbol/consultas";
import type { EstadoImportacionMarcas } from "./importar";
import type { AsignacionConjunto, CabezaNueva } from "./conjuntos/importar";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { MarcaLeida } from "./filas";

export type { MarcaLeida };

/**
 * Lecturas y escrituras compartidas de M2 (solo servidor): ÚNICO archivo de
 * `src/lib` que escribe la tabla `marcas` desde el módulo de conjuntos y de
 * marcas relevantes (02b). Como en el árbol, todo lo que pueda crecer se lee
 * con `leerTodo` (PostgREST corta en 1000 filas).
 */

type Db = SupabaseClient<Database>;

/** `select` de una marca con su agrupación embebida; lo usan GET, POST y PATCH de `/api/marcas`. */
export const SELECT_MARCA_CON_AGRUPACION = "*, agrupacion_marca:agrupaciones_marca(id, codigo, nombre, orden, activo)";

/** Todas las marcas (activas e inactivas) con su agrupación embebida y orden estable. */
export function leerMarcasConAgrupacion(db: Db) {
  return leerTodo<MarcaLeida>((d, h) =>
    db.from("marcas").select(SELECT_MARCA_CON_AGRUPACION).order("nombre").order("id").range(d, h)
  );
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

/** Una marca por id (con `*`), o `null`. */
export async function leerMarcaPorId(db: Db, id: string) {
  const { data, error } = await db.from("marcas").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/**
 * 02b: deja marcadas en `por_gml` las marcas dadas (`tratamiento_especial = true`,
 * `modalidad_tratamiento = 'por_gml'`; la nota de tratamiento no se toca), por
 * tandas. Es lo que pasa al hacerlas relevantes en un GML.
 */
export async function marcarPorGml(db: Db, ids: readonly string[]): Promise<{ error: PostgrestError | null }> {
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { error } = await db
      .from("marcas")
      .update({ tratamiento_especial: true, modalidad_tratamiento: "por_gml" })
      .in("id", tanda);
    if (error) return { error };
  }
  return { error: null };
}

/** 02b: fija `conjunto_marca_id` (la cabeza o `null` para salir del conjunto) en las marcas dadas, por tandas. */
export async function fijarConjunto(
  db: Db,
  ids: readonly string[],
  cabezaId: string | null
): Promise<{ escritas: number; error: PostgrestError | null }> {
  let escritas = 0;
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { data, error } = await db
      .from("marcas")
      .update({ conjunto_marca_id: cabezaId })
      .in("id", tanda)
      .select("id");
    if (error) return { escritas, error };
    escritas += data?.length ?? 0;
  }
  return { escritas, error: null };
}

/** Cuántas marcas tienen a esta como cabeza (conteo por el índice de `conjunto_marca_id`). */
export async function contarMiembros(db: Db, cabezaId: string) {
  const { count, error } = await db
    .from("marcas")
    .select("id", { count: "exact", head: true })
    .eq("conjunto_marca_id", cabezaId);
  return { cuenta: count ?? 0, error };
}

export type ResultadoEscrituraConjuntos = { cabezas_creadas: number; asignadas: number };

/**
 * Escribe lo que planificaron los importadores de conjuntos (de la hoja
 * `MARCA, CONJUNTO` y de la columna `CONJUNTO` de marcas): inserta las cabezas
 * nuevas (`upsert … onConflict: "nombre", ignoreDuplicates`, tandas de 500),
 * resuelve por nombre los ids que todavía no existían (marcas nuevas y cabezas
 * nuevas) y fija `conjunto_marca_id` agrupando por cabeza (`update … in (ids)`,
 * tandas de 150). Sin transacción: idempotente, repetir completa lo que faltó.
 */
export async function escribirConjuntos(
  db: Db,
  cabezasNuevas: readonly CabezaNueva[],
  asignaciones: readonly AsignacionConjunto[]
): Promise<{ resultado: ResultadoEscrituraConjuntos; error: PostgrestError | null }> {
  const resultado: ResultadoEscrituraConjuntos = { cabezas_creadas: 0, asignadas: 0 };

  for (const tanda of enTandas([...cabezasNuevas], 500)) {
    const filas = tanda.map((c) => ({
      nombre: c.nombre,
      codigo: c.codigo,
      agrupacion_marca_id: c.agrupacion_marca_id,
      tratamiento_especial: false,
    }));
    const { data, error } = await db
      .from("marcas")
      .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
      .select("id");
    if (error) return { resultado, error };
    resultado.cabezas_creadas += data?.length ?? 0;
  }

  let idPorNombre: Map<string, string> | null = null;
  if (asignaciones.some((a) => a.marca_id === null || a.cabeza_id === null)) {
    const leidas = await leerTodo<Pick<Tables<"marcas">, "id" | "nombre">>((d, h) =>
      db.from("marcas").select("id, nombre").order("id").range(d, h)
    );
    if (leidas.error) return { resultado, error: leidas.error };
    idPorNombre = new Map(leidas.data.map((m) => [normalizarNombre(m.nombre), m.id]));
  }

  const porCabeza = new Map<string, string[]>();
  for (const a of asignaciones) {
    const marcaId = a.marca_id ?? idPorNombre?.get(normalizarNombre(a.marca_nombre));
    const cabezaId = a.cabeza_id ?? idPorNombre?.get(normalizarNombre(a.cabeza_nombre));
    if (!marcaId || !cabezaId) continue;
    const lista = porCabeza.get(cabezaId) ?? [];
    lista.push(marcaId);
    porCabeza.set(cabezaId, lista);
  }
  for (const [cabezaId, ids] of porCabeza) {
    const { escritas, error } = await fijarConjunto(db, ids, cabezaId);
    resultado.asignadas += escritas;
    if (error) return { resultado, error };
  }
  return { resultado, error: null };
}
