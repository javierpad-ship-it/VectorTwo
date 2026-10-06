"use client";

import { useMemo } from "react";
import { mapaColores, type AgrupacionConOrden, type MapaColores } from "@/lib/estacionalidad/colores";
import { Badge } from "@/components/ui/badge";
import { Punto } from "@/components/ui/punto";

/**
 * `id → color` del catálogo de agrupaciones, memoizado para compartirlo entre
 * todas las filas de una tabla. Sin catálogo devuelve un mapa vacío.
 */
export function useMapaColores(agrupaciones: readonly AgrupacionConOrden[] | null | undefined): MapaColores {
  return useMemo(() => mapaColores(agrupaciones ?? []), [agrupaciones]);
}

/**
 * Agrupación de estacionalidad de una equivalencia, como la ven el árbol y la
 * lista plana: fondo suave y punto del color de la agrupación (el mismo que
 * en el mapa), o alerta si falta o está inactiva (con el punto gris).
 * Sin `colores` (catálogo no cargado) cae al tono marca de siempre.
 */
export function BadgeAgrupacion({
  agrupacion,
  colores,
}: {
  agrupacion: { id?: string; nombre: string; activo: boolean } | null;
  colores?: MapaColores;
}) {
  if (!agrupacion) return <Badge tono="alerta">Sin agrupación</Badge>;
  if (!agrupacion.activo) {
    return (
      <Badge tono="alerta">
        <Punto />
        {agrupacion.nombre} · inactiva
      </Badge>
    );
  }
  const color = agrupacion.id ? colores?.get(agrupacion.id) : undefined;
  if (!color) return <Badge tono="marca">{agrupacion.nombre}</Badge>;
  return (
    <Badge color={{ fondo: color.suave, texto: color.texto }}>
      <Punto color={color.pleno} />
      {agrupacion.nombre}
    </Badge>
  );
}
