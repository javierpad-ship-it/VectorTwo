import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerAgrupacionPorId, leerVersiones } from "@/lib/curvas/consultas";
import { MENSAJE_AGRUPACION_NO_ENCONTRADA, versionesDeAgrupacion } from "@/lib/curvas/reglas";
import type { VersionesAgrupacionApi } from "@/lib/curvas/tipos-api";

/**
 * Historial de curvas de una agrupación (`requirePlanner`): `VersionesAgrupacionApi`,
 * por `version` descendente (a lo sumo una `vigente`; el resto `reemplazada` o
 * `retirada`), con la `foto_id` de cada una ("Ver foto") y `parametros_resumen`. `404` si
 * la agrupación no existe.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, MENSAJE_AGRUPACION_NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [agrupacion, versiones] = await Promise.all([leerAgrupacionPorId(db, id), leerVersiones(db, id)]);
  const fallo = agrupacion.error ?? versiones.error;
  if (fallo) return traducirErrorDb(fallo, "versiones de la agrupación");
  if (!agrupacion.data) return error(MENSAJE_AGRUPACION_NO_ENCONTRADA, 404);

  const cuerpo: VersionesAgrupacionApi = { versiones: versionesDeAgrupacion(versiones.data) };
  return ok(cuerpo);
}
