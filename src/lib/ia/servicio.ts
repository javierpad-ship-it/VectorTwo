import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { leerVigentes } from "@/lib/crecimientos/consultas-vigentes";
import { leerFilasConAnios } from "@/lib/proyeccion/consultas";
import { cargarContextoCalculo } from "@/lib/proyeccion/contexto";
import { calculoEnCurso } from "@/lib/proyeccion/reglas";
import { bloqueosNinoDe, crecimientosDeHoy, desactualizadaDe } from "@/lib/proyeccion/servicio";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";
import { falla, fallaDb, listo, sello, type Actor, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { VERSION_METODO } from "@/lib/proyeccion/tipos";
import type { FilaConAnios } from "@/lib/proyeccion/persistencia";
import type { RespuestaDecidirFilaApi } from "@/lib/proyeccion/tipos";
import {
  actualizarCorrida,
  insertarConfig,
  insertarCorrida,
  insertarCorridaGMs,
  leerConfigVigente,
  leerConfiguraciones,
  leerCorrida,
  leerCorridaDeEvaluacion,
  leerCorridaEnCurso,
  leerCorridaGMs,
  leerCorridaGMsDeCorridas,
  leerCorridasDeConfig,
  leerCorridasDeProyeccion,
  leerCorridasDelRango,
  leerCostosDelRango,
  leerCostosPorCorrida,
  leerCostosPorCorridaGM,
  leerEntrada,
  leerEvaluacion,
  leerFilasDePropuestas,
  leerModelosRespondidos,
  leerPropuestaFila,
  leerPropuestaGM,
  leerPropuestasDeProyeccion,
  leerUltimaLlamada,
  maxVersionConfig,
  reemplazarConfigVigente,
  restaurarConfigVigente,
  deByteaHex,
  descomprimirContenido,
  type ConfigDb,
  type CorridaDb,
  type CorridaGMDb,
  type NuevoCorridaGM,
  type PropuestaFilaDb,
  type PropuestaGMDb,
} from "./consultas";
import { armarEstimacionGM, type GMParaPlan } from "./servicio-estimacion";
import {
  cargarProyeccionIa,
  filasBaseDeGM,
  filaMetaDe,
  huellaHistoriaDeGM,
  huellasHistoriaDe,
  leerClaveGM,
  leerContextoTiendasGM,
  planMetaDeGM,
  aportesDeModelo,
  type GMCatalogo,
  type PlanMetaGM,
  type ProyeccionIa,
} from "./contexto-gm";
import { motivoNoArranca, estimarCorrida } from "./costo";
import { leerEntornoIa, type EntornoIa } from "./entorno";
import { lecturaDeGM, textoMotivosDesactualizada, type FilaHoy, type LecturaGM, type PropuestaGuardada } from "./lectura-gm";
import { diaLima, mesLima, rangoDiaLima, rangoMesLima } from "./limites";
import { PROMPTS, VERSIONES_PROMPT } from "./prompt";
import { adaptadorDelEntorno } from "./proveedores";
import type { ProveedorIA } from "./proveedor";
import { aFilaModelo } from "@/lib/proyeccion/persistencia";
import type { aceptarIaSchema, configuracionSchema, iniciarCorridaSchema, terminarCorridaSchema } from "./esquemas";
import {
  CAPACIDADES_IA,
  CORRIDA_CADUCA_MIN,
  type ConfiguracionIaApi,
  type CorridaApi,
  type EstimacionApi,
  type GMIaDetalleApi,
  type GMIaResumenApi,
  type IaFilaApi,
  type MetaGMApi,
  type MotivoIa,
  type MotivoServicioIa,
  type PreciosIa,
  type ServicioIaApi,
  type VeredictoCapacidadIa,
  type CapacidadIa,
  type EstadoMetaFila,
} from "./tipos-api";

/**
 * Servicio de la propuesta con IA (ficha 07e, §3.1 y §3.2): estado del servicio, lecturas de la propuesta, inicio y cierre de corridas, «Aceptar IA»,
 * configuración, uso y auditoría de entradas. Cada operación abre su cliente con `supabaseAdmin()` (los handlers nunca tocan la base) y devuelve
 * `{ data, respuesta }`. Los pasos de un GM viven en `servicio-pasos.ts` y la evaluación en `servicio-evaluacion.ts`. Solo servidor.
 *
 * La IA no cambia nada de M7: aquí solo se LEE M7 por sus funciones exportadas y «Aceptar IA» llama a `decidirFila` con la traza.
 */

const db = (): Db => supabaseAdmin();

// ─── Errores con código y detalle ───

/** `{ error, codigo, ...extra }` (como los `409` de M7 con listas): la pantalla distingue un `409` de otro por `codigo`. */
export function errorIa(mensaje: string, status: number, codigo: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: mensaje, codigo, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}
export const fallaIa = (mensaje: string, status: number, codigo: string, extra: Record<string, unknown> = {}): Salida<never> => falla(errorIa(mensaje, status, codigo, extra));

// ─── Servicio: ¿puede la IA trabajar hoy? ───

export type ServicioInterno = {
  api: ServicioIaApi;
  config: ConfigDb | null;
  precios: PreciosIa | null;
  /** Solo si el servicio puede llamar (disponible, o con el tope mensual alcanzado: lo decide el motor antes de cada llamada). */
  proveedor: ProveedorIA | null;
  entorno: EntornoIa;
};

export const CAPACIDAD_Y1: CapacidadIa = "distribucion_y1";

/** Ventana (ms) en que un `401`/`403` reciente del proveedor deja el servicio en `clave_invalida` (después se vuelve a intentar). */
const VENTANA_CLAVE_INVALIDA_MS = 10 * 60_000;

const NUMERO = (v: unknown, defecto = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : defecto);

export function preciosDe(json: Json): PreciosIa {
  const o = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  return { entrada: NUMERO(o.entrada), entrada_cache: NUMERO(o.entrada_cache), salida: NUMERO(o.salida) };
}

const capacidadesDe = (c: readonly string[]): CapacidadIa[] => c.filter((x): x is CapacidadIa => (CAPACIDADES_IA as readonly string[]).includes(x));

export function aConfigApi(c: ConfigDb): ConfiguracionIaApi {
  return {
    id: c.id,
    version: c.version,
    estado: c.estado === "vigente" ? "vigente" : "reemplazada",
    proveedor: c.proveedor,
    modelo: c.modelo,
    version_prompt: c.version_prompt,
    capacidades: capacidadesDe(c.capacidades),
    evaluacion_id: c.evaluacion_id,
    tope_usd_corrida: NUMERO(c.tope_usd_corrida),
    tope_usd_mes: NUMERO(c.tope_usd_mes),
    tope_usd_dia_usuario: NUMERO(c.tope_usd_dia_usuario),
    max_filas_llamada: c.max_filas_llamada,
    incluir_cola_larga: c.incluir_cola_larga,
    presupuesto_razonamiento: c.presupuesto_razonamiento,
    precios: preciosDe(c.precios),
    terminos_extra: c.terminos_extra,
    nota: c.nota,
    usuario_nombre: c.usuario_nombre,
    aprobada_at: c.aprobada_at,
  };
}

function veredictoDe(json: Json | null): Record<CapacidadIa, VeredictoCapacidadIa> {
  const o = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const v = o.distribucion_y1;
  return { distribucion_y1: v === "gana" || v === "no_gana" || v === "sin_dato" ? v : "sin_dato" };
}

/**
 * Evalúa si la IA puede trabajar hoy, en este orden (§5.5.8): `IA_DESACTIVADA`, proveedor sin adaptador, falta la clave, sin configuración vigente,
 * configuración de otro proveedor o de un modelo fuera de `IA_MODELO`, sin capacidades, clave rechazada hace poco y tope mensual. También trae el
 * gasto del mes y del día del usuario. No llama al proveedor.
 */
export async function evaluarServicio(d: Db, perfilId: string | null, ahora: Date = new Date()): Promise<Salida<ServicioInterno>> {
  const entorno = leerEntornoIa();
  const adaptador = adaptadorDelEntorno(entorno);
  const cR = await leerConfigVigente(d);
  if (cR.error) return fallaDb(cR.error, "IA: leer la configuración vigente");
  const config = cR.data;
  const mes = rangoMesLima(mesLima(ahora));
  const costos = await leerCostosDelRango(d, mes.desde, mes.hasta);
  if (costos.error) return fallaDb(costos.error, "IA: leer el gasto del mes");
  const dia = rangoDiaLima(diaLima(ahora));
  const gastoMes = costos.data.reduce((s, c) => s + c.costo_usd, 0);
  const gastoDia = costos.data.filter((c) => perfilId !== null && c.perfil_id === perfilId && c.created_at >= dia.desde && c.created_at < dia.hasta).reduce((s, c) => s + c.costo_usd, 0);
  const ultima = await leerUltimaLlamada(d);
  if (ultima.error) return fallaDb(ultima.error, "IA: leer la última llamada");
  const claveInvalida = ultima.data?.estado === "clave_invalida" && ahora.getTime() - Date.parse(ultima.data.created_at) < VENTANA_CLAVE_INVALIDA_MS;
  const capacidades = config ? capacidadesDe(config.capacidades) : [];

  let motivo: MotivoServicioIa | null = null;
  if (entorno.desactivada) motivo = "desactivada_entorno";
  else if (!adaptador) motivo = "sin_proveedor";
  else if (!adaptador.adaptador.hayClave()) motivo = "sin_clave";
  else if (!config) motivo = "sin_configuracion";
  else if (config.proveedor !== adaptador.id) motivo = "proveedor_distinto";
  else if (!entorno.modelos.includes(config.modelo)) motivo = "modelo_no_permitido";
  else if (capacidades.length === 0) motivo = "sin_capacidades";
  else if (claveInvalida) motivo = "clave_invalida";
  else if (gastoMes >= NUMERO(config.tope_usd_mes)) motivo = "tope_mensual";

  let evaluacion: ServicioIaApi["evaluacion"] = null;
  if (config?.evaluacion_id) {
    const e = await leerEvaluacion(d, config.evaluacion_id);
    if (e.error) return fallaDb(e.error, "IA: leer la evaluación de la configuración");
    if (e.data) evaluacion = { id: e.data.id, fecha: e.data.terminada_at ?? e.data.iniciada_at, veredicto: veredictoDe(e.data.veredicto) };
  }
  const api: ServicioIaApi = {
    disponible: motivo === null,
    motivo,
    proveedor: adaptador?.id ?? null,
    modelos_permitidos: entorno.modelos,
    modelo: config?.modelo ?? null,
    version_prompt: config?.version_prompt ?? null,
    capacidades,
    gasto_mes_usd: gastoMes,
    tope_usd_mes: config ? NUMERO(config.tope_usd_mes) : null,
    tope_usd_corrida: config ? NUMERO(config.tope_usd_corrida) : null,
    gasto_dia_usuario_usd: gastoDia,
    tope_usd_dia_usuario: config ? NUMERO(config.tope_usd_dia_usuario) : null,
    evaluacion,
  };
  return listo({ api, config, precios: config ? preciosDe(config.precios) : null, proveedor: (motivo === null || motivo === "tope_mensual") && adaptador ? adaptador.adaptador.crear() : null, entorno });
}

const MOTIVOS_DE_ENTORNO: readonly MotivoServicioIa[] = ["desactivada_entorno", "sin_proveedor", "sin_clave", "sin_configuracion", "proveedor_distinto", "modelo_no_permitido"];

const MENSAJE_SERVICIO: Record<MotivoServicioIa, string> = {
  sin_clave: "Falta la clave del proveedor de IA en el servidor.",
  desactivada_entorno: "La IA está desactivada por el entorno del servidor.",
  sin_configuracion: "Todavía no hay una configuración de IA aprobada.",
  sin_capacidades: "La configuración de IA vigente no tiene ninguna capacidad encendida.",
  clave_invalida: "El proveedor rechazó la clave del servidor.",
  tope_mensual: "Se alcanzó el tope de gasto del mes.",
  sin_proveedor: "El servidor no tiene proveedor de IA configurado.",
  proveedor_distinto: "La configuración vigente es de otro proveedor: el administrador debe evaluar y guardar una nueva.",
  modelo_no_permitido: "La configuración vigente es de un modelo que el servidor ya no permite: el administrador debe evaluar y guardar una nueva.",
};

/** `409 ia_no_disponible` con su motivo. */
export const faltaServicio = (s: ServicioInterno): Salida<never> => fallaIa(MENSAJE_SERVICIO[s.api.motivo ?? "sin_configuracion"], 409, "ia_no_disponible", { motivo: s.api.motivo });

/** Las lecturas de la propuesta se permiten salvo que falte el entorno, la configuración o la capacidad; un tope o una clave rechazada no las ocultan. */
export function lecturaPermitida(s: ServicioInterno): { ok: true } | { ok: false; respuesta: NextResponse } {
  const motivo = s.api.motivo;
  if (motivo !== null && MOTIVOS_DE_ENTORNO.includes(motivo)) return { ok: false, respuesta: errorIa(MENSAJE_SERVICIO[motivo], 409, "ia_no_disponible", { motivo }) };
  if (!s.api.capacidades.includes(CAPACIDAD_Y1)) return { ok: false, respuesta: errorIa("La propuesta de IA para la distribución de la meta está apagada.", 409, "capacidad_apagada") };
  return { ok: true };
}

// ─── Corridas ───

export const esTerminalGM = (estado: string): boolean => ["hecho", "reusado", "sin_filas_libres", "bloqueado_privacidad"].includes(estado);

/** Cuántos GM de la corrida terminaron (con propuesta, reuso, sin filas libres o bloqueados por privacidad) o fallaron: nada más que hacer en ellos. */
const sinPendientes = (gms: readonly CorridaGMDb[]): boolean => gms.every((g) => esTerminalGM(g.estado) || g.estado === "fallido");

/** Una corrida `en_curso` sin actividad en `CORRIDA_CADUCA_MIN` minutos pasa a `abandonada`. Devuelve la corrida ya actualizada. */
export async function aplicarCaducidad(d: Db, corrida: CorridaDb, ahora: Date = new Date()): Promise<Salida<CorridaDb>> {
  if (corrida.estado !== "en_curso" || ahora.getTime() - Date.parse(corrida.ultima_actividad_at) < CORRIDA_CADUCA_MIN * 60_000) return listo(corrida);
  const r = await actualizarCorrida(d, corrida.id, { estado: "abandonada", terminada_at: ahora.toISOString() });
  if (r.error) return fallaDb(r.error, "IA: caducar la corrida");
  return listo(r.data ?? { ...corrida, estado: "abandonada" });
}

/** `CorridaApi` de varias corridas: los contadores se derivan de `ia_corrida_gms` e `ia_llamadas` (R33, nada es contador). */
export async function aCorridasApi(d: Db, corridas: readonly CorridaDb[]): Promise<Salida<CorridaApi[]>> {
  if (corridas.length === 0) return listo([]);
  const ids = corridas.map((c) => c.id);
  const [gms, costos] = await Promise.all([leerCorridaGMsDeCorridas(d, ids), leerCostosPorCorrida(d, ids)]);
  if (gms.error) return fallaDb(gms.error, "IA: leer los GM de las corridas");
  if (costos.error) return fallaDb(costos.error, "IA: leer el costo de las corridas");
  return listo(
    corridas.map((c): CorridaApi => {
      const mios = gms.data.filter((g) => g.corrida_id === c.id);
      return {
        id: c.id,
        estado: c.estado,
        gm_total: mios.length,
        gm_hechos: mios.filter((g) => g.estado === "hecho").length,
        gm_reusados: mios.filter((g) => g.estado === "reusado").length,
        gm_fallidos: mios.filter((g) => g.estado === "fallido").length,
        costo_usd: Math.round((costos.data.get(c.id) ?? 0) * 1e4) / 1e4,
        costo_estimado_usd: NUMERO(c.costo_estimado_usd),
        proveedor: c.proveedor,
        modelo: c.modelo,
        version_prompt: c.version_prompt,
        usuario_nombre: c.usuario_nombre,
        iniciada_at: c.iniciada_at,
        terminada_at: c.terminada_at,
        motivo_fin: c.motivo_fin,
      };
    })
  );
}

export async function aCorridaApi(d: Db, corrida: CorridaDb): Promise<Salida<CorridaApi>> {
  const r = await aCorridasApi(d, [corrida]);
  if (r.respuesta) return falla(r.respuesta);
  return listo(r.data[0]);
}

/** Cuando ya no queda ningún GM por hacer, la corrida `en_curso` pasa sola a `completa` (todos bien) o `parcial` (alguno falló). */
export async function cerrarCorridaSiTerminada(d: Db, corrida: CorridaDb): Promise<Salida<CorridaDb>> {
  if (corrida.estado !== "en_curso") return listo(corrida);
  const gms = await leerCorridaGMs(d, corrida.id);
  if (gms.error) return fallaDb(gms.error, "IA: leer los GM de la corrida");
  if (!sinPendientes(gms.data)) return listo(corrida);
  const estado = gms.data.some((g) => g.estado === "fallido") ? "parcial" : "completa";
  const r = await actualizarCorrida(d, corrida.id, { estado, terminada_at: sello() });
  if (r.error) return fallaDb(r.error, "IA: cerrar la corrida");
  return listo(r.data ?? { ...corrida, estado });
}

// ─── Lectura de la propuesta de un GM ───

type IntentoGM = "bloqueado_privacidad" | "fallido" | null;

export type LecturaProyeccionIa = {
  pi: ProyeccionIa;
  servicio: ServicioInterno;
  filas: FilaConAnios[];
  propuestas: Map<string, PropuestaGuardada>;
  anteriores: Map<string, { id: string; created_at: string; proveedor: string; modelo: string; version_prompt: string }[]>;
  intentos: Map<string, IntentoGM>;
  huellas: Map<string, string>;
};

const aFilaHoy = (f: FilaConAnios, pi: ProyeccionIa, historico: boolean): FilaHoy | null => {
  const meta = filaMetaDe(f, pi.Y);
  if (!meta) return null;
  const nodo = pi.catalogo.nodos.get(f.gml_id);
  const y = f.proyeccion_fila_anios.find((a) => a.anio === pi.Y && a.activo);
  let aportes: { entrantes: number; salientes: number } | null = null;
  if (historico) {
    const m = aFilaModelo(f, pi.k, pi.Y);
    const regS = m.registros.find((r) => r.anio === pi.Y + 1);
    if (regS) aportes = aportesDeModelo(m, m.registros.find((r) => r.anio === pi.Y), regS);
  }
  return {
    fila_id: f.id,
    clave: f.clave,
    linea: nodo?.linea ?? "—",
    equivalencia: f.equivalencia_id ? (nodo?.equivalencias.get(f.equivalencia_id) ?? null) : null,
    agrupacion_marca: pi.catalogo.agrupacionesMarca.get(f.agrupacion_marca_id) ?? "—",
    meta,
    vigente_y1: meta.vigente,
    decidida_y1: meta.decidido !== null,
    vigente_y: y ? (y.decidido ?? y.propuesto ?? null) : null,
    decidida_y: y ? y.decidido !== null : false,
    aporte_entrantes: aportes?.entrantes ?? null,
    aporte_salientes: aportes?.salientes ?? null,
  };
};

const aPropuestaGuardada = (p: PropuestaGMDb, filas: readonly PropuestaFilaDb[], costo: number): PropuestaGuardada => ({
  id: p.id,
  created_at: p.created_at,
  usuario_nombre: p.usuario_nombre,
  proveedor: p.proveedor,
  modelo: p.modelo,
  version_prompt: p.version_prompt,
  razon_gm: p.razon_gm,
  version_metodo: p.version_metodo,
  huella_historia: p.huella_historia,
  meta: p.meta !== null && typeof p.meta === "object" && !Array.isArray(p.meta) ? (p.meta as unknown as MetaGMApi) : null,
  costo_usd: Math.round(costo * 1e4) / 1e4,
  filas: filas.map((f) => ({
    id: f.id,
    fila_id: f.fila_id,
    fila_clave: f.fila_clave,
    estado_meta: f.estado_meta,
    base_corregida_al_generar: f.base_corregida_al_generar === null ? null : Number(f.base_corregida_al_generar),
    aporte_fijo_al_generar: f.aporte_fijo_al_generar,
    natural_y1: f.natural_y1,
    razon_natural: f.razon_natural,
    meta_y1_modelo: f.meta_y1_modelo,
    meta_y1_al_generar: f.meta_y1_al_generar,
    razon: f.razon,
    banderas: f.banderas,
    senales: f.senales,
    avisos: f.avisos,
    confianza: f.confianza,
  })),
});

/**
 * Lo que hace falta para leer la propuesta de uno o varios GM: las filas de hoy (columnas ligeras), las propuestas guardadas (la vigente de un GM es la
 * más reciente), cómo terminó el último intento de cada GM y la `huella_historia` de hoy (con caché por `(proyeccion, calculado_at)`).
 */
export async function cargarLecturaProyeccion(d: Db, pi: ProyeccionIa, servicio: ServicioInterno, gms: readonly GMCatalogo[]): Promise<Salida<LecturaProyeccionIa>> {
  const filas = await leerFilasConAnios(d, pi.p.id, { columnas: "ligeras", tiendaId: null, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "IA: leer las filas de la proyección");
  const todas = await leerPropuestasDeProyeccion(d, pi.p.id);
  if (todas.error) return fallaDb(todas.error, "IA: leer las propuestas");
  const claves = new Set(gms.map((g) => g.gm_clave));
  const vigentes = new Map<string, PropuestaGMDb>();
  const anteriores = new Map<string, { id: string; created_at: string; proveedor: string; modelo: string; version_prompt: string }[]>();
  for (const p of todas.data) {
    if (!claves.has(p.gm_clave)) continue;
    if (!vigentes.has(p.gm_clave)) vigentes.set(p.gm_clave, p);
    else anteriores.set(p.gm_clave, [...(anteriores.get(p.gm_clave) ?? []), { id: p.id, created_at: p.created_at, proveedor: p.proveedor, modelo: p.modelo, version_prompt: p.version_prompt }]);
  }
  const filasProp = await leerFilasDePropuestas(d, [...vigentes.values()].map((p) => p.id));
  if (filasProp.error) return fallaDb(filasProp.error, "IA: leer las filas de las propuestas");
  const costos = await leerCostosPorCorridaGM(d, [...vigentes.values()].map((p) => p.corrida_gm_id));
  if (costos.error) return fallaDb(costos.error, "IA: leer el costo de las propuestas");
  const propuestas = new Map<string, PropuestaGuardada>();
  for (const [clave, p] of vigentes) propuestas.set(clave, aPropuestaGuardada(p, filasProp.data.filter((f) => f.propuesta_gm_id === p.id), costos.data.get(p.corrida_gm_id) ?? 0));

  // Cómo terminó el último intento de cada GM (solo importa si no hay propuesta).
  const intentos = new Map<string, IntentoGM>();
  const corridas = await leerCorridasDeProyeccion(d, pi.p.id, 5);
  if (corridas.error) return fallaDb(corridas.error, "IA: leer las corridas");
  const gmsCorrida = await leerCorridaGMsDeCorridas(d, corridas.data.map((c) => c.id));
  if (gmsCorrida.error) return fallaDb(gmsCorrida.error, "IA: leer los GM de las corridas");
  const orden = new Map(corridas.data.map((c, i) => [c.id, i]));
  for (const g of [...gmsCorrida.data].filter((x) => ["hecho", "reusado", "fallido", "bloqueado_privacidad"].includes(x.estado)).sort((a, b) => (orden.get(a.corrida_id) ?? 99) - (orden.get(b.corrida_id) ?? 99))) {
    if (intentos.has(g.gm_clave)) continue;
    intentos.set(g.gm_clave, g.estado === "bloqueado_privacidad" ? "bloqueado_privacidad" : g.estado === "fallido" ? "fallido" : null);
  }

  const conPropuesta = gms.filter((g) => propuestas.has(g.gm_clave));
  const huellas = conPropuesta.length > 0 ? await huellasHistoriaDe(d, pi, conPropuesta) : listo(new Map<string, string>());
  if (huellas.respuesta) return falla(huellas.respuesta);
  return listo({ pi, servicio, filas: filas.data, propuestas, anteriores, intentos, huellas: huellas.data });
}

const incluirColaLarga = (s: ServicioInterno): boolean => s.config?.incluir_cola_larga ?? false;

/** Lectura de un GM con las filas de hoy y su propuesta vigente. `completas` trae el `historico` para mostrar los aportes de tiendas. */
export function lecturaDelGM(l: LecturaProyeccionIa, gm: GMCatalogo, extras: { contexto: { aperturas_y1: number; cierres_y1: number }; historico?: boolean; filas?: readonly FilaConAnios[]; huella?: string }): { lectura: LecturaGM; plan: PlanMetaGM; filasHoy: FilaHoy[] } {
  const fuente = extras.filas ?? l.filas;
  const plan = planMetaDeGM({ pi: l.pi, gm, filas: fuente, incluir_cola_larga: incluirColaLarga(l.servicio) });
  const filasHoy = filasBaseDeGM(fuente, gm).flatMap((f) => {
    const x = aFilaHoy(f, l.pi, extras.historico === true);
    return x ? [x] : [];
  });
  const config = l.servicio.config;
  const lectura = lecturaDeGM({
    gm,
    filas: filasHoy,
    plan,
    propuesta: l.propuestas.get(gm.gm_clave) ?? null,
    anteriores: l.anteriores.get(gm.gm_clave) ?? [],
    ultimo_intento: l.intentos.get(gm.gm_clave) ?? null,
    huella_historia_hoy: extras.huella ?? l.huellas.get(gm.gm_clave) ?? "",
    version_metodo_hoy: typeof l.pi.resumen?.version_metodo === "number" ? l.pi.resumen.version_metodo : 0,
    capacidad_encendida: l.servicio.api.capacidades.includes(CAPACIDAD_Y1),
    servicio_disponible: aceptarPermitido(l.servicio),
    config: config ? { modelo: config.modelo, version_prompt: config.version_prompt } : null,
    contexto: extras.contexto,
  });
  return { lectura, plan, filasHoy };
}

/** «Aceptar IA» no llama al proveedor: un tope mensual o una clave rechazada no lo impiden; faltar el entorno o la configuración, sí. */
export const aceptarPermitido = (s: ServicioInterno): boolean => s.api.motivo === null || s.api.motivo === "tope_mensual" || s.api.motivo === "clave_invalida";

// ─── GET …/ia ───

export type MotivoPrerrequisito = MotivoIa;
export type EstadoIaProyeccionApi = {
  servicio: ServicioIaApi;
  prerrequisitos: { bloquea: MotivoIa[]; avisa: MotivoIa[] };
  corrida_en_curso: CorridaApi | null;
  gms: GMIaResumenApi[];
  estimacion_pendientes: EstimacionApi;
};

/** Los motivos de desactualización de M7 que impiden generar (los de las cargas, las curvas, los crecimientos y la agrupación del Niño). */
const MOTIVOS_QUE_BLOQUEAN: readonly string[] = ["cargas_nuevas", "curvas_cambiadas", "crecimientos_cambiados", "temporada_cambiada"];

const MENSAJE_BLOQUEO: Record<MotivoIa, string> = {
  version_metodo: "La proyección se calculó con una versión anterior del método: recalcúlala antes de generar la propuesta de IA.",
  proyeccion_desactualizada: "La proyección está desactualizada (venta, curvas o crecimientos nuevos): recalcúlala antes de generar la propuesta de IA.",
  cerrada: "La proyección está cerrada: no se puede generar una propuesta de IA.",
  archivada: "La proyección está archivada: no se puede generar una propuesta de IA.",
  calculo_en_curso: "La proyección se está calculando: espera a que termine.",
  anio_siguiente_atipico: "El año que se planifica está marcado como atípico: la IA no propone sobre un año con Niño.",
  factor_y: "Falta confirmar el factor del Niño del año en curso (o está desfasado): confírmalo en Factores del Niño.",
  reaprobar_pendiente: "Hay crecimientos que reaprobar.",
  meta_provisional: "La meta del Resto no está aprobada.",
  sin_meta: "Hay géneros y mundos sin meta.",
  decisiones_y_pendientes: "Hay filas de este año sin decidir.",
};

export async function prerrequisitosIa(d: Db, pi: ProyeccionIa, planes: readonly { gm: GMCatalogo; plan: PlanMetaGM; filasHoy: readonly FilaHoy[] }[]): Promise<Salida<{ bloquea: MotivoIa[]; avisa: MotivoIa[] }>> {
  const bloquea: MotivoIa[] = [];
  const avisa: MotivoIa[] = [];
  const p = pi.p;
  if (p.estado === "cerrada") bloquea.push("cerrada");
  if (p.estado === "archivada") bloquea.push("archivada");
  if (calculoEnCurso(p.calculando_desde, sello())) bloquea.push("calculo_en_curso");
  const version = pi.resumen?.version_metodo;
  if (typeof version !== "number" || version < VERSION_METODO) bloquea.push("version_metodo");
  if (p.estado === "en_trabajo") {
    const ctx = await cargarContextoCalculo(d);
    if (ctx.respuesta) return falla(ctx.respuesta);
    const des = await desactualizadaDe(d, p, ctx.data);
    if (des.respuesta) return falla(des.respuesta);
    if (des.data.some((m) => MOTIVOS_QUE_BLOQUEAN.includes(m.codigo))) bloquea.push("proyeccion_desactualizada");
    const nino = bloqueosNinoDe(p, ctx.data, des.data);
    if (nino.anioSiguienteAtipico) bloquea.push("anio_siguiente_atipico");
    if ((nino.factorFaltante?.length ?? 0) > 0 || (nino.factorDesfasado?.length ?? 0) > 0 || (nino.factorSinConfirmar?.length ?? 0) > 0) bloquea.push("factor_y");
    const vig = await leerVigentes(d, [pi.Y + 1]);
    if (vig.error) return fallaDb(vig.error, "IA: leer los crecimientos aprobados");
    const aprobar = crecimientosDeHoy(p, ctx.data, vig.data).sinAprobar;
    if (aprobar && (aprobar.reaprobar?.length ?? 0) > 0) avisa.push("reaprobar_pendiente");
  }
  if (planes.some((x) => x.plan.fuente?.fuente === "resto_provisional")) avisa.push("meta_provisional");
  if (planes.some((x) => x.plan.libres.length > 0 && x.plan.meta === null)) avisa.push("sin_meta");
  if (planes.some((x) => x.filasHoy.some((f) => f.meta && x.plan.estados.get(f.fila_id) === "libre" && !f.decidida_y))) avisa.push("decisiones_y_pendientes");
  return listo({ bloquea, avisa });
}

/** GM con filas base y su lectura/plan de hoy, listos para estimar y seleccionar. */
function gmsConFilas(l: LecturaProyeccionIa) {
  const salida: { gm: GMCatalogo; lectura: LecturaGM; plan: PlanMetaGM; filasHoy: FilaHoy[] }[] = [];
  for (const gm of l.pi.gms) {
    if (filasBaseDeGM(l.filas, gm).length === 0) continue;
    const r = lecturaDelGM(l, gm, { contexto: { aperturas_y1: 0, cierres_y1: 0 } });
    salida.push({ gm, ...r });
  }
  return salida;
}

/** Los GM pendientes (sin propuesta, desactualizados, fallidos o bloqueados) con filas libres. */
const ESTADOS_PENDIENTES = ["sin_propuesta", "desactualizada", "fallida", "bloqueado_privacidad"] as const;

function paraPlan(l: LecturaProyeccionIa, g: ReturnType<typeof gmsConFilas>[number], regenerar: boolean): GMParaPlan {
  const libres = g.plan.libres.length;
  const fijas = [...g.plan.estados.values()].filter((e) => e === "fija_decidida" || e === "fija_pct").length;
  const lineasLibres = new Set(g.plan.libres.map((f) => l.pi.catalogo.nodos.get(l.filas.find((x) => x.id === f.fila_id)?.gml_id ?? "")?.linea_id ?? f.fila_id)).size;
  const e = g.lectura.resumen;
  const config = l.servicio.config;
  // «Reusable»: la propuesta vigente está al día, es de la misma terna y su meta es la de hoy (el cálculo exacto lo hace el primer paso con la huella).
  const prop = l.propuestas.get(g.gm.gm_clave);
  const reusable =
    !regenerar &&
    config !== null &&
    prop !== undefined &&
    e.estado === "al_dia" &&
    prop.proveedor === config.proveedor &&
    prop.modelo === config.modelo &&
    prop.version_prompt === config.version_prompt &&
    prop.meta !== null &&
    g.plan.meta !== null &&
    prop.meta.meta_gm === g.plan.meta.meta_gm &&
    prop.meta.meta_libre === g.plan.meta.meta_libre &&
    prop.meta.fijas === g.plan.meta.fijas;
  return { gm_clave: g.gm.gm_clave, libres, fijas, lineas_libres: lineasLibres, max_filas_llamada: config?.max_filas_llamada ?? 60, reusable };
}

/** Estimación y plan (sin cargar la historia: por conteo de filas, ficha §3.9). */
function estimarSeleccion(l: LecturaProyeccionIa, elegidos: ReturnType<typeof gmsConFilas>, regenerar: boolean, tope: number) {
  const precios = l.servicio.precios ?? { entrada: 0, entrada_cache: 0, salida: 0 };
  const items = elegidos.map((g) => ({ g, p: paraPlan(l, g, regenerar) })).map(({ g, p }) => ({ g, p, e: armarEstimacionGM(p) }));
  const estimacion = estimarCorrida(items.filter((x) => x.p.libres > 0).map((x) => x.e.gm), precios, tope);
  const plan = items.map((x) => ({ gm_clave: x.g.gm.gm_clave, modo: x.p.libres > 0 ? x.e.modo : null, llamadas: x.p.libres > 0 && !x.p.reusable ? x.e.llamadas : 0, reusa: x.p.libres > 0 && x.p.reusable }));
  return { estimacion, plan };
}

const filtrarPendientes = (todos: ReturnType<typeof gmsConFilas>) => todos.filter((g) => g.plan.libres.length > 0 && (ESTADOS_PENDIENTES as readonly string[]).includes(g.lectura.resumen.estado));

export async function leerEstadoIa(id: string, actor: Actor): Promise<Salida<EstadoIaProyeccionApi>> {
  const d = db();
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const l = await cargarLecturaProyeccion(d, pi.data, s.data, pi.data.gms);
  if (l.respuesta) return falla(l.respuesta);
  const todos = gmsConFilas(l.data);
  const pre = await prerrequisitosIa(d, pi.data, todos);
  if (pre.respuesta) return falla(pre.respuesta);
  let corrida: CorridaApi | null = null;
  const c = await leerCorridaEnCurso(d, id);
  if (c.error) return fallaDb(c.error, "IA: leer la corrida en curso");
  if (c.data) {
    const v = await aplicarCaducidad(d, c.data);
    if (v.respuesta) return falla(v.respuesta);
    if (v.data.estado === "en_curso") {
      const api = await aCorridaApi(d, v.data);
      if (api.respuesta) return falla(api.respuesta);
      corrida = api.data;
    }
  }
  const tope = s.data.config ? NUMERO(s.data.config.tope_usd_corrida) : 0;
  const { estimacion } = estimarSeleccion(l.data, filtrarPendientes(todos), false, tope);
  return listo({ servicio: s.data.api, prerrequisitos: pre.data, corrida_en_curso: corrida, gms: todos.map((x) => x.lectura.resumen), estimacion_pendientes: estimacion });
}

// ─── GET …/ia/gm/[clave] y …/ia/filas ───

export async function leerGMDetalle(id: string, clave: string, actor: Actor): Promise<Salida<GMIaDetalleApi>> {
  const d = db();
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  const gm = pi.data.gms.find((g) => g.gm_clave === clave);
  if (!gm || leerClaveGM(clave) === null) return fallaIa("Género y mundo no encontrado en esta proyección.", 404, "gm_no_encontrado");
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const permitido = lecturaPermitida(s.data);
  if (!permitido.ok) return falla(permitido.respuesta);
  const l = await cargarLecturaProyeccion(d, pi.data, s.data, [gm]);
  if (l.respuesta) return falla(l.respuesta);
  const completas = await leerFilasConAnios(d, id, { columnas: "completas", gmlIds: gm.gml_ids, tiendaId: null, soloActivas: true });
  if (completas.error) return fallaDb(completas.error, "IA: leer las filas del género y mundo");
  const tiendas = await leerContextoTiendasGM(d, id, gm, pi.data.Y);
  if (tiendas.respuesta) return falla(tiendas.respuesta);
  const huella = huellaHistoriaDeGM(completas.data, gm, pi.data.k, pi.data.Y);
  const { lectura } = lecturaDelGM(l.data, gm, { contexto: tiendas.data, historico: true, filas: completas.data, huella });
  return listo(lectura.detalle);
}

export async function leerFilasIa(id: string, filtro: { genero_id?: string; mundo_id?: string; linea_id?: string }, actor: Actor): Promise<Salida<{ filas: IaFilaApi[] }>> {
  const d = db();
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const permitido = lecturaPermitida(s.data);
  if (!permitido.ok) return falla(permitido.respuesta);
  const gms = pi.data.gms.filter((g) => (filtro.genero_id === undefined || g.genero_id === filtro.genero_id) && (filtro.mundo_id === undefined || g.mundo_id === filtro.mundo_id));
  const l = await cargarLecturaProyeccion(d, pi.data, s.data, gms);
  if (l.respuesta) return falla(l.respuesta);
  const filas: IaFilaApi[] = [];
  for (const gm of gms) {
    if (!l.data.propuestas.has(gm.gm_clave)) continue;
    const { lectura } = lecturaDelGM(l.data, gm, { contexto: { aperturas_y1: 0, cierres_y1: 0 } });
    const delGM = filasBaseDeGM(l.data.filas, gm).filter((f) => filtro.linea_id === undefined || pi.data.catalogo.nodos.get(f.gml_id)?.linea_id === filtro.linea_id);
    for (const f of delGM) {
      const x = lectura.porFila.get(f.id);
      if (x) filas.push(x);
    }
  }
  return listo({ filas });
}

// ─── POST …/ia/corridas ───

export type PlanGmApi = { gm_clave: string; modo: "directo" | "jerarquico" | null; llamadas: number; reusa: boolean };
export type RespuestaIniciarCorridaApi = { corrida: CorridaApi; plan: PlanGmApi[]; estimacion: EstimacionApi };
export type IniciarCorridaCuerpo = z.infer<typeof iniciarCorridaSchema>;

export async function iniciarCorrida(id: string, cuerpo: IniciarCorridaCuerpo, actor: Actor): Promise<Salida<RespuestaIniciarCorridaApi>> {
  const d = db();
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  if (!s.data.api.disponible || s.data.config === null || s.data.proveedor === null) return faltaServicio(s.data);
  if (!s.data.api.capacidades.includes(CAPACIDAD_Y1)) return fallaIa("La propuesta de IA para la distribución de la meta está apagada.", 409, "capacidad_apagada");
  const config = s.data.config;

  const l = await cargarLecturaProyeccion(d, pi.data, s.data, pi.data.gms);
  if (l.respuesta) return falla(l.respuesta);
  const todos = gmsConFilas(l.data);
  const pre = await prerrequisitosIa(d, pi.data, todos);
  if (pre.respuesta) return falla(pre.respuesta);
  const primero = pre.data.bloquea[0];
  if (primero) return fallaIa(MENSAJE_BLOQUEO[primero], 409, primero);

  const previa = await leerCorridaEnCurso(d, id);
  if (previa.error) return fallaDb(previa.error, "IA: leer la corrida en curso");
  if (previa.data) {
    const v = await aplicarCaducidad(d, previa.data);
    if (v.respuesta) return falla(v.respuesta);
    if (v.data.estado === "en_curso") return fallaIa("Ya hay una corrida de IA en curso en esta proyección. Termínala o espera a que caduque.", 409, "corrida_en_curso", { corrida_id: v.data.id });
  }

  let elegidos: ReturnType<typeof gmsConFilas>;
  if (cuerpo.gms === "todos") elegidos = todos;
  else if (cuerpo.gms === "pendientes") elegidos = filtrarPendientes(todos);
  else {
    const claves = [...new Set(cuerpo.gms)];
    const desconocida = claves.find((c) => !todos.some((t) => t.gm.gm_clave === c));
    if (desconocida !== undefined) return fallaIa("Uno de los géneros y mundos pedidos no tiene filas en esta proyección.", 404, "gm_no_encontrado");
    elegidos = todos.filter((t) => claves.includes(t.gm.gm_clave));
  }
  if (elegidos.length === 0) return fallaIa("No hay géneros y mundos por generar: todos están al día.", 409, "sin_gm_pendientes");

  const { estimacion, plan } = estimarSeleccion(l.data, elegidos, cuerpo.regenerar, NUMERO(config.tope_usd_corrida));
  if (cuerpo.costo_confirmado_usd + 0.005 < estimacion.costo_usd) return fallaIa("Confirma el costo estimado antes de generar.", 409, "costo_no_confirmado", { estimacion });
  const topes = {
    tope_usd_corrida: NUMERO(config.tope_usd_corrida),
    restante_mes_usd: NUMERO(config.tope_usd_mes) - s.data.api.gasto_mes_usd,
    restante_dia_usuario_usd: NUMERO(config.tope_usd_dia_usuario) - s.data.api.gasto_dia_usuario_usd,
  };
  const tope = motivoNoArranca(estimacion.costo_usd, topes);
  if (tope) {
    const mensaje = { tope_corrida: "El costo estimado supera el tope por corrida.", tope_mensual: "El costo estimado supera lo que queda del tope del mes.", tope_dia: "El costo estimado supera lo que te queda hoy." }[tope];
    return fallaIa(mensaje, 409, tope, { estimacion });
  }

  const ahora = sello();
  const corrida = await insertarCorrida(d, {
    tipo: "propuesta",
    proyeccion_id: id,
    configuracion_id: config.id,
    proveedor: config.proveedor,
    modelo: config.modelo,
    version_prompt: config.version_prompt,
    anio_en_curso: pi.data.Y,
    k: pi.data.k,
    calculado_at_proyeccion: pi.data.p.calculado_at,
    alcance: { gms: cuerpo.gms === "pendientes" || cuerpo.gms === "todos" ? cuerpo.gms : elegidos.map((g) => g.gm.gm_clave), regenerar: cuerpo.regenerar, semilla: null } as unknown as Json,
    estado: "en_curso",
    costo_estimado_usd: cuerpo.costo_confirmado_usd,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
    iniciada_at: ahora,
    ultima_actividad_at: ahora,
  });
  if (corrida.error) {
    if (corrida.error.code === "23505") return fallaIa("Ya hay una corrida de IA en curso en esta proyección.", 409, "corrida_en_curso");
    return fallaDb(corrida.error, "IA: crear la corrida");
  }
  const filasGM: NuevoCorridaGM[] = elegidos.map((g) => ({
    corrida_id: corrida.data.id,
    pliegue: "",
    gm_clave: g.gm.gm_clave,
    estado: g.plan.libres.length === 0 ? "sin_filas_libres" : "pendiente",
  }));
  const gmsCreados = await insertarCorridaGMs(d, filasGM);
  if (gmsCreados.error) {
    await actualizarCorrida(d, corrida.data.id, { estado: "cancelada", terminada_at: sello(), motivo_fin: "no_se_pudo_crear" });
    return fallaDb(gmsCreados.error, "IA: crear los GM de la corrida");
  }
  const api = await aCorridaApi(d, corrida.data);
  if (api.respuesta) return falla(api.respuesta);
  return listo({ corrida: api.data, plan, estimacion });
}

// ─── POST …/ia/corridas/[corridaId]/terminar ───

export type TerminarCorridaCuerpo = z.infer<typeof terminarCorridaSchema>;

export async function terminarCorrida(id: string, corridaId: string, cuerpo: TerminarCorridaCuerpo): Promise<Salida<CorridaApi>> {
  const d = db();
  const r = await leerCorrida(d, corridaId);
  if (r.error) return fallaDb(r.error, "IA: leer la corrida");
  if (!r.data || r.data.proyeccion_id !== id || r.data.tipo !== "propuesta") return fallaIa("Corrida no encontrada.", 404, "corrida_no_encontrada");
  let corrida = r.data;
  if (corrida.estado === "en_curso") {
    const gms = await leerCorridaGMs(d, corrida.id);
    if (gms.error) return fallaDb(gms.error, "IA: leer los GM de la corrida");
    const estado = cuerpo.cancelar ? "cancelada" : gms.data.every((g) => esTerminalGM(g.estado)) ? "completa" : "parcial";
    const u = await actualizarCorrida(d, corrida.id, { estado, terminada_at: sello(), motivo_fin: cuerpo.cancelar ? "cancelada_por_el_usuario" : null });
    if (u.error) return fallaDb(u.error, "IA: terminar la corrida");
    corrida = u.data ?? (await leerCorrida(d, corridaId)).data ?? corrida;
  }
  return aCorridaApi(d, corrida);
}

// ─── POST …/ia/filas/[filaId]/aceptar ───

export type AceptarIaCuerpo = z.infer<typeof aceptarIaSchema>;

export async function aceptarIaFila(id: string, filaId: string, cuerpo: AceptarIaCuerpo, actor: Actor): Promise<Salida<RespuestaDecidirFilaApi>> {
  const d = db();
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  if (!aceptarPermitido(s.data) || s.data.config === null) return faltaServicio(s.data);
  if (!s.data.api.capacidades.includes(CAPACIDAD_Y1)) return fallaIa("La propuesta de IA para la distribución de la meta está apagada.", 409, "capacidad_apagada");
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  if (pi.data.p.estado === "cerrada") return fallaIa("La proyección está cerrada.", 409, "cerrada");
  if (pi.data.p.estado === "archivada") return fallaIa("La proyección está archivada.", 409, "archivada");
  if (cuerpo.anio !== pi.data.Y + 1) return fallaIa(`La IA solo propone cifras para ${pi.data.Y + 1}.`, 409, "anio_no_admitido");

  const pf = await leerPropuestaFila(d, cuerpo.propuesta_fila_id);
  if (pf.error) return fallaDb(pf.error, "IA: leer la propuesta de la fila");
  if (!pf.data) return fallaIa("Propuesta de IA no encontrada.", 404, "ia_no_encontrada");
  if (pf.data.fila_id !== filaId) return fallaIa("Esa propuesta de IA es de otra fila.", 409, "ia_fila_ajena");
  const pg = await leerPropuestaGM(d, pf.data.propuesta_gm_id);
  if (pg.error) return fallaDb(pg.error, "IA: leer la propuesta del género y mundo");
  if (!pg.data || pg.data.proyeccion_id !== id) return fallaIa("Esa propuesta de IA no es de esta proyección.", 409, "ia_no_vigente");
  const gm = pi.data.gms.find((g) => g.gm_clave === pg.data?.gm_clave);
  if (!gm) return fallaIa("Género y mundo no encontrado en esta proyección.", 404, "gm_no_encontrado");

  const l = await cargarLecturaProyeccion(d, pi.data, s.data, [gm]);
  if (l.respuesta) return falla(l.respuesta);
  const vigente = l.data.propuestas.get(gm.gm_clave);
  if (!vigente || vigente.id !== pg.data.id) return fallaIa("Hay una propuesta de IA más reciente para este género y mundo: vuelve a cargar.", 409, "ia_no_vigente");
  const { lectura } = lecturaDelGM(l.data, gm, { contexto: { aperturas_y1: 0, cierres_y1: 0 } });
  if (lectura.resumen.estado === "desactualizada") return fallaIa(`La propuesta de IA está desactualizada (${textoMotivosDesactualizada(lectura.resumen.motivos)}). Regenera este género y mundo.`, 409, "ia_desactualizada", { motivos: lectura.resumen.motivos });
  const fila = lectura.porFila.get(filaId);
  if (!fila) return fallaIa("Esa propuesta de IA es de otra fila.", 409, "ia_fila_ajena");
  if (fila.estado_meta !== ("libre" satisfies EstadoMetaFila)) return fallaIa("La fila ya está fija (decidida, con su porcentaje o de cola larga): no se acepta la IA.", 409, "fila_no_libre");
  if (fila.meta_y1 === null) return fallaIa("La IA no dio una cifra para esta fila.", 409, "ia_sin_valor");
  if (fila.meta_y1 !== cuerpo.valor_esperado) return fallaIa("La cifra de la IA cambió desde que la viste: revisa y acepta de nuevo.", 409, "ia_valor_cambio", { valor_actual: fila.meta_y1 });

  return decidirFila(id, filaId, cuerpo.anio, { decidido: fila.meta_y1, origen: "manual", nota: cuerpo.nota }, actor, { decision_ia_fila_id: cuerpo.propuesta_fila_id });
}

// ─── Administración: configuración ───

export type AvisoConfiguracionApi = { codigo: "modelo_efectivo_distinto"; observados: string[]; produccion: string[] };
export type RespuestaConfiguracionIa = { vigente: ConfiguracionIaApi | null; versiones: ConfiguracionIaApi[]; servicio: ServicioIaApi; prompts: string[]; avisos: AvisoConfiguracionApi[] };
export type ConfiguracionCuerpo = z.infer<typeof configuracionSchema>;

/** R34: ¿algún `modelo_respuesta` de producción difiere de los observados en la evaluación que justifica la configuración? Informativo. */
async function avisosModeloEfectivo(d: Db, config: ConfigDb): Promise<Salida<AvisoConfiguracionApi[]>> {
  if (!config.evaluacion_id) return listo([]);
  const ce = await leerCorridaDeEvaluacion(d, config.evaluacion_id);
  if (ce.error) return fallaDb(ce.error, "IA: leer la corrida de la evaluación");
  if (!ce.data) return listo([]);
  const observados = await leerModelosRespondidos(d, [ce.data.id]);
  if (observados.error) return fallaDb(observados.error, "IA: leer los modelos de la evaluación");
  const corridas = await leerCorridasDeConfig(d, config.id);
  if (corridas.error) return fallaDb(corridas.error, "IA: leer las corridas de la configuración");
  const produccion = await leerModelosRespondidos(d, corridas.data.map((c) => c.id));
  if (produccion.error) return fallaDb(produccion.error, "IA: leer los modelos de producción");
  const distintos = [...produccion.data].filter((m) => !observados.data.has(m));
  return listo(distintos.length > 0 ? [{ codigo: "modelo_efectivo_distinto" as const, observados: [...observados.data].sort(), produccion: [...produccion.data].sort() }] : []);
}

export async function leerConfiguracionIa(actor: Actor): Promise<Salida<RespuestaConfiguracionIa>> {
  const d = db();
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const v = await leerConfiguraciones(d);
  if (v.error) return fallaDb(v.error, "IA: leer las configuraciones");
  const avisos = s.data.config ? await avisosModeloEfectivo(d, s.data.config) : listo<AvisoConfiguracionApi[]>([]);
  if (avisos.respuesta) return falla(avisos.respuesta);
  return listo({
    vigente: s.data.config ? aConfigApi(s.data.config) : null,
    versiones: v.data.map(aConfigApi),
    servicio: s.data.api,
    prompts: [...VERSIONES_PROMPT],
    avisos: avisos.data,
  });
}

/**
 * Guarda una versión nueva de la configuración (R23): el proveedor lo pone el servidor (`IA_PROVEEDOR`), el modelo debe estar en `IA_MODELO` y toda
 * capacidad exige una evaluación `completa` del mismo proveedor, modelo y prompt que la dio por ganadora. La anterior pasa a `reemplazada` y, si el
 * `insert` falla, se restaura.
 */
export async function guardarConfiguracionIa(cuerpo: ConfiguracionCuerpo, actor: Actor): Promise<Salida<ConfiguracionIaApi>> {
  const d = db();
  const entorno = leerEntornoIa();
  const adaptador = adaptadorDelEntorno(entorno);
  if (!adaptador) return fallaIa(MENSAJE_SERVICIO.sin_proveedor, 409, "sin_proveedor");
  if (!entorno.modelos.includes(cuerpo.modelo)) return fallaIa("Ese modelo no está entre los que permite el servidor (IA_MODELO).", 409, "modelo_no_permitido", { modelos_permitidos: entorno.modelos });
  if (!(cuerpo.version_prompt in PROMPTS)) return fallaIa("Esa versión del prompt no existe.", 409, "prompt_inexistente");

  const vig = await leerConfigVigente(d);
  if (vig.error) return fallaDb(vig.error, "IA: leer la configuración vigente");
  if ((vig.data?.version ?? null) !== cuerpo.version_vigente) return fallaIa("La configuración cambió mientras la editabas: vuelve a cargar.", 409, "vigente_cambiada");

  if (cuerpo.capacidades.length > 0 && cuerpo.evaluacion_id === null) return fallaIa("Para encender una capacidad hace falta una evaluación que la dé por ganadora.", 409, "capacidad_sin_evaluacion");
  if (cuerpo.evaluacion_id !== null) {
    const ev = await leerEvaluacion(d, cuerpo.evaluacion_id);
    if (ev.error) return fallaDb(ev.error, "IA: leer la evaluación");
    if (!ev.data) return fallaIa("Evaluación no encontrada.", 404, "evaluacion_no_encontrada");
    if (cuerpo.capacidades.length > 0) {
      if (ev.data.proveedor !== adaptador.id || ev.data.modelo !== cuerpo.modelo || ev.data.version_prompt !== cuerpo.version_prompt) {
        return fallaIa("Esa evaluación es de otro proveedor, modelo o versión de prompt: evalúa con los mismos antes de encender.", 409, "evaluacion_otro_modelo");
      }
      if (ev.data.estado !== "completa" || veredictoDe(ev.data.veredicto).distribucion_y1 !== "gana") return fallaIa("Esa evaluación no dio ganadora a la IA: no se puede encender.", 409, "evaluacion_no_gana");
    }
  }

  const max = await maxVersionConfig(d);
  if (max.error) return fallaDb(max.error, "IA: leer la última versión");
  if (vig.data) {
    const r = await reemplazarConfigVigente(d, vig.data.id);
    if (r.error) return fallaDb(r.error, "IA: reemplazar la configuración vigente");
    if (!r.data) return fallaIa("La configuración cambió mientras la editabas: vuelve a cargar.", 409, "vigente_cambiada");
  }
  const ins = await insertarConfig(d, {
    version: max.data + 1,
    estado: "vigente",
    proveedor: adaptador.id,
    modelo: cuerpo.modelo,
    version_prompt: cuerpo.version_prompt,
    capacidades: cuerpo.capacidades,
    evaluacion_id: cuerpo.evaluacion_id,
    tope_usd_corrida: cuerpo.tope_usd_corrida,
    tope_usd_mes: cuerpo.tope_usd_mes,
    tope_usd_dia_usuario: cuerpo.tope_usd_dia_usuario,
    max_filas_llamada: cuerpo.max_filas_llamada,
    incluir_cola_larga: cuerpo.incluir_cola_larga,
    presupuesto_razonamiento: cuerpo.presupuesto_razonamiento,
    precios: cuerpo.precios as unknown as Json,
    terminos_extra: cuerpo.terminos_extra,
    nota: cuerpo.nota,
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  });
  if (ins.error) {
    if (vig.data) await restaurarConfigVigente(d, vig.data.id);
    if (ins.error.code === "23505") return fallaIa("La configuración cambió mientras la editabas: vuelve a cargar.", 409, "vigente_cambiada");
    return fallaDb(ins.error, "IA: guardar la configuración");
  }
  return listo(aConfigApi(ins.data));
}

// ─── Administración: uso y auditoría ───

export type RespuestaUsoIa = { mes: string; costo_usd: number; tope_usd_mes: number | null; corridas: CorridaApi[]; por_dia: { dia: string; costo_usd: number; llamadas: number }[] };

export async function leerUsoIa(mes: string | undefined): Promise<Salida<RespuestaUsoIa>> {
  const d = db();
  const elegido = mes ?? mesLima(new Date());
  const rango = rangoMesLima(elegido);
  const costos = await leerCostosDelRango(d, rango.desde, rango.hasta);
  if (costos.error) return fallaDb(costos.error, "IA: leer el gasto del mes");
  const porDia = new Map<string, { costo_usd: number; llamadas: number }>();
  for (const c of costos.data) {
    const dia = diaLima(new Date(c.created_at));
    const x = porDia.get(dia) ?? { costo_usd: 0, llamadas: 0 };
    x.costo_usd += c.costo_usd;
    x.llamadas += 1;
    porDia.set(dia, x);
  }
  const corridas = await leerCorridasDelRango(d, rango.desde, rango.hasta);
  if (corridas.error) return fallaDb(corridas.error, "IA: leer las corridas del mes");
  const api = await aCorridasApi(d, corridas.data);
  if (api.respuesta) return falla(api.respuesta);
  const vig = await leerConfigVigente(d);
  if (vig.error) return fallaDb(vig.error, "IA: leer la configuración vigente");
  return listo({
    mes: elegido,
    costo_usd: Math.round(costos.data.reduce((s, c) => s + c.costo_usd, 0) * 1e4) / 1e4,
    tope_usd_mes: vig.data ? NUMERO(vig.data.tope_usd_mes) : null,
    corridas: api.data,
    por_dia: [...porDia].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([dia, x]) => ({ dia, costo_usd: Math.round(x.costo_usd * 1e4) / 1e4, llamadas: x.llamadas })),
  });
}

export type EntradaAuditoriaApi = { id: string; corrida_id: string; tipo: string; huella: string; bytes: number; contenido: unknown; diccionario: unknown; created_at: string };

/** El JSON canónico descomprimido y su diccionario, para auditar una llamada. Solo admin; ninguna pantalla del planner lo usa. */
export async function leerEntradaIa(id: string): Promise<Salida<EntradaAuditoriaApi>> {
  const d = db();
  const r = await leerEntrada(d, id);
  if (r.error) return fallaDb(r.error, "IA: leer la entrada");
  if (!r.data) return fallaIa("Entrada no encontrada.", 404, "entrada_no_encontrada");
  let contenido: unknown = null;
  try {
    contenido = JSON.parse(descomprimirContenido(deByteaHex(r.data.contenido_gz)));
  } catch {
    return fallaIa("La entrada guardada no se pudo leer.", 500, "entrada_ilegible");
  }
  return listo({ id: r.data.id, corrida_id: r.data.corrida_id, tipo: r.data.tipo, huella: r.data.huella, bytes: r.data.bytes, contenido, diccionario: r.data.diccionario, created_at: r.data.created_at });
}
