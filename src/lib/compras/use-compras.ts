"use client";

import { api } from "@/lib/api-client";
import { useColeccion } from "@/lib/use-coleccion";
import { useAccion, useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import type { MarcaFila } from "@/lib/marcas/tipos-api";
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
 * Lecturas y acciones de las pantallas de compras de M8 (ficha 08, §7), contra las rutas reales de `/api/compras/**` (T3b). Los proveedores
 * van con `useColeccion` (patrón del repositorio). La lista y una compra van con `useLectura`: la lista se filtra en el servidor con varios
 * controles a la vez y `useLectura` descarta las respuestas fuera de orden (con `useColeccion` una respuesta lenta del filtro anterior
 * podía pisar a la del actual). Nunca se habla con Supabase desde aquí.
 * Las escrituras de `0.13.0` son de admin y planner (`requirePlanner`): la pantalla oculta los botones al comprador, pero la API manda.
 */
export { useAccion };

/**
 * Filtros de `GET /api/compras` que la pantalla manda al servidor. `llegada_desde` y `llegada_hasta` son meses (`aaaa-mm`) de entrega; el
 * texto libre (`q`) se aplica en el navegador, que además busca en la nota.
 */
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

const SIN_COMPRAS: CompraApi[] = [];

/**
 * La lista de compras (con líneas y entregas; el historial va vacío). Mientras llega la lista del filtro nuevo conserva la anterior
 * (`cargando` indica que se relee). Recarga con `recargar()` tras cada escritura.
 */
export function useCompras(filtros: FiltrosCompras = {}) {
  const lectura = useLectura<CompraApi[]>(urlCompras(filtros), true);
  return { ...lectura, datos: lectura.datos ?? SIN_COMPRAS };
}

/** Una compra con su historial; sin id no lee nada (`datos = null`). */
export function useCompra(id: string | null) {
  return useLectura<CompraApi>(id === null ? null : urlCompra(id));
}

export function useProveedores() {
  return useColeccion<ProveedorApi>(URL_PROVEEDORES);
}

/** Las marcas para el filtro de la lista (`GET /api/marcas`, de todos los roles); con `activo = false` no lee nada. */
export function useMarcas(activo = true) {
  return useLectura<MarcaFila[]>(activo ? "/api/marcas" : null);
}

/** «Confirmar ingreso» (`POST …/recibir`): registra la recepción con el mes X y devuelve la compra al día. */
export const confirmarIngreso = (compraId: string, cuerpo: RecibirCuerpo) => api.post<CompraApi>(`${urlCompra(compraId)}/recibir`, cuerpo);

/** Quita un ingreso confirmado (`DELETE …/recepciones/[id]?revision=`). */
export const quitarIngreso = (compraId: string, recepcionId: string, revision: number) =>
  api.delete<CompraApi>(`${urlCompra(compraId)}/recepciones/${recepcionId}?revision=${revision}`);

/** Cancela la compra; con ingresos registrados cierra el saldo (§0.11). */
export const cancelarCompra = (compraId: string, cuerpo: CancelarCuerpo) => api.post<CompraApi>(`${urlCompra(compraId)}/cancelar`, cuerpo);

export const leerHistorial = (compraId: string) => api.get<EventoCompraApi[]>(`${urlCompra(compraId)}/historial`);

/** `POST /api/compras/importar`: en `0.13.0` solo con `carga_inicial` (sin ella, `400 carga_inicial_requerida`). */
export const importarCompras = (cuerpo: { modo: "previsualizar" | "aplicar"; carga_inicial: boolean; filas: Record<string, string>[] }) =>
  api.post<ReporteImportacionComprasApi>(URL_IMPORTAR_COMPRAS, cuerpo);
