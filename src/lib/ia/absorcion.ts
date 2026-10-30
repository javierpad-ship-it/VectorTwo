import { UMBRAL_ABSORCION_FILA_PCT, UMBRAL_META_MOVIDA_PCT, type AbsorcionApi, type AvisoIa } from "./tipos-api";

/**
 * Absorción (ficha 07e, §5.1; decisión 1 de Javier; R7). Puro. Cuando el planner fija una fila o se mueve la meta, las demás libres
 * absorben la diferencia para que el GM siga sumando su meta; esto mide cuánto absorbió cada una desde que la IA propuso.
 * Depende solo del estado de hoy y de lo guardado al generar: no importa el orden en que se fijaron las filas.
 * Congelado al cerrar la tanda 1.
 */

export type FilaAbsorcion = {
  fila_id: string;
  /** `A_f` de hoy si la fila es libre hoy y hay reparto; `null` si no. */
  a_hoy: number | null;
  /** Aporte (vigente) de hoy si la fila es fija hoy (decidida o con % propio; o cola larga); `null` si no. */
  aporte_hoy: number | null;
  /** `meta_y1_al_generar` si la fila era libre al generar (guardada); `null` si no. */
  meta_y1_al_generar: number | null;
  /** `aporte_fijo_al_generar` si la fila era fija al generar (guardada); `null` si no. */
  aporte_fijo_al_generar: number | null;
};

export type AbsorcionFila = { absorbido_u: number; absorbido_pct: number | null; avisos: AvisoIa[] };

export type ResultadoAbsorcion = {
  gm: AbsorcionApi;
  /** `absorbido_pct > 5 %`. */
  meta_movida: boolean;
  avisos_gm: AvisoIa[];
  /** Por fila libre hoy con referencia. */
  filas: Map<string, AbsorcionFila>;
};

/**
 * - Fila libre hoy con referencia: `absorbido_u = A − meta_y1_al_generar`; `absorcion_alta` si `|absorbido_u| > 10 %` de la referencia.
 * - GM: `absorbido_u = Σ absorbido_u_f`; `absorbido_pct = Σ |absorbido_u_f| ÷ Σ referencia`; `meta_movida` si pasa de 5 %.
 * - Desglose: `delta_meta_u = Meta_GM hoy − Meta_GM al generar`; `desviacion_fijadas_u` = lo que las filas fijadas después (y las que ya
 *   eran fijas) se apartaron de lo que tenían; `otros_u` es lo que queda (cola larga que cambió, libres nuevas, filas que salieron).
 */
export function calcularAbsorcion(e: { filas: readonly FilaAbsorcion[]; meta_gm_hoy: number; meta_gm_al_generar: number }): ResultadoAbsorcion {
  const filas = new Map<string, AbsorcionFila>();
  let absorbido = 0;
  let absorbidoAbs = 0;
  let referencia = 0;
  let desviacionFijadas = 0;
  for (const f of e.filas) {
    if (f.meta_y1_al_generar !== null && f.a_hoy !== null) {
      const u = f.a_hoy - f.meta_y1_al_generar;
      const ref = f.meta_y1_al_generar;
      absorbido += u;
      absorbidoAbs += Math.abs(u);
      referencia += ref;
      const alta = Math.abs(u) * 100 > UMBRAL_ABSORCION_FILA_PCT * ref;
      filas.set(f.fila_id, { absorbido_u: u, absorbido_pct: ref > 0 ? (u / ref) * 100 : null, avisos: alta ? ["absorcion_alta"] : [] });
    } else if (f.meta_y1_al_generar !== null && f.aporte_hoy !== null) {
      desviacionFijadas += f.aporte_hoy - f.meta_y1_al_generar;
    } else if (f.aporte_fijo_al_generar !== null && f.aporte_hoy !== null) {
      desviacionFijadas += f.aporte_hoy - f.aporte_fijo_al_generar;
    }
  }
  const delta = e.meta_gm_hoy - e.meta_gm_al_generar;
  const pct = referencia > 0 ? (absorbidoAbs / referencia) * 100 : null;
  const meta_movida = referencia > 0 && absorbidoAbs * 100 > UMBRAL_META_MOVIDA_PCT * referencia;
  return {
    gm: { delta_meta_u: delta, desviacion_fijadas_u: desviacionFijadas, otros_u: delta - desviacionFijadas - absorbido, absorbido_u: absorbido, absorbido_pct: pct },
    meta_movida,
    avisos_gm: meta_movida ? ["meta_movida"] : [],
    filas,
  };
}
