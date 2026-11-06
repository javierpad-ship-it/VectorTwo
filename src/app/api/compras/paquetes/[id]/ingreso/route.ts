import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { ingresoPaqueteSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { ingresoDePaquete, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/paquetes/[id]/ingreso` (`requireUser`): fija, cambia o suelta (`fecha_ingreso_stock = null`: hereda el del embarque) el
 * ingreso al stock propio de un paquete. `revision_embarque` es la del embarque del paquete. Si el mes cambia, mueve las entregas de sus
 * asignaciones activas (y reparte de nuevo los lotes si cambia la temporada): pide `huella_plan` de la vista previa (`409 plan_cambio`);
 * `motivo` y `causa` solo si reprograma un ingreso que ya tenía valor. Un ingreso anterior a la llegada del embarque se sube a ella y el
 * aviso `ingreso_paquete_ajustado` lo dice. Respuesta como `/fechas`: `RespuestaMovimientoApi`, o `PlanFechasApi` con `?previsualizar=1`.
 * `409`: `agrupador_cambio` (también si el paquete ya no es del embarque), `no_editable` (paquete cancelado), `embarque_no_editable`,
 * `asignacion_con_recepciones`, `sin_cambios`, `motivo_requerido`, `causa_requerida`, `reparto_sin_vector`, `compra_cambio`, `conflicto_reintentar`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese paquete.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, ingresoPaqueteSchema);
  if (respuesta) return respuesta;
  const r = await ingresoDePaquete(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos, { previsualizar: q.datos.previsualizar });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
