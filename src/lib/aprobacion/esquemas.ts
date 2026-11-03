import { z } from "zod";
import { MAX_TOTAL } from "@/lib/proyeccion/tipos-api";
import {
  MAX_FILAS_LOTE,
  MAX_LOTES_CONFIRMACION,
  MAX_NOTA_LOTE,
  REVISION_OBLIGATORIA_DESDE,
  type FiltroLote,
} from "./tipos-api";

/**
 * Esquemas zod de la aprobación en bloque (ficha 07g, §3.1 y §3.2; R15). Cada cuerpo se valida con `leerCuerpo`; los mensajes van en castellano llano
 * para mostrarse en pantalla. Lo que depende de los datos (bloqueos, valores de hoy, IA) lo valida el servidor.
 *
 * (`filtroLoteSchema` se acotó y endureció tras QA y seguridad: M2 y M4.)
 */

export { MAX_FILAS_LOTE, REVISION_OBLIGATORIA_DESDE };

/** Caracteres de control, de dirección de texto y separadores de línea: una nota es de una sola línea (como en 07e). */
const PROHIBIDOS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const sinProhibidos = (v: string): boolean => !PROHIBIDOS.test(v);

const uuid = z.uuid("Identificador inválido.");
const entero = (nombre: string) =>
  z.int(`${nombre} debe ser un número entero.`).min(0, `${nombre} no puede ser negativo.`).max(MAX_TOTAL, `${nombre} es demasiado grande.`);

/** Vacía o solo espacios → ausente (no se guarda). */
const nota = z
  .string("La nota debe ser texto.")
  .trim()
  .max(MAX_NOTA_LOTE, `La nota no puede superar ${MAX_NOTA_LOTE} caracteres.`)
  .refine(sinProhibidos, "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.")
  .transform((v) => (v === "" ? undefined : v));

const huella = z.string("La huella de la simulación debe ser texto.").regex(/^[0-9a-f]{64}$/, "La huella de la simulación no es válida: simula de nuevo.");

/**
 * El `filtro` es solo contexto de pantalla y se guarda tal cual en `proyeccion_lotes.filtro`: se acota fuerte (M2) y se le aplican los mismos caracteres prohibidos que a la nota
 * (M4). Hasta 5 listas × 50 valores × 80 caracteres; la pantalla manda un valor por lista (un id de 36 caracteres o la clave de un GM, de 73).
 */
export const MAX_VALORES_FILTRO = 50;
export const MAX_LARGO_VALOR_FILTRO = 80;
const texto = z
  .string("Cada valor del filtro debe ser texto.")
  .min(1, "Un valor del filtro no puede estar vacío.")
  .max(MAX_LARGO_VALOR_FILTRO, `Un valor del filtro no puede superar ${MAX_LARGO_VALOR_FILTRO} caracteres.`)
  .refine(sinProhibidos, "El filtro no puede llevar saltos de línea ni caracteres de control o de dirección de texto.");
const lista = z.array(texto).max(MAX_VALORES_FILTRO, "El filtro tiene demasiados valores.");

export const ESTADOS_IA_FILTRO = ["sin_propuesta", "sin_filas_libres", "al_dia", "meta_movida", "desactualizada", "fallida", "bloqueado_privacidad"] as const;

/** §4.3: contexto de pantalla que se guarda con el lote (no cambia lo que se aprueba). */
export const filtroLoteSchema: z.ZodType<FiltroLote> = z.strictObject({
  generos: lista.optional(),
  mundos: lista.optional(),
  lineas: lista.optional(),
  agrupaciones: lista.optional(),
  gms: lista.optional(),
  solo_sin_avisos_fuertes: z.boolean("«Solo sin avisos fuertes» debe ser verdadero o falso.").optional(),
  incluir_revision: z.boolean("«Para revisión» debe ser verdadero o falso.").optional(),
  confianza: z.array(z.enum(["alta", "media"])).max(2).optional(),
  estado_ia: z.array(z.enum(ESTADOS_IA_FILTRO)).max(ESTADOS_IA_FILTRO.length).optional(),
  brecha_max_pct: z.number("La brecha máxima debe ser un número.").min(0, "La brecha máxima no puede ser negativa.").max(10000, "La brecha máxima es demasiado grande.").optional(),
});

// ─── POST …/lotes (aprobar y reaprobar) ───

