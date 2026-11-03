import type { AvisoIa, EstadoMetaFila, EstadoPropuestaGM } from "@/lib/ia/tipos-api";
import { motivoRechazoDecision } from "@/lib/proyeccion/reglas";
import type { ItemLote } from "./esquemas";
import type {
  CodigoExclusion,
  CodigoRechazoFila,
  FilaAprobacionApi,
  FuenteAprobacion,
  FuenteFilaLote,
  ModoAprobacion,
  ResultadoFilaLoteApi,
} from "./tipos-api";

/**
 * Plan de un lote (ficha 07g, §3.3 puntos 5 y 6, D2, D4, D5, D7 y D9; R1, R3, R4, R5, R7, R23 y R24). Puro, sin I/O: el servicio le entrega los hechos
 * que leyó (registros, cifras de IA de hoy, estado de cada GM) y recibe, por ítem, si se aplica o por qué se rechaza, con lo que debe escribirse.
 *
 * No calcula la IA: `valor` de cada fila de IA es la cifra `A_f` de HOY que ya calculó `lecturaDelGM` de una sola foto (en `reaprobar`, con las filas
 * a reaprobar tratadas como libres, §3.5). Tampoco consulta la base: `motivo_cierre` es `filaBloqueaCierre(registro, umbral)` de `proyeccion/reglas`.
 */

// ─── Hechos de entrada ───

export type RegistroLectura = { id: string; updated_at: string };

/** El registro (`proyeccion_fila_anios`) del año del lote. `updated_at` en texto, con microsegundos, tal como lo leyó el servidor (nunca pasado por `Date`). */
export type RegistroPlan = {
  id: string;
  updated_at: string;
  activo: boolean;
  vendido: number;
  propuesto: number | null;
  decidido: number | null;
  /** % propio de la fila (`fija_pct` en 2027). */
  crecimiento_pct: number | null;
  /** No nulo = aprobado en bloque y nadie lo cambió después (D2). */
  decision_lote_id: string | null;
};

/** La fila de la propuesta de IA vigente de su GM, con la cifra de HOY. */
export type IaFilaPlan = {
  propuesta_fila_id: string;
  /** `libre_en_bloque` (§3.5) llega ya como `libre` cuando el servicio calcula para reaprobar. */
  estado_meta: EstadoMetaFila | "libre_en_bloque";
  /** `A_f` de hoy; `null` si no hay reparto. */
  valor: number | null;
  natural: number | null;
  confianza: "alta" | "media" | "baja" | null;
  avisos: readonly AvisoIa[];
};

export type FilaPlan = {
  fila_id: string;
  /** `proyeccion_filas.clave` (lo que guarda `proyeccion_lote_filas.fila_clave`). */
  clave: string;
  gm_clave: string;
  /** La fila (`proyeccion_filas.activo`). */
  activa: boolean;
  /** `tienda_id` nulo. */
  es_base: boolean;
  /** `null` si la fila no tiene registro de ese año. */
  registro: RegistroPlan | null;
  /** `filaBloqueaCierre(registro, umbral)`: por qué bloquea el cierre, o `null` si no. */
  motivo_cierre: "umbral" | "revision_cola_larga" | null;
  /** Cifra de IA de hoy; `null` si la fila no está en la propuesta vigente de su GM (o el GM no tiene IA). */
  ia: IaFilaPlan | null;
  /** Lotes de `Y`: los registros de tienda que B2 leyó para esta fila (van a `registros_lectura` de su grupo). */
  lectura: readonly RegistroLectura[];
};

/**
 * Qué fuente tiene un GM en 2027 (D4):
 * - `con_ia`: propuesta vigente `al_dia` o `meta_movida` con IA disponible y con cifras;
 * - `sin_ia`: IA apagada o no disponible, `sin_propuesta`, `sin_filas_libres`, `fallida`, `bloqueado_privacidad`, `sin_meta` o `fijadas_exceden_meta` →
 *   las filas se aprueban con el método y el badge «Método · GM sin IA»;
 * - `desactualizada`: no tiene fuente hasta regenerarlo.
 */
