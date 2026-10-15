import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { lineasQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerLineas } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string }> };

/**
 * Parte 1, por línea (`requirePlanner`, solo lectura). `?genero_id&mundo_id&linea_id&q`. Con la línea elegida trae sus filas
 * GML × agrupación de marca con los dos años, el histórico de unidades (cada año con su red de mismas tiendas), las tiendas
 * nuevas y cierres que la tocan y la prueba con el año anterior; sin filtro, solo el índice de líneas y sus estados.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = leerConsulta(request, lineasQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerLineas(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
