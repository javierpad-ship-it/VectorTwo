import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { temporadaDeFila } from "./tipos";
import type { PeriodoAtipicoApi, TemporadaAgrupacion } from "./tipos-api";

/**
 * Acceso a datos de M6 (solo servidor). ÚNICO archivo de `src/` que lee o
 * escribe `periodos_atipicos` (docs/modulos/06-curvas-estacionalidad.md,
 * "Contratos de API"); en el paso 2 será también el único que nombre
 * `venta_mensual_estacionalidad` y su función de refresco.
 */

type Db = SupabaseClient<Database>;

export type PeriodoDb = Tables<"periodos_atipicos">;

/** La fila de la base (fechas `aaaa-mm-01`) como viaja por la API (`aaaa-mm`). */
export function aPeriodoApi(fila: PeriodoDb): PeriodoAtipicoApi {
  return {
    id: fila.id,
    desde: recortarPeriodo(fila.desde),
    hasta: recortarPeriodo(fila.hasta),
    motivo: fila.motivo,
    descripcion: fila.descripcion,
    alcance: fila.alcance === "todas" ? "todas" : "invierno",
    activo: fila.activo,
    created_at: fila.created_at,
    updated_at: fila.updated_at,
  };
}

// ─── Periodos atípicos ───

/** Por `desde` y, a igualdad, `hasta` e `id` (orden estable). Sin `soloActivos`, también los inactivos. */
export function leerPeriodos(db: Db, opciones: { soloActivos: boolean }) {
  return leerTodo<PeriodoDb>((d, h) => {
    let consulta = db.from("periodos_atipicos").select("*");
    if (opciones.soloActivos) consulta = consulta.eq("activo", true);
    return consulta.order("desde").order("hasta").order("id").range(d, h);
  });
}

export async function leerPeriodoPorId(db: Db, id: string) {
  const { data, error } = await db.from("periodos_atipicos").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

export async function insertarPeriodo(db: Db, fila: TablesInsert<"periodos_atipicos">) {
  return db.from("periodos_atipicos").insert(fila).select("*").single();
}

export async function actualizarPeriodo(db: Db, id: string, cambio: TablesUpdate<"periodos_atipicos">) {
  return db.from("periodos_atipicos").update(cambio).eq("id", id).select("*").maybeSingle();
}

/** Borra el periodo; `data` es `null` si el id no existía. */
export async function borrarPeriodo(db: Db, id: string) {
  const { data, error } = await db.from("periodos_atipicos").delete().eq("id", id).select("id").maybeSingle();
  return { data, error };
}

// ─── Agrupaciones (solo temporada y estado) ───

export type TemporadasActivas = { total: number; invierno: number; verano: number; todo_el_ano: number };

/** Cuántas agrupaciones activas hay en total y por temporada (para `agrupaciones_afectadas`). */
export async function contarAgrupacionesActivas(
  db: Db
): Promise<{ data: TemporadasActivas; error: PostgrestError | null }> {
  const { data, error } = await leerTodo<{ id: string; temporada: string }>((d, h) =>
    db.from("agrupaciones_estacionalidad").select("id, temporada").eq("activo", true).order("id").range(d, h)
  );
  const conteo: TemporadasActivas = { total: 0, invierno: 0, verano: 0, todo_el_ano: 0 };
  for (const a of data) {
    conteo.total += 1;
    conteo[temporadaDeFila(a.temporada)] += 1;
  }
  return { data: conteo, error };
}

/** Temporada de una agrupación (activa o no); `data` es `null` si no existe. */
export async function leerTemporadaDeAgrupacion(
  db: Db,
  id: string
): Promise<{ data: { id: string; temporada: TemporadaAgrupacion } | null; error: PostgrestError | null }> {
  const { data, error } = await db.from("agrupaciones_estacionalidad").select("id, temporada").eq("id", id).maybeSingle();
  if (error || !data) return { data: null, error };
  return { data: { id: data.id, temporada: temporadaDeFila(data.temporada) }, error: null };
}

// ─── Meses publicados en M5 ───

/**
 * Meses (`aaaa-mm`) con carga `publicada` en M5, ascendente. Lee solo el
 * `periodo` de `cargas_venta_stock`: un índice único parcial garantiza a lo
 * sumo una publicada por mes, así que son del orden de 50 filas (muy por debajo
 * del corte de 1000 de PostgREST) y no hace falta leer las filas de venta.
 */
export async function leerMesesPublicados(db: Db): Promise<{ data: string[]; error: PostgrestError | null }> {
  const { data, error } = await db
    .from("cargas_venta_stock")
    .select("periodo")
    .eq("estado", "publicada")
    .order("periodo")
    .limit(1000);
  return { data: (data ?? []).map((c) => recortarPeriodo(c.periodo)), error };
}
