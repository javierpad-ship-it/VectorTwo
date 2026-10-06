import type { AsignacionNoPermitida, GeneroDeAgrupacion, MotivoFaltante } from "./tipos";

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
 *
 * Géneros (cambio "agrupaciones por género"): cada agrupación pertenece a uno
 * o más géneros y una equivalencia solo puede asignarse a una agrupación que
 * incluya el género de su nodo (`equivalencias.genero_mundo_linea_id →
 * genero_mundo_linea.genero_id`). La base no puede expresarlo; lo hacen
 * cumplir los handlers con las funciones de este archivo. Una agrupación con
 * cero géneros (heredada) puede editarse pero no acepta asignaciones.
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

// ─── Géneros de la agrupación ───

/** Rechazo con su status HTTP, listo para `error(mensaje, status)`. */
export type RechazoAsignacion = { status: 404 | 409; mensaje: string };

export type AgrupacionConGeneros = { nombre: string; genero_ids: string[] };
export type AgrupacionDestinoConGeneros = AgrupacionDestino & { genero_ids: string[] };

/** ¿La agrupación incluye ese género? Sin géneros → nunca. */
export function generoPermitido(agrupacion: Pick<AgrupacionConGeneros, "genero_ids">, generoId: string): boolean {
  return agrupacion.genero_ids.includes(generoId);
}

/** Una agrupación sin géneros no acepta asignaciones hasta que tenga al menos uno. */
export function motivoRechazoSinGenero(agrupacion: AgrupacionConGeneros): { status: 409; mensaje: string } | null {
  if (agrupacion.genero_ids.length > 0) return null;
  return {
    status: 409,
    mensaje: `La agrupación ${agrupacion.nombre} no tiene géneros: asígnale al menos uno antes de usarla.`,
  };
}

/**
 * Regla de género de una equivalencia concreta: `null` si puede entrar en la
 * agrupación; si no, `409` con el motivo (sin géneros, o género no incluido).
 */
export function motivoRechazoGeneroAsignacion(
  agrupacion: AgrupacionConGeneros,
  generoDeLaEquivalencia: { id: string; nombre: string }
): { status: 409; mensaje: string } | null {
  const sinGenero = motivoRechazoSinGenero(agrupacion);
  if (sinGenero) return sinGenero;
  if (generoPermitido(agrupacion, generoDeLaEquivalencia.id)) return null;
  return {
    status: 409,
    mensaje:
      `La agrupación ${agrupacion.nombre} no incluye el género ${generoDeLaEquivalencia.nombre}: ` +
      "edítala para añadírselo o elige otra.",
  };
}

/**
 * Comprobaciones del DESTINO, sin mirar ninguna equivalencia (asignación
 * masiva): inexistente (404) → inactiva (409) → sin género (409). `destinoNulo`
 * (quitar) siempre se permite.
 */
export function rechazoDestinoAsignacion(
  agrupacion: AgrupacionDestinoConGeneros | null | undefined,
  destinoNulo: boolean
): RechazoAsignacion | null {
  const motivo = motivoRechazoAsignacion(agrupacion, destinoNulo);
  if (motivo) return { status: statusRechazoAsignacion(motivo), mensaje: motivo };
  if (destinoNulo || !agrupacion) return null;
  return motivoRechazoSinGenero(agrupacion);
}

/**
 * Asignación individual: el orden de comprobaciones es inexistente (404) →
 * inactiva (409) → sin género (409) → género no incluido (409). `null` en
 * `destinoNulo`: quitar no se comprueba.
 */
export function rechazoAsignacion(
  agrupacion: AgrupacionDestinoConGeneros | null | undefined,
  destinoNulo: boolean,
  generoDeLaEquivalencia: { id: string; nombre: string }
): RechazoAsignacion | null {
  const destino = rechazoDestinoAsignacion(agrupacion, destinoNulo);
  if (destino || destinoNulo || !agrupacion) return destino;
  return motivoRechazoGeneroAsignacion(agrupacion, generoDeLaEquivalencia);
}

/** Vínculo agrupación ↔ género tal como está en la base (`agrupacion_estacionalidad_genero`). */
export type VinculoGenero = { agrupacion_estacionalidad_id: string; genero_id: string };

/** Anexa `genero_ids` a cada agrupación a partir de los vínculos, en el orden en que llegan. */
export function anexarGeneroIds<T extends { id: string }>(
  agrupaciones: T[],
  vinculos: VinculoGenero[]
): Array<T & { genero_ids: string[] }> {
  const porAgrupacion = new Map<string, string[]>();
  for (const v of vinculos) {
    const lista = porAgrupacion.get(v.agrupacion_estacionalidad_id) ?? [];
    lista.push(v.genero_id);
    porAgrupacion.set(v.agrupacion_estacionalidad_id, lista);
  }
  return agrupaciones.map((a) => ({ ...a, genero_ids: porAgrupacion.get(a.id) ?? [] }));
}

const comparadorNombre = new Intl.Collator("es", { sensitivity: "base", numeric: true });

type GeneroOrdenable = GeneroDeAgrupacion & { orden: number };

