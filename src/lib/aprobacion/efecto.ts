import { faltantesDeCierre, type ExigidosCierre, type GmConNino, type VigenteCrecimiento } from "@/lib/crecimientos/vigentes";
import type { FilaParaNino } from "@/lib/proyeccion/calculo";
import { aplicarDecision, registroDe, type ContextoModelo } from "@/lib/proyeccion/decision";
import type { FilaParaMeta } from "@/lib/proyeccion/meta-gm";
import type { FilaModelo, RegistroModelo } from "@/lib/proyeccion/tipos";
import { desvioPct, revisionRequerida } from "./reglas";
import { resultadoFilaApi, type FilaPlanificada } from "./plan";
import {
  MAX_MAYORES,
  type CrecimientoAReaprobarApi,
  type EfectoGMApi,
  type LoteApi,
  type PendientesCierreApi,
  type ResultadoFilaLoteApi,
  type ResultadoLoteApi,
  type TotalesLoteApi,
} from "./tipos-api";

/**
 * Efecto de un lote (ficha 07g, §3.3 puntos 6 y 7, D15, D18; R3, R6 y R27). Puro, sin I/O: aplica las decisiones en memoria con `aplicarDecision` (en `Y`,
 * B2 recalcula `Y+1`), calcula por GM el total, el crecimiento implícito, la meta y el desvío antes y después, y arma el resultado que ve la confirmación.
 * Importa solo tipos de `proyeccion/calculo` (que usa `node:crypto`): este archivo es de servidor.
 */

const porTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ─── Aplicar las decisiones en memoria (B2 incluido) ───

/** Una fila base con las filas de tienda de su mismo GML-AM (lo que `aplicarDecision` necesita para B2). */
export type GrupoMemoria = { fila: FilaModelo; tiendas: readonly FilaModelo[] };

export type DecisionMemoria = {
  fila_id: string;
  anio: number;
  /** `null` = volver a la propuesta (reversión). */
  decidido: number | null;
  origen: "propuesta" | "manual";
  nota?: string | null;
  decidido_por_nombre?: string | null;
  /** El sello del lote: todas las filas del lote llevan el mismo. */
  decidido_at?: string | null;
};

/**
 * §3.3 punto 6. `aplicarDecision` por fila con un `ctx` compartido. Devuelve `fila_id → fila base resultante` (la de entrada sin tocar si no hay
 * decisión). En una decisión de `Y`, `aplicarDecision` recalcula el `Y+1` de la misma fila; una decisión de `Y+1` solo cambia su registro.
 */
export function aplicarEnMemoria(grupos: ReadonlyMap<string, GrupoMemoria>, decisiones: readonly DecisionMemoria[], ctx: ContextoModelo): Map<string, FilaModelo> {
  const salida = new Map<string, FilaModelo>();
  for (const [id, g] of grupos) salida.set(id, g.fila);
  for (const d of decisiones) {
    const g = grupos.get(d.fila_id);
    const actual = salida.get(d.fila_id);
    if (!g || !actual) continue;
    salida.set(
      d.fila_id,
      aplicarDecision(actual, g.tiendas, d.anio, { decidido: d.decidido, origen: d.origen, nota: d.nota ?? null, decidido_por_nombre: d.decidido_por_nombre ?? null, decidido_at: d.decidido_at ?? null }, ctx)
    );
  }
  return salida;
}

/**
 * Qué registros hay que escribir de una fila ya decidida en memoria: el de la decisión (`objetivo`) y, si el lote es de `Y`, también el de `Y+1`
 * que B2 recalculó (sin columnas de decisión, §3.6).
 */
export function registrosAEscribir(despues: FilaModelo, anioLote: number, anioEnCurso: number): { anio: number; registro: RegistroModelo; objetivo: boolean }[] {
  const salida: { anio: number; registro: RegistroModelo; objetivo: boolean }[] = [];
  const objetivo = registroDe(despues, anioLote);
  if (objetivo) salida.push({ anio: anioLote, registro: objetivo, objetivo: true });
  if (anioLote === anioEnCurso && despues.tienda_id === null) {
    const siguiente = registroDe(despues, anioEnCurso + 1);
    if (siguiente) salida.push({ anio: anioEnCurso + 1, registro: siguiente, objetivo: false });
  }
  return salida;
}

