import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-tinta">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-tinta-suave">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clasesControl(className)} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clasesControl(className)} {...props} />;
}
