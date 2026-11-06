import type { CompraParaHojaLineaDeTiempo } from "@/lib/compras/agrupadores/excel";
import { lineaDeTiempo, type AsignacionParaLineaTiempo, type EmbarqueParaLineaTiempo, type PaqueteParaLineaTiempo, type ResumenHito } from "@/lib/compras/agrupadores/hitos";
import type { CausaFecha, EmbarqueDetalleApi, EventoAgrupadorApi, SinAgrupadorApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";

/**
 * Lo que la hoja `LINEA_DE_TIEMPO` de Viajes y embarques (ficha 08b-1b §3.8) arma con lo que la pantalla ya leyó: el detalle de cada embarque
 * de la lista (sus asignaciones, paquetes y los cinco hitos con su retraso y reprogramaciones) y, para el viaje elegido, las entregas
 * «sin embarque» (`/agrupadores/sin-asignar`). Una fila por compra y tramo; el cálculo del estado y del mes es el de la API
 * (`lineaDeTiempo`), no uno propio. Puro: sin red ni reloj.
 */

type CompraAcumulada = {
  numero: string;
  numero_oc: string | null;
  proveedor: string;
  viaje_id: string | null;
  fecha_compra: string;
  asignaciones: AsignacionParaLineaTiempo[];
  /** Entregas con lo que se conoce de cada una: lo asignado en estos embarques más lo que sigue sin embarque. */
  entregas: Map<string, { id: string; periodo: string; unidades: number }>;
};

const aEmbarqueParaLineaTiempo = (e: EmbarqueDetalleApi): EmbarqueParaLineaTiempo => ({
  id: e.id,
  codigo: e.codigo,
  nombre: e.nombre,
  origen: e.origen ?? null,
  periodo_llegada: e.periodo_llegada,
  tipo: e.tipo,
  estado: e.estado,
  fecha_salida_estimada: e.fecha_salida_estimada,
  fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
  fecha_llegada_estimada: e.fecha_llegada_estimada,
  fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
  hora_inicio_operativo: e.hora_inicio_operativo ?? null,
  fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
  fecha_llegada_real: e.fecha_llegada_real,
  hito_confirmado: e.hito_confirmado ?? null,
});

/** La fecha original y las reprogramaciones de cada hito del embarque, tal como las trae la API. */
const resumenDeEmbarque = (e: EmbarqueDetalleApi): ResumenHito[] =>
  (e.hitos ?? []).flatMap((h) => (h.hito === "orden_compra" ? [] : [{ hito: h.hito, fecha_original: h.fecha_original, reprogramaciones: h.reprogramaciones }]));

export function comprasParaLineaDeTiempo(args: { detalles: readonly EmbarqueDetalleApi[]; sinAsignar: SinAgrupadorApi | null; viajes: readonly ViajeApi[]; hoy: string }): CompraParaHojaLineaDeTiempo[] {
  const compras = new Map<string, CompraAcumulada>();
  const compra = (c: { id: string; numero: string; numero_oc?: string | null; proveedor: { nombre: string }; viaje_id: string | null; fecha_compra: string }): CompraAcumulada => {
    const previa = compras.get(c.id);
    if (previa) return previa;
    const nueva: CompraAcumulada = { numero: c.numero, numero_oc: c.numero_oc ?? null, proveedor: c.proveedor.nombre, viaje_id: c.viaje_id, fecha_compra: c.fecha_compra, asignaciones: [], entregas: new Map() };
    compras.set(c.id, nueva);
    return nueva;
  };
  const sumarEntrega = (c: CompraAcumulada, id: string, periodo: string, unidades: number) => {
    const e = c.entregas.get(id);
    if (e) e.unidades += unidades;
    else c.entregas.set(id, { id, periodo, unidades });
  };

  const embarques = args.detalles.map(aEmbarqueParaLineaTiempo);
  const paquetes: PaqueteParaLineaTiempo[] = args.detalles.flatMap((e) =>
    e.paquetes.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, fecha_ingreso_estimada: p.fecha_ingreso ?? null, periodo_ingreso: p.periodo_ingreso ?? null })),
  );
  const resumenes = new Map(args.detalles.map((e) => [e.id, resumenDeEmbarque(e)]));

  for (const e of args.detalles) {
    for (const a of e.asignaciones) {
      const c = compra(a.compra);
      c.asignaciones.push({ entrega_id: a.entrega_id, embarque_id: e.id, paquete_id: a.paquete_id, unidades: a.unidades });
      sumarEntrega(c, a.entrega_id, a.periodo, a.unidades);
    }
  }
  // Lo que sigue sin embarque (`sin_asignar` ya descuenta lo asignado en cualquier embarque).
  for (const s of args.sinAsignar?.entregas ?? []) {
    if (s.sin_asignar <= 0) continue;
    sumarEntrega(compra(s.compra), s.entrega_id, s.periodo, s.sin_asignar);
  }

  const codigoViaje = new Map(args.viajes.map((v) => [v.id, v.codigo]));
  return [...compras.values()].map((c) => ({
    numero: c.numero,
    numero_oc: c.numero_oc,
    proveedor: c.proveedor,
    viaje_codigo: c.viaje_id ? (codigoViaje.get(c.viaje_id) ?? null) : null,
    linea_de_tiempo: lineaDeTiempo({ fecha_compra: c.fecha_compra, entregas: [...c.entregas.values()] }, c.asignaciones, embarques, paquetes, args.hoy, resumenes),
  }));
}

/**
 * La causa del último cambio de fechas de cada embarque (columna ÚLTIMA CAUSA): la del evento `cambiar_fecha` más reciente que trae causa.
 * `eventos` viene del más antiguo al más reciente, como los da la API.
 */
export function ultimaCausaPorEmbarque(eventosPorEmbarque: ReadonlyMap<string, readonly Pick<EventoAgrupadorApi, "accion" | "causa">[]>): (embarqueId: string) => CausaFecha | null {
  return (id) => {
    const eventos = eventosPorEmbarque.get(id) ?? [];
    for (let i = eventos.length - 1; i >= 0; i--) if (eventos[i].accion === "cambiar_fecha" && eventos[i].causa) return eventos[i].causa ?? null;
    return null;
  };
}
