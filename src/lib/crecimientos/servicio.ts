import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { error, errorConCodigo, ok } from "@/lib/api/respuestas";
import { leerNodos } from "@/lib/arbol/consultas";
import { anioDe, hastaPorDefecto, redondear } from "@/lib/curvas/anios";
import { claseDeAnio } from "@/lib/curvas/atipicos";
import { aPeriodoApi, leerAgrupacionesActivasBasicas, leerCargasPublicadas, leerHuellaComposicionTemporada, leerCurvasVigentes, leerPeriodos, leerTiendas } from "@/lib/curvas/consultas";
import { referenciaVolumen } from "@/lib/curvas/efecto";
import { huellaCargas, huellaRed } from "@/lib/curvas/huellas";
import { curvaDeFila } from "@/lib/curvas/reglas";
import { clasificarTienda } from "@/lib/proyeccion/bloques";
import { calcularPromedio, claveGM, generosDeMatriz } from "@/lib/proyeccion/crecimientos";
import { leerCrecimientos, leerFactoresDb, leerFilasConAnios, leerGenerosMundos, listarProyeccionesDb, type FactorDb, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { correccionMaterial, type HoyFactor } from "@/lib/proyeccion/factor-nino";
import { factorDe, type FactorProy } from "@/lib/proyeccion/nino";
import type { SobreBase, TemporadaFactor } from "@/lib/proyeccion/tipos-api";
import { comoObjeto, nombreDeUsuario } from "@/lib/ventas/http";
import { aPeriodo } from "@/lib/ventas/periodo";
import { armarFactorY, cerrarConjunto, cierreDeGM, diagnosticoVeranoGM, variacionCierre, type CurvaDeAgrupacion, type ResultadoCierreGM } from "./cierre-curva";
import { aniosDeRed, calcularRedes, comparablesDe, motivoFuera, ventaTotalPorTienda, type RedesPorAnio } from "./comparables";
import { insertarVersion, leerMarcasArbol, leerVentaGeneroMundo, leerVersionesDeAnio, reemplazarVigente, restaurarVigente, type VersionDb } from "./consultas";
import { leerClaveGeneroMundo, type AprobarCrecimientoValidado, type ClaveGeneroMundo, type ConsultaGeneroMundo } from "./esquemas";
import { huellaCurvasVigentes, huellaDatosGM, huellaFactoresNino, huellaPeriodosNino, huellaTiendasSiguiente, type FactorParaHuella } from "./huellas";
import { leerVentaGMCacheada } from "./cache";
import {
  agregadoDe,
  calcularReaprobar,
  calcularReferencias,
  equivalenteReal,
  estadoDeProyeccion,
  METODO_MIN_REFERENCIA,
  periodoTocaNino,
  valorDeBase,
  type FilaBase,
  type ProyeccionParaReferencias,
  type ResultadoReferencias,
} from "./referencias";
import {
  aniosPermitidos,
  ESTADOS_REFERENCIA,
  estadoDeGM,
  evaluarObsoleto,
  mensajeAnioSiguienteAtipico,
  mesesAtipicosDelAnio,
  motivoRechazoAnio,
  motivoRechazoAnioSiguienteAtipico,
  motivoRechazoAprobar,
  motivoRechazoBaseAnio,
  motivoRechazoGeneroMundo,
  motivoRechazoReferencia,
  referenciaPorDefecto,
  siguienteVersion,
  type RechazoCrecimiento,
  type VersionParaComparar,
} from "./reglas";
import {
  agruparPorGM,
  armarSeriesAnios,
  aniosPublicados,
  bandasNino,
  claveRutaGM,
  crearPhi,
  formaTipica,
  mesesPublicadosDe,
  tiendasConVenta,
  type FactorConParcial,
  type Phi,
  type SerieGM,
  type VentaGeneroMundo,
} from "./series";
import {
  CLAVE_RESTO,
  type AvisoGMApi,
  type BaseCrecimiento,
  type DetalleGeneroMundoApi,
  type EstadoVersionCrecimiento,
  type FactorYApi,
  type FilaGMApi,
  type ListaGeneroMundoApi,
  type ProyeccionReferenciaApi,
  type ReferenciaApi,
  type RespuestaAprobarCrecimientoApi,
  type VarianteBase,
  type VersionCrecimientoApi,
} from "./tipos-api";

/**
 * Servicio de 06d y 06e (solo servidor): lee los datos una vez (`cargarContexto`), arma la lista y el detalle (`armarLista`,
 * `armarDetalle`) y aprueba una versión (`aprobarCrecimiento`). Las reglas están en `reglas.ts`, las cifras en `referencias.ts` y el cierre
 * por curva en `cierre-curva.ts`; aquí solo se orquesta. NO escribe en ninguna proyección: lo único que escribe es `crecimientos_genero_mundo`.
 */

type Db = SupabaseClient<Database>;
type Leido<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };

const listo = <T>(data: T): Leido<T> => ({ data, respuesta: null });
const falla = (respuesta: NextResponse): Leido<never> => ({ data: null, respuesta });
const r2 = (n: number) => redondear(n, 2);
const r2n = (n: number | null) => (n === null ? null : r2(n));
const comoJson = (v: unknown): Json => v as Json;

const MESES_LECTURA_ATRAS = 4;
const PUENTE_CERO = { total_en_curso: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, cierres_sin_decidir: 0 };

export function rechazar(r: RechazoCrecimiento): NextResponse {
  return errorConCodigo(r.mensaje, r.status, r.codigo);
}

// ─── Contexto ───

type GeneroMundoCatalogo = { id: string; nombre: string; orden: number | null; activo: boolean };

/** La proyección de referencia elegida con lo que de ella usan las cifras. */
export type ReferenciaElegida = {
  proyeccion: ProyeccionDb;
  version_metodo: number | null;
  datos: ProyeccionParaReferencias;
};

export type ContextoGM = {
  /** Año de aplicación (`Y+1`). */
  anio: number;
  y: number;
  /** Último mes publicado y cerrado (`aaaa-mm`). */
  hasta: string;
  /** Mes (1 a 12) de `Y` hasta el que hay datos cerrados; `null` si `Y` aún no tiene meses cerrados. */
  k: number | null;
  publicados: ReadonlySet<string>;
  aniosPermitidos: number[];
  venta: VentaGeneroMundo;
  grupos: Map<string, SerieGM[]>;
  codigos: ReadonlyMap<string, string>;
  redes: RedesPorAnio;
  comparables: (z: number) => ReadonlySet<string>;
  /** `M(Y+1)` (06e §5.1): las tiendas que tendrá el año siguiente (`clasificarTienda(t, Y+1).bloque = 'mismas'`). */
  mismasSiguiente: ReadonlySet<string>;
  aniosCompletos: number[];
  phi: Phi;
  periodos: ReturnType<typeof aPeriodoApi>[];
  factores: FactorConParcial[];
  /** Las filas de `factores_volumen_atipico` activas, con las columnas de `0.14.0` (el estado y el diagnóstico salen de aquí). */
  factoresDb: FactorDb[];
  /** Lo de hoy contra lo que se juzga un factor de `Y` (B2): cargas, composición de la temporada y meses del periodo publicados. */
  hoyFactor: (temporada: TemporadaFactor) => HoyFactor;
  /** Curvas vigentes de M6 por agrupación y los nombres de las agrupaciones activas. */
  curvas: ReadonlyMap<string, CurvaDeAgrupacion>;
  nombresAgrupacion: ReadonlyMap<string, string>;
  generos: GeneroMundoCatalogo[];
  mundos: GeneroMundoCatalogo[];
  detallables: ReadonlySet<string>;
  nodos: Tables<"genero_mundo_linea">[];
  versiones: VersionDb[];
  proyecciones: ProyeccionDb[];
  referencia: ReferenciaElegida | null;
  huella_datos: string;
};

const aFactor = (f: FactorDb): FactorConParcial => ({
  anio: f.anio,
  temporada: f.temporada === "verano" ? "verano" : "invierno",
  ratio_calculado: f.ratio_calculado === null ? null : Number(f.ratio_calculado),
  ratio_aplicado: f.ratio_aplicado === null ? null : Number(f.ratio_aplicado),
  parcial: f.parcial,
});

