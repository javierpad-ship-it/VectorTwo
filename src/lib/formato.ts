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

/**
 * Número decimal con el formato `es-PE` de la pantalla (decimal con punto, miles
 * con coma): `formatearDecimal(27.43, 1)` → `"27.4"`. Lo usan igual el servidor
 * (frases, avisos y motivos que genera) y la pantalla, para que un mismo número
 * se lea igual en los dos sitios.
 */
export function formatearDecimal(n: number, decimales = 1): string {
  return n.toLocaleString("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/** Puntos porcentuales sin la unidad: `27.4`. Es lo que muestra `formatearPp` sin el " pp". */
export function formatearPuntos(n: number, decimales = 1): string {
  return formatearDecimal(n, decimales);
}

/** Puntos porcentuales con la unidad: `27.4 pp`. */
export function formatearPp(n: number, decimales = 1): string {
  return `${formatearPuntos(n, decimales)} pp`;
}
