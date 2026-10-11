import Papa from "papaparse";
import type { CellObject, WorkSheet } from "xlsx";
import { esExcel, fechasExcelAIso } from "@/lib/arbol/leer-archivo";
import { archivoPosiblementeTruncado } from "./cargas";
import { CAMPOS_VENTA, FILAS_EXCEL_MAX, type CampoVenta, type FilaCruda } from "./tipos";

/**
 * Lectura del archivo en el navegador SIN cargarlo entero en memoria
 * (docs/modulos/05-venta-stock.md, "Lectura del archivo en el navegador").
 * El archivo nunca se sube al servidor: se lee por bloques y cada bloque se
 * entrega ya partido en celdas; las filas crudas no se conservan.
 *
 * - CSV: el archivo se corta en trozos de ~2 MB (`Blob.slice`), se decodifica
 *   en streaming (`TextDecoder` con `stream: true`, así un carácter de varios
 *   bytes partido entre trozos no se rompe) y cada trozo se parte en filas con
 *   papaparse. Una fila partida entre dos trozos (incluida una con saltos de
 *   línea entre comillas) se arrastra al siguiente. Entre trozos se cede el
 *   hilo para que la barra de avance se mueva.
 * - Excel (`.xls` y `.xlsx`, secundario): SheetJS carga el libro entero; se
 *   entrega la hoja en bloques y con los valores NUMÉRICOS CRUDOS (precisión
 *   completa: `205.70999999999998`, `2026` aunque el formato diga `2,026`).
 *
 * Las filas se entregan como arreglos de celdas (no objetos): el mapeo a los
 * 14 campos lo hace `crearProyector`.
 */

export type Codificacion = "utf-8" | "windows-1252";
export type Separador = "," | ";" | "\t" | "|";

export const SEPARADORES: readonly Separador[] = [",", ";", "\t", "|"];
export const BYTES_BLOQUE = 2 * 1024 * 1024;
const FILAS_BLOQUE_EXCEL = 20_000;
const BYTES_MUESTRA = 64 * 1024;

export type Deteccion = {
  codificacion: Codificacion;
  /** El archivo empieza con la marca BOM de UTF-8. */
  conBom: boolean;
  /** Texto para mostrar: "UTF-8 con BOM", "UTF-8", "Windows-1252". */
  etiqueta: string;
};

/**
 * Pre-escaneo con `TextDecoder("utf-8", { fatal: true })` en trozos: si falla,
 * el archivo se lee como Windows-1252. Una `Ñ` mal decodificada (`NIÃ‘AS`)
 * rompería la coincidencia con tiendas y géneros, por eso se comprueba ANTES de
 * leer.
 */
export async function detectarCodificacion(archivo: Blob): Promise<Deteccion> {
  const cabeza = new Uint8Array(await archivo.slice(0, 3).arrayBuffer());
  const conBom = cabeza.length === 3 && cabeza[0] === 0xef && cabeza[1] === 0xbb && cabeza[2] === 0xbf;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (let i = 0; i < archivo.size; i += BYTES_BLOQUE) {
      decoder.decode(await archivo.slice(i, i + BYTES_BLOQUE).arrayBuffer(), { stream: true });
    }
    decoder.decode();
    return { codificacion: "utf-8", conBom, etiqueta: conBom ? "UTF-8 con BOM" : "UTF-8" };
  } catch {
    return { codificacion: "windows-1252", conBom: false, etiqueta: "Windows-1252" };
  }
}

/** Separador más probable de una muestra de texto (papaparse entre coma, punto y coma, tabulador y barra). */
export function detectarSeparador(muestra: string): Separador {
  const r = Papa.parse<string[]>(muestra, { preview: 10, delimitersToGuess: [...SEPARADORES], skipEmptyLines: true });
  const d = r.meta.delimiter;
  return (SEPARADORES as readonly string[]).includes(d) ? (d as Separador) : ",";
}

export const ETIQUETA_SEPARADOR: Record<Separador, string> = { ",": "coma", ";": "punto y coma", "\t": "tabulador", "|": "barra vertical" };

export type Progreso = {
  /** 0 a 1. */
  fraccion: number;
  bytesLeidos: number;
  bytesTotales: number;
  /** Filas de datos entregadas hasta ahora. */
  filas: number;
};

export type BloqueFilas = {
  /** Cabecera (recortada), igual en todos los bloques. */
  columnas: string[];
  /** Celdas de cada fila de datos (sin la cabecera ni las filas vacías). */
  filas: string[][];
  /** Número de la primera fila de este bloque (1 = primera fila de datos). */
  primeraFila: number;
};

