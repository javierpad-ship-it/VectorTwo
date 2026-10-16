import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { leerTodo } from "@/lib/arbol/consultas";
import { enTandas, TANDA_IN } from "@/lib/arbol/importar";
import { periodoADb } from "@/lib/ventas/periodo";
import type { FilaConAnios, TiendaPyDb } from "./persistencia";
import { TANDA_UPSERT, type ColaLargaApi, type VentaProyeccion } from "./tipos";

/**
 * Acceso a datos de M7 (solo servidor). ÚNICO archivo de `src/` que nombra la función `venta_proyeccion` y que lee o
 * escribe `proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios`, `proyeccion_tiendas` y `factores_volumen_atipico`
 * (ficha 07, sección 7 y regla 44). La venta se lee SOLO con la función `jsonb`, por tandas de nodos (un solo estado de
 * los datos por tanda); nada pagina una vista. Todo lo que puede crecer va paginado con `leerTodo` o en tandas.
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

export type ProyeccionDb = Tables<"proyecciones">;
export type FactorDb = Tables<"factores_volumen_atipico">;

/**
 * Un `upsert` en bloque de PostgREST toma como columnas la UNIÓN de las claves de todos los objetos y a las que falta en alguno
 * las deja en su valor por defecto (`missing=default`): mezclar objetos con claves distintas pisaría con el defecto lo que ya
 * había (una rampa editada, quién decidió). Por eso cada `upsert` agrupa los objetos por su juego exacto de claves.
 */
export function agruparPorColumnas<T extends object>(filas: readonly T[]): T[][] {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const firma = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join("|");
    const g = grupos.get(firma) ?? [];
    g.push(f);
    grupos.set(firma, g);
  }
  return [...grupos.values()];
}

// ─── proyecciones ───

