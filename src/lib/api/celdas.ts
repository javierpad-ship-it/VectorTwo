import { z } from "zod";

/**
 * Topes de longitud por celda para los importadores masivos. El cliente manda
 * hasta 10 000 filas; sin tope por celda, una sola celda de varios megabytes
 * cabe dentro del límite del cuerpo y se la comen las funciones de parseo.
 * 300 caracteres sobra para cualquier nombre legítimo (los de dominio son más
 * cortos y las reglas de cada importador los siguen validando por fila); las
 * notas y descripciones admiten 1 000.
 */
export const MAX_CELDA = 300;
export const MAX_CELDA_NOTA = 1_000;

/** Celda de texto con tope: el mensaje de tipo es el de siempre, más el de longitud. */
export function celdaTexto(campo: string, max: number = MAX_CELDA) {
  return z.string(`${campo} debe ser texto.`).max(max, `${campo} no puede superar los ${max} caracteres.`);
}