/** Una fila base de `Y+1` como la ve `metaDeGM`: `B`, `B'`, `P^M` y el % propio. `id` es el que se use para la fila (el `fila_id` o la clave). */
export function filaParaMeta(f: FilaModelo, anioSiguiente: number, id: string): FilaParaMeta | null {
  const r = registroDe(f, anioSiguiente);
  if (!r || f.tienda_id !== null) return null;
  return { fila_id: id, propuesto: r.propuesto, base: r.base_siguiente ?? null, base_corregida: r.base_normalizada ?? null, crecimiento_pct: r.crecimiento_pct, vigente: r.vigente };
}

/** Lo que `ninoPorGM` necesita de una fila base ya decidida en memoria (la misma lectura que `ninoDeFilas` hace de la base). */
export function filaParaNino(f: FilaModelo, anioEnCurso: number): FilaParaNino | null {
  if (f.tienda_id !== null || !f.activo) return null;
  const sig = registroDe(f, anioEnCurso + 1);
  if (!sig) return null;
  return { gml_id: f.gml_id, base_siguiente: sig.base_siguiente ?? null, base_normalizada: sig.base_normalizada ?? null, vendido: registroDe(f, anioEnCurso)?.vendido ?? 0 };
}

// ─── Indicadores de un GM ───

export type IndicadoresGM = {
  /** `Σ vigente` de las filas con base. */
  total: number;
  /** `Σ B^s`; `null` sin filas con base o con suma 0. */
  base_total: number | null;
  /** `total ÷ Σ B^s − 1` en %. */
  crecimiento_pct: number | null;
  desvio_u: number | null;
  desvio_pct: number | null;
};

/**
 * `crecimiento_implicito_pct` = `Σ vigente ÷ Σ B^s − 1` (§3.2): en 2027, con `B^s` = `B'` o `B` según la `sobre_base` de la meta del GM; en 2026, con
 * `B^s` = lo vendido en 2025 por las mismas tiendas (lo calcula quien llama). Una fila sin `B^s` (`null`) está fuera de base: no suma ni al total ni a la base,
 * igual que `metaDeGM` deja fuera a la fila sin propuesta (si no, el desvío mediría algo que nunca sumó a la meta).
 * `desvio = total − meta` (solo con meta).
 */
export function indicadoresGM(a: { filas: readonly { vigente: number | null; base_s: number | null }[]; meta: number | null }): IndicadoresGM {
  let total = 0;
  let base = 0;
  let conBase = 0;
  for (const f of a.filas) {
    if (f.base_s === null) continue;
    conBase += 1;
    base += f.base_s;
    total += f.vigente ?? 0;
  }
  const baseTotal = conBase > 0 && base > 0 ? base : null;
  const desvio = a.meta === null ? null : total - a.meta;
  return {
    total,
    base_total: baseTotal,
    crecimiento_pct: baseTotal === null ? null : (total / baseTotal - 1) * 100,
    desvio_u: desvio,
    desvio_pct: desvioPct(desvio, a.meta),
  };
}

export type FilaEfecto = { fila_id: string; vigente_antes: number | null; base_s: number | null; libre_antes: boolean };
/**
 * `meta_antes` y `meta_despues` son la meta de 2027 del GM (`Σ P^GM`, `null` sin `g`): iguales en un lote de `Y+1`; en uno de `Y` pueden moverse por B2 (R6).
 * `filas`: todas las filas base del GM que cuentan (con su `B^s`), no solo las del lote.
 */
export type GMEfectoEntrada = { gm_clave: string; meta_antes: number | null; meta_despues: number | null; filas: readonly FilaEfecto[] };
export type CambioFila = { vigente_despues: number | null; libre_despues: boolean };

