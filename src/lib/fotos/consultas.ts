import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";

/**
 * Acceso a datos de las fotos de las líneas y de la ficha de la línea (08c, §3). LEE `compra_linea_fotos`, `compra_lineas`, `compras` y
 * `proveedores` y ESCRIBE solo con las funciones `rpc` de `0039` (`agregar_foto_linea`, `quitar_foto_linea`, `traer_fotos_linea`,
 * `editar_ficha_linea`) y lee `fotos_huerfanas`. Aquí no hay `.insert(`, `.update(`, `.upsert(` ni `.delete(` (lo vigila la prueba estática).
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };
export type RespuestaRpc = { data: unknown; error: PostgrestError | null };

export type FotoDb = Tables<"compra_linea_fotos">;

/** Quién hace el cambio: el perfil del guard (la base lo copia a `subida_por_*`, `quitada_por_*` y a los eventos). */
export type ActorFotoDb = { perfil_id: string; nombre: string; rol: string };

export type ContextoLineaFoto = {
  compra: Pick<Tables<"compras">, "id" | "estado" | "proveedor_id" | "numero"> | null;
  linea: Pick<Tables<"compra_lineas">, "id" | "compra_id" | "activo" | "clave_importacion" | "descripcion" | "modelo"> | null;
  /** Fotos activas de la línea. */
  activas: number;
};

/** Compra, línea y cuántas fotos activas tiene: lo que mira el pre-chequeo de la subida (la base vuelve a comprobarlo bajo candado). */
export async function leerContextoLinea(db: Db, compraId: string, lineaId: string): Promise<Resultado<ContextoLineaFoto>> {
  const vacio: ContextoLineaFoto = { compra: null, linea: null, activas: 0 };
  const compra = await db.from("compras").select("id, estado, proveedor_id, numero").eq("id", compraId).maybeSingle();
  if (compra.error) return { data: vacio, error: compra.error };
  if (!compra.data) return { data: vacio, error: null };
  const linea = await db
    .from("compra_lineas")
    .select("id, compra_id, activo, clave_importacion, descripcion, modelo")
    .eq("id", lineaId)
    .eq("compra_id", compraId)
    .maybeSingle();
  if (linea.error) return { data: vacio, error: linea.error };
  if (!linea.data) return { data: { compra: compra.data, linea: null, activas: 0 }, error: null };
  const fotos = await db.from("compra_linea_fotos").select("id").eq("linea_id", lineaId).eq("activo", true).order("id");
  if (fotos.error) return { data: vacio, error: fotos.error };
  return { data: { compra: compra.data, linea: linea.data, activas: (fotos.data ?? []).length }, error: null };
}

/** Una foto ACTIVA por id; `null` si no existe o está quitada. */
export async function leerFotoActiva(db: Db, fotoId: string): Promise<Resultado<FotoDb | null>> {
  const r = await db.from("compra_linea_fotos").select("*").eq("id", fotoId).eq("activo", true).maybeSingle();
  return { data: r.data ?? null, error: r.error };
}

/** Lo que se muestra al pie de la foto grande: compra, proveedor, modelo y descripción de la línea. */
export type DatosLeyenda = { numero: string; proveedor: string | null; modelo: string | null; descripcion: string | null };

export async function leerDatosLeyenda(db: Db, foto: Pick<FotoDb, "compra_id" | "linea_id">): Promise<Resultado<DatosLeyenda | null>> {
  const compra = await db.from("compras").select("numero, proveedor_id").eq("id", foto.compra_id).maybeSingle();
  if (compra.error) return { data: null, error: compra.error };
  if (!compra.data) return { data: null, error: null };
  const [linea, proveedor] = await Promise.all([
    db.from("compra_lineas").select("modelo, descripcion").eq("id", foto.linea_id).maybeSingle(),
    db.from("proveedores").select("nombre").eq("id", compra.data.proveedor_id).maybeSingle(),
  ]);
  if (linea.error) return { data: null, error: linea.error };
  if (proveedor.error) return { data: null, error: proveedor.error };
  return {
    data: { numero: compra.data.numero, proveedor: proveedor.data?.nombre ?? null, modelo: linea.data?.modelo ?? null, descripcion: linea.data?.descripcion ?? null },
    error: null,
  };
}

export type OrigenTraer = {
  linea_id: string;
  /** Fotos activas de la línea de origen, de la más antigua a la más nueva. */
  fotos: FotoDb[];
  /** `origen_foto_id` de las fotos ya activas en la línea destino (ya traídas). */
  ya_traidas: string[];
};

/**
 * La línea más reciente de una compra CANCELADA con la misma `clave_importacion` y el mismo proveedor que la línea destino, con sus fotos
 * activas (decisión 104). `null` si no hay (línea sin clave, sin versión cancelada o sin fotos).
 */
