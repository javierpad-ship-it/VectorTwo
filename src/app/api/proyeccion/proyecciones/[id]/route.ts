import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { editarSchema } from "@/lib/proyeccion/esquemas";
import { editarProyeccion, eliminarProyeccion, leerProyeccion } from "@/lib/proyeccion/servicio";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Proyección no encontrada.";

/** Una proyección con sus bloques, el motivo por el que está desactualizada (si lo está) y si se está calculando (`requirePlanner`). */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await leerProyeccion(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/**
 * Edita nombre, nota, «datos hasta» o parámetros (`requirePlanner`). Cambiar los parámetros o el mes la marca
 * `recalculo_pendiente`. `409 cerrada` / `409 calculo_en_curso`.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarSchema);
  if (respuesta) return respuesta;
  const r = await editarProyeccion(id, datos);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}

/** Elimina una proyección `en_trabajo` sin decisiones (`requirePlanner`); si no, `409` y se archiva. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const r = await eliminarProyeccion(id);
  if (r.respuesta) return r.respuesta;
  return ok(r.data);
}
