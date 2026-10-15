import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { mensualQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerMensual } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string }> };

/**
 * Parte 3, la vista mensual (`requirePlanner`, solo lectura): los meses reales y proyectados de cada año, repartidos con las
 * curvas de M6 y guardados. `?bloque=todas|mismas|nuevas|cierres&por_agrupacion=1` y los mismos filtros de la matriz. Nunca
 * vuelve a repartir ni usa `meses_propuestos`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = leerConsulta(request, mensualQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerMensual(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
