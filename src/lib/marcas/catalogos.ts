import { requireAdmin, requireUser } from "@/lib/auth/guard";
import type { ConfigCatalogo } from "@/lib/api/catalogo";
import { crearCatalogoSchema, editarCatalogoSchema } from "@/lib/arbol/esquemas";

/**
 * Agrupaciones de marca para el helper `src/lib/api/catalogo.ts`. Catálogo
 * raíz y ABIERTO: lo lee cualquier usuario y lo escribe el admin (si Javier
 * prefiere que también lo edite el planner, es cambiar `guardEscritura`;
 * pregunta abierta 2 de la ficha). Misma estructura que géneros y mundos, así
 * que reutiliza sus esquemas zod.
 *
 * El listado anexa `marcas` (todas, activas o no) y `marcas_activas` (para el
 * `confirm` de desactivar); eliminar solo con 0 marcas.
 */
export const catalogoAgrupacionesMarca: ConfigCatalogo<"agrupaciones_marca"> = {
  tabla: "agrupaciones_marca",
  tipo: "agrupacion_marca",
  noEncontrado: "Agrupación de marca no encontrada.",
  guardLectura: requireUser,
  guardEscritura: requireAdmin,
  orden: ["orden", "nombre"],
  esquemaCrear: crearCatalogoSchema,
  esquemaEditar: editarCatalogoSchema,
  escritura: {
    insertar: (db, datos) => db.from("agrupaciones_marca").insert(datos).select("*").single(),
    actualizar: (db, id, datos) => db.from("agrupaciones_marca").update(datos).eq("id", id).select("*").single(),
  },
  hijos: { tabla: "marcas", columna: "agrupacion_marca_id", clave: "marcas", claveActivos: "marcas_activas" },
  conConteoHijos: true,
};
