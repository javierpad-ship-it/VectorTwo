import { requireAdmin, requirePlanner, requireUser } from "@/lib/auth/guard";
import type { ConfigCatalogo } from "@/lib/api/catalogo";
import { crearCatalogoSchema, crearLineaSchema, editarCatalogoSchema, editarLineaSchema } from "./esquemas";

/**
 * Configuración de los cuatro catálogos planos de M1 para el helper
 * `src/lib/api/catalogo.ts`. Géneros y mundos son raíz: escribe el admin.
 * Líneas las mantiene el planner. Agrupaciones de talla es cerrado: solo GET
 * (confirmado por Javier: catálogo fijo de dos filas, se cambia por migración).
 *
 * `escritura` repite la tabla literal porque supabase-js solo tipa
 * `insert`/`update` con el nombre concreto (ver nota en el helper).
 */

export const catalogoGeneros: ConfigCatalogo<"generos"> = {
  tabla: "generos",
  tipo: "genero",
  noEncontrado: "Género no encontrado.",
  guardLectura: requireUser,
  guardEscritura: requireAdmin,
  orden: ["orden", "nombre"],
  esquemaCrear: crearCatalogoSchema,
  esquemaEditar: editarCatalogoSchema,
  escritura: {
    insertar: (db, datos) => db.from("generos").insert(datos).select("*").single(),
    actualizar: (db, id, datos) => db.from("generos").update(datos).eq("id", id).select("*").single(),
  },
  hijos: { tabla: "genero_mundo_linea", columna: "genero_id", clave: "nodos" },
  conConteoHijos: true,
};

export const catalogoMundos: ConfigCatalogo<"mundos"> = {
  tabla: "mundos",
  tipo: "mundo",
  noEncontrado: "Mundo no encontrado.",
  guardLectura: requireUser,
  guardEscritura: requireAdmin,
  orden: ["orden", "nombre"],
  esquemaCrear: crearCatalogoSchema,
  esquemaEditar: editarCatalogoSchema,
  escritura: {
    insertar: (db, datos) => db.from("mundos").insert(datos).select("*").single(),
    actualizar: (db, id, datos) => db.from("mundos").update(datos).eq("id", id).select("*").single(),
  },
  hijos: { tabla: "genero_mundo_linea", columna: "mundo_id", clave: "nodos" },
  conConteoHijos: true,
};

export const catalogoLineas: ConfigCatalogo<"lineas"> = {
  tabla: "lineas",
  tipo: "linea",
  noEncontrado: "Línea no encontrada.",
  guardLectura: requireUser,
  guardEscritura: requirePlanner,
  orden: ["nombre"],
  esquemaCrear: crearLineaSchema,
  esquemaEditar: editarLineaSchema,
  escritura: {
    insertar: (db, datos) => db.from("lineas").insert(datos).select("*").single(),
    actualizar: (db, id, datos) => db.from("lineas").update(datos).eq("id", id).select("*").single(),
  },
  hijos: { tabla: "genero_mundo_linea", columna: "linea_id", clave: "nodos" },
  conConteoHijos: true,
};

/** Catálogo cerrado: sin `escritura`, el helper responde 405 a POST/PATCH (y no hay rutas para ellos). */
export const catalogoAgrupacionesTalla: ConfigCatalogo<"agrupaciones_talla"> = {
  tabla: "agrupaciones_talla",
  tipo: "agrupacion_talla",
  noEncontrado: "Agrupación de talla no encontrada.",
  guardLectura: requireUser,
  guardEscritura: requireAdmin,
  orden: ["orden", "nombre"],
  esquemaCrear: crearCatalogoSchema,
  esquemaEditar: editarCatalogoSchema,
};