export type ModoIaGM = "con_ia" | "sin_ia" | "desactualizada";

export type GMPlan = {
  gm_clave: string;
  modo: ModoIaGM;
  /** La propuesta de IA vigente; `null` si no hay. */
  propuesta_gm_id: string | null;
  /** D7: todos los registros base activos de 2026 y 2027 del GM con su `updated_at` (`registros_lectura` del grupo IA). */
  lectura: readonly RegistroLectura[];
};

export function modoIaDeGM(a: {
  ia_disponible: boolean;
  estado: EstadoPropuestaGM | null;
  sin_meta: boolean;
  fijadas_exceden_meta: boolean;
}): ModoIaGM {
  if (!a.ia_disponible) return "sin_ia";
  if (a.estado === null || a.estado === "sin_propuesta" || a.estado === "sin_filas_libres" || a.estado === "fallida" || a.estado === "bloqueado_privacidad") return "sin_ia";
  if (a.sin_meta) return "sin_ia";
  if (a.estado === "desactualizada") return "desactualizada";
  if (a.fijadas_exceden_meta) return "sin_ia";
  return "con_ia";
}

/** Una fila de `ia_propuestas_filas` que citó un ítem: a qué fila y a qué propuesta de GM pertenece. */
export type PropuestaFilaRef = { fila_id: string | null; propuesta_gm_id: string };

// ─── D4 y D5 · Qué fuente admite una fila ───

/** D5. «Con cifra en la propuesta vigente de su GM»: hay un natural del modelo o una cifra repartida que el modelo respaldó. */
export function tieneCifraIa(ia: IaFilaPlan | null): boolean {
  if (ia === null) return false;
  if (ia.natural !== null) return true;
  return ia.valor !== null && !ia.avisos.includes("sin_propuesta_ia");
}

/** D5. Confianza baja o NULA (solo se consulta en filas de 2027 con cifra de IA: en 2026 y en un GM sin IA no aplica). */
export const confianzaExcluyente = (c: "alta" | "media" | "baja" | null): boolean => c === null || c === "baja";

/** D4. Una libre sin cifra de IA: fuera de la propuesta (libre nueva) o sin cifra del modelo. */
export const sinCifraIa = (ia: IaFilaPlan | null): boolean => ia === null || ia.avisos.includes("sin_propuesta_ia");

export const MOTIVOS_EXCLUSION: Readonly<Record<CodigoExclusion, string>> = {
  confianza_baja: "La IA no respalda esta cifra (confianza baja o sin dato): decídela en Por línea.",
  sin_cifra_ia: "La IA no dio cifra para esta fila: decídela en Por línea o regenera el género y mundo.",
  ia_desactualizada: "La propuesta de IA de este género y mundo está desactualizada: regenera el género y mundo.",
  ia_no_aceptable: "La IA no permite aprobar esta fila en bloque: decídela en Por línea.",
};

export type FuentePermitida = {
  fuente: FuenteAprobacion | null;
  badge: FilaAprobacionApi["badge"];
  excluida: CodigoExclusion | null;
  motivo: string | null;
  /** El código con que el `POST` rechaza un ítem que pide una fuente no permitida por esta exclusión (con `fuente = null`). */
  codigo_rechazo: CodigoRechazoFila | null;
};

const permitida = (fuente: FuenteAprobacion, badge: FilaAprobacionApi["badge"]): FuentePermitida => ({ fuente, badge, excluida: null, motivo: null, codigo_rechazo: null });
const excluida = (excl: CodigoExclusion, codigo: CodigoRechazoFila): FuentePermitida => ({ fuente: null, badge: null, excluida: excl, motivo: MOTIVOS_EXCLUSION[excl], codigo_rechazo: codigo });

