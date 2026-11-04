import "server-only";
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { leerVigentes } from "@/lib/crecimientos/consultas-vigentes";
import { gmExigidos, type VigenteCrecimiento } from "@/lib/crecimientos/vigentes";
import {
  aceptarPermitido,
  CAPACIDAD_Y1,
  cargarProyeccionIa,
  evaluarServicio,
  fallaIa,
  faltaServicio,
  fuenteMetaDe,
  gmClaveDe,
  valoresIaParaAprobacion,
  type GMCatalogo,
  type ProyeccionIa,
  type ServicioInterno,
  type ValoresIaAprobacion,
} from "@/lib/ia/servicio";
import { claveGM } from "@/lib/proyeccion/crecimientos";
import { leerAniosHistoricoDeGML, leerFilasConAnios, leerTiendasProyeccion, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { cargarContextoCalculo } from "@/lib/proyeccion/contexto";
import { registroDe, type ContextoModelo } from "@/lib/proyeccion/decision";
import { metaDeGM, type FilaParaMeta, type FuenteMeta } from "@/lib/proyeccion/meta-gm";
import { aFilaModelo, comoAvisos, payloadAnioDecision, type AnioDb, type FilaConAnios, type TiendaPyDb } from "@/lib/proyeccion/persistencia";
import type { HistoricoFila } from "@/lib/proyeccion/tipos";
import { filaBloqueaCierre } from "@/lib/proyeccion/reglas";
import { bloqueosNinoDe, crecimientosDeHoy, desactualizadaDe, ninoDeFilas } from "@/lib/proyeccion/servicio";
import { refrescarResumen } from "@/lib/proyeccion/servicio-edicion";
import {
  contextoModelo,
  falla,
  fallaDb,
  fallaMensaje,
  fallaRegla,
  kDe,
  listo,
  nombreDeFilaPorClave,
  parametrosDe,
  proyeccionOr404,
  sello,
  type Actor,
  type Db,
  type Salida,
} from "@/lib/proyeccion/servicio-base";
import type { FilaModelo, ResumenProyeccion, SobreBase } from "@/lib/proyeccion/tipos";
import {
  aplicarLoteDb,
  leerFilasDeLoteDb,
  leerLoteDb,
  leerLotesDeConfirmacionDb,
  leerLotesDeProyeccionDb,
  leerReversionesDeLoteDb,
  type CabeceraLotePayload,
  type FilaRespuestaLote,
  type LoteDb,
  type LoteFilaDb,
  type PayloadLote,
  type RespuestaLoteDb,
} from "./consultas";
import {
  aplicarEnMemoria,
  armarResultadoLote,
  cambiosDePlan,
  calcularEfectoGM,
  crecimientosAReaprobar,
  filaParaMeta,
  indicadoresGM,
  registrosAEscribir,
  type DatosGMNombre,
  type DecisionMemoria,
  type GMEfectoEntrada,
  type GrupoMemoria,
} from "./efecto";
import type { LoteCuerpo, RevertirCuerpo, RevertirConfirmacionCuerpo } from "./esquemas";
import { huellaCuerpoLote, huellaCuerpoReversion, huellaSimulacion } from "./huella";
import {
  armarGrupos,
  fuentePermitida,
  modoIaDeGM,
  planificarLote,
  planificarReversion,
  resultadoFilaApi,
  type FilaLoteARevertir,
  type FilaPlan,
  type FilaPlanificada,
  type GMPlan,
  type IaFilaPlan,
  type PlanLote,
  type RegistroAEscribir,
  type RegistroLectura,
  type RegistroPlan,
} from "./plan";
import { bloqueoDeReversion, bloqueosDeLote, motivoRechazoAnioYFuentes, motivoRechazoRevertir, revisionRequerida } from "./reglas";
import {
  TIPOS_LOTE,
  type AprobacionApi,
  type BloqueoLoteApi,
  type CodigoRechazoFila,
  type EfectoGMApi,
  type FilaAprobacionApi,
  type FilaLoteApi,
  type FiltroLote,
  type FuenteFilaLote,
  type GMAprobacionApi,
  type LoteApi,
  type ModoAprobacion,
  type PendientesCierreApi,
  type ResultadoFilaLoteApi,
  type ResultadoLoteApi,
  type ResumenLoteApi,
  type TipoLote,
} from "./tipos-api";

/**
 * Servicio de la aprobación en bloque (ficha 07g, §3): el `GET` de las filas elegibles, el `POST` de lotes (aprobar y reaprobar, con `simular`), revertir un
 * lote o una confirmación y el historial. Cada operación abre su cliente con `supabaseAdmin()` (los handlers nunca tocan la base) y devuelve `{ data, respuesta }`.
 * Las reglas son las de `reglas.ts`, `plan.ts`, `efecto.ts` y `huella.ts` (puras): aquí solo se leen los hechos, se arma lo que escribe la función SQL
 * `aplicar_lote_proyeccion` (en `consultas.ts`) y se traducen sus errores. Los bloqueos de D14 NO dependen de `src/lib/ia/`.
 */

const db = (): Db => supabaseAdmin();

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const estadoDe = (p: ProyeccionDb) => (p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : ("en_trabajo" as const));
const regDe = (f: FilaConAnios, anio: number): AnioDb | undefined => f.proyeccion_fila_anios.find((a) => a.anio === anio);

export const MENSAJE_LOTE_NO_ENCONTRADO = "Lote no encontrado.";
const MENSAJE_SIN_FILAS_APROBAR = "Ninguna de las filas elegidas se puede aprobar ahora: vuelve a cargar la pantalla para ver cómo están.";
const MENSAJE_SIN_FILAS_REVERTIR = "Ninguna de las filas elegidas se puede revertir ahora: alguien las cambió después del lote.";
const MENSAJE_SIN_CALCULAR = "La proyección todavía no se calculó: calcúlala antes de aprobar en bloque.";

/** `409 { error, codigo, ...extra }` con el detalle que la pantalla necesita para explicarse (sin caché). */
function fallaConCodigo(mensaje: string, status: number, codigo: string, extra: Record<string, unknown> = {}): Salida<never> {
  return falla(NextResponse.json({ error: mensaje, codigo, ...extra }, { status, headers: { "Cache-Control": "no-store" } }));
}

/** SQLSTATE de `aplicar_lote_proyeccion` (LP001 a LP008, 40P01, 55P03, 57014) → la respuesta HTTP que ve la pantalla. El resto, a `traducirErrorDb`. */
function traducirErrorLote(e: PostgrestError): Salida<never> {
  const mensaje = e.message ?? "";
  switch (e.code) {
    case "LP001":
      return mensaje.includes("archivada")
        ? fallaConCodigo("La proyección está archivada: no admite cambios.", 409, "archivada")
        : fallaConCodigo("La proyección está cerrada: no admite cambios.", 409, "cerrada");
    case "LP002":
      return fallaConCodigo("La proyección se está calculando. Espera a que termine y vuelve a intentarlo.", 409, "calculo_en_curso");
    case "LP003":
      return fallaConCodigo("La proyección se recalculó mientras revisabas: vuelve a cargar y simula de nuevo.", 409, "datos_cambiaron");
    case "LP004":
      return fallaConCodigo("Ese identificador de lote ya se usó con otra petición: vuelve a cargar la pantalla.", 409, "lote_ajeno");
    case "LP005":
      return fallaConCodigo("Ese lote no se puede revertir: solo se revierte un lote aprobado o reaprobado de esta proyección.", 409, "no_revertible");
    case "LP006":
      return fallaMensaje("Proyección no encontrada.", 404);
    // `40P01` interbloqueo, `55P03` no se obtuvo el candado a tiempo (`lock_timeout`), `57014` la consulta se cortó por tiempo (`statement_timeout`): en los tres casos la función no
    // escribió nada y el navegador puede reintentar con el mismo `lote_id`.
    case "40P01":
    case "55P03":
    case "57014":
      return fallaConCodigo("Otra persona estaba guardando lo mismo o la base tardó demasiado: vuelve a intentarlo.", 409, "conflicto_reintentar");
    default:
      return fallaDb(e, "aprobación en bloque: aplicar el lote");
  }
}

// ─── Lectura de la proyección y de sus filas ───

type Escenario = {
  d: Db;
  pi: ProyeccionIa;
  p: ProyeccionDb;
  Y: number;
  umbral: number;
  /** Filas base (activas e inactivas) con sus registros, SIN `historico` y sin las columnas pesadas de los registros (columnas «ligeras» de M7, con `updated_at` y las trazas del lote). */
  base: FilaConAnios[];
  porId: Map<string, FilaConAnios>;
  tiendas: TiendaPyDb[];
};

/** La clave de la fila (`tienda|gml|equivalencia|agrupación`) trae lo que las columnas «previas» no seleccionan. */
function completarClave(f: FilaConAnios): FilaConAnios {
  const [, , equivalencia = "", marca = ""] = f.clave.split("|");
  return { ...f, equivalencia_id: equivalencia === "" ? null : equivalencia, agrupacion_marca_id: marca };
}

async function cargarEscenario(d: Db, id: string): Promise<Salida<Escenario>> {
  const pi = await cargarProyeccionIa(d, id);
  if (pi.respuesta) return falla(pi.respuesta);
  const filas = await leerFilasConAnios(d, id, { columnas: "ligeras", tiendaId: null });
  if (filas.error) return fallaDb(filas.error, "aprobación: leer las filas de la proyección");
  const tiendas = await leerTiendasProyeccion(d, id);
  if (tiendas.error) return fallaDb(tiendas.error, "aprobación: leer las tiendas de la proyección");
  const base = filas.data.map(completarClave);
  return listo({ d, pi: pi.data, p: pi.data.p, Y: pi.data.Y, umbral: pi.data.umbral_cola_larga, base, porId: new Map(base.map((f) => [f.id, f])), tiendas: tiendas.data });
}

/** El GM (`genero_id.mundo_id`) de una fila; `""` si su nodo ya no está en el árbol. */
function gmDeFila(pi: ProyeccionIa, f: Pick<FilaConAnios, "gml_id">): string {
  const n = pi.catalogo.nodos.get(f.gml_id);
  return n ? gmClaveDe(n.genero_id, n.mundo_id) : "";
}

/** Filas base activas por GM. */
function filasPorGM(e: Pick<Escenario, "pi" | "base">): Map<string, FilaConAnios[]> {
  const m = new Map<string, FilaConAnios[]>();
  for (const f of e.base) {
    if (!f.activo) continue;
    const gm = gmDeFila(e.pi, f);
    if (gm === "") continue;
    const lista = m.get(gm);
    if (lista) lista.push(f);
    else m.set(gm, [f]);
  }
  return m;
}

// ─── D14 · Bloqueos de todo lote «aprobar» o «reaprobar» (sin depender de src/lib/ia/) ───

async function leerVigentesY1(d: Db, Y: number): Promise<Salida<VigenteCrecimiento[]>> {
  const v = await leerVigentes(d, [Y + 1]);
  if (v.error) return fallaDb(v.error, "aprobación: leer los crecimientos aprobados");
  return listo(v.data);
}

/**
 * H3 (decisión de diseño, D15). Un lote de `Y` puede dejar crecimientos de `Y+1` en `reaprobar` (B2 mueve `B'` con el Niño), y eso no debe frenar las tandas siguientes de la
 * MISMA confirmación. Por eso `crecimientos_sin_aprobar` no se evalúa cuando `confirmacion_id` ya tiene un lote aprobado o reaprobado con filas aplicadas en esta proyección
 * y con el mismo `calculado_at` (un recálculo en medio vuelve a exigirlo todo). Sí se evalúa en la primera tanda y en toda confirmación nueva. Los demás bloqueos (D14) no cambian.
 */
async function confirmacionEmpezada(d: Db, p: ProyeccionDb, confirmacionId: string): Promise<Salida<boolean>> {
  const lotes = await leerLotesDeConfirmacionDb(d, p.id, confirmacionId);
  if (lotes.error) return fallaDb(lotes.error, "aprobación: leer los lotes de la confirmación");
  return listo(lotes.data.some((l) => (l.tipo === "aprobar" || l.tipo === "reaprobar") && aResumen(l).aplicadas > 0 && p.calculado_at !== null && l.calculado_at_proyeccion === p.calculado_at));
}

/**
 * D14. Se arma como el cierre: proyección en trabajo y sin cálculo, método vigente, desactualizada por CUALQUIER motivo, los del Niño y los crecimientos
 * de `Y+1` sin aprobar (con el Niño de las filas de HOY). Solo lee M7 y los crecimientos: nada de IA.
 * `sinCrecimientos` (H3): omite solo el bloqueo `crecimientos_sin_aprobar`; todos los demás se evalúan igual.
 */
async function leerBloqueos(d: Db, p: ProyeccionDb, base: readonly FilaConAnios[], o: { sinCrecimientos?: boolean } = {}): Promise<Salida<{ bloqueos: BloqueoLoteApi[]; vigentes: VigenteCrecimiento[] }>> {
  const Y = p.anio_en_curso;
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: true });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  const vigentes = p.estado === "en_trabajo" ? await leerVigentesY1(d, Y) : listo<VigenteCrecimiento[]>([]);
  if (vigentes.respuesta) return falla(vigentes.respuesta);
  const des = await desactualizadaDe(d, p, ctx, { vigentes: vigentes.data });
  if (des.respuesta) return falla(des.respuesta);
  const hoy = crecimientosDeHoy(p, ctx, vigentes.data, p.estado === "en_trabajo" ? ninoDeFilas(base.filter((f) => f.tienda_id === null), Y, ctx) : undefined);
  const resumen = p.resumen as unknown as Partial<ResumenProyeccion> | null;
  const bloqueos = bloqueosDeLote({
    estado: estadoDe(p),
    calculandoDesde: p.calculando_desde,
    ahora: sello(),
    anioEnCurso: Y,
    versionMetodo: typeof resumen?.version_metodo === "number" ? resumen.version_metodo : null,
    desactualizada: des.data,
    bloqueosNino: bloqueosNinoDe(p, ctx, des.data),
    // H3: dentro de una confirmación ya empezada, `crecimientos_sin_aprobar` no se evalúa (ver `confirmacionEmpezada`).
    crecimientosSinAprobar: o.sinCrecimientos ? null : hoy.sinAprobar,
  });
  return listo({ bloqueos, vigentes: vigentes.data });
}

