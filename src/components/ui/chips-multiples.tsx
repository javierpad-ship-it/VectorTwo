import type { ReactNode } from "react";

export type ChipMultipleItem = {
  id: string;
  label: ReactNode;
  /** No se puede marcar ni desmarcar (p. ej. un género inactivo que ya no se puede añadir). */
  disabled?: boolean;
  title?: string;
};

/**
 * Selector múltiple en forma de chips (casillas con aspecto de píldora),
 * controlado desde fuera. Hermano de `Chips`, que es excluyente: aquí se
 * marcan varios a la vez, p. ej. los géneros de una agrupación.
 */
export function ChipsMultiples({
  items,
  valor,
  onCambiar,
  etiqueta,
  disabled = false,
  className = "",
}: {
  items: ChipMultipleItem[];
  valor: readonly string[];
  onCambiar: (ids: string[]) => void;
  /** Texto accesible del grupo. */
  etiqueta?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((c) => {
        const marcado = valor.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            role="checkbox"
            aria-checked={marcado}
            disabled={disabled || c.disabled}
            title={c.title}
            onClick={() => onCambiar(marcado ? valor.filter((v) => v !== c.id) : [...valor, c.id])}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:cursor-not-allowed disabled:opacity-50 ${
              marcado
                ? "border-marca bg-marca-suave text-marca-oscura"
                : "border-borde bg-superficie text-tinta-suave hover:bg-neutro-suave hover:text-tinta"
            }`}
          >
            <span aria-hidden className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] leading-none ${marcado ? "border-marca bg-marca text-white" : "border-borde"}`}>
              {marcado ? "✓" : ""}
            </span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
