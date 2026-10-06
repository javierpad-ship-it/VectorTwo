import { ESTADOS_TIENDA, TIPOS_TIENDA, type EstadoTienda, type TipoTienda } from "./tipos";

/**
 * Estado derivado de una tienda (docs/modulos/04-tiendas.md, "Estado
 * derivado" y reglas 1–3). Funciones puras sin `Date` salvo `hoyLima`.
 *
 * Las fechas son ISO `aaaa-mm-dd` (así viajan las `date` de Postgres) y se
 * comparan como cadenas: es correcto para ese formato y evita cualquier
 * desplazamiento de zona horaria al convertir a `Date`.
 */

export type FechasTienda = { fecha_apertura: string | null; fecha_cierre: string | null };

/**
 *   1. Sin apertura, o apertura > hoy → Planificada.
 *   2. Si no, con cierre y cierre < hoy → Cerrada (el cierre es el último día con venta).
 *   3. Si no → Activa.
 */
export function estadoTienda(t: FechasTienda, hoy: string): EstadoTienda {
  if (!t.fecha_apertura || t.fecha_apertura > hoy) return "Planificada";
  if (t.fecha_cierre && t.fecha_cierre < hoy) return "Cerrada";
  return "Activa";
}

const formatoLima = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Fecha de hoy en Lima como `aaaa-mm-dd`. El servidor corre en UTC y desde
 * las 19:00 de Lima `new Date().toISOString()` ya sería "mañana".
 */
export function hoyLima(ahora: Date = new Date()): string {
  return formatoLima.format(ahora);
}

export function esEstadoTienda(valor: unknown): valor is EstadoTienda {
  return typeof valor === "string" && (ESTADOS_TIENDA as readonly string[]).includes(valor);
}

export function esTipoTienda(valor: unknown): valor is TipoTienda {
  return typeof valor === "string" && (TIPOS_TIENDA as readonly string[]).includes(valor);
}
