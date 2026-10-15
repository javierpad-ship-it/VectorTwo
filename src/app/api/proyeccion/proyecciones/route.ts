import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { crearSchema } from "@/lib/proyeccion/esquemas";
import { crearProyeccion } from "@/lib/proyeccion/servicio";

/**
 * Crea una proyección y la calcula (`requirePlanner`). `201` con la proyección ya calculada; `409 sin_datos`,
 * `409 prerrequisitos` (con `meses_faltantes`), `409 nombre_repetido`, `409 datos_cambiaron` y `409 calculo_en_curso`.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearSchema);
  if (respuesta) return respuesta;

  const r = await crearProyeccion(datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
