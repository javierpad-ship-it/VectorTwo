import type { AgrupacionEstacionalidadFila } from "@/lib/estacionalidad/tipos-api";

/**
 * Los contratos de la API de M6 (paso 1) viven en `src/lib/curvas/tipos-api.ts`
 * (autocontenido: lo usan servidor y pantalla); acá solo se re-exportan los que
 * consume esta pantalla.
 */
export type {
  AlcancePeriodo,
  AniosAtipicosRespuesta,
  CrearPeriodoAtipicoCuerpo,
  EditarPeriodoAtipicoCuerpo,
  PeriodoAtipicoLista,
} from "@/lib/curvas/tipos-api";

/** Fila de `GET /api/agrupaciones-estacionalidad` con la temporada de M6 y la que sugieren sus líneas. */
export type AgrupacionConTemporada = AgrupacionEstacionalidadFila;

/** ¿La temporada fijada difiere de la sugerida (aviso `temporada_sugerida_distinta`)? */
export function temporadaDistinta(a: AgrupacionConTemporada): boolean {
  return a.temporada_sugerida_distinta ?? (a.equivalencias_activas > 0 && a.temporada_sugerida !== a.temporada);
}
