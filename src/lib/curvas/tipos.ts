/**
 * Tipos y constantes de M6 del lado del servidor (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API" → Constantes). En el paso 1 solo hay lo que usan los
 * periodos atípicos y la temporada; las constantes del modelo (`MAX_MESES_HUECO`,
 * `UMBRAL_FORMA`, `MODELOS`…) llegan con el paso 2.
 *
 * Las formas JSON viven en `tipos-api.ts` (autocontenido, lo usa el frontend);
 * se re-exportan aquí para que el servidor importe de un solo sitio.
 */
import {
  ALCANCES_PERIODO,
  TEMPORADAS_AGRUPACION,
  type AlcancePeriodo,
  type TemporadaAgrupacion,
} from "./tipos-api";

export * from "./tipos-api";

export function esTemporadaAgrupacion(valor: unknown): valor is TemporadaAgrupacion {
  return typeof valor === "string" && (TEMPORADAS_AGRUPACION as readonly string[]).includes(valor);
}

export function esAlcancePeriodo(valor: unknown): valor is AlcancePeriodo {
  return typeof valor === "string" && (ALCANCES_PERIODO as readonly string[]).includes(valor);
}

/** Temporada de una fila de la base (`text` con `check`): un valor desconocido se trata como el neutro. */
export function temporadaDeFila(valor: unknown): TemporadaAgrupacion {
  return esTemporadaAgrupacion(valor) ? valor : "todo_el_ano";
}
