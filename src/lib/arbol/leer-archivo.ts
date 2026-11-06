import Papa from "papaparse";
import type { CellObject, WorkBook, WorkSheet } from "xlsx";

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

/** Un Excel de más bytes que esto no se parsea (SheetJS lo carga entero en memoria); se pide CSV. */
export const BYTES_EXCEL_MAX = 50 * 1024 * 1024;

export const MENSAJE_EXCEL_PESADO = "Ese Excel pesa demasiado: guárdalo como CSV";

/**
 * Opciones de lectura de SheetJS: solo lo que usa la app. No hacen falta fórmulas, HTML, estilos ni macros.
 * `cellNF` se conserva: `fechasExcelAIso` y `numerosCrudosExcel` dependen del formato de número (`z`/`w`).
 */
export const OPCIONES_LECTURA_EXCEL = {
  type: "array",
  cellNF: true,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  bookVBA: false,
} as const;

/** Rechaza un Excel demasiado grande ANTES de leerlo a memoria y parsearlo. */
export function exigirExcelLiviano(archivo: { size: number }): void {
  if (archivo.size > BYTES_EXCEL_MAX) throw new Error(MENSAJE_EXCEL_PESADO);
}

/** Quita la extensión .csv/.xlsx/.xls para armar nombres derivados. */
export function nombreBase(nombre: string): string {
  return nombre.replace(/\.(csv|xlsx|xlsm|xls)$/i, "");
}

/** Días entre el origen de Excel (1899-12-30) y el de Unix, para convertir series de fecha. */
const ORIGEN_EXCEL_MS = Date.UTC(1899, 11, 30);
const MS_POR_DIA = 86_400_000;

/**
 * ¿El formato numérico de la celda es de fecha? Se ignoran los textos entre
 * comillas, los bloques `[...]` (colores, moneda, configuración regional) y
 * los caracteres escapados, y se busca día o año: `m/d/yy`, `dd/mm/yyyy`,
 * `[$-F800]dddd, mmmm dd, yyyy`. Solo horas (`h:mm`) no cuenta.
 */
export function esFormatoFecha(formato: string): boolean {
  const limpio = formato.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[yd]/i.test(limpio);
}

/** Serie de fecha de Excel a `aaaa-mm-dd`, sin pasar por la zona horaria del navegador. */
export function serieAFechaIso(serie: number): string | null {
  if (!Number.isFinite(serie) || serie < 1 || serie > 2_958_465) return null;
  const d = new Date(ORIGEN_EXCEL_MS + Math.floor(serie) * MS_POR_DIA);
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
}

/** ¿El formato numérico de la celda lleva hora (`h`, `hh:mm`)? Se ignoran textos entre comillas, bloques `[...]` y escapados. */
export function esFormatoConHora(formato: string): boolean {
  const limpio = formato.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /h/i.test(limpio);
}

/** Serie de fecha y hora de Excel a `aaaa-mm-dd hh:mm` (hora de pared, sin zona), redondeando al minuto. */
export function serieAFechaHoraIso(serie: number): string | null {
  if (!Number.isFinite(serie) || serie < 1 || serie > 2_958_465) return null;
  const minutos = Math.round(serie * 1440);
  const fecha = serieAFechaIso(Math.floor(minutos / 1440));
  if (fecha === null) return null;
  const resto = minutos % 1440;
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${fecha} ${dos(Math.floor(resto / 60))}:${dos(resto % 60)}`;
}

/** `conHora`: las celdas de fecha y hora salen como `aaaa-mm-dd hh:mm` (el importador de agrupadores, INICIO_OPERATIVO). Por defecto, solo la fecha. */
export type OpcionesLecturaFechas = { conHora?: boolean };

/**
 * Las celdas de fecha de Excel se leen como texto con el formato del libro,
 * que en SheetJS es mes primero (`3/15/19`). El importador lee las fechas con
 * el día primero, así que ese texto se rechazaba (mes 15) o, peor, se leía
 * mal (`3/5/19` es 5 de marzo y saldría 3 de mayo). Se reemplaza por
 * `aaaa-mm-dd`, que no admite dos lecturas. Requiere leer el libro con
 * `cellNF: true` para conservar el formato (`z`) de cada celda.
 */
export function fechasExcelAIso(hoja: WorkSheet, opciones: OpcionesLecturaFechas = {}): void {
  for (const ref of Object.keys(hoja)) {
    if (ref.startsWith("!")) continue;
    const celda = hoja[ref] as CellObject;
    if (celda.t === "d" && celda.v instanceof Date) {
      celda.w = celda.v.toISOString().slice(0, 10);
    } else if (celda.t === "n" && typeof celda.v === "number" && typeof celda.z === "string" && esFormatoFecha(celda.z)) {
      // Con `conHora`, una celda de fecha y hora conserva la hora (`aaaa-mm-dd hh:mm`); sin ella, o con hora 00:00, solo la fecha.
      const conHora = opciones.conHora === true && esFormatoConHora(celda.z) && celda.v % 1 !== 0 ? serieAFechaHoraIso(celda.v) : null;
      const iso = conHora && !conHora.endsWith(" 00:00") ? conHora : serieAFechaIso(celda.v);
      if (iso) celda.w = iso;
    }
  }
}

/**
 * Convierte una hoja en filas con cabecera. Pura (recibe la hoja ya leída),
 * para poder probarla sin navegador.
 *
 * - La primera fila con algún valor es la cabecera; sus celdas se recortan.
 * - Columnas sin nombre se descartan (Excel las trae como `__EMPTY`).
 * - Filas completamente vacías se descartan.
 * - Todo se devuelve como texto (`raw: false`), igual que un CSV.
 * - Las celdas con formato de fecha salen como `aaaa-mm-dd` (ver `fechasExcelAIso`).
 */
export function hojaATabla(utils: typeof import("xlsx").utils, hoja: WorkSheet, opciones: OpcionesLecturaFechas = {}): Pick<TablaLeida, "columnas" | "filas"> {
  fechasExcelAIso(hoja, opciones);
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
export function libroATabla(utils: typeof import("xlsx").utils, libro: WorkBook, hoja?: string, opciones: OpcionesLecturaFechas = {}): TablaLeida {
  const hojas = libro.SheetNames;
  const elegida = hoja && hojas.includes(hoja) ? hoja : hojas[0];
  if (!elegida) return { columnas: [], filas: [], hojas, hoja: null };
  return { ...hojaATabla(utils, libro.Sheets[elegida], opciones), hojas, hoja: elegida };
}

/**
 * Lee el archivo en el navegador. La librería de Excel se carga bajo demanda
 * para no pesar en el resto de la aplicación.
 */
export async function leerArchivoTabular(archivo: File, hoja?: string, opciones: OpcionesLecturaFechas = {}): Promise<TablaLeida> {
  if (esExcel(archivo.name)) {
    exigirExcelLiviano(archivo);
    const XLSX = await import("xlsx");
    const datos = await archivo.arrayBuffer();
    const libro = XLSX.read(datos, OPCIONES_LECTURA_EXCEL);
    return libroATabla(XLSX.utils, libro, hoja, opciones);
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
