"use client";

import { formatearNumero } from "@/lib/formato";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** `2026-09` → `setiembre 2026` (el texto largo se usa en confirmaciones y mensajes). */
export function nombrePeriodo(periodo: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodo);
  if (!m) return periodo;
  return `${MESES[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

const SOLES = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const SOLES_2 = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Soles sin céntimos (las cifras de QlikView vienen enteras); `null` → `—`. */
export function formatearSoles(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${SOLES.format(n)}`;
}

/** Soles con céntimos, para conciliar. */
export function formatearSoles2(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${SOLES_2.format(n)}`;
}

export function formatearEntero(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return formatearNumero(n);
}

/** Porcentaje con un decimal (`0.0213` → `2,1 %`); los valores muy chicos no se muestran como 0. */
export function formatearPct(fraccion: number): string {
  if (!Number.isFinite(fraccion)) return "—";
  const p = fraccion * 100;
  if (p !== 0 && Math.abs(p) < 0.1) return `${p < 0 ? "-" : ""}<0,1 %`;
  return `${p.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/** Porcentaje que ya viene en 0 a 100 (como lo calcula el informe): `2.13` → `2,1 %`. */
export function formatearPorcentaje(porcentaje: number): string {
  return formatearPct(porcentaje / 100);
}

/** Fecha y hora en Lima: `2026-10-09T15:02:11Z` → `09/10/2026 10:02`. */
export function formatearFechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Solo la hora en Lima (`10:42`), para "desde las 10:42". */
export function formatearHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function formatearTamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-PE", { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-PE", { maximumFractionDigits: 1 })} MB`;
}

export function formatearDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}
