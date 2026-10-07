import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { leerLineas, leerNodos, leerTodo } from "@/lib/arbol/consultas";
import type { GeneroEntrada, MundoEntrada, NodoEntrada } from "@/lib/arbol/armar-arbol";
import type { AsignacionEntrada, LineaMatrizEntrada, PerfilEntrada } from "./matriz";

/**
 * Lecturas de M1b (solo servidor). Todo se lee con `leerTodo` (PostgREST corta
 * en 1000 filas) y con `order` estable. A propósito NO se leen equivalencias
 * (1 790 filas pesadas del árbol): la matriz solo necesita contar nodos.
 */

type Db = SupabaseClient<Database>;

export type AsignacionFila = Pick<
  Tables<"responsables_genero_mundo">,
  "id" | "genero_id" | "mundo_id" | "perfil_id" | "activo"
>;

const COLUMNAS_PERFIL = "id, nombre, email, rol, activo";
const COLUMNAS_CATALOGO = "id, codigo, nombre, orden, activo";

/** Géneros por `orden, nombre`, activos o no. */
export function leerGeneros(db: Db) {
  return leerTodo<GeneroEntrada>((d, h) =>
    db.from("generos").select(COLUMNAS_CATALOGO).order("orden").order("nombre").order("id").range(d, h)
  );
}

/** Mundos por `orden, nombre`, activos o no. */
export function leerMundos(db: Db) {
  return leerTodo<MundoEntrada>((d, h) =>
    db.from("mundos").select(COLUMNAS_CATALOGO).order("orden").order("nombre").order("id").range(d, h)
  );
}

/** Todos los perfiles (id, nombre, correo, rol, activo), con orden estable. */
export function leerPerfiles(db: Db) {
  return leerTodo<PerfilEntrada>((d, h) => db.from("perfiles").select(COLUMNAS_PERFIL).order("id").range(d, h));
}

/** Todas las filas de `responsables_genero_mundo` (del orden de 40), con orden estable. */
export function leerAsignaciones(db: Db) {
  return leerTodo<AsignacionFila>((d, h) =>
    db.from("responsables_genero_mundo").select("id, genero_id, mundo_id, perfil_id, activo").order("id").range(d, h)
  );
}

/** Los nodos de una sola pareja género-mundo (para devolver la celda sin leer todo el árbol). */
export function leerNodosDePareja(db: Db, generoId: string, mundoId: string) {
  return leerTodo<NodoEntrada>((d, h) =>
    db
      .from("genero_mundo_linea")
      .select("id, genero_id, mundo_id, linea_id, activo")
      .eq("genero_id", generoId)
      .eq("mundo_id", mundoId)
      .order("id")
      .range(d, h)
  );
}

export type EstadoResponsables = {
  generos: GeneroEntrada[];
  mundos: MundoEntrada[];
  asignaciones: AsignacionEntrada[];
  perfiles: PerfilEntrada[];
  nodos: NodoEntrada[];
  lineas: LineaMatrizEntrada[];
};

/**
 * Lo que `armarMatriz` necesita, completo (activos e inactivos): géneros,
 * mundos, perfiles, asignaciones, y nodos y líneas para contar líneas por
 * celda.
 */
export async function cargarEstadoResponsables(
  db: Db
): Promise<{ estado: EstadoResponsables; error: null } | { estado: null; error: PostgrestError }> {
  const [generos, mundos, perfiles, asignaciones, nodos, lineas] = await Promise.all([
    leerGeneros(db),
    leerMundos(db),
    leerPerfiles(db),
    leerAsignaciones(db),
    leerNodos(db),
    leerLineas(db),
  ]);
  const fallo = generos.error ?? mundos.error ?? perfiles.error ?? asignaciones.error ?? nodos.error ?? lineas.error;
  if (fallo) return { estado: null, error: fallo };
  return {
    estado: {
      generos: generos.data,
      mundos: mundos.data,
      asignaciones: asignaciones.data,
      perfiles: perfiles.data,
      nodos: nodos.data,
      lineas: lineas.data,
    },
    error: null,
  };
}
