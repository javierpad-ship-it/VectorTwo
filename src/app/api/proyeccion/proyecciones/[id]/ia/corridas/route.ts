import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { iniciarCorridaSchema } from "@/lib/ia/esquemas";
import { iniciarCorrida } from "@/lib/ia/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Inicia una corrida de IA (`requirePlanner`): crea la corrida y sus géneros y mundos en `pendiente` y responde `201 { corrida, plan, estimacion }`.
 * Con `costo_confirmado_usd` menor que la estimación responde `409 costo_no_confirmado` con `estimacion` en el cuerpo. Otros `409`: `ia_no_disponible`,
 * `capacidad_apagada`, `cerrada`, `archivada`, `version_metodo`, `proyeccion_desactualizada`, `factor_y`, `anio_siguiente_atipico`, `calculo_en_curso`,
 * `corrida_en_curso`, `tope_corrida`, `tope_mensual`, `tope_dia`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, iniciarCorridaSchema);
  if (respuesta) return respuesta;
  const r = await iniciarCorrida(id, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
