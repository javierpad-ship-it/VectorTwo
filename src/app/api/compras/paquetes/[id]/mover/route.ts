import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { moverPaqueteSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/paquetes/[id]/mover` (`requireUser`): pasa el paquete a otro embarque en curso (solo sin ingresos vinculados); sus
 * asignaciones activas se llevan al mes de llegada del destino. `revision` es la del embarque de origen y `revision_destino` la del
 * destino. Motivo obligatorio. `?previsualizar=1` y `huella_plan` como en `/asignar`. La respuesta trae el embarque de DESTINO (donde el
 * paquete vive ahora) y, en `embarques_tocados`, el de origen. `409`: `asignacion_con_recepciones`, `embarque_no_editable`,
 * `max_entregas`, `reparto_sin_vector`, `motivo_requerido`, `agrupador_cambio`, `plan_cambio`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese paquete.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, moverPaqueteSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    { operacion: "mover_paquete", paquete_id: t.id, revision: datos.revision, embarque_destino_id: datos.embarque_destino_id, revision_destino: datos.revision_destino, motivo: datos.motivo },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
