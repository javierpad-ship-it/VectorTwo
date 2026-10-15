import { claseDeAnio, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { aPeriodo } from "@/lib/ventas/periodo";
import type { AvisoFila, TemporadaFactor } from "./tipos-api";

/**
 * Factor de volumen del año Niño por mes (ficha 07, sección 3 y reglas 5 a 7). Puro.
 *
 * `φ_{Z,m}` es un vector de doce valores por unidad y año: el factor de la temporada
 * en los meses atípicos de `Z` y 1 en el resto. Para un GML que mezcla temporadas (M2)
 * se pondera mes a mes: `φ_{Z,m} = Σ_e w_e c_{e,m} φ_{e,Z,m} ÷ Σ_e w_e c_{e,m}`.
 */

/** Factor de una (año, temporada), tal como vive en `factores_volumen_atipico`. */
export type FactorProy = {
  anio: number;
  temporada: TemporadaFactor;
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
};

/** Una agrupación de estacionalidad con peso dentro de una unidad, con su curva. */
export type ComponenteUnidad = {
  agrupacion_id: string;
  temporada: TemporadaAgrupacion;
  peso: number;
  curva: readonly number[] | null;
};

const MESES = 12;
export const UNOS: readonly number[] = Array.from({ length: MESES }, () => 1);

/** Regla 6. `ratio_aplicado ?? ratio_calculado ?? null` de la fila `(anio, temporada)`. */
export function factorDe(factores: readonly FactorProy[], anio: number, temporada: TemporadaFactor): number | null {
  const f = factores.find((x) => x.anio === anio && x.temporada === temporada);
  if (!f) return null;
  return f.ratio_aplicado ?? f.ratio_calculado ?? null;
}

/** El factor efectivo del último año anterior a `anio` con valor para esa temporada (año objetivo sin fila propia). */
export function factorMasReciente(
  factores: readonly FactorProy[],
  anio: number,
  temporada: TemporadaFactor
): { anio: number; ratio: number } | null {
  let mejor: { anio: number; ratio: number } | null = null;
  for (const f of factores) {
    if (f.temporada !== temporada || f.anio >= anio) continue;
    const ratio = f.ratio_aplicado ?? f.ratio_calculado;
    if (ratio === null || ratio === undefined) continue;
    if (mejor === null || f.anio > mejor.anio) mejor = { anio: f.anio, ratio };
  }
  return mejor;
}

export type ResultadoFactoresMes = {
  /** `φ_{Z,m}`, doce valores (enero primero). */
  factores: number[];
  avisos: AvisoFila[];
  /** `aaaa-mm` atípicos del año para alguna de las agrupaciones con peso (con o sin factor). */
  mesesAtipicos: string[];
};

/**
 * Regla 5. `φ_{Z,m}` de la unidad (sus componentes con peso). Una sola agrupación:
 * el factor de su temporada en los meses de `claseDeAnio(...).meses_atipicos`, 1 fuera;
 * `todo_el_ano` nunca se ajusta. Varias: promedio ponderado por `w_e × c_{e,m}`.
 *
 * Un mes atípico sin factor vale 1 y deja el aviso `sin_factor`. Con `objetivo` (el
 * año siguiente, cuyo factor aún no existe) se usa el efectivo del último año atípico
 * de la temporada y el aviso `objetivo_atipico`.
 */
export function factoresMes(
  componentes: readonly ComponenteUnidad[],
  periodos: readonly PeriodoParaClase[],
  factores: readonly FactorProy[],
  anio: number,
  opciones: { objetivo?: boolean } = {}
): ResultadoFactoresMes {
  const avisos = new Set<AvisoFila>();
  const atipicosUnion = new Set<string>();
  const activos = componentes.filter((c) => c.peso > 0);

  const phiDe = (c: ComponenteUnidad): number[] => {
    if (c.temporada === "todo_el_ano") return [...UNOS];
    const clase = claseDeAnio(anio, { temporada: c.temporada }, periodos, []);
    for (const m of clase.meses_atipicos) atipicosUnion.add(m);
    const atipicos = new Set(clase.meses_atipicos);
    if (atipicos.size === 0) return [...UNOS];
    let ratio = factorDe(factores, anio, c.temporada);
    if (ratio === null && opciones.objetivo) {
      const previo = factorMasReciente(factores, anio, c.temporada);
      if (previo) ratio = previo.ratio;
    }
    if (ratio === null) {
      avisos.add("sin_factor");
      return [...UNOS];
    }
    if (opciones.objetivo) avisos.add("objetivo_atipico");
    return Array.from({ length: MESES }, (_, i) => (atipicos.has(aPeriodo(anio, i + 1)) ? ratio : 1));
  };

  if (activos.length === 0) return { factores: [...UNOS], avisos: [...avisos], mesesAtipicos: [] };
  const phis = activos.map(phiDe);
  const mesesAtipicos = [...atipicosUnion].sort();
  if (activos.length === 1) return { factores: phis[0], avisos: [...avisos], mesesAtipicos };

  const resultado = Array.from({ length: MESES }, (_, m) => {
    let numerador = 0;
    let denominador = 0;
    let pesoPlano = 0;
    let numeradorPlano = 0;
    activos.forEach((c, i) => {
      const w = c.peso * (c.curva ? (c.curva[m] ?? 0) : 0);
      numerador += w * phis[i][m];
      denominador += w;
      pesoPlano += c.peso;
      numeradorPlano += c.peso * phis[i][m];
    });
    if (denominador > 0) return numerador / denominador;
    return pesoPlano > 0 ? numeradorPlano / pesoPlano : 1;
  });
  return { factores: resultado, avisos: [...avisos], mesesAtipicos };
}

/** Regla 7. `u_m ÷ φ_m`; con `φ` de unos la serie sale idéntica. */
export function normalizar(serie: readonly number[], phi: readonly number[]): number[] {
  return serie.map((u, i) => {
    const f = phi[i] ?? 1;
    return f > 0 ? u / f : u;
  });
}

/** ¿Todos los meses valen lo mismo? Con `φ` constante el factor se cancela. */
export function esConstante(phi: readonly number[], tolerancia = 1e-12): boolean {
  return phi.every((f) => Math.abs(f - phi[0]) <= tolerancia);
}
