import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { leerCuerpo, ok } from "@/lib/api/respuestas";
import { parametrosFlujoSchema } from "@/lib/flujo/esquemas";
import { guardarParametros, leerParametros } from "@/lib/flujo/servicio";

/** `GET /api/flujo/parametros` (`requireUser`): el IMI, los meses de la tarjeta, las temporadas y los umbrales; sin fila, los valores por defecto. */
export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  const r = await leerParametros(supabaseAdmin());
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * `PUT /api/flujo/parametros` (`requirePlanner`): reemplaza la fila única. Cambiar las fechas de temporada deja obsoletos los repartos de
 * M12 («Obsoleto: config_cambiada») y NO mueve ningún lote por sí solo.
 */
export async function PUT(request: NextRequest) {
  const { perfil, response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, parametrosFlujoSchema);
  if (respuesta) return respuesta;
  const r = await guardarParametros(supabaseAdmin(), datos, { id: perfil.id, nombre: perfil.nombre ?? perfil.email });
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
