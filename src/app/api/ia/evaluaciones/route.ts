import { requireAdmin } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { evaluacionSchema } from "@/lib/ia/esquemas";
import { iniciarEvaluacion, listarEvaluaciones } from "@/lib/ia/servicio-evaluacion";

/** Todas las evaluaciones, también las canceladas y fallidas, con su número de intento (`requireAdmin`). */
export async function GET() {
  const { response } = await requireAdmin();
  if (response) return response;

  const r = await listarEvaluaciones();
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Inicia una evaluación (`requireAdmin`): `201 { evaluacion, plan: { pliegue, gm_clave }[], estimacion }`. El proveedor es el del entorno. `409`:
 * `evaluacion_en_curso`, `sin_datos_pliegue`, `tope_mensual`, `tope_evaluacion`, `limite_evaluaciones_mes`, `costo_no_confirmado` (con `estimacion`),
 * `ia_sin_clave`, `sin_proveedor`, `modelo_no_permitido`.
 */
export async function POST(request: Request) {
  const { perfil, response } = await requireAdmin();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, evaluacionSchema);
  if (respuesta) return respuesta;
  const r = await iniciarEvaluacion(datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
