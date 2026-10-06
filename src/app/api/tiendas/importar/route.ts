import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { CODIGO_UNICO, describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { importarTiendasSchema } from "@/lib/tiendas/esquemas";
import { cargarEstadoTiendas } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { enTandas, planificarImportacionTiendas } from "@/lib/tiendas/importar";
import type { ConteosCrearTiendas, ReporteImportacionTiendas } from "@/lib/tiendas/tipos";

const MENSAJE_CODIGO_REPETIDO_AL_APLICAR = "Ya existe una tienda con ese código. Vuelve a previsualizar.";

/**
 * Importador de tiendas (`requirePlanner`). `previsualizar` devuelve el
 * reporte sin escribir; `aplicar` inserta las tiendas nuevas con `insert`
 * plano en tandas de 500 y cuenta lo realmente insertado. El plan ya excluyó
 * los códigos existentes (el único es sobre `upper(codigo)`, que PostgREST no
 * admite en `onConflict`); si alguien creó una de esas tiendas entre
 * previsualizar y aplicar, el `23505` responde `409` y reimportar completa
 * el resto sin duplicar. Nunca modifica tiendas existentes. Sin transacción.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarTiendasSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoTiendas(db);
  if (errEstado) return traducirErrorDb(errEstado, "importar tiendas: leer estado");

  const hoy = hoyLima();
  const plan = planificarImportacionTiendas(datos.filas, estado, hoy);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionTiendas = { modo: "previsualizar", hoy, ...plan.reporte };
    return ok(reporte);
  }

  const creados: ConteosCrearTiendas = { tiendas: 0, centros_distribucion: 0, sin_fecha_apertura: 0 };

  const fallo = (err: PostgrestError) => {
    if (err.code === CODIGO_UNICO) return error(MENSAJE_CODIGO_REPETIDO_AL_APLICAR, 409);
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, "importar tiendas");
    return error(
      `La importación se detuvo al crear tiendas: ${descrito.mensaje} Se crearon ${creados.tiendas} tiendas ` +
        `y ${creados.centros_distribucion} centros de distribución; vuelve a importar el mismo archivo ` +
        "para completar el resto sin duplicar.",
      descrito.status >= 500 ? 500 : descrito.status
    );
  };

  for (const tanda of enTandas(plan.tiendas)) {
    const filas: TablesInsert<"tiendas">[] = tanda.map((t) => ({ ...t }));
    const { data, error: err } = await db.from("tiendas").insert(filas).select("tipo, fecha_apertura");
    if (err) return fallo(err);
    for (const fila of data ?? []) {
      if (fila.tipo === "Centro de Distribución") creados.centros_distribucion += 1;
      else {
        creados.tiendas += 1;
        if (fila.fecha_apertura === null) creados.sin_fecha_apertura += 1;
      }
    }
  }

  const reporte: ReporteImportacionTiendas = { modo: "aplicar", hoy, ...plan.reporte, crear: creados };
  return ok(reporte);
}
