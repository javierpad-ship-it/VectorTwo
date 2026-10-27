import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { flujoQuerySchema } from "@/lib/flujo/esquemas";
import { leerHuecos } from "@/lib/flujo/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

/**
 * `GET /api/flujo/huecos` (`requireUser`; solo lectura): una tarjeta por fila, ordenadas por saldo descendente, con el saldo de los
 * próximos `?meses=` (por defecto, los de Parámetros). Siempre trae `datos` completos, también con `meses=1`. Mismos filtros que el
 * flujo (la pantalla filtra en el navegador y solo manda `meses`).
 */
export async function GET(request: NextRequest) {
  const { perfil, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, flujoQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerHuecos(supabaseAdmin(), perfil.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
