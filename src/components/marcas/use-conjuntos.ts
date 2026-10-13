"use client";

import { useRecurso } from "./use-recurso";
import type { RespuestaConjuntos } from "./tipos-m2b";

/** `GET /api/marcas/conjuntos` (solo planner/admin). */
export function useConjuntos(incluirInactivas: boolean, habilitado = true) {
  return useRecurso<RespuestaConjuntos>(habilitado ? `/api/marcas/conjuntos${incluirInactivas ? "?incluir_inactivas=1" : ""}` : null);
}
