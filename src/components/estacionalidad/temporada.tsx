import { ETIQUETA_TEMPORADA, TEMPORADAS_AGRUPACION, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { Badge } from "@/components/ui/badge";

/**
 * Temporada de una agrupación de estacionalidad (M6, `agrupaciones_estacionalidad.temporada`):
 * es la que gobierna a qué agrupaciones afecta un periodo atípico de alcance «invierno».
 * Distinta de `lineas.temporada` de M1 (`Verano` / `Invierno` / `Todo el año`).
 * Sin `"use client"` a propósito: lo importan tanto componentes cliente como servidor.
 */

// Los códigos y las etiquetas viven en el contrato de la API (`tipos-api.ts`, autocontenido y apto para el cliente).
export { ETIQUETA_TEMPORADA, type TemporadaAgrupacion };


const TONO: Record<TemporadaAgrupacion, "marca" | "alerta" | "neutro"> = {
  invierno: "marca",
  verano: "alerta",
  todo_el_ano: "neutro",
};

export const OPCIONES_TEMPORADA: { valor: TemporadaAgrupacion; etiqueta: string }[] = TEMPORADAS_AGRUPACION.map((valor) => ({
  valor,
  etiqueta: ETIQUETA_TEMPORADA[valor],
}));

export function esTemporada(v: unknown): v is TemporadaAgrupacion {
  return typeof v === "string" && (TEMPORADAS_AGRUPACION as readonly string[]).includes(v);
}

/** Etiqueta legible; un valor desconocido (no debería llegar) se muestra tal cual. */
export function etiquetaTemporada(v: string | null | undefined): string {
  if (!v) return "—";
  return esTemporada(v) ? ETIQUETA_TEMPORADA[v] : v;
}

export function BadgeTemporada({ temporada }: { temporada: string | null | undefined }) {
  if (!temporada) return <span className="text-tinta-suave">—</span>;
  return <Badge tono={esTemporada(temporada) ? TONO[temporada] : "neutro"}>{etiquetaTemporada(temporada)}</Badge>;
}
