import { z } from "zod";
import { CARACTERES_PROHIBIDOS_NOTA } from "@/lib/curvas/esquemas";
import { crecimiento } from "@/lib/proyeccion/esquemas";
import { BASES_APROBABLES, BASES_CRECIMIENTO, CLAVE_RESTO, MAX_HUELLA_DATOS, MAX_NOTA_CRECIMIENTO, VARIANTES_APROBABLES, VARIANTES_BASE, type AlcanceCrecimiento } from "./tipos-api";

/**
 * Esquemas zod de 06d (ficha 06d, §3, «Contratos de API»). Cada cuerpo se valida con `leerCuerpo`; los mensajes van en castellano
 * llano para mostrarse en pantalla. Lo que depende de los datos (año permitido, referencia del año, género detallado) lo valida el
 * servidor.
 */

/** Lectura (incluye la heredada `cierre_proyectado`). */
export const BASES = BASES_CRECIMIENTO;

/** Bases y variantes heredadas (versiones de `0.12.1`/`0.13.x`) que ya no se aprueban: `400 base_retirada` (06e R11). */
export const BASES_RETIRADAS: readonly string[] = BASES_CRECIMIENTO.filter((b) => !(BASES_APROBABLES as readonly string[]).includes(b));
export const VARIANTES_RETIRADAS: readonly string[] = VARIANTES_BASE.filter((v) => !(VARIANTES_APROBABLES as readonly string[]).includes(v));

/** ¿La base de un `POST` es una de las retiradas? El handler la traduce a `400 base_retirada` con `MENSAJE_BASE_RETIRADA`. */
export const esBaseRetirada = (base: { tipo: string; variante: string }): boolean => BASES_RETIRADAS.includes(base.tipo) || VARIANTES_RETIRADAS.includes(base.variante);

export const MENSAJE_BASE_RETIRADA = "Esa base ya no se usa desde 0.14.0: elige “Cierre por curva” o “Aplicado hoy”.";

const uuid = z.uuid("Identificador inválido.");

export const notaCrecimientoSchema = z
  .string("La nota debe ser texto.")
  .trim()
  .max(MAX_NOTA_CRECIMIENTO, `La nota no puede superar ${MAX_NOTA_CRECIMIENTO} caracteres.`)
  .refine((v) => !CARACTERES_PROHIBIDOS_NOTA.test(v), "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.");

/**
 * Cuerpo del `POST /api/curvas/genero-mundo/[clave]`. Estricto: una clave desconocida es `400`. `nota` vacía (o solo espacios) llega
 * como `null`. `base.anio` es obligatorio con `anio_completo` y debe ser `null` con las demás bases. `pct` se redondea a 2 decimales
 * (`numeric(6,2)`) en el handler.
 *
 * `permitirRetiradas`: con `false` (esquema final de 06e §3.1) solo pasan `BASES_APROBABLES` y `VARIANTES_APROBABLES`. Con `true` (el
 * esquema de transición, `aprobarCrecimientoSchema`) también pasan las heredadas y el handler llama `esBaseRetirada` para responder
 * `400 base_retirada` sin escribir; así el tipo validado y las pruebas de la pantalla actual siguen valiendo hasta que Backend A
 * cambie el handler y pase a `aprobarCrecimientoSchemaEstricto`.
 */
