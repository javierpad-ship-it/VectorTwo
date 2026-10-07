/**
 * Formas JSON de la API de M1b (docs/modulos/01b-responsables.md, "Contratos
 * de API"). Describen el JSON que viaja, no las filas de la base; el frontend
 * tiene los mismos nombres en `tipos-api.ts` (estructuralmente idénticos). A
 * propósito no se importa nada de `@/components`: el backend no depende de la
 * pantalla.
 */
import type { Rol } from "@/lib/auth/roles";

// ─── Valores cerrados ───

/** Único rol que puede ser responsable de una combinación (respuesta 1 de Javier). */
export const ROL_RESPONSABLE: Rol = "comprador";

/**
 * Por qué una combinación vigente no tiene un responsable válido. La base solo
 * sabe si hay fila; el resto se calcula (`motivoFaltante`).
 */
export const MOTIVOS_FALTANTE_RESPONSABLE = [
  "sin_responsable",
  "responsable_inactivo",
  "responsable_no_comprador",
] as const;
export type MotivoFaltanteResponsable = (typeof MOTIVOS_FALTANTE_RESPONSABLE)[number];

// ─── Matriz (GET /api/responsables) ───

/** Género o mundo tal como lo muestra la matriz. */
export type CatalogoMatriz = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
};

/** El perfil asignado a una celda, con nombre y correo para todos los roles. */
export type ResponsableCelda = {
  id: string;
  nombre: string | null;
  email: string;
  rol: Rol;
  activo: boolean;
};

/** Una combinación género × mundo. `lineas` = nodos vigentes de la pareja. */
export type Celda = {
  genero_id: string;
  mundo_id: string;
  /** Género activo y mundo activo. Una celda no vigente nunca es faltante. */
  vigente: boolean;
  lineas: number;
  responsable: ResponsableCelda | null;
  faltante: boolean;
  motivo_faltante: MotivoFaltanteResponsable | null;
};

/** Comprador activo, asignable. Solo se devuelve a admin y planner. */
export type Comprador = {
  id: string;
  nombre: string | null;
  email: string;
};

export type CargaResponsable = {
  perfil_id: string;
  nombre: string | null;
  email: string;
  /** Celdas vigentes que tiene asignadas (válidas o no). */
  combinaciones: number;
  /** Activo y rol comprador. */
  valido: boolean;
};

export type ResumenResponsables = {
  /** Combinaciones vigentes: `con_responsable + faltantes`. */
  combinaciones: number;
  con_responsable: number;
  /** `faltantes_sin_responsable + faltantes_responsable_inactivo + faltantes_responsable_no_comprador`. */
  faltantes: number;
  faltantes_sin_responsable: number;
  faltantes_responsable_inactivo: number;
  faltantes_responsable_no_comprador: number;
  /** Informativo: cuántas de las faltantes están en combinaciones sin líneas vigentes. */
  faltantes_sin_lineas: number;
  /** De más a menos combinaciones y luego por nombre. */
  por_responsable: CargaResponsable[];
};

export type ReporteMatriz = {
  generos: CatalogoMatriz[];
  mundos: CatalogoMatriz[];
  /** Producto cartesiano de `generos` × `mundos`, ordenado por género y luego por mundo. */
  celdas: Celda[];
  /** `[]` para el rol comprador. */
  compradores: Comprador[];
  resumen: ResumenResponsables;
};

// ─── Asignación ───

/** Una combinación género × mundo, sin más. */
export type Combinacion = { genero_id: string; mundo_id: string };

/** `PUT /api/responsables`: la celda resultante. */
export type ResultadoAsignacionUna = Celda;

/** `POST /api/responsables/asignar`. */
export type ResultadoAsignacionMasiva = {
  /** Filas nuevas o cuyo responsable cambió. */
  asignadas: number;
  /** Filas borradas (con `perfil_id: null`). */
  quitadas: number;
  /** Ya tenían ese responsable (o no tenían y se pidió quitar). */
  sin_cambio: number;
  /** Saltadas por `solo_faltantes` (ya tenían un responsable válido). */
  con_responsable: number;
  /** Género o mundo borrado desde que se cargó la pantalla. */
  no_encontradas: Combinacion[];
  /** Género o mundo inactivo (solo al asignar). */
  no_vigentes: Combinacion[];
};

/** Ámbito de una asignación en bloque: una fila, una columna o toda la matriz. */
export type AmbitoBloque = { genero_id: string } | { mundo_id: string } | "todas";

/** Qué muestra el panel de bloque antes de aplicar. */
export type PlanBloque = {
  /** Combinaciones vigentes del ámbito: lo que se manda al servidor. */
  combinaciones: Combinacion[];
  /** Cuántas se asignarán (todas, o solo las faltantes con `soloFaltantes`). */
  a_asignar: number;
  /** Cuántas se respetan por tener ya un responsable válido (solo con `soloFaltantes`). */
  respetadas: number;
};

// ─── Filtros ───

export type FiltroCeldas = "todas" | "faltantes" | "sin_responsable" | { responsable: string };

// ─── /usuarios ───

export type AccionUsuarioConResponsabilidades = "desactivar" | "eliminar" | "cambiar_rol";

/** Respuesta de `DELETE /api/usuarios/[id]`. */
export type UsuarioEliminado = { id: string; combinaciones_liberadas: number };
