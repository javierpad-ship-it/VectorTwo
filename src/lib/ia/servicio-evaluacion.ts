import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { enTandas } from "@/lib/arbol/importar";
import { aPeriodo } from "@/lib/ventas/periodo";
import { bloquesDeAnio, claveIncluye, clavesPertenencia } from "@/lib/proyeccion/bloques";
import { indiceMes } from "@/lib/proyeccion/calendario";
import { calcularProyeccion } from "@/lib/proyeccion/calculo";
import { leerVentaTanda } from "@/lib/proyeccion/consultas";
import { cargarContextoCalculo, type ContextoCalculo } from "@/lib/proyeccion/contexto";
import { tiendasDeDetalle } from "@/lib/proyeccion/servicio";
import { PARAMETROS_DEFECTO, falla, fallaDb, listo, sello, type Actor, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { filtrarUniverso } from "@/lib/proyeccion/universo";
import { PARALELO, TANDA_GML, VERSION_METODO, type FilaModelo, type VentaProyeccion } from "@/lib/proyeccion/tipos";
import {
  actualizarCorrida,
  actualizarCorridaGM,
  actualizarEvaluacionEnCurso,
  insertarCorrida,
  insertarCorridaGMs,
  insertarEvaluacion,
  leerConfigVigente,
  leerCorrida,
  leerCorridaDeEvaluacion,
  leerCorridaGMs,
  leerCostosDelRango,
  leerCostosPorCorrida,
  leerEvaluacion,
  leerEvaluacionEnCurso,
  leerEvaluaciones,
  leerFilasDePropuestas,
  leerPropuestaGM,
  leerTerminosPrivados,
  leerVentaLineasIa,
  type CorridaDb,
  type CorridaGMDb,
  type EvaluacionDb,
  type NuevoCorridaGM,
} from "./consultas";
import { armarDatosGM, filaMetaDeModelo, filaParaHuellaDeModelo, gmsDeCatalogo, type GMCatalogo } from "./contexto-gm";
import { MEJORA_MIN_DESDE_SEGUNDA, MAX_EVALUACIONES_MES, PLIEGUES_DEFECTO, DEFINICION_PLIEGUE, SEMILLA_BOOTSTRAP, REMUESTREOS_BOOTSTRAP, mejoraMinima, recortarAlCorte, repartoMetodo, repartoTendencia, resultadosDeEvaluacion, type FilaEvaluada, type GMEvaluado } from "./evaluacion";
import { armarBloquesGM, desempaquetarVentaLineasIa, type RegistroVentaIa } from "./entrada";
import { huellaGM, huellaHistoria } from "./huellas";
import { leerEntornoIa } from "./entorno";
import { mesLima, rangoMesLima } from "./limites";
import type { EstimacionApi, EvaluacionApi, GrupoGeneroIa, MetaGMApi, PasoGMApi, PliegueIa, PreciosIa } from "./tipos-api";
import { adaptadorDelEntorno } from "./proveedores";
import { guardarBloques, ejecutarPasoGM, metaParaHuella, pasosDelPlan, type DominioPaso } from "./servicio-pasos";
import { aplicarCaducidad, fallaIa, preciosDe } from "./servicio";
import type { evaluacionSchema, pasoEvaluacionSchema } from "./esquemas";
import type { EstadoPlanIa, FilaBaseFinal, LineaBasePlan } from "./propuesta";
import type { z } from "zod";
import { CAPACIDAD_Y1 } from "./servicio";
import type { EstadoMetaFila } from "./tipos-api";
import type { FilaMeta } from "./meta";

/**
 * Evaluación (backtest) de la propuesta con IA (ficha 07e, §5.4). El navegador la conduce: `POST` crea la evaluación y su corrida con un GM por pliegue,
 * `preparar` arma EN MEMORIA la proyección del método con los datos hasta el corte del pliegue (una vez por pliegue; no escribe ninguna proyección),
 * guarda los bloques en `ia_entradas` y la referencia (método, tendencia y real) en `ia_corrida_gms`, y cada `paso` hace una llamada con el mismo motor
 * que producción. NUNCA reusa por huella. Al terminar el último GM se calculan `resultados` y `veredicto`.
 *
 * Limitación conocida (ficha §5.4): las curvas y los factores del Niño son los de hoy, que conocen los años de prueba (fuga compartida por el método y la
 * IA). Además `venta_proyeccion` no tiene tope de fecha: las filas, la venta por tienda y la disponibilidad se recortan al corte aquí, pero los pesos de
 * las equivalencias y el detalle de `W12` que lee esa función pueden incluir meses posteriores (solo mueven pesos de curvas, también compartidos).
 */

const db = (): Db => supabaseAdmin();
const NUMERO = (v: unknown): number => (typeof v === "number" ? v : Number(v));

/** Estimación gruesa de la tabla de la ficha §3.9: ≈ 1,9 M tokens de entrada y 0,42 M de salida para tres pliegues (sin caché). */
const TOKENS_ENTRADA_POR_PLIEGUE = 633_000;
const TOKENS_SALIDA_POR_PLIEGUE = 140_000;
const LLAMADAS_POR_PLIEGUE = 64;
const FILAS_POR_PLIEGUE = 650;
const TOPE_MES_DEFECTO = 60;
const MARGEN = 1.2;

export type EvaluacionCuerpo = z.infer<typeof evaluacionSchema>;
export type PasoEvaluacionCuerpo = z.infer<typeof pasoEvaluacionSchema>;
export type PlanEvaluacionApi = { pliegue: string; gm_clave: string };
export type RespuestaIniciarEvaluacionApi = { evaluacion: EvaluacionApi; plan: PlanEvaluacionApi[]; estimacion: EstimacionApi };

export function estimarEvaluacion(pliegues: number, gms: number, precios: PreciosIa, tope: number): EstimacionApi {
  const entrada = Math.ceil(pliegues * TOKENS_ENTRADA_POR_PLIEGUE * MARGEN);
  const salida = Math.ceil(pliegues * TOKENS_SALIDA_POR_PLIEGUE * MARGEN);
  return {
    gms: gms * pliegues,
    llamadas: pliegues * LLAMADAS_POR_PLIEGUE,
    filas: pliegues * FILAS_POR_PLIEGUE,
    tokens_entrada: entrada,
    tokens_salida: salida,
    costo_usd: Math.round(((entrada * precios.entrada + salida * precios.salida) / 1e6) * 1e4) / 1e4,
    tope_usd: tope,
    reusables: 0,
  };
}

// ─── Lectura ───

async function aEvaluacionesApi(d: Db, lista: readonly EvaluacionDb[], todas: readonly EvaluacionDb[]): Promise<Salida<EvaluacionApi[]>> {
  const corridas = await Promise.all(lista.map((e) => leerCorridaDeEvaluacion(d, e.id)));
  const fallo = corridas.find((c) => c.error);
  if (fallo?.error) return fallaDb(fallo.error, "IA: leer las corridas de las evaluaciones");
  const ids = corridas.flatMap((c) => (c.data ? [c.data.id] : []));
  const costos = await leerCostosPorCorrida(d, ids);
  if (costos.error) return fallaDb(costos.error, "IA: leer el costo de las evaluaciones");
  const orden = [...todas].sort((a, b) => (a.iniciada_at < b.iniciada_at ? -1 : a.iniciada_at > b.iniciada_at ? 1 : a.id < b.id ? -1 : 1));
  return listo(
    lista.map((e, i): EvaluacionApi => ({
      id: e.id,
      intento: orden.findIndex((x) => x.id === e.id) + 1,
      proveedor: e.proveedor,
      modelo: e.modelo,
      version_prompt: e.version_prompt,
      estado: e.estado as EvaluacionApi["estado"],
      parametros: (e.parametros ?? {}) as Record<string, unknown>,
      resultados: e.resultados as unknown as EvaluacionApi["resultados"],
      veredicto: e.veredicto as unknown as EvaluacionApi["veredicto"],
      tope_usd: NUMERO(e.tope_usd),
      costo_usd: Math.round((costos.data.get(corridas[i].data?.id ?? "") ?? 0) * 1e4) / 1e4,
      usuario_nombre: e.usuario_nombre,
      iniciada_at: e.iniciada_at,
      terminada_at: e.terminada_at,
    }))
  );
}

export async function listarEvaluaciones(): Promise<Salida<EvaluacionApi[]>> {
  const d = db();
  const r = await leerEvaluaciones(d);
  if (r.error) return fallaDb(r.error, "IA: leer las evaluaciones");
  const api = await aEvaluacionesApi(d, r.data, r.data);
  if (api.respuesta) return falla(api.respuesta);
  return listo([...api.data].reverse());
}

export async function leerEvaluacionApi(id: string): Promise<Salida<EvaluacionApi>> {
  const d = db();
  const e = await leerEvaluacion(d, id);
  if (e.error) return fallaDb(e.error, "IA: leer la evaluación");
  if (!e.data) return fallaIa("Evaluación no encontrada.", 404, "evaluacion_no_encontrada");
  const todas = await leerEvaluaciones(d);
  if (todas.error) return fallaDb(todas.error, "IA: leer las evaluaciones");
  const api = await aEvaluacionesApi(d, [e.data], todas.data);
  if (api.respuesta) return falla(api.respuesta);
  return listo(api.data[0]);
}

// ─── Entorno ───

function comprobarEntorno(modelo: string): Salida<null> {
  const entorno = leerEntornoIa();
  if (entorno.desactivada) return fallaIa("La IA está desactivada por el entorno del servidor.", 409, "ia_no_disponible", { motivo: "desactivada_entorno" });
  const ad = adaptadorDelEntorno(entorno);
  if (!ad) return fallaIa("El servidor no tiene proveedor de IA configurado.", 409, "sin_proveedor");
  if (!ad.adaptador.hayClave()) return fallaIa("Falta la clave del proveedor de IA en el servidor.", 409, "ia_sin_clave");
  if (!entorno.modelos.includes(modelo)) return fallaIa("Ese modelo no está entre los que permite el servidor (IA_MODELO).", 409, "modelo_no_permitido", { modelos_permitidos: entorno.modelos });
  return listo(null);
}

// ─── POST /api/ia/evaluaciones ───

export async function iniciarEvaluacion(cuerpo: EvaluacionCuerpo, actor: Actor): Promise<Salida<RespuestaIniciarEvaluacionApi>> {
  const d = db();
  const ent = comprobarEntorno(cuerpo.modelo);
  if (ent.respuesta) return falla(ent.respuesta);
  const entorno = leerEntornoIa();
  const adaptador = adaptadorDelEntorno(entorno);
  if (!adaptador) return fallaIa("El servidor no tiene proveedor de IA configurado.", 409, "sin_proveedor");
  const pliegues = (cuerpo.pliegues ?? [...PLIEGUES_DEFECTO]) as PliegueIa[];
  if (pliegues.includes("E25") && !pliegues.includes("D25")) return fallaIa("El pliegue E25 repite D25: incluye también D25.", 409, "pliegues_invalidos");

  // Una evaluación a la vez; una cuya corrida caducó se cancela para no dejar bloqueado el sistema.
  const enCurso = await leerEvaluacionEnCurso(d);
  if (enCurso.error) return fallaDb(enCurso.error, "IA: leer la evaluación en curso");
  if (enCurso.data) {
    const c = await leerCorridaDeEvaluacion(d, enCurso.data.id);
    if (c.error) return fallaDb(c.error, "IA: leer la corrida de la evaluación");
    const vivo = c.data ? await aplicarCaducidad(d, c.data) : null;
    if (vivo?.respuesta) return falla(vivo.respuesta);
    if (vivo && vivo.data.estado === "en_curso") return fallaIa("Ya hay una evaluación en curso. Termínala o cancélala.", 409, "evaluacion_en_curso", { evaluacion_id: enCurso.data.id });
    await actualizarEvaluacionEnCurso(d, enCurso.data.id, { estado: "cancelada", terminada_at: sello() });
  }

  const todas = await leerEvaluaciones(d);
  if (todas.error) return fallaDb(todas.error, "IA: leer las evaluaciones");
  const mes = rangoMesLima(mesLima(new Date()));
  if (todas.data.filter((e) => e.iniciada_at >= mes.desde && e.iniciada_at < mes.hasta).length >= MAX_EVALUACIONES_MES) {
    return fallaIa(`Ya se hicieron ${MAX_EVALUACIONES_MES} evaluaciones este mes.`, 409, "limite_evaluaciones_mes");
  }

  const cfg = await leerConfigVigente(d);
  if (cfg.error) return fallaDb(cfg.error, "IA: leer la configuración vigente");
  const cat = await cargarContextoCalculo(d, { conFlujo: false });
  if (cat.respuesta) return falla(cat.respuesta);
  const gms = gmsDeCatalogo(cat.data.catalogo, new Set(cat.data.generosMatriz));
  const estimacion = estimarEvaluacion(pliegues.length, gms.length, cuerpo.precios, cuerpo.tope_usd);
  if (cuerpo.costo_confirmado_usd + 0.005 < estimacion.costo_usd) return fallaIa("Confirma el costo estimado antes de evaluar.", 409, "costo_no_confirmado", { estimacion });
  if (estimacion.costo_usd > cuerpo.tope_usd) return fallaIa("El costo estimado supera el tope de la evaluación.", 409, "tope_evaluacion", { estimacion });
  const costos = await leerCostosDelRango(d, mes.desde, mes.hasta);
  if (costos.error) return fallaDb(costos.error, "IA: leer el gasto del mes");
  const gastoMes = costos.data.reduce((s, c) => s + c.costo_usd, 0);
  const topeMes = cfg.data ? NUMERO(cfg.data.tope_usd_mes) : TOPE_MES_DEFECTO;
  if (estimacion.costo_usd > topeMes - gastoMes) return fallaIa("El costo estimado supera lo que queda del tope del mes.", 409, "tope_mensual", { estimacion });

  const orden = [...todas.data].sort((a, b) => (a.iniciada_at < b.iniciada_at ? -1 : 1));
  const evaluadas = [...new Set(orden.map((e) => e.version_prompt))];
  const mejora_min = mejoraMinima(cuerpo.version_prompt, evaluadas);
  const parametros = {
    pliegues,
    mejora_min,
    intento: todas.data.length + 1,
    max_filas_llamada: cfg.data?.max_filas_llamada ?? 60,
    presupuesto_razonamiento: cfg.data?.presupuesto_razonamiento ?? 0,
    precios: cuerpo.precios,
    semilla_bootstrap: SEMILLA_BOOTSTRAP,
    remuestreos: REMUESTREOS_BOOTSTRAP,
    semilla_proveedor: null,
    terminos_extra: cfg.data?.terminos_extra ?? [],
    version_metodo: VERSION_METODO,
  };
  const ev = await insertarEvaluacion(d, {
    proveedor: adaptador.id,
    modelo: cuerpo.modelo,
    version_prompt: cuerpo.version_prompt,
    parametros: parametros as unknown as Json,
    estado: "en_curso",
    tope_usd: cuerpo.tope_usd,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  });
  if (ev.error) {
    if (ev.error.code === "23505") return fallaIa("Ya hay una evaluación en curso.", 409, "evaluacion_en_curso");
    return fallaDb(ev.error, "IA: crear la evaluación");
  }
  const ahora = sello();
  const corrida = await insertarCorrida(d, {
    tipo: "evaluacion",
    evaluacion_id: ev.data.id,
    proveedor: adaptador.id,
    modelo: cuerpo.modelo,
    version_prompt: cuerpo.version_prompt,
    alcance: { pliegues, semilla: null } as unknown as Json,
    estado: "en_curso",
    costo_estimado_usd: cuerpo.costo_confirmado_usd,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
    iniciada_at: ahora,
    ultima_actividad_at: ahora,
  });
  if (corrida.error) {
    await actualizarEvaluacionEnCurso(d, ev.data.id, { estado: "fallida", terminada_at: sello() });
    return fallaDb(corrida.error, "IA: crear la corrida de la evaluación");
  }
  const plan: PlanEvaluacionApi[] = pliegues.flatMap((pliegue) => gms.map((g) => ({ pliegue, gm_clave: g.gm_clave })));
  const filas: NuevoCorridaGM[] = plan.map((p) => ({ corrida_id: corrida.data.id, pliegue: p.pliegue, gm_clave: p.gm_clave, estado: "pendiente" }));
  for (const tanda of enTandas(filas, 200)) {
    const r = await insertarCorridaGMs(d, tanda);
    if (r.error) {
      await actualizarCorrida(d, corrida.data.id, { estado: "cancelada", terminada_at: sello(), motivo_fin: "no_se_pudo_crear" });
      await actualizarEvaluacionEnCurso(d, ev.data.id, { estado: "fallida", terminada_at: sello() });
      return fallaDb(r.error, "IA: crear los GM de la evaluación");
    }
  }
  const api = await leerEvaluacionApi(ev.data.id);
  if (api.respuesta) return falla(api.respuesta);
  return listo({ evaluacion: api.data, plan, estimacion });
}

// ─── Preparar un pliegue ───

async function evaluacionViva(d: Db, id: string): Promise<Salida<{ ev: EvaluacionDb; corrida: CorridaDb }>> {
  const e = await leerEvaluacion(d, id);
  if (e.error) return fallaDb(e.error, "IA: leer la evaluación");
  if (!e.data) return fallaIa("Evaluación no encontrada.", 404, "evaluacion_no_encontrada");
  if (e.data.estado !== "en_curso") return fallaIa("La evaluación ya terminó.", 409, "evaluacion_terminada");
  const c = await leerCorridaDeEvaluacion(d, id);
  if (c.error) return fallaDb(c.error, "IA: leer la corrida de la evaluación");
  if (!c.data) return fallaIa("La evaluación no tiene corrida.", 500, "corrida_no_encontrada");
  const vivo = await aplicarCaducidad(d, c.data);
  if (vivo.respuesta) return falla(vivo.respuesta);
  if (vivo.data.estado !== "en_curso") {
    await actualizarEvaluacionEnCurso(d, id, { estado: "cancelada", terminada_at: sello() });
    return fallaIa("La evaluación caducó por inactividad.", 409, "evaluacion_terminada");
  }
  return listo({ ev: e.data, corrida: vivo.data });
}

const grupoDe = (nombre: string, esResto: boolean): GrupoGeneroIa => (esResto ? "RESTO" : nombre.trim().toUpperCase() === "MUJER" ? "MUJER" : "HOMBRE");

const unidadesDe = (rs: readonly RegistroVentaIa[]): number => rs.reduce((s, r) => s + r.unidades, 0);

/** Referencia de una fila libre del pliegue (`ia_corrida_gms.referencia`): el real y lo que predicen el método y la tendencia. Nunca se envía. */
export type ReferenciaFilaEval = { real: number; base_s: number; tendencia_pct: number | null; metodo: number; tendencia: number };
export type ReferenciaGMEval = { grupo: GrupoGeneroIa; meta_oraculo: number; corte: string; predice: number; filas: Record<string, ReferenciaFilaEval> };

/**
 * Arma EN MEMORIA la proyección del método del pliegue (datos hasta el corte), y por GM los bloques de entrada, el plan y la referencia.
 * No escribe ninguna proyección. E25 repite la entrada de D25 sin armar nada.
 */
export async function prepararPliegue(evaluacionId: string, pliegue: PliegueIa): Promise<Salida<{ gms: number }>> {
  const d = db();
  const v = await evaluacionViva(d, evaluacionId);
  if (v.respuesta) return falla(v.respuesta);
  const { ev, corrida } = v.data;
  const parametros = ev.parametros as { pliegues?: string[]; max_filas_llamada?: number; terminos_extra?: string[] } | null;
  if (!parametros?.pliegues?.includes(pliegue)) return fallaIa("Ese pliegue no es parte de la evaluación.", 404, "pliegue_no_encontrado");
  const filasR = await leerCorridaGMs(d, corrida.id);
  if (filasR.error) return fallaDb(filasR.error, "IA: leer los GM de la evaluación");
  const delPliegue = filasR.data.filter((g) => g.pliegue === pliegue);

  if (pliegue === "E25") {
    const origen = new Map(filasR.data.filter((g) => g.pliegue === "D25").map((g) => [g.gm_clave, g]));
    if (origen.size === 0 || [...origen.values()].every((g) => g.plan === null && g.estado === "pendiente")) return fallaIa("Prepara D25 antes que E25.", 409, "pliegue_sin_preparar");
    let n = 0;
    for (const g of delPliegue) {
      const o = origen.get(g.gm_clave);
      if (!o) continue;
      // Repite la ENTRADA de D25 (plan, bloques y referencia) pero parte de cero: lo que D25 ya contestó no se copia (E25 mide la estabilidad con su propia respuesta).
      const foto = (o.parcial as { _?: EstadoPlanIa } | null)?._;
      const cambio =
        o.estado === "sin_filas_libres" || o.estado === "bloqueado_privacidad"
          ? { estado: o.estado }
          : { estado: "pendiente", plan: o.plan, modo: o.modo, bloque_ids: o.bloque_ids, huella_gm: o.huella_gm, parcial: { _: foto ? { ...foto, partido: false, correccion: null } : undefined }, referencia: o.referencia, error_codigo: null };
      const r = await actualizarCorridaGM(d, g.id, cambio as Partial<NuevoCorridaGM>);
      if (r.error) return fallaDb(r.error, "IA: preparar E25");
      n += 1;
    }
    await actualizarCorrida(d, corrida.id, { ultima_actividad_at: sello() });
    return listo({ gms: n });
  }

  const def = DEFINICION_PLIEGUE[pliegue];
  const Yp = def.anio_en_curso;
  const k = def.k;
  const ctxR = await cargarContextoCalculo(d, { conFlujo: true });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  if (!(def.corte in ctx.cargas)) return fallaIa(`El mes ${def.corte} no está publicado en Venta y stock: el pliegue ${pliegue} no se puede armar.`, 409, "sin_datos_pliegue");
  const claves = clavesPertenencia(ctx.tiendas, Yp);
  const bloques = { [Yp]: bloquesDeAnio(ctx.tiendas, Yp, claves), [Yp + 1]: bloquesDeAnio(ctx.tiendas, Yp + 1, claves) };
  if (bloques[Yp].mismas.length === 0) return fallaIa(`Ninguna tienda estuvo abierta los doce meses de ${Yp - 1}.`, 409, "sin_datos_pliegue");
  const detalle = tiendasDeDetalle(ctx.tiendas, bloques, Yp);
  const desdeW12 = aPeriodo(Math.floor((indiceMes(Yp, k) - 11) / 12), ((indiceMes(Yp, k) - 11) % 12) + 1);
  const desde = aPeriodo(Yp - 3, 1);
  const tandas = enTandas(ctx.nodos.map((n) => n.gml_id), TANDA_GML);
  const ventas: VentaProyeccion[] = [];
  for (const grupo of enTandas(tandas, PARALELO)) {
    const lecturas = await Promise.all(grupo.map((gmlIds) => leerVentaTanda(d, { gmlIds, grupos: claves, tiendasDetalle: [...detalle], desde, desdeW12 })));
    for (const l of lecturas) {
      if (l.error) return fallaDb(l.error, "IA: leer la venta del pliegue");
      if (!l.data) return fallaIa("La lectura de venta no devolvió datos válidos.", 500, "venta_invalida");
      ventas.push(l.data);
    }
  }
  const tope = (p: string) => p.slice(0, 7) <= def.corte;
  const venta: VentaProyeccion = {
    filas: ventas.flatMap((x) => x.filas).filter((f) => tope(f.periodo)),
    por_tienda: ventas.flatMap((x) => x.por_tienda).filter((f) => tope(f.periodo)),
    equivalencias: ventas.flatMap((x) => x.equivalencias),
    detalle_w12: ventas.flatMap((x) => x.detalle_w12),
    disponibilidad: ventas.flatMap((x) => x.disponibilidad).filter((f) => tope(f.periodo)),
    cargas: ventas[0]?.cargas ?? {},
  };
  const salida = calcularProyeccion({
    anio: Yp,
    k,
    hoy: ctx.hoy,
    parametros: {
      crecimiento_pct_defecto: 0,
      umbral_avance: PARAMETROS_DEFECTO.umbral_avance,
      umbral_cobertura: PARAMETROS_DEFECTO.umbral_cobertura,
      umbral_cola_larga: PARAMETROS_DEFECTO.umbral_cola_larga,
      umbral_disponibilidad: PARAMETROS_DEFECTO.umbral_disponibilidad,
      rampa_maduracion: PARAMETROS_DEFECTO.rampa_maduracion,
    },
    tiendas: ctx.tiendas,
    nodos: ctx.nodos,
    agrupaciones: ctx.agrupaciones,
    vigentes: ctx.vigentes,
    periodos: ctx.periodosClase,
    factores: ctx.factores,
    venta: filtrarUniverso(venta, Yp, k),
    planAnterior: null,
    configFlujo: ctx.configFlujo,
  });

  const terminosR = await leerTerminosPrivados(d, parametros.terminos_extra ?? []);
  if (terminosR.error) return fallaDb(terminosR.error, "IA: leer los términos privados");
  const terminos = terminosR.data;
  const gms = gmsDeCatalogo(ctx.catalogo, new Set(ctx.generosMatriz));
  const base = salida.filas.filter((f) => f.tienda_id === null && f.activo);
  const umbral = PARAMETROS_DEFECTO.umbral_cola_larga;
  const factoresUsados = ctx.factores.filter((f) => f.anio <= Yp).map((f) => ({ anio: f.anio, temporada: f.temporada, ratio: f.ratio_aplicado ?? f.ratio_calculado, origen: null }));
  const filasPorGM = new Map(delPliegue.map((g) => [g.gm_clave, g]));
  let preparados = 0;

  for (const gm of gms) {
    const fila = filasPorGM.get(gm.gm_clave);
    if (!fila) continue;
    const r = await prepararGM({ d, corridaId: corrida.id, pliegue, gm, fila, base: base.filter((f) => gm.gml_ids.includes(f.gml_id)), ctx, Yp, k, umbral, terminos, factoresUsados, max_filas: parametros.max_filas_llamada ?? 60, def });
    if (r.respuesta) return falla(r.respuesta);
    preparados += 1;
  }
  await actualizarCorrida(d, corrida.id, { ultima_actividad_at: sello() });
  return listo({ gms: preparados });
}

type ArgsGM = {
  d: Db;
  corridaId: string;
  pliegue: PliegueIa;
  gm: GMCatalogo;
  fila: CorridaGMDb;
  base: FilaModelo[];
  ctx: ContextoCalculo;
  Yp: number;
  k: number;
  umbral: number;
  terminos: Awaited<ReturnType<typeof leerTerminosPrivados>>["data"];
  factoresUsados: { anio: number; temporada: "invierno" | "verano"; ratio: number | null; origen: null }[];
  max_filas: number;
  def: (typeof DEFINICION_PLIEGUE)[PliegueIa];
};

async function prepararGM(a: ArgsGM): Promise<Salida<null>> {
  const { d, Yp, k, gm } = a;
  const sinFilas = async (estado: "sin_filas_libres" | "bloqueado_privacidad") => {
    const u = await actualizarCorridaGM(d, a.fila.id, { estado, error_codigo: estado === "bloqueado_privacidad" ? "privacidad" : null });
    return u.error ? fallaDb(u.error, "IA: marcar el GM del pliegue") : listo(null);
  };
  const filasMeta = new Map<string, FilaMeta>();
  const estados = new Map<string, EstadoMetaFila>();
  for (const m of a.base) {
    const fm = filaMetaDeModelo(m.clave, m, Yp);
    if (!fm) continue;
    filasMeta.set(m.clave, fm);
    estados.set(m.clave, fm.propuesto === null ? "sin_base" : fm.propuesto < a.umbral && !fm.revision_cola_larga ? "fija_cola_larga" : "libre");
  }
  const venta = await leerVentaLineasIa(d, { gmlIds: gm.gml_ids, grupos: clavesPertenencia(a.ctx.tiendas, Yp), desde: `${Yp - 3}-01`, hasta: `${a.def.predice}-12` });
  if (venta.error) return fallaDb(venta.error, "IA: leer la venta del GM del pliegue");
  const todos = venta.data ? desempaquetarVentaLineasIa(venta.data) : new Map<string, RegistroVentaIa[]>();
  // La entrada solo ve datos hasta el corte; el real del año predicho sale de las mismas tiendas de ese año.
  const entrada = new Map<string, RegistroVentaIa[]>();
  const real = new Map<string, number>();
  for (const [clave, regs] of todos) {
    entrada.set(clave, recortarAlCorte(regs, a.def.corte));
    real.set(clave, unidadesDe(regs.filter((r) => r.anio === a.def.predice && claveIncluye(r.clave, Yp, a.def.predice))));
  }
  const libres = a.base.filter((m) => estados.get(m.clave) === "libre").sort((x, y) => (x.clave < y.clave ? -1 : 1));
  const metaOraculo = libres.reduce((s, m) => s + (real.get(m.clave) ?? 0), 0);
  if (libres.length === 0 || metaOraculo <= 0) return sinFilas("sin_filas_libres");

  const evaluadas: FilaEvaluada[] = libres.map((m) => {
    const fm = filasMeta.get(m.clave) as FilaMeta;
    return { id: m.clave, real: real.get(m.clave) ?? 0, base_s: fm.base_corregida ?? fm.base ?? 0, tendencia_pct: m.historico?.tendencia ?? null, reparto_ia: null, natural_ia: null };
  });
  const metodo = repartoMetodo(metaOraculo, evaluadas);
  const tendencia = repartoTendencia(metaOraculo, evaluadas);
  const sumaBase = evaluadas.reduce((s, e) => s + e.base_s, 0);

  const modelos = a.base.map((m) => ({ id: m.clave, m }));
  const { datos } = armarDatosGM({
    pi: { Y: Yp, k, catalogo: a.ctx.catalogo, parametros: { factores_usados: a.factoresUsados } as never, umbral_cola_larga: a.umbral },
    gm,
    filas: modelos,
    plan: { estados },
    venta: entrada,
    tiendas: { aperturas_y1: 0, cierres_y1: 0 },
  });
  const arm = armarBloquesGM(datos, { terminos: a.terminos, max_filas_llamada: a.max_filas });
  if (!arm.ok) return sinFilas("bloqueado_privacidad");

  const fDeClave = new Map<string, string>();
  for (const l of arm.lotes) for (const [f, clave] of Object.entries(l.diccionario.f)) fDeClave.set(clave, f);
  const pctMeta = sumaBase > 0 ? (metaOraculo / sumaBase - 1) * 100 : 0;
  const meta: MetaGMApi = {
    pct: pctMeta,
    sobre_base: "corregida",
    fuente: "gm",
    crecimiento_id: null,
    version: null,
    meta_gm: metaOraculo,
    fijas: 0,
    fijas_detalle: { decididas: 0, pct_propio: 0, cola_larga: 0 },
    meta_libre: metaOraculo,
    filas_libres: libres.length,
    filas_fijas: 0,
    fuera_base: { filas: 0, unidades: 0 },
  };
  const filasFinal: FilaBaseFinal[] = libres.map((m, i) => {
    const fm = filasMeta.get(m.clave) as FilaMeta;
    return { f: fDeClave.get(m.clave) ?? null, fila_id: null, fila_clave: m.clave, estado_meta: "libre", base: fm.base, base_corregida: fm.base_corregida, p_gm: metodo[i] ?? null, aporte_fijo: null, base_s: evaluadas[i].base_s };
  });
  const lineasBase: LineaBasePlan[] = arm.lineas.map((l) => {
    const propias = filasFinal.filter((x) => x.f !== null && l.filas_libres_f.includes(x.f));
    return { ...l, p_gm: propias.reduce((s, x) => s + (x.p_gm ?? 0), 0), base_s: propias.reduce((s, x) => s + (x.base_s ?? 0), 0) };
  });
  const estado: EstadoPlanIa = {
    v: 1,
    genero_id: gm.genero_id,
    mundo_id: gm.mundo_id,
    es_resto: gm.es_resto,
    version_metodo: VERSION_METODO,
    huella_historia: huellaHistoria(a.base.map((m) => filaParaHuellaDeModelo(m, Yp))),
    meta,
    meta_entrada: { pct: pctMeta, sobre: "corregida", total: metaOraculo, fijas: 0, libre: metaOraculo, provisional: false },
    filas: filasFinal,
    lineas_base: lineasBase,
    avisos_plan: [],
    partido: false,
    correccion: null,
  };
  const ids = await guardarBloques(d, a.corridaId, arm);
  if (ids.respuesta) return falla(ids.respuesta);
  const referencia: ReferenciaGMEval = { grupo: grupoDe(gm.genero, gm.es_resto), meta_oraculo: metaOraculo, corte: a.def.corte, predice: a.def.predice, filas: {} };
  libres.forEach((m, i) => {
    const f = fDeClave.get(m.clave);
    if (f) referencia.filas[f] = { real: evaluadas[i].real, base_s: evaluadas[i].base_s, tendencia_pct: evaluadas[i].tendencia_pct, metodo: metodo[i] ?? 0, tendencia: tendencia[i] ?? 0 };
  });
  const u = await actualizarCorridaGM(d, a.fila.id, {
    estado: "pendiente",
    plan: pasosDelPlan(arm, estado) as unknown as Json,
    modo: arm.modo,
    bloque_ids: ids.data,
    huella_gm: huellaGM({ proveedor: "", version_prompt: "", modelo: "", bloques: arm.lotes.map((l) => l.huella), meta: metaParaHuella(estado) }),
    parcial: { _: estado } as unknown as Json,
    referencia: referencia as unknown as Json,
    error_codigo: null,
  });
  return u.error ? fallaDb(u.error, "IA: guardar el plan del pliegue") : listo(null);
}

// ─── Un paso de un GM de un pliegue ───

export async function pasoEvaluacion(evaluacionId: string, clave: string, pliegue: PliegueIa, actor: Actor): Promise<Salida<PasoGMApi>> {
  const d = db();
  // Con la evaluación ya terminada, un paso de un GM que ya estaba hecho responde igual (el navegador puede llegar al final de su lista después de que
  // el último GM con trabajo cerró la evaluación); un GM sin terminar responde `corrida_terminada`.
  const previa = await leerEvaluacion(d, evaluacionId);
  if (previa.error) return fallaDb(previa.error, "IA: leer la evaluación");
  if (!previa.data) return fallaIa("Evaluación no encontrada.", 404, "evaluacion_no_encontrada");
  let ev = previa.data;
  let corrida: CorridaDb;
  if (ev.estado === "en_curso") {
    const v = await evaluacionViva(d, evaluacionId);
    if (v.respuesta) return falla(v.respuesta);
    ev = v.data.ev;
    corrida = v.data.corrida;
  } else {
    const c = await leerCorridaDeEvaluacion(d, evaluacionId);
    if (c.error) return fallaDb(c.error, "IA: leer la corrida de la evaluación");
    if (!c.data) return fallaIa("La evaluación no tiene corrida.", 500, "corrida_no_encontrada");
    corrida = c.data;
  }
  const ent = comprobarEntorno(ev.modelo);
  if (ent.respuesta) return falla(ent.respuesta);
  const entorno = leerEntornoIa();
  const adaptador = adaptadorDelEntorno(entorno);
  if (!adaptador || adaptador.id !== ev.proveedor) return fallaIa("El proveedor del servidor no es el de esta evaluación.", 409, "ia_no_disponible", { motivo: "proveedor_distinto" });
  const gms = await leerCorridaGMs(d, corrida.id);
  if (gms.error) return fallaDb(gms.error, "IA: leer los GM de la evaluación");
  const fila = gms.data.find((g) => g.pliegue === pliegue && g.gm_clave === clave);
  if (!fila) return fallaIa("Ese género y mundo no es parte de la evaluación.", 409, "gm_fuera_de_corrida");
  const parametros = ev.parametros as { precios?: Json; max_filas_llamada?: number; presupuesto_razonamiento?: number; terminos_extra?: string[] } | null;
  const cfg = await leerConfigVigente(d);
  if (cfg.error) return fallaDb(cfg.error, "IA: leer la configuración vigente");
  const dom: DominioPaso = {
    tipo: "evaluacion",
    d,
    corrida,
    proveedor: adaptador.adaptador.crear(),
    precios: preciosDe((parametros?.precios ?? {}) as Json),
    topes: { corrida: NUMERO(ev.tope_usd), mes: cfg.data ? NUMERO(cfg.data.tope_usd_mes) : TOPE_MES_DEFECTO, dia: 1e9 },
    config: { max_filas_llamada: parametros?.max_filas_llamada ?? 60, presupuesto_razonamiento: parametros?.presupuesto_razonamiento ?? 0, terminos_extra: parametros?.terminos_extra ?? [] },
    capacidades: [CAPACIDAD_Y1],
    actor,
    reuso: false,
    regenerar: false,
    armarPlan: null,
    gastos: async () => {
      const mes = rangoMesLima(mesLima(new Date()));
      const c = await leerCostosDelRango(d, mes.desde, mes.hasta);
      if (c.error) return fallaDb(c.error, "IA: leer el gasto del mes");
      return listo({ mes: c.data.reduce((s, x) => s + x.costo_usd, 0), dia: 0 });
    },
    alTerminarGM: () => alTerminarGMEvaluacion(d, ev),
  };
  const r = await ejecutarPasoGM(dom, fila.id);
  if (r.respuesta) {
    // Un tope (u otra detención) de la corrida deja la evaluación sin poder seguir: queda registrada como fallida.
    const c = await leerCorrida(d, corrida.id);
    if (c.data?.estado === "detenida") await actualizarEvaluacionEnCurso(d, ev.id, { estado: "fallida", terminada_at: sello() });
    return r;
  }
  return r;
}

const FINALES_EVAL = ["hecho", "fallido", "sin_filas_libres", "bloqueado_privacidad"];

/** Cuando ya no queda ningún GM por hacer en ningún pliegue, calcula `resultados` y `veredicto` y deja la evaluación `completa`. */
async function alTerminarGMEvaluacion(d: Db, ev: EvaluacionDb): Promise<Salida<null>> {
  const c = await leerCorridaDeEvaluacion(d, ev.id);
  if (c.error) return fallaDb(c.error, "IA: leer la corrida de la evaluación");
  if (!c.data) return listo(null);
  const gms = await leerCorridaGMs(d, c.data.id);
  if (gms.error) return fallaDb(gms.error, "IA: leer los GM de la evaluación");
  if (!gms.data.every((g) => FINALES_EVAL.includes(g.estado))) return listo(null);

  const pliegueDe = async (p: PliegueIa): Promise<Salida<GMEvaluado[] | null>> => {
    const delPliegue = gms.data.filter((g) => g.pliegue === p);
    if (delPliegue.length === 0) return listo(null);
    const salida: GMEvaluado[] = [];
    for (const g of delPliegue) {
      const ref = g.referencia as unknown as ReferenciaGMEval | null;
      const estado = (g.parcial as { _?: EstadoPlanIa } | null)?._;
      if (!ref || !estado || g.estado === "sin_filas_libres" || g.estado === "bloqueado_privacidad") continue;
      let porClave = new Map<string, { natural: number | null; reparto: number | null }>();
      if (g.estado === "hecho" && g.propuesta_gm_id) {
        const pg = await leerPropuestaGM(d, g.propuesta_gm_id);
        if (pg.error) return fallaDb(pg.error, "IA: leer la propuesta del pliegue");
        const filas = await leerFilasDePropuestas(d, [g.propuesta_gm_id]);
        if (filas.error) return fallaDb(filas.error, "IA: leer las filas de la propuesta del pliegue");
        porClave = new Map(filas.data.map((f) => [f.fila_clave, { natural: f.natural_y1, reparto: f.meta_y1_al_generar }]));
      }
      const filas: FilaEvaluada[] = estado.filas
        .filter((f) => f.estado_meta === "libre" && f.f !== null && ref.filas[f.f])
        .map((f) => {
          const r = ref.filas[f.f as string];
          const x = porClave.get(f.fila_clave);
          return { id: f.f as string, real: r.real, base_s: r.base_s, tendencia_pct: r.tendencia_pct, reparto_ia: x?.reparto ?? null, natural_ia: x?.natural ?? null };
        });
      salida.push({ clave: g.gm_clave, grupo: ref.grupo, filas, meta: ref.meta_oraculo });
    }
    return listo(salida);
  };
  const d25 = await pliegueDe("D25");
  const e25 = await pliegueDe("E25");
  const d24 = await pliegueDe("D24");
  for (const x of [d25, e25, d24]) if (x.respuesta) return falla(x.respuesta);
  const mejora = (ev.parametros as { mejora_min?: number } | null)?.mejora_min ?? MEJORA_MIN_DESDE_SEGUNDA;
  const { resultados, veredicto } = resultadosDeEvaluacion({ d25: d25.data, e25: e25.data, d24: d24.data, mejora_min: mejora });
  const u = await actualizarEvaluacionEnCurso(d, ev.id, { estado: "completa", resultados: resultados as unknown as Json, veredicto: veredicto as unknown as Json, terminada_at: sello() });
  if (u.error) return fallaDb(u.error, "IA: cerrar la evaluación");
  const hayFallidos = gms.data.some((g) => g.estado === "fallido");
  await actualizarCorrida(d, c.data.id, { estado: hayFallidos ? "parcial" : "completa", terminada_at: sello() });
  return listo(null);
}

// ─── Cancelar ───

export async function cancelarEvaluacion(id: string): Promise<Salida<EvaluacionApi>> {
  const d = db();
  const e = await leerEvaluacion(d, id);
  if (e.error) return fallaDb(e.error, "IA: leer la evaluación");
  if (!e.data) return fallaIa("Evaluación no encontrada.", 404, "evaluacion_no_encontrada");
  if (e.data.estado === "en_curso") {
    const c = await leerCorridaDeEvaluacion(d, id);
    if (c.data) await actualizarCorrida(d, c.data.id, { estado: "cancelada", terminada_at: sello(), motivo_fin: "cancelada_por_el_usuario" });
    const u = await actualizarEvaluacionEnCurso(d, id, { estado: "cancelada", terminada_at: sello() });
    if (u.error) return fallaDb(u.error, "IA: cancelar la evaluación");
  }
  return leerEvaluacionApi(id);
}

