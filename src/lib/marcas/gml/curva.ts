import type { AvisoCurva, CurvaMensual, ResultadoCurvaUnidad } from "../tipos-api";
import type { NivelPlanificacion } from "@/lib/arbol/tipos";

/**
 * `curvaUnidad` (02b, regla 13): la curva de estacionalidad de una unidad de
 * planificación a partir de las curvas vigentes de M6, que se calculan por
 * agrupación de estacionalidad y se asignan por equivalencia (M3).
 *
 *   - unidad `GMLE` → la curva vigente de la agrupación de su equivalencia;
 *   - unidad `GML`  → MEZCLA ponderada de las curvas de sus equivalencias
 *     activas: `c_m = Σ peso_e × curva_e[m]`, con `peso_e` la participación de
 *     la equivalencia en las unidades del nodo (M7 fija el rango de meses),
 *     renormalizada a 1 sobre las que tienen curva. Si todas comparten
 *     agrupación, la mezcla ES esa curva.
 *   - una equivalencia con peso y sin curva vigente deja la unidad con el aviso
 *     `curva_incompleta` (y su peso fuera de la mezcla); sin ninguna curva →
 *     `null`.
 *
 * Pura; no importa de `@supabase/*` ni de componentes. `normalizar` es la misma
 * operación que `normalizarCurva` de M6 (dividir entre la suma), aquí local para
 * no depender de un módulo que aún no existe.
 */

export type UnidadCurva = { nivel: NivelPlanificacion; equivalencia_id: string | null };
export type EquivalenciaCurva = { id: string; agrupacion_estacionalidad_id: string | null };

const MESES = 12;

function normalizar(curva: number[]): number[] {
  const suma = curva.reduce((a, b) => a + b, 0);
  return suma > 0 ? curva.map((x) => x / suma) : curva;
}

export function curvaUnidad(
  unidad: UnidadCurva,
  equivalencias: readonly EquivalenciaCurva[],
  curvasVigentes: ReadonlyMap<string, CurvaMensual>,
  pesos: ReadonlyMap<string, number>
): ResultadoCurvaUnidad {
  const curvaDe = (e: EquivalenciaCurva): CurvaMensual | undefined =>
    e.agrupacion_estacionalidad_id ? curvasVigentes.get(e.agrupacion_estacionalidad_id) : undefined;

  if (unidad.nivel === "GMLE") {
    const eq = equivalencias.find((e) => e.id === unidad.equivalencia_id);
    const curva = eq ? curvaDe(eq) : undefined;
    return { curva: curva ? [...curva] : null, avisos: [] };
  }

  const avisos: AvisoCurva[] = [];
  const mezcla = new Array<number>(MESES).fill(0);
  let pesoTotal = 0;
  const agrupaciones = new Set<string>();
  let unica: CurvaMensual | null = null;
  for (const e of equivalencias) {
    const peso = pesos.get(e.id) ?? 0;
    if (!(peso > 0)) continue;
    const curva = curvaDe(e);
    if (!curva || curva.length !== MESES) {
      if (!avisos.includes("curva_incompleta")) avisos.push("curva_incompleta");
      continue;
    }
    pesoTotal += peso;
    agrupaciones.add(e.agrupacion_estacionalidad_id as string);
    unica = curva;
    for (let m = 0; m < MESES; m++) mezcla[m] += peso * curva[m];
  }
  if (pesoTotal <= 0 || unica === null) return { curva: null, avisos };

  // Todas en la misma agrupación: la mezcla ES esa curva (sin error de redondeo).
  if (agrupaciones.size === 1) return { curva: [...unica], avisos };
  return { curva: normalizar(mezcla.map((x) => x / pesoTotal)), avisos };
}
