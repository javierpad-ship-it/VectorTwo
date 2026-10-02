import type { ReactNode } from "react";

/** Mensaje centrado para listas o columnas sin contenido. */
export function EmptyState({
  titulo,
  detalle,
  children,
  className = "",
}: {
  titulo: string;
  detalle?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-dashed border-borde px-4 py-8 text-center ${className}`}>
      <p className="text-sm font-medium text-tinta">{titulo}</p>
      {detalle && <p className="mt-1 text-xs text-tinta-suave">{detalle}</p>}
      {children && <div className="mt-3 flex justify-center gap-2">{children}</div>}
    </div>
  );
}
