import { z } from "zod";
import { MAX_TOTAL } from "@/lib/proyeccion/tipos-api";
import { VERSIONES_PROMPT } from "./prompt";
import { CAPACIDADES_IA, PLIEGUES_IA, type BanderaIa } from "./tipos-api";

/**
 * Esquemas zod de la propuesta con IA (ficha 07e, §3.1, §3.2 y §3.6). Cada cuerpo se valida con `leerCuerpo`; los mensajes van en
 * castellano llano para mostrarse en pantalla. Lo que depende de los datos (propuesta vigente, meta de hoy, capacidades) lo valida el servidor.
 */

/** Caracteres de control, de formato (ancho cero, LRM, RLM) y separadores de línea o de párrafo: más amplio que `CARACTERES_PROHIBIDOS_NOTA`. */
export const CARACTERES_PROHIBIDOS_IA = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const sinProhibidos = (v: string): boolean => !new RegExp(CARACTERES_PROHIBIDOS_IA.source, "u").test(v);

export const BANDERAS_IA = [
  "dato_insuficiente",
  "linea_nueva",
  "en_salida",
  "quiebres",
  "nino",
  "volatil",
  "tiendas_entrantes",
  "meta_exigente",
  "meta_holgada",
  "estacionalidad_atipica",
] as const satisfies readonly BanderaIa[];

// ─── Salida del proveedor (§3.6) ───

const entero = z.number().int().min(0).max(MAX_TOTAL);
const f = z.string().regex(/^f\d{3,4}$/);
const banderas = z.array(z.string().max(40)).max(6);

export const salidaNaturalIa = z.strictObject({
  version_salida: z.literal(2),
  filas: z
    .array(z.strictObject({ f, natural_y1: entero, razon_natural: z.string().min(1).max(260), banderas, confianza: z.enum(["alta", "media", "baja"]) }))
    .max(150),
});

export const salidaRepartoIa = z.strictObject({
  version_salida: z.literal(2),
  /** Se recorta a 600 (directo; en jerárquico manda la de `lineas`). */
  razon_gm: z.string().max(800),
  banderas_gm: banderas,
  filas: z.array(z.strictObject({ f, meta_y1: entero, razon: z.string().min(1).max(400), banderas })).max(150),
});

export const salidaLineasIa = z.strictObject({
  version_salida: z.literal(2),
  razon_gm: z.string().max(800),
  banderas_gm: banderas,
  lineas: z.array(z.strictObject({ l: z.string().regex(/^l\d{2,3}$/), meta_y1: entero, razon: z.string().min(1).max(400) })).max(150),
});

export type SalidaNaturalIa = z.infer<typeof salidaNaturalIa>;
export type SalidaRepartoIa = z.infer<typeof salidaRepartoIa>;
export type SalidaLineasIa = z.infer<typeof salidaLineasIa>;
export type TipoLlamadaIa = "natural" | "reparto" | "lineas";

export const ESQUEMAS_SALIDA = { natural: salidaNaturalIa, reparto: salidaRepartoIa, lineas: salidaLineasIa } as const;

/** La salida estructurada de los proveedores no admite todas las restricciones de JSON Schema (rev. M8): se quitan; zod las exige igual al volver. */
const NO_SOPORTADAS = new Set(["$schema", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "format", "multipleOf"]);

function simplificar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(simplificar);
  if (valor !== null && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      // `properties` es un mapa de nombres de campo: no se filtran sus claves, sí cada esquema hijo.
      if (k === "properties" && v !== null && typeof v === "object" && !Array.isArray(v)) {
        salida[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, s]) => [n, simplificar(s)]));
      } else if (!NO_SOPORTADAS.has(k)) salida[k] = simplificar(v);
    }
    return salida;
  }
  return valor;
}

/** JSON Schema (`z.toJSONSchema`) de una salida, con solo el subconjunto que admite el proveedor. */
export function jsonSchemaSalida(tipo: TipoLlamadaIa): Record<string, unknown> {
  return simplificar(z.toJSONSchema(ESQUEMAS_SALIDA[tipo])) as Record<string, unknown>;
}

// ─── Cuerpos de las rutas (§3.1 y §3.2) ───

const uuid = z.uuid("Identificador inválido.");
const dinero = (max: number, nombre: string) =>
  z.number(`${nombre} debe ser un número.`).positive(`${nombre} debe ser mayor que 0.`).max(max, `${nombre} no puede superar ${max}.`);
const costoConfirmado = z.number("El costo confirmado debe ser un número.").min(0, "El costo confirmado no puede ser negativo.");
const nota = z
  .string("La nota debe ser texto.")
  .trim()
  .max(300, "La nota no puede superar 300 caracteres.")
  .refine(sinProhibidos, "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.");

