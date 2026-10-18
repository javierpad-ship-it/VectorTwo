import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MAX_NOTA, MENSAJE_NOTA_LARGA } from "./esquemas";
import { MODALIDADES, esModalidad, modalidadEfectiva, normalizarModalidad, type ParModalidad } from "./modalidad";
import type { Modalidad, ModalidadEntrada } from "./tipos-api";

/**
 * Reglas de negocio de marcas (docs/modulos/02-marcas.md, reglas 1–4 y 6).
 * Funciones puras: devuelven el motivo del rechazo en castellano o `null`.
 * Los handlers las llaman antes de tocar la base; los índices únicos, el
 * `on delete restrict` y los `check` son la garantía final.
 *
 * Desde 02b también hay aquí la modalidad del tratamiento (reglas 5 y 6 de la
 * ficha de 02b).
 *
 * `motivoRechazoEliminar` (regla 4) es la de `src/lib/arbol/reglas.ts`, que
 * ya conoce los tipos `agrupacion_marca` y `marca`; se re-exporta por comodidad.
 */

import { motivoRechazoEliminar } from "@/lib/arbol/reglas";

export { motivoRechazoEliminar };

export const AGRUPACION_NO_ENCONTRADA = "Agrupación de marca no encontrada.";
export const MENSAJE_NOTA_SIN_BANDERA_PATCH = "Marca el tratamiento especial para agregar una nota.";

type ConActivo = { activo: boolean };

/** Regla 1: una marca se ve si ella y su agrupación están activas. Sin agrupación (no debería pasar) → `false`. */
export function marcaVigente(marca: ConActivo, agrupacion: ConActivo | null | undefined): boolean {
  return Boolean(agrupacion) && marca.activo && (agrupacion as ConActivo).activo;
}

/**
 * 02b: eliminar una marca. `409` si tiene venta o stock (M5) o si es cabeza de
 * un conjunto con miembros (se rechaza antes de que lo haga la FK `restrict`,
 * con el conteo en el mensaje). Eliminar un miembro simplemente lo saca del
 * conjunto; la cascada se lleva sus asignaciones por GML.
 */
export function motivoRechazoEliminarMarca(hechos: number, miembros: number): string | null {
  const porHechos = motivoRechazoEliminar("marca", hechos);
  if (porHechos) return porHechos;
  if (miembros > 0) {
    return `No se puede eliminar la marca: es cabeza de un conjunto con ${miembros === 1 ? "1 marca" : `${miembros} marcas`}. Quítalas del conjunto o desactívala.`;
  }
  return null;
}

export type AgrupacionDestino = { nombre: string; activo: boolean };

/**
 * Regla 2: a qué agrupación se puede asignar una marca. `undefined` → no
 * existe (el handler responde `404`); inactiva → `409`; activa → `null`. Solo
 * se aplica al crear y al *mover* (PATCH con `agrupacion_marca_id`); estar en
 * una agrupación inactiva no impide renombrar, desactivar ni reactivar.
 */
export function motivoRechazoAgrupacionDestino(agrupacion: AgrupacionDestino | null | undefined): string | null {
  if (!agrupacion) return AGRUPACION_NO_ENCONTRADA;
  if (!agrupacion.activo) {
    return `La agrupación ${agrupacion.nombre} está inactiva: reactívala antes de asignarle marcas.`;
  }
  return null;
}

export type MarcaMin = { id: string; nombre: string; codigo: string };
export type CambioMarca = { id?: string; nombre?: string; codigo?: string };

/** Regla 3: nombre repetido tras normalizar o código repetido sin distinguir caja (sin contar la propia marca). */
export function motivoRechazoMarca(marcasExistentes: MarcaMin[], cambio: CambioMarca): string | null {
  const otras = marcasExistentes.filter((m) => m.id !== cambio.id);
  const nombre = cambio.nombre === undefined ? undefined : normalizarNombre(cambio.nombre);
  const codigo = cambio.codigo === undefined ? undefined : aCodigo(cambio.codigo);

  if (nombre !== undefined && otras.some((m) => normalizarNombre(m.nombre) === nombre)) {
    return `Ya existe una marca llamada ${nombre}.`;
  }
  if (codigo !== undefined && otras.some((m) => m.codigo.toUpperCase() === codigo)) {
    return `Ya existe una marca con el código ${codigo}.`;
  }
  return null;
}

export { MODALIDADES, esModalidad, modalidadEfectiva, normalizarModalidad, type ParModalidad };

/** 02b regla 6: `por_gml` si la marca ya tiene GML asignados, `barrido` si no (la interpretación de Javier de "marcada y sin GML"). */
export function modalidadPorDefecto(gmlActivos: number): Modalidad {
  return gmlActivos > 0 ? "por_gml" : "barrido";
}

