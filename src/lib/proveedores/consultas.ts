import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import type { ContactoFila, CompraParaResumen, LineaParaResumen } from "./api";
import type { EventoProveedorDb } from "./historial";

/**
 * Acceso a datos de los proveedores (08c, §3.2). LEE `proveedores`, `proveedor_contactos`, `proveedor_eventos` y las compras del proveedor
 * (para contar y resumir) y ESCRIBE solo con `guardar_proveedor`, `cambiar_activo_proveedor` y `eliminar_proveedor` (`rpc`, una
 * transacción por llamada). Aquí no hay `.insert(`, `.update(`, `.upsert(` ni `.delete(` (lo vigila la prueba estática). Nunca se lee
 * ninguna columna bancaria (no existen) ni se devuelve `clave_origen`: el mapeo de `api.ts` no la copia.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };
export type RespuestaRpc = { data: unknown; error: PostgrestError | null };

export type ProveedorDb = Tables<"proveedores">;

export const leerProveedores = (db: Db): Promise<Resultado<ProveedorDb[]>> =>
  leerTodo<ProveedorDb>((d, h) => db.from("proveedores").select("*").order("nombre").order("id").range(d, h));

export async function leerProveedor(db: Db, id: string): Promise<Resultado<ProveedorDb | null>> {
  const r = await db.from("proveedores").select("*").eq("id", id).maybeSingle();
  return { data: r.data ?? null, error: r.error };
}

const COLUMNAS_CONTACTO = "id, proveedor_id, nombre, cargo, telefono, correo, es_principal, orden, created_at";

export const leerContactos = (db: Db): Promise<Resultado<ContactoFila[]>> =>
  leerTodo<ContactoFila>((d, h) => db.from("proveedor_contactos").select(COLUMNAS_CONTACTO).order("proveedor_id").order("orden").order("id").range(d, h));

export const leerContactosDe = (db: Db, proveedorId: string): Promise<Resultado<ContactoFila[]>> =>
  leerTodo<ContactoFila>((d, h) => db.from("proveedor_contactos").select(COLUMNAS_CONTACTO).eq("proveedor_id", proveedorId).order("orden").order("id").range(d, h));

/** `proveedor_id` y estado de todas las compras: de ahí sale cuántas no canceladas tiene cada proveedor. */
export const leerComprasPorProveedor = (db: Db): Promise<Resultado<{ id: string; proveedor_id: string; estado: string }[]>> =>
  leerTodo<{ id: string; proveedor_id: string; estado: string }>((d, h) => db.from("compras").select("id, proveedor_id, estado").order("id").range(d, h));

/** Las compras de un proveedor y sus líneas (en tandas: los ids viajan en la URL). */
export async function leerComprasYLineasDe(db: Db, proveedorId: string): Promise<Resultado<{ compras: CompraParaResumen[]; lineas: LineaParaResumen[] }>> {
  const compras = await leerTodo<CompraParaResumen>((d, h) => db.from("compras").select("id, estado, fecha_compra, moneda").eq("proveedor_id", proveedorId).order("id").range(d, h));
  if (compras.error) return { data: { compras: [], lineas: [] }, error: compras.error };
  const lineas: LineaParaResumen[] = [];
  for (const tanda of enTandas(
    compras.data.map((c) => c.id),
    TANDA_IN,
  )) {
    const r = await leerTodo<LineaParaResumen>((d, h) =>
      db.from("compra_lineas").select("compra_id, unidades, unidades_canceladas, costo_unitario, activo, id").in("compra_id", tanda).order("id").range(d, h)
    );
    if (r.error) return { data: { compras: [], lineas: [] }, error: r.error };
    lineas.push(...r.data);
  }
  return { data: { compras: compras.data, lineas }, error: null };
}

export const leerEventosDeProveedor = (db: Db, proveedorId: string): Promise<Resultado<EventoProveedorDb[]>> =>
  leerTodo<EventoProveedorDb>((d, h) =>
    db.from("proveedor_eventos").select("id, accion, antes, despues, resumen, usuario_nombre, created_at").eq("proveedor_id", proveedorId).order("created_at", { ascending: false }).order("id").range(d, h)
  );

// ─── Escritura: SOLO las funciones de 0039 ───

export type ActorProveedorDb = { perfil_id: string; nombre: string; rol: string };
const actorJson = (a: ActorProveedorDb): Json => ({ perfil_id: a.perfil_id, nombre: a.nombre, rol: a.rol });

export function rpcGuardarProveedor(db: Db, a: { id: string | null; revision: number | null; proveedor: Record<string, Json>; contactos: Json | null; actor: ActorProveedorDb }): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("guardar_proveedor", { p_id: a.id, p_revision: a.revision, p_proveedor: a.proveedor, p_contactos: a.contactos as Json, p_actor: actorJson(a.actor) }));
}

export function rpcCambiarActivoProveedor(db: Db, id: string, activo: boolean, actor: ActorProveedorDb): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("cambiar_activo_proveedor", { p_id: id, p_activo: activo, p_actor: actorJson(actor) }));
}

export function rpcEliminarProveedor(db: Db, id: string, actor: ActorProveedorDb): Promise<RespuestaRpc> {
  return Promise.resolve(db.rpc("eliminar_proveedor", { p_id: id, p_actor: actorJson(actor) }));
}
