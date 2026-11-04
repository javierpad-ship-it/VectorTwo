import type { Hoja } from "@/lib/proyeccion/excel";
import {
  ETIQUETA_ESTADO_EMBARQUE,
  ETIQUETA_ESTADO_PAQUETE,
  ETIQUETA_ESTADO_VIAJE,
  ETIQUETA_TIPO_EMBARQUE,
  type AsignableApi,
  type EmbarqueApi,
  type EmbarqueDetalleApi,
  type ResponsableEfectivoApi,
  type ViajeApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { VALORES_TIPO_EMBARQUE_IMPORTADOR, VALORES_TIPO_IMPORTADOR } from "@/lib/compras/agrupadores/tipos";
import { ENCABEZADOS_PLANTILLA_AGRUPADORES } from "./vista-importar-agrupadores";
import { textoLinea } from "./vista-agrupadores";

/**
 * Hojas de la exportación a Excel de Viajes y embarques (ficha 08b §3.11 y §4.1; regla «Excel = pantalla»). Puro: solo arma filas con lo que la
 * pantalla ya leyó; SheetJS se carga bajo demanda al descargar (`descargarLibro`). Hojas: `VIAJES`, `EMBARQUES`, `PAQUETES`, `ASIGNACIONES` y
 * `AGRUPADORES`, esta última con las MISMAS columnas que la plantilla del importador (se puede bajar, completar y volver a subir: lo que ya
 * existe sale «igual»). En AGRUPADORES, el responsable va como correo (lo que pide el importador) y solo si es del propio agrupador.
 */

export const NOMBRE_ARCHIVO_AGRUPADORES = "viajes-y-embarques.xlsx";

const si = (v: boolean) => (v ? "Sí" : "No");
const costo = (c: { PEN: number; USD: number }) => [c.PEN, c.USD] as const;

export function hojaViajes(viajes: readonly ViajeApi[]): Hoja {
  const filas: Hoja = [["CÓDIGO", "NOMBRE", "DESTINO", "INICIO", "FIN", "RESPONSABLE", "ESTADO", "COMPRAS", "UNIDADES", "COSTO PEN", "COSTO USD", "EMBARQUES", "UNIDADES SIN EMBARQUE", "NOTA"]];
  for (const v of viajes) {
    filas.push([v.codigo, v.nombre, v.destino ?? "", v.fecha_inicio, v.fecha_fin ?? "", v.responsable?.nombre ?? "", ETIQUETA_ESTADO_VIAJE[v.estado], v.totales.compras, v.totales.unidades, ...costo(v.totales.costo), v.totales.embarques, v.totales.unidades_sin_embarque, v.nota ?? ""]);
  }
  return filas;
}

export function hojaEmbarques(embarques: readonly EmbarqueApi[]): Hoja {
  const filas: Hoja = [
    ["CÓDIGO", "NOMBRE", "TIPO", "VIAJE", "PUERTO", "REFERENCIA LOGÍSTICA", "RESPONSABLE", "SALIDA ESTIMADA", "LLEGADA ESTIMADA", "LLEGADA REAL", "ESTADO", "ATRASADO", "PAQUETES", "COMPRAS", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES", "HISTÓRICAS", "COSTO PEN", "COSTO USD", "PROVEEDORES", "NOTA"],
  ];
  for (const e of embarques) {
    filas.push([
      e.codigo,
      e.nombre,
      ETIQUETA_TIPO_EMBARQUE[e.tipo],
      e.viaje?.codigo ?? "",
      e.puerto_embarque ?? "",
      e.referencia_logistica ?? "",
      e.responsable_efectivo?.nombre ?? "",
      e.fecha_salida_estimada ?? "",
      e.fecha_llegada_estimada,
      e.fecha_llegada_real ?? "",
      ETIQUETA_ESTADO_EMBARQUE[e.estado],
      si(e.avisos.includes("atrasado")),
      e.totales.paquetes,
      e.totales.compras,
      e.totales.unidades,
      e.totales.recibidas,
      e.totales.pendientes,
      e.totales.historicas,
      ...costo(e.totales.costo),
      e.proveedores.map((p) => p.nombre).join(", "),
      e.nota ?? "",
    ]);
  }
  return filas;
}

export function hojaPaquetes(detalles: readonly EmbarqueDetalleApi[]): Hoja {
  const filas: Hoja = [["EMBARQUE", "CÓDIGO", "NOMBRE", "RESPONSABLE", "ESTADO", "COMPRAS", "LÍNEAS", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES", "HISTÓRICAS", "NOTA"]];
  for (const e of detalles) {
    for (const p of e.paquetes) {
      filas.push([e.codigo, p.codigo, p.nombre, p.responsable_efectivo?.nombre ?? "", ETIQUETA_ESTADO_PAQUETE[p.estado], p.totales.compras, p.totales.lineas, p.totales.unidades, p.totales.recibidas, p.totales.pendientes, p.totales.historicas, p.nota ?? ""]);
    }
  }
  return filas;
}

export function hojaAsignaciones(detalles: readonly EmbarqueDetalleApi[]): Hoja {
  const filas: Hoja = [["EMBARQUE", "PAQUETE", "COMPRA", "PROVEEDOR", "LÍNEA", "MES", "UNIDADES", "RECIBIDAS (EST.)", "PENDIENTES", "HISTÓRICA", "COSTO UNITARIO", "MONEDA"]];
  for (const e of detalles) {
    const paquetes = new Map(e.paquetes.map((p) => [p.id, p.codigo]));
    for (const a of e.asignaciones) {
      filas.push([e.codigo, a.paquete_id ? (paquetes.get(a.paquete_id) ?? "") : "", a.compra.numero, a.compra.proveedor.nombre, textoLinea(a.linea), a.periodo, a.unidades, a.recibidas, a.historica ? 0 : a.pendiente, si(a.historica), a.linea.costo_unitario, a.linea.moneda]);
    }
  }
  return filas;
}

const correoDe = (r: { perfil_id: string } | null, asignables: readonly AsignableApi[]): string => (r ? (asignables.find((a) => a.perfil_id === r.perfil_id)?.email ?? "") : "");
/** El responsable propio como correo; el heredado se deja vacío para que al reimportar siga heredando. */
const correoPropio = (r: ResponsableEfectivoApi | null, asignables: readonly AsignableApi[]): string => (r && r.origen === "propio" ? correoDe(r, asignables) : "");

/**
 * Hoja `AGRUPADORES`: los viajes, después los embarques y después los paquetes, con las columnas y los valores de la plantilla del
 * importador (`TIPO`, `VIAJE`/`EMBARQUE` por código, fechas `aaaa-mm-dd`). Un responsable que ya no es asignable sale vacío: hay que
 * elegir otro antes de reimportar (el importador lo pide en los viajes).
 */
export function hojaAgrupadores(viajes: readonly ViajeApi[], detalles: readonly EmbarqueDetalleApi[], asignables: readonly AsignableApi[]): Hoja {
  const filas: Hoja = [ENCABEZADOS_PLANTILLA_AGRUPADORES];
  const fila = (v: Partial<Record<(typeof ENCABEZADOS_PLANTILLA_AGRUPADORES)[number], string>>): string[] => ENCABEZADOS_PLANTILLA_AGRUPADORES.map((h) => v[h] ?? "");
  for (const v of viajes) {
    filas.push(
      fila({ TIPO: VALORES_TIPO_IMPORTADOR.viaje, CODIGO: v.codigo, NOMBRE: v.nombre, DESTINO: v.destino ?? "", FECHA_INICIO: v.fecha_inicio, FECHA_FIN: v.fecha_fin ?? "", RESPONSABLE: correoDe(v.responsable, asignables), NOTA: v.nota ?? "" }),
    );
  }
  for (const e of detalles) {
    filas.push(
      fila({
        TIPO: VALORES_TIPO_IMPORTADOR.embarque,
        CODIGO: e.codigo,
        NOMBRE: e.nombre,
        VIAJE: e.viaje?.codigo ?? "",
        TIPO_EMBARQUE: VALORES_TIPO_EMBARQUE_IMPORTADOR[e.tipo],
        FECHA_SALIDA: e.fecha_salida_estimada ?? "",
        FECHA_LLEGADA: e.fecha_llegada_estimada,
        PUERTO: e.puerto_embarque ?? "",
        REFERENCIA_LOGISTICA: e.referencia_logistica ?? "",
        RESPONSABLE: correoPropio(e.responsable_efectivo, asignables),
        NOTA: e.nota ?? "",
      }),
    );
  }
  for (const e of detalles) {
    for (const p of e.paquetes) {
      filas.push(fila({ TIPO: VALORES_TIPO_IMPORTADOR.paquete, CODIGO: p.codigo, NOMBRE: p.nombre, EMBARQUE: e.codigo, RESPONSABLE: correoPropio(p.responsable_efectivo, asignables), NOTA: p.nota ?? "" }));
    }
  }
  return filas;
}
