import { z } from "zod";
import { IMI_LIMITE_MAX, IMI_LIMITE_MIN, IMI_MAX_DEFECTO, IMI_MIN_DEFECTO, MAX_NOTA_REGLA } from "./tipos-api";

/**
 * Esquemas zod de M13 (ficha 13, secciones 7 y 8, regla 9). Los mensajes van en castellano porque `leerCuerpo` y `leerConsulta`
 * los devuelven tal cual a la pantalla. Los rangos de negocio (mínimo y tope entre 0,5 y 24 meses, tope ≥ mínimo) se validan AQUÍ y
 * no en la base (criterio I9: aflojarlos no exige `DROP constraint`); la base solo guarda lo estructural.
 */

const uuid = (campo: string) => z.uuid(`${campo} debe ser un identificador válido.`);

const MENSAJE_MES = "El mes debe ser el primer día de un mes, con la forma aaaa-mm (por ejemplo 2026-10).";

/** Años que admite un mes de regla (`0000-01` o `9999-12` romperían la fecha de la base: se rechazan con 400). */
const ANIO_MIN_MES = 2000;
const ANIO_MAX_MES = 2100;
const MENSAJE_ANIO = `El año del mes debe estar entre ${ANIO_MIN_MES} y ${ANIO_MAX_MES}.`;

/** `aaaa-mm` o `aaaa-mm-01`; cualquier otro día se rechaza. Sale siempre como `aaaa-mm`. */
export const mesSchema = z
  .string(MENSAJE_MES)
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, MENSAJE_MES)
  .refine((v) => Number(v.slice(0, 4)) >= ANIO_MIN_MES && Number(v.slice(0, 4)) <= ANIO_MAX_MES, MENSAJE_ANIO)
  .transform((v) => v.slice(0, 7));

const decimales = (v: number, n: number) => Math.abs(v * 10 ** n - Math.round(v * 10 ** n)) < 1e-9;

const rangoImi = (campo: string) =>
  z
    .number(`${campo} debe ser un número de meses.`)
    .min(IMI_LIMITE_MIN, `${campo} debe estar entre ${IMI_LIMITE_MIN} y ${IMI_LIMITE_MAX} meses.`)
    .max(IMI_LIMITE_MAX, `${campo} debe estar entre ${IMI_LIMITE_MIN} y ${IMI_LIMITE_MAX} meses.`)
    .refine((v) => decimales(v, 1), `${campo} admite un solo decimal.`);

const pctDirecto = z
  .number("El porcentaje directo debe ser un número.")
  .min(0, "El porcentaje directo debe estar entre 0 y 100.")
  .max(100, "El porcentaje directo debe estar entre 0 y 100.")
  .refine((v) => decimales(v, 2), "El porcentaje directo admite hasta dos decimales.");

/** Vacío o solo espacios cuenta como "sin nota" (la base exige 1 a 200 caracteres si hay nota). */
const nota = z
  .string("La nota debe ser texto.")
  .trim()
  .max(MAX_NOTA_REGLA, `La nota no puede superar ${MAX_NOTA_REGLA} caracteres.`)
  .transform((v) => (v === "" ? null : v));

export const MENSAJE_RANGO = "El IMI máximo no puede ser menor que el mínimo.";

/** `POST /api/intercompany/reglas`: sin rango se guardan 4 y 8 (el general, decisión 29). */
export const crearReglaSchema = z
  .object({
    marca_id: uuid("La marca"),
    genero_mundo_linea_id: uuid("El nodo género-mundo-línea"),
    equivalencia_id: uuid("La equivalencia").nullish().transform((v) => v ?? null),
    vigente_desde: mesSchema,
    imi_min: rangoImi("El IMI mínimo").optional(),
    imi_max: rangoImi("El IMI máximo").optional(),
    pct_directo: pctDirecto,
    nota: nota.nullish().transform((v) => v ?? null),
  })
  .refine((v) => (v.imi_max ?? IMI_MAX_DEFECTO) >= (v.imi_min ?? IMI_MIN_DEFECTO), { message: MENSAJE_RANGO, path: ["imi_max"] });
export type CrearRegla = z.infer<typeof crearReglaSchema>;

/**
 * `PATCH /api/intercompany/reglas/[id]`: rango, porcentaje y nota. La fecha NO se edita (se elimina y se crea). La regla "tope ≥
 * mínimo" se evalúa en el servicio con los valores RESULTANTES (los guardados más los del cuerpo).
 */
export const editarReglaSchema = z
  .object({
    imi_min: rangoImi("El IMI mínimo").optional(),
    imi_max: rangoImi("El IMI máximo").optional(),
    pct_directo: pctDirecto.optional(),
    nota: nota.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Indica qué cambiar: rango IMI, porcentaje directo o nota. La fecha no se edita: elimina la regla y crea otra.",
  });
export type EditarRegla = z.infer<typeof editarReglaSchema>;

const bandera = (campo: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return false;
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
      ctx.addIssue({ code: "custom", message: `${campo} debe ser 1 o 0.` });
      return false;
    });

/** `GET /api/intercompany/reglas?mes=&incluir_historial=1`. */
export const reglasQuerySchema = z.object({
  mes: mesSchema.optional(),
  incluir_historial: bandera("incluir_historial"),
});

/** `GET /api/intercompany/vigentes?desde=&hasta=`: sin ellos, todas las activas. */
export const vigentesQuerySchema = z
  .object({ desde: mesSchema.optional(), hasta: mesSchema.optional() })
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta, { message: "«desde» no puede ser posterior a «hasta».", path: ["hasta"] });

/** `GET /api/intercompany/aplicabilidad?marca_id=&genero_mundo_linea_id=&mes=`. */
export const aplicabilidadQuerySchema = z.object({
  marca_id: uuid("marca_id"),
  genero_mundo_linea_id: uuid("genero_mundo_linea_id"),
  mes: mesSchema.optional(),
});
