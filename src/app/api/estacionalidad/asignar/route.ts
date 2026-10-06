import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { enTandas } from "@/lib/arbol/importar";
import { asignarSchema } from "@/lib/estacionalidad/esquemas";
import {
  motivoRechazoAsignacion,
  planificarAsignacion,
  statusRechazoAsignacion,
  type EquivalenciaAsignable,
} from "@/lib/estacionalidad/reglas";
import type { ResultadoAsignacion } from "@/lib/estacionalidad/tipos";

/**
 * Asignación masiva (`requirePlanner`): pone `agrupacion_id` (o `null` para
 * quitarla) en todas las `equivalencia_ids`. `404` si la agrupación no existe,
 * `409` si está inactiva. Los ids de equivalencia que no existan van en
 * `no_encontradas` y no abortan; se asigna también a equivalencias inactivas.
 * Sin transacción: si una tanda falla, `500`, y repetir la misma asignación
 * completa el resto (es idempotente).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, asignarSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();

  if (datos.agrupacion_id !== null) {
    const { data: agrupacion, error: errAgrupacion } = await db
      .from("agrupaciones_estacionalidad")
      .select("id, nombre, activo")
      .eq("id", datos.agrupacion_id)
      .maybeSingle();
    if (errAgrupacion) return traducirErrorDb(errAgrupacion, "asignar: buscar agrupación");
    const motivo = motivoRechazoAsignacion(agrupacion, false);
    if (motivo) return error(motivo, statusRechazoAsignacion(motivo));
  }

  const ids = [...new Set(datos.equivalencia_ids)];
  const encontradas: EquivalenciaAsignable[] = [];
  for (const tanda of enTandas(ids)) {
    const { data, error: err } = await db
      .from("equivalencias")
      .select("id, agrupacion_estacionalidad_id")
      .in("id", tanda);
    if (err) return traducirErrorDb(err, "asignar: leer equivalencias");
    encontradas.push(...(data ?? []));
  }

  const plan = planificarAsignacion(ids, encontradas, datos.agrupacion_id);

  let asignadas = 0;
  for (const tanda of enTandas(plan.a_asignar)) {
    const { data, error: err } = await db
      .from("equivalencias")
      .update({ agrupacion_estacionalidad_id: datos.agrupacion_id })
      .in("id", tanda)
      .select("id");
    if (err) return traducirErrorDb(err, "asignar: escribir equivalencias");
    asignadas += data?.length ?? 0;
  }

  const resultado: ResultadoAsignacion = {
    asignadas,
    sin_cambio: plan.sin_cambio,
    no_encontradas: plan.no_encontradas,
  };
  return ok(resultado);
}