/**
 * D3, D4 y D5. La fuente con que se puede aprobar UNA fila (la que sugiere el `GET` y la única que el `POST` acepta):
 * - 2026 (`Y`): siempre «Método»; la IA no propone el año en curso y la regla de confianza no aplica.
 * - 2027 (`Y+1`), GM sin IA: «Método · GM sin IA».
 * - 2027, GM desactualizado: sin fuente (`ia_desactualizada`).
 * - 2027, GM con IA: con cifra de IA y confianza baja o nula, sin fuente (`confianza_baja`, I4: ni «IA» ni «Método»); una fila con % propio usa el método
 *   (la IA no la reparte); una libre usa «IA», y sin cifra de IA queda fuera (`sin_cifra_ia`).
 */
export function fuentePermitida(f: FilaPlan, gm: GMPlan | undefined, anio: number, anioEnCurso: number): FuentePermitida {
  if (anio !== anioEnCurso + 1) return permitida("metodo", "metodo");
  if (!gm || gm.modo === "sin_ia") return permitida("metodo", "metodo_gm_sin_ia");
  if (gm.modo === "desactualizada") return excluida("ia_desactualizada", "ia_desactualizada");
  const fijaPct = (f.registro?.crecimiento_pct ?? null) !== null;
  if (!fijaPct && sinCifraIa(f.ia)) return excluida("sin_cifra_ia", "sin_cifra_ia");
  if (tieneCifraIa(f.ia) && confianzaExcluyente(f.ia?.confianza ?? null)) return excluida("confianza_baja", "confianza_baja");
  if (fijaPct) return permitida("metodo", "metodo");
  const ia = f.ia as IaFilaPlan;
  if (ia.estado_meta !== "libre") return excluida("ia_no_aceptable", "fila_no_libre");
  if (ia.valor === null) return excluida("ia_no_aceptable", "ia_sin_valor");
  return permitida("ia", "ia");
}

// ─── Resultado del plan ───

export type DecisionPlanificada = {
  /** `null` = volver a la propuesta (reversión). */
  decidido: number | null;
  origen: "propuesta" | "manual" | null;
  /** Solo «IA»: `ia_propuestas_filas.id`. */
  decision_ia_fila_id: string | null;
};

export type FilaPlanificada = {
  fila_id: string;
  anio: number;
  fila_clave: string;
  gm_clave: string;
  fuente: FuenteFilaLote;
  resultado: "aplicada" | "rechazada";
  codigo: CodigoRechazoFila | null;
  /** Lo que se escribe como `decidido` (`null` si se rechazó y en toda reversión). */
  valor: number | null;
  valor_esperado: number | null;
  valor_actual: number | null;
  decidido_anterior: number | null;
  /** Reaprobar y revertir: el `decidido` que debe tener el registro al escribir. */
  decidido_esperado: number | null;
  propuesta_fila_id: string | null;
  propuesta_gm_id: string | null;
  decision: DecisionPlanificada | null;
  registro_id: string | null;
  updated_at: string | null;
  /** Solo IA con natural: `valor − natural`. */
  brecha_u: number | null;
};

export type PlanLote = { filas: FilaPlanificada[] };

/** Proyección a la forma de la API. */
export function resultadoFilaApi(p: FilaPlanificada): ResultadoFilaLoteApi {
  return {
    fila_id: p.fila_id,
    anio: p.anio,
    gm_clave: p.gm_clave,
    fuente: p.fuente,
    resultado: p.resultado,
    codigo: p.codigo,
    valor: p.valor,
    valor_actual: p.valor_actual,
    brecha_u: p.brecha_u,
  };
}

// ─── Aprobar y reaprobar ───

export type EntradaPlan = {
  tipo: ModoAprobacion;
  anio: number;
  anioEnCurso: number;
  items: readonly ItemLote[];
  filas: ReadonlyMap<string, FilaPlan>;
  gms: ReadonlyMap<string, GMPlan>;
  /** `ia_propuestas_filas` que citan los ítems de IA. */
  propuestasFila: ReadonlyMap<string, PropuestaFilaRef>;
};

