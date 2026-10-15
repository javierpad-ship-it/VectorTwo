import type { PeriodoParaClase } from "./atipicos";
import type { EvaluacionVigente } from "./obsolescencia";
import { armarPrerrequisitosGlobales, bloqueadaPor, contarPeriodosAplicables } from "./prerrequisitos";
import type {
  AgrupacionCurvasApi,
  AgrupacionResultado,
  EstadoAgrupacion,
  EstadoCurvasApi,
  MotivoObsoletaApi,
  ObsoletaApi,
  PeriodoAtipicoApi,
  ResumenEstadoCurvas,
  TemporadaAgrupacion,
  TemporadaResultado,
  VigenteResumenApi,
} from "./tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "./tipos";

/**
 * Armado puro de la lista de curvas (`GET /api/curvas` v2, 06b): estado de cada
 * agrupación sin corrida, avisos de la vigente, prerrequisitos y conteos del
 * resumen. Sin base ni HTTP: reciben lo ya leído. La lista NUNCA calcula.
 */

/** Curva de la candidata recomendada (la `T` de la temporada si es `T`); `null` si no hay. */
export function curvaDeRecomendada(a: AgrupacionResultado, temporada: Pick<TemporadaResultado, "curva_T"> | null): number[] | null {
  if (a.recomendada === null) return null;
  if (a.recomendada === "T") return temporada?.curva_T ?? null;
  return a.candidatas.find((c) => c.modelo === a.recomendada)?.curva ?? null;
}

export function aObsoleta(motivos: readonly MotivoObsoletaApi[] | undefined): ObsoletaApi | null {
  return motivos && motivos.length > 0 ? { motivos: [...motivos] } : null;
}

export type AgrupacionLeida = {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
  orden: number;
  temporada: TemporadaAgrupacion;
  /** Solo si las líneas informan (`invierno` o `verano`). */
  temporada_sugerida: TemporadaAgrupacion | null;
  generos: string[];
  equivalencias_activas: number;
};

/**
 * Regla 40. Estado de una agrupación en la lista: `inactiva_con_curva` (gana a los
 * demás), `sin_curva`, `obsoleta` (con motivos), `al_dia` (se aprobó la recomendada)
 * o `al_dia_distinta` (se aprobó otra candidata).
 */
export function estadoDeAgrupacion(
  vigente: Pick<VigenteResumenApi, "recomendada"> | null,
  obsoleta: ObsoletaApi | null,
  activo: boolean
): EstadoAgrupacion {
  if (!vigente) return "sin_curva";
  if (!activo) return "inactiva_con_curva";
  if (obsoleta && obsoleta.motivos.length > 0) return "obsoleta";
  return vigente.recomendada ? "al_dia" : "al_dia_distinta";
}

export type EntradaEstado = {
  datos: EstadoCurvasApi["datos"];
  agrupaciones: readonly AgrupacionLeida[];
  /** Curva vigente por agrupación. */
  vigentes: ReadonlyMap<string, VigenteResumenApi>;
  /** Motivos y avisos de cada vigente (`evaluarObsolescencia`). */
  evaluaciones: ReadonlyMap<string, EvaluacionVigente>;
  /** Versiones guardadas por agrupación. */
  versiones: ReadonlyMap<string, number>;
  periodos: PeriodoAtipicoApi[];
  /** Lo que necesitan los prerrequisitos que se saben sin calcular. */
  prerrequisitos: {
    meses_publicados: readonly string[];
    /** Último mes publicado y cerrado; `null` si ninguno. */
    hasta_periodo: string | null;
    tiendas: readonly TiendaMaestro[];
    venta_tienda: readonly VentaTiendaMes[];
  };
  equivalencias_sin_agrupacion: number;
};

/**
 * `GET /api/curvas` v2: activas por orden y nombre y, al final, las inactivas que
 * aún tienen curva vigente.
 */
