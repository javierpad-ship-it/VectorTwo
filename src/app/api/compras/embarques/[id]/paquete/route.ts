import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { moverAPaqueteSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/paquete` (`requireUser`): mueve asignaciones del embarque a un paquete del MISMO embarque (o fuera de
 * paquete con `paquete_id` nulo). No mueve meses y vale también con ingresos confirmados. `?previsualizar=1` como en `/asignar` (este
 * movimiento no lleva `huella_plan`: no hay reintento). `404 no_pertenece`; `409`: `paquete_de_otro_embarque`, `embarque_no_editable`,
 * `agrupador_cambio`, `no_editable` (paquete cancelado).
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
    { operacion: "mover_a_paquete", embarque_id: t.id, revision: datos.revision, paquete_id: datos.paquete_id, asignaciones: datos.asignaciones },
    { previsualizar: q.datos.previsualizar },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
