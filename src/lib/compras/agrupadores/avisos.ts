import type { Mes } from "@/lib/compras/tipos";
import { estadoHito } from "./hitos";
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
  /**
   * Mes de destino de la asignación: `mesDeDestino(embarque, paquete de la asignación)` (08b-1b §2.4 bis), que calcula `consultas.ts`. Sin
   * él (quien no lo conozca) se compara contra el mes del embarque, como en 08b-1.
   */
  periodo_destino?: Mes;
};

const enOrden = (avisos: Iterable<AvisoAgrupador>): AvisoAgrupador[] => {
  const s = new Set(avisos);
  return AVISOS_AGRUPADOR.filter((a) => s.has(a));
};

/** El ingreso al stock del embarque está `vencido` (no `por_confirmar`); con los campos nuevos ausentes se comporta como 08b-1 (la llegada al CD ya pasó). */
function ingresoVencido(e: Pick<EmbarqueRegistro, "estado" | "fecha_llegada_estimada"> & Partial<Pick<EmbarqueRegistro, "tipo" | "fecha_salida_estimada" | "fecha_puerto_estimada" | "fecha_inicio_operativo_estimada" | "hora_inicio_operativo" | "fecha_ingreso_estimada" | "fecha_llegada_real" | "hito_confirmado">>, hoy: string): boolean {
  return (
    estadoHito(
      "ingreso_stock",
      {
        tipo: e.tipo ?? "importacion",
        estado: e.estado,
        fecha_salida_estimada: e.fecha_salida_estimada ?? null,
        fecha_puerto_estimada: e.fecha_puerto_estimada ?? null,
        fecha_llegada_estimada: e.fecha_llegada_estimada,
        fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada ?? null,
        hora_inicio_operativo: e.hora_inicio_operativo ?? null,
        fecha_ingreso_estimada: e.fecha_ingreso_estimada ?? null,
        fecha_llegada_real: e.fecha_llegada_real ?? null,
        hito_confirmado: e.hito_confirmado ?? null,
      },
      hoy,
    ) === "vencido"
  );
}

/** `sin_responsable` del viaje: el propio no es asignable, o falta (solo si se borró el perfil). */
export function avisosViaje(responsable: ResponsableCalculado): AvisoAgrupador[] {
  return responsable.faltante ? ["sin_responsable"] : [];
}

/**
 * Avisos de un embarque. `asignaciones` son las suyas (activas e históricas). `atrasado`: sigue sin recibirse (`planificado` o
 * `en_transito`) y su INGRESO AL STOCK está `vencido` (fecha efectiva anterior a hoy, sin ingreso real y sin que la mercadería figure ya
 * en el CD: un ingreso `por_confirmar` no es atraso; 08b-1b §2.2); `en_embarque_cancelado`: cancelado con asignaciones activas (se ofrece
 * «Quitar del embarque»); `desalineada`: alguna asignación activa no está en su mes de destino (se ofrece «Realinear»). Los avisos de los
 * demás hitos (`hito_vencido`) los da `avisosDeHitos` de `hitos.ts`.
 */
export function avisosEmbarque(entrada: {
  embarque: Pick<EmbarqueRegistro, "estado" | "fecha_llegada_estimada" | "periodo_llegada"> &
    Partial<Pick<EmbarqueRegistro, "tipo" | "fecha_salida_estimada" | "fecha_puerto_estimada" | "fecha_inicio_operativo_estimada" | "hora_inicio_operativo" | "fecha_ingreso_estimada" | "fecha_llegada_real" | "hito_confirmado">>;
  viaje: Pick<ViajeRegistro, "estado"> | null;
  responsable: ResponsableCalculado;
  asignaciones: readonly AsignacionParaAviso[];
  hoy: string;
}): AvisoAgrupador[] {
  const { embarque, viaje, responsable, asignaciones, hoy } = entrada;
  const avisos: AvisoAgrupador[] = [];
  const activas = asignaciones.filter((a) => !a.historica);
  if (responsable.faltante) avisos.push("sin_responsable");
  if ((embarque.estado === "planificado" || embarque.estado === "en_transito") && ingresoVencido(embarque, hoy)) avisos.push("atrasado");
  if (viaje?.estado === "cerrado") avisos.push("viaje_cerrado");
  if (embarque.estado === "cancelado" && activas.length > 0) avisos.push("en_embarque_cancelado");
  if (activas.some((a) => estaDesalineada(a.periodo, a.periodo_destino ?? embarque.periodo_llegada))) avisos.push("desalineada");
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
  if (asignaciones.filter((a) => !a.historica).some((a) => estaDesalineada(a.periodo, a.periodo_destino ?? embarque.periodo_llegada))) avisos.push("desalineada");
  if (asignaciones.some((a) => a.historica)) avisos.push("asignaciones_historicas");
  return enOrden(avisos);
}

/** «El viaje 261001 está cerrado: igual se registra» (decisión 95): el aviso de toda operación sobre un viaje cerrado. */
export function avisoViajeCerrado(viaje: Pick<ViajeRegistro, "codigo" | "estado">): AvisoDetalleApi | null {
  return viaje.estado === "cerrado" ? { aviso: "viaje_cerrado", detalle: `El viaje ${viaje.codigo} está cerrado: igual se registra.` } : null;
}
