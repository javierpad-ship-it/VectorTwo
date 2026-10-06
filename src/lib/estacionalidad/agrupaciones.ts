import type { NextRequest, NextResponse } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { error, idDeRuta, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import { leerTodo } from "@/lib/arbol/consultas";
import { crearAgrupacionSchema, editarAgrupacionSchema } from "./esquemas";
import {
  AGRUPACION_NO_ENCONTRADA,
  diferenciaGeneros,
  generosDeAgrupacion,
  motivoRechazoGenerosPedidos,
  motivoRechazoQuitarGeneros,
} from "./reglas";
import type { AgrupacionEstacionalidadFila } from "./tipos";

/**
 * Handlers propios de `/api/agrupaciones-estacionalidad` (listar, crear,
 * editar). Desde el cambio "agrupaciones por género" ya no sirve el CRUD plano
 * de `src/lib/api/catalogo.ts`: crear y editar escriben en dos tablas
 * (`agrupaciones_estacionalidad` y `agrupacion_estacionalidad_genero`) y
 * validan géneros antes de escribir, y las respuestas llevan `genero_ids` y
 * `generos`. Es el mismo camino que siguió M2 con las marcas. El catálogo
 * genérico queda intacto para géneros, mundos, líneas y agrupaciones de marca;
 * ELIMINAR sigue usando `eliminarDeCatalogo` (el `on delete cascade` de los
 * vínculos se lleva sus géneros con la agrupación, que solo se puede eliminar
 * sin equivalencias).
 *
 * Sin transacción (supabase-js no las expone): todo lo que se puede validar se
 * valida ANTES de escribir; si una escritura intermedia falla (500), crear
 * deshace la agrupación recién insertada y editar deja los campos ya escritos
 * (repetir el mismo PATCH completa el resto).
 */

type Db = SupabaseClient<Database>;
type Agrupacion = Tables<"agrupaciones_estacionalidad">;
type GeneroLeido = Pick<Tables<"generos">, "id" | "codigo" | "nombre" | "orden" | "activo">;

const SELECT_GENERO = "id, codigo, nombre, orden, activo";

/** Todos los géneros (activos e inactivos): son pocos y hacen falta para nombrar y ordenar. */
export async function leerGeneros(db: Db): Promise<{ data: GeneroLeido[]; error: PostgrestError | null }> {
  const { data, error: err } = await db.from("generos").select(SELECT_GENERO).order("orden").order("nombre");
  return { data: data ?? [], error: err };
}

/**
 * Anexa a cada agrupación sus conteos de equivalencias y sus géneros. Con `ids`
 * solo lee lo de esas agrupaciones (POST/PATCH); sin `ids`, todo (listado).
 */
async function anexarDatos(
  db: Db,
  filas: Agrupacion[],
  ids?: string[]
): Promise<{ data: AgrupacionEstacionalidadFila[]; error: PostgrestError | null }> {
  const [equivalencias, vinculos, generos] = await Promise.all([
    leerTodo<{ agrupacion_estacionalidad_id: string | null; activo: boolean }>((d, h) => {
      const consulta = db.from("equivalencias").select("id, agrupacion_estacionalidad_id, activo");
      return (ids ? consulta.in("agrupacion_estacionalidad_id", ids) : consulta.not("agrupacion_estacionalidad_id", "is", null))
        .order("id")
        .range(d, h);
    }),
    leerTodo<Pick<Tables<"agrupacion_estacionalidad_genero">, "agrupacion_estacionalidad_id" | "genero_id">>((d, h) => {
      const consulta = db.from("agrupacion_estacionalidad_genero").select("id, agrupacion_estacionalidad_id, genero_id");
      return (ids ? consulta.in("agrupacion_estacionalidad_id", ids) : consulta).order("id").range(d, h);
    }),
    leerGeneros(db),
  ]);
  const fallo = equivalencias.error ?? vinculos.error ?? generos.error;
  if (fallo) return { data: [], error: fallo };

  const total = new Map<string, number>();
  const activas = new Map<string, number>();
  for (const e of equivalencias.data) {
    if (e.agrupacion_estacionalidad_id === null) continue;
    total.set(e.agrupacion_estacionalidad_id, (total.get(e.agrupacion_estacionalidad_id) ?? 0) + 1);
    if (e.activo) activas.set(e.agrupacion_estacionalidad_id, (activas.get(e.agrupacion_estacionalidad_id) ?? 0) + 1);
  }
  const generoIdsPorAgrupacion = new Map<string, string[]>();
  for (const v of vinculos.data) {
    const lista = generoIdsPorAgrupacion.get(v.agrupacion_estacionalidad_id) ?? [];
    lista.push(v.genero_id);
    generoIdsPorAgrupacion.set(v.agrupacion_estacionalidad_id, lista);
  }

  const data = filas.map((fila) => {
    const losGeneros = generosDeAgrupacion(generoIdsPorAgrupacion.get(fila.id) ?? [], generos.data);
    return {
      ...fila,
      equivalencias: total.get(fila.id) ?? 0,
      equivalencias_activas: activas.get(fila.id) ?? 0,
      genero_ids: losGeneros.map((g) => g.id),
      generos: losGeneros,
    };
  });
  return { data, error: null };
}

/**
 * `GET /api/agrupaciones-estacionalidad` (`requireUser`; `?incluir_inactivos=1`):
 * por `orden, nombre`, cada fila con `equivalencias`, `equivalencias_activas`,
 * `genero_ids` y `generos`.
 */
export async function listarAgrupaciones(request: NextRequest): Promise<NextResponse> {
  const { response } = await requireUser();
  if (response) return response;

  const db = supabaseAdmin();
  const soloActivos = !incluirInactivos(request);
  const { data: filas, error: err } = await leerTodo<Agrupacion>((d, h) => {
    let consulta = db.from("agrupaciones_estacionalidad").select("*");
    if (soloActivos) consulta = consulta.eq("activo", true);
    return consulta.order("orden").order("nombre").order("id").range(d, h);
  });
  if (err) return traducirErrorDb(err, "listar agrupaciones_estacionalidad");

  const { data, error: errAnexo } = await anexarDatos(db, filas);
  if (errAnexo) return traducirErrorDb(errAnexo, "listar agrupaciones_estacionalidad: conteos y géneros");
  return ok(data);
}

/**
 * `POST /api/agrupaciones-estacionalidad` (`requirePlanner`), `201`. Exige
 * `genero_ids` (1 a 50 UUID únicos): `404` si alguno no existe, `409` si alguno
 * está inactivo, `409` nombre o código repetido.
 */
export async function crearAgrupacion(request: NextRequest): Promise<NextResponse> {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearAgrupacionSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { genero_ids, ...campos } = datos;

  const generos = await leerGeneros(db);
  if (generos.error) return traducirErrorDb(generos.error, "crear agrupación: leer géneros");
  const rechazo = motivoRechazoGenerosPedidos(genero_ids, generos.data, genero_ids);
  if (rechazo) return error(rechazo.mensaje, rechazo.status);

  const { data: fila, error: err } = await db.from("agrupaciones_estacionalidad").insert(campos).select("*").single();
  if (err) return traducirErrorDb(err, "crear agrupación");

  const { error: errVinculos } = await db
    .from("agrupacion_estacionalidad_genero")
    .insert(genero_ids.map((genero_id) => ({ agrupacion_estacionalidad_id: fila.id, genero_id })));
  if (errVinculos) {
    // Sin géneros la agrupación quedaría "heredada" y sin uso: se deshace.
    await db.from("agrupaciones_estacionalidad").delete().eq("id", fila.id);
    return traducirErrorDb(errVinculos, "crear agrupación: asignar géneros");
  }

  const losGeneros = generosDeAgrupacion(genero_ids, generos.data);
  const creada: AgrupacionEstacionalidadFila = {
    ...fila,
    equivalencias: 0,
    equivalencias_activas: 0,
    genero_ids: losGeneros.map((g) => g.id),
    generos: losGeneros,
  };
  return ok(creada, 201);
}

/** La agrupación como destino de una asignación: lo justo para `rechazoAsignacion` y `planificarAsignacion`. */
export type DestinoAsignacion = { id: string; nombre: string; activo: boolean; genero_ids: string[] };

/** Lee la agrupación con sus `genero_ids`; `null` si no existe. */
export async function leerDestino(
  db: Db,
  id: string
): Promise<{ data: DestinoAsignacion | null; error: PostgrestError | null }> {
  const { data, error: err } = await db
    .from("agrupaciones_estacionalidad")
    .select("id, nombre, activo, agrupacion_estacionalidad_genero(genero_id)")
    .eq("id", id)
    .maybeSingle();
  if (err || !data) return { data: null, error: err };
  const { agrupacion_estacionalidad_genero: vinculos, ...agrupacion } = data;
  return { data: { ...agrupacion, genero_ids: vinculos.map((v) => v.genero_id) }, error: null };
}

type Params = { params: Promise<{ id: string }> };

/** Cuántas equivalencias de cada género tiene asignadas la agrupación (género del nodo de la equivalencia). */
async function contarEquivalenciasPorGenero(
  db: Db,
  agrupacionId: string
): Promise<{ data: Map<string, number>; error: PostgrestError | null }> {
  const { data, error: err } = await leerTodo<{ id: string; genero_mundo_linea: { genero_id: string } | null }>((d, h) =>
    db
      .from("equivalencias")
      .select("id, genero_mundo_linea(genero_id)")
      .eq("agrupacion_estacionalidad_id", agrupacionId)
      .order("id")
      .range(d, h)
  );
  const conteo = new Map<string, number>();
  for (const e of data) {
    const generoId = e.genero_mundo_linea?.genero_id;
    if (generoId) conteo.set(generoId, (conteo.get(generoId) ?? 0) + 1);
  }
  return { data: conteo, error: err };
}

/**
 * `PATCH /api/agrupaciones-estacionalidad/[id]` (`requirePlanner`): nombre,
 * código, descripción, orden, activo y/o `genero_ids`. Si `genero_ids` viene
 * (mínimo 1) reemplaza el conjunto: `404` si algún género no existe, `409` si
 * agrega uno inactivo y `409` si quita un género del que la agrupación tiene
 * equivalencias ("Reasígnalas antes."). Todo se valida antes de escribir. Una
 * agrupación heredada sin géneros se puede renombrar o activar sin mandar
 * `genero_ids`; solo la asignación de equivalencias queda bloqueada.
 */
export async function editarAgrupacion(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { response } = await requirePlanner();
  if (response) return response;

  const { id, respuesta: respuestaId } = await idDeRuta(params, AGRUPACION_NO_ENCONTRADA);
  if (respuestaId) return respuestaId;
  const { datos, respuesta } = await leerCuerpo(request, editarAgrupacionSchema);
  if (respuesta) return respuesta;

  const db = supabaseAdmin();
  const { data: actual, error: errActual } = await db
    .from("agrupaciones_estacionalidad")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (errActual) return traducirErrorDb(errActual, "buscar agrupación de estacionalidad");
  if (!actual) return error(AGRUPACION_NO_ENCONTRADA, 404);

  const { genero_ids, ...campos } = datos;
  let agregar: string[] = [];
  let quitar: string[] = [];

  // 1. Validar todo lo de géneros antes de escribir nada.
  if (genero_ids !== undefined) {
    const [generos, vinculos] = await Promise.all([
      leerGeneros(db),
      db.from("agrupacion_estacionalidad_genero").select("genero_id").eq("agrupacion_estacionalidad_id", id),
    ]);
    if (generos.error) return traducirErrorDb(generos.error, "editar agrupación: leer géneros");
    if (vinculos.error) return traducirErrorDb(vinculos.error, "editar agrupación: leer géneros de la agrupación");

    ({ agregar, quitar } = diferenciaGeneros(
      vinculos.data.map((v) => v.genero_id),
      genero_ids
    ));

    const rechazo = motivoRechazoGenerosPedidos(genero_ids, generos.data, agregar);
    if (rechazo) return error(rechazo.mensaje, rechazo.status);

    if (quitar.length > 0) {
      const conteo = await contarEquivalenciasPorGenero(db, id);
      if (conteo.error) return traducirErrorDb(conteo.error, "editar agrupación: contar equivalencias por género");
      const quitados = generosDeAgrupacion(quitar, generos.data).map((g) => ({
        nombre: g.nombre,
        equivalencias: conteo.data.get(g.id) ?? 0,
      }));
      const bloqueo = motivoRechazoQuitarGeneros(actual, quitados);
      if (bloqueo) return error(bloqueo, 409);
    }
  }

  // 2. Campos de la agrupación (los `409` de nombre o código repetido salen aquí, antes de tocar géneros).
  let fila = actual;
  if (Object.keys(campos).length > 0) {
    const { data, error: err } = await db
      .from("agrupaciones_estacionalidad")
      .update(campos)
      .eq("id", id)
      .select("*")
      .single();
    if (err) return traducirErrorDb(err, "editar agrupación");
    fila = data;
  }

  // 3. Géneros: primero los nuevos y después los quitados, para que la agrupación no pase por cero géneros.
  if (agregar.length > 0) {
    const { error: err } = await db
      .from("agrupacion_estacionalidad_genero")
      .upsert(
        agregar.map((genero_id) => ({ agrupacion_estacionalidad_id: id, genero_id })),
        { onConflict: "agrupacion_estacionalidad_id,genero_id", ignoreDuplicates: true }
      );
    if (err) return traducirErrorDb(err, "editar agrupación: agregar géneros");
  }
  if (quitar.length > 0) {
    const { error: err } = await db
      .from("agrupacion_estacionalidad_genero")
      .delete()
      .eq("agrupacion_estacionalidad_id", id)
      .in("genero_id", quitar);
    if (err) return traducirErrorDb(err, "editar agrupación: quitar géneros");
  }

  const { data, error: errAnexo } = await anexarDatos(db, [fila], [id]);
  if (errAnexo) return traducirErrorDb(errAnexo, "editar agrupación: leer resultado");
  return ok(data[0]);
}
