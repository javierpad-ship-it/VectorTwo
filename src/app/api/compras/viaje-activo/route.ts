import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { viajeActivoSchema } from "@/lib/compras/agrupadores/esquemas";
import { validarViajeActivoSolicitado } from "@/lib/compras/agrupadores/servicio";
import { COOKIE_VIAJE_ACTIVO, OPCIONES_COOKIE_VIAJE_ACTIVO } from "@/lib/compras/agrupadores/viaje-activo";

/**
 * `PUT /api/compras/viaje-activo` (`requireUser`): guarda el viaje activo de este NAVEGADOR en la cookie `v2_viaje_activo` (un año, `path=/`,
 * `lax`, sin `httpOnly`: no es secreta). `viaje_id` es un uuid de un viaje existente no cancelado (`404 no_encontrado` si no), `todos` o
 * `sin_viaje`. Es una preferencia: ninguna ruta de la API la lee (reciben `viaje_id` explícito) y no da ni quita permisos (R22).
 * Respuesta `{ viaje_activo }`.
 */
export async function PUT(request: NextRequest) {
  const { response } = await requireUser();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, viajeActivoSchema);
  if (respuesta) return respuesta;
  const v = await validarViajeActivoSolicitado(supabaseAdmin(), datos);
  if (v.respuesta) return v.respuesta;
  const r = ok({ viaje_activo: v.data });
  r.cookies.set(COOKIE_VIAJE_ACTIVO, v.data, { ...OPCIONES_COOKIE_VIAJE_ACTIVO, secure: process.env.NODE_ENV === "production" });
  return r;
}
