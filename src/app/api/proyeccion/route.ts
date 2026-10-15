import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerEstadoInicial } from "@/lib/proyeccion/servicio";

/**
 * Estado inicial de la proyección anual (`requirePlanner`, solo lectura): los datos de M5 (meses, faltantes, curvas), los
 * prerrequisitos que bloquean o avisan, los bloques de tiendas de hoy, las proyecciones y los factores del Niño.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const r = await leerEstadoInicial();
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
