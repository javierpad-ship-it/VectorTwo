import type { ReactNode } from "react";

/**
 * Un filtro de sí o no en forma de píldora (`aria-pressed`), hermano de `Chips` y `ChipsMultiples` pero suelto y con tamaño táctil: en el celular
 * mide 44 px de alto (`grande`, el valor por defecto) y en pantallas anchas baja a 36 px. Controlado desde fuera.
 */
export function ChipFiltro({
  activo,
  onCambiar,
  children,
  grande = true,
  className = "",
}: {
  activo: boolean;
  onCambiar: (activo: boolean) => void;
  children: ReactNode;
  grande?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={() => onCambiar(!activo)}
      className={`inline-flex items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${
        grande ? "h-11 md:h-9" : "h-8"
      } ${activo ? "border-marca bg-marca text-white" : "border-borde bg-superficie text-tinta-suave hover:bg-neutro-suave hover:text-tinta"} ${className}`}
    >
      {children}
    </button>
  );
}
