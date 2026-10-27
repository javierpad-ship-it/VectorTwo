import { formatearDecimal, formatearNumero } from "@/lib/formato";
import type { Senal } from "@/lib/flujo/tipos-api";

/**
 * Presentación de meses, unidades, IMI y dinero para las pantallas de Compras (M8). Puro y sin React. Los meses viajan como
 * `aaaa-mm` y se leen como `oct-26` (cabeceras de tabla) u `oct-2026` (frases). Todo con el formato `es-PE` de la aplicación.
 */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

const esMesValido = (mes: string) => /^\d{4}-(0[1-9]|1[0-2])/.test(mes);

/** `2026-10` → `oct`. */
export function nombreMes(mes: string): string {
  return esMesValido(mes) ? MESES[Number(mes.slice(5, 7)) - 1] : mes;
}

/** `2026-10` → `oct-26`. */
export function mesCorto(mes: string): string {
  return esMesValido(mes) ? `${nombreMes(mes)}-${mes.slice(2, 4)}` : mes;
}

/** `2026-10` → `oct-2026`. */
export function mesLargo(mes: string): string {
  return esMesValido(mes) ? `${nombreMes(mes)}-${mes.slice(0, 4)}` : mes;
}

/** `2026-10` + 3 → `2027-01`. */
export function sumarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const indice = a * 12 + (m - 1) + n;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
}

/** `[desde … hasta]` mes a mes; vacío si `desde > hasta`. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  for (let m = desde; m <= hasta && salida.length < 600; m = sumarMes(m, 1)) salida.push(m);
  return salida;
}

/** El mes en curso en Lima (`aaaa-mm`); el reloj entra como parámetro para poder probarlo. */
export function mesActualLima(ahora: Date = new Date()): string {
  return fechaLima(ahora).slice(0, 7);
}

/** La fecha de hoy en Lima como `aaaa-mm-dd`. */
export function fechaLima(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ahora);
  const dato = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${dato("year")}-${dato("month")}-${dato("day")}`;
}

/** `2026-02` → `2026-02-28`. */
export function ultimoDiaDelMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** `2026-10-14T15:02:00.000Z` → `2026-10-14 10:02` (hora de Lima). */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const dato = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "00";
  return `${dato("year")}-${dato("month")}-${dato("day")} ${dato("hour")}:${dato("minute")}`;
}

/** Unidades enteras con separador de miles; el cálculo va en flotante y se redondea solo al mostrar. */
export const unidades = (n: number): string => formatearNumero(Math.round(n) || 0);

/** `1 127 u`. */
export const unidadesU = (n: number): string => `${unidades(n)} u`;

/** IMI con un decimal; `—` si no hay (sin demanda o sin curva). */
export const imi = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : formatearDecimal(n, 1));

/** `S/ 38,00` o `US$ 12,50` (la moneda de la compra; no se convierte). */
export function dinero(moneda: "PEN" | "USD", n: number | null): string {
  if (n === null) return "—";
  return `${moneda === "PEN" ? "S/" : "US$"} ${formatearDecimal(n, 2)}`;
}

/** Texto de un porcentaje en puntos 0–100. */
export const porcentaje = (n: number): string => `${formatearDecimal(n, n % 1 === 0 ? 0 : 1)} %`;

// ─── Señales ───

export type TonoSenal = "marca" | "exito" | "alerta" | "neutro";

/** Quiebre y falta piden comprar (alerta), el exceso es el otro lado (marca), al día va en verde; lo demás, neutro. */
export const TONO_SENAL: Record<Senal, TonoSenal> = {
  quiebre: "alerta",
  falta: "alerta",
  exceso: "marca",
  al_dia: "exito",
  sin_demanda: "neutro",
  sin_curva: "neutro",
};

/** Texto de la ayuda de cada señal (para `title`). */
export const AYUDA_SENAL: Record<Senal, string> = {
  quiebre: "El stock proyectado llega a cero o menos: la venta no se podría atender.",
  falta: "Hay saldo por comprar: sin compras nuevas el IMI baja del mínimo.",
  exceso: "El stock proyectado supera el tope (IMI máximo).",
  al_dia: "El IMI proyectado se mantiene dentro del rango.",
  sin_demanda: "No hay venta proyectada en el horizonte: no se calcula el IMI.",
  sin_curva: "Tiene venta anual proyectada pero sin curva de estacionalidad: no se puede repartir mes a mes y queda fuera del IMI total.",
};

/** Clase de color del texto de una cifra según el tono (solo tokens del tema). */
export const CLASE_TEXTO_TONO: Record<TonoSenal, string> = {
  marca: "text-marca-oscura",
  exito: "text-exito",
  alerta: "text-alerta",
  neutro: "text-tinta-suave",
};
