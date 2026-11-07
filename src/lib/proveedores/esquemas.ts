import { z } from "zod";
import { MAX_NOMBRE_PROVEEDOR, MAX_NOTA_PROVEEDOR, MONEDAS } from "@/lib/compras/tipos";
import { INCOTERMS, MAX_CONTACTOS_POR_PROVEEDOR } from "./constantes";
import { PAIS_EEUU, PAISES } from "./paises";
import { ESTADOS_EEUU } from "./regiones";

/**
 * Esquemas zod de los proveedores (08c, §3.1). Los mensajes van en castellano porque `leerCuerpo` los devuelve tal cual a la pantalla.
 * La ficha es ESTRICTA: una clave desconocida (banco, cuenta, `clave_origen`...) da `400` (R17, decisión 106).
 */

const MENSAJE_CLAVE_DESCONOCIDA = "Dato desconocido: el proveedor no admite datos bancarios ni otros campos que los de la ficha.";
const opcionesEstrictas = { error: (iss: { code: string }) => (iss.code === "unrecognized_keys" ? MENSAJE_CLAVE_DESCONOCIDA : undefined) };

/** Texto recortado; vacío o ausente cuenta como «sin texto» (`null`). */
const textoOpcional = (campo: string, max: number) =>
  z
    .string(`${campo} debe ser texto.`)
    .trim()
    .max(max, `${campo} no puede superar ${max} caracteres.`)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v));

const entero = (campo: string, min: number, max: number) =>
  z
    .number(`${campo} debe ser un número.`)
    .int(`${campo} debe ser un número entero.`)
    .min(min, `${campo} debe estar entre ${min} y ${max}.`)
    .max(max, `${campo} debe estar entre ${min} y ${max}.`)
    .nullish()
    .transform((v) => v ?? null);

const nombre = z
  .string("El nombre debe ser texto.")
  .trim()
  .min(1, "Escribe el nombre del proveedor.")
  .max(MAX_NOMBRE_PROVEEDOR, `El nombre no puede superar ${MAX_NOMBRE_PROVEEDOR} caracteres.`);

const pais = z.enum(PAISES, "Elige un país de la lista.");

/** Un contacto del proveedor (`nombre` obligatorio; `correo` con formato). */
export const contactoSchema = z.strictObject(
  {
    nombre: z.string("El nombre del contacto debe ser texto.").trim().min(1, "Escribe el nombre del contacto.").max(120, "El nombre del contacto no puede superar 120 caracteres."),
    cargo: textoOpcional("El cargo", 80),
    telefono: textoOpcional("El teléfono", 40),
    correo: z
      .string("El correo debe ser texto.")
      .trim()
      .max(120, "El correo no puede superar 120 caracteres.")
      .nullish()
      .transform((v) => (v === undefined || v === null || v === "" ? null : v))
      .refine((v) => v === null || z.email().safeParse(v).success, "El correo no tiene un formato válido."),
    es_principal: z.boolean("es_principal debe ser verdadero o falso.").optional().default(false),
  },
  opcionesEstrictas,
);
export type ContactoCuerpo = z.infer<typeof contactoSchema>;

const contactos = z
  .array(contactoSchema, "Los contactos deben ser una lista.")
  .max(MAX_CONTACTOS_POR_PROVEEDOR, `Un proveedor admite hasta ${MAX_CONTACTOS_POR_PROVEEDOR} contactos.`)
  .refine((lista) => lista.filter((c) => c.es_principal).length <= 1, "Solo un contacto puede ser el principal.");

const campoRevision = z.number("La revisión debe ser un número.").int("La revisión debe ser un entero.").min(0, "La revisión no puede ser negativa.");

