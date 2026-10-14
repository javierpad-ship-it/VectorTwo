import { z } from "zod";
import { uuid } from "@/lib/arbol/esquemas";

/**
 * Esquemas zod de los cuerpos de la API de M11. Los mensajes van en castellano
 * porque `leerCuerpo` los devuelve tal cual a la pantalla.
 */

/** Tope de equivalencias por petición (el reporte envía las que pasan sus filtros). */
export const MAX_EQUIVALENCIAS_UNIDADES = 5_000;

/**
 * `POST /api/reportes/agrupacion-gmle/unidades-mensuales`. `equivalencia_ids`
 * ausente = todas las equivalencias; `[]` = ninguna. Los repetidos se quitan
 * (la base filtra con `= any(...)`, así que no cambian el resultado) y el tope
 * se aplica a lo que llega, antes de quitarlos.
 */
export const unidadesMensualesSchema = z.object({
  equivalencia_ids: z
    .array(uuid, "equivalencia_ids debe ser una lista de identificadores.")
    .max(MAX_EQUIVALENCIAS_UNIDADES, `Se pueden pedir como máximo ${MAX_EQUIVALENCIAS_UNIDADES} equivalencias a la vez.`)
    .transform((ids) => [...new Set(ids)])
    .optional(),
});

export type UnidadesMensualesCuerpo = z.output<typeof unidadesMensualesSchema>;
