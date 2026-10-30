import { aporteSaliente } from "@/lib/proyeccion/siguiente";
import { UMBRAL_APORTE_TIENDAS_PCT, type SenalIa } from "./tipos-api";

/**
 * Aportes de tiendas a la base de 2027 (ficha 07e, §5.1 y ejemplo I; R8). Puro.
 *
 *   B = cierre de A + entrantes − salientes          (identidad de `proponerSiguiente`)
 *   aporte_salientes = Σ aporteSaliente(cierreBase, vendidoBase, vendidoTienda) sobre las tiendas que salen
 *   aporte_entrantes = B − vigente_A + aporte_salientes
 */

export type AportesFila = {
  entrantes: number;
  salientes: number;
  /**
   * `B` quedó en 0 por el `max(0, …)` de `proponerSiguiente`: la identidad `entrantes − salientes = B − vigente` no vale y los
   * entrantes se informan en 0 (aviso interno).
   */
  base_truncada: boolean;
};

/** `Σ aporteSaliente` de las tiendas que salen de `M(A+1)`, con `cierreBase = propuesto_A ?? decidido_A` (`decision.ts`). */
export function aporteSalientesFila(args: { cierreBase: number | null; vendidoBase: number; salientes: readonly { vendido: number }[] }): number {
  let total = 0;
  for (const s of args.salientes) total += aporteSaliente({ cierreBase: args.cierreBase, vendidoBase: args.vendidoBase, vendidoTienda: s.vendido });
  return total;
}

/** `aporte_entrantes = B − vigente_A + aporte_salientes`; con `B = 0` los entrantes son 0. */
export function aportesDeFila(args: { base: number; vigenteY: number; salientes: number }): AportesFila {
  if (args.base <= 0) return { entrantes: 0, salientes: args.salientes, base_truncada: args.salientes !== args.vigenteY };
  return { entrantes: Math.max(0, args.base - args.vigenteY + args.salientes), salientes: args.salientes, base_truncada: false };
}

/** Señales `tiendas_entrantes` y `tiendas_salientes`: el aporte pesa al menos el 10 % de `B`. */
export function senalesTiendas(aportes: Pick<AportesFila, "entrantes" | "salientes">, base: number | null): Extract<SenalIa, "tiendas_entrantes" | "tiendas_salientes">[] {
  if (base === null || !(base > 0)) return [];
  const salida: Extract<SenalIa, "tiendas_entrantes" | "tiendas_salientes">[] = [];
  if (aportes.entrantes > 0 && aportes.entrantes * 100 >= UMBRAL_APORTE_TIENDAS_PCT * base) salida.push("tiendas_entrantes");
  if (aportes.salientes > 0 && aportes.salientes * 100 >= UMBRAL_APORTE_TIENDAS_PCT * base) salida.push("tiendas_salientes");
  return salida;
}
