import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { ok, error } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aCorridaResumen, aPeriodoApi, leerAgrupacionesConDatos, leerPeriodos } from "@/lib/curvas/consultas";
import { comoEfecto, comoResultado } from "@/lib/curvas/consultas";
import { leerCorridaId } from "@/lib/curvas/esquemas";
import { resolverCorrida } from "@/lib/curvas/lectura";
import { TEMPORADAS_AGRUPACION, type AniosAtipicosNinoApi, type ClaseAnioCurva, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";

/**
 * Lo que alimenta la pestaña Años Niño (`requirePlanner`; `?corrida_id=`, por
 * defecto la de REFERENCIA): el efecto de la corrida (ratios por temporada con su
 * control y relativo, crecimiento normal, forma), los periodos activos, la clase
 * de cada año por temporada, el efecto por agrupación y las series de las
 * temporadas. Sin corrida, `corrida: null`. NO lee la vista materializada. `404`
 * si el `corrida_id` no existe.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { corridaId, rechazo } = leerCorridaId(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const db = supabaseAdmin();
  const [corrida, periodos, agrupaciones] = await Promise.all([
    resolverCorrida(db, corridaId, { ultimaSiNoHayReferencia: false }),
    leerPeriodos(db, { soloActivos: true }),
    leerAgrupacionesConDatos(db, { soloActivas: false }),
  ]);
  const fallo = periodos.error ?? agrupaciones.error;
  if (fallo) return traducirErrorDb(fallo, "años atípicos de la corrida");
  if (corrida.respuesta) return corrida.respuesta;

  const periodosApi = periodos.data.map(aPeriodoApi);
  const fila = corrida.data;
  if (!fila) {
    const vacio: AniosAtipicosNinoApi = { corrida: null, efecto: null, periodos: periodosApi, anios: [], agrupaciones: [], temporadas: [] };
    return ok(vacio);
  }

  const resultado = comoResultado(fila.resultado);
  const aniosVistos = new Map<number, { clases: Partial<Record<TemporadaAgrupacion, ClaseAnioCurva>>; completo: boolean }>();
  for (const t of resultado.temporadas) {
    for (const a of t.anios) {
      const x = aniosVistos.get(a.anio) ?? { clases: {}, completo: true };
      x.clases[t.temporada] = a.clase;
      x.completo = x.completo && a.clase !== "en_curso" && a.clase !== "incompleto";
      aniosVistos.set(a.anio, x);
    }
  }
  const nombres = new Map(agrupaciones.data.map((a) => [a.id, a.nombre]));

  const cuerpo: AniosAtipicosNinoApi = {
    corrida: aCorridaResumen(fila),
    efecto: comoEfecto(fila.efecto_atipico),
    periodos: periodosApi,
    anios: [...aniosVistos]
      .sort(([a], [b]) => a - b)
      .map(([anio, x]) => ({
        anio,
        // Una temporada sin agrupaciones en la corrida no tiene clase propia: se toma la de `todo_el_ano` o `normal`.
        clase_por_temporada: Object.fromEntries(
          TEMPORADAS_AGRUPACION.map((t) => [t, x.clases[t] ?? x.clases.todo_el_ano ?? "normal"])
        ) as Record<TemporadaAgrupacion, ClaseAnioCurva>,
        completo: x.completo,
      })),
    agrupaciones: resultado.agrupaciones.map((a) => ({
      id: a.agrupacion_id,
      nombre: nombres.get(a.agrupacion_id) ?? a.agrupacion_id,
      temporada: a.temporada,
      efecto_atipico: a.efecto_atipico,
      avisos: a.avisos,
    })),
    temporadas: resultado.temporadas,
  };
  return ok(cuerpo);
}
