import type { Rol } from "@/lib/auth/roles";
import { ACCIONES_ESTADO_SOLO_PLANNER, type AccionEstado } from "./tipos";

/**
 * Permisos de los agrupadores de compras (ficha 08b, §0.3, R15, decisiones 92 y 95). Pura.
 *
 * El permiso es POR ROL, no por responsable (matiz de la decisión 28): cualquier comprador edita cualquier agrupador, sea o no su
 * responsable. «Mis…» es un filtro. Hasta M9a el comprador escribe SOLO las funciones de agrupadores (adelanto de la decisión 92).
 *  - Los tres roles (`requireUser`): leer, Excel, viaje activo; crear, editar e importar viajes, embarques y paquetes (también de un
 *    viaje cerrado); cambiar fecha de salida y de llegada; asignar o quitar compras de un viaje abierto o cerrado; asignar, quitar o
 *    mover entregas; pasar pendientes; mover un paquete; marcar en tránsito; recibir un embarque (08b-2).
 *  - Solo admin y planner (`requirePlanner`): cerrar, reabrir y cancelar un viaje, un embarque o un paquete; volver de recibido a
 *    en tránsito (08b-2).
 * El guard de la ruta es la barrera real; esto sirve para que la pantalla oculte lo que daría `403` y para probar la tabla.
 */

export type AccionAgrupadorPermiso =
  | "leer"
  | "excel"
  | "viaje_activo"
  | "guardar_viaje"
  | "guardar_embarque"
  | "guardar_paquete"
  | "importar_agrupadores"
  | "asignar_compras_viaje"
  | "movimiento_entregas"
  | "cambiar_fecha"
  | "marcar_en_transito"
  | "recibir_embarque"
  | "cerrar_viaje"
  | "reabrir_viaje"
  | "cancelar"
  | "revertir_recepcion";

/** Qué guard exige cada acción. */
export type GuardAgrupador = "requireUser" | "requirePlanner";

export const GUARD_POR_ACCION: Record<AccionAgrupadorPermiso, GuardAgrupador> = {
  leer: "requireUser",
  excel: "requireUser",
  viaje_activo: "requireUser",
  guardar_viaje: "requireUser",
  guardar_embarque: "requireUser",
  guardar_paquete: "requireUser",
  importar_agrupadores: "requireUser",
  asignar_compras_viaje: "requireUser",
  movimiento_entregas: "requireUser",
  cambiar_fecha: "requireUser",
  marcar_en_transito: "requireUser",
  recibir_embarque: "requireUser",
  cerrar_viaje: "requirePlanner",
  reabrir_viaje: "requirePlanner",
  cancelar: "requirePlanner",
  revertir_recepcion: "requirePlanner",
};

const esPlannerOAdmin = (rol: Rol): boolean => rol === "admin" || rol === "planner";

/** `true` si el rol puede hacer la acción (R15). */
export function puedeAgrupador(rol: Rol, accion: AccionAgrupadorPermiso): boolean {
  return GUARD_POR_ACCION[accion] === "requireUser" ? true : esPlannerOAdmin(rol);
}

/**
 * Guard de `POST …/estado`: cerrar, reabrir y cancelar piden `requirePlanner`; `en_transito` y `volver_a_planificado`, `requireUser`.
 * Como la ruta recibe la acción en el cuerpo, pone `requireUser` primero y devuelve `403` si `puedeCambiarEstado` da `false`.
 */
export const guardDeAccionEstado = (accion: AccionEstado): GuardAgrupador => (ACCIONES_ESTADO_SOLO_PLANNER.includes(accion) ? "requirePlanner" : "requireUser");

export const puedeCambiarEstado = (rol: Rol, accion: AccionEstado): boolean => (guardDeAccionEstado(accion) === "requireUser" ? true : esPlannerOAdmin(rol));

/** La acción de permiso de un cambio de estado de un viaje, un embarque o un paquete (para `puedeAgrupador`). */
export function accionPermisoDeEstado(accion: AccionEstado): AccionAgrupadorPermiso {
  switch (accion) {
    case "cerrar":
      return "cerrar_viaje";
    case "reabrir":
      return "reabrir_viaje";
    case "cancelar":
      return "cancelar";
    case "en_transito":
    case "volver_a_planificado":
      return "marcar_en_transito";
  }
}

/** Lo que la pantalla muestra a cada rol (botones). */
export type PermisosAgrupadoresApi = {
  crear_y_editar: boolean;
  importar: boolean;
  cambiar_fechas: boolean;
  asignar: boolean;
  recibir: boolean;
  cerrar_reabrir: boolean;
  cancelar: boolean;
  revertir_recepcion: boolean;
};

export function permisosAgrupadores(rol: Rol): PermisosAgrupadoresApi {
  return {
    crear_y_editar: puedeAgrupador(rol, "guardar_embarque"),
    importar: puedeAgrupador(rol, "importar_agrupadores"),
    cambiar_fechas: puedeAgrupador(rol, "cambiar_fecha"),
    asignar: puedeAgrupador(rol, "movimiento_entregas"),
    recibir: puedeAgrupador(rol, "recibir_embarque"),
    cerrar_reabrir: puedeAgrupador(rol, "cerrar_viaje"),
    cancelar: puedeAgrupador(rol, "cancelar"),
    revertir_recepcion: puedeAgrupador(rol, "revertir_recepcion"),
  };
}
