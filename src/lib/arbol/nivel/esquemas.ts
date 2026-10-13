import { z } from "zod";
import { nivelPlanificacion, uuid } from "../esquemas";

/**
 * Esquemas zod del nivel de planificación (02b, "Contratos de API" y regla 17).
 * `editarNodoSchema` (con `nivel_planificacion`) vive en `../esquemas`.
 */

export const nivelBloqueSchema = z.object({
  nivel: nivelPlanificacion,
  nodo_ids: z
    .array(uuid, "nodo_ids debe ser una lista de identificadores.")
    .min(1, "Elige al menos un nodo.")
    .max(600, "Se admiten hasta 600 nodos por bloque."),
});

export const filaImportacionNivelSchema = z.object({
  genero: z.string("genero debe ser texto."),
  mundo: z.string("mundo debe ser texto."),
  linea: z.string("linea debe ser texto."),
  nivel: z.string("nivel debe ser texto."),
});

export const importarNivelSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionNivelSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type NivelBloque = z.infer<typeof nivelBloqueSchema>;
export type ImportarNivel = z.infer<typeof importarNivelSchema>;
