import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeFoto } from "@/lib/fotos/ids";
import { leerMiniatura } from "@/lib/fotos/servicio";

/**
 * `GET /api/compras/fotos/[fotoId]/miniatura` (`requireUser`): los bytes de la miniatura (`image/jpeg`), bajados de Storage con
 * `service_role`. La miniatura de un `id` nunca cambia: el navegador la guarda un día (`private`, `immutable`). `404` si la foto no existe o
 * está quitada. La respuesta lleva `nosniff` y una CSP con `sandbox` por si alguien abre la URL a mano.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ fotoId: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeFoto(params);
  if (t.respuesta) return t.respuesta;
  const r = await leerMiniatura(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return new Response(r.data as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(r.data.length),
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
