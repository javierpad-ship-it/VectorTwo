import type { MapaColores } from "@/lib/estacionalidad/colores";
import { formatearNumero } from "@/lib/formato";
import { Punto } from "@/components/ui/punto";

export type ItemLeyenda = {
  id: string;
  nombre: string;
  /** Se pinta solo si es mayor que cero. */
  conteo?: number;
  activo?: boolean;
};

/**
 * Leyenda compacta de agrupaciones: punto de color + nombre (+ conteo). La
 * misma en el mapa y encima de las tablas de Asignación y Faltantes, para que
 * el color signifique lo mismo en toda la pantalla. `sinAgrupacion` añade el
 * chip de faltantes en tono alerta al final.
 */
export function LeyendaAgrupaciones({
  items,
  colores,
  sinAgrupacion,
  etiqueta = "Leyenda de agrupaciones",
  className = "",
}: {
  items: ItemLeyenda[];
  colores: MapaColores;
  sinAgrupacion?: number;
  etiqueta?: string;
  className?: string;
}) {
  if (items.length === 0 && !sinAgrupacion) return null;
  return (
    <ul aria-label={etiqueta} className={`flex flex-wrap gap-x-3 gap-y-1 text-xs ${className}`}>
      {items.map((a) => {
        const color = colores.get(a.id);
        const inactiva = a.activo === false;
        return (
          <li key={a.id} className={`inline-flex items-center gap-1.5 ${inactiva ? "text-tinta-suave/70" : "text-tinta"}`}>
            <Punto color={inactiva ? null : color?.pleno} />
            <span className={inactiva ? "line-through decoration-tinta-suave/50" : ""}>{a.nombre}</span>
            {a.conteo !== undefined && a.conteo > 0 && <span className="font-mono text-tinta-suave">{formatearNumero(a.conteo)}</span>}
          </li>
        );
      })}
      {sinAgrupacion !== undefined && sinAgrupacion > 0 && (
        <li className="inline-flex items-center gap-1.5 text-alerta">
          <Punto tono="alerta" />
          Sin agrupación
          <span className="font-mono">{formatearNumero(sinAgrupacion)}</span>
        </li>
      )}
    </ul>
  );
}
