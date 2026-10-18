import type { Modalidad, ModalidadEfectiva, ModalidadEntrada } from "./tipos-api";

/**
 * Modalidad de una marca (02b regla 5, ampliada por M12). Pura y sin dependencias de otros módulos de marcas: la importan
 * `reglas.ts` y `esquemas.ts` sin ciclo. Es el ÚNICO sitio que lee `modalidad_tratamiento` junto a `resto_al_barrer` para decidir qué
 * modalidad tiene una marca.
 */

/**
 * Las tres modalidades que admite la API (M12). La COLUMNA solo guarda `por_gml` o `barrido`: `mixta` se escribe como
 * `por_gml` + `resto_al_barrer` (`normalizarModalidad`), así no hace falta ampliar el check de `0010`.
 */
export const MODALIDADES = ["por_gml", "barrido", "mixta"] as const;

export function esModalidad(valor: unknown): valor is ModalidadEntrada {
  return typeof valor === "string" && (MODALIDADES as readonly string[]).includes(valor);
}

/** El par de columnas que representa una modalidad (M12, 6.1). */
export type ParModalidad = { modalidad_tratamiento: Modalidad; resto_al_barrer: boolean };

/** `mixta` → `{ por_gml, resto_al_barrer: true }`; cualquier otra escribe `resto_al_barrer = false`. */
export function normalizarModalidad(modalidad: ModalidadEntrada): ParModalidad {
  if (modalidad === "mixta") return { modalidad_tratamiento: "por_gml", resto_al_barrer: true };
  return { modalidad_tratamiento: modalidad, resto_al_barrer: false };
}

/**
 * 02b regla 5 ampliada por M12. Sin casilla → `null`; con casilla y `por_gml` → `por_gml`, o `mixta` si además
 * `resto_al_barrer`; con casilla y `barrido` o `null` (heredada de antes de `0010` o escrita desde el SQL Editor) →
 * `barrido`: "marcada y sin GML" es al barrer. Toda lectura de la modalidad pasa por aquí: nadie compara la columna.
 */
export function modalidadEfectiva(marca: {
  tratamiento_especial: boolean;
  modalidad_tratamiento: string | null;
  resto_al_barrer?: boolean | null;
}): ModalidadEfectiva | null {
  if (!marca.tratamiento_especial) return null;
  if (marca.modalidad_tratamiento === "por_gml") return marca.resto_al_barrer ? "mixta" : "por_gml";
  return "barrido";
}

// ─── Lectura/escritura de la columna cruda para las pantallas (M12, 6.1) ───
// Las pantallas no nombran `modalidad_tratamiento`: lo hacen estos helpers, junto al resto de las reglas de modalidad.

/** Lo que una pantalla necesita saber de una marca para decidir qué hacer con su modalidad (la columna cruda va aquí dentro). */
export type MarcaParaModalidad = {
  tratamiento_especial: boolean;
  modalidad_tratamiento: Modalidad | null;
  modalidad_efectiva: ModalidadEfectiva | null;
};

/** El cuerpo del `PATCH /api/marcas/[id]` que cambia la modalidad (la API normaliza `mixta` al par `por_gml` + `resto_al_barrer`). */
export function cuerpoModalidad(valor: ModalidadEntrada): { modalidad_tratamiento: ModalidadEntrada } {
  return { modalidad_tratamiento: valor };
}

/** La columna cruda en la forma que la API entrega, para armar un estado a partir de una marca. */
export function columnaModalidad(m: { modalidad_tratamiento: Modalidad | null }): { modalidad_tratamiento: Modalidad | null } {
  return { modalidad_tratamiento: m.modalidad_tratamiento };
}

/**
 * Marcada con tratamiento pero sin modalidad guardada (dato heredado de antes de `0010`): la API la lee `barrido`
 * (`modalidad_efectiva`), pero el planner debe poder verla como «sin modalidad» y elegirle una. Lectura cruda a propósito.
 */
export function sinModalidadGuardada(m: { tratamiento_especial: boolean; modalidad_tratamiento: Modalidad | null }): boolean {
  return m.tratamiento_especial && m.modalidad_tratamiento === null;
}
