import { TEMPORADAS_DEFECTO, type RangoTemporada, type Temporada, type TemporadasConfig } from "./tipos-api";

/**
 * Temporadas (decisión 31 de Javier): verano octubre–marzo e invierno abril–septiembre POR DEFECTO, con fechas editables en
 * Parámetros de M8 (`flujo_parametros.temporadas`). `temporadaDe` y `mesesDe` son la ÚNICA forma de decidir a qué temporada
 * pertenece un mes (aquí y en M8, que las mueve a `src/lib/flujo/temporadas.ts`). Puras.
 */

export { TEMPORADAS_DEFECTO };

/** Los meses (1 a 12) de un rango, que puede cruzar el fin de año (`10 → 3` = oct, nov, dic, ene, feb, mar). */
function mesesDeRango(r: RangoTemporada): number[] {
  const salida: number[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((r.desde_mes - 1 + i) % 12) + 1;
    salida.push(m);
    if (m === r.hasta_mes) break;
  }
  return salida;
}

const mesValido = (m: unknown): m is number => typeof m === "number" && Number.isInteger(m) && m >= 1 && m <= 12;

/**
 * `null` si las dos temporadas son válidas (meses de 1 a 12), cubren los doce meses y no se solapan; si no, el motivo en
 * castellano llano.
 */
export function motivoTemporadasInvalidas(t: TemporadasConfig): string | null {
  for (const nombre of ["verano", "invierno"] as const) {
    const r = t?.[nombre];
    if (!r || !mesValido(r.desde_mes) || !mesValido(r.hasta_mes)) {
      return `Las fechas de ${nombre} deben ser meses del 1 al 12.`;
    }
  }
  const verano = new Set(mesesDeRango(t.verano));
  const invierno = new Set(mesesDeRango(t.invierno));
  for (const m of verano) {
    if (invierno.has(m)) return "Las temporadas se solapan: un mes no puede ser de verano y de invierno.";
  }
  if (verano.size + invierno.size !== 12) return "Las temporadas deben cubrir los doce meses del año.";
  return null;
}

/** Los meses (1 a 12, en orden de calendario) de una temporada. Lanza si las temporadas no son válidas. */
export function mesesDe(temporada: Temporada, temporadas: TemporadasConfig = TEMPORADAS_DEFECTO): number[] {
  const motivo = motivoTemporadasInvalidas(temporadas);
  if (motivo) throw new Error(motivo);
  return [...mesesDeRango(temporadas[temporada])].sort((a, b) => a - b);
}

/** La temporada de un mes (1 a 12). Lanza si las temporadas no cubren los doce meses sin solaparse. */
export function temporadaDe(mes: number, temporadas: TemporadasConfig = TEMPORADAS_DEFECTO): Temporada {
  if (!mesValido(mes)) throw new Error("El mes debe estar entre 1 y 12.");
  return mesesDe("verano", temporadas).includes(mes) ? "verano" : "invierno";
}
