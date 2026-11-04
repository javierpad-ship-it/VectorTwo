"use client";

import { api } from "@/lib/api-client";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import type { Mes } from "@/lib/compras/tipos-api";
import type {
  CambiarEstado,
  AsignarEntregas,
  AsignarViaje,
  CambiarFecha,
  MoverAPaquete,
  MoverPaquete,
  PasarPendientes,
  QuitarAsignaciones,
} from "./esquemas";
import type {
  EmbarqueApi,
  EmbarqueDetalleApi,
  EstadoEmbarque,
  EventoAgrupadorApi,
  GuardarEmbarqueCuerpo,
  GuardarPaqueteCuerpo,
  GuardarViajeCuerpo,
  OpcionesAgrupadoresApi,
  PlanMovimientoApi,
  ReporteImportacionAgrupadoresApi,
  RespuestaAsignarViajeApi,
  RespuestaMovimientoApi,
  RespuestaViajesApi,
  SinAgrupadorApi,
  TipoEmbarque,
  ViajeApi,
  ViajeDetalleApi,
} from "./tipos-api";

/**
 * Lecturas y acciones de las pantallas de agrupadores de compras (ficha 08b §3.3), contra las rutas de `/api/compras/{viajes,embarques,
 * paquetes,agrupadores,viaje-activo}/**`. Las lecturas van con `useLectura` (descarta las respuestas fuera de orden y conserva lo último
 * leído mientras llega un filtro nuevo); las escrituras, con `useAccion` (ocupado, error con código de negocio). Nunca se habla con
 * Supabase desde aquí. El permiso lo decide la API: la pantalla solo oculta los botones que no corresponden al rol.
 */
export { useAccion };

export const URL_VIAJES = "/api/compras/viajes";
export const URL_EMBARQUES = "/api/compras/embarques";
export const URL_OPCIONES = "/api/compras/agrupadores/opciones";
export const URL_SIN_ASIGNAR = "/api/compras/agrupadores/sin-asignar";
export const URL_HISTORIAL = "/api/compras/agrupadores/historial";
export const URL_IMPORTAR_AGRUPADORES = "/api/compras/agrupadores/importar";
export const URL_VIAJE_ACTIVO = "/api/compras/viaje-activo";

export const urlViaje = (id: string): string => `${URL_VIAJES}/${id}`;
export const urlEmbarque = (id: string): string => `${URL_EMBARQUES}/${id}`;
export const urlPaquete = (id: string): string => `/api/compras/paquetes/${id}`;

function conQuery(base: string, filtros: Record<string, string | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) {
    if (v === undefined || v === "" || v === false) continue;
    q.set(k, v === true ? "1" : v);
  }
  const s = q.toString();
  return s === "" ? base : `${base}?${s}`;
}

/** Filtros de `GET /api/compras/embarques` que van al servidor; «Mis embarques» y el texto se aplican en el navegador. */
export type FiltrosEmbarques = {
  estado?: EstadoEmbarque;
  tipo?: TipoEmbarque;
  /** Un viaje concreto o `sin_viaje` (los locales). Nunca «todos»: eso es no mandarlo. */
  viaje_id?: string;
  desde?: Mes;
  hasta?: Mes;
  atrasados?: boolean;
};
export const urlEmbarques = (f: FiltrosEmbarques = {}): string => conQuery(URL_EMBARQUES, { ...f });

/** Filtros de `GET /api/compras/agrupadores/sin-asignar`. */
export type FiltrosSinAsignar = { viaje_id?: string; proveedor_id?: string; desde?: Mes; hasta?: Mes; q?: string };
export const urlSinAsignar = (f: FiltrosSinAsignar = {}): string => conQuery(URL_SIN_ASIGNAR, { ...f });

/** Qué historial leer: exactamente uno de viaje, embarque o paquete. */
export type RefHistorial = { tipo: "viaje" | "embarque" | "paquete"; id: string };
export const urlHistorialDe = (r: RefHistorial): string => conQuery(URL_HISTORIAL, { [`${r.tipo}_id`]: r.id });

// ─── Lecturas ───

/** Todos los viajes con los responsables asignables (§2.8). Los filtros «Mis viajes» y el texto se aplican en el navegador. */
export function useViajes(activo = true) {
  return useLectura<RespuestaViajesApi>(activo ? URL_VIAJES : null);
}

/** Un viaje con sus compras y embarques; sin id no lee nada. */
export function useViaje(id: string | null) {
  return useLectura<ViajeDetalleApi>(id === null ? null : urlViaje(id));
}

/** La lista de embarques; `activo = false` (o `null`) no lee nada. Conserva la lista anterior mientras llega la del filtro nuevo. */
export function useEmbarques(filtros: FiltrosEmbarques | null) {
  return useLectura<{ embarques: EmbarqueApi[] }>(filtros === null ? null : urlEmbarques(filtros), true);
}

/** Un embarque con sus paquetes y asignaciones; sin id no lee nada. */
export function useEmbarque(id: string | null) {
  return useLectura<{ embarque: EmbarqueDetalleApi }>(id === null ? null : urlEmbarque(id));
}

