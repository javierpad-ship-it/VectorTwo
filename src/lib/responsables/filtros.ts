import { motivoFaltante } from "./matriz";
import type { Celda, FiltroCeldas } from "./tipos";

/**
 * Regla 11: filtros de la matriz, aplicados en memoria. Solo entran celdas
 * vigentes (una combinación con género o mundo inactivo no cuenta, igual que
 * en `resumen`), de modo que los conteos de los chips salen de esta misma
 * función y coinciden con el servidor:
 *
 *   "todas"                  → las vigentes (= `resumen.combinaciones`)
 *   "faltantes"              → `motivoFaltante ≠ null` (= `resumen.faltantes`)
 *   "sin_responsable"        → vigentes sin fila
 *   { responsable: perfilId } → las que apuntan a ese perfil, sea o no válido
 *                              ("Mis combinaciones" = `{ responsable: yo }`);
 *                              así se ve y se corrige lo que ya no lo es.
 *
 * Ningún filtro oculta datos del servidor: el cliente siempre recibe todo.
 */
export function filtrarCeldas(celdas: Celda[], filtro: FiltroCeldas): Celda[] {
  const vigentes = celdas.filter((c) => c.vigente);
  if (filtro === "todas") return vigentes;
  if (filtro === "faltantes") return vigentes.filter((c) => motivoFaltante(c) !== null);
  if (filtro === "sin_responsable") return vigentes.filter((c) => c.responsable === null);
  return vigentes.filter((c) => c.responsable?.id === filtro.responsable);
}
