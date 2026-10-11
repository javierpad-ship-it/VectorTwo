import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { limpiarPendientes } from "@/lib/ventas/consultas";

/**
 * Limpieza de las cargas terminales (`requirePlanner`). Lee
 * `cargas_pendientes_limpieza()` (las cargas `reemplazada`, `retirada`,
 * `abandonada` o `fallida` que todavía tienen filas) y para cada una hace UN
 * `delete … eq("carga_id", id)`, que entra por el prefijo de la clave primaria
 * y borra las ~32 mil filas de un mes en décimas de segundo; luego marca
 * `limpiada_at`. Nunca toca cargas `publicada` ni `en_curso` (la función no las
 * devuelve) y es idempotente. Si falla, solo quedan filas huérfanas invisibles
 * que la siguiente pasada recoge. Respuesta: `{ cargas_limpiadas,
 * filas_borradas, pendientes }`.
 */
export async function POST() {
  const { response } = await requirePlanner();
  if (response) return response;

  const r = await limpiarPendientes(supabaseAdmin());
  if (r.error) return traducirErrorDb(r.error, "limpiar cargas");
  return ok(r.data);
}
