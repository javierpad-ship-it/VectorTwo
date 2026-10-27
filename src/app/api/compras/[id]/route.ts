import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { leerCompra } from "@/lib/compras/servicio";
import { contextoParaCompras } from "@/lib/flujo/servicio";

/**
 * `GET /api/compras/[id]` (`requireUser`; solo lectura): una compra con sus líneas, entregas (con el pendiente por FIFO y la sugerencia de
 * la conciliación), recepciones, avisos, `revision`, `puede` e `historial`. Las compras NO se borran (se cancelan): no hay `DELETE`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, "No encontramos esa compra.");
  if (t.respuesta) return t.respuesta;
  const d = supabaseAdmin();
  const r = await leerCompra(d, { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, () => contextoParaCompras(d));
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
