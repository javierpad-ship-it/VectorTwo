import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner } from "@/lib/auth/guard";
import { error, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { aniosAtipicidad } from "@/lib/curvas/atipicos";
import {
  aPeriodoApi,
  leerMesesPublicados,
  leerPeriodos,
  leerTemporadaDeAgrupacion,
} from "@/lib/curvas/consultas";
import { AGRUPACION_NO_ENCONTRADA_ANIOS, leerConsultaAnios } from "@/lib/curvas/esquemas";
import type { AniosAtipicosRespuesta, TemporadaAgrupacion } from "@/lib/curvas/tipos-api";

/**
 * Qué años fueron atípicos (contrato estable para M7; `requirePlanner`).
 * `?agrupacion_id=<uuid>` evalúa los periodos activos que aplican a esa
 * agrupación (según su temporada); `?temporada=invierno|verano|todo_el_ano`
 * (por defecto `invierno`) evalúa una temporada. `?desde=2023&hasta=2026`
 * fija los años; sin ellos, del primer mes publicado al último más los años de
 * periodos activos futuros. `400` si vienen los dos criterios o algo no es
 * válido; `404` si la agrupación no existe. No lee ventas ni corridas:
 * `ratio_volumen` es `null` hasta que exista una corrida.
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

  const { anios, resumen } = aniosAtipicidad({
    agrupacion: { temporada },
    periodos: periodos.data.map(aPeriodoApi),
    mesesPublicados: publicados.data,
    desde: consulta.desde,
    hasta: consulta.hasta,
  });
  const cuerpo: AniosAtipicosRespuesta = {
    criterio: { agrupacion_id: consulta.agrupacion_id, temporada },
    anios,
    resumen,
  };
  return ok(cuerpo);
}
