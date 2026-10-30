import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { sincronizarFactores } from "@/lib/proyeccion/servicio";

/**
 * Sincroniza con M6 (`requirePlanner`, `POST`: escribe): calcula a demanda el factor de volumen de cada año atípico por
 * temporada y guarda `ratio_calculado`, `huella_cargas`, `calculado_at` y `parcial`. No toca `ratio_aplicado` ni la nota.
 */
export async function POST() {
  const { response } = await requirePlanner();
  if (response) return response;

  const r = await sincronizarFactores();
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
