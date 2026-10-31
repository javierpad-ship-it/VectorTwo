import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerEvaluacionApi } from "@/lib/ia/servicio-evaluacion";

type Params = { params: Promise<{ id: string }> };

/** Una evaluación con sus `resultados` y `veredicto` (`requireAdmin`). `404` si no existe. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Evaluación no encontrada.");
  if (respuesta) return respuesta;
  const r = await leerEvaluacionApi(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
