import { CAUSAS_SIN_ATRASO, type CausaFecha, type HitoConfirmable } from "./tipos";

/**
 * Fechas y orden de los hitos de un embarque (ficha 08b-1b, §2.1, §2.2 y §2.10). PURO y sin dependencias de `movimiento.ts` ni de
 * `hitos.ts` (los dos lo importan): días entre fechas, qué es «futuro» en hora de Lima, el orden de los hitos, la integridad de un hito
 * confirmado (I7, espejo de `agrupador_hito_violado` de la 0038) y los textos cortos de fecha. Sin reloj: «hoy» y «ahora» entran como
 * parámetros (fecha y hora de Lima, `aaaa-mm-dd` y `hh:mm`; Lima no tiene horario de verano).
 */

const MS_POR_DIA = 86_400_000;

/** Fecha y hora de Lima en este instante (el llamador las lee del reloj o las fija en una prueba). */
export type AhoraLima = { fecha: string; hora: string };

const aUtc = (f: string): number => {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};

/** Días de `desde` a `hasta` (`aaaa-mm-dd`); positivo si `hasta` es posterior. */
export const diasEntre = (desde: string, hasta: string): number => Math.round((aUtc(hasta) - aUtc(desde)) / MS_POR_DIA);

/** Suma días a una fecha `aaaa-mm-dd`. */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(aUtc(fecha) + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

/** El día de `fecha` es posterior a `hoy`. */
export const esFechaFutura = (fecha: string, hoy: string): boolean => fecha.slice(0, 10) > hoy;

/** Fecha y hora (la hora vacía cuenta como 00:00) posteriores a «ahora». Para el inicio operativo, que lleva hora opcional. */
export const esMomentoFuturo = (fecha: string, hora: string | null | undefined, ahora: AhoraLima): boolean => {
  const f = fecha.slice(0, 10);
  if (f !== ahora.fecha) return f > ahora.fecha;
  return (hora ?? "00:00").slice(0, 5) > ahora.hora.slice(0, 5);
};

/**
 * Una reprogramación cuenta como atraso (contador visible y retraso en días) salvo las causas `correccion` (un dato mal puesto) y
 * `programacion` (decisión propia): quedan en el historial pero no suman (F-R9, decisión 116). Sin causa (un cambio viejo), cuenta.
 */
export const cuentaComoAtraso = (causa: CausaFecha | null | undefined): boolean => causa == null || !CAUSAS_SIN_ATRASO.includes(causa);

// ─── Orden de los hitos ───

/** Posición de cada hito confirmable en la línea de tiempo (el `rango` de `agrupador_hito_violado`). */
export const RANGO_HITO_CONFIRMABLE: Record<HitoConfirmable, number> = { zarpe: 1, arribo: 2, ingreso_cd: 3, inicio_operativo: 4 };
/** El ingreso al stock sigue al inicio operativo: no se confirma («al recibir», 08b-2). */
export const RANGO_INGRESO_STOCK = 5;

export const rangoConfirmado = (hito: HitoConfirmable | null | undefined): number => (hito ? RANGO_HITO_CONFIRMABLE[hito] : 0);

/** Los valores de un embarque que importan a la integridad de sus hitos (los finales de un guardado). */
export type ValoresHitos = {
  fecha_salida_estimada: string | null;
  fecha_puerto_estimada: string | null;
  fecha_llegada_estimada: string;
  fecha_inicio_operativo_estimada: string | null;
  hora_inicio_operativo: string | null;
  hito_confirmado: HitoConfirmable | null;
};

/** La fecha de un hito confirmable. */
export function fechaDeHito(v: ValoresHitos, hito: HitoConfirmable): string | null {
  switch (hito) {
    case "zarpe":
      return v.fecha_salida_estimada;
    case "arribo":
      return v.fecha_puerto_estimada;
    case "ingreso_cd":
      return v.fecha_llegada_estimada;
    case "inicio_operativo":
      return v.fecha_inicio_operativo_estimada;
  }
}

/**
 * I7 (§2.2, espejo de `agrupador_hito_violado`): si hay hito confirmado, ese hito tiene fecha (`fecha_requerida`) y ningún hito en o antes
 * de él tiene fecha futura (`fecha_futura`; el inicio operativo, con su hora). Devuelve `null` si se cumple. Se mide con los valores
 * FINALES de todo guardado, no solo al confirmar.
 */
export function integridadDeHitos(v: ValoresHitos, ahora: AhoraLima): "fecha_requerida" | "fecha_futura" | null {
  const rango = rangoConfirmado(v.hito_confirmado);
  if (rango === 0 || v.hito_confirmado === null) return null;
  if (fechaDeHito(v, v.hito_confirmado) === null) return "fecha_requerida";
  if (rango >= 1 && v.fecha_salida_estimada !== null && esFechaFutura(v.fecha_salida_estimada, ahora.fecha)) return "fecha_futura";
  if (rango >= 2 && v.fecha_puerto_estimada !== null && esFechaFutura(v.fecha_puerto_estimada, ahora.fecha)) return "fecha_futura";
  if (rango >= 3 && esFechaFutura(v.fecha_llegada_estimada, ahora.fecha)) return "fecha_futura";
  if (rango >= 4 && v.fecha_inicio_operativo_estimada !== null && esMomentoFuturo(v.fecha_inicio_operativo_estimada, v.hora_inicio_operativo, ahora)) return "fecha_futura";
  return null;
}

// ─── Orden de fechas (aviso `orden_de_fechas`) ───

export type HitoOrdenado = "zarpe" | "arribo" | "ingreso_cd" | "inicio_operativo" | "ingreso_stock";

const NOMBRE_ORDEN: Record<HitoOrdenado, string> = { zarpe: "Zarpe", arribo: "Arribo", ingreso_cd: "Ingreso CD", inicio_operativo: "Inicio operativo", ingreso_stock: "Ingreso al stock" };
const ORDEN: readonly HitoOrdenado[] = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"];

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/** `2027-04-04` → `04-abr`. */
export function etiquetaDiaMes(fecha: string): string {
  const [, m, d] = fecha.slice(0, 10).split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MESES_CORTOS[m - 1]}`;
}

/** `2026-12` → `dic-26` (como escribe la ficha 08b-1b los meses: «dic-26, sin embarque», «mar-27»). Los meses abreviados son los de `etiquetaMesCorta`. */
export function etiquetaMes(mes: string): string {
  const [a, m] = mes.slice(0, 7).split("-").map(Number);
  return `${MESES_CORTOS[m - 1]}-${String(a % 100).padStart(2, "0")}`;
}

/** `2027-04-04` → `04/04/2027`. */
export function etiquetaFecha(fecha: string): string {
  const [a, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Pares de hitos con fecha fuera de orden (Zarpe ≤ Arribo ≤ Ingreso CD ≤ Inicio operativo ≤ Ingreso al stock). `ingreso_stock` es el
 * FIJADO (sin fijar sigue al Ingreso CD y ya está comparado). El par (Zarpe, Ingreso CD) lo bloquea el `check` de la base y no se avisa
 * aquí. Cada texto: «El Ingreso al stock (12-nov) es anterior al Ingreso CD (15-nov)».
 */
export function ordenDeFechasRoto(fechas: Partial<Record<HitoOrdenado, string | null>>): string[] {
  const textos: string[] = [];
  for (let i = 0; i < ORDEN.length; i++) {
    for (let j = i + 1; j < ORDEN.length; j++) {
      const a = fechas[ORDEN[i]];
      const b = fechas[ORDEN[j]];
      if (!a || !b || a.slice(0, 10) <= b.slice(0, 10)) continue;
      if (ORDEN[i] === "zarpe" && ORDEN[j] === "ingreso_cd") continue;
      textos.push(`${NOMBRE_ORDEN[ORDEN[j]]} (${etiquetaDiaMes(b)}) es anterior al ${NOMBRE_ORDEN[ORDEN[i]]} (${etiquetaDiaMes(a)}).`);
    }
  }
  return textos;
}
