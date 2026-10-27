import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { conciliacionQuerySchema } from "@/lib/flujo/esquemas";
import { leerConciliacion } from "@/lib/flujo/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

/**
 * `GET /api/flujo/conciliacion?periodo=aaaa-mm&genero_id&mundo_id&linea_id&solo&mio=1` (`requireUser`; NUNCA escribe): para un mes
 * cerrado, el ingreso inferido del inventario frente a las recepciones y entregas registradas, con las sugerencias de «Aceptar
 * sugerencia». Sin `periodo`, el último mes publicado. `404 sin_mes` si el periodo no está publicado (o no es de los doce últimos).
 */
export async function GET(request: NextRequest) {
  const { perfil, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, conciliacionQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerConciliacion(supabaseAdmin(), perfil.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
