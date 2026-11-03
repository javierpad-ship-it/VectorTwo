import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import type { GrupoLote } from "./plan";
import type { EfectoGMApi, FiltroLote, ResumenLoteApi, TipoLote } from "./tipos-api";

/**
 * Acceso a datos de la aprobación en bloque (ficha 07g, §3). ÚNICO archivo de `src/` que nombra la función `aplicar_lote_proyeccion` y las tablas
 * `proyeccion_lotes` y `proyeccion_lote_filas`. Las tablas de M7 (`proyeccion_filas`, `proyeccion_fila_anios`…) se leen por las funciones exportadas de
 * `src/lib/proyeccion/consultas.ts`. Solo servidor, con el cliente `supabaseAdmin()` que pasa quien llama.
 *
 * Los timestamps (`updated_at_esperado`, `calculado_at_esperado`) viajan como TEXTO tal como los devolvió la base, sin pasar por `Date` (pierde los
 * microsegundos): la función SQL los compara como `timestamptz`.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type LoteDb = Tables<"proyeccion_lotes">;
export type LoteFilaDb = Tables<"proyeccion_lote_filas">;

/** La cabecera del lote que viaja a la función (§2.5). */
export type CabeceraLotePayload = {
  id: string;
  confirmacion_id: string;
  proyeccion_id: string;
  tipo: TipoLote;
  revierte_lote_id?: string;
  anio: number;
  huella_cuerpo: string;
  /** `proyecciones.calculado_at` tal como lo devolvió la base (texto). */
  calculado_at_esperado: string;
  filtro: FiltroLote;
  efecto_gm_previsto: EfectoGMApi[];
  revision_confirmada: boolean;
  propuestas_gm: string[];
  nota?: string;
  perfil_id: string;
  usuario_nombre: string | null;
};

export type PayloadLote = { lote: CabeceraLotePayload; grupos: GrupoLote[] };

/** Una fila de la respuesta de la función (`respuesta_lote_proyeccion`): lo que de verdad quedó guardado. */
export type FilaRespuestaLote = {
  fila_id: string | null;
  fila_clave: string;
  anio: number;
  gm_clave: string;
  fuente: string;
  resultado: "aplicada" | "rechazada";
  codigo: string | null;
  valor: number | null;
  valor_actual: number | null;
};

export type RespuestaLoteDb = { lote_id: string; repetido: boolean; resumen: ResumenLoteApi; filas: FilaRespuestaLote[] };

/**
 * `aplicar_lote_proyeccion(p)`: UNA llamada, UNA transacción. Un error de la función (SQLSTATE `LP001` a `LP008`, `40P01`) llega en `error.code` y lo traduce
 * `servicio.ts`.
 */
export async function aplicarLoteDb(db: Db, payload: PayloadLote): Promise<Resultado<RespuestaLoteDb | null>> {
  const { data, error } = await db.rpc("aplicar_lote_proyeccion", { p: payload as unknown as Json });
  if (error) return { data: null, error };
  return { data: (data as unknown as RespuestaLoteDb | null) ?? null, error: null };
}

/** Un lote por id (cualquier proyección); `data` es `null` si no existe. */
export async function leerLoteDb(db: Db, id: string): Promise<Resultado<LoteDb | null>> {
  const { data, error } = await db.from("proyeccion_lotes").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/** Los lotes de una proyección, del más reciente al más antiguo (orden estable por `created_at` e `id`), paginados. */
export function leerLotesDeProyeccionDb(db: Db, proyeccionId: string): Promise<Resultado<LoteDb[]>> {
  return leerTodo<LoteDb>((d, h) =>
    db.from("proyeccion_lotes").select("*").eq("proyeccion_id", proyeccionId).order("created_at", { ascending: false }).order("id").range(d, h)
  );
}

/** Los lotes de una confirmación (todas sus tandas) dentro de una proyección, del más antiguo al más reciente. */
export function leerLotesDeConfirmacionDb(db: Db, proyeccionId: string, confirmacionId: string): Promise<Resultado<LoteDb[]>> {
  return leerTodo<LoteDb>((d, h) =>
    db
      .from("proyeccion_lotes")
      .select("*")
      .eq("proyeccion_id", proyeccionId)
      .eq("confirmacion_id", confirmacionId)
      .order("created_at")
      .order("id")
      .range(d, h)
  );
}

/** Los lotes de reversión de un lote (`revierte_lote_id`), para saber cuántas de sus filas ya se devolvieron a la propuesta. */
export function leerReversionesDeLoteDb(db: Db, loteId: string): Promise<Resultado<LoteDb[]>> {
  return leerTodo<LoteDb>((d, h) => db.from("proyeccion_lotes").select("*").eq("revierte_lote_id", loteId).order("created_at").order("id").range(d, h));
}

/** Las filas guardadas de un lote (aplicadas y rechazadas), en un orden estable, paginadas. */
export function leerFilasDeLoteDb(db: Db, loteId: string): Promise<Resultado<LoteFilaDb[]>> {
  return leerTodo<LoteFilaDb>((d, h) =>
    db.from("proyeccion_lote_filas").select("*").eq("lote_id", loteId).order("gm_clave").order("fila_clave").order("anio").order("id").range(d, h)
  );
}
