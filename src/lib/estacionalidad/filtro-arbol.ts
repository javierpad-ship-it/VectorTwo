import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import type { EquivalenciaPlana } from "./tipos-api";

/** Filtro de árbol de las pestañas Asignación y Faltantes: género · mundo · una o varias líneas · texto. */
export type FiltroArbol = { generoId: string; mundoId: string; lineaIds: string[]; texto: string };

export const FILTRO_ARBOL_VACIO: FiltroArbol = { generoId: "", mundoId: "", lineaIds: [], texto: "" };

/**
 * Filtro en memoria. `lineaIds` vacío = todas las líneas; con varias ids pasan
 * las equivalencias de cualquiera de ellas. El texto busca en nombre y código
 * de la equivalencia y en la ruta.
 */
export function filtrarPorArbol(filas: readonly EquivalenciaPlana[], f: FiltroArbol): EquivalenciaPlana[] {
  const consulta = normalizarNombre(f.texto);
  const consultaCodigo = aCodigo(consulta);
  const lineas = new Set(f.lineaIds);
  return filas.filter(
    (e) =>
      (f.generoId === "" || e.genero_id === f.generoId) &&
      (f.mundoId === "" || e.mundo_id === f.mundoId) &&
      (lineas.size === 0 || lineas.has(e.linea_id)) &&
      (consulta === "" ||
        e.nombre.includes(consulta) ||
        e.ruta.includes(consulta) ||
        (consultaCodigo !== "" && e.codigo.includes(consultaCodigo)))
  );
}

/** Deja solo las líneas elegidas que siguen disponibles (cambiar género o mundo puede quitar alguna). */
export function lineasVigentes(elegidas: readonly string[], disponibles: readonly { id: string }[]): string[] {
  const ids = new Set(disponibles.map((l) => l.id));
  return elegidas.filter((id) => ids.has(id));
}

/** Texto del botón del selector: "Todas", el nombre, "A, B" o "N líneas". */
export function resumenLineas(elegidas: readonly string[], disponibles: readonly { id: string; nombre: string }[]): string {
  if (elegidas.length === 0) return "Todas";
  const nombres = disponibles.filter((l) => elegidas.includes(l.id)).map((l) => l.nombre);
  if (nombres.length <= 2) return nombres.join(", ");
  return `${nombres.length} líneas`;
}