export type OpcionesLectura = {
  separador?: Separador;
  codificacion?: Codificacion;
  /** Hoja a leer (solo Excel); por defecto la primera. */
  hoja?: string;
  /** Bytes por trozo del CSV (por defecto 2 MB). */
  bytesBloque?: number;
  /** Tope de texto pendiente sin cerrar una fila (por defecto 16 MB): una comilla suelta no hace crecer la memoria sin límite. */
  maxFila?: number;
  alBloque: (bloque: BloqueFilas) => void | Promise<void>;
  alProgreso?: (p: Progreso) => void;
  signal?: AbortSignal;
};

export type ResultadoLectura = {
  columnas: string[];
  /** Filas de datos entregadas. */
  filas: number;
  separador: Separador | null;
  codificacion: Codificacion | null;
  hoja: string | null;
  hojas: string[];
  /** Solo Excel: filas de la hoja, cabecera incluida (para `archivo_posiblemente_truncado`). */
  filasHoja: number | null;
  /** Una hoja `.xls` de exactamente 65 536 filas está posiblemente truncada. */
  posiblementeTruncado: boolean;
  cancelado: boolean;
};

const cederHilo = () => new Promise<void>((resolver) => setTimeout(resolver, 0));

const filaVacia = (celdas: string[]) => celdas.every((c) => c.trim() === "");

/** Cabecera sin BOM ni espacios en los bordes. */
const limpiarCabecera = (celdas: string[]) => celdas.map((c) => c.replace(/^﻿/, "").trim());

// ─── Cabecera y muestra (pasos 1 y 2 de la pantalla) ───

export type Cabecera = {
  columnas: string[];
  /** Las primeras filas de datos, para mostrar una muestra. */
  muestra: string[][];
  separador: Separador | null;
  codificacion: Codificacion | null;
  hojas: string[];
  hoja: string | null;
  /** Solo Excel. */
  filasHoja: number | null;
};

/**
 * Lee solo la cabecera y las primeras filas (~64 KB en CSV) para autodetectar
 * el mapeo antes de leer todo el archivo.
 */
export async function leerCabecera(
  archivo: File,
  opciones: { separador?: Separador; codificacion?: Codificacion; hoja?: string; filasMuestra?: number } = {}
): Promise<Cabecera> {
  const filasMuestra = opciones.filasMuestra ?? 5;
  if (esExcel(archivo.name)) {
    const libro = await abrirLibro(archivo, opciones.hoja);
    const filas = filasDeHoja(libro.utils, libro.hoja, 0, filasMuestra + 1);
    const idx = filas.findIndex((f) => !filaVacia(f));
    return {
      columnas: idx >= 0 ? limpiarCabecera(filas[idx]) : [],
      muestra: idx >= 0 ? filas.slice(idx + 1).filter((f) => !filaVacia(f)) : [],
      separador: null,
      codificacion: null,
      hojas: libro.hojas,
      hoja: libro.nombre,
      filasHoja: libro.filas,
    };
  }

  const codificacion = opciones.codificacion ?? (await detectarCodificacion(archivo)).codificacion;
  const bytes = await archivo.slice(0, BYTES_MUESTRA).arrayBuffer();
  const texto = new TextDecoder(codificacion).decode(bytes);
  // El último renglón puede venir cortado: se descarta salvo que sea el único.
  const corte = texto.lastIndexOf("\n");
  const entero = archivo.size > BYTES_MUESTRA && corte > 0 ? texto.slice(0, corte) : texto;
  const separador = opciones.separador ?? detectarSeparador(entero);
  const r = Papa.parse<string[]>(entero, { delimiter: separador, skipEmptyLines: "greedy", preview: filasMuestra + 1 });
  const filas = r.data;
  return {
    columnas: filas.length > 0 ? limpiarCabecera(filas[0]) : [],
    muestra: filas.slice(1),
    separador,
    codificacion,
    hojas: [],
    hoja: null,
    filasHoja: null,
  };
}

// ─── Lectura completa por bloques ───

/**
 * Lee todo el archivo y va entregando bloques de filas. Se puede cancelar con
 * `signal`. Los errores de lectura (Excel de más de 150 000 filas, archivo sin
 * cabecera) se lanzan como `Error` con un mensaje para pantalla.
 */
export async function leerPorBloques(archivo: File, opciones: OpcionesLectura): Promise<ResultadoLectura> {
  return esExcel(archivo.name) ? leerExcelPorBloques(archivo, opciones) : leerCsvPorBloques(archivo, opciones);
}

/**
 * Corta `texto` en el último salto de línea que no esté dentro de comillas.
 * Devuelve `[completo, resto]`. Una sola pasada (la paridad de comillas se lleva
 * incrementalmente): una comilla suelta no la vuelve cuadrática.
 */
