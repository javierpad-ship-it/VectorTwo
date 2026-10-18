import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { cargarEstadoNivel } from "@/lib/arbol/nivel/consultas";
import { leerEquivalencias } from "@/lib/arbol/consultas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { hastaPorDefecto } from "@/lib/curvas/anios";
import { aniosAtipicidad, type PeriodoParaClase } from "@/lib/curvas/atipicos";
import {
  aPeriodoApi,
  leerAgrupacionesActivasBasicas,
  leerAgrupacionesConDatos,
  leerCargasPublicadas,
  leerCorridaPorId,
  leerCurvasVigentes,
  leerPeriodos,
  leerTiendas as leerTiendasMaestro,
  leerVentaMensualTienda,
  type CurvaFila,
} from "@/lib/curvas/consultas";
import { leerObsolescencia } from "@/lib/curvas/lectura";
import { curvaDeFila } from "@/lib/curvas/reglas";
import { estadoGlobalActual } from "@/lib/curvas/trabajo";
import type { PeriodoAtipicoApi } from "@/lib/curvas/tipos-api";
import { cargarEstadoGml, type EstadoGmlCargado } from "@/lib/marcas/gml/estado";
import { construirConfigFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { leerTiendas } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { huellaFlujo } from "@/lib/marcas-barrer/huellas";
import { ultimoMesCerrado } from "@/lib/ventas/periodo";
import type { TiendaProy } from "./bloques";
import { generosDeMatriz } from "./crecimientos";
import type { Catalogo, NombresNodo } from "./persistencia";
import type { AgrupacionProy, CurvaVigenteProy } from "./curva-fila";
import {
  leerAgrupacionesEstacionalidadTodas,
  leerCargasConFecha,
  leerFactoresDb,
  leerNombresAgrupacionesMarca,
  type FactorDb,
} from "./consultas";
import type { EstadoActual } from "./desactualizado";
import { factorDe, type FactorProy } from "./nino";
import type { NodoProy } from "./tipos";

/**
 * Lo que el servicio de M7 lee de los demás módulos (M1 a M6) y arma en la forma que el método necesita. Solo servidor.
 * Cada lector devuelve `{ data, respuesta }`: o los datos, o la respuesta HTTP con la que cortar (errores de la base ya
 * traducidos).
 */

type Db = SupabaseClient<Database>;
export type Leido<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };
const listo = <T>(data: T): Leido<T> => ({ data, respuesta: null });
const falla = (respuesta: NextResponse): Leido<never> => ({ data: null, respuesta });

// ─── Catálogo de nombres ───

/** Géneros, mundos, líneas, equivalencias y agrupaciones con sus nombres (todo, activo o no: son para mostrar). */
export async function cargarCatalogo(
  db: Db
): Promise<Leido<{ catalogo: Catalogo; equivalencias: Tables<"equivalencias">[]; nodosDb: Tables<"genero_mundo_linea">[]; generos: { id: string; nombre: string; activo: boolean }[] }>> {
  const [nivel, equivalencias, marcas, estacionalidad] = await Promise.all([
    cargarEstadoNivel(db),
    leerEquivalencias(db),
    leerNombresAgrupacionesMarca(db),
    leerAgrupacionesEstacionalidadTodas(db),
  ]);
  const fallo = nivel.error ?? equivalencias.error ?? marcas.error ?? estacionalidad.error;
  if (fallo || !nivel.estado) return falla(traducirErrorDb(fallo as NonNullable<typeof fallo>, "proyección: leer catálogos"));
  const e = nivel.estado;
  const generos = new Map(e.generos.map((g) => [g.id, g.nombre]));
  const mundos = new Map(e.mundos.map((m) => [m.id, m.nombre]));
  const lineas = new Map(e.lineas.map((l) => [l.id, l.nombre]));
  const eqPorNodo = new Map<string, Map<string, string>>();
  for (const q of equivalencias.data) {
    const m = eqPorNodo.get(q.genero_mundo_linea_id) ?? new Map<string, string>();
    m.set(q.id, q.nombre);
    eqPorNodo.set(q.genero_mundo_linea_id, m);
  }
  const nodos = new Map<string, NombresNodo>();
  for (const n of e.nodos) {
    nodos.set(n.id, {
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      genero: generos.get(n.genero_id) ?? "—",
      mundo: mundos.get(n.mundo_id) ?? "—",
      linea: lineas.get(n.linea_id) ?? "—",
      equivalencias: eqPorNodo.get(n.id) ?? new Map(),
    });
  }
  return listo({
    catalogo: {
      nodos,
      agrupacionesMarca: new Map(marcas.data.map((a) => [a.id, a.nombre])),
      ordenAgrupacionesMarca: new Map(marcas.data.map((a) => [a.id, a.orden])),
      agrupacionesEstacionalidad: new Map(estacionalidad.data.map((a) => [a.id, { nombre: a.nombre, temporada: a.temporada }])),
    },
    equivalencias: equivalencias.data,
    nodosDb: e.nodos as unknown as Tables<"genero_mundo_linea">[],
    generos: e.generos.map((g) => ({ id: g.id, nombre: g.nombre, activo: g.activo })),
  });
}

