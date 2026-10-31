import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerEstadoIa } from "@/lib/ia/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Estado de la propuesta de IA de una proyección (`requirePlanner`; el comprador recibe `403`): servicio, prerrequisitos, corrida en curso, un resumen por
 * género y mundo y la estimación de los pendientes. Nunca escribe ni llama al proveedor. `404` si la proyección no existe.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuesta) return respuesta;
  const r = await leerEstadoIa(id, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
