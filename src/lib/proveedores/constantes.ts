/** Constantes de la ficha del proveedor (08c, §2.1 y §3.1). Sin dependencias: las usan los esquemas, las reglas y las pantallas. */

/** Incoterms 2020. Catálogo en zod, sin `check` en la base (PLAN §4). Solo informativo (decisión 102). */
export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];

export const MAX_CONTACTOS_POR_PROVEEDOR = 20;

/** Cuánto se parecen dos nombres (Dice sobre los nombres limpios) para avisar «¿es alguno de estos?» (R12). */
export const UMBRAL_PARECIDO_PROVEEDOR = 0.7;
/** Cuántos parecidos se ofrecen como mucho. */
export const MAX_PARECIDOS = 3;

/** Acciones del historial de un proveedor (`proveedor_eventos.accion`, decisión 103). */
export const ACCIONES_PROVEEDOR = ["crear", "editar", "desactivar", "reactivar", "eliminar", "importar"] as const;
export type AccionProveedor = (typeof ACCIONES_PROVEEDOR)[number];

/** Lo que puede faltar en una ficha para considerarla completa (`faltan`, §3.2). */
export const CAMPOS_FALTANTES = ["pais", "identificacion", "direccion", "contacto"] as const;
export type CampoFaltante = (typeof CAMPOS_FALTANTES)[number];
