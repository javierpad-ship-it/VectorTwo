"use client";

import type { AnalisisMarcaApi, ListaBarrerApi, RepartoApi } from "@/lib/marcas-barrer/tipos-api";
import { useAccion, useLectura } from "../proyeccion/use-proyeccion";
import { urlLista, urlAnalisis, type ParametrosVista } from "./vista";

/**
 * Lecturas y acciones de /planificacion/marcas-barrer (M12). Reutilizan los hooks de M7 (`useLectura` con descarte de
 * respuestas fuera de orden y estado tocado solo dentro de promesas; `useAccion` con el código de negocio de los `409`),
 * que tienen el mismo patrón que `use-estacionalidad`: no se vuelve a escribir. Nunca se habla con Supabase desde aquí.
 */
export { useAccion };

/** La lista de marcas al barrer y mixtas (`GET /api/marcas-barrer?ventana=`). Conserva la última lista mientras llega la nueva ventana. */
export function useListaBarrer(ventana: ParametrosVista["ventana"]) {
  return useLectura<ListaBarrerApi>(urlLista(ventana), true);
}

/** El análisis de una marca con los parámetros de la URL. Conserva el anterior mientras llega el nuevo (cambiar de ventana no vacía la pantalla). */
export function useAnalisisMarca(marcaId: string, parametros: ParametrosVista) {
  return useLectura<AnalisisMarcaApi>(urlAnalisis(marcaId, parametros), true);
}

/** Todas las versiones aprobadas de una marca, con sus filas (`GET /api/marcas-barrer/[marcaId]/repartos`). */
export function useRepartosMarca(marcaId: string) {
  return useLectura<RepartoApi[]>(`/api/marcas-barrer/${marcaId}/repartos`);
}
