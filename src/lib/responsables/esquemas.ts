import { z } from "zod";

/**
 * Esquemas zod de M1b (docs/modulos/01b-responsables.md, "Contratos de API" y
 * regla 8). `perfil_id` es obligatorio en ambos (nulo o UUID): un cuerpo sin
 * él es `400`, no "quitar".
 */

export const MAX_COMBINACIONES_BLOQUE = 400;

const uuid = (que: string) =>
  z.uuid({
    error: (issue) => (issue.input === undefined ? `${que} es obligatorio.` : `${que} no es válido.`),
  });

const perfilId = z
  .uuid({
    error: (issue) =>
      issue.input === undefined ? "perfil_id es obligatorio (usa null para quitar)." : "El usuario no es válido.",
  })
  .nullable();

/** `PUT /api/responsables`: una combinación; `perfil_id: null` quita el responsable. */
export const asignarUnaSchema = z.object({
  genero_id: uuid("El género"),
  mundo_id: uuid("El mundo"),
  perfil_id: perfilId,
});

export const combinacionSchema = z.object({
  genero_id: uuid("El género"),
  mundo_id: uuid("El mundo"),
});

/** `POST /api/responsables/asignar`: varias combinaciones. */
export const asignarMasivaSchema = z
  .object({
    combinaciones: z
      .array(combinacionSchema, { error: "combinaciones debe ser una lista." })
      .min(1, "Elige al menos una combinación.")
      .max(MAX_COMBINACIONES_BLOQUE, `No se pueden asignar más de ${MAX_COMBINACIONES_BLOQUE} combinaciones de una vez.`),
    perfil_id: perfilId,
    solo_faltantes: z.boolean("solo_faltantes debe ser verdadero o falso.").default(false),
  })
  .refine((v) => !(v.perfil_id === null && v.solo_faltantes), {
    message: "No se puede quitar el responsable solo a las faltantes.",
    path: ["solo_faltantes"],
  });

export type AsignarUna = z.infer<typeof asignarUnaSchema>;
export type AsignarMasiva = z.infer<typeof asignarMasivaSchema>;