function planificarItem(item: ItemLote, e: EntradaPlan): FilaPlanificada {
  const f = e.filas.get(item.fila_id);
  const reg = f?.registro ?? null;
  const base: FilaPlanificada = {
    fila_id: item.fila_id,
    anio: e.anio,
    fila_clave: f?.clave ?? item.fila_id,
    gm_clave: f?.gm_clave ?? "",
    fuente: item.fuente,
    resultado: "rechazada",
    codigo: null,
    valor: null,
    valor_esperado: item.valor_esperado,
    valor_actual: null,
    decidido_anterior: reg?.decidido ?? null,
    decidido_esperado: item.decidido_esperado ?? null,
    propuesta_fila_id: item.propuesta_fila_id ?? null,
    propuesta_gm_id: null,
    decision: null,
    registro_id: reg?.id ?? null,
    updated_at: reg?.updated_at ?? null,
    brecha_u: null,
  };
  const rechazo = (codigo: CodigoRechazoFila, valorActual: number | null = null): FilaPlanificada => ({ ...base, codigo, valor_actual: valorActual });

  if (!f || !reg) return rechazo("fila_no_encontrada");
  if (!f.activa || !reg.activo) return rechazo("fila_inactiva");
  if (!f.es_base) return rechazo(e.tipo === "aprobar" ? "no_bloquea_cierre" : "no_reaprobable");

  // D2 · elegibilidad. Aprobar solo escribe lo sin decidir; reaprobar, solo lo aprobado en bloque que nadie cambió.
  if (e.tipo === "aprobar") {
    if (reg.decidido !== null) return rechazo("ya_decidida", reg.decidido);
    if (f.motivo_cierre === null) return rechazo("no_bloquea_cierre");
  } else {
    if (reg.decision_lote_id === null || reg.decidido === null) return rechazo("no_reaprobable", reg.decidido);
    if (item.decidido_esperado !== reg.decidido) return rechazo("cambiada_despues", reg.decidido);
  }

  const gm = e.gms.get(f.gm_clave);
  const perm = fuentePermitida(f, gm, e.anio, e.anioEnCurso);
  let valorHoy: number | null;
  let decision: DecisionPlanificada;
  let brecha: number | null = null;
  let propuestaGm: string | null = null;

  if (item.fuente === "ia") {
    // Las comprobaciones de «Aceptar IA» (07e §3.1), en su orden, más D4 y D5.
    const pf = item.propuesta_fila_id === undefined ? undefined : e.propuestasFila.get(item.propuesta_fila_id);
    if (e.anio !== e.anioEnCurso + 1 || !pf) return rechazo("ia_no_vigente");
    if (pf.fila_id !== f.fila_id) return rechazo("ia_fila_ajena");
    if (!gm || gm.modo === "sin_ia" || gm.propuesta_gm_id === null || pf.propuesta_gm_id !== gm.propuesta_gm_id) return rechazo("ia_no_vigente");
    if (gm.modo === "desactualizada") return rechazo("ia_desactualizada");
    if (f.ia === null || f.ia.propuesta_fila_id !== item.propuesta_fila_id) return rechazo("ia_fila_ajena");
    if (perm.fuente === null) return rechazo(perm.codigo_rechazo ?? "ia_sin_valor");
    if (perm.fuente === "metodo") return rechazo("fila_no_libre");
    valorHoy = f.ia.valor as number;
    if (valorHoy !== item.valor_esperado) return rechazo("ia_valor_cambio", valorHoy);
    decision = { decidido: valorHoy, origen: "manual", decision_ia_fila_id: item.propuesta_fila_id as string };
    brecha = f.ia.natural === null ? null : valorHoy - f.ia.natural;
    propuestaGm = gm.propuesta_gm_id;
  } else {
    if (perm.fuente === null) return rechazo(perm.codigo_rechazo ?? "sin_cifra_ia");
    if (perm.fuente === "ia") return rechazo("metodo_en_gm_con_ia");
    // R5: `decidido = propuesto`, `origen = propuesta`, sin traza de IA.
    if (reg.propuesto === null) return rechazo("no_bloquea_cierre");
    valorHoy = reg.propuesto;
    if (valorHoy !== item.valor_esperado) return rechazo("propuesta_cambio", valorHoy);
    decision = { decidido: valorHoy, origen: "propuesta", decision_ia_fila_id: null };
  }

  if (e.tipo === "reaprobar" && valorHoy === reg.decidido) return rechazo("sin_cambio", valorHoy);

  const r = motivoRechazoDecision({
    estado: "en_trabajo",
    calculandoDesde: null,
    ahora: "",
    filaActiva: true,
    anio: e.anio,
    anioEnCurso: e.anioEnCurso,
    vendido: reg.vendido,
    propuesto: reg.propuesto,
    decidido: decision.decidido,
    origen: decision.origen ?? "propuesta",
  });
  if (r) return rechazo(r.codigo === "menor_que_vendido" ? "menor_que_vendido" : r.codigo === "fila_inactiva" ? "fila_inactiva" : "no_bloquea_cierre");

  return { ...base, resultado: "aplicada", valor: decision.decidido, decision, brecha_u: brecha, propuesta_gm_id: propuestaGm };
}