/**
 * §3.3 punto 7. Total, crecimiento implícito, meta y desvío por GM, antes y después. El desvío solo se informa en lotes de `Y+1` (`null` en `Y`, donde la
 * meta de 2027 no se compara con el total de 2026). `cambios` es `fila_id → cómo queda` para las filas aplicadas: aprobar y reaprobar fijan `vigente = valor`
 * y la dejan decidida; revertir la devuelve a su propuesta y la deja libre. El resto de las filas no cambia. Ordenado por `gm_clave`.
 */
export function calcularEfectoGM(a: { anioSiguiente: boolean; gms: readonly GMEfectoEntrada[]; cambios: ReadonlyMap<string, CambioFila> }): EfectoGMApi[] {
  return [...a.gms]
    .sort((x, y) => porTexto(x.gm_clave, y.gm_clave))
    .map((g) => {
      const antes = indicadoresGM({ filas: g.filas.map((f) => ({ vigente: f.vigente_antes, base_s: f.base_s })), meta: a.anioSiguiente ? g.meta_antes : null });
      const despues = indicadoresGM({
        filas: g.filas.map((f) => ({ vigente: a.cambios.has(f.fila_id) ? (a.cambios.get(f.fila_id) as CambioFila).vigente_despues : f.vigente_antes, base_s: f.base_s })),
        meta: a.anioSiguiente ? g.meta_despues : null,
      });
      return {
        gm_clave: g.gm_clave,
        total_antes: antes.total,
        total_despues: despues.total,
        crecimiento_implicito_antes_pct: antes.crecimiento_pct,
        crecimiento_implicito_despues_pct: despues.crecimiento_pct,
        meta_antes: g.meta_antes,
        meta_despues: g.meta_despues,
        desvio_antes_u: antes.desvio_u,
        desvio_despues_u: despues.desvio_u,
        libres_antes: g.filas.filter((f) => f.libre_antes).length,
        libres_despues: g.filas.filter((f) => (a.cambios.get(f.fila_id)?.libre_despues ?? f.libre_antes)).length,
      };
    });
}

/** Los `cambios` de `calcularEfectoGM` a partir del plan: las filas aplicadas. `propuestas`: `fila_id → propuesto` para las reversiones. */
export function cambiosDePlan(filas: readonly FilaPlanificada[], propuestas: ReadonlyMap<string, number | null> = new Map()): Map<string, CambioFila> {
  const m = new Map<string, CambioFila>();
  for (const p of filas) {
    if (p.resultado !== "aplicada") continue;
    if (p.fuente === "revertir") m.set(p.fila_id, { vigente_despues: propuestas.get(p.fila_id) ?? null, libre_despues: true });
    else m.set(p.fila_id, { vigente_despues: p.valor, libre_despues: false });
  }
  return m;
}

// ─── Totales y las 10 mayores ───

export function totalesDeLote(filas: readonly FilaPlanificada[]): TotalesLoteApi {
  const t: TotalesLoteApi = { pedidas: filas.length, aplicadas: 0, rechazadas: 0, unidades: 0, por_fuente: { ia: { filas: 0, unidades: 0 }, metodo: { filas: 0, unidades: 0 } } };
  for (const p of filas) {
    if (p.resultado === "rechazada") {
      t.rechazadas += 1;
      continue;
    }
    t.aplicadas += 1;
    if (p.fuente === "revertir") continue;
    t.unidades += p.valor ?? 0;
    t.por_fuente[p.fuente].filas += 1;
    t.por_fuente[p.fuente].unidades += p.valor ?? 0;
  }
  return t;
}

const orden = (a: FilaPlanificada, b: FilaPlanificada): number => porTexto(a.gm_clave, b.gm_clave) || porTexto(a.fila_id, b.fila_id);

/** §4.4. Las `n` filas aplicadas con más unidades (la cifra que se escribe o, en una reversión, la que se quita); empate por `gm_clave` y `fila_id`. */
export function mayoresUnidades(filas: readonly FilaPlanificada[], n = MAX_MAYORES): ResultadoFilaLoteApi[] {
  const u = (p: FilaPlanificada) => p.valor ?? p.decidido_anterior ?? 0;
  return filas
    .filter((p) => p.resultado === "aplicada")
    .sort((a, b) => u(b) - u(a) || orden(a, b))
    .slice(0, n)
    .map(resultadoFilaApi);
}

