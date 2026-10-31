import { requireAdmin } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { configuracionSchema } from "@/lib/ia/esquemas";
import { guardarConfiguracionIa, leerConfiguracionIa } from "@/lib/ia/servicio";

/**
 * Configuración vigente del motor de IA, sus versiones, el estado del servicio (proveedor y modelos permitidos del entorno, nunca la clave) y los
 * prompts que existen (`requireAdmin`). Incluye `avisos` informativos (`modelo_efectivo_distinto`).
 */
export async function GET() {
  const { perfil, response } = await requireAdmin();
  if (response) return response;

  const r = await leerConfiguracionIa({ id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Guarda una versión nueva de la configuración (`requireAdmin`). El proveedor lo pone el servidor (`IA_PROVEEDOR`). `201 ConfiguracionIaApi`. `409`:
 * `sin_proveedor`, `modelo_no_permitido`, `capacidad_sin_evaluacion`, `evaluacion_otro_modelo`, `evaluacion_no_gana`, `vigente_cambiada`.
 */
export async function POST(request: Request) {
  const { perfil, response } = await requireAdmin();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, configuracionSchema);
  if (respuesta) return respuesta;
  const r = await guardarConfiguracionIa(datos, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
