/**
 * Pestañas de /maestros/marcas. Viven fuera del módulo cliente para que el
 * Server Component de la página pueda validar `?pestana=…`: un export de un
 * módulo "use client" llega al servidor como referencia, no como valor.
 */
export type PestanaMarcas = "agrupaciones" | "marcas" | "conjuntos" | "gml" | "importar";

export const PESTANAS_MARCAS: readonly PestanaMarcas[] = ["agrupaciones", "marcas", "conjuntos", "gml", "importar"];

export function esPestanaMarcas(v: unknown): v is PestanaMarcas {
  return typeof v === "string" && (PESTANAS_MARCAS as readonly string[]).includes(v);
}
