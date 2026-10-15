"use client";

import { Button } from "@/components/ui/button";
import type { Vecinos } from "./vista";

/**
 * «← Anterior» · «3 de 15» · «Siguiente →»: avanza y retrocede entre las agrupaciones en el orden de la lista tal como
 * se veía al abrir (filtros incluidos), sin dar la vuelta: en los extremos el botón se deshabilita. El nombre de la
 * vecina va en el `title` y en el `aria-label`. `porDefecto` avisa de que el orden es el de la lista completa
 * (se recargó la página y no se recuerda el filtro).
 */
export function NavegarAgrupaciones({
  vecinos,
  porDefecto,
  deshabilitado,
  onIr,
}: {
  vecinos: Vecinos;
  porDefecto: boolean;
  deshabilitado: boolean;
  onIr: (id: string) => void;
}) {
  const { anterior, siguiente } = vecinos;
  return (
    <nav aria-label="Navegar entre agrupaciones" className="inline-flex flex-wrap items-center gap-2">
      <Button
        variante="secundario"
        tamano="sm"
        disabled={deshabilitado || anterior === null}
        onClick={() => anterior && onIr(anterior.id)}
        aria-label={anterior ? `Agrupación anterior: ${anterior.nombre}` : "No hay agrupación anterior: esta es la primera"}
        title={anterior ? `Anterior: ${anterior.nombre} (tecla ←)` : "Esta es la primera de la lista"}
      >
        ← Anterior
      </Button>
      <span
        className="text-xs text-tinta-suave"
        aria-live="polite"
        title={porDefecto ? "Orden de la lista completa (al recargar no se recuerdan los filtros)" : "Orden de la lista con los filtros que tenías al abrirla"}
      >
        {vecinos.posicion} de {vecinos.total}
        {porDefecto && " · lista completa"}
      </span>
      <Button
        variante="secundario"
        tamano="sm"
        disabled={deshabilitado || siguiente === null}
        onClick={() => siguiente && onIr(siguiente.id)}
        aria-label={siguiente ? `Agrupación siguiente: ${siguiente.nombre}` : "No hay agrupación siguiente: esta es la última"}
        title={siguiente ? `Siguiente: ${siguiente.nombre} (tecla →)` : "Esta es la última de la lista"}
      >
        Siguiente →
      </Button>
    </nav>
  );
}