export function crearAprobarCrecimientoSchema(permitirRetiradas: boolean) {
  const tipos = permitirRetiradas ? BASES_CRECIMIENTO : BASES_APROBABLES;
  const variantes = permitirRetiradas ? VARIANTES_BASE : VARIANTES_APROBABLES;
  return z
    .object({
      anio: z.int("El año debe ser un número entero.").min(2024, "El año no puede ser anterior a 2024.").max(2100, "El año no puede ser posterior a 2100."),
      pct: crecimiento,
      nota: notaCrecimientoSchema.nullable().transform((v) => (v === "" ? null : v)),
      base: z
        .object({
          tipo: z.enum(tipos, "La base debe ser acumulado, cierre_curva, anio_completo, aplicado_hoy o ninguna."),
          anio: z.int("El año de la base debe ser un número entero.").min(2023, "El año de la base no puede ser anterior a 2023.").max(2100, "El año de la base no puede ser posterior a 2100.").nullable(),
          variante: z.enum(variantes, "La variante debe ser corregido o bruto."),
        })
        .strict(),
      proyeccion_referencia_id: uuid.nullable(),
      huella_datos: z.string("La huella de los datos debe ser texto.").min(1, "Falta la huella de los datos: vuelve a cargar la pantalla.").max(MAX_HUELLA_DATOS, `La huella de los datos no puede superar ${MAX_HUELLA_DATOS} caracteres.`),
      version_vigente: z
        .number("version_vigente debe ser un número (o null si no había versión vigente).")
        .int("version_vigente debe ser un número entero.")
        .min(1, "version_vigente debe ser 1 o más (o null si no había versión vigente).")
        .nullable(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.base.tipo === "anio_completo" && v.base.anio === null) {
        ctx.addIssue({ code: "custom", message: "Con la base de año completo hay que indicar el año de la base.", path: ["base", "anio"] });
      }
      if (v.base.tipo !== "anio_completo" && v.base.anio !== null) {
        ctx.addIssue({ code: "custom", message: "Solo la base de año completo lleva año.", path: ["base", "anio"] });
      }
    });
}

export const aprobarCrecimientoSchema = crearAprobarCrecimientoSchema(true);
/** El esquema final de 06e (§3.1): rechaza las bases y variantes retiradas. */
export const aprobarCrecimientoSchemaEstricto = crearAprobarCrecimientoSchema(false);

export type AprobarCrecimientoValidado = z.infer<typeof aprobarCrecimientoSchema>;

// ─── Ruta y consulta ───

/** `resto` o `<genero_id>.<mundo_id>` (el id de ruta de `…/genero-mundo/[clave]`). */
export type ClaveGeneroMundo = { alcance: Extract<AlcanceCrecimiento, "resto"> } | { alcance: Extract<AlcanceCrecimiento, "gm">; genero_id: string; mundo_id: string };

/** `null` si la clave no es `resto` ni dos ids separados por un punto (`400 clave_invalida`). */
export function leerClaveGeneroMundo(clave: string): ClaveGeneroMundo | null {
  if (clave === CLAVE_RESTO) return { alcance: "resto" };
  const partes = clave.split(".");
  if (partes.length !== 2) return null;
  const [genero, mundo] = partes;
  if (!uuid.safeParse(genero).success || !uuid.safeParse(mundo).success) return null;
  return { alcance: "gm", genero_id: genero as string, mundo_id: mundo as string };
}

/** `?anio=2027&proyeccion=<id>`, ambos opcionales. `400` con un año que no es entero de cuatro cifras o una proyección que no es un id. */
export type ConsultaGeneroMundo = { anio: number | null; proyeccion: string | null };

export function leerConsultaGeneroMundo(
  params: Pick<URLSearchParams, "get">
): { consulta: ConsultaGeneroMundo; rechazo: null } | { consulta: null; rechazo: { status: 400; mensaje: string } } {
  const rechazar = (mensaje: string) => ({ consulta: null, rechazo: { status: 400, mensaje } }) as const;

  const anioTexto = params.get("anio");
  let anio: number | null = null;
  if (anioTexto !== null && anioTexto !== "") {
    if (!/^\d{4}$/.test(anioTexto)) return rechazar("El año debe tener cuatro cifras (por ejemplo 2027).");
    anio = Number(anioTexto);
    if (anio < 2024 || anio > 2100) return rechazar("El año debe estar entre 2024 y 2100.");
  }

  const proyeccionTexto = params.get("proyeccion");
  let proyeccion: string | null = null;
  if (proyeccionTexto !== null && proyeccionTexto !== "") {
    if (!uuid.safeParse(proyeccionTexto).success) return rechazar("La proyección de referencia no es válida.");
    proyeccion = proyeccionTexto;
  }
  return { consulta: { anio, proyeccion }, rechazo: null };
}
