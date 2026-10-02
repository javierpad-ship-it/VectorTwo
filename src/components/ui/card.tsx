import type { ReactNode } from "react";

export function Card({
  titulo,
  descripcion,
  acciones,
  children,
  className = "",
}: {
  titulo?: string;
  descripcion?: string;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-borde bg-superficie shadow-sm ${className}`}>
      {(titulo || acciones) && (
        <header className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
          <div>
            {titulo && <h2 className="text-base font-semibold text-tinta">{titulo}</h2>}
            {descripcion && <p className="mt-0.5 text-sm text-tinta-suave">{descripcion}</p>}
          </div>
          {acciones}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
