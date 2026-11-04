import type { Hoja } from "@/lib/proyeccion/excel";
import { COLUMNAS_IMPORTAR_AGRUPADORES, type ClaveColumnaAgrupador } from "./tipos";

/**
 * Plantilla del importador de agrupadores (ficha 08b, §3.11, R25). Pura: la pestaña Importar la baja en CSV (`descargarCsv`) y en Excel
 * (`descargarExcel`) con el encabezado y una fila de ejemplo de cada tipo, todo sintético. La plantilla recomienda ESCRIBIR EL CÓDIGO
 * (con código la clave es el código y reimportar no duplica; sin código la clave es natural y el código se numera al aplicar).
 *
 * El encabezado y el orden son los de `COLUMNAS_IMPORTAR_AGRUPADORES` y de la hoja `AGRUPADORES` de la exportación a Excel, así que lo que
 * se baja de Viajes y embarques se puede completar y volver a subir.
 */

export const NOMBRE_ARCHIVO_PLANTILLA_AGRUPADORES_XLSX = "plantilla-agrupadores.xlsx";
export const NOMBRE_ARCHIVO_PLANTILLA_AGRUPADORES_CSV = "plantilla-agrupadores.csv";
export const NOMBRE_HOJA_PLANTILLA_AGRUPADORES = "AGRUPADORES";

/** Encabezados, en el orden de la plantilla. */
export const ENCABEZADOS_AGRUPADORES: string[] = COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => c.encabezado);

/** Una fila en el orden del encabezado a partir de un objeto por clave (lo que falta queda vacío). */
export function filaDeAgrupador(valores: Partial<Record<ClaveColumnaAgrupador, string | number | null | undefined>>): string[] {
  return COLUMNAS_IMPORTAR_AGRUPADORES.map((c) => {
    const v = valores[c.clave];
    return v === null || v === undefined ? "" : String(v);
  });
}

/**
 * Una fila de ejemplo de cada tipo, encadenadas: el embarque apunta al viaje del ejemplo y el paquete al embarque (solo por código).
 * Los correos son de ejemplo: el real es el de un comprador o admin activos.
 */
export const FILAS_EJEMPLO_AGRUPADORES: string[][] = [
  filaDeAgrupador({ tipo: "VIAJE", codigo: "261101", nombre: "Feria Sur · nov-2026", destino: "Ciudad Sur", fecha_inicio: "2026-11-03", fecha_fin: "2026-11-10", responsable: "comprador@ejemplo.com", nota: "Viaje de ejemplo" }),
  filaDeAgrupador({
    tipo: "EMBARQUE",
    codigo: "261201",
    nombre: "Dic-26 · Feria Sur",
    viaje: "261101",
    tipo_embarque: "IMPORTACION",
    fecha_salida: "2026-11-20",
    fecha_llegada: "2026-12-15",
    puerto: "Puerto Sur",
    referencia_logistica: "BL-0001",
    responsable: "",
  }),
  filaDeAgrupador({ tipo: "PAQUETE", codigo: "261201", nombre: "Paquete denim", embarque: "261201", responsable: "comprador@ejemplo.com" }),
];

export type PlantillaAgrupadores = { encabezados: string[]; filas: string[][]; hoja: Hoja };

/** La plantilla lista para descargar: encabezado y una fila de ejemplo de cada tipo (VIAJE, EMBARQUE y PAQUETE). */
export function plantillaAgrupadores(): PlantillaAgrupadores {
  return { encabezados: ENCABEZADOS_AGRUPADORES, filas: FILAS_EJEMPLO_AGRUPADORES, hoja: [ENCABEZADOS_AGRUPADORES, ...FILAS_EJEMPLO_AGRUPADORES] };
}