// ─── Hechos de cada fila y de cada GM para el plan (plan.ts) ───

const registroPlanDe = (a: AnioDb | undefined): RegistroPlan | null =>
  a ? { id: a.id, updated_at: a.updated_at, activo: a.activo, vendido: a.vendido, propuesto: a.propuesto, decidido: a.decidido, crecimiento_pct: num(a.crecimiento_pct), decision_lote_id: a.decision_lote_id ?? null } : null;

/** D1: por qué la fila bloquea el cierre en ese registro (la regla única de `reglas.ts` de M7), o `null`. */
const motivoCierreDe = (a: AnioDb | undefined, umbral: number) => (a ? filaBloqueaCierre({ propuesto: a.propuesto, decidido: a.decidido, avisos: comoAvisos(a.avisos) }, umbral) : null);

type HechosGM = {
  anio: number;
  Y: number;
  umbral: number;
  pi: ProyeccionIa;
  iaDisponible: boolean;
  valores: ValoresIaAprobacion | null;
  porGM: Map<string, FilaConAnios[]>;
};

/** D4: la fuente de cada GM en 2027 y `registros_lectura` (D7: todos sus registros base activos de `Y` y `Y+1`). */
function gmsPlan(h: HechosGM): Map<string, GMPlan> {
  const salida = new Map<string, GMPlan>();
  for (const [gm, filas] of h.porGM) {
    const v = h.valores?.gms.get(gm);
    const modo = modoIaDeGM({
      ia_disponible: h.iaDisponible && v !== undefined,
      estado: v?.lectura.resumen.estado ?? null,
      sin_meta: v !== undefined && v.plan.meta === null,
      fijadas_exceden_meta: v?.plan.avisos.includes("fijadas_exceden_meta") ?? false,
    });
    const lectura: RegistroLectura[] = [];
    for (const f of filas) for (const a of f.proyeccion_fila_anios) if (a.activo && (a.anio === h.Y || a.anio === h.Y + 1)) lectura.push({ id: a.id, updated_at: a.updated_at });
    salida.set(gm, { gm_clave: gm, modo, propuesta_gm_id: v?.lectura.resumen.propuesta?.id ?? null, lectura });
  }
  return salida;
}

function iaPlanDe(h: HechosGM, gm: string, filaId: string): IaFilaPlan | null {
  const x = h.valores?.gms.get(gm)?.lectura.porFila.get(filaId);
  if (!x) return null;
  return { propuesta_fila_id: x.propuesta_fila_id, estado_meta: x.estado_meta, valor: x.meta_y1, natural: x.natural_y1, confianza: x.confianza, avisos: x.avisos };
}

/** `lectura` de una fila de `Y`: los registros de `Y` de las filas de tienda nuevas de su misma GML-AM que B2 lee (van a `registros_lectura`). */
function lecturaTiendas(f: FilaConAnios, tiendas: readonly FilaConAnios[], Y: number): RegistroLectura[] {
  const salida: RegistroLectura[] = [];
  for (const t of tiendas) {
    if (t.gml_id !== f.gml_id || t.agrupacion_marca_id !== f.agrupacion_marca_id || (t.equivalencia_id ?? null) !== (f.equivalencia_id ?? null)) continue;
    const a = regDe(t, Y);
    if (a && a.activo && a.bloque === "nuevas") salida.push({ id: a.id, updated_at: a.updated_at });
  }
  return salida;
}

function filaPlanDe(f: FilaConAnios, h: HechosGM, tiendasDelGrupo: readonly FilaConAnios[]): FilaPlan {
  const gm = gmDeFila(h.pi, f);
  const a = regDe(f, h.anio);
  return {
    fila_id: f.id,
    clave: f.clave,
    gm_clave: gm,
    activa: f.activo,
    es_base: f.tienda_id === null,
    registro: registroPlanDe(a),
    motivo_cierre: motivoCierreDe(a, h.umbral),
    ia: h.anio === h.Y + 1 ? iaPlanDe(h, gm, f.id) : null,
    lectura: h.anio === h.Y ? lecturaTiendas(f, tiendasDelGrupo, h.Y) : [],
  };
}

// ─── Indicadores de un GM ───

type MetaHoy = { meta: number | null; fuente: FuenteMeta | null; sobre: SobreBase };

