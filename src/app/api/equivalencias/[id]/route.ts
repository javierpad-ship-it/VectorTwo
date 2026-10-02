import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { editarEquivalenciaSchema } from "@/lib/arbol/esquemas";
import { motivoRechazoEquivalencia } from "@/lib/arbol/reglas";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Equivalencia no encontrada.";

/**
 * Renombra, cambia el código o activa/desactiva (`requirePlanner`). Sobre la
 * genérica solo se admite `activo` (`409` si intentan renombrarla).
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

  const { data: hermanas, error: errHermanas } = await db
    .from("equivalencias")
    .select("id, nombre, codigo, es_generica, activo")
    .eq("genero_mundo_linea_id", actual.genero_mundo_linea_id);
  if (errHermanas) return traducirErrorDb(errHermanas);

  const motivo = motivoRechazoEquivalencia(hermanas ?? [], { id, ...datos });
  if (motivo) return error(motivo, 409);

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
