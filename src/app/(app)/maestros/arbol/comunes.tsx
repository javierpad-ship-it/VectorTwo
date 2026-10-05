"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { GeneroArbol, LineaArbol, MundoArbol, Temporada } from "@/lib/arbol/tipos-api";

/** Piezas compartidas por las columnas del árbol. */

// Los helpers de formato viven en `@/lib/formato` (los usan también los
// componentes compartidos); se re-exportan para no tocar los imports del árbol.
export { formatearNumero, mensajeError } from "@/lib/formato";

const TONO_TEMPORADA: Record<Temporada, "marca" | "neutro" | "exito"> = {
  Verano: "marca",
  Invierno: "neutro",
  "Todo el año": "exito",
};

export function BadgeTemporada({ temporada }: { temporada: Temporada }) {
  return <Badge tono={TONO_TEMPORADA[temporada] ?? "neutro"}>{temporada}</Badge>;
}

/** Estado visible de un nodo: inactivo a mano, oculto por un padre inactivo, o nada. */
export function estadoNodo(
  l: LineaArbol,
  genero: GeneroArbol,
  mundo: MundoArbol
): { texto: string; tono: "alerta" | "neutro" } | null {
  if (!l.activo_nodo) return { texto: "Inactivo", tono: "alerta" };
  if (!l.vigente) {
    const padre = !genero.activo ? "género" : !mundo.activo ? "mundo" : "línea";
    return { texto: `Oculto por ${padre} inactivo`, tono: "neutro" };
  }
  return null;
}

/** Columna del árbol con cabecera fija y lista con scroll. */
export function Columna({
  titulo,
  subtitulo,
  acciones,
  children,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-48 flex-col rounded-xl border border-borde bg-superficie shadow-sm">
      <header className="flex items-start justify-between gap-2 border-b border-borde px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-tinta">{titulo}</h2>
          {subtitulo && <div className="truncate text-xs text-tinta-suave">{subtitulo}</div>}
        </div>
        {acciones}
      </header>
      <div className="flex-1 overflow-y-auto p-2 lg:max-h-[32rem]">{children}</div>
    </section>
  );
}

/** Fila seleccionable de una columna. */
export function FilaColumna({
  seleccionada,
  atenuada = false,
  onClick,
  children,
}: {
  seleccionada: boolean;
  atenuada?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={seleccionada ? "true" : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
        seleccionada ? "bg-marca-suave text-marca-oscura" : "hover:bg-neutro-suave"
      } ${atenuada ? "opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}

export { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
