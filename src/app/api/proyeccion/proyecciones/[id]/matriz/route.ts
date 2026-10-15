import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { matrizQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerMatriz } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string }> };

/**
 * Parte 2, la matriz (`requirePlanner`, solo lectura): una fila por género · mundo · línea con las columnas sin solapes de los
 * dos años, totales por mundo, género y compañía, y la composición de los bloques. Los filtros se aplican sobre las tablas, sin
 * releer venta ni seleccionar `historico`. `?por=agrupacion_marca` da la vista por agrupación de marca × género.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = leerConsulta(request, matrizQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerMatriz(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