const itemLote = z
  .strictObject({
    fila_id: uuid,
    fuente: z.enum(["ia", "metodo"], "La fuente debe ser «ia» o «metodo»."),
    /** Lo que el planner vio como cifra de hoy (la propuesta del método o la de la IA). */
    valor_esperado: entero("La cifra que viste"),
    /** Solo al reaprobar: lo aprobado en bloque que viste. */
    decidido_esperado: entero("La cifra aprobada que viste").optional(),
    propuesta_fila_id: uuid.optional(),
  })
  .superRefine((it, ctx) => {
    if (it.fuente === "ia" && it.propuesta_fila_id === undefined) {
      ctx.addIssue({ code: "custom", path: ["propuesta_fila_id"], message: "Una fila aprobada con la IA debe llevar su propuesta de IA." });
    }
    if (it.fuente === "metodo" && it.propuesta_fila_id !== undefined) {
      ctx.addIssue({ code: "custom", path: ["propuesta_fila_id"], message: "Una fila aprobada con el método no lleva propuesta de IA." });
    }
  });

export const loteSchema = z
  .strictObject({
    lote_id: uuid,
    confirmacion_id: uuid,
    tipo: z.enum(["aprobar", "reaprobar"], "El tipo debe ser «aprobar» o «reaprobar».").default("aprobar"),
    anio: z.int("El año debe ser un número entero.").min(2024, "El año no es válido.").max(2101, "El año no es válido."),
    simular: z.boolean("«Simular» debe ser verdadero o falso.").default(false),
    /** Obligatoria al aplicar: el resultado simulado que el planner revisó (D8). */
    huella_simulacion: huella.optional(),
    revision_confirmada: z.boolean("«Revisé el resumen por GM» debe ser verdadero o falso.").default(false),
    filas: z
      .array(itemLote, "Elige las filas que quieres aprobar.")
      .min(1, "Elige al menos una fila.")
      .max(MAX_FILAS_LOTE, `Un lote admite como máximo ${MAX_FILAS_LOTE} filas: el navegador las envía por tandas.`),
    nota: nota.optional(),
    filtro: filtroLoteSchema.optional(),
  })
  .superRefine((c, ctx) => {
    const vistas = new Set<string>();
    c.filas.forEach((f, i) => {
      if (vistas.has(f.fila_id)) ctx.addIssue({ code: "custom", path: ["filas", i, "fila_id"], message: "Una fila no puede repetirse en el mismo lote." });
      vistas.add(f.fila_id);
      if (c.tipo === "reaprobar" && f.decidido_esperado === undefined) {
        ctx.addIssue({ code: "custom", path: ["filas", i, "decidido_esperado"], message: "Al reaprobar, cada fila debe llevar la cifra aprobada que viste." });
      }
    });
    if (!c.simular && c.huella_simulacion === undefined) {
      ctx.addIssue({ code: "custom", path: ["huella_simulacion"], message: "Simula el lote y revisa el resumen antes de aprobarlo." });
    }
  });
export type LoteCuerpo = z.infer<typeof loteSchema>;
export type ItemLote = LoteCuerpo["filas"][number];

// ─── POST …/lotes/[loteId]/revertir ───

/**
 * `lote_id` es el id del lote de REVERSIÓN que genera el navegador (D10); el lote que se revierte va en la ruta (`[loteId]`). `filas` son `fila_id`
 * (`proyeccion_filas.id`) del lote que se revierte: sin ellas se revierte entero.
 */
export const revertirSchema = z
  .strictObject({
    lote_id: uuid,
    filas: z.array(uuid, "Las filas deben ser una lista.").min(1, "Elige al menos una fila.").max(MAX_FILAS_LOTE, `Se pueden revertir como máximo ${MAX_FILAS_LOTE} filas por vez.`).optional(),
    nota: nota.optional(),
    simular: z.boolean("«Simular» debe ser verdadero o falso.").default(false),
    huella_simulacion: huella.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.filas && new Set(c.filas).size !== c.filas.length) ctx.addIssue({ code: "custom", path: ["filas"], message: "Una fila no puede repetirse." });
  });
export type RevertirCuerpo = z.infer<typeof revertirSchema>;

// ─── POST …/confirmaciones/[confirmacionId]/revertir ───

/** `lote_ids`: uno por cada lote de la confirmación que se revierte, generados por el navegador. */
export const revertirConfirmacionSchema = z
  .strictObject({
    lote_ids: z.array(uuid, "Los lotes de reversión deben ser una lista.").min(1, "Falta el identificador de los lotes de reversión.").max(MAX_LOTES_CONFIRMACION, "La confirmación tiene demasiadas tandas."),
    nota: nota.optional(),
    simular: z.boolean("«Simular» debe ser verdadero o falso.").default(false),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.lote_ids).size !== c.lote_ids.length) ctx.addIssue({ code: "custom", path: ["lote_ids"], message: "Un lote de reversión no puede repetirse." });
  });
export type RevertirConfirmacionCuerpo = z.infer<typeof revertirConfirmacionSchema>;
