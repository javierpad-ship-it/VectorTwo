import type { NextRequest, NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import type { requireUser } from "@/lib/auth/guard";
import { motivoRechazoEliminar, type TipoEliminable } from "@/lib/arbol/reglas";
import { leerNodos, leerTodo } from "@/lib/arbol/consultas";
import { error, idDeRuta, leerCuerpo, ok } from "./respuestas";
import { traducirErrorDb } from "./errores-db";

/**
 * CRUD plano para los catálogos del árbol (géneros, mundos, líneas,
 * agrupaciones de talla). Cada ruta declara su configuración (tabla, guards,
 * esquemas zod, orden, escritura) y delega en estas cuatro funciones; así el
 * patrón "guard → cuerpo → base → traducir error" vive en un solo sitio.
 *
 * Nota de tipado: supabase-js no resuelve `from(tabla)` con un nombre de
 * tabla genérico. Las lecturas y el borrado funcionan con la unión
 * `TablaCatalogo` (solo usan columnas comunes); `insert`/`update` exigen la
 * tabla literal, así que cada catálogo aporta esas dos operaciones en
 * `escritura`, tipadas contextualmente con su `TablesInsert`/`TablesUpdate`.
 */

export type TablaCatalogo = "generos" | "mundos" | "lineas" | "agrupaciones_talla";

export type Guard = typeof requireUser;

type Db = SupabaseClient<Database>;
type Resultado<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>;

export type EscrituraCatalogo<T extends TablaCatalogo> = {
  insertar: (db: Db, datos: TablesInsert<T>) => Resultado<Tables<T>>;
  actualizar: (db: Db, id: string, datos: TablesUpdate<T>) => Resultado<Tables<T>>;
};

export type ConfigCatalogo<T extends TablaCatalogo> = {
  tabla: T;
  /** Para `motivoRechazoEliminar`. */
  tipo: TipoEliminable;
  noEncontrado: string;
  guardLectura: Guard;
  guardEscritura: Guard;
  /** Columnas de orden del listado, en prioridad (todas ascendentes). */
  orden: ReadonlyArray<keyof Tables<T> & string>;
  esquemaCrear: ZodType<TablesInsert<T>>;
  esquemaEditar: ZodType<TablesUpdate<T>>;
  /** Ausente en catálogos cerrados: POST/PATCH responden 405. */
  escritura?: EscrituraCatalogo<T>;
  /** Columna de `genero_mundo_linea` que apunta a esta tabla; si falta, la tabla no tiene hijos en M1. */
  columnaHijos?: "genero_id" | "mundo_id" | "linea_id";
  /** Anexar `nodos: number` (conteo de nodos, activos o no) a cada fila del listado. */
  conConteoNodos?: boolean;
};

const CATALOGO_CERRADO = "Este catálogo es cerrado: se cambia por migración.";

/** `?incluir_inactivos=1` (también `true`) en cualquier lectura. */
export function incluirInactivos(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get("incluir_inactivos");
  return v === "1" || v === "true";
}

type Params = { params: Promise<{ id: string }> };

async function contarHijos(columna: ConfigCatalogo<TablaCatalogo>["columnaHijos"], id: string) {
  if (!columna) return { hijos: 0, error: null };
  const { count, error: err } = await supabaseAdmin()
    .from("genero_mundo_linea")
    .select("id", { count: "exact", head: true })
    .eq(columna, id);
  return { hijos: count ?? 0, error: err };
}

async function existe(tabla: TablaCatalogo, id: string) {
  const { data, error: err } = await supabaseAdmin().from(tabla).select("id").eq("id", id).maybeSingle();
  return { existe: Boolean(data), error: err };
}

export async function listarCatalogo<T extends TablaCatalogo>(
  cfg: ConfigCatalogo<T>,
  request: NextRequest
): Promise<NextResponse> {
  const { response } = await cfg.guardLectura();
  if (response) return response;

  const db = supabaseAdmin();
  const tabla: TablaCatalogo = cfg.tabla;
  const orden: readonly string[] = cfg.orden;
  const soloActivos = !incluirInactivos(request);

  // Paginado con `leerTodo`: PostgREST corta en 1000 filas por defecto. Se
  // ordena por las columnas del catálogo y, al final, por `id` para que el
  // orden sea estable entre páginas aunque haya empates.
  const { data: filas, error: err } = await leerTodo<Tables<TablaCatalogo>>((desde, hasta) => {
    let consulta = db.from(tabla).select("*");
    if (soloActivos) consulta = consulta.eq("activo", true);
    for (const columna of orden) consulta = consulta.order(columna, { ascending: true });
    return consulta.order("id", { ascending: true }).range(desde, hasta);
  });
  if (err) return traducirErrorDb(err, `listar ${tabla}`);

  if (!cfg.conConteoNodos || !cfg.columnaHijos) return ok(filas);

  const columna = cfg.columnaHijos;
  const { data: nodos, error: errNodos } = await leerNodos(db);
  if (errNodos) return traducirErrorDb(errNodos, `contar nodos de ${tabla}`);
  const conteo = new Map<string, number>();
  for (const n of nodos) conteo.set(n[columna], (conteo.get(n[columna]) ?? 0) + 1);

  return ok(filas.map((fila) => ({ ...fila, nodos: conteo.get(fila.id) ?? 0 })));
}

export async function crearEnCatalogo<T extends TablaCatalogo>(
  cfg: ConfigCatalogo<T>,
  request: NextRequest
): Promise<NextResponse> {
  const { response } = await cfg.guardEscritura();
  if (response) return response;

  if (!cfg.escritura) return error(CATALOGO_CERRADO, 405);

  const { datos, respuesta } = await leerCuerpo(request, cfg.esquemaCrear);
  if (respuesta) return respuesta;

  const { data, error: err } = await cfg.escritura.insertar(supabaseAdmin(), datos);
  if (err) return traducirErrorDb(err, `crear en ${cfg.tabla}`);
  return ok(data, 201);
}

export async function editarEnCatalogo<T extends TablaCatalogo>(
  cfg: ConfigCatalogo<T>,
  request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  const { response } = await cfg.guardEscritura();
  if (response) return response;

  if (!cfg.escritura) return error(CATALOGO_CERRADO, 405);

  const { id, respuesta: respuestaId } = await idDeRuta(params, cfg.noEncontrado);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, cfg.esquemaEditar);
  if (respuesta) return respuesta;

  const actual = await existe(cfg.tabla, id);
  if (actual.error) return traducirErrorDb(actual.error, `buscar en ${cfg.tabla}`);
  if (!actual.existe) return error(cfg.noEncontrado, 404);

  const { data, error: err } = await cfg.escritura.actualizar(supabaseAdmin(), id, datos);
  if (err) return traducirErrorDb(err, `editar en ${cfg.tabla}`);
  return ok(data);
}

export async function eliminarDeCatalogo<T extends TablaCatalogo>(
  cfg: ConfigCatalogo<T>,
  { params }: Params
): Promise<NextResponse> {
  const { response } = await cfg.guardEscritura();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, cfg.noEncontrado);
  if (respuestaId) return respuestaId;
  const tabla: TablaCatalogo = cfg.tabla;
  const actual = await existe(tabla, id);
  if (actual.error) return traducirErrorDb(actual.error, `buscar en ${tabla}`);
  if (!actual.existe) return error(cfg.noEncontrado, 404);

  const { hijos, error: errHijos } = await contarHijos(cfg.columnaHijos, id);
  if (errHijos) return traducirErrorDb(errHijos, `contar hijos de ${tabla}`);
  const motivo = motivoRechazoEliminar(cfg.tipo, hijos);
  if (motivo) return error(motivo, 409);

  const { error: err } = await supabaseAdmin().from(tabla).delete().eq("id", id);
  if (err) return traducirErrorDb(err, `eliminar de ${tabla}`);
  return ok({ id });
}
