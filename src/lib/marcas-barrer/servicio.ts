import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { leerEquivalencias } from "@/lib/arbol/consultas";
import { compararNombre } from "@/lib/arbol/armar-arbol";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { curvaFila } from "@/lib/proyeccion/curva-fila";
import { factoresMes } from "@/lib/proyeccion/nino";
import { cargarContextoCalculo, type ContextoCalculo } from "@/lib/proyeccion/contexto";
import { falla, fallaDb, fallaMensaje, listo, type Salida } from "@/lib/proyeccion/servicio-base";
import { leerProyeccionCerrada } from "@/lib/proyeccion/servicio";
import { miembrosPorCabeza, unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import { construirConfigFlujo, type ConfigFlujo } from "@/lib/marcas/gml/flujo";
import { cargarEstadoGml, type EstadoGmlCargado } from "@/lib/marcas/gml/estado";
import { marcaVigenteGml, type MarcaGml } from "@/lib/marcas/gml/reglas";
import { unidadesFlujoEspecial } from "@/lib/marcas/gml/vista";
import { modalidadEfectiva } from "@/lib/marcas/reglas";
import { analizarMarca, type EntradaAnalisis, type ResultadoAnalisis } from "./modelo";
import { aniosDeLaCerrada, type FilaCerrada } from "./cerrada";
import {
  eliminarVersion,
  fijarVigente,
  insertarFilasVersion,
  insertarVersion,
  leerResumenVenta,
  leerVentaMarcaGml,
  leerVersionesDeMarca,
  leerVersionesVigentes,
  primerDia,
  siguienteVersion,
} from "./consultas";
import {
  huellaCargasBarrer,
  huellaConfig,
  miembrosDeUnidad,
  motivosObsoleto,
  type HuellasReparto,
} from "./huellas";
import { mesesDeVentana, normalizarAlcance } from "./reparto";
import {
  adjuntarVigente,
  alcanceDe,
  aRepartoApi,
  armarVersion,
  diferenciaConVigente,
  errorDeLista,
  estadoDeReparto,
  fuenteDe,
  huellaConfigActual,
  huellaConfigDeVersion,
  modoDe,
  temporadasAGuardar,
  temporadasDeVersion,
  temporadasPorDefecto,
  type VersionLeida,
} from "./reglas";
import { veredictoError } from "./error";
import {
  UMBRAL_GML_PEQUENO,
  VENTANA_DEFECTO,
  type AlcanceApi,
  type AnalisisMarcaApi,
  type AvisoBarrer,
  type ListaBarrerApi,
  type MarcaBarrerResumenApi,
  type ModalidadBarrer,
  type ModoEntrada,
  type MotivoObsoleto,
  type RepartoApi,
  type RepartoVigenteApi,
  type RepartosVigentesApi,
  type TemporadasConfig,
  type Ventana,
} from "./tipos-api";
import type { ClaveG, DatosMarca, UnidadG } from "./tipos";
import type { AprobarReparto } from "./esquemas";

/**
 * Servicio de M12 (solo servidor): arma el contexto (marcas y configuración de 02b, árbol, curvas, factores del Niño), llama a
 * las funciones SQL por `consultas.ts` y a la lógica pura de este módulo, y devuelve `{ data, respuesta }` como el servicio
 * de M7: los datos o la respuesta HTTP con la que cortar. Los handlers abren el cliente con `supabaseAdmin()` y lo pasan.
 * NADA aquí aprueba un reparto por su cuenta ni lo recalcula: aprobar es una decisión del planner (o del administrador) que
 * queda a su nombre y con su fecha; un reparto obsoleto solo se marca.
 */

type Db = SupabaseClient<Database>;

export const NO_ENCONTRADA = "Marca no encontrada.";

// ─── Contexto ───

export type ContextoBarrer = {
  d: Db;
  gml: EstadoGmlCargado;
  ctx: ContextoCalculo;
  config: ConfigFlujo;
  /** `k` (`aaaa-mm`): último mes publicado y terminado; `null` si no hay ninguno. */
  hasta: string | null;
  marcas: readonly MarcaGml[];
  nivelDe: (gmlId: string) => "GML" | "GMLE";
  rutaDe: (gmlId: string, equivalenciaId: string | null) => string;
  unidadDe: (clave: ClaveG) => UnidadG | null;
  nombreEquivalencia: (id: string) => string;
  /** Las fechas de temporada con que se calcula HOY (las del defecto hasta que M8 las configure); no las de una versión aprobada. */
  temporadas: TemporadasConfig;
};

/** Marcas y árbol de 02b, catálogo, curvas vigentes y factores del Niño de M3 a M7: todo lo que el análisis lee fuera de la venta. */
export async function cargarContextoBarrer(d: Db): Promise<Salida<ContextoBarrer>> {
  const [gml, ctxR, equivalencias] = await Promise.all([
    cargarEstadoGml(d),
    cargarContextoCalculo(d, { conEat: false, conFlujo: false }),
    leerEquivalencias(d),
  ]);
  if (gml.error || !gml.estado) return falla(traducirErrorDb(gml.error as NonNullable<typeof gml.error>, "marcas al barrer: leer marcas"));
  if (equivalencias.error) return fallaDb(equivalencias.error, "marcas al barrer: leer equivalencias");
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  const gmlCargado = gml as EstadoGmlCargado;
  const config = construirConfigFlujo(
    gmlCargado.estado,
    equivalencias.data.map((e) => ({ id: e.id, genero_mundo_linea_id: e.genero_mundo_linea_id }))
  );

  const nodos = new Map(ctx.nodos.map((n) => [n.gml_id, n]));
  const nombresEq = new Map(equivalencias.data.map((e) => [e.id, e.nombre]));
  const vigentes = new Map(ctx.vigentes.map((v) => [v.agrupacion_id, v]));
  const agrupaciones = new Map(ctx.agrupaciones.map((a) => [a.id, a]));
  const memo = new Map<ClaveG, UnidadG | null>();

  const nivelDe = (gmlId: string): "GML" | "GMLE" => (config.nivelDeNodo.get(gmlId) === "GMLE" ? "GMLE" : "GML");
  const nombreEquivalencia = (id: string) => nombresEq.get(id) ?? id;
  const rutaDe = (gmlId: string, equivalenciaId: string | null): string => {
    const n = gmlCargado.estado.nodos.get(gmlId);
    const base = n?.ruta ?? gmlId;
    return equivalenciaId ? `${base} › ${nombreEquivalencia(equivalenciaId)}` : base;
  };

  const unidadDe = (clave: ClaveG): UnidadG | null => {
    const previo = memo.get(clave);
    if (previo !== undefined) return previo;
    const i = clave.indexOf("|");
    const gmlId = clave.slice(0, i);
    const eq = clave.slice(i + 1) === "" ? null : clave.slice(i + 1);
    const nodo = nodos.get(gmlId);
    if (!nodo || (nodo.nivel === "GMLE") !== (eq !== null)) {
      memo.set(clave, null);
      return null;
    }
    // Sin pesos por equivalencia (la función SQL agrega por nodo): `curvaFila` reparte parejo entre las que tienen curva vigente.
    const cf = curvaFila(
      { nivel: nodo.nivel, equivalencia_id: eq },
      nodo.equivalencias.map((x) => ({ id: x.id, agrupacion_estacionalidad_id: x.agrupacion_estacionalidad_id })),
      vigentes,
      agrupaciones,
      new Map()
    );
    const porAnio = new Map<number, ReturnType<typeof factoresMes>>();
    const phiDe = (anio: number) => {
      let r = porAnio.get(anio);
      if (!r) {
        r = factoresMes(cf.componentes, ctx.periodosClase, ctx.factores, anio);
        porAnio.set(anio, r);
      }
      return r;
    };
    const u: UnidadG = {
      clave,
      gml_id: gmlId,
      equivalencia_id: eq,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      linea_id: nodo.linea_id,
      genero: nodo.genero,
      mundo: nodo.mundo,
      linea: nodo.linea,
      ruta: `${nodo.genero} · ${nodo.mundo} · ${nodo.linea}${eq ? ` › ${nombreEquivalencia(eq)}` : ""}`,
      nivel: nodo.nivel,
      curva: cf.curva,
      curvaIncompleta: cf.avisos.includes("curva_incompleta"),
      phi: (anio) => phiDe(anio).factores,
      sinFactor: (anio) => phiDe(anio).avisos.includes("sin_factor"),
    };
    memo.set(clave, u);
    return u;
  };

  return listo({
    d,
    gml: gmlCargado,
    ctx,
    config,
    hasta: ctx.hastaDefecto,
    marcas: gmlCargado.estado.marcas,
    nivelDe,
    rutaDe,
    unidadDe,
    nombreEquivalencia,
    temporadas: temporadasPorDefecto(),
  });
}

// ─── La marca analizada ───

/** `409` con su código y mensaje; la marca debe ser una unidad vigente con modalidad `barrido` o `mixta`. */
export function validarMarcaBarrer(c: ContextoBarrer, marcaId: string): Salida<{ marca: MarcaGml; datos: DatosMarca }> {
  const marca = c.marcas.find((m) => m.id === marcaId);
  if (!marca) return fallaMensaje(NO_ENCONTRADA, 404);
  const unidad = unidadDeMarca(marca, c.marcas);
  if (unidad.en_conjunto) {
    const cabeza = c.marcas.find((m) => m.id === unidad.unidad_marca_id);
    return fallaMensaje(
      `${marca.nombre} cuenta como ${cabeza?.nombre ?? "su cabeza"}: el reparto se aprueba en ${cabeza?.nombre ?? "su cabeza"}.`,
      409,
      "marca_en_conjunto"
    );
  }
  const agrupacion = c.gml.estado.agrupaciones.find((a) => a.id === marca.agrupacion_marca_id);
  const efectiva = modalidadEfectiva(marca);
  if (efectiva !== "barrido" && efectiva !== "mixta") {
    return fallaMensaje(
      `${marca.nombre} no está al barrer ni es mixta: este análisis solo es para marcas al barrer o mixtas.`,
      409,
      "modalidad_no_barrer"
    );
  }
  if (!marcaVigenteGml(marca, agrupacion)) {
    return fallaMensaje(`${marca.nombre} (o su agrupación) está inactiva: reactívala para analizarla.`, 409, "modalidad_no_barrer");
  }
  return listo({ marca, datos: datosDeMarca(c, marca, efectiva) });
}

function datosDeMarca(c: ContextoBarrer, marca: MarcaGml, modalidad: ModalidadBarrer): DatosMarca {
  const agrupacion = c.gml.estado.agrupaciones.find((a) => a.id === marca.agrupacion_marca_id);
  const miembros = (miembrosPorCabeza(c.marcas).get(marca.id) ?? [])
    .filter((m) => unidadDeMarca(m, c.marcas).unidad_marca_id === marca.id)
    .map((m) => m.nombre)
    .sort(compararNombre);
  const especificos =
    modalidad === "mixta"
      ? unidadesFlujoEspecial(c.gml.estado)
          .unidades.filter((u) => u.marca_id === marca.id && u.modalidad === "por_gml" && u.genero_mundo_linea_id)
          .map((u) => ({ gml_id: u.genero_mundo_linea_id as string, ruta: c.gml.estado.nodos.get(u.genero_mundo_linea_id as string)?.ruta ?? "" }))
          .sort((a, b) => a.ruta.localeCompare(b.ruta, "es") || (a.gml_id < b.gml_id ? -1 : 1))
      : [];
  return {
    id: marca.id,
    nombre: marca.nombre,
    modalidad,
    agrupacion_marca: agrupacion?.nombre ?? "",
    agrupacion_marca_id: marca.agrupacion_marca_id,
    miembros,
    gml_especificos: especificos,
  };
}

// ─── La cerrada de M7 ───

/**
 * Las filas de la proyección cerrada de los años que cubren los doce meses siguientes a `k` (M7: `GET /api/proyeccion/cerrada`
 * por año, solo lectura). Si falta alguno de los años, la cerrada no sirve para el reparto (`null` = `sin_cerrada`); un error que
 * no es "no hay cerrada" se propaga.
 */
export async function leerFilasCerrada(hasta: string): Promise<Salida<FilaCerrada[] | null>> {
  const filas: FilaCerrada[] = [];
  for (const anio of aniosDeLaCerrada(hasta)) {
    const r = await leerProyeccionCerrada(anio);
    if (r.respuesta) {
      if (r.respuesta.status === 404) return listo(null);
      return falla(r.respuesta);
    }
    for (const f of r.data.filas) {
      filas.push({
        gml_id: f.gml_id,
        equivalencia_id: f.equivalencia_id,
        agrupacion_marca_id: f.agrupacion_marca_id,
        tienda_id: f.tienda_id,
        anio: f.anio,
        meses: f.meses,
        participaciones_historicas: f.participaciones_historicas,
      });
    }
  }
  return listo(filas);
}

// ─── Análisis de una marca ───

type ParametrosAnalisis = { ventana: Ventana; modo: ModoEntrada; alcance: AlcanceApi; normaliza_nino: boolean };

function entradaAnalisis(
  c: ContextoBarrer,
  datos: DatosMarca,
  hasta: string,
  p: ParametrosAnalisis,
  venta: EntradaAnalisis["venta"],
  cerrada: FilaCerrada[] | null
): EntradaAnalisis {
  return {
    marca: datos,
    hasta,
    ventana: p.ventana,
    modo: p.modo,
    alcance: p.alcance,
    normaliza_nino: p.normaliza_nino,
    temporadas: c.temporadas,
    config: c.config,
    venta,
    unidades: c.unidadDe,
    factores: c.ctx.factores.map((f) => ({ anio: f.anio, temporada: f.temporada, ratio: f.ratio_aplicado ?? f.ratio_calculado })),
    cerrada,
  };
}

const MESES_MAX = 36;

/** Primer mes de una ventana de `n` meses que termina en `hasta`. */
const desdeDeVentana = (hasta: string, n: number) => mesesDeVentana(hasta, n)[0];

/** Los parámetros con que se aprobó una versión (para volver a calcular "lo de hoy" en las mismas condiciones). */
function parametrosDeVersion(v: VersionLeida): ParametrosAnalisis {
  const modo = modoDe(v.modo);
  const ventana = ([12, 24, 36] as const).find((x) => x === v.ventana_meses) ?? VENTANA_DEFECTO;
  return { ventana, modo: modo === "anual" ? "anual" : "por_temporada", alcance: normalizarAlcance(alcanceDe(v.alcance)), normaliza_nino: v.normaliza_nino };
}

const mismosParametros = (a: ParametrosAnalisis, b: ParametrosAnalisis) =>
  a.ventana === b.ventana &&
  a.modo === b.modo &&
  a.normaliza_nino === b.normaliza_nino &&
  JSON.stringify(a.alcance) === JSON.stringify(b.alcance);

export type ResultadoServicioAnalisis = { api: AnalisisMarcaApi; analisis: ResultadoAnalisis; contexto: ContextoBarrer; datos: DatosMarca; hasta: string };

/** El análisis de una marca (sin vigente): lo comparten el `GET` del análisis y el `POST` que aprueba. */
async function calcularAnalisis(
  c: ContextoBarrer,
  marcaId: string,
  p: ParametrosAnalisis,
  ventanaExtra: number
): Promise<Salida<ResultadoServicioAnalisis & { venta: EntradaAnalisis["venta"]; cerrada: FilaCerrada[] | null }>> {
  const v = validarMarcaBarrer(c, marcaId);
  if (v.respuesta) return falla(v.respuesta);
  if (c.hasta === null) return fallaMensaje("Todavía no hay meses de venta publicados para analizar.", 409, "sin_datos");
  const hasta = c.hasta;
  const n = Math.min(MESES_MAX, Math.max(p.ventana, ventanaExtra));
  const venta = await leerVentaMarcaGml(c.d, [marcaId], desdeDeVentana(hasta, n), hasta);
  if (venta.error) return fallaDb(venta.error, "marcas al barrer: leer la venta por GML");
  const cerrada = await leerFilasCerrada(hasta);
  if (cerrada.respuesta) return falla(cerrada.respuesta);
  const analisis = analizarMarca(entradaAnalisis(c, v.data.datos, hasta, p, venta.data, cerrada.data));
  return listo({ api: analisis.api, analisis, contexto: c, datos: v.data.datos, hasta, venta: venta.data, cerrada: cerrada.data });
}

/** Cómo está el reparto vigente frente a lo que se calcularía hoy (regla 11): motivos de obsolescencia y diferencia en pp. */
function evaluarVigente(
  c: ContextoBarrer,
  hoy: ResultadoAnalisis,
  v: VersionLeida,
  ventanaPedida: number
): { motivos: MotivoObsoleto[]; diferencia_pp: number | null } {
  const diferencia = diferenciaConVigente(hoy.interno, v);
  const actual: HuellasReparto = {
    huella_config: huellaConfigActual(hoy.interno, v, c.nivelDe, ventanaPedida),
    huella_cargas: hoy.interno.huella_cargas,
  };
  const r = motivosObsoleto({ huella_config: v.huella_config, huella_cargas: v.huella_cargas }, actual, diferencia);
  return { motivos: r.motivos, diferencia_pp: diferencia };
}

/** `GET /api/marcas-barrer/[marcaId]`: el análisis a demanda, con el reparto vigente y su estado. Nunca escribe. */
export async function analizarMarcaServicio(d: Db, marcaId: string, p: ParametrosAnalisis): Promise<Salida<AnalisisMarcaApi>> {
  const cargado = await cargarContextoBarrer(d);
  if (cargado.respuesta) return falla(cargado.respuesta);
  const c = cargado.data;
  const vigentes = await leerVersionesVigentes(d, [marcaId]);
  if (vigentes.error) return fallaDb(vigentes.error, "marcas al barrer: leer el reparto vigente");
  const vigente = vigentes.data[0] ?? null;

  const r = await calcularAnalisis(c, marcaId, p, vigente ? vigente.ventana_meses : p.ventana);
  if (r.respuesta) return falla(r.respuesta);
  if (!vigente) return listo(adjuntarVigente(r.data.api, null, { motivos: [], diferencia_pp: null }));

  // Lo de hoy con los parámetros de la versión vigente (si son los de la pantalla, el mismo análisis).
  const pv = parametrosDeVersion(vigente);
  const hoy = mismosParametros(p, pv)
    ? r.data.analisis
    : analizarMarca(entradaAnalisis(c, r.data.datos, r.data.hasta, pv, r.data.venta, r.data.cerrada));
  const evaluacion = evaluarVigente(c, hoy, vigente, p.ventana);
  return listo(adjuntarVigente(r.data.api, vigente, evaluacion));
}

// ─── Aprobar ───

export type Aprobador = { id: string; nombre: string | null };

/**
 * `POST /api/marcas-barrer/[marcaId]/repartos`: aprueba un reparto (una versión nueva; la anterior deja de ser la vigente).
 * Vuelve a calcular el análisis con los parámetros del cuerpo y exige que su `huella` sea la que el planner vio (`409
 * huella_cambiada`). Quién y cuándo quedan en la versión. Sin transacción (como M6): la versión nueva se inserta APAGADA,
 * luego sus filas, se apaga la anterior y se enciende la nueva; si algo falla se deshace lo que se pueda y la vigente anterior
 * sigue siendo la vigente.
 */
export async function aprobarReparto(d: Db, marcaId: string, cuerpo: AprobarReparto, actor: Aprobador): Promise<Salida<RepartoApi>> {
  const cargado = await cargarContextoBarrer(d);
  if (cargado.respuesta) return falla(cargado.respuesta);
  const c = cargado.data;
  const parametros: ParametrosAnalisis = {
    ventana: cuerpo.ventana_meses as Ventana,
    modo: cuerpo.modo,
    alcance: normalizarAlcance(cuerpo.alcance),
    normaliza_nino: cuerpo.normaliza_nino,
  };
  const r = await calcularAnalisis(c, marcaId, parametros, parametros.ventana);
  if (r.respuesta) return falla(r.respuesta);
  const { api, analisis } = r.data;

  if (api.huella !== cuerpo.huella) {
    return fallaMensaje(
      "Los datos cambiaron mientras decidías (se publicó un mes, cambió la configuración de la marca o la proyección cerrada). Vuelve a cargar el análisis y revisa el reparto antes de aprobar.",
      409,
      "huella_cambiada"
    );
  }

  const armado = armarVersion(analisis.interno, {
    ventana_meses: cuerpo.ventana_meses,
    modo: cuerpo.modo,
    fuente: cuerpo.fuente,
    alcance: parametros.alcance,
    filas: cuerpo.filas,
    nota: cuerpo.nota,
  });
  if (!armado.ok) return fallaMensaje(armado.rechazo.mensaje, 409, armado.rechazo.codigo);

  // Las fechas de temporada con que se calculó este análisis quedan en la versión (no se reescriben si luego cambian).
  const temporadasUsadas = temporadasAGuardar(api.parametros.temporadas);
  if (temporadasUsadas === null) {
    return fallaMensaje("Las fechas de las temporadas no son válidas (deben cubrir los doce meses sin solaparse): corrígelas antes de aprobar.", 409, "temporadas_invalidas");
  }

  const anterior = await leerVersionesVigentes(d, [marcaId]);
  if (anterior.error) return fallaDb(anterior.error, "marcas al barrer: leer el reparto vigente");
  const siguiente = await siguienteVersion(d, marcaId);
  if (siguiente.error) return fallaDb(siguiente.error, "marcas al barrer: numerar la versión");

  const { version } = armado;
  const alcanceGuardado: Record<string, string[]> = {};
  if (parametros.alcance.generos.length > 0) alcanceGuardado.generos = parametros.alcance.generos;
  if (parametros.alcance.mundos.length > 0) alcanceGuardado.mundos = parametros.alcance.mundos;
  if (parametros.alcance.lineas.length > 0) alcanceGuardado.lineas = parametros.alcance.lineas;

  const eat = api.estacionalidad.eat_pp;
  const insertada = await insertarVersion(d, {
    marca_id: marcaId,
    version: siguiente.data,
    ventana_meses: cuerpo.ventana_meses,
    // El modo EFECTIVO: con `temporada_corta` el reparto es anual y sus filas no llevan temporada.
    modo: api.parametros.modo_efectivo,
    fuente: cuerpo.fuente,
    alcance: alcanceGuardado,
    hasta_periodo: primerDia(r.data.hasta),
    normaliza_nino: cuerpo.normaliza_nino,
    huella_cargas: analisis.interno.huella_cargas,
    huella_config: huellaConfigDeVersion(analisis.interno, cuerpo.fuente, version.filas, c.nivelDe),
    factores_usados: api.parametros.factores,
    temporadas_usadas: temporadasUsadas,
    share_barrido: Math.round(api.share_barrido * 1e4) / 1e4,
    eat_pp: eat === null ? null : Math.round(eat * 100) / 100,
    error_reparto_pp: api.error_reparto.pp === null ? null : Math.round(api.error_reparto.pp * 100) / 100,
    nota: cuerpo.nota ?? null,
    aprobada_por_id: actor.id,
    aprobada_por_nombre: actor.nombre,
    aprobada_at: new Date().toISOString(),
  });
  if (insertada.error || !insertada.data) {
    if (insertada.error?.code === "23505") {
      return fallaMensaje("Otra persona aprobó un reparto de esta marca al mismo tiempo. Vuelve a cargar el análisis.", 409, "huella_cambiada");
    }
    return fallaDb(insertada.error as NonNullable<typeof insertada.error>, "marcas al barrer: guardar la versión");
  }
  const nueva = insertada.data;

  const deshacer = async () => {
    await eliminarVersion(d, nueva.id);
  };
  const escritas = await insertarFilasVersion(
    d,
    version.filas.map((f) => ({ ...f, reparto_id: nueva.id }))
  );
  if (escritas.error) {
    await deshacer();
    return fallaDb(escritas.error, "marcas al barrer: guardar las filas del reparto");
  }

  const previa = anterior.data[0];
  if (previa) {
    const apagada = await fijarVigente(d, previa.id, false);
    if (apagada.error) {
      await deshacer();
      return fallaDb(apagada.error, "marcas al barrer: reemplazar la versión vigente");
    }
  }
  let encendida = await fijarVigente(d, nueva.id, true);
  if (encendida.error) encendida = await fijarVigente(d, nueva.id, true);
  if (encendida.error) {
    // Se devuelve la anterior a vigente y se borra la nueva: el planner vuelve a intentarlo.
    if (previa) await fijarVigente(d, previa.id, true);
    await deshacer();
    return fallaDb(encendida.error, "marcas al barrer: activar la versión nueva");
  }

  const guardada: VersionLeida = {
    id: nueva.id,
    marca_id: marcaId,
    version: nueva.version,
    vigente: true,
    ventana_meses: nueva.ventana_meses,
    modo: nueva.modo,
    fuente: nueva.fuente,
    alcance: nueva.alcance,
    hasta_periodo: nueva.hasta_periodo,
    normaliza_nino: nueva.normaliza_nino,
    huella_cargas: nueva.huella_cargas,
    huella_config: nueva.huella_config,
    factores_usados: nueva.factores_usados,
    temporadas_usadas: nueva.temporadas_usadas,
    share_barrido: nueva.share_barrido === null ? null : Number(nueva.share_barrido),
    eat_pp: nueva.eat_pp === null ? null : Number(nueva.eat_pp),
    error_reparto_pp: nueva.error_reparto_pp === null ? null : Number(nueva.error_reparto_pp),
    nota: nueva.nota,
    aprobada_por_id: nueva.aprobada_por_id,
    aprobada_por_nombre: nueva.aprobada_por_nombre,
    aprobada_at: nueva.aprobada_at,
    filas: version.filas.map((f) => ({ ...f })),
  };
  return listo(aRepartoApi(guardada, c.rutaDe));
}

// ─── Versiones y vigentes ───

/** Carga lo mínimo para nombrar las `g` de las versiones (árbol, equivalencias) y comprobar que la marca existe. */
async function cargarRutas(d: Db) {
  const [gml, equivalencias] = await Promise.all([cargarEstadoGml(d), leerEquivalencias(d)]);
  if (gml.error || !gml.estado) return { respuesta: traducirErrorDb(gml.error as NonNullable<typeof gml.error>, "marcas al barrer: leer marcas") } as const;
  if (equivalencias.error) return { respuesta: traducirErrorDb(equivalencias.error, "marcas al barrer: leer equivalencias") } as const;
  const g = gml as EstadoGmlCargado;
  const nombres = new Map<string, string>(equivalencias.data.map((e: Tables<"equivalencias">) => [e.id, e.nombre]));
  const rutaDe = (gmlId: string, eq: string | null) => {
    const base = g.estado.nodos.get(gmlId)?.ruta ?? gmlId;
    return eq ? `${base} › ${nombres.get(eq) ?? eq}` : base;
  };
  return { respuesta: null, marcas: g.estado.marcas, rutaDe } as const;
}

/** `GET /api/marcas-barrer/[marcaId]/repartos`: todas las versiones (la más reciente primero) con sus filas. */
export async function leerRepartos(d: Db, marcaId: string): Promise<Salida<RepartoApi[]>> {
  const base = await cargarRutas(d);
  if (base.respuesta) return falla(base.respuesta);
  if (!base.marcas.some((m) => m.id === marcaId)) return fallaMensaje(NO_ENCONTRADA, 404);
  const versiones = await leerVersionesDeMarca(d, marcaId);
  if (versiones.error) return fallaDb(versiones.error, "marcas al barrer: leer las versiones");
  return listo(versiones.data.map((v) => aRepartoApi(v, base.rutaDe)));
}

/** El contrato de M8 y M9 en la forma de la API (ver `leerRepartosVigentes`). */
export function armarRepartosVigentes(versiones: readonly VersionLeida[], marcaIds: readonly string[] | null, todasLasMarcas: readonly string[]): RepartosVigentesApi {
  const porMarca = new Map(versiones.map((v) => [v.marca_id, v]));
  const pedidas = marcaIds ?? todasLasMarcas;
  const repartos: RepartoVigenteApi[] = [...versiones]
    .filter((v) => marcaIds === null || marcaIds.includes(v.marca_id))
    .sort((a, b) => (a.marca_id < b.marca_id ? -1 : a.marca_id > b.marca_id ? 1 : 0))
    .map((v) => ({
      marca_id: v.marca_id,
      reparto_id: v.id,
      version: v.version,
      modo: modoDe(v.modo),
      fuente: fuenteDe(v.fuente),
      alcance: alcanceDe(v.alcance),
      hasta_periodo: v.hasta_periodo.slice(0, 7),
      error_reparto_pp: v.error_reparto_pp,
      temporadas_usadas: temporadasDeVersion(v.temporadas_usadas),
      aprobada_at: v.aprobada_at,
      filas: v.filas
        .filter((f) => f.participacion_vigente > 0)
        .map((f) => ({
          gml_id: f.genero_mundo_linea_id,
          equivalencia_id: f.equivalencia_id,
          temporada: f.temporada === "verano" || f.temporada === "invierno" ? (f.temporada as "verano" | "invierno") : null,
          participacion: f.participacion_vigente,
        }))
        .sort(
          (a, b) =>
            (a.temporada ?? "").localeCompare(b.temporada ?? "") ||
            (a.gml_id < b.gml_id ? -1 : a.gml_id > b.gml_id ? 1 : 0) ||
            (a.equivalencia_id ?? "").localeCompare(b.equivalencia_id ?? "")
        ),
    }));
  const sin_reparto = [...new Set(pedidas)].filter((id) => !porMarca.has(id)).sort();
  return { repartos, sin_reparto };
}

/**
 * `GET /api/marcas-barrer/vigentes?marca_ids=`: el contrato de M8 y M9 (lotes de una sola marca). Con `marca_ids`, esas marcas
 * (las que no tienen reparto vigente van a `sin_reparto`); sin ellas, todos los repartos vigentes y en `sin_reparto` las marcas
 * al barrer o mixtas que todavía no tienen. M8 lo incluye en su propia respuesta (el comprador no puede llamar aquí).
 */
export async function leerRepartosVigentes(d: Db, marcaIds: readonly string[] | null): Promise<Salida<RepartosVigentesApi>> {
  const versiones = await leerVersionesVigentes(d, marcaIds);
  if (versiones.error) return fallaDb(versiones.error, "marcas al barrer: leer los repartos vigentes");
  let todas: string[] = [];
  if (marcaIds === null) {
    const gml = await cargarEstadoGml(d);
    if (gml.error || !gml.estado) return falla(traducirErrorDb(gml.error as NonNullable<typeof gml.error>, "marcas al barrer: leer marcas"));
    todas = [...new Set(unidadesFlujoEspecial((gml as EstadoGmlCargado).estado).unidades.filter((u) => u.modalidad === "barrido").map((u) => u.marca_id))];
  }
  return listo(armarRepartosVigentes(versiones.data, marcaIds, todas));
}

// ─── Lista ───

/** `GET /api/marcas-barrer?ventana=`: una fila por unidad de marca al barrer o mixta, desde la función resumen (no lee hechos por mes). */
export async function listarMarcasBarrer(d: Db, ventana: Ventana): Promise<Salida<ListaBarrerApi>> {
  const cargado = await cargarContextoBarrer(d);
  if (cargado.respuesta) return falla(cargado.respuesta);
  const c = cargado.data;
  const hasta = c.hasta;
  const desde = hasta === null ? null : desdeDeVentana(hasta, ventana);
  // Sin meses cerrados no hay ventana: un rango vacío lista las marcas con cero unidades (y "Sin reparto").
  const resumen = await leerResumenVenta(d, desde ?? "1900-01", hasta ?? "1900-01", UMBRAL_GML_PEQUENO);
  if (resumen.error) return fallaDb(resumen.error, "marcas al barrer: leer el resumen de venta");
  const vigentes = await leerVersionesVigentes(d, null);
  if (vigentes.error) return fallaDb(vigentes.error, "marcas al barrer: leer los repartos vigentes");
  const vigentePorMarca = new Map(vigentes.data.map((v) => [v.marca_id, v]));

  const nodos = new Map(c.ctx.nodos.map((n) => [n.gml_id, n]));
  const porUnidad = new Map<string, typeof resumen.data.por_gml>();
  for (const g of resumen.data.por_gml) {
    const l = porUnidad.get(g.unidad_marca_id) ?? [];
    l.push(g);
    porUnidad.set(g.unidad_marca_id, l);
  }
  const huellaCargasActual = huellaCargasBarrer(resumen.data.cargas);

  const marcas: MarcaBarrerResumenApi[] = [];
  const pendientesDeDiferencia: { fila: MarcaBarrerResumenApi; version: VersionLeida; datos: DatosMarca }[] = [];
  for (const u of resumen.data.unidades) {
    const marca = c.marcas.find((m) => m.id === u.unidad_marca_id);
    const efectiva = marca ? modalidadEfectiva(marca) : null;
    if (!marca || (efectiva !== "barrido" && efectiva !== "mixta")) continue;
    const datos = datosDeMarca(c, marca, efectiva);
    const especificos = new Set(datos.gml_especificos.map((g) => g.gml_id));
    const porG = porUnidad.get(marca.id) ?? [];

    let barrer = 0;
    let especifica = 0;
    let conVenta = 0;
    let pequenos = 0;
    const generos = new Set<string>();
    const mundos = new Set<string>();
    const lineas = new Set<string>();
    for (const g of porG) {
      if (efectiva === "mixta" && especificos.has(g.gml_id)) {
        especifica += g.unidades;
        continue;
      }
      barrer += g.unidades;
      if (g.unidades > 0) {
        conVenta += 1;
        if (g.unidades < UMBRAL_GML_PEQUENO) pequenos += 1;
        const n = nodos.get(g.gml_id);
        if (n) {
          generos.add(n.genero_id);
          mundos.add(n.mundo_id);
          lineas.add(n.linea_id);
        }
      }
    }
    const total = barrer + especifica;
    const vigente = vigentePorMarca.get(marca.id) ?? null;

    const avisos: AvisoBarrer[] = [];
    if (efectiva === "mixta" && datos.gml_especificos.length === 0) avisos.push("mixta_sin_gml");
    if (barrer <= 0) avisos.push("sin_venta_barrer");
    if (!vigente) avisos.push("sin_reparto");

    let motivos: MotivoObsoleto[] = [];
    let diferencia: number | null = null;
    if (vigente) {
      const pv = parametrosDeVersion(vigente);
      const actual: HuellasReparto = {
        huella_config: huellaConfig({
          modalidad: efectiva,
          agrupacion_marca_id: marca.agrupacion_marca_id,
          gml_especificos: datos.gml_especificos.map((g) => g.gml_id),
          miembros: miembrosDeUnidad(c.config, marca.id),
          temporadas: c.temporadas,
          modo: pv.modo,
          alcance: pv.alcance,
          fuente: fuenteDe(vigente.fuente),
          normaliza_nino: pv.normaliza_nino,
          niveles: new Map(vigente.filas.map((f) => [f.genero_mundo_linea_id, c.nivelDe(f.genero_mundo_linea_id)])),
          ventana_meses: ventana,
        }),
        huella_cargas: huellaCargasActual,
      };
      const mismaVentana = vigente.ventana_meses === ventana;
      const cargasIguales = mismaVentana && vigente.huella_cargas === huellaCargasActual;
      // Sin cargas nuevas la diferencia es 0; con cargas nuevas se calcula al abrir (aquí, solo la que haga falta).
      const r = motivosObsoleto({ huella_config: vigente.huella_config, huella_cargas: vigente.huella_cargas }, actual, cargasIguales ? 0 : null);
      motivos = r.motivos;
      diferencia = cargasIguales ? 0 : null;
    }

    const fila: MarcaBarrerResumenApi = {
      id: marca.id,
      nombre: marca.nombre,
      modalidad: efectiva,
      agrupacion_marca: { id: marca.agrupacion_marca_id, nombre: datos.agrupacion_marca },
      miembros: datos.miembros,
      unidades_ventana: Math.round(total),
      unidades_barrer: Math.round(barrer),
      unidades_especificas: Math.round(especifica),
      share_barrido: total > 0 ? barrer / total : null,
      gml_con_venta: conVenta,
      gml_pequenos: pequenos,
      gml_especificos: datos.gml_especificos.length,
      genero_ids: [...generos].sort(),
      mundo_ids: [...mundos].sort(),
      linea_ids: [...lineas].sort(),
      error_reparto: errorDeLista(vigente?.error_reparto_pp ?? null),
      vigente: vigente
        ? {
            reparto_id: vigente.id,
            version: vigente.version,
            modo: modoDe(vigente.modo),
            fuente: fuenteDe(vigente.fuente),
            ventana_meses: vigente.ventana_meses,
            aprobada_at: vigente.aprobada_at,
            aprobada_por_nombre: vigente.aprobada_por_nombre,
            error_reparto_pp: vigente.error_reparto_pp,
          }
        : null,
      estado: estadoDeReparto(vigente !== null, motivos),
      obsoleto: motivos,
      diferencia_pp: diferencia,
      avisos,
    };
    marcas.push(fila);
    // Con cargas nuevas y sin otro motivo, la diferencia decide si está obsoleta: se calcula para esa marca (una lectura por marca).
    if (vigente && vigente.ventana_meses === ventana && vigente.huella_cargas !== huellaCargasActual && diferencia === null) {
      pendientesDeDiferencia.push({ fila, version: vigente, datos });
    }
  }

  // Diferencia de las marcas con cargas nuevas: el análisis con los parámetros de su versión vigente (sin cerrada: no hace falta).
  for (const p of pendientesDeDiferencia) {
    if (hasta === null) break;
    const venta = await leerVentaMarcaGml(d, [p.fila.id], desdeDeVentana(hasta, p.version.ventana_meses), hasta);
    if (venta.error) return fallaDb(venta.error, "marcas al barrer: leer la venta por GML");
    const pv = parametrosDeVersion(p.version);
    // La cerrada solo se lee si el reparto vigente se aprobó según ella.
    let cerrada: FilaCerrada[] | null = null;
    if (fuenteDe(p.version.fuente) === "cerrada") {
      const r = await leerFilasCerrada(hasta);
      if (r.respuesta) return falla(r.respuesta);
      cerrada = r.data;
    }
    const hoy = analizarMarca(entradaAnalisis(c, p.datos, hasta, pv, venta.data, cerrada));
    const ev = evaluarVigente(c, hoy, p.version, ventana);
    p.fila.diferencia_pp = ev.diferencia_pp;
    p.fila.obsoleto = ev.motivos;
    p.fila.estado = estadoDeReparto(true, ev.motivos);
  }

  marcas.sort((a, b) => b.unidades_ventana - a.unidades_ventana || compararNombre(a.nombre, b.nombre) || (a.id < b.id ? -1 : 1));
  return listo({
    datos: {
      hasta_periodo: hasta,
      desde_periodo: desde,
      ventana,
      cargas: Object.keys(resumen.data.cargas).length,
    },
    marcas,
    resumen: {
      marcas: marcas.length,
      sin_reparto: marcas.filter((m) => m.estado === "sin_reparto").length,
      obsoletas: marcas.filter((m) => m.estado === "obsoleto").length,
      mixtas: marcas.filter((m) => m.modalidad === "mixta").length,
      inestables: marcas.filter((m) => veredictoError(m.error_reparto.pp) === "inestable").length,
      unidades_barrer: marcas.reduce((a, m) => a + m.unidades_barrer, 0),
    },
  });
}