/**
 * Géneros de una agrupación (`id, codigo, nombre`) ordenados por `orden, nombre`
 * del género. (Comparación propia: importar `compararOrdenNombre` de
 * `armar-arbol` crearía un ciclo, porque este archivo ya lo usa.)
 */
export function generosDeAgrupacion(generoIds: string[], generos: GeneroOrdenable[]): GeneroDeAgrupacion[] {
  const ids = new Set(generoIds);
  return generos
    .filter((g) => ids.has(g.id))
    .sort((a, b) => a.orden - b.orden || comparadorNombre.compare(a.nombre, b.nombre))
    .map(({ id, codigo, nombre }) => ({ id, codigo, nombre }));
}

/** Qué géneros hay que agregar y cuáles quitar para pasar del conjunto actual al pedido. */
export function diferenciaGeneros(actuales: string[], pedidos: string[]): { agregar: string[]; quitar: string[] } {
  const actual = new Set(actuales);
  const pedido = new Set(pedidos);
  return {
    agregar: [...pedido].filter((id) => !actual.has(id)),
    quitar: [...actual].filter((id) => !pedido.has(id)),
  };
}

/**
 * Quitar géneros a una agrupación: se rechaza si alguno de los géneros que se
 * quitan tiene equivalencias de ese género asignadas a la agrupación (se
 * reportan en el orden recibido; el primero con equivalencias manda).
 */
export function motivoRechazoQuitarGeneros(
  agrupacion: { nombre: string },
  quitados: Array<{ nombre: string; equivalencias: number }>
): string | null {
  const bloqueado = quitados.find((g) => g.equivalencias > 0);
  if (!bloqueado) return null;
  const n = bloqueado.equivalencias;
  const cuenta = n === 1 ? "1 equivalencia" : `${n} equivalencias`;
  return `No se puede quitar ${bloqueado.nombre} de ${agrupacion.nombre}: tiene ${cuenta} de ${bloqueado.nombre}. Reasígnalas antes.`;
}

/** Mensaje de un género que no existe al crear o editar una agrupación. */
export const GENERO_NO_ENCONTRADO = "Género no encontrado.";

/**
 * Géneros pedidos para una agrupación: todos deben existir (`404`) y los que
 * se AGREGAN deben estar activos (`409`). Los que ya tenía y se conservan no
 * se revisan: un género desactivado después no le quita la agrupación.
 */
export function motivoRechazoGenerosPedidos(
  pedidos: string[],
  existentes: Array<{ id: string; nombre: string; activo: boolean }>,
  agregar: string[]
): RechazoAsignacion | null {
  const porId = new Map(existentes.map((g) => [g.id, g]));
  if (pedidos.some((id) => !porId.has(id))) return { status: 404, mensaje: GENERO_NO_ENCONTRADO };
  const inactivo = agregar.map((id) => porId.get(id)).find((g) => g && !g.activo);
  if (inactivo) {
    return {
      status: 409,
      mensaje: `El género ${inactivo.nombre} está inactivo: no se puede asignar a una agrupación.`,
    };
  }
  return null;
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

export type EquivalenciaAsignable = {
  id: string;
  agrupacion_estacionalidad_id: string | null;
  /** Género del nodo de la equivalencia. */
  genero_id: string;
  genero_nombre: string;
};

export type PlanAsignacion = {
  /** Ids (sin repetir) cuya agrupación hay que escribir. */
  a_asignar: string[];
  sin_cambio: number;
  /** Ids pedidos que no están entre las encontradas. */
  no_encontradas: string[];
  /** Equivalencias cuyo género no está en la agrupación destino: no se asignan, no abortan. */
  no_permitidas: AsignacionNoPermitida[];
};

/**
 * Asignación masiva: deduplica los ids pedidos, separa los que no existen
 * (no abortan), los que ya tienen el destino (`sin_cambio`) y los que son de un
 * género que la agrupación destino no incluye (`no_permitidas`, tampoco
 * abortan) y deja en `a_asignar` solo los que cambian. Se asigna también a
 * inactivas: la asignación es un atributo de la equivalencia, no una escritura
 * bajo un padre apagado.
 *
 * `destino` es la agrupación a la que se asigna (su id y sus `genero_ids`) o
 * `null` para quitar: quitar no comprueba géneros. Las comprobaciones del
 * destino (existe, activo, tiene géneros) las hace el handler antes, con
 * `rechazoDestinoAsignacion`.
 */
export function planificarAsignacion(
  idsPedidos: string[],
  encontradas: EquivalenciaAsignable[],
  destino: { id: string; genero_ids: string[] } | null
): PlanAsignacion {
  const ids = [...new Set(idsPedidos)];
  const porId = new Map(encontradas.map((e) => [e.id, e]));
  const plan: PlanAsignacion = { a_asignar: [], sin_cambio: 0, no_encontradas: [], no_permitidas: [] };
  for (const id of ids) {
    const e = porId.get(id);
    if (!e) plan.no_encontradas.push(id);
    else if (e.agrupacion_estacionalidad_id === (destino?.id ?? null)) plan.sin_cambio += 1;
    else if (destino && !generoPermitido(destino, e.genero_id)) {
      plan.no_permitidas.push({ id, genero: e.genero_nombre });
    } else plan.a_asignar.push(id);
  }
  return plan;
}
