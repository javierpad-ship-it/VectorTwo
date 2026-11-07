import type { PersonaFechaApi, ProveedorApi } from "@/lib/compras/tipos-api";
import type { AccionProveedor, CampoFaltante, Incoterm } from "./constantes";

/**
 * Contratos de la API de proveedores (08c, §3.2). Sin dependencias de servidor: los comparten el servicio y las pantallas.
 *
 *   GET    /api/compras/proveedores?activos=1&q=       → ProveedorListadoApi[]
 *   POST   /api/compras/proveedores                    → 201 ProveedorFichaApi (modo ficha o rápido)
 *   GET    /api/compras/proveedores/[id]               → ProveedorDetalleApi
 *   PATCH  /api/compras/proveedores/[id]               → ProveedorFichaApi
 *   POST   /api/compras/proveedores/[id]/activo        → ProveedorFichaApi
 *   DELETE /api/compras/proveedores/[id]               → { accion: "borrado" | "desactivado" }
 *   GET    /api/compras/proveedores/[id]/historial     → EventoProveedorApi[]
 *
 * `clave_origen`, `revision` interna de la carga y cualquier dato bancario NO salen nunca (decisión 106, regla 19).
 */

export type ContactoProveedorApi = { id: string; nombre: string; cargo: string | null; telefono: string | null; correo: string | null; es_principal: boolean };

/** Un elemento del listado: `ProveedorApi` (de compras) más los campos de importación y los contactos llenos. */
export type ProveedorListadoApi = Omit<ProveedorApi, "contactos"> & {
  region: string | null;
  puerto_embarque: string | null;
  incoterm: Incoterm | null;
  moneda: "USD" | "PEN" | null;
  /** `faltan` vacío. */
  completo: boolean;
  contactos: ContactoProveedorApi[];
};

export type PermisosProveedorApi = { editar: boolean; cambiar_intercompany: boolean; desactivar: boolean; eliminar: boolean };

export type ProveedorFichaApi = ProveedorListadoApi & {
  direccion: string | null;
  plazo_produccion_dias: number | null;
  plazo_transito_dias: number | null;
  condiciones_pago: string | null;
  faltan: CampoFaltante[];
  creado_por: PersonaFechaApi;
  modificado_por: PersonaFechaApi | null;
  revision: number;
  puede: PermisosProveedorApi;
  /** Solo en la respuesta de un alta: nombres parecidos que ya existían (aviso, no bloquea). */
  parecidos?: ParecidoProveedorApi[];
};

export type ResumenProveedorApi = {
  compras: number;
  ultima_compra: string | null;
  unidades: number;
  costo: { USD: number; PEN: number };
};

export type ProveedorDetalleApi = ProveedorFichaApi & { resumen: ResumenProveedorApi };

export type ParecidoProveedorApi = { id: string; nombre: string; similitud: number; motivo: "misma_razon_social" | "similar" };

/** Cambio campo a campo de un evento del historial (`antes` y `despues` ya sin banco ni claves internas). */
export type CambioProveedorApi = { campo: string; antes: string | null; despues: string | null };

export type EventoProveedorApi = {
  id: string;
  accion: AccionProveedor;
  resumen: string | null;
  cambios: CambioProveedorApi[];
  por: PersonaFechaApi;
};

export type RespuestaEliminarProveedorApi = { accion: "borrado" | "desactivado" };

// ─── Códigos de error (§3.6) ───

export type CodigoErrorProveedor =
  | "proveedor_cambio"
  | "nombre_repetido"
  | "codigo_repetido"
  | "nombre_parecido"
  | "solo_planner_intercompany"
  | "no_encontrado";

export const ESTADO_HTTP_ERROR_PROVEEDOR: Record<CodigoErrorProveedor, number> = {
  proveedor_cambio: 409,
  nombre_repetido: 409,
  codigo_repetido: 409,
  nombre_parecido: 409,
  solo_planner_intercompany: 403,
  no_encontrado: 404,
};

export const MENSAJE_ERROR_PROVEEDOR: Record<CodigoErrorProveedor, string> = {
  proveedor_cambio: "Otra persona guardó cambios en este proveedor. Recarga la ficha y vuelve a intentarlo.",
  nombre_repetido: "Ya existe un proveedor con ese nombre.",
  codigo_repetido: "Ya existe un proveedor con ese código.",
  nombre_parecido: "Hay proveedores con un nombre parecido. Confirma si es alguno de ellos.",
  solo_planner_intercompany: "Solo un planner o un admin puede marcar o quitar la marca intercompany de un proveedor.",
  no_encontrado: "No encontramos ese proveedor.",
};
