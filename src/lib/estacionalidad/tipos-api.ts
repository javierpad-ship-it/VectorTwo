/**
 * Vista de la API de M3 para el frontend (docs/modulos/03-agrupaciones-estacionalidad.md,
 * "Contratos de API"). Describe el JSON que viaja, no las filas de la base;
 * el backend puede tipar sus respuestas con estos nombres o re-exportarlos
 * desde `tipos.ts`. No importa de `./tipos` a propósito (mismo criterio que M2).
 */
import type { Temporada } from "@/lib/arbol/normalizar";
import type { ModoImportacion } from "@/components/importador/tipos";
import type { TemporadaAgrupacion, TemporadaDeAgrupacionApi } from "@/lib/curvas/tipos-api";

export type { ModoImportacion, TemporadaAgrupacion, TemporadaDeAgrupacionApi };

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
} & TemporadaDeAgrupacionApi; // M6 paso 1: temporada, temporada_sugerida, temporada_sugerida_distinta

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
  /** M6: por defecto `todo_el_ano`. */
  temporada?: TemporadaAgrupacion;
};

export type EditarAgrupacionEstacionalidadCuerpo = Partial<{
  nombre: string;
  codigo: string;
  descripcion: string | null;
  orden: number;
  activo: boolean;
  /** Reemplaza el conjunto de géneros; mínimo uno. */
  genero_ids: string[];
  /** M6: no recalcula nada; la próxima corrida la usa. */
  temporada: TemporadaAgrupacion;
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
  agrupaciones: (CatalogoPlanoEstacionalidad & {
    descripcion?: string | null;
    genero_ids: string[];
    /** M6 paso 1. */
    temporada: TemporadaAgrupacion;
    temporada_sugerida: TemporadaAgrupacion;
  })[];
  resumen: ResumenEstacionalidad;
};

// ─── Importador (POST /api/estacionalidad/importar) ───

/**
 * Una fila del archivo ya mapeada a las cinco columnas, más la sexta opcional
 * `temporada` (M6): `Invierno` / `Verano` / `Todo el año` o sus códigos; vacía o
 * ausente = `todo_el_ano`. Solo aplica a las agrupaciones que el archivo crea.
 */
export type FilaImportacionEstacionalidad = {
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  agrupacion: string;
  temporada?: string | null;
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
  | "agrupacion_sin_genero"
  // De la sexta columna `temporada` (M6).
  | "temporada_invalida"
  | "temporada_contradictoria_en_archivo";

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
  /** Con la que se creará: la del archivo o `todo_el_ano` si ninguna fila la trae. */
  temporada: TemporadaAgrupacion;
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
  temporada_invalida: "Temporada no válida",
  temporada_contradictoria_en_archivo: "Temporada contradictoria en el archivo",
};

export const ETIQUETA_MOTIVO_FALTANTE: Record<MotivoFaltante, string> = {
  sin_agrupacion: "Sin agrupación",
  agrupacion_inactiva: "Agrupación inactiva",
};

// ─── Importador de agrupaciones (POST /api/agrupaciones-estacionalidad/importar) ───
//
// Carga masiva para CREAR agrupaciones de estacionalidad nuevas (nunca actualiza
// una existente). Contrato autocontenido: sin `"use client"`, sin base de datos;
// lo importan tanto el backend como la pantalla de `/maestros/estacionalidad`.

/**
 * Una fila del archivo ya mapeada a las columnas de la plantilla
 * (`NOMBRE`, `CODIGO`, `GENEROS`, `TEMPORADA`, `DESCRIPCION`, `ORDEN`). Todo
 * viaja como texto tal cual lo leyó el archivo (se admite un número en `orden`);
 * una columna sin mapear viaja como cadena vacía, `null` o ausente.
 *
 * - `nombre`: obligatorio (se normaliza: NFC, espacios, mayúsculas; ≤ 120).
 * - `codigo`: opcional; vacío → se deriva del nombre (`aCodigo`), ≤ 40.
 * - `generos`: obligatorio; uno o más nombres o códigos de género separados por
 *   coma, punto y coma, barra (`/`) o `|`.
 * - `temporada`: `Invierno`, `Verano`, `Todo el año` / `Toda temporada` o sus
 *   códigos; vacía → `todo_el_ano`.
 * - `descripcion`: opcional, ≤ 500; vacía → `null`.
 * - `orden`: opcional, entero ≥ 0; vacío → el siguiente múltiplo de 10 tras el
 *   mayor `orden` actual (creciente por fila).
 */
