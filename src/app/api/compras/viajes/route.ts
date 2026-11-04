import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { guardarViajeSchema, viajesQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarViaje, listarViajes, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `GET /api/compras/viajes` (`requireUser`; los tres roles): todos los viajes con sus totales y los responsables posibles (comprador o admin
 * activos). Filtros opcionales: `?estado&responsable_id&mio=1&q` («Mis viajes» es un filtro, nunca un permiso). Respuesta
 * `{ viajes, asignables }`.
 */
export async function GET(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = leerConsulta(request, viajesQuerySchema);
  if (respuesta) return respuesta;
  const r = await listarViajes(supabaseAdmin(), usuarioDe(perfil, rol), datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `POST /api/compras/viajes` (`requireUser`: el comprador crea viajes, decisión 92): crea un viaje (guardar_viaje). Sin `codigo`, se numera
 * `aamm##` con el mes de `fecha_inicio`. Respuesta `{ viaje }` (201). `409`: `codigo_duplicado`, `codigo_invalido`, `correlativo_agotado`,
 * `responsable_no_asignable` (el planner no puede ser responsable).
 */
export async function POST(request: NextRequest) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, guardarViajeSchema);
  if (respuesta) return respuesta;
  const r = await guardarViaje(supabaseAdmin(), usuarioDe(perfil, rol), datos, null);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
