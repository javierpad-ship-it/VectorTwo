import {
  ACCIONES_ESTADO_POR_TIPO,
  type AccionEstado,
  type EstadoEmbarque,
  type EstadoPaquete,
  type EstadoViaje,
  type OperacionMovimiento,
  type TipoAgrupador,
} from "./tipos";

/**
 * Estados y transiciones de los agrupadores (ficha 08b, R13, decisión 95). Puro: dice qué cambio de estado admite cada estado y qué
 * operaciones admite un embarque según el suyo; la función SQL `cambiar_estado_agrupador` y los guards hacen lo mismo con los datos.
 *
 *  - Viaje: `abierto ⇄ cerrado` (solo admin y planner; un viaje cerrado NO bloquea nada: solo avisa `viaje_cerrado`);
 *    `→ cancelado` solo sin compras no canceladas ni embarques no cancelados; `cancelado` es inmutable y bloquea (`viaje_cancelado`).
 *  - Embarque: `planificado ⇄ en_transito`; `→ recibido` solo al recibir (08b-2); `recibido → en_transito` solo al revertir (08b-2);
 *    `→ cancelado` solo sin asignaciones activas ni recepciones vinculadas.
 *  - Paquete: `abierto → cancelado` solo sin asignaciones activas.
 *  - Cancelar es irreversible y exige motivo (`motivo_requerido`); el resto no lo pide.
 */

export type MotivoTransicionAgrupador = "transicion_invalida" | "tiene_asignaciones_activas" | "tiene_compras" | "tiene_recepciones" | "motivo_requerido";

export type ResultadoTransicionAgrupador<E extends string> = { ok: true; hacia: E } | { ok: false; motivo: MotivoTransicionAgrupador };

const invalida = { ok: false, motivo: "transicion_invalida" } as const;
const sinMotivo = (motivo: string | undefined | null): boolean => (motivo ?? "").trim() === "";

/** `true` si la acción existe para ese tipo (el paquete solo admite `cancelar`). */
export const accionAdmitidaPorTipo = (tipo: TipoAgrupador, accion: AccionEstado): boolean => ACCIONES_ESTADO_POR_TIPO[tipo].includes(accion);

export type ContextoViaje = {
  /** Compras del viaje que no están canceladas. */
  compras_no_canceladas: number;
  /** Embarques del viaje que no están cancelados. */
  embarques_no_cancelados: number;
  motivo?: string | null;
};

/** R13 · viaje. `cancelar` exige motivo y que no queden compras ni embarques sin cancelar. */
export function transicionViaje(estado: EstadoViaje, accion: AccionEstado, ctx: ContextoViaje): ResultadoTransicionAgrupador<EstadoViaje> {
  if (!accionAdmitidaPorTipo("viaje", accion) || estado === "cancelado") return invalida;
  switch (accion) {
    case "cerrar":
      return estado === "abierto" ? { ok: true, hacia: "cerrado" } : invalida;
    case "reabrir":
      return estado === "cerrado" ? { ok: true, hacia: "abierto" } : invalida;
    case "cancelar":
      if (sinMotivo(ctx.motivo)) return { ok: false, motivo: "motivo_requerido" };
      if (ctx.compras_no_canceladas > 0 || ctx.embarques_no_cancelados > 0) return { ok: false, motivo: "tiene_compras" };
      return { ok: true, hacia: "cancelado" };
    default:
      return invalida;
  }
}

export type ContextoEmbarque = {
  /** Asignaciones activas (no históricas) del embarque. */
  asignaciones_activas: number;
  /** Recepciones vinculadas a asignaciones del embarque (08b-2; en 08b-1 siempre 0). */
  recepciones_vinculadas: number;
  motivo?: string | null;
};

/**
 * R13 · embarque. `recibido` no se alcanza por aquí: llega con `recibir_embarque` y se deshace con `revertir_recepcion_embarque`
 * (08b-2). `cancelar` desde `recibido` solo si no queda nada activo ni vinculado.
 */
export function transicionEmbarque(estado: EstadoEmbarque, accion: AccionEstado, ctx: ContextoEmbarque): ResultadoTransicionAgrupador<EstadoEmbarque> {
  if (!accionAdmitidaPorTipo("embarque", accion) || estado === "cancelado") return invalida;
  switch (accion) {
    case "en_transito":
      return estado === "planificado" ? { ok: true, hacia: "en_transito" } : invalida;
    case "volver_a_planificado":
      return estado === "en_transito" ? { ok: true, hacia: "planificado" } : invalida;
    case "cancelar":
      if (sinMotivo(ctx.motivo)) return { ok: false, motivo: "motivo_requerido" };
      if (ctx.recepciones_vinculadas > 0) return { ok: false, motivo: "tiene_recepciones" };
      if (ctx.asignaciones_activas > 0) return { ok: false, motivo: "tiene_asignaciones_activas" };
      return { ok: true, hacia: "cancelado" };
    default:
      return invalida;
  }
}

