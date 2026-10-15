import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { tiendasQuerySchema } from "@/lib/proyeccion/esquemas";
import { leerConsulta } from "@/lib/proyeccion/rutas";
import { leerTiendasDeProyeccion } from "@/lib/proyeccion/servicio-lectura";

type Params = { params: Promise<{ id: string }> };

/**
 * Tiendas nuevas y cierres por año (`requirePlanner`, solo lectura). `?anio&bloque`. Cada tienda trae su composición, su
 * propuesta, las referencias (últimos tres meses, venta esperada), su decisión y sus filas; y el perfil de las aperturas
 * históricas como referencia de la rampa.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = leerConsulta(request, tiendasQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerTiendasDeProyeccion(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
