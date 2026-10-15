import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aniosAtipicidad } from "@/lib/curvas/atipicos";
import {
  aPeriodoApi,
  comoEfecto,
  comoResultado,
  leerCorridaReferencia,
  leerMesesPublicados,
  leerPeriodos,
  leerTemporadaDeAgrupacion,
} from "@/lib/curvas/consultas";
import { AGRUPACION_NO_ENCONTRADA_ANIOS, leerConsultaAnios } from "@/lib/curvas/esquemas";
import type { AniosAtipicosRespuesta, TemporadaAgrupacion, VolumenAnioApi } from "@/lib/curvas/tipos-api";

/**
 * Qué años fueron atípicos (contrato estable para M7; `requirePlanner`).
 * `?agrupacion_id=<uuid>` evalúa los periodos activos que aplican a esa
 * agrupación (según su temporada); `?temporada=invierno|verano|todo_el_ano`
 * (por defecto `invierno`) evalúa una temporada. `?desde=2023&hasta=2026`
 * fija los años; sin ellos, del primer mes publicado al último más los años de
 * periodos activos futuros. `400` si vienen los dos criterios o algo no es
 * válido; `404` si la agrupación no existe. No lee ventas ni la vista
 * materializada: `ratio_volumen` y `volumen` salen de la corrida de REFERENCIA
 * (nivel temporada, con control, relativo y crecimiento normal; con
 * `?agrupacion_id=` suma el ratio de la agrupación como diagnóstico) y son `null`
 * sin corrida de referencia o en un año sin comparación. `corrida_id` es la de
 * referencia (o `null`).
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

  const [periodos, publicados, referencia] = await Promise.all([
    leerPeriodos(db, { soloActivos: true }),
    leerMesesPublicados(db),
    leerCorridaReferencia(db),
  ]);
  if (periodos.error) return traducirErrorDb(periodos.error, "años atípicos: leer periodos");
  if (publicados.error) return traducirErrorDb(publicados.error, "años atípicos: leer meses publicados");
  if (referencia.error) return traducirErrorDb(referencia.error, "años atípicos: leer la corrida de referencia");

  const corrida = referencia.data;
  const filasEfecto = corrida ? comoEfecto(corrida.efecto_atipico).por_temporada : [];
  const deAgrupacion =
    corrida && consulta.agrupacion_id !== null
      ? comoResultado(corrida.resultado).agrupaciones.find((a) => a.agrupacion_id === consulta.agrupacion_id)
      : undefined;
  const volumenDeAnio = (anio: number) => {
    const fila = filasEfecto.find((f) => f.anio === anio && f.temporada === temporada);
    if (!corrida || !fila) return null;
    const volumen: VolumenAnioApi = {
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
      corrida_id: corrida.id,
    };
    return { ratio_volumen: fila.ratio_volumen, volumen };
  };

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
    corrida_id: corrida?.id ?? null,
    anios,
    resumen,
  };
  return ok(cuerpo);
}
