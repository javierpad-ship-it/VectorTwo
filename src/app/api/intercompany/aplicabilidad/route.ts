import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { aplicabilidadQuerySchema } from "@/lib/intercompany/esquemas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { leerAplicabilidad } from "@/lib/intercompany/servicio";

/**
 * Si una regla de `?marca_id=` en `?genero_mundo_linea_id=` sería aplicable con la proyección cerrada de hoy (`requirePlanner`, solo
 * lectura: M13). Sirve para el aviso amarillo de la pantalla ANTES de guardar; no bloquea nada. `404` marca o nodo.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, aplicabilidadQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerAplicabilidad(supabaseAdmin(), datos.marca_id, datos.genero_mundo_linea_id, datos.mes);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
