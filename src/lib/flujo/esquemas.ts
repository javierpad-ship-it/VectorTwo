import { z } from "zod";
import { mesSchema } from "@/lib/intercompany/esquemas";
import { motivoTemporadasInvalidas } from "@/lib/marcas-barrer/temporadas";
import {
  IMI_LIMITE_MAX,
  IMI_LIMITE_MIN,
  MAX_MESES_HORIZONTE,
  MESES_TARJETA_MAX,
  MESES_TARJETA_MIN,
  UMBRAL_CONCILIACION_PCT_MAX,
  UMBRAL_CONCILIACION_U_MAX,
} from "./tipos";
import { SOLO_CONCILIACION, SOLO_FLUJO } from "./tipos-api";

/**
 * Esquemas zod del flujo de M8 (ficha 08, secciones 0.5 y 7; `0.13.0`). Los mensajes van en castellano porque `leerCuerpo` y
 * `leerConsulta` los devuelven tal cual a la pantalla. Los rangos de negocio se validan AQUÍ y no en la base (criterio I9). Los
 * meses entran como `aaaa-mm` (o `aaaa-mm-01`) y salen como `aaaa-mm`.
 */

const uuid = (campo: string) => z.uuid(`${campo} debe ser un identificador válido.`);

const decimales = (v: number, n: number) => Math.abs(v * 10 ** n - Math.round(v * 10 ** n)) < 1e-9;

// ─── Aceptar sugerencia (§0.5) ───

/** `POST /api/flujo/conciliacion/aceptar`. Sin `huella`: el servidor recalcula la sugerencia con los datos de hoy. */
export const aceptarSugerenciaSchema = z.object({
  periodo: mesSchema,
  linea_id: uuid("La línea"),
  entrega_id: uuid("La entrega"),
  unidades: z
    .number("Las unidades deben ser un número.")
    .int("Las unidades deben ser un número entero.")
    .min(1, "Las unidades deben ser mayores que cero."),
  revision: z
    .number("La revisión debe ser un número.")
    .int("La revisión debe ser un entero.")
    .min(0, "La revisión no puede ser negativa."),
});
export type AceptarSugerencia = z.infer<typeof aceptarSugerenciaSchema>;

// ─── Parámetros ───

const rangoImi = (campo: string) =>
  z
    .number(`${campo} debe ser un número de meses.`)
    .min(IMI_LIMITE_MIN, `${campo} debe estar entre ${IMI_LIMITE_MIN} y ${IMI_LIMITE_MAX} meses.`)
    .max(IMI_LIMITE_MAX, `${campo} debe estar entre ${IMI_LIMITE_MIN} y ${IMI_LIMITE_MAX} meses.`)
    .refine((v) => decimales(v, 1), `${campo} admite un solo decimal.`);

const mesDelAnio = (campo: string) =>
  z
    .number(`${campo} debe ser un mes del 1 al 12.`)
    .int(`${campo} debe ser un mes del 1 al 12.`)
    .min(1, `${campo} debe ser un mes del 1 al 12.`)
    .max(12, `${campo} debe ser un mes del 1 al 12.`);

const rangoTemporada = (nombre: string) =>
  z.object({ desde_mes: mesDelAnio(`El mes inicial de ${nombre}`), hasta_mes: mesDelAnio(`El mes final de ${nombre}`) });

export const temporadasSchema = z
  .object({ verano: rangoTemporada("verano"), invierno: rangoTemporada("invierno") })
  .superRefine((t, ctx) => {
    const motivo = motivoTemporadasInvalidas(t);
    if (motivo) ctx.addIssue({ code: "custom", message: motivo });
  });

export const MENSAJE_RANGO_IMI = "El IMI máximo no puede ser menor que el mínimo.";

