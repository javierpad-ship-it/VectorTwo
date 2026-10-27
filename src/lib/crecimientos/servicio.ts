import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { error, errorConCodigo, ok } from "@/lib/api/respuestas";
import { leerNodos } from "@/lib/arbol/consultas";
import { anioDe, hastaPorDefecto, redondear } from "@/lib/curvas/anios";
import { claseDeAnio } from "@/lib/curvas/atipicos";
import { aPeriodoApi, leerCargasPublicadas, leerPeriodos, leerTiendas } from "@/lib/curvas/consultas";
import { huellaCargas, huellaRed } from "@/lib/curvas/huellas";
import { calcularPromedio, claveGM, generosDeMatriz } from "@/lib/proyeccion/crecimientos";
import { leerCrecimientos, leerFactoresDb, leerFilasConAnios, leerGenerosMundos, listarProyeccionesDb, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import { comoObjeto, nombreDeUsuario } from "@/lib/ventas/http";
import { aPeriodo } from "@/lib/ventas/periodo";
import { aniosDeRed, calcularRedes, comparablesDe, motivoFuera, ventaTotalPorTienda, type RedesPorAnio } from "./comparables";
import { insertarVersion, leerMarcasArbol, leerVentaGeneroMundo, leerVersionesDeAnio, reemplazarVigente, restaurarVigente, type VersionDb } from "./consultas";
import { leerClaveGeneroMundo, type AprobarCrecimientoValidado, type ClaveGeneroMundo, type ConsultaGeneroMundo } from "./esquemas";
import { huellaDatosGM, huellaFactoresNino, huellaPeriodosNino } from "./huellas";
import { leerVentaGMCacheada } from "./cache";
import {
  agregadoDe,
  calcularReferencias,
  estadoDeProyeccion,
  proyectadoDeFilas,
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
  motivoRechazoAnio,
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
  type FilaGMApi,
  type ListaGeneroMundoApi,
  type ProyeccionReferenciaApi,
  type ReferenciaApi,
  type RespuestaAprobarCrecimientoApi,
  type VarianteBase,
  type VersionCrecimientoApi,
} from "./tipos-api";

/**
 * Servicio de 06d (solo servidor): lee los datos una vez (`cargarContexto`), arma la lista y el detalle (`armarLista`,
 * `armarDetalle`) y aprueba una versión (`aprobarCrecimiento`). Las reglas están en `reglas.ts` y las cifras en `referencias.ts`;
 * aquí solo se orquesta. NO escribe en ninguna proyección: lo único que escribe es `crecimientos_genero_mundo`.
 */

type Db = SupabaseClient<Database>;
type Leido<T> = { data: T; respuesta: null } | { data: null; respuesta: NextResponse };

const listo = <T>(data: T): Leido<T> => ({ data, respuesta: null });
const falla = (respuesta: NextResponse): Leido<never> => ({ data: null, respuesta });
const r2 = (n: number) => redondear(n, 2);
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
  aniosCompletos: number[];
  phi: Phi;
  periodos: ReturnType<typeof aPeriodoApi>[];
  factores: FactorConParcial[];
  generos: GeneroMundoCatalogo[];
  mundos: GeneroMundoCatalogo[];
  detallables: ReadonlySet<string>;
  nodos: Tables<"genero_mundo_linea">[];
  versiones: VersionDb[];
  proyecciones: ProyeccionDb[];
  referencia: ReferenciaElegida | null;
  huella_datos: string;
};

