import type { Rol } from "@/lib/auth/roles";
import type { ProveedorFichaCuerpo } from "./esquemas";
import { ESTADO_HTTP_ERROR_PROVEEDOR, MENSAJE_ERROR_PROVEEDOR, type CodigoErrorProveedor, type PermisosProveedorApi } from "./tipos-api";

/**
 * Reglas puras de los proveedores (08c, R13, R16). La base las vuelve a comprobar (`guardar_proveedor`); aquí se traducen a mensajes.
 */

/** Cambiar `es_intercompany` es del planner y del admin (R16), también al crear. */
export const puedeCambiarIntercompany = (rol: Rol): boolean => rol === "admin" || rol === "planner";

/** Desactivar y eliminar son del planner y del admin (R16). */
export const puedeDesactivarProveedor = (rol: Rol): boolean => rol === "admin" || rol === "planner";

/** Lo que el servidor le dice a la pantalla que puede hacer este rol sobre un proveedor. */
export function permisosProveedor(rol: Rol): PermisosProveedorApi {
  return { editar: true, cambiar_intercompany: puedeCambiarIntercompany(rol), desactivar: puedeDesactivarProveedor(rol), eliminar: puedeDesactivarProveedor(rol) };
}

type ContactoEntrada = NonNullable<ProveedorFichaCuerpo["contactos"]>[number];

/** Como mucho un principal; si el usuario no marcó ninguno, el primero pasa a principal (R13). Lista vacía = vacía. */
export function normalizarContactos(contactos: readonly ContactoEntrada[]): ContactoEntrada[] {
  const hayPrincipal = contactos.some((c) => c.es_principal);
  return contactos.map((c, i) => ({ ...c, es_principal: hayPrincipal ? c.es_principal : i === 0 }));
}

/**
 * Un comprador que pide `es_intercompany: true` al crear, o que lo cambia al editar, recibe `403 solo_planner_intercompany`.
 * `actual` es el valor guardado (al crear, `false`); `pedido` es `undefined` si el cuerpo no lo trae (se conserva).
 */
export function cambiaIntercompanySinPermiso(rol: Rol, pedido: boolean | undefined, actual: boolean): boolean {
  if (puedeCambiarIntercompany(rol)) return false;
  return pedido !== undefined && pedido !== actual;
}

/** Error con código estable de proveedores (estado y mensaje de las tablas de `tipos-api`). */
export function rechazoProveedor(codigo: CodigoErrorProveedor, mensaje?: string): { codigo: CodigoErrorProveedor; status: number; mensaje: string } {
  return { codigo, status: ESTADO_HTTP_ERROR_PROVEEDOR[codigo], mensaje: mensaje ?? MENSAJE_ERROR_PROVEEDOR[codigo] };
}

/** Mensaje de `nombre_repetido`; si el existente está inactivo pide reactivarlo (R11). */
export function mensajeNombreRepetido(conflicto: { nombre: string; activo: boolean } | null): string {
  if (!conflicto) return MENSAJE_ERROR_PROVEEDOR.nombre_repetido;
  return conflicto.activo
    ? `Ya existe un proveedor con el nombre «${conflicto.nombre}».`
    : `Existe «${conflicto.nombre}», pero está inactivo: pide a un admin o planner que lo reactive.`;
}

export function mensajeCodigoRepetido(conflicto: { nombre: string; activo: boolean } | null): string {
  if (!conflicto) return MENSAJE_ERROR_PROVEEDOR.codigo_repetido;
  return conflicto.activo
    ? `Ese código ya lo usa «${conflicto.nombre}».`
    : `Ese código ya lo usa «${conflicto.nombre}», que está inactivo: pide a un admin o planner que lo reactive.`;
}
