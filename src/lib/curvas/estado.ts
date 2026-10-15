import { eatEntreCurvas, difiereDeVigente } from "./obsolescencia";
import { sumar } from "./anios";
import type {
  AgrupacionCurvasApi,
  AgrupacionResultado,
  CorridaResumenApi,
  EfectoAtipicoCorrida,
  EstadoCurvasApi,
  FormaAnio,
  MotivoObsoletaApi,
  ObsoletaApi,
  PeriodoAtipicoApi,
  PropuestaApi,
  ResultadoCorrida,
  ResumenEstadoCurvas,
  TemporadaAgrupacion,
  TemporadaResultado,
  VigenteResumenApi,
} from "./tipos-api";

/**
 * Armado puro de las respuestas de lectura de M6 (`GET /api/curvas` y el detalle
 * de una agrupación): propuesta de la corrida frente a la curva vigente,
 * obsolescencia y conteos del resumen. Sin base ni HTTP: reciben lo ya leído.
 */

/** Curva de la candidata recomendada (la `T` de la temporada si es `T`); `null` si no hay. */
export function curvaDeRecomendada(a: AgrupacionResultado, temporada: Pick<TemporadaResultado, "curva_T"> | null): number[] | null {
  if (a.recomendada === null) return null;
  if (a.recomendada === "T") return temporada?.curva_T ?? null;
  return a.candidatas.find((c) => c.modelo === a.recomendada)?.curva ?? null;
}

/** ¿La agrupación tuvo venta sobre la red comparable en la corrida? */
export function conVenta(a: AgrupacionResultado | undefined): boolean {
  return a ? sumar(a.anios.map((x) => x.unidades)) > 0 : false;
}

/** Propuesta de la corrida para una agrupación, comparada con su vigente (si la hay). */
export function propuestaDe(
  corridaId: string,
  a: AgrupacionResultado,
  temporada: Pick<TemporadaResultado, "curva_T"> | null,
  vigente: Pick<VigenteResumenApi, "modelo" | "curva" | "eat"> | null
): PropuestaApi {
  const curva = curvaDeRecomendada(a, temporada);
  const recomendada = a.recomendada;
  const candidata = recomendada && recomendada !== "T" ? a.candidatas.find((c) => c.modelo === recomendada) : null;
  const eat = candidata?.eat ?? null;
  const veredicto = a.efecto_atipico.forma?.veredicto ?? null;
  const forma = a.efecto_atipico.forma;
  const comparable = curva !== null && recomendada !== null && vigente !== null;
  return {
    corrida_id: corridaId,
    recomendada,
    motivo_recomendacion: a.motivo_recomendacion,
    origen: a.origen,
    eat,
    curva,
    estabilidad: a.estabilidad,
    nivel_estabilidad: a.nivel_estabilidad,
    difiere_de_vigente: comparable ? difiereDeVigente({ modelo: recomendada, curva, eat }, vigente) : false,
    eat_vs_vigente: comparable ? eatEntreCurvas(curva, vigente.curva) : null,
    veredicto_forma: veredicto,
    anios: a.anios.map((x) => ({
      anio: x.anio,
      clase: x.clase,
      tratamiento: x.tratamiento,
      escaso: x.escaso,
      en_ajuste: x.en_ajuste,
      meses_atipicos: x.meses_atipicos,
    })),
    nino: {
      volumen: a.efecto_atipico.volumen.map((v) => ({ anio: v.anio, ratio_volumen: v.ratio_volumen })),
      forma: forma
        ? {
            veredicto: forma.veredicto,
            diferencia_anio: maxDiferencia(forma.por_anio),
            ruido_normal: forma.ruido_normal,
            umbral_efectivo: forma.umbral_efectivo,
          }
        : null,
    },
    avisos: a.avisos,
  };
}