function filaParaMetaDe(f: FilaConAnios, anioSiguiente: number): FilaParaMeta | null {
  const a = regDe(f, anioSiguiente);
  if (!a || !a.activo) return null;
  return { fila_id: f.id, propuesto: a.propuesto, base: num(a.base_siguiente), base_corregida: num(a.base_normalizada), crecimiento_pct: num(a.crecimiento_pct), vigente: a.decidido ?? a.propuesto };
}

/** `Meta_GM` de 2027 de un GM con las filas dadas (sin `g`, `meta` es `null`). */
function metaDeGMHoy(pi: ProyeccionIa, gm: GMCatalogo, filasMeta: readonly FilaParaMeta[]): MetaHoy {
  const f = fuenteMetaDe(pi, gm);
  const sobre: SobreBase = f?.sobre_base ?? "corregida";
  const r = metaDeGM({ filas: filasMeta, g: f?.g ?? null, sobre_base: sobre, fuente: f?.fuente ?? "resto" });
  return { meta: r.meta_gm, fuente: f?.fuente ?? null, sobre };
}

const baseSDe = (r: { base: number | null; base_corregida: number | null }, sobre: SobreBase): number | null => (sobre === "corregida" ? r.base_corregida : r.base);

/** Libre en el efecto: sin decidir y con propuesta (el conteo de `libres_antes` y `libres_despues`). */
function sinDecidirConPropuesta(f: FilaConAnios | undefined, anio: number): boolean {
  const r = f ? regDe(f, anio) : undefined;
  return !!r && r.decidido === null && r.propuesto !== null;
}

// ─── Pendientes para cerrar ───

function contarPendientes(a: {
  base: readonly FilaConAnios[];
  tiendas: readonly TiendaPyDb[];
  Y: number;
  umbral: number;
  anio: number;
  /** `fila_id#anio → decidido` que dejaría el lote (null = sin decidir). */
  cambios?: ReadonlyMap<string, number | null>;
}): PendientesCierreApi {
  let filasY = 0;
  let filasY1 = 0;
  let revision = 0;
  for (const f of a.base) {
    if (!f.activo) continue;
    for (const anio of [a.Y, a.Y + 1]) {
      const r = regDe(f, anio);
      if (!r || !r.activo) continue;
      const clave = `${f.id}#${anio}`;
      const decidido = a.cambios?.has(clave) ? (a.cambios.get(clave) ?? null) : r.decidido;
      const motivo = filaBloqueaCierre({ propuesto: r.propuesto, decidido, avisos: comoAvisos(r.avisos) }, a.umbral);
      if (motivo === null) continue;
      if (anio === a.Y) filasY += 1;
      else filasY1 += 1;
      if (anio === a.anio && motivo === "revision_cola_larga") revision += 1;
    }
  }
  const tiendas = a.tiendas.filter((t) => t.activo && t.bloque === "nuevas" && t.venta_esperada_usada !== null && t.decidido === null).length;
  return { filas_y: filasY, filas_y1: filasY1, para_revision: revision, tiendas };
}

// ─── IA: ¿puede aprobar hoy? ───

function iaDisponibleDe(s: ServicioInterno): { disponible: boolean; motivo: string | null } {
  if (!aceptarPermitido(s) || s.config === null) return { disponible: false, motivo: s.api.motivo ?? "sin_configuracion" };
  if (!s.api.capacidades.includes(CAPACIDAD_Y1)) return { disponible: false, motivo: "capacidad_apagada" };
  return { disponible: true, motivo: null };
}

/** Las filas base de `Y+1` aprobadas en bloque con IA (`decision_lote_id` y `decision_ia_fila_id`): lo que «Reaprobar» podría cambiar con la IA de hoy. */
function hayIaAprobadasEnBloque(base: readonly FilaConAnios[], Y: number): boolean {
  for (const f of base) {
    if (!f.activo || f.tienda_id !== null) continue;
    const a = regDe(f, Y + 1);
    if (a && a.activo && a.decidido !== null && a.decision_lote_id && a.decision_ia_fila_id) return true;
  }
  return false;
}

/**
 * La cifra «de hoy» de una fila aprobada en bloque (D13): en «Método» su `propuesto`; en «IA» la `A_f` de hoy (`null` si el GM no tiene IA al día, sin valor para comparar).
 */
function valorHoyDe(f: FilaPlan, a: AnioDb): number | null {
  return a.decision_ia_fila_id ? (f.ia?.valor ?? null) : a.propuesto;
}

// ─── GET …/aprobacion ───

export async function leerAprobacion(id: string, q: { anio: number; modo: ModoAprobacion }, actor: Actor): Promise<Salida<AprobacionApi>> {
  const d = db();
  const esc = await cargarEscenario(d, id);
  if (esc.respuesta) return falla(esc.respuesta);
  const { pi, p, Y, umbral, base, tiendas } = esc.data;
  const rechazoAnio = motivoRechazoAnioYFuentes({ anio: q.anio, anioEnCurso: Y, fuentes: [] });
  if (rechazoAnio) return fallaRegla(rechazoAnio);

  const blq = await leerBloqueos(d, p, base);
  if (blq.respuesta) return falla(blq.respuesta);
  const s = await evaluarServicio(d, actor.id);
  if (s.respuesta) return falla(s.respuesta);
  const ia = iaDisponibleDe(s.data);

  const porGM = filasPorGM(esc.data);
  let valores: ValoresIaAprobacion | null = null;
  if (ia.disponible && (q.anio === Y + 1 || hayIaAprobadasEnBloque(base, Y))) {
    const v = await valoresIaParaAprobacion(d, pi, s.data, pi.gms, { reaprobar: true, filas: base.filter((f) => f.activo) });
    // La IA de 2027 hace falta para saber qué GM tienen IA (D4); en 2026 una lectura fallida solo deja sin contar las filas de IA del aviso de «Reaprobar».
    if (v.respuesta) {
      if (q.anio === Y + 1) return falla(v.respuesta);
    } else valores = v.data;
  }
  const h: HechosGM = { anio: q.anio, Y, umbral, pi, iaDisponible: ia.disponible, valores, porGM };
  const planes = gmsPlan(h);

  const filas: FilaAprobacionApi[] = [];
  const gmsConFilas = new Set<string>();
  const reaprobables = { y: 0, y1: 0 };
  for (const f of base) {
    if (!f.activo) continue;
    const gm = gmDeFila(pi, f);
    if (gm === "") continue;
    // Las filas reaprobables de cada año (aviso de la cabecera, D13).
    for (const anio of [Y, Y + 1]) {
      const a = regDe(f, anio);
      if (!a || !a.activo || a.decidido === null || !a.decision_lote_id) continue;
      const fp = filaPlanDe(f, { ...h, anio }, []);
      // H6: solo cuentan las filas que «Reaprobar» podría tomar de verdad. Las de un GM sin IA al día (desactualizado, sin propuesta, confianza baja…) saldrían excluidas.
      if (fuentePermitida(fp, planes.get(gm), anio, Y).fuente === null) continue;
      const hoy = valorHoyDe(fp, a);
      if (hoy !== null && hoy !== a.decidido) {
        if (anio === Y) reaprobables.y += 1;
        else reaprobables.y1 += 1;
      }
    }
    const a = regDe(f, q.anio);
    if (!a || !a.activo) continue;
    const fp = filaPlanDe(f, h, []);
    if (q.modo === "aprobar") {
      if (a.decidido !== null || fp.motivo_cierre === null) continue;
    } else {
      if (a.decidido === null || !a.decision_lote_id) continue;
      const hoy = valorHoyDe(fp, a);
      if (hoy === null || hoy === a.decidido) continue;
    }
    const perm = fuentePermitida(fp, planes.get(gm), q.anio, Y);
    const nombres = nombreDeFilaPorClave(f.clave, pi.catalogo);
    const nodo = pi.catalogo.nodos.get(f.gml_id);
    const gmCat = pi.gms.find((g) => g.gm_clave === gm);
    const x = h.valores?.gms.get(gm)?.lectura.porFila.get(f.id);
    const avisosIa = x?.avisos ?? [];
    gmsConFilas.add(gm);
    filas.push({
      fila_id: f.id,
      anio: q.anio,
      gm_clave: gm,
      genero: gmCat?.genero ?? nombres.genero ?? "",
      mundo: gmCat?.mundo ?? nombres.mundo ?? "",
      es_resto: gmCat?.es_resto ?? false,
      linea: nombres.linea ?? "—",
      linea_id: nodo?.linea_id ?? "",
      equivalencia: nombres.equivalencia,
      agrupacion_marca: nombres.agrupacion_marca ?? "—",
      agrupacion_marca_id: f.agrupacion_marca_id,
      motivo_cierre: fp.motivo_cierre ?? motivoCierreDe({ ...a, decidido: null }, umbral) ?? "umbral",
      vendido: a.vendido,
      base: q.anio === Y + 1 ? num(a.base_siguiente) : null,
      base_corregida: q.anio === Y + 1 ? num(a.base_normalizada) : null,
      metodo: { valor: a.propuesto ?? 0, pct_propio: num(a.crecimiento_pct), avisos: comoAvisos(a.avisos) },
      ia: x
        ? {
            propuesta_fila_id: x.propuesta_fila_id,
            valor: x.meta_y1,
            natural: x.natural_y1,
            brecha_u: x.brecha_u,
            brecha_pct: x.brecha_pct,
            contra_metodo_u: x.contra_metodo_u,
            absorbido_pct: x.absorbido_pct,
            confianza: x.confianza,
            avisos: x.avisos,
            razon: x.razon,
            aceptable: x.aceptable.y1,
            motivo: x.aceptable.motivo,
          }
        : null,
      decidido: q.modo === "reaprobar" ? a.decidido : null,
      fuente_sugerida: perm.fuente,
      badge: perm.badge,
      excluida: perm.excluida,
      motivo_exclusion: perm.motivo,
      avisos_fuertes: avisosIa.includes("brecha_extrema") || avisosIa.includes("absorcion_alta"),
    });
  }
  filas.sort((x, y) => porTexto(x.genero, y.genero) || porTexto(x.mundo, y.mundo) || porTexto(x.linea, y.linea) || porTexto(x.agrupacion_marca, y.agrupacion_marca) || porTexto(x.fila_id, y.fila_id));

  const gms: GMAprobacionApi[] = [];
  for (const gmCat of pi.gms) {
    if (!gmsConFilas.has(gmCat.gm_clave)) continue;
    const delGM = porGM.get(gmCat.gm_clave) ?? [];
    const v = valores?.gms.get(gmCat.gm_clave);
    let libres = 0;
    let pendientes = 0;
    let vigenteTotal = 0;
    for (const f of delGM) {
      const a = regDe(f, q.anio);
      if (!a || !a.activo) continue;
      if (a.decidido === null && a.propuesto !== null) libres += 1;
      if (a.decidido === null && motivoCierreDe(a, umbral) !== null) pendientes += 1;
      vigenteTotal += a.decidido ?? a.propuesto ?? 0;
    }
    let meta: number | null = null;
    let fuenteMeta: GMAprobacionApi["fuente_meta"] = null;
    let ind = { base_total: null as number | null, crecimiento_pct: null as number | null, desvio_u: null as number | null, desvio_pct: null as number | null, total: vigenteTotal };
    if (q.anio === Y + 1) {
      const filasMeta = delGM.flatMap((f) => {
        const m = filaParaMetaDe(f, Y + 1);
        return m ? [m] : [];
      });
      const m = metaDeGMHoy(pi, gmCat, filasMeta);
      meta = m.meta;
      fuenteMeta = m.fuente;
      ind = indicadoresGM({ filas: filasMeta.map((r) => ({ vigente: r.vigente ?? null, base_s: baseSDe(r, m.sobre) })), meta });
    }
    gms.push({
      gm_clave: gmCat.gm_clave,
      genero: gmCat.genero,
      mundo: gmCat.mundo,
      es_resto: gmCat.es_resto,
      meta,
      fuente_meta: fuenteMeta,
      base_total: ind.base_total,
      vigente_total: ind.total,
      crecimiento_implicito_pct: ind.crecimiento_pct,
      desvio_u: ind.desvio_u,
      desvio_pct: ind.desvio_pct,
      libres,
      pendientes,
      estado_ia: v?.lectura.resumen.estado ?? null,
      propuesta_gm_id: v?.lectura.resumen.propuesta?.id ?? null,
    });
  }

  return listo({
    anio: q.anio,
    anio_en_curso: Y,
    modo: q.modo,
    calculado_at: p.calculado_at ?? "",
    editable: p.estado === "en_trabajo" && blq.data.bloqueos.length === 0,
    bloqueos: blq.data.bloqueos,
    ia: {
      disponible: ia.disponible,
      motivo: ia.motivo,
      corrida_en_curso: valores?.corrida_en_curso ?? false,
      gms_con_propuesta: valores ? [...valores.gms.values()].filter((g) => g.lectura.resumen.propuesta !== null).length : 0,
    },
    filas,
    gms,
    pendientes_cierre: contarPendientes({ base, tiendas, Y, umbral, anio: q.anio }),
    reaprobables,
    umbral_cola_larga: umbral,
  });
}

