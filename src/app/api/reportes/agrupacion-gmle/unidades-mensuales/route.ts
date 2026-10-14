import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerUnidadesMensuales } from "@/lib/reportes/consultas";
import { unidadesMensualesSchema } from "@/lib/reportes/esquemas";
import { armarUnidadesMensuales, UNIDADES_MENSUALES_VACIAS } from "@/lib/reportes/unidades-mensuales";
import type { UnidadesMensuales } from "@/lib/reportes/tipos-unidades";

/**
 * Unidades vendidas por mes para el histograma del Resumen del reporte (M11,
 * `requirePlanner`). Es POST porque la lista de equivalencias que dejan pasar
 * los filtros puede tener miles de ids; no escribe nada. La base suma por mes
 * (~45 filas). Sin `equivalencia_ids` = todas; con `[]` responde vacío sin
 * consultar.
 */
export async function POST(request: Request) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, unidadesMensualesSchema);
  if (respuesta) return respuesta;

  const ids = datos.equivalencia_ids ?? null;
  if (ids !== null && ids.length === 0) return ok<UnidadesMensuales>(UNIDADES_MENSUALES_VACIAS);

  const { data, error: err } = await leerUnidadesMensuales(supabaseAdmin(), ids);
  if (err) return traducirErrorDb(err, "reportes: unidades mensuales");

  try {
    return ok<UnidadesMensuales>(armarUnidadesMensuales(data, ids === null ? null : ids.length));
  } catch (e) {
    console.error("[reportes] unidades mensuales: respuesta inesperada de la base", e);
    return error("No se pudieron leer las unidades por mes. Inténtalo de nuevo.", 500);
  }
}
