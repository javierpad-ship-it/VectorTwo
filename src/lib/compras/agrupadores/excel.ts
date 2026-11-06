import type { Hoja } from "@/lib/proyeccion/excel";
import { TEXTO_ESTADO_HITO_EXCEL } from "./hitos";
import { ENCABEZADOS_AGRUPADORES, filaDeAgrupador } from "./plantilla";
import {
  ETIQUETA_CAUSA_FECHA,
  ETIQUETA_ESTADO_EMBARQUE,
  ETIQUETA_ESTADO_PAQUETE,
  ETIQUETA_ESTADO_VIAJE,
  ETIQUETA_RECEPCION_EMBARQUE,
  ETIQUETA_TIPO_EMBARQUE,
  type EmbarqueApi,
  type EmbarqueDetalleApi,
  type HitoApi,
  type TramoLineaTiempoApi,
  type ViajeApi,
} from "./tipos-api";
import type { CausaFecha, Hito } from "./tipos";
import { VALORES_TIPO_EMBARQUE_IMPORTADOR } from "./tipos";

/**
 * Hojas de la exportación a Excel de Viajes y embarques (ficha 08b, §3.11 y §4.1: «Excel = pantalla»). Puro: solo arma filas; SheetJS se
 * carga bajo demanda en el navegador (`descargarLibro`) y no llama a ninguna ruta: parte de lo que la pantalla ya tiene.
 *
 * Embarques: `EMBARQUES`, `PAQUETES`, `ASIGNACIONES`. Viajes: `VIAJES` y `AGRUPADORES`, la hoja con las MISMAS columnas que la
 * plantilla del importador (se puede bajar, completar y volver a subir: lo que ya existe sale `igual`).
 */

export type { Hoja };
export type Celda = string | number | null;

export const NOMBRE_ARCHIVO_EMBARQUES = "embarques.xlsx";
export const NOMBRE_ARCHIVO_VIAJES = "viajes.xlsx";

const dec = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const costoTexto = (c: { PEN: number; USD: number }): string => [c.PEN !== 0 ? `S/ ${dec(c.PEN, 2)}` : null, c.USD !== 0 ? `US$ ${dec(c.USD, 2)}` : null].filter((x) => x !== null).join(" + ") || "—";
const persona = (p: { nombre: string | null; at: string } | null): string | null => (p ? `${p.nombre ?? "—"} (${p.at.slice(0, 10)})` : null);

/** Hoja `VIAJES`: una fila por viaje, con sus totales y quién lo creó y lo modificó. */
export function hojaViajes(viajes: readonly ViajeApi[]): Hoja {
  const hoja: Hoja = [["CÓDIGO", "NOMBRE", "DESTINO", "INICIO", "FIN", "RESPONSABLE", "ESTADO", "COMPRAS", "UNIDADES", "COSTO", "EMBARQUES", "UNIDADES SIN EMBARQUE", "CREADO POR", "ÚLTIMO CAMBIO", "AVISOS"]];
  for (const v of viajes) {
    hoja.push([
      v.codigo,
      v.nombre,
      v.destino,
      v.fecha_inicio,
      v.fecha_fin,
      v.responsable?.nombre ?? null,
      ETIQUETA_ESTADO_VIAJE[v.estado],
      v.totales.compras,
      v.totales.unidades,
      costoTexto(v.totales.costo),
      v.totales.embarques,
      v.totales.unidades_sin_embarque,
      persona(v.creado_por),
      persona(v.modificado_por),
      v.avisos.join("; ") || null,
    ]);
  }
  return hoja;
}