export const MENSAJE_MODALIDAD_SIN_BANDERA = "La modalidad solo se guarda si la marca tiene tratamiento especial.";
export const MENSAJE_MODALIDAD_SIN_BANDERA_PATCH = "Marca el tratamiento especial para definir la modalidad.";

export type Tratamiento = {
  tratamiento_especial: boolean;
  nota_tratamiento: string | null;
  modalidad_tratamiento: Modalidad | null;
  /** M12: `true` solo en una `mixta` (`modalidad_tratamiento = 'por_gml'`). */
  resto_al_barrer: boolean;
};

/** Lo que trae el cuerpo del PATCH respecto al tratamiento: cada clave puede faltar (`modalidad_tratamiento: null` cuenta como "no dice"). */
export type CambioTratamiento = {
  tratamiento_especial?: boolean;
  nota_tratamiento?: string | null;
  modalidad_tratamiento?: ModalidadEntrada | null;
};

/** Lo actual de la marca (una fila de `marcas` sirve tal cual; la modalidad desconocida se lee como ausente). */
export type TratamientoActual = {
  tratamiento_especial: boolean;
  nota_tratamiento: string | null;
  modalidad_tratamiento?: string | null;
  resto_al_barrer?: boolean | null;
};

export type ResultadoTratamiento = { motivo: string; valor: null } | { motivo: null; valor: Tratamiento };

/**
 * Regla 6 de M2, ampliada por 02b: el trío `{ tratamiento_especial,
 * nota_tratamiento, modalidad_tratamiento }` que se escribirá al editar una
 * marca.
 *
 *   - M12: la `mixta` del cuerpo se escribe como `por_gml` + `resto_al_barrer`; toda otra modalidad (y desmarcar) deja
 *     `resto_al_barrer = false`; si el cuerpo no trae modalidad se conserva el par actual;
 *   - casilla resultante `false` → nota y modalidad `null` siempre (aunque el
 *     cuerpo traiga nota o la marca las tuviera): al desmarcar se borran. Las
 *     asignaciones por GML NO se tocan (el handler no las borra);
 *   - casilla resultante `true` → la nota del cuerpo si viene, si no la actual;
 *     la modalidad del cuerpo si viene, si no la actual si existe y, si no,
 *     `modalidadPorDefecto(gmlActivos)`: toda escritura que deja la casilla
 *     encendida escribe una modalidad (la garantía inversa del `check`);
 *   - nota vacía o solo espacios → `null`; nota de más de 200 → rechazo;
 *   - cuerpo con nota o modalidad pero SIN casilla, sobre una marca sin
 *     tratamiento → rechazo (`400`).
 */
export function normalizarTratamiento(
  cambio: CambioTratamiento,
  actual: TratamientoActual,
  gmlActivos = 0
): ResultadoTratamiento {
  const bandera = cambio.tratamiento_especial ?? actual.tratamiento_especial;
  const traeNota = cambio.nota_tratamiento !== undefined;
  const notaCuerpo = traeNota ? (cambio.nota_tratamiento ?? "").trim() || null : undefined;
  const modalidadCuerpo = cambio.modalidad_tratamiento ?? undefined;

  if (notaCuerpo !== undefined && notaCuerpo !== null && notaCuerpo.length > MAX_NOTA) {
    return { motivo: MENSAJE_NOTA_LARGA, valor: null };
  }

  if (!bandera) {
    if (notaCuerpo && cambio.tratamiento_especial === undefined) {
      return { motivo: MENSAJE_NOTA_SIN_BANDERA_PATCH, valor: null };
    }
    if (modalidadCuerpo !== undefined && cambio.tratamiento_especial === undefined) {
      return { motivo: MENSAJE_MODALIDAD_SIN_BANDERA_PATCH, valor: null };
    }
    return {
      motivo: null,
      valor: { tratamiento_especial: false, nota_tratamiento: null, modalidad_tratamiento: null, resto_al_barrer: false },
    };
  }

  const nota = traeNota ? (notaCuerpo ?? null) : actual.nota_tratamiento;
  // La modalidad actual como la lee el usuario (la columna sola no distingue `mixta`).
  const efectivaActual = actual.tratamiento_especial ? modalidadEfectiva({ ...actual, modalidad_tratamiento: actual.modalidad_tratamiento ?? null, tratamiento_especial: true }) : null;
  const columnaActual = actual.modalidad_tratamiento === "por_gml" || actual.modalidad_tratamiento === "barrido" ? actual.modalidad_tratamiento : null;
  const destino: ModalidadEntrada =
    modalidadCuerpo ?? (columnaActual !== null && efectivaActual !== null ? efectivaActual : modalidadPorDefecto(gmlActivos));
  const par = normalizarModalidad(destino);
  return { motivo: null, valor: { tratamiento_especial: true, nota_tratamiento: nota, ...par } };
}
