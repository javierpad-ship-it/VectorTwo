import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { aceptarIaSchema } from "@/lib/ia/esquemas";
import { aceptarIaFila } from "@/lib/ia/servicio";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; filaId: string }> };

/**
 * «Aceptar IA» en una fila (`requirePlanner`): una fila a la vez, solo el año siguiente, con la cifra que el planner vio (`valor_esperado`). Si cambió,
 * `409 ia_valor_cambio` con `valor_actual`. Si coincide, decide la fila con `origen = manual` y la traza de la propuesta (`decidirFila`) y responde
 * como `PUT …/filas/[filaId]/anios/[anio]` (con `decision_ia`). `409`: `ia_no_disponible`, `capacidad_apagada`, `cerrada`, `anio_no_admitido`,
 * `ia_desactualizada`, `ia_no_vigente`, `ia_fila_ajena`, `fila_no_libre`, `ia_sin_valor`, `ia_valor_cambio` y los de la decisión.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "filaId"], "Fila no encontrada.");
  if (s.respuesta) return s.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, aceptarIaSchema);
  if (respuesta) return respuesta;
  const r = await aceptarIaFila(s.valores.id, s.valores.filaId, datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
