import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { vigentesQuerySchema } from "@/lib/intercompany/esquemas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { leerVigentes } from "@/lib/intercompany/servicio";

/**
 * Contrato de M8 (`requirePlanner`, solo lectura): `{ reglas, marcas }` con todas las reglas activas y su `hasta_derivado`, o solo las
 * que rigen en algún mes de `?desde=aaaa-mm&hasta=aaaa-mm`. NO evalúa `aplicable` (llega `null`): M8 ya tiene la cerrada. M8 lo
 * incluye en su propia respuesta porque el comprador no puede llamar aquí.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, vigentesQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerVigentes(supabaseAdmin(), datos.desde, datos.hasta);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
