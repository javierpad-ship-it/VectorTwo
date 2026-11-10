import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerOpciones } from "@/lib/direccion/servicio";

/**
 * Opciones del tablero de dirección (`requirePlanner`: admin y planner; el comprador no entra): proyecciones con su estado de dirección, la que se
 * abre por defecto (la cerrada que usa Compras), con cuál se compara por defecto (la última aprobada) y los catálogos de los filtros. No lee venta.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const r = await leerOpciones();
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
