import type { NextRequest, NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import type { requireUser } from "@/lib/auth/guard";
import { motivoRechazoEliminar, type TipoEliminable } from "@/lib/arbol/reglas";
import { leerEquivalencias, leerNodos, leerTodo } from "@/lib/arbol/consultas";
import { error, idDeRuta, leerCuerpo, ok } from "./respuestas";
import { traducirErrorDb } from "./errores-db";

/**
 * CRUD plano para los catálogos (géneros, mundos, líneas, agrupaciones de
 * talla, desde M2 agrupaciones de marca y desde M3 agrupaciones de
 * estacionalidad, estas últimas solo para ELIMINAR: desde que pertenecen a uno
 * o más géneros, listar/crear/editar tienen handlers propios en
 * `src/lib/estacionalidad/agrupaciones.ts`). Cada ruta declara su
 * configuración (tabla, guards, esquemas zod, orden, escritura) y delega en
 * estas cuatro funciones; así el patrón "guard → cuerpo → base → traducir
 * error" vive en un solo sitio.
 *
 * Nota de tipado: supabase-js no resuelve `from(tabla)` con un nombre de
 * tabla genérico. Las lecturas y el borrado funcionan con la unión
 * `TablaCatalogo` (solo usan columnas comunes); `insert`/`update` exigen la
 * tabla literal, así que cada catálogo aporta esas dos operaciones en
 * `escritura`, tipadas contextualmente con su `TablesInsert`/`TablesUpdate`.
 */

export type TablaCatalogo =
  | "generos"
  | "mundos"
  | "lineas"
  | "agrupaciones_talla"
  | "agrupaciones_marca"
  | "agrupaciones_estacionalidad";

export type Guard = typeof requireUser;

type Db = SupabaseClient<Database>;
type Resultado<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>;

export type EscrituraCatalogo<T extends TablaCatalogo> = {
  insertar: (db: Db, datos: TablesInsert<T>) => Resultado<Tables<T>>;
  actualizar: (db: Db, id: string, datos: TablesUpdate<T>) => Resultado<Tables<T>>;
};

/**
 * Qué tabla cuelga de este catálogo y por qué columna. `clave` es el nombre
 * con el que el listado anexa el conteo a cada fila (`nodos` para géneros,
 * mundos y líneas; `marcas` para agrupaciones de marca; `equivalencias` para
 * agrupaciones de estacionalidad, M3). `claveActivos`, opcional, anexa además
 * el conteo de hijos con `activo = true` (la pantalla lo usa en el `confirm`
 * de desactivar).
 */
export type HijosCatalogo =
  | {
      tabla: "genero_mundo_linea";
      columna: "genero_id" | "mundo_id" | "linea_id";
      clave: "nodos";
      claveActivos?: "nodos_activos";
    }
  | {
      tabla: "marcas";
      columna: "agrupacion_marca_id";
      clave: "marcas";
      claveActivos?: "marcas_activas";
    }
  | {
      tabla: "equivalencias";
      columna: "genero_mundo_linea_id" | "agrupacion_estacionalidad_id";
      clave: "equivalencias";
      claveActivos?: "equivalencias_activas";
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
  /** Tabla hija y columna que apunta a este catálogo; si falta, la tabla no tiene hijos todavía. */
  hijos?: HijosCatalogo;
  /** Anexar a cada fila del listado el conteo de hijos (activos o no) bajo `hijos.clave`. */
  conConteoHijos?: boolean;
};

const CATALOGO_CERRADO = "Este catálogo es cerrado: se cambia por migración.";

/** `?incluir_inactivos=1` (también `true`) en cualquier lectura. */
export function incluirInactivos(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get("incluir_inactivos");
  return v === "1" || v === "true";
}

type Params = { params: Promise<{ id: string }> };

async function contarHijos(hijos: HijosCatalogo | undefined, id: string) {
  if (!hijos) return { hijos: 0, error: null };
  const db = supabaseAdmin();
  const { count, error: err } =
    hijos.tabla === "marcas"
      ? await db.from("marcas").select("id", { count: "exact", head: true }).eq(hijos.columna, id)
      : hijos.tabla === "equivalencias"
        ? await db.from("equivalencias").select("id", { count: "exact", head: true }).eq(hijos.columna, id)
        : await db.from("genero_mundo_linea").select("id", { count: "exact", head: true }).eq(hijos.columna, id);
  return { hijos: count ?? 0, error: err };
}

type HijoMin = { padre: string; activo: boolean };

/** Todos los hijos de la tabla configurada (activos o no) como pares `padre → activo`, paginados. */
async function leerHijos(db: Db, hijos: HijosCatalogo): Promise<{ data: HijoMin[]; error: PostgrestError | null }> {
  if (hijos.tabla === "marcas") {
    const columna = hijos.columna;
    const { data, error: err } = await leerTodo<Pick<Tables<"marcas">, "id" | "agrupacion_marca_id" | "activo">>(
      (d, h) => db.from("marcas").select("id, agrupacion_marca_id, activo").order("id").range(d, h)
    );
    return { data: data.map((m) => ({ padre: m[columna], activo: m.activo })), error: err };
  }
  if (hijos.tabla === "equivalencias") {
    // `agrupacion_estacionalidad_id` es nullable: una equivalencia sin agrupación no cuelga de nadie.
    const columna = hijos.columna;
    const { data, error: err } = await leerEquivalencias(db);
    const pares: HijoMin[] = [];
    for (const e of data) {
      const padre = e[columna];
      if (padre !== null) pares.push({ padre, activo: e.activo });
    }
    return { data: pares, error: err };
  }
  const columna = hijos.columna;
  const { data, error: err } = await leerNodos(db);
  return { data: data.map((n) => ({ padre: n[columna], activo: n.activo })), error: err };
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

  if (!cfg.conConteoHijos || !cfg.hijos) return ok(filas);

  const { clave, claveActivos } = cfg.hijos;
  const { data: hijos, error: errHijos } = await leerHijos(db, cfg.hijos);
  if (errHijos) return traducirErrorDb(errHijos, `contar ${clave} de ${tabla}`);
  const conteo = new Map<string, number>();
  const conteoActivos = new Map<string, number>();
  for (const h of hijos) {
    conteo.set(h.padre, (conteo.get(h.padre) ?? 0) + 1);
    if (h.activo) conteoActivos.set(h.padre, (conteoActivos.get(h.padre) ?? 0) + 1);
  }

  return ok(
    filas.map((fila) => ({
      ...fila,
      [clave]: conteo.get(fila.id) ?? 0,
      ...(claveActivos ? { [claveActivos]: conteoActivos.get(fila.id) ?? 0 } : {}),
    }))
  );
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

  const { hijos, error: errHijos } = await contarHijos(cfg.hijos, id);
  if (errHijos) return traducirErrorDb(errHijos, `contar hijos de ${tabla}`);
  const motivo = motivoRechazoEliminar(cfg.tipo, hijos);
  if (motivo) return error(motivo, 409);

  const { error: err } = await supabaseAdmin().from(tabla).delete().eq("id", id);
  if (err) return traducirErrorDb(err, `eliminar de ${tabla}`);
  return ok({ id });
}
