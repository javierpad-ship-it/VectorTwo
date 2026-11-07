import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { idsDeLinea } from "@/lib/fotos/ids";
import { traerFotosDeCancelada } from "@/lib/fotos/servicio";

/**
 * `POST /api/compras/[id]/lineas/[lineaId]/fotos/traer` (`requireUser`; decisión 104; sin cuerpo): copia a la línea las fotos de la misma
 * línea de la versión cancelada (misma `clave_importacion` y proveedor), hasta completar 3. Traer dos veces no duplica. `404 sin_origen`,
 * `409 max_fotos`, `409 no_editable`, `502 almacen_no_disponible`.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; lineaId: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idsDeLinea(params);
  if (t.respuesta) return t.respuesta;
  const r = await traerFotosDeCancelada(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.compraId, t.lineaId);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
