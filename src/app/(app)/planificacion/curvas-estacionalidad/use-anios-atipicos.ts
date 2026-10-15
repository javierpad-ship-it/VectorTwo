"use client";

import { useCallback } from "react";
import { TEMPORADAS_AGRUPACION, type AniosAtipicosRespuesta } from "@/lib/curvas/tipos-api";
import type { AniosDeTemporada } from "./anios-atipicos-card";
import { useRecurso } from "./use-recurso";

/**
 * Los años atípicos de M7 por temporada (`GET /api/periodos-atipicos/anios`): tres
 * lecturas que alimentan la tarjeta «Años marcados como atípicos» (pestañas
 * Periodos atípicos y Años Niño). `recargar` vuelve a pedir las tres.
 */
export function useAniosAtipicosPorTemporada() {
  const invierno = useRecurso<AniosAtipicosRespuesta>("/api/periodos-atipicos/anios?temporada=invierno");
  const verano = useRecurso<AniosAtipicosRespuesta>("/api/periodos-atipicos/anios?temporada=verano");
  const todo = useRecurso<AniosAtipicosRespuesta>("/api/periodos-atipicos/anios?temporada=todo_el_ano");
  const porTemporada = { invierno, verano, todo_el_ano: todo };

  const recargarInvierno = invierno.recargar;
  const recargarVerano = verano.recargar;
  const recargarTodo = todo.recargar;
  const recargar = useCallback(() => Promise.all([recargarInvierno(), recargarVerano(), recargarTodo()]).then(() => undefined), [recargarInvierno, recargarVerano, recargarTodo]);

  const filas: AniosDeTemporada[] = TEMPORADAS_AGRUPACION.map((t) => ({
    temporada: t,
    datos: porTemporada[t].datos,
    cargando: porTemporada[t].cargando,
    error: porTemporada[t].error,
    onCerrarError: () => porTemporada[t].setError(null),
  }));

  return { filas, recargar };
}
