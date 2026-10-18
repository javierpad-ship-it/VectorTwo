import type { NextRequest } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { marcarPorGml } from "@/lib/marcas/consultas";
import { insertarAsignacionesSiNoExisten } from "@/lib/marcas/gml/consultas";
import { cargarEstadoGml } from "@/lib/marcas/gml/estado";
import { importarGmlSchema } from "@/lib/marcas/gml/esquemas";
import { planificarImportacionGml } from "@/lib/marcas/gml/importar";
import type { ReporteImportacionGml } from "@/lib/marcas/tipos-api";

/**
 * Importador de marcas relevantes por GML, la hoja `MARCA, GENERO, MUNDO,
 * LINEA, NOTA` (`requirePlanner`, 02b). `previsualizar` devuelve el reporte sin
 * escribir; `aplicar` inserta los pares nuevos (`upsert … ignoreDuplicates`,
 * tandas de 500) y deja marcadas `por_gml` las marcas sin casilla, al barrer o
 * sin modalidad que reciben GML (tandas de 150), que el reporte lista antes en
 * `cambios_marca`. Nunca crea árbol ni marcas y no quita lo que el archivo no
 * traiga. M12: una marca al barrer necesita la columna `MODALIDAD` (`POR_GML` o `MIXTA`); sin ella sus filas nuevas se omiten
 * con `modalidad_destino_requerida`. Sin transacción: si algo falla, `500` con lo hecho y reimportar
 * completa el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarGmlSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const cargado = await cargarEstadoGml(db);
  if (cargado.error) return traducirErrorDb(cargado.error, "importar marcas relevantes: leer estado");

  const plan = planificarImportacionGml(datos.filas, {
    ...cargado.arbol,
    marcas: cargado.estado.marcas,
    asignaciones: cargado.estado.asignaciones,
  });

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionGml = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  const detener = (err: PostgrestError, haciendo: string, hecho: string) => {
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, "importar marcas relevantes");
    return error(
      `La importación se detuvo al ${haciendo}: ${descrito.mensaje} ${hecho} Vuelve a importar el mismo archivo para completar el resto sin duplicar.`,
      500
    );
  };

  const { insertadas, error: errInsertar } = await insertarAsignacionesSiNoExisten(
    db,
    plan.asignaciones.map((a) => ({ marca_id: a.marca_id, genero_mundo_linea_id: a.genero_mundo_linea_id, nota: a.nota }))
  );
  if (errInsertar) return detener(errInsertar, "crear las asignaciones", `Se crearon ${insertadas} asignaciones.`);

  const mixtas = new Set(plan.marcar_mixta_ids);
  const soloPorGml = plan.marcar_ids.filter((id) => !mixtas.has(id));
  const errMarcar =
    (soloPorGml.length > 0 ? (await marcarPorGml(db, soloPorGml, false)).error : null) ??
    (plan.marcar_mixta_ids.length > 0 ? (await marcarPorGml(db, plan.marcar_mixta_ids, true)).error : null);
  if (errMarcar) {
    return detener(
      errMarcar,
      "marcar las marcas como Por GML o Mixta",
      `Se crearon ${insertadas} asignaciones, pero algunas marcas siguen sin marcar y sus GML aparecen ignorados.`
    );
  }

  const reporte: ReporteImportacionGml = {
    modo: "aplicar",
    ...plan.reporte,
    crear: { ...plan.reporte.crear, asignaciones: insertadas },
  };
  return ok(reporte);
}
