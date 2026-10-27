import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { recibirSchema } from "@/lib/compras/esquemas";
import { confirmarIngreso } from "@/lib/compras/servicio";

/**
 * `POST /api/compras/[id]/recibir` (`requirePlanner` en M8; `requireUser` desde M9a): «Confirmar ingreso» de una o varias líneas en un
 * mes X (con la función `registrar_recepciones`: una transacción, candado por `revision`, pertenencia y evento). Si X ≤ `k'`, esas
 * unidades dejan de esperarse en el flujo futuro; si X > `k'`, suman en X. Devuelve la compra al día. `404 no_pertenece` (una línea de
 * otra compra), `409 compra_cambio`, `409 excede_pendiente`, `409 recepcion_antes_de_compra`, `409 no_editable`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos esa compra.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, recibirSchema);
  if (respuesta) return respuesta;
  const r = await confirmarIngreso(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
