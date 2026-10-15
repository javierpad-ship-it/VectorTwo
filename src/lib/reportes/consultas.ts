import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { FilaUnidadesMensuales } from "./unidades-mensuales";

/**
 * Único archivo de `src/lib/reportes/` (y de `src/app/api/reportes/`) que nombra
 * funciones o tablas de la base. Solo lectura.
 */

type Db = SupabaseClient<Database>;

/**
 * Unidades y venta en soles por mes (solo cargas publicadas, orden cronológico)
 * agregadas en la base: la tabla de hechos tiene cientos de miles de filas y
 * PostgREST corta en 1 000. `equivalencias` nulo = todas; un arreglo = solo
 * esas (se envía en el cuerpo del POST del rpc, sin límite de URL).
 */
export async function leerUnidadesMensuales(db: Db, equivalencias: readonly string[] | null) {
  const { data, error } = await db.rpc(
    "unidades_mensuales",
    equivalencias === null ? {} : { p_equivalencias: [...equivalencias] }
  );
  const filas: FilaUnidadesMensuales[] = data ?? [];
  return { data: filas, error };
}