export async function leerProyeccionDb(db: Db, id: string) {
  const { data, error } = await db.from("proyecciones").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

/** Todas las proyecciones, las más recientes primero. */
export function listarProyeccionesDb(db: Db) {
  return leerTodo<ProyeccionDb>((d, h) =>
    db.from("proyecciones").select("*").order("anio_en_curso", { ascending: false }).order("created_at", { ascending: false }).order("id").range(d, h)
  );
}

export async function leerCerradaDeAnio(db: Db, anioEnCurso: number) {
  const { data, error } = await db.from("proyecciones").select("*").eq("anio_en_curso", anioEnCurso).eq("estado", "cerrada").maybeSingle();
  return { data, error };
}

/** Nombres de las proyecciones de un año (para anticipar `nombre_repetido`). */
export async function leerNombresDeAnio(db: Db, anioEnCurso: number) {
  const { data, error } = await db.from("proyecciones").select("id, nombre, estado").eq("anio_en_curso", anioEnCurso);
  return { data: data ?? [], error };
}

export function insertarProyeccionDb(db: Db, fila: TablesInsert<"proyecciones">) {
  return db.from("proyecciones").insert(fila).select("*").single();
}

export function actualizarProyeccionDb(db: Db, id: string, cambio: TablesUpdate<"proyecciones">) {
  return db.from("proyecciones").update(cambio).eq("id", id).select("*").single();
}

/** Borra la proyección (sus filas, registros y tiendas se van por `cascade`). */
export async function eliminarProyeccionDb(db: Db, id: string) {
  const { error } = await db.from("proyecciones").delete().eq("id", id);
  return { error };
}

/**
 * Toma el candado de cálculo (`calculando_desde`) de forma CONDICIONAL al valor que se leyó: si otro `calcular` lo tomó entre
 * la lectura y esta escritura no se toca nada y `data` es `null` (el handler responde `409 calculo_en_curso`).
 */
export async function tomarCalculo(db: Db, id: string, valorLeido: string | null, ahora: string) {
  let consulta = db.from("proyecciones").update({ calculando_desde: ahora }).eq("id", id);
  consulta = valorLeido === null ? consulta.is("calculando_desde", null) : consulta.eq("calculando_desde", valorLeido);
  const { data, error } = await consulta.select("*").maybeSingle();
  return { data, error };
}

/** Suelta el candado SOLO si sigue siendo el que se tomó (si caducó y otro lo tomó, no se lo quita). */
export async function soltarCalculo(db: Db, id: string, valorTomado: string) {
  const { error } = await db.from("proyecciones").update({ calculando_desde: null }).eq("id", id).eq("calculando_desde", valorTomado);
  return { error };
}

/** Otros cálculos en marcha (no caducados) en todo el sistema: solo se admite uno pesado a la vez. */
export async function leerCalculosActivos(db: Db, exceptoId: string | null, limiteIso: string) {
  let c = db.from("proyecciones").select("id, calculando_desde").gt("calculando_desde", limiteIso);
  if (exceptoId !== null) c = c.neq("id", exceptoId);
  const { data, error } = await c;
  return { data: (data ?? []) as { id: string; calculando_desde: string }[], error };
}

/** El guardado final del cálculo: solo si la proyección sigue `en_trabajo` y con el mismo candado; si no, `data` es `null` y no escribe. */
export async function guardarResultadoCalculo(db: Db, id: string, valorTomado: string, cambio: TablesUpdate<"proyecciones">) {
  const { data, error } = await db
    .from("proyecciones")
    .update(cambio)
    .eq("id", id)
    .eq("estado", "en_trabajo")
    .eq("calculando_desde", valorTomado)
    .select("*")
    .maybeSingle();
  return { data, error };
}

/** `calculando_desde` nulo o caducado (anterior a `limiteIso`). */
const sinCalculoVivo = (limiteIso: string) => `calculando_desde.is.null,calculando_desde.lt.${limiteIso}`;

/**
 * Cambio de estado CONDICIONAL (`desde` → `hasta`): si otro usuario ya la movió, `data` es `null`. Con `sinCalculoDesde`
 * exige además que no haya un cálculo vivo (cerrar mientras se calcula no es posible).
 */
export async function cambiarEstadoProyeccion(
  db: Db,
  id: string,
  desde: "en_trabajo" | "cerrada" | "archivada",
  cambio: TablesUpdate<"proyecciones">,
  opciones: { sinCalculoDesde?: string } = {}
) {
  let c = db.from("proyecciones").update(cambio).eq("id", id).eq("estado", desde);
  if (opciones.sinCalculoDesde) c = c.or(sinCalculoVivo(opciones.sinCalculoDesde));
  const { data, error } = await c.select("*").maybeSingle();
  return { data, error };
}

/** Borra solo una proyección `en_trabajo` sin cálculo vivo; `data` es `null` si ya no cumple. */
export async function eliminarProyeccionCondicional(db: Db, id: string, limiteIso: string) {
  const { data, error } = await db.from("proyecciones").delete().eq("id", id).eq("estado", "en_trabajo").or(sinCalculoVivo(limiteIso)).select("id").maybeSingle();
  return { data, error };
}

// ─── Filas con sus años ───

export type ColumnasFilas = "ligeras" | "cerrada" | "previas" | "completas";

/** Sin `historico`: lo que leen `matriz`, `mensual` y el contrato de M8. */
export const COLUMNAS_FILA_LIGERA =
  "id, clave, tienda_id, gml_id, equivalencia_id, agrupacion_marca_id, nivel_proyectado, agrupacion_estacionalidad_id, temporada, avisos, activo";
export const COLUMNAS_ANIO_LIGERA =
  "id, fila_id, anio, bloque, subbloque, vendido, propuesto, metodo, decidido, origen, propuesta_al_decidir, crecimiento_pct, meses, origen_meses, avisos, activo";
const COLUMNAS_FILA: Record<ColumnasFilas, string> = {
  ligeras: COLUMNAS_FILA_LIGERA,
  cerrada: `${COLUMNAS_FILA_LIGERA}, participaciones`,
  previas: "id, clave, tienda_id, gml_id, activo",
  completas: "*",
};
const COLUMNAS_ANIO: Record<ColumnasFilas, string> = {
  ligeras: COLUMNAS_ANIO_LIGERA,
  cerrada: `${COLUMNAS_ANIO_LIGERA}, curva_origen_usada`,
  previas: "*",
  completas: "*",
};

export type OpcionesFilas = {
  columnas?: ColumnasFilas;
  gmlId?: string;
  gmlIds?: readonly string[];
  agrupacionMarcaId?: string;
  /** `null` = solo filas base; un id = solo las filas de esa tienda. */
  tiendaId?: string | null;
  /** Solo las filas de tienda (de cualquier tienda). */
  soloTiendas?: boolean;
  soloActivas?: boolean;
};

/**
 * Las filas de una proyección con sus registros por año, paginadas por fila. Con `columnas: "ligeras"` o `"cerrada"` NUNCA
 * se selecciona `historico` (pesa cientos de KB por línea). El tipo de retorno es el de la fila completa: lo no seleccionado
 * llega `undefined` y quien lo lee elige las columnas que necesita.
 */
export function leerFilasConAnios(db: Db, proyeccionId: string, o: OpcionesFilas = {}): Promise<Resultado<FilaConAnios[]>> {
  const columnas = o.columnas ?? "completas";
  const seleccion = columnas === "completas" ? "*, proyeccion_fila_anios(*)" : `${COLUMNAS_FILA[columnas]}, proyeccion_fila_anios(${COLUMNAS_ANIO[columnas]})`;
  return leerTodo<FilaConAnios>((d, h) => {
    let c = db.from("proyeccion_filas").select(seleccion).eq("proyeccion_id", proyeccionId);
    if (o.gmlId !== undefined) c = c.eq("gml_id", o.gmlId);
    if (o.gmlIds !== undefined) c = c.in("gml_id", [...o.gmlIds]);
    if (o.agrupacionMarcaId !== undefined) c = c.eq("agrupacion_marca_id", o.agrupacionMarcaId);
    if (o.tiendaId === null) c = c.is("tienda_id", null);
    else if (o.tiendaId !== undefined) c = c.eq("tienda_id", o.tiendaId);
    if (o.soloTiendas) c = c.not("tienda_id", "is", null);
    if (o.soloActivas) c = c.eq("activo", true);
    return c.order("clave").order("id").range(d, h) as unknown as PromiseLike<{ data: FilaConAnios[] | null; error: PostgrestError | null }>;
  });
}

/** Una fila con todo (incluido `historico`); `data` es `null` si no existe en esa proyección. */
export async function leerFilaCompleta(db: Db, proyeccionId: string, filaId: string): Promise<Resultado<FilaConAnios | null>> {
  const { data, error } = await db
    .from("proyeccion_filas")
    .select("*, proyeccion_fila_anios(*)")
    .eq("proyeccion_id", proyeccionId)
    .eq("id", filaId)
    .maybeSingle();
  return { data: (data as FilaConAnios | null) ?? null, error };
}

/**
 * `historico.cola_larga` (la validación de disponibilidad) de unas filas por id, sin traer el `historico` entero. Lo usa `cerrar` para
 * decir con qué demanda corregida y qué disponibilidad queda cada fila para revisión.
 */
export async function leerColaLargaDeFilas(db: Db, proyeccionId: string, ids: readonly string[]): Promise<Resultado<Map<string, ColaLargaApi>>> {
  const salida = new Map<string, ColaLargaApi>();
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { data, error } = await db.from("proyeccion_filas").select("id, cola_larga:historico->cola_larga").eq("proyeccion_id", proyeccionId).in("id", tanda);
    if (error) return { data: salida, error };
    for (const f of (data ?? []) as unknown as { id: string; cola_larga: ColaLargaApi | null }[]) if (f.cola_larga) salida.set(f.id, f.cola_larga);
  }
  return { data: salida, error: null };
}

