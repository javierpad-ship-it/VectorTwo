import { z } from "zod";
import {
  activo,
  codigo,
  codigoOpcional,
  codigoValido,
  derivarCodigo,
  nombre,
  nombreValido,
  orden,
  uuid,
} from "@/lib/arbol/esquemas";
import { temporadaAgrupacion } from "@/lib/curvas/esquemas";
import { MAX_FILAS_IMPORTAR_AGRUPACIONES } from "./tipos-api";
import { celdaTexto, MAX_CELDA_NOTA } from "@/lib/api/celdas";

/**
 * Esquemas zod de M3 (docs/modulos/03-agrupaciones-estacionalidad.md,
 * "Contratos de API" y reglas 1–3). Las piezas básicas (nombre normalizado,
 * código derivado, orden, uuid, activo) son las de M1; aquí solo se agrega lo
 * propio: la descripción de la agrupación, su temporada (M6 paso 1), la
 * asignación masiva y el importador de cinco columnas más la sexta opcional
 * `temporada`.
 *
 * `editarEquivalenciaSchema` (M1) ya acepta `agrupacion_estacionalidad_id`
 * como UUID o `null`; vive en `src/lib/arbol/esquemas.ts`.
 */

export const MAX_DESCRIPCION = 500;
/** Tope de la celda GENEROS del importador de agrupaciones. */
export const MAX_CELDA_GENEROS = 1000;
export const MENSAJE_DESCRIPCION_LARGA = `La descripción no puede superar ${MAX_DESCRIPCION} caracteres.`;
export const MAX_EQUIVALENCIAS_ASIGNAR = 2_000;
export const MAX_GENEROS_AGRUPACION = 50;

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

/**
 * Descripción recortada (no se pasa a mayúsculas); `""`, solo espacios,
 * `null` o ausente → `null`. En `editarAgrupacionSchema` (parcial) una clave
 * ausente sigue ausente: zod 4 no ejecuta la transformación si no viene.
 */
export const descripcion = z
  .string("La descripción debe ser texto.")
  .nullable()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().max(MAX_DESCRIPCION, MENSAJE_DESCRIPCION_LARGA).nullable());

// ─── Catálogo de agrupaciones ───

/**
 * Géneros de una agrupación: UUID únicos, de 1 a 50. Obligatorio al crear; al
 * editar es opcional y, si viene, reemplaza el conjunto (por eso también exige
 * al menos uno: una agrupación nunca se deja sin género desde la API).
 */
export const generoIds = z
  .array(uuid, "genero_ids debe ser una lista de géneros.")
  .min(1, "Elige al menos un género.")
  .max(MAX_GENEROS_AGRUPACION, `Una agrupación admite hasta ${MAX_GENEROS_AGRUPACION} géneros.`)
  .refine((ids) => new Set(ids).size === ids.length, "No repitas géneros.");

export const crearAgrupacionSchema = z
  .object({
    nombre,
    codigo: codigoOpcional,
    descripcion,
    orden: orden.optional(),
    genero_ids: generoIds,
    /** M6: opcional; sin ella la agrupación nace `todo_el_ano`. */
    temporada: temporadaAgrupacion.default("todo_el_ano"),
  })
  .transform(derivarCodigo)
  .pipe(
    z.object({
      nombre: nombreValido,
      codigo: codigoValido,
      descripcion: z.string().nullable(),
      orden: orden.optional(),
      genero_ids: z.array(z.string()),
      temporada: temporadaAgrupacion,
    })
  );

export const editarAgrupacionSchema = z
  .object({ nombre, codigo, descripcion, orden, activo, genero_ids: generoIds, temporada: temporadaAgrupacion })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Asignación masiva ───

export const asignarSchema = z.object({
  /** `null` = quitar la agrupación a todas. */
  agrupacion_id: uuid.nullable(),
  equivalencia_ids: z
    .array(uuid)
    .min(1, "Elige al menos una equivalencia.")
    .max(MAX_EQUIVALENCIAS_ASIGNAR, `Se admiten hasta ${MAX_EQUIVALENCIAS_ASIGNAR} equivalencias por asignación.`),
});

// ─── Importador ───

export const filaImportacionEstacionalidadSchema = z.object({
  genero: celdaTexto("genero"),
  mundo: celdaTexto("mundo"),
  linea: celdaTexto("linea"),
  equivalencia: celdaTexto("equivalencia"),
  agrupacion: celdaTexto("agrupacion"),
  /**
   * Sexta columna, opcional (los archivos de cinco columnas siguen valiendo):
   * `Invierno` / `Verano` / `Todo el año` o sus códigos. Solo aplica a las
   * agrupaciones que el archivo crea; el importador la valida (`temporada_invalida`).
   */
  temporada: celdaTexto("temporada").nullish(),
});

export const importarEstacionalidadSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionEstacionalidadSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

// ─── Importador de agrupaciones (carga masiva de agrupaciones nuevas) ───


/**
 * Fila de la plantilla `NOMBRE · CODIGO · GENEROS · TEMPORADA · DESCRIPCION ·
 * ORDEN`. `nombre` y `generos` viajan siempre (cadena vacía si la columna no
 * está mapeada); el resto es opcional. Las reglas de contenido (longitudes,
 * géneros, temporada, orden) las aplica el importador y salen como motivos de
 * omisión por fila, no como un `400` de todo el archivo.
 */
export const filaImportacionAgrupacionesSchema = z.object({
  nombre: celdaTexto("nombre"),
  /** Tope bajo: el parser de géneros parte la celda en piezas; ver `separarGeneros`. */
  generos: celdaTexto("generos", MAX_CELDA_GENEROS),
  codigo: celdaTexto("codigo").nullish(),
  temporada: celdaTexto("temporada").nullish(),
  descripcion: celdaTexto("descripcion", MAX_CELDA_NOTA).nullish(),
  orden: z.union([celdaTexto("orden"), z.number()], "orden debe ser un número o texto.").nullish(),
});

export const importarAgrupacionesSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionAgrupacionesSchema)
    .min(1, "No hay filas que importar.")
    .max(MAX_FILAS_IMPORTAR_AGRUPACIONES, "Se admiten hasta 5 000 filas por importación."),
});

export type CrearAgrupacion =z.infer<typeof crearAgrupacionSchema>;
export type EditarAgrupacion = z.infer<typeof editarAgrupacionSchema>;
export type Asignar = z.infer<typeof asignarSchema>;
export type ImportarEstacionalidad = z.infer<typeof importarEstacionalidadSchema>;
export type ImportarAgrupaciones = z.infer<typeof importarAgrupacionesSchema>;
