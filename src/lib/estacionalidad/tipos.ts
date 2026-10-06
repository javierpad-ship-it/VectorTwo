/**
 * Formas JSON de la API de M3 (docs/modulos/03-agrupaciones-estacionalidad.md,
 * "Contratos de API"). Describen el JSON que viaja, no las filas de la base;
 * el frontend tiene los mismos nombres en `tipos-api.ts` (más las etiquetas de
 * pantalla) y puede re-exportar desde aquí. A propósito no se importa nada de
 * `@/components`: el backend no depende de la pantalla.
 */
import type { ModoImportacion, Temporada } from "@/lib/arbol/tipos";

export type { ModoImportacion, Temporada };

// ─── Catálogo (GET /api/agrupaciones-estacionalidad) ───

/** Un género de una agrupación (`agrupacion_estacionalidad_genero`), tal como viaja en el catálogo. */
export type GeneroDeAgrupacion = { id: string; codigo: string; nombre: string };

/**
 * Fila de `agrupaciones_estacionalidad` en el listado y en las respuestas de
 * POST/PATCH, con el conteo de equivalencias asignadas (activas o no) y sus
 * géneros. Una agrupación pertenece a uno o más géneros; las heredadas de antes
 * de ese cambio pueden tener cero ("sin género") y no aceptan asignaciones.
 */
export type AgrupacionEstacionalidadFila = {
  id: string;
  codigo: string;
  nombre: string;
  /** Texto libre (≤ 500), para qué sirve la curva; `null` si no se escribió. */
  descripcion: string | null;
  orden: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
  /** Equivalencias que apuntan a ella, activas o no. */
  equivalencias: number;
  /** Solo las activas (lo que pasa a faltante al desactivar). */
  equivalencias_activas: number;
  /** Ids de sus géneros, en el orden de `generos` (`orden, nombre` del género). */
  genero_ids: string[];
  /** Sus géneros ordenados por `orden, nombre` del género. */
  generos: GeneroDeAgrupacion[];
};

/** La agrupación tal como viaja en los catálogos de la lista plana (con `genero_ids`). */
export type AgrupacionEstacionalidadCatalogo = Pick<
  AgrupacionEstacionalidadFila,
  "id" | "codigo" | "nombre" | "orden" | "activo" | "genero_ids"
>;

/** La agrupación embebida en cada equivalencia de la lista plana. */
export type AgrupacionEstacionalidadEmbebida = Pick<AgrupacionEstacionalidadFila, "id" | "codigo" | "nombre" | "activo">;

// ─── Asignación masiva (POST /api/estacionalidad/asignar) ───

/** Equivalencia que no se asignó porque su género no está entre los de la agrupación destino. */
export type AsignacionNoPermitida = {
  id: string;
  /** Nombre del género de la equivalencia (el de su nodo). */
  genero: string;
};

export type ResultadoAsignacion = {
  /** Equivalencias cuya agrupación cambió (incluye quitarla cuando `agrupacion_id` es `null`). */
  asignadas: number;
  /** Ya tenían esa agrupación (o ya no tenían ninguna, si se pidió quitar). */
  sin_cambio: number;
  /** Ids enviados que no existen; no abortan la operación. */
  no_encontradas: string[];
  /**
   * Equivalencias cuyo género no está en la agrupación destino: no se asignan y
   * no abortan la operación. Siempre presente (`[]` si no hay).
   */
  no_permitidas: AsignacionNoPermitida[];
};

// ─── Lista plana y faltantes (GET /api/estacionalidad/equivalencias · /faltantes) ───

/** Regla 7: por qué una equivalencia es faltante. `null` en las que no lo son. */
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
  /** `nodo.activo ∧ genero.activo ∧ mundo.activo ∧ linea.activo` (regla 13 de M1). */
  vigente: boolean;
  /** `"GÉNERO / MUNDO / LÍNEA"` con los nombres del catálogo. */
  ruta: string;
  /** Resuelta por id, también si está inactiva (con su `activo`); `null` si no tiene. */
  agrupacion: AgrupacionEstacionalidadEmbebida | null;
  /** `activo ∧ vigente ∧ (agrupacion == null ∨ !agrupacion.activo)`. */
  faltante: boolean;
  motivo_faltante: MotivoFaltante | null;
};

export type GeneroPlano = { id: string; codigo: string; nombre: string; orden: number; activo: boolean };
export type MundoPlano = GeneroPlano;
export type LineaPlana = { id: string; codigo: string; nombre: string; temporada: Temporada; activo: boolean };

