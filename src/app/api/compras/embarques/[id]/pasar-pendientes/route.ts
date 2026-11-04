import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { pasarPendientesSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/pasar-pendientes` (`requireUser`): lo pendiente de cada asignación (estimado con el FIFO de M8) sale a
 * otro embarque en curso, y su entrega pasa al mes de llegada del destino; el origen conserva lo recibido. Sin `asignaciones`, todas las
 * del embarque. Motivo obligatorio. `?previsualizar=1` y `huella_plan` como en `/asignar`. `404 no_pertenece`; `409`: `sin_pendientes`,
 * `embarque_no_editable`, `paquete_de_otro_embarque`, `max_entregas`, `reparto_sin_vector`, `motivo_requerido`, `agrupador_cambio`,
 * `compra_cambio`, `plan_cambio`. La respuesta trae el embarque de origen y, en `embarques_tocados`, el de destino.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, pasarPendientesSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    {
      operacion: "pasar_pendientes",
      embarque_id: t.id,
      revision: datos.revision,
      embarque_destino_id: datos.embarque_destino_id,
      revision_destino: datos.revision_destino,
      paquete_destino_id: datos.paquete_destino_id,
      asignaciones: datos.asignaciones,
      motivo: datos.motivo,
    },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
