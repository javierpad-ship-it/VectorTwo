import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { cerrarSchema } from "@/lib/proyeccion/esquemas";
import { cerrarProyeccion } from "@/lib/proyeccion/servicio";

type Params = { params: Promise<{ id: string }> };

/**
 * Cierra la proyección (`requirePlanner`, `POST`): la `cerrada` anterior del mismo año pasa a `archivada`. Bloquea con
 * `409 filas_sin_decidir` (lista), `409 tiendas_sin_decidir`, `409 desactualizada` (salvo `?forzar=1`), `409 ya_cerrada` y
 * `409 calculo_en_curso`. La cola larga se cierra con la propuesta. Una cerrada es solo lectura y nunca se vuelve a repartir.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, "Proyección no encontrada.");
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, cerrarSchema);
  if (respuesta) return respuesta;
  const forzar = ["1", "true"].includes(request.nextUrl.searchParams.get("forzar") ?? "");
  const r = await cerrarProyeccion(id, datos.nota, forzar, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
