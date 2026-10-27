import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { cancelarSchema } from "@/lib/compras/esquemas";
import { cancelarCompra } from "@/lib/compras/servicio";

/**
 * `POST /api/compras/[id]/cancelar` (`requirePlanner` en M8; `requireUser` desde M9a): cancela con motivo (con la función
 * `cancelar_compra`). Sin recepciones la compra queda `cancelada` (inmutable: todo deja de contar); con recepciones CIERRA EL SALDO y
 * queda `recibida` con saldo cancelado. `409 recibida` si ya llegó todo, `409 compra_cambio`, `409 no_editable` (ya cancelada).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos esa compra.");
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, cancelarSchema);
  if (respuesta) return respuesta;
  const r = await cancelarCompra(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
