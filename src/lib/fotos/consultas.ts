import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import type { ViajeResumenApi } from "@/lib/compras/agrupadores/tipos-api";
import { ESTADOS_VIAJE } from "@/lib/compras/agrupadores/tipos";
import { MAX_FOTOS_POR_LINEA } from "./constantes";
import type { CompraFotos, FotoActivaFotos, LineaFotos } from "./modulo";
import { elegirLineaOrigen, fotosParaTraer, type CompraCandidata } from "./traer";

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

// ─── Compras → Fotos (solo lectura) ───

export type FiltrosLecturaFotos = {
  /** `sin_viaje` pide las compras sin viaje; un uuid, las de ese viaje; ausente, todas. */
  viaje_id?: string | undefined;
  compra_id?: string | undefined;
  origen?: string | undefined;
  /** Ausente: todas menos las canceladas. */
  estado?: string | undefined;
};

export type DatosModuloFotos = {
  compras: CompraFotos[];
  lineas: LineaFotos[];
  fotos: FotoActivaFotos[];
  proveedores: Map<string, string>;
  viajes: Map<string, ViajeResumenApi>;
  /** `clave_importacion` de cada línea (nula en las manuales), para contar las fotos de la versión cancelada. */
  claves: Map<string, string | null>;
};

const elegirEstadoViaje = (v: string): ViajeResumenApi["estado"] => (ESTADOS_VIAJE as readonly string[]).includes(v) ? (v as ViajeResumenApi["estado"]) : "abierto";

const VACIO_MODULO = (): DatosModuloFotos => ({ compras: [], lineas: [], fotos: [], proveedores: new Map(), viajes: new Map(), claves: new Map() });

/**
 * Lo que necesita Compras → Fotos: las compras filtradas en la base (viaje, compra, origen y estado), sus líneas ACTIVAS y sus fotos
 * activas en tandas de ids, los nombres de proveedor y los viajes de esas compras. Solo columnas livianas; nunca `ruta` ni `ruta_miniatura`.
 */
