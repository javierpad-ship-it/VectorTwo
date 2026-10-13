import type { NextRequest } from "next/server";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { importarAgrupacionesSchema } from "@/lib/estacionalidad/esquemas";
import { cargarEstadoImportacionAgrupaciones, crearAgrupacionesConGeneros } from "@/lib/estacionalidad/consultas";
import { mensajeFalloCrearAgrupaciones, planificarImportacionAgrupaciones } from "@/lib/estacionalidad/importar-agrupaciones";
import type { ReporteImportacionAgrupaciones } from "@/lib/estacionalidad/tipos-api";

/**
 * Carga masiva de agrupaciones de estacionalidad nuevas (`requirePlanner`).
 * `previsualizar` devuelve el reporte sin escribir; `aplicar` vuelve a
 * planificar contra el estado actual y crea las agrupaciones (con sus géneros)
 * en tandas de 500 con `upsert … ignoreDuplicates`. Solo crea: lo que ya existe
 * sale como `ya_existe` y nunca se actualiza, así que reimportar el mismo
 * archivo da 0 creadas. Sin transacción: si una tanda falla, el mensaje dice
 * cuántas se crearon antes (y si alguna quedó sin género) y reimportar completa
 * el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarAgrupacionesSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoImportacionAgrupaciones(db);
  if (errEstado) return traducirErrorDb(errEstado, "importar agrupaciones: leer estado");

  const plan = planificarImportacionAgrupaciones(datos.filas, estado);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionAgrupaciones = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  const { creadas, error: errCrear, errorCompensacion, sinGenero } = await crearAgrupacionesConGeneros(db, plan.crear);
  if (errCrear) {
    // Sin transacción: el mensaje dice cuántas se crearon antes y si alguna quedó sin género.
    const descrito = describirErrorDb(errCrear.code, errCrear.message, errCrear.details);
    if (descrito.status >= 500) registrarErrorDb(errCrear, "importar agrupaciones: crear");
    if (errorCompensacion) registrarErrorDb(errorCompensacion, "importar agrupaciones: deshacer la tanda fallida");
    return error(mensajeFalloCrearAgrupaciones(descrito.mensaje, creadas, sinGenero), descrito.status >= 500 || errorCompensacion ? 500 : descrito.status);
  }

  const reporte: ReporteImportacionAgrupaciones = {
    modo: "aplicar",
    ...plan.reporte,
    totales: { ...plan.reporte.totales, creadas },
  };
  return ok(reporte);
}
