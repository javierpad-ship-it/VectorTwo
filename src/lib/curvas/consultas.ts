import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerLineas, leerNodos, leerTodo } from "@/lib/arbol/consultas";
import { temporadasDeLineasPorAgrupacion } from "@/lib/estacionalidad/reglas";
import { recortarPeriodo } from "@/lib/ventas/periodo";
import { leerAgregado, type AgregadoLeido } from "./agregado";
import { alcanceEspejo, temporadaSugerida, temporadasDePeriodo, temporadaSugeridaVisible } from "./atipicos";
import { huellaComposicion } from "./huellas";
import { temporadaDeFila, type TiendaMaestro, type VentaTiendaMes } from "./tipos";
import {
  PARAMETROS_POR_DEFECTO,
  type CorridaResumenApi,
  type EfectoAtipicoCorrida,
  type ParametrosCurvas,
  type PeriodoAtipicoApi,
  type RedAnio,
  type ResultadoCorrida,
  type ResumenCorrida,
  type TemporadaAgrupacion,
} from "./tipos-api";
import type { AgrupacionLeida } from "./estado";

/**
 * Acceso a datos de M6 (solo servidor). ÚNICO archivo de `src/` que lee o
 * escribe `periodos_atipicos`, `corridas_estacionalidad` y `curvas_estacionalidad`
 * y que nombra la vista materializada del agregado, su función de refresco y
 * lectura y `venta_mensual_tienda`
 * (docs/modulos/06-curvas-estacionalidad.md, "Contratos de API" y regla 31).
 * El agregado se lee SOLO con la función `jsonb` (sin paginar la vista: un
 * refresco concurrente la dejaría a medias).
 */

type Db = SupabaseClient<Database>;

export type PeriodoDb = Tables<"periodos_atipicos">;

