import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerHistorial } from "@/lib/compras/servicio";

/** `GET /api/compras/[id]/historial` (`requireUser`; solo lectura): los eventos de la compra, del más antiguo al más reciente (quién, cuándo, antes y después). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos esa compra.");
  if (t.respuesta) return t.respuesta;
  const r = await leerHistorial(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
