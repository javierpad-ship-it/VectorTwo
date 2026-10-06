import type { ReactNode } from "react";

type Tono = "marca" | "exito" | "alerta" | "neutro";

const tonos: Record<Tono, string> = {
  marca: "bg-marca-suave text-marca-oscura",
  exito: "bg-exito-suave text-exito",
  alerta: "bg-alerta-suave text-alerta",
  neutro: "bg-neutro-suave text-tinta-suave",
};

/** Fondo y texto arbitrarios (p. ej. el color de una agrupación); sustituye al `tono`. */
export type ColorBadge = { fondo: string; texto: string };

export function Badge({ tono = "neutro", color, children }: { tono?: Tono; color?: ColorBadge | null; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${color ? "" : tonos[tono]}`}
      style={color ? { backgroundColor: color.fondo, color: color.texto } : undefined}
    >
      {children}
    </span>
  );
}
