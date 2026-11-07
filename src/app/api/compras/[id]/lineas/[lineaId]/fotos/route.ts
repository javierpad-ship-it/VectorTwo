import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { idsDeLinea } from "@/lib/fotos/ids";
import { subirFotoLinea } from "@/lib/fotos/servicio";

/**
 * `POST /api/compras/[id]/lineas/[lineaId]/fotos` (`requireUser`, decisión 100): sube UNA foto (hasta 3 por línea) como `multipart/form-data`
 * con dos partes, `foto` (JPEG ≤ 800 × 800 y ≤ 400 KB) y `miniatura` (≤ 320 × 320 y ≤ 60 KB). La petición se lee con tope de 512 KB en
 * `src/lib/fotos/validar.ts` (no hay `leerCuerpo`: no es JSON). `201` con la foto. Errores: `411 longitud_requerida`, `413 foto_grande`,
 * `403 origen_invalido`, `400 foto_requerida`, `400 formato_invalido`, `400 dimensiones_invalidas`, `404 no_pertenece`, `409 no_editable`,
 * `409 max_fotos`, `502 almacen_no_disponible`. Si la base rechaza, los dos objetos subidos se borran.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; lineaId: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idsDeLinea(params);
  if (t.respuesta) return t.respuesta;
  const r = await subirFotoLinea(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.compraId, t.lineaId, request);
  if (r.respuesta) return r.respuesta;
  return ok(r.data, 201);
}
