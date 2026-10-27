"use client";

import { api } from "@/lib/api-client";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import type {
  AceptarSugerenciaCuerpo,
  ConciliacionApi,
  FiltrosConciliacion,
  FiltrosFlujo,
  FilaFlujoDetalleApi,
  FlujoApi,
  HuecosApi,
  ParametrosFlujoApi,
  ParametrosFlujoCuerpo,
  RespuestaAceptarApi,
} from "./tipos-api";

/**
 * Lecturas y acciones de las pantallas de flujo de M8 (ficha 08, §7). Reutilizan `useLectura` y `useAccion` de M7 (descarte de
 * respuestas fuera de orden, estado tocado solo dentro de promesas y el código de negocio de los `409`): no se vuelven a escribir. Nunca
 * se habla con Supabase desde aquí: todo va por `/api/flujo/**`, que construye T3b.
 */
export { useAccion };

function consulta(valores: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(valores)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

/** `GET /api/flujo` con los filtros en el servidor (los totales siguen al filtro). */
export const urlFlujo = (f: FiltrosFlujo): string =>
  `/api/flujo${consulta({ genero_id: f.genero_id, mundo_id: f.mundo_id, linea_id: f.linea_id, agrupacion_marca_id: f.agrupacion_marca_id, solo: f.solo, mio: f.mio, meses: f.meses })}`;

/** `GET /api/flujo/huecos`: todas las tarjetas, con el saldo de los próximos `meses` (por defecto, los de Parámetros). */
export const urlHuecos = (meses?: number | null): string => `/api/flujo/huecos${consulta({ meses: meses ?? undefined })}`;

export type ClaveFila = { gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string };

/** `GET /api/flujo/fila`: el detalle de una fila (con la historia de doce meses, que la lista no trae). */
export const urlFila = (c: ClaveFila): string => `/api/flujo/fila${consulta({ gml_id: c.gml_id, equivalencia_id: c.equivalencia_id ?? undefined, agrupacion_marca_id: c.agrupacion_marca_id })}`;

/** `GET /api/flujo/conciliacion`: sin `periodo`, el último mes publicado. */
export const urlConciliacion = (f: FiltrosConciliacion): string =>
  `/api/flujo/conciliacion${consulta({ periodo: f.periodo, genero_id: f.genero_id, mundo_id: f.mundo_id, linea_id: f.linea_id, solo: f.solo, mio: f.mio })}`;

export const URL_PARAMETROS = "/api/flujo/parametros";
export const URL_ACEPTAR_SUGERENCIA = "/api/flujo/conciliacion/aceptar";

/** La lista del flujo (con `activo = false` no lee nada). Conserva la última mientras llega la del filtro nuevo (la tabla no parpadea al filtrar). */
export function useFlujo(filtros: FiltrosFlujo, activo = true) {
  return useLectura<FlujoApi>(activo ? urlFlujo(filtros) : null, true);
}

/** Las tarjetas de Huecos (con `activo = false` no lee nada). */
export function useHuecos(meses?: number | null, activo = true) {
  return useLectura<HuecosApi>(activo ? urlHuecos(meses) : null, true);
}

/** El detalle de una fila; sin clave no lee nada (`datos = null`). */
export function useFilaFlujo(clave: ClaveFila | null) {
  return useLectura<FilaFlujoDetalleApi>(clave === null ? null : urlFila(clave));
}

/** La conciliación de un mes cerrado; con `activo = false` no lee nada (la pestaña no está abierta). */
export function useConciliacion(filtros: FiltrosConciliacion, activo: boolean) {
  return useLectura<ConciliacionApi>(activo ? urlConciliacion(filtros) : null, true);
}

export function useParametros(activo = true) {
  return useLectura<ParametrosFlujoApi>(activo ? URL_PARAMETROS : null);
}

/** `PUT /api/flujo/parametros` (planner o admin): la fila es única y se reemplaza entera. */
export const guardarParametros = (cuerpo: ParametrosFlujoCuerpo) => api.put<ParametrosFlujoApi>(URL_PARAMETROS, cuerpo);

/** `POST /api/flujo/conciliacion/aceptar` («Aceptar sugerencia»; solo líneas específicas en `0.13.0`). */
export const aceptarSugerencia = (cuerpo: AceptarSugerenciaCuerpo) => api.post<RespuestaAceptarApi>(URL_ACEPTAR_SUGERENCIA, cuerpo);