// ─── Lo que comparten aprobar, reaprobar y revertir: leer lo necesario, aplicar en memoria, armar lo que escribe la función ───

/** Lo que hace falta para decidir en memoria (§3.3 puntos 4 a 6), leído por columnas: nunca el `historico` entero (H2). */
type Completas = {
  /** `fila_id → fila base` de los ítems del lote (con `salientes` y `cola_larga` del `historico` solo si el lote es de `Y`, que es lo que B2 lee). */
  filas: Map<string, FilaConAnios>;
  /** Filas de tienda de los nodos del lote (solo lotes de `Y`; columnas ligeras y solo el registro de `Y`). */
  tiendas: FilaConAnios[];
  ctx: ContextoModelo;
  modelos: Map<string, FilaModelo>;
  /** `fila_id → total vendido en Y−1` de TODAS las filas base de cada GM del lote (solo lotes de `Y`): la base del crecimiento implícito de `Y`. */
  vendidoAnterior: ReadonlyMap<string, number | null>;
};

/** Una fila leída con `decision_historico`: `salientes` y `cola_larga` (alias de PostgREST) pasan a un `historico` parcial, que es lo único que lee `aplicarDecision`. */
function conHistoricoParcial(f: FilaConAnios): FilaConAnios {
  const { salientes, cola_larga, ...resto } = f as FilaConAnios & { salientes?: HistoricoFila["salientes"] | null; cola_larga?: HistoricoFila["cola_larga"] };
  const historico: HistoricoFila = { anios: [], tendencia: null, prueba_anterior: null, pesos_equivalencias: [], salientes: salientes ?? [], cola_larga: cola_larga ?? null };
  return { ...resto, historico: historico as unknown as FilaConAnios["historico"] };
}

/**
 * H2: antes se leían las filas completas (con todo su `historico`) de los nodos del lote y, en `Y`, de TODOS los nodos de cada GM. Ahora, por columnas:
 * - las filas de los ítems del lote (`ids`), con las columnas de decisión y, en `Y`, `historico->salientes` y `historico->cola_larga` (lo que lee B2);
 * - en `Y`, las filas de tienda de esos nodos, solo con su registro de `Y` y columnas ligeras (lo único que lee B2);
 * - en `Y`, solo `historico->anios` de las filas base de cada GM (el total de `Y−1` del efecto).
 */
async function leerCompletas(e: Escenario, a: { anio: number; filaIds: readonly string[]; gmlIds: readonly string[]; gmlIdsGM: readonly string[] }): Promise<Salida<Completas>> {
  const { d, p, pi, Y } = e;
  const anioY = a.anio === Y;
  const baseR = await leerFilasConAnios(d, p.id, { columnas: anioY ? "decision_historico" : "decision", ids: a.filaIds, tiendaId: null, soloActivas: true });
  if (baseR.error) return fallaDb(baseR.error, "aprobación: leer las filas del lote");
  const baseFilas = anioY ? baseR.data.map(conHistoricoParcial) : baseR.data;
  let tiendasFilas: FilaConAnios[] = [];
  const vendidoAnterior = new Map<string, number | null>();
  if (anioY) {
    if (a.gmlIds.length > 0) {
      // Lo único que B2 lee de una fila de tienda es su registro de `Y` (bloque, vigente, meses): columnas ligeras y solo ese año.
      const t = await leerFilasConAnios(d, p.id, { columnas: "ligeras", soloAnio: Y, gmlIds: a.gmlIds, soloTiendas: true, soloActivas: true });
      if (t.error) return fallaDb(t.error, "aprobación: leer las filas de tienda");
      tiendasFilas = t.data;
    }
    const anios = await leerAniosHistoricoDeGML(d, p.id, a.gmlIdsGM);
    if (anios.error) return fallaDb(anios.error, "aprobación: leer el vendido del año anterior");
    for (const [id, lista] of anios.data) vendidoAnterior.set(id, lista.find((x) => x.anio === Y - 1)?.total ?? null);
  }
  const k = kDe(p);
  const modelosLista = baseFilas.map((f) => aFilaModelo(f, k, Y));
  const modelos = new Map(baseFilas.map((f, i) => [f.id, modelosLista[i]]));
  const ctx = contextoModelo(p, parametrosDe(p.parametros), pi.catalogo, e.tiendas, [...modelosLista, ...tiendasFilas.map((f) => aFilaModelo(f, k, Y))], pi.foto);
  return listo({ filas: new Map(baseFilas.map((f) => [f.id, f])), tiendas: tiendasFilas, ctx, modelos, vendidoAnterior });
}

/** Qué sale de aplicar el plan en memoria. */
type Evaluacion = {
  plan: FilaPlanificada[];
  efecto: EfectoGMApi[];
  crecimientos: { gm_clave: string; genero: string; mundo: string }[];
  pendientes: PendientesCierreApi;
  registros: Map<string, RegistroAEscribir[]>;
  filas: ResultadoFilaLoteApi[];
  huella: string;
};

const COLUMNAS_FUERA_DEL_SET = ["fila_id", "anio", "activo"];
const COLUMNAS_DE_DECISION = ["crecimiento_pct", "decidido", "origen", "propuesta_al_decidir", "nota", "decidido_at", "decidido_por_id", "decidido_por_nombre", "decision_ia_fila_id", "decision_lote_id"];

/** `set` de la función SQL (§2.5): el registro objetivo lleva toda la lista; el `Y+1` que B2 reescribe, sin ninguna columna de decisión (§3.6). */
function setDe(payload: Record<string, unknown>, objetivo: boolean): Record<string, unknown> {
  const fuera = new Set<string>(objetivo ? COLUMNAS_FUERA_DEL_SET : [...COLUMNAS_FUERA_DEL_SET, ...COLUMNAS_DE_DECISION]);
  return Object.fromEntries(Object.entries(payload).filter(([k, v]) => !fuera.has(k) && v !== undefined));
}

