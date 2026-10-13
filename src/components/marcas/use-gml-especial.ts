"use client";

import { useRecurso } from "./use-recurso";
import type { EstadoGmlEspecial } from "./tipos-m2b";

/**
 * `GET /api/marcas/gml-especial` (solo planner/admin). Con `habilitado = false`
 * (el comprador) no se llama a la API.
 */
export function useGmlEspecial(incluirInactivas: boolean, habilitado = true) {
  return useRecurso<EstadoGmlEspecial>(habilitado ? `/api/marcas/gml-especial${incluirInactivas ? "?incluir_inactivas=1" : ""}` : null);
}
