import type { MedidasC } from "./tipos";

/**
 * Lectura y redondeo de cifras (docs/modulos/05-venta-stock.md, reglas 5–9).
 * Funciones puras. Punto decimal; coma de miles solo en grupos de tres;
 * coma decimal NO se adivina.
 */

export const NUMERO_INVALIDO = "invalido";

// 1 234 567.5 con o sin separadores de miles (coma + exactamente tres dígitos).
const SIN_SIGNO = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$|^\.\d+$/;
const CIENTIFICA = /^\d+(?:\.\d+)?[eE][+-]?\d+$/;
// Formas de coma decimal: `12,5`, `0,25`, `1.234,56`.
const COMA_DECIMAL = /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/;

/** `-0` → `0`. */
const sinCeroNegativo = (n: number) => (n === 0 ? 0 : n);

/**
 * Regla 5. `"7913"` → 7913; `"7,913"` → 7913; `"1,234,567.5"` → 1234567.5;
 * `"-12.5"` y `"(12.5)"` → −12.5; `"1e3"` → 1000. Todo lo demás (`"12,5"`,
 * `"1.234,56"`, `"1,23"`, `"abc"`, `""`) → `"invalido"`: el vacío en una
 * medida es inválido porque QlikView exporta `0`. Nunca `-0`.
 */
const ENTERO_O_DECIMAL = /^-?\d+(?:\.\d+)?$/;

export function leerNumero(valor: unknown): number | typeof NUMERO_INVALIDO {
  // Camino rápido: el caso real (`7913`, `-12.5`) sin separadores ni espacios.
  if (typeof valor === "string" && ENTERO_O_DECIMAL.test(valor)) {
    const n = Number(valor);
    return n === 0 ? 0 : n;
  }
  if (typeof valor === "number") return Number.isFinite(valor) ? sinCeroNegativo(valor) : NUMERO_INVALIDO;
  if (typeof valor !== "string") return NUMERO_INVALIDO;

  let texto = valor.trim().replace(/\s+/g, "");
  if (texto === "") return NUMERO_INVALIDO;

  let negativo = false;
  const parentesis = /^\((.*)\)$/.exec(texto);
  if (parentesis) {
    negativo = true;
    texto = parentesis[1];
  }
  if (texto.startsWith("-")) {
    negativo = !negativo;
    texto = texto.slice(1);
  } else if (texto.startsWith("+")) {
    texto = texto.slice(1);
  }

  let n: number;
  if (CIENTIFICA.test(texto)) n = Number(texto);
  else if (SIN_SIGNO.test(texto)) n = Number(texto.replace(/,/g, ""));
  else return NUMERO_INVALIDO;

  if (!Number.isFinite(n)) return NUMERO_INVALIDO;
  return sinCeroNegativo(negativo ? -n : n);
}

/** `true` si la celda tiene forma de coma decimal (`12,5`, `1.234,56`). */
export function esComaDecimal(valor: string): boolean {
  return COMA_DECIMAL.test(valor.trim().replace(/\s+/g, ""));
}

/**
 * Regla 8. Verdadero cuando más del 1 % de las celdas numéricas (las que
 * parsean o tienen forma de coma decimal) tienen forma `\d+,\d{1,2}`. Falso
 * para `7,913` y `1,234,567`.
 */
export function pareceComaDecimal(valores: readonly string[]): boolean {
  let numericas = 0;
  let coma = 0;
  for (const v of valores) {
    if (esComaDecimal(v)) {
      numericas += 1;
      coma += 1;
    } else if (leerNumero(v) !== NUMERO_INVALIDO) numericas += 1;
  }
  return proporcionComaDecimalAlta(coma, numericas);
}

/** Misma regla desde contadores (el acumulador no conserva las celdas). */
export function proporcionComaDecimalAlta(celdasComa: number, celdasNumericas: number): boolean {
  return celdasNumericas > 0 && celdasComa / celdasNumericas > 0.01;
}

/**
 * Quita el ruido de coma flotante de un valor ya multiplicado (`x = |n| * 100`)
 * sin mover los montos grandes: `1.005 * 100 = 100.49999999999999` se corrige a
 * `100.5`, y `30000000 * 100` se queda en `3000000000`. Un épsilon relativo
 * (`x * 1e-9`) corrompía los montos grandes (S/ 30 000 000 daba +S/ 0,03);
 * 15 cifras significativas son las que un `double` garantiza.
 */
const limpiarRuido = (x: number): number => Number(x.toPrecision(15));

/**
 * Regla 6. Redondea a 2 decimales, mitad hacia afuera de cero y con tolerancia
 * al ruido de coma flotante: `205.70999999999998` → `205.71`, `1.005` → `1.01`,
 * `-1.005` → `-1.01`, `-0.004` → `0` (nunca `-0`).
 */
export function redondear2(n: number): number {
  const r = Math.round(limpiarRuido(Math.abs(n) * 100)) / 100;
  return sinCeroNegativo(n < 0 ? -r : r);
}

/** Céntimos enteros de un monto (redondeado a 2 decimales). */
export function aCentimos(n: number): number {
  const c = Math.round(limpiarRuido(Math.abs(n) * 100));
  return sinCeroNegativo(n < 0 ? -c : c);
}

/** Soles con 2 decimales a partir de céntimos enteros. */
export function centimosASoles(c: number): number {
  return sinCeroNegativo(c / 100);
}

/**
 * Regla 7. Redondea a entero (mitad hacia afuera de cero). `tuvoDecimales` es
 * verdadero si había una parte decimal real (el ruido de coma flotante no cuenta).
 */
export function aEntero(n: number): { valor: number; tuvoDecimales: boolean } {
  const x = Math.abs(n);
  const r = Math.round(limpiarRuido(x));
  const tuvoDecimales = Math.abs(x - r) > 1e-6;
  return { valor: sinCeroNegativo(n < 0 ? -r : r), tuvoDecimales };
}

/** Regla 9. Verdadero si todos los valores no tienen céntimos (export en soles enteros). */
export function todasEnteras(valores: readonly number[]): boolean {
  return valores.every((v) => Math.abs(v * 100 - Math.round(v) * 100) < 1e-6);
}

/** Todas las medidas en cero (en céntimos y unidades ya redondeadas). */
export function medidasEnCero(m: MedidasC): boolean {
  return m.unidades === 0 && m.venta === 0 && m.costo === 0 && m.stock_unidades === 0 && m.stock_valorizado === 0;
}

/** Hay céntimos reales en alguna de las tres medidas de dinero (en céntimos). */
export function tieneCentavos(m: MedidasC): boolean {
  return m.venta % 100 !== 0 || m.costo % 100 !== 0 || m.stock_valorizado % 100 !== 0;
}
