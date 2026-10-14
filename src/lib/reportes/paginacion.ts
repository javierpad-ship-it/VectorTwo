/**
 * Paginación "mostrar más" del reporte de agrupación GMLE (M11). Con ~2 300
 * equivalencias, pintar todas las filas de la tabla son decenas de miles de
 * nodos del DOM; la tabla muestra las primeras `PAGINA_FILAS` y un botón
 * añade otras tantas. Es solo presentación: la descarga sigue usando todas las
 * filas filtradas. Funciones puras, sin React.
 */

/** Filas que se pintan al principio y cada vez que se pulsa "Mostrar más". */
export const PAGINA_FILAS = 200;

/** Límite válido: entero entre 0 y el total (un límite no finito o negativo cuenta como 0). */
export function normalizarLimite(limite: number, total: number): number {
  if (!Number.isFinite(limite)) return 0;
  return Math.min(Math.max(0, Math.floor(limite)), Math.max(0, total));
}

/** Las primeras `limite` filas, en el mismo orden y sin mutar la entrada. */
export function limitarFilas<T>(filas: readonly T[], limite: number): T[] {
  return filas.slice(0, normalizarLimite(limite, filas.length));
}

/** Cuántas filas se añadirían al pulsar "Mostrar más": una página, o las que falten. */
export function filasPorAnadir(limite: number, total: number, pagina: number = PAGINA_FILAS): number {
  return Math.min(pagina, Math.max(0, total - normalizarLimite(limite, total)));
}

/** Nuevo límite tras pulsar "Mostrar más" (nunca pasa del total). */
export function ampliarLimite(limite: number, total: number, pagina: number = PAGINA_FILAS): number {
  return normalizarLimite(limite, total) + filasPorAnadir(limite, total, pagina);
}

/** ¿Quedan filas sin pintar? */
export function hayMasFilas(limite: number, total: number): boolean {
  return normalizarLimite(limite, total) < total;
}