type ArgsEvaluar = {
  e: Escenario;
  anio: number;
  /** `aprobar`, `reaprobar` o `revertir`: define la traza que se escribe. */
  tipo: TipoLote;
  plan: PlanLote;
  completas: Completas;
  actor: Actor;
  ahora: string;
  nota?: string;
  /** `decision_lote_id` que se escribe (el id del lote); `null` en `revertir`. */
  loteId: string | null;
  vigentes: readonly VigenteCrecimiento[];
};

/**
 * §3.3 puntos 6 y 7. Aplica las decisiones en memoria (en `Y`, B2 recalcula `Y+1`), arma los registros que escribe la función con el `updated_at` leído, y calcula el
 * efecto por GM, los crecimientos a reaprobar (D15), los pendientes para cerrar y la huella. Una fila a la que le falta en la base un registro que hay que escribir
 * (el `Y+1` que B2 reescribe) se rechaza.
 */
function evaluar(a: ArgsEvaluar): Evaluacion {
  const { e, anio, completas, plan } = a;
  const Y = e.Y;
  const anioY = anio === Y;
  const aplicadas = plan.filas.filter((p) => p.resultado === "aplicada");

  const grupos = new Map<string, GrupoMemoria>();
  const decisiones: DecisionMemoria[] = [];
  const rechazadas = new Map<string, CodigoRechazoFila>();
  for (const p of aplicadas) {
    const f = completas.modelos.get(p.fila_id);
    const raw = completas.filas.get(p.fila_id);
    if (!f || !raw || !p.decision) {
      rechazadas.set(p.fila_id, "fila_no_encontrada");
      continue;
    }
    const tiendasDelGrupo = anioY
      ? completas.tiendas.filter((t) => t.gml_id === raw.gml_id && t.agrupacion_marca_id === raw.agrupacion_marca_id && (t.equivalencia_id ?? null) === (raw.equivalencia_id ?? null)).map((t) => aFilaModelo(t, kDe(e.p), Y))
      : [];
    grupos.set(p.fila_id, { fila: f, tiendas: tiendasDelGrupo });
    decisiones.push({
      fila_id: p.fila_id,
      anio,
      decidido: p.decision.decidido,
      origen: p.decision.origen ?? "manual",
      nota: p.decision.decidido === null ? null : (a.nota ?? null),
      decidido_por_nombre: p.decision.decidido === null ? null : a.actor.nombre,
      decidido_at: p.decision.decidido === null ? null : a.ahora,
    });
  }
  const despues = aplicarEnMemoria(grupos, decisiones, completas.ctx);

  // Los registros que se escriben (con el `updated_at` leído, en texto) y el rechazo de los que no tienen dónde escribirse.
  const registros = new Map<string, RegistroAEscribir[]>();
  for (const p of aplicadas) {
    const nuevo = despues.get(p.fila_id);
    const raw = completas.filas.get(p.fila_id);
    if (!nuevo || !raw || rechazadas.has(p.fila_id)) continue;
    const lista: RegistroAEscribir[] = [];
    let falta = false;
    for (const w of registrosAEscribir(nuevo, anio, Y)) {
      const dbReg = regDe(raw, w.anio);
      if (!dbReg || !dbReg.activo) {
        falta = true;
        break;
      }
      const payload = w.objetivo
        ? (payloadAnioDecision(p.fila_id, w.registro, a.tipo === "revertir" ? undefined : a.actor.id, p.decision?.decision_ia_fila_id ?? null, a.tipo === "revertir" ? null : a.loteId) as Record<string, unknown>)
        : (payloadAnioDecision(p.fila_id, w.registro, undefined) as Record<string, unknown>);
      lista.push({ id: dbReg.id, updated_at_esperado: dbReg.updated_at, objetivo: w.objetivo, set: setDe(payload, w.objetivo) });
    }
    if (falta) rechazadas.set(p.fila_id, "fila_inactiva");
    else registros.set(`${p.fila_id}#${p.anio}`, lista);
  }
  const planFinal: FilaPlanificada[] = plan.filas.map((p) => {
    const c = rechazadas.get(p.fila_id);
    return c && p.resultado === "aplicada" ? { ...p, resultado: "rechazada", codigo: c, valor: null, decision: null, brecha_u: null } : p;
  });

  // Efecto por GM (antes y después), de las filas base activas del GM.
  const porGM = filasPorGM(e);
  const gmsEnLote = [...new Set(planFinal.map((p) => p.gm_clave).filter((g) => g !== ""))].sort(porTexto);
  const propuestasRev = new Map<string, number | null>();
  if (a.tipo === "revertir") for (const p of planFinal) propuestasRev.set(p.fila_id, ((fila) => (fila ? regDe(fila, anio)?.propuesto : null) ?? null)(completas.filas.get(p.fila_id) ?? e.porId.get(p.fila_id)));
  const cambios = cambiosDePlan(planFinal, propuestasRev);
  const entradas: GMEfectoEntrada[] = [];
  for (const gm of gmsEnLote) {
    const gmCat = e.pi.gms.find((g) => g.gm_clave === gm);
    if (!gmCat) continue;
    const delGM = porGM.get(gm) ?? [];
    const filasMetaAntes = delGM.flatMap((f) => {
      const m = filaParaMetaDe(f, Y + 1);
      return m ? [m] : [];
    });
    const antes = metaDeGMHoy(e.pi, gmCat, filasMetaAntes);
    if (anio === Y + 1) {
      entradas.push({
        gm_clave: gm,
        meta_antes: antes.meta,
        meta_despues: antes.meta,
        filas: filasMetaAntes.map((r) => ({ fila_id: r.fila_id, vigente_antes: r.vigente ?? null, base_s: baseSDe(r, antes.sobre), libre_antes: sinDecidirConPropuesta(e.porId.get(r.fila_id), Y + 1) })),
      });
      continue;
    }
    // Lote de `Y`: la meta de 2027 se mueve por B2 y la base del crecimiento implícito es lo vendido en `Y−1`.
    const filasMetaDespues = delGM.flatMap((f) => {
      const nuevo = despues.get(f.id);
      const m = nuevo ? filaParaMeta(nuevo, Y + 1, f.id) : filaParaMetaDe(f, Y + 1);
      return m ? [m] : [];
    });
    const despuesMeta = metaDeGMHoy(e.pi, gmCat, filasMetaDespues);
    const filas = delGM.flatMap((f) => {
      const r = regDe(f, Y);
      if (!r || !r.activo) return [];
      return [{ fila_id: f.id, vigente_antes: r.decidido ?? r.propuesto, base_s: completas.vendidoAnterior.get(f.id) ?? null, libre_antes: r.decidido === null && r.propuesto !== null }];
    });
    entradas.push({ gm_clave: gm, meta_antes: antes.meta, meta_despues: despuesMeta.meta, filas });
  }
  const efecto = calcularEfectoGM({ anioSiguiente: anio === Y + 1, gms: entradas, cambios });

  // D15: un lote de `Y` puede dejar GM con crecimientos que reaprobar (B2 mueve `B'` de 2027).
  let crecimientos: { gm_clave: string; genero: string; mundo: string }[] = [];
  if (anioY && aplicadas.some((p) => despues.has(p.fila_id) && !rechazadas.has(p.fila_id))) {
    const filasNino = e.base.map((f) => {
      const nuevo = despues.get(f.id);
      const sig = nuevo ? registroDe(nuevo, Y + 1) : undefined;
      if (!nuevo || !sig || rechazadas.has(f.id) || !cambios.has(f.id)) return f;
      return { ...f, proyeccion_fila_anios: f.proyeccion_fila_anios.map((x) => (x.anio === Y + 1 ? { ...x, base_siguiente: sig.base_siguiente ?? null, base_normalizada: sig.base_normalizada ?? null } : x)) };
    });
    const ctxNino = ctxNinoDe(e.pi);
    const nombres = new Map<string, DatosGMNombre>(e.pi.gms.map((g) => [claveGM(g.genero_id, g.mundo_id), { gm_clave: g.gm_clave, genero: g.genero, mundo: g.mundo }]));
    const resumen = e.p.resumen as unknown as Partial<ResumenProyeccion> | null;
    crecimientos = crecimientosAReaprobar({
      ninoDespues: ninoDeFilas(filasNino, Y, ctxNino),
      exigidos: gmExigidos(resumen?.gm_gml ?? {}, ctxNino.generosMatriz),
      vigentes: a.vigentes,
      anioSiguiente: Y + 1,
      nombres,
    });
  }

  const decididoDespues = new Map<string, number | null>();
  for (const p of planFinal) if (p.resultado === "aplicada") decididoDespues.set(`${p.fila_id}#${p.anio}`, p.decision?.decidido ?? null);
  const pendientes = contarPendientes({ base: e.base, tiendas: e.tiendas, Y, umbral: e.umbral, anio, cambios: decididoDespues });
  const filas = planFinal.map(resultadoFilaApi);
  return { plan: planFinal, efecto, crecimientos, pendientes, registros, filas, huella: huellaSimulacion({ filas, efecto_gm: efecto }) };
}

/** `ninoDeFilas` necesita los nodos y los géneros de la matriz; salen de la foto de la proyección (no hace falta el contexto de cálculo). */
function ctxNinoDe(pi: ProyeccionIa): { nodos: { gml_id: string; genero_id: string; mundo_id: string }[]; generosMatriz: string[] } {
  return { nodos: [...pi.catalogo.nodos].map(([gml_id, n]) => ({ gml_id, genero_id: n.genero_id, mundo_id: n.mundo_id })), generosMatriz: [...pi.foto.matriz.generos] };
}

