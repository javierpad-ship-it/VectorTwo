import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { guardarPaqueteSchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarPaquete, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/paquetes` (`requireUser`): crea un paquete del embarque (guardar_paquete). La `revision_embarque` es la
 * del embarque (su revisión cubre a sus paquetes). Sin `codigo` se numera con el mes de llegada del embarque. `409`: `agrupador_cambio`,
 * `codigo_duplicado`, `embarque_no_editable` (cancelado o recibido), `responsable_no_asignable`. Respuesta `{ embarque }` con el detalle (201).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, guardarPaqueteSchema);
  if (respuesta) return respuesta;
  const r = await guardarPaquete(supabaseAdmin(), usuarioDe(perfil, rol), { embarque_id: t.id }, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
