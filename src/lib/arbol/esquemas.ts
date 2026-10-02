import { z } from "zod";
import {
  EQUIVALENCIA_GENERICA,
  MAX_CODIGO,
  MAX_NOMBRE,
  TEMPORADAS,
  aCodigo,
  esEquivalenciaGenerica,
  normalizarNombre,
} from "./normalizar";

/**
 * Esquemas zod de M1 (docs/modulos/01-arbol-producto.md, "Contratos de API").
 *
 * `nombre` siempre pasa por `normalizarNombre` y `codigo` por `aCodigo`; si al
 * crear falta el código, se deriva del nombre. Los mensajes van en castellano
 * porque `leerCuerpo` los devuelve tal cual a la pantalla.
 */

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

const nombreValido = z
  .string()
  .min(1, "El nombre es obligatorio.")
  .max(MAX_NOMBRE, `El nombre no puede superar ${MAX_NOMBRE} caracteres.`);

const codigoValido = z
  .string()
  .min(1, "El código no puede quedar vacío (usa letras o números).")
  .max(MAX_CODIGO, `El código no puede superar ${MAX_CODIGO} caracteres.`);

/** Nombre normalizado y obligatorio. */
export const nombre = z.string("El nombre debe ser texto.").transform(normalizarNombre).pipe(nombreValido);

/** Código ASCII derivado del valor recibido, obligatorio. */
export const codigo = z.string("El código debe ser texto.").transform(aCodigo).pipe(codigoValido);

/** Código opcional: vacío o ausente se trata como "derivar del nombre". */
const codigoOpcional = z
  .string("El código debe ser texto.")
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : aCodigo(v)));

const orden = z.int("El orden debe ser un número entero.").min(0, "El orden no puede ser negativo.");
const activo = z.boolean("activo debe ser verdadero o falso.");
const uuid = z.uuid("Identificador inválido.");
const temporada = z.enum(TEMPORADAS, "La temporada debe ser Verano, Invierno o Todo el año.");

function derivarCodigo<T extends { nombre: string; codigo?: string }>(v: T): T & { codigo: string } {
  return { ...v, codigo: v.codigo ?? aCodigo(v.nombre) };
}

// ─── Catálogos planos (géneros, mundos) ───

export const crearCatalogoSchema = z
  .object({ nombre, codigo: codigoOpcional, orden: orden.optional() })
  .transform(derivarCodigo)
  .pipe(z.object({ nombre: nombreValido, codigo: codigoValido, orden: orden.optional() }));

export const editarCatalogoSchema = z
  .object({ nombre, codigo, orden, activo })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Líneas ───

export const crearLineaSchema = z
  .object({ nombre, codigo: codigoOpcional, temporada: temporada.default("Todo el año") })
  .transform(derivarCodigo)
  .pipe(z.object({ nombre: nombreValido, codigo: codigoValido, temporada }));

export const editarLineaSchema = z
  .object({ nombre, codigo, temporada, activo })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Nodos género-mundo-línea ───

export const crearNodoSchema = z.object({ genero_id: uuid, mundo_id: uuid, linea_id: uuid });

export const editarNodoSchema = z
  .object({ activo, mundo_id: uuid })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Equivalencias ───

/**
 * Al crear, un nombre vacío, `-` o `SIN EQUIVALENCIA` se convierte en la
 * genérica del nodo con nombre y código fijos; el resto lleva su código
 * derivado o el que mande el cliente.
 */
export const crearEquivalenciaSchema = z
  .object({
    genero_mundo_linea_id: uuid,
    nombre: z
      .string("El nombre debe ser texto.")
      .transform(normalizarNombre)
      .pipe(z.string().max(MAX_NOMBRE, `El nombre no puede superar ${MAX_NOMBRE} caracteres.`)),
    codigo: codigoOpcional,
  })
  .transform((v) =>
    esEquivalenciaGenerica(v.nombre)
      ? {
          genero_mundo_linea_id: v.genero_mundo_linea_id,
          nombre: EQUIVALENCIA_GENERICA.nombre,
          codigo: EQUIVALENCIA_GENERICA.codigo,
          es_generica: true,
        }
      : {
          genero_mundo_linea_id: v.genero_mundo_linea_id,
          nombre: v.nombre,
          codigo: v.codigo ?? aCodigo(v.nombre),
          es_generica: false,
        }
  )
  .pipe(
    z.object({
      genero_mundo_linea_id: z.string(),
      nombre: nombreValido,
      codigo: codigoValido,
      es_generica: z.boolean(),
    })
  );

export const editarEquivalenciaSchema = z
  .object({ nombre, codigo, activo })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Importador ───

export const filaImportacionSchema = z.object({
  genero: z.string("genero debe ser texto."),
  mundo: z.string("mundo debe ser texto."),
  linea: z.string("linea debe ser texto."),
  equivalencia: z.string("equivalencia debe ser texto."),
});

export const importarSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type CrearCatalogo = z.infer<typeof crearCatalogoSchema>;
export type EditarCatalogo = z.infer<typeof editarCatalogoSchema>;
export type CrearLinea = z.infer<typeof crearLineaSchema>;
export type EditarLinea = z.infer<typeof editarLineaSchema>;
export type CrearNodo = z.infer<typeof crearNodoSchema>;
export type EditarNodo = z.infer<typeof editarNodoSchema>;
export type CrearEquivalencia = z.infer<typeof crearEquivalenciaSchema>;
export type EditarEquivalencia = z.infer<typeof editarEquivalenciaSchema>;
export type Importar = z.infer<typeof importarSchema>;