export const ENCABEZADOS_EMBARQUES = [
  "CÓDIGO",
  "NOMBRE",
  "TIPO",
  "VIAJE",
  "ORIGEN",
  "PUERTO",
  "REFERENCIA LOGÍSTICA",
  "ZARPE",
  "ESTADO ZARPE",
  "ARRIBO",
  "ESTADO ARRIBO",
  "INGRESO CD",
  "ESTADO INGRESO CD",
  "INICIO OPERATIVO",
  "ESTADO INICIO OPERATIVO",
  "INGRESO AL STOCK",
  "ESTADO INGRESO AL STOCK",
  "MES DEL FLUJO",
  "INGRESO REAL",
  "PRÓXIMO HITO",
  "REPROGRAMACIONES",
  "RESPONSABLE",
  "ESTADO",
  "RECEPCIÓN",
  "UNIDADES",
  "RECIBIDAS (EST.)",
  "PENDIENTES (EST.)",
  "HISTÓRICAS",
  "COMPRAS",
  "LÍNEAS",
  "PAQUETES",
  "PROVEEDORES",
  "COSTO",
  "AVISOS",
] as const;

/** Columnas (base 0) de `EMBARQUES` que son fecha (`aaaa-mm-dd`): quien escribe el libro las convierte a fecha de Excel. */
export const COLUMNAS_FECHA_EMBARQUES: readonly number[] = [7, 9, 11, 15, 18];
/** Columna del inicio operativo de `EMBARQUES` (fecha y hora, `aaaa-mm-dd hh:mm`, o solo la fecha si no hay hora). */
export const COLUMNA_FECHA_HORA_EMBARQUES = 13;

const NOMBRE_HITO_EXCEL: Record<Hito, string> = { orden_compra: "Orden de compra", zarpe: "Zarpe", arribo: "Arribo", ingreso_cd: "Ingreso CD", inicio_operativo: "Inicio operativo", ingreso_stock: "Ingreso al stock" };

/**
 * Hoja `EMBARQUES`: una fila por embarque, con los cinco hitos (fecha y estado en texto, como en la pantalla), el origen, el mes del flujo,
 * el próximo hito, las reprogramaciones, el responsable efectivo, las unidades y el costo. Las fechas van como `aaaa-mm-dd` (el inicio
 * operativo, con su hora si la tiene) para convertirlas a fecha de Excel al escribir el libro (`COLUMNAS_FECHA_EMBARQUES`).
 */
export function hojaEmbarques(embarques: readonly EmbarqueApi[]): Hoja {
  const hoja: Hoja = [[...ENCABEZADOS_EMBARQUES]];
  for (const e of embarques) {
    const h = (hito: Hito): HitoApi | undefined => e.hitos?.find((x) => x.hito === hito);
    const fecha = (hito: Hito, plana: string | null | undefined): string | null => {
      const x = h(hito);
      const f = x ? x.fecha : (plana ?? null);
      if (f === null) return null;
      return hito === "inicio_operativo" && x?.hora ? `${f} ${x.hora}` : f;
    };
    const estado = (hito: Hito): string | null => {
      const x = h(hito);
      return x ? TEXTO_ESTADO_HITO_EXCEL[x.estado] : null;
    };
    const p = e.proximo_hito;
    // El mes del flujo es el del ingreso al stock vigente (el real, si no el fijado, si no el Ingreso CD): se lee de la fecha, no de `periodo_llegada`.
    const ingresoStock = fecha("ingreso_stock", e.fecha_llegada_real ?? e.fecha_ingreso_estimada ?? e.fecha_llegada_estimada);
    hoja.push([
      e.codigo,
      e.nombre,
      ETIQUETA_TIPO_EMBARQUE[e.tipo],
      e.viaje ? e.viaje.codigo : null,
      e.origen ?? null,
      e.puerto_embarque,
      e.referencia_logistica,
      fecha("zarpe", e.fecha_salida_estimada),
      estado("zarpe"),
      fecha("arribo", e.fecha_puerto_estimada),
      estado("arribo"),
      fecha("ingreso_cd", e.fecha_llegada_estimada),
      estado("ingreso_cd"),
      fecha("inicio_operativo", e.fecha_inicio_operativo_estimada),
      estado("inicio_operativo"),
      ingresoStock,
      estado("ingreso_stock"),
      ingresoStock === null ? null : ingresoStock.slice(0, 7),
      e.fecha_llegada_real,
      p ? `${NOMBRE_HITO_EXCEL[p.hito]}${p.fecha ? ` · ${p.fecha.slice(8, 10)}/${p.fecha.slice(5, 7)}/${p.fecha.slice(0, 4)}` : ""} · ${TEXTO_ESTADO_HITO_EXCEL[p.estado]}` : null,
      e.reprogramaciones_total ?? 0,
      e.responsable_efectivo?.nombre ?? null,
      ETIQUETA_ESTADO_EMBARQUE[e.estado],
      ETIQUETA_RECEPCION_EMBARQUE[e.recepcion],
      e.totales.unidades,
      e.totales.recibidas,
      e.totales.pendientes,
      e.totales.historicas,
      e.totales.compras,
      e.totales.lineas,
      e.totales.paquetes,
      e.proveedores.map((x) => x.nombre).join("; ") || null,
      costoTexto(e.totales.costo),
      e.avisos.join("; ") || null,
    ]);
  }
  return hoja;
}