/**
 * Planifica un lote de `aprobar` o `reaprobar`: por ítem, `aplicada` o el código del rechazo (D2, D4, D5, R1, R5, R23, R24) y, al final, D7:
 * **la IA de un GM se aprueba entera o no se aprueba**: si algún ítem de IA de un GM no pasa, los que sí pasaban quedan `grupo_rechazado` (R4, ejemplos C y L).
 * Un ítem `sin_cambio` no cuenta como rechazo del grupo: su cifra ya es la de hoy y no cambia lo que suman las demás. Devuelve un resultado por ítem, en el
 * orden del cuerpo.
 */
export function planificarLote(e: EntradaPlan): PlanLote {
  const filas = e.items.map((it) => planificarItem(it, e));
  const malos = new Set<string>();
  for (const p of filas) if (p.fuente === "ia" && p.resultado === "rechazada" && p.codigo !== "sin_cambio") malos.add(p.gm_clave);
  const resultado = filas.map((p) => {
    if (p.fuente !== "ia" || p.resultado !== "aplicada" || !malos.has(p.gm_clave)) return p;
    return { ...p, resultado: "rechazada" as const, codigo: "grupo_rechazado" as const, valor: null, decision: null, brecha_u: null };
  });
  return { filas: resultado };
}

// ─── Revertir (D12, R11) ───

/** Una fila aplicada del lote que se revierte (`proyeccion_lote_filas` con `resultado = aplicada`). */
export type FilaLoteARevertir = { fila_id: string | null; fila_clave: string; gm_clave: string; anio: number };

export type EntradaReversion = {
  /** El lote que se revierte (su id es el `decision_lote_id` que deben conservar los registros). */
  loteId: string;
  anio: number;
  filasLote: readonly FilaLoteARevertir[];
  /** `fila_id` marcados (`revertirSchema.filas`); `undefined` = el lote entero. */
  seleccion?: readonly string[];
  /** Estado de hoy de las filas (con su registro del año del lote). */
  filas: ReadonlyMap<string, FilaPlan>;
};

/**
 * R11. Por cada fila aplicada del lote (o las marcadas): solo se devuelve a la propuesta el registro cuyo `decision_lote_id` sigue siendo el del lote; el que
 * alguien cambió después queda `cambiada_despues`, el de una fila que un recálculo desactivó `fila_inactiva` y una fila marcada que no es del lote
 * `fila_no_encontrada`. Cada fila es su propio grupo en la función SQL (la reversión de una no depende de las demás). Las que se revierten llevan
 * `valor = null` y `decidido_anterior` = la cifra que se quita.
 */
