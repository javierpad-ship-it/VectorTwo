import "server-only";
import type { ProveedorIA } from "./proveedor";
import { crearProveedorOpenAI, hayClaveOpenAI } from "./proveedor-openai";
import type { EntornoIa } from "./entorno";

/**
 * Registro de adaptadores (ficha 07e, §3.11). Cada proveedor es un adaptador aparte; `IA_PROVEEDOR` dice cuál usa el servidor. Sin valor, o con
 * uno que no tiene adaptador, el servicio queda apagado (`sin_proveedor`). `proveedor-anthropic.ts` es un adaptador futuro: no existe en `0.15.0`.
 */

export type AdaptadorRegistrado = {
  /** Crea el proveedor (lee su clave en cada llamada). */
  crear(): ProveedorIA;
  /** ¿Hay clave del proveedor en el servidor? Nunca devuelve la clave. */
  hayClave(): boolean;
};

const ADAPTADORES: Readonly<Record<string, AdaptadorRegistrado>> = {
  openai: { crear: () => crearProveedorOpenAI(), hayClave: () => hayClaveOpenAI() },
};

/** Ids de los adaptadores que existen en el código. */
export const proveedoresRegistrados = (): string[] => Object.keys(ADAPTADORES);

/** El adaptador de `IA_PROVEEDOR`, o `null` si falta o no tiene adaptador. */
export function adaptadorDelEntorno(entorno: Pick<EntornoIa, "proveedor">): { id: string; adaptador: AdaptadorRegistrado } | null {
  const id = entorno.proveedor;
  if (id === null || !Object.prototype.hasOwnProperty.call(ADAPTADORES, id)) return null;
  return { id, adaptador: ADAPTADORES[id] };
}
