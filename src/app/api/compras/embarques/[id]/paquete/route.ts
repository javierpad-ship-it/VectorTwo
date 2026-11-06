import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { moverAPaqueteSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/paquete` (`requireUser`): mueve asignaciones del embarque a un paquete del MISMO embarque (o fuera de
 * paquete con `paquete_id` nulo). Cada asignación va como `id` (entera) o como `{ id, unidades }` (solo esas unidades). Vale también con
 * ingresos confirmados. Si el movimiento cambia de mes (el paquete destino tiene ingreso propio en otro mes, o se saca un lote de un
 * paquete con ingreso propio; 08b-1b §2.5) el cuerpo debe traer `motivo` y `causa` (`409 motivo_requerido`, `409 causa_requerida`) y la
 * `huella_plan` de la vista previa (`409 plan_cambio` si falta o ya no coincide); si no cambia de mes, nada de eso es obligatorio.
 * `?previsualizar=1` devuelve el `PlanMovimientoApi` (con la `huella_plan`) sin escribir; sin él, responde `RespuestaMovimientoApi`.
 * `404 no_pertenece`; `409`: `paquete_de_otro_embarque`, `embarque_no_editable`, `agrupador_cambio`, `no_editable` (paquete cancelado),
 * `asignacion_con_recepciones`, `excede_entrega`, `compra_cambio`, `plan_cambio`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, moverAPaqueteSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    {
      operacion: "mover_a_paquete",
      embarque_id: t.id,
      revision: datos.revision,
      paquete_id: datos.paquete_id,
      asignaciones: datos.asignaciones,
      ...(datos.motivo === undefined ? {} : { motivo: datos.motivo }),
      ...(datos.causa === undefined ? {} : { causa: datos.causa }),
    },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