/** §4.4. Las `n` filas aplicadas con mayor `|brecha_u|` (solo las de IA con natural); empate por `gm_clave` y `fila_id`. */
export function mayoresBrechas(filas: readonly FilaPlanificada[], n = MAX_MAYORES): ResultadoFilaLoteApi[] {
  return filas
    .filter((p) => p.resultado === "aplicada" && p.brecha_u !== null)
    .sort((a, b) => Math.abs(b.brecha_u as number) - Math.abs(a.brecha_u as number) || orden(a, b))
    .slice(0, n)
    .map(resultadoFilaApi);
}

// ─── D15 · Crecimientos que un lote de Y deja por reaprobar ───

export type DatosGMNombre = { gm_clave: string; genero: string; mundo: string };

/**
 * R27 y D15. `ninoPorGM` sobre las filas DESPUÉS del lote (`filaParaNino` de cada fila decidida en memoria) dice qué GM quedan con Niño material; si de ellos
 * hay uno con crecimiento vigente `bruta`, `faltantesDeCierre` lo pone en `reaprobar`. Como D14 ya impide empezar un lote con crecimientos sin aprobar, todo lo
 * que sale aquí lo crea el lote. `nombres`: por clave de `ninoPorGM` (`genero_id|mundo_id` o `resto`). Ordenado por clave.
 */
export function crecimientosAReaprobar(a: {
  ninoDespues: { gm_con_nino: readonly string[]; gm_correccion_nino_pct: Readonly<Record<string, number>> };
  exigidos: ExigidosCierre;
  vigentes: readonly VigenteCrecimiento[];
  anioSiguiente: number;
  nombres: ReadonlyMap<string, DatosGMNombre>;
}): CrecimientoAReaprobarApi[] {
  const conNino: GmConNino = new Map(
    a.ninoDespues.gm_con_nino.map((clave) => {
      const d = a.nombres.get(clave);
      return [clave, { nombre: d ? `${d.genero} · ${d.mundo}` : clave === "resto" ? "Resto" : clave, correccion_pct: a.ninoDespues.gm_correccion_nino_pct[clave] ?? 0 }];
    })
  );
  const { reaprobar } = faltantesDeCierre(a.exigidos, a.vigentes, a.anioSiguiente, conNino);
  return reaprobar
    .map((r) => {
      const d = a.nombres.get(r.clave);
      return { gm_clave: d?.gm_clave ?? r.clave, genero: d?.genero ?? (r.clave === "resto" ? "Resto" : r.nombre), mundo: d?.mundo ?? "" };
    })
    .sort((x, y) => porTexto(x.gm_clave, y.gm_clave));
}

// ─── Resultado de la simulación o de la aplicación ───

/**
 * Arma el `ResultadoLoteApi` con una sola función para que simular y aplicar den lo mismo (R22): `filas`, `efecto_gm`, `totales`, las 10 mayores,
 * `revision_requerida` (de lo pedido y del efecto, no de lo escrito) y `huella_simulacion` (la calcula `huella.ts`).
 */
export function armarResultadoLote(a: {
  plan: readonly FilaPlanificada[];
  efecto_gm: EfectoGMApi[];
  crecimientos_a_reaprobar: CrecimientoAReaprobarApi[];
  pendientes_cierre: PendientesCierreApi;
  huella_simulacion: string;
  simulado: boolean;
  repetido?: boolean;
  lote?: LoteApi | null;
}): ResultadoLoteApi {
  return {
    lote: a.lote ?? null,
    simulado: a.simulado,
    repetido: a.repetido ?? false,
    huella_simulacion: a.huella_simulacion,
    filas: a.plan.map(resultadoFilaApi),
    totales: totalesDeLote(a.plan),
    efecto_gm: a.efecto_gm,
    mayores_unidades: mayoresUnidades(a.plan),
    mayores_brechas: mayoresBrechas(a.plan),
    crecimientos_a_reaprobar: a.crecimientos_a_reaprobar,
    revision_requerida: revisionRequerida({ filasPedidas: a.plan.length, efecto: a.efecto_gm }),
    pendientes_cierre: a.pendientes_cierre,
  };
}
