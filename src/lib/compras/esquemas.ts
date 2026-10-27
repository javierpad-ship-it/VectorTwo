import { z } from "zod";
import { celdaTexto, MAX_CELDA_NOTA } from "@/lib/api/celdas";
import { mesSchema } from "@/lib/intercompany/esquemas";
import {
  ESTADOS_COMPRA,
  MAX_FILAS_IMPORTACION,
  MAX_FILAS_MEZCLA,
  MAX_MOTIVO_CANCELACION,
  MAX_NOMBRE_PROVEEDOR,
  MAX_NOTA_PROVEEDOR,
  MAX_NOTA_RECEPCION,
  MAX_RECEPCIONES_POR_LLAMADA,
  MAX_UNIDADES_LINEA,
  ORIGENES_COMPRA,
} from "./tipos";

/**
 * Esquemas zod de las compras de M8 (ficha 08, secciones 0.5, 0.11, 0.13 y 7; solo lo de `0.13.0`: la captura y la edición de
 * `0.13.1` se fijan entonces). Los mensajes van en castellano porque `leerCuerpo` y `leerConsulta` los devuelven tal cual a la
 * pantalla. Los catálogos y los rangos de negocio se validan AQUÍ y no en la base (criterio I9).
 *
 * Los meses entran como `aaaa-mm` (o `aaaa-mm-01`) y salen como `aaaa-mm` (`mesSchema` de M13). Los números de la plantilla de
 * importación llegan como texto de celda: `importar.ts` (T2b) los interpreta y omite la fila con su motivo en vez de dar `400`.
 */

const uuid = (campo: string) => z.uuid(`${campo} debe ser un identificador válido.`);

const MENSAJE_FECHA = "La fecha debe tener la forma aaaa-mm-dd (por ejemplo 2026-10-14).";

/** `aaaa-mm-dd` de un día que existe en el calendario (rechaza `2026-02-30`). */
export const fechaSchema = z
  .string(MENSAJE_FECHA)
  .regex(/^\d{4}-\d{2}-\d{2}$/, MENSAJE_FECHA)
  .refine((v) => {
    const [a, m, d] = v.split("-").map(Number);
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d && a >= 2000 && a <= 2100;
  }, MENSAJE_FECHA);

/** La revisión vigente de la compra: toda escritura la lleva (`409 compra_cambio` si ya no lo es). */
const revision = z
  .number("La revisión debe ser un número.")
  .int("La revisión debe ser un entero.")
  .min(0, "La revisión no puede ser negativa.");

/** Texto recortado; vacío o solo espacios cuenta como «sin texto» (`null`). */
const textoOpcional = (campo: string, max: number) =>
  z
    .string(`${campo} debe ser texto.`)
    .trim()
    .max(max, `${campo} no puede superar ${max} caracteres.`)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

// ─── Confirmar ingreso (recepciones, §0.5) ───

export const recepcionNuevaSchema = z.object({
  linea_id: uuid("La línea"),
  recibida_periodo: mesSchema,
  unidades: z
    .number("Las unidades deben ser un número.")
    .int("Las unidades deben ser un número entero.")
    .min(1, "Las unidades deben ser mayores que cero.")
    .max(MAX_UNIDADES_LINEA, "Las unidades son demasiadas."),
  fecha_recepcion: fechaSchema,
  nota: textoOpcional("La nota", MAX_NOTA_RECEPCION),
});
export type RecepcionNuevaCuerpo = z.infer<typeof recepcionNuevaSchema>;

/** `POST /api/compras/[id]/recibir` («Confirmar ingreso»). */
export const recibirSchema = z.object({
  revision,
  recepciones: z
    .array(recepcionNuevaSchema, "Indica qué ingresos confirmar.")
    .min(1, "Indica al menos un ingreso.")
    .max(MAX_RECEPCIONES_POR_LLAMADA, `Se admiten hasta ${MAX_RECEPCIONES_POR_LLAMADA} ingresos por vez.`),
});
export type Recibir = z.infer<typeof recibirSchema>;

/** `DELETE /api/compras/[id]/recepciones/[recepcionId]?revision=`: la revisión viaja en la query string. */
export const quitarRecepcionSchema = z.object({
  revision: z.coerce
    .number("La revisión debe ser un número.")
    .int("La revisión debe ser un entero.")
    .min(0, "La revisión no puede ser negativa."),
});
export type QuitarRecepcion = z.infer<typeof quitarRecepcionSchema>;

// ─── Cancelar (§0.11) ───

/** `POST /api/compras/[id]/cancelar`: el motivo es obligatorio. */
export const cancelarSchema = z.object({
  motivo: z
    .string("Escribe el motivo de la cancelación.")
    .trim()
    .min(1, "Escribe el motivo de la cancelación.")
    .max(MAX_MOTIVO_CANCELACION, `El motivo no puede superar ${MAX_MOTIVO_CANCELACION} caracteres.`),
  revision,
});
export type Cancelar = z.infer<typeof cancelarSchema>;

// ─── Proveedores (regla 19: sin datos bancarios, clave desconocida = 400) ───

const MENSAJE_CLAVE_DESCONOCIDA = "Dato desconocido: el proveedor no admite datos bancarios ni otros campos que los de la ficha.";