// ─── Tiendas ───

export function aTiendaProy(t: Tables<"tiendas">): TiendaProy {
  return {
    id: t.id,
    codigo: t.codigo,
    nombre: t.nombre,
    tipo: t.tipo,
    activo: t.activo,
    fecha_apertura: t.fecha_apertura,
    fecha_cierre: t.fecha_cierre,
    zona: t.zona,
    venta_esperada: t.venta_esperada_promedio === null ? null : Number(t.venta_esperada_promedio),
    referente_id: t.tienda_referencia_id,
  };
}

// ─── Curvas vigentes (con el EAT del backtesting de M6 dejando un año fuera) ───

type CandidataConPliegues = { modelo?: string; eat_por_pliegue?: { anio: number; eat: number; error_max?: number }[] };

/**
 * `curvas_estacionalidad` vigentes → lo que el método necesita. El `eat_por_pliegue` del año `Y−1` sale de la foto con la que se
 * aprobó cada curva (la candidata del modelo elegido); si la foto no lo trae, queda sin backtesting.
 */
export async function leerVigentesProy(db: Db, conEat = true): Promise<Leido<{ filas: CurvaFila[]; vigentes: CurvaVigenteProy[] }>> {
  const r = await leerCurvasVigentes(db);
  if (r.error) return falla(traducirErrorDb(r.error, "proyección: leer curvas vigentes"));
  const eat = new Map<string, CandidataConPliegues["eat_por_pliegue"]>();
  if (conEat && r.data.length > 0) {
    // Una lectura por foto (≈ una por agrupación; M6 es el único lector de `corridas_estacionalidad`). Si una falla, esa curva queda sin backtesting.
    const fotos = await Promise.all([...new Set(r.data.map((v) => v.corrida_id))].map((id) => leerCorridaPorId(db, id)));
    {
      const porFoto = new Map(fotos.filter((f) => !f.error && f.data).map((f) => [f.data!.id, f.data!.resultado]));
      for (const v of r.data) {
        const res = porFoto.get(v.corrida_id) as { agrupaciones?: { agrupacion_id: string; candidatas?: CandidataConPliegues[] }[] } | null | undefined;
        const a = res?.agrupaciones?.find((x) => x.agrupacion_id === v.agrupacion_estacionalidad_id);
        const c = a?.candidatas?.find((x) => x.modelo === v.modelo);
        if (c?.eat_por_pliegue && c.eat_por_pliegue.length > 0) eat.set(v.agrupacion_estacionalidad_id, c.eat_por_pliegue);
      }
    }
  }
  return listo({
    filas: r.data,
    vigentes: r.data.map((v) => ({
      agrupacion_id: v.agrupacion_estacionalidad_id,
      curva_id: v.id,
      version: v.version,
      curva: curvaDeFila(v),
      ...(eat.get(v.agrupacion_estacionalidad_id) ? { eat_por_pliegue: eat.get(v.agrupacion_estacionalidad_id) } : {}),
    })),
  });
}

// ─── Factores del Niño ───

export const aFactorProy = (f: FactorDb): FactorProy => ({
  anio: f.anio,
  temporada: f.temporada === "verano" ? "verano" : "invierno",
  ratio_calculado: f.ratio_calculado === null ? null : Number(f.ratio_calculado),
  ratio_aplicado: f.ratio_aplicado === null ? null : Number(f.ratio_aplicado),
});

// ─── Contexto completo del cálculo ───