export type ContextoPaquete = { asignaciones_activas: number; motivo?: string | null };

/** R13 · paquete: `abierto → cancelado` solo sin asignaciones activas. */
export function transicionPaquete(estado: EstadoPaquete, accion: AccionEstado, ctx: ContextoPaquete): ResultadoTransicionAgrupador<EstadoPaquete> {
  if (!accionAdmitidaPorTipo("paquete", accion) || estado === "cancelado") return invalida;
  if (sinMotivo(ctx.motivo)) return { ok: false, motivo: "motivo_requerido" };
  if (ctx.asignaciones_activas > 0) return { ok: false, motivo: "tiene_asignaciones_activas" };
  return { ok: true, hacia: "cancelado" };
}

// ─── Validación de un embarque que se guarda (caso 10) ───

export type MotivoValidacionEmbarque = "fecha_por_movimiento" | "local_con_viaje" | "salida_despues_de_llegada";

/**
 * Lo que la función `guardar_embarque` comprueba con la base y responde `409` (no `400`, porque la llegada vigente vive en la base):
 * al EDITAR no se manda `fecha_llegada_estimada` (va por movimiento: `fecha_por_movimiento`); un `local` no lleva viaje
 * (`local_con_viaje`); la salida no puede ser posterior a la llegada (`salida_despues_de_llegada`; la llegada es la nueva al crear y la
 * vigente al editar). Devuelve `null` si todo está bien.
 */
export function validarGuardarEmbarque(
  entrada: { tipo: "importacion" | "local"; viaje_id: string | null; fecha_salida_estimada?: string | null; fecha_llegada_estimada?: string },
  vigente: { fecha_llegada_estimada: string } | null,
): MotivoValidacionEmbarque | null {
  if (vigente !== null && entrada.fecha_llegada_estimada !== undefined) return "fecha_por_movimiento";
  if (entrada.tipo === "local" && entrada.viaje_id !== null) return "local_con_viaje";
  const llegada = vigente !== null ? vigente.fecha_llegada_estimada : entrada.fecha_llegada_estimada;
  if (llegada !== undefined && entrada.fecha_salida_estimada != null && entrada.fecha_salida_estimada > llegada) return "salida_despues_de_llegada";
  return null;
}

// ─── Qué admite cada estado ───

/** Un viaje o un embarque cancelado no admite ningún cambio; un viaje cerrado sí (decisión 95). */
export const viajeEditable = (estado: EstadoViaje): boolean => estado !== "cancelado";
/** Editar nombre, responsable, puerto, referencia, salida y nota: todo menos un embarque cancelado. */
export const embarqueEditable = (estado: EstadoEmbarque): boolean => estado !== "cancelado";
/** Crear o editar un paquete: el embarque no puede estar cancelado ni recibido (`embarque_no_editable`) ni el paquete cancelado. */
export const embarqueAdmitePaquetes = (estado: EstadoEmbarque): boolean => estado === "planificado" || estado === "en_transito";
export const paqueteEditable = (estado: EstadoPaquete): boolean => estado === "abierto";
/** Un viaje cancelado bloquea asignarle compras y crearle embarques (`viaje_cancelado`); uno cerrado no. */
export const viajeAdmiteCompras = (estado: EstadoViaje): boolean => estado !== "cancelado";

const EN_CURSO: readonly EstadoEmbarque[] = ["planificado", "en_transito"];

/**
 * R13 · qué operaciones de movimiento admite un embarque como ORIGEN según su estado (`embarque_no_editable` si no):
 *  - `quitar` siempre (también `cancelado` y `recibido`: es la salida de lo que quedó activo, B1);
 *  - `asignar`, `mover_a_paquete`, `cambiar_fecha`, `mover_paquete` solo `planificado` y `en_transito`;
 *  - `pasar_pendientes` también desde `recibido`;
 *  - 08b-2: `recibir` desde `planificado` o `en_transito`; `otra_llegada` y `revertir_recepcion` desde `recibido`.
 */
export function embarqueAdmiteOperacion(estado: EstadoEmbarque, operacion: OperacionMovimiento): boolean {
  switch (operacion) {
    case "quitar":
      return true;
    case "asignar":
    case "mover_a_paquete":
    case "cambiar_fecha":
    case "mover_paquete":
    case "recibir":
      return EN_CURSO.includes(estado);
    case "pasar_pendientes":
      return EN_CURSO.includes(estado) || estado === "recibido";
    case "otra_llegada":
    case "revertir_recepcion":
      return estado === "recibido";
  }
}

/** Un embarque admite recibir mercadería nueva (destino de asignar, de pasar pendientes o de mover un paquete) solo en curso. */
export const embarqueAdmiteComoDestino = (estado: EstadoEmbarque): boolean => EN_CURSO.includes(estado);