/** La fila de la base (fechas `aaaa-mm-01`) como viaja por la API (`aaaa-mm`). */
export function aPeriodoApi(fila: PeriodoDb): PeriodoAtipicoApi {
  const temporadas = temporadasDePeriodo({
    alcance: fila.alcance === "todas" ? "todas" : "invierno",
    temporadas: (fila.temporadas ?? []).map(temporadaDeFila),
  });
  return {
    id: fila.id,
    desde: recortarPeriodo(fila.desde),
    hasta: recortarPeriodo(fila.hasta),
    motivo: fila.motivo,
    descripcion: fila.descripcion,
    temporadas,
    alcance: alcanceEspejo(temporadas),
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

/**
 * Fila de alta de un periodo ya validado (`crearPeriodoAtipicoSchema`): escribe
 * SIEMPRE `temporadas` y su espejo heredado `alcance`.
 */
export function filaDePeriodoNuevo(d: {
  desde: string;
  hasta: string;
  motivo: string;
  descripcion?: string | null;
  temporadas: TemporadaAgrupacion[];
  alcance: PeriodoAtipicoApi["alcance"];
}): TablesInsert<"periodos_atipicos"> {
  return {
    desde: `${d.desde}-01`,
    hasta: `${d.hasta}-01`,
    motivo: d.motivo,
    descripcion: d.descripcion ?? null,
    temporadas: d.temporadas,
    alcance: d.alcance,
  };
}

/** Cambio de un periodo ya validado (`editarPeriodoAtipicoSchema`); con `temporadas` o `alcance` el esquema trae los dos. */
export function cambioDePeriodo(d: {
  desde?: string;
  hasta?: string;
  motivo?: string;
  descripcion?: string | null;
  temporadas?: TemporadaAgrupacion[];
  alcance?: PeriodoAtipicoApi["alcance"];
  activo?: boolean;
}): TablesUpdate<"periodos_atipicos"> {
  const cambio: TablesUpdate<"periodos_atipicos"> = {};
  if (d.desde !== undefined) cambio.desde = `${d.desde}-01`;
  if (d.hasta !== undefined) cambio.hasta = `${d.hasta}-01`;
  if (d.motivo !== undefined) cambio.motivo = d.motivo;
  if (d.descripcion !== undefined) cambio.descripcion = d.descripcion;
  if (d.temporadas !== undefined) cambio.temporadas = d.temporadas;
  if (d.alcance !== undefined) cambio.alcance = d.alcance;
  if (d.activo !== undefined) cambio.activo = d.activo;
  return cambio;
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

// ═══════════════════════════════════════════════════════════════════════════
// Paso 2
// ═══════════════════════════════════════════════════════════════════════════

// ─── Agregado (la única lectura de la vista materializada) ───

/**
 * Refresca la vista materializada y devuelve su grano agrupación × tienda × mes en
 * UNA sola llamada atómica, bajo lock de aviso: si otro cálculo está refrescando,
 * el error es `55P03` / `calculo_en_curso` (el handler lo traduce a `409`).
 * `data` es `null` si la respuesta no tiene la forma esperada.
 */
export async function refrescarYLeerAgregado(db: Db): Promise<{ data: AgregadoLeido | null; error: PostgrestError | null }> {
  const { data, error } = await db.rpc("refrescar_y_leer_agregado_estacionalidad");
  if (error) return { data: null, error };
  return { data: leerAgregado(data), error: null };
}

// ─── Tiendas, venta por tienda y cargas ───

export async function leerTiendas(db: Db): Promise<{ data: TiendaMaestro[]; error: PostgrestError | null }> {
  const { data, error } = await leerTodo<Tables<"tiendas">>((d, h) => db.from("tiendas").select("*").order("id").range(d, h));
  return {
    data: data.map((t) => ({
      id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      tipo: t.tipo,
      activo: t.activo,
      fecha_apertura: t.fecha_apertura,
      fecha_cierre: t.fecha_cierre,
    })),
    error,
  };
}

/** Venta total por tienda y mes (`venta_mensual_tienda()`, del orden de 500 filas): la red comparable sin corrida y la obsolescencia por red. */
export async function leerVentaMensualTienda(db: Db): Promise<{ data: VentaTiendaMes[]; error: PostgrestError | null }> {
  const { data, error } = await leerTodo<{ periodo: string; tienda_id: string; unidades: number }>((d, h) =>
    db.rpc("venta_mensual_tienda").range(d, h)
  );
  return { data: data.map((v) => ({ tienda_id: v.tienda_id, periodo: recortarPeriodo(v.periodo), unidades: Number(v.unidades) })), error };
}

/** `{ "aaaa-mm": carga_id }` de los meses con carga `publicada` (a lo sumo una por mes: unas 50 filas). */
export async function leerCargasPublicadas(db: Db): Promise<{ data: Record<string, string>; error: PostgrestError | null }> {
  const { data, error } = await db
    .from("cargas_venta_stock")
    .select("id, periodo")
    .eq("estado", "publicada")
    .order("periodo")
    .limit(1000);
  const cargas: Record<string, string> = {};
  for (const c of data ?? []) cargas[recortarPeriodo(c.periodo)] = c.id;
  return { data: cargas, error };
}

// ─── Agrupaciones con lo que necesita M6 ───

export type AgrupacionConDatos = AgrupacionLeida & {
  /** md5 de los ids de sus equivalencias activas. */
  huella: string;
  /** Sugerida cruda de M3 (`todo_el_ano` si las líneas no informan). */
  temporada_sugerida_cruda: TemporadaAgrupacion;
  /** Sus equivalencias activas son de líneas de más de una temporada. */
  temporadas_mezcladas: boolean;
};

/** Agrupaciones (activas o todas) con géneros, equivalencias activas, huella y temporada sugerida. */
export async function leerAgrupacionesConDatos(
  db: Db,
  opciones: { soloActivas: boolean }
): Promise<{ data: AgrupacionConDatos[]; error: PostgrestError | null }> {
  const [filas, equivalencias, vinculos, generos, nodos, lineas] = await Promise.all([
    leerTodo<Tables<"agrupaciones_estacionalidad">>((d, h) => {
      let q = db.from("agrupaciones_estacionalidad").select("*");
      if (opciones.soloActivas) q = q.eq("activo", true);
      return q.order("orden").order("nombre").order("id").range(d, h);
    }),
    leerTodo<{ id: string; agrupacion_estacionalidad_id: string | null; activo: boolean; genero_mundo_linea_id: string }>((d, h) =>
      db
        .from("equivalencias")
        .select("id, agrupacion_estacionalidad_id, activo, genero_mundo_linea_id")
        .not("agrupacion_estacionalidad_id", "is", null)
        .eq("activo", true)
        .order("id")
        .range(d, h)
    ),
    leerTodo<{ agrupacion_estacionalidad_id: string; genero_id: string }>((d, h) =>
      db.from("agrupacion_estacionalidad_genero").select("id, agrupacion_estacionalidad_id, genero_id").order("id").range(d, h)
    ),
    leerTodo<{ id: string; nombre: string; orden: number }>((d, h) => db.from("generos").select("id, nombre, orden").order("orden").order("id").range(d, h)),
    leerNodos(db),
    leerLineas(db),
  ]);
  const fallo = filas.error ?? equivalencias.error ?? vinculos.error ?? generos.error ?? nodos.error ?? lineas.error;
  if (fallo) return { data: [], error: fallo };

  const idsPorAgrupacion = new Map<string, string[]>();
  for (const e of equivalencias.data) {
    if (e.agrupacion_estacionalidad_id === null) continue;
    const lista = idsPorAgrupacion.get(e.agrupacion_estacionalidad_id) ?? [];
    lista.push(e.id);
    idsPorAgrupacion.set(e.agrupacion_estacionalidad_id, lista);
  }
  const nombreGenero = new Map(generos.data.map((g) => [g.id, g.nombre]));
  const generosPorAgrupacion = new Map<string, string[]>();
  for (const v of vinculos.data) {
    const nombre = nombreGenero.get(v.genero_id);
    if (!nombre) continue;
    const lista = generosPorAgrupacion.get(v.agrupacion_estacionalidad_id) ?? [];
    lista.push(nombre);
    generosPorAgrupacion.set(v.agrupacion_estacionalidad_id, lista);
  }
  const lineasPorAgrupacion = temporadasDeLineasPorAgrupacion(equivalencias.data, nodos.data, lineas.data);

  return {
    data: filas.data.map((a) => {
      const ids = idsPorAgrupacion.get(a.id) ?? [];
      const delasLineas = lineasPorAgrupacion.get(a.id) ?? [];
      const sugerida = temporadaSugerida(delasLineas);
      return {
        id: a.id,
        nombre: a.nombre,
        codigo: a.codigo,
        activo: a.activo,
        orden: a.orden,
        temporada: temporadaDeFila(a.temporada),
        temporada_sugerida: temporadaSugeridaVisible(sugerida),
        temporada_sugerida_cruda: sugerida,
        generos: [...(generosPorAgrupacion.get(a.id) ?? [])].sort((x, y) => x.localeCompare(y, "es")),
        equivalencias_activas: ids.length,
        huella: huellaComposicion(ids),
        temporadas_mezcladas: new Set(delasLineas).size > 1,
      };
    }),
    error: null,
  };
}

/** `data` es `null` si la agrupación no existe (activa o no). */
export async function leerAgrupacionPorId(db: Db, id: string) {
  const { data, error } = await db.from("agrupaciones_estacionalidad").select("id, nombre, codigo, activo, temporada").eq("id", id).maybeSingle();
  return { data, error };
}

// ─── Corridas ───

export type CorridaFila = Tables<"corridas_estacionalidad">;

const COLUMNAS_CORRIDA_RESUMEN = "id, created_at, hasta_periodo, referencia, parametros, resumen, usuario_nombre";

/** `parametros` guardados → `ParametrosCurvas` (lo que falte o no sea del tipo esperado toma el valor por defecto). */
export function leerParametros(json: Json): ParametrosCurvas {
  const o = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const salida: Record<string, unknown> = { ...PARAMETROS_POR_DEFECTO };
  for (const [clave, defecto] of Object.entries(PARAMETROS_POR_DEFECTO)) {
    const valor = (o as Record<string, Json | undefined>)[clave];
    if (typeof valor === typeof defecto) salida[clave] = valor;
  }
  return salida as ParametrosCurvas;
}

/**
 * `jsonb` guardado por este mismo código → su tipo. Es el único lugar donde se
 * afirma la forma: lo escribe `calcular` con estos mismos tipos.
 */
export const comoResultado = (json: Json) => json as unknown as ResultadoCorrida;
export const comoEfecto = (json: Json) => json as unknown as EfectoAtipicoCorrida;
export const comoRed = (json: Json) => json as unknown as RedAnio[];
export const comoResumen = (json: Json) => json as unknown as ResumenCorrida;

type FilaResumenCorrida = Pick<CorridaFila, "id" | "created_at" | "hasta_periodo" | "referencia" | "parametros" | "resumen" | "usuario_nombre">;

export function aCorridaResumen(fila: FilaResumenCorrida): CorridaResumenApi {
  return {
    id: fila.id,
    created_at: fila.created_at,
    hasta_periodo: recortarPeriodo(fila.hasta_periodo),
    referencia: fila.referencia,
    parametros: leerParametros(fila.parametros),
    resumen: comoResumen(fila.resumen),
    usuario_nombre: fila.usuario_nombre,
  };
}

/** Las últimas `limite` corridas SIN `resultado` (por fecha descendente). */
export async function leerCorridasLista(db: Db, limite: number) {
  const { data, error } = await db
    .from("corridas_estacionalidad")
    .select(COLUMNAS_CORRIDA_RESUMEN)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  return { data: data ?? [], error };
}

/** Todos los campos de una corrida; `data` es `null` si no existe. */
export async function leerCorridaPorId(db: Db, id: string) {
  const { data, error } = await db.from("corridas_estacionalidad").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

export async function leerCorridasPorIds(db: Db, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as CorridaFila[], error: null };
  const { data, error } = await db.from("corridas_estacionalidad").select("*").in("id", [...ids]);
  return { data: data ?? [], error };
}

/** La corrida marcada como referencia (completa); `null` si no hay ninguna marcada. */
export async function leerCorridaReferencia(db: Db) {
  const { data, error } = await db.from("corridas_estacionalidad").select("*").eq("referencia", true).maybeSingle();
  return { data, error };
}

/** La corrida más reciente (completa); `null` si no hay corridas. */
export async function leerUltimaCorrida(db: Db) {
  const { data, error } = await db
    .from("corridas_estacionalidad")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

/** `id`, fecha y marca de todas las corridas (para decidir cuál es la de referencia; son pocas). */
export async function leerMarcasDeCorridas(db: Db) {
  const { data, error } = await leerTodo<Pick<CorridaFila, "id" | "created_at" | "referencia">>((d, h) =>
    db.from("corridas_estacionalidad").select("id, created_at, referencia").order("created_at").order("id").range(d, h)
  );
  return { data, error };
}

export async function insertarCorrida(db: Db, fila: TablesInsert<"corridas_estacionalidad">) {
  return db.from("corridas_estacionalidad").insert(fila).select("*").single();
}

/** Quita la marca de referencia a las demás corridas (a lo sumo una la tiene). */
export async function quitarReferencia(db: Db, exceptoId?: string) {
  let q = db.from("corridas_estacionalidad").update({ referencia: false }).eq("referencia", true);
  if (exceptoId) q = q.neq("id", exceptoId);
  return q;
}

export async function marcarReferencia(db: Db, id: string) {
  return db.from("corridas_estacionalidad").update({ referencia: true }).eq("id", id).select(COLUMNAS_CORRIDA_RESUMEN).maybeSingle();
}

// ─── Curvas ───

export type CurvaFila = Tables<"curvas_estacionalidad">;

/** Todas las curvas `vigente` (una por agrupación como mucho). */
export async function leerCurvasVigentes(db: Db) {
  const { data, error } = await leerTodo<CurvaFila>((d, h) =>
    db.from("curvas_estacionalidad").select("*").eq("estado", "vigente").order("agrupacion_estacionalidad_id").order("id").range(d, h)
  );
  return { data, error };
}

export async function leerCurvaVigente(db: Db, agrupacionId: string) {
  const { data, error } = await db
    .from("curvas_estacionalidad")
    .select("*")
    .eq("agrupacion_estacionalidad_id", agrupacionId)
    .eq("estado", "vigente")
    .maybeSingle();
  return { data, error };
}

/** Mayor `version` ya usada por la agrupación (0 si no tiene curvas). */
export async function leerUltimaVersion(db: Db, agrupacionId: string): Promise<{ data: number; error: PostgrestError | null }> {
  const { data, error } = await db
    .from("curvas_estacionalidad")
    .select("version")
    .eq("agrupacion_estacionalidad_id", agrupacionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data: data?.version ?? 0, error };
}

export async function cambiarEstadoCurva(db: Db, id: string, estado: "vigente" | "reemplazada" | "retirada") {
  return db.from("curvas_estacionalidad").update({ estado }).eq("id", id).select("*").maybeSingle();
}

export async function insertarCurva(db: Db, fila: TablesInsert<"curvas_estacionalidad">) {
  return db.from("curvas_estacionalidad").insert(fila).select("*").single();
}
