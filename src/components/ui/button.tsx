import type { ButtonHTMLAttributes } from "react";

type Variante = "primario" | "secundario" | "peligro" | "fantasma";
type Tamano = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca";

const variantes: Record<Variante, string> = {
  primario: "bg-marca text-white hover:bg-marca-oscura",
  secundario: "border border-borde bg-superficie text-tinta hover:bg-neutro-suave",
  peligro: "border border-alerta/30 bg-alerta-suave text-alerta hover:bg-alerta/15",
  fantasma: "text-tinta-suave hover:bg-neutro-suave hover:text-tinta",
};

const tamanos: Record<Tamano, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variante = "primario",
  tamano = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: Tamano }) {
  return (
    <button
      type={type}
      className={`${base} ${variantes[variante]} ${tamanos[tamano]} ${className}`}
      {...props}
    />
  );
}