export function cortarEnFilaCompleta(texto: string): [string, string] {
  let dentro = false;
  let corte = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c === 34) dentro = !dentro;
    else if (c === 10 && !dentro) corte = i;
  }
  return corte < 0 ? ["", texto] : [texto.slice(0, corte + 1), texto.slice(corte + 1)];
}

/** Tope del texto pendiente (una fila, o una comilla sin cerrar): 16 MB. */
export const MAX_BYTES_FILA = 16 * 1024 * 1024;

async function leerCsvPorBloques(archivo: File, o: OpcionesLectura): Promise<ResultadoLectura> {
  const codificacion = o.codificacion ?? (await detectarCodificacion(archivo)).codificacion;
  const decoder = new TextDecoder(codificacion);
  const bytesBloque = o.bytesBloque ?? BYTES_BLOQUE;
  let separador: Separador | null = o.separador ?? null;
  let columnas: string[] | null = null;
  let entregadas = 0;
  let pendiente = "";
  let cancelado = false;

  const procesar = async (texto: string, bytesLeidos: number) => {
    if (texto === "") return;
    if (!separador) separador = detectarSeparador(texto.slice(0, BYTES_MUESTRA));
    const r = Papa.parse<string[]>(texto, { delimiter: separador, skipEmptyLines: "greedy" });
    let filas = r.data;
    if (!columnas) {
      if (filas.length === 0) return;
      columnas = limpiarCabecera(filas[0]);
      filas = filas.slice(1);
    }
    filas = filas.filter((f) => !filaVacia(f));
    if (filas.length > 0) {
      await o.alBloque({ columnas, filas, primeraFila: entregadas + 1 });
      entregadas += filas.length;
    }
    o.alProgreso?.({
      fraccion: archivo.size === 0 ? 1 : Math.min(1, bytesLeidos / archivo.size),
      bytesLeidos,
      bytesTotales: archivo.size,
      filas: entregadas,
    });
  };

  for (let i = 0; i < archivo.size; i += bytesBloque) {
    if (o.signal?.aborted) {
      cancelado = true;
      break;
    }
    const fin = Math.min(archivo.size, i + bytesBloque);
    const texto = decoder.decode(await archivo.slice(i, fin).arrayBuffer(), { stream: true });
    const [completo, resto] = cortarEnFilaCompleta(pendiente + texto);
    pendiente = resto;
    if (pendiente.length > (o.maxFila ?? MAX_BYTES_FILA)) {
      throw new Error(
        "Hay una fila muy larga o una comilla («\"») sin cerrar: el archivo no se puede leer. Revisa la fila donde empieza la comilla suelta."
      );
    }
    await procesar(completo, fin - resto.length);
    await cederHilo();
  }
  if (!cancelado) {
    pendiente += decoder.decode();
    await procesar(pendiente, archivo.size);
    if (!columnas) throw new Error("El archivo está vacío o no tiene cabecera.");
  }

  return {
    columnas: columnas ?? [],
    filas: entregadas,
    separador,
    codificacion,
    hoja: null,
    hojas: [],
    filasHoja: null,
    posiblementeTruncado: false,
    cancelado,
  };
}

// ─── Excel ───

type LibroAbierto = { hoja: WorkSheet; nombre: string | null; hojas: string[]; filas: number };

/**
 * Reemplaza el texto visible `w` de las celdas numéricas que no son fechas por
 * `String(celda.v)` (precisión completa): así `AÑO` con formato `#,##0` no sale
 * como `2,026` y los decimales ocultos de venta y costo no se pierden. Misma
 * técnica que `fechasExcelAIso`.
 */
export function numerosCrudosExcel(hoja: WorkSheet): void {
  for (const ref of Object.keys(hoja)) {
    if (ref.startsWith("!")) continue;
    const celda = hoja[ref] as CellObject;
    if (celda.t === "n" && typeof celda.v === "number" && !(typeof celda.w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(celda.w))) {
      celda.w = String(celda.v);
    }
  }
}

function rangoDeHoja(hoja: WorkSheet): { filas: number; columnas: number } {
  const ref = hoja["!ref"];
  if (!ref) return { filas: 0, columnas: 0 };
  // Una hoja de una sola celda tiene `!ref` = "A1" (sin los dos puntos).
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!m) return { filas: 0, columnas: 0 };
  const col = (s: string) => s.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const col2 = m[3] ?? m[1];
  const fila2 = m[4] ?? m[2];
  return { filas: Number(fila2) - Number(m[2]) + 1, columnas: col(col2) - col(m[1]) + 1 };
}

