import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { cancelarEvaluacion } from "@/lib/ia/servicio-evaluacion";

type Params = { params: Promise<{ id: string }> };

/** Cancela una evaluación en curso (`requireAdmin`); una terminal se devuelve como está. Queda registrada: ninguna evaluación se borra. */
export async function POST(_request: NextRequest, { params }: Params) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Evaluación no encontrada.");
  if (respuesta) return respuesta;
  const r = await cancelarEvaluacion(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
