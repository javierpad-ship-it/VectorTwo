import { z } from "zod";
import {
  BLOQUES_TABLERO,
  DESGLOSES_TABLERO,
  MAX_AGRUPACIONES,
  MAX_COMENTARIO_DIRECCION,
  MAX_GENEROS,
  MAX_TIENDAS,
  MIN_COMENTARIO_DIRECCION,
  MOTIVOS_DIRECCION,
  RESULTADOS_APROBACION,
  TEMPORADAS_TABLERO,
  type AprobarCuerpoApi,
  type FiltrosTableroApi,
  type FiltrosVistosApi,
} from "./tipos-api";

/**
 * Esquemas zod del tablero de aprobación de dirección (ficha 14, §3.2). Los mensajes van en castellano llano para mostrarse en pantalla.
 *
 * Dos formas de mandar listas, a propósito (M1 de la primera revisión):
 *   - en la query de un `GET`, como TEXTO separado por comas (`generos=<uuid>,<uuid>`);
 *   - en el cuerpo JSON del `POST`, como ARREGLOS (`filtros_vistos.generos = ["<uuid>"]`).
 *
 * Lo que depende de los datos lo valida el servidor con el catálogo: que la unidad de marca sea de una de las agrupaciones elegidas
 * (`400 marca_fuera_de_agrupacion`), que la línea sea de ese género y ese mundo, que las proyecciones existan y que la comparada no sea la mostrada
 * cuando una de las dos sale del valor por defecto (`400 comparar_igual`).
 */

export { MOTIVOS_DIRECCION };

/** Un parámetro o un campo que no existe se rechaza (un `mundo=` en vez de `mundo_id=` no debe dar, en silencio, un tablero sin filtrar). */
const estricto = {
  error: (iss: { code?: string; keys?: string[] }) => (iss.code === "unrecognized_keys" ? `Dato desconocido: la petición lleva un campo que no existe (${(iss.keys ?? []).join(", ")}).` : undefined),
};

/**
 * Un uuid, con el mensaje completo si no lo es (`falta`, si se da, cuando no viene). Sale en minúsculas (como los devuelve Postgres): sirve de clave
 * de caché y se compara sin más con los del catálogo.
 */
const uuid = (de: string, mensaje = `El identificador ${de} no es válido.`) =>
  z.uuid({ error: (iss) => (iss.input === undefined ? `Falta el identificador ${de}.` : mensaje) }).toLowerCase();

/**
 * Lista en la query: texto separado por comas. Se descartan los trozos vacíos y los repetidos; una lista vacía cuenta como ausente (sin filtro en
 * esa dimensión), nunca como «nada coincide».
 */
const listaQuery = <T extends z.ZodType<unknown, string>>(item: T, max: number, que: string) =>
  z
    .string(`${que}: debe ser una lista separada por comas.`)
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v !== "")
      ),
    ])
    .pipe(z.array(item).max(max, `Se pueden elegir hasta ${max} ${que} a la vez.`))
    .transform((v) => (v.length > 0 ? v : undefined));

const temporada = z.enum(TEMPORADAS_TABLERO, "La temporada debe ser invierno, verano, todo_el_ano o sin_temporada.");
const bloque = z.enum(BLOQUES_TABLERO, "El bloque debe ser todas, mismas, nuevas o cierres.");
const desglose = z.enum(DESGLOSES_TABLERO, "El desglose debe ser genero, mundo, linea, agrupacion_marca, marca, temporada o tienda.");

// ─── GET /api/direccion/tablero ───

const MENSAJE_COMPARAR_INVALIDO = "«comparar_id» debe ser el identificador de una proyección o «ninguna».";
export const MENSAJE_COMPARAR_IGUAL = "La proyección para comparar no puede ser la misma que estás viendo.";
export const MENSAJE_LINEA_SIN_MUNDO = "Para filtrar por línea elige también un mundo.";
export const MENSAJE_LINEA_UN_GENERO = "Para filtrar por línea elige un solo género (sin «Resto»).";

