import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { importarMarcasSchema } from "@/lib/marcas/esquemas";
import { cargarEstadoMarcas } from "@/lib/marcas/consultas";
import { enTandas, planificarImportacionMarcas } from "@/lib/marcas/importar";
import type { ConteosCrearMarcas, ReporteImportacionMarcas } from "@/lib/marcas/tipos";

/**
 * Importador de marcas (`requirePlanner`). `previsualizar` devuelve el
 * reporte sin escribir; `aplicar` inserta las marcas nuevas en tandas de 500
 * con `upsert … onConflict: "nombre", ignoreDuplicates` y cuenta lo realmente
 * insertado. Nunca crea agrupaciones ni modifica marcas existentes. Sin
 * transacción: si una tanda falla, `500` con lo creado hasta ahí y reimportar
 * completa el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarMarcasSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoMarcas(db);
  if (errEstado) return traducirErrorDb(errEstado, "importar marcas: leer estado");

  const plan = planificarImportacionMarcas(datos.filas, estado);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionMarcas = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  const creados: ConteosCrearMarcas = { marcas: 0, con_tratamiento_especial: 0 };

  const fallo = (err: PostgrestError) => {
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, "importar marcas");
    return error(
      `La importación se detuvo al crear marcas: ${descrito.mensaje} Se crearon ${creados.marcas} marcas ` +
        `(${creados.con_tratamiento_especial} con tratamiento especial); vuelve a importar el mismo archivo ` +
        "para completar el resto sin duplicar.",
      500
    );
  };

  for (const tanda of enTandas(plan.marcas)) {
    const filas: TablesInsert<"marcas">[] = tanda.map((m) => ({
      nombre: m.nombre,
      codigo: m.codigo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      tratamiento_especial: m.tratamiento_especial,
    }));
    const { data, error: err } = await db
      .from("marcas")
      .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
      .select("id, tratamiento_especial");
    if (err) return fallo(err);
    for (const fila of data ?? []) {
      creados.marcas += 1;
      if (fila.tratamiento_especial) creados.con_tratamiento_especial += 1;
    }
  }

  const reporte: ReporteImportacionMarcas = { modo: "aplicar", ...plan.reporte, crear: creados };
  return ok(reporte);
}