/** Selectores: viajes, embarques, paquetes, asignables y puertos ya usados. */
export function useOpciones(activo = true) {
  return useLectura<OpcionesAgrupadoresApi>(activo ? URL_OPCIONES : null);
}

/** Entregas sin embarque y compras sin viaje; `filtros = null` no lee nada. */
export function useSinAsignar(filtros: FiltrosSinAsignar | null) {
  return useLectura<SinAgrupadorApi>(filtros === null ? null : urlSinAsignar(filtros), true);
}

/** Historial de un viaje, embarque o paquete; sin referencia no lee nada. */
export function useHistorial(ref: RefHistorial | null) {
  return useLectura<{ eventos: EventoAgrupadorApi[] }>(ref === null ? null : urlHistorialDe(ref));
}

// ─── Escrituras: viajes ───

export const crearViaje = (cuerpo: GuardarViajeCuerpo) => api.post<{ viaje: ViajeApi }>(URL_VIAJES, cuerpo);
export const editarViaje = (id: string, cuerpo: GuardarViajeCuerpo) => api.patch<{ viaje: ViajeApi }>(urlViaje(id), cuerpo);
export const cambiarEstadoViaje = (id: string, cuerpo: CambiarEstado) => api.post<{ viaje: ViajeApi }>(`${urlViaje(id)}/estado`, cuerpo);
/** `viaje_id` nulo quita el viaje de esas compras (la ruta exige que sea el del `[id]`). */
export const asignarComprasViaje = (id: string, cuerpo: AsignarViaje) => api.post<RespuestaAsignarViajeApi>(`${urlViaje(id)}/compras`, cuerpo);

// ─── Escrituras: embarques y paquetes ───

export const crearEmbarque = (cuerpo: GuardarEmbarqueCuerpo) => api.post<{ embarque: EmbarqueApi }>(URL_EMBARQUES, cuerpo);
export const editarEmbarque = (id: string, cuerpo: GuardarEmbarqueCuerpo) => api.patch<{ embarque: EmbarqueDetalleApi }>(urlEmbarque(id), cuerpo);
export const cambiarEstadoEmbarque = (id: string, cuerpo: CambiarEstado) => api.post<{ embarque: EmbarqueDetalleApi }>(`${urlEmbarque(id)}/estado`, cuerpo);
export const crearPaquete = (embarqueId: string, cuerpo: GuardarPaqueteCuerpo) => api.post<{ embarque: EmbarqueDetalleApi }>(`${urlEmbarque(embarqueId)}/paquetes`, cuerpo);
export const editarPaquete = (paqueteId: string, cuerpo: GuardarPaqueteCuerpo) => api.patch<{ embarque: EmbarqueDetalleApi }>(urlPaquete(paqueteId), cuerpo);
export const cancelarPaquete = (paqueteId: string, cuerpo: CambiarEstado) => api.post<{ embarque: EmbarqueDetalleApi }>(`${urlPaquete(paqueteId)}/estado`, cuerpo);

// ─── Movimientos (§3.3): con `previsualizar = true` devuelven el plan sin escribir ───

export type ResultadoMovimiento = PlanMovimientoApi | RespuestaMovimientoApi;

const ruta = (base: string, previsualizar: boolean) => (previsualizar ? `${base}?previsualizar=1` : base);

export const asignarEntregas = (embarqueId: string, cuerpo: AsignarEntregas, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlEmbarque(embarqueId)}/asignar`, previsualizar), cuerpo);
export const quitarAsignaciones = (embarqueId: string, cuerpo: QuitarAsignaciones, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlEmbarque(embarqueId)}/quitar`, previsualizar), cuerpo);
export const moverAPaquete = (embarqueId: string, cuerpo: MoverAPaquete, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlEmbarque(embarqueId)}/paquete`, previsualizar), cuerpo);
export const cambiarFechaLlegada = (embarqueId: string, cuerpo: CambiarFecha, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlEmbarque(embarqueId)}/fecha`, previsualizar), cuerpo);
export const pasarPendientes = (embarqueId: string, cuerpo: PasarPendientes, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlEmbarque(embarqueId)}/pasar-pendientes`, previsualizar), cuerpo);
export const moverPaquete = (paqueteId: string, cuerpo: MoverPaquete, previsualizar = false) =>
  api.post<ResultadoMovimiento>(ruta(`${urlPaquete(paqueteId)}/mover`, previsualizar), cuerpo);

/** `true` si la respuesta de un movimiento es una vista previa (trae `huella_plan`) y no el resultado de escribir. */
export const esPlan = (r: ResultadoMovimiento): r is PlanMovimientoApi => "huella_plan" in r && "movimientos" in r;

// ─── Viaje activo y importador ───

/** Guarda el viaje activo del navegador en la cookie (`uuid`, `todos` o `sin_viaje`). Es una preferencia: nunca da ni quita permisos. */
export const guardarViajeActivo = (viaje_id: string) => api.put<{ viaje_activo: string }>(URL_VIAJE_ACTIVO, { viaje_id });

export const importarAgrupadores = (cuerpo: { modo: "previsualizar" | "aplicar"; archivo_nombre: string; filas: Record<string, string | number>[] }) =>
  api.post<ReporteImportacionAgrupadoresApi>(URL_IMPORTAR_AGRUPADORES, cuerpo);
