import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { historialQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { leerHistorial } from "@/lib/compras/agrupadores/servicio";

/**
 * `GET /api/compras/agrupadores/historial?viaje_id|embarque_id|paquete_id` (`requireUser`; exactamente uno): los eventos del agrupador, del
 * más antiguo al más reciente (quién, cuándo, qué y el motivo). El historial de un embarque incluye el de sus paquetes. `404` si no
 * existe. Respuesta `{ eventos }`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, historialQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerHistorial(supabaseAdmin(), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
