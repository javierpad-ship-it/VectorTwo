import { requirePlanner, requireUser } from "@/lib/auth/guard";
import type { ConfigCatalogo } from "@/lib/api/catalogo";
import { crearAgrupacionSchema, editarAgrupacionSchema } from "./esquemas";

/**
 * Configuración del helper `src/lib/api/catalogo.ts` para las agrupaciones de
 * estacionalidad. Catálogo plano que mantiene el PLANNER (es trabajo de
 * planificación, como las líneas; decisión 4 de la ficha), no raíz como géneros
 * y mundos.
 *
 * Desde el cambio "agrupaciones por género" el helper SOLO se usa para
 * ELIMINAR (`eliminarDeCatalogo`: solo con 0 equivalencias; el `restrict` lo
 * garantiza y se responde `409` con el conteo). Listar, crear y editar tienen
 * handlers propios en `./agrupaciones.ts` porque escriben `genero_ids` y
 * devuelven `genero_ids` y `generos`. Por eso aquí no hay `escritura`.
 * Desactivar nunca se rechaza (regla 6).
 */
export const catalogoAgrupacionesEstacionalidad: ConfigCatalogo<"agrupaciones_estacionalidad"> = {
  tabla: "agrupaciones_estacionalidad",
  tipo: "agrupacion_estacionalidad",
  noEncontrado: "Agrupación de estacionalidad no encontrada.",
  guardLectura: requireUser,
  guardEscritura: requirePlanner,
  orden: ["orden", "nombre"],
  esquemaCrear: crearAgrupacionSchema,
  esquemaEditar: editarAgrupacionSchema,
  hijos: {
    tabla: "equivalencias",
    columna: "agrupacion_estacionalidad_id",
    clave: "equivalencias",
    claveActivos: "equivalencias_activas",
  },
};
