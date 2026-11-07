import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { idDeRuta, ok } from "@/lib/api/respuestas";
import { MENSAJE_ERROR_PROVEEDOR } from "@/lib/proveedores/tipos-api";
import { leerHistorialProveedor } from "@/lib/proveedores/servicio";

/** `GET /api/compras/proveedores/[id]/historial` (`requireUser`; decisión 103): los cambios del proveedor, campo a campo. `404`. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireUser();
  if (response) return response;

  const t = await idDeRuta(params, MENSAJE_ERROR_PROVEEDOR.no_encontrado);
  if (t.respuesta) return t.respuesta;
  const r = await leerHistorialProveedor(supabaseAdmin(), t.id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
