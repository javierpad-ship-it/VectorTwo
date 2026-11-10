import { formatearDecimal, formatearNumero } from "@/lib/formato";
import type { EstadoAprobacion, MotivoDireccion, ResultadoAprobacion } from "@/lib/direccion/tipos-api";

/**
 * Formatos y textos compartidos del tablero de aprobación de dirección (ficha 14, §4) y de sus avisos en Proyección y en Flujo mensual (§4.11).
 * Puro: sin React ni red. Formato `es-PE` de la app (miles con coma, decimal con punto, mes «set»), igual en pantalla y en el Excel.
 */

export const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;
export const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"] as const;

const SIN_DATO = "—";

/** Unidades: `52,708`; `—` si no hay dato. */
export function unidades(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? SIN_DATO : formatearNumero(Math.round(n));
}

/** Unidades con signo: `+1,408`, `-2,961`, `0`; `—` si no hay dato. */
export function unidadesConSigno(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return SIN_DATO;
  const r = Math.round(n);
  if (r === 0) return "0";
  return `${r > 0 ? "+" : "-"}${formatearNumero(Math.abs(r))}`;
}

/** Porcentaje con signo (7.9 = 7,9 %): `+7.9 %`, `-3.9 %`, `0.0 %`; `—` si no hay dato. */
export function porcentaje(n: number | null | undefined, decimales = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return SIN_DATO;
  const factor = 10 ** decimales;
  const r = Math.round(n * factor) / factor;
  const texto = formatearDecimal(Math.abs(r), decimales);
  if (r === 0) return `${texto} %`;
  return `${r > 0 ? "+" : "-"}${texto} %`;
}

