import { EAT_DISTINTA, EAT_SIMILAR, type AvisoBarrer, type VeredictoEstacionalidad } from "./tipos-api";
import type { ClaveG, Mes } from "./tipos";

/**
 * Estacionalidad propia de la marca frente a la del GML (ficha 12, regla 8). Informativa: no entra en el reparto. Pura.
 *
 *   propia[m]   = Σ_{años completos} ũ_m ÷ total      (doce valores que suman 1)
 *   c^{GML}[m]  = Σ_g p2_g × curvaUnidad(g)[m]         (sobre las `g` con curva, renormalizado)
 *   EAT         = 50 × Σ_m |propia − c^{GML}|           (0 si iguales, 100 si disjuntas)
 */

const MESES = 12;
const anioDe = (m: Mes) => Number(m.slice(0, 4));
const mesDe = (m: Mes) => Number(m.slice(5, 7));

/** Años de la ventana con sus doce meses (ascendente). */
export function aniosCompletos(meses: readonly Mes[]): number[] {
  const cuenta = new Map<number, number>();
  for (const m of meses) cuenta.set(anioDe(m), (cuenta.get(anioDe(m)) ?? 0) + 1);
  return [...cuenta.entries()].filter(([, n]) => n === MESES).map(([a]) => a).sort((a, b) => a - b);
}

/**
 * Doce valores propios sobre los años completos de la ventana: la suma de `serie` (unidades normalizadas del total de la marca
 * por mes) por mes del calendario, sobre el total. `null` sin año completo o sin venta.
 */
export function estacionalidadPropia(serieTotal: ReadonlyMap<Mes, number>, completos: readonly number[]): number[] | null {
  if (completos.length === 0) return null;
  const v = Array<number>(MESES).fill(0);
  for (const [mes, u] of serieTotal) if (completos.includes(anioDe(mes))) v[mesDe(mes) - 1] += Math.max(0, u);
  const total = v.reduce((a, b) => a + b, 0);
  return total > 0 ? v.map((x) => x / total) : null;
}

/**
 * `c^{GML} = Σ_g p2_g × curva_g`, renormalizada sobre las `g` con curva (las que no la tienen dejan `curva_incompleta`).
 * `null` si ninguna `g` con participación tiene curva.
 */
export function estacionalidadGml(
  p2: ReadonlyMap<ClaveG, number>,
  curvas: (clave: ClaveG) => readonly number[] | null
): { curva: number[] | null; avisos: AvisoBarrer[] } {
  const v = Array<number>(MESES).fill(0);
  let peso = 0;
  let incompleta = false;
  for (const [clave, p] of p2) {
    if (!(p > 0)) continue;
    const curva = curvas(clave);
    if (!curva || curva.length !== MESES) {
      incompleta = true;
      continue;
    }
    peso += p;
    for (let m = 0; m < MESES; m++) v[m] += p * curva[m];
  }
  const avisos: AvisoBarrer[] = incompleta ? ["curva_incompleta"] : [];
  if (!(peso > 0)) return { curva: null, avisos };
  const suma = v.reduce((a, b) => a + b, 0);
  return { curva: suma > 0 ? v.map((x) => x / suma) : null, avisos };
}

/** EAT entre dos curvas de doce meses en puntos: 0 si iguales, 100 si disjuntas. */
export function eat(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let m = 0; m < Math.max(a.length, b.length); m++) s += Math.abs((a[m] ?? 0) - (b[m] ?? 0));
  return s * 50;
}

/** `similar` si `eat ≤ EAT_SIMILAR`, `distinta` si `> EAT_DISTINTA`, `dudosa` entre medias; `null` sin EAT. */
export function veredicto(eatPp: number | null): VeredictoEstacionalidad | null {
  if (eatPp === null) return null;
  if (eatPp <= EAT_SIMILAR) return "similar";
  if (eatPp > EAT_DISTINTA) return "distinta";
  return "dudosa";
}
