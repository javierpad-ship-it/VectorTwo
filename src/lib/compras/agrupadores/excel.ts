import type { Hoja } from "@/lib/proyeccion/excel";
import { ENCABEZADOS_AGRUPADORES, filaDeAgrupador } from "./plantilla";
import { ETIQUETA_ESTADO_EMBARQUE, ETIQUETA_ESTADO_PAQUETE, ETIQUETA_ESTADO_VIAJE, ETIQUETA_RECEPCION_EMBARQUE, ETIQUETA_TIPO_EMBARQUE, type EmbarqueApi, type EmbarqueDetalleApi, type ViajeApi } from "./tipos-api";
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

/** Hoja `EMBARQUES`: una fila por embarque, con fechas, responsable efectivo, unidades y costo. */
export function hojaEmbarques(embarques: readonly EmbarqueApi[]): Hoja {
  const hoja: Hoja = [
    ["CÓDIGO", "NOMBRE", "TIPO", "VIAJE", "PUERTO", "REFERENCIA LOGÍSTICA", "SALIDA ESTIMADA", "LLEGADA ESTIMADA", "LLEGADA REAL", "RESPONSABLE", "ESTADO", "RECEPCIÓN", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES (EST.)", "HISTÓRICAS", "COMPRAS", "LÍNEAS", "PAQUETES", "PROVEEDORES", "COSTO", "AVISOS"],
  ];
  for (const e of embarques) {
    hoja.push([
      e.codigo,
      e.nombre,
      ETIQUETA_TIPO_EMBARQUE[e.tipo],
      e.viaje ? e.viaje.codigo : null,
      e.puerto_embarque,
      e.referencia_logistica,
      e.fecha_salida_estimada,
      e.fecha_llegada_estimada,
      e.fecha_llegada_real,
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
      e.proveedores.map((p) => p.nombre).join("; ") || null,
      costoTexto(e.totales.costo),
      e.avisos.join("; ") || null,
    ]);
  }
  return hoja;
}

/** Hoja `PAQUETES`: una fila por paquete de los embarques con detalle. */
export function hojaPaquetes(embarques: readonly EmbarqueDetalleApi[]): Hoja {
  const hoja: Hoja = [["EMBARQUE", "CÓDIGO", "NOMBRE", "RESPONSABLE", "ESTADO", "ASIGNACIONES", "COMPRAS", "LÍNEAS", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES (EST.)", "HISTÓRICAS", "NOTA", "AVISOS"]];
  for (const e of embarques) {
    for (const p of e.paquetes) {
      hoja.push([e.codigo, p.codigo, p.nombre, p.responsable_efectivo?.nombre ?? null, ETIQUETA_ESTADO_PAQUETE[p.estado], p.totales.asignaciones, p.totales.compras, p.totales.lineas, p.totales.unidades, p.totales.recibidas, p.totales.pendientes, p.totales.historicas, p.nota, p.avisos.join("; ") || null]);
    }
  }
  return hoja;
}

/** Hoja `ASIGNACIONES`: una fila por asignación (embarque, paquete, compra, línea, mes y unidades). */
export function hojaAsignaciones(embarques: readonly EmbarqueDetalleApi[]): Hoja {
  const hoja: Hoja = [["EMBARQUE", "PAQUETE", "COMPRA", "PROVEEDOR", "LÍNEA", "TIPO", "MARCA / AGRUPACIÓN", "MES", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTE (EST.)", "HISTÓRICA", "COSTO UNITARIO", "MONEDA"]];
  for (const e of embarques) {
    const codigoPaquete = new Map(e.paquetes.map((p) => [p.id, p.codigo]));
    for (const a of e.asignaciones) {
      hoja.push([
        e.codigo,
        a.paquete_id ? (codigoPaquete.get(a.paquete_id) ?? null) : null,
        a.compra.numero,
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
        fecha_salida: e.fecha_salida_estimada,
        fecha_llegada: e.fecha_llegada_estimada,
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

/** Las hojas de la pestaña Embarques: `EMBARQUES`, `PAQUETES` y `ASIGNACIONES`. */
export function hojasEmbarques(embarques: readonly EmbarqueDetalleApi[]): { EMBARQUES: Hoja; PAQUETES: Hoja; ASIGNACIONES: Hoja } {
  return { EMBARQUES: hojaEmbarques(embarques), PAQUETES: hojaPaquetes(embarques), ASIGNACIONES: hojaAsignaciones(embarques) };
}

/** Las hojas de la pestaña Viajes: `VIAJES` y `AGRUPADORES` (la que se puede volver a subir). */
export function hojasViajes(entrada: { viajes: readonly ViajeApi[]; embarques: readonly EmbarqueDetalleApi[]; correoDe: (perfilId: string) => string | null }): { VIAJES: Hoja; AGRUPADORES: Hoja } {
  return { VIAJES: hojaViajes(entrada.viajes), AGRUPADORES: hojaAgrupadores(entrada) };
}
