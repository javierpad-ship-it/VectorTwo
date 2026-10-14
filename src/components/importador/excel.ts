/**
 * Genera un libro Excel (.xlsx) de una sola hoja en el navegador y lo
 * descarga. SheetJS se carga bajo demanda (`import()`) para no pesar en la
 * carga inicial. La edición comunitaria de SheetJS no escribe estilos, así
 * que el encabezado no sale en negrita; se compensa con anchos de columna
 * ajustados al contenido.
 */

const ANCHO_MINIMO = 10;
const ANCHO_MAXIMO = 60;

/** Ancho (en caracteres) de cada columna según el texto más largo, con tope. Puro, probable sin navegador. */
export function anchosColumnas(fields: string[], data: (string | number)[][]): { wch: number }[] {
  return fields.map((campo, i) => {
    let max = campo.length;
    for (const fila of data) max = Math.max(max, String(fila[i] ?? "").length);
    return { wch: Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, max + 2)) };
  });
}

/**
 * La hoja tal como se escribe: encabezado + filas como celdas, con anchos
 * ajustados. Pura (recibe el módulo SheetJS), probable sin navegador. Los
 * textos van siempre como celdas de texto (`t: "s"`): `aoa_to_sheet` no
 * interpreta `=…`, `+…`, `-…` ni `@…` como fórmula, así que un nombre
 * malicioso no se ejecuta al abrir el Excel.
 */
export function construirHoja(XLSX: Pick<typeof import("xlsx"), "utils">, fields: string[], data: (string | number)[][]) {
  const hoja = XLSX.utils.aoa_to_sheet([fields, ...data]);
  hoja["!cols"] = anchosColumnas(fields, data);
  return hoja;
}

export async function descargarExcel(fields: string[], data: (string | number)[][], nombreHoja: string, nombreArchivo: string): Promise<void> {
  const XLSX = await import("xlsx");
  const hoja = construirHoja(XLSX, fields, data);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  // `writeFile` dispara la descarga en el navegador; se escribe a bytes para
  // controlar el nombre y no depender de rutas de Node.
  const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}
