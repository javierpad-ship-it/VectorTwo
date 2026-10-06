/**
 * Vista de la API de M3 para el frontend (docs/modulos/03-agrupaciones-estacionalidad.md,
 * "Contratos de API"). Describe el JSON que viaja, no las filas de la base;
 * el backend puede tipar sus respuestas con estos nombres o re-exportarlos
 * desde `tipos.ts`. No importa de `./tipos` a propósito (mismo criterio que M2).
 */
import type { Temporada } from "@/lib/arbol/normalizar";
import type { ModoImportacion } from "@/components/importador/tipos";

export type { ModoImportacion };

// ─── Catálogo (GET /api/agrupaciones-estacionalidad) ───

/** Género de una agrupación tal como viaja en el listado (por `orden, nombre`). */
export type GeneroDeAgrupacion = { id: string; codigo: string; nombre: string };

/**
 * Fila de `agrupaciones_estacionalidad` en el listado, con el conteo de
 * equivalencias asignadas (activas o no) y los géneros a los que pertenece
 * (una agrupación pertenece a uno o más géneros; sin ninguno no admite
 * asignaciones).
 */
export type AgrupacionEstacionalidadFila = {
  id: string;
  codigo: string;
  nombre: string;
  /** Texto libre (≤ 500); `null` si está vacía. */
  descripcion: string | null;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
  /** Equivalencias que apuntan a ella, activas o no. */
  equivalencias: number;
  /** Solo las activas (lo que pasa a faltante al desactivar). */
  equivalencias_activas: number;
  /** Ids de los géneros de la agrupación; vacío = "sin género". */
  genero_ids: string[];
  /** Los mismos géneros con nombre, por `orden, nombre`. */
  generos: GeneroDeAgrupacion[];
};

/** La agrupación tal como viaja embebida en cada equivalencia de la lista plana. */
export type AgrupacionEstacionalidadEmbebida = Pick<AgrupacionEstacionalidadFila, "id" | "codigo" | "nombre" | "activo">;

/** La agrupación tal como viaja en `GET /api/arbol` dentro de cada equivalencia. */
export type AgrupacionEstacionalidadArbol = Pick<AgrupacionEstacionalidadFila, "id" | "nombre" | "activo">;

export type CrearAgrupacionEstacionalidadCuerpo = {
  nombre: string;
  codigo?: string;
  descripcion?: string | null;
  orden?: number;
  /** Mínimo uno (`400` si falta o va vacío). */
  genero_ids: string[];
};

export type EditarAgrupacionEstacionalidadCuerpo = Partial<{
  nombre: string;
  codigo: string;
  descripcion: string | null;
  orden: number;
  activo: boolean;
  /** Reemplaza el conjunto de géneros; mínimo uno. */
  genero_ids: string[];
}>;

// ─── Equivalencias: asignación individual (PATCH /api/equivalencias/[id]) ───

export type AsignarEquivalenciaCuerpo = { agrupacion_estacionalidad_id: string | null };

// ─── Asignación masiva (POST /api/estacionalidad/asignar) ───

export type AsignarCuerpo = {
  /** `null` quita la agrupación a todas. */
  agrupacion_id: string | null;
  /** 1 a 2 000 ids. */
  equivalencia_ids: string[];
};

export type AsignarRespuesta = {
  asignadas: number;
  /** Ya tenían esa agrupación. */
  sin_cambio: number;
  /** Ids que no existen (la pantalla tenía datos viejos); no abortan la operación. */
  no_encontradas: string[];
  /** Equivalencias cuyo género la agrupación no incluye: no se asignan y no abortan. `genero` es el nombre del género. */
  no_permitidas: { id: string; genero: string }[];
};

// ─── Lista plana y faltantes (GET /api/estacionalidad/equivalencias · /faltantes) ───

export type MotivoFaltante = "sin_agrupacion" | "agrupacion_inactiva";

export type EquivalenciaPlana = {
  id: string;
  codigo: string;
  nombre: string;
  es_generica: boolean;
  activo: boolean;
  nodo_id: string;
  genero_id: string;
  mundo_id: string;
  linea_id: string;
  /** El nodo y sus padres están activos. */
  vigente: boolean;
  /** `"GÉNERO / MUNDO / LÍNEA"`. */
  ruta: string;
  agrupacion: AgrupacionEstacionalidadEmbebida | null;
  /** Regla 7: activa ∧ vigente ∧ (sin agrupación ∨ agrupación inactiva). */
  faltante: boolean;
  motivo_faltante: MotivoFaltante | null;
};

/** Género o mundo tal como viaja en la lista plana. */
export type CatalogoPlanoEstacionalidad = {
  id: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
};

