import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { cambiarFechasSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { cambiarFechasEmbarque, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/fechas` (`requireUser`: planner y comprador cambian las fechas): cambia cualquier hito del embarque
 * (Zarpe, Arribo, Ingreso CD, Inicio operativo con hora, Ingreso al stock) y `hito_confirmado`. Clave ausente = no cambia; presente = valor
 * nuevo, `null` incluido. `motivo` y `causa` solo si reprograma (`409 motivo_requerido`, `409 causa_requerida`); `huella_plan` solo si algún
 * mes cambia (`409 plan_cambio`). Sin `?previsualizar=1` responde `RespuestaMovimientoApi` (el embarque con su detalle, los otros embarques y
 * las compras tocadas, y los avisos); con `?previsualizar=1`, el `PlanFechasApi` sin escribir nada. `409`: `agrupador_cambio`, `sin_cambios`,
 * `embarque_no_editable`, `embarque_con_recepciones`, `asignacion_con_recepciones`, `salida_despues_de_llegada`, `puerto_en_local`,
 * `fecha_futura`, `fecha_requerida`, `max_entregas`, `reparto_sin_vector`, `compra_cambio`, `conflicto_reintentar`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cambiarFechasSchema);
  if (respuesta) return respuesta;
  const r = await cambiarFechasEmbarque(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos, { previsualizar: q.datos.previsualizar });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
