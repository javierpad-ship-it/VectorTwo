import { etiquetaPerfil, motivoFaltante } from "./matriz";
import type { Celda, CatalogoMatriz, MotivoFaltanteResponsable } from "./tipos";

/**
 * Regla 13: filas del CSV de la matriz (`descargarCsv` del frontend las
 * escapa con `Papa.unparse` y antepone el BOM). Una fila por celda, en el
 * orden recibido.
 */

export const COLUMNAS_CSV_RESPONSABLES = ["GENERO", "MUNDO", "RESPONSABLE", "CORREO", "ESTADO"] as const;

export const ESTADO_CSV = {
  asignada: "Asignada",
  inactiva: "Inactiva",
  sin_responsable: "Sin responsable",
  responsable_inactivo: "Responsable desactivado",
  responsable_no_comprador: "Responsable ya no es comprador",
} as const satisfies Record<"asignada" | "inactiva" | MotivoFaltanteResponsable, string>;

/**
 * Estado en texto según `motivoFaltante`. Una celda de género o mundo inactivo
 * no es faltante ni se reparte: sale como "Inactiva" (valor propio, no
 * previsto en la ficha, para no mezclarla con las faltantes).
 */
export function estadoCsv(celda: Celda): string {
  if (!celda.vigente) return ESTADO_CSV.inactiva;
  const motivo = motivoFaltante(celda);
  return motivo === null ? ESTADO_CSV.asignada : ESTADO_CSV[motivo];
}

export function filasCsvResponsables(
  celdas: Celda[],
  generos: Array<Pick<CatalogoMatriz, "id" | "nombre">>,
  mundos: Array<Pick<CatalogoMatriz, "id" | "nombre">>
): string[][] {
  const nombreGenero = new Map(generos.map((g) => [g.id, g.nombre]));
  const nombreMundo = new Map(mundos.map((m) => [m.id, m.nombre]));
  return celdas.map((c) => [
    nombreGenero.get(c.genero_id) ?? "",
    nombreMundo.get(c.mundo_id) ?? "",
    c.responsable ? etiquetaPerfil(c.responsable) : "",
    c.responsable?.email ?? "",
    estadoCsv(c),
  ]);
}
