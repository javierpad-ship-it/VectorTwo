import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { activoProveedorSchema } from "@/lib/proveedores/esquemas";
import { MENSAJE_ERROR_PROVEEDOR } from "@/lib/proveedores/tipos-api";
import { cambiarActivoProveedor } from "@/lib/proveedores/servicio";

/** `POST /api/compras/proveedores/[id]/activo` (`requirePlanner`): `{ activo }` desactiva o reactiva. Responde la ficha. `404`. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { perfil, rol, response } = await requirePlanner();
  if (response) return response;

  const t = await idDeRuta(params, MENSAJE_ERROR_PROVEEDOR.no_encontrado);
  if (t.respuesta) return t.respuesta;
  const { datos, respuesta } = await leerCuerpo(request, activoProveedorSchema);
  if (respuesta) return respuesta;
  const r = await cambiarActivoProveedor(supabaseAdmin(), { id: perfil.id, nombre: perfil.nombre ?? perfil.email, rol }, t.id, datos.activo);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
