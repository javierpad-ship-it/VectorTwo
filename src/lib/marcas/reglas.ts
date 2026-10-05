import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MAX_NOTA, MENSAJE_NOTA_LARGA } from "./esquemas";

/**
 * Reglas de negocio de marcas (docs/modulos/02-marcas.md, reglas 1–4 y 6).
 * Funciones puras: devuelven el motivo del rechazo en castellano o `null`.
 * Los handlers las llaman antes de tocar la base; los índices únicos, el
 * `on delete restrict` y los `check` son la garantía final.
 *
 * `motivoRechazoEliminar` (regla 4) es la de `src/lib/arbol/reglas.ts`, que
 * ya conoce los tipos `agrupacion_marca` y `marca`; se re-exporta por comodidad.
 */

export { motivoRechazoEliminar } from "@/lib/arbol/reglas";

export const AGRUPACION_NO_ENCONTRADA = "Agrupación de marca no encontrada.";
export const MENSAJE_NOTA_SIN_BANDERA_PATCH = "Marca el tratamiento especial para agregar una nota.";

type ConActivo = { activo: boolean };

/** Regla 1: una marca se ve si ella y su agrupación están activas. Sin agrupación (no debería pasar) → `false`. */
export function marcaVigente(marca: ConActivo, agrupacion: ConActivo | null | undefined): boolean {
  return Boolean(agrupacion) && marca.activo && (agrupacion as ConActivo).activo;
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

export type Tratamiento = { tratamiento_especial: boolean; nota_tratamiento: string | null };

/** Lo que trae el cuerpo del PATCH respecto al tratamiento: cada clave puede faltar. */
export type CambioTratamiento = { tratamiento_especial?: boolean; nota_tratamiento?: string | null };

export type ResultadoTratamiento = { motivo: string; valor: null } | { motivo: null; valor: Tratamiento };

/**
 * Regla 6: el par `{ tratamiento_especial, nota_tratamiento }` que se escribirá
 * al editar una marca.
 *
 *   - bandera resultante `false` → nota `null` siempre (aunque el cuerpo
 *     traiga nota o la marca la tuviera): al desmarcar se borra la nota;
 *   - bandera resultante `true` → la nota del cuerpo si viene, si no la actual;
 *   - nota vacía o solo espacios → `null`; nota de más de 200 → rechazo;
 *   - cuerpo con nota pero SIN bandera, sobre una marca sin tratamiento →
 *     rechazo "Marca el tratamiento especial para agregar una nota." (`400`).
 */
export function normalizarTratamiento(cambio: CambioTratamiento, actual: Tratamiento): ResultadoTratamiento {
  const bandera = cambio.tratamiento_especial ?? actual.tratamiento_especial;
  const traeNota = cambio.nota_tratamiento !== undefined;
  const notaCuerpo = traeNota ? (cambio.nota_tratamiento ?? "").trim() || null : undefined;

  if (notaCuerpo !== undefined && notaCuerpo !== null && notaCuerpo.length > MAX_NOTA) {
    return { motivo: MENSAJE_NOTA_LARGA, valor: null };
  }

  if (!bandera) {
    if (notaCuerpo && cambio.tratamiento_especial === undefined) {
      return { motivo: MENSAJE_NOTA_SIN_BANDERA_PATCH, valor: null };
    }
    return { motivo: null, valor: { tratamiento_especial: false, nota_tratamiento: null } };
  }

  const nota = traeNota ? (notaCuerpo ?? null) : actual.nota_tratamiento;
  return { motivo: null, valor: { tratamiento_especial: true, nota_tratamiento: nota } };
}
