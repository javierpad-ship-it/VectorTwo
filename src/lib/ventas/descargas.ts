import type { CombinacionDesconocida } from "./informe";
import { ETIQUETAS_MOTIVO, type Exclusion, type InformeCarga } from "./tipos";

/**
 * Contenido de las descargas del reporte previo (ficha, "Descargas"), como
 * `{ campos, datos }` para `descargarCsv` de `src/components/importador/csv.ts`
 * (que agrega el BOM). Funciones puras.
 */

export type TablaCsv = { campos: string[]; datos: (string | number)[][] };

function fila(e: Exclusion, periodo: string): (string | number)[] {
  return [
    periodo,
    ETIQUETAS_MOTIVO[e.motivo],
    e.tipo === "error" ? "ERROR" : "DECISION",
    e.valor,
    e.filas,
    e.primera_fila,
    e.venta_soles,
    e.costo_vendido,
    e.unidades,
    e.stock_unidades,
    e.stock_valorizado,
  ];
}

/**
 * "Descargar omitidas (CSV)": una fila por valor o combinación con su motivo,
 * las filas, la primera fila y los pesos, de todos los meses (más las filas sin
 * mes).
 */
export function tablaOmitidas(informe: InformeCarga): TablaCsv {
  const datos: (string | number)[][] = [];
  for (const m of informe.meses) for (const e of m.exclusiones) datos.push(fila(e, m.periodo));
  for (const e of informe.sin_mes.exclusiones) datos.push(fila(e, "(sin mes)"));
  return {
    campos: ["PERIODO", "MOTIVO", "TIPO", "VALOR", "FILAS", "PRIMERA_FILA", "VENTA", "COSTO", "UNIDADES", "STOCK_UNIDADES", "STOCK_VALORIZADO"],
    datos,
  };
}

/**
 * "Descargar combinaciones desconocidas (formato árbol)": `GENERO, MUNDO,
 * LINEA, EQUIVALENCIA` (la equivalencia tal como vino: vacío sigue vacío y `-`
 * sigue `-`, para que el importador del árbol de M1 la procese con sus reglas)
 * más `FILAS`, `VENTA`, `STOCK_VALORIZADO` y `MOTIVO`, columnas que el
 * importador del árbol ignora.
 */
export function tablaCombinacionesDesconocidas(combinaciones: readonly CombinacionDesconocida[]): TablaCsv {
  return {
    campos: ["GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "FILAS", "VENTA", "STOCK_VALORIZADO", "MOTIVO"],
    datos: combinaciones.map((c) => [c.genero, c.mundo, c.linea, c.equivalencia, c.filas, c.venta_soles, c.stock_valorizado, c.motivo]),
  };
}
