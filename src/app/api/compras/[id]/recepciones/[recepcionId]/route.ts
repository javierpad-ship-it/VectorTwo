import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { quitarRecepcionSchema } from "@/lib/compras/esquemas";
import { quitarIngreso } from "@/lib/compras/servicio";
import { leerConsulta } from "@/lib/intercompany/rutas";

const uuid = z.uuid();

/**
 * `DELETE /api/compras/[id]/recepciones/[recepcionId]?revision=` (`requirePlanner` en M8; `requireUser` desde M9a): quita un ingreso
 * confirmado (función `quitar_recepcion`; la recepción entera queda en el `antes` del evento). La recepción debe ser de una línea de ESTA
 * compra: si no, `404 no_pertenece` sin tocar nada. `409 compra_cambio` si la `revision` ya no es la vigente.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; recepcionId: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const { id, recepcionId } = await params;
  if (!uuid.safeParse(id).success) return error("No encontramos esa compra.", 404);
  if (!uuid.safeParse(recepcionId).success) return error("Ese ingreso no pertenece a esta compra.", 404);
  const { datos, respuesta } = leerConsulta(request, quitarRecepcionSchema);
  if (respuesta) return respuesta;
  const r = await quitarIngreso(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, id, recepcionId, datos.revision);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
