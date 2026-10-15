import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aniosAtipicidad } from "@/lib/curvas/atipicos";
import { aPeriodoApi, leerMesesPublicados, leerPeriodos, leerTemporadaDeAgrupacion } from "@/lib/curvas/consultas";
import { AGRUPACION_NO_ENCONTRADA_ANIOS, leerConsultaAnios } from "@/lib/curvas/esquemas";
import { calcularEfectoNino } from "@/lib/curvas/lectura";
import type { AniosAtipicosRespuesta, AvisoAnios, TemporadaAgrupacion, VolumenAnioApi } from "@/lib/curvas/tipos-api";

/**
 * Qué años fueron atípicos (contrato estable para M7; `requirePlanner`).
 * `?agrupacion_id=<uuid>` evalúa los periodos activos que aplican a esa
 * agrupación (según su temporada); `?temporada=invierno|verano|todo_el_ano`
 * (por defecto `invierno`) evalúa una temporada. `?desde=2023&hasta=2026`
 * fija los años; sin ellos, del primer mes publicado al último más los años de
 * periodos activos futuros. `400` si vienen los dos criterios o algo no es
 * válido; `404` si la agrupación no existe.
 *
 * Sin `?con_volumen=1` es barato: no lee venta y `ratio_volumen` / `volumen` son
 * `null`. Con `con_volumen=1` (M7 y la pestaña Años Niño) calcula a demanda, con UNA
 * llamada a `venta_estacionalidad_agrupacion(agrupacion_id ?? null)` y los parámetros
 * POR DEFECTO (lo dice el aviso `parametros_por_defecto`): `ratio_volumen` y `volumen`
 * a nivel de temporada, con control, relativo y crecimiento normal; con `?agrupacion_id=`
 * suma el ratio de la agrupación como diagnóstico. `corrida_id` es siempre `null`
 * (ya no hay corrida de referencia); `calculado_at` y `huella_cargas` dicen cuándo y
 * con qué cargas.
 */
export async function GET(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { consulta, rechazo } = leerConsultaAnios(request.nextUrl.searchParams);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const db = supabaseAdmin();
  let temporada: TemporadaAgrupacion = consulta.temporada;
  if (consulta.agrupacion_id !== null) {
    const { data, error: err } = await leerTemporadaDeAgrupacion(db, consulta.agrupacion_id);
    if (err) return traducirErrorDb(err, "años atípicos: leer agrupación");
    if (!data) return error(AGRUPACION_NO_ENCONTRADA_ANIOS, 404);
    temporada = data.temporada;
  }

  const [periodos, publicados] = await Promise.all([leerPeriodos(db, { soloActivos: true }), leerMesesPublicados(db)]);
  if (periodos.error) return traducirErrorDb(periodos.error, "años atípicos: leer periodos");
  if (publicados.error) return traducirErrorDb(publicados.error, "años atípicos: leer meses publicados");

  let volumenDeAnio: ((anio: number) => { ratio_volumen: number | null; volumen: VolumenAnioApi } | null) | undefined;
  let huellaCargas: string | null = null;
  let calculadoAt: string | null = null;
  const avisos: AvisoAnios[] = [];
  if (consulta.con_volumen) {
    const calculo = await calcularEfectoNino(db, consulta.agrupacion_id);
    if (calculo.respuesta) return calculo.respuesta;
    const c = calculo.data;
    if (!c) return error(AGRUPACION_NO_ENCONTRADA_ANIOS, 404);
    const filasEfecto = c.salida?.efecto_atipico.por_temporada ?? [];
    const deAgrupacion =
      consulta.agrupacion_id !== null ? c.salida?.resultado.agrupaciones.find((a) => a.agrupacion_id === consulta.agrupacion_id) : undefined;
    volumenDeAnio = (anio) => {
      const fila = filasEfecto.find((f) => f.anio === anio && f.temporada === temporada);
      if (!fila) return null;
      return {
        ratio_volumen: fila.ratio_volumen,
        volumen: {
          nivel: "temporada",
          temporada,
          ratio_control: fila.ratio_control,
          ratio_relativo: fila.ratio_relativo,
          crecimiento_normal: fila.crecimiento_normal,
          anio_referencia: fila.anio_referencia,
          tiendas_comunes: fila.tiendas_comunes,
          meses_comparados: fila.meses_comparados,
          agrupaciones: fila.agrupaciones,
          ratio_agrupacion: deAgrupacion?.efecto_atipico.volumen.find((v) => v.anio === anio)?.ratio_volumen ?? null,
          corrida_id: null,
        },
      };
    };
    huellaCargas = c.huella_cargas;
    calculadoAt = new Date().toISOString();
    avisos.push({
      codigo: "parametros_por_defecto",
      detalle: "El factor se calculó con los parámetros por defecto, no con los de cada curva aprobada.",
    });
  }

  const { anios, resumen } = aniosAtipicidad({
    agrupacion: { temporada },
    periodos: periodos.data.map(aPeriodoApi),
    mesesPublicados: publicados.data,
    desde: consulta.desde,
    hasta: consulta.hasta,
    volumenDeAnio,
  });
  const cuerpo: AniosAtipicosRespuesta = {
    criterio: { agrupacion_id: consulta.agrupacion_id, temporada },
    corrida_id: null,
    huella_cargas: huellaCargas,
    calculado_at: calculadoAt,
    avisos,
    anios,
    resumen,
  };
  return ok(cuerpo);
}
