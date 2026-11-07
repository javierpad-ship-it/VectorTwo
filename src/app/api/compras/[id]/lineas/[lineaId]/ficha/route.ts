import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { fichaLineaSchema } from "@/lib/fotos/esquemas";
import { idsDeLinea } from "@/lib/fotos/ids";
import { editarFichaLinea } from "@/lib/fotos/servicio";

/**
 * `PATCH /api/compras/[id]/lineas/[lineaId]/ficha` (`requireUser`; decisión 88): descripción y modelo de UNA línea, con los valores que vio
 * el formulario (`antes`). No usa ni sube la `revision` de la compra. `404 no_pertenece`, `409 linea_cambio` (con `actual`) y
 * `409 no_editable`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineaId: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idsDeLinea(params);
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, fichaLineaSchema);
  if (respuesta) return respuesta;
  const r = await editarFichaLinea(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.compraId, t.lineaId, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
