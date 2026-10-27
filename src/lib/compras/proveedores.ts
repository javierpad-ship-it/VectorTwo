import { MAX_NOMBRE_PROVEEDOR } from "./tipos";
import type { ProveedorCuerpo } from "./esquemas";

/**
 * Reglas de los proveedores de las compras (ficha 08, §6.1 y regla 19). Puras.
 *  - `nombre` único sobre `upper(btrim(nombre))` (la base lo garantiza con un índice único; aquí se traduce a un mensaje útil);
 *  - `codigo` único sobre `upper` cuando existe;
 *  - un proveedor con compras no se borra: se desactiva (la FK de `compras` es `restrict`);
 *  - sin datos bancarios: lo rechaza el esquema (`proveedorSchema` es estricto), no esta capa.
 */

/** Texto con el que se comparan nombres y códigos: sin espacios en los bordes y en mayúsculas (como `upper(btrim(…))` de SQL). */
export const claveProveedor = (nombre: string): string => nombre.trim().toUpperCase();

export type ProveedorRegistro = { id: string; nombre: string; codigo?: string | null; activo: boolean; es_intercompany?: boolean };

export type MotivoRechazoProveedor = "nombre_repetido" | "codigo_repetido" | "nombre_vacio" | "nombre_largo" | "contactos_demasiados";

export type RechazoProveedor = { motivo: MotivoRechazoProveedor; mensaje: string; conflicto?: { id: string; nombre: string } };

/** Contactos por proveedor (M9a). */
export const MAX_CONTACTOS_PROVEEDOR = 20;

/**
 * `null` si el proveedor puede crearse o editarse; si no, el motivo y un mensaje para mostrar tal cual. `propioId` excluye al propio
 * proveedor al editarlo. `contactos` es la cantidad que trae el cuerpo (M9a).
 */
export function motivoRechazoProveedor(
  nuevo: Pick<ProveedorCuerpo, "nombre"> & { codigo?: string | null },
  existentes: readonly ProveedorRegistro[],
  opciones: { propioId?: string; contactos?: number } = {},
): RechazoProveedor | null {
  const nombre = claveProveedor(nuevo.nombre);
  if (nombre === "") return { motivo: "nombre_vacio", mensaje: "Escribe el nombre del proveedor." };
  if (nuevo.nombre.trim().length > MAX_NOMBRE_PROVEEDOR) {
    return { motivo: "nombre_largo", mensaje: `El nombre no puede superar ${MAX_NOMBRE_PROVEEDOR} caracteres.` };
  }
  if ((opciones.contactos ?? 0) > MAX_CONTACTOS_PROVEEDOR) {
    return { motivo: "contactos_demasiados", mensaje: `Un proveedor admite hasta ${MAX_CONTACTOS_PROVEEDOR} contactos.` };
  }
  const otros = existentes.filter((p) => p.id !== opciones.propioId);
  const igual = otros.find((p) => claveProveedor(p.nombre) === nombre);
  if (igual) {
    return { motivo: "nombre_repetido", mensaje: `Ya existe un proveedor con el nombre «${igual.nombre}».`, conflicto: { id: igual.id, nombre: igual.nombre } };
  }
  const codigo = nuevo.codigo?.trim();
  if (codigo) {
    const mismo = otros.find((p) => p.codigo && claveProveedor(p.codigo) === claveProveedor(codigo));
    if (mismo) {
      return { motivo: "codigo_repetido", mensaje: `Ya existe un proveedor con el código «${mismo.codigo}».`, conflicto: { id: mismo.id, nombre: mismo.nombre } };
    }
  }
  return null;
}

/**
 * Qué hace `DELETE /api/compras/proveedores/[id]`: con compras (de cualquier estado: la FK es `restrict`, también cuentan las
 * canceladas) se desactiva; sin ellas se puede borrar. `comprasTotal` es el total de compras del proveedor, no solo las vigentes.
 */
export function accionEliminarProveedor(comprasTotal: number): "borrar" | "desactivar" {
  return comprasTotal > 0 ? "desactivar" : "borrar";
}

/** Un proveedor inactivo no se ofrece en el autocompletado ni recibe compras nuevas. */
export const puedeRecibirCompras = (p: Pick<ProveedorRegistro, "activo">): boolean => p.activo;

/** El proveedor que corresponde a un nombre escrito a mano o importado (sin distinguir mayúsculas ni espacios de los bordes), o `null`. */
export function buscarProveedor(nombre: string, existentes: readonly ProveedorRegistro[]): ProveedorRegistro | null {
  const clave = claveProveedor(nombre);
  return clave === "" ? null : (existentes.find((p) => claveProveedor(p.nombre) === clave) ?? null);
}
