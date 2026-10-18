import { z } from "zod";
import { MAX_NOTA_REPARTO, MODOS_ENTRADA, FUENTES, TEMPORADAS, VENTANAS, VENTANA_DEFECTO, MODO_DEFECTO } from "./tipos-api";

/**
 * Esquemas zod de M12 (ficha 12, sección 7). Los mensajes van en castellano porque `leerCuerpo` y `leerConsulta` los devuelven
 * tal cual a la pantalla. Los catálogos (`modo`, `fuente`, `ventana_meses`, `temporada`) se validan AQUÍ y no en la base
 * (criterio I9: ampliarlos no exige `DROP constraint`).
 */

const uuid = z.uuid("Debe ser un identificador válido.");

const MENSAJE_VENTANA = `La ventana debe ser ${VENTANAS.join(", ")} meses.`;
const MENSAJE_MODO = "El modo debe ser anual o por_temporada.";
const MENSAJE_FUENTE = "La fuente debe ser historico o cerrada.";

const ventanaNumero = z
  .number(MENSAJE_VENTANA)
  .refine((v) => (VENTANAS as readonly number[]).includes(v), MENSAJE_VENTANA);

/** Lista de uuid en la query (`a,b,c`); vacío o ausente → `[]`. */
const listaUuid = (campo: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? [] : v.split(",").map((x) => x.trim()).filter((x) => x !== "")))
    .pipe(z.array(uuid, `${campo} debe ser una lista de identificadores separados por comas.`).max(500, `${campo} admite hasta 500 identificadores.`));

const bandera = (campo: string, defecto: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return defecto;
      if (v === "1" || v === "true") return true;
      if (v === "0" || v === "false") return false;
      ctx.addIssue({ code: "custom", message: `${campo} debe ser 1 o 0.` });
      return defecto;
    });

/** `GET /api/marcas-barrer?ventana=24`. */
export const listaQuerySchema = z.object({
  ventana: z.coerce.number(MENSAJE_VENTANA).pipe(ventanaNumero).default(VENTANA_DEFECTO),
});

/** `GET /api/marcas-barrer/[marcaId]?ventana=&modo=&normaliza_nino=1&genero=&mundo=&lineas=`. */
export const analisisQuerySchema = z.object({
  ventana: z.coerce.number(MENSAJE_VENTANA).pipe(ventanaNumero).default(VENTANA_DEFECTO),
  modo: z.enum(MODOS_ENTRADA, MENSAJE_MODO).default(MODO_DEFECTO),
  normaliza_nino: bandera("normaliza_nino", true),
  genero: listaUuid("genero"),
  mundo: listaUuid("mundo"),
  lineas: listaUuid("lineas"),
});

/** `GET /api/marcas-barrer/vigentes?marca_ids=a,b,c` (sin `marca_ids`, todas las marcas con reparto vigente). */
export const vigentesQuerySchema = z.object({ marca_ids: listaUuid("marca_ids") });

export const MAX_FILAS_APROBAR = 5_000;

const alcanceSchema = z
  .object({
    generos: z.array(uuid, "generos debe ser una lista de identificadores.").max(500).optional(),
    mundos: z.array(uuid, "mundos debe ser una lista de identificadores.").max(500).optional(),
    lineas: z.array(uuid, "lineas debe ser una lista de identificadores.").max(500).optional(),
  })
  .default({});

const notaSchema = z
  .string("La nota debe ser texto.")
  .transform((v) => v.trim())
  .pipe(z.string().max(MAX_NOTA_REPARTO, `La nota no puede superar ${MAX_NOTA_REPARTO} caracteres.`))
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** `POST /api/marcas-barrer/[marcaId]/repartos`. Las filas de resto llegan expandidas por `g`. */
export const aprobarRepartoSchema = z.object({
  ventana_meses: ventanaNumero,
  modo: z.enum(MODOS_ENTRADA, MENSAJE_MODO),
  fuente: z.enum(FUENTES, MENSAJE_FUENTE),
  alcance: alcanceSchema,
  normaliza_nino: z.boolean("normaliza_nino debe ser verdadero o falso."),
  huella: z.string("La huella debe ser texto.").min(1, "Falta la huella del análisis.").max(200, "La huella no es válida."),
  filas: z
    .array(
      z.object({
        genero_mundo_linea_id: uuid,
        equivalencia_id: uuid.nullable().optional(),
        temporada: z.enum(TEMPORADAS, "La temporada debe ser verano o invierno.").nullable().optional(),
        participacion_ajustada: z
          .number("La participación debe ser un número entre 0 y 1.")
          .min(0, "La participación debe estar entre 0 y 1.")
          .max(1, "La participación debe estar entre 0 y 1.")
          .nullable(),
      }),
      "filas debe ser una lista."
    )
    .max(MAX_FILAS_APROBAR, `Se admiten hasta ${MAX_FILAS_APROBAR} filas.`),
  nota: notaSchema,
});

export type ListaQuery = z.infer<typeof listaQuerySchema>;
export type AnalisisQuery = z.infer<typeof analisisQuerySchema>;
export type VigentesQuery = z.infer<typeof vigentesQuerySchema>;
export type AprobarReparto = z.infer<typeof aprobarRepartoSchema>;
