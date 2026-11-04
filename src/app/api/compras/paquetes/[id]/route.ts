import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { guardarPaqueteSchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarPaquete, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `PATCH /api/compras/paquetes/[id]` (`requireUser`): edita nombre, responsable y nota de un paquete (guardar_paquete; el código no cambia).
 * La `revision_embarque` es la de su embarque. `409`: `agrupador_cambio`, `embarque_no_editable`, `no_editable` (paquete cancelado),
 * `responsable_no_asignable`. Respuesta `{ embarque }` con el detalle del embarque del paquete.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese paquete.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, guardarPaqueteSchema);
  if (respuesta) return respuesta;
  const r = await guardarPaquete(supabaseAdmin(), usuarioDe(perfil, rol), { paquete_id: t.id }, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