/** `gml_id` y nivel guardado de todas las filas (para detectar `nivel_cambiado`). */
export async function leerNivelesProyectados(db: Db, proyeccionId: string): Promise<Resultado<{ gml_id: string; nivel_proyectado: string }[]>> {
  const r = await leerTodo<{ id: string; gml_id: string; nivel_proyectado: string }>((d, h) =>
    db.from("proyeccion_filas").select("id, gml_id, nivel_proyectado").eq("proyeccion_id", proyeccionId).eq("activo", true).order("id").range(d, h)
  );
  const vistos = new Map<string, string>();
  for (const f of r.data) vistos.set(f.gml_id, f.nivel_proyectado);
  return { data: [...vistos].map(([gml_id, nivel_proyectado]) => ({ gml_id, nivel_proyectado })), error: r.error };
}

/** `upsert` de filas (`onConflict: proyeccion_id,clave`) en tandas; devuelve `clave → id`. */
export async function upsertFilas(db: Db, filas: readonly TablesInsert<"proyeccion_filas">[], tamano = 250): Promise<Resultado<Map<string, string>>> {
  const ids = new Map<string, string>();
  for (const grupo of agruparPorColumnas(filas)) {
    for (const tanda of enTandas(grupo, tamano)) {
      const { data, error } = await db.from("proyeccion_filas").upsert(tanda, { onConflict: "proyeccion_id,clave" }).select("id, clave");
      if (error) return { data: ids, error };
      for (const f of data ?? []) ids.set(f.clave, f.id);
    }
  }
  return { data: ids, error: null };
}

