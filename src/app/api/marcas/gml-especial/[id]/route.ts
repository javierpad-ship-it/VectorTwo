import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { actualizarNotaAsignacion, borrarAsignacion, leerAsignacionPorId } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { editarGmlEspecialSchema } from "@/lib/marcas/gml/esquemas";
import { describirAsignacion } from "@/lib/marcas/gml/vista";
import type { EditarGmlEspecialRespuesta, EliminarGmlEspecialRespuesta } from "@/lib/marcas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Asignación no encontrada.";

/** Edita la nota de una asignación (`requirePlanner`); `""` o `null` la borra. `404` si no existe. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarGmlEspecialSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await leerAsignacionPorId(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar asignación");
  if (!actual) return error(NO_ENCONTRADA, 404);

  const { data, error: err } = await actualizarNotaAsignacion(db, id, datos.nota);
  if (err || !data) {
    return err ? traducirErrorDb(err, "editar nota de la asignación") : error(NO_ENCONTRADA, 404);
  }

  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "editar asignación: leer estado");
  const marca = cargado.estado.marcas.find((m) => m.id === data.marca_id);
  const asignacion = marca ? describirAsignacion(data, marca, cargado.estado) : undefined;
  if (!asignacion) return error(NO_ENCONTRADA, 404);
  const cuerpo: EditarGmlEspecialRespuesta = { ...asignacion, marca_id: data.marca_id };
  return ok(cuerpo);
}

/** Quita una asignación (`requirePlanner`); siempre se permite, también las ignoradas. `404` si no existe. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await leerAsignacionPorId(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar asignación");
  if (!actual) return error(NO_ENCONTRADA, 404);

  const { error: err } = await borrarAsignacion(db, id);
  if (err) return traducirErrorDb(err, "quitar asignación");
  const cuerpo: EliminarGmlEspecialRespuesta = { id };
  return ok(cuerpo);
}
