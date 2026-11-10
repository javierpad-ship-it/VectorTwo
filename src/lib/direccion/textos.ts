import { formatearDecimal, formatearNumero } from "@/lib/formato";

/**
 * Textos del tablero de dirección que arma el servidor (frases del resumen, alertas, etiquetas). Puro. Formato `es-PE` compartido con la pantalla
 * (`src/lib/formato.ts`): miles con coma y decimal con punto.
 */

export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

/** Signo menos tipográfico («−», U+2212): el mismo en todos los textos que arma el servidor (nunca el guion «-»). */
export const MENOS = "−";

/** `12 345` → «12,345»; `−2 961` → «−2,961» (con el signo menos tipográfico, no con guion). */
export const miles = (n: number): string => {
  const r = Math.round(n);
  return r < 0 ? `${MENOS}${formatearNumero(-r)}` : formatearNumero(r);
};

/**
 * T3: una frase del servidor con un solo punto final y sin «..» tras una abreviatura: un nombre puede terminar en punto («Admin A.») y la frase
 * le añade el suyo. Respeta los puntos suspensivos («…» y «...»).
 */
export const frase = (texto: string): string => texto.replace(/(?<!\.)\.\.(?!\.)/g, ".");

/** Unidades con signo: «+1,214» o «−2,961» (signo menos tipográfico, como el resto de la aplicación). */
export const conSigno = (n: number): string => `${n < 0 ? MENOS : "+"}${miles(Math.abs(n))}`;

/** Porcentaje con signo y un decimal: «+7.9 %», «−3.9 %». `null` → «—». */
export function pct(x: number | null, decimales = 1): string {
  if (x === null || !Number.isFinite(x)) return "—";
  // Un −0,04 no debe leerse «−0.0 %».
  const redondo = Number(x.toFixed(decimales));
  return `${redondo < 0 ? MENOS : "+"}${formatearDecimal(Math.abs(redondo), decimales)} %`;
}

/** Participación (fracción) como porcentaje sin signo: `0.157` → «15.7 %». */
export const parte = (x: number, decimales = 1): string => `${x < 0 ? MENOS : ""}${formatearDecimal(Math.abs(x) * 100, decimales)} %`;

/** Puntos porcentuales con signo: «+4.3 pp». */
export const pp = (x: number): string => `${x < 0 ? MENOS : "+"}${formatearDecimal(Math.abs(Number(x.toFixed(1))), 1)} pp`;

/** `2026-09` (o `2026-09-01`) → «set 2026». */
export function mesAnio(periodo: string): string {
  const mes = Number(periodo.slice(5, 7));
  return `${MESES_CORTOS[mes - 1] ?? periodo.slice(5, 7)} ${periodo.slice(0, 4)}`;
}

/** Rango de meses de un año: `(1, 10)` → «ene–oct»; un solo mes → «oct». */
export const rangoMeses = (desde: number, hasta: number): string => (desde === hasta ? MESES_CORTOS[desde - 1] : `${MESES_CORTOS[desde - 1]}–${MESES_CORTOS[hasta - 1]}`);

const formatoLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });

/** Fecha (Lima) de un instante ISO o de una fecha `aaaa-mm-dd`, como `aaaa-mm-dd`. */
export function fechaLima(instante: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(instante)) return instante;
  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? instante.slice(0, 10) : formatoLima.format(d);
}

/** «07 nov 2026» (día en Lima) de un instante ISO o de una fecha; sin el año con `conAnio = false`. */
export function fechaCorta(instante: string, conAnio = true): string {
  const f = fechaLima(instante);
  const mes = MESES_CORTOS[Number(f.slice(5, 7)) - 1] ?? f.slice(5, 7);
  return conAnio ? `${f.slice(8, 10)} ${mes} ${f.slice(0, 4)}` : `${f.slice(8, 10)} ${mes}`;
}

/** Une una lista en castellano: «a», «a y b», «a, b y c». */
export function lista(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** `(actual − anterior) ÷ anterior × 100` sobre sumas; `null` si el anterior no es mayor que 0. */
export function variacionPct(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || !Number.isFinite(actual) || !Number.isFinite(anterior) || !(anterior > 0)) return null;
  return ((actual - anterior) / anterior) * 100;
}

export const sumar = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);