export type ContextoCalculo = {
  tiendasDb: Tables<"tiendas">[];
  tiendas: TiendaProy[];
  cargas: Record<string, string>;
  cargasLista: { id: string; periodo: string; publicada_at: string | null }[];
  publicados: string[];
  catalogo: Catalogo;
  nodos: NodoProy[];
  agrupaciones: AgrupacionProy[];
  vigentesFilas: CurvaFila[];
  vigentes: CurvaVigenteProy[];
  periodos: PeriodoAtipicoApi[];
  periodosClase: PeriodoParaClase[];
  factoresDb: FactorDb[];
  factores: FactorProy[];
  configFlujo: ConfigFlujo;
  /**
   * M12 (`0.11.0`): `huella_flujo` de hoy (hash de la configuración de 02b y `VERSION_METODO_BARRER`). `null` si el contexto se leyó
   * sin la configuración de marcas (`conFlujo: false`): no se puede comparar, así que no se marca nada.
   */
  huellaFlujo: string | null;
  /** `0.10.8` (07c): ids de los géneros que son columna de la matriz de crecimientos (HOMBRE, MUJER), según el catálogo. */
  generosMatriz: string[];
  hoy: string;
  ultimoCerrado: string | null;
  hastaDefecto: string | null;
};

export async function cargarContextoCalculo(db: Db, opciones: { conEat?: boolean; conFlujo?: boolean } = {}): Promise<Leido<ContextoCalculo>> {
  const [tiendas, cargas, cat, agrupaciones, vigentes, periodos, factores] = await Promise.all([
    leerTiendas(db, { soloActivas: false }),
    leerCargasConFecha(db),
    cargarCatalogo(db),
    leerAgrupacionesActivasBasicas(db),
    leerVigentesProy(db, opciones.conEat ?? true),
    leerPeriodos(db, { soloActivos: true }),
    leerFactoresDb(db),
  ]);
  const fallo = tiendas.error ?? cargas.error ?? agrupaciones.error ?? periodos.error ?? factores.error;
  if (fallo) return falla(traducirErrorDb(fallo, "proyección: leer datos"));
  if (cat.respuesta) return falla(cat.respuesta);
  if (vigentes.respuesta) return falla(vigentes.respuesta);

  // Marcas, conjuntos y marcas relevantes por GML (claveFlujo para las participaciones).
  let configFlujo: ConfigFlujo = { unidadDe: new Map(), marcas: new Map(), nodoDeEquivalencia: new Map(), nivelDeNodo: new Map(), relevantes: new Set() };
  let huella: string | null = null;
  if (opciones.conFlujo ?? true) {
    const gml: Awaited<ReturnType<typeof cargarEstadoGml>> = await cargarEstadoGml(db);
    if (gml.error || !gml.estado) return falla(traducirErrorDb(gml.error as NonNullable<typeof gml.error>, "proyección: leer marcas"));
    configFlujo = construirConfigFlujo((gml as EstadoGmlCargado).estado, cat.data.equivalencias);
    huella = huellaFlujo(configFlujo);
  }

  const nodos: NodoProy[] = [];
  for (const n of cat.data.nodosDb) {
    if (!n.activo) continue;
    const nombres = cat.data.catalogo.nodos.get(n.id);
    if (!nombres) continue;
    nodos.push({
      gml_id: n.id,
      nivel: n.nivel_planificacion === "GMLE" ? "GMLE" : "GML",
      genero_id: n.genero_id,
      mundo_id: n.mundo_id,
      linea_id: n.linea_id,
      genero: nombres.genero,
      mundo: nombres.mundo,
      linea: nombres.linea,
      equivalencias: cat.data.equivalencias
        .filter((q) => q.genero_mundo_linea_id === n.id && q.activo)
        .map((q) => ({ id: q.id, nombre: q.nombre, agrupacion_estacionalidad_id: q.agrupacion_estacionalidad_id })),
    });
  }

  const cargasMapa: Record<string, string> = {};
  for (const c of cargas.data) cargasMapa[c.periodo.slice(0, 7)] = c.id;
  const publicados = Object.keys(cargasMapa).sort();
  const hoy = hoyLima();
  const periodosApi = periodos.data.map(aPeriodoApi);
  return listo({
    tiendasDb: tiendas.data,
    tiendas: tiendas.data.map(aTiendaProy),
    cargas: cargasMapa,
    cargasLista: cargas.data.map((c) => ({ id: c.id, periodo: c.periodo.slice(0, 7), publicada_at: c.publicada_at })),
    publicados,
    catalogo: cat.data.catalogo,
    nodos,
    agrupaciones: agrupaciones.data.map((a) => ({ id: a.id, nombre: a.nombre, temporada: a.temporada })),
    vigentesFilas: vigentes.data.filas,
    vigentes: vigentes.data.vigentes,
    periodos: periodosApi,
    periodosClase: periodosApi,
    factoresDb: factores.data,
    factores: factores.data.map(aFactorProy),
    configFlujo,
    huellaFlujo: huella,
    generosMatriz: generosDeMatriz(cat.data.generos).map((g) => g.id),
    hoy,
    ultimoCerrado: publicados.length > 0 ? ultimoMesCerrado(hoy) : null,
    hastaDefecto: hastaPorDefecto(publicados, hoy),
  });
}

