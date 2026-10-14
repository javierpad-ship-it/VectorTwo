/**
 * Columnas y filas del reporte de agrupación GMLE (M11), una sola definición
 * para la tabla de pantalla y para la descarga: la `DataTable` se arma con
 * estas mismas columnas (misma `clave`, mismo orden), así que lo que baja en
 * CSV o Excel es literalmente lo que se ve, filtrado y en el orden visible.
 * Las funciones de columnas y filas son puras; solo `descargar…` toca el
 * navegador (y reutiliza el escape de fórmulas de `generarCsv`).
 */
import { descargarCsv } from "@/components/importador/csv";
import { descargarExcel } from "@/components/importador/excel";
import { ETIQUETA_TEMPORADA } from "@/lib/curvas/tipos-api";
import type { AgrupacionGmle, AgrupacionNodoGmle, LineaPartidaGmle, UnidadGmle } from "./tipos-api";
import { textoLineaPartida, type FilaDetalleGmle, type FilaNodoMixtoGmle, type FilaResumenGmle } from "./filtros";

export type ColumnaGmle<T> = {
  clave: string;
  /** Encabezado de la tabla y del archivo. */
  titulo: string;
  /** Valor de la celda en la descarga y criterio de orden en pantalla. */
  valor: (fila: T) => string | number;
};

export type Celda = string | number;

const siNo = (v: boolean) => (v ? "Sí" : "No");

const ETIQUETA_UNIDAD: Record<UnidadGmle, string> = { nodo: "Nodo", equivalencia: "Equivalencia", ninguna: "—" };

/** `Única / Mixta / Sin`; en los nodos GMLE (`null`) un guion largo. */
export const ETIQUETA_AGRUPACION_NODO: Record<AgrupacionNodoGmle, string> = { unica: "Única", mixta: "Mixta", sin: "Sin" };

const textoAgrupacionNodo = (v: AgrupacionNodoGmle | null) => (v === null ? "—" : ETIQUETA_AGRUPACION_NODO[v]);

/** Códigos de anomalía separados por `; ` (como salen en el CSV). */
export const textoAnomalias = (codigos: readonly string[]) => codigos.join("; ");

const textoGeneros = (generos: readonly string[]) => generos.join("; ");

// ─── Resumen ───

export const COLUMNAS_RESUMEN: ColumnaGmle<FilaResumenGmle>[] = [
  { clave: "agrupacion", titulo: "AGRUPACION", valor: (f) => (f.activo ? f.nombre : `${f.nombre} (inactiva)`) },
  { clave: "temporada", titulo: "TEMPORADA", valor: (f) => (f.temporada ? ETIQUETA_TEMPORADA[f.temporada] : "") },
  { clave: "generos", titulo: "GENEROS", valor: (f) => (f.id === null ? "" : f.generos.length === 0 ? "Sin género" : textoGeneros(f.generos)) },
  { clave: "nodos_gml", titulo: "NODOS_GML", valor: (f) => f.nodos_gml },
  { clave: "gml_mixtos", titulo: "GML_MIXTOS", valor: (f) => f.nodos_gml_mixtos },
  { clave: "unidades_gmle", titulo: "UNIDADES_GMLE", valor: (f) => f.unidades_gmle },
  { clave: "equivalencias", titulo: "EQUIVALENCIAS", valor: (f) => f.equivalencias },
  { clave: "genericas", titulo: "GENERICAS", valor: (f) => f.genericas },
  { clave: "lineas", titulo: "LINEAS", valor: (f) => f.lineas },
  { clave: "anomalias", titulo: "ANOMALIAS", valor: (f) => textoAnomalias(f.anomalias) },
];

// ─── Detalle (una fila por equivalencia) ───

export const COLUMNAS_DETALLE: ColumnaGmle<FilaDetalleGmle>[] = [
  { clave: "agrupacion", titulo: "AGRUPACION", valor: (f) => f.agrupacion },
  { clave: "temporada", titulo: "TEMPORADA", valor: (f) => (f.temporada ? ETIQUETA_TEMPORADA[f.temporada] : "") },
  { clave: "genero", titulo: "GENERO", valor: (f) => f.genero },
  { clave: "mundo", titulo: "MUNDO", valor: (f) => f.mundo },
  { clave: "linea", titulo: "LINEA", valor: (f) => f.linea },
  { clave: "nivel", titulo: "NIVEL", valor: (f) => f.nivel },
  { clave: "unidad", titulo: "UNIDAD", valor: (f) => ETIQUETA_UNIDAD[f.unidad] },
  { clave: "equivalencia", titulo: "EQUIVALENCIA", valor: (f) => f.equivalencia },
  { clave: "codigo", titulo: "CODIGO", valor: (f) => f.codigo },
  { clave: "generica", titulo: "GENERICA", valor: (f) => siNo(f.es_generica) },
  { clave: "activa", titulo: "ACTIVA", valor: (f) => siNo(f.activo) },
  { clave: "nodo_vigente", titulo: "NODO_VIGENTE", valor: (f) => siNo(f.vigente) },
  { clave: "agrupacion_nodo", titulo: "AGRUPACION_NODO", valor: (f) => textoAgrupacionNodo(f.agrupacion_nodo) },
  { clave: "mayoritaria", titulo: "MAYORITARIA", valor: (f) => f.mayoritaria },
  { clave: "anomalias", titulo: "ANOMALIAS", valor: (f) => textoAnomalias(f.anomalias) },
];

