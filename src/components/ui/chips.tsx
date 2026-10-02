import type { ReactNode } from "react";

export type ChipItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** Conteo opcional que se pinta junto a la etiqueta. */
  conteo?: number;
};

/**
 * Fila de chips excluyentes (un filtro activo a la vez), controlada desde
 * fuera. Mismo contrato que `Tabs`, pero en forma de píldoras: sirve para
 * filtrar una lista por categoría mostrando cuántos hay en cada una.
 */
export function Chips<T extends string>({
  items,
  activo,
  onCambiar,
  etiqueta,
  className = "",
}: {
  items: ChipItem<T>[];
  activo: T;
  onCambiar: (id: T) => void;
  /** Texto accesible del grupo (p. ej. "Filtrar por motivo"). */
  etiqueta?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={etiqueta} className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((c) => {
        const seleccionado = c.id === activo;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={seleccionado}
            onClick={() => onCambiar(c.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${
              seleccionado
                ? "border-marca bg-marca text-white"
                : "border-borde bg-superficie text-tinta-suave hover:bg-neutro-suave hover:text-tinta"
            }`}
          >
            {c.label}
            {c.conteo !== undefined && (
              <span className={`rounded-full px-1.5 font-mono text-[11px] ${seleccionado ? "bg-white/20" : "bg-neutro-suave text-tinta"}`}>
                {c.conteo}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
