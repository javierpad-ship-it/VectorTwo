import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const control =
  "h-10 w-full rounded-md border border-borde bg-superficie px-3 text-sm text-tinta placeholder:text-tinta-suave/70 focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20 disabled:bg-neutro-suave";

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
  return <input className={`${control} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${control} ${className}`} {...props} />;
}
