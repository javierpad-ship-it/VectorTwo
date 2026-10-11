import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { destinoDescarte, exigirTransicion } from "@/lib/ventas/cargas";
import { aCargaApi, leerCargaConReporte, leerCargasDePeriodo, type CargaLeida } from "@/lib/ventas/consultas";
import { comoObjeto } from "@/lib/ventas/http";
import type { DescartarCargaRespuesta, DetalleCargaRespuesta, EstadoCarga } from "@/lib/ventas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Carga no encontrada.";

/**
 * Detalle de una carga (`requirePlanner`; añadido a la ficha): la carga con el
 * reporte que se guardó al cargarla (exclusiones y avisos de aquel mes) y el
 * historial de las otras cargas del mismo mes (reemplazadas, retiradas…).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data, error: err } = await leerCargaConReporte(db, id);
  if (err) return traducirErrorDb(err, "detalle de carga");
  if (!data) return error(NO_ENCONTRADA, 404);

  const { reporte, ...resto } = data;
  const historial = await leerCargasDePeriodo(db, data.periodo);
  if (historial.error) return traducirErrorDb(historial.error, "detalle de carga: historial");

  const incompleto = comoObjeto(reporte)?.incompleto ?? null;
  const cuerpo: DetalleCargaRespuesta = {
    carga: aCargaApi({ ...resto, incompleto: incompleto as CargaLeida["incompleto"] }),
    reporte: comoObjeto(reporte) ?? {},
    historial: historial.data.filter((c) => c.id !== id).map(aCargaApi),
  };
  return ok(cuerpo);
}

/**
 * Descarta una carga (`requirePlanner`): `en_curso` → `abandonada`; `publicada`
 * → `retirada` (el mes deja de verse; las filas se limpian después). `409` en
 * cualquier otro estado. Con `?solo=en_curso` (lo usa el flujo de carga) solo
 * descarta cargas `en_curso`: ante una publicación ambigua (se cortó la
 * respuesta) un descarte automático nunca debe retirar un mes ya publicado; el
 * retiro de `publicada` es una acción manual de "Cargas por mes". El `update` es condicional al estado leído, así que
 * una carrera (se publicó justo ahora) responde `409` en vez de pisar nada.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db.from("cargas_venta_stock").select("id, estado").eq("id", id).maybeSingle();
  if (errActual) return traducirErrorDb(errActual, "descartar carga: buscar");
  if (!actual) return error(NO_ENCONTRADA, 404);

  const destino = destinoDescarte(actual.estado, request.nextUrl.searchParams.get("solo") === "en_curso");
  if ("mensaje" in destino) return error(destino.mensaje, 409);
  const a = destino.a;
  const de: EstadoCarga = a === "abandonada" ? "en_curso" : "publicada";
  exigirTransicion(de, a);

  const { data, error: err } = await db
    .from("cargas_venta_stock")
    .update({ estado: a })
    .eq("id", id)
    .eq("estado", de)
    .select("id, estado");
  if (err) return traducirErrorDb(err, "descartar carga: actualizar");
  if (!data || data.length === 0) return error("La carga cambió de estado mientras tanto. Vuelve a mirar el listado.", 409);

  const cuerpo: DescartarCargaRespuesta = { id, estado: a };
  return ok(cuerpo);
}
