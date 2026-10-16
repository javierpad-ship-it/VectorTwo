import { z } from "zod";
import { mes } from "@/lib/curvas/esquemas";
import { motivoRampaInvalida } from "./tiendas-nuevas";
import { MAX_TOTAL, RATIO_MAX, RATIO_MIN, SOLO_MATRIZ, TEMPORADAS_FACTOR } from "./tipos-api";

/**
 * Esquemas zod de M7 (ficha 07, sección 7, "Contratos de API"). Cada cuerpo se valida con `leerCuerpo`; los mensajes
 * van en castellano llano para mostrarse en pantalla.
 */

const noVacio = { message: "No hay nada que actualizar." };
const tieneAlgo = (v: object) => Object.keys(v).length > 0;

export const MAX_NOMBRE = 80;
/** Tope de un total decidido (unidades): evita desbordar columnas y sumas con una cifra tecleada de más. */
export { MAX_TOTAL };
/** Registros por llamada de `aplicar-curva`. */
export const MAX_REGISTROS_CURVA = 200;
export const MAX_NOTA_PROYECCION = 500;
export const MAX_NOTA_DECISION = 300;
export const MAX_NOTA_FACTOR = 200;

const nombre = z
  .string("El nombre debe ser texto.")
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(MAX_NOMBRE, `El nombre no puede superar ${MAX_NOMBRE} caracteres.`);

