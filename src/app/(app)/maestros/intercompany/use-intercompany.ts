"use client";

import type { AplicabilidadApi, ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { useAccion, useLectura } from "../../planificacion/proyeccion/use-proyeccion";
import { urlAplicabilidad, urlReglas } from "./vista";

/**
 * Lecturas y acciones de /maestros/intercompany (M13). Reutilizan los hooks de M7 (`useLectura` con descarte de respuestas fuera
 * de orden y estado tocado solo dentro de promesas; `useAccion` con el código de negocio de los `409`): no se vuelven a escribir.
 * Nunca se habla con Supabase desde aquí.
 */
export { useAccion };

/** Las reglas vigentes en `mes` (una por clave) o, con `historial`, todas. Conserva la última lista mientras llega la del nuevo mes. */
export function useReglas(mes: string, historial: boolean) {
  return useLectura<ReglaIntercompanyApi[]>(urlReglas(mes, historial), true);
}

/** ¿Una regla de esa marca en ese GML sería aplicable con la cerrada de hoy? Sin marca o sin GML no lee nada (`datos = null`). */
export function useAplicabilidad(marcaId: string, nodoId: string) {
  return useLectura<AplicabilidadApi>(urlAplicabilidad(marcaId, nodoId));
}
