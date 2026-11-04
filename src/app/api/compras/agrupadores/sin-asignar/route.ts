import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { sinAsignarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { leerSinAsignar } from "@/lib/compras/agrupadores/servicio";

/**
 * `GET /api/compras/agrupadores/sin-asignar` (`requireUser`): las entregas con unidades sin embarque (compras en borrador o confirmadas) y
 * las compras sin viaje. Filtros: `?viaje_id=<uuid>|sin_viaje&proveedor_id&desde&hasta&q`. Con `viaje_id`, las entregas son las de ese viaje;
 * las compras sin viaje se devuelven siempre. Respuesta `{ entregas, compras_sin_viaje }`.
 */
export async function GET(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, sinAsignarQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerSinAsignar(supabaseAdmin(), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