export function planificarReversion(e: EntradaReversion): PlanLote {
  const delLote = new Map<string, FilaLoteARevertir>();
  for (const f of e.filasLote) if (f.fila_id !== null) delLote.set(f.fila_id, f);
  const ids = e.seleccion ?? [...delLote.keys()];
  const filas: FilaPlanificada[] = ids.map((id) => {
    const fl = delLote.get(id);
    const f = e.filas.get(id);
    const reg = f?.registro ?? null;
    const base: FilaPlanificada = {
      fila_id: id,
      anio: e.anio,
      fila_clave: fl?.fila_clave ?? f?.clave ?? id,
      gm_clave: fl?.gm_clave ?? f?.gm_clave ?? "",
      fuente: "revertir",
      resultado: "rechazada",
      codigo: null,
      valor: null,
      valor_esperado: null,
      valor_actual: null,
      decidido_anterior: reg?.decidido ?? null,
      decidido_esperado: null,
      propuesta_fila_id: null,
      propuesta_gm_id: null,
      decision: null,
      registro_id: reg?.id ?? null,
      updated_at: reg?.updated_at ?? null,
      brecha_u: null,
    };
    const rechazo = (codigo: CodigoRechazoFila, valorActual: number | null = null): FilaPlanificada => ({ ...base, codigo, valor_actual: valorActual });
    if (!fl || !f || !reg) return rechazo("fila_no_encontrada");
    if (!f.activa || !reg.activo) return rechazo("fila_inactiva");
    if (reg.decision_lote_id !== e.loteId || reg.decidido === null) return rechazo("cambiada_despues", reg.decidido);
    return {
      ...base,
      resultado: "aplicada",
      decidido_esperado: reg.decidido,
      decision: { decidido: null, origen: null, decision_ia_fila_id: null },
    };
  });
  return { filas };
}

// ─── Grupos de la función SQL (§2.5) ───

export type RegistroAEscribir = {
  id: string;
  /** Texto con microsegundos tal como lo leyó el servidor. */
  updated_at_esperado: string;
  /** `true` = el registro de la decisión; `false` = el de `Y+1` que B2 reescribe (sin columnas de decisión). */
  objetivo: boolean;
  set: Readonly<Record<string, unknown>>;
};

export type FilaGrupoLote = {
  fila_id: string;
  fila_clave: string;
  anio: number;
  fuente: FuenteFilaLote;
  valor?: number | null;
  valor_esperado?: number | null;
  valor_actual?: number | null;
  decidido_anterior?: number | null;
  decidido_esperado?: number | null;
  propuesta_fila_id?: string;
  /** Las filas que TypeScript ya rechazó viajan con `rechazo` y sin `registros`. */
  rechazo?: CodigoRechazoFila;
  registros?: RegistroAEscribir[];
};

export type GrupoLote = {
  tipo: "ia" | "metodo" | "revertir";
  gm_clave: string;
  propuesta_gm_id?: string;
  registros_lectura: { id: string; updated_at_esperado: string }[];
  filas: FilaGrupoLote[];
};

const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function filaDeGrupo(p: FilaPlanificada, registros: readonly RegistroAEscribir[] | undefined): FilaGrupoLote {
  const fila: FilaGrupoLote = { fila_id: p.fila_id, fila_clave: p.fila_clave, anio: p.anio, fuente: p.fuente };
  if (p.valor_esperado !== null) fila.valor_esperado = p.valor_esperado;
  if (p.valor_actual !== null) fila.valor_actual = p.valor_actual;
  if (p.decidido_anterior !== null) fila.decidido_anterior = p.decidido_anterior;
  if (p.decidido_esperado !== null) fila.decidido_esperado = p.decidido_esperado;
  if (p.propuesta_fila_id !== null) fila.propuesta_fila_id = p.propuesta_fila_id;
  if (p.resultado === "rechazada") {
    fila.rechazo = p.codigo ?? "cambio_concurrente";
    return fila;
  }
  if (p.valor !== null) fila.valor = p.valor;
  fila.registros = [...(registros ?? [])].sort((a, b) => Number(b.objetivo) - Number(a.objetivo) || porTexto(a.id, b.id));
  return fila;
}

