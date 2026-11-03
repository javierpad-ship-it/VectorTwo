import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { revertirConfirmacionSchema } from "@/lib/aprobacion/esquemas";
import { revertirConfirmacion } from "@/lib/aprobacion/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; confirmacionId: string }> };

/**
 * Revierte una confirmación completa (`requirePlanner`, `POST`): un lote de reversión por cada tanda aprobada o reaprobada, con los `lote_ids` que genera el
 * navegador (uno por tanda). Responde un arreglo de resultados, uno por tanda; se detiene en el primer error. Con `simular` responde `200` sin escribir; si no, `201`.
 * `404` confirmación no encontrada; `400` si faltan identificadores de tanda; `409`: los de revertir un lote.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "confirmacionId"], "Confirmación no encontrada.");
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, revertirConfirmacionSchema);
  if (respuesta) return respuesta;
  const r = await revertirConfirmacion(s.valores.id, s.valores.confirmacionId, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, datos.simular || r.data.every((x) => x.repetido) ? 200 : 201);
}
