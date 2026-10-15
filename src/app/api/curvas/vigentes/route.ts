import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { leerAgrupacionesConDatos, leerCurvasVigentes } from "@/lib/curvas/consultas";
import { aCurvaVigente } from "@/lib/curvas/reglas";
import type { CurvaVigenteApi } from "@/lib/curvas/tipos-api";

/**
 * Curvas vigentes de las agrupaciones ACTIVAS (`requirePlanner`): lo que M7
 * leerá y el CSV. Cada fila trae la `curva` (suma 1), su `acumulada` (termina en
 * 1), el `curva_id`, la `version`, las huellas con las que se calculó y la
 * `corrida_id`. Por código de agrupación.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const [agrupaciones, vigentes] = await Promise.all([leerAgrupacionesConDatos(db, { soloActivas: true }), leerCurvasVigentes(db)]);
  const fallo = agrupaciones.error ?? vigentes.error;
  if (fallo) return traducirErrorDb(fallo, "curvas vigentes");

  const porId = new Map(agrupaciones.data.map((a) => [a.id, a]));
  const filas: CurvaVigenteApi[] = [];
  for (const v of vigentes.data) {
    const a = porId.get(v.agrupacion_estacionalidad_id);
    if (!a) continue;
    filas.push(aCurvaVigente(v, { codigo: a.codigo, nombre: a.nombre }));
  }
  filas.sort((x, y) => x.codigo.localeCompare(y.codigo, "es") || x.agrupacion_id.localeCompare(y.agrupacion_id));
  return ok(filas);
}
