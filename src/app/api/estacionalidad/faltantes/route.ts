import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { agrupacionesConGeneros, cargarEstadoEstacionalidad } from "@/lib/estacionalidad/consultas";
import { aplanarEquivalencias } from "@/lib/estacionalidad/aplanar";

/**
 * Solo las equivalencias faltantes (`requireUser`): activas, en nodo vigente
 * y sin agrupación activa (regla 7). Mismo formato que `/equivalencias`;
 * `resumen` cuenta lo devuelto, así que `resumen.faltantes = 0` es el hito.
 * `incluir_inactivos` no aplica: una inactiva nunca es faltante.
 */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const { estado, error: err } = await cargarEstadoEstacionalidad(supabaseAdmin());
  if (err) return traducirErrorDb(err, "estacionalidad: leer estado");

  return ok(aplanarEquivalencias(estado, agrupacionesConGeneros(estado), { incluirInactivos: false, soloFaltantes: true }));
}
