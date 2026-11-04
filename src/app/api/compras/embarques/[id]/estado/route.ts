import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { cambiarEstadoSchema } from "@/lib/compras/agrupadores/esquemas";
import { puedeCambiarEstado } from "@/lib/compras/agrupadores/permisos";
import { cambiarEstadoEmbarque, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/estado`: `{ revision, accion: en_transito | volver_a_planificado | cancelar, motivo? }`. Pasar a en
 * tránsito o volver a planificado son de los tres roles (`requireUser`); CANCELAR, solo admin y planner: la acción viene en el cuerpo, así
 * que el guard es `requireUser` y el comprador que pide cancelar recibe `403` antes de tocar nada. Cancelar exige motivo, sin asignaciones
 * activas ni ingresos confirmados. `409`: `transicion_invalida`, `tiene_asignaciones_activas`, `tiene_recepciones`, `motivo_requerido`,
 * `agrupador_cambio`. Respuesta `{ embarque }` con el detalle.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cambiarEstadoSchema);
  if (respuesta) return respuesta;
  if (!puedeCambiarEstado(rol, datos.accion)) return error("Tu rol no puede hacer ese cambio: lo hacen el administrador o el planner.", 403);
  const r = await cambiarEstadoEmbarque(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
