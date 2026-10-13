import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { editarMarcaSchema } from "@/lib/marcas/esquemas";
import { contarHechos } from "@/lib/ventas/consultas";
import { contarMiembros, leerMarcaPorId, leerMarcas } from "@/lib/marcas/consultas";
import { contarAsignacionesDeMarca } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml, filasDeMarcas } from "@/lib/marcas/gml/estado";
import { motivoRechazoConjunto } from "@/lib/marcas/conjuntos/reglas";
import {
  AGRUPACION_NO_ENCONTRADA,
  motivoRechazoAgrupacionDestino,
  motivoRechazoEliminarMarca,
  normalizarTratamiento,
} from "@/lib/marcas/reglas";
import type { EliminarMarcaRespuesta } from "@/lib/marcas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Marca no encontrada.";

/**
 * Edita una marca (`requirePlanner`): nombre, código, agrupación, tratamiento
 * especial, nota, modalidad, conjunto y/o activo. `404` si no existe; si el
 * cuerpo trae `agrupacion_marca_id`, la agrupación destino debe existir (`404`)
 * y estar activa (`409`); un PATCH que no la toca sobre una marca de agrupación
 * inactiva sí se permite. La coherencia nota y modalidad ↔ bandera la resuelve
 * `normalizarTratamiento` (regla 6, 02b): desmarcar borra la nota y la
 * modalidad pero NO toca las asignaciones por GML; nota o modalidad sin bandera
 * → `400`; marcar sin modalidad deja `por_gml` si ya tiene GML y `barrido` si
 * no. Con `conjunto_marca_id` (entrar, cambiar o salir) `motivoRechazoConjunto`
 * (regla 21) responde `404` cabeza inexistente o `409`; entrar a un conjunto no
 * toca la casilla, la modalidad ni las asignaciones propias (quedan ignoradas).
 * Únicos repetidos → `409`. Devuelve la fila completa (con `gml_asignados` y
 * `avisos_conjunto`).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarMarcaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await leerMarcaPorId(db, id);
  if (errActual) return traducirErrorDb(errActual, "buscar marca");
  if (!actual) return error(NO_ENCONTRADA, 404);

  if (datos.agrupacion_marca_id !== undefined) {
    const { data: agrupacion, error: errAgrupacion } = await db
      .from("agrupaciones_marca")
      .select("id, nombre, activo")
      .eq("id", datos.agrupacion_marca_id)
      .maybeSingle();
    if (errAgrupacion) return traducirErrorDb(errAgrupacion, "buscar agrupación de marca");
    const motivo = motivoRechazoAgrupacionDestino(agrupacion);
    if (motivo) return error(motivo, motivo === AGRUPACION_NO_ENCONTRADA ? 404 : 409);
  }

  const { tratamiento_especial, nota_tratamiento, modalidad_tratamiento, conjunto_marca_id, ...resto } = datos;
  const cambio: TablesUpdate<"marcas"> = { ...resto };

  if (tratamiento_especial !== undefined || nota_tratamiento !== undefined || modalidad_tratamiento !== undefined) {
    const { cuenta, error: errCuenta } = await contarAsignacionesDeMarca(db, id);
    if (errCuenta) return traducirErrorDb(errCuenta, "contar GML de la marca");
    const resultado = normalizarTratamiento({ tratamiento_especial, nota_tratamiento, modalidad_tratamiento }, actual, cuenta);
    if (resultado.motivo !== null) return error(resultado.motivo, 400);
    cambio.tratamiento_especial = resultado.valor.tratamiento_especial;
    cambio.nota_tratamiento = resultado.valor.nota_tratamiento;
    cambio.modalidad_tratamiento = resultado.valor.modalidad_tratamiento;
  }

  if (conjunto_marca_id !== undefined) {
    if (conjunto_marca_id !== null) {
      const marcas = await leerMarcas(db);
      if (marcas.error) return traducirErrorDb(marcas.error, "leer marcas para el conjunto");
      const cabeza = marcas.data.find((m) => m.id === conjunto_marca_id);
      const rechazo = motivoRechazoConjunto(actual, cabeza, marcas.data);
      if (rechazo) return error(rechazo.mensaje, rechazo.status);
    }
    cambio.conjunto_marca_id = conjunto_marca_id;
  }

  const { error: err } = await db.from("marcas").update(cambio).eq("id", id);
  if (err) return traducirErrorDb(err, "editar marca");

  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "editar marca: leer estado");
  const [fila] = filasDeMarcas(cargado, new Set([id]));
  return ok(fila);
}

/**
 * Elimina la marca (`requirePlanner`); `409` con el conteo si tiene venta o
 * stock cargados (M5: el conteo usa el índice `(marca_id, carga_id)` y es
 * instantáneo; el `restrict` de la FK es la red de seguridad) o si es cabeza de
 * un conjunto con miembros (02b: quita los miembros o desactívala). La cascada
 * borra sus asignaciones por GML y la respuesta es `{ id, gml_eliminados }`.
 * Eliminar un miembro simplemente lo saca del conjunto.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("marcas").select("id").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual, "buscar marca");
  if (!actual) return error(NO_ENCONTRADA, 404);

  const [hechos, miembros, gml] = await Promise.all([
    contarHechos(db, "marca_id", id),
    contarMiembros(db, id),
    contarAsignacionesDeMarca(db, id),
  ]);
  const fallo = hechos.error ?? miembros.error ?? gml.error;
  if (fallo) return traducirErrorDb(fallo, "contar lo que cuelga de la marca");
  const motivo = motivoRechazoEliminarMarca(hechos.cuenta, miembros.cuenta);
  if (motivo) return error(motivo, 409);

  const { error: err } = await db.from("marcas").delete().eq("id", id);
  if (err) return traducirErrorDb(err, "eliminar marca");
  const cuerpo: EliminarMarcaRespuesta = { id, gml_eliminados: gml.cuenta };
  return ok(cuerpo);
}
