import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { diferenciasMedidas, mensajeNoConcilia } from "@/lib/ventas/cargas";
import { SELECT_CARGA, aCargaApi, type CargaLeida } from "@/lib/ventas/consultas";
import { publicarSchema } from "@/lib/ventas/esquemas";
import { argumentosPublicar, errorConCodigo, leerResultadoPublicar } from "@/lib/ventas/http";
import type { PublicarRespuesta } from "@/lib/ventas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Carga no encontrada.";

/**
 * Publica una carga (`requirePlanner`) llamando a `publicar_carga_venta_stock`,
 * que en una sola transacción mide lo que hay en la base, lo compara con lo que
 * el cliente dice haber enviado y, si cuadra, pasa la carga anterior del mes a
 * `reemplazada` y esta a `publicada` con sus totales medidos. Si no cuadra, la
 * carga queda `fallida`, el mes anterior sigue intacto y responde `409` con
 * `{ esperado, medido, diferencias }`. `409` también si ya no estaba `en_curso`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, publicarSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: existe, error: errExiste } = await db.from("cargas_venta_stock").select("id").eq("id", id).maybeSingle();
  if (errExiste) return traducirErrorDb(errExiste, "publicar: buscar carga");
  if (!existe) return error(NO_ENCONTRADA, 404);

  // `esperado` ya viene exacto (validado con hasta 2 decimales): no se vuelve a redondear.
  const esperado = datos.esperado;
  const { data: resultado, error: errPublicar } = await db.rpc("publicar_carga_venta_stock", argumentosPublicar(id, esperado));
  if (errPublicar) return traducirErrorDb(errPublicar, "publicar carga");

  const r = leerResultadoPublicar(resultado);
  if (!r.ok && r.motivo === "no_en_curso") {
    return error("Esa carga ya no está en curso (se publicó, se abandonó o caducó). Vuelve a empezar el mes.", 409);
  }
  if (!r.ok) {
    // No concilia: la carga pasa a `fallida` (solo si sigue en curso) y el mes anterior queda intacto.
    const { error: errFallida } = await db
      .from("cargas_venta_stock")
      .update({ estado: "fallida" })
      .eq("id", id)
      .eq("estado", "en_curso");
    if (errFallida) console.error("[db] marcar carga fallida", errFallida.message);
    return errorConCodigo(mensajeNoConcilia(esperado, r.medido), 409, "no_concilia", {
      esperado,
      medido: r.medido,
      diferencias: diferenciasMedidas(esperado, r.medido),
    });
  }

  const { data: carga, error: errCarga } = await db.from("cargas_venta_stock").select(SELECT_CARGA).eq("id", id).single();
  if (errCarga) return traducirErrorDb(errCarga, "publicar: leer carga");

  const cuerpo: PublicarRespuesta = { carga: aCargaApi(carga as CargaLeida), medido: r.medido, reemplaza: r.reemplaza };
  return ok(cuerpo);
}
