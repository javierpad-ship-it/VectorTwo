import type { ReactNode } from "react";

type Tono = "marca" | "exito" | "alerta" | "neutro";

const tonos: Record<Tono, string> = {
  marca: "bg-marca-suave text-marca-oscura",
  exito: "bg-exito-suave text-exito",
  alerta: "bg-alerta-suave text-alerta",
  neutro: "bg-neutro-suave text-tinta-suave",
};

export function Badge({ tono = "neutro", children }: { tono?: Tono; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tonos[tono]}`}>
      {children}
    </span>
  );
}
