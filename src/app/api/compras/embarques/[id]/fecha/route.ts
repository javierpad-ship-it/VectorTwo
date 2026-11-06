import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { cambiarFechaSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * ALIAS por una versión de `/fechas` (solo pestañas abiertas durante el despliegue). `POST /api/compras/embarques/[id]/fecha` (`requireUser`: planner y comprador cambian las fechas, respuesta b de Javier): cambia la llegada
 * estimada con motivo obligatorio. Si el mes cambia, mueve en bloque las asignaciones ACTIVAS al mes nuevo (las históricas no se mueven);
 * dentro del mismo mes solo cambia el embarque y no toca ninguna compra. `?previsualizar=1` y `huella_plan` como en `/asignar`. `409`:
 * `embarque_con_recepciones`, `embarque_no_editable`, `salida_despues_de_llegada`, `max_entregas`, `reparto_sin_vector`, `motivo_requerido`,
 * `agrupador_cambio`, `compra_cambio`, `plan_cambio`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cambiarFechaSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    { operacion: "cambiar_fecha", embarque_id: t.id, revision: datos.revision, fecha_llegada_estimada: datos.fecha_llegada_estimada, motivo: datos.motivo },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