// ─── Anomalías ───

export const COLUMNAS_LINEAS_PARTIDAS: ColumnaGmle<LineaPartidaGmle>[] = [
  { clave: "genero", titulo: "GENERO", valor: (f) => f.genero },
  { clave: "linea", titulo: "LINEA", valor: (f) => f.linea },
  { clave: "agrupaciones", titulo: "AGRUPACIONES", valor: (f) => f.agrupaciones.length },
  { clave: "detalle", titulo: "DETALLE", valor: (f) => textoLineaPartida(f) },
];

export const COLUMNAS_NODOS_MIXTOS: ColumnaGmle<FilaNodoMixtoGmle>[] = [
  { clave: "ruta", titulo: "RUTA", valor: (f) => f.nodo.ruta },
  { clave: "reparto", titulo: "REPARTO", valor: (f) => f.reparto },
  { clave: "mayoritaria", titulo: "MAYORITARIA", valor: (f) => f.mayoritaria },
  { clave: "equivalencias", titulo: "EQUIVALENCIAS", valor: (f) => f.equivalencias },
];

export const COLUMNAS_AGRUPACIONES_VACIAS: ColumnaGmle<AgrupacionGmle>[] = [
  { clave: "agrupacion", titulo: "AGRUPACION", valor: (f) => f.nombre },
  { clave: "temporada", titulo: "TEMPORADA", valor: (f) => ETIQUETA_TEMPORADA[f.temporada] },
  { clave: "generos", titulo: "GENEROS", valor: (f) => (f.generos.length === 0 ? "Sin género" : textoGeneros(f.generos.map((g) => g.nombre))) },
];

// ─── Filas ───

export const encabezados = <T>(columnas: readonly ColumnaGmle<T>[]): string[] => columnas.map((c) => c.titulo);

/** Una fila de celdas por cada fila de la tabla, en el orden de las columnas. */
export function filasDe<T>(columnas: readonly ColumnaGmle<T>[], filas: readonly T[]): Celda[][] {
  return filas.map((f) => columnas.map((c) => c.valor(f)));
}

export const filasResumen = (filas: readonly FilaResumenGmle[]) => filasDe(COLUMNAS_RESUMEN, filas);
export const filasDetalle = (filas: readonly FilaDetalleGmle[]) => filasDe(COLUMNAS_DETALLE, filas);
export const filasLineasPartidas = (filas: readonly LineaPartidaGmle[]) => filasDe(COLUMNAS_LINEAS_PARTIDAS, filas);
export const filasNodosMixtos = (filas: readonly FilaNodoMixtoGmle[]) => filasDe(COLUMNAS_NODOS_MIXTOS, filas);
export const filasAgrupacionesVacias = (filas: readonly AgrupacionGmle[]) => filasDe(COLUMNAS_AGRUPACIONES_VACIAS, filas);

// ─── Archivos ───

export type VistaDescarga = "resumen" | "detalle" | "anomalias-lineas-partidas" | "anomalias-nodos-mixtos" | "anomalias-equivalencias" | "anomalias-agrupaciones-vacias";

/** `agrupacion-gmle-detalle-2026-10-14.csv` (fecha local del navegador, no UTC). */
export function nombreArchivoGmle(vista: VistaDescarga, extension: "csv" | "xlsx", fecha: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `agrupacion-gmle-${vista}-${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}.${extension}`;
}

export const HOJA_REPORTE = "REPORTE";

export function descargarVistaCsv<T>(vista: VistaDescarga, columnas: readonly ColumnaGmle<T>[], filas: readonly T[]) {
  descargarCsv(encabezados(columnas), filasDe(columnas, filas), nombreArchivoGmle(vista, "csv"));
}

export function descargarVistaExcel<T>(vista: VistaDescarga, columnas: readonly ColumnaGmle<T>[], filas: readonly T[]): Promise<void> {
  return descargarExcel(encabezados(columnas), filasDe(columnas, filas), HOJA_REPORTE, nombreArchivoGmle(vista, "xlsx"));
}