/** `PUT /api/flujo/parametros`: la fila es única y se reemplaza entera, así que todos los campos son obligatorios. */
export const parametrosFlujoSchema = z
  .object({
    imi_min: rangoImi("El IMI mínimo"),
    imi_max: rangoImi("El IMI máximo"),
    meses_tarjeta: z
      .number("Los meses de la tarjeta deben ser un número.")
      .int("Los meses de la tarjeta deben ser un número entero.")
      .min(MESES_TARJETA_MIN, `Los meses de la tarjeta deben estar entre ${MESES_TARJETA_MIN} y ${MESES_TARJETA_MAX}.`)
      .max(MESES_TARJETA_MAX, `Los meses de la tarjeta deben estar entre ${MESES_TARJETA_MIN} y ${MESES_TARJETA_MAX}.`),
    extender_horizonte: z.boolean("extender_horizonte debe ser verdadero o falso."),
    temporadas: temporadasSchema,
    umbral_conciliacion_u: z
      .number("El umbral en unidades debe ser un número.")
      .int("El umbral en unidades debe ser un número entero.")
      .min(0, `El umbral en unidades debe estar entre 0 y ${UMBRAL_CONCILIACION_U_MAX}.`)
      .max(UMBRAL_CONCILIACION_U_MAX, `El umbral en unidades debe estar entre 0 y ${UMBRAL_CONCILIACION_U_MAX}.`),
    umbral_conciliacion_pct: z
      .number("El umbral en porcentaje debe ser un número.")
      .min(0, `El umbral en porcentaje debe estar entre 0 y ${UMBRAL_CONCILIACION_PCT_MAX}.`)
      .max(UMBRAL_CONCILIACION_PCT_MAX, `El umbral en porcentaje debe estar entre 0 y ${UMBRAL_CONCILIACION_PCT_MAX}.`)
      .refine((v) => decimales(v, 2), "El umbral en porcentaje admite hasta dos decimales."),
  })
  .refine((v) => v.imi_max >= v.imi_min, { message: MENSAJE_RANGO_IMI, path: ["imi_max"] });
export type ParametrosFlujo = z.infer<typeof parametrosFlujoSchema>;

// ─── Lectura (query string; `leerConsulta` descarta los valores vacíos) ───

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

const filtrosArbol = {
  genero_id: uuid("El género").optional(),
  mundo_id: uuid("El mundo").optional(),
  linea_id: uuid("La línea").optional(),
  mio: bandera("mio"),
};

const mesesTarjeta = z.coerce
  .number("meses debe ser un número.")
  .int("meses debe ser un número entero.")
  .min(MESES_TARJETA_MIN, `meses debe estar entre ${MESES_TARJETA_MIN} y ${MAX_MESES_HORIZONTE}.`)
  .max(MAX_MESES_HORIZONTE, `meses debe estar entre ${MESES_TARJETA_MIN} y ${MAX_MESES_HORIZONTE}.`);

/** `GET /api/flujo` y `GET /api/flujo/huecos`: `?genero_id&mundo_id&linea_id&agrupacion_marca_id&solo=falta|exceso|quiebre|por_confirmar&mio=1&meses=6`. */
export const flujoQuerySchema = z.object({
  ...filtrosArbol,
  agrupacion_marca_id: uuid("La agrupación de marca").optional(),
  solo: z.enum(SOLO_FLUJO, "solo debe ser falta, exceso, quiebre o por_confirmar.").optional(),
  meses: mesesTarjeta.optional(),
});
export type FlujoQuery = z.infer<typeof flujoQuerySchema>;

/** `GET /api/flujo/fila?gml_id&equivalencia_id&agrupacion_marca_id`. */
export const filaQuerySchema = z.object({
  gml_id: uuid("El nodo género-mundo-línea"),
  equivalencia_id: uuid("La equivalencia").optional(),
  agrupacion_marca_id: uuid("La agrupación de marca"),
});
export type FilaQuery = z.infer<typeof filaQuerySchema>;

/** `GET /api/flujo/conciliacion?periodo=aaaa-mm&genero_id&mundo_id&linea_id&solo=…&mio=1`; sin `periodo`, el último mes publicado. */
export const conciliacionQuerySchema = z.object({
  periodo: mesSchema.optional(),
  ...filtrosArbol,
  solo: z
    .enum(SOLO_CONCILIACION, "solo debe ser sin_registrar, sin_respaldo, entregas_vencidas o por_confirmar.")
    .optional(),
});
export type ConciliacionQuery = z.infer<typeof conciliacionQuerySchema>;
