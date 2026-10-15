import { diasDelMes, indiceMes, partesDeFecha } from "./calendario";
import type { AvisoFila, Metodo } from "./tipos-api";

/**
 * Cierres de tienda (ficha 07, paso 5 y regla 24). Puro.
 *
 * En la primera entrega (`0.10.0`) un cierre solo se CLASIFICA: su real hasta `k` es lo propuesto
 * (`metodo = cierre`) y el aviso `cierre_no_proyectado` dice que el resto no se proyecta. La proyección de los
 * meses restantes (composición propia × curva × fracción abierta) es de `0.10.1`; `fraccionAbierta` ya deja
 * lista la fracción `q_m`.
 */

/**
 * `q_m` de los doce meses de `anio`: 1 antes del mes de cierre, `días hasta el cierre ÷ días del mes` en el mes de
 * cierre (`fecha_cierre` es el último día con venta, inclusive) y 0 después.
 */
export function fraccionAbierta(fechaCierre: string, anio: number): number[] {
  const { anio: ca, mes: cm, dia } = partesDeFecha(fechaCierre);
  const base = indiceMes(ca, cm);
  return Array.from({ length: 12 }, (_, i) => {
    const j = indiceMes(anio, i + 1) - base;
    if (j < 0) return 1;
    if (j === 0) return dia / diasDelMes(ca, cm);
    return 0;
  });
}

export type ResultadoCierreTienda = {
  vendido: number;
  propuesto: number;
  metodo: Metodo;
  avisos: AvisoFila[];
};

/**
 * Regla 24 (primera entrega). `propuesto = vendido`; `cierre_no_proyectado` si el cierre es posterior al último mes
 * cerrado (`k` de `anioEnCurso`) o si el año es el siguiente (no hay real).
 */
export function proponerCierreTienda(args: {
  vendido: number;
  fechaCierre: string;
  anio: number;
  anioEnCurso: number;
  k: number;
}): ResultadoCierreTienda {
  const { anio: ca, mes: cm } = partesDeFecha(args.fechaCierre);
  // El cierre ya pasó (cierre ≤ último día de k) solo en el año en curso.
  const yaCerro = args.anio === args.anioEnCurso && indiceMes(ca, cm) <= indiceMes(args.anioEnCurso, args.k);
  return {
    vendido: args.vendido,
    propuesto: args.vendido,
    metodo: "cierre",
    avisos: yaCerro ? [] : ["cierre_no_proyectado"],
  };
}
