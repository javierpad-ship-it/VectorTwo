"use client";

import { useRef, useState } from "react";
import { formatearDecimal } from "@/lib/formato";
import { leerPorcentaje } from "./ajuste";

/**
 * Celda de porcentaje editable en línea (bloque 1 de M12): muestra un decimal y, al salir de la celda (o con Enter), entrega
 * lo escrito acotado a 0–100 con un decimal; vacío o no numérico = `null` (deshacer la edición de esa celda). El borrador
 * vive aquí mientras se escribe, para que «4» camino de «41,5» no se reescriba a cada pulsación.
 */
export function CeldaPorcentaje({
  valor,
  editada,
  escalada,
  etiqueta,
  disabled,
  onCommit,
}: {
  /** Valor que cuenta hoy (0..100). */
  valor: number;
  /** El planner lo escribió a mano. */
  editada: boolean;
  /** Lo dejó «Renormalizar el resto». */
  escalada: boolean;
  /** Texto accesible: qué fila y qué temporada. */
  etiqueta: string;
  disabled?: boolean;
  onCommit: (valor: number | null) => void;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const cancelado = useRef(false);
  const estilo = editada ? "border-marca bg-marca-suave font-semibold text-marca-oscura" : escalada ? "border-borde bg-neutro-suave italic" : "border-borde bg-superficie";
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={etiqueta}
      title={editada ? "Editado por ti" : escalada ? "Escalado al renormalizar" : "Calculado: escribe para ajustar"}
      disabled={disabled}
      value={borrador ?? formatearDecimal(valor, 1)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={() => {
        if (cancelado.current) {
          cancelado.current = false;
          setBorrador(null);
          return;
        }
        if (borrador === null) return;
        const nuevo = leerPorcentaje(borrador);
        setBorrador(null);
        onCommit(nuevo);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelado.current = true;
          e.currentTarget.blur();
        }
      }}
      className={`h-8 w-20 rounded-md border px-2 text-right text-sm tabular-nums text-tinta focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20 disabled:opacity-50 ${estilo}`}
    />
  );
}
