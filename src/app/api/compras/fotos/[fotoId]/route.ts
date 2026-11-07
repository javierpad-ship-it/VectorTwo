import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { idDeFoto } from "@/lib/fotos/ids";
import { leerFotoGrande } from "@/lib/fotos/servicio";

/** `GET /api/compras/fotos/[fotoId]` (`requireUser`): la foto grande con una URL firmada de 1 h, firmada a demanda. `404` si no existe o está quitada. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ fotoId: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeFoto(params);
  if (t.respuesta) return t.respuesta;
  const r = await leerFotoGrande(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
