import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { cargarEstadoNivel, escribirNivel } from "@/lib/arbol/nivel/consultas";
import { importarNivelSchema } from "@/lib/arbol/nivel/esquemas";
import { planificarImportacionNivel } from "@/lib/arbol/nivel/importar";
import type { ReporteImportacionNivel } from "@/lib/arbol/tipos";

/**
 * Importador de niveles de planificación (`requirePlanner`, 02b). Columnas
 * `GENERO, MUNDO, LINEA, NIVEL`. `previsualizar` devuelve el reporte sin
 * escribir; `aplicar` cambia el nivel de los nodos que difieren (el archivo
 * manda) en tandas de 150. Nunca crea árbol ni toca los nodos ausentes del
 * archivo. Sin transacción: si una tanda falla, `500` con lo hecho y reimportar
 * completa el resto.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarNivelSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { estado, error: errEstado } = await cargarEstadoNivel(db);
  if (errEstado) return traducirErrorDb(errEstado, "importar niveles: leer estado");

  const plan = planificarImportacionNivel(datos.filas, estado);

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionNivel = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  let escritos = 0;
  for (const nivel of ["GMLE", "GML"] as const) {
    const ids = plan.cambios.filter((c) => c.nivel === nivel).map((c) => c.nodo_id);
    const { escritos: n, error: err } = await escribirNivel(db, ids, nivel);
    escritos += n;
    if (err) {
      const descrito = describirErrorDb(err.code, err.message, err.details);
      if (descrito.status >= 500) registrarErrorDb(err, "importar niveles");
      return error(
        `La importación se detuvo al cambiar niveles: ${descrito.mensaje} Se cambiaron ${escritos} de ` +
          `${plan.cambios.length} nodos; vuelve a importar el mismo archivo para completar el resto.`,
        500
      );
    }
  }

  const reporte: ReporteImportacionNivel = { modo: "aplicar", ...plan.reporte };
  return ok(reporte);
}
