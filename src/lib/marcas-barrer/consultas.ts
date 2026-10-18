import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { TANDA_IN, enTandas } from "@/lib/arbol/importar";
import type { VersionLeida } from "./reglas";
import { UMBRAL_GML_PEQUENO } from "./tipos-api";
import type { HechoBarrer, TotalBarrer, VentaMarcaGml } from "./tipos";

/**
 * Acceso a datos de M12 (solo servidor). ÚNICO archivo de `src/` que nombra las funciones SQL `venta_marca_gml` y
 * `venta_marca_gml_resumen` y que lee o escribe `repartos_marca_barrido` y `reparto_marca_barrido_gml` (ficha 12, sección 7).
 * Los agregados salen de las dos funciones `jsonb` (un solo valor: no hay tope de 1 000 filas de PostgREST); todo lo demás
 * que puede crecer se lee con `leerTodo` o en tandas.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

const TANDA_FILAS = 500;
/** Primer día de mes `aaaa-mm-01` a partir de `aaaa-mm`. */
export const primerDia = (mes: string) => `${mes.slice(0, 7)}-01`;

// ─── Funciones SQL de lectura ───

const esObjeto = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const lista = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(esObjeto) : []);
const nulo = (x: unknown): string | null => (typeof x === "string" ? x : null);

/** `venta_marca_gml(p_marca_ids, p_desde, p_hasta)`: hechos de las unidades pedidas (sin talla) y totales de sus GML. */
export async function leerVentaMarcaGml(db: Db, marcaIds: readonly string[], desde: string, hasta: string): Promise<Resultado<VentaMarcaGml>> {
  const { data, error } = await db.rpc("venta_marca_gml", { p_marca_ids: [...marcaIds], p_desde: primerDia(desde), p_hasta: primerDia(hasta) });
  if (error) return { data: { hechos: [], totales: [], cargas: {} }, error };
  const o = esObjeto(data) ? data : {};
  const hechos: HechoBarrer[] = lista(o.hechos).map((h) => ({
    unidad_marca_id: String(h.unidad_marca_id),
    gml_id: String(h.gml_id),
    equivalencia_id: nulo(h.equivalencia_id),
    periodo: String(h.periodo),
    unidades: Number(h.unidades),
  }));
  const totales: TotalBarrer[] = lista(o.totales).map((t) => ({
    gml_id: String(t.gml_id),
    equivalencia_id: nulo(t.equivalencia_id),
    periodo: String(t.periodo),
    unidades: Number(t.unidades),
  }));
  const cargas: Record<string, string> = {};
  if (esObjeto(o.cargas)) for (const [mes, id] of Object.entries(o.cargas)) cargas[mes] = String(id);
  return { data: { hechos, totales, cargas }, error: null };
}

export type ResumenVentaUnidad = { unidad_marca_id: string; unidades: number; gml_con_venta: number; gml_pequenos: number };
export type ResumenVentaPorG = { unidad_marca_id: string; gml_id: string; equivalencia_id: string | null; unidades: number };
export type ResumenVenta = { unidades: ResumenVentaUnidad[]; por_gml: ResumenVentaPorG[]; cargas: Record<string, string> };

/** `venta_marca_gml_resumen(p_desde, p_hasta, p_umbral_pequeno)`: la lista (una fila por unidad con parte al barrer) y su agregado por `g`. */
export async function leerResumenVenta(db: Db, desde: string, hasta: string, umbral: number = UMBRAL_GML_PEQUENO): Promise<Resultado<ResumenVenta>> {
  const { data, error } = await db.rpc("venta_marca_gml_resumen", { p_desde: primerDia(desde), p_hasta: primerDia(hasta), p_umbral_pequeno: umbral });
  if (error) return { data: { unidades: [], por_gml: [], cargas: {} }, error };
  const o = esObjeto(data) ? data : {};
  const cargas: Record<string, string> = {};
  if (esObjeto(o.cargas)) for (const [mes, id] of Object.entries(o.cargas)) cargas[mes] = String(id);
  return {
    data: {
      unidades: lista(o.unidades).map((u) => ({
        unidad_marca_id: String(u.unidad_marca_id),
        unidades: Number(u.unidades),
        gml_con_venta: Number(u.gml_con_venta),
        gml_pequenos: Number(u.gml_pequenos),
      })),
      por_gml: lista(o.por_gml).map((g) => ({
        unidad_marca_id: String(g.unidad_marca_id),
        gml_id: String(g.gml_id),
        equivalencia_id: nulo(g.equivalencia_id),
        unidades: Number(g.unidades),
      })),
      cargas,
    },
    error: null,
  };
}

// ─── Repartos: versiones y filas ───

type RepartoDb = Tables<"repartos_marca_barrido">;
type FilaDb = Tables<"reparto_marca_barrido_gml">;

const aVersion = (r: RepartoDb, filas: readonly FilaDb[]): VersionLeida => ({
  id: r.id,
  marca_id: r.marca_id,
  version: r.version,
  vigente: r.vigente,
  ventana_meses: r.ventana_meses,
  modo: r.modo,
  fuente: r.fuente,
  alcance: r.alcance,
  hasta_periodo: r.hasta_periodo,
  normaliza_nino: r.normaliza_nino,
  huella_cargas: r.huella_cargas,
  huella_config: r.huella_config,
  factores_usados: r.factores_usados,
  temporadas_usadas: r.temporadas_usadas,
  share_barrido: r.share_barrido === null ? null : Number(r.share_barrido),
  eat_pp: r.eat_pp === null ? null : Number(r.eat_pp),
  error_reparto_pp: r.error_reparto_pp === null ? null : Number(r.error_reparto_pp),
  nota: r.nota,
  aprobada_por_id: r.aprobada_por_id,
  aprobada_por_nombre: r.aprobada_por_nombre,
  aprobada_at: r.aprobada_at,
  filas: filas.map((f) => ({
    genero_mundo_linea_id: f.genero_mundo_linea_id,
    equivalencia_id: f.equivalencia_id,
    temporada: f.temporada,
    grupo_resto: f.grupo_resto,
    unidades_ventana: f.unidades_ventana,
    participacion_calculada: Number(f.participacion_calculada),
    participacion_ajustada: f.participacion_ajustada === null ? null : Number(f.participacion_ajustada),
    participacion_vigente: Number(f.participacion_vigente),
  })),
});

