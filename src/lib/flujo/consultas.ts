import "server-only";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { leerEquivalencias, leerTodo } from "@/lib/arbol/consultas";
import { cargarEstadoGml, type EstadoGmlCargado } from "@/lib/marcas/gml/estado";
import { leerAsignaciones, leerPerfiles } from "@/lib/responsables/consultas";
import {
  DESTINOS_COMPRA,
  ESTADOS_COMPRA,
  ORIGENES_COMPRA,
  ORIGENES_ENTREGA,
  ORIGENES_RECEPCION,
  TALLAS_COMPRA,
  TIPOS_LINEA,
  type CompraRegistro,
  type EntregaRegistro,
  type LineaRegistro,
  type RecepcionRegistro,
  type RepartoRegistro,
} from "@/lib/compras/tipos";
import type { RegistrosCompras } from "./modelo";
import type { HuellaBaseJson, StockFlujoJson } from "./tipos";

/**
 * Acceso a datos del flujo de M8 (solo servidor). ÚNICO archivo de `src/lib/flujo/` que habla con Supabase (ficha 08, regla 21): las
 * dos funciones de lectura de `0025` (`flujo_huella_base` y `stock_flujo`), `flujo_parametros` (una fila, `upsert`) y las tablas de
 * compras SOLO PARA LEER, con columnas mínimas y solo las compras que cuentan (`confirmada` y `recibida`). Nada aquí escribe una
 * tabla de compras (la API solo escribe compras con las funciones `rpc` de `src/lib/compras/consultas.ts`). Todo lo que puede crecer
 * va con `leerTodo` y orden estable (PostgREST corta en 1 000 filas).
 */

type Db = SupabaseClient<Database>;
type Resultado<T> = { data: T; error: PostgrestError | null };

const esObjeto = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const numero = (x: unknown, defecto = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x !== "" && Number.isFinite(Number(x)) ? Number(x) : defecto);
const texto = (x: unknown): string | null => (typeof x === "string" ? x : null);
const mesDe = (fecha: string): string => fecha.slice(0, 7);

function elegir<T extends string>(permitidos: readonly T[], valor: unknown, defecto: T): T {
  return typeof valor === "string" && (permitidos as readonly string[]).includes(valor) ? (valor as T) : defecto;
}

// ─── Funciones de lectura de 0025 ───

const conteoMaximo = (x: unknown): [number, string | null] => {
  const a = lista(x);
  return [numero(a[0]), texto(a[1])];
};

/** Normaliza lo que devuelve `flujo_huella_base()`: lo que falte toma un valor neutro (la huella solo se usa para comparar). */
export function comoHuellaBase(json: unknown): HuellaBaseJson {
  const o = esObjeto(json) ? json : {};
  const compras = esObjeto(o.compras) ? o.compras : {};
  const repartos = esObjeto(o.repartos) ? o.repartos : {};
  const reglas = esObjeto(o.reglas) ? o.reglas : {};
  const config = esObjeto(o.config) ? o.config : {};
  return {
    cargas: lista(o.cargas)
      .filter(esObjeto)
      .map((c) => ({ periodo: mesDe(String(c.periodo ?? "")), carga_id: String(c.carga_id ?? ""), publicada_at: String(c.publicada_at ?? "") })),
    cerradas: lista(o.cerradas)
      .filter(esObjeto)
      .map((c) => ({ id: String(c.id ?? ""), anio_en_curso: numero(c.anio_en_curso), updated_at: String(c.updated_at ?? "") })),
    compras: { eventos: numero(compras.eventos), ultimo: texto(compras.ultimo), revision: numero(compras.revision), actualizada: texto(compras.actualizada) },
    parametros: texto(o.parametros),
    repartos: { vigentes: numero(repartos.vigentes), ultima: texto(repartos.ultima) },
    reglas: { n: numero(reglas.n), ultima: texto(reglas.ultima) },
    config: {
      marcas: conteoMaximo(config.marcas),
      marca_gml_especial: conteoMaximo(config.marca_gml_especial),
      agrupaciones_marca: conteoMaximo(config.agrupaciones_marca),
      genero_mundo_linea: conteoMaximo(config.genero_mundo_linea),
      equivalencias: conteoMaximo(config.equivalencias),
      tiendas: conteoMaximo(config.tiendas),
      responsables_genero_mundo: conteoMaximo(config.responsables_genero_mundo),
    },
  };
}

/** `flujo_huella_base()`: una sola llamada barata (≤ 0,15 s) que dice si algo de lo que usa el flujo cambió. Se llama en cada `GET`. */
export async function leerHuellaBase(db: Db): Promise<Resultado<HuellaBaseJson | null>> {
  const { data, error } = await db.rpc("flujo_huella_base");
  if (error) return { data: null, error };
  return { data: comoHuellaBase(data), error: null };
}