/** Puntos porcentuales con signo: `+4.3 pp`. */
export function puntos(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return SIN_DATO;
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "-" : ""}${formatearDecimal(Math.abs(r), 1)} pp`;
}

/** Participación (fracción, 0.157 = 15,7 %): `15.7 %`, sin signo. */
export function participacion(fraccion: number | null | undefined, decimales = 1): string {
  return fraccion === null || fraccion === undefined || !Number.isFinite(fraccion) ? SIN_DATO : `${formatearDecimal(fraccion * 100, decimales)} %`;
}

/** Soles sin decimales: `S/ 2,350,000`. */
export function soles(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? SIN_DATO : `S/ ${formatearNumero(Math.round(n))}`;
}

/** Meses de cobertura: `6.9 meses`. */
export function mesesCobertura(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? SIN_DATO : `${formatearDecimal(n, 1)} meses`;
}

/** 1 a 12 → `ene` … `dic`. */
export function nombreMes(mes: number): string {
  return MESES[mes - 1] ?? "?";
}

/** `2026-09` o `2026-09-01` → `set 2026`. */
export function mesAnio(periodo: string | null | undefined): string {
  if (!periodo || !/^\d{4}-\d{2}/.test(periodo)) return SIN_DATO;
  return `${nombreMes(Number(periodo.slice(5, 7)))} ${periodo.slice(0, 4)}`;
}

/** Rango de meses del año: `rangoMeses(1, 9)` → `ene–set`; un solo mes, `oct`. */
export function rangoMeses(desde: number, hasta: number): string {
  if (hasta < desde) return SIN_DATO;
  return desde === hasta ? nombreMes(desde) : `${nombreMes(desde)}–${nombreMes(hasta)}`;
}

type PartesFecha = { anio: number; mes: number; dia: number; hora: string | null };

/** Un instante ISO (en hora de Lima) o una fecha `aaaa-mm-dd` (tal cual), en partes. `null` si no se entiende. */
export function partesFecha(iso: string | null | undefined): PartesFecha | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { anio: Number(iso.slice(0, 4)), mes: Number(iso.slice(5, 7)), dia: Number(iso.slice(8, 10)), hora: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return { anio: Number(de("year")), mes: Number(de("month")), dia: Number(de("day")), hora: `${de("hour")}:${de("minute")}` };
}

/** `2026-11-07T15:00:00Z` o `2026-11-07` → `07 nov 2026` (en Lima). */
export function fechaCorta(iso: string | null | undefined): string {
  const p = partesFecha(iso);
  return p === null ? (iso ?? SIN_DATO) : `${String(p.dia).padStart(2, "0")} ${nombreMes(p.mes)} ${p.anio}`;
}

/** `2026-11-07T15:00:00Z` → `07 nov 2026, 10:00` (en Lima). */
export function fechaHora(iso: string | null | undefined): string {
  const p = partesFecha(iso);
  if (p === null) return iso ?? SIN_DATO;
  return p.hora === null ? fechaCorta(iso) : `${fechaCorta(iso)}, ${p.hora}`;
}

// ─── Estado de la aprobación de dirección ───

export const ETIQUETA_RESULTADO: Record<ResultadoAprobacion, string> = {
  aprobada: "Aprobada",
  con_observaciones: "Aprobada con observaciones",
  rechazada: "Rechazada",
};

export const ETIQUETA_MOTIVO: Record<MotivoDireccion, string> = {
  crecimiento_alto: "Crecimiento alto",
  crecimiento_bajo: "Crecimiento bajo",
  contra_tendencia: "Contra la tendencia de venta",
  tiendas_nuevas: "Tiendas nuevas o aperturas",
  nino: "Efecto del Niño",
  filas_sin_decidir: "Filas sin decidir",
  concentracion: "Concentración en pocas filas",
  otro: "Otro",
};

export function etiquetaMotivo(motivo: string | null | undefined): string {
  if (!motivo) return SIN_DATO;
  return (ETIQUETA_MOTIVO as Record<string, string>)[motivo] ?? motivo.replace(/_/g, " ");
}

/** Lo mínimo de una aprobación para decir el estado en texto. */
export type AprobacionParaEstado = { usuario_nombre: string; created_at: string; invalidada_por?: "cifras" | "version_huella" | null };

/**
 * El estado de dirección EN TEXTO (§4.2): nunca solo un color. `ultima` es la aprobación más reciente de la proyección (la vigente, si la hay).
 * «Con observaciones» cuenta como aprobación vigente (§5.1).
 */
export function textoEstadoDireccion(estado: EstadoAprobacion, ultima: AprobacionParaEstado | null | undefined): string {
  const quien = ultima ? ` por ${ultima.usuario_nombre} el ${fechaCorta(ultima.created_at)}` : "";
  switch (estado) {
    case "sin_aprobacion":
      return "Sin aprobación de dirección";
    case "aprobada":
      return `Aprobada${quien}`;
    case "con_observaciones":
      return `Aprobada con observaciones${quien}`;
    case "rechazada":
      return `Rechazada${quien}`;
    case "invalidada":
      if (ultima?.invalidada_por === "version_huella") return "Aprobación invalidada por un cambio en el cálculo de la huella";
      return ultima ? `Aprobación invalidada: la proyección cambió después del ${fechaCorta(ultima.created_at)}` : "Aprobación invalidada: la proyección cambió después de aprobarse";
  }
}

export type TonoEstado = "exito" | "marca" | "alerta" | "neutro";

export function tonoEstadoDireccion(estado: EstadoAprobacion): TonoEstado {
  if (estado === "aprobada") return "exito";
  if (estado === "con_observaciones") return "marca";
  if (estado === "sin_aprobacion") return "neutro";
  return "alerta";
}

/** ¿Hay aprobación vigente? (aprobada o con observaciones; §5.1). Los avisos de §4.11 se encienden cuando no la hay. */
export function hayAprobacionVigente(estado: EstadoAprobacion): boolean {
  return estado === "aprobada" || estado === "con_observaciones";
}

export const RUTA_TABLERO_DIRECCION = "/planificacion/aprobacion-direccion";

/** Enlace al tablero abierto en una proyección. */
export function enlaceTablero(proyeccionId?: string | null): string {
  return proyeccionId ? `${RUTA_TABLERO_DIRECCION}?proyeccion=${encodeURIComponent(proyeccionId)}` : RUTA_TABLERO_DIRECCION;
}
