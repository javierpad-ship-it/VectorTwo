import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerEquivalencias, leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import { cargarEstadoGml, type EstadoGmlCargado } from "@/lib/marcas/gml/estado";
import { leerAsignaciones } from "@/lib/responsables/consultas";
import { leerTiendas } from "@/lib/tiendas/consultas";
import type { ArgsCancelarCompra } from "./cancelar";
import type { PayloadImportarCompra } from "./importar";
import type { ArgsQuitarRecepcion, ArgsRegistrarRecepciones } from "./recepciones";
import type { ActorCompra } from "./tipos";

/**
 * Acceso a datos de las compras de M8 (solo servidor). ÚNICO archivo de `src/lib/compras/` que habla con Supabase (ficha 08, regla 21).
 * LEE las tablas de compras (todas, con `leerTodo` y orden estable) y las ESCRIBE solo con las cuatro funciones `rpc` de `0025`
 * (`importar_compra`, `registrar_recepciones`, `quitar_recepcion`, `cancelar_compra`): una transacción por llamada, con candado por
 * `revision`, pertenencia y evento. Aquí no hay `.insert(`, `.update(`, `.upsert(` ni `.delete(` sobre ninguna tabla de compras
 * (lo vigila la prueba estática): la API nunca las escribe directamente.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type CompraDb = Tables<"compras">;
export type LineaDb = Tables<"compra_lineas">;
export type EntregaDb = Tables<"compra_linea_entregas">;
export type RepartoDb = Tables<"compra_linea_repartos">;
export type RecepcionDb = Tables<"compra_linea_recepciones">;
export type EventoDb = Tables<"compra_eventos">;
export type ProveedorDb = Tables<"proveedores">;

export type DatosCompras = {
  compras: CompraDb[];
  lineas: LineaDb[];
  entregas: EntregaDb[];
  repartos: RepartoDb[];
  recepciones: RecepcionDb[];
  proveedores: ProveedorDb[];
};

const FALLO_VACIO: DatosCompras = { compras: [], lineas: [], entregas: [], repartos: [], recepciones: [], proveedores: [] };

/** Todas las compras con sus líneas, entregas, repartos y recepciones (de cualquier estado), más los proveedores. */
export async function leerDatosCompras(db: Db): Promise<Resultado<DatosCompras>> {
  const [compras, lineas, entregas, repartos, recepciones, proveedores] = await Promise.all([
    leerTodo<CompraDb>((d, h) => db.from("compras").select("*").order("id").range(d, h)),
    leerTodo<LineaDb>((d, h) => db.from("compra_lineas").select("*").order("id").range(d, h)),
    leerTodo<EntregaDb>((d, h) => db.from("compra_linea_entregas").select("*").order("id").range(d, h)),
    leerTodo<RepartoDb>((d, h) => db.from("compra_linea_repartos").select("*").order("id").range(d, h)),
    leerTodo<RecepcionDb>((d, h) => db.from("compra_linea_recepciones").select("*").order("id").range(d, h)),
    leerTodo<ProveedorDb>((d, h) => db.from("proveedores").select("*").order("id").range(d, h)),
  ]);
  const fallo = compras.error ?? lineas.error ?? entregas.error ?? repartos.error ?? recepciones.error ?? proveedores.error;
  if (fallo) return { data: FALLO_VACIO, error: fallo };
  return {
    data: { compras: compras.data, lineas: lineas.data, entregas: entregas.data, repartos: repartos.data, recepciones: recepciones.data, proveedores: proveedores.data },
    error: null,
  };
}

export type DatosDeCompra = Omit<DatosCompras, "compras" | "proveedores"> & { compra: CompraDb; proveedor: ProveedorDb | null };

/** Una compra con todo lo suyo; `null` si no existe. Los hijos se piden por los ids de sus líneas (en tandas: viajan en la URL). */
export async function leerDatosDeCompra(db: Db, compraId: string): Promise<Resultado<DatosDeCompra | null>> {
  const compra = await db.from("compras").select("*").eq("id", compraId).maybeSingle();
  if (compra.error) return { data: null, error: compra.error };
  if (!compra.data) return { data: null, error: null };
  const [lineas, proveedor] = await Promise.all([
    leerTodo<LineaDb>((d, h) => db.from("compra_lineas").select("*").eq("compra_id", compraId).order("id").range(d, h)),
    db.from("proveedores").select("*").eq("id", compra.data.proveedor_id).maybeSingle(),
  ]);
  if (lineas.error) return { data: null, error: lineas.error };
  if (proveedor.error) return { data: null, error: proveedor.error };

  const ids = lineas.data.map((l) => l.id);
  const entregas: EntregaDb[] = [];
  const repartos: RepartoDb[] = [];
  const recepciones: RecepcionDb[] = [];
  for (const tanda of enTandas(ids, TANDA_IN)) {
    const [e, r, x] = await Promise.all([
      leerTodo<EntregaDb>((d, h) => db.from("compra_linea_entregas").select("*").in("linea_id", tanda).order("id").range(d, h)),
      leerTodo<RepartoDb>((d, h) => db.from("compra_linea_repartos").select("*").in("linea_id", tanda).order("id").range(d, h)),
      leerTodo<RecepcionDb>((d, h) => db.from("compra_linea_recepciones").select("*").in("linea_id", tanda).order("id").range(d, h)),
    ]);
    const fallo = e.error ?? r.error ?? x.error;
    if (fallo) return { data: null, error: fallo };
    entregas.push(...e.data);
    repartos.push(...r.data);
    recepciones.push(...x.data);
  }
  return { data: { compra: compra.data, proveedor: proveedor.data ?? null, lineas: lineas.data, entregas, repartos, recepciones }, error: null };
}

