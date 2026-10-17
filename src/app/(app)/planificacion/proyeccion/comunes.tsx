"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { AvisoFila, EstadoLinea, ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import type { ErrorAccion } from "./use-proyeccion";
import { accionParaCodigo, ETIQUETA_ACCION, ETIQUETA_ESTADO_LINEA, textoAviso, TONO_ESTADO_LINEA, tonoAviso } from "./vista";

/**
 * Un error de la API con la acción que corresponde a su código de negocio (los `409` de M7): `datos_cambiaron` →
 * calcular de nuevo; `calculo_en_curso` o proyección ya cerrada → actualizar la pantalla. El mensaje del servidor se
 * muestra siempre tal cual: nunca se traga.
 */
export function AlertaError({
  error,
  onCerrar,
  onRecalcular,
  onRecargar,
  tono = "alerta",
}: {
  error: ErrorAccion | string;
  onCerrar: () => void;
  onRecalcular?: () => void;
  onRecargar?: () => void;
  tono?: "alerta" | "info";
}) {
  const e: ErrorAccion = typeof error === "string" ? { mensaje: error, codigo: null } : error;
  const accion = accionParaCodigo(e.codigo);
  const manejador = accion === "recalcular" ? onRecalcular : accion === "recargar" ? onRecargar : undefined;
  return (
    <Alert tono={tono} onCerrar={onCerrar}>
      <span className="block">{e.mensaje}</span>
      {accion && manejador && (
        <span className="mt-1 block">
          <button type="button" onClick={manejador} className="font-medium underline underline-offset-2">
            {ETIQUETA_ACCION[accion]}
          </button>
        </span>
      )}
    </Alert>
  );
}

/** Avisos de una fila, tienda o registro: los de alerta con `Badge` de alerta y el texto completo al pasar el cursor. */
export function Avisos({ avisos, detalle = false, textos }: { avisos: readonly AvisoFila[]; detalle?: boolean; textos?: Partial<Record<AvisoFila, string>> }) {
  if (avisos.length === 0) return null;
  if (detalle) {
    return (
      <ul className="space-y-1.5">
        {avisos.map((a) => (
          <li key={a}>
            <Alert tono={tonoAviso(a) === "alerta" ? "alerta" : "info"}>{textos?.[a] ?? textoAviso(a)}</Alert>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {avisos.map((a) => (
        <span key={a} title={textoAviso(a)}>
          <Badge tono={tonoAviso(a) === "alerta" ? "alerta" : "neutro"}>{a.replace(/_/g, " ")}</Badge>
        </span>
      ))}
    </span>
  );
}

export function BadgeEstadoLinea({ estado }: { estado: EstadoLinea }) {
  return <Badge tono={TONO_ESTADO_LINEA[estado]}>{ETIQUETA_ESTADO_LINEA[estado]}</Badge>;
}

export function BadgeEstadoProyeccion({ estado }: { estado: ProyeccionApi["estado"] }) {
  if (estado === "en_trabajo") return <Badge tono="marca">En trabajo</Badge>;
  if (estado === "cerrada") return <Badge tono="exito">Cerrada</Badge>;
  return <Badge tono="neutro">Archivada</Badge>;
}

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return <p className="py-8 text-center text-sm text-tinta-suave">{texto}</p>;
}

/** Texto con un enlace que parece botón, para acciones dentro de una frase. */
export function BotonEnlace({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="font-medium text-marca-oscura underline underline-offset-2 hover:text-marca disabled:cursor-not-allowed disabled:opacity-50">
      {children}
    </button>
  );
}

/** Celda numérica alineada a la derecha con cifras de ancho fijo. */
export const NUM = "text-right font-mono tabular-nums";
