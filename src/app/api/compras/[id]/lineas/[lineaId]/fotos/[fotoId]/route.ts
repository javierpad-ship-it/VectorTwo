import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { idsDeLinea } from "@/lib/fotos/ids";
import { quitarFotoLinea } from "@/lib/fotos/servicio";

/**
 * `DELETE /api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]` (`requireUser`): quita la foto (queda registrado quién y cuándo; los dos
 * objetos se borran de Storage). `404 no_pertenece` (ids cruzados), `409 no_editable` (compra cancelada y quien quita no es admin) y
 * `409 ya_quitada`.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; lineaId: string; fotoId: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idsDeLinea(params);
  if (t.respuesta) return t.respuesta;
  if (t.fotoId === null) return error("Esa foto no pertenece a esta compra.", 404);
  const r = await quitarFotoLinea(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.compraId, t.lineaId, t.fotoId);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
