import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarViajeSchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarViaje, leerViaje, usuarioDe } from "@/lib/compras/agrupadores/servicio";

const NO_ENCONTRADO = "No encontramos ese viaje.";

/**
 * `GET /api/compras/viajes/[id]` (`requireUser`): el viaje, sus compras (no canceladas) y sus embarques. `404 no_encontrado`.
 * Respuesta `{ viaje, compras, embarques }`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, NO_ENCONTRADO);
  if (t.respuesta) return t.respuesta;
  const r = await leerViaje(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `PATCH /api/compras/viajes/[id]` (`requireUser`: también un viaje cerrado; uno cancelado no, `409 no_editable`): edita el viaje con su
 * `revision` (`409 agrupador_cambio` si ya no es la vigente). El código no cambia. Respuesta `{ viaje }`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, NO_ENCONTRADO);
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, editarViajeSchema);
  if (respuesta) return respuesta;
  const r = await guardarViaje(supabaseAdmin(), usuarioDe(perfil, rol), datos, t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
