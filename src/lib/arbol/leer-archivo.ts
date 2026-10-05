import Papa from "papaparse";
import type { WorkBook, WorkSheet } from "xlsx";

/**
 * Lectura en el navegador de archivos tabulares para el importador: CSV con
 * cabecera, o libros Excel (.xlsx y .xls) donde la primera fila es la
 * cabecera. Devuelve siempre la misma forma, así el resto del importador no
 * distingue de dónde vino.
 */
export type TablaLeida = {
  columnas: string[];
  filas: Record<string, string>[];
  /** Nombres de las hojas del libro (solo Excel); vacío para CSV. */
  hojas: string[];
  /** Hoja que se leyó (solo Excel). */
  hoja: string | null;
};

const EXTENSIONES_EXCEL = /\.(xlsx|xlsm|xls)$/i;

export function esExcel(nombre: string): boolean {
  return EXTENSIONES_EXCEL.test(nombre);
}

/** Quita la extensión .csv/.xlsx/.xls para armar nombres derivados. */
export function nombreBase(nombre: string): string {
  return nombre.replace(/\.(csv|xlsx|xlsm|xls)$/i, "");
}

/**
 * Convierte una hoja en filas con cabecera. Pura (recibe la hoja ya leída),
 * para poder probarla sin navegador.
 *
 * - La primera fila con algún valor es la cabecera; sus celdas se recortan.
 * - Columnas sin nombre se descartan (Excel las trae como `__EMPTY`).
 * - Filas completamente vacías se descartan.
 * - Todo se devuelve como texto (`raw: false`), igual que un CSV.
 */
export function hojaATabla(utils: typeof import("xlsx").utils, hoja: WorkSheet): Pick<TablaLeida, "columnas" | "filas"> {
  const matriz = utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: false, defval: "" });
  const indiceCabecera = matriz.findIndex((fila) => fila.some((c) => String(c ?? "").trim() !== ""));
  if (indiceCabecera < 0) return { columnas: [], filas: [] };

  const cabecera = matriz[indiceCabecera].map((c) => String(c ?? "").trim());
  const columnas = cabecera.filter((c) => c !== "");

  const filas: Record<string, string>[] = [];
  for (const fila of matriz.slice(indiceCabecera + 1)) {
    const obj: Record<string, string> = {};
    let vacia = true;
    cabecera.forEach((nombre, i) => {
      if (nombre === "") return;
      const valor = String(fila[i] ?? "").trim();
      if (valor !== "") vacia = false;
      obj[nombre] = valor;
    });
    if (!vacia) filas.push(obj);
  }
  return { columnas, filas };
}

/** Lee un libro ya cargado y devuelve la tabla de la hoja pedida (o la primera). */
export function libroATabla(utils: typeof import("xlsx").utils, libro: WorkBook, hoja?: string): TablaLeida {
  const hojas = libro.SheetNames;
  const elegida = hoja && hojas.includes(hoja) ? hoja : hojas[0];
  if (!elegida) return { columnas: [], filas: [], hojas, hoja: null };
  return { ...hojaATabla(utils, libro.Sheets[elegida]), hojas, hoja: elegida };
}

/**
 * Lee el archivo en el navegador. La librería de Excel se carga bajo demanda
 * para no pesar en el resto de la aplicación.
 */
export async function leerArchivoTabular(archivo: File, hoja?: string): Promise<TablaLeida> {
  if (esExcel(archivo.name)) {
    const XLSX = await import("xlsx");
    const datos = await archivo.arrayBuffer();
    const libro = XLSX.read(datos, { type: "array" });
    return libroATabla(XLSX.utils, libro, hoja);
  }

  return new Promise((resolver, rechazar) => {
    Papa.parse<Record<string, string>>(archivo, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (r) => {
        const columnas = (r.meta.fields ?? []).filter((c) => c !== "");
        resolver({ columnas, filas: r.data, hojas: [], hoja: null });
      },
      error: (err) => rechazar(err),
    });
  });
}
