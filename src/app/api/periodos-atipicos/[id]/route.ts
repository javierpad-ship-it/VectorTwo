import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { rangoValido } from "@/lib/curvas/atipicos";
import { actualizarPeriodo, aPeriodoApi, borrarPeriodo, cambioDePeriodo, leerPeriodoPorId } from "@/lib/curvas/consultas";
import { editarPeriodoAtipicoSchema, MENSAJE_RANGO_INVERTIDO } from "@/lib/curvas/esquemas";
import type { EliminarPeriodoAtipicoRespuesta } from "@/lib/curvas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const PERIODO_NO_ENCONTRADO = "Periodo atípico no encontrado.";

/**
 * Edita desde, hasta, motivo, descripción, temporadas (o el alcance heredado) y/o activo
 * (`requirePlanner`). `404` si no existe; `400` si el rango resultante (contra
 * la fila actual cuando solo viene un extremo) queda invertido o el cuerpo no
 * trae nada que cambiar. Cambiar un periodo no recalcula nada.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, PERIODO_NO_ENCONTRADO);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarPeriodoAtipicoSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await leerPeriodoPorId(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar periodo atípico");
  if (!actual) return error(PERIODO_NO_ENCONTRADO, 404);

  const desde = datos.desde ?? recortarPeriodo(actual.desde);
  const hasta = datos.hasta ?? recortarPeriodo(actual.hasta);
  if (!rangoValido(desde, hasta)) return error(MENSAJE_RANGO_INVERTIDO, 400);

  const cambio = cambioDePeriodo(datos);

  const { data, error: err } = await actualizarPeriodo(db, id, cambio);
  if (err) return traducirErrorDb(err, "editar periodo atípico");
  if (!data) return error(PERIODO_NO_ENCONTRADO, 404);
  return ok(aPeriodoApi(data));
}

/**
 * Elimina el periodo (`requirePlanner`), `{ id }`; `404` si no existe. Se
 * permite siempre: nada cuelga de un periodo (las corridas guardan copia de los
 * meses atípicos que usaron).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, PERIODO_NO_ENCONTRADO);
  if (respuestaId) return respuestaId;

  const { data, error: err } = await borrarPeriodo(supabaseAdmin(), id);
  if (err) return traducirErrorDb(err, "eliminar periodo atípico");
  if (!data) return error(PERIODO_NO_ENCONTRADO, 404);
  const cuerpo: EliminarPeriodoAtipicoRespuesta = { id: data.id };
  return ok(cuerpo);
}
