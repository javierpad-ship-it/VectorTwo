import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import { leerDestino, leerGeneros } from "@/lib/estacionalidad/agrupaciones";
import { asignarSchema } from "@/lib/estacionalidad/esquemas";
import {
  planificarAsignacion,
  rechazoDestinoAsignacion,
  type EquivalenciaAsignable,
} from "@/lib/estacionalidad/reglas";
import type { ResultadoAsignacion } from "@/lib/estacionalidad/tipos";

/**
 * Asignación masiva (`requirePlanner`): pone `agrupacion_id` (o `null` para
 * quitarla) en todas las `equivalencia_ids`. Rechaza TODA la petición si el
 * destino no sirve: `404` si la agrupación no existe, `409` si está inactiva o
 * no tiene géneros. Lo que no es del destino no aborta: los ids que no existan
 * van en `no_encontradas` y las equivalencias cuyo género la agrupación no
 * incluye van en `no_permitidas` (`{ id, genero }`, género por nombre) y no se
 * asignan. Se asigna también a equivalencias inactivas. Quitar no comprueba
 * géneros. Sin transacción: si una tanda falla, `500`, y repetir la misma
 * asignación completa el resto (es idempotente).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, asignarSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();

  let destino: Awaited<ReturnType<typeof leerDestino>>["data"] = null;
  if (datos.agrupacion_id !== null) {
    const leido = await leerDestino(db, datos.agrupacion_id);
    if (leido.error) return traducirErrorDb(leido.error, "asignar: buscar agrupación");
    destino = leido.data;
  }
  const rechazo = rechazoDestinoAsignacion(destino, datos.agrupacion_id === null);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const generos = await leerGeneros(db);
  if (generos.error) return traducirErrorDb(generos.error, "asignar: leer géneros");
  const nombreGenero = new Map(generos.data.map((g) => [g.id, g.nombre]));

  const ids = [...new Set(datos.equivalencia_ids)];
  const encontradas: EquivalenciaAsignable[] = [];
  for (const tanda of enTandas(ids, TANDA_IN)) {
    const { data, error: err } = await db
      .from("equivalencias")
      .select("id, agrupacion_estacionalidad_id, genero_mundo_linea(genero_id)")
      .in("id", tanda);
    if (err) return traducirErrorDb(err, "asignar: leer equivalencias");
    for (const e of data ?? []) {
      const generoId = e.genero_mundo_linea?.genero_id ?? "";
      encontradas.push({
        id: e.id,
        agrupacion_estacionalidad_id: e.agrupacion_estacionalidad_id,
        genero_id: generoId,
        genero_nombre: nombreGenero.get(generoId) ?? "",
      });
    }
  }

  const plan = planificarAsignacion(ids, encontradas, destino);

  let asignadas = 0;
  for (const tanda of enTandas(plan.a_asignar, TANDA_IN)) {
    const { data, error: err } = await db
      .from("equivalencias")
      .update({ agrupacion_estacionalidad_id: datos.agrupacion_id })
      .in("id", tanda)
      .select("id");
    if (err) return traducirErrorDb(err, "asignar: escribir equivalencias");
    asignadas += data?.length ?? 0;
  }

  const resultado: ResultadoAsignacion = {
    asignadas,
    sin_cambio: plan.sin_cambio,
    no_encontradas: plan.no_encontradas,
    no_permitidas: plan.no_permitidas,
  };
  return ok(resultado);
}
