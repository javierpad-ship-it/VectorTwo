import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { editarEquivalenciaSchema } from "@/lib/arbol/esquemas";
import { motivoRechazoEquivalencia } from "@/lib/arbol/reglas";
import { leerDestino, leerGeneros } from "@/lib/estacionalidad/agrupaciones";
import { rechazoAsignacion } from "@/lib/estacionalidad/reglas";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Equivalencia no encontrada.";

/**
 * Renombra, cambia el código, activa/desactiva o asigna la agrupación de
 * estacionalidad (`requirePlanner`). Sobre la genérica solo se admiten
 * `activo` y `agrupacion_estacionalidad_id` (`409` si intentan renombrarla).
 * Si el cuerpo trae `agrupacion_estacionalidad_id` no nulo, la agrupación
 * debe existir (`404`), estar activa (`409`), tener géneros (`409`) e incluir
 * el género del nodo de la equivalencia (`409`); `null` la quita sin
 * comprobar nada. Se comprueba antes del `update` para que la violación de FK
 * nunca llegue a la base. Devuelve la fila completa (con
 * `agrupacion_estacionalidad_id`).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarEquivalenciaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("equivalencias").select("*").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual);
  if (!actual) return error(NO_ENCONTRADA, 404);

  const { agrupacion_estacionalidad_id, ...cambio } = datos;

  if (Object.keys(cambio).length > 0) {
    const { data: hermanas, error: errHermanas } = await db
      .from("equivalencias")
      .select("id, nombre, codigo, es_generica, activo")
      .eq("genero_mundo_linea_id", actual.genero_mundo_linea_id);
    if (errHermanas) return traducirErrorDb(errHermanas);

    const motivo = motivoRechazoEquivalencia(hermanas ?? [], { id, ...cambio });
    if (motivo) return error(motivo, 409);
  }

  if (agrupacion_estacionalidad_id !== undefined && agrupacion_estacionalidad_id !== null) {
    const destino = await leerDestino(db, agrupacion_estacionalidad_id);
    if (destino.error) return traducirErrorDb(destino.error, "buscar agrupación de estacionalidad");

    // Género del nodo de la equivalencia: lo pide la regla "solo a agrupaciones que incluyan su género".
    const { data: nodo, error: errNodo } = await db
      .from("genero_mundo_linea")
      .select("genero_id")
      .eq("id", actual.genero_mundo_linea_id)
      .maybeSingle();
    if (errNodo) return traducirErrorDb(errNodo, "buscar nodo de la equivalencia");
    const generos = await leerGeneros(db);
    if (generos.error) return traducirErrorDb(generos.error, "buscar género de la equivalencia");
    const generoId = nodo?.genero_id ?? "";
    const genero = { id: generoId, nombre: generos.data.find((g) => g.id === generoId)?.nombre ?? "" };

    const rechazo = rechazoAsignacion(destino.data, false, genero);
    if (rechazo) return error(rechazo.mensaje, rechazo.status);
  }

  const { data, error: err } = await db.from("equivalencias").update(datos).eq("id", id).select("*").single();
  if (err) return traducirErrorDb(err);
  return ok(data);
}

/** Elimina la equivalencia (`requirePlanner`); `409` si tiene hijos (a partir de M2). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;
  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("equivalencias").select("id").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual);
  if (!actual) return error(NO_ENCONTRADA, 404);

  const { error: err } = await db.from("equivalencias").delete().eq("id", id);
  if (err) return traducirErrorDb(err);
  return ok({ id });
}
