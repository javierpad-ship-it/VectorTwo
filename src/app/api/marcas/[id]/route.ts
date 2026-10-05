import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { editarMarcaSchema } from "@/lib/marcas/esquemas";
import { SELECT_MARCA_CON_AGRUPACION, aMarcaFila } from "@/lib/marcas/consultas";
import {
  AGRUPACION_NO_ENCONTRADA,
  motivoRechazoAgrupacionDestino,
  motivoRechazoEliminar,
  normalizarTratamiento,
} from "@/lib/marcas/reglas";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Marca no encontrada.";

/**
 * Edita una marca (`requirePlanner`): nombre, código, agrupación, tratamiento
 * especial, nota y/o activo. `404` si no existe; si el cuerpo trae
 * `agrupacion_marca_id`, la agrupación destino debe existir (`404`) y estar
 * activa (`409`); un PATCH que no la toca sobre una marca de agrupación
 * inactiva sí se permite. La coherencia nota ↔ bandera la resuelve
 * `normalizarTratamiento` (regla 6): desmarcar borra la nota; nota sin
 * bandera → `400`. Únicos repetidos → `409`.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarMarcaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("marcas").select("*").eq("id", id).maybeSingle();
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

  const { tratamiento_especial, nota_tratamiento, ...resto } = datos;
  const cambio: TablesUpdate<"marcas"> = { ...resto };
  if (tratamiento_especial !== undefined || nota_tratamiento !== undefined) {
    const resultado = normalizarTratamiento({ tratamiento_especial, nota_tratamiento }, actual);
    if (resultado.motivo !== null) return error(resultado.motivo, 400);
    cambio.tratamiento_especial = resultado.valor.tratamiento_especial;
    cambio.nota_tratamiento = resultado.valor.nota_tratamiento;
  }

  const { data, error: err } = await db
    .from("marcas")
    .update(cambio)
    .eq("id", id)
    .select(SELECT_MARCA_CON_AGRUPACION)
    .single();
  if (err) return traducirErrorDb(err, "editar marca");
  return ok(aMarcaFila(data));
}

/**
 * Elimina la marca (`requirePlanner`); `409` si tiene hijos (ninguno en M2;
 * a partir de M5 colgarán venta y stock, y el `restrict` lo garantiza).
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

  // Sin tablas hijas en M2: el conteo es 0 y la regla deja pasar.
  const motivo = motivoRechazoEliminar("marca", 0);
  if (motivo) return error(motivo, 409);

  const { error: err } = await db.from("marcas").delete().eq("id", id);
  if (err) return traducirErrorDb(err, "eliminar marca");
  return ok({ id });
}
