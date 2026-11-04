import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { cambiarEstadoSchema } from "@/lib/compras/agrupadores/esquemas";
import { cambiarEstadoViaje, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/viajes/[id]/estado` (`requirePlanner`: cerrar, reabrir y cancelar un viaje son de admin y planner; el comprador
 * recibe `403`, decisión 95): `{ revision, accion: cerrar | reabrir | cancelar, motivo? }`. Cancelar exige motivo y que no queden compras
 * ni embarques sin cancelar. `409`: `transicion_invalida`, `tiene_compras`, `motivo_requerido`, `agrupador_cambio`. Respuesta `{ viaje }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese viaje.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cambiarEstadoSchema);
  if (respuesta) return respuesta;
  const r = await cambiarEstadoViaje(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
