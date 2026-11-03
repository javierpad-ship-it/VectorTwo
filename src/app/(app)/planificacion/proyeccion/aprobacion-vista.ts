// Lógica de vista de la pestaña «Aprobación» (ficha 07g, §4). Pura, sin React: la prueba vitest con datos sintéticos. Aquí viven las rutas (URL de la
// pantalla y de la API), el estado de los filtros en la URL, la selección, las tandas, la combinación de resultados, los textos y la traducción de los
// errores de la API. Nada de esto decide cifras de negocio: las cifras, las exclusiones y los bloqueos vienen del servidor (`src/lib/aprobacion/`).

import type { ItemLote, LoteCuerpo } from "@/lib/aprobacion/esquemas";
import {
  MAX_FILAS_LOTE,
  MAX_MAYORES,
  REVISION_DESVIO_PCT,
  REVISION_OBLIGATORIA_DESDE,
  type AprobacionApi,
  type BloqueoLoteApi,
  type CodigoExclusion,
  type CodigoRechazoFila,
  type CrecimientoAReaprobarApi,
  type EfectoGMApi,
  type EstadoLote,
  type FiltroLote,
  type FilaAprobacionApi,
  type FuenteFilaLote,
  type GMAprobacionApi,
  type LoteApi,
  type ModoAprobacion,
  type PendientesCierreApi,
  type ResultadoFilaLoteApi,
  type ResultadoLoteApi,
  type ResumenLoteApi,
  type TipoLote,
  type TotalesLoteApi,
} from "@/lib/aprobacion/tipos-api";
import { trocear } from "@/lib/aprobacion/trocear";
import { formatearNumero, plural } from "@/lib/formato";
import type { EstadoPropuestaGM } from "@/lib/ia/tipos-api";
import { CODIGOS_CIERRE_BLOQUEADO_NINO } from "@/lib/proyeccion/tipos-api";
import { claveGmValida, idsDeGm } from "./propuesta-ia-vista";
import type { ErrorAccion } from "./use-proyeccion";
import { formatearPct, unidades, type FiltroVista } from "./vista";

// ─── Rutas ───

export const RUTA_PANTALLA_PROYECCION = "/planificacion/proyeccion";

/**
 * Lo que se puede dejar puesto en la URL al llegar a la pestaña (desde el modal de Cerrar, desde «Propuesta IA» o desde Por línea). `genero`, `mundo`, `linea` y
 * `agrupacion_marca` son ids y son los mismos filtros que comparten Por línea y Matriz; `gm` es la clave `<genero_id>.<mundo_id>`.
 */
export type FiltroRutaAprobacion = {
  anio?: number;
  modo?: ModoAprobacion;
  gm?: string;
  genero?: string;
  mundo?: string;
  linea?: string;
  agrupacion_marca?: string;
};

/**
 * CONGELADA (Frontend B la usa para sus enlaces): la URL de la pantalla con la pestaña «Aprobación» abierta y el filtro puesto. Mismo orden siempre;
 * lo vacío no se escribe y el modo `aprobar` (el de siempre) tampoco.
 */
export function rutaAprobacion(proyeccionId: string, filtro: FiltroRutaAprobacion = {}): string {
  const q = new URLSearchParams();
  q.set("proyeccion", proyeccionId);
  q.set("pestana", "aprobacion");
  if (filtro.anio !== undefined) q.set("anio", String(filtro.anio));
  if (filtro.modo === "reaprobar") q.set("modo", "reaprobar");
  if (filtro.gm) q.set("gm", filtro.gm);
  if (filtro.genero) q.set("genero", filtro.genero);
  if (filtro.mundo) q.set("mundo", filtro.mundo);
  if (filtro.linea) q.set("linea", filtro.linea);
  if (filtro.agrupacion_marca) q.set("agrupacion_marca", filtro.agrupacion_marca);
  return `${RUTA_PANTALLA_PROYECCION}?${q.toString()}`;
}

const baseApi = (proyeccionId: string) => `/api/proyeccion/proyecciones/${proyeccionId}/aprobacion`;
export const urlAprobacionApi = (proyeccionId: string, anio: number, modo: ModoAprobacion) => `${baseApi(proyeccionId)}?anio=${anio}&modo=${modo}`;
export const urlLotes = (proyeccionId: string) => `${baseApi(proyeccionId)}/lotes`;
export const urlLote = (proyeccionId: string, loteId: string) => `${baseApi(proyeccionId)}/lotes/${loteId}`;
export const urlRevertirLote = (proyeccionId: string, loteId: string) => `${urlLote(proyeccionId, loteId)}/revertir`;
export const urlRevertirConfirmacion = (proyeccionId: string, confirmacionId: string) => `${baseApi(proyeccionId)}/confirmaciones/${confirmacionId}/revertir`;

// ─── Estado en la URL (propio de la pestaña; género, mundo, línea y marca son los filtros compartidos de `vista.ts`) ───

export type ConfianzaFiltro = "alta" | "media";

export type ParametrosAprobacion = {
  /** `null` = el año en curso. */
  anio: number | null;
  modo: ModoAprobacion;
  /** Clave de GM (`<genero_id>.<mundo_id>`) o vacío. */
  gm: string;
  /** «Solo sin avisos fuertes» está encendido por defecto: el parámetro lo APAGA (`fuertes=1`). */
  incluirFuertes: boolean;
  /** «Para revisión» incluidas por defecto (Javier, f): el parámetro las QUITA (`revision=0`). */
  incluirRevision: boolean;
  confianza: ConfianzaFiltro[];
  estadoIa: EstadoPropuestaGM[];
  brechaMaxPct: number | null;
};