export function armarEstadoCurvas(e: EntradaEstado): EstadoCurvasApi {
  const visibles = e.agrupaciones.filter((a) => a.activo || e.vigentes.has(a.id));
  const ordenadas = [...visibles].sort(
    (a, b) => Number(b.activo) - Number(a.activo) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id)
  );
  const periodosActivos: PeriodoParaClase[] = e.periodos.filter((p) => p.activo);
  const p = e.prerrequisitos;

  // Las agrupaciones cuya última aprobación confirmó "sin años atípicos" no se cuentan como faltantes de periodos.
  const confirmadas = new Set<string>();
  for (const [id, v] of e.vigentes) if (v.parametros?.sin_periodos_confirmado) confirmadas.add(id);

  const agrupaciones: AgrupacionCurvasApi[] = ordenadas.map((a) => {
    const vigente = e.vigentes.get(a.id) ?? null;
    const evaluacion = e.evaluaciones.get(a.id);
    const obsoleta = aObsoleta(evaluacion?.motivos);
    return {
      id: a.id,
      nombre: a.nombre,
      codigo: a.codigo,
      activo: a.activo,
      temporada: a.temporada,
      temporada_sugerida: a.temporada_sugerida,
      generos: a.generos,
      equivalencias_activas: a.equivalencias_activas,
      periodos_aplicables: contarPeriodosAplicables(periodosActivos, a.temporada),
      vigente,
      obsoleta,
      avisos_vigente: evaluacion?.avisos ?? [],
      estado: estadoDeAgrupacion(vigente, obsoleta, a.activo),
      bloqueada_por: a.activo
        ? bloqueadaPor({
            agrupacion: { id: a.id, nombre: a.nombre, activo: a.activo, temporada: a.temporada, equivalencias_activas: a.equivalencias_activas },
            versiones: e.versiones.get(a.id) ?? 0,
            parametros: {
              solo_tiendas_completas: vigente?.parametros?.solo_tiendas_completas ?? true,
              tiendas_excluidas: vigente?.parametros?.tiendas_excluidas ?? [],
              sin_periodos_confirmado: confirmadas.has(a.id),
            },
            meses_publicados: p.meses_publicados,
            hasta_periodo: p.hasta_periodo,
            periodos: periodosActivos,
            tiendas: p.tiendas,
            venta_tienda: p.venta_tienda,
          })
        : [],
      versiones: e.versiones.get(a.id) ?? 0,
    };
  });

  const activas = agrupaciones.filter((a) => a.activo);
  const porTemporada: Record<TemporadaAgrupacion, number> = { invierno: 0, verano: 0, todo_el_ano: 0 };
  for (const a of activas) porTemporada[a.temporada] += 1;
  const sinCurva = activas.filter((a) => a.estado === "sin_curva");
  const bloqueadasSinCurva = sinCurva.filter((a) => a.bloqueada_por.length > 0).length;

  const resumen: ResumenEstadoCurvas = {
    agrupaciones_activas: activas.length,
    por_temporada: porTemporada,
    sin_revisar_toda_temporada: porTemporada.todo_el_ano,
    con_curva_vigente: activas.filter((a) => a.vigente).length,
    al_dia: activas.filter((a) => a.estado === "al_dia").length,
    al_dia_distintas: activas.filter((a) => a.estado === "al_dia_distinta").length,
    obsoletas: activas.filter((a) => a.estado === "obsoleta").length,
    sin_curva: sinCurva.length,
    bloqueadas: activas.filter((a) => a.bloqueada_por.length > 0).length,
    bloqueadas_sin_curva: bloqueadasSinCurva,
    calculables_sin_curva: sinCurva.length - bloqueadasSinCurva,
    vigentes_prestadas: activas.filter((a) => a.vigente?.origen === "prestada").length,
    inactivas_con_curva: agrupaciones.filter((a) => !a.activo && a.vigente).length,
    equivalencias_sin_agrupacion: e.equivalencias_sin_agrupacion,
  };

  return {
    datos: e.datos,
    prerrequisitos_globales: armarPrerrequisitosGlobales({
      meses_publicados: p.meses_publicados,
      hasta_periodo: p.hasta_periodo,
      periodos: periodosActivos,
      agrupaciones: activas,
      confirmadas_sin_periodos: confirmadas,
      tiendas: p.tiendas,
      venta_tienda: p.venta_tienda,
    }),
    agrupaciones,
    periodos_atipicos: e.periodos,
    resumen,
  };
}

/** Aviso `inactiva_con_curva` para una agrupación inactiva que conserva su curva vigente. */
export function avisoInactivaConCurva(activo: boolean, tieneVigente: boolean): boolean {
  return !activo && tieneVigente;
}