export type LineaPlana = {
  id: string;
  codigo: string;
  nombre: string;
  temporada: Temporada;
  activo: boolean;
};

/** Conteos de lo devuelto (no de la base completa). */
export type ResumenEstacionalidad = {
  equivalencias: number;
  con_agrupacion: number;
  faltantes: number;
  faltantes_genericas: number;
  faltantes_por_agrupacion_inactiva: number;
};

export type EquivalenciasEstacionalidadRespuesta = {
  equivalencias: EquivalenciaPlana[];
  generos: CatalogoPlanoEstacionalidad[];
  mundos: CatalogoPlanoEstacionalidad[];
  lineas: LineaPlana[];
  agrupaciones: (CatalogoPlanoEstacionalidad & { descripcion?: string | null; genero_ids: string[] })[];
  resumen: ResumenEstacionalidad;
};

// ─── Importador (POST /api/estacionalidad/importar) ───

/** Una fila del archivo ya mapeada a las cinco columnas. */
export type FilaImportacionEstacionalidad = {
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  agrupacion: string;
};

export type ImportarEstacionalidadCuerpo = {
  modo: ModoImportacion;
  filas: FilaImportacionEstacionalidad[];
};

export type MotivoOmisionEstacionalidad =
  // Los ocho de M1.
  | "linea_vacia"
  | "fila_total"
  | "genero_desconocido"
  | "genero_inactivo"
  | "mundo_vacio"
  | "mundo_desconocido"
  | "mundo_inactivo"
  | "duplicada_en_archivo"
  // Propios de M3.
  | "linea_desconocida"
  | "nodo_desconocido"
  | "nodo_inactivo"
  | "equivalencia_desconocida"
  | "equivalencia_inactiva"
  | "agrupacion_vacia"
  | "agrupacion_inactiva"
  | "contradictoria_en_archivo"
  // Del vínculo agrupación-género.
  | "genero_no_incluido"
  | "agrupacion_sin_genero";

/** Fila omitida con su contenido normalizado, para corregir el archivo. */
export type FilaOmitidaEstacionalidad = FilaImportacionEstacionalidad & {
  fila: number;
  motivo: MotivoOmisionEstacionalidad;
  detalle?: string;
  /** En `duplicada_en_archivo` y `contradictoria_en_archivo`: la primera aparición de la misma equivalencia. */
  fila_original?: number;
};

/** Equivalencia que ya tenía otra agrupación y el archivo la cambia. */
export type ReasignacionImportacion = {
  ruta: string;
  equivalencia: string;
  de: string;
  a: string;
};

/** Agrupación que el archivo creará, con cuántas filas apuntan a ella. */
export type AgrupacionNuevaImportacion = {
  nombre: string;
  codigo: string;
  equivalencias: number;
  /** Géneros (nombres) de las filas que apuntan a ella: con ellos se crea. */
  generos: string[];
};

export type ReporteImportacionEstacionalidad = {
  modo: ModoImportacion;
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: { agrupaciones: number };
  asignar: { nuevas: number; reasignadas: number; sin_cambio: number };
  omitidas: FilaOmitidaEstacionalidad[];
  /** Hasta 500; el total está en `asignar.reasignadas`. */
  reasignaciones: ReasignacionImportacion[];
  /** Todas las agrupaciones que se crearán. */
  muestra: { agrupaciones: AgrupacionNuevaImportacion[] };
};

// ─── Etiquetas de pantalla ───

export const ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD: Record<MotivoOmisionEstacionalidad, string> = {
  linea_vacia: "Línea vacía",
  fila_total: "Fila de totales",
  genero_desconocido: "Género desconocido",
  genero_inactivo: "Género inactivo",
  mundo_vacio: "Mundo vacío",
  mundo_desconocido: "Mundo desconocido",
  mundo_inactivo: "Mundo inactivo",
  linea_desconocida: "Línea desconocida",
  nodo_desconocido: "Nodo desconocido",
  nodo_inactivo: "Nodo inactivo",
  equivalencia_desconocida: "Equivalencia desconocida",
  equivalencia_inactiva: "Equivalencia inactiva",
  agrupacion_vacia: "Agrupación vacía",
  agrupacion_inactiva: "Agrupación inactiva",
  contradictoria_en_archivo: "Contradictoria en el archivo",
  duplicada_en_archivo: "Duplicada en el archivo",
  genero_no_incluido: "El género no está en la agrupación",
  agrupacion_sin_genero: "La agrupación no tiene géneros",
};

export const ETIQUETA_MOTIVO_FALTANTE: Record<MotivoFaltante, string> = {
  sin_agrupacion: "Sin agrupación",
  agrupacion_inactiva: "Agrupación inactiva",
};
