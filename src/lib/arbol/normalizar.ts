/**
 * Normalización de nombres y códigos del árbol de producto
 * (docs/modulos/01-arbol-producto.md, "Convenciones comunes").
 *
 * Funciones puras, sin dependencias: las usan los esquemas zod del backend,
 * el importador y las previsualizaciones del frontend.
 */

export const TEMPORADAS = ["Verano", "Invierno", "Todo el año"] as const;
export type Temporada = (typeof TEMPORADAS)[number];

export function esTemporada(valor: unknown): valor is Temporada {
  return typeof valor === "string" && (TEMPORADAS as readonly string[]).includes(valor);
}

/** Equivalencia genérica que recibe las filas sin equivalencia definida. */
export const EQUIVALENCIA_GENERICA = {
  nombre: "SIN EQUIVALENCIA",
  codigo: "SIN_EQUIVALENCIA",
} as const;

export const MAX_NOMBRE = 120;
export const MAX_CODIGO = 40;

/**
 * Nombre canónico: Unicode NFC, sin espacios en los bordes, espacios
 * internos colapsados y mayúsculas con reglas de español (ñ → Ñ).
 */
export function normalizarNombre(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleUpperCase("es");
}

/**
 * Código ASCII estable a partir de un nombre: sin acentos, Ñ → N, todo lo
 * que no sea letra o dígito pasa a `_`, sin `_` repetidos ni en los bordes,
 * máximo MAX_CODIGO caracteres.
 *
 *   aCodigo("Niñas")       → "NINAS"
 *   aCodigo("SIN ASIGNAR") → "SIN_ASIGNAR"
 *   aCodigo("POLO M/C")    → "POLO_M_C"
 *   aCodigo("  --  ")      → ""
 */
export function aCodigo(valor: unknown): string {
  const base = normalizarNombre(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.slice(0, MAX_CODIGO).replace(/_+$/g, "");
}

/** `""`, `"-"`, `"   "` y `"SIN EQUIVALENCIA"` (en cualquier caja) significan "sin equivalencia definida". */
export function esEquivalenciaGenerica(valor: unknown): boolean {
  const n = normalizarNombre(valor);
  return n === "" || n === "-" || n === EQUIVALENCIA_GENERICA.nombre;
}
