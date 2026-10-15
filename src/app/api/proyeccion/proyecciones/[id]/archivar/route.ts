import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { archivarSchema } from "@/lib/proyeccion/esquemas";
import { archivarProyeccion } from "@/lib/proyeccion/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Archiva una proyección en trabajo o cerrada (`requirePlanner`, `POST`): queda de solo lectura. Cuerpo opcional
 * `{ confirmar_sin_cerrada?: boolean }`: archivar la cerrada de un año deja a Presupuesto (M8) sin proyección, así que sin
 * `true` responde `409 ultima_cerrada` con el aviso.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuesta) return respuesta;
  // El cuerpo es opcional: una petición sin contenido (`content-length: 0`) equivale a `{}`.
  let confirmar = false;
  if (request.headers.get("content-length") !== "0") {
    const { datos, respuesta: respuestaCuerpo } = await leerCuerpo(request, archivarSchema);
    if (respuestaCuerpo) return respuestaCuerpo;
    confirmar = datos.confirmar_sin_cerrada === true;
  }
  const r = await archivarProyeccion(id, confirmar);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