/** El historial de una compra, del más antiguo al más reciente (`created_at` y, a igual instante, `id`). */
export function leerEventosDeCompra(db: Db, compraId: string): Promise<Resultado<EventoDb[]>> {
  return leerTodo<EventoDb>((d, h) => db.from("compra_eventos").select("*").eq("compra_id", compraId).order("created_at").order("id").range(d, h));
}

/** Una línea con su compra y la entrega que se nombra (si es de esa línea): la pertenencia de «Aceptar sugerencia». */
export async function leerLineaYEntrega(
  db: Db,
  lineaId: string,
  entregaId: string
): Promise<Resultado<{ linea: LineaDb; entrega: EntregaDb | null } | null>> {
  const linea = await db.from("compra_lineas").select("*").eq("id", lineaId).maybeSingle();
  if (linea.error) return { data: null, error: linea.error };
  if (!linea.data) return { data: null, error: null };
  const entrega = await db.from("compra_linea_entregas").select("*").eq("id", entregaId).eq("linea_id", lineaId).maybeSingle();
  if (entrega.error) return { data: null, error: entrega.error };
  return { data: { linea: linea.data, entrega: entrega.data ?? null }, error: null };
}

export function leerProveedoresDb(db: Db): Promise<Resultado<ProveedorDb[]>> {
  return leerTodo<ProveedorDb>((d, h) => db.from("proveedores").select("*").order("nombre").order("id").range(d, h));
}

/** Los meses con carga publicada (`aaaa-mm`): de ahí sale el último mes publicado `k'` (con `hastaPorDefecto`). */
export async function leerMesesPublicados(db: Db): Promise<Resultado<string[]>> {
  const r = await leerTodo<{ id: string; periodo: string }>((d, h) =>
    db.from("cargas_venta_stock").select("id, periodo").eq("estado", "publicada").order("periodo").order("id").range(d, h)
  );
  return { data: r.data.map((c) => c.periodo.slice(0, 7)), error: r.error };
}

/** `flujo_parametros.temporadas` (para la temporada de una entrega); `null` si no hay fila. */
export async function leerTemporadasConfiguradas(db: Db): Promise<Resultado<Json | null>> {
  const { data, error } = await db.from("flujo_parametros").select("temporadas").eq("clave", "global").maybeSingle();
  return { data: data?.temporadas ?? null, error };
}

export type CatalogoLeido = {
  gml: EstadoGmlCargado;
  equivalencias: Tables<"equivalencias">[];
  tiendas: Tables<"tiendas">[];
  asignaciones: { genero_id: string; mundo_id: string; perfil_id: string }[];
};

/** Marcas, agrupaciones y árbol (02b), equivalencias, tiendas y responsables: lo que arma los nombres de una compra y el estado del importador. */
export async function leerCatalogo(db: Db): Promise<{ data: CatalogoLeido | null; error: PostgrestError | null }> {
  const [gml, equivalencias, tiendas, asignaciones] = await Promise.all([cargarEstadoGml(db), leerEquivalencias(db), leerTiendas(db, { soloActivas: false }), leerAsignaciones(db)]);
  const fallo = gml.error ?? equivalencias.error ?? tiendas.error ?? asignaciones.error;
  if (fallo || !gml.estado) return { data: null, error: (fallo ?? null) as PostgrestError | null };
  return {
    data: {
      gml: gml as EstadoGmlCargado,
      equivalencias: equivalencias.data,
      tiendas: tiendas.data,
      asignaciones: asignaciones.data.filter((a) => a.activo).map((a) => ({ genero_id: a.genero_id, mundo_id: a.mundo_id, perfil_id: a.perfil_id })),
    },
    error: null,
  };
}

// ─── Escritura: SOLO las funciones de `0025` (una transacción por llamada) ───

/** Lo que devuelve una llamada `rpc`: el `jsonb` de la función o el error de Postgres (una excepción de la función deshace todo). */
export type RespuestaRpc = { data: unknown; error: PostgrestError | null };

/** `registrar_recepciones`: «Confirmar ingreso» (y «Aceptar sugerencia») de una o varias líneas de UNA compra. */
export function rpcRegistrarRecepciones(db: Db, a: ArgsRegistrarRecepciones): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("registrar_recepciones", { ...a, p_motivo: a.p_motivo as string }));
}

/** `quitar_recepcion`: borra UNA recepción (queda entera en el `antes` del evento). */
export function rpcQuitarRecepcion(db: Db, a: ArgsQuitarRecepcion): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("quitar_recepcion", { ...a }));
}

/** `cancelar_compra`: sin recepciones, `cancelada`; con ellas, cierra el saldo. */
export function rpcCancelarCompra(db: Db, a: ArgsCancelarCompra): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("cancelar_compra", { ...a }));
}

/** `importar_compra`: UNA compra de la carga inicial (proveedor si falta, compra, líneas, entregas, repartos, recepciones y evento). */
export function rpcImportarCompra(db: Db, a: { p_compra: PayloadImportarCompra; p_actor: ActorCompra }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("importar_compra", { p_compra: a.p_compra as unknown as Json, p_actor: a.p_actor }));
}
