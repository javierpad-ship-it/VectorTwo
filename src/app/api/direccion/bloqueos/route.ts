import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerBloqueos } from "@/lib/direccion/cierre";
import { proyeccionQuerySchema } from "@/lib/direccion/esquemas";
import { leerConsultaDireccion } from "@/lib/direccion/rutas";

/**
 * Lo que bloquearía el cierre de una proyección en trabajo, con las reglas de M7 (`requirePlanner`). En cerrada o archivada, `{ aplica: false }`.
 * `400` si `proyeccion_id` falta o está mal formado; `404`; `409 calculo_en_curso`. Va aparte del tablero porque carga el contexto de cálculo de M7.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsultaDireccion(request, proyeccionQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerBloqueos(datos.proyeccion_id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
