/**
 * Calendario sin `Date` (el método nunca lee el reloj ni depende de la zona
 * horaria). Las fechas viajan como `aaaa-mm-dd` y se comparan como cadenas.
 */

export function esBisiesto(anio: number): boolean {
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

const DIAS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Días de un mes (`mes` de 1 a 12). */
export function diasDelMes(anio: number, mes: number): number {
  return mes === 2 && esBisiesto(anio) ? 29 : DIAS[mes - 1];
}

const dos = (n: number) => String(n).padStart(2, "0");

/** `aaaa-mm-dd` a partir de sus partes. */
export function iso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, "0")}-${dos(mes)}-${dos(dia)}`;
}

/** Solo la parte de fecha de un valor de `date` o `timestamp`. */
export function soloFecha(valor: string): string {
  return valor.slice(0, 10);
}

export type PartesFecha = { anio: number; mes: number; dia: number };

export function partesDeFecha(fecha: string): PartesFecha {
  const [anio, mes, dia] = soloFecha(fecha).split("-").map(Number);
  return { anio, mes, dia };
}

/**
 * Índice de mes absoluto (`año × 12 + mes − 1`): permite restar meses entre años.
 */
export function indiceMes(anio: number, mes: number): number {
  return anio * 12 + (mes - 1);
}
