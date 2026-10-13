"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Diálogo modal sobre el elemento nativo `<dialog>`: el navegador atrapa el
 * foco, pone el fondo inerte y cierra con Esc. Se monta cuando hay que
 * mostrarlo y se desmonta al cerrar (`onCerrar`). Con `cerrable=false` (por
 * ejemplo mientras se envía algo) Esc, el fondo y la X no lo cierran. Al
 * cerrarse devuelve el foco al elemento que lo abrió; un arrastre que empieza
 * dentro y termina en el fondo no lo cierra (hace falta pulsar y soltar en el
 * fondo); con `descripcion`, el diálogo la anuncia (`aria-describedby`).
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
  const idDescripcion = useId();
  /** Dónde estaba el foco al abrir (el botón que lo pidió): se lee en el primer render, antes de que el diálogo lo tome. */
  const [abridor] = useState<Element | null>(() => (typeof document === "undefined" ? null : document.activeElement));
  /** El botón del ratón se pulsó sobre el fondo (no solo se soltó allí tras un arrastre). */
  const pulsoEnFondo = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // `autoFocus` de React corre antes de abrir el <dialog> y el navegador deja el foco en la X:
      // se pasa al primer campo del cuerpo (si no hay, queda donde el navegador lo puso).
      const primero = d.querySelector<HTMLElement>("[data-modal-cuerpo] input:not([type=hidden]):not([disabled]), [data-modal-cuerpo] select:not([disabled]), [data-modal-cuerpo] textarea:not([disabled])");
      primero?.focus();
    }
    return () => {
      if (abridor instanceof HTMLElement && abridor.isConnected) abridor.focus();
    };
  }, [abridor]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={idTitulo}
      aria-describedby={descripcion ? idDescripcion : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (cerrable) onCerrar();
      }}
      onMouseDown={(e) => {
        pulsoEnFondo.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Un clic en el fondo cae sobre el propio <dialog> (el contenido está en un div hijo). Un arrastre
        // (p. ej. seleccionar texto) que termina en el fondo también dispara `click` sobre él: se exige que
        // el botón también se haya pulsado en el fondo.
        const pulsoAhi = pulsoEnFondo.current;
        pulsoEnFondo.current = false;
        if (cerrable && pulsoAhi && e.target === e.currentTarget) onCerrar();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${ancho} overflow-hidden rounded-xl border border-borde bg-superficie p-0 text-tinta shadow-xl backdrop:bg-black/40`}
    >
      <div className="flex max-h-[90vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
          <div>
            <h2 id={idTitulo} className="text-base font-semibold text-tinta">
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDescripcion} className="mt-0.5 text-sm text-tinta-suave">
                {descripcion}
              </p>
            )}
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
        <div data-modal-cuerpo className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-borde px-5 py-3">{pie}</footer>}
      </div>
    </dialog>
  );
}
