import { z } from "zod";

/**
 * Esquemas zod de la ficha de la línea y de las rutas de fotos (08c, §3.1). La subida de la foto NO usa zod: es `multipart/form-data`
 * validado en `validar.ts`.
 */

export const MAX_DESCRIPCION_LINEA = 200;
export const MAX_MODELO_LINEA = 60;

/** Texto recortado; vacío cuenta como «sin texto» (`null`). `null` explícito se acepta; ausente no (la ficha siempre manda los dos). */
const textoONulo = (campo: string, max: number) =>
  z
    .string(`${campo} debe ser texto o null.`)
    .trim()
    .max(max, `${campo} no puede superar ${max} caracteres.`)
    .nullable()
    .transform((v) => (v === null || v === "" ? null : v));

/**
 * `PATCH /api/compras/[id]/lineas/[lineaId]/ficha`: la descripción y el modelo nuevos, más `antes` (lo que vio el formulario). Si otra
 * persona los cambió, `409 linea_cambio`. Sin `revision` de la compra (§2.7).
 */
export const fichaLineaSchema = z.strictObject({
  descripcion: textoONulo("La descripción", MAX_DESCRIPCION_LINEA),
  modelo: textoONulo("El modelo", MAX_MODELO_LINEA),
  antes: z.strictObject({
    descripcion: textoONulo("La descripción anterior", MAX_DESCRIPCION_LINEA),
    modelo: textoONulo("El modelo anterior", MAX_MODELO_LINEA),
  }),
});
export type FichaLinea = z.infer<typeof fichaLineaSchema>;

/** `POST /api/compras/fotos/limpiar`: hay que confirmar a propósito. */
export const limpiarFotosSchema = z.strictObject({ confirmar: z.literal(true, "Confirma la limpieza con `confirmar: true`.") });
export type LimpiarFotos = z.infer<typeof limpiarFotosSchema>;

/** Un `[lineaId]` o `[fotoId]` de la ruta. */
export const idRutaSchema = z.uuid();
