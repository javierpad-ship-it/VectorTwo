import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { leerConsulta } from "@/lib/intercompany/rutas";
import { asignarEntregasSchema, previsualizarQuerySchema } from "@/lib/compras/agrupadores/esquemas";
import { moverEntregas, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/embarques/[id]/asignar` (`requireUser`: «añade mercadería a los pedidos», decisión 92): asigna unidades de entregas a
 * este embarque (y paquete). Las que están en otro mes pasan al mes de llegada; los lotes se reparten de nuevo con la misma versión de M12.
 * Con `?previsualizar=1` devuelve el `PlanMovimientoApi` (con su `huella_plan`) sin escribir; si no, escribe con
 * `aplicar_movimiento_agrupador` y devuelve `RespuestaMovimientoApi`. Si una compra cambió, reintenta UNA vez solo con la `huella_plan`
 * idéntica; si no, `409 plan_cambio`. `404 no_pertenece`; `409`: `excede_entrega`, `compra_no_asignable`, `saldo_cerrado`, `max_entregas`,
 * `reparto_sin_vector`, `embarque_no_editable`, `agrupador_cambio`, `compra_cambio`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese embarque.");
  if (t.respuesta) return t.respuesta;
  const q = leerConsulta(request, previsualizarQuerySchema);
  if (q.respuesta) return q.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, asignarEntregasSchema);
  if (respuesta) return respuesta;
  const r = await moverEntregas(
    supabaseAdmin(),
    usuarioDe(perfil, rol),
    { operacion: "asignar", embarque_id: t.id, revision: datos.revision, paquete_id: datos.paquete_id, items: datos.items },
    { previsualizar: q.datos.previsualizar, huella_plan: datos.huella_plan },
  );
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
