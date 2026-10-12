"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Diálogo modal sobre el elemento nativo `<dialog>`: el navegador atrapa el
 * foco, pone el fondo inerte y cierra con Esc. Se monta cuando hay que
 * mostrarlo y se desmonta al cerrar (`onCerrar`). Con `cerrable=false` (por
 * ejemplo mientras se envía algo) Esc, el fondo y la X no lo cierran.
 */
export function Modal({
  titulo,
  descripcion,
  onCerrar,
  cerrable = true,
  ancho = "max-w-4xl",
  pie,
  children,
}: {
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  cerrable?: boolean;
  /** Clase de ancho máximo (Tailwind). */
  ancho?: string;
  /** Barra de botones fija al pie, fuera del área con scroll. */
  pie?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        e.preventDefault();
        if (cerrable) onCerrar();
      }}
      onClick={(e) => {
        // Un clic en el fondo cae sobre el propio <dialog> (el contenido está en un div hijo).
        if (cerrable && e.target === e.currentTarget) onCerrar();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${ancho} overflow-hidden rounded-xl border border-borde bg-superficie p-0 text-tinta shadow-xl backdrop:bg-black/40`}
    >
      <div className="flex max-h-[90vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
          <div>
            <h2 id={idTitulo} className="text-base font-semibold text-tinta">
              {titulo}
            </h2>
            {descripcion && <p className="mt-0.5 text-sm text-tinta-suave">{descripcion}</p>}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={!cerrable}
            aria-label="Cerrar"
            className="rounded-md px-2 text-lg font-bold leading-none text-tinta-suave hover:bg-neutro-suave hover:text-tinta disabled:cursor-not-allowed disabled:opacity-50"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-borde px-5 py-3">{pie}</footer>}
      </div>
    </dialog>
  );
}
