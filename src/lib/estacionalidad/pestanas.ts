/**
 * Pestañas de /maestros/estacionalidad. Viven fuera del módulo cliente
 * para que el Server Component de la página pueda validar `?pestana=…`:
 * un export de un módulo "use client" llega al servidor como referencia,
 * no como valor, y `.includes` no existe.
 */
export type PestanaEstacionalidad = "agrupaciones" | "asignacion" | "faltantes" | "importar";

export const PESTANAS_ESTACIONALIDAD: readonly PestanaEstacionalidad[] = [
  "agrupaciones",
  "asignacion",
  "faltantes",
  "importar",
];

export function esPestanaEstacionalidad(v: unknown): v is PestanaEstacionalidad {
  return typeof v === "string" && (PESTANAS_ESTACIONALIDAD as readonly string[]).includes(v);
}
