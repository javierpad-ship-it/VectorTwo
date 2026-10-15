import { anchosColumnas } from "@/components/importador/excel";
import type { Hoja } from "@/lib/proyeccion/excel";

/**
 * Descarga un libro de Excel con varias hojas, generado en el navegador (ficha 07, pasos 5 y 5b). SheetJS se carga
 * bajo demanda con `import()` (como el reporte M11, `components/importador/excel.ts`): no pesa en la carga inicial y
 * nunca llama a una ruta nueva. Las hojas ya vienen armadas por `hojasMatriz` / `hojasMensual` con exactamente las filas
 * visibles; aquí solo se convierten. La edición comunitaria de SheetJS no escribe estilos: se compensa con anchos.
 * `aoa_to_sheet` escribe los textos como celdas de texto, así que un nombre que empiece por `=` no se ejecuta.
 */

/** Nombre de hoja válido para Excel: sin `\ / ? * [ ] :` y de 31 caracteres como máximo. */
export function nombreHojaValido(nombre: string): string {
  return nombre.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "HOJA";
}

/** La hoja tal como se escribe: celdas y anchos ajustados (la primera fila es la cabecera). Pura. */
export function construirHojaLibro(XLSX: Pick<typeof import("xlsx"), "utils">, filas: Hoja) {
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  const cabecera = (filas[0] ?? []).map((c) => String(c ?? ""));
  hoja["!cols"] = anchosColumnas(
    cabecera,
    filas.slice(1).map((f) => f.map((c) => (c === null ? "" : c)))
  );
  return hoja;
}

export async function descargarLibro(hojas: Record<string, Hoja>, nombreArchivo: string): Promise<void> {
  const XLSX = await import("xlsx");
  const libro = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(libro, construirHojaLibro(XLSX, filas), nombreHojaValido(nombre));
  const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}
