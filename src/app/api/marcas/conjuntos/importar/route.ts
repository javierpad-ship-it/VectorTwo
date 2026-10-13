import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { describirErrorDb, registrarErrorDb, traducirErrorDb } from "@/lib/api/errores-db";
import { escribirConjuntos, leerAgrupacionesMarca, leerMarcas } from "@/lib/marcas/consultas";
import { importarConjuntosSchema } from "@/lib/marcas/conjuntos/esquemas";
import { planificarImportacionConjuntos } from "@/lib/marcas/conjuntos/importar";
import type { ReporteImportacionConjuntos } from "@/lib/marcas/tipos-api";

/**
 * Importador de conjuntos, la hoja `MARCA, CONJUNTO` (`requirePlanner`, 02b).
 * `previsualizar` devuelve el reporte sin escribir; `aplicar` crea las cabezas
 * que no existan (con la agrupación de la fila que las nombra) y fija el
 * conjunto de cada marca. EL ARCHIVO MANDA: una marca que ya está en otro
 * conjunto se cambia y el reporte lo lista (`de → a`). Nunca crea marcas
 * miembro. Sin transacción: si algo falla, `500` con lo hecho y reimportar
 * completa el resto sin duplicar.
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, importarConjuntosSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const [agrupaciones, marcas] = await Promise.all([leerAgrupacionesMarca(db), leerMarcas(db)]);
  const fallo = agrupaciones.error ?? marcas.error;
  if (fallo) return traducirErrorDb(fallo, "importar conjuntos: leer estado");

  const plan = planificarImportacionConjuntos(datos.filas, { agrupaciones: agrupaciones.data, marcas: marcas.data });

  if (datos.modo === "previsualizar") {
    const reporte: ReporteImportacionConjuntos = { modo: "previsualizar", ...plan.reporte };
    return ok(reporte);
  }

  const { resultado, error: err } = await escribirConjuntos(db, plan.cabezas_nuevas, plan.asignaciones);
  if (err) {
    const descrito = describirErrorDb(err.code, err.message, err.details);
    if (descrito.status >= 500) registrarErrorDb(err, "importar conjuntos");
    return error(
      `La importación se detuvo: ${descrito.mensaje} Se crearon ${resultado.cabezas_creadas} cabezas y se asignaron ` +
        `${resultado.asignadas} marcas; vuelve a importar el mismo archivo para completar el resto sin duplicar.`,
      500
    );
  }

  const reporte: ReporteImportacionConjuntos = { modo: "aplicar", ...plan.reporte };
  return ok(reporte);
}