/**
 * Agrupa lo planificado como lo espera `aplicar_lote_proyeccion` (§2.4 y §2.5):
 * - un grupo `ia` por GM con todos sus ítems de IA (D7: entero o nada), con `propuesta_gm_id` y `registros_lectura` = todos los registros base del GM;
 * - un grupo `metodo` (o `revertir`) POR FILA: cada fila se escribe entera o no se escribe, sin arrastrar a las demás. `registros_lectura` = los registros
 *   de tienda que B2 leyó para esa fila.
 * `registros` trae, por `fila_id#anio`, lo que se escribe de cada fila aplicada (la lista y los `set` los arma el servicio con `payloadAnioDecision`). Orden estable:
 * primero los grupos `ia`, después los demás; dentro de cada clase, por su primera `fila_id`; las filas por `(fila_id, anio)`, el mismo orden que usa la función para bloquear sin interbloquearse.
 */
export function armarGrupos(a: {
  plan: PlanLote;
  filas: ReadonlyMap<string, FilaPlan>;
  gms: ReadonlyMap<string, GMPlan>;
  registros: ReadonlyMap<string, readonly RegistroAEscribir[]>;
}): GrupoLote[] {
  const lectura = (xs: readonly RegistroLectura[]) => [...xs].sort((x, y) => porTexto(x.id, y.id)).map((r) => ({ id: r.id, updated_at_esperado: r.updated_at }));
  const grupos: GrupoLote[] = [];
  const ia = new Map<string, FilaPlanificada[]>();
  for (const p of a.plan.filas) {
    if (p.fuente === "ia") {
      ia.set(p.gm_clave, [...(ia.get(p.gm_clave) ?? []), p]);
      continue;
    }
    const f = a.filas.get(p.fila_id);
    grupos.push({
      tipo: p.fuente,
      gm_clave: p.gm_clave,
      registros_lectura: lectura(p.resultado === "aplicada" ? (f?.lectura ?? []) : []),
      filas: [filaDeGrupo(p, a.registros.get(`${p.fila_id}#${p.anio}`))],
    });
  }
  for (const [gm, items] of ia) {
    const g = a.gms.get(gm);
    const algunaAplicada = items.some((p) => p.resultado === "aplicada");
    const propuesta = items.find((p) => p.propuesta_gm_id !== null)?.propuesta_gm_id ?? g?.propuesta_gm_id ?? null;
    const ordenadas = [...items].sort((x, y) => porTexto(x.fila_id, y.fila_id) || x.anio - y.anio);
    grupos.push({
      tipo: "ia",
      gm_clave: gm,
      ...(propuesta !== null ? { propuesta_gm_id: propuesta } : {}),
      registros_lectura: lectura(algunaAplicada ? (g?.lectura ?? []) : []),
      filas: ordenadas.map((p) => filaDeGrupo(p, a.registros.get(`${p.fila_id}#${p.anio}`))),
    });
  }
  // Defensa (H1): los grupos `ia` van ANTES que los `metodo`, de modo que un grupo de método no escriba antes de que la función haya comprobado la lectura del grupo de IA.
  // La función SQL ya verifica todos los `registros_lectura` contra el estado del inicio del lote, así que el orden no cambia el resultado; esto solo lo hace estable y legible.
  const rango = (g: GrupoLote): number => (g.tipo === "ia" ? 0 : 1);
  return grupos.sort((x, y) => rango(x) - rango(y) || porTexto(x.filas[0].fila_id, y.filas[0].fila_id) || porTexto(x.tipo, y.tipo));
}
