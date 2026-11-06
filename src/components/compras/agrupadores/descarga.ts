import { construirHojaLibro, descargarLibro, nombreHojaValido } from "@/app/(app)/planificacion/proyeccion/descarga-libro";
import { api } from "@/lib/api-client";
import {
  COLUMNA_FECHA_HORA_EMBARQUES,
  COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO,
  COLUMNAS_FECHA_EMBARQUES,
  COLUMNAS_FECHA_LINEA_DE_TIEMPO,
  COLUMNAS_FECHA_PAQUETES,
  hojaLineaDeTiempo,
} from "@/lib/compras/agrupadores/excel";
import type { AsignableApi, EmbarqueApi, EmbarqueDetalleApi, EventoAgrupadorApi, SinAgrupadorApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { urlEmbarque, urlHistorialDe, urlSinAsignar } from "@/lib/compras/agrupadores/use-agrupadores";
import type { Hoja } from "@/lib/proyeccion/excel";
import { FORMATO_FECHA_EXCEL, FORMATO_FECHA_HORA_EXCEL, serieDeFechaExcel } from "../descarga";
import { fechaLima } from "../formato";
import { hojaAgrupadores, hojaAsignaciones, hojaEmbarques, hojaPaquetes, hojaViajes, NOMBRE_ARCHIVO_EMBARQUES, NOMBRE_ARCHIVO_VIAJES } from "./hojas-agrupadores";
import { comprasParaLineaDeTiempo, ultimaCausaPorEmbarque } from "./hojas-linea-tiempo";

/**
 * Excel de Viajes y embarques (ficha 08b §3.11 y §4.1; 08b-1b §3.8). Solo en el navegador: SheetJS se carga bajo demanda. Los paquetes, las
 * asignaciones y la línea de tiempo salen del detalle de cada embarque (`GET /api/compras/embarques/[id]`), de su historial (la última causa) y de
 * `/agrupadores/sin-asignar` (los tramos «Sin embarque» del viaje elegido); todo se lee de a pocos a la vez. Las fechas de `EMBARQUES`,
 * `PAQUETES` y `LINEA_DE_TIEMPO` van como fecha de Excel (ordenan y filtran como fechas); `AGRUPADORES` se queda en texto `aaaa-mm-dd`, que es lo
 * que el importador lee, para que se pueda bajar, completar y volver a subir.
 */

const EN_PARALELO = 4;

async function enTandas<T, R>(items: readonly T[], leer: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = [];
  for (let i = 0; i < items.length; i += EN_PARALELO) salida.push(...(await Promise.all(items.slice(i, i + EN_PARALELO).map(leer))));
  return salida;
}

const leerDetalles = async (embarques: readonly EmbarqueApi[]): Promise<EmbarqueDetalleApi[]> =>
  (await enTandas(embarques, (e) => api.get<{ embarque: EmbarqueDetalleApi }>(urlEmbarque(e.id)))).map((r) => r.embarque);

// ─── Fechas de Excel ───

/** Qué columnas (base 0) de una hoja son fecha, y cuáles fecha y hora. */
export type ColumnasFecha = { fecha: readonly number[]; fechaHora?: readonly number[] };

/**
 * Una hoja con sus fechas como números de serie de Excel (`aaaa-mm-dd` y `aaaa-mm-dd hh:mm`; `descargarLibro` escribe lo que recibe y no convierte
 * fechas) y el formato de cada celda convertida (`dd/mm/yyyy`, y con hora si el texto la traía). La cabecera y lo que no es una fecha válida no se
 * tocan. Pura.
 */
export function hojaConFechasDeExcel(hoja: Hoja, columnas: ColumnasFecha): { filas: Hoja; formatos: Map<string, string> } {
  const todas = new Set<number>([...columnas.fecha, ...(columnas.fechaHora ?? [])]);
  const formatos = new Map<string, string>();
  const filas = hoja.map((fila, r) =>
    r === 0
      ? fila
      : fila.map((valor, c) => {
          if (!todas.has(c) || typeof valor !== "string") return valor;
          const serie = serieDeFechaExcel(valor);
          if (serie === null) return valor;
          formatos.set(`${r},${c}`, valor.length > 10 ? FORMATO_FECHA_HORA_EXCEL : FORMATO_FECHA_EXCEL);
          return serie;
        }),
  );
  return { filas, formatos };
}

async function descargarLibroConFechas(hojas: Record<string, { filas: Hoja; formatos?: Map<string, string> }>, nombreArchivo: string): Promise<void> {
  const XLSX = await import("xlsx");
  const libro = XLSX.utils.book_new();
  for (const [nombre, { filas, formatos }] of Object.entries(hojas)) {
    const hoja = construirHojaLibro(XLSX, filas);
    formatos?.forEach((formato, clave) => {
      const [r, c] = clave.split(",").map(Number);
      const celda = hoja[XLSX.utils.encode_cell({ r, c })];
      if (celda) celda.z = formato;
    });
    XLSX.utils.book_append_sheet(libro, hoja, nombreHojaValido(nombre));
  }
  const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}

/**
 * `EMBARQUES`, `PAQUETES`, `ASIGNACIONES` y `LINEA_DE_TIEMPO` de los embarques de la lista, y `AGRUPADORES` con sus viajes, embarques y paquetes
 * (reimportable). `viajeId` es el viaje activo (`uuid` o `sin_viaje`; nada = todos): acota los tramos «Sin embarque» de la línea de tiempo.
 */
export async function descargarEmbarques(args: { embarques: readonly EmbarqueApi[]; viajes: readonly ViajeApi[]; asignables: readonly AsignableApi[]; viajeId?: string }): Promise<void> {
  const [detalles, sinAsignar, historiales] = await Promise.all([
    leerDetalles(args.embarques),
    api.get<SinAgrupadorApi>(urlSinAsignar(args.viajeId ? { viaje_id: args.viajeId } : {})),
    enTandas(args.embarques, async (e) => [e.id, (await api.get<{ eventos: EventoAgrupadorApi[] }>(urlHistorialDe({ tipo: "embarque", id: e.id }))).eventos] as const),
  ]);
  const codigosViaje = new Set(args.embarques.map((e) => e.viaje?.id).filter((x): x is string => !!x));
  const viajes = args.viajes.filter((v) => codigosViaje.has(v.id));
  const compras = comprasParaLineaDeTiempo({ detalles, sinAsignar, viajes: args.viajes, hoy: fechaLima() });
  await descargarLibroConFechas(
    {
      EMBARQUES: hojaConFechasDeExcel(hojaEmbarques(detalles), { fecha: COLUMNAS_FECHA_EMBARQUES, fechaHora: [COLUMNA_FECHA_HORA_EMBARQUES] }),
      PAQUETES: hojaConFechasDeExcel(hojaPaquetes(detalles), { fecha: COLUMNAS_FECHA_PAQUETES }),
      ASIGNACIONES: { filas: hojaAsignaciones(detalles) },
      LINEA_DE_TIEMPO: hojaConFechasDeExcel(hojaLineaDeTiempo(compras, ultimaCausaPorEmbarque(new Map(historiales))), { fecha: COLUMNAS_FECHA_LINEA_DE_TIEMPO, fechaHora: [COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO] }),
      AGRUPADORES: { filas: hojaAgrupadores(viajes, detalles, args.asignables) },
    },
    NOMBRE_ARCHIVO_EMBARQUES,
  );
}

/** `VIAJES` de la lista y `AGRUPADORES` con esos viajes (reimportable: lo existente sale «igual»). */
export async function descargarViajes(args: { viajes: readonly ViajeApi[]; asignables: readonly AsignableApi[] }): Promise<void> {
  await descargarLibro({ VIAJES: hojaViajes(args.viajes), AGRUPADORES: hojaAgrupadores(args.viajes, [], args.asignables) }, NOMBRE_ARCHIVO_VIAJES);
}
