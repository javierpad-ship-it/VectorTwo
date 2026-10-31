import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { pasoVacioSchema, pliegueRutaSchema } from "@/lib/ia/esquemas";
import { prepararPliegue } from "@/lib/ia/servicio-evaluacion";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; pliegue: string }> };

/** Armar la proyección de un pliegue en memoria tarda unos treinta segundos. */
export const maxDuration = 300;

/**
 * Prepara un pliegue sin llamar al proveedor (`requireAdmin`): arma en memoria la proyección con los datos hasta el corte, guarda los bloques de cada GM
 * en `ia_entradas` y la referencia (método, tendencia y real) en `ia_corrida_gms`. Idempotente. `200 { gms }`. `409`: `evaluacion_terminada`,
 * `sin_datos_pliegue`, `pliegue_sin_preparar` (E25 antes que D25).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requireAdmin();
  if (response) return response;

  const s = await leerSegmentos(params, ["id"], "Evaluación no encontrada.");
  if (s.respuesta) return s.respuesta;
  const pliegue = pliegueRutaSchema.safeParse((await params).pliegue);
  if (!pliegue.success) return error("Ese pliegue no existe.", 404);
  const { respuesta } = await leerCuerpo(request, pasoVacioSchema);
  if (respuesta) return respuesta;
  const r = await prepararPliegue(s.valores.id, pliegue.data);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
