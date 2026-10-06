import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { editarTiendaSchema } from "@/lib/tiendas/esquemas";
import { aTiendaFila } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { motivoRechazoEliminar, motivoRechazoTienda } from "@/lib/tiendas/reglas";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Tienda no encontrada.";

/**
 * Edita una tienda (`requirePlanner`): cualquier columna y/o `activo`.
 * `404` si no existe. La coherencia cruzada (cierre exige apertura, cierre ≥
 * apertura, CD sin venta) se comprueba con `motivoRechazoTienda` sobre
 * `{ ...actual, ...cambio }` antes de escribir (`400`); únicos repetidos →
 * `409`. La respuesta lleva el `estado` calculado con `hoyLima()`.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarTiendaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("tiendas").select("*").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual, "buscar tienda");
  if (!actual) return error(NO_ENCONTRADA, 404);

  const motivo = motivoRechazoTienda({ ...actual, ...datos });
  if (motivo) return error(motivo.mensaje, 400);

  const cambio: TablesUpdate<"tiendas"> = { ...datos };
  const { data, error: err } = await db.from("tiendas").update(cambio).eq("id", id).select("*").single();
  if (err) return traducirErrorDb(err, "editar tienda");
  return ok(aTiendaFila(data, hoyLima()));
}

/**
 * Elimina la tienda (`requirePlanner`); `409` si tiene hijos (ninguno en M4;
 * a partir de M5 colgarán venta y stock, y el `restrict` lo garantizará).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("tiendas").select("id").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual, "buscar tienda");
  if (!actual) return error(NO_ENCONTRADA, 404);

  // Sin tablas hijas en M4: el conteo es 0 y la regla deja pasar.
  const motivo = motivoRechazoEliminar("tienda", 0);
  if (motivo) return error(motivo, 409);

  const { error: err } = await db.from("tiendas").delete().eq("id", id);
  if (err) return traducirErrorDb(err, "eliminar tienda");
  return ok({ id });
}
