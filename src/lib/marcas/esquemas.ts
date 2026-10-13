import { z } from "zod";
import { activo, codigo, codigoOpcional, codigoValido, derivarCodigo, nombre, nombreValido, uuid } from "@/lib/arbol/esquemas";

/**
 * Esquemas zod de M2 (docs/modulos/02-marcas.md, "Contratos de API" y regla
 * 16). Las piezas básicas (nombre normalizado, código derivado, uuid, activo)
 * son las de M1; aquí solo se agrega lo propio de marcas: la agrupación, la
 * bandera de tratamiento especial y su nota.
 *
 * Las agrupaciones de marca usan `crearCatalogoSchema` / `editarCatalogoSchema`
 * de M1 tal cual (misma estructura que géneros y mundos).
 */

export const MAX_NOTA = 200;
export const MENSAJE_NOTA_LARGA = `La nota no puede superar ${MAX_NOTA} caracteres.`;
export const MENSAJE_NOTA_SIN_BANDERA = "La nota solo se guarda si la marca tiene tratamiento especial.";
export const MENSAJE_MODALIDAD_INVALIDA = "La modalidad debe ser por_gml o barrido.";
export const MENSAJE_MODALIDAD_SIN_TRATAMIENTO = "La modalidad solo se guarda si la marca tiene tratamiento especial.";

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

/**
 * Nota recortada; `""`, solo espacios, `null` o ausente → `null`. En
 * `editarMarcaSchema` (parcial) una clave ausente sigue ausente: zod 4 no
 * ejecuta la transformación si la clave no viene.
 */
export const notaTratamiento = z
  .string("La nota debe ser texto.")
  .nullable()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().max(MAX_NOTA, MENSAJE_NOTA_LARGA).nullable());

const tratamientoEspecial = z.boolean("tratamiento_especial debe ser verdadero o falso.");

/** 02b: `por_gml` (relevante en los GML asignados) o `barrido` (flujo propio sin detalle por GML). */
export const modalidadTratamiento = z.enum(["por_gml", "barrido"], MENSAJE_MODALIDAD_INVALIDA);

export const crearMarcaSchema = z
  .object({
    nombre,
    codigo: codigoOpcional,
    agrupacion_marca_id: uuid,
    tratamiento_especial: tratamientoEspecial.default(false),
    nota_tratamiento: notaTratamiento,
    modalidad_tratamiento: modalidadTratamiento.nullable().optional(),
  })
  .transform(derivarCodigo)
  // 02b regla 2: con casilla y sin modalidad se guarda `barrido`; sin casilla la modalidad pedida se conserva
  // para que el `refine` la rechace (modalidad ⇒ casilla).
  .transform((v) => ({
    ...v,
    modalidad_tratamiento: v.modalidad_tratamiento ?? (v.tratamiento_especial ? ("barrido" as const) : null),
  }))
  .pipe(
    z.object({
      nombre: nombreValido,
      codigo: codigoValido,
      agrupacion_marca_id: z.string(),
      tratamiento_especial: z.boolean(),
      nota_tratamiento: z.string().nullable(),
      modalidad_tratamiento: modalidadTratamiento.nullable(),
    })
  )
  .refine((v) => v.nota_tratamiento === null || v.tratamiento_especial, {
    message: MENSAJE_NOTA_SIN_BANDERA,
    path: ["nota_tratamiento"],
  })
  .refine((v) => v.modalidad_tratamiento === null || v.tratamiento_especial, {
    message: MENSAJE_MODALIDAD_SIN_TRATAMIENTO,
    path: ["modalidad_tratamiento"],
  });

/**
 * La coherencia nota y modalidad ↔ bandera en PATCH la resuelve el handler con
 * `normalizarTratamiento(cambio, actual, gmlActivos)` (regla 6): depende del
 * valor actual de la marca, que el esquema no conoce. `conjunto_marca_id` lo
 * valida `motivoRechazoConjunto` (regla 21), que necesita todas las marcas.
 */
export const editarMarcaSchema = z
  .object({
    nombre,
    codigo,
    agrupacion_marca_id: uuid,
    tratamiento_especial: tratamientoEspecial,
    nota_tratamiento: notaTratamiento,
    modalidad_tratamiento: modalidadTratamiento.nullable(),
    /** 02b: la cabeza del conjunto (entrar o cambiar de conjunto) o `null` (salir). */
    conjunto_marca_id: uuid.nullable(),
    activo,
  })
  .partial()
  .refine(tieneAlgo, noVacio);

// ─── Importador ───

export const filaImportacionMarcaSchema = z.object({
  marca: z.string("marca debe ser texto."),
  agrupacion: z.string("agrupacion debe ser texto."),
  /** La columna es opcional en el archivo; el cliente manda "" si no la mapeó. */
  tratamiento_especial: z.string("tratamiento_especial debe ser texto.").default(""),
  /** 02b: columna opcional `CONJUNTO`; el cliente manda "" (o no la manda) si no la mapeó. */
  conjunto: z.string("conjunto debe ser texto.").default(""),
});

export const importarMarcasSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionMarcaSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type CrearMarca = z.infer<typeof crearMarcaSchema>;
export type EditarMarca = z.infer<typeof editarMarcaSchema>;
export type ImportarMarcas = z.infer<typeof importarMarcasSchema>;
