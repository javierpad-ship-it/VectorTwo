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

/**
 * Esquemas zod de M3 (docs/modulos/03-agrupaciones-estacionalidad.md,
 * "Contratos de API" y reglas 1–3). Las piezas básicas (nombre normalizado,
 * código derivado, orden, uuid, activo) son las de M1; aquí solo se agrega lo
 * propio: la descripción de la agrupación, la asignación masiva y el
 * importador de cinco columnas.
 *
 * `editarEquivalenciaSchema` (M1) ya acepta `agrupacion_estacionalidad_id`
 * como UUID o `null`; vive en `src/lib/arbol/esquemas.ts`.
 */

export const MAX_DESCRIPCION = 500;
export const MENSAJE_DESCRIPCION_LARGA = `La descripción no puede superar ${MAX_DESCRIPCION} caracteres.`;
export const MAX_EQUIVALENCIAS_ASIGNAR = 2_000;

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

export const crearAgrupacionSchema = z
  .object({ nombre, codigo: codigoOpcional, descripcion, orden: orden.optional() })
  .transform(derivarCodigo)
  .pipe(
    z.object({
      nombre: nombreValido,
      codigo: codigoValido,
      descripcion: z.string().nullable(),
      orden: orden.optional(),
    })
  );

export const editarAgrupacionSchema = z
  .object({ nombre, codigo, descripcion, orden, activo })
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
  genero: z.string("genero debe ser texto."),
  mundo: z.string("mundo debe ser texto."),
  linea: z.string("linea debe ser texto."),
  equivalencia: z.string("equivalencia debe ser texto."),
  agrupacion: z.string("agrupacion debe ser texto."),
});

export const importarEstacionalidadSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionEstacionalidadSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type CrearAgrupacion = z.infer<typeof crearAgrupacionSchema>;
export type EditarAgrupacion = z.infer<typeof editarAgrupacionSchema>;
export type Asignar = z.infer<typeof asignarSchema>;
export type ImportarEstacionalidad = z.infer<typeof importarEstacionalidadSchema>;
