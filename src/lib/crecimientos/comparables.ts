import { redComparable, tiendasComunes, tiendasQueEntran, type ParametrosRed } from "@/lib/curvas/red";
import { PARAMETROS_POR_DEFECTO, type RedAnio } from "@/lib/curvas/tipos-api";
import type { TiendaMaestro, VentaTiendaMes } from "@/lib/curvas/tipos";
import { anioDe } from "@/lib/curvas/anios";
import type { SerieGM } from "./series";

/**
 * Mismas tiendas (ficha 06d §5.1). Lógica PURA. La red de un año `Z` es la `redComparable` de M6 sobre la venta total de cada
 * tienda (sumada de `series`): tienda tipo Tienda y activa, abierta los doce meses de `Z` (o de enero a `k` si `Z = Y`) por las
 * fechas de M4 y con venta en cada mes por los datos de M5. Los comparables de `Z−1` a `Z` son `C(Z) = red(Z−1) ∩ red(Z)`.
 */

/** Parámetros de red de la 06d: los de M6 por defecto, sin la regla de «tienda nueva» (la excluye ya no estar abierta todo `Z−1`). */
export const PARAMETROS_RED_GM: ParametrosRed = {
  solo_tiendas_completas: PARAMETROS_POR_DEFECTO.solo_tiendas_completas,
  exigir_venta_todo_el_ano: PARAMETROS_POR_DEFECTO.exigir_venta_todo_el_ano,
  meses_tienda_nueva: 0,
  umbral_tienda_dominante: PARAMETROS_POR_DEFECTO.umbral_tienda_dominante,
  umbral_forma: PARAMETROS_POR_DEFECTO.umbral_forma,
  peso_minimo_diagnostico: PARAMETROS_POR_DEFECTO.peso_minimo_diagnostico,
};

/** Venta total (todos los GM) por tienda y mes, sumada de `series`: la entrada de `redComparable`. */
export function ventaTotalPorTienda(series: readonly SerieGM[]): VentaTiendaMes[] {
  const total = new Map<string, number>();
  for (const s of series) {
    for (const [periodo, u] of Object.entries(s.u)) {
      const k = `${s.t}\u0000${periodo}`;
      total.set(k, (total.get(k) ?? 0) + u);
    }
  }
  return [...total.entries()]
    .map(([k, unidades]) => {
      const [tienda_id, periodo] = k.split("\u0000") as [string, string];
      return { tienda_id, periodo, unidades };
    })
    .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : a.tienda_id < b.tienda_id ? -1 : a.tienda_id > b.tienda_id ? 1 : 0));
}

export type RedesPorAnio = ReadonlyMap<number, RedAnio>;

/**
 * La red de cada año de `anios` hasta `hasta` (el último mes publicado y cerrado). `publicados` son los meses con carga: un mes sin
 * publicar no se exige. Los años posteriores a `hasta` no tienen red.
 */
export function calcularRedes(
  tiendas: readonly TiendaMaestro[],
  venta: readonly VentaTiendaMes[],
  anios: readonly number[],
  hasta: string,
  publicados: Iterable<string>
): RedesPorAnio {
  const redes = redComparable(tiendas, venta, anios, hasta, PARAMETROS_RED_GM, { mesesPublicados: publicados });
  return new Map(redes.map((r) => [r.anio, r]));
}

/** `C(Z)`: las tiendas que están en la red de `Z−1` y en la de `Z`. Vacío si falta alguna de las dos. */
export function comparablesDe(redes: RedesPorAnio, z: number): Set<string> {
  return tiendasComunes(redes.get(z - 1), redes.get(z));
}

const TEXTO_MOTIVO: Record<string, string> = {
  excluida_manual: "excluida a mano",
  centro_distribucion: "no es una tienda",
  tienda_desactivada: "tienda desactivada",
  no_abierta_todo_el_ano: "no estuvo abierta todo el periodo",
  tienda_nueva: "tienda nueva",
  meses_sin_venta: "meses sin venta",
};

/**
 * Por qué una tienda con venta del GM no está en `C(Y)`: el primer motivo de la red donde falla (`Y` primero, luego `Y−1`). `null` si
 * sí está.
 */
export function motivoFuera(redes: RedesPorAnio, y: number, tiendaId: string): string | null {
  if (comparablesDe(redes, y).has(tiendaId)) return null;
  for (const anio of [y, y - 1]) {
    const red = redes.get(anio);
    if (!red) return `sin datos de ${anio}`;
    if (tiendasQueEntran(red).has(tiendaId)) continue;
    const t = red.tiendas.find((x) => x.tienda_id === tiendaId);
    const motivo = t?.motivos.find((m) => m in TEXTO_MOTIVO);
    return `${TEXTO_MOTIVO[motivo ?? "meses_sin_venta"] ?? "fuera de la red"} en ${anio}`;
  }
  return "fuera de la red";
}

/** Años a evaluar: del primer año publicado al del último mes cerrado. */
export function aniosDeRed(publicados: Iterable<string>, hasta: string): number[] {
  const primero = [...publicados].filter((m) => m <= hasta).sort()[0];
  if (primero === undefined) return [];
  const salida: number[] = [];
  for (let a = anioDe(primero); a <= anioDe(hasta); a++) salida.push(a);
  return salida;
}
