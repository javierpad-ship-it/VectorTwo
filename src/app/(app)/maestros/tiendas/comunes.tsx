"use client";

import { Badge } from "@/components/ui/badge";
import type { EstadoTienda, TiendaFila } from "@/lib/tiendas/tipos-api";

/** Hoy en Lima como `aaaa-mm-dd` (mismo criterio que `hoyLima()` del servidor; Railway corre en UTC). */
export function hoyLimaCliente(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
}

/** `2019-03-15` → `15/03/2019`; `null` o vacío → `—`. Sin pasar por `Date` (evita saltos de zona horaria). */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** `2019-03-15` → `15/03`. */
export function formatearDiaMes(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

const MONTO = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `85000` → `S/ 85,000.00`; `null` → `—`. */
export function formatearMonto(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `S/ ${MONTO.format(n)}`;
}

/** Vista del `Input type="number"` a número o `null` (vacío); `NaN` si no es número. */
export function leerMontoInput(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : Number.NaN;
}

const TONO_ESTADO: Record<EstadoTienda, "exito" | "marca" | "alerta"> = {
  Activa: "exito",
  Planificada: "marca",
  Cerrada: "alerta",
};

/** Badge del estado derivado; con `activo = false` muestra "Desactivada" en lugar del estado. */
export function BadgeEstado({ estado, activo = true, prefijo }: { estado: EstadoTienda; activo?: boolean; prefijo?: string }) {
  if (!activo) return <Badge tono="neutro">Desactivada</Badge>;
  return (
    <Badge tono={TONO_ESTADO[estado]}>
      {prefijo ? `${prefijo} ` : ""}
      {estado}
    </Badge>
  );
}

export function BadgeTipo({ tipo }: { tipo: TiendaFila["tipo"] }) {
  return tipo === "Centro de Distribución" ? <Badge tono="marca">CD</Badge> : <span>Tienda</span>;
}
