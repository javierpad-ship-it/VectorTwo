import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoArbol } from "@/lib/arbol/consultas";
import { actualizarMapeo, borrarMapeo, leerMapeoPorId, type MapeoUpdate } from "@/lib/ventas/consultas";
import { editarMapeoSchema } from "@/lib/ventas/esquemas";
import { errorConCodigo } from "@/lib/ventas/http";
import { crearEvaluadorMapeos, normalizarNota } from "@/lib/ventas/mapeos";
import { textoDestino } from "@/lib/ventas/resolver";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = "Mapeo no encontrado.";

/**
 * Edita un mapeo (`requirePlanner`): destino (`equivalencia_id`), nota y/o
 * `activo` (pausarlo sin borrarlo). `404` si no existe o el destino no existe;
 * `409 destino_inactivo` si el nuevo destino no es vigente. No cambia el origen
 * (para eso se crea otro) ni toca cargas ya publicadas: el efecto se ve al
 * recargar el mes. Responde el `MapeoApi` con su estado recalculado.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarMapeoSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [actual, arbol] = await Promise.all([leerMapeoPorId(db, id), cargarEstadoArbol(db)]);
  if (actual.error) return traducirErrorDb(actual.error, "editar mapeo: buscar");
  if (arbol.error) return traducirErrorDb(arbol.error, "editar mapeo: árbol");
  if (!actual.data) return error(NO_ENCONTRADO, 404);

  const evaluador = crearEvaluadorMapeos(arbol.estado);
  if (datos.equivalencia_id !== undefined) {
    const destino = evaluador.describir(datos.equivalencia_id);
    if (!destino) return error("La equivalencia de destino no existe.", 404);
    if (!destino.vigente) {
      return errorConCodigo(`El destino «${textoDestino(destino)}» está desactivado: elige otro.`, 409, "destino_inactivo");
    }
  }

  const cambio: MapeoUpdate = {};
  if (datos.equivalencia_id !== undefined) cambio.equivalencia_id = datos.equivalencia_id;
  if (datos.nota !== undefined) cambio.nota = normalizarNota(datos.nota);
  if (datos.activo !== undefined) cambio.activo = datos.activo;

  const { data, error: err } = await actualizarMapeo(db, id, cambio);
  if (err) return traducirErrorDb(err, "editar mapeo");
  return ok(evaluador.aApi(data));
}

/** Elimina un mapeo (`requirePlanner`). `404` si no existe. No toca cargas ya publicadas. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await leerMapeoPorId(db, id);
  if (errActual) return traducirErrorDb(errActual, "eliminar mapeo: buscar");
  if (!actual) return error(NO_ENCONTRADO, 404);

  const { error: err } = await borrarMapeo(db, id);
  if (err) return traducirErrorDb(err, "eliminar mapeo");
  return ok({ id });
}
