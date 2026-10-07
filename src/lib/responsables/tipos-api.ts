/**
 * Vista de la API de M1b para el frontend (docs/modulos/01b-responsables.md,
 * "Contratos de API"). Describe el JSON que viaja; es estructuralmente igual
 * a lo que arma el backend en `tipos.ts`. A propósito no se importa nada de
 * `./tipos`: la pantalla no depende de los módulos de servidor.
 */
import type { Rol } from "@/lib/auth/roles";

export type MotivoFaltante = "sin_responsable" | "responsable_inactivo" | "responsable_no_comprador";

export type GeneroResponsables = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };
export type MundoResponsables = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };

/** Perfil asignado a una celda (con nombre y correo para todos los roles). */
export type ResponsableCelda = {
  id: string;
  nombre: string | null;
  email: string;
  rol: Rol;
  activo: boolean;
};

/** Una combinación género × mundo. */
export type CeldaResponsable = {
  genero_id: string;
  mundo_id: string;
  /** Género y mundo activos. Una celda no vigente nunca es faltante. */
  vigente: boolean;
  /** Nodos vigentes de la pareja (contexto de pantalla; no entra en "faltante"). */
  lineas: number;
  responsable: ResponsableCelda | null;
  faltante: boolean;
  motivo_faltante: MotivoFaltante | null;
};

/** Comprador activo asignable. Llega `[]` para el rol comprador. */
export type CompradorAsignable = { id: string; nombre: string | null; email: string };

export type CargaResponsable = {
  perfil_id: string;
  nombre: string | null;
  email: string;
  combinaciones: number;
  /** Activo y con rol comprador. */
  valido: boolean;
};

export type ResumenResponsables = {
  combinaciones: number;
  con_responsable: number;
  faltantes: number;
  faltantes_sin_responsable: number;
  faltantes_responsable_inactivo: number;
  faltantes_responsable_no_comprador: number;
  faltantes_sin_lineas: number;
  por_responsable: CargaResponsable[];
};

/** `GET /api/responsables` */
export type MatrizResponsables = {
  generos: GeneroResponsables[];
  mundos: MundoResponsables[];
  celdas: CeldaResponsable[];
  compradores: CompradorAsignable[];
  resumen: ResumenResponsables;
};

// ─── Cuerpos y respuestas de escritura ───

/** `PUT /api/responsables` (responde la `CeldaResponsable` resultante). */
export type AsignarUnaCuerpo = { genero_id: string; mundo_id: string; perfil_id: string | null };

export type CombinacionRef = { genero_id: string; mundo_id: string };

/** `POST /api/responsables/asignar` */
export type AsignarMasivaCuerpo = {
  combinaciones: CombinacionRef[];
  perfil_id: string | null;
  solo_faltantes: boolean;
};

export type ResultadoAsignarMasiva = {
  asignadas: number;
  quitadas: number;
  sin_cambio: number;
  con_responsable: number;
  no_encontradas: CombinacionRef[];
  no_vigentes: CombinacionRef[];
};

/** `DELETE /api/usuarios/[id]` */
export type EliminarUsuarioRespuesta = { id: string; combinaciones_liberadas: number };