const aFactorHuella = (f: FactorDb): FactorParaHuella => ({
  ...aFactor(f),
  formula: f.formula,
  ratio_volumen: f.ratio_volumen === null ? null : Number(f.ratio_volumen),
  ratio_control: f.ratio_control === null ? null : Number(f.ratio_control),
  huella_cargas: f.huella_cargas,
  huella_composicion: f.huella_composicion,
  aplicado_huella: f.aplicado_huella,
});

const numeroONulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Datos de `resumen` y `parametros` de una proyección que usan las cifras. */
function leerResumen(p: ProyeccionDb): {
  version_metodo: number | null;
  gm_gml: Record<string, string>;
  gm_con_nino: ReadonlySet<string> | null;
  gm_fuera_base: ReadonlyMap<string, { filas: number; unidades: number }>;
} {
  const resumen = comoObjeto(p.resumen);
  const gm = comoObjeto(resumen?.gm_gml);
  const gm_gml: Record<string, string> = {};
  for (const [k, v] of Object.entries(gm ?? {})) if (typeof v === "string") gm_gml[k] = v;
  const conNino = Array.isArray(resumen?.gm_con_nino) ? new Set((resumen.gm_con_nino as unknown[]).filter((x): x is string => typeof x === "string")) : null;
  const fuera = new Map<string, { filas: number; unidades: number }>();
  for (const [k, v] of Object.entries(comoObjeto(resumen?.gm_fuera_base) ?? {})) {
    const o = comoObjeto(v);
    const filas = num(o?.filas);
    const unidades = num(o?.unidades);
    if (filas !== null && unidades !== null) fuera.set(k, { filas, unidades });
  }
  return { version_metodo: num(resumen?.version_metodo), gm_gml, gm_con_nino: conNino, gm_fuera_base: fuera };
}

