import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeFoto } from "@/lib/fotos/ids";
import { leerMiniatura } from "@/lib/fotos/servicio";

/**
 * `GET /api/compras/fotos/[fotoId]/miniatura` (`requireUser`): los bytes de la miniatura (`image/jpeg`), bajados de Storage con
 * `service_role`. El navegador la guarda solo 5 minutos (`private, max-age=300`, sin `immutable`; H-2 de la auditoría de 08c E1): una foto quitada deja de verse pronto y en un equipo compartido no queda un día en la caché de disco. `404` si la foto no existe o
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
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
