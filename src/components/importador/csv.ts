import Papa from "papaparse";

/**
 * Celdas que Excel o LibreOffice interpretarían como fórmula: empiezan por
 * `=`, `+`, `-`, `@`, tabulador o retorno. Es el patrón de `escapeFormulae: true`
 * de Papa Parse con dos excepciones inofensivas para no estropear datos
 * legítimos: un número con signo (`-5`, `+3,2`) y el guion solo (`-`, que es un
 * valor real de las columnas de equivalencia).
 */
const CELDA_DE_FORMULA = /^(?![+-]?\d+(?:[.,]\d+)?$)(?!-$)[=+\-@\t\r]/;

/**
 * CSV como texto. `escapeFormulae` antepone un apóstrofo a las celdas que
 * parecen fórmula: sin eso, un nombre del archivo cargado (`=HYPERLINK(...)`)
 * se ejecutaría al abrir el CSV descargado en Excel.
 */
export function generarCsv(fields: string[], data: (string | number)[][]): string {
  return Papa.unparse({ fields, data }, { escapeFormulae: CELDA_DE_FORMULA });
}

/**
 * Genera un CSV en el navegador y lo descarga. Lleva BOM para que Excel
 * respete los acentos al abrirlo con doble clic.
 */
export function descargarCsv(fields: string[], data: (string | number)[][], nombreArchivo: string) {
  const csv = generarCsv(fields, data);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}
