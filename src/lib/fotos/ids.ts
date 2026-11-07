import type { NextResponse } from "next/server";
import { error } from "@/lib/api/respuestas";
import { idRutaSchema } from "./esquemas";
import { MENSAJE_ERROR_FOTO } from "./tipos-api";

/**
 * Lee y valida los ids de las rutas de fotos (`params` es una Promise en esta versión de Next). Un id mal formado responde `404` con el
 * mismo texto que un recurso inexistente: Postgres nunca ve un `invalid input syntax for type uuid`. Sin acceso a datos.
 */
type IdsLinea = { compraId: string; lineaId: string; fotoId: string | null; respuesta: null } | { compraId: null; lineaId: null; fotoId: null; respuesta: NextResponse };

export async function idsDeLinea(params: Promise<{ id: string; lineaId: string; fotoId?: string }>): Promise<IdsLinea> {
  const { id, lineaId, fotoId } = await params;
  const rechazo = (mensaje: string): IdsLinea => ({ compraId: null, lineaId: null, fotoId: null, respuesta: error(mensaje, 404) });
  if (!idRutaSchema.safeParse(id).success) return rechazo("No encontramos esa compra.");
  if (!idRutaSchema.safeParse(lineaId).success) return rechazo(MENSAJE_ERROR_FOTO.no_pertenece);
  if (fotoId !== undefined && !idRutaSchema.safeParse(fotoId).success) return rechazo(MENSAJE_ERROR_FOTO.no_pertenece);
  return { compraId: id, lineaId, fotoId: fotoId ?? null, respuesta: null };
}

/** El `[fotoId]` de `/api/compras/fotos/[fotoId]`. */
export async function idDeFoto(params: Promise<{ fotoId: string }>): Promise<{ id: string; respuesta: null } | { id: null; respuesta: NextResponse }> {
  const { fotoId } = await params;
  if (!idRutaSchema.safeParse(fotoId).success) return { id: null, respuesta: error(MENSAJE_ERROR_FOTO.no_encontrado, 404) };
  return { id: fotoId, respuesta: null };
}
