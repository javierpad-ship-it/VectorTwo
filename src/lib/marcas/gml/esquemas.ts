import { z } from "zod";
import { uuid } from "@/lib/arbol/esquemas";
import { MAX_NOTA } from "../esquemas";
import { celdaTexto, MAX_CELDA_NOTA } from "@/lib/api/celdas";

/**
 * Esquemas zod de las marcas relevantes por GML (02b, "Contratos de API" y
 * regla 17). Los mensajes van en castellano porque `leerCuerpo` los devuelve
 * tal cual a la pantalla.
 */

export const MENSAJE_NOTA_GML_LARGA = `La nota no puede superar ${MAX_NOTA} caracteres.`;

/** Nota recortada; `""`, solo espacios, `null` o ausente → `null`. */
export const notaGml = z
  .string("La nota debe ser texto.")
  .nullable()
  .optional()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().max(MAX_NOTA, MENSAJE_NOTA_GML_LARGA).nullable());

/** Como `notaGml` pero la clave es obligatoria: en `PATCH` un cuerpo vacío no debe borrar la nota sin querer. */
const notaGmlObligatoria = z
  .string("Envía la nota (o null para borrarla).")
  .nullable()
  .transform((v) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().max(MAX_NOTA, MENSAJE_NOTA_GML_LARGA).nullable());

export const crearGmlEspecialSchema = z.object({
  marca_id: uuid,
  genero_mundo_linea_id: uuid,
  nota: notaGml,
});

/** `PATCH`: la única clave editable es la nota; `null` o `""` la borra. */
export const editarGmlEspecialSchema = z.object({ nota: notaGmlObligatoria });

const accion = z.enum(["asignar", "quitar"], "La acción debe ser asignar o quitar.");
const par = z.object({ marca_id: uuid, nodo_id: uuid });

export const MAX_PARES_BLOQUE = 5_000;

/** Dos formas: producto cartesiano (hasta 200 marcas × 600 nodos, 5 000 pares) o lista de pares. */
export const asignarGmlSchema = z.discriminatedUnion(
  "forma",
  [
    z
      .object({
        forma: z.literal("cartesiano"),
        accion,
        marca_ids: z
          .array(uuid, "marca_ids debe ser una lista de identificadores.")
          .min(1, "Elige al menos una marca.")
          .max(200, "Se admiten hasta 200 marcas por bloque."),
        nodo_ids: z
          .array(uuid, "nodo_ids debe ser una lista de identificadores.")
          .min(1, "Elige al menos un GML.")
          .max(600, "Se admiten hasta 600 GML por bloque."),
        nota: notaGml,
      })
      .refine((v) => v.marca_ids.length * v.nodo_ids.length <= MAX_PARES_BLOQUE, {
        message: "Se admiten hasta 5 000 pares por bloque.",
      }),
    z.object({
      forma: z.literal("pares"),
      accion,
      pares: z
        .array(par, "pares debe ser una lista de { marca_id, nodo_id }.")
        .min(1, "Elige al menos un par.")
        .max(MAX_PARES_BLOQUE, "Se admiten hasta 5 000 pares por bloque."),
      nota: notaGml,
    }),
  ],
  { error: "La forma debe ser cartesiano o pares." }
);

/** `GET /api/marcas/gml-especial?marca_id=&nodo_id=`. */
export const estadoGmlQuerySchema = z.object({
  marca_id: uuid.optional(),
  nodo_id: uuid.optional(),
});

const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes debe tener la forma aaaa-mm.");

/**
 * `GET /api/marcas/gml-especial/sugerencias`. Valores por defecto (los de la
 * ficha): `top` 4 (1 a 10), `min_participacion` 0,05 (0 a 0,5), `medida`
 * `venta_soles`; `desde` y `hasta` se resuelven con los meses publicados.
 */
export const sugerenciasQuerySchema = z
  .object({
    desde: periodo.optional(),
    hasta: periodo.optional(),
    top: z.coerce
      .number("top debe ser un número.")
      .int("top debe ser un entero.")
      .min(1, "top debe estar entre 1 y 10.")
      .max(10, "top debe estar entre 1 y 10.")
      .default(4),
    min_participacion: z.coerce
      .number("min_participacion debe ser un número.")
      .min(0, "min_participacion debe estar entre 0 y 0,5.")
      .max(0.5, "min_participacion debe estar entre 0 y 0,5.")
      .default(0.05),
    medida: z.enum(["venta_soles", "unidades"], "La medida debe ser venta_soles o unidades.").default("venta_soles"),
  })
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta, {
    message: "El mes inicial no puede ser posterior al final.",
    path: ["desde"],
  });

// ─── Importador de marcas relevantes ───

export const filaImportacionGmlSchema = z.object({
  marca: celdaTexto("marca"),
  genero: celdaTexto("genero"),
  mundo: celdaTexto("mundo"),
  linea: celdaTexto("linea"),
  /** La columna `NOTA` es opcional; el cliente manda "" si no la mapeó. */
  nota: celdaTexto("nota", MAX_CELDA_NOTA).default(""),
});

export const importarGmlSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionGmlSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type CrearGmlEspecial = z.infer<typeof crearGmlEspecialSchema>;
export type EditarGmlEspecial = z.infer<typeof editarGmlEspecialSchema>;
export type AsignarGml = z.infer<typeof asignarGmlSchema>;
export type SugerenciasQuery = z.infer<typeof sugerenciasQuerySchema>;
export type ImportarGml = z.infer<typeof importarGmlSchema>;
