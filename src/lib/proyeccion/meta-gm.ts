import type { SobreBase } from "./tipos-api";

/**
 * Meta de un género × mundo (ficha 07e, D3 y §5.1). Puro: lo importan la Matriz y `src/lib/ia/`, así M7 no depende de la IA.
 *
 *   Meta_GM = Σ_f P^GM_f
 *   P^GM_f  = propuesto_f                          si la fila no tiene % propio (su `propuesto` ya es round(B^s × (1 + g)))
 *   P^GM_f  = round(B^s_f × (1 + g/100))            si tiene % propio; B^s = B' (`corregida`) o B (`bruta`)
 *
 * Entran las filas con `propuesto` no nulo (lo que implica `B` no nulo). Las demás quedan en `fuera_base`.
 * `B'` viene de `base_normalizada`, guardada en centésimas: con % propio puede diferir en una unidad de lo que daría `B'` sin
 * redondear (se acepta; rev. M3).
 */

export type FuenteMeta = "gm" | "resto" | "resto_provisional";

export type FilaParaMeta = {
  fila_id: string;
  /** `P^M`: la propuesta del método de 2027. `null` = sin base o sin curva. */
  propuesto: number | null;
  /** `B` (`base_siguiente`). */
  base: number | null;
  /** `B'` (`base_normalizada`, método 5). */
  base_corregida: number | null;
  /** % propio de la fila (`crecimiento_pct`), o `null` si sigue al GM. */
  crecimiento_pct: number | null;
  /** Vigente de 2027 (`decidido ?? propuesto`); solo para contar las unidades de `fuera_base`. */
  vigente?: number | null;
};

export type EntradaMetaGM = {
  filas: readonly FilaParaMeta[];
  /** `g` en porcentaje (8 = 8 %); `null` = el GM no tiene meta (`sin_meta`). */
  g: number | null;
  sobre_base: SobreBase;
  fuente: FuenteMeta;
};

export type ResultadoMetaGM = {
  /** `Σ P^GM`; `null` si no hay `g` (sin meta). */
  meta_gm: number | null;
  /** `fila_id → P^GM`. Sin `g`, el `propuesto` de cada fila con base. */
  p_gm: Map<string, number>;
  /** Filas sin `propuesto` y sus unidades vigentes. */
  fuera_base: { filas: number; unidades: number };
  sobre_base: SobreBase;
  fuente: FuenteMeta;
};

export function metaDeGM(e: EntradaMetaGM): ResultadoMetaGM {
  const p_gm = new Map<string, number>();
  const fuera_base = { filas: 0, unidades: 0 };
  let suma = 0;
  for (const f of e.filas) {
    if (f.propuesto === null) {
      fuera_base.filas += 1;
      fuera_base.unidades += f.vigente ?? 0;
      continue;
    }
    let p = f.propuesto;
    if (e.g !== null && f.crecimiento_pct !== null) {
      const baseS = e.sobre_base === "corregida" ? f.base_corregida : f.base;
      if (baseS !== null) p = Math.max(0, Math.round(baseS * (1 + e.g / 100)));
    }
    p_gm.set(f.fila_id, p);
    suma += p;
  }
  return { meta_gm: e.g === null ? null : suma, p_gm, fuera_base, sobre_base: e.sobre_base, fuente: e.fuente };
}
