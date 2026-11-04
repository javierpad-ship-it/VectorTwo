import type { Mes } from "@/lib/compras/tipos";
import { estaDesalineada } from "./movimiento";
import type { ResponsableCalculado } from "./responsable";
import type { AvisoDetalleApi } from "./tipos-api";
import { AVISOS_AGRUPADOR, type AvisoAgrupador, type EmbarqueRegistro, type PaqueteRegistro, type ViajeRegistro } from "./tipos";

/**
 * Avisos de los agrupadores en las listas y el detalle (ficha 08b, §3.2, R12, R13): `sin_responsable`, `atrasado`, `viaje_cerrado`,
 * `desalineada`, `asignaciones_historicas`, `linea_recibida`, `en_embarque_cancelado`. Los avisos propios de un movimiento
 * (`viaje_distinto`, `cambia_temporada`, `fecha_en_mes_cerrado`, `llegada_antes_de_compra`, `entregas_fusionadas`) los calcula
 * `planificarMovimiento` en `movimiento.ts`. Ningún aviso bloquea nada. Puro; `hoy` entra como parámetro (`aaaa-mm-dd`, Lima).
 */

/** Lo que cada asignación aporta a los avisos de su embarque y su paquete (la API lo arma con `clasificarAsignacion`). */
export type AsignacionParaAviso = {
  /** Mes de su entrega. */
  periodo: Mes;
  historica: boolean;
  /** Línea recibida al 100 % en una compra todavía `confirmada`. */
  linea_recibida: boolean;
  /** Paquete de la asignación (nulo = sin paquete). */
  paquete_id?: string | null;
};

const enOrden = (avisos: Iterable<AvisoAgrupador>): AvisoAgrupador[] => {
  const s = new Set(avisos);
  return AVISOS_AGRUPADOR.filter((a) => s.has(a));
};

/** `sin_responsable` del viaje: el propio no es asignable, o falta (solo si se borró el perfil). */
export function avisosViaje(responsable: ResponsableCalculado): AvisoAgrupador[] {
  return responsable.faltante ? ["sin_responsable"] : [];
}

/**
 * Avisos de un embarque. `asignaciones` son las suyas (activas e históricas). `atrasado`: sigue sin recibirse (`planificado` o
 * `en_transito`) y su llegada estimada ya pasó; `en_embarque_cancelado`: cancelado con asignaciones activas (se ofrece «Quitar del
 * embarque»); `desalineada`: alguna asignación activa no está en el mes de llegada (se ofrece «Realinear»).
 */
export function avisosEmbarque(entrada: {
  embarque: Pick<EmbarqueRegistro, "estado" | "fecha_llegada_estimada" | "periodo_llegada">;
  viaje: Pick<ViajeRegistro, "estado"> | null;
  responsable: ResponsableCalculado;
  asignaciones: readonly AsignacionParaAviso[];
  hoy: string;
}): AvisoAgrupador[] {
  const { embarque, viaje, responsable, asignaciones, hoy } = entrada;
  const avisos: AvisoAgrupador[] = [];
  const activas = asignaciones.filter((a) => !a.historica);
  if (responsable.faltante) avisos.push("sin_responsable");
  if ((embarque.estado === "planificado" || embarque.estado === "en_transito") && embarque.fecha_llegada_estimada < hoy) avisos.push("atrasado");
  if (viaje?.estado === "cerrado") avisos.push("viaje_cerrado");
  if (embarque.estado === "cancelado" && activas.length > 0) avisos.push("en_embarque_cancelado");
  if (activas.some((a) => estaDesalineada(a.periodo, embarque.periodo_llegada))) avisos.push("desalineada");
  if (asignaciones.some((a) => a.historica)) avisos.push("asignaciones_historicas");
  if (asignaciones.some((a) => a.linea_recibida)) avisos.push("linea_recibida");
  return enOrden(avisos);
}

/** Avisos de un paquete: `sin_responsable` (efectivo faltante) y, con sus asignaciones, `desalineada` e históricas. */
export function avisosPaquete(entrada: {
  paquete: Pick<PaqueteRegistro, "estado">;
  embarque: Pick<EmbarqueRegistro, "periodo_llegada">;
  responsable: ResponsableCalculado;
  asignaciones: readonly AsignacionParaAviso[];
}): AvisoAgrupador[] {
  const { responsable, asignaciones, embarque } = entrada;
  const avisos: AvisoAgrupador[] = [];
  if (responsable.faltante) avisos.push("sin_responsable");
  if (asignaciones.filter((a) => !a.historica).some((a) => estaDesalineada(a.periodo, embarque.periodo_llegada))) avisos.push("desalineada");
  if (asignaciones.some((a) => a.historica)) avisos.push("asignaciones_historicas");
  return enOrden(avisos);
}

/** «El viaje 261001 está cerrado: igual se registra» (decisión 95): el aviso de toda operación sobre un viaje cerrado. */
export function avisoViajeCerrado(viaje: Pick<ViajeRegistro, "codigo" | "estado">): AvisoDetalleApi | null {
  return viaje.estado === "cerrado" ? { aviso: "viaje_cerrado", detalle: `El viaje ${viaje.codigo} está cerrado: igual se registra.` } : null;
}