// ─── La respuesta de un lote ───

/** Una fila de la respuesta de la función (lo que de verdad quedó guardado) como fila del plan, para reutilizar los totales y las 10 mayores. */
function planDeRespuesta(r: FilaRespuestaLote, plan: FilaPlanificada | undefined): FilaPlanificada {
  const base: FilaPlanificada = plan ?? {
    fila_id: r.fila_id ?? "",
    anio: r.anio,
    fila_clave: r.fila_clave,
    gm_clave: r.gm_clave,
    fuente: "metodo",
    resultado: "rechazada",
    codigo: null,
    valor: null,
    valor_esperado: null,
    valor_actual: null,
    decidido_anterior: null,
    decidido_esperado: null,
    propuesta_fila_id: null,
    propuesta_gm_id: null,
    decision: null,
    registro_id: null,
    updated_at: null,
    brecha_u: null,
  };
  const fuente = (["ia", "metodo", "revertir"] as const).includes(r.fuente as FuenteFilaLote) ? (r.fuente as FuenteFilaLote) : base.fuente;
  return {
    ...base,
    fila_id: r.fila_id ?? base.fila_id,
    fuente,
    resultado: r.resultado,
    codigo: r.resultado === "aplicada" ? null : (r.codigo as CodigoRechazoFila | null),
    valor: r.resultado === "aplicada" ? r.valor : null,
    valor_actual: r.valor_actual,
    brecha_u: r.resultado === "aplicada" ? base.brecha_u : null,
  };
}

const aResumen = (l: LoteDb): ResumenLoteApi => {
  const r = (l.resumen ?? {}) as unknown as Partial<ResumenLoteApi>;
  return { pedidas: r.pedidas ?? 0, aplicadas: r.aplicadas ?? 0, rechazadas: r.rechazadas ?? {}, por_fuente: r.por_fuente ?? {} };
};

/** `LoteApi` con los conteos derivados: cuántas filas aplicadas ya devolvió a la propuesta otro lote de reversión y el estado que sale de ahí. */
function aLoteApi(l: LoteDb, revertidas: number): LoteApi {
  const tipo: TipoLote = (TIPOS_LOTE as readonly string[]).includes(l.tipo) ? (l.tipo as TipoLote) : "aprobar";
  const resumen = aResumen(l);
  const esReversion = tipo === "revertir";
  return {
    id: l.id,
    confirmacion_id: l.confirmacion_id,
    proyeccion_id: l.proyeccion_id,
    tipo,
    revierte_lote_id: l.revierte_lote_id,
    anio: l.anio,
    created_at: l.created_at,
    usuario_nombre: l.usuario_nombre,
    perfil_id: l.perfil_id,
    filtro: (l.filtro ?? {}) as unknown as FiltroLote,
    nota: l.nota,
    revision_confirmada: l.revision_confirmada,
    resumen,
    efecto_gm_previsto: Array.isArray(l.efecto_gm_previsto) ? (l.efecto_gm_previsto as unknown as EfectoGMApi[]) : [],
    propuestas_gm: l.propuestas_gm ?? [],
    filas_revertidas: esReversion ? 0 : revertidas,
    estado: esReversion ? null : revertidas <= 0 ? "vigente" : revertidas >= resumen.aplicadas ? "revertido" : "revertido_en_parte",
  };
}

const aFilaLoteApi = (f: LoteFilaDb): FilaLoteApi => ({
  id: f.id,
  fila_id: f.fila_id,
  fila_clave: f.fila_clave,
  gm_clave: f.gm_clave,
  anio: f.anio,
  fuente: (["ia", "metodo", "revertir"] as const).includes(f.fuente as FuenteFilaLote) ? (f.fuente as FuenteFilaLote) : "metodo",
  resultado: f.resultado as FilaLoteApi["resultado"],
  valor: f.valor,
  valor_esperado: f.valor_esperado,
  valor_actual: f.valor_actual,
  decidido_anterior: f.decidido_anterior,
  propuesta_fila_id: f.propuesta_fila_id,
});

/** Las filas guardadas de un lote como filas del plan (para armar la misma respuesta que el `POST`). */
const planDeLoteFilas = (filas: readonly LoteFilaDb[]): FilaPlanificada[] =>
  filas.map((f) =>
    planDeRespuesta(
      { fila_id: f.fila_id, fila_clave: f.fila_clave, anio: f.anio, gm_clave: f.gm_clave, fuente: f.fuente, resultado: f.resultado === "aplicada" ? "aplicada" : "rechazada", codigo: f.resultado === "aplicada" ? null : f.resultado, valor: f.valor, valor_actual: f.valor_actual },
      undefined
    )
  );

/** El resultado de un lote ya guardado (reintento con el mismo `lote_id` y el mismo cuerpo: `repetido`). */
async function respuestaGuardada(e: Escenario, lote: LoteDb, huella: string): Promise<Salida<ResultadoLoteApi>> {
  const filas = await leerFilasDeLoteDb(e.d, lote.id);
  if (filas.error) return fallaDb(filas.error, "aprobación: leer las filas del lote");
  const efecto = Array.isArray(lote.efecto_gm_previsto) ? (lote.efecto_gm_previsto as unknown as EfectoGMApi[]) : [];
  return listo(
    armarResultadoLote({
      plan: planDeLoteFilas(filas.data),
      efecto_gm: efecto,
      crecimientos_a_reaprobar: [],
      pendientes_cierre: contarPendientes({ base: e.base, tiendas: e.tiendas, Y: e.Y, umbral: e.umbral, anio: lote.anio }),
      huella_simulacion: huella,
      simulado: false,
      repetido: true,
      lote: aLoteApi(lote, 0),
    })
  );
}

/**
 * Escribe el lote con la función SQL, traduce sus errores, lee el lote guardado, rehace el resumen UNA vez (R20) y arma la respuesta con lo que de verdad se
 * escribió (los rechazos de SQL incluidos). `efecto`: el previsto de TypeScript.
 */
async function escribirLote(a: { e: Escenario; payload: PayloadLote; ev: Evaluacion; huella: string; conCatalogo: boolean }): Promise<Salida<ResultadoLoteApi>> {
  const { e, payload, ev } = a;
  const r = await aplicarLoteDb(e.d, payload);
  if (r.error) return traducirErrorLote(r.error);
  const resp: RespuestaLoteDb | null = r.data;
  if (!resp) return fallaMensaje("No se pudo guardar el lote: vuelve a intentarlo.", 500);
  await refrescarResumen(e.d, e.p, a.conCatalogo ? e.pi.catalogo : undefined);
  const guardado = await leerLoteDb(e.d, payload.lote.id);
  if (guardado.error) return fallaDb(guardado.error, "aprobación: leer el lote guardado");
  const porClave = new Map(ev.plan.map((p) => [`${p.fila_id}#${p.anio}`, p]));
  const filas = resp.filas.map((f) => planDeRespuesta(f, f.fila_id ? porClave.get(`${f.fila_id}#${f.anio}`) : undefined));
  const resultado = armarResultadoLote({
    plan: filas,
    efecto_gm: resp.repetido && guardado.data && Array.isArray(guardado.data.efecto_gm_previsto) ? (guardado.data.efecto_gm_previsto as unknown as EfectoGMApi[]) : ev.efecto,
    crecimientos_a_reaprobar: ev.crecimientos,
    pendientes_cierre: ev.pendientes,
    huella_simulacion: a.huella,
    simulado: false,
    repetido: resp.repetido,
    lote: guardado.data ? aLoteApi(guardado.data, 0) : null,
  });
  return listo(resultado);
}

// ─── POST …/lotes (aprobar y reaprobar, con simular) ───

/** Los GML de las filas pedidas (la identidad de una fila viene de la lectura de todas las base) y los de sus GM completos. */
function nodosDeFilas(e: Escenario, ids: readonly string[]): { gmlIds: string[]; gmlIdsGM: string[]; gms: string[] } {
  const gml = new Set<string>();
  const gms = new Set<string>();
  for (const id of ids) {
    const f = e.porId.get(id);
    if (!f) continue;
    gml.add(f.gml_id);
    const gm = gmDeFila(e.pi, f);
    if (gm !== "") gms.add(gm);
  }
  const gmlGM = new Set<string>(gml);
  for (const gm of gms) for (const g of e.pi.gms.find((x) => x.gm_clave === gm)?.gml_ids ?? []) gmlGM.add(g);
  return { gmlIds: [...gml].sort(porTexto), gmlIdsGM: [...gmlGM].sort(porTexto), gms: [...gms].sort(porTexto) };
}