/** Conteos de lo devuelto (no de la base completa). */
export type ResumenEstacionalidad = {
  equivalencias: number;
  /** Con `agrupacion` no nula (activa o inactiva). */
  con_agrupacion: number;
  faltantes: number;
  /** De las faltantes, las genéricas `SIN EQUIVALENCIA`. */
  faltantes_genericas: number;
  /** De las faltantes, las que apuntan a una agrupación desactivada. */
  faltantes_por_agrupacion_inactiva: number;
};

export type ReporteEstacionalidad = {
  equivalencias: EquivalenciaPlana[];
  /** Catálogos completos (activos e inactivos), ordenados, para que la pantalla arme filtros y `Select`. */
  generos: GeneroPlano[];
  mundos: MundoPlano[];
  lineas: LineaPlana[];
  agrupaciones: AgrupacionEstacionalidadCatalogo[];
  resumen: ResumenEstacionalidad;
};

// ─── Importador (POST /api/estacionalidad/importar) ───

/** Una fila del archivo ya mapeada por el cliente a las cinco columnas. */
export type FilaImportacionEstacionalidad = {
  genero: string;
  mundo: string;
  linea: string;
  equivalencia: string;
  agrupacion: string;
};

/**
 * Por qué una fila del archivo no se procesa: los ocho de M1 más los propios
 * de M3 (18 en total). Solo `duplicada_en_archivo` es informativa; el resto
 * son errores. `genero_no_incluido` y `agrupacion_sin_genero` nacen del cambio
 * "agrupaciones por género": el importador nunca amplía los géneros de una
 * agrupación que ya existe.
 */
export type MotivoOmisionEstacionalidad =
  | "linea_vacia"
  | "fila_total"
  | "genero_desconocido"
  | "genero_inactivo"
  | "mundo_vacio"
  | "mundo_desconocido"
  | "mundo_inactivo"
  | "duplicada_en_archivo"
  | "linea_desconocida"
  | "nodo_desconocido"
  | "nodo_inactivo"
  | "equivalencia_desconocida"
  | "equivalencia_inactiva"
  | "agrupacion_vacia"
  | "agrupacion_inactiva"
  | "contradictoria_en_archivo"
  | "genero_no_incluido"
  | "agrupacion_sin_genero";

/**
 * Fila omitida con su contenido normalizado (los cinco campos) para corregir
 * el archivo. `fila` y `fila_original` son 1-based sobre las `filas` enviadas.
 */
export type FilaOmitidaEstacionalidad = FilaImportacionEstacionalidad & {
  fila: number;
  motivo: MotivoOmisionEstacionalidad;
  /**
   * El valor que no se reconoció; en `contradictoria_en_archivo`, la agrupación
   * de la primera aparición; en `genero_no_incluido`, el nombre del género de la
   * fila; en `agrupacion_sin_genero`, el nombre de la agrupación.
   */
  detalle?: string;
  /** En `duplicada_en_archivo` y `contradictoria_en_archivo`: la primera aparición de la misma equivalencia. */
  fila_original?: number;
};

/** Equivalencia que ya tenía otra agrupación y el archivo la cambia. */
export type Reasignacion = {
  ruta: string;
  equivalencia: string;
  /** Nombre de la agrupación actual en la base. */
  de: string;
  /** Nombre de la agrupación que trae el archivo. */
  a: string;
};

/**
 * Agrupación que el importador va a crear, con cuántas filas procesadas del
 * archivo apuntan a ella y los géneros (nombres) de esas filas, que serán los
 * suyos al crearla (distintos, al menos uno).
 */
export type AgrupacionAImportar = { nombre: string; codigo: string; equivalencias: number; generos: string[] };

export type ConteosAsignar = { nuevas: number; reasignadas: number; sin_cambio: number };

/** Reporte sin `modo`: lo produce `planificarImportacionEstacionalidad`; el handler le agrega el modo. */
export type ReporteImportacionEstacionalidadBase = {
  totales: { recibidas: number; procesadas: number; omitidas: number };
  crear: { agrupaciones: number };
  asignar: ConteosAsignar;
  omitidas: FilaOmitidaEstacionalidad[];
  /** Hasta `REASIGNACIONES_MAX` (500); el total está en `asignar.reasignadas`. */
  reasignaciones: Reasignacion[];
  /** Todas las agrupaciones que se crearán. */
  muestra: { agrupaciones: AgrupacionAImportar[] };
};

export type ReporteImportacionEstacionalidad = ReporteImportacionEstacionalidadBase & { modo: ModoImportacion };
