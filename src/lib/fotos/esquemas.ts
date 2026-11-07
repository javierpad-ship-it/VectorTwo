import { z } from "zod";
import { ESTADOS_COMPRA, ORIGENES_COMPRA } from "@/lib/compras/tipos";
import { MAX_POR_PAGINA_FOTOS } from "./constantes";

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

// ─── `GET /api/compras/fotos` (§3.3) ───

const uuidFiltro = (campo: string) => z.uuid(`${campo} debe ser un identificador válido.`);
const entero = (campo: string, min: number, max: number) =>
  z
    .string(`${campo} debe ser un número.`)
    .regex(/^\d{1,6}$/, `${campo} debe ser un número entero.`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${campo} debe estar entre ${min} y ${max}.`);

/**
 * Filtros de Compras → Fotos. La API NUNCA lee la cookie del viaje activo (08b, R22): la pantalla manda `viaje_id` (`todos` o ausente = sin
 * filtro). Sin `estado`, las compras canceladas quedan fuera; con `estado=cancelada` salen en solo lectura.
 */
export const fotosQuerySchema = z.object({
  viaje_id: z.union([uuidFiltro("El viaje"), z.literal("sin_viaje"), z.literal("todos")], "El viaje debe ser un identificador, «sin_viaje» o «todos».").optional(),
  proveedor_id: uuidFiltro("El proveedor").optional(),
  compra_id: uuidFiltro("La compra").optional(),
  origen: z.enum(ORIGENES_COMPRA, "El origen debe ser comprador, carga_inicial o intercompany_cd.").optional(),
  estado: z.enum(ESTADOS_COMPRA, "El estado debe ser borrador, confirmada, recibida o cancelada.").optional(),
  solo_sin_foto: z
    .enum(["1", "0", "true", "false"], "solo_sin_foto debe ser 1 o 0.")
    .optional()
    .transform((v) => v === "1" || v === "true"),
  q: z.string().trim().max(100, "La búsqueda no puede superar 100 caracteres.").optional(),
  pagina: entero("La página", 1, 100_000).optional(),
  por_pagina: entero("El tamaño de página", 1, MAX_POR_PAGINA_FOTOS).optional(),
});
export type FotosQuery = z.infer<typeof fotosQuerySchema>;
