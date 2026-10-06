import Papa from "papaparse";

/**
 * Genera un CSV en el navegador y lo descarga. Lleva BOM para que Excel
 * respete los acentos al abrirlo con doble clic.
 */
export function descargarCsv(fields: string[], data: (string | number)[][], nombreArchivo: string) {
  const csv = Papa.unparse({ fields, data });
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}