/** Desactiva filas por id (conservan sus decisiones y dejan de contar). */
export async function desactivarFilas(db: Db, ids: readonly string[]): Promise<{ error: PostgrestError | null }> {
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { error } = await db.from("proyeccion_filas").update({ activo: false }).in("id", tanda);
    if (error) return { error };
  }
  return { error: null };
}

export async function upsertAnios(db: Db, filas: readonly TablesInsert<"proyeccion_fila_anios">[]): Promise<{ error: PostgrestError | null }> {
  for (const grupo of agruparPorColumnas(filas)) {
    for (const tanda of enTandas(grupo, TANDA_UPSERT)) {
      const { error } = await db.from("proyeccion_fila_anios").upsert(tanda, { onConflict: "fila_id,anio" });
      if (error) return { error };
    }
  }
  return { error: null };
}

export async function desactivarAnios(db: Db, ids: readonly string[]): Promise<{ error: PostgrestError | null }> {
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { error } = await db.from("proyeccion_fila_anios").update({ activo: false }).in("id", tanda);
    if (error) return { error };
  }
  return { error: null };
}

/** Registros por id con la proyección de su fila (para `aplicar-curva` con `fila_anio_ids`). */
export async function leerAniosPorIds(db: Db, ids: readonly string[]) {
  const salida: (Tables<"proyeccion_fila_anios"> & { proyeccion_filas: { proyeccion_id: string } | null })[] = [];
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { data, error } = await db.from("proyeccion_fila_anios").select("*, proyeccion_filas(proyeccion_id)").in("id", tanda);
    if (error) return { data: salida, error };
    salida.push(...(data ?? []));
  }
  return { data: salida, error: null };
}

export async function actualizarAnio(db: Db, id: string, cambio: TablesUpdate<"proyeccion_fila_anios">) {
  const { error } = await db.from("proyeccion_fila_anios").update(cambio).eq("id", id);
  return { error };
}

// ─── Tiendas de la proyección ───

export function leerTiendasProyeccion(db: Db, proyeccionId: string) {
  return leerTodo<TiendaPyDb>((d, h) => db.from("proyeccion_tiendas").select("*").eq("proyeccion_id", proyeccionId).order("tienda_id").order("anio").range(d, h));
}

export async function upsertTiendasProyeccion(db: Db, filas: readonly TablesInsert<"proyeccion_tiendas">[]) {
  for (const grupo of agruparPorColumnas(filas)) {
    for (const tanda of enTandas(grupo, TANDA_UPSERT)) {
      const { error } = await db.from("proyeccion_tiendas").upsert(tanda, { onConflict: "proyeccion_id,tienda_id,anio" });
      if (error) return { error };
    }
  }
  return { error: null as PostgrestError | null };
}

export async function desactivarTiendasProyeccion(db: Db, ids: readonly string[]) {
  for (const tanda of enTandas([...ids], TANDA_IN)) {
    const { error } = await db.from("proyeccion_tiendas").update({ activo: false }).in("id", tanda);
    if (error) return { error };
  }
  return { error: null as PostgrestError | null };
}

export function actualizarTiendaProyeccion(db: Db, id: string, cambio: TablesUpdate<"proyeccion_tiendas">) {
  return db.from("proyeccion_tiendas").update(cambio).eq("id", id).select("*").single();
}

// ─── Factores del Niño ───