export const PARAMETROS_APROBACION_INICIALES: ParametrosAprobacion = {
  anio: null,
  modo: "aprobar",
  gm: "",
  incluirFuertes: false,
  incluirRevision: true,
  confianza: [],
  estadoIa: [],
  brechaMaxPct: null,
};

/** Claves de URL que son solo de esta pestaña (al cambiar de pestaña se quitan junto con el resto de lo que no corresponde). */
export const CLAVES_APROBACION = ["anio", "modo", "gm", "fuertes", "revision", "conf", "estado_ia", "brecha"] as const;

export const ESTADOS_IA_FILTRABLES: readonly EstadoPropuestaGM[] = ["al_dia", "meta_movida", "desactualizada", "sin_propuesta", "fallida", "bloqueado_privacidad", "sin_filas_libres"];

const lista = (v: string | null): string[] => (v ? v.split(",").filter(Boolean) : []);

export function leerParametrosAprobacion(params: { get: (k: string) => string | null }): ParametrosAprobacion {
  const anioTexto = params.get("anio");
  const anio = anioTexto !== null && /^\d{4}$/.test(anioTexto) && Number(anioTexto) >= 2024 && Number(anioTexto) <= 2101 ? Number(anioTexto) : null;
  const gm = params.get("gm");
  const brechaTexto = params.get("brecha");
  const brecha = brechaTexto !== null && brechaTexto !== "" ? Number(brechaTexto) : NaN;
  return {
    anio,
    modo: params.get("modo") === "reaprobar" ? "reaprobar" : "aprobar",
    gm: claveGmValida(gm) ? gm : "",
    incluirFuertes: params.get("fuertes") === "1",
    incluirRevision: params.get("revision") !== "0",
    confianza: lista(params.get("conf")).filter((c): c is ConfianzaFiltro => c === "alta" || c === "media"),
    estadoIa: lista(params.get("estado_ia")).filter((e): e is EstadoPropuestaGM => (ESTADOS_IA_FILTRABLES as readonly string[]).includes(e)),
    brechaMaxPct: Number.isFinite(brecha) && brecha >= 0 && brecha <= 10000 ? brecha : null,
  };
}

/** Cambios de parámetros → cambios de URL (`null` quita el parámetro; lo que es el valor por defecto tampoco se escribe). Solo las claves presentes. */
export function parametrosAUrl(c: Partial<ParametrosAprobacion>): Record<string, string | null> {
  const u: Record<string, string | null> = {};
  if ("anio" in c) u.anio = c.anio == null ? null : String(c.anio);
  if ("modo" in c) u.modo = c.modo === "reaprobar" ? "reaprobar" : null;
  if ("gm" in c) u.gm = c.gm ? c.gm : null;
  if ("incluirFuertes" in c) u.fuertes = c.incluirFuertes ? "1" : null;
  if ("incluirRevision" in c) u.revision = c.incluirRevision === false ? "0" : null;
  if ("confianza" in c) u.conf = c.confianza && c.confianza.length > 0 ? c.confianza.join(",") : null;
  if ("estadoIa" in c) u.estado_ia = c.estadoIa && c.estadoIa.length > 0 ? c.estadoIa.join(",") : null;
  if ("brechaMaxPct" in c) u.brecha = c.brechaMaxPct == null ? null : String(c.brechaMaxPct);
  return u;
}

/** ¿Algún filtro propio de la pestaña se aparta del valor por defecto? (para ofrecer «Quitar filtros») */
export function hayFiltroAprobacion(p: ParametrosAprobacion, f: Pick<FiltroVista, "genero" | "mundo" | "linea" | "agrupacion_marca">): boolean {
  return (
    p.gm !== "" || p.incluirFuertes || !p.incluirRevision || p.confianza.length > 0 || p.estadoIa.length > 0 || p.brechaMaxPct !== null || f.genero !== "" || f.mundo !== "" || f.linea !== "" || f.agrupacion_marca !== ""
  );
}

// ─── Filtros (en el navegador) ───

export type FiltroCompartido = Pick<FiltroVista, "genero" | "mundo" | "linea" | "agrupacion_marca">;

/**
 * Aplica los filtros de §4.3 a las filas que dio el servidor. No decide elegibilidad: una fila excluida (D4, D5) SE VE, con su motivo y la casilla deshabilitada.
 * Con el filtro de confianza puesto, una fila sin confianza de IA (método) no se muestra; con la brecha máxima, una fila sin brecha sí (no hay nada que medir).
 */
