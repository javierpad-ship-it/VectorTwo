import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { BUCKET_FOTOS } from "./constantes";

/**
 * Almacén de las fotos: ÚNICO archivo de `src/` que habla con Storage (08c, §3 y R9). El bucket `compras-fotos` es privado y no tiene
 * ninguna política: solo `service_role`, desde los route handlers. Aquí viven `.upload(`, `.remove(`, `.copy(`, `.download(` y
 * `.createSignedUrl(`; la prueba estática vigila que no aparezcan en otro lado.
 *
 * Todas las funciones devuelven un resultado en vez de lanzar: quien llama decide si un fallo es `502 almacen_no_disponible` o algo que
 * recoge la limpieza (`fotos_huerfanas`).
 */

type Db = SupabaseClient<Database>;

const almacen = (db: Db) => db.storage.from(BUCKET_FOTOS);

export type ResultadoAlmacen = { ok: true } | { ok: false; mensaje: string };

/** Sube un JPEG sin sobrescribir (`upsert: false`): una ruta nueva por foto, con ids. */
export async function subirJpeg(db: Db, ruta: string, bytes: Uint8Array): Promise<ResultadoAlmacen> {
  try {
    const { error } = await almacen(db).upload(ruta, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
    return error ? { ok: false, mensaje: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "fallo de red" };
  }
}

/** Borra objetos; los que no existen no cuentan como fallo. */
export async function borrarObjetos(db: Db, rutas: readonly string[]): Promise<ResultadoAlmacen> {
  if (rutas.length === 0) return { ok: true };
  try {
    const { error } = await almacen(db).remove([...rutas]);
    return error ? { ok: false, mensaje: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "fallo de red" };
  }
}

/** Copia un objeto a una ruta nueva dentro del mismo bucket («Traer fotos de la versión cancelada»). */
export async function copiarObjeto(db: Db, desde: string, hasta: string): Promise<ResultadoAlmacen> {
  try {
    const { error } = await almacen(db).copy(desde, hasta);
    return error ? { ok: false, mensaje: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "fallo de red" };
  }
}

export type ResultadoDescarga = { ok: true; bytes: Uint8Array } | { ok: false; mensaje: string };

/** Baja un objeto con `service_role` (la miniatura se sirve por la API). */
export async function descargarObjeto(db: Db, ruta: string): Promise<ResultadoDescarga> {
  try {
    const { data, error } = await almacen(db).download(ruta);
    if (error || !data) return { ok: false, mensaje: error?.message ?? "sin datos" };
    return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "fallo de red" };
  }
}

export type ResultadoFirma = { ok: true; url: string; expira_at: string } | { ok: false; mensaje: string };

/** URL firmada de corta vida (la foto grande, a demanda). */
export async function firmarObjeto(db: Db, ruta: string, segundos: number, ahora: Date = new Date()): Promise<ResultadoFirma> {
  try {
    const { data, error } = await almacen(db).createSignedUrl(ruta, segundos);
    if (error || !data?.signedUrl) return { ok: false, mensaje: error?.message ?? "sin URL" };
    return { ok: true, url: data.signedUrl, expira_at: new Date(ahora.getTime() + segundos * 1000).toISOString() };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "fallo de red" };
  }
}