const camposFicha = {
  nombre,
  codigo: textoOpcional("El código", 30),
  pais,
  region: textoOpcional("El estado o provincia", 80),
  ciudad: textoOpcional("La ciudad", 80),
  direccion: textoOpcional("La dirección", 300),
  identificacion: textoOpcional("El RUC / Tax ID", 40),
  es_intercompany: z.boolean("es_intercompany debe ser verdadero o falso.").optional(),
  puerto_embarque: textoOpcional("El puerto de embarque", 80),
  incoterm: z
    .enum(INCOTERMS, "Elige un incoterm de la lista.")
    .nullish()
    .transform((v) => v ?? null),
  moneda: z
    .enum(MONEDAS, "La moneda debe ser USD o PEN.")
    .nullish()
    .transform((v) => v ?? null),
  plazo_produccion_dias: entero("El plazo de producción", 0, 365),
  plazo_transito_dias: entero("El plazo de tránsito", 0, 180),
  condiciones_pago: textoOpcional("Las condiciones de pago", 200),
  nota: textoOpcional("La nota", MAX_NOTA_PROVEEDOR),
  /** Ausente en una edición = se conservan los actuales; en un alta = ninguno. */
  contactos: contactos.optional(),
};

/** Con Estados Unidos la región es obligatoria y sale de la lista de estados; con otro país es texto libre (R14). */
function exigirRegionDeEeuu(f: { pais: string; region: string | null }, ctx: z.RefinementCtx) {
  if (f.pais !== PAIS_EEUU) return;
  if (f.region === null) {
    ctx.addIssue({ code: "custom", path: ["region"], message: "Elige el estado de Estados Unidos." });
  } else if (!(ESTADOS_EEUU as readonly string[]).includes(f.region)) {
    ctx.addIssue({ code: "custom", path: ["region"], message: "Elige un estado de la lista de Estados Unidos." });
  }
}

/** La ficha completa (POST modo ficha y PATCH). `revision` solo cuenta al editar. */
export const proveedorFichaSchema = z
  .strictObject({ ...camposFicha, revision: campoRevision.optional() }, opcionesEstrictas)
  .superRefine(exigirRegionDeEeuu);
export type ProveedorFichaCuerpo = z.infer<typeof proveedorFichaSchema>;

/** `PATCH /api/compras/proveedores/[id]`: como la ficha, pero con la `revision` que vio el formulario. */
export const proveedorEdicionSchema = z
  .strictObject({ ...camposFicha, revision: campoRevision }, opcionesEstrictas)
  .superRefine(exigirRegionDeEeuu);
export type ProveedorEdicionCuerpo = z.infer<typeof proveedorEdicionSchema>;

/** Alta al vuelo: solo el nombre (y el país si se sabe). Con un parecido pregunta antes de crear (`409 nombre_parecido`). */
export const proveedorRapidoSchema = z.strictObject(
  {
    modo: z.literal("rapido"),
    nombre,
    pais: pais.nullish().transform((v) => v ?? null),
    confirmar_parecido: z.boolean("confirmar_parecido debe ser verdadero o falso.").optional(),
  },
  opcionesEstrictas,
);
export type ProveedorRapidoCuerpo = z.infer<typeof proveedorRapidoSchema>;

const proveedorFichaConModoSchema = z
  .strictObject({ modo: z.literal("ficha"), ...camposFicha, revision: campoRevision.optional() }, opcionesEstrictas)
  .superRefine(exigirRegionDeEeuu);

/**
 * `POST /api/compras/proveedores`: unión por `modo` (`"ficha"` o `"rapido"`). Sin `modo` se toma como `"ficha"`.
 * Un cuerpo que no es objeto pasa tal cual y falla con el mensaje de zod.
 */
export const proveedorCreacionSchema = z.preprocess(
  (v) => (typeof v === "object" && v !== null && !Array.isArray(v) && !("modo" in v) ? { ...v, modo: "ficha" } : v),
  z.discriminatedUnion("modo", [proveedorFichaConModoSchema, proveedorRapidoSchema], { error: "Indica el proveedor." }),
);
export type ProveedorCreacionCuerpo = z.infer<typeof proveedorCreacionSchema>;

/** `POST /api/compras/proveedores/[id]/activo`. */
export const activoProveedorSchema = z.strictObject({ activo: z.boolean("`activo` debe ser verdadero o falso.") });
export type ActivoProveedorCuerpo = z.infer<typeof activoProveedorSchema>;

/** `GET /api/compras/proveedores?activos=1&q=`. */
export const proveedoresQuerySchema = z.object({
  activos: z.enum(["1"], "`activos` solo admite 1.").optional(),
  q: z.string().trim().max(120, "La búsqueda es demasiado larga.").optional(),
});
export type ProveedoresQuery = z.infer<typeof proveedoresQuerySchema>;
