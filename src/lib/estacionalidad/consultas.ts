import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { cargarEstadoArbol, leerTodo, type EstadoArbol } from "@/lib/arbol/consultas";
import { enTandas } from "@/lib/arbol/importar";
import { anexarGeneroIds } from "./reglas";
import type { AgrupacionACrear, EstadoImportacionAgrupaciones } from "./importar-agrupaciones";

/**
 * Lecturas compartidas de M3 (solo servidor). Como en el árbol, todo lo que
 * pueda crecer se lee con `leerTodo` (PostgREST corta en 1000 filas).
 *
 * `cargarEstadoArbol` (M1) se deja como está y aquí se expone la hermana
 * `cargarEstadoEstacionalidad`, que lee además `agrupaciones_estacionalidad`
 * completa (activas e inactivas: una equivalencia puede apuntar a una
 * inactiva y el árbol y los faltantes deben poder mostrarlo) y los vínculos
 * agrupación ↔ género (`agrupacion_estacionalidad_genero`). La usan
 * `GET /api/arbol`, la lista plana, los faltantes y el importador.
 */

type Db = SupabaseClient<Database>;

export type EstadoEstacionalidad = EstadoArbol & {
  agrupaciones: Tables<"agrupaciones_estacionalidad">[];
  /** Vínculos agrupación ↔ género, completos. `agrupacionesConGeneros` los pliega en cada agrupación. */
  agrupacion_generos: Tables<"agrupacion_estacionalidad_genero">[];
};

/** Vínculos agrupación ↔ género, completos y con orden estable. */
export function leerVinculosGenero(db: Db) {
  return leerTodo<Tables<"agrupacion_estacionalidad_genero">>((d, h) =>
    db.from("agrupacion_estacionalidad_genero").select("*").order("id").range(d, h)
  );
}

/** Las agrupaciones del estado con `genero_ids` (vacío en las heredadas "sin género"). */
export function agrupacionesConGeneros(estado: Pick<EstadoEstacionalidad, "agrupaciones" | "agrupacion_generos">) {
  return anexarGeneroIds(estado.agrupaciones, estado.agrupacion_generos);
}

export function leerAgrupacionesEstacionalidad(db: Db) {
  return leerTodo<Tables<"agrupaciones_estacionalidad">>((d, h) =>
    db.from("agrupaciones_estacionalidad").select("*").order("orden").order("nombre").order("id").range(d, h)
  );
}

/** Las cinco tablas del árbol, las agrupaciones y sus vínculos con géneros, completas (activas e inactivas). */
export async function cargarEstadoEstacionalidad(
  db: Db
): Promise<{ estado: EstadoEstacionalidad; error: null } | { estado: null; error: PostgrestError }> {
  const [arbol, agrupaciones, vinculos] = await Promise.all([
    cargarEstadoArbol(db),
    leerAgrupacionesEstacionalidad(db),
    leerVinculosGenero(db),
  ]);
  if (arbol.error) return { estado: null, error: arbol.error };
  if (agrupaciones.error) return { estado: null, error: agrupaciones.error };
  if (vinculos.error) return { estado: null, error: vinculos.error };
  return {
    estado: { ...arbol.estado, agrupaciones: agrupaciones.data, agrupacion_generos: vinculos.data },
    error: null,
  };
}

// ─── Importador masivo de agrupaciones ───

/** Géneros y agrupaciones actuales (activos e inactivos): lo que `planificarImportacionAgrupaciones` necesita. */
export async function cargarEstadoImportacionAgrupaciones(
  db: Db
): Promise<{ estado: EstadoImportacionAgrupaciones; error: null } | { estado: null; error: PostgrestError }> {
  const [generos, agrupaciones] = await Promise.all([
    leerTodo<Pick<Tables<"generos">, "id" | "codigo" | "nombre" | "orden" | "activo">>((d, h) =>
      db.from("generos").select("id, codigo, nombre, orden, activo").order("orden").order("nombre").order("id").range(d, h)
    ),
    leerAgrupacionesEstacionalidad(db),
  ]);
  if (generos.error) return { estado: null, error: generos.error };
  if (agrupaciones.error) return { estado: null, error: agrupaciones.error };
  return { estado: { generos: generos.data, agrupaciones: agrupaciones.data }, error: null };
}

/** Resultado de `crearAgrupacionesConGeneros`. `creadas` es lo realmente completo (con sus géneros), aunque haya error. */
export type ResultadoCrearAgrupaciones = {
  creadas: number;
  error: PostgrestError | null;
  /** Error al deshacer la tanda fallida (solo si `error` viene con vínculos fallidos). */
  errorCompensacion: PostgrestError | null;
  /** Agrupaciones que quedaron sin género (o con géneros incompletos) porque el borrado de compensación también falló. */
  sinGenero: number;
};

/**
 * Crea las agrupaciones nuevas con sus géneros, en tandas de 500. El `upsert …
 * ignoreDuplicates` por nombre nunca toca una fila que ya exista y devuelve solo
 * las que insertó: los vínculos de género se escriben solo para esas, así que si
 * otra sesión creó el mismo nombre en el medio no se le cambian los géneros. Sin
 * transacción: si fallan los vínculos de una tanda, se borran las agrupaciones
 * recién creadas de esa tanda (el `cascade` se lleva sus vínculos) para que no
 * queden "sin género"; las tandas anteriores quedan completas. Si ese borrado
 * también falla se devuelve su error y `sinGenero` con cuántas quedaron así,
 * porque un reimport las vería como `ya_existe`. `creadas` cuenta solo las
 * completas; reimportar completa el resto.
 */
export async function crearAgrupacionesConGeneros(db: Db, nuevas: AgrupacionACrear[]): Promise<ResultadoCrearAgrupaciones> {
  let creadas = 0;
  const generosPorNombre = new Map(nuevas.map((a) => [a.nombre, a.genero_ids]));

  for (const tanda of enTandas(nuevas)) {
    const filas: TablesInsert<"agrupaciones_estacionalidad">[] = tanda.map((a) => ({
      nombre: a.nombre,
      codigo: a.codigo,
      descripcion: a.descripcion,
      orden: a.orden,
      temporada: a.temporada,
    }));
    const { data, error: err } = await db
      .from("agrupaciones_estacionalidad")
      .upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })
      .select("id, nombre");
    if (err) return { creadas, error: err, errorCompensacion: null, sinGenero: 0 };
    const insertadas = data ?? [];

    const vinculos: TablesInsert<"agrupacion_estacionalidad_genero">[] = insertadas.flatMap((c) =>
      (generosPorNombre.get(c.nombre) ?? []).map((genero_id) => ({ agrupacion_estacionalidad_id: c.id, genero_id }))
    );
    for (const lote of enTandas(vinculos)) {
      const { error: errVinculos } = await db.from("agrupacion_estacionalidad_genero").insert(lote);
      if (errVinculos) {
        let sinGenero = 0;
        let errorCompensacion: PostgrestError | null = null;
        for (const ids of enTandas(insertadas.map((c) => c.id), 100)) {
          const { error: errBorrar } = await db.from("agrupaciones_estacionalidad").delete().in("id", ids);
          if (errBorrar) {
            errorCompensacion ??= errBorrar;
            sinGenero += ids.length;
          }
        }
        return { creadas, error: errVinculos, errorCompensacion, sinGenero };
      }
    }
    creadas += insertadas.length;
  }
  return { creadas, error: null, errorCompensacion: null, sinGenero: 0 };
}
