import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { armarVigentes } from "@/lib/marcas/gml/vista";

/**
 * La configuración vigente ya en la forma de "mi flujo de Jeans"
 * (`requirePlanner`, 02b): los GML vigentes con sus marcas relevantes por
 * agrupación, las marcas al barrer, el mapa marca → unidad de las marcas en un
 * conjunto efectivo y las pendientes (`sin_gml`, `sin_modalidad`). Es lo que M7
 * y M8 leen; en SQL cruzan la vista de vigentes, que coincide con esta función.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const cargado = await cargarEstadoGml(supabaseAdmin());
  if (cargado.error) return traducirErrorDb(cargado.error, "marcas relevantes vigentes");
  return ok(armarVigentes(cargado.estado, new Date().toISOString()));
}