export function leerFactoresDb(db: Db) {
  return leerTodo<FactorDb>((d, h) => db.from("factores_volumen_atipico").select("*").order("anio").order("temporada").range(d, h));
}

export async function upsertFactores(db: Db, filas: readonly TablesInsert<"factores_volumen_atipico">[]) {
  const { error } = await db.from("factores_volumen_atipico").upsert([...filas], { onConflict: "anio,temporada" });
  return { error };
}

// ─── La única lectura de venta ───

/**
 * Una tanda de `venta_proyeccion`: filas por nodo × agrupación de marca × clave de pertenencia × mes, `por_tienda` de las
 * tiendas pedidas, pesos de las equivalencias, `detalle_w12` y `cargas` del mismo estado de los datos.
 */
export async function leerVentaTanda(
  db: Db,
  args: { gmlIds: readonly string[]; grupos: Record<string, string>; tiendasDetalle: readonly string[]; desde: string; desdeW12: string }
): Promise<Resultado<VentaProyeccion | null>> {
  const { data, error } = await db.rpc("venta_proyeccion", {
    p_gml_ids: [...args.gmlIds],
    p_grupos: args.grupos as Json,
    p_tiendas_detalle: [...args.tiendasDetalle],
    p_desde: periodoADb(args.desde),
    p_desde_w12: periodoADb(args.desdeW12),
  });
  if (error) return { data: null, error };
  const v = data as unknown as Partial<VentaProyeccion> | null;
  if (!v || !Array.isArray(v.filas)) return { data: null, error: null };
  return {
    data: {
      filas: v.filas,
      por_tienda: v.por_tienda ?? [],
      equivalencias: v.equivalencias ?? [],
      detalle_w12: v.detalle_w12 ?? [],
      // Una lectura anterior a la migración 0021 no trae `disponibilidad`: llega vacía (toda cola larga queda `sin_dato`).
      disponibilidad: v.disponibilidad ?? [],
      cargas: v.cargas ?? {},
    },
    error: null,
  };
}

// ─── Tiendas de M4 (lectura mínima para el referente) ───

export async function leerTiendaPorId(db: Db, id: string) {
  const { data, error } = await db.from("tiendas").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

// ─── Catálogos mínimos (nombres para la API) ───

export function leerNombresAgrupacionesMarca(db: Db) {
  return leerTodo<{ id: string; nombre: string; orden: number }>((d, h) => db.from("agrupaciones_marca").select("id, nombre, orden").order("orden").order("id").range(d, h));
}

export function leerAgrupacionesEstacionalidadTodas(db: Db) {
  return leerTodo<{ id: string; nombre: string; temporada: string; activo: boolean }>((d, h) =>
    db.from("agrupaciones_estacionalidad").select("id, nombre, temporada, activo").order("id").range(d, h)
  );
}

/** Cargas publicadas con su fecha de publicación (para `cargas_nuevas`). */
export async function leerCargasConFecha(db: Db) {
  const { data, error } = await db
    .from("cargas_venta_stock")
    .select("id, periodo, publicada_at")
    .eq("estado", "publicada")
    .order("periodo")
    .limit(1000);
  return { data: data ?? [], error };
}

/** La identidad de una fila (para buscar las de su misma GML-AM); `data` es `null` si no está en esa proyección. */
export async function leerIdentidadFila(db: Db, proyeccionId: string, filaId: string) {
  const { data, error } = await db
    .from("proyeccion_filas")
    .select("id, gml_id, agrupacion_marca_id, equivalencia_id, tienda_id")
    .eq("proyeccion_id", proyeccionId)
    .eq("id", filaId)
    .maybeSingle();
  return { data, error };
}

/** Reescribe la `composicion` (jsonb) de una fila de tienda: las unidades maduras dependen de la rampa. */
export async function actualizarComposicionFila(db: Db, id: string, composicion: Json) {
  const { error } = await db.from("proyeccion_filas").update({ composicion }).eq("id", id);
  return { error };
}

/** Cambia la rampa de una tienda de la proyección (un año). */
export async function actualizarRampaTienda(db: Db, id: string, rampa: readonly number[]) {
  const { error } = await db.from("proyeccion_tiendas").update({ rampa: [...rampa] }).eq("id", id);
  return { error };
}
