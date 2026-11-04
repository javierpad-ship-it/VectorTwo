import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { previsualizarQuerySchema, quitarAsignacionesSchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/quitar` (`requireUser`): quita asignaciones del embarque; las unidades quedan SIN embarque en el mismo
 * mes. Vale en cualquier estado del embarque, también cancelado o recibido (es la salida de lo que quedó activo). `?previsualizar=1` y
 * `huella_plan` como en `/asignar`. `404 no_pertenece` (una asignación de otro embarque); `409`: `asignacion_con_recepciones`,
 * `compra_no_asignable` (histórica), `agrupador_cambio`, `compra_cambio`, `plan_cambio`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, quitarAsignacionesSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    { operacion: "quitar", embarque_id: t.id, revision: datos.revision, asignaciones: datos.asignaciones },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