async function abrirLibro(archivo: File, hoja?: string): Promise<LibroAbierto & { utils: typeof import("xlsx").utils }> {
  const XLSX = await import("xlsx");
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellNF: true });
  const hojas = libro.SheetNames;
  const nombre = hoja && hojas.includes(hoja) ? hoja : (hojas[0] ?? null);
  if (!nombre) return { hoja: {}, nombre: null, hojas, filas: 0, utils: XLSX.utils };
  const h = libro.Sheets[nombre];
  fechasExcelAIso(h);
  numerosCrudosExcel(h);
  return { hoja: h, nombre, hojas, filas: rangoDeHoja(h).filas, utils: XLSX.utils };
}

/** Filas `[desde, hasta)` (0 = primera fila de la hoja) como texto. */
function filasDeHoja(utils: typeof import("xlsx").utils, hoja: WorkSheet, desde: number, hasta: number): string[][] {
  const { filas, columnas } = rangoDeHoja(hoja);
  if (filas === 0) return [];
  const ref = hoja["!ref"] as string;
  const inicio = utils.decode_range(ref);
  const r0 = inicio.s.r + desde;
  const r1 = Math.min(inicio.e.r, inicio.s.r + hasta - 1);
  if (r0 > r1) return [];
  const matriz = utils.sheet_to_json<unknown[]>(hoja, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
    range: { s: { r: r0, c: inicio.s.c }, e: { r: r1, c: inicio.s.c + columnas - 1 } },
  });
  return matriz.map((f) => f.map((c) => String(c ?? "").trim()));
}

async function leerExcelPorBloques(archivo: File, o: OpcionesLectura): Promise<ResultadoLectura> {
  const libro = await abrirLibro(archivo, o.hoja);
  if (libro.filas > FILAS_EXCEL_MAX) {
    throw new Error(`Esa hoja tiene ${libro.filas} filas y un Excel admite hasta ${FILAS_EXCEL_MAX}: usa CSV.`);
  }
  const truncado = archivoPosiblementeTruncado(archivo.name, libro.filas);

  let columnas: string[] | null = null;
  let entregadas = 0;
  let cancelado = false;
  for (let desde = 0; desde < libro.filas; desde += FILAS_BLOQUE_EXCEL) {
    if (o.signal?.aborted) {
      cancelado = true;
      break;
    }
    let filas = filasDeHoja(libro.utils, libro.hoja, desde, desde + FILAS_BLOQUE_EXCEL);
    if (!columnas) {
      const idx = filas.findIndex((f) => !filaVacia(f));
      if (idx < 0) continue;
      columnas = limpiarCabecera(filas[idx]);
      filas = filas.slice(idx + 1);
    }
    filas = filas.filter((f) => !filaVacia(f));
    if (filas.length > 0) {
      await o.alBloque({ columnas, filas, primeraFila: entregadas + 1 });
      entregadas += filas.length;
    }
    o.alProgreso?.({
      fraccion: Math.min(1, (desde + FILAS_BLOQUE_EXCEL) / Math.max(1, libro.filas)),
      bytesLeidos: Math.min(archivo.size, Math.round((archivo.size * (desde + FILAS_BLOQUE_EXCEL)) / Math.max(1, libro.filas))),
      bytesTotales: archivo.size,
      filas: entregadas,
    });
    await cederHilo();
  }
  if (!cancelado && !columnas) throw new Error("La hoja está vacía o no tiene cabecera.");

  return {
    columnas: columnas ?? [],
    filas: entregadas,
    separador: null,
    codificacion: null,
    hoja: libro.nombre,
    hojas: libro.hojas,
    filasHoja: libro.filas,
    posiblementeTruncado: truncado,
    cancelado,
  };
}

// ─── Proyección a los 14 campos ───

/**
 * Convierte las celdas de una fila en una `FilaCruda` según el mapeo (campo →
 * nombre de columna; `""` si no está mapeado). Por índice: no busca por nombre
 * en cada fila.
 */
export function crearProyector(columnas: readonly string[], mapeo: Readonly<Record<CampoVenta, string>>): (celdas: readonly string[]) => FilaCruda {
  const indices = CAMPOS_VENTA.map((campo) => (mapeo[campo] === "" ? -1 : columnas.indexOf(mapeo[campo])));
  return (celdas) => {
    const fila = {} as FilaCruda;
    for (let i = 0; i < CAMPOS_VENTA.length; i++) {
      const ix = indices[i];
      fila[CAMPOS_VENTA[i]] = ix >= 0 ? (celdas[ix] ?? "") : "";
    }
    return fila;
  };
}