export const claveGMSchema = z.string("La clave del género y mundo debe ser texto.").min(1, "Falta la clave del género y mundo.").max(80, "La clave del género y mundo es demasiado larga.");

export const iniciarCorridaSchema = z.strictObject({
  gms: z.union([z.literal("pendientes"), z.literal("todos"), z.array(claveGMSchema).min(1, "Elige al menos un género y mundo.").max(60, "Son demasiados géneros y mundos.")], "Elige «pendientes», «todos» o una lista de géneros y mundos."),
  regenerar: z.boolean("«Regenerar» debe ser verdadero o falso.").default(false),
  costo_confirmado_usd: costoConfirmado,
});

export const terminarCorridaSchema = z.strictObject({ cancelar: z.boolean("«Cancelar» debe ser verdadero o falso.").default(false) });

export const pasoVacioSchema = z.strictObject({});

export const aceptarIaSchema = z.strictObject({
  anio: z.int("El año debe ser un número entero."),
  propuesta_fila_id: uuid,
  valor_esperado: z.int("La cifra que viste debe ser un número entero.").min(0, "La cifra que viste no puede ser negativa.").max(MAX_TOTAL, "La cifra que viste es demasiado grande."),
  nota: nota.optional(),
});

export const preciosSchema = z.strictObject({
  entrada: dinero(1000, "El precio de entrada"),
  salida: dinero(1000, "El precio de salida"),
  cache_escritura: dinero(1000, "El precio de escritura en caché"),
  cache_lectura: dinero(1000, "El precio de lectura de caché"),
});

const termino = z.string("Cada término debe ser texto.").trim().min(2, "Cada término debe tener al menos 2 caracteres.").max(60, "Cada término puede tener hasta 60 caracteres.").refine(sinProhibidos, "Un término no puede llevar caracteres de control.");

export const configuracionSchema = z
  .strictObject({
    modelo: z.string("El modelo debe ser texto.").trim().min(1, "Escribe el modelo.").max(100, "El modelo no puede superar 100 caracteres."),
    version_prompt: z.enum(VERSIONES_PROMPT, "Esa versión del prompt no existe."),
    capacidades: z.array(z.enum(CAPACIDADES_IA, "Esa capacidad no existe.")),
    evaluacion_id: uuid.nullable(),
    tope_usd_corrida: dinero(500, "El tope por corrida"),
    tope_usd_mes: dinero(5000, "El tope mensual"),
    tope_usd_dia_usuario: dinero(500, "El tope por usuario y día"),
    max_filas_llamada: z.int("Las filas por llamada deben ser un número entero.").min(10, "Mínimo 10 filas por llamada.").max(150, "Máximo 150 filas por llamada."),
    incluir_cola_larga: z.boolean("«Incluir cola larga» debe ser verdadero o falso."),
    presupuesto_razonamiento: z.int("El presupuesto de razonamiento debe ser un número entero.").min(0, "No puede ser negativo.").max(32000, "Máximo 32 000 tokens."),
    precios: preciosSchema,
    terminos_extra: z.array(termino).max(50, "Máximo 50 términos."),
    nota: nota.nullish().transform((v) => (v === undefined || v === null || v === "" ? null : v)),
    version_vigente: z.int("version_vigente debe ser un número entero (o null si no había versión vigente).").min(1).nullable(),
  })
  .refine((c) => new Set(c.capacidades).size === c.capacidades.length, { message: "Hay capacidades repetidas.", path: ["capacidades"] });

export const evaluacionSchema = z.strictObject({
  modelo: z.string("El modelo debe ser texto.").trim().min(1, "Escribe el modelo.").max(100, "El modelo no puede superar 100 caracteres."),
  version_prompt: z.enum(VERSIONES_PROMPT, "Esa versión del prompt no existe."),
  pliegues: z
    .array(z.enum(PLIEGUES_IA, "Ese pliegue no existe."))
    .min(1, "Elige al menos un pliegue.")
    .refine((p) => new Set(p).size === p.length, "Hay pliegues repetidos.")
    .optional(),
  precios: preciosSchema,
  tope_usd: dinero(500, "El tope de la evaluación"),
  costo_confirmado_usd: costoConfirmado,
});

export const pasoEvaluacionSchema = z.strictObject({ pliegue: z.enum(PLIEGUES_IA, "Ese pliegue no existe.") });

export const pliegueRutaSchema = z.enum(PLIEGUES_IA, "Ese pliegue no existe.");

export const usoQuerySchema = z.strictObject({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes debe ser aaaa-mm.").optional() });

export const filtroFilasIaSchema = z.strictObject({ genero_id: uuid.optional(), mundo_id: uuid.optional(), linea_id: uuid.optional() });