/** Vacía, solo espacios o `null` → `null`. */
const notaOpcional = (max: number) =>
  z
    .string("La nota debe ser texto.")
    .trim()
    .max(max, `La nota no puede superar ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const crecimiento = z
  .number("El crecimiento debe ser un número.")
  .min(-95, "El crecimiento no puede ser menor que −95 %.")
  .max(500, "El crecimiento no puede ser mayor que 500 %.");

const rampa = z
  .array(z.number("Cada valor de la rampa debe ser un número."), "La rampa debe ser una lista de números.")
  .min(1, "La rampa necesita al menos un mes.")
  .max(6, "La rampa no puede pasar de seis meses.")
  .superRefine((valor, ctx) => {
    const motivo = motivoRampaInvalida(valor);
    if (motivo) ctx.addIssue({ code: "custom", message: motivo });
  });

/** Parámetros editables de una proyección (los demás, `factores_usados` y `bloques`, los fija el cálculo). */
export const parametrosSchema = z.strictObject({
  crecimiento_pct_defecto: crecimiento,
  umbral_avance: z.number("El umbral de avance debe ser un número.").min(0, "El umbral de avance debe estar entre 0 y 1.").max(1, "El umbral de avance debe estar entre 0 y 1."),
  umbral_cobertura: z.number("El umbral de cobertura debe ser un número.").min(0, "El umbral de cobertura no puede ser negativo.").max(5, "El umbral de cobertura no puede superar 5."),
  umbral_cola_larga: z.int("El umbral de cola larga debe ser un número entero.").min(0, "El umbral de cola larga no puede ser negativo.").max(100000, "El umbral de cola larga es demasiado grande."),
  umbral_disponibilidad: z
    .number("El umbral de disponibilidad debe ser un número.")
    .min(0, "El umbral de disponibilidad debe estar entre 0 y 1.")
    .max(1, "El umbral de disponibilidad debe estar entre 0 y 1."),
  rampa_maduracion: rampa,
});

export const crearSchema = z.strictObject({
  nombre,
  hasta_periodo: mes.optional(),
  parametros: parametrosSchema.partial().optional(),
  copiar_de: z.uuid("La proyección de la que copiar no es válida.").optional(),
});

export const editarSchema = z
  .strictObject({
    nombre,
    nota: notaOpcional(MAX_NOTA_PROYECCION),
    hasta_periodo: mes,
    parametros: parametrosSchema.partial(),
  })
  .partial()
  .refine(tieneAlgo, noVacio);

/**
 * Decisión sobre una fila base y un año: `decidido = null` vuelve a la propuesta; `origen = propuesta` copia la propuesta
 * (y no necesita cifra); `manual` exige la cifra.
 */
export const decisionSchema = z
  .object({
    decidido: z.int("El total debe ser un número entero.").min(0, "El total no puede ser negativo.").max(MAX_TOTAL, "El total es demasiado grande.").nullable().optional(),
    origen: z.enum(["propuesta", "manual"], "El origen debe ser propuesta o manual.").default("manual"),
    nota: notaOpcional(MAX_NOTA_DECISION),
    crecimiento_pct: crecimiento.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.origen === "manual" && v.decidido === undefined && v.crecimiento_pct === undefined) {
      ctx.addIssue({ code: "custom", path: ["decidido"], message: "Escribe el total o acepta la propuesta." });
    }
  });

/** Decisión por tienda y año (sin crecimiento) con la rampa de la tienda. */
export const decisionTiendaSchema = z
  .object({
    decidido: z.int("El total debe ser un número entero.").min(0, "El total no puede ser negativo.").max(MAX_TOTAL, "El total es demasiado grande.").nullable().optional(),
    origen: z.enum(["propuesta", "manual"], "El origen debe ser propuesta o manual.").default("manual"),
    nota: notaOpcional(MAX_NOTA_DECISION),
    rampa: rampa.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.origen === "manual" && v.decidido === undefined && v.rampa === undefined) {
      ctx.addIssue({ code: "custom", path: ["decidido"], message: "Escribe el total, acepta la propuesta o cambia la rampa." });
    }
  });

/** Una cifra fijada a mano en UNA fila de tienda. */
export const decisionFilaTiendaSchema = z.object({
  decidido: z.int("El total debe ser un número entero.").min(0, "El total no puede ser negativo.").max(MAX_TOTAL, "El total es demasiado grande.").nullable(),
  nota: notaOpcional(MAX_NOTA_DECISION),
});

export const aplicarCurvaSchema = z
  .strictObject({
    fila_anio_ids: z
      .array(z.uuid("Un registro no es válido."), "fila_anio_ids debe ser una lista.")
      .min(1, "Indica al menos un registro.")
      .max(MAX_REGISTROS_CURVA, `Son demasiados registros a la vez (máximo ${MAX_REGISTROS_CURVA}). Aplica la curva por línea.`)
      .optional(),
    gml_id: z.uuid("La línea no es válida.").optional(),
    anio: z.int("El año debe ser un número entero.").min(2024, "El año no es válido.").max(2101, "El año no es válido.").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fila_anio_ids === undefined && v.gml_id === undefined) {
      ctx.addIssue({ code: "custom", message: "Indica qué curva aplicar: los registros (fila_anio_ids) o la línea (gml_id)." });
    } else if (v.fila_anio_ids !== undefined && v.gml_id !== undefined) {
      ctx.addIssue({ code: "custom", message: "Indica los registros o la línea, no las dos cosas." });
    }
  });

export const cerrarSchema = z.object({ nota: notaOpcional(MAX_NOTA_PROYECCION) });

/** `POST archivar`: el cuerpo es opcional; `confirmar_sin_cerrada` confirma archivar la única cerrada del año. */
export const archivarSchema = z.object({ confirmar_sin_cerrada: z.boolean("confirmar_sin_cerrada debe ser verdadero o falso.").optional() });

export const vacioSchema = z.object({}).strict().or(z.object({}));

export const factoresPutSchema = z.object({
  factores: z
    .array(
      z.object({
        anio: z.int("El año debe ser un número entero.").min(2000, "El año no es válido.").max(2101, "El año no es válido."),
        temporada: z.enum(TEMPORADAS_FACTOR as [string, ...string[]], "La temporada debe ser invierno o verano."),
        ratio_aplicado: z
          .number("El factor debe ser un número.")
          .gt(RATIO_MIN, `El factor debe ser mayor que ${RATIO_MIN}.`)
          .max(RATIO_MAX, `El factor no puede superar ${RATIO_MAX}.`)
          .nullable(),
        nota: notaOpcional(MAX_NOTA_FACTOR),
      }),
      "factores debe ser una lista."
    )
    .min(1, "No hay nada que actualizar.")
    .max(50, "Son demasiados factores a la vez."),
});

// ─── Parámetros de consulta ───

const uuidOpcional = z.uuid("El identificador no es válido.").optional();
const textoOpcional = z.string().trim().max(120, "El texto es demasiado largo.").optional();

/** `""` cuenta como ausente (los `Select` de la pantalla mandan cadenas vacías). */
export const sinVacios = (crudo: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(crudo).filter(([, v]) => v !== ""));

export const lineasQuerySchema = z.object({
  genero_id: uuidOpcional,
  mundo_id: uuidOpcional,
  linea_id: uuidOpcional,
  q: textoOpcional,
});

export const filtrosMatrizSchema = z.object({
  genero_id: uuidOpcional,
  mundo_id: uuidOpcional,
  linea_id: uuidOpcional,
  temporada: z.enum(["invierno", "verano", "todo_el_ano"], "La temporada debe ser invierno, verano o todo_el_ano.").optional(),
  agrupacion_estacionalidad_id: uuidOpcional,
  agrupacion_marca_id: uuidOpcional,
  solo: z.enum(SOLO_MATRIZ, "El filtro «solo» no es válido.").optional(),
});

export const matrizQuerySchema = filtrosMatrizSchema.extend({
  por: z.enum(["arbol", "agrupacion_marca"], "«por» debe ser arbol o agrupacion_marca.").default("arbol"),
});

export const mensualQuerySchema = filtrosMatrizSchema.extend({
  bloque: z.enum(["todas", "mismas", "nuevas", "cierres"], "El bloque debe ser todas, mismas, nuevas o cierres.").default("todas"),
  por_agrupacion: z
    .enum(["0", "1"], "por_agrupacion debe ser 0 o 1.")
    .default("0")
    .transform((v) => v === "1"),
});

export const tiendasQuerySchema = z.object({
  anio: z.coerce.number("El año debe ser un número de cuatro cifras, por ejemplo 2026.").int("El año debe ser un número entero.").min(2024, "El año no es válido.").max(2101, "El año no es válido.").optional(),
  bloque: z.enum(["nuevas", "cierres"], "El bloque debe ser nuevas o cierres.").optional(),
});

/** Año de `…/tiendas/[tiendaId]/filas?anio=`: obligatorio. */
export const filasTiendaQuerySchema = z.object({
  anio: z.coerce.number("El año debe ser un número de cuatro cifras, por ejemplo 2026.").int("El año debe ser un número entero.").min(2024, "El año no es válido.").max(2101, "El año no es válido."),
});

export const cerradaQuerySchema = z.object({
  anio: z.coerce.number("El año debe ser un número de cuatro cifras, por ejemplo 2026 (?anio=2026).").int("El año debe ser un número entero.").min(2024, "El año no es válido.").max(2101, "El año no es válido."),
});

export type CrearProyeccionCuerpo = z.infer<typeof crearSchema>;
export type EditarProyeccionCuerpo = z.infer<typeof editarSchema>;
export type DecisionCuerpo = z.infer<typeof decisionSchema>;
export type DecisionTiendaCuerpo = z.infer<typeof decisionTiendaSchema>;
