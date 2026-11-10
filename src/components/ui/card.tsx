import type { ReactNode } from "react";

export function Card({
  titulo,
  descripcion,
  acciones,
  children,
  className = "",
  nivel = 2,
}: {
  titulo?: string;
  descripcion?: string;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Nivel del encabezado del título: `2` por defecto; `3` si la tarjeta va dentro de una parte que ya tiene su `h2`. */
  nivel?: 2 | 3;
}) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <section className={`rounded-xl border border-borde bg-superficie shadow-sm ${className}`}>
      {(titulo || acciones) && (
        <header className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
          <div>
            {titulo && <Titulo className="text-base font-semibold text-tinta">{titulo}</Titulo>}
            {descripcion && <p className="mt-0.5 text-sm text-tinta-suave">{descripcion}</p>}
          </div>
          {acciones}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