/** `stock_flujo(carga_id)`: el stock y la venta de UN mes publicado por `(equivalencia, unidad de marca)`, sin talla. */
export async function leerStockFlujo(db: Db, cargaId: string): Promise<Resultado<StockFlujoJson | null>> {
  const { data, error } = await db.rpc("stock_flujo", { p_carga_id: cargaId });
  if (error) return { data: null, error };
  const o = esObjeto(data) ? data : {};
  const excluido = esObjeto(o.excluido) ? o.excluido : {};
  return {
    data: {
      carga_id: String(o.carga_id ?? cargaId),
      periodo: String(o.periodo ?? ""),
      publicada: o.publicada === true,
      equivalencias: lista(o.equivalencias).map(String),
      marcas: lista(o.marcas).map(String),
      filas: lista(o.filas).map((f) => {
        const a = lista(f);
        return [numero(a[0]), numero(a[1]), numero(a[2]), numero(a[3]), numero(a[4]), numero(a[5]), numero(a[6])] as [number, number, number, number, number, number, number];
      }),
      excluido: { stock: numero(excluido.stock), unidades: numero(excluido.unidades) },
    },
    error: null,
  };
}

// ─── Parámetros (una fila) ───

export type ParametrosDb = Tables<"flujo_parametros">;

/** La fila única de `flujo_parametros` (`clave = 'global'`); `null` si todavía no se guardó nada (la API toma los valores por defecto). */
export async function leerParametrosDb(db: Db): Promise<Resultado<ParametrosDb | null>> {
  const { data, error } = await db.from("flujo_parametros").select("*").eq("clave", "global").maybeSingle();
  return { data: data ?? null, error };
}

/** Solo las temporadas (las lee M12 al armar su contexto); `null` si no hay fila. */
export async function leerTemporadasDb(db: Db): Promise<Resultado<Json | null>> {
  const { data, error } = await db.from("flujo_parametros").select("temporadas").eq("clave", "global").maybeSingle();
  return { data: data?.temporadas ?? null, error };
}

export type ParametrosAGuardar = {
  imi_min: number;
  imi_max: number;
  meses_tarjeta: number;
  extender_horizonte: boolean;
  temporadas: Json;
  umbral_conciliacion_u: number;
  umbral_conciliacion_pct: number;
  perfil_id: string | null;
  usuario_nombre: string | null;
};

/** `flujo_parametros` es un `upsert` de una fila (`clave = 'global'`): la única escritura de este archivo. */
export async function guardarParametrosDb(db: Db, p: ParametrosAGuardar): Promise<Resultado<ParametrosDb | null>> {
  const { data, error } = await db
    .from("flujo_parametros")
    .upsert({ clave: "global", activo: true, ...p }, { onConflict: "clave" })
    .select("*")
    .single();
  return { data: data ?? null, error };
}

// ─── Configuración de 02b y responsables ───

export type ConfiguracionLeida = {
  gml: EstadoGmlCargado;
  equivalencias: Tables<"equivalencias">[];
  asignaciones: { genero_id: string; mundo_id: string; perfil_id: string }[];
  perfiles: Map<string, string>;
};

/** Marcas, agrupaciones y árbol de 02b, equivalencias y responsables género × mundo con el nombre del perfil. */
export async function leerConfiguracion(db: Db): Promise<{ data: ConfiguracionLeida | null; error: PostgrestError | null }> {
  const [gml, equivalencias, asignaciones, perfiles] = await Promise.all([cargarEstadoGml(db), leerEquivalencias(db), leerAsignaciones(db), leerPerfiles(db)]);
  const fallo = gml.error ?? equivalencias.error ?? asignaciones.error ?? perfiles.error;
  if (fallo || !gml.estado) return { data: null, error: (fallo ?? null) as PostgrestError | null };
  return {
    data: {
      gml: gml as EstadoGmlCargado,
      equivalencias: equivalencias.data,
      asignaciones: asignaciones.data.filter((a) => a.activo).map((a) => ({ genero_id: a.genero_id, mundo_id: a.mundo_id, perfil_id: a.perfil_id })),
      perfiles: new Map(perfiles.data.map((p) => [p.id, p.nombre ?? p.email ?? "—"])),
    },
    error: null,
  };
}

// ─── Compras (SOLO LECTURA) ───

/**
 * Registros planos de las compras que cuentan (`confirmada` y `recibida`) con sus líneas activas, entregas, repartos y recepciones,
 * en la forma que consumen las funciones puras (meses `aaaa-mm`). Orden estable por `id`. Los borradores y las canceladas sin
 * recepciones no se leen: aportan 0 al flujo.
 */
