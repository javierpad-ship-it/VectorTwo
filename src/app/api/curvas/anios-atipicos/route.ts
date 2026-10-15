import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { calcularEfectoNino } from "@/lib/curvas/lectura";
import {
  PARAMETROS_POR_DEFECTO,
  TEMPORADAS_AGRUPACION,
  type AniosAtipicosNinoApi,
  type ClaseAnioCurva,
  type EfectoAtipicoCorrida,
  type TemporadaAgrupacion,
} from "@/lib/curvas/tipos-api";

/**
 * Lo que alimenta la pestaña Años Niño (`requirePlanner`), CALCULADO A DEMANDA con
 * los parámetros por defecto y una sola lectura de `venta_estacionalidad_agrupacion(null)`
 * (`AniosAtipicosNinoApi`): el efecto en volumen por temporada con su control y
 * relativo (`efecto`), los periodos activos, la clase de cada año por temporada, las
 * series agregadas de las temporadas y las agrupaciones activas (para "Ver"). No hay
 * corrida, ni `corrida_id`, ni nada guardado: `calculado_at` y `huella_cargas` dicen
 * cuándo y con qué cargas. `forma` va vacía (requiere abrir cada agrupación). Sin meses
 * publicados y cerrados, el efecto sale vacío.
 */
export async function GET() {
  const { response } = await requirePlanner();
  if (response) return response;

  const db = supabaseAdmin();
  const calculo = await calcularEfectoNino(db, null);
  if (calculo.respuesta) return calculo.respuesta;
  const c = calculo.data;
  if (!c) return error("No se pudo calcular el efecto del Niño.", 500);

  const temporadas = c.salida?.resultado.temporadas ?? [];
  const aniosVistos = new Map<number, { clases: Partial<Record<TemporadaAgrupacion, ClaseAnioCurva>>; completo: boolean }>();
  for (const t of temporadas) {
    for (const a of t.anios) {
      const x = aniosVistos.get(a.anio) ?? { clases: {}, completo: true };
      x.clases[t.temporada] = a.clase;
      x.completo = x.completo && a.clase !== "en_curso" && a.clase !== "incompleto";
      aniosVistos.set(a.anio, x);
    }
  }
  const vacio: EfectoAtipicoCorrida = {
    umbral_forma: PARAMETROS_POR_DEFECTO.umbral_forma,
    margen_ruido: PARAMETROS_POR_DEFECTO.margen_ruido,
    por_temporada: [],
    crecimiento_normal: [],
    forma: {},
    avisos: [],
  };

  const meses = c.venta.meses_publicados;
  const cuerpo: AniosAtipicosNinoApi = {
    calculado_at: new Date().toISOString(),
    huella_cargas: c.huella_cargas,
    parametros: PARAMETROS_POR_DEFECTO as AniosAtipicosNinoApi["parametros"],
    datos: { desde: meses[0] ?? null, hasta_periodo: c.hasta_periodo, meses_publicados: meses.length },
    efecto: c.salida?.efecto_atipico ?? vacio,
    periodos: c.periodos,
    anios: [...aniosVistos]
      .sort(([a], [b]) => a - b)
      .map(([anio, x]) => ({
        anio,
        // Una temporada sin serie no tiene clase propia: se toma la de `todo_el_ano` o `normal`.
        clase_por_temporada: Object.fromEntries(
          TEMPORADAS_AGRUPACION.map((t) => [t, x.clases[t] ?? x.clases.todo_el_ano ?? "normal"])
        ) as Record<TemporadaAgrupacion, ClaseAnioCurva>,
        completo: x.completo,
      })),
    temporadas,
    agrupaciones: c.activas,
  };
  return ok(cuerpo);
}
