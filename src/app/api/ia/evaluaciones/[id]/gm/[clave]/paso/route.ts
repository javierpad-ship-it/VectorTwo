import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { pasoEvaluacionSchema } from "@/lib/ia/esquemas";
import { pasoEvaluacion } from "@/lib/ia/servicio-evaluacion";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; clave: string }> };

/** Una llamada al proveedor puede tardar hasta cuatro minutos. */
export const maxDuration = 300;

/**
 * Un paso de un género y mundo de un pliegue (`requireAdmin`), con el mismo motor que producción y leyendo los bloques ya guardados. Nunca reusa por
 * huella. `200 PasoGMApi`. Al terminar el último GM calcula `resultados` y `veredicto`. `409`: `evaluacion_terminada`, `corrida_terminada`,
 * `pliegue_sin_preparar`, `gm_en_proceso`, `tope_corrida`, `tope_mensual`, `ia_no_disponible`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requireAdmin();
  if (response) return response;

  const s = await leerSegmentos(params, ["id"], "Evaluación no encontrada.");
  if (s.respuesta) return s.respuesta;
  const clave = (await params).clave;
  if (typeof clave !== "string" || clave.length > 80) return error("Género y mundo no encontrado.", 404);
  const { datos, respuesta } = await leerCuerpo(request, pasoEvaluacionSchema);
  if (respuesta) return respuesta;
  const r = await pasoEvaluacion(s.valores.id, clave, datos.pliegue, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
