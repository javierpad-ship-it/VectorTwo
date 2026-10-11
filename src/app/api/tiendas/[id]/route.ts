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
import { contarHechos } from "@/lib/ventas/consultas";

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
 * Elimina la tienda (`requirePlanner`); `409` con el conteo si tiene venta o
 * stock cargados (M5; el `restrict` de la FK es la red de seguridad).
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

  // M5: la venta y el stock cargados cuelgan de la tienda. El conteo por tienda
  // escanea la tabla (≈ 0,5 a 2 s) pero solo corre al intentar eliminar. Si el
  // conteo fallara (p. ej. por el tiempo máximo de la sentencia), no se bloquea
  // la pantalla: el `restrict` de la FK sigue siendo la garantía y `DELETE`
  // responde `409` por `errores-db.ts`.
  const { cuenta, error: errCuenta } = await contarHechos(db, "tienda_id", id);
  if (errCuenta) console.error("[db] contar hechos de la tienda", errCuenta.message);
  const motivo = motivoRechazoEliminar("tienda", errCuenta ? 0 : cuenta);
  if (motivo) return error(motivo, 409);

  const { error: err } = await db.from("tiendas").delete().eq("id", id);
  if (err) return traducirErrorDb(err, "eliminar tienda");
  return ok({ id });
}
