import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";

/**
 * Los contratos de la API de M6 viven en `src/lib/curvas/tipos-api.ts`
 * (autocontenido: lo usan servidor y pantalla); acá solo se re-exportan los que
 * consume el módulo de periodos atípicos y se tipa la lista de agrupaciones de M3.
 */
export type {
  CrearPeriodoAtipicoCuerpo,
  EditarPeriodoAtipicoCuerpo,
  PeriodoAtipicoLista,
} from "@/lib/curvas/tipos-api";

/** Fila de `GET /api/agrupaciones-estacionalidad` con la temporada de M6 y la que sugieren sus líneas. */
export type AgrupacionConTemporada = AgrupacionEstacionalidadFila;