export async function leerRegistrosCompras(db: Db): Promise<{ data: RegistrosCompras | null; error: PostgrestError | null }> {
  const [compras, proveedores, lineas, entregas, repartos, recepciones] = await Promise.all([
    leerTodo<Pick<Tables<"compras">, "id" | "numero" | "proveedor_id" | "origen" | "estado" | "fecha_compra" | "moneda" | "cancelada_at" | "revision">>((d, h) =>
      db
        .from("compras")
        .select("id, numero, proveedor_id, origen, estado, fecha_compra, moneda, cancelada_at, revision")
        .in("estado", ["confirmada", "recibida"])
        .order("id")
        .range(d, h)
    ),
    leerTodo<Pick<Tables<"proveedores">, "id" | "nombre">>((d, h) => db.from("proveedores").select("id, nombre").order("id").range(d, h)),
    leerTodo<Tables<"compra_lineas">>((d, h) => db.from("compra_lineas").select("*").eq("activo", true).order("id").range(d, h)),
    leerTodo<Tables<"compra_linea_entregas">>((d, h) => db.from("compra_linea_entregas").select("*").order("id").range(d, h)),
    leerTodo<Tables<"compra_linea_repartos">>((d, h) => db.from("compra_linea_repartos").select("*").order("id").range(d, h)),
    leerTodo<Tables<"compra_linea_recepciones">>((d, h) => db.from("compra_linea_recepciones").select("*").order("id").range(d, h)),
  ]);
  const fallo = compras.error ?? proveedores.error ?? lineas.error ?? entregas.error ?? repartos.error ?? recepciones.error;
  if (fallo) return { data: null, error: fallo };

  const nombreProveedor = new Map(proveedores.data.map((p) => [p.id, p.nombre]));
  const registrosCompra: CompraRegistro[] = compras.data.map((c) => ({
    id: c.id,
    numero: c.numero,
    proveedor_id: c.proveedor_id,
    proveedor_nombre: nombreProveedor.get(c.proveedor_id) ?? "—",
    origen: elegir(ORIGENES_COMPRA, c.origen, "comprador"),
    estado: elegir(ESTADOS_COMPRA, c.estado, "confirmada"),
    fecha_compra: c.fecha_compra,
    moneda: c.moneda === "USD" ? "USD" : "PEN",
    cancelada_at: c.cancelada_at,
    revision: c.revision,
  }));
  const idsCompra = new Set(registrosCompra.map((c) => c.id));

  const registrosLinea: LineaRegistro[] = lineas.data
    .filter((l) => idsCompra.has(l.compra_id))
    .map((l) => {
      const alcance = esObjeto(l.alcance) ? l.alcance : {};
      const ids = (x: unknown): string[] | undefined => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : undefined);
      return {
        id: l.id,
        compra_id: l.compra_id,
        tipo: elegir(TIPOS_LINEA, l.tipo, "especifica"),
        genero_mundo_linea_id: l.genero_mundo_linea_id,
        equivalencia_id: l.equivalencia_id,
        marca_id: l.marca_id,
        agrupacion_marca_id: l.agrupacion_marca_id,
        tallas: elegir(TALLAS_COMPRA, l.tallas, "ambas"),
        unidades: l.unidades,
        unidades_recibidas: l.unidades_recibidas,
        unidades_canceladas: l.unidades_canceladas,
        costo_unitario: l.costo_unitario === null ? null : Number(l.costo_unitario),
        destino: elegir(DESTINOS_COMPRA, l.destino, "cd"),
        tienda_id: l.tienda_id,
        alcance: { generos: ids(alcance.generos), mundos: ids(alcance.mundos), lineas: ids(alcance.lineas) },
        activo: l.activo,
      };
    });
  const idsLinea = new Set(registrosLinea.map((l) => l.id));

  const registrosEntrega: EntregaRegistro[] = entregas.data
    .filter((e) => idsLinea.has(e.linea_id))
    .map((e) => ({ id: e.id, linea_id: e.linea_id, periodo: mesDe(e.periodo), unidades: e.unidades, origen: elegir(ORIGENES_ENTREGA, e.origen, "manual") }));
  const registrosReparto: RepartoRegistro[] = repartos.data
    .filter((r) => idsLinea.has(r.linea_id))
    .map((r) => ({
      linea_id: r.linea_id,
      entrega_id: r.entrega_id,
      marca_id: r.marca_id,
      genero_mundo_linea_id: r.genero_mundo_linea_id,
      equivalencia_id: r.equivalencia_id,
      unidades: r.unidades,
      reparto_id: r.reparto_id,
      reparto_version: r.reparto_version,
      temporada: r.temporada,
      error_reparto_pp: r.error_reparto_pp === null ? null : Number(r.error_reparto_pp),
    }));
  const registrosRecepcion: RecepcionRegistro[] = recepciones.data
    .filter((r) => idsLinea.has(r.linea_id))
    .map((r) => ({
      id: r.id,
      linea_id: r.linea_id,
      recibida_periodo: mesDe(r.recibida_periodo),
      unidades: r.unidades,
      fecha_recepcion: r.fecha_recepcion,
      origen: elegir(ORIGENES_RECEPCION, r.origen, "manual"),
    }));

  return { data: { compras: registrosCompra, lineas: registrosLinea, entregas: registrosEntrega, repartos: registrosReparto, recepciones: registrosRecepcion }, error: null };
}
