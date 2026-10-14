import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { agrupacionesConGeneros, cargarEstadoEstacionalidad } from "@/lib/estacionalidad/consultas";
import { aplanarEquivalencias } from "@/lib/estacionalidad/aplanar";
import { armarReporteAgrupacionGmle } from "@/lib/reportes/agrupacion-gmle";

/**
 * Reporte de agrupación GMLE (M11, `requirePlanner`). Solo lectura y sin
 * parámetros: lee el árbol completo con `cargarEstadoEstacionalidad`
 * (`leerTodo`, páginas de 1 000), aplana con inactivos y cruza cada nodo con su
 * nivel de planificación en `armarReporteAgrupacionGmle`. Los filtros se
 * aplican en el navegador.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoEstacionalidad(supabaseAdmin());
  if (err) return traducirErrorDb(err, "reportes: leer agrupación GMLE");

  const plano = aplanarEquivalencias(estado, agrupacionesConGeneros(estado), { incluirInactivos: true });
  return ok(armarReporteAgrupacionGmle(plano, estado.nodos));
}