/** Las filas de varias versiones (por tandas de ids, cada una paginada con `leerTodo`). */
async function leerFilasDeVersiones(db: Db, repartoIds: readonly string[]): Promise<Resultado<Map<string, FilaDb[]>>> {
  const porReparto = new Map<string, FilaDb[]>();
  for (const tanda of enTandas([...repartoIds], TANDA_IN)) {
    const r = await leerTodo<FilaDb>((d, h) =>
      db.from("reparto_marca_barrido_gml").select("*").in("reparto_id", tanda).order("reparto_id").order("id").range(d, h)
    );
    if (r.error) return { data: porReparto, error: r.error };
    for (const f of r.data) {
      const l = porReparto.get(f.reparto_id) ?? [];
      l.push(f);
      porReparto.set(f.reparto_id, l);
    }
  }
  return { data: porReparto, error: null };
}

/** Los repartos VIGENTES (con sus filas) de esas marcas (`null` = todas las que tienen uno). Una por marca (índice único parcial). */
export async function leerVersionesVigentes(db: Db, marcaIds: readonly string[] | null): Promise<Resultado<VersionLeida[]>> {
  const repartos: RepartoDb[] = [];
  const tandas = marcaIds === null ? [null] : enTandas([...marcaIds], TANDA_IN);
  for (const tanda of tandas) {
    const r = await leerTodo<RepartoDb>((d, h) => {
      let q = db.from("repartos_marca_barrido").select("*").eq("vigente", true).eq("activo", true);
      if (tanda !== null) q = q.in("marca_id", tanda);
      return q.order("marca_id").order("id").range(d, h);
    });
    if (r.error) return { data: [], error: r.error };
    repartos.push(...r.data);
  }
  const filas = await leerFilasDeVersiones(db, repartos.map((r) => r.id));
  if (filas.error) return { data: [], error: filas.error };
  return { data: repartos.map((r) => aVersion(r, filas.data.get(r.id) ?? [])), error: null };
}

/** Todas las versiones de una marca (la más reciente primero), con sus filas. */
export async function leerVersionesDeMarca(db: Db, marcaId: string): Promise<Resultado<VersionLeida[]>> {
  const r = await leerTodo<RepartoDb>((d, h) =>
    db.from("repartos_marca_barrido").select("*").eq("marca_id", marcaId).eq("activo", true).order("version", { ascending: false }).order("id").range(d, h)
  );
  if (r.error) return { data: [], error: r.error };
  const filas = await leerFilasDeVersiones(db, r.data.map((x) => x.id));
  if (filas.error) return { data: [], error: filas.error };
  return { data: r.data.map((x) => aVersion(x, filas.data.get(x.id) ?? [])), error: null };
}

/** Número de versión que sigue (`max + 1`; 1 si la marca no tiene ninguna). */
export async function siguienteVersion(db: Db, marcaId: string): Promise<Resultado<number>> {
  const { data, error } = await db
    .from("repartos_marca_barrido")
    .select("version")
    .eq("marca_id", marcaId)
    .order("version", { ascending: false })
    .limit(1);
  if (error) return { data: 1, error };
  return { data: (data?.[0]?.version ?? 0) + 1, error: null };
}

export type NuevaVersion = Omit<TablesInsert<"repartos_marca_barrido">, "id" | "created_at" | "updated_at" | "activo">;

/** Inserta la versión NUEVA con `vigente = false` (la anterior sigue siendo la vigente hasta que se complete el cambio). */
export async function insertarVersion(db: Db, fila: NuevaVersion) {
  const { data, error } = await db.from("repartos_marca_barrido").insert({ ...fila, vigente: false }).select("*").single();
  return { data, error };
}

export type NuevaFilaVersion = Omit<TablesInsert<"reparto_marca_barrido_gml">, "id" | "created_at" | "updated_at" | "activo">;

/** Inserta las filas de una versión en tandas de 500. */
export async function insertarFilasVersion(db: Db, filas: readonly NuevaFilaVersion[]): Promise<{ error: PostgrestError | null }> {
  for (const tanda of enTandas([...filas], TANDA_FILAS)) {
    const { error } = await db.from("reparto_marca_barrido_gml").insert(tanda);
    if (error) return { error };
  }
  return { error: null };
}

/** Pone `vigente` de una versión. El orden (apagar la anterior y luego encender la nueva) lo respeta quien llama: el único parcial impide dos. */
export async function fijarVigente(db: Db, repartoId: string, vigente: boolean): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from("repartos_marca_barrido").update({ vigente }).eq("id", repartoId);
  return { error };
}

/** Borra una versión a medio escribir (sus filas se van por `cascade`). Solo para deshacer un `POST` que falló. */
export async function eliminarVersion(db: Db, repartoId: string): Promise<{ error: PostgrestError | null }> {
  const { error } = await db.from("repartos_marca_barrido").delete().eq("id", repartoId);
  return { error };
}
