import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { filaQuerySchema } from "@/lib/flujo/esquemas";
import { leerFilaDetalle } from "@/lib/flujo/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

/**
 * `GET /api/flujo/fila?gml_id&equivalencia_id&agrupacion_marca_id` (`requireUser`; solo lectura): el detalle de una fila con la
 * historia de doce meses (que la lista no trae), lo que va al barrer, los subflujos de M13, el resto, la conciliación y las entregas.
 * `404 fila_no_encontrada` si la fila no existe en el flujo de hoy.
 */
export async function GET(request: NextRequest) {
  const { perfil, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, filaQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerFilaDetalle(supabaseAdmin(), perfil.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
