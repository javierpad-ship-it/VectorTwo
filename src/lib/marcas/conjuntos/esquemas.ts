import { z } from "zod";
import { uuid } from "@/lib/arbol/esquemas";
import { celdaTexto } from "@/lib/api/celdas";

/** Esquemas zod de los conjuntos de marcas (02b, "Contratos de API" y regla 17). */

export const miembrosSchema = z.object({
  cabeza_marca_id: uuid,
  accion: z.enum(["asignar", "quitar"], "La acción debe ser asignar o quitar."),
  marca_ids: z
    .array(uuid, "marca_ids debe ser una lista de identificadores.")
    .min(1, "Elige al menos una marca.")
    .max(200, "Se admiten hasta 200 marcas por bloque."),
});

/** `GET /api/marcas/conjuntos/sugerencias?umbral=`: de 0,3 a 0,9, por defecto 0,5. */
export const sugerenciasConjuntosQuerySchema = z.object({
  umbral: z.coerce
    .number("umbral debe ser un número.")
    .min(0.3, "umbral debe estar entre 0,3 y 0,9.")
    .max(0.9, "umbral debe estar entre 0,3 y 0,9.")
    .default(0.5),
});

export const filaImportacionConjuntoSchema = z.object({
  marca: celdaTexto("marca"),
  conjunto: celdaTexto("conjunto"),
});

export const importarConjuntosSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"], "El modo debe ser previsualizar o aplicar."),
  filas: z
    .array(filaImportacionConjuntoSchema)
    .min(1, "No hay filas que importar.")
    .max(10_000, "Se admiten hasta 10 000 filas por importación."),
});

export type Miembros = z.infer<typeof miembrosSchema>;
export type ImportarConjuntos = z.infer<typeof importarConjuntosSchema>;
