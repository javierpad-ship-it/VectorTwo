import { construirHojaLibro, descargarLibro, nombreHojaValido } from "@/app/(app)/planificacion/proyeccion/descarga-libro";
import { COLUMNAS_FECHA_LINEA_DE_TIEMPO, COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO } from "@/lib/compras/agrupadores/excel";
import type { CompraApi } from "@/lib/compras/tipos-api";
import { hojasCompras, hojasFlujo, NOMBRE_ARCHIVO_COMPRAS, NOMBRE_ARCHIVO_FLUJO, type FiltroExcelFlujo, type Hoja } from "@/lib/flujo/excel";
import type { ConciliacionApi, FlujoApi } from "@/lib/flujo/tipos-api";

/**
 * Excel de Flujo mensual y de Compras (ficha 08 §4.3 y §4.4). Solo en el navegador: SheetJS se carga bajo demanda con `import()` dentro de
 * `descargarLibro` (patrón de M7, M11, M12 y M13). Las hojas las arman `hojasFlujo` y `hojasCompras` con los datos que la pantalla ya
 * leyó de la API; aquí solo se descartan las hojas vacías y se descarga.
 */

/** `FLUJO`, `SALDO`, `PARAMETROS` y `FILTROS`, más `CONCILIACION` si hay un mes conciliado. */
export async function descargarFlujo(args: { flujo: FlujoApi; conciliacion: ConciliacionApi | null; filtro: FiltroExcelFlujo }): Promise<void> {
  const h = hojasFlujo(args);
  const hojas: Record<string, Hoja> = { FLUJO: h.FLUJO, SALDO: h.SALDO };
  if (h.CONCILIACION) hojas.CONCILIACION = h.CONCILIACION;
  hojas.PARAMETROS = h.PARAMETROS;
  hojas.FILTROS = h.FILTROS;
  await descargarLibro(hojas, NOMBRE_ARCHIVO_FLUJO);
}

const MS_POR_DIA = 86_400_000;
/** Día 0 del calendario de Excel (1899-12-30 en UTC: ya absorbe el error del 29-feb-1900). */
const ORIGEN_EXCEL = Date.UTC(1899, 11, 30);
export const FORMATO_FECHA_EXCEL = "dd/mm/yyyy";
export const FORMATO_FECHA_HORA_EXCEL = "dd/mm/yyyy hh:mm";

/**
 * `aaaa-mm-dd` o `aaaa-mm-dd hh:mm` → número de serie de fecha de Excel (la hora, como fracción del día). `null` si el texto no es una fecha
 * válida (queda como texto y no se rompe el libro). Es la hora de pared: no se mueve por zona horaria.
 */
export function serieDeFechaExcel(texto: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(texto.trim());
  if (!m) return null;
  const [a, mes, d, hh, mm] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  const fecha = new Date(Date.UTC(a, mes - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== d || hh > 23 || mm > 59) return null;
  const dias = Math.round((fecha.getTime() - ORIGEN_EXCEL) / MS_POR_DIA);
  return dias + (hh * 60 + mm) / 1440;
}

/**
 * La hoja `LINEA_DE_TIEMPO` con sus fechas como números de serie de Excel (`descargarLibro` escribe lo que recibe y no convierte fechas):
 * las columnas `COLUMNAS_FECHA_LINEA_DE_TIEMPO` y la de fecha y hora (inicio operativo). La cabecera y lo que no es una fecha válida no se tocan.
 * Pura; el formato de celda lo pone `descargarCompras` (`FORMATO_FECHA_EXCEL`).
 */
export function lineaDeTiempoConFechasDeExcel(hoja: Hoja): Hoja {
  const columnas = new Set<number>([...COLUMNAS_FECHA_LINEA_DE_TIEMPO, COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO]);
  return hoja.map((fila, i) => (i === 0 ? fila : fila.map((c, j) => (columnas.has(j) && typeof c === "string" ? (serieDeFechaExcel(c) ?? c) : c))));
}

/** El formato de celda de cada columna de fecha de la hoja ya convertida: `dd/mm/yyyy`, y con hora en el inicio operativo. */
export const formatoDeColumnaLineaDeTiempo = (columna: number): string | null =>
  columna === COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO ? FORMATO_FECHA_HORA_EXCEL : COLUMNAS_FECHA_LINEA_DE_TIEMPO.includes(columna) ? FORMATO_FECHA_EXCEL : null;

/**
 * `COMPRAS`, `ENTREGAS`, `POR_PROVEEDOR`, `COSTO` y `LINEA_DE_TIEMPO` de las compras de la lista. La última lleva sus fechas como fechas de
 * Excel (ordenan y filtran como fechas), con formato `dd/mm/yyyy`; el inicio operativo, con hora.
 */
export async function descargarCompras(compras: readonly CompraApi[]): Promise<void> {
  const hojas: Record<string, Hoja> = { ...hojasCompras(compras) };
  hojas.LINEA_DE_TIEMPO = lineaDeTiempoConFechasDeExcel(hojas.LINEA_DE_TIEMPO);
  const XLSX = await import("xlsx");
  const libro = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    const hoja = construirHojaLibro(XLSX, filas);
    if (nombre === "LINEA_DE_TIEMPO") {
      filas.forEach((fila, r) =>
        fila.forEach((valor, c) => {
          const formato = r === 0 || typeof valor !== "number" ? null : formatoDeColumnaLineaDeTiempo(c);
          const celda = formato === null ? undefined : hoja[XLSX.utils.encode_cell({ r, c })];
          if (celda && formato !== null) celda.z = formato;
        }),
      );
    }
    XLSX.utils.book_append_sheet(libro, hoja, nombreHojaValido(nombre));
  }
  const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = NOMBRE_ARCHIVO_COMPRAS;
  enlace.click();
  URL.revokeObjectURL(url);
}
