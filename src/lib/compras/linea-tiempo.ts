import type { Tables } from "@/lib/supabase/database.types";
import { lineaDeTiempo, proximoHito, type AsignacionParaLineaTiempo, type EmbarqueParaLineaTiempo, type PaqueteParaLineaTiempo, type ResumenHito } from "./agrupadores/hitos";
import { periodoLlegada } from "./agrupadores/movimiento";
import { HITOS_CONFIRMABLES, TIPOS_EMBARQUE, ESTADOS_EMBARQUE } from "./agrupadores/tipos";
import { mesDe } from "./reglas";
import type { ProximoHitoCompraApi } from "./tipos-api";
import type { TramoLineaTiempoApi } from "./agrupadores/tipos-api";

/**
 * Línea de tiempo y próximo hito de las COMPRAS (ficha 08b-1b §3.4). Puro: convierte las filas de `compra_embarques` y `compra_paquetes`
 * a lo que `lineaDeTiempo` y `proximoHito` (de `agrupadores/hitos.ts`) necesitan y arma, por compra, los tramos desde un ÍNDICE que se lee
 * UNA vez para todas las compras (sin N+1). El estado de cada hito depende de `hoy` (hora de Lima), que llega por parámetro.
 */

type EmbarqueFila = Tables<"compra_embarques">;
type PaqueteFila = Tables<"compra_paquetes">;
type AsignacionFila = Pick<Tables<"compra_entrega_asignaciones">, "entrega_id" | "embarque_id" | "paquete_id" | "unidades">;

/** Lo que `lineaDeTiempo` lee de un embarque. La misma regla que la columna generada `periodo_llegada` (la fila de prueba puede no traerla). */
export function embarqueParaLineaTiempo(e: EmbarqueFila): EmbarqueParaLineaTiempo {
  return {
    id: e.id,
    codigo: e.codigo,
    nombre: e.nombre,
    tipo: TIPOS_EMBARQUE.find((t) => t === e.tipo) ?? "importacion",
    estado: ESTADOS_EMBARQUE.find((s) => s === e.estado) ?? "planificado",
    origen: e.origen ?? null,
    fecha_salida_estimada: e.fecha_salida_estimada ?? null,
    fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
    fecha_llegada_estimada: e.fecha_llegada_estimada,
    fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
    hora_inicio_operativo: e.hora_inicio_operativo?.slice(0, 5) ?? null,
    fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
    fecha_llegada_real: e.fecha_llegada_real ?? null,
    hito_confirmado: HITOS_CONFIRMABLES.find((h) => h === e.hito_confirmado) ?? null,
    periodo_llegada: periodoLlegada(e.fecha_llegada_real, e.fecha_ingreso_estimada, e.fecha_llegada_estimada),
  };
}

export function paqueteParaLineaTiempo(p: PaqueteFila): PaqueteParaLineaTiempo {
  return { id: p.id, codigo: p.codigo, nombre: p.nombre, fecha_ingreso_estimada: p.fecha_ingreso_estimada ?? null, periodo_ingreso: p.periodo_ingreso ? mesDe(p.periodo_ingreso) : null };
}

/** Los embarques, paquetes y asignaciones de TODAS las compras, indexados una sola vez. */
export type IndiceLineaTiempo = {
  embarques: ReadonlyMap<string, EmbarqueParaLineaTiempo>;
  paquetes: ReadonlyMap<string, PaqueteParaLineaTiempo>;
  porEntrega: ReadonlyMap<string, readonly AsignacionParaLineaTiempo[]>;
  /** `agrupador_hitos_resumen` por embarque (solo el detalle lo trae: fecha original y reprogramaciones). */
  resumenes?: ReadonlyMap<string, readonly ResumenHito[]>;
};

export function indexarLineaTiempo(datos: { embarques: readonly EmbarqueFila[]; paquetes: readonly PaqueteFila[]; asignaciones: readonly AsignacionFila[] }): IndiceLineaTiempo {
  const porEntrega = new Map<string, AsignacionParaLineaTiempo[]>();
  for (const a of datos.asignaciones) {
    const l = porEntrega.get(a.entrega_id);
    if (l) l.push(a);
    else porEntrega.set(a.entrega_id, [a]);
  }
  return { embarques: new Map(datos.embarques.map((e) => [e.id, embarqueParaLineaTiempo(e)])), paquetes: new Map(datos.paquetes.map((p) => [p.id, paqueteParaLineaTiempo(p)])), porEntrega };
}

/** Los ids de los embarques a los que viajan las entregas dadas (para pedir su resumen de hitos solo de esos). */
export function embarquesDeEntregas(ix: Pick<IndiceLineaTiempo, "porEntrega">, entregaIds: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const id of entregaIds) for (const a of ix.porEntrega.get(id) ?? []) ids.add(a.embarque_id);
  return [...ids];
}

/** Los tramos de UNA compra (con su tramo «Sin embarque» por mes) y su próximo hito. `entregas` son las de sus líneas ACTIVAS. */
export function tiempoDeCompra(
  compra: { fecha_compra: string; entregas: readonly { id: string; periodo: string; unidades: number }[] },
  ix: IndiceLineaTiempo,
  hoy: string,
): { linea_de_tiempo: TramoLineaTiempoApi[]; proximo_hito: ProximoHitoCompraApi | null } {
  const asignaciones = compra.entregas.flatMap((e) => ix.porEntrega.get(e.id) ?? []);
  const embarques = [...new Set(asignaciones.map((a) => a.embarque_id))].flatMap((id) => ix.embarques.get(id) ?? []);
  const paquetes = [...new Set(asignaciones.flatMap((a) => (a.paquete_id ? [a.paquete_id] : [])))].flatMap((id) => ix.paquetes.get(id) ?? []);
  const linea_de_tiempo = lineaDeTiempo({ fecha_compra: compra.fecha_compra, entregas: compra.entregas }, asignaciones, embarques, paquetes, hoy, ix.resumenes);
  return { linea_de_tiempo, proximo_hito: proximoHito(linea_de_tiempo) };
}
