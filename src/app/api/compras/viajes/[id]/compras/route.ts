import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { asignarViajeSchema } from "@/lib/compras/agrupadores/esquemas";
import { asignarComprasAViaje, usuarioDe } from "@/lib/compras/agrupadores/servicio";

/**
 * `POST /api/compras/viajes/[id]/compras` (`requireUser`: los tres roles, también con el viaje cerrado, que solo avisa `viaje_cerrado`;
 * decisión 95): `{ viaje_id, compras: [{ id, revision }] }`. `viaje_id` es el del `[id]` (asigna) o nulo (quita; solo vale para compras de
 * ese viaje, `404 no_pertenece`). Una función por llamada (asignar_viaje_compras: bloquea el viaje y después las compras). `409`:
 * `compra_cambio`, `viaje_cancelado`, `no_editable`. Respuesta `{ viaje, compras: [{ id, revision }], avisos }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos ese viaje.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, asignarViajeSchema);
  if (respuesta) return respuesta;
  const r = await asignarComprasAViaje(supabaseAdmin(), usuarioDe(perfil, rol), t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