function tiendasMismasDe(p: ProyeccionDb, y: number): Set<string> {
  const bloques = comoObjeto(comoObjeto(p.parametros)?.bloques);
  const delAnio = comoObjeto(bloques?.[String(y)]);
  const mismas = Array.isArray(delAnio?.mismas) ? (delAnio.mismas as unknown[]) : [];
  const ids = new Set<string>();
  for (const t of mismas) {
    const id = comoObjeto(t)?.tienda_id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** El Resto aplicado por el último cálculo: su % y sobre qué base (`crecimiento_resto_usado`; sin la clave, el provisional `corregida`). */
function restoAplicadoDe(p: ProyeccionDb): { pct: number; sobre: SobreBase } {
  const parametros = comoObjeto(p.parametros);
  const usado = comoObjeto(parametros?.crecimiento_resto_usado);
  const pct = num(usado?.pct) ?? num(parametros?.crecimiento_pct_defecto) ?? 0;
  const sobre: SobreBase = usado ? (usado.sobre_base === "corregida" ? "corregida" : "bruta") : "corregida";
  return { pct, sobre };
}

/** Las filas base de la proyección (tienda nula, activas, con GM conocido) con su registro de `Y` y el de `Y+1`. */
function filasBaseDe(filas: Awaited<ReturnType<typeof leerFilasConAnios>>["data"], gmGml: Record<string, string>, y: number): FilaBase[] {
  const salida: FilaBase[] = [];
  for (const f of filas) {
    if (f.tienda_id !== null || !f.activo) continue;
    const gm = gmGml[f.gml_id];
    if (!gm) continue;
    const [genero_id = "", mundo_id = ""] = gm.split("|");
    if (genero_id === "" || mundo_id === "") continue;
    const anios = f.proyeccion_fila_anios ?? [];
    const delY = anios.find((a) => a.anio === y && a.bloque === "mismas" && a.activo !== false);
    const delSiguiente = anios.find((a) => a.anio === y + 1 && a.bloque === "mismas" && a.activo !== false);
    salida.push({
      fila_id: f.id,
      genero_id,
      mundo_id,
      gm,
      temporada: f.temporada ?? "todo_el_ano",
      vigente_y: delY ? (delY.decidido ?? delY.propuesto ?? null) : null,
      meses_y: delY?.meses ? delY.meses.map(Number) : null,
      b: num(delSiguiente?.base_siguiente),
      bn: num(delSiguiente?.base_normalizada),
      crecimiento_pct: num(delSiguiente?.crecimiento_pct),
      decidido: delSiguiente?.decidido ?? null,
      propuesto: delSiguiente?.propuesto ?? null,
    });
  }
  return salida;
}

/**
 * Lee todo lo que la lista, el detalle y el `POST` necesitan, una sola vez: cargas, tiendas, periodos y factores del Niño, curvas vigentes,
 * agrupaciones, árbol, catálogo, proyecciones, versiones del año, la venta por GM (por la caché de memoria) y la proyección de referencia.
 * Valida el año (`400 anio_no_permitido`) y la referencia (`400 referencia_otro_anio`). `409 sin_datos` si ningún mes está publicado y cerrado.
 */
export async function cargarContexto(db: Db, consulta: ConsultaGeneroMundo, hoy: string, opciones: { referencia?: { id: string | null } } = {}): Promise<Leido<ContextoGM>> {
  const [cargas, tiendas, periodos, factores, nodos, catalogo, proyecciones, marcas, curvas, agrupaciones] = await Promise.all([
    leerCargasPublicadas(db),
    leerTiendas(db),
    leerPeriodos(db, { soloActivos: true }),
    leerFactoresDb(db),
    leerNodos(db),
    leerGenerosMundos(db),
    listarProyeccionesDb(db),
    leerMarcasArbol(db),
    leerCurvasVigentes(db),
    leerAgrupacionesActivasBasicas(db),
  ]);
  const fallo = cargas.error ?? tiendas.error ?? periodos.error ?? factores.error ?? nodos.error ?? catalogo.error ?? proyecciones.error ?? marcas.error ?? curvas.error ?? agrupaciones.error;
  if (fallo) return falla(traducirErrorDb(fallo, "crecimientos por género y mundo: leer datos"));

  const mesesPublicados = Object.keys(cargas.data).sort();
  const hasta = hastaPorDefecto(mesesPublicados, hoy);
  if (hasta === null) return falla(errorConCodigo("Todavía no hay ningún mes publicado y cerrado en Venta y stock.", 409, "sin_datos"));

  const permitidos = aniosPermitidos(hasta, proyecciones.data);
  const anio = consulta.anio ?? anioDe(hasta) + 1;
  const rechazoAnio = motivoRechazoAnio(anio, permitidos);
  if (rechazoAnio) return falla(rechazar(rechazoAnio));
  const y = anio - 1;

  // La proyección de referencia: la pedida (o la del cuerpo del POST) o, sin pedir ninguna, la que se ofrece por defecto.
  const pedida = opciones.referencia !== undefined ? opciones.referencia.id : consulta.proyeccion;
  let elegida: ProyeccionDb | null = null;
  if (pedida !== null) {
    const p = proyecciones.data.find((x) => x.id === pedida);
    const rechazo = motivoRechazoReferencia(p, anio);
    if (rechazo) return falla(rechazar(rechazo));
    elegida = p ?? null;
  } else if (opciones.referencia === undefined) {
    const candidata = referenciaPorDefecto(
      proyecciones.data.map((p) => ({ id: p.id, estado: p.estado, anio_en_curso: p.anio_en_curso, calculado_at: p.calculado_at, version_metodo: leerResumen(p).version_metodo })),
      anio,
      METODO_MIN_REFERENCIA
    );
    elegida = candidata ? (proyecciones.data.find((p) => p.id === candidata.id) ?? null) : null;
  }

  const publicados = new Set(mesesPublicados.filter((m) => m <= hasta));
  const primerAnio = anioDe(mesesPublicados[0] as string);
  const anioHasta = anioDe(hasta);
  const desde = `${Math.max(primerAnio, anioHasta - MESES_LECTURA_ATRAS)}-01-01`;
  const cargasHuella = huellaCargas(cargas.data);
  const lectura = await leerVentaGMCacheada({ desde, cargas_huella: cargasHuella, marcas: marcas.data }, () => leerVentaGeneroMundo(db, desde));
  if (lectura.error) return falla(traducirErrorDb(lectura.error, "crecimientos por género y mundo: leer la venta"));
  if (!lectura.data) return falla(error("La lectura de venta por género y mundo no tiene la forma esperada.", 500));
  const venta = lectura.data;

  const versiones = await leerVersionesDeAnio(db, anio);
  if (versiones.error) return falla(traducirErrorDb(versiones.error, "crecimientos por género y mundo: leer las versiones"));

  const periodosApi = periodos.data.map(aPeriodoApi);
  const factoresActivos = factores.data.filter((f) => f.activo);
  const factoresProy: FactorConParcial[] = factoresActivos.map(aFactor);
  const phi = crearPhi(periodosApi, factoresProy);

  const redes = calcularRedes(tiendas.data, ventaTotalPorTienda(venta.series), aniosDeRed(publicados, hasta), hasta, publicados);
  const memo = new Map<number, ReadonlySet<string>>();
  const comparables = (z: number): ReadonlySet<string> => {
    let c = memo.get(z);
    if (!c) {
      c = comparablesDe(redes, z);
      memo.set(z, c);
    }
    return c;
  };
  const mismasSiguiente = new Set(tiendas.data.filter((t) => clasificarTienda(t, anio).bloque === "mismas").map((t) => t.id));
  const aniosCompletos = [y - 1, y - 2].filter((z) => mesesPublicadosDe(publicados, z) === 12 && mesesPublicadosDe(publicados, z - 1) > 0);
  const k = y < anioHasta ? 12 : y === anioHasta ? Number(hasta.slice(5, 7)) : null;
  const detallables = new Set(generosDeMatriz(catalogo.generos).map((g) => g.id));

  // Curvas vigentes (una por agrupación) y nombres de las agrupaciones activas.
  const curvasPorAgrupacion = new Map<string, CurvaDeAgrupacion>();
  for (const c of curvas.data) curvasPorAgrupacion.set(c.agrupacion_estacionalidad_id, { id: c.id, version: c.version, c: curvaDeFila(c) });
  const nombresAgrupacion = new Map<string, string>();
  for (const a of agrupaciones.data) nombresAgrupacion.set(a.id, a.nombre);

  // Lo de hoy contra lo que se juzga un factor de `Y` (B2): las mismas cargas y la misma composición con que se sincroniza
  // (`leerHuellaComposicionTemporada`: la misma función que usan `sincronizarFactores` y el contexto de M7). Solo se lee la composición de las temporadas que
  // tienen meses atípicos en `Y`: en un año sin Niño no hace falta (y ahorra las lecturas de equivalencias).
  const mesesAtipicosY = (temporada: TemporadaFactor): string[] => claseDeAnio(y, { temporada }, periodosApi, [...publicados]).meses_atipicos;
  const huellaComposicionDe: Record<TemporadaFactor, string> = { invierno: "", verano: "" };
  for (const temporada of ["invierno", "verano"] as const) {
    if (mesesAtipicosY(temporada).length === 0) continue;
    const composicion = await leerHuellaComposicionTemporada(db, temporada);
    if (composicion.error) return falla(traducirErrorDb(composicion.error, "crecimientos por género y mundo: leer la composición de las agrupaciones"));
    huellaComposicionDe[temporada] = composicion.data;
  }
  const hoyFactor = (temporada: TemporadaFactor): HoyFactor => ({
    huella_cargas: cargasHuella,
    huella_composicion: huellaComposicionDe[temporada],
    meses_periodo_publicados: mesesAtipicosY(temporada).filter((m) => publicados.has(m)).length,
  });

  // La proyección de referencia: solo se leen sus filas si es del método con `B'` (≥ 5).
  let referencia: ReferenciaElegida | null = null;
  if (elegida) {
    const resumen = leerResumen(elegida);
    const metodoOk = (resumen.version_metodo ?? 0) >= METODO_MIN_REFERENCIA;
    let filas: FilaBase[] = [];
    const pctPorGM = new Map<string, number>();
    const sobrePorGM = new Map<string, SobreBase>();
    if (metodoOk) {
      const [leidas, foto] = await Promise.all([leerFilasConAnios(db, elegida.id, { columnas: "ligeras", tiendaId: null, soloActivas: true }), leerCrecimientos(db, elegida.id)]);
      const f = leidas.error ?? foto.error;
      if (f) return falla(traducirErrorDb(f, "crecimientos por género y mundo: leer la proyección de referencia"));
      filas = filasBaseDe(leidas.data, resumen.gm_gml, y);
      for (const c of foto.data) {
        const clave = claveGM(c.genero_id, c.mundo_id);
        pctPorGM.set(clave, Number(c.pct));
        sobrePorGM.set(clave, c.sobre_base === "corregida" ? "corregida" : "bruta");
      }
    }
    const resto = restoAplicadoDe(elegida);
    referencia = {
      proyeccion: elegida,
      version_metodo: resumen.version_metodo,
      datos: {
        estado: estadoDeProyeccion(resumen.version_metodo, filas),
        mismas: tiendasMismasDe(elegida, y),
        filas,
        pctPorGM,
        restoPct: resto.pct,
        sobrePorGM,
        restoSobre: resto.sobre,
        gmConNino: resumen.gm_con_nino,
        gmFueraBase: resumen.gm_fuera_base,
      },
    };
  }

  const huella = huellaDatosGM({
    anio,
    cargas_huella: cargasHuella,
    marcas: marcas.data,
    red_huella: huellaRed(tiendas.data),
    periodos_huella: huellaPeriodosNino(periodosApi),
    factores_huella: huellaFactoresNino(factoresActivos.map(aFactorHuella)),
    curvas_huella: huellaCurvasVigentes([...curvasPorAgrupacion.entries()].map(([agrupacion_id, c]) => ({ agrupacion_id, id: c.id, version: c.version }))),
    tiendas_siguiente_huella: huellaTiendasSiguiente(mismasSiguiente),
    proyeccion: elegida ? { id: elegida.id, calculado_at: elegida.calculado_at, version_metodo: referencia?.version_metodo ?? null } : null,
  });

  return listo({
    anio,
    y,
    hasta,
    k,
    publicados,
    aniosPermitidos: permitidos,
    venta,
    grupos: agruparPorGM(venta.series),
    codigos: new Map(tiendas.data.map((t) => [t.id, t.codigo])),
    redes,
    comparables,
    mismasSiguiente,
    aniosCompletos,
    phi,
    periodos: periodosApi,
    factores: factoresProy,
    factoresDb: factoresActivos,
    hoyFactor,
    curvas: curvasPorAgrupacion,
    nombresAgrupacion,
    generos: catalogo.generos,
    mundos: catalogo.mundos,
    detallables,
    nodos: nodos.data,
    versiones: versiones.data,
    proyecciones: proyecciones.data,
    referencia,
    huella_datos: huella,
  });
}

// ─── Conjuntos: un GM o el Resto ───

type Conjunto = {
  clave: string;
  alcance: "gm" | "resto";
  genero_id: string | null;
  mundo_id: string | null;
  genero: string | null;
  mundo: string | null;
  detallable: boolean;
  mundo_activo: boolean;
  entradas: SerieGM[];
  filas: FilaBase[];
  /** Nodos activos que hoy forman el conjunto. */
  gml_ids: string[];
};

const nombreDe = (xs: readonly GeneroMundoCatalogo[], id: string) => xs.find((x) => x.id === id)?.nombre ?? id;

function armarConjuntos(ctx: ContextoGM): { gms: Conjunto[]; resto: Conjunto } {
  const filasBase = ctx.referencia?.datos.filas ?? [];
  const filasPorGM = new Map<string, FilaBase[]>();
  for (const f of filasBase) {
    const k = claveRutaGM(f.genero_id, f.mundo_id);
    const g = filasPorGM.get(k);
    if (g) g.push(f);
    else filasPorGM.set(k, [f]);
  }
  const claves = new Set<string>();
  for (const [k, entradas] of ctx.grupos) if (tiendasConVenta(entradas).size > 0) claves.add(k);
  for (const v of ctx.versiones) if (v.estado === "vigente" && v.alcance === "gm" && v.genero_id && v.mundo_id) claves.add(claveRutaGM(v.genero_id, v.mundo_id));
  for (const k of filasPorGM.keys()) claves.add(k);

  const gms = [...claves].map((clave): Conjunto => {
    const [generoId = "", mundoId = ""] = clave.split(".");
    return {
      clave,
      alcance: "gm",
      genero_id: generoId,
      mundo_id: mundoId,
      genero: nombreDe(ctx.generos, generoId),
      mundo: nombreDe(ctx.mundos, mundoId),
      detallable: ctx.detallables.has(generoId),
      mundo_activo: ctx.mundos.find((m) => m.id === mundoId)?.activo ?? true,
      entradas: ctx.grupos.get(clave) ?? [],
      filas: filasPorGM.get(clave) ?? [],
      gml_ids: ctx.nodos.filter((n) => n.activo && n.genero_id === generoId && n.mundo_id === mundoId).map((n) => n.id).sort(),
    };
  });
  const orden = (xs: readonly GeneroMundoCatalogo[], id: string) => xs.find((x) => x.id === id)?.orden ?? 9999;
  gms.sort(
    (a, b) =>
      orden(ctx.generos, a.genero_id as string) - orden(ctx.generos, b.genero_id as string) ||
      (a.genero as string).localeCompare(b.genero as string) ||
      orden(ctx.mundos, a.mundo_id as string) - orden(ctx.mundos, b.mundo_id as string) ||
      (a.mundo as string).localeCompare(b.mundo as string) ||
      a.clave.localeCompare(b.clave)
  );

  const resto: Conjunto = {
    clave: CLAVE_RESTO,
    alcance: "resto",
    genero_id: null,
    mundo_id: null,
    genero: null,
    mundo: null,
    detallable: true,
    mundo_activo: true,
    entradas: [...ctx.grupos.entries()].filter(([k]) => !ctx.detallables.has(k.split(".")[0] as string)).flatMap(([, e]) => e),
    filas: filasBase.filter((f) => !ctx.detallables.has(f.genero_id)),
    gml_ids: ctx.nodos.filter((n) => n.activo && !ctx.detallables.has(n.genero_id)).map((n) => n.id).sort(),
  };
  return { gms, resto };
}

const versionesDe = (ctx: ContextoGM, c: Conjunto): VersionDb[] =>
  ctx.versiones
    .filter((v) => v.alcance === c.alcance && (c.alcance === "resto" || (v.genero_id === c.genero_id && v.mundo_id === c.mundo_id)))
    .sort((a, b) => b.version - a.version);

/** La clave de un conjunto en `resumen.gm_con_nino` y `gm_fuera_base`: `genero_id|mundo_id` o `resto`. */
const claveResumenDe = (c: Conjunto): string => (c.alcance === "resto" ? CLAVE_RESTO : claveGM(c.genero_id as string, c.mundo_id as string));

/** Temporadas ajustables por el Niño (invierno y verano) en las que el conjunto tiene venta. */
function temporadasConVenta(c: Conjunto): TemporadaFactor[] {
  return (["invierno", "verano"] as const).filter((t) => c.entradas.some((e) => e.temp === t && Object.values(e.u).some((v) => v !== 0)));
}

// ─── De la fila de la base a la API ───

type BaseGuardada = { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase };

function baseDe(v: VersionDb): BaseGuardada {
  const base = comoObjeto(comoObjeto(v.referencia)?.base);
  const anio = num(base?.anio);
  const variante = base?.variante;
  return {
    tipo: (v.base_tipo as BaseCrecimiento) ?? "ninguna",
    anio,
    variante: variante === "sin_nino_mas_rebote" || variante === "corregido" ? variante : "bruto",
  };
}

const sobreBaseDe = (v: VersionDb): SobreBase => (v.sobre_base === "corregida" ? "corregida" : "bruta");

function gmlIdsDe(v: VersionDb): string[] {
  const ids = comoObjeto(v.referencia)?.gml_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/**
 * La versión como la ve la API. `equivalenteReal` (06e): el % de la versión sobre 2026 real; una `bruta` ya lo es, una `corregida` lo saca
 * de `(1 + g) × B' ÷ B − 1` con la base de la referencia o, sin ella, la base por curva sobre `M(Y+1)` (lo calcula quien llama).
 */
export function aVersionApi(v: VersionDb, proyecciones: readonly ProyeccionDb[], equivalenteRealDe: number | null = null): VersionCrecimientoApi {
  const foto = comoObjeto(comoObjeto(v.referencia)?.proyeccion);
  const nombre = v.proyeccion_referencia_id ? (proyecciones.find((p) => p.id === v.proyeccion_referencia_id)?.nombre ?? (typeof foto?.nombre === "string" ? foto.nombre : "")) : null;
  const base = baseDe(v);
  return {
    id: v.id,
    version: v.version,
    estado: v.estado as EstadoVersionCrecimiento,
    pct: Number(v.pct),
    nota: v.nota,
    base: { tipo: base.tipo, anio: base.anio, variante: base.variante, valor: v.base_valor === null ? null : Number(v.base_valor) },
    sobre_base: sobreBaseDe(v),
    equivalente_real: equivalenteRealDe,
    por_nombre: v.usuario_nombre,
    aprobada_at: v.aprobada_at,
    proyeccion_referencia: v.proyeccion_referencia_id ? { id: v.proyeccion_referencia_id, nombre: nombre ?? "" } : null,
  };
}

/** Los factores de `Y` de la foto de una versión `corregida` (`referencia.factores`): año, temporada y valor efectivo con que se aprobó. */
function factoresDeFoto(v: VersionDb): { anio: number; temporada: TemporadaFactor; efectivo: number | null }[] | null {
  const lista = comoObjeto(v.referencia)?.factores;
  if (!Array.isArray(lista)) return null;
  const salida: { anio: number; temporada: TemporadaFactor; efectivo: number | null }[] = [];
  for (const f of lista as unknown[]) {
    const o = comoObjeto(f);
    const anio = num(o?.anio);
    if (anio === null || (o?.temporada !== "invierno" && o?.temporada !== "verano")) continue;
    salida.push({ anio, temporada: o.temporada, efectivo: numeroONulo(o.efectivo) });
  }
  return salida;
}

/** `K'_M` con los factores de `Y` de la foto en lugar de los de hoy (R14, M3); `null` si no se pudo cerrar. */
function cierreCorregidoConFactoresDeFoto(ctx: ContextoGM, c: Conjunto, foto: readonly { anio: number; temporada: TemporadaFactor; efectivo: number | null }[]): number | null {
  const sobreescritos = new Set(foto.map((f) => `${f.anio}|${f.temporada}`));
  const factores: FactorProy[] = [
    ...ctx.factores.filter((f) => !sobreescritos.has(`${f.anio}|${f.temporada}`)),
    ...foto.map((f) => ({ anio: f.anio, temporada: f.temporada, ratio_calculado: null, ratio_aplicado: f.efectivo })),
  ];
  const phi = crearPhi(ctx.periodos, factores);
  return cerrarConjunto({ entradas: c.entradas, y: ctx.y, k: ctx.k, publicados: ctx.publicados, tiendas: ctx.mismasSiguiente, phi, curvas: ctx.curvas, nombres: ctx.nombresAgrupacion }).cierre_corregido;
}

/** Los factores de `Y` que tocan al conjunto: una temporada con venta del conjunto y meses atípicos en `Y`. */
function factoresDeY(ctx: ContextoGM, c: Conjunto): FactorYApi[] {
  const salida: FactorYApi[] = [];
  for (const temporada of temporadasConVenta(c)) {
    const meses = claseDeAnio(ctx.y, { temporada }, ctx.periodos, [...ctx.publicados]).meses_atipicos;
    if (meses.length === 0) continue;
    const fila = ctx.factoresDb.find((f) => f.anio === ctx.y && f.temporada === temporada);
    salida.push(
      armarFactorY(
        fila
          ? {
              anio: fila.anio,
              temporada: fila.temporada,
              calculado_at: fila.calculado_at,
              formula: fila.formula,
              huella_cargas: fila.huella_cargas,
              huella_composicion: fila.huella_composicion,
              parcial: fila.parcial,
              meses_comparados: fila.meses_comparados,
              ratio_calculado: numeroONulo(fila.ratio_calculado),
              ratio_aplicado: numeroONulo(fila.ratio_aplicado),
              aplicado_huella: fila.aplicado_huella,
              ratio_volumen: numeroONulo(fila.ratio_volumen),
              ratio_control: numeroONulo(fila.ratio_control),
              diagnostico: fila.diagnostico,
            }
          : undefined,
        ctx.y,
        temporada,
        meses.length,
        ctx.hoyFactor(temporada)
      )
    );
  }
  return salida;
}

type Calculado = {
  c: Conjunto;
  ref: ResultadoReferencias;
  cierre: ResultadoCierreGM;
  factores_y: FactorYApi[];
  fila: FilaGMApi;
  versiones: VersionDb[];
  vigente: VersionDb | null;
  /** `equivalente_real` de cada versión (por id). */
  equivalentes: ReadonlyMap<string, number | null>;
};

function calcularConjunto(ctx: ContextoGM, c: Conjunto): Calculado {
  const datos = ctx.referencia?.datos ?? null;
  const valida = datos !== null && datos.estado === "valida";
  const gm = c.alcance === "gm" ? claveGM(c.genero_id as string, c.mundo_id as string) : null;
  const propioGM = valida && datos && gm !== null && c.detallable && datos.pctPorGM.has(gm);
  const pctAplicado = valida && datos ? (propioGM && gm !== null ? (datos.pctPorGM.get(gm) as number) : datos.restoPct) : null;
  const sobreAplicado: SobreBase | undefined = valida && datos ? (propioGM && gm !== null ? (datos.sobrePorGM?.get(gm) ?? "bruta") : (datos.restoSobre ?? "bruta")) : undefined;

  const cierre = cierreDeGM({
    entradas: c.entradas,
    y: ctx.y,
    k: ctx.k,
    publicados: ctx.publicados,
    cy: ctx.comparables(ctx.y),
    mismas: ctx.mismasSiguiente,
    codigos: ctx.codigos,
    phi: ctx.phi,
    curvas: ctx.curvas,
    nombres: ctx.nombresAgrupacion,
  });
  const factoresY = factoresDeY(ctx, c);
  const ref = calcularReferencias({
    entradas: c.entradas,
    y: ctx.y,
    k: ctx.k,
    comparables: ctx.comparables,
    phi: ctx.phi,
    tiendas: ctx.codigos,
    aniosCompletos: ctx.aniosCompletos,
    proyeccion: datos,
    filas: c.filas,
    pctAplicado,
    ...(sobreAplicado ? { sobreAplicado } : {}),
    cierre: cierre.api,
  });

  // D8: con proyección de referencia de método 5 manda `resumen.gm_con_nino`; sin ella, la base por curva. Siempre `correccionMaterial`.
  const hayNino =
    valida && datos
      ? datos.gmConNino
        ? datos.gmConNino.has(claveResumenDe(c))
        : ref.base_siguiente !== null && ref.base_corregida !== null && correccionMaterial(ref.base_siguiente, ref.base_corregida)
      : cierre.api.hay_nino;
  const cierreApi = {
    ...cierre.api,
    hay_nino: hayNino,
    factor_parcial: factoresY.some((f) => f.parcial),
    sin_factor: cierre.api.sin_factor || factoresY.some((f) => f.efectivo === null),
  };

  const versiones = versionesDe(ctx, c);
  const vigente = c.detallable ? (versiones.find((v) => v.estado === "vigente") ?? null) : null;

  // `equivalente_real` de cada versión: `bruta` ya es real; `corregida` con la base de la referencia o, sin ella, la base por curva.
  const base = ref.base_siguiente;
  const baseCorregida = ref.base_corregida;
  const kM = cierre.api.base_curva?.real ?? null;
  const kMc = cierre.api.base_curva?.corregida ?? null;
  const equivalentes = new Map<string, number | null>();
  for (const v of versiones) {
    const pct = Number(v.pct);
    equivalentes.set(v.id, sobreBaseDe(v) === "bruta" ? r2(pct) : valida && base !== null ? equivalenteReal(pct, base, baseCorregida) : equivalenteReal(pct, kM, kMc));
  }

  let motivo: FilaGMApi["motivo_obsoleto"] = null;
  if (vigente) {
    const foto = sobreBaseDe(vigente) === "corregida" ? factoresDeFoto(vigente) : null;
    let factores: { cambiaron: boolean; variacion: number | null } | undefined;
    if (foto && foto.length > 0) {
      const cambiaron = foto.some((f) => !igualesFactor(f.efectivo, factorDe(ctx.factores, f.anio, f.temporada)));
      factores = { cambiaron, variacion: cambiaron ? variacionCierre(cierre.m.cierre_corregido, cierreCorregidoConFactoresDeFoto(ctx, c, foto)) : null };
    }
    motivo = evaluarObsoleto(
      { base: { ...baseDe(vigente), valor: vigente.base_valor === null ? null : Number(vigente.base_valor) }, gml_ids: gmlIdsDe(vigente), sobre_base: sobreBaseDe(vigente) },
      ref.todas,
      new Set(c.gml_ids),
      { hay_nino: hayNino, ...(factores ? { factores } : {}) }
    );
  }

  const fuera = datos?.gmFueraBase ? fueraBaseDe(ctx, c, datos.gmFueraBase) : null;
  const fila: FilaGMApi = {
    clave: c.clave,
    genero: c.genero,
    mundo: c.mundo,
    detallable: c.detallable,
    mundo_activo: c.mundo_activo,
    unidades_anterior: ref.unidades_anterior,
    acumulado: ref.acumulado,
    aplicado_hoy: ref.aplicado_hoy,
    base_siguiente: ref.base_siguiente,
    vigente: vigente ? aVersionApi(vigente, ctx.proyecciones, equivalentes.get(vigente.id) ?? null) : null,
    estado: estadoDeGM(vigente !== null, motivo),
    motivo_obsoleto: motivo,
    sigue: c.alcance === "resto" || (c.detallable && vigente !== null) ? "propio" : "resto",
    cierre: cierreApi,
    base_corregida: valida ? r2n(ref.base_corregida) : null,
    correccion_nino_pct: valida ? ref.correccion_nino_pct : null,
    hay_nino: hayNino,
    fuera_base: fuera,
  };
  return { c, ref, cierre, factores_y: factoresY, fila, versiones, vigente, equivalentes };
}

const igualesFactor = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/** M8: lo que queda fuera de la base de M7 en este conjunto (`resumen.gm_fuera_base`); `null` si nada. El Resto suma lo de los GM no detallados. */
function fueraBaseDe(ctx: ContextoGM, c: Conjunto, fuera: ReadonlyMap<string, { filas: number; unidades: number }>): { filas: number; unidades: number } | null {
  let filas = 0;
  let unidades = 0;
  if (c.alcance === "gm") {
    const f = fuera.get(claveResumenDe(c));
    filas = f?.filas ?? 0;
    unidades = f?.unidades ?? 0;
  } else {
    for (const [clave, f] of fuera) {
      const [genero = ""] = clave.split("|");
      if (clave === CLAVE_RESTO || !ctx.detallables.has(genero)) {
        filas += f.filas;
        unidades += f.unidades;
      }
    }
  }
  return filas > 0 || unidades > 0 ? { filas, unidades: Math.round(unidades) } : null;
}

function proyeccionRefApi(ctx: ContextoGM): ProyeccionReferenciaApi | null {
  const r = ctx.referencia;
  return r ? { id: r.proyeccion.id, nombre: r.proyeccion.nombre, calculado_at: r.proyeccion.calculado_at, version_metodo: r.version_metodo } : null;
}

function proyeccionesDisponibles(ctx: ContextoGM): ListaGeneroMundoApi["proyecciones_disponibles"] {
  const elegida = ctx.referencia?.proyeccion.id ?? null;
  return ctx.proyecciones
    .filter((p) => p.anio_en_curso === ctx.y && (ESTADOS_REFERENCIA as readonly string[]).includes(p.estado))
    .map((p) => ({ id: p.id, nombre: p.nombre, calculado_at: p.calculado_at, version_metodo: leerResumen(p).version_metodo, estado: p.estado as "en_trabajo" | "cerrada" }))
    .filter((p) => p.id === elegida || (p.calculado_at !== null && (p.version_metodo ?? 0) >= METODO_MIN_REFERENCIA));
}

/** El % sobre corregido equivalente a un % `bruto` en un agregado: `(1 + g) × Σ B ÷ Σ B' − 1`. */
const corregidoDeBruto = (pctBruto: number, base: number, baseCorregida: number): number => (baseCorregida > 0 ? ((1 + pctBruto / 100) * base) / baseCorregida * 100 - 100 : pctBruto);

/** `GET /api/curvas/genero-mundo`. */
export function armarLista(ctx: ContextoGM): ListaGeneroMundoApi {
  const { gms, resto } = armarConjuntos(ctx);
  const calculados = gms.map((c) => calcularConjunto(ctx, c));
  const calculadoResto = calcularConjunto(ctx, resto);
  const datos = ctx.referencia?.datos ?? null;
  const valida = datos !== null && datos.estado === "valida";

  const detallables = calculados.filter((x) => x.c.detallable);
  const sinAprobar = detallables.filter((x) => x.fila.estado === "sin_aprobar" && (!valida || (x.fila.base_siguiente ?? 0) > 0)).length;

  let pctPonderado: number | null = null;
  let pctReal: number | null = null;
  let base = 0;
  if (valida && datos) {
    const aResto = agregadoDe(resto.filas);
    const restoSobre: SobreBase = calculadoResto.vigente ? sobreBaseDe(calculadoResto.vigente) : "corregida";
    const restoEscrito = calculadoResto.vigente ? Number(calculadoResto.vigente.pct) : datos.restoPct;
    const enCorregido = (pct: number, sobre: SobreBase, a: ReturnType<typeof agregadoDe>) => (sobre === "bruta" ? corregidoDeBruto(pct, a.base, a.base_normalizada) : pct);
    const promedio = calcularPromedio(
      detallables.map((x) => {
        const a = agregadoDe(x.c.filas);
        return {
          genero: x.c.genero as string,
          mundo: x.c.mundo as string,
          pct: x.vigente ? enCorregido(Number(x.vigente.pct), sobreBaseDe(x.vigente), a) : enCorregido(restoEscrito, restoSobre, a),
          sin_filas: x.c.filas.length === 0,
          agregado: a,
        };
      }),
      { pct: enCorregido(restoEscrito, restoSobre, aResto), agregado: aResto },
      null,
      PUENTE_CERO,
      { sobre: "corregida" }
    );
    if (promedio.resultado) {
      pctPonderado = promedio.resultado.ponderado_escrito_pct === null ? null : r2(promedio.resultado.ponderado_escrito_pct);
      base = promedio.resultado.base_corregida_total;
      const baseReal = promedio.resultado.base_total;
      pctReal = pctPonderado !== null && baseReal > 0 ? r2(((1 + pctPonderado / 100) * base / baseReal - 1) * 100) : null;
    }
  }

  return {
    anio_aplicacion: ctx.anio,
    anios_permitidos: ctx.aniosPermitidos,
    anio_en_curso: ctx.y,
    ultimo_mes_cerrado: ctx.hasta,
    proyeccion_referencia: proyeccionRefApi(ctx),
    proyecciones_disponibles: proyeccionesDisponibles(ctx),
    filas: calculados.map((x) => x.fila),
    resto: calculadoResto.fila,
    total: { pct_ponderado: pctPonderado, base, sin_aprobar: sinAprobar, pct_real: pctReal },
    huella_datos: ctx.huella_datos,
    anio_siguiente_atipico: anioSiguienteAtipicoDe(ctx),
  };
}

/** D7: los meses de `Y+1` marcados como atípicos (de invierno o verano); `null` si el año siguiente es normal. */
function anioSiguienteAtipicoDe(ctx: ContextoGM): { meses: string[] } | null {
  const meses = mesesAtipicosDelAnio(ctx.anio, ctx.periodos, ["invierno", "verano"]);
  return meses.length > 0 ? { meses } : null;
}

function conjuntoDe(ctx: ContextoGM, clave: ClaveGeneroMundo): Conjunto | null {
  const { gms, resto } = armarConjuntos(ctx);
  if (clave.alcance === "resto") return resto;
  const k = claveRutaGM(clave.genero_id, clave.mundo_id);
  return gms.find((c) => c.clave === k) ?? null;
}

const aviso = (codigo: string, mensaje: string, detalle?: string[]): AvisoGMApi => (detalle ? { codigo, mensaje, detalle } : { codigo, mensaje });
const coma = (n: number) => String(r2(n)).replace(".", ",");

/** El año normal más cercano a `Y` para el verano (`referenciaVolumen`): sin meses atípicos de verano y con los doce meses publicados. */
function anioReferenciaVerano(ctx: ContextoGM): number | null {
  const normales = aniosPublicados(ctx.publicados).filter(
    (z) => z !== ctx.y && mesesPublicadosDe(ctx.publicados, z) === 12 && claseDeAnio(z, { temporada: "verano" }, ctx.periodos, [...ctx.publicados]).meses_atipicos.length === 0
  );
  return referenciaVolumen(ctx.y, normales);
}

/** Detalle de un GM o del Resto; `null` si no hay ni venta, ni versión aprobada ni filas base de ese GM. */
export function armarDetalle(ctx: ContextoGM, clave: ClaveGeneroMundo): DetalleGeneroMundoApi | null {
  const c = conjuntoDe(ctx, clave);
  if (!c) return null;
  const calc = calcularConjunto(ctx, c);
  const cy = ctx.comparables(ctx.y);
  const conVenta = tiendasConVenta(c.entradas);
  const ids = [...cy].filter((t) => conVenta.has(t)).sort((a, b) => (ctx.codigos.get(a) ?? a).localeCompare(ctx.codigos.get(b) ?? b));
  const fuera = [...conVenta]
    .filter((t) => !cy.has(t))
    .sort((a, b) => (ctx.codigos.get(a) ?? a).localeCompare(ctx.codigos.get(b) ?? b))
    .map((t) => ({ tienda_id: t, motivo: motivoFuera(ctx.redes, ctx.y, t) ?? "fuera de la red" }));

  const aniosVenta = aniosPublicados(ctx.publicados);
  const ultimoAnio = Math.min(ctx.y, aniosVenta[aniosVenta.length - 1] ?? ctx.y);
  const primerAnio = Math.max(aniosVenta[0] ?? ctx.y, ctx.y - 3);
  const anios: number[] = [];
  for (let a = primerAnio; a <= ultimoAnio; a++) anios.push(a);
  const datos = ctx.referencia?.datos ?? null;
  const valida = datos !== null && datos.estado === "valida";
  const tiendasGrafico = new Set(ids);
  const cierreCy = calc.cierre.cy;
  const series = armarSeriesAnios({
    entradas: c.entradas,
    tiendas: tiendasGrafico,
    anios,
    publicados: ctx.publicados,
    y: ctx.y,
    k: ctx.k,
    phi: ctx.phi,
    cierreY: cierreCy.motivo_nulo === null && cierreCy.cierre !== null ? { meses: cierreCy.meses, corregidos: cierreCy.meses_corregidos } : null,
  });
  const bandas = bandasNino(c.entradas, anios, ctx.periodos, ctx.factores, ctx.publicados);
  const parcial = bandas.some((b) => b.parcial && b.anio === ctx.y);
  const hayNino = calc.fila.hay_nino === true;

  // La serie corregida de `Y` (solo con Niño material): lo vendido ÷ φ hasta `k` y el cierre corregido después.
  const serieY = series.find((s) => s.anio === ctx.y);
  const serieCorregida =
    hayNino && serieY
      ? (() => {
          const meses = serieY.meses_sin_nino;
          const total = r2(meses.reduce<number>((a, v) => a + (v ?? 0), 0));
          const completo = meses.every((v) => v !== null);
          return {
            ...serieY,
            meses,
            total,
            total_sin_nino: total,
            forma: meses.map((v) => (completo && total > 0 && v !== null ? redondear((v / total) * 100, 4) : null)),
          };
        })()
      : null;

  // «Cómo crece el verano atípicamente» del GM (solo informativo).
  const mesesVerano = claseDeAnio(ctx.y, { temporada: "verano" }, ctx.periodos, [...ctx.publicados]).meses_atipicos;
  const diagnosticoVerano =
    temporadasConVenta(c).includes("verano") && mesesVerano.length > 0
      ? diagnosticoVeranoGM({
          entradasVerano: c.entradas.filter((e) => e.temp === "verano"),
          control: ctx.venta.series.filter((s) => s.temp === "todo_el_ano"),
          y: ctx.y,
          anioRef: anioReferenciaVerano(ctx),
          publicados: ctx.publicados,
          mesesPeriodo: Array.from({ length: 12 }, (_, m) => mesesVerano.includes(aPeriodo(ctx.y, m + 1))),
          redes: ctx.redes,
        })
      : null;

  const avisos: AvisoGMApi[] = [];
  if (ids.length === 0) avisos.push(aviso("sin_venta_comparable", "Este grupo no tiene venta comparable: ninguna tienda estuvo abierta todo el periodo comparado con venta de este género y mundo."));
  const sinFactor = calc.factores_y.filter((f) => f.efectivo === null).map((f) => `${f.temporada} ${f.anio}`);
  const sinFactorOtros = bandas.filter((b) => b.factor === null && b.anio !== ctx.y).map((b) => `${b.temporada} ${b.anio}`);
  if (sinFactor.length > 0 || sinFactorOtros.length > 0) {
    avisos.push(aviso("sin_factor", "Hay meses marcados como atípicos sin factor del Niño: se usó 1 (sin corrección) en esos meses y no podrás cerrar la proyección.", [...sinFactor, ...sinFactorOtros]));
  }
  if (parcial) avisos.push(aviso("factor_parcial", `El factor del Niño de ${ctx.y} es parcial (solo cubre hasta el último mes cerrado): las cifras corregidas son provisionales.`));
  const desactualizados = calc.factores_y.filter((f) => f.estado === "desfasado").map((f) => `${f.temporada} ${f.anio}`);
  if (desactualizados.length > 0) avisos.push(aviso("factor_desfasado", "El factor del Niño se calculó con datos viejos: pulsa «Sincronizar» en Proyección → Factores del Niño.", desactualizados));
  const porConfirmar = calc.factores_y.filter((f) => f.estado === "sin_confirmar").map((f) => `${f.temporada} ${f.anio}`);
  if (porConfirmar.length > 0) avisos.push(aviso("factor_sin_confirmar", "El factor del Niño es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Proyección → Factores del Niño (el mismo valor lo confirma).", porConfirmar));
  const cierre = calc.fila.cierre;
  if (hayNino && cierre && cierre.cierre_corregido !== null) {
    const frente = cierre.pct_corregido === null ? "" : `, ${cierre.pct_corregido >= 0 ? "+" : ""}${coma(cierre.pct_corregido)} % frente a ${ctx.y - 1}`;
    avisos.push(aviso("anio_nino", `${ctx.y} fue Niño para este grupo: el % de ${ctx.anio} se escribe sobre ${ctx.y} corregido (${Math.round(cierre.cierre_corregido)} u en las mismas tiendas${frente}).`));
  }
  if (cierre?.motivo_nulo === "meses_faltantes") avisos.push(aviso("meses_faltantes", `Faltan meses publicados de ${ctx.y}: el cierre por curva no se puede calcular.`));
  if (cierre?.motivo_nulo === "sin_curva") avisos.push(aviso("sin_curva", "Alguna agrupación con venta no tiene curva vigente y el grupo no tiene ninguna otra: el cierre por curva no se puede calcular."));
  else if (cierre?.sin_curva_pct) avisos.push(aviso("sin_curva", `El ${coma(cierre.sin_curva_pct)} % de lo vendido se cerró con la curva compuesta del grupo: alguna agrupación no tiene curva vigente.`));
  if (cierre?.avance_bajo) avisos.push(aviso("avance_bajo", `El avance de la curva es bajo: el cierre por curva es frágil y la base por defecto es el año completo ${ctx.y - 1}.`, cierre.agrupaciones_avance_bajo));
  const mesesAtipicoGM = mesesAtipicosDelAnio(ctx.anio, ctx.periodos, temporadasConVenta(c));
  if (mesesAtipicoGM.length > 0) avisos.push(aviso("anio_siguiente_atipico", mensajeAnioSiguienteAtipico(ctx.anio), mesesAtipicoGM));
  if (!ctx.referencia) avisos.push(aviso("sin_proyeccion_referencia", `No hay proyección de ${ctx.y} calculada con el método actual: recalcula la proyección para ver «Aplicado hoy» y la base de ${ctx.anio} que usa M7.`));
  else if (datos?.estado === "metodo_anterior") avisos.push(aviso("metodo_anterior", "La proyección de referencia se calculó con un método anterior: recálculala para ver lo aplicado hoy y la base."));
  else if (datos?.estado === "sin_base") avisos.push(aviso("sin_base", "La proyección de referencia no tiene base para el año siguiente: recálculala."));

  const vigente = calc.vigente;
  const reaprobar = vigente && sobreBaseDe(vigente) === "bruta" && hayNino && valida ? calcularReaprobar(c.filas, Number(vigente.pct)) : null;
  const baseP = calc.ref.base_siguiente;
  const cierreProyeccion = valida && ctx.referencia && baseP !== null && calc.ref.base_corregida !== null ? { nombre: ctx.referencia.proyeccion.nombre, base: r2(baseP), base_corregida: r2(calc.ref.base_corregida) } : null;

  return {
    ...calc.fila,
    tiendas: { n: ids.length, ids, fuera },
    series,
    forma_tipica: formaTipica(c.entradas, tiendasGrafico, series, ctx.phi),
    bandas_nino: bandas,
    factores_parciales: parcial,
    referencias: calc.ref.todas,
    rebote_nino_pct: calc.ref.rebote_nino_pct,
    versiones: calc.versiones.map((v) => aVersionApi(v, ctx.proyecciones, calc.equivalentes.get(v.id) ?? null)),
    avisos,
    huella_datos: ctx.huella_datos,
    cierre_por_agrupacion: calc.cierre.por_agrupacion,
    serie_corregida: serieCorregida,
    serie_base_curva: calc.cierre.serie_base_curva,
    factores_y: calc.factores_y,
    diagnostico_verano_gm: diagnosticoVerano,
    cierre_proyeccion: cierreProyeccion,
    reaprobar,
  };
}

// ─── Aprobar ───

const enTrabajoDelAnio = (ctx: ContextoGM) => ctx.proyecciones.filter((p) => p.estado === "en_trabajo" && p.anio_en_curso === ctx.y);

/** I3: el GM tiene filas base en alguna proyección en trabajo de `anio − 1` (algún valor de `resumen.gm_gml` es esa clave). */
function conFilasBaseEnTrabajo(ctx: ContextoGM, c: Conjunto): boolean {
  if (c.alcance !== "gm") return false;
  const gm = claveGM(c.genero_id as string, c.mundo_id as string);
  return enTrabajoDelAnio(ctx).some((p) => Object.values(leerResumen(p).gm_gml).includes(gm));
}

const esUnique = (e: { code?: string }) => e.code === "23505";

/** Los factores de `Y` de la foto de una versión: lo que se usó y de dónde salió (`referencia.factores`, 06e §3.1). */
function factoresParaFoto(ctx: ContextoGM, factores: readonly FactorYApi[]) {
  return factores.map((f) => {
    const fila = ctx.factoresDb.find((x) => x.anio === f.anio && x.temporada === f.temporada);
    return { anio: f.anio, temporada: f.temporada, efectivo: f.efectivo, origen: f.origen, formula: fila?.formula ?? null, parcial: f.parcial, huella_cargas: fila?.huella_cargas ?? null };
  });
}

/**
 * `POST /api/curvas/genero-mundo/[clave]` ya con el cuerpo validado por zod (y sin bases retiradas: el handler responde `400 base_retirada`
 * antes de llegar aquí). Orden de los rechazos: `anio_no_permitido` y `referencia_otro_anio` (al leer) · `404` · `anio_siguiente_atipico`
 * (D7, R25) · `datos_cambiados` · `base_invalida` · `genero_no_detallado` · `mundo_inactivo` · `vigente_cambiada` · `sin_cambio` (compara también
 * `sobre_base`, R13) · `nota_requerida` (R-N, con la variante `bruto` en un GM con Niño, R12). Sin transacción: pasa la vigente a `reemplazada`
 * con un `UPDATE` condicional y, si el alta falla, la restaura. Escribe `sobre_base = 'corregida'` explícito. NO escribe en ninguna proyección.
 */
export async function aprobarCrecimiento(
  db: Db,
  args: { clave: string; datos: AprobarCrecimientoValidado; hoy: string; perfil: Pick<Tables<"perfiles">, "id" | "nombre" | "email"> }
): Promise<NextResponse> {
  const clave = leerClaveGeneroMundo(args.clave);
  if (!clave) return errorConCodigo("La clave no es válida: usa «resto» o «<género>.<mundo>».", 400, "clave_invalida");
  const { datos } = args;

  const leido = await cargarContexto(db, { anio: datos.anio, proyeccion: null }, args.hoy, { referencia: { id: datos.proyeccion_referencia_id } });
  if (leido.respuesta) return leido.respuesta;
  const ctx = leido.data;

  const conjunto = conjuntoDe(ctx, clave);
  if (!conjunto) return error("No hay venta, filas base ni crecimiento aprobado para ese género y mundo.", 404);
  const detalle = armarDetalle(ctx, clave);
  if (!detalle) return error("No hay venta, filas base ni crecimiento aprobado para ese género y mundo.", 404);

  // D7: con meses atípicos marcados en `Y+1` no se aprueba nada (ni se escribe) hasta quitar la marca o decidir cómo modelarlos.
  const atipico = motivoRechazoAnioSiguienteAtipico(ctx.anio, mesesAtipicosDelAnio(ctx.anio, ctx.periodos, temporadasConVenta(conjunto)));
  if (atipico) return rechazar(atipico);

  if (datos.huella_datos !== ctx.huella_datos) return errorConCodigo("Los datos cambiaron mientras tanto (una carga nueva, un cambio en el árbol, una curva o un factor, o la proyección recalculada): vuelve a cargar.", 409, "datos_cambiados");

  const rechazoBase = motivoRechazoBaseAnio(datos.base, ctx.y, detalle.referencias);
  if (rechazoBase) return rechazar(rechazoBase);
  const rechazoGM = motivoRechazoGeneroMundo({
    alcance: conjunto.alcance,
    detallables: ctx.detallables,
    genero_id: conjunto.genero_id,
    mundo_activo: conjunto.mundo_activo,
    con_filas_base_en_trabajo: conFilasBaseEnTrabajo(ctx, conjunto),
  });
  if (rechazoGM) return rechazar(rechazoGM);

  const ref = detalle.referencias.find((r: ReferenciaApi) => r.tipo === datos.base.tipo && (datos.base.tipo !== "anio_completo" || r.anio === datos.base.anio));
  const baseValor = datos.base.tipo === "ninguna" ? null : valorDeBase(ref, datos.base.variante);
  const base = { tipo: datos.base.tipo, anio: datos.base.anio, variante: datos.base.variante, valor: baseValor };
  const vigenteApi = detalle.vigente;
  const vigente: VersionParaComparar | null = vigenteApi
    ? { version: vigenteApi.version, pct: vigenteApi.pct, nota: vigenteApi.nota, base: vigenteApi.base, obsoleta: detalle.estado === "obsoleto", sobre_base: vigenteApi.sobre_base ?? "bruta" }
    : null;
  const hayNino = detalle.hay_nino === true;
  const rechazo = motivoRechazoAprobar({
    vigente,
    version_vigente: datos.version_vigente,
    nueva: { pct: datos.pct, nota: datos.nota, base, sobre_base: "corregida" },
    nota: { hay_nino: hayNino, periodo_toca_nino: ref ? periodoTocaNino(ref, conjunto.entradas, ctx.phi) : false },
  });
  if (rechazo) return rechazar(rechazo);

  const vigenteDb = vigenteApi ? ctx.versiones.find((v) => v.id === vigenteApi.id) : undefined;
  if (vigenteDb) {
    const movida = await reemplazarVigente(db, vigenteDb.id);
    if (movida.error) return traducirErrorDb(movida.error, "aprobar crecimiento: reemplazar la vigente");
    if (!movida.data) return errorConCodigo("Otra persona aprobó un crecimiento para este género y mundo mientras tanto: vuelve a cargar.", 409, "vigente_cambiada");
  }

  const elegida = ctx.referencia?.proyeccion ?? null;
  const kM = detalle.cierre?.base_curva?.real ?? null;
  const kMc = detalle.cierre?.base_curva?.corregida ?? null;
  const valida = ctx.referencia?.datos.estado === "valida";
  const equivalenteRealNuevo = valida && detalle.base_siguiente !== null ? equivalenteReal(datos.pct, detalle.base_siguiente, detalle.base_corregida ?? null) : equivalenteReal(datos.pct, kM, kMc);
  const conVentaConjunto = tiendasConVenta(conjunto.entradas);
  const foto = {
    version_foto: 2,
    metodo: 5,
    sobre_base: "corregida" as const,
    base: { tipo: base.tipo, anio: base.anio, variante: base.variante },
    y: ctx.y,
    k: ctx.k === null ? null : aPeriodo(ctx.y, ctx.k),
    referencias: detalle.referencias,
    rebote_nino_pct: detalle.rebote_nino_pct,
    tiendas: { n: detalle.tiendas.n, ids: detalle.tiendas.ids },
    tiendas_cy: detalle.tiendas.ids,
    tiendas_m: [...ctx.mismasSiguiente].filter((t) => conVentaConjunto.has(t)).sort(),
    cierre: detalle.cierre ?? null,
    cierre_por_agrupacion: detalle.cierre_por_agrupacion ?? [],
    factores: factoresParaFoto(ctx, detalle.factores_y ?? []),
    serie_corregida: detalle.serie_corregida ?? null,
    base_siguiente: detalle.base_siguiente,
    base_corregida: detalle.base_corregida ?? null,
    correccion_nino_pct: detalle.correccion_nino_pct ?? null,
    equivalente_real: equivalenteRealNuevo,
    huella_datos: ctx.huella_datos,
    gml_ids: conjunto.gml_ids,
    avisos: detalle.avisos.map((a) => a.codigo),
    proyeccion: elegida ? { id: elegida.id, nombre: elegida.nombre, calculado_at: elegida.calculado_at, version_metodo: ctx.referencia?.version_metodo ?? null } : null,
  };
  const { data: nueva, error: errInsert } = await insertarVersion(db, {
    anio_aplicacion: ctx.anio,
    alcance: conjunto.alcance,
    genero_id: conjunto.genero_id,
    mundo_id: conjunto.mundo_id,
    version: siguienteVersion(versionesDe(ctx, conjunto)),
    estado: "vigente",
    pct: datos.pct,
    sobre_base: "corregida",
    nota: datos.nota,
    base_tipo: datos.base.tipo,
    base_valor: baseValor,
    referencia: comoJson(foto),
    proyeccion_referencia_id: elegida?.id ?? null,
    perfil_id: args.perfil.id,
    usuario_nombre: nombreDeUsuario(args.perfil),
  });
  if (errInsert) {
    if (vigenteDb) await restaurarVigente(db, vigenteDb.id);
    if (esUnique(errInsert)) return errorConCodigo("Otra persona aprobó un crecimiento para este género y mundo mientras tanto: vuelve a cargar.", 409, "vigente_cambiada");
    return traducirErrorDb(errInsert, "aprobar crecimiento: guardar la versión nueva");
  }

  const cuerpo: RespuestaAprobarCrecimientoApi = {
    vigente: aVersionApi(nueva, ctx.proyecciones, equivalenteRealNuevo),
    proyecciones_desactualizadas: enTrabajoDelAnio(ctx).map((p) => ({ id: p.id, nombre: p.nombre })),
  };
  return ok(cuerpo, 201);
}
