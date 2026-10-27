import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { listarProveedores } from "@/lib/compras/servicio";

/**
 * `GET /api/compras/proveedores` (`requireUser`; solo lectura): los proveedores con sus compras no canceladas. En `0.13.0` los crea la
 * carga inicial (`importar_compra`); la pantalla de proveedores y los contactos llegan con M9a.
 */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const r = await listarProveedores(supabaseAdmin());
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
