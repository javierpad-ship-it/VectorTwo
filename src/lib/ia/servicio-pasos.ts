import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { repartirEntero } from "@/lib/proyeccion/reparto";
import { leerFilasConAnios } from "@/lib/proyeccion/consultas";
import { aFilaModelo } from "@/lib/proyeccion/persistencia";
import { falla, fallaDb, listo, proyeccionOr404, sello, type Actor, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { crearAliasador, type Aliasador, type TerminoPrivado } from "./alias";
import { canonico } from "./canonico";
import {
  actualizarCorrida,
  actualizarCorridaGM,
  actualizarCorridaGMConToken,
  deByteaHex,
  describirErrorRegistro,
  descomprimirContenido,
  guardarEntrada,
  insertarLlamada,
  leerCorrida,
  leerCorridaGMPorId,
  leerCorridaGMs,
  leerCorridaGM,
  leerCostosPorCorrida,
  leerEntradas,
  leerLlamadasDePaso,
  leerPropuestaVigenteDeGM,
  leerTerminosPrivados,
  leerVentaLineasIa,
  registrarPropuestaIa,
  tomarCandadoGM,
  type CorridaDb,
  type CorridaGMDb,
  type PayloadRegistroIa,
} from "./consultas";
import {
  cargarProyeccionIa,
  armarDatosGM,
  filasBaseDeGM,
  gruposDeProyeccion,
  huellaHistoriaDeGM,
  leerClaveGM,
  leerContextoTiendasGM,
  planMetaDeGM,
} from "./contexto-gm";
import { costoUsd, estimarUsoLlamada, motivoDetencion, redondearUsd, tokensDeBytes } from "./costo";
import { armarBloquesGM, armarEntradaLineas, armarSufijoNatural, armarSufijoReparto, desempaquetarVentaLineasIa, type PlanEntradaGM } from "./entrada";
import { ESQUEMAS_SALIDA, jsonSchemaSalida, type TipoLlamadaIa } from "./esquemas";
import { huellaEntrada, huellaGM, huellaLlamada } from "./huellas";
import {
  CORTE_CIRCUITO_GM,
  ESPERA_429_DEFECTO_MS,
  MAX_INTENTOS_PASO,
  MAX_TOKENS_SALIDA,
  PLIEGUE_PROPUESTA,
  TIMEOUT_LLAMADA_MS,
  esperaTras429,
  esperaTrasFallo,
  semaforoLlamadas,
} from "./limites";
import { componerPropuesta, hayReparto, type EstadoPlanIa, type FilaBaseFinal, type LineaBasePlan, type SalidasPasos } from "./propuesta";
import { textoPrompt } from "./prompt";
import { ErrorProveedorIa, ErrorServicioProveedor, esErrorProveedorIa, type PeticionIa, type ProveedorIA, type RespuestaIa } from "./proveedor";
import { registrarLlamada } from "./registro";
import { aCorridaApi, cerrarCorridaSiTerminada, errorIa, esTerminalGM, evaluarServicio, fallaIa, faltaServicio, aplicarCaducidad } from "./servicio";
import { subMetasPorLinea, type PesoLinea } from "./meta";
import type { BloqueGMIa, DiccionarioEntradaIa, MetaEntradaIa, PasoPlanIa } from "./tipos";
import {
  MAX_ESPERAS_429,
  type CapacidadIa,
  type EstadoCorridaGM,
  type PasoGMApi,
  type PreciosIa,
} from "./tipos-api";
import { validarLineas, validarNatural, validarReparto, leerJsonSalida, type InvalidezIa, type ResultadoLineas, type ResultadoNatural, type ResultadoReparto } from "./validar";
import { CANDADO_GM_SEG } from "./tipos-api";

/**
 * Los pasos de un GM (ficha 07e, §3.1, §3.8 y D10): cada `POST …/paso` hace A LO SUMO UNA llamada al proveedor y responde. El navegador conduce la
 * corrida: un `429`, una sobrecarga o un tiempo agotado no son errores HTTP, sino `siguiente: "esperar"`. Un candado por GM (un único `UPDATE`) impide
 * que dos peticiones hagan el mismo paso; la propuesta entera se graba con `registrar_propuesta_ia_gm` (todo o nada).
 *
 * El motor es el mismo para una propuesta de producción y para un GM de evaluación; cambia el `DominioPaso`: quién arma el plan en el primer paso
 * (producción lo arma desde M7; una evaluación ya lo dejó preparado), de dónde salen los topes y qué se hace al terminar. Ni lo enviado ni lo recibido
 * llega nunca a los logs ni a los mensajes de error: `registro.ts` solo recibe ids, tokens, costo, duración y códigos.
 */

export const NOMBRE_ESQUEMA: Readonly<Record<TipoLlamadaIa, string>> = { natural: "salida_natural", reparto: "salida_reparto", lineas: "salida_lineas" };

/** Reservada en `parcial` para la foto del plan (no cuenta como paso). */
const CLAVE_PLAN = "_";

export type ResultadoPlan =
  | { tipo: "bloqueado" }
  | { tipo: "sin_filas_libres" }
  | { tipo: "ok"; arm: PlanEntradaGM; estado: EstadoPlanIa };

export type DominioPaso = {
  tipo: "propuesta" | "evaluacion";
  d: Db;
  corrida: CorridaDb;
  proveedor: ProveedorIA;
  precios: PreciosIa;
  topes: { corrida: number; mes: number; dia: number };
  config: { max_filas_llamada: number; presupuesto_razonamiento: number; terminos_extra: readonly string[] };
  capacidades: CapacidadIa[];
  actor: Actor;
  /** Producción reusa una propuesta con la misma huella (salvo «Regenerar»); la evaluación nunca. */
  reuso: boolean;
  regenerar: boolean;
  /** Primer paso (solo producción): arma los bloques y la foto del GM. `null` = ya viene preparado. */
  armarPlan: ((gm: CorridaGMDb, opciones: { max_filas_llamada?: number }) => Promise<Salida<ResultadoPlan>>) | null;
  /** Gasto acumulado del mes de Lima y del día del usuario (con las llamadas ya registradas). */
  gastos: () => Promise<Salida<{ mes: number; dia: number }>>;
  /** Se llama cuando un GM llega a un estado terminal (la evaluación cierra aquí sus resultados). */
  alTerminarGM: ((gm: CorridaGMDb) => Promise<Salida<null>>) | null;
};

type Parcial = Record<string, unknown>;
type PasoGuardado = ResultadoNatural | ResultadoReparto | (ResultadoLineas & { sub_metas: Record<string, number> });

const leerParcial = (gm: CorridaGMDb): Parcial => (gm.parcial !== null && typeof gm.parcial === "object" && !Array.isArray(gm.parcial) ? (gm.parcial as Parcial) : {});
const leerPlan = (gm: CorridaGMDb): PasoPlanIa[] | null => (Array.isArray(gm.plan) ? (gm.plan as unknown as PasoPlanIa[]) : null);
const estadoDe = (p: Parcial): EstadoPlanIa | null => (p[CLAVE_PLAN] as EstadoPlanIa | undefined) ?? null;
const comoJson = (v: unknown): Json => v as Json;

type BloqueGuardado = { id: string; contenido: string; bloque: BloqueGMIa; diccionario: DiccionarioEntradaIa };

// ─── Respuesta ───

async function responder(dom: DominioPaso, gm: CorridaGMDb, siguiente: PasoGMApi["siguiente"], esperarMs: number | null = null): Promise<Salida<PasoGMApi>> {
  const c = await leerCorrida(dom.d, dom.corrida.id);
  if (c.error) return fallaDb(c.error, "IA: leer la corrida");
  const api = await aCorridaApi(dom.d, c.data ?? dom.corrida);
  if (api.respuesta) return falla(api.respuesta);
  const plan = leerPlan(gm);
  const parcial = leerParcial(gm);
  return listo({
    gm_clave: gm.gm_clave,
    pliegue: dom.tipo === "evaluacion" ? gm.pliegue : null,
    estado: gm.estado as EstadoCorridaGM,
    pasos_hechos: plan ? plan.filter((p) => p.id in parcial).length : 0,
    pasos_total: plan?.length ?? 0,
    siguiente,
    esperar_ms: esperarMs,
    corrida: api.data,
  });
}

/** Actualiza el GM soltando el candado (solo si el token sigue siendo el mío) y devuelve la fila. */
async function soltar(dom: DominioPaso, gm: CorridaGMDb, token: string, cambio: Partial<CorridaGMDb> = {}): Promise<Salida<CorridaGMDb>> {
  const r = await actualizarCorridaGMConToken(dom.d, gm.id, token, { ...(cambio as Record<string, unknown>), candado_token: null, candado_desde: null });
  if (r.error) return fallaDb(r.error, "IA: actualizar el género y mundo de la corrida");
  if (!r.data) return fallaIa("Otro proceso tomó este género y mundo mientras trabajabas en él. Vuelve a intentarlo.", 409, "gm_en_proceso");
  return listo(r.data);
}

async function tocarCorrida(dom: DominioPaso): Promise<void> {
  await actualizarCorrida(dom.d, dom.corrida.id, { ultima_actividad_at: sello() });
}

/** Un GM llegó a un estado final: avisa a la evaluación y, en producción, cierra la corrida si ya no queda nada por hacer. */
async function tras(dom: DominioPaso, gm: CorridaGMDb): Promise<Salida<null>> {
  if (dom.alTerminarGM) {
    const r = await dom.alTerminarGM(gm);
    if (r.respuesta) return r;
  } else {
    const c = await leerCorrida(dom.d, dom.corrida.id);
    if (c.data) {
      const r = await cerrarCorridaSiTerminada(dom.d, c.data);
      if (r.respuesta) return falla(r.respuesta);
    }
  }
  return listo(null);
}

async function detenerCorrida(d: Db, corridaId: string, motivo: string): Promise<void> {
  await actualizarCorrida(d, corridaId, { estado: "detenida", motivo_fin: motivo, terminada_at: sello() });
}
const detener = (dom: DominioPaso, motivo: string): Promise<void> => detenerCorrida(dom.d, dom.corrida.id, motivo);

// ─── Entrada del paso ───

/** Reparte la sub-meta de las líneas entre los lotes en que aparecen (una línea partida cuenta en cada lote en proporción a sus libres). */
export function delLoteJerarquico(bloques: readonly BloqueGMIa[], subMetas: Readonly<Record<string, number>>, lote: number): number {
  const porLinea = new Map<string, number[]>();
  bloques.forEach((b, i) => {
    for (const f of b.filas) {
      if (!f.y1.pedir) continue;
      const cuentas = porLinea.get(f.l) ?? bloques.map(() => 0);
      cuentas[i] += 1;
      porLinea.set(f.l, cuentas);
    }
  });
  let total = 0;
  for (const [l, cuentas] of porLinea) {
    const sub = subMetas[l];
    if (sub === undefined) continue;
    const parte = repartirEntero(sub, cuentas) ?? cuentas.map(() => 0);
    total += parte[lote - 1] ?? 0;
  }
  return total;
}

async function cargarBloques(dom: DominioPaso, gm: CorridaGMDb): Promise<Salida<BloqueGuardado[]>> {
  const r = await leerEntradas(dom.d, gm.bloque_ids);
  if (r.error) return fallaDb(r.error, "IA: leer los bloques");
  if (r.data.length !== gm.bloque_ids.length) return fallaIa("Falta una entrada guardada de este género y mundo.", 500, "entrada_faltante");
  return listo(
    r.data.map((e) => {
      const contenido = descomprimirContenido(deByteaHex(e.contenido_gz));
      return { id: e.id, contenido, bloque: JSON.parse(contenido) as BloqueGMIa, diccionario: e.diccionario as unknown as DiccionarioEntradaIa };
    })
  );
}

/** Los alias del diccionario deben seguir siendo los de hoy (si las marcas o tiendas cambiaron a mitad de la corrida, restituir daría otro nombre). */
function aliasVigentes(bloques: readonly BloqueGuardado[], aliasador: Aliasador): boolean {
  for (const b of bloques) {
    for (const [alias, e] of Object.entries(b.diccionario.alias)) {
      const nombre = aliasador.restituir(alias);
      if (nombre === alias) return false;
      const usados: Record<string, { tipo: string; id: string | null }> = {};
      aliasador.aplicar(nombre, usados as never);
      if (usados[alias]?.id !== e.id) return false;
    }
  }
  return true;
}

// ─── Cierre del GM por error ───

async function fallar(dom: DominioPaso, gm: CorridaGMDb, token: string, codigo: string, porProveedor: boolean): Promise<Salida<PasoGMApi>> {
  const u = await soltar(dom, gm, token, { estado: "fallido", error_codigo: codigo.slice(0, 60) });
  if (u.respuesta) return falla(u.respuesta);
  if (porProveedor) {
    // Corte de circuito: 3 GM seguidos fallidos POR EL PROVEEDOR (los 429 no cuentan).
    const gms = await leerCorridaGMs(dom.d, dom.corrida.id);
    if (gms.data.length > 0) {
      const finales = gms.data.filter((g) => ["hecho", "reusado", "fallido"].includes(g.estado)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
      let seguidos = 0;
      for (const g of finales) {
        if (g.estado === "fallido" && g.error_codigo === "proveedor") seguidos += 1;
        else break;
      }
      if (seguidos >= CORTE_CIRCUITO_GM) await detener(dom, "proveedor_inestable");
    }
  }
  const t = await tras(dom, u.data);
  if (t.respuesta) return falla(t.respuesta);
  return responder(dom, u.data, "fallido");
}

// ─── Primer paso ───

export async function guardarBloques(d: Db, corridaId: string, arm: PlanEntradaGM): Promise<Salida<string[]>> {
  const ids: string[] = [];
  for (const l of arm.lotes) {
    const r = await guardarEntrada(d, { corrida_id: corridaId, tipo: "bloque", huella: l.huella, contenido: l.contenido, bytes: l.bytes, diccionario: comoJson(l.diccionario) });
    if (r.error) return fallaDb(r.error, "IA: guardar la entrada");
    if (!r.data) return fallaIa("No se pudo guardar la entrada del género y mundo.", 500, "entrada_no_guardada");
    ids.push(r.data);
  }
  return listo(ids);
}

export const metaParaHuella = (e: EstadoPlanIa) => (e.meta_entrada ? { pct: e.meta_entrada.pct, sobre: e.meta_entrada.sobre, total: e.meta_entrada.total, fijas: e.meta_entrada.fijas, libre: e.meta_entrada.libre, provisional: e.meta_entrada.provisional } : null);

/** Solo se pide el natural si no hay nada que repartir (sin meta o con las fijas por encima de la meta). */
export const pasosDelPlan = (arm: PlanEntradaGM, estado: EstadoPlanIa): PasoPlanIa[] => (hayReparto(estado) ? arm.plan : arm.plan.filter((p) => p.tipo === "natural"));

async function primerPaso(dom: DominioPaso, gm: CorridaGMDb, token: string, opciones: { max_filas_llamada?: number; sobreEstadoPartido?: boolean } = {}): Promise<Salida<PasoGMApi>> {
  if (!dom.armarPlan) {
    const u = await soltar(dom, gm, token);
    if (u.respuesta) return falla(u.respuesta);
    return fallaIa("Este pliegue todavía no está preparado.", 409, "pliegue_sin_preparar");
  }
  const r = await dom.armarPlan(gm, { max_filas_llamada: opciones.max_filas_llamada });
  if (r.respuesta) {
    await soltar(dom, gm, token);
    return falla(r.respuesta);
  }
  const plan = r.data;
  if (plan.tipo === "bloqueado" || plan.tipo === "sin_filas_libres") {
    const estado = plan.tipo === "bloqueado" ? "bloqueado_privacidad" : "sin_filas_libres";
    const u = await soltar(dom, gm, token, { estado, error_codigo: plan.tipo === "bloqueado" ? "privacidad" : null });
    if (u.respuesta) return falla(u.respuesta);
    await tocarCorrida(dom);
    const t = await tras(dom, u.data);
    if (t.respuesta) return falla(t.respuesta);
    return responder(dom, u.data, "hecho");
  }
  const ids = await guardarBloques(dom.d, dom.corrida.id, plan.arm);
  if (ids.respuesta) {
    await soltar(dom, gm, token);
    return falla(ids.respuesta);
  }
  const estado: EstadoPlanIa = { ...plan.estado, partido: opciones.sobreEstadoPartido === true };
  const huella = huellaGM({ proveedor: dom.corrida.proveedor, version_prompt: dom.corrida.version_prompt, modelo: dom.corrida.modelo, bloques: plan.arm.lotes.map((l) => l.huella), meta: metaParaHuella(estado) });

  // Reuso: la misma huella (con proveedor, modelo y prompt) que la propuesta vigente válida del GM.
  if (dom.reuso && !dom.regenerar && dom.corrida.proyeccion_id) {
    const vigente = await leerPropuestaVigenteDeGM(dom.d, dom.corrida.proyeccion_id, gm.gm_clave);
    if (vigente.error) {
      await soltar(dom, gm, token);
      return fallaDb(vigente.error, "IA: leer la propuesta vigente");
    }
    if (vigente.data && vigente.data.huella_gm === huella) {
      const reg = await registrarPropuestaIa(dom.d, { corrida_gm_id: gm.id, candado_token: token, reusa_propuesta_id: vigente.data.id, huella_gm: huella });
      if (reg.error) return errorDeRegistro(reg.error.code);
      const g = await leerCorridaGMPorId(dom.d, gm.id);
      const fila = g.data ?? gm;
      const t = await tras(dom, fila);
      if (t.respuesta) return falla(t.respuesta);
      return responder(dom, fila, "hecho");
    }
  }

  const pasos = pasosDelPlan(plan.arm, estado);
  const u = await soltar(dom, gm, token, {
    estado: "en_proceso",
    plan: comoJson(pasos),
    modo: plan.arm.modo,
    bloque_ids: ids.data,
    huella_gm: huella,
    parcial: comoJson({ [CLAVE_PLAN]: estado }),
    error_codigo: null,
  });
  if (u.respuesta) return falla(u.respuesta);
  await tocarCorrida(dom);
  return responder(dom, u.data, "continuar");
}

function errorDeRegistro(code: string | null | undefined): Salida<never> {
  const d = describirErrorRegistro(code);
  if (d) return fallaIa(d.mensaje, d.status, d.codigo);
  return fallaIa("No se pudo guardar la propuesta.", 500, "registro_fallido");
}

// ─── Una llamada ───

function resumenInvalidez(i: InvalidezIa): string {
  return i.resumen;
}

type Resultado =
  | { tipo: "ok"; guardar: PasoGuardado }
  | { tipo: "invalida"; invalidez: InvalidezIa }
  | { tipo: "rechazada" }
  | { tipo: "truncada" }
  | { tipo: "error"; error: ErrorProveedorIa };

async function ejecutarLlamada(dom: DominioPaso, gm: CorridaGMDb, token: string, paso: PasoPlanIa, estado: EstadoPlanIa, parcial: Parcial): Promise<Salida<PasoGMApi>> {
  const d = dom.d;
  const bl = await cargarBloques(dom, gm);
  if (bl.respuesta) {
    await soltar(dom, gm, token);
    return falla(bl.respuesta);
  }
  const bloques = bl.data;
  const terminosR = await leerTerminosPrivados(d, dom.config.terminos_extra);
  if (terminosR.error) {
    await soltar(dom, gm, token);
    return fallaDb(terminosR.error, "IA: leer los términos privados");
  }
  const terminos: TerminoPrivado[] = terminosR.data;
  const aliasador = crearAliasador(terminos);
  if (!aliasVigentes(bloques, aliasador)) return fallar(dom, gm, token, "alias_cambiaron", false);
  const jerarquico = gm.modo === "jerarquico";
  const meta = estado.meta_entrada;

  let bloqueTexto: string;
  let bloqueObj: unknown;
  let sufijoObj: unknown;
  let entradaBloqueId: string | null = null;
  let entradaSufijoId: string | null = null;
  let filasEnviadas = 0;
  let validar: (salida: unknown) => Resultado;
  const subMetas = (parcial.l as { sub_metas?: Record<string, number> } | undefined)?.sub_metas ?? {};

  if (paso.tipo === "natural") {
    const lote = bloques[paso.lote - 1];
    bloqueTexto = lote.contenido;
    bloqueObj = lote.bloque;
    sufijoObj = armarSufijoNatural();
    entradaBloqueId = lote.id;
    filasEnviadas = lote.bloque.filas.filter((f) => f.y1.pedir).length;
    const sobre = meta?.sobre ?? "corregida";
    validar = (salida) => {
      const v = validarNatural(salida, { bloque: lote.bloque, sobre }, { restituir: aliasador.restituir });
      return v.invalida ? { tipo: "invalida", invalidez: v.invalida } : { tipo: "ok", guardar: v };
    };
  } else if (paso.tipo === "reparto") {
    if (!meta) return fallar(dom, gm, token, "sin_meta", false);
    const lote = bloques[paso.lote - 1];
    const nat = parcial[`n${paso.lote}`] as ResultadoNatural | undefined;
    if (!nat) return fallar(dom, gm, token, "falta_natural", false);
    const delLote = jerarquico ? delLoteJerarquico(bloques.map((b) => b.bloque), subMetas, paso.lote) : meta.libre;
    const sufijo = armarSufijoReparto({
      meta: { ...meta, del_lote: delLote },
      naturales: lote.bloque.filas.filter((f) => f.y1.pedir).map((f) => ({ f: f.f, natural_y1: nat.filas.find((n) => n.f === f.f)?.natural_y1 ?? null })),
    });
    const guardado = await guardarEntrada(d, { corrida_id: dom.corrida.id, tipo: "sufijo_reparto", huella: huellaEntradaTexto(sufijo), contenido: canonico(sufijo as never), bytes: Buffer.byteLength(canonico(sufijo as never), "utf8"), diccionario: {} });
    if (guardado.error || !guardado.data) {
      await soltar(dom, gm, token);
      return guardado.error ? fallaDb(guardado.error, "IA: guardar el sufijo") : fallaIa("No se pudo guardar la entrada del reparto.", 500, "entrada_no_guardada");
    }
    bloqueTexto = lote.contenido;
    bloqueObj = lote.bloque;
    sufijoObj = sufijo;
    entradaBloqueId = lote.id;
    entradaSufijoId = guardado.data;
    filasEnviadas = lote.bloque.filas.filter((f) => f.y1.pedir).length;
    validar = (salida) => {
      const v = validarReparto(salida, { bloque: lote.bloque, sobre: meta.sobre, del_lote: delLote }, { restituir: aliasador.restituir });
      return v.invalida ? { tipo: "invalida", invalidez: v.invalida } : { tipo: "ok", guardar: v };
    };
  } else {
    if (!meta) return fallar(dom, gm, token, "sin_meta", false);
    const naturales = new Map<string, number | null>();
    for (const p of leerPlan(gm) ?? []) if (p.tipo === "natural") for (const f of (parcial[p.id] as ResultadoNatural | undefined)?.filas ?? []) naturales.set(f.f, f.natural_y1);
    const base = bloques[0].bloque;
    const entrada = armarEntradaLineas({ contexto: base.contexto, gm: base.gm, meta, lineas: estado.lineas_base, naturales }, terminos);
    if (!entrada.ok) return bloquearPorPrivacidad(dom, gm, token);
    const guardado = await guardarEntrada(d, { corrida_id: dom.corrida.id, tipo: "lineas", huella: entrada.huella, contenido: entrada.contenido, bytes: entrada.bytes, diccionario: comoJson({ f: {}, l: {}, e: {}, alias: {} }) });
    if (guardado.error || !guardado.data) {
      await soltar(dom, gm, token);
      return guardado.error ? fallaDb(guardado.error, "IA: guardar la entrada de líneas") : fallaIa("No se pudo guardar la entrada de líneas.", 500, "entrada_no_guardada");
    }
    bloqueTexto = entrada.contenido;
    bloqueObj = entrada.entrada;
    sufijoObj = { tarea: "lineas" };
    entradaBloqueId = guardado.data;
    filasEnviadas = estado.lineas_base.length;
    validar = (salida) => {
      const v = validarLineas(salida, { lineas: entrada.entrada.lineas, meta_libre: meta.libre }, { restituir: aliasador.restituir });
      if (v.invalida) return { tipo: "invalida", invalidez: v.invalida };
      // Sub-meta de cada línea: `asignarMeta` con la cifra de la IA o, si faltó o se descartó, `Σ P^GM` de sus libres (R28).
      const pesos: PesoLinea[] = estado.lineas_base.map((l) => ({
        fila_id: l.l,
        clave: l.l,
        p_gm: l.p_gm,
        meta_y1_modelo: v.lineas.find((x) => x.l === l.l)?.meta_y1 ?? null,
        natural_y1: entrada.entrada.lineas.find((x) => x.l === l.l)?.natural_y1 ?? null,
        base_s: l.base_s,
      }));
      const subs = subMetasPorLinea(meta.libre, pesos);
      return { tipo: "ok", guardar: { ...v, sub_metas: Object.fromEntries(subs ?? []) } };
    };
  }

  const sufijoTexto = canonico(sufijoObj as never);
  const bytesEntrada = Buffer.byteLength(bloqueTexto, "utf8") + Buffer.byteLength(sufijoTexto, "utf8");

  // Topes: antes de llamar, el gasto acumulado más la estimación de esta llamada no puede pasar de ninguno.
  const estimacion = estimarUsoLlamada(
    paso.tipo === "lineas" ? { tipo: "lineas", tokens_entrada: tokensDeBytes(bytesEntrada), lineas: estado.lineas_base.length } : { tipo: paso.tipo, tokens_bloque: tokensDeBytes(bytesEntrada), filas_libres: filasEnviadas }
  );
  const gastos = await dom.gastos();
  if (gastos.respuesta) {
    await soltar(dom, gm, token);
    return falla(gastos.respuesta);
  }
  const corrida = await leerCostosPorCorrida(d, [dom.corrida.id]);
  if (corrida.error) {
    await soltar(dom, gm, token);
    return fallaDb(corrida.error, "IA: leer el gasto de la corrida");
  }
  const tope = motivoDetencion({
    gasto_corrida_usd: corrida.data.get(dom.corrida.id) ?? 0,
    estimacion_llamada_usd: costoUsd(estimacion, dom.precios),
    tope_usd_corrida: dom.topes.corrida,
    gasto_mes_usd: gastos.data.mes,
    tope_usd_mes: dom.topes.mes,
    gasto_dia_usuario_usd: gastos.data.dia,
    tope_usd_dia_usuario: dom.topes.dia,
  });
  if (tope) {
    await soltar(dom, gm, token);
    await detener(dom, tope);
    return fallaIa({ tope_corrida: "Se alcanzó el tope de gasto de la corrida.", tope_mensual: "Se alcanzó el tope de gasto del mes.", tope_dia: "Se alcanzó tu tope de gasto de hoy." }[tope], 409, tope);
  }

  const previas = await leerLlamadasDePaso(d, gm.id, paso.id);
  if (previas.error) {
    await soltar(dom, gm, token);
    return fallaDb(previas.error, "IA: leer las llamadas del paso");
  }
  const sin429 = previas.data.filter((p) => p.estado !== "limite_proveedor");
  const intento = sin429.length + 1;
  const correccion = estado.correccion?.paso === paso.id ? estado.correccion.resumen : null;

  const texto = textoPrompt(dom.corrida.version_prompt);
  if (texto === null) return fallar(dom, gm, token, "prompt_inexistente", false);
  const peticion: PeticionIa = {
    modelo: dom.corrida.modelo,
    sistema: texto,
    bloque: bloqueTexto,
    sufijo: sufijoTexto,
    esquema: jsonSchemaSalida(paso.tipo),
    nombre_esquema: NOMBRE_ESQUEMA[paso.tipo],
    max_tokens: MAX_TOKENS_SALIDA,
    // Sin temperatura ni semilla: lo que admite cada modelo está pendiente de verificar (ficha §11.2, punto 4); el adaptador omite lo que no se envía.
    temperatura: null,
    semilla: null,
    presupuesto_razonamiento: dom.config.presupuesto_razonamiento,
    timeout_ms: TIMEOUT_LLAMADA_MS,
    correccion,
  };

  const inicio = Date.now();
  let respuesta: RespuestaIa | null = null;
  let errorProveedor: ErrorProveedorIa | null = null;
  try {
    respuesta = await semaforoLlamadas.ejecutar(() => dom.proveedor.llamar(peticion));
  } catch (e) {
    // Un error que no es del proveedor (un fallo del adaptador): se trata como un fallo del servicio; su mensaje no se propaga.
    errorProveedor = esErrorProveedorIa(e) ? e : new ErrorServicioProveedor("500");
  }
  const duracion = respuesta?.duracion_ms ?? Math.max(0, Date.now() - inicio);

  let resultado: Resultado;
  if (errorProveedor) resultado = { tipo: "error", error: errorProveedor };
  else if (respuesta === null) resultado = { tipo: "error", error: new ErrorServicioProveedor("500") };
  else if (respuesta.fin === "limite_salida") resultado = { tipo: "truncada" };
  else if (respuesta.fin === "rechazo" || respuesta.texto.trim() === "") resultado = { tipo: "rechazada" };
  else {
    const json = leerJsonSalida(respuesta.texto);
    resultado = json.ok ? validar(json.valor) : { tipo: "invalida", invalidez: { codigo: "zod", resumen: "la respuesta no es JSON válido" } };
  }

  // Registro de la llamada (siempre), con su estado y costo.
  const uso = respuesta?.uso ?? { entrada: 0, entrada_cache: 0, salida: 0 };
  const costo = redondearUsd(costoUsd(uso, dom.precios));
  let estadoLlamada: string;
  let codigoError: string | null = null;
  let esperar: number | null = null;
  if (resultado.tipo === "ok") estadoLlamada = "ok";
  else if (resultado.tipo === "invalida") {
    estadoLlamada = "invalida";
    codigoError = resultado.invalidez.codigo;
  } else if (resultado.tipo === "truncada") {
    estadoLlamada = "truncada";
    codigoError = "limite_salida";
  } else if (resultado.tipo === "rechazada") {
    estadoLlamada = "rechazada";
    codigoError = "rechazo";
  } else {
    codigoError = resultado.error.codigo;
    esperar = resultado.error.esperar_ms;
    estadoLlamada = { limite: "limite_proveedor", servicio: "error_proveedor", tiempo_agotado: "tiempo_agotado", solicitud_invalida: "error_proveedor", clave_invalida: "clave_invalida" }[resultado.error.tipo];
  }
  const llamada = await insertarLlamada(d, {
    corrida_id: dom.corrida.id,
    corrida_gm_id: gm.id,
    paso: paso.id,
    tipo_llamada: paso.tipo,
    intento,
    entrada_bloque_id: entradaBloqueId,
    entrada_sufijo_id: entradaSufijoId,
    huella_llamada: huellaLlamada({ proveedor: dom.corrida.proveedor, version_prompt: dom.corrida.version_prompt, modelo: dom.corrida.modelo, bloque: bloqueObj as never, sufijo: sufijoObj as never }),
    estado: estadoLlamada,
    modelo_respuesta: respuesta?.modelo_respuesta ?? null,
    id_solicitud: respuesta?.id_solicitud ?? null,
    bytes_entrada: bytesEntrada,
    filas_enviadas: filasEnviadas,
    tokens_entrada: uso.entrada,
    tokens_entrada_cache: uso.entrada_cache,
    tokens_salida: uso.salida,
    costo_usd: costo,
    duracion_ms: duracion,
    esperar_ms: esperar,
    error_codigo: codigoError,
    // Mensajes genéricos de los errores tipados: nunca la clave, cabeceras ni datos.
    error_detalle: resultado.tipo === "error" ? resultado.error.message.slice(0, 300) : null,
    perfil_id: dom.actor.id,
  });
  if (llamada.error) {
    await soltar(dom, gm, token);
    return fallaDb(llamada.error, "IA: registrar la llamada");
  }
  registrarLlamada({ corrida_id: dom.corrida.id, llamada_id: llamada.data.id, gm_clave: gm.gm_clave, paso: paso.id, estado: estadoLlamada, tokens: uso, costo, duracion_ms: duracion, error_codigo: codigoError });

  // ── Qué sigue ──
  if (resultado.tipo === "error") {
    const e = resultado.error;
    if (e.tipo === "limite") {
      const seguidas = [...previas.data].reverse().findIndex((p) => p.estado !== "limite_proveedor");
      const antes = seguidas === -1 ? previas.data.length : seguidas;
      if (antes + 1 >= MAX_ESPERAS_429) {
        const u = await soltar(dom, gm, token);
        if (u.respuesta) return falla(u.respuesta);
        await detener(dom, "limite_proveedor");
        return fallaIa("El proveedor está limitando las peticiones: sigue más tarde. Lo ya generado queda guardado.", 409, "limite_proveedor");
      }
      const u = await soltar(dom, gm, token);
      if (u.respuesta) return falla(u.respuesta);
      return responder(dom, u.data, "esperar", esperaTras429(e.esperar_ms ?? ESPERA_429_DEFECTO_MS));
    }
    if (e.tipo === "clave_invalida") {
      const u = await soltar(dom, gm, token);
      if (u.respuesta) return falla(u.respuesta);
      await detener(dom, "clave_invalida");
      return fallaIa("El proveedor rechazó la clave del servidor.", 409, "ia_no_disponible", { motivo: "clave_invalida" });
    }
    if (e.tipo === "solicitud_invalida") return fallar(dom, gm, token, "solicitud_invalida", false);
    // Servicio, sobrecarga, red o tiempo agotado: hasta MAX_INTENTOS_PASO intentos; el navegador espera y vuelve a llamar.
    if (intento < MAX_INTENTOS_PASO) {
      const u = await soltar(dom, gm, token);
      if (u.respuesta) return falla(u.respuesta);
      return responder(dom, u.data, "esperar", esperaTrasFallo(intento, e.esperar_ms));
    }
    return fallar(dom, gm, token, "proveedor", true);
  }
  if (resultado.tipo === "rechazada") return fallar(dom, gm, token, "rechazo", false);
  if (resultado.tipo === "truncada") {
    // El lote se parte en dos una vez: se rehace el plan con la mitad de filas por llamada (solo producción, que puede rearmar los bloques).
    const filasLote = Math.max(...bloques.map((b) => b.bloque.filas.length));
    if (!estado.partido && dom.armarPlan && filasLote >= 20) return primerPaso(dom, gm, token, { max_filas_llamada: Math.max(10, Math.floor(filasLote / 2)), sobreEstadoPartido: true });
    return fallar(dom, gm, token, "limite_salida", false);
  }
  if (resultado.tipo === "invalida") {
    // Un solo reintento por salida inválida, con los errores resumidos SIN datos.
    if (previas.data.some((p) => p.estado === "invalida")) return fallar(dom, gm, token, "invalida", false);
    const u = await soltar(dom, gm, token, { parcial: comoJson({ ...parcial, [CLAVE_PLAN]: { ...estado, correccion: { paso: paso.id, resumen: resumenInvalidez(resultado.invalidez) } } }) });
    if (u.respuesta) return falla(u.respuesta);
    await tocarCorrida(dom);
    return responder(dom, u.data, "continuar");
  }

  // Salida válida: se guarda el resultado del paso.
  const nuevo: Parcial = { ...parcial, [paso.id]: resultado.guardar, [CLAVE_PLAN]: { ...estado, correccion: null } };
  const plan = leerPlan(gm) ?? [];
  const ultimo = plan.every((p) => p.id in nuevo);
  if (!ultimo) {
    const u = await soltar(dom, gm, token, { parcial: comoJson(nuevo) });
    if (u.respuesta) return falla(u.respuesta);
    await tocarCorrida(dom);
    return responder(dom, u.data, "continuar");
  }
  return finalizar(dom, gm, token, estado, nuevo, bloques);
}

const huellaEntradaTexto = (x: unknown): string => huellaEntrada(x as never);

async function bloquearPorPrivacidad(dom: DominioPaso, gm: CorridaGMDb, token: string): Promise<Salida<PasoGMApi>> {
  const u = await soltar(dom, gm, token, { estado: "bloqueado_privacidad", error_codigo: "privacidad" });
  if (u.respuesta) return falla(u.respuesta);
  const t = await tras(dom, u.data);
  if (t.respuesta) return falla(t.respuesta);
  return responder(dom, u.data, "hecho");
}

// ─── Último paso: validar y grabar ───

async function finalizar(dom: DominioPaso, gm: CorridaGMDb, token: string, estado: EstadoPlanIa, parcial: Parcial, bloques: readonly BloqueGuardado[]): Promise<Salida<PasoGMApi>> {
  const plan = leerPlan(gm) ?? [];
  const delTipo = <T,>(tipo: PasoPlanIa["tipo"]): T[] => plan.filter((p) => p.tipo === tipo).map((p) => parcial[p.id] as T);
  const lineas = delTipo<ResultadoLineas & { sub_metas: Record<string, number> }>("lineas")[0] ?? null;
  const salidas: SalidasPasos = { naturales: delTipo<ResultadoNatural>("natural"), repartos: delTipo<ResultadoReparto>("reparto"), lineas };
  const modo = gm.modo === "jerarquico" ? "jerarquico" : "directo";
  const c = componerPropuesta({ plan: estado, bloques: bloques.map((b) => b.bloque), modo, salidas });
  const payload: PayloadRegistroIa = {
    corrida_gm_id: gm.id,
    candado_token: token,
    propuesta: {
      ...c.payload,
      capacidades: dom.capacidades,
      modo,
      huella_gm: gm.huella_gm ?? "",
      perfil_id: dom.actor.id,
      ...(dom.actor.nombre === null ? {} : { usuario_nombre: dom.actor.nombre }),
    },
    filas: c.filas,
  };
  const reg = await registrarPropuestaIa(dom.d, payload);
  if (reg.error) return errorDeRegistro(reg.error.code);
  const g = await leerCorridaGMPorId(dom.d, gm.id);
  const fila = g.data ?? gm;
  const t = await tras(dom, fila);
  if (t.respuesta) return falla(t.respuesta);
  return responder(dom, fila, "hecho");
}

// ─── Motor ───

/** Un paso de un GM: toma el candado, hace a lo sumo UNA llamada y responde. */
export async function ejecutarPasoGM(dom: DominioPaso, gmId: string): Promise<Salida<PasoGMApi>> {
  const d = dom.d;
  const g0 = await leerCorridaGMPorId(d, gmId);
  if (g0.error) return fallaDb(g0.error, "IA: leer el género y mundo de la corrida");
  if (!g0.data) return fallaIa("Género y mundo fuera de esta corrida.", 409, "gm_fuera_de_corrida");
  let gm = g0.data;
  if (esTerminalGM(gm.estado)) return responder(dom, gm, "hecho");
  // Un GM fallido de una evaluación no se reintenta (perdería su plan preparado): queda fallido.
  if (gm.estado === "fallido" && dom.armarPlan === null) return responder(dom, gm, "fallido");

  const c = await leerCorrida(d, dom.corrida.id);
  if (c.error) return fallaDb(c.error, "IA: leer la corrida");
  if (!c.data) return fallaIa("Corrida no encontrada.", 404, "corrida_no_encontrada");
  const vivo = await aplicarCaducidad(d, c.data);
  if (vivo.respuesta) return falla(vivo.respuesta);
  if (vivo.data.estado !== "en_curso") return fallaIa("La corrida ya terminó: inicia una nueva.", 409, "corrida_terminada");
  dom = { ...dom, corrida: vivo.data };

  if (gm.estado === "fallido") {
    // «Reintentar este GM»: vuelve a empezar desde cero (las entradas ya guardadas se reusan por su huella).
    const r = await actualizarCorridaGM(d, gm.id, { estado: "pendiente", plan: null, modo: null, parcial: {}, bloque_ids: [], huella_gm: null, error_codigo: null, candado_token: null, candado_desde: null });
    if (r.error) return fallaDb(r.error, "IA: reintentar el género y mundo");
    if (r.data) gm = r.data;
  }

  const token = randomUUID();
  const ahora = Date.now();
  const tomado = await tomarCandadoGM(d, gm.id, token, new Date(ahora).toISOString(), new Date(ahora - CANDADO_GM_SEG * 1000).toISOString());
  if (tomado.error) return fallaDb(tomado.error, "IA: tomar el candado");
  if (!tomado.data) return fallaIa("Otro proceso está trabajando este género y mundo. Espera un momento.", 409, "gm_en_proceso");
  gm = tomado.data;
  try {
    const plan = leerPlan(gm);
    const parcial = leerParcial(gm);
    const estado = estadoDe(parcial);
    if (plan === null || estado === null) return await primerPaso(dom, gm, token);
    const siguiente = plan.find((p) => !(p.id in parcial));
    if (!siguiente) {
      const bl = await cargarBloques(dom, gm);
      if (bl.respuesta) {
        await soltar(dom, gm, token);
        return falla(bl.respuesta);
      }
      return await finalizar(dom, gm, token, estado, parcial, bl.data);
    }
    return await ejecutarLlamada(dom, gm, token, siguiente, estado, parcial);
  } catch (e) {
    await actualizarCorridaGMConToken(d, gm.id, token, { candado_token: null, candado_desde: null });
    throw e;
  }
}

// ─── Producción: `POST …/ia/corridas/[corridaId]/gm/[clave]/paso` ───

export async function pasoGM(proyeccionId: string, corridaId: string, clave: string, actor: Actor): Promise<Salida<PasoGMApi>> {
  const d: Db = supabaseAdmin();
  if (leerClaveGM(clave) === null) return fallaIa("Género y mundo no encontrado.", 404, "gm_no_encontrado");
  const pR = await proyeccionOr404(d, proyeccionId);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (p.estado === "cerrada") return fallaIa("La proyección está cerrada.", 409, "cerrada");
  if (p.estado === "archivada") return fallaIa("La proyección está archivada.", 409, "archivada");

  const cR = await leerCorrida(d, corridaId);
  if (cR.error) return fallaDb(cR.error, "IA: leer la corrida");
  if (!cR.data || cR.data.proyeccion_id !== proyeccionId || cR.data.tipo !== "propuesta") return fallaIa("Corrida no encontrada.", 404, "corrida_no_encontrada");
  const vivo = await aplicarCaducidad(d, cR.data);
  if (vivo.respuesta) return falla(vivo.respuesta);
  const corrida = vivo.data;
  if (corrida.estado !== "en_curso") return fallaIa("La corrida ya terminó: inicia una nueva.", 409, "corrida_terminada");

  const gmR = await leerCorridaGM(d, corrida.id, PLIEGUE_PROPUESTA, clave);
  if (gmR.error) return fallaDb(gmR.error, "IA: leer el género y mundo de la corrida");
  if (!gmR.data) return fallaIa("Ese género y mundo no es parte de la corrida.", 409, "gm_fuera_de_corrida");

  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const config = s.data.config;
  // Un tope mensual lo decide el motor antes de cada llamada (así un GM reusado o sin filas libres sigue); lo demás apaga el paso.
  if (s.data.api.motivo !== null && s.data.api.motivo !== "tope_mensual") {
    if (s.data.api.motivo === "clave_invalida") await detenerCorrida(d, corrida.id, "clave_invalida");
    return faltaServicio(s.data);
  }
  if (!config || s.data.proveedor === null) return faltaServicio(s.data);
  if (config.proveedor !== corrida.proveedor || config.modelo !== corrida.modelo || config.version_prompt !== corrida.version_prompt) {
    return fallaIa("La configuración de IA cambió durante la corrida: inicia una nueva.", 409, "ia_no_disponible", { motivo: "config_cambiada" });
  }
  if (p.calculado_at !== corrida.calculado_at_proyeccion) {
    await actualizarCorrida(d, corrida.id, { estado: "parcial", motivo_fin: "datos_cambiaron", terminada_at: sello() });
    return fallaIa("La proyección se recalculó mientras se generaba la propuesta de IA. Lo ya generado queda; inicia una corrida nueva.", 409, "datos_cambiaron");
  }
  const proveedor = s.data.proveedor;

  const precios = s.data.precios as PreciosIa;
  const dom: DominioPaso = {
    tipo: "propuesta",
    d,
    corrida,
    proveedor,
    precios,
    topes: { corrida: Number(config.tope_usd_corrida), mes: Number(config.tope_usd_mes), dia: Number(config.tope_usd_dia_usuario) },
    config: { max_filas_llamada: config.max_filas_llamada, presupuesto_razonamiento: config.presupuesto_razonamiento, terminos_extra: config.terminos_extra },
    capacidades: s.data.api.capacidades,
    actor,
    reuso: true,
    regenerar: (corrida.alcance as { regenerar?: boolean } | null)?.regenerar === true,
    armarPlan: (gm, opciones) => armarPlanProduccion(d, proyeccionId, gm, config, opciones),
    gastos: async () => {
      const e = await evaluarServicio(d, actor.id);
      if (e.respuesta) return falla(e.respuesta);
      return listo({ mes: e.data.api.gasto_mes_usd, dia: e.data.api.gasto_dia_usuario_usd });
    },
    alTerminarGM: null,
  };
  return ejecutarPasoGM(dom, gmR.data.id);
}

/** El plan de un GM de producción: lee las filas y la venta, arma los bloques con alias y control de salida y deja la foto del GM. */
async function armarPlanProduccion(
  d: Db,
  proyeccionId: string,
  gm: CorridaGMDb,
  config: { max_filas_llamada: number; incluir_cola_larga: boolean; terminos_extra: readonly string[] },
  opciones: { max_filas_llamada?: number }
): Promise<Salida<ResultadoPlan>> {
  const pi = await cargarProyeccionIa(d, proyeccionId);
  if (pi.respuesta) return falla(pi.respuesta);
  const gmCat = pi.data.gms.find((g) => g.gm_clave === gm.gm_clave);
  if (!gmCat) return fallaIa("Género y mundo no encontrado en esta proyección.", 404, "gm_no_encontrado");
  const filas = await leerFilasConAnios(d, proyeccionId, { columnas: "completas", gmlIds: gmCat.gml_ids, tiendaId: null, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "IA: leer las filas del género y mundo");
  const plan = planMetaDeGM({ pi: pi.data, gm: gmCat, filas: filas.data, incluir_cola_larga: config.incluir_cola_larga });
  if (plan.libres.length === 0) return listo({ tipo: "sin_filas_libres" });

  const venta = await leerVentaLineasIa(d, { gmlIds: gmCat.gml_ids, grupos: gruposDeProyeccion(pi.data.parametros, pi.data.Y), desde: `${pi.data.Y - 3}-01`, hasta: pi.data.p.hasta_periodo });
  if (venta.error) return fallaDb(venta.error, "IA: leer la venta del género y mundo");
  const tiendas = await leerContextoTiendasGM(d, proyeccionId, gmCat, pi.data.Y);
  if (tiendas.respuesta) return falla(tiendas.respuesta);
  const { datos } = armarDatosGM({ pi: pi.data, gm: gmCat, filas: filasBaseDeGM(filas.data, gmCat).map((f) => ({ id: f.id, m: aFilaModelo(f, pi.data.k, pi.data.Y) })), plan, venta: venta.data ? desempaquetarVentaLineasIa(venta.data) : new Map(), tiendas: tiendas.data });
  const terminos = await leerTerminosPrivados(d, config.terminos_extra);
  if (terminos.error) return fallaDb(terminos.error, "IA: leer los términos privados");
  const arm = armarBloquesGM(datos, { terminos: terminos.data, max_filas_llamada: opciones.max_filas_llamada ?? config.max_filas_llamada });
  if (!arm.ok) return listo({ tipo: "bloqueado" });

  const fDeClave = new Map<string, string>();
  for (const l of arm.lotes) for (const [f, clave] of Object.entries(l.diccionario.f)) fDeClave.set(clave, f);
  const sobreCorregida = (plan.meta?.sobre_base ?? "corregida") === "corregida";
  const filasFinal: FilaBaseFinal[] = [];
  for (const m of plan.filasMeta) {
    const e = plan.estados.get(m.fila_id);
    if (e !== "libre" && e !== "fija_decidida" && e !== "fija_pct") continue;
    filasFinal.push({
      f: fDeClave.get(m.clave) ?? null,
      fila_id: m.fila_id,
      fila_clave: m.clave,
      estado_meta: e,
      base: m.base,
      base_corregida: m.base_corregida,
      p_gm: plan.p_gm.get(m.fila_id) ?? null,
      aporte_fijo: e === "libre" ? null : (plan.aportes.get(m.fila_id) ?? null),
      base_s: sobreCorregida ? m.base_corregida : m.base,
    });
  }
  const lineasBase: LineaBasePlan[] = arm.lineas.map((l) => {
    const libres = filasFinal.filter((x) => x.estado_meta === "libre" && x.f !== null && l.filas_libres_f.includes(x.f));
    return { ...l, p_gm: libres.reduce((s, x) => s + (x.p_gm ?? 0), 0), base_s: libres.reduce((s, x) => s + (x.base_s ?? 0), 0) };
  });
  const meta = plan.meta;
  const metaEntrada: Omit<MetaEntradaIa, "del_lote"> | null = meta
    ? { pct: meta.pct, sobre: meta.sobre_base, total: meta.meta_gm, fijas: meta.fijas, libre: meta.meta_libre, provisional: meta.fuente === "resto_provisional" }
    : null;
  return listo({
    tipo: "ok",
    arm,
    estado: {
      v: 1,
      genero_id: gmCat.genero_id,
      mundo_id: gmCat.mundo_id,
      es_resto: gmCat.es_resto,
      version_metodo: typeof pi.data.resumen?.version_metodo === "number" ? pi.data.resumen.version_metodo : 0,
      huella_historia: huellaHistoriaDeGM(filas.data, gmCat, pi.data.k, pi.data.Y),
      meta,
      meta_entrada: metaEntrada,
      filas: filasFinal,
      lineas_base: lineasBase,
      avisos_plan: plan.avisos,
      partido: false,
      correccion: null,
    },
  });
}

export { ESQUEMAS_SALIDA, errorIa };