/** Objeto SIN refinamientos: `.partial()`, `.extend()` y `.pick()` no se pueden llamar sobre un objeto ya refinado (M1). */
const filtrosQueryBase = z.strictObject(
  {
    /** Ausente = `por_defecto` de `/opciones`. */
    proyeccion_id: uuid("de la proyección").optional(),
    /** Ausente = `comparar_por_defecto`; `"ninguna"` = sin comparar. */
    comparar_id: z.union([uuid("de la proyección para comparar", MENSAJE_COMPARAR_INVALIDO), z.literal("ninguna")], MENSAJE_COMPARAR_INVALIDO).optional(),
    generos: listaQuery(uuid("del género"), MAX_GENEROS, "géneros").optional(),
    /** Atajo: suma a `generos` los géneros del Resto (fuera de `generosDeMatriz`). */
    resto: z
      .enum(["0", "1"], "«resto» debe ser 1 o 0.")
      .default("0")
      .transform((v) => v === "1"),
    mundo_id: uuid("del mundo").optional(),
    /** Exige un solo género (sin «Resto») y `mundo_id`. */
    linea_id: uuid("de la línea").optional(),
    temporadas: listaQuery(temporada, TEMPORADAS_TABLERO.length, "temporadas").optional(),
    /** Agrupaciones de marca (primer nivel). */
    am: listaQuery(uuid("de la agrupación de marca"), MAX_AGRUPACIONES, "agrupaciones de marca").optional(),
    /** UNA unidad de marca en `0.19.0`. */
    marca: uuid("de la marca").optional(),
    tiendas: listaQuery(uuid("de la tienda"), MAX_TIENDAS, "tiendas").optional(),
    bloque: bloque.default("todas"),
    desglose: desglose.default("mundo"),
  },
  estricto
);

/**
 * Query de `GET /api/direccion/tablero`. Se le pasa el objeto de `searchParams` SIN los valores vacíos (`sinVacios` de M7: los `Select` mandan `""`).
 * El problema de «comparar con la misma» lleva `params.codigo = "comparar_igual"` para que la ruta responda con ese código.
 */
export const tableroQuerySchema: z.ZodType<FiltrosTableroApi> = filtrosQueryBase.superRefine((v, ctx) => {
  if (v.linea_id !== undefined) {
    if (v.mundo_id === undefined) ctx.addIssue({ code: "custom", path: ["linea_id"], message: MENSAJE_LINEA_SIN_MUNDO });
    if (v.resto || v.generos === undefined || v.generos.length !== 1) ctx.addIssue({ code: "custom", path: ["linea_id"], message: MENSAJE_LINEA_UN_GENERO });
  }
  if (v.comparar_id !== undefined && v.comparar_id !== "ninguna" && v.comparar_id === v.proyeccion_id) {
    ctx.addIssue({ code: "custom", path: ["comparar_id"], message: MENSAJE_COMPARAR_IGUAL, params: { codigo: "comparar_igual" } });
  }
});

// ─── GET /api/direccion/bloqueos, /aprobaciones y /estado ───

/** `?proyeccion_id=<uuid>` de `/bloqueos` y de `GET /aprobaciones`. */
export const proyeccionQuerySchema = z.strictObject({ proyeccion_id: uuid("de la proyección") }, estricto);
export type ProyeccionQuery = z.infer<typeof proyeccionQuerySchema>;

/** `GET /api/direccion/estado`: una proyección concreta o la cerrada que usa el flujo de Compras. */
export type EstadoQuery = { proyeccion_id: string } | { para: "compras" };

/** `?proyeccion_id=<uuid>` o `?para=compras`: exactamente uno de los dos. */
export const estadoQuerySchema: z.ZodType<EstadoQuery> = z
  .strictObject(
    {
      proyeccion_id: uuid("de la proyección").optional(),
      para: z.literal("compras", "«para» solo admite «compras».").optional(),
    },
    estricto
  )
  .transform((v, ctx): EstadoQuery => {
    if (v.proyeccion_id !== undefined && v.para === undefined) return { proyeccion_id: v.proyeccion_id };
    if (v.para !== undefined && v.proyeccion_id === undefined) return { para: v.para };
    ctx.addIssue({ code: "custom", message: "Indica «proyeccion_id» o «para=compras» (uno de los dos)." });
    return z.NEVER;
  });

// ─── POST /api/direccion/aprobaciones ───

