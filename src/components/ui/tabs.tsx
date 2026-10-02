import type { ReactNode } from "react";

export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * Pestañas simples controladas desde fuera. Solo pinta la barra; el contenido
 * lo decide quien la usa según `activa`.
 */
export function Tabs<T extends string>({
  items,
  activa,
  onCambiar,
  className = "",
}: {
  items: TabItem<T>[];
  activa: T;
  onCambiar: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={`flex gap-1 overflow-x-auto border-b border-borde ${className}`}>
      {items.map((t) => {
        const seleccionada = t.id === activa;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={seleccionada}
            disabled={t.disabled}
            onClick={() => onCambiar(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              seleccionada
                ? "border-marca text-marca-oscura"
                : "border-transparent text-tinta-suave hover:border-borde hover:text-tinta"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