export async function leerDatosModuloFotos(db: Db, f: FiltrosLecturaFotos): Promise<Resultado<DatosModuloFotos>> {
  const compras = await leerTodo<CompraFotos>((d, h) => {
    let q = db.from("compras").select("id, numero, estado, proveedor_id, viaje_id, fecha_compra, moneda");
    if (f.viaje_id === "sin_viaje") q = q.is("viaje_id", null);
    else if (f.viaje_id !== undefined) q = q.eq("viaje_id", f.viaje_id);
    if (f.compra_id !== undefined) q = q.eq("id", f.compra_id);
    if (f.origen !== undefined) q = q.eq("origen", f.origen);
    q = f.estado === undefined ? q.neq("estado", "cancelada") : q.eq("estado", f.estado);
    return q.order("id").range(d, h);
  });
  const vacio = VACIO_MODULO();
  if (compras.error) return { data: vacio, error: compras.error };
  const datos = { ...vacio, compras: compras.data };
  const ids = compras.data.map((c) => c.id);

  for (const tanda of enTandas(ids, TANDA_IN)) {
    const [lineas, fotos] = await Promise.all([
      leerTodo<LineaFotos & { clave_importacion: string | null }>((d, h) =>
        db
          .from("compra_lineas")
          .select("id, compra_id, tipo, genero_mundo_linea_id, marca_id, agrupacion_marca_id, tallas, unidades, costo_unitario, descripcion, modelo, created_at, clave_importacion")
          .in("compra_id", tanda)
          .eq("activo", true)
          .order("id")
          .range(d, h)
      ),
      leerTodo<FotoActivaFotos>((d, h) =>
        db.from("compra_linea_fotos").select("id, linea_id, subida_por_nombre, created_at").in("compra_id", tanda).eq("activo", true).order("id").range(d, h)
      ),
    ]);
    if (lineas.error) return { data: vacio, error: lineas.error };
    if (fotos.error) return { data: vacio, error: fotos.error };
    for (const l of lineas.data) {
      const { clave_importacion, ...linea } = l;
      datos.lineas.push(linea);
      datos.claves.set(l.id, clave_importacion);
    }
    datos.fotos.push(...fotos.data);
  }

  for (const tanda of enTandas([...new Set(compras.data.map((c) => c.proveedor_id))], TANDA_IN)) {
    const r = await leerTodo<{ id: string; nombre: string }>((d, h) => db.from("proveedores").select("id, nombre").in("id", tanda).order("id").range(d, h));
    if (r.error) return { data: vacio, error: r.error };
    for (const p of r.data) datos.proveedores.set(p.id, p.nombre);
  }
  const idsViaje = [...new Set(compras.data.map((c) => c.viaje_id).filter((x): x is string => x !== null))];
  for (const tanda of enTandas(idsViaje, TANDA_IN)) {
    const r = await leerTodo<{ id: string; codigo: string; nombre: string; estado: string }>((d, h) =>
      db.from("compra_viajes").select("id, codigo, nombre, estado").in("id", tanda).order("id").range(d, h)
    );
    if (r.error) return { data: vacio, error: r.error };
    for (const v of r.data) datos.viajes.set(v.id, { id: v.id, codigo: v.codigo, nombre: v.nombre, estado: elegirEstadoViaje(v.estado) });
  }
  return { data: datos, error: null };
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
  const origen = elegirLineaOrigen(
    { id: destino.id, compra_id: destino.compra_id, proveedor_id: proveedorId },
    candidatas.data,
    new Map(compras.data.map((c) => [c.id, c])),
  );
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

/** Una línea que podría traer fotos de su versión cancelada: de una compra NO cancelada, con las fotos activas que ya tiene. */
export type DestinoParaTraer = { id: string; compra_id: string; proveedor_id: string; clave_importacion: string | null; activas: number };

/**
 * `fotos_en_cancelada` de muchas líneas a la vez (decisión 104): cuántas fotos traería «Traer» ahora a cada línea (las activas de su línea
 * de origen que aún no trajo, hasta completar 3). Solo aparecen en el resultado las líneas con algo que traer. Son 4 lecturas en tandas
 * para todas, no una por línea: las líneas sin `clave_importacion` (las manuales) ni siquiera se consultan.
 */
export async function leerFotosEnCancelada(db: Db, destinos: readonly DestinoParaTraer[]): Promise<Resultado<Map<string, number>>> {
  const salida = new Map<string, number>();
  const conClave = destinos.filter((d): d is DestinoParaTraer & { clave_importacion: string } => d.clave_importacion !== null && d.activas < MAX_FOTOS_POR_LINEA);
  if (conClave.length === 0) return { data: salida, error: null };

  const candidatas: (Pick<Tables<"compra_lineas">, "id" | "compra_id" | "created_at" | "clave_importacion">)[] = [];
  for (const tanda of enTandas([...new Set(conClave.map((d) => d.clave_importacion))], TANDA_IN)) {
    const r = await leerTodo<Pick<Tables<"compra_lineas">, "id" | "compra_id" | "created_at" | "clave_importacion">>((d, h) =>
      db.from("compra_lineas").select("id, compra_id, created_at, clave_importacion").in("clave_importacion", tanda).order("id").range(d, h)
    );
    if (r.error) return { data: salida, error: r.error };
    candidatas.push(...r.data);
  }
  if (candidatas.length === 0) return { data: salida, error: null };

  const compras = new Map<string, CompraCandidata>();
  for (const tanda of enTandas([...new Set(candidatas.map((l) => l.compra_id))], TANDA_IN)) {
    const r = await leerTodo<Pick<Tables<"compras">, "id" | "estado" | "proveedor_id" | "created_at" | "cancelada_at">>((d, h) =>
      db.from("compras").select("id, estado, proveedor_id, created_at, cancelada_at").in("id", tanda).eq("estado", "cancelada").order("id").range(d, h)
    );
    if (r.error) return { data: salida, error: r.error };
    for (const c of r.data) compras.set(c.id, c);
  }
  if (compras.size === 0) return { data: salida, error: null };

  const porClave = new Map<string, typeof candidatas>();
  for (const l of candidatas) if (l.clave_importacion !== null) porClave.set(l.clave_importacion, [...(porClave.get(l.clave_importacion) ?? []), l]);
  const origenDe = new Map<string, string>();
  for (const d of conClave) {
    const o = elegirLineaOrigen(d, porClave.get(d.clave_importacion) ?? [], compras);
    if (o) origenDe.set(d.id, o.id);
  }
  if (origenDe.size === 0) return { data: salida, error: null };

  const fotosDeOrigen = new Map<string, string[]>();
  for (const tanda of enTandas([...new Set(origenDe.values())], TANDA_IN)) {
    const r = await leerTodo<Pick<FotoDb, "id" | "linea_id">>((d, h) => db.from("compra_linea_fotos").select("id, linea_id").in("linea_id", tanda).eq("activo", true).order("id").range(d, h));
    if (r.error) return { data: salida, error: r.error };
    for (const f of r.data) fotosDeOrigen.set(f.linea_id, [...(fotosDeOrigen.get(f.linea_id) ?? []), f.id]);
  }
  const traidasPorLinea = new Map<string, Set<string>>();
  for (const tanda of enTandas([...origenDe.keys()], TANDA_IN)) {
    const r = await leerTodo<Pick<FotoDb, "id" | "linea_id" | "origen_foto_id">>((d, h) =>
      db.from("compra_linea_fotos").select("id, linea_id, origen_foto_id").in("linea_id", tanda).eq("activo", true).order("id").range(d, h)
    );
    if (r.error) return { data: salida, error: r.error };
    for (const f of r.data) if (f.origen_foto_id !== null) traidasPorLinea.set(f.linea_id, (traidasPorLinea.get(f.linea_id) ?? new Set()).add(f.origen_foto_id));
  }
  for (const d of conClave) {
    const origen = origenDe.get(d.id);
    if (!origen) continue;
    const n = fotosParaTraer(fotosDeOrigen.get(origen) ?? [], traidasPorLinea.get(d.id) ?? new Set(), d.activas);
    if (n > 0) salida.set(d.id, n);
  }
  return { data: salida, error: null };
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