/** En el cuerpo JSON las listas son arreglos, no texto. Todo opcional: es solo lo que el admin tenía filtrado (va a `resumen.filtros_vistos`). */
export const filtrosVistosSchema: z.ZodType<FiltrosVistosApi> = z
  .object({
    generos: z.array(uuid("del género"), "«generos» debe ser una lista.").max(MAX_GENEROS, `Se pueden elegir hasta ${MAX_GENEROS} géneros a la vez.`),
    resto: z.boolean("«resto» debe ser verdadero o falso."),
    mundo_id: uuid("del mundo").nullable(),
    linea_id: uuid("de la línea").nullable(),
    temporadas: z.array(temporada, "«temporadas» debe ser una lista.").max(TEMPORADAS_TABLERO.length, "Hay demasiadas temporadas."),
    am: z.array(uuid("de la agrupación de marca"), "«am» debe ser una lista.").max(MAX_AGRUPACIONES, `Se pueden elegir hasta ${MAX_AGRUPACIONES} agrupaciones de marca a la vez.`),
    marca: uuid("de la marca").nullable(),
    tiendas: z.array(uuid("de la tienda"), "«tiendas» debe ser una lista.").max(MAX_TIENDAS, `Se pueden elegir hasta ${MAX_TIENDAS} tiendas a la vez.`),
    bloque,
  })
  .partial();

/**
 * Caracteres que un comentario no admite: los de control (salvo salto de línea, retorno y tabulador: el comentario puede tener varias líneas), los
 * separadores de línea y de párrafo de Unicode y los que cambian la dirección del texto (pueden disfrazar lo que se lee en el historial o en el Excel).
 */
const PROHIBIDOS = /[^\P{Cc}\n\r\t]|[\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/u;

/** Vacío o solo espacios → `null` (no se guarda). Ausente → `null`. */
const comentario = z
  .string("El comentario debe ser texto.")
  .trim()
  .max(MAX_COMENTARIO_DIRECCION, `El comentario no puede superar ${MAX_COMENTARIO_DIRECCION} caracteres.`)
  .refine((v) => !PROHIBIDOS.test(v), "El comentario no puede llevar caracteres de control ni de dirección de texto.")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null);

/** Largo en caracteres como los cuenta Postgres (`char_length`): un emoji cuenta uno, no dos. */
const largo = (v: string): number => [...v].length;

export const MENSAJE_MOTIVO_OBLIGATORIO = "Para aprobar con observaciones o rechazar, elige un motivo.";
export const MENSAJE_COMENTARIO_OBLIGATORIO = `Para aprobar con observaciones o rechazar, escribe un comentario de al menos ${MIN_COMENTARIO_DIRECCION} caracteres.`;

/**
 * Cuerpo de `POST /api/direccion/aprobaciones` (R18). `perfil_id`, `usuario_nombre` y `rol` NO viajan: los pone el servidor desde la sesión; el
 * `resumen` lo arma el servidor. `motivo` y `comentario` pueden omitirse (valen `null`); con `aprobada` son opcionales.
 */
export const aprobarDireccionSchema: z.ZodType<AprobarCuerpoApi> = z
  .object({
    proyeccion_id: uuid("de la proyección"),
    /** La que trajo el `GET` del tablero. */
    huella_vista: z.string("La huella debe ser texto.").regex(/^[0-9a-f]{32}$/, "La huella no es válida: vuelve a cargar el tablero."),
    resultado: z.enum(RESULTADOS_APROBACION, "El resultado debe ser aprobada, con_observaciones o rechazada."),
    motivo: z.enum(MOTIVOS_DIRECCION, "El motivo no es válido.").nullable().default(null),
    comentario,
    confirmo_revision: z.literal(true, "Confirma que revisaste las alertas y las cifras de toda la proyección."),
    /** Informativo; la aprobación es siempre de la proyección entera. */
    filtros_vistos: filtrosVistosSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.resultado === "aprobada") return;
    if (v.motivo === null) ctx.addIssue({ code: "custom", path: ["motivo"], message: MENSAJE_MOTIVO_OBLIGATORIO });
    if (v.comentario === null || largo(v.comentario) < MIN_COMENTARIO_DIRECCION) {
      ctx.addIssue({ code: "custom", path: ["comentario"], message: MENSAJE_COMENTARIO_OBLIGATORIO });
    }
  });
