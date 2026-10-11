import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { enTandas } from "@/lib/arbol/importar";
import { cargaCaducada } from "@/lib/ventas/cargas";
import { insertarHechos, leerCodigosTalla, type HechoInsert } from "@/lib/ventas/consultas";
import { tandaSchema } from "@/lib/ventas/esquemas";
import { redondear2 } from "@/lib/ventas/numeros";
import { TANDA_INSERT_VENTAS } from "@/lib/ventas/tipos";
import type { TandaRespuesta } from "@/lib/ventas/tipos-api";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADA = "Carga no encontrada.";

/**
 * Recibe una tanda de filas de una carga `en_curso` (`requirePlanner`). Filas
 * posicionales con ids por diccionario (≈ 40 B por fila). Valida que cada
 * índice caiga en su diccionario (zod), arma las filas con la agrupación de
 * talla de CENTRALES o EXTREMAS y las escribe con `upsert … ignoreDuplicates`
 * en trozos de 2 000: la tanda es IDEMPOTENTE (si el navegador perdió la
 * respuesta y la reenvía, no duplica ni falla; la publicación sigue siendo
 * quien detecta una tanda perdida). Refresca `updated_at` de la carga (latido
 * del candado de 30 minutos). No reinterpreta nada de negocio.
 *
 * `404` carga inexistente; `409` si no está `en_curso` o caducó; `400` índices
 * o cifras inválidas.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, tandaSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: carga, error: errCarga } = await db
    .from("cargas_venta_stock")
    .select("id, estado, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (errCarga) return traducirErrorDb(errCarga, "tanda: buscar carga");
  if (!carga) return error(NO_ENCONTRADA, 404);
  if (carga.estado !== "en_curso") return error("Esa carga ya no está en curso. Vuelve a empezar el mes.", 409);
  if (cargaCaducada(carga.updated_at)) {
    return error("Esa carga caducó por falta de actividad (más de 30 minutos). Vuelve a empezar el mes.", 409);
  }

  const talla = await leerCodigosTalla(db);
  if (talla.error) return traducirErrorDb(talla.error, "tanda: agrupaciones de talla");
  const tallas = talla.data;
  if (!tallas) return error("Faltan las agrupaciones de talla CENTRALES y EXTREMAS en el catálogo.", 500);

  // Latido: condicional al estado, así una carga abandonada justo ahora responde 409.
  const { data: latido, error: errLatido } = await db
    .from("cargas_venta_stock")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "en_curso")
    .select("id");
  if (errLatido) return traducirErrorDb(errLatido, "tanda: latido");
  if (!latido || latido.length === 0) return error("Esa carga ya no está en curso. Vuelve a empezar el mes.", 409);

  const { tiendas, equivalencias, marcas } = datos.diccionario;
  const filas: HechoInsert[] = datos.filas.map(([t, e, m, tl, unidades, venta, costo, stockU, stockV]) => ({
    carga_id: id,
    tienda_id: tiendas[t],
    equivalencia_id: equivalencias[e],
    marca_id: marcas[m],
    agrupacion_talla_id: tl === 1 ? tallas.EXTREMAS : tallas.CENTRALES,
    unidades,
    venta_soles: redondear2(venta),
    costo_vendido: redondear2(costo),
    stock_unidades: stockU,
    stock_valorizado: redondear2(stockV),
  }));

  for (const trozo of enTandas(filas, TANDA_INSERT_VENTAS)) {
    const { error: err } = await insertarHechos(db, trozo);
    if (err) return traducirErrorDb(err, `tanda ${datos.tanda}: insertar filas`);
  }

  const cuerpo: TandaRespuesta = { tanda: datos.tanda, recibidas: filas.length };
  return ok(cuerpo);
}