export type FilaImportacionAgrupaciones = {
  nombre: string;
  generos: string;
  codigo?: string | null;
  temporada?: string | null;
  descripcion?: string | null;
  orden?: string | number | null;
};

/** Máximo de filas por importación (el servidor responde `400` con más). */
export const MAX_FILAS_IMPORTAR_AGRUPACIONES = 5_000;

export type PeticionImportarAgrupaciones = {
  modo: ModoImportacion;
  /** 1 a 5 000 filas. */
  filas: FilaImportacionAgrupaciones[];
};

/**
 * Por qué una fila no crea nada. `ya_existe` es informativo (la agrupación ya
 * está; nunca se actualiza) y `nombre_repetido_en_archivo` lo es solo cuando la
 * fila repite exactamente a otra anterior; el resto son errores del archivo.
 * La fila que gana en un nombre o código repetido es la primera.
 */
export type MotivoOmisionAgrupaciones =
  | "nombre_vacio"
  | "nombre_largo"
  | "fila_total"
  | "genero_vacio"
  | "genero_desconocido"
  | "genero_inactivo"
  | "temporada_invalida"
  | "orden_invalido"
  | "descripcion_larga"
  | "codigo_invalido"
  | "codigo_repetido_en_archivo"
  | "nombre_repetido_en_archivo"
  | "codigo_en_uso"
  | "ya_existe";

/** Fila omitida con su contenido normalizado (texto), para corregir el archivo. */
export type FilaOmitidaAgrupaciones = {
  /** Posición de la fila en el archivo enviado (1 = la primera fila de datos). */
  fila: number;
  motivo: MotivoOmisionAgrupaciones;
  /** Qué valor falló o con qué choca (p. ej. el género desconocido, la agrupación que ya existe). */
  detalle?: string;
  /** En `nombre_repetido_en_archivo` y `codigo_repetido_en_archivo`: la primera fila que lo usó. */
  fila_original?: number;
  /** `true` = no hay nada que corregir (`ya_existe`, o repetida exacta); `false` = error del archivo. */
  informativa: boolean;
  nombre: string;
  codigo: string;
  generos: string;
  temporada: string;
  descripcion: string;
  orden: string;
};

/** Agrupación que se creará (previsualizar) o que el archivo propone crear (aplicar). */
export type AgrupacionNuevaImportada = {
  /** Fila del archivo de la que sale. */
  fila: number;
  nombre: string;
  codigo: string;
  /** Nombres de los géneros, por `orden, nombre` del género. */
  generos: string[];
  temporada: TemporadaAgrupacion;
  orden: number;
  descripcion: string | null;
};

export type ReporteImportacionAgrupaciones = {
  modo: ModoImportacion;
  totales: {
    /** Filas recibidas. */
    filas: number;
    /** Agrupaciones que el archivo crearía (igual en los dos modos). */
    a_crear: number;
    /** Realmente creadas: 0 en `previsualizar`. */
    creadas: number;
    /** Filas omitidas por `ya_existe`. */
    ya_existen: number;
    /** Todas las filas omitidas (informativas y con error). */
    omitidas: number;
    /** Omitidas que son un error del archivo (`informativa: false`). */
    con_error: number;
  };
  /** Todas las que se crearán, en el orden del archivo. */
  agrupaciones_nuevas: AgrupacionNuevaImportada[];
  omitidas: FilaOmitidaAgrupaciones[];
};

export const ETIQUETA_MOTIVO_OMISION_AGRUPACIONES: Record<MotivoOmisionAgrupaciones, string> = {
  nombre_vacio: "Nombre vacío",
  nombre_largo: "Nombre demasiado largo",
  fila_total: "Fila de totales",
  genero_vacio: "Género vacío",
  genero_desconocido: "Género desconocido",
  genero_inactivo: "Género inactivo",
  temporada_invalida: "Temporada no válida",
  orden_invalido: "Orden no válido",
  descripcion_larga: "Descripción demasiado larga",
  codigo_invalido: "Código no válido",
  codigo_repetido_en_archivo: "Código repetido en el archivo",
  nombre_repetido_en_archivo: "Nombre repetido en el archivo",
  codigo_en_uso: "Código en uso por otra agrupación",
  ya_existe: "Ya existe",
};