export async function aplicarLote(id: string, cuerpo: LoteCuerpo, actor: Actor): Promise<Salida<ResultadoLoteApi>> {
  const d = db();
  const esc = await cargarEscenario(d, id);
  if (esc.respuesta) return falla(esc.respuesta);
  const e = esc.data;
  const { pi, p, Y } = e;
  const huellaCuerpo = huellaCuerpoLote(cuerpo);

  // Idempotencia (D10): un reintento con el mismo `lote_id` devuelve lo guardado sin volver a mirar los bloqueos (el primer intento puede haberlos creado, D15).
  if (!cuerpo.simular) {
    const previo = await leerLoteDb(d, cuerpo.lote_id);
    if (previo.error) return fallaDb(previo.error, "aprobación: leer el lote");
    if (previo.data) {
      if (previo.data.proyeccion_id === id && previo.data.huella_cuerpo === huellaCuerpo) return respuestaGuardada(e, previo.data, cuerpo.huella_simulacion ?? "");
      return fallaConCodigo("Ese identificador de lote ya se usó con otra petición: vuelve a cargar la pantalla.", 409, "lote_ajeno");
    }
  }

  const rechazoAnio = motivoRechazoAnioYFuentes({ anio: cuerpo.anio, anioEnCurso: Y, fuentes: cuerpo.filas.map((f) => f.fuente) });
  if (rechazoAnio) return fallaRegla(rechazoAnio);
  if (p.calculado_at === null) return fallaConCodigo(MENSAJE_SIN_CALCULAR, 409, "datos_cambiaron");

  const empezada = await confirmacionEmpezada(d, p, cuerpo.confirmacion_id);
  if (empezada.respuesta) return falla(empezada.respuesta);
  const blq = await leerBloqueos(d, p, e.base, { sinCrecimientos: empezada.data });
  if (blq.respuesta) return falla(blq.respuesta);
  if (blq.data.bloqueos.length > 0) {
    const primero = blq.data.bloqueos[0];
    return fallaConCodigo(primero.mensaje, 409, primero.codigo, { bloqueos: blq.data.bloqueos, ...(primero.detalle ? { detalle: primero.detalle } : {}) });
  }

  // D16: con ítems de IA, el servicio debe poder y no puede haber una corrida en curso; si no, se rechaza el cuerpo entero.
  const hayIa = cuerpo.filas.some((f) => f.fuente === "ia");
  const nodos = nodosDeFilas(e, cuerpo.filas.map((f) => f.fila_id));
  let valores: ValoresIaAprobacion | null = null;
  let iaDisponible = false;
  if (cuerpo.anio === Y + 1) {
    const s = await evaluarServicio(d, actor.id);
    if (s.respuesta) return falla(s.respuesta);
    const ia = iaDisponibleDe(s.data);
    iaDisponible = ia.disponible;
    if (hayIa && !ia.disponible) {
      return ia.motivo === "capacidad_apagada" ? fallaIa("La propuesta de IA para la distribución de la meta está apagada.", 409, "capacidad_apagada") : faltaServicio(s.data);
    }
    if (ia.disponible) {
      const gmsLeer = pi.gms.filter((g) => nodos.gms.includes(g.gm_clave));
      const v = await valoresIaParaAprobacion(d, pi, s.data, gmsLeer, { reaprobar: true, filas: e.base.filter((f) => f.activo) });
      if (v.respuesta) return falla(v.respuesta);
      valores = v.data;
      if (hayIa && valores.corrida_en_curso) return fallaIa("Hay una corrida de IA en curso: espera a que termine para aprobar con la IA.", 409, "corrida_en_curso");
    }
  }

  const compR = await leerCompletas(e, { anio: cuerpo.anio, filaIds: cuerpo.filas.map((f) => f.fila_id), gmlIds: nodos.gmlIds, gmlIdsGM: nodos.gmlIdsGM });
  if (compR.respuesta) return falla(compR.respuesta);
  const completas = compR.data;
  const h: HechosGM = { anio: cuerpo.anio, Y, umbral: e.umbral, pi, iaDisponible, valores, porGM: filasPorGM(e) };
  const gmsDelPlan = gmsPlan(h);
  const filasPlan = new Map<string, FilaPlan>();
  for (const it of cuerpo.filas) {
    const raw = completas.filas.get(it.fila_id) ?? e.porId.get(it.fila_id);
    if (raw && raw.tienda_id === null) filasPlan.set(it.fila_id, filaPlanDe(raw, h, completas.tiendas));
  }
  const plan = planificarLote({
    tipo: cuerpo.tipo,
    anio: cuerpo.anio,
    anioEnCurso: Y,
    items: cuerpo.filas,
    filas: filasPlan,
    gms: gmsDelPlan,
    propuestasFila: valores?.propuestasFila ?? new Map(),
  });
  const ahora = sello();
  const ev = evaluar({ e, anio: cuerpo.anio, tipo: cuerpo.tipo, plan, completas, actor, ahora, nota: cuerpo.nota, loteId: cuerpo.lote_id, vigentes: blq.data.vigentes });
  const requerida = revisionRequerida({ filasPedidas: cuerpo.filas.length, efecto: ev.efecto });

  if (cuerpo.simular) {
    return listo(armarResultadoLote({ plan: ev.plan, efecto_gm: ev.efecto, crecimientos_a_reaprobar: ev.crecimientos, pendientes_cierre: ev.pendientes, huella_simulacion: ev.huella, simulado: true }));
  }
  if (cuerpo.huella_simulacion !== ev.huella) {
    return fallaConCodigo("El resultado cambió desde que lo revisaste: vuelve a simular y revisa el resumen.", 409, "simulacion_distinta");
  }
  // M2: si TypeScript ya rechazó todas las filas, la función SQL no tiene nada que escribir: no se llama (ni se guarda un lote vacío).
  if (!ev.plan.some((f) => f.resultado === "aplicada")) return fallaConCodigo(MENSAJE_SIN_FILAS_APROBAR, 409, "sin_filas_aplicables");
  if (requerida && !cuerpo.revision_confirmada) {
    return fallaConCodigo("Marca «Revisé el resumen por GM» para aprobar este lote.", 409, "revision_requerida");
  }

  const grupos = armarGrupos({ plan: { filas: ev.plan }, filas: filasPlan, gms: gmsDelPlan, registros: ev.registros });
  const propuestas = [...new Set(grupos.filter((g) => g.tipo === "ia" && g.propuesta_gm_id).map((g) => g.propuesta_gm_id as string))].sort(porTexto);
  const cabecera: CabeceraLotePayload = {
    id: cuerpo.lote_id,
    confirmacion_id: cuerpo.confirmacion_id,
    proyeccion_id: id,
    tipo: cuerpo.tipo,
    anio: cuerpo.anio,
    huella_cuerpo: huellaCuerpo,
    calculado_at_esperado: p.calculado_at,
    filtro: cuerpo.filtro ?? {},
    efecto_gm_previsto: ev.efecto,
    revision_confirmada: cuerpo.revision_confirmada,
    propuestas_gm: propuestas,
    ...(cuerpo.nota !== undefined ? { nota: cuerpo.nota } : {}),
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  };
  return escribirLote({ e, payload: { lote: cabecera, grupos }, ev, huella: ev.huella, conCatalogo: cuerpo.anio === Y });
}

// ─── Revertir ───

type ParametrosReversion = {
  lote_id: string;
  filas?: readonly string[];
  nota?: string;
  simular: boolean;
  huella_simulacion?: string;
  /** Reversión de una confirmación: una tanda sin nada que revertir se omite en vez de cortar las demás (devuelve `lote: null`). */
  tolerarSinFilas?: boolean;
};

