import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { aplicarCurvaSchema } from "@/lib/proyeccion/esquemas";
import { aplicarCurva } from "@/lib/proyeccion/servicio-edicion";

type Params = { params: Promise<{ id: string }> };

/**
 * «La curva cambió» (`requirePlanner`, `POST`): copia el reparto nuevo (`meses_propuestos`) a `meses` y la versión de curva
 * propuesta a `curva_origen_usada` en los registros indicados (`fila_anio_ids`, o `gml_id` con `anio` opcional). El total
 * decidido no cambia. `409 cerrada`: una cerrada nunca se vuelve a repartir.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, aplicarCurvaSchema);
  if (respuesta) return respuesta;
  const r = await aplicarCurva(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