export function filtrarFilas(filas: readonly FilaAprobacionApi[], gms: readonly GMAprobacionApi[], f: FiltroCompartido, p: ParametrosAprobacion): FilaAprobacionApi[] {
  const estadoDeGm = new Map(gms.map((g) => [g.gm_clave, g.estado_ia] as const));
  return filas.filter((r) => {
    if (p.gm !== "" && r.gm_clave !== p.gm) return false;
    if (f.genero !== "" || f.mundo !== "") {
      const ids = idsDeGm(r.gm_clave);
      if (!ids) return false;
      if (f.genero !== "" && ids.genero_id !== f.genero) return false;
      if (f.mundo !== "" && ids.mundo_id !== f.mundo) return false;
    }
    if (f.linea !== "" && r.linea_id !== f.linea) return false;
    if (f.agrupacion_marca !== "" && r.agrupacion_marca_id !== f.agrupacion_marca) return false;
    if (!p.incluirFuertes && r.avisos_fuertes) return false;
    if (!p.incluirRevision && r.motivo_cierre === "revision_cola_larga") return false;
    if (p.confianza.length > 0) {
      const c = r.ia?.confianza;
      if (c !== "alta" && c !== "media") return false;
      if (!p.confianza.includes(c)) return false;
    }
    if (p.estadoIa.length > 0) {
      const e = estadoDeGm.get(r.gm_clave) ?? null;
      if (e === null || !p.estadoIa.includes(e)) return false;
    }
    if (p.brechaMaxPct !== null && r.ia?.brecha_pct != null && Math.abs(r.ia.brecha_pct) > p.brechaMaxPct) return false;
    return true;
  });
}

/** El contexto de pantalla que se guarda con el lote (`proyeccion_lotes.filtro`); no cambia lo que se aprueba. */
export function filtroLoteDe(f: FiltroCompartido, p: ParametrosAprobacion): FiltroLote {
  const out: FiltroLote = {};
  if (f.genero) out.generos = [f.genero];
  if (f.mundo) out.mundos = [f.mundo];
  if (f.linea) out.lineas = [f.linea];
  if (f.agrupacion_marca) out.agrupaciones = [f.agrupacion_marca];
  if (p.gm) out.gms = [p.gm];
  out.solo_sin_avisos_fuertes = !p.incluirFuertes;
  out.incluir_revision = p.incluirRevision;
  if (p.confianza.length > 0) out.confianza = p.confianza;
  if (p.estadoIa.length > 0) out.estado_ia = p.estadoIa;
  if (p.brechaMaxPct !== null) out.brecha_max_pct = p.brechaMaxPct;
  return out;
}

// ─── Rótulos de fuente ───

export const ETIQUETA_FUENTE = { ia: "IA", metodo: "Método", metodo_gm_sin_ia: "Método · GM sin IA" } as const;
export type RotuloFuente = keyof typeof ETIQUETA_FUENTE;

/** «IA 10 961», «Método 10 000», «Método · GM sin IA 841». El rótulo de la fuente va siempre. */
export function textoSeAprueba(f: Pick<FilaAprobacionApi, "badge" | "fuente_sugerida" | "ia" | "metodo">): string | null {
  const valor = valorSugerido(f);
  if (f.badge === null || valor === null) return null;
  return `${ETIQUETA_FUENTE[f.badge]} ${unidades(valor)}`;
}

export const ETIQUETA_FUENTE_FILA_LOTE: Record<FuenteFilaLote, string> = { ia: "IA", metodo: "Método", revertir: "Reversión" };

// ─── Selección ───

export const TEXTO_EXCLUSION: Record<CodigoExclusion, string> = {
  confianza_baja: "Confianza baja o sin dato: se decide en Por línea.",
  sin_cifra_ia: "Fila libre sin cifra de la IA: decídela en Por línea o regenera el GM.",
  ia_desactualizada: "La propuesta de IA de este GM está desactualizada: regenera el GM.",
  ia_no_aceptable: "La IA no es aceptable para esta fila ahora.",
};

/** Lo que se escribiría como decidido: la cifra de la IA o la del método según la fuente sugerida; `null` si no hay. */
export function valorSugerido(f: Pick<FilaAprobacionApi, "fuente_sugerida" | "ia" | "metodo">): number | null {
  if (f.fuente_sugerida === "ia") return f.ia?.valor ?? null;
  if (f.fuente_sugerida === "metodo") return f.metodo.valor;
  return null;
}

/** Por qué la casilla de una fila está deshabilitada; `null` = se puede marcar. */
export function motivoNoSeleccionable(f: FilaAprobacionApi, modo: ModoAprobacion): string | null {
  if (f.excluida !== null) return f.motivo_exclusion ?? TEXTO_EXCLUSION[f.excluida] ?? "Excluida del bloque.";
  if (f.fuente_sugerida === null) return f.motivo_exclusion ?? "Sin fuente para aprobar: se decide en Por línea.";
  if (f.fuente_sugerida === "ia" && (f.ia === null || f.ia.valor === null || f.ia.propuesta_fila_id === "")) return "La IA no dio cifra para esta fila: se decide en Por línea.";
  if (modo === "reaprobar" && f.decidido === null) return "No fue aprobada en bloque: no se reaprueba.";
  return null;
}

/** Una fila lista para el cuerpo del lote; `null` si no se puede aprobar. */
export type ItemSeleccion = { fila_id: string; gm_clave: string; item: ItemLote };

export function itemDeFila(f: FilaAprobacionApi, modo: ModoAprobacion): ItemSeleccion | null {
  if (motivoNoSeleccionable(f, modo) !== null) return null;
  const valor = valorSugerido(f);
  if (valor === null || f.fuente_sugerida === null) return null;
  const item: ItemLote = { fila_id: f.fila_id, fuente: f.fuente_sugerida, valor_esperado: valor };
  if (f.fuente_sugerida === "ia" && f.ia) item.propuesta_fila_id = f.ia.propuesta_fila_id;
  if (modo === "reaprobar" && f.decidido !== null) item.decidido_esperado = f.decidido;
  return { fila_id: f.fila_id, gm_clave: f.gm_clave, item };
}

