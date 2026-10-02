import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { editarNodoSchema } from "@/lib/arbol/esquemas";
import { motivoRechazoEliminar, motivoRechazoMoverNodo } from "@/lib/arbol/reglas";
import type { TablesUpdate } from "@/lib/supabase/database.types";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = "Nodo no encontrado.";

/**
 * Activa/desactiva el nodo o lo mueve de mundo (`requirePlanner`).
 * `mundo_id` sirve para sacar una línea de SIN ASIGNAR; `409` si en el mundo
 * destino ya existe esa línea para ese género.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarNodoSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: nodo, error: errNodo } = await db.from("genero_mundo_linea").select("*").eq("id", id).maybeSingle();
  if (errNodo) return traducirErrorDb(errNodo);
  if (!nodo) return error(NO_ENCONTRADO, 404);

  const cambios: TablesUpdate<"genero_mundo_linea"> = {};
  if (datos.activo !== undefined) cambios.activo = datos.activo;

  if (datos.mundo_id !== undefined) {
    const [{ data: mundo, error: errMundo }, { data: hermanos, error: errHermanos }] = await Promise.all([
      db.from("mundos").select("id").eq("id", datos.mundo_id).maybeSingle(),
      db
        .from("genero_mundo_linea")
        .select("id, genero_id, mundo_id, linea_id, activo")
        .eq("genero_id", nodo.genero_id)
        .eq("linea_id", nodo.linea_id),
    ]);
    if (errMundo) return traducirErrorDb(errMundo);
    if (!mundo) return error("Mundo destino no encontrado.", 404);
    if (errHermanos) return traducirErrorDb(errHermanos);

    const motivo = motivoRechazoMoverNodo(nodo, datos.mundo_id, hermanos ?? []);
    if (motivo) return error(motivo, 409);
    cambios.mundo_id = datos.mundo_id;
  }

  const { data, error: err } = await db.from("genero_mundo_linea").update(cambios).eq("id", id).select("*").single();
  if (err) return traducirErrorDb(err);
  return ok(data);
}

/** Elimina el nodo si no tiene equivalencias (`requirePlanner`); `409` si las tiene. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADO);
  if (respuesta) return respuesta;
  const db = supabaseAdmin();
  const [{ data: nodo, error: errNodo }, { count, error: errCount }] = await Promise.all([
    db.from("genero_mundo_linea").select("id").eq("id", id).maybeSingle(),
    db.from("equivalencias").select("id", { count: "exact", head: true }).eq("genero_mundo_linea_id", id),
  ]);
  if (errNodo) return traducirErrorDb(errNodo);
  if (!nodo) return error(NO_ENCONTRADO, 404);
  if (errCount) return traducirErrorDb(errCount);

  const motivo = motivoRechazoEliminar("nodo", count ?? 0);
  if (motivo) return error(motivo, 409);

  const { error: err } = await db.from("genero_mundo_linea").delete().eq("id", id);
  if (err) return traducirErrorDb(err);
  return ok({ id });
}