function maxDiferencia(porAnio: readonly FormaAnio[]): number | null {
  const valores: number[] = [];
  for (const x of porAnio) if (!x.parcial) valores.push(x.diferencia_anio);
  return valores.length === 0 ? null : Math.max(...valores);
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

export type CorridaVista = {
  resumen: CorridaResumenApi;
  resultado: ResultadoCorrida;
  efecto_atipico: EfectoAtipicoCorrida;
};

export type EntradaEstado = {
  datos: EstadoCurvasApi["datos"];
  corrida: CorridaVista | null;
  corridas: EstadoCurvasApi["corridas"];
  agrupaciones: readonly AgrupacionLeida[];
  /** Curva vigente por agrupación. */
  vigentes: ReadonlyMap<string, VigenteResumenApi>;
  obsoletas: ReadonlyMap<string, readonly MotivoObsoletaApi[]>;
  periodos: PeriodoAtipicoApi[];
};

/**
 * `GET /api/curvas`: activas por orden y nombre y, al final, las inactivas que
 * aún tienen curva vigente. El resumen sale de la corrida que se está viendo
 * (incluidas las unidades sin agrupación, rotuladas "agregado refrescado el …").
 */
export function armarEstadoCurvas(e: EntradaEstado): EstadoCurvasApi {
  const visibles = e.agrupaciones.filter((a) => a.activo || e.vigentes.has(a.id));
  const ordenadas = [...visibles].sort(
    (a, b) => Number(b.activo) - Number(a.activo) || a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id)
  );

  const resultadoDe = (id: string) => e.corrida?.resultado.agrupaciones.find((x) => x.agrupacion_id === id);

  const agrupaciones: AgrupacionCurvasApi[] = ordenadas.map((a) => {
    const r = resultadoDe(a.id);
    const vigente = e.vigentes.get(a.id) ?? null;
    const temporada = r ? (e.corrida?.resultado.temporadas.find((t) => t.temporada === r.temporada) ?? null) : null;
    return {
      id: a.id,
      nombre: a.nombre,
      codigo: a.codigo,
      activo: a.activo,
      temporada: a.temporada,
      temporada_sugerida: a.temporada_sugerida,
      generos: a.generos,
      equivalencias_activas: a.equivalencias_activas,
      con_venta: conVenta(r),
      vigente,
      obsoleta: aObsoleta(e.obsoletas.get(a.id)),
      propuesta: r && e.corrida ? propuestaDe(e.corrida.resumen.id, r, temporada, vigente) : null,
    };
  });

  const activas = agrupaciones.filter((a) => a.activo);
  const porTemporada: Record<TemporadaAgrupacion, number> = { invierno: 0, verano: 0, todo_el_ano: 0 };
  for (const a of activas) porTemporada[a.temporada] += 1;

  const forma = { forma_estable: 0, forma_cambia: 0, sin_comparacion: 0 };
  for (const a of activas) {
    const v = a.propuesta?.veredicto_forma;
    if (v) forma[v] += 1;
  }

  const resumen: ResumenEstadoCurvas = {
    agrupaciones_activas: activas.length,
    por_temporada: porTemporada,
    sin_revisar_toda_temporada: porTemporada.todo_el_ano,
    con_curva_vigente: activas.filter((a) => a.vigente).length,
    sin_curva_con_venta: activas.filter((a) => !a.vigente && a.con_venta).length,
    sin_venta: e.corrida ? activas.filter((a) => !a.con_venta).length : 0,
    vigentes_prestadas: activas.filter((a) => a.vigente?.origen === "prestada").length,
    obsoletas: activas.filter((a) => a.obsoleta).length,
    propuestas_distintas: activas.filter((a) => a.propuesta?.difiere_de_vigente).length,
    inactivas_con_curva: agrupaciones.filter((a) => !a.activo && a.vigente).length,
    unidades_sin_agrupacion: e.corrida?.resumen.resumen.unidades_sin_agrupacion ?? 0,
    forma,
  };

  return {
    datos: e.datos,
    corrida: e.corrida?.resumen ?? null,
    corridas: e.corridas,
    agrupaciones,
    periodos_atipicos: e.periodos,
    resumen,
  };
}

/** Aviso `inactiva_con_curva` para una agrupación inactiva que conserva su curva vigente. */
export function avisoInactivaConCurva(activo: boolean, tieneVigente: boolean): boolean {
  return !activo && tieneVigente;
}
