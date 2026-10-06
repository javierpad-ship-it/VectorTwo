import { requirePlanner, requireUser } from "@/lib/auth/guard";
import type { ConfigCatalogo } from "@/lib/api/catalogo";
import { crearAgrupacionSchema, editarAgrupacionSchema } from "./esquemas";

/**
 * Agrupaciones de estacionalidad para el helper `src/lib/api/catalogo.ts`.
 * Catálogo plano que mantiene el PLANNER (es trabajo de planificación, como
 * las líneas; decisión 4 de la ficha), no raíz como géneros y mundos.
 *
 * El listado anexa `equivalencias` (las que apuntan a ella, activas o no);
 * eliminar solo con 0 equivalencias (el `restrict` lo garantiza y el helper
 * responde `409` con el conteo). Desactivar nunca se rechaza (regla 6).
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
  escritura: {
    insertar: (db, datos) => db.from("agrupaciones_estacionalidad").insert(datos).select("*").single(),
    actualizar: (db, id, datos) =>
      db.from("agrupaciones_estacionalidad").update(datos).eq("id", id).select("*").single(),
  },
  hijos: {
    tabla: "equivalencias",
    columna: "agrupacion_estacionalidad_id",
    clave: "equivalencias",
    claveActivos: "equivalencias_activas",
  },
  conConteoHijos: true,
};