/** Columna (base 0) de `PAQUETES` con el ingreso propio del paquete (`aaaa-mm-dd`). */
export const COLUMNAS_FECHA_PAQUETES: readonly number[] = [5];

/** Hoja `PAQUETES`: una fila por paquete, con su ingreso al stock propio (vacío si hereda el del embarque). */
export function hojaPaquetes(embarques: readonly EmbarqueDetalleApi[]): Hoja {
  const hoja: Hoja = [["EMBARQUE", "CÓDIGO", "NOMBRE", "RESPONSABLE", "ESTADO", "INGRESO AL STOCK PROPIO", "INGRESO", "ASIGNACIONES", "COMPRAS", "LÍNEAS", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES (EST.)", "HISTÓRICAS", "LOTES AL BARRER", "NOTA", "AVISOS"]];
  for (const e of embarques) {
    for (const p of e.paquetes) {
      const propio = p.ingreso_propio === true && (p.fecha_ingreso ?? null) !== null;
      hoja.push([
        e.codigo,
        p.codigo,
        p.nombre,
        p.responsable_efectivo?.nombre ?? null,
        ETIQUETA_ESTADO_PAQUETE[p.estado],
        propio ? (p.fecha_ingreso ?? null) : null,
        propio ? "Propio" : "Hereda del embarque",
        p.totales.asignaciones,
        p.totales.compras,
        p.totales.lineas,
        p.totales.unidades,
        p.totales.recibidas,
        p.totales.pendientes,
        p.totales.historicas,
        p.lotes_al_barrer ?? 0,
        p.nota,
        p.avisos.join("; ") || null,
      ]);
    }
  }
  return hoja;
}

/** Hoja `ASIGNACIONES`: una fila por asignación (embarque, paquete, compra, línea, mes y unidades). */
export function hojaAsignaciones(embarques: readonly EmbarqueDetalleApi[]): Hoja {
  const hoja: Hoja = [["EMBARQUE", "PAQUETE", "COMPRA", "OC", "PROVEEDOR", "LÍNEA", "TIPO", "MARCA / AGRUPACIÓN", "MES", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTE (EST.)", "HISTÓRICA", "COSTO UNITARIO", "MONEDA"]];
  for (const e of embarques) {
    const codigoPaquete = new Map(e.paquetes.map((p) => [p.id, p.codigo]));
    for (const a of e.asignaciones) {
      hoja.push([
        e.codigo,
        a.paquete_id ? (codigoPaquete.get(a.paquete_id) ?? null) : null,
        a.compra.numero,
        a.compra.numero_oc ?? null,
        a.compra.proveedor.nombre,
        a.linea.gml,
        a.linea.tipo,
        a.linea.marca ?? a.linea.agrupacion_marca,
        a.periodo,
        a.unidades,
        a.recibidas,
        a.pendiente,
        a.historica ? "Sí" : "No",
        a.linea.costo_unitario,
        a.linea.moneda,
      ]);
    }
  }
  return hoja;
}

/**
 * Hoja `AGRUPADORES`: los viajes, embarques y paquetes no cancelados con las columnas de la plantilla del importador (§3.11), en el orden
 * viajes, embarques y paquetes. `correoDe` da el correo del perfil responsable (la columna `RESPONSABLE` lleva el correo); el
 * responsable de un embarque o paquete solo se escribe si es PROPIO (si hereda, la celda queda vacía, como se importó). Subirla otra
 * vez da todo `igual`.
 */
export function hojaAgrupadores(entrada: { viajes: readonly ViajeApi[]; embarques: readonly EmbarqueDetalleApi[]; correoDe: (perfilId: string) => string | null }): Hoja {
  const { viajes, embarques, correoDe } = entrada;
  const hoja: Hoja = [ENCABEZADOS_AGRUPADORES];
  const correoPropio = (r: { perfil_id: string; origen: string } | null) => (r && r.origen === "propio" ? (correoDe(r.perfil_id) ?? "") : "");
  for (const v of viajes) {
    if (v.estado === "cancelado") continue;
    hoja.push(
      filaDeAgrupador({
        tipo: "VIAJE",
        codigo: v.codigo,
        nombre: v.nombre,
        destino: v.destino,
        fecha_inicio: v.fecha_inicio,
        fecha_fin: v.fecha_fin,
        responsable: v.responsable ? (correoDe(v.responsable.perfil_id) ?? "") : "",
        nota: v.nota,
      }),
    );
  }
  const vivos = embarques.filter((e) => e.estado !== "cancelado");
  for (const e of vivos) {
    hoja.push(
      filaDeAgrupador({
        tipo: "EMBARQUE",
        codigo: e.codigo,
        nombre: e.nombre,
        viaje: e.viaje?.codigo ?? "",
        tipo_embarque: VALORES_TIPO_EMBARQUE_IMPORTADOR[e.tipo],
        fecha_zarpe: e.fecha_salida_estimada,
        fecha_arribo: e.fecha_puerto_estimada ?? null,
        fecha_ingreso_cd: e.fecha_llegada_estimada,
        inicio_operativo: e.fecha_inicio_operativo_estimada ? `${e.fecha_inicio_operativo_estimada}${e.hora_inicio_operativo ? ` ${e.hora_inicio_operativo.slice(0, 5)}` : ""}` : "",
        // Solo el ingreso FIJADO: sin fijar sigue al Ingreso CD y sale vacío (como se importó).
        fecha_ingreso_stock: e.fecha_ingreso_estimada ?? null,
        origen: e.origen ?? null,
        puerto: e.puerto_embarque,
        referencia_logistica: e.referencia_logistica,
        responsable: correoPropio(e.responsable_efectivo),
        nota: e.nota,
      }),
    );
  }
  for (const e of vivos) {
    for (const p of e.paquetes) {
      if (p.estado === "cancelado") continue;
      hoja.push(filaDeAgrupador({ tipo: "PAQUETE", codigo: p.codigo, nombre: p.nombre, embarque: e.codigo, responsable: correoPropio(p.responsable_efectivo), nota: p.nota }));
    }
  }
  return hoja;
}

// ─── Hoja LINEA_DE_TIEMPO (08b-1b §3.8) ───

/** Una compra con su línea de tiempo (la de `GET /api/compras/[id]` y los tramos «Sin embarque» de `/agrupadores/sin-asignar`). */
export type CompraParaHojaLineaDeTiempo = {
  numero: string;
  numero_oc: string | null;
  proveedor: string;
  viaje_codigo: string | null;
  linea_de_tiempo: readonly TramoLineaTiempoApi[];
};

export const ENCABEZADOS_LINEA_DE_TIEMPO = [
  "PROVEEDOR",
  "COMPRA",
  "OC",
  "VIAJE",
  "EMBARQUE",
  "ORIGEN",
  "PAQUETE",
  "UNIDADES",
  "ORDEN DE COMPRA",
  "ZARPE",
  "ESTADO ZARPE",
  "ARRIBO",
  "ESTADO ARRIBO",
  "INGRESO CD",
  "ESTADO INGRESO CD",
  "INICIO OPERATIVO",
  "ESTADO INICIO OPERATIVO",
  "INGRESO AL STOCK",
  "ESTADO INGRESO AL STOCK",
  "MES DEL FLUJO",
  "REPROGRAMACIONES",
  "ÚLTIMA CAUSA",
] as const;

/** Columnas (base 0) que son fecha (`aaaa-mm-dd`): quien escribe el libro las convierte a fecha de Excel. */
export const COLUMNAS_FECHA_LINEA_DE_TIEMPO: readonly number[] = [8, 9, 11, 13, 17];
/** Columna del inicio operativo, que es fecha y hora (`aaaa-mm-dd hh:mm`, o solo la fecha si no hay hora). */
export const COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO = 15;

const comparar = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * Hoja `LINEA_DE_TIEMPO` (§3.8): una fila por compra y tramo, ordenada por proveedor y compra. Las fechas van como `aaaa-mm-dd` (el inicio
 * operativo, `aaaa-mm-dd hh:mm` si tiene hora) para convertirlas a fecha de Excel al escribir el libro (`COLUMNAS_FECHA_LINEA_DE_TIEMPO`); el
 * estado, en texto («Pendiente», «Previsto», «Ocurrió», «Vencido», «Por confirmar», «Ocurrió sin fecha», «No aplica»). `ultimaCausaDe` da la
 * causa del último cambio de fechas de un embarque (de `agrupador_hitos_resumen`).
 */
export function hojaLineaDeTiempo(compras: readonly CompraParaHojaLineaDeTiempo[], ultimaCausaDe: (embarqueId: string) => CausaFecha | null = () => null): Hoja {
  const hoja: Hoja = [[...ENCABEZADOS_LINEA_DE_TIEMPO]];
  const ordenadas = [...compras].sort((a, b) => comparar(a.proveedor, b.proveedor) || comparar(a.numero, b.numero));
  for (const c of ordenadas) {
    for (const t of c.linea_de_tiempo) {
      const h = (hito: Hito): HitoApi | undefined => t.hitos.find((x) => x.hito === hito);
      const fecha = (hito: Hito): string | null => {
        const x = h(hito);
        if (!x || x.fecha === null) return null;
        return hito === "inicio_operativo" && x.hora ? `${x.fecha} ${x.hora}` : x.fecha;
      };
      const estado = (hito: Hito): string | null => {
        const x = h(hito);
        return x ? TEXTO_ESTADO_HITO_EXCEL[x.estado] : null;
      };
      const causa = t.embarque ? ultimaCausaDe(t.embarque.id) : null;
      hoja.push([
        c.proveedor,
        c.numero,
        c.numero_oc,
        c.viaje_codigo,
        t.embarque ? t.embarque.codigo : "Sin embarque",
        t.embarque?.origen ?? null,
        t.paquete?.codigo ?? null,
        t.unidades,
        fecha("orden_compra"),
        fecha("zarpe"),
        estado("zarpe"),
        fecha("arribo"),
        estado("arribo"),
        fecha("ingreso_cd"),
        estado("ingreso_cd"),
        fecha("inicio_operativo"),
        estado("inicio_operativo"),
        fecha("ingreso_stock"),
        estado("ingreso_stock"),
        t.mes,
        t.hitos.reduce((s, x) => s + x.reprogramaciones, 0),
        causa === null ? null : ETIQUETA_CAUSA_FECHA[causa],
      ]);
    }
  }
  return hoja;
}

/** Las hojas de la pestaña Embarques: `EMBARQUES`, `PAQUETES` y `ASIGNACIONES`. */
export function hojasEmbarques(embarques: readonly EmbarqueDetalleApi[]): { EMBARQUES: Hoja; PAQUETES: Hoja; ASIGNACIONES: Hoja } {
  return { EMBARQUES: hojaEmbarques(embarques), PAQUETES: hojaPaquetes(embarques), ASIGNACIONES: hojaAsignaciones(embarques) };
}

/** Las hojas de la pestaña Viajes: `VIAJES` y `AGRUPADORES` (la que se puede volver a subir). */
export function hojasViajes(entrada: { viajes: readonly ViajeApi[]; embarques: readonly EmbarqueDetalleApi[]; correoDe: (perfilId: string) => string | null }): { VIAJES: Hoja; AGRUPADORES: Hoja } {
  return { VIAJES: hojaViajes(entrada.viajes), AGRUPADORES: hojaAgrupadores(entrada) };
}