const aFactor = (f: Tables<"factores_volumen_atipico">): FactorConParcial => ({
  anio: f.anio,
  temporada: f.temporada === "verano" ? "verano" : "invierno",
  ratio_calculado: f.ratio_calculado === null ? null : Number(f.ratio_calculado),
  ratio_aplicado: f.ratio_aplicado === null ? null : Number(f.ratio_aplicado),
  parcial: f.parcial,
});

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Datos de `resumen` y `parametros` de una proyección que usan las cifras. */
function leerResumen(p: ProyeccionDb): { version_metodo: number | null; gm_gml: Record<string, string> } {
  const resumen = comoObjeto(p.resumen);
  const gm = comoObjeto(resumen?.gm_gml);
  const gm_gml: Record<string, string> = {};
  for (const [k, v] of Object.entries(gm ?? {})) if (typeof v === "string") gm_gml[k] = v;
  return { version_metodo: num(resumen?.version_metodo), gm_gml };
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

function restoAplicadoDe(p: ProyeccionDb): number {
  const parametros = comoObjeto(p.parametros);
  const usado = num(comoObjeto(parametros?.crecimiento_resto_usado)?.pct);
  return usado ?? num(parametros?.crecimiento_pct_defecto) ?? 0;
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
 * Lee todo lo que la lista, el detalle y el `POST` necesitan, una sola vez: cargas, tiendas, periodos y factores del Niño, árbol,
 * catálogo, proyecciones, versiones del año, la venta por GM (por la caché de memoria) y la proyección de referencia. Valida el año
 * (`400 anio_no_permitido`) y la referencia (`400 referencia_otro_anio`). `409 sin_datos` si ningún mes está publicado y cerrado.
 */
export async function cargarContexto(db: Db, consulta: ConsultaGeneroMundo, hoy: string, opciones: { referencia?: { id: string | null } } = {}): Promise<Leido<ContextoGM>> {
  const [cargas, tiendas, periodos, factores, nodos, catalogo, proyecciones, marcas] = await Promise.all([
    leerCargasPublicadas(db),
    leerTiendas(db),
    leerPeriodos(db, { soloActivos: true }),
    leerFactoresDb(db),
    leerNodos(db),
    leerGenerosMundos(db),
    listarProyeccionesDb(db),
    leerMarcasArbol(db),
  ]);
  const fallo = cargas.error ?? tiendas.error ?? periodos.error ?? factores.error ?? nodos.error ?? catalogo.error ?? proyecciones.error ?? marcas.error;
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
      VERSION_METODO
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
  const factoresProy: FactorConParcial[] = factores.data.filter((f) => f.activo).map(aFactor);
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
  const aniosCompletos = [y - 1, y - 2].filter((z) => mesesPublicadosDe(publicados, z) === 12 && mesesPublicadosDe(publicados, z - 1) > 0);
  const k = y < anioHasta ? 12 : y === anioHasta ? Number(hasta.slice(5, 7)) : null;
  const detallables = new Set(generosDeMatriz(catalogo.generos).map((g) => g.id));

  // La proyección de referencia: solo se leen sus filas si es de un método con `B` (≥ 4).
  let referencia: ReferenciaElegida | null = null;
  if (elegida) {
    const resumen = leerResumen(elegida);
    const metodoOk = (resumen.version_metodo ?? 0) >= VERSION_METODO;
    let filas: FilaBase[] = [];
    const pctPorGM = new Map<string, number>();
    if (metodoOk) {
      const [leidas, foto] = await Promise.all([leerFilasConAnios(db, elegida.id, { columnas: "ligeras", tiendaId: null, soloActivas: true }), leerCrecimientos(db, elegida.id)]);
      const f = leidas.error ?? foto.error;
      if (f) return falla(traducirErrorDb(f, "crecimientos por género y mundo: leer la proyección de referencia"));
      filas = filasBaseDe(leidas.data, resumen.gm_gml, y);
      for (const c of foto.data) pctPorGM.set(claveGM(c.genero_id, c.mundo_id), Number(c.pct));
    }
    referencia = {
      proyeccion: elegida,
      version_metodo: resumen.version_metodo,
      datos: { estado: estadoDeProyeccion(resumen.version_metodo, filas), mismas: tiendasMismasDe(elegida, y), filas, pctPorGM, restoPct: restoAplicadoDe(elegida) },
    };
  }

  const huella = huellaDatosGM({
    anio,
    cargas_huella: cargasHuella,
    marcas: marcas.data,
    red_huella: huellaRed(tiendas.data),
    periodos_huella: huellaPeriodosNino(periodosApi),
    factores_huella: huellaFactoresNino(factoresProy),
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
    aniosCompletos,
    phi,
    periodos: periodosApi,
    factores: factoresProy,
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

// ─── De la fila de la base a la API ───

type BaseGuardada = { tipo: BaseCrecimiento; anio: number | null; variante: VarianteBase };

function baseDe(v: VersionDb): BaseGuardada {
  const base = comoObjeto(comoObjeto(v.referencia)?.base);
  const anio = num(base?.anio);
  return {
    tipo: (v.base_tipo as BaseCrecimiento) ?? "ninguna",
    anio,
    variante: base?.variante === "sin_nino_mas_rebote" ? "sin_nino_mas_rebote" : "bruto",
  };
}

function gmlIdsDe(v: VersionDb): string[] {
  const ids = comoObjeto(v.referencia)?.gml_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

export function aVersionApi(v: VersionDb, proyecciones: readonly ProyeccionDb[]): VersionCrecimientoApi {
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
    por_nombre: v.usuario_nombre,
    aprobada_at: v.aprobada_at,
    proyeccion_referencia: v.proyeccion_referencia_id ? { id: v.proyeccion_referencia_id, nombre: nombre ?? "" } : null,
  };
}

type Calculado = {
  c: Conjunto;
  ref: ResultadoReferencias;
  fila: FilaGMApi;
  versiones: VersionDb[];
  vigente: VersionDb | null;
};

function calcularConjunto(ctx: ContextoGM, c: Conjunto): Calculado {
  const datos = ctx.referencia?.datos ?? null;
  const valida = datos !== null && datos.estado === "valida";
  const gm = c.alcance === "gm" ? claveGM(c.genero_id as string, c.mundo_id as string) : null;
  const pctAplicado = valida && datos ? (gm !== null && c.detallable ? (datos.pctPorGM.get(gm) ?? datos.restoPct) : datos.restoPct) : null;
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
  });
  const versiones = versionesDe(ctx, c);
  const vigente = c.detallable ? (versiones.find((v) => v.estado === "vigente") ?? null) : null;
  const motivo = vigente ? evaluarObsoleto({ base: { ...baseDe(vigente), valor: vigente.base_valor === null ? null : Number(vigente.base_valor) }, gml_ids: gmlIdsDe(vigente) }, ref.todas, new Set(c.gml_ids)) : null;
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
    vigente: vigente ? aVersionApi(vigente, ctx.proyecciones) : null,
    estado: estadoDeGM(vigente !== null, motivo),
    motivo_obsoleto: motivo,
    sigue: c.alcance === "resto" || (c.detallable && vigente !== null) ? "propio" : "resto",
  };
  return { c, ref, fila, versiones, vigente };
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
    .filter((p) => p.id === elegida || (p.calculado_at !== null && (p.version_metodo ?? 0) >= VERSION_METODO));
}

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
  let base = 0;
  if (valida && datos) {
    const restoPct = calculadoResto.vigente ? Number(calculadoResto.vigente.pct) : datos.restoPct;
    const promedio = calcularPromedio(
      detallables.map((x) => ({
        genero: x.c.genero as string,
        mundo: x.c.mundo as string,
        pct: x.vigente ? Number(x.vigente.pct) : restoPct,
        sin_filas: x.c.filas.length === 0,
        agregado: agregadoDe(x.c.filas),
      })),
      { pct: restoPct, agregado: agregadoDe(resto.filas) },
      null,
      PUENTE_CERO
    );
    if (promedio.resultado) {
      pctPonderado = promedio.resultado.ponderado_escrito_pct === null ? null : r2(promedio.resultado.ponderado_escrito_pct);
      base = promedio.resultado.base_total;
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
    total: { pct_ponderado: pctPonderado, base, sin_aprobar: sinAprobar },
    huella_datos: ctx.huella_datos,
  };
}

function conjuntoDe(ctx: ContextoGM, clave: ClaveGeneroMundo): Conjunto | null {
  const { gms, resto } = armarConjuntos(ctx);
  if (clave.alcance === "resto") return resto;
  const k = claveRutaGM(clave.genero_id, clave.mundo_id);
  return gms.find((c) => c.clave === k) ?? null;
}

const aviso = (codigo: string, mensaje: string, detalle?: string[]): AvisoGMApi => (detalle ? { codigo, mensaje, detalle } : { codigo, mensaje });
const coma = (n: number) => String(r2(n)).replace(".", ",");

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
  const proyectado = datos && datos.estado === "valida" ? proyectadoDeFilas(c.filas, ctx.y, ctx.phi) : null;
  const tiendasGrafico = new Set(ids);
  const series = armarSeriesAnios({ entradas: c.entradas, tiendas: tiendasGrafico, anios, publicados: ctx.publicados, y: ctx.y, k: ctx.k, phi: ctx.phi, proyectado });
  const bandas = bandasNino(c.entradas, anios, ctx.periodos, ctx.factores, ctx.publicados);
  const parcial = bandas.some((b) => b.parcial && b.anio === ctx.y);

  const avisos: AvisoGMApi[] = [];
  if (ids.length === 0) avisos.push(aviso("sin_venta_comparable", "Este grupo no tiene venta comparable: ninguna tienda estuvo abierta todo el periodo comparado con venta de este género y mundo."));
  const sinFactor = bandas.filter((b) => b.factor === null).map((b) => `${b.temporada} ${b.anio}`);
  if (sinFactor.length > 0) avisos.push(aviso("sin_factor", "Hay meses marcados como atípicos sin factor del Niño: se usó 1 (sin corrección) en esos meses.", sinFactor));
  if (parcial) avisos.push(aviso("factor_parcial", `El factor del Niño de ${ctx.y} es parcial (solo cubre hasta el último mes cerrado): las cifras sin Niño son provisionales.`));
  if (calc.ref.acumulado.variante_defecto === "sin_nino_mas_rebote") {
    const eq = calc.ref.acumulado.equivalente.sin_nino_mas_rebote;
    avisos.push(aviso("anio_nino", `${ctx.y} fue Niño para este grupo: compara con las cifras sin Niño + rebote${eq === null ? "" : ` (${eq >= 0 ? "+" : ""}${coma(eq)} %)`}.`));
  }
  const atipicoSiguiente = (["invierno", "verano"] as const).filter((t) => c.entradas.some((e) => e.temp === t) && claseDeAnio(ctx.anio, { temporada: t }, ctx.periodos, [...ctx.publicados]).meses_atipicos.length > 0);
  if (atipicoSiguiente.length > 0) avisos.push(aviso("anio_siguiente_atipico", `${ctx.anio} tiene meses marcados como atípicos (${atipicoSiguiente.join(", ")}): tu porcentaje bruto debe incluirlo.`));
  if (!ctx.referencia) avisos.push(aviso("sin_proyeccion_referencia", `No hay proyección de ${ctx.y} calculada con el método actual: recalcula la proyección para ver «Cierre proyectado», «Aplicado hoy» y la base ${ctx.anio}.`));
  else if (datos?.estado === "metodo_anterior") avisos.push(aviso("metodo_anterior", "La proyección de referencia se calculó con un método anterior: recálculala para ver el cierre proyectado, lo aplicado hoy y la base."));
  else if (datos?.estado === "sin_base") avisos.push(aviso("sin_base", "La proyección de referencia no tiene base para el año siguiente: recálculala."));

  return {
    ...calc.fila,
    tiendas: { n: ids.length, ids, fuera },
    series,
    forma_tipica: formaTipica(c.entradas, tiendasGrafico, series, ctx.phi),
    bandas_nino: bandas,
    factores_parciales: parcial,
    referencias: calc.ref.todas,
    rebote_nino_pct: calc.ref.rebote_nino_pct,
    versiones: calc.versiones.map((v) => aVersionApi(v, ctx.proyecciones)),
    avisos,
    huella_datos: ctx.huella_datos,
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

/**
 * `POST /api/curvas/genero-mundo/[clave]` ya con el cuerpo validado por zod. Orden de los rechazos: `anio_no_permitido` y
 * `referencia_otro_anio` (al leer) · `404` · `datos_cambiados` · `base_invalida` · `genero_no_detallado` · `mundo_inactivo` ·
 * `vigente_cambiada` · `sin_cambio` · `nota_requerida`. Sin transacción: pasa la vigente a `reemplazada` con un `UPDATE` condicional
 * y, si el alta falla, la restaura. NO escribe en ninguna proyección.
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

  if (datos.huella_datos !== ctx.huella_datos) return errorConCodigo("Los datos cambiaron mientras tanto (una carga nueva, un cambio en el árbol o la proyección recalculada): vuelve a cargar.", 409, "datos_cambiados");

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
  const vigente: VersionParaComparar | null = vigenteApi ? { version: vigenteApi.version, pct: vigenteApi.pct, nota: vigenteApi.nota, base: vigenteApi.base, obsoleta: detalle.estado === "obsoleto" } : null;
  const rechazo = motivoRechazoAprobar({ vigente, version_vigente: datos.version_vigente, nueva: { pct: datos.pct, nota: datos.nota, base } });
  if (rechazo) return rechazar(rechazo);

  const vigenteDb = vigenteApi ? ctx.versiones.find((v) => v.id === vigenteApi.id) : undefined;
  if (vigenteDb) {
    const movida = await reemplazarVigente(db, vigenteDb.id);
    if (movida.error) return traducirErrorDb(movida.error, "aprobar crecimiento: reemplazar la vigente");
    if (!movida.data) return errorConCodigo("Otra persona aprobó un crecimiento para este género y mundo mientras tanto: vuelve a cargar.", 409, "vigente_cambiada");
  }

  const elegida = ctx.referencia?.proyeccion ?? null;
  const foto = {
    version_foto: 1,
    base: { tipo: base.tipo, anio: base.anio, variante: base.variante },
    y: ctx.y,
    k: ctx.k === null ? null : aPeriodo(ctx.y, ctx.k),
    referencias: detalle.referencias,
    rebote_nino_pct: detalle.rebote_nino_pct,
    tiendas: { n: detalle.tiendas.n, ids: detalle.tiendas.ids },
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
    vigente: aVersionApi(nueva, ctx.proyecciones),
    proyecciones_desactualizadas: enTrabajoDelAnio(ctx).map((p) => ({ id: p.id, nombre: p.nombre })),
  };
  return ok(cuerpo, 201);
}

