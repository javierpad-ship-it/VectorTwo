import type { AnomaliaGmle } from "./tipos-api";

/** Por qué una fila lleva cada aviso (tooltip y leyenda de la pantalla). */
export const DESCRIPCION_ANOMALIA: Record<AnomaliaGmle, string> = {
  sin_agrupacion: "La equivalencia no tiene agrupación (o su agrupación está inactiva): no se puede proyectar.",
  genero_no_incluido: "Su agrupación no incluye el género del nodo.",
  generica_discrepante: "La genérica tiene una agrupación distinta de la que tiene la mayoría de las equivalencias reales del nodo.",
  nodo_gml_mixto: "El nodo es GML y sus equivalencias están en dos o más agrupaciones: M7 lo leerá con una curva mezclada.",
  linea_partida: "Esta línea de este género tiene equivalencias en dos o más agrupaciones.",
  agrupacion_vacia: "La agrupación está activa y no tiene ninguna equivalencia vigente.",
};
