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
 * y M8 leen; en SQL cruzan la vista de vigentes, que coincide con esta función. M12: `barrido` trae solo
 * las marcas al barrer puras y `mixtas` las mixtas (su parte al barrer más los nodos de sus GML específicos,
 * que además salen en `gml`); una mixta sin GML vigentes aparece también en `pendientes` (`mixta_sin_gml`).
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const cargado = await cargarEstadoGml(supabaseAdmin());
  if (cargado.error) return traducirErrorDb(cargado.error, "marcas relevantes vigentes");
  return ok(armarVigentes(cargado.estado, new Date().toISOString()));
}
