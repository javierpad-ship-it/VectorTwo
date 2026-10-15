import { claseDeAnio, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import { aPeriodo } from "@/lib/ventas/periodo";
import { esMisma } from "./bloques";
import { factorDe, type FactorProy } from "./nino";

/**
 * Tendencia del último año completo como referencia del crecimiento por defecto (ficha 07, paso 1 y paso 8): `total(Y−1) ÷
 * total(Y−2) − 1` sobre las tiendas de `M(Y−1) ∩ M(Y)`, con los meses del Niño llevados a su nivel normal. Es la señal de toda
 * la red (la de cada fila vive en su `historico.tendencia`). Pura.
 */

/** `φ` mensual global del año: el factor de la temporada en cada mes atípico (invierno y verano a la vez promedian). */
export function factorMensualGlobal(anio: number, periodos: readonly PeriodoParaClase[], factores: readonly FactorProy[]): number[] {
  const suma = Array.from({ length: 12 }, () => 0);
  const n = Array.from({ length: 12 }, () => 0);
  for (const temporada of ["invierno", "verano"] as const) {
    const ratio = factorDe(factores, anio, temporada);
    if (ratio === null || !(ratio > 0)) continue;
    for (const mes of claseDeAnio(anio, { temporada }, periodos, []).meses_atipicos) {
      const i = Number(mes.slice(5, 7)) - 1;
      if (i < 0 || i > 11) continue;
      suma[i] += ratio;
      n[i] += 1;
    }
  }
  return suma.map((s, i) => (n[i] > 0 ? s / n[i] : 1));
}

/**
 * En % (por ejemplo `4,2`), o `null` si falta algún mes de `Y−2` o `Y−1`, no hay tiendas en `M(Y−1) ∩ M(Y)` o `Y−2` no vendió.
 * `venta` son las unidades por tienda y mes (`aaaa-mm`) de M6; `publicados`, los meses con carga.
 */
export function tendenciaUltimoAnioPct(args: {
  anioEnCurso: number;
  tiendas: readonly TiendaMaestro[];
  venta: readonly { tienda_id: string; periodo: string; unidades: number }[];
  publicados: readonly string[];
  periodos: readonly PeriodoParaClase[];
  factores: readonly FactorProy[];
}): number | null {
  const Y = args.anioEnCurso;
  const publicados = new Set(args.publicados.map((p) => p.slice(0, 7)));
  for (const z of [Y - 2, Y - 1]) for (let m = 1; m <= 12; m++) if (!publicados.has(aPeriodo(z, m))) return null;
  const comunes = new Set(args.tiendas.filter((t) => esMisma(t, Y - 1) && esMisma(t, Y)).map((t) => t.id));
  if (comunes.size === 0) return null;
  const total = (z: number): number => {
    const phi = factorMensualGlobal(z, args.periodos, args.factores);
    let suma = 0;
    for (const v of args.venta) {
      if (!comunes.has(v.tienda_id) || Number(v.periodo.slice(0, 4)) !== z) continue;
      suma += v.unidades / (phi[Number(v.periodo.slice(5, 7)) - 1] ?? 1);
    }
    return suma;
  };
  const antes = total(Y - 2);
  if (!(antes > 0)) return null;
  return Math.round((total(Y - 1) / antes - 1) * 1000) / 10;
}