export const proveedorSchema = z.strictObject(
  {
    nombre: z
      .string("El nombre debe ser texto.")
      .trim()
      .min(1, "Escribe el nombre del proveedor.")
      .max(MAX_NOMBRE_PROVEEDOR, `El nombre no puede superar ${MAX_NOMBRE_PROVEEDOR} caracteres.`),
    codigo: textoOpcional("El código", 30),
    pais: textoOpcional("El país", 80),
    ciudad: textoOpcional("La ciudad", 80),
    identificacion: textoOpcional("La identificación", 40),
    es_intercompany: z.boolean("es_intercompany debe ser verdadero o falso.").optional(),
    nota: textoOpcional("La nota", MAX_NOTA_PROVEEDOR),
  },
  { error: (iss) => (iss.code === "unrecognized_keys" ? MENSAJE_CLAVE_DESCONOCIDA : undefined) },
);
export type ProveedorCuerpo = z.infer<typeof proveedorSchema>;

// ─── Importador de carga inicial (§0.13, 4.7) ───

const celda = (campo: string) => celdaTexto(campo).default("");

/**
 * Una fila de la hoja de compras tal como la lee el navegador: todo texto, `""` si la columna no venía. Columnas de la plantilla →
 * claves: `PROVEEDOR`, `FECHA_COMPRA`, `REFERENCIA`, `LINEA` (el ordinal dentro de la referencia) → `linea_ordinal`, `TIPO`,
 * `GENERO`, `MUNDO`, `LINEA` (la línea de producto) → `linea`, `EQUIVALENCIA`, `MARCA`, `AGRUPACION_MARCA`, `TALLAS`, `UNIDADES`,
 * `COSTO_UNITARIO`, `MONEDA`, `LLEGADA`, `ENTREGAS`, `RECIBIDAS`, `DESTINO`, `ALCANCE`, `NOTA`. La plantilla repite el encabezado
 * `LINEA`: la pantalla debe rotular el ordinal como `LINEA_ORDINAL` (como la hoja `MEZCLA`) para no confundirlos.
 */
export const filaImportacionCompraSchema = z.object({
  proveedor: celda("proveedor"),
  fecha_compra: celda("fecha_compra"),
  referencia: celda("referencia"),
  linea_ordinal: celda("linea_ordinal"),
  tipo: celda("tipo"),
  genero: celda("genero"),
  mundo: celda("mundo"),
  linea: celda("linea"),
  equivalencia: celda("equivalencia"),
  marca: celda("marca"),
  agrupacion_marca: celda("agrupacion_marca"),
  tallas: celda("tallas"),
  unidades: celda("unidades"),
  costo_unitario: celda("costo_unitario"),
  moneda: celda("moneda"),
  llegada: celda("llegada"),
  entregas: celdaTexto("entregas", 500).default(""),
  recibidas: celda("recibidas"),
  destino: celda("destino"),
  alcance: celdaTexto("alcance", 500).default(""),
  nota: celdaTexto("nota", MAX_CELDA_NOTA).default(""),
});
export type FilaImportacionCompra = z.infer<typeof filaImportacionCompraSchema>;

/** Hoja `MEZCLA` (M9a): `REFERENCIA`, `LINEA_ORDINAL`, `MARCA`, `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA`, `PCT`. */
export const filaMezclaImportacionSchema = z.object({
  referencia: celda("referencia"),
  linea_ordinal: celda("linea_ordinal"),
  marca: celda("marca"),
  genero: celda("genero"),
  mundo: celda("mundo"),
  linea: celda("linea"),
  equivalencia: celda("equivalencia"),
  pct: celda("pct"),
});
export type FilaMezclaImportacion = z.infer<typeof filaMezclaImportacionSchema>;

/** `POST /api/compras/importar`. En `0.13.0` la casilla es obligatoria: sin `carga_inicial` la ruta responde `400 carga_inicial_requerida`. */
export const importarComprasSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  carga_inicial: z.boolean("carga_inicial debe ser verdadero o falso.").default(false),
  filas: z
    .array(filaImportacionCompraSchema)
    .min(1, "No hay filas que importar.")
    .max(MAX_FILAS_IMPORTACION, "Se admiten hasta 10 000 filas por importación."),
  mezcla: z
    .array(filaMezclaImportacionSchema)
    .max(MAX_FILAS_MEZCLA, "Se admiten hasta 20 000 filas en la hoja MEZCLA.")
    .default([]),
});
export type ImportarCompras = z.infer<typeof importarComprasSchema>;

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

/** `GET /api/compras?estado&proveedor_id&origen&llegada_desde&llegada_hasta&genero_id&mundo_id&linea_id&marca_id&mio=1&por_confirmar=1&q=`. */
export const comprasQuerySchema = z
  .object({
    estado: z.enum(ESTADOS_COMPRA, "El estado debe ser borrador, confirmada, recibida o cancelada.").optional(),
    proveedor_id: uuid("El proveedor").optional(),
    origen: z.enum(ORIGENES_COMPRA, "El origen debe ser comprador, carga_inicial o intercompany_cd.").optional(),
    llegada_desde: mesSchema.optional(),
    llegada_hasta: mesSchema.optional(),
    genero_id: uuid("El género").optional(),
    mundo_id: uuid("El mundo").optional(),
    linea_id: uuid("La línea").optional(),
    marca_id: uuid("La marca").optional(),
    mio: bandera("mio"),
    por_confirmar: bandera("por_confirmar"),
    q: z.string().trim().max(100, "La búsqueda no puede superar 100 caracteres.").optional(),
  })
  .refine((v) => v.llegada_desde === undefined || v.llegada_hasta === undefined || v.llegada_desde <= v.llegada_hasta, {
    message: "«llegada_desde» no puede ser posterior a «llegada_hasta».",
    path: ["llegada_hasta"],
  });
export type ComprasQuery = z.infer<typeof comprasQuerySchema>;
