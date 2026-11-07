import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const COLOR_Y_FORMA =
  "rounded-md border border-borde bg-superficie px-3 text-sm text-tinta placeholder:text-tinta-suave/70 focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20 disabled:bg-neutro-suave";

/** Una clase de ancho (`w-44`, `w-[4.75rem]`, `w-auto!`) o de alto (`h-8`, `h-9!`), con variantes (`md:w-1/2`) permitidas. */
const TRAE_ANCHO = /(^|\s)(?:[\w-]+:)*!?w-/;
const TRAE_ALTO = /(^|\s)(?:[\w-]+:)*!?h-/;

/**
 * Clases de un control de formulario. Por defecto ocupa todo el ancho y mide
 * `h-10`; si quien lo usa ya pide ancho (`w-…`) o alto (`h-…`) se omite el
 * valor por defecto correspondiente: Tailwind ordena las utilidades del mismo
 * grupo por nombre, no por el orden en `className`, así que dejar los dos hacía
 * ganar a `w-full` sobre `w-44` (y a `h-10` sobre `h-8` según el valor).
 */
export function clasesControl(className = ""): string {
  const ancho = TRAE_ANCHO.test(className) ? "" : "w-full";
  const alto = TRAE_ALTO.test(className) ? "" : "h-10";
  return [alto, ancho, COLOR_Y_FORMA, className].filter(Boolean).join(" ");
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  /** Mensaje de validación del campo (en rojo, debajo del control). Quien lo pasa pone `aria-invalid` en el control. */
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-tinta">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-alerta">{error}</span> : hint && <span className="mt-1 block text-xs text-tinta-suave">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clasesControl(className)} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clasesControl(className)} {...props} />;
}

/** Área de texto de varias líneas; sin alto fijo (`h-10` no aplica), con la misma forma y color que `Input`. */
export function Textarea({ className = "", rows = 3, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ancho = TRAE_ANCHO.test(className) ? "" : "w-full";
  return <textarea rows={rows} className={[ancho, "py-2", COLOR_Y_FORMA, className].filter(Boolean).join(" ")} {...props} />;
}