/** Revierte UN lote (entero o las filas marcadas). Comparte todo con la ruta de la confirmación. */
async function revertirUnLote(e: Escenario, lote: LoteDb, o: ParametrosReversion, actor: Actor): Promise<Salida<ResultadoLoteApi>> {
  const { d, p, pi, Y } = e;
  const tipo: TipoLote = (TIPOS_LOTE as readonly string[]).includes(lote.tipo) ? (lote.tipo as TipoLote) : "aprobar";
  const huellaCuerpo = huellaCuerpoReversion({ lote_id: o.lote_id, confirmacion_id: lote.confirmacion_id, revierte_lote_id: lote.id, filas: o.filas, nota: o.nota });

  // Idempotencia (D10, I4): igual que `aplicarLote`, un reintento con el mismo `lote_id` devuelve lo guardado ANTES de mirar si la proyección ya se cerró o se está calculando
  // (el primer intento pudo haber terminado y la proyección cerrarse después).
  if (!o.simular) {
    const previo = await leerLoteDb(d, o.lote_id);
    if (previo.error) return fallaDb(previo.error, "aprobación: leer el lote de reversión");
    if (previo.data) {
      if (previo.data.proyeccion_id === p.id && previo.data.huella_cuerpo === huellaCuerpo) return respuestaGuardada(e, previo.data, o.huella_simulacion ?? "");
      return fallaConCodigo("Ese identificador de lote ya se usó con otra petición: vuelve a cargar la pantalla.", 409, "lote_ajeno");
    }
  }

  const noRevertible = motivoRechazoRevertir({ tipo, proyeccionIdDelLote: lote.proyeccion_id, proyeccionId: p.id });
  if (noRevertible) return fallaRegla(noRevertible);
  const bloqueo = bloqueoDeReversion({ estado: estadoDe(p), calculandoDesde: p.calculando_desde, ahora: sello() });
  if (bloqueo) return fallaRegla(bloqueo);
  if (p.calculado_at === null) return fallaConCodigo(MENSAJE_SIN_CALCULAR, 409, "datos_cambiaron");

  const delLote = await leerFilasDeLoteDb(d, lote.id);
  if (delLote.error) return fallaDb(delLote.error, "aprobación: leer las filas del lote");
  const filasLote: FilaLoteARevertir[] = delLote.data
    .filter((f) => f.resultado === "aplicada" && f.anio === lote.anio)
    .map((f) => ({ fila_id: f.fila_id, fila_clave: f.fila_clave, gm_clave: f.gm_clave, anio: f.anio }));
  const ids = [...new Set([...filasLote.flatMap((f) => (f.fila_id ? [f.fila_id] : [])), ...(o.filas ?? [])])];
  const nodos = nodosDeFilas(e, ids);
  const vig = await leerVigentesY1(d, Y);
  if (vig.respuesta) return falla(vig.respuesta);
  const compR = await leerCompletas(e, { anio: lote.anio, filaIds: ids, gmlIds: nodos.gmlIds, gmlIdsGM: nodos.gmlIdsGM });
  if (compR.respuesta) return falla(compR.respuesta);
  const completas = compR.data;

  const h: HechosGM = { anio: lote.anio, Y, umbral: e.umbral, pi, iaDisponible: false, valores: null, porGM: filasPorGM(e) };
  const filasPlan = new Map<string, FilaPlan>();
  for (const id of ids) {
    const raw = completas.filas.get(id) ?? e.porId.get(id);
    if (raw && raw.tienda_id === null) filasPlan.set(id, filaPlanDe(raw, h, completas.tiendas));
  }
  const plan = planificarReversion({ loteId: lote.id, anio: lote.anio, filasLote, seleccion: o.filas, filas: filasPlan });
  const ev = evaluar({ e, anio: lote.anio, tipo: "revertir", plan, completas, actor, ahora: sello(), nota: o.nota, loteId: null, vigentes: vig.data });

  if (o.simular) {
    return listo(armarResultadoLote({ plan: ev.plan, efecto_gm: ev.efecto, crecimientos_a_reaprobar: ev.crecimientos, pendientes_cierre: ev.pendientes, huella_simulacion: ev.huella, simulado: true }));
  }
  // Revertir no exige huella (decisión 82-e): si el cuerpo trae una y el resultado es otro, no se escribe.
  if (o.huella_simulacion !== undefined && o.huella_simulacion !== ev.huella) {
    return fallaConCodigo("El resultado cambió desde que lo revisaste: vuelve a simular y revisa el resumen.", 409, "simulacion_distinta");
  }
  // M2: sin ninguna fila que revertir no se llama a la función ni se guarda un lote vacío.
  if (!ev.plan.some((f) => f.resultado === "aplicada")) {
    if (o.tolerarSinFilas) {
      return listo(armarResultadoLote({ plan: ev.plan, efecto_gm: ev.efecto, crecimientos_a_reaprobar: ev.crecimientos, pendientes_cierre: ev.pendientes, huella_simulacion: ev.huella, simulado: false, repetido: false, lote: null }));
    }
    return fallaConCodigo(MENSAJE_SIN_FILAS_REVERTIR, 409, "sin_filas_aplicables");
  }
  const grupos = armarGrupos({ plan: { filas: ev.plan }, filas: filasPlan, gms: new Map(), registros: ev.registros });
  const cabecera: CabeceraLotePayload = {
    id: o.lote_id,
    confirmacion_id: lote.confirmacion_id,
    proyeccion_id: p.id,
    tipo: "revertir",
    revierte_lote_id: lote.id,
    anio: lote.anio,
    huella_cuerpo: huellaCuerpo,
    calculado_at_esperado: p.calculado_at,
    filtro: {},
    efecto_gm_previsto: ev.efecto,
    revision_confirmada: false,
    propuestas_gm: [],
    ...(o.nota !== undefined ? { nota: o.nota } : {}),
    perfil_id: actor.id,
    usuario_nombre: actor.nombre,
  };
  return escribirLote({ e, payload: { lote: cabecera, grupos }, ev, huella: ev.huella, conCatalogo: lote.anio === Y });
}

export async function revertirLote(id: string, loteId: string, cuerpo: RevertirCuerpo, actor: Actor): Promise<Salida<ResultadoLoteApi>> {
  const d = db();
  const existe = await leerProyeccionExistente(d, id);
  if (existe.respuesta) return falla(existe.respuesta);
  const lote = await leerLoteDb(d, loteId);
  if (lote.error) return fallaDb(lote.error, "aprobación: leer el lote");
  if (!lote.data || lote.data.proyeccion_id !== id) return fallaMensaje(MENSAJE_LOTE_NO_ENCONTRADO, 404);
  const esc = await cargarEscenario(d, id);
  if (esc.respuesta) return falla(esc.respuesta);
  return revertirUnLote(esc.data, lote.data, { lote_id: cuerpo.lote_id, filas: cuerpo.filas, nota: cuerpo.nota, simular: cuerpo.simular, huella_simulacion: cuerpo.huella_simulacion }, actor);
}

/**
 * Revierte una confirmación completa: un lote de reversión por cada lote `aprobar` o `reaprobar` de la confirmación, del más antiguo al más reciente, con los
 * `lote_ids` que generó el navegador (uno por lote, en ese orden). Se detiene en el primer error; lo ya revertido queda y un reintento con los mismos ids
 * devuelve lo guardado (`repetido`).
 */
export async function revertirConfirmacion(id: string, confirmacionId: string, cuerpo: RevertirConfirmacionCuerpo, actor: Actor): Promise<Salida<ResultadoLoteApi[]>> {
  const d = db();
  const esc = await cargarEscenario(d, id);
  if (esc.respuesta) return falla(esc.respuesta);
  const lotes = await leerLotesDeConfirmacionDb(d, id, confirmacionId);
  if (lotes.error) return fallaDb(lotes.error, "aprobación: leer los lotes de la confirmación");
  const delTipo = lotes.data.filter((l) => l.tipo === "aprobar" || l.tipo === "reaprobar");
  if (delTipo.length === 0) return fallaMensaje("Confirmación no encontrada.", 404);
  // Una tanda sin ninguna fila aplicada no tiene nada que revertir: se ignora sin error (el navegador manda un id por cada tanda con filas aplicadas).
  const aRevertir = delTipo.filter((l) => aResumen(l).aplicadas > 0);
  if (aRevertir.length !== cuerpo.lote_ids.length) {
    return fallaMensaje(`La confirmación tiene ${aRevertir.length} ${aRevertir.length === 1 ? "tanda" : "tandas"} con filas aplicadas: hace falta un identificador por cada una.`, 400);
  }
  const salida: ResultadoLoteApi[] = [];
  for (let i = 0; i < aRevertir.length; i++) {
    // Cada reversión puede mover la proyección (B2): se vuelve a leer lo necesario antes de la siguiente.
    const fresco = i === 0 ? esc : await cargarEscenario(d, id);
    if (fresco.respuesta) return falla(fresco.respuesta);
    const r = await revertirUnLote(fresco.data, aRevertir[i], { lote_id: cuerpo.lote_ids[i], nota: cuerpo.nota, simular: cuerpo.simular, tolerarSinFilas: true }, actor);
    if (r.respuesta) return falla(r.respuesta);
    salida.push(r.data);
  }
  // M2: si ninguna tanda tenía algo que revertir (alguien cambió todo después), es el mismo 409 que revertir un solo lote.
  if (!cuerpo.simular && salida.every((r) => r.lote === null)) return fallaConCodigo(MENSAJE_SIN_FILAS_REVERTIR, 409, "sin_filas_aplicables");
  return listo(salida);
}

// ─── Historial ───

/** Filas aplicadas que cada lote de reversión devolvió a la propuesta, por lote revertido. */
function revertidasPorLote(lotes: readonly LoteDb[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lotes) {
    if (l.tipo !== "revertir" || !l.revierte_lote_id) continue;
    m.set(l.revierte_lote_id, (m.get(l.revierte_lote_id) ?? 0) + aResumen(l).aplicadas);
  }
  return m;
}

export async function listarLotes(id: string): Promise<Salida<{ lotes: LoteApi[] }>> {
  const d = db();
  const p = await leerProyeccionExistente(d, id);
  if (p.respuesta) return falla(p.respuesta);
  const lotes = await leerLotesDeProyeccionDb(d, id);
  if (lotes.error) return fallaDb(lotes.error, "aprobación: leer los lotes");
  const rev = revertidasPorLote(lotes.data);
  return listo({ lotes: lotes.data.map((l) => aLoteApi(l, rev.get(l.id) ?? 0)) });
}

export async function leerLote(id: string, loteId: string): Promise<Salida<LoteApi & { filas: FilaLoteApi[] }>> {
  const d = db();
  const p = await leerProyeccionExistente(d, id);
  if (p.respuesta) return falla(p.respuesta);
  const lote = await leerLoteDb(d, loteId);
  if (lote.error) return fallaDb(lote.error, "aprobación: leer el lote");
  if (!lote.data || lote.data.proyeccion_id !== id) return fallaMensaje(MENSAJE_LOTE_NO_ENCONTRADO, 404);
  const [filas, reversiones] = await Promise.all([leerFilasDeLoteDb(d, loteId), leerReversionesDeLoteDb(d, loteId)]);
  if (filas.error) return fallaDb(filas.error, "aprobación: leer las filas del lote");
  if (reversiones.error) return fallaDb(reversiones.error, "aprobación: leer las reversiones del lote");
  const revertidas = reversiones.data.filter((l) => l.proyeccion_id === id).reduce((s, l) => s + aResumen(l).aplicadas, 0);
  return listo({ ...aLoteApi(lote.data, revertidas), filas: filas.data.map(aFilaLoteApi) });
}

/** `404` si la proyección no existe (el historial es de una proyección). */
async function leerProyeccionExistente(d: Db, id: string): Promise<Salida<null>> {
  const r = await proyeccionOr404(d, id);
  if (r.respuesta) return falla(r.respuesta);
  return listo(null);
}
