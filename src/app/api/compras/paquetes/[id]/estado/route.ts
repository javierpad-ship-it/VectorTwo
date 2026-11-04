import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { cambiarEstadoSchema } from "@/lib/compras/agrupadores/esquemas";
import { cancelarPaquete, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/paquetes/[id]/estado` (`requirePlanner`: cancelar es irreversible y solo lo hacen admin y planner): `{ revision,
 * accion: "cancelar", motivo }`, con la `revision` del EMBARQUE del paquete. `409`: `tiene_asignaciones_activas`, `motivo_requerido`,
 * `transicion_invalida`, `agrupador_cambio`. Respuesta `{ embarque }` con el detalle del embarque del paquete.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese paquete.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cambiarEstadoSchema);
  if (respuesta) return respuesta;
  const r = await cancelarPaquete(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
