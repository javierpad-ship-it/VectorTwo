import type { NextRequest } from "next/server";
import { requireAdmin, requirePlanner } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { aprobarDireccionSchema, proyeccionQuerySchema } from "@/lib/direccion/esquemas";
import { leerConsultaDireccion } from "@/lib/direccion/rutas";
import { aprobar, leerAprobaciones } from "@/lib/direccion/servicio";

/** Estado de dirección e historial de aprobaciones de una proyección, de la más reciente a la más antigua (`requirePlanner`). `400`, `404`. */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = leerConsultaDireccion(request, proyeccionQuerySchema);
  if (respuesta) return respuesta;
  const r = await leerAprobaciones(datos.proyeccion_id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Registra la decisión de dirección sobre la proyección entera (`requireAdmin`: solo el admin aprueba). Quién aprueba sale de la sesión, nunca del
 * cuerpo. `201` con la aprobación; `409 huella_distinta` (con `huella_actual`) si la proyección cambió desde que se cargó el tablero; `409 archivada`,
 * `calculo_en_curso` o `sin_calcular`; `404 proyeccion_no_encontrada`.
 */
export async function POST(request: NextRequest) {
  const { perfil, response } = await requireAdmin();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, aprobarDireccionSchema);
  if (respuesta) return respuesta;
  const nombre = (perfil.nombre ?? "").trim() || perfil.email;
  const r = await aprobar(datos, { id: perfil.id, nombre: nombre.slice(0, 200) });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
