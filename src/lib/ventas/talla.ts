import { normalizarNombre } from "@/lib/arbol/normalizar";

/**
 * Mapeo de la talla del archivo a la agrupación de talla (regla 10). Solo hay
 * dos agrupaciones (catálogo cerrado de M1). `Revisar`, `-` y vacío se cargan
 * como CENTRALES con aviso. No se guarda la talla original: si se decide
 * repartir `Revisar` de otro modo, se recarga el mes.
 */

export type AgrupacionTalla = "CENTRALES" | "EXTREMAS";

/** Valor original que disparó el aviso de `Revisar`. */
export type OrigenRevisar = "REVISAR" | "-" | "";

export type TallaMapeada = {
  agrupacion: AgrupacionTalla;
  revisar: boolean;
  /** Solo con `revisar`: el valor original (`REVISAR`, `-` o vacío). */
  original: OrigenRevisar | null;
};

const sinAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Constante fácil de cambiar: valor normalizado (sin acentos) → resultado. */
export const MAPEO_TALLA: Readonly<Record<string, TallaMapeada>> = {
  CENTRAL: { agrupacion: "CENTRALES", revisar: false, original: null },
  CENTRALES: { agrupacion: "CENTRALES", revisar: false, original: null },
  "TALLAS CENTRALES": { agrupacion: "CENTRALES", revisar: false, original: null },
  EXTREMA: { agrupacion: "EXTREMAS", revisar: false, original: null },
  EXTREMAS: { agrupacion: "EXTREMAS", revisar: false, original: null },
  "TALLAS EXTREMAS": { agrupacion: "EXTREMAS", revisar: false, original: null },
  REVISAR: { agrupacion: "CENTRALES", revisar: true, original: "REVISAR" },
  "-": { agrupacion: "CENTRALES", revisar: true, original: "-" },
  "": { agrupacion: "CENTRALES", revisar: true, original: "" },
};

/** `null` si la talla no se reconoce (`talla_desconocida`). */
export function mapearTalla(valor: unknown): TallaMapeada | null {
  const clave = sinAcentos(normalizarNombre(valor));
  return MAPEO_TALLA[clave] ?? null;
}

/** 0 = CENTRALES, 1 = EXTREMAS (el código que viaja en las tandas). */
export function codigoTalla(agrupacion: AgrupacionTalla): 0 | 1 {
  return agrupacion === "EXTREMAS" ? 1 : 0;
}
