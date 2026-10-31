import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { filtroFilasIaSchema } from "@/lib/ia/esquemas";
import { leerFilasIa } from "@/lib/ia/servicio";
import { leerConsulta } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string }> };

/**
 * Las filas de la IA de una línea para Por línea (`requirePlanner`): `{ filas: IaFilaApi[] }` por `fila_id`, con `?genero_id&mundo_id&linea_id`. Lectura
 * aparte (D15): con la IA apagada responde `409 ia_no_disponible` o `capacidad_apagada`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const q = leerConsulta(request, filtroFilasIaSchema);
  if (q.respuesta) return q.respuesta;
  const r = await leerFilasIa(id, q.datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
