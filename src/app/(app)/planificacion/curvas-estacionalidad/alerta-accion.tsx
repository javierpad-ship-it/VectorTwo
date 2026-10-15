"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import type { AccionSugerida, ErrorAprobar } from "./trabajo-vista";

/**
 * Un error de la API con su acción sugerida (un enlace a la pantalla que lo arregla o un botón
 * que hace algo en esta). Nunca se traga el error: el mensaje del servidor se muestra tal cual.
 */
export function AlertaAccion({
  error,
  onAccion,
  onCerrar,
  tono = "alerta",
}: {
  error: ErrorAprobar;
  onAccion: (a: AccionSugerida) => void;
  onCerrar: () => void;
  tono?: "alerta" | "info";
}) {
  const a = error.accion;
  return (
    <Alert tono={tono} onCerrar={onCerrar}>
      <span className="block">{error.mensaje}</span>
      {a && (
        <span className="mt-1 block">
          {a.tipo === "enlace" ? (
            <Link href={a.href} className="font-medium underline underline-offset-2">
              {a.etiqueta}
            </Link>
          ) : (
            <button type="button" onClick={() => onAccion(a)} className="font-medium underline underline-offset-2">
              {a.etiqueta}
            </button>
          )}
        </span>
      )}
    </Alert>
  );
}
