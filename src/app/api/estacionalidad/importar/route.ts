import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { importarEstacionalidadSchema } from "@/lib/estacionalidad/esquemas";
import { cargarEstadoEstacionalidad, leerAgrupacionesEstacionalidad } from "@/lib/estacionalidad/consultas";
import {
  enTandas,
  planificarImportacionEstacionalidad,
  type AsignacionPlan,
} from "@/lib/estacionalidad/importar";
import type { ConteosAsignar, ReporteImportacionEstacionalidad } from "@/lib/estacionalidad/tipos";

/**
 * Importador de asignaciones (`requirePlanner`). `previsualizar` devuelve el
 * reporte sin escribir; `aplicar` inserta las agrupaciones nuevas con `on
 * conflict do nothing`, las relee para obtener ids y hace un `update … where
 * id in (…)` por agrupación destino en tandas de 500. Nunca crea líneas,
 * nodos ni equivalencias, ni quita agrupaciones. Sin transacción: si una
 * tanda falla, `500` con lo escrito hasta ahí y reimportar completa el resto
 * sin duplicar ni cambiar nada más (regla 12).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarEstacionalidadSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoEstacionalidad(db);
  if (errEstado) return traducirErrorDb(errEstado, "importar estacionalidad: leer estado");

  const plan = planificarImportacionEstacionalidad(datos.filas, estado);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionEstacionalidad = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  let agrupacionesCreadas = 0;
  const escritas: ConteosAsignar = { nuevas: 0, reasignadas: 0, sin_cambio: plan.reporte.asignar.sin_cambio };

  const falloEn = (etapa: string, err: PostgrestError | string) => {
    let detalle: string;
    if (typeof err === "string") detalle = err;
    else {
      const descrito = describirErrorDb(err.code, err.message, err.details);
      if (descrito.status >= 500) registrarErrorDb(err, `importar estacionalidad: ${etapa}`);
      detalle = descrito.mensaje;
    }
    return error(
      `La importación se detuvo al ${etapa}: ${detalle} Se crearon ${agrupacionesCreadas} agrupaciones y se ` +
        `asignaron ${escritas.nuevas + escritas.reasignadas} equivalencias; vuelve a importar el mismo archivo ` +
        "para completar el resto sin duplicar.",
      500
    );
  };

  // 1. Agrupaciones nuevas (único por nombre).
  for (const tanda of enTandas(plan.agrupaciones_nuevas)) {
    const filas: TablesInsert<"agrupaciones_estacionalidad">[] = tanda.map((a) => ({ nombre: a.nombre, codigo: a.codigo }));
    const { data, error: err } = await db
      .from("agrupaciones_estacionalidad")
      .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
      .select("id");
    if (err) return falloEn("crear agrupaciones", err);
    agrupacionesCreadas += data?.length ?? 0;
  }

  const { data: agrupaciones, error: errAgrupaciones } = await leerAgrupacionesEstacionalidad(db);
  if (errAgrupaciones) return falloEn("releer agrupaciones", errAgrupaciones);
  const idPorNombre = new Map(agrupaciones.map((a) => [normalizarNombre(a.nombre), a.id]));

  // 2. Asignaciones agrupadas por destino: un update por agrupación, en tandas de 500.
  const porDestino = new Map<string, AsignacionPlan[]>();
  for (const a of plan.asignaciones) {
    const destino = a.agrupacion_id ?? idPorNombre.get(a.agrupacion_nombre);
    if (!destino) return falloEn("asignar", `no se encontró la agrupación ${a.agrupacion_nombre} después de crearla.`);
    const lista = porDestino.get(destino) ?? [];
    lista.push(a);
    porDestino.set(destino, lista);
  }

  for (const [destino, asignaciones] of porDestino) {
    const tipoPorId = new Map(asignaciones.map((a) => [a.equivalencia_id, a.tipo]));
    for (const tanda of enTandas(asignaciones.map((a) => a.equivalencia_id))) {
      const { data, error: err } = await db
        .from("equivalencias")
        .update({ agrupacion_estacionalidad_id: destino })
        .in("id", tanda)
        .select("id");
      if (err) return falloEn("asignar", err);
      for (const fila of data ?? []) {
        if (tipoPorId.get(fila.id) === "reasignada") escritas.reasignadas += 1;
        else escritas.nuevas += 1;
      }
    }
  }

  const reporte: ReporteImportacionEstacionalidad = {
    modo: "aplicar",
    ...plan.reporte,
    crear: { agrupaciones: agrupacionesCreadas },
    asignar: escritas,
  };
  return ok(reporte);
}
