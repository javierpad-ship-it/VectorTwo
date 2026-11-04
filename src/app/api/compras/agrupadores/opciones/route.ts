import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { leerOpciones } from "@/lib/compras/agrupadores/servicio";

/**
 * `GET /api/compras/agrupadores/opciones` (`requireUser`): lo que piden los selectores: viajes (abiertos y cerrados; los cerrados los marca
 * la pantalla), embarques y paquetes vigentes, responsables posibles (comprador o admin activos) y puertos ya usados.
 */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const r = await leerOpciones(supabaseAdmin());
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