/** `EstadoActual` para `motivosDesactualizada`, con lo ya leído. */
export function estadoActualDe(ctx: ContextoCalculo, nivelesCambiados: number, crecimientos?: EstadoActual["crecimientos"]): EstadoActual {
  const periodosUpdated = ctx.periodos.map((p) => p.updated_at).sort();
  return {
    ...(crecimientos ? { crecimientos } : {}),
    cargas_publicadas: ctx.cargasLista.map((c) => ({ periodo: c.periodo, publicada_at: c.publicada_at })),
    ultimo_mes_cerrado: ctx.ultimoCerrado,
    curvas_vigentes: ctx.vigentes.map((v) => ({ agrupacion_id: v.agrupacion_id, curva_id: v.curva_id })),
    niveles_cambiados: nivelesCambiados,
    ...(ctx.huellaFlujo !== null ? { huella_flujo: ctx.huellaFlujo } : {}),
    tiendas: ctx.tiendas,
    factores: ctx.factores,
    periodos_updated_at: periodosUpdated.length > 0 ? periodosUpdated[periodosUpdated.length - 1] : null,
  };
}

/** Factores del Niño que faltan (año atípico sin factor) y si el año siguiente es atípico. */
export function factoresPendientes(ctx: ContextoCalculo, anioEnCurso: number): { faltantes: { anio: number; temporada: string }[]; siguienteAtipico: boolean } {
  const faltantes: { anio: number; temporada: string }[] = [];
  let siguienteAtipico = false;
  for (const temporada of ["invierno", "verano"] as const) {
    if (!ctx.agrupaciones.some((a) => a.temporada === temporada)) continue;
    const { anios } = aniosAtipicidad({ agrupacion: { temporada }, periodos: ctx.periodosClase, mesesPublicados: ctx.publicados });
    for (const a of anios) {
      if (a.clase !== "atipico") continue;
      if (a.anio === anioEnCurso + 1) siguienteAtipico = true;
      if (a.anio <= anioEnCurso && factorDe(ctx.factores, a.anio, temporada) === null) faltantes.push({ anio: a.anio, temporada });
    }
  }
  return { faltantes, siguienteAtipico };
}

/** Cuántas curvas vigentes están obsoletas hoy (lectura de fotos sin `resultado`; la misma regla que `GET /api/curvas`). */
export async function contarCurvasObsoletas(db: Db, ctx: ContextoCalculo): Promise<Leido<number>> {
  if (ctx.vigentesFilas.length === 0) return listo(0);
  const [agrupaciones, tiendas, venta] = await Promise.all([leerAgrupacionesConDatos(db, { soloActivas: false }), leerTiendasMaestro(db), leerVentaMensualTienda(db)]);
  const fallo = agrupaciones.error ?? tiendas.error ?? venta.error;
  if (fallo) return falla(traducirErrorDb(fallo, "proyección: curvas obsoletas"));
  const cargasPublicadas = await leerCargasPublicadas(db);
  if (cargasPublicadas.error) return falla(traducirErrorDb(cargasPublicadas.error, "proyección: curvas obsoletas"));
  const evaluadas = await leerObsolescencia(
    db,
    ctx.vigentesFilas,
    estadoGlobalActual({
      tiendas: tiendas.data,
      venta: venta.data,
      cargas: cargasPublicadas.data,
      periodos: ctx.periodosClase,
      agrupaciones: agrupaciones.data,
      activas: agrupaciones.data.filter((a) => a.activo),
      hoy: ctx.hoy,
    })
  );
  if (evaluadas.respuesta) return falla(evaluadas.respuesta);
  return listo([...evaluadas.data.values()].filter((e) => e.motivos.length > 0).length);
}

/** Venta mensual por tienda (M6) para las dudas de la red por datos. */
export async function leerVentaTiendaMeses(db: Db) {
  const r = await leerVentaMensualTienda(db);
  if (r.error) return falla(traducirErrorDb(r.error, "proyección: venta por tienda"));
  return listo(r.data);
}

