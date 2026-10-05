/** Helpers de presentación compartidos por las pantallas (sin dependencias de React). */

export function formatearNumero(n: number): string {
  return n.toLocaleString("es-PE");
}

export function mensajeError(e: unknown): string {
  return e instanceof Error ? e.message : "Error inesperado";
}

/** `plural(1, "fila", "filas")` → "1 fila"; `plural(3, …)` → "3 filas". */
export function plural(n: number, singular: string, pluralTxt: string): string {
  return `${formatearNumero(n)} ${n === 1 ? singular : pluralTxt}`;
}