export type ResumenSeleccion = {
  filas: number;
  gms: number;
  ia: { filas: number; unidades: number };
  metodo: { filas: number; unidades: number };
  unidades: number;
  porGm: { gm_clave: string; nombre: string; filas: number; unidades: number; desvio_u: number | null; desvio_pct: number | null; meta: number | null }[];
};

/** Lo que dice la barra de selección: «214 filas · IA 198 (46 120 u) · Método 16 (2 090 u) · en 6 GM». */
export function resumenSeleccion(filas: readonly FilaAprobacionApi[], gms: readonly GMAprobacionApi[]): ResumenSeleccion {
  const ia = { filas: 0, unidades: 0 };
  const metodo = { filas: 0, unidades: 0 };
  const porGm = new Map<string, { filas: number; unidades: number }>();
  for (const f of filas) {
    const v = valorSugerido(f) ?? 0;
    const bolsa = f.fuente_sugerida === "ia" ? ia : metodo;
    bolsa.filas += 1;
    bolsa.unidades += v;
    const g = porGm.get(f.gm_clave) ?? { filas: 0, unidades: 0 };
    g.filas += 1;
    g.unidades += v;
    porGm.set(f.gm_clave, g);
  }
  const datosGm = new Map(gms.map((g) => [g.gm_clave, g] as const));
  const lista = [...porGm.entries()]
    .map(([gm_clave, g]) => {
      const d = datosGm.get(gm_clave);
      return { gm_clave, nombre: d ? nombreGm(d) : gm_clave, filas: g.filas, unidades: g.unidades, desvio_u: d?.desvio_u ?? null, desvio_pct: d?.desvio_pct ?? null, meta: d?.meta ?? null };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { filas: filas.length, gms: lista.length, ia, metodo, unidades: ia.unidades + metodo.unidades, porGm: lista };
}

export function textoBarraSeleccion(r: ResumenSeleccion): string {
  const partes = [plural(r.filas, "fila", "filas")];
  if (r.ia.filas > 0) partes.push(`IA ${formatearNumero(r.ia.filas)} (${formatearNumero(r.ia.unidades)} u)`);
  if (r.metodo.filas > 0) partes.push(`Método ${formatearNumero(r.metodo.filas)} (${formatearNumero(r.metodo.unidades)} u)`);
  partes.push(`en ${r.gms === 1 ? "1 GM" : `${formatearNumero(r.gms)} GM`}`);
  return partes.join(" · ");
}

export const nombreGm = (g: Pick<GMAprobacionApi, "genero" | "mundo">): string => `${g.genero} · ${g.mundo}`;

/** Nombre de la línea en la tabla: la equivalencia si la hay, y la agrupación de marca. */
export function nombreLinea(f: Pick<FilaAprobacionApi, "linea" | "equivalencia" | "agrupacion_marca">): string {
  return f.equivalencia ? `${f.linea} · ${f.equivalencia} · ${f.agrupacion_marca}` : `${f.linea} · ${f.agrupacion_marca}`;
}

export type GrupoGm = { gm: GMAprobacionApi | null; gm_clave: string; nombre: string; lineas: { linea: string; filas: FilaAprobacionApi[] }[]; filas: FilaAprobacionApi[] };

/** Filas agrupadas por GM (en el orden de los GM del servidor, los que no vengan al final) y, dentro, por línea. */
export function agruparPorGm(filas: readonly FilaAprobacionApi[], gms: readonly GMAprobacionApi[]): GrupoGm[] {
  const datos = new Map(gms.map((g) => [g.gm_clave, g] as const));
  const porGm = new Map<string, FilaAprobacionApi[]>();
  for (const f of filas) {
    const l = porGm.get(f.gm_clave);
    if (l) l.push(f);
    else porGm.set(f.gm_clave, [f]);
  }
  const claves = [...porGm.keys()].sort((a, b) => {
    const na = datos.get(a);
    const nb = datos.get(b);
    return (na ? nombreGm(na) : a).localeCompare(nb ? nombreGm(nb) : b, "es");
  });
  return claves.map((clave) => {
    const fs = (porGm.get(clave) as FilaAprobacionApi[]).slice().sort((a, b) => a.linea.localeCompare(b.linea, "es") || nombreLinea(a).localeCompare(nombreLinea(b), "es"));
    const lineas: { linea: string; filas: FilaAprobacionApi[] }[] = [];
    for (const f of fs) {
      const ultima = lineas[lineas.length - 1];
      if (ultima && ultima.linea === f.linea) ultima.filas.push(f);
      else lineas.push({ linea: f.linea, filas: [f] });
    }
    const gm = datos.get(clave) ?? null;
    return { gm, gm_clave: clave, nombre: gm ? nombreGm(gm) : clave, lineas, filas: fs };
  });
}

// ─── Cabecera ───

export function textoPendientesCierre(p: PendientesCierreApi, anioEnCurso: number): string {
  const partes = [`${anioEnCurso} · ${plural(p.filas_y, "fila", "filas")}`, `${anioEnCurso + 1} · ${plural(p.filas_y1, "fila", "filas")}`];
  if (p.para_revision > 0) partes.push(`${formatearNumero(p.para_revision)} para revisión`);
  partes.push(p.tiendas === 1 ? "1 tienda nueva" : `${formatearNumero(p.tiendas)} tiendas nuevas`);
  return `Para cerrar faltan: ${partes.join(" · ")}`;
}

export function textoReaprobables(n: number): string {
  return n === 1 ? "1 fila aprobada en bloque cambió de propuesta tras el último recálculo" : `${formatearNumero(n)} filas aprobadas en bloque cambiaron de propuesta tras el último recálculo`;
}

export function textoIaCabecera(ia: AprobacionApi["ia"], gmsTotal: number): { texto: string; tono: "info" | "alerta" } {
  if (ia.corrida_en_curso) return { texto: "Hay una corrida de IA en curso: no se puede aprobar con IA hasta que termine.", tono: "alerta" };
  if (!ia.disponible) {
    const motivo = ia.motivo ? ` ${ia.motivo}` : "";
    return { texto: `IA apagada: 2027 se aprueba con el método solo en GM sin IA.${motivo}`, tono: "alerta" };
  }
  return { texto: `IA encendida · propuesta vigente en ${formatearNumero(ia.gms_con_propuesta)} de ${formatearNumero(gmsTotal)} GM`, tono: "info" };
}

export function etiquetaAnio(anio: number, anioEnCurso: number): string {
  return anio === anioEnCurso ? `${anio} · Método` : `${anio} · IA`;
}

export const TEXTO_ORDEN_ANIOS = "Aprueba el año en curso primero: cada decisión de ese año mueve la base y la meta del año siguiente.";

export type AccionBloqueo = "recalcular" | "factores" | "crecimientos" | null;

/** Qué enlace acompaña a un bloqueo (D14). */
export function accionDeBloqueo(b: Pick<BloqueoLoteApi, "codigo">): AccionBloqueo {
  if (b.codigo === "proyeccion_desactualizada" || b.codigo === "version_metodo" || b.codigo === "datos_cambiaron") return "recalcular";
  if (b.codigo === "crecimientos_sin_aprobar") return "crecimientos";
  if ((CODIGOS_CIERRE_BLOQUEADO_NINO as readonly string[]).includes(b.codigo)) return "factores";
  return null;
}

export const ETIQUETA_ACCION_BLOQUEO: Record<Exclude<AccionBloqueo, null>, string> = { recalcular: "Recalcular la proyección", factores: "Ir a Factores del Niño", crecimientos: "Ir a Crecimientos" };

// ─── Desvío frente a la meta ───

/** ¿El desvío del GM pasa de ±1 % de su meta? (se pinta en ámbar) */
export const desvioFueraDeRango = (pct: number | null | undefined): boolean => pct !== null && pct !== undefined && Math.abs(pct) > REVISION_DESVIO_PCT;

export function desvioPctDe(desvioU: number | null, meta: number | null): number | null {
  return desvioU === null || meta === null || !(meta > 0) ? null : (desvioU / meta) * 100;
}

/** `+60 (+0.2 %)`; `—` sin dato. */
export function textoDesvio(u: number | null, pct: number | null): string {
  if (u === null) return "—";
  const r = Math.round(u);
  const base = r === 0 ? "0" : `${r > 0 ? "+" : "-"}${unidades(Math.abs(r))}`;
  return pct === null ? base : `${base} (${formatearPct(pct)})`;
}

// ─── Tandas (D17) ───

export type TandaPlan = { lote_id: string; items: ItemSeleccion[] };

const nuevoIdPorDefecto = (): string => crypto.randomUUID();

/** Reparte la selección en tandas de a `MAX_FILAS_LOTE` SIN partir un GM (`trocear`) y le da a cada una su `lote_id` (D10). */
export function planearTandas(items: readonly ItemSeleccion[], nuevoId: () => string = nuevoIdPorDefecto, max: number = MAX_FILAS_LOTE): { tandas: TandaPlan[]; gm_partidos: string[] } {
  const r = trocear(items, (i) => i.gm_clave, max);
  return { tandas: r.tandas.map((t) => ({ lote_id: nuevoId(), items: t })), gm_partidos: r.gm_partidos };
}

export type ArgsCuerpoLote = {
  tanda: TandaPlan;
  confirmacionId: string;
  tipo: "aprobar" | "reaprobar";
  anio: number;
  simular: boolean;
  huellaSimulacion?: string;
  revisionConfirmada: boolean;
  nota?: string;
  filtro?: FiltroLote;
};

/** El cuerpo de `POST …/lotes` de una tanda (`loteSchema`). Sin `nota` ni `filtro` si no hay. */
export function cuerpoLote(a: ArgsCuerpoLote): LoteCuerpo {
  const c: LoteCuerpo = {
    lote_id: a.tanda.lote_id,
    confirmacion_id: a.confirmacionId,
    tipo: a.tipo,
    anio: a.anio,
    simular: a.simular,
    revision_confirmada: a.revisionConfirmada,
    filas: a.tanda.items.map((i) => i.item),
  };
  if (a.huellaSimulacion !== undefined) c.huella_simulacion = a.huellaSimulacion;
  const nota = a.nota?.trim();
  if (nota) c.nota = nota;
  if (a.filtro !== undefined) c.filtro = a.filtro;
  return c;
}

// ─── Resultados combinados (varias tandas) ───

export type ResultadoCombinado = {
  filas: ResultadoFilaLoteApi[];
  totales: TotalesLoteApi;
  efecto_gm: EfectoGMApi[];
  mayores_unidades: ResultadoFilaLoteApi[];
  mayores_brechas: ResultadoFilaLoteApi[];
  crecimientos_a_reaprobar: CrecimientoAReaprobarApi[];
  revision_requerida: boolean;
  pendientes_cierre: PendientesCierreApi | null;
  tandas: number;
};

/**
 * Junta los resultados de las tandas de una confirmación (simuladas o aplicadas) en uno solo para mostrarlo. Cada GM está en una sola tanda (D17), así
 * que el efecto por GM se concatena. Las 10 mayores se recalculan sobre todas las filas aplicadas, que da lo mismo que unir las de cada tanda.
 */
export function combinarResultados(rs: readonly ResultadoLoteApi[]): ResultadoCombinado {
  const filas = rs.flatMap((r) => r.filas);
  const totales: TotalesLoteApi = { pedidas: 0, aplicadas: 0, rechazadas: 0, unidades: 0, por_fuente: { ia: { filas: 0, unidades: 0 }, metodo: { filas: 0, unidades: 0 } } };
  for (const r of rs) {
    totales.pedidas += r.totales.pedidas;
    totales.aplicadas += r.totales.aplicadas;
    totales.rechazadas += r.totales.rechazadas;
    totales.unidades += r.totales.unidades;
    for (const k of ["ia", "metodo"] as const) {
      totales.por_fuente[k].filas += r.totales.por_fuente[k]?.filas ?? 0;
      totales.por_fuente[k].unidades += r.totales.por_fuente[k]?.unidades ?? 0;
    }
  }
  const aplicadas = filas.filter((f) => f.resultado === "aplicada");
  const mayores_unidades = [...aplicadas].sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, MAX_MAYORES);
  const mayores_brechas = aplicadas
    .filter((f) => f.brecha_u !== null)
    .sort((a, b) => Math.abs(b.brecha_u ?? 0) - Math.abs(a.brecha_u ?? 0))
    .slice(0, MAX_MAYORES);
  const vistos = new Set<string>();
  const crecimientos: CrecimientoAReaprobarApi[] = [];
  for (const c of rs.flatMap((r) => r.crecimientos_a_reaprobar)) {
    if (vistos.has(c.gm_clave)) continue;
    vistos.add(c.gm_clave);
    crecimientos.push(c);
  }
  return {
    filas,
    totales,
    efecto_gm: rs.flatMap((r) => r.efecto_gm),
    mayores_unidades,
    mayores_brechas,
    crecimientos_a_reaprobar: crecimientos,
    revision_requerida: rs.some((r) => r.revision_requerida),
    pendientes_cierre: rs.length > 0 ? rs[rs.length - 1].pendientes_cierre : null,
    tandas: rs.length,
  };
}

/** §4.4: más de 100 filas pedidas o algún GM fuera de ±1 % (lo dice el servidor por tanda) → casilla obligatoria. */
export function exigeRevision(filasPedidas: number, combinado: Pick<ResultadoCombinado, "revision_requerida">): boolean {
  return filasPedidas > REVISION_OBLIGATORIA_DESDE || combinado.revision_requerida;
}

export const TEXTO_RECHAZO: Record<CodigoRechazoFila, string> = {
  ya_decidida: "Ya tiene una decisión.",
  no_bloquea_cierre: "No bloquea el cierre.",
  no_reaprobable: "No se aprobó en bloque (o alguien la decidió a mano después).",
  sin_cambio: "Su cifra de hoy ya es la aprobada.",
  fila_inactiva: "La fila ya no está activa (un recálculo la desactivó).",
  fila_no_encontrada: "La fila ya no existe.",
  propuesta_cambio: "La propuesta del método cambió desde que la viste.",
  ia_valor_cambio: "La cifra de la IA cambió desde que la viste.",
  ia_no_vigente: "La propuesta de IA ya no es la vigente del GM.",
  ia_desactualizada: "La propuesta de IA está desactualizada: regenera el GM.",
  ia_fila_ajena: "La cifra de IA no corresponde a esa fila.",
  fila_no_libre: "La fila ya no está libre (alguien la fijó).",
  ia_sin_valor: "La IA no dio cifra para esta fila.",
  sin_cifra_ia: "Libre sin cifra de la IA: decídela en Por línea o regenera el GM.",
  metodo_en_gm_con_ia: "Este GM tiene IA: sus filas se aprueban con la IA, no con el método.",
  confianza_baja: "Confianza baja o sin dato: se decide en Por línea.",
  grupo_rechazado: "Otra fila de su GM no pasó: la IA de un GM se aprueba entera o no se aprueba.",
  cambio_concurrente: "Otra persona cambió algo del GM mientras se aprobaba.",
  cambiada_despues: "Alguien la cambió después del lote: no se toca.",
  menor_que_vendido: "La cifra queda por debajo de lo ya vendido.",
};

export const textoRechazo = (c: CodigoRechazoFila | null | string): string => (c !== null && c in TEXTO_RECHAZO ? TEXTO_RECHAZO[c as CodigoRechazoFila] : c === null ? "—" : c.replace(/_/g, " "));

/** «Ya tiene una decisión.: 3 · …» agrupado: cuántas filas por motivo de rechazo, de más a menos. */
export function rechazosPorCodigo(filas: readonly ResultadoFilaLoteApi[]): { codigo: CodigoRechazoFila; filas: number }[] {
  const m = new Map<CodigoRechazoFila, number>();
  for (const f of filas) if (f.resultado === "rechazada" && f.codigo !== null) m.set(f.codigo, (m.get(f.codigo) ?? 0) + 1);
  return [...m.entries()].map(([codigo, filas]) => ({ codigo, filas })).sort((a, b) => b.filas - a.filas || a.codigo.localeCompare(b.codigo));
}

/** «212 aprobadas · 2 no aprobadas». */
export function textoResultadoAprobar(t: Pick<TotalesLoteApi, "aplicadas" | "rechazadas">, tipo: TipoLote = "aprobar"): string {
  const verbo = tipo === "revertir" ? "revertidas" : tipo === "reaprobar" ? "reaprobadas" : "aprobadas";
  const noVerbo = tipo === "revertir" ? "no revertidas" : tipo === "reaprobar" ? "no reaprobadas" : "no aprobadas";
  return `${formatearNumero(t.aplicadas)} ${verbo}${t.rechazadas > 0 ? ` · ${formatearNumero(t.rechazadas)} ${noVerbo}` : ""}`;
}

export const textoTanda = (actual: number, total: number): string => `tanda ${formatearNumero(actual)} de ${formatearNumero(total)}`;

/** Avisos de la confirmación (§4.4), de lo que se sabe en el navegador (la fuente de cada fila y el estado del GM). */
export function avisosDeConfirmacion(a: {
  filas: readonly FilaAprobacionApi[];
  gms: readonly GMAprobacionApi[];
  anioEnCurso: number;
  crecimientosAReaprobar: readonly CrecimientoAReaprobarApi[];
}): string[] {
  const avisos: string[] = [];
  const sinIa = a.filas.filter((f) => f.badge === "metodo_gm_sin_ia").length;
  if (sinIa > 0) avisos.push(`${plural(sinIa, "fila", "filas")} con método en GM sin IA.`);
  const datos = new Map(a.gms.map((g) => [g.gm_clave, g] as const));
  const movidos = new Set(a.filas.filter((f) => datos.get(f.gm_clave)?.estado_ia === "meta_movida").map((f) => f.gm_clave));
  for (const clave of [...movidos].sort()) {
    const g = datos.get(clave);
    if (g) avisos.push(`${nombreGm(g)} en meta movida: la meta cambió desde que la IA propuso.`);
  }
  if (a.crecimientosAReaprobar.length > 0) {
    avisos.push(
      `Este lote dejará ${a.crecimientosAReaprobar.length === 1 ? "1 GM" : `${a.crecimientosAReaprobar.length} GM`} con crecimientos que reaprobar: hasta reaprobarlos no se podrá aprobar ${a.anioEnCurso + 1} ni cerrar.`
    );
  }
  return avisos;
}

// ─── Errores de la API ───

export type AccionAprobacion = "recalcular" | "recargar" | "factores" | "crecimientos" | "solo_metodo" | "simular_de_nuevo" | "reintentar" | "marcar_revision" | null;

export type ErrorTraducido = { mensaje: string; detalleServidor: string | null; accion: AccionAprobacion };

type Regla = { mensaje: string; accion: AccionAprobacion };

const REGLAS_ERROR: Record<string, Regla> = {
  ia_no_disponible: { mensaje: "La IA no está disponible ahora (el servicio está apagado o falló). No se escribió nada. Puedes aprobar solo las filas de método.", accion: "solo_metodo" },
  capacidad_apagada: { mensaje: "La capacidad de distribución de la IA para el año siguiente está apagada. No se escribió nada. Puedes aprobar solo las filas de método.", accion: "solo_metodo" },
  corrida_en_curso: { mensaje: "Hay una corrida de IA en curso. Espera a que termine para aprobar con IA. No se escribió nada; mientras tanto puedes aprobar solo las filas de método.", accion: "solo_metodo" },
  calculo_en_curso: { mensaje: "La proyección se está calculando. Espera a que termine y actualiza la pantalla.", accion: "recargar" },
  datos_cambiaron: { mensaje: "Los datos cambiaron mientras revisabas (se publicó un mes o se recalculó). Nada se aprobó después de ese cambio: recalcula si hace falta y vuelve a simular.", accion: "recalcular" },
  proyeccion_desactualizada: { mensaje: "La proyección está desactualizada: recalcula antes de aprobar en bloque, para no fijar cifras que ya no se propondrían.", accion: "recalcular" },
  version_metodo: { mensaje: "La proyección se calculó con una versión anterior del método: recalcúlala antes de aprobar en bloque.", accion: "recalcular" },
  crecimientos_sin_aprobar: { mensaje: "Faltan crecimientos del año siguiente por aprobar (o reaprobar). Hasta entonces no se aprueba en bloque.", accion: "crecimientos" },
  sin_filas_aplicables: { mensaje: "Ninguna de las filas elegidas se puede aprobar ahora. Actualiza la pantalla para ver cómo están: puede que otra persona las haya decidido o que la propuesta haya cambiado.", accion: "recargar" },
  lote_ajeno: { mensaje: "Este identificador de lote ya se usó con otras filas. Actualiza la pantalla y confirma de nuevo.", accion: "recargar" },
  no_revertible: { mensaje: "Este lote no se puede revertir: una reversión no se revierte, o el lote no es de esta proyección.", accion: "recargar" },
  conflicto_reintentar: { mensaje: "Choque con otro cambio al escribir. Reintenta: se reenvía con el mismo lote, así que no se aprueba dos veces.", accion: "reintentar" },
  cerrada: { mensaje: "La proyección está cerrada: ya no admite aprobaciones.", accion: "recargar" },
  ya_cerrada: { mensaje: "La proyección está cerrada: ya no admite aprobaciones.", accion: "recargar" },
  proyeccion_cerrada: { mensaje: "La proyección está cerrada: ya no admite aprobaciones.", accion: "recargar" },
  archivada: { mensaje: "La proyección está archivada: es solo lectura.", accion: "recargar" },
  proyeccion_archivada: { mensaje: "La proyección está archivada: es solo lectura.", accion: "recargar" },
  simulacion_distinta: { mensaje: "El resultado cambió desde que lo simulaste (otra persona decidió filas o cambió la propuesta). No se escribió nada de esta tanda. Simula de nuevo y revisa.", accion: "simular_de_nuevo" },
  revision_requerida: { mensaje: "Marca «Revisé el resumen por GM» para poder aprobar este lote.", accion: "marcar_revision" },
};

/**
 * Traduce un error de la API a un mensaje claro y a la acción que corresponde. El mensaje del servidor NO se pierde: si dice otra cosa, va aparte como detalle.
 * Sin código conocido, el mensaje del servidor es el principal.
 */
export function traducirErrorAprobacion(e: ErrorAccion | string): ErrorTraducido {
  const err: ErrorAccion = typeof e === "string" ? { mensaje: e, codigo: null } : e;
  const codigo = err.codigo;
  let regla: Regla | undefined = codigo !== null ? REGLAS_ERROR[codigo] : undefined;
  if (!regla && codigo !== null && (CODIGOS_CIERRE_BLOQUEADO_NINO as readonly string[]).includes(codigo)) {
    regla = { mensaje: "Los factores del Niño impiden aprobar en bloque hasta que se resuelvan.", accion: "factores" };
  }
  if (!regla) return { mensaje: err.mensaje, detalleServidor: null, accion: null };
  const servidor = err.mensaje.trim();
  return { mensaje: regla.mensaje, detalleServidor: servidor !== "" && servidor !== regla.mensaje ? servidor : null, accion: regla.accion };
}

/** Los errores que reintentar tal cual no arregla: hay que releer y simular de nuevo. */
export const CODIGOS_RELEER = ["simulacion_distinta", "datos_cambiaron", "proyeccion_desactualizada", "version_metodo", "crecimientos_sin_aprobar", "lote_ajeno", "sin_filas_aplicables", "calculo_en_curso", "cerrada", "ya_cerrada", "proyeccion_cerrada", "archivada", "proyeccion_archivada", "no_revertible"];

// ─── Historial ───

export const ETIQUETA_TIPO_LOTE: Record<TipoLote, string> = { aprobar: "Aprobación", reaprobar: "Reaprobación", revertir: "Reversión" };
export const ETIQUETA_ESTADO_LOTE: Record<EstadoLote, string> = { vigente: "vigente", revertido_en_parte: "revertido en parte", revertido: "revertido" };
export const TONO_ESTADO_LOTE: Record<EstadoLote, "exito" | "alerta" | "neutro"> = { vigente: "exito", revertido_en_parte: "alerta", revertido: "neutro" };

/** `Método 16 (2 090 u) · IA 198 (46 120 u)` de lo que el lote escribió de verdad; vacío si no hay. */
export function textoPorFuente(r: ResumenLoteApi): string {
  const partes: string[] = [];
  for (const k of ["ia", "metodo", "revertir"] as const) {
    const f = r.por_fuente?.[k];
    if (f && f.filas > 0) partes.push(`${ETIQUETA_FUENTE_FILA_LOTE[k]} ${formatearNumero(f.filas)}${k === "revertir" ? "" : ` (${formatearNumero(f.unidades)} u)`}`);
  }
  return partes.join(" · ");
}

export function totalRechazadasLote(r: ResumenLoteApi): number {
  return Object.values(r.rechazadas ?? {}).reduce((s, n) => s + n, 0);
}

/** «ya decidida 2 · cambiada después 1». */
export function textoRechazadasLote(r: ResumenLoteApi): string {
  return Object.entries(r.rechazadas ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => `${c.replace(/_/g, " ")} ${formatearNumero(n)}`)
    .join(" · ");
}

/** Los lotes de una misma confirmación (las tandas), en el orden en que llegaron del servidor (más reciente primero). */
export function tandasDeConfirmacion(lotes: readonly LoteApi[], confirmacionId: string): LoteApi[] {
  return lotes.filter((l) => l.confirmacion_id === confirmacionId);
}

/** Lotes de una confirmación que se podrían revertir: aprobaciones o reaprobaciones que no están revertidas del todo. */
export function lotesRevertibles(lotes: readonly LoteApi[], confirmacionId: string): LoteApi[] {
  return tandasDeConfirmacion(lotes, confirmacionId).filter((l) => l.tipo !== "revertir" && l.estado !== "revertido");
}

export function puedeRevertirLote(l: Pick<LoteApi, "tipo" | "estado" | "resumen">, editable: boolean): boolean {
  return editable && l.tipo !== "revertir" && l.estado !== "revertido" && l.resumen.aplicadas > 0;
}

export const textoUsuarioLote = (l: Pick<LoteApi, "usuario_nombre">): string => l.usuario_nombre ?? "—";

/** El texto de la simulación de una reversión. */
export function textoSimulacionReversion(t: Pick<TotalesLoteApi, "aplicadas" | "rechazadas">): string {
  return `${plural(t.aplicadas, "fila vuelve", "filas vuelven")} a la propuesta${t.rechazadas > 0 ? ` · ${plural(t.rechazadas, "no se toca", "no se tocan")} (cambiadas después o inactivas)` : ""}`;
}
