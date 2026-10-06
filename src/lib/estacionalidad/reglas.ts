import type { MotivoFaltante } from "./tipos";

/**
 * Reglas de negocio de M3 (docs/modulos/03-agrupaciones-estacionalidad.md,
 * reglas 4–7). Funciones puras: devuelven el motivo del rechazo en castellano
 * o `null`. Los handlers las llaman antes de tocar la base; los índices
 * únicos, el `on delete restrict` y los `check` son la garantía final.
 *
 * `motivoRechazoEliminar` (regla 5) es la de `src/lib/arbol/reglas.ts`, que
 * ya conoce el tipo `agrupacion_estacionalidad`; se re-exporta por comodidad.
 *
 * Regla 6: desactivar una agrupación NUNCA se rechaza por tener
 * equivalencias. A propósito no existe `motivoRechazoDesactivarAgrupacion`;
 * quien quiera agregarla tiene que cambiar la regla en la ficha primero.
 */

export { motivoRechazoEliminar } from "@/lib/arbol/reglas";

export const AGRUPACION_NO_ENCONTRADA = "Agrupación de estacionalidad no encontrada.";

export type AgrupacionDestino = { nombre: string; activo: boolean };

/**
 * Regla 4: a qué agrupación se puede asignar una equivalencia. `destinoNulo`
 * (quitar la agrupación) siempre se permite; `undefined` → no existe (el
 * handler responde `404`); inactiva → `409`; activa → `null`.
 */
export function motivoRechazoAsignacion(
  agrupacion: AgrupacionDestino | null | undefined,
  destinoNulo: boolean
): string | null {
  if (destinoNulo) return null;
  if (!agrupacion) return AGRUPACION_NO_ENCONTRADA;
  if (!agrupacion.activo) return `La agrupación ${agrupacion.nombre} está inactiva: reactívala o elige otra.`;
  return null;
}

/** Status HTTP que corresponde a un motivo de `motivoRechazoAsignacion`. */
export function statusRechazoAsignacion(motivo: string): 404 | 409 {
  return motivo === AGRUPACION_NO_ENCONTRADA ? 404 : 409;
}

type ConActivo = { activo: boolean };

/**
 * Regla 7: una equivalencia es faltante si está activa, su nodo es vigente y
 * no tiene agrupación activa. Devuelve el motivo o `null` si no es faltante.
 * Una genérica cuenta igual que una real; una inactiva o en nodo no vigente
 * nunca es faltante aunque no tenga agrupación.
 */
export function motivoFaltante(
  equivalencia: ConActivo,
  vigente: boolean,
  agrupacion: ConActivo | null | undefined
): MotivoFaltante | null {
  if (!equivalencia.activo || !vigente) return null;
  if (!agrupacion) return "sin_agrupacion";
  if (!agrupacion.activo) return "agrupacion_inactiva";
  return null;
}

export type EquivalenciaAsignable = { id: string; agrupacion_estacionalidad_id: string | null };

export type PlanAsignacion = {
  /** Ids (sin repetir) cuya agrupación hay que escribir. */
  a_asignar: string[];
  sin_cambio: number;
  /** Ids pedidos que no están entre las encontradas. */
  no_encontradas: string[];
};

/**
 * Asignación masiva: deduplica los ids pedidos, separa los que no existen
 * (no abortan) y los que ya tienen el destino (`sin_cambio`), y deja en
 * `a_asignar` solo los que cambian. Se asigna también a inactivas: la
 * asignación es un atributo de la equivalencia, no una escritura bajo un
 * padre apagado.
 */
export function planificarAsignacion(
  idsPedidos: string[],
  encontradas: EquivalenciaAsignable[],
  agrupacionId: string | null
): PlanAsignacion {
  const ids = [...new Set(idsPedidos)];
  const porId = new Map(encontradas.map((e) => [e.id, e]));
  const plan: PlanAsignacion = { a_asignar: [], sin_cambio: 0, no_encontradas: [] };
  for (const id of ids) {
    const e = porId.get(id);
    if (!e) plan.no_encontradas.push(id);
    else if (e.agrupacion_estacionalidad_id === agrupacionId) plan.sin_cambio += 1;
    else plan.a_asignar.push(id);
  }
  return plan;
}
