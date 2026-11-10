import type { ReactNode } from "react";

export function Alert({
  tono = "alerta",
  children,
  onCerrar,
}: {
  /** `aviso`: advertencia que no es un error ni un rechazo (ámbar: tokens `aviso` y `aviso-suave`, texto en tinta); `alerta`: error o rechazo. */
  tono?: "alerta" | "aviso" | "exito" | "info" | "neutro";
  children: ReactNode;
  onCerrar?: () => void;
}) {
  const estilos = {
    alerta: "border-alerta/30 bg-alerta-suave text-alerta",
    aviso: "border-aviso/40 border-l-4 border-l-aviso bg-aviso-suave text-tinta",
    exito: "border-exito/30 bg-exito-suave text-exito",
    info: "border-marca/30 bg-marca-suave text-marca-oscura",
    neutro: "border-borde bg-neutro-suave text-tinta-suave",
  }[tono];

  return (
    <div role="alert" className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${estilos}`}>
      <span>{children}</span>
      {onCerrar && (
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="font-bold opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}