export async function leerOrigenDeFotos(db: Db, destino: { id: string; compra_id: string; clave_importacion: string | null }, proveedorId: string): Promise<Resultado<OrigenTraer | null>> {
  if (destino.clave_importacion === null) return { data: null, error: null };
  const candidatas = await leerTodo<Pick<Tables<"compra_lineas">, "id" | "compra_id" | "created_at">>((d, h) =>
    db.from("compra_lineas").select("id, compra_id, created_at").eq("clave_importacion", destino.clave_importacion as string).neq("id", destino.id).order("id").range(d, h)
  );
  if (candidatas.error) return { data: null, error: candidatas.error };
  if (candidatas.data.length === 0) return { data: null, error: null };
  const compras = await leerTodo<Pick<Tables<"compras">, "id" | "estado" | "proveedor_id" | "created_at" | "cancelada_at">>((d, h) =>
    db.from("compras").select("id, estado, proveedor_id, created_at, cancelada_at").in("id", [...new Set(candidatas.data.map((l) => l.compra_id))]).order("id").range(d, h)
  );
  if (compras.error) return { data: null, error: compras.error };
  const validas = new Map(compras.data.filter((c) => c.estado === "cancelada" && c.proveedor_id === proveedorId && c.id !== destino.compra_id).map((c) => [c.id, c]));
  const ordenadas = candidatas.data
    .filter((l) => validas.has(l.compra_id))
    .sort((a, b) => {
      const ca = validas.get(a.compra_id)?.cancelada_at ?? validas.get(a.compra_id)?.created_at ?? "";
      const cb = validas.get(b.compra_id)?.cancelada_at ?? validas.get(b.compra_id)?.created_at ?? "";
      return ca < cb ? 1 : ca > cb ? -1 : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1;
    });
  const origen = ordenadas[0];
  if (!origen) return { data: null, error: null };
  const [fotos, traidas] = await Promise.all([
    leerTodo<FotoDb>((d, h) => db.from("compra_linea_fotos").select("*").eq("linea_id", origen.id).eq("activo", true).order("created_at").order("id").range(d, h)),
    leerTodo<Pick<FotoDb, "id" | "origen_foto_id">>((d, h) => db.from("compra_linea_fotos").select("id, origen_foto_id").eq("linea_id", destino.id).eq("activo", true).order("id").range(d, h)),
  ]);
  if (fotos.error) return { data: null, error: fotos.error };
  if (traidas.error) return { data: null, error: traidas.error };
  if (fotos.data.length === 0) return { data: null, error: null };
  return {
    data: { linea_id: origen.id, fotos: fotos.data, ya_traidas: traidas.data.map((t) => t.origen_foto_id).filter((x): x is string => x !== null) },
    error: null,
  };
}

// ─── Escritura: SOLO las funciones de 0039 ───

const actorJson = (a: ActorFotoDb): Json => ({ perfil_id: a.perfil_id, nombre: a.nombre, rol: a.rol });

export type FotoNueva = { id: string; ancho: number; alto: number; bytes: number; bytes_miniatura: number; ruta: string; ruta_miniatura: string };

export function rpcAgregarFotoLinea(db: Db, compra: string, linea: string, foto: FotoNueva, actor: ActorFotoDb): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("agregar_foto_linea", { p_compra: compra, p_linea: linea, p_foto: { ...foto }, p_actor: actorJson(actor) }));
}

export function rpcQuitarFotoLinea(db: Db, compra: string, linea: string, foto: string, actor: ActorFotoDb): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("quitar_foto_linea", { p_compra: compra, p_linea: linea, p_foto: foto, p_actor: actorJson(actor) }));
}

export function rpcTraerFotosLinea(db: Db, compra: string, linea: string, origen: string, fotos: { id: string; origen_foto_id: string }[], actor: ActorFotoDb): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("traer_fotos_linea", { p_compra: compra, p_linea: linea, p_origen: origen, p_fotos: fotos, p_actor: actorJson(actor) }));
}

export function rpcEditarFichaLinea(
  db: Db,
  compra: string,
  linea: string,
  antes: { descripcion: string | null; modelo: string | null },
  nuevo: { descripcion: string | null; modelo: string | null },
  actor: ActorFotoDb,
): Promise<RespuestaRpc> {
  return Promise.resolve(
    db.rpc("editar_ficha_linea", { p_compra: compra, p_linea: linea, p_antes: antes, p_descripcion: nuevo.descripcion, p_modelo: nuevo.modelo, p_actor: actorJson(actor) }),
  );
}

/** `fotos_huerfanas` (solo lectura): los nombres de objeto que la limpieza puede borrar. */
export function rpcFotosHuerfanas(db: Db, horas: number, limite: number): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("fotos_huerfanas", { p_horas: horas, p_limite: limite }));
}
