"use client";

import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import type {
  CancelarCuerpo,
  CompraApi,
  EstadoCompra,
  EventoCompraApi,
  Mes,
  OrigenCompra,
  ProveedorApi,
  RecibirCuerpo,
  ReporteImportacionComprasApi,
} from "./tipos-api";

/**
 * Lecturas y acciones de las pantallas de compras de M8 (ficha 08, §7). La lista y los proveedores van con `useColeccion` (patrón del
 * repositorio); una compra, con `useLectura`. Nunca se habla con Supabase desde aquí: todo va por `/api/compras/**`, que construye T3b.
 * Las escrituras de `0.13.0` son de admin y planner (`requirePlanner`): la pantalla oculta los botones al comprador, pero la API manda.
 */
export { useAccion };

/** Filtros de `GET /api/compras` (los que la pantalla manda al servidor; el texto libre se aplica en el navegador). */
export type FiltrosCompras = {
  estado?: EstadoCompra;
  proveedor_id?: string;
  origen?: OrigenCompra;
  llegada_desde?: Mes;
  llegada_hasta?: Mes;
  genero_id?: string;
  mundo_id?: string;
  linea_id?: string;
  marca_id?: string;
  mio?: boolean;
  por_confirmar?: boolean;
};

export function urlCompras(f: FiltrosCompras = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s === "" ? "/api/compras" : `/api/compras?${s}`;
}

export const urlCompra = (id: string): string => `/api/compras/${id}`;
export const URL_PROVEEDORES = "/api/compras/proveedores";
export const URL_IMPORTAR_COMPRAS = "/api/compras/importar";

/** La lista de compras (con líneas y entregas; el historial va vacío). Recarga con `recargar()` tras cada escritura. */
export function useCompras(filtros: FiltrosCompras = {}) {
  return useColeccion<CompraApi>(urlCompras(filtros));
}

/** Una compra con su historial; sin id no lee nada (`datos = null`). */
export function useCompra(id: string | null) {
  return useLectura<CompraApi>(id === null ? null : urlCompra(id));
}

export function useProveedores() {
  return useColeccion<ProveedorApi>(URL_PROVEEDORES);
}

/** «Confirmar ingreso» (`POST …/recibir`): registra la recepción con el mes X y devuelve la compra al día. */
export const confirmarIngreso = (compraId: string, cuerpo: RecibirCuerpo) => api.post<CompraApi>(`${urlCompra(compraId)}/recibir`, cuerpo);

/** Quita un ingreso confirmado (`DELETE …/recepciones/[id]?revision=`). */
export const quitarIngreso = (compraId: string, recepcionId: string, revision: number) =>
  api.delete<CompraApi>(`${urlCompra(compraId)}/recepciones/${recepcionId}?revision=${revision}`);

/** Cancela la compra; con ingresos registrados cierra el saldo (§0.11). */
export const cancelarCompra = (compraId: string, cuerpo: CancelarCuerpo) => api.post<CompraApi>(`${urlCompra(compraId)}/cancelar`, cuerpo);

/** La lectura fresca de una compra (la usa «Aceptar sugerencia» para tomar su `revision` vigente). */
export const leerCompra = (compraId: string) => api.get<CompraApi>(urlCompra(compraId));

export const leerHistorial = (compraId: string) => api.get<EventoCompraApi[]>(`${urlCompra(compraId)}/historial`);

/** `POST /api/compras/importar`: en `0.13.0` solo con `carga_inicial` (sin ella, `400 carga_inicial_requerida`). */
export const importarCompras = (cuerpo: { modo: "previsualizar" | "aplicar"; carga_inicial: boolean; filas: Record<string, string>[] }) =>
  api.post<ReporteImportacionComprasApi>(URL_IMPORTAR_COMPRAS, cuerpo);
