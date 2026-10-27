import { z } from "zod";
import { CARACTERES_PROHIBIDOS_NOTA } from "@/lib/curvas/esquemas";
import { crecimiento } from "@/lib/proyeccion/esquemas";
import { BASES_CRECIMIENTO, CLAVE_RESTO, MAX_HUELLA_DATOS, MAX_NOTA_CRECIMIENTO, VARIANTES_BASE, type AlcanceCrecimiento } from "./tipos-api";

/**
 * Esquemas zod de 06d (ficha 06d, §3, «Contratos de API»). Cada cuerpo se valida con `leerCuerpo`; los mensajes van en castellano
 * llano para mostrarse en pantalla. Lo que depende de los datos (año permitido, referencia del año, género detallado) lo valida el
 * servidor.
 */

export const BASES = BASES_CRECIMIENTO;

const uuid = z.uuid("Identificador inválido.");

export const notaCrecimientoSchema = z
  .string("La nota debe ser texto.")
  .trim()
  .max(MAX_NOTA_CRECIMIENTO, `La nota no puede superar ${MAX_NOTA_CRECIMIENTO} caracteres.`)
  .refine((v) => !CARACTERES_PROHIBIDOS_NOTA.test(v), "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.");

/**
 * Cuerpo del `POST /api/curvas/genero-mundo/[clave]`. Estricto: una clave desconocida es `400`. `nota` vacía (o solo espacios) llega
 * como `null`. `base.anio` es obligatorio con `anio_completo` y debe ser `null` con las demás bases.
 */
export const aprobarCrecimientoSchema = z
  .object({
    anio: z.int("El año debe ser un número entero.").min(2024, "El año no puede ser anterior a 2024.").max(2100, "El año no puede ser posterior a 2100."),
    pct: crecimiento,
    nota: notaCrecimientoSchema.nullable().transform((v) => (v === "" ? null : v)),
    base: z
      .object({
        tipo: z.enum(BASES, "La base debe ser acumulado, cierre_proyectado, anio_completo, aplicado_hoy o ninguna."),
        anio: z.int("El año de la base debe ser un número entero.").min(2023, "El año de la base no puede ser anterior a 2023.").max(2100, "El año de la base no puede ser posterior a 2100.").nullable(),
        variante: z.enum(VARIANTES_BASE, "La variante debe ser bruto o sin_nino_mas_rebote."),
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
