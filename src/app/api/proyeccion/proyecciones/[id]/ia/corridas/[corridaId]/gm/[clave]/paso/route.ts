import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { pasoVacioSchema } from "@/lib/ia/esquemas";
import { pasoGM } from "@/lib/ia/servicio-pasos";
import { leerSegmentos } from "@/lib/proyeccion/rutas";

type Params = { params: Promise<{ id: string; corridaId: string; clave: string }> };

/** Una llamada al proveedor puede tardar hasta cuatro minutos (`TIMEOUT_LLAMADA_MS`): se pide ese margen a la plataforma. */
export const maxDuration = 300;

/**
 * Hace UN paso de un género y mundo de la corrida (`requirePlanner`): en el primero arma los bloques y decide el plan; en los siguientes hace una sola
 * llamada al proveedor; en el último valida y graba la propuesta. `200 PasoGMApi`; un `429`, una sobrecarga o un tiempo agotado responden
 * `siguiente: "esperar"` (no es un error HTTP). `409`: `corrida_terminada`, `gm_fuera_de_corrida`, `gm_en_proceso`, `datos_cambiaron`, `tope_corrida`,
 * `tope_mensual`, `tope_dia`, `limite_proveedor`, `cerrada`, `ia_no_disponible`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const s = await leerSegmentos(params, ["id", "corridaId"], "Corrida no encontrada.");
  if (s.respuesta) return s.respuesta;
  const clave = (await params).clave;
  if (typeof clave !== "string" || clave.length > 80) return error("Género y mundo no encontrado.", 404);
  const { respuesta } = await leerCuerpo(request, pasoVacioSchema);
  if (respuesta) return respuesta;
  const r = await pasoGM(s.valores.id, s.valores.corridaId, clave, { id: perfil.id, nombre: perfil.nombre });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
