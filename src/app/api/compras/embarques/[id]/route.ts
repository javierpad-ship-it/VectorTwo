import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarEmbarqueSchema } from "@/lib/compras/agrupadores/esquemas";
import { guardarEmbarque, leerEmbarque, usuarioDe } from "@/lib/compras/agrupadores/servicio";

const NO_ENCONTRADO = "No encontramos ese embarque.";

/** `GET /api/compras/embarques/[id]` (`requireUser`): el embarque con sus paquetes y todas sus asignaciones. `404 no_encontrado`. `{ embarque }`. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, NO_ENCONTRADO);
  if (t.respuesta) return t.respuesta;
  const r = await leerEmbarque(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return ok({ embarque: r.data });
}

/**
 * `PATCH /api/compras/embarques/[id]` (`requireUser`): edita todo menos la llegada estimada (que mueve entregas y va por `/fecha`: `409
 * fecha_por_movimiento`); la salida sí, y no mueve nada. Con `revision` (`409 agrupador_cambio`). `409` también: `salida_despues_de_llegada`,
 * `local_con_viaje`, `no_editable` (cancelado), `viaje_cancelado`. Respuesta `{ embarque }` con el detalle.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, NO_ENCONTRADO);
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, editarEmbarqueSchema);
  if (respuesta) return respuesta;
  const r = await guardarEmbarque(supabaseAdmin(), usuarioDe(perfil, rol), datos, t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
