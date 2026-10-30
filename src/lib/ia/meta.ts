import { metaDeGM, type FilaParaMeta, type FuenteMeta } from "@/lib/proyeccion/meta-gm";
import { repartirEntero } from "@/lib/proyeccion/reparto";
import type { SobreBase } from "@/lib/proyeccion/tipos-api";
import {
  RANGO_BRECHA_EXTREMA,
  UMBRAL_BRECHA_CEDE_PCT,
  UMBRAL_BRECHA_FORZADA_PCT,
  UMBRAL_BRECHA_MUY_FORZADA_PCT,
  UMBRAL_ESFUERZO_EXIGENTE_PCT,
  UMBRAL_ESFUERZO_HOLGADO_PCT,
  type AvisoIa,
  type BanderaIa,
  type EstadoMetaFila,
  type MetaGMApi,
} from "./tipos-api";

/**
 * Meta del GM, clasificación de filas y asignación de la meta libre (ficha 07e, §5.1; R1 a R6 y R28). Puro, sin I/O.
 * La IA solo aporta un PESO por fila: la exactitud de la suma la pone `repartirEntero` (mayor resto) cada vez que se lee.
 * Congelado al cerrar la tanda 1.
 */

export type FilaMeta = FilaParaMeta & {
  /** Clave de la fila (`proyeccion_filas.clave`): fija el orden estable de los repartos. */
  clave: string;
  decidido: number | null;
  vigente: number | null;
  /** Aviso `revision_cola_larga` de la fila: una cola larga con quiebres relevantes es libre. */
  revision_cola_larga: boolean;
};

export type OpcionesMeta = { umbral_cola_larga: number; incluir_cola_larga: boolean };

/**
 * Clasificación de una fila base de 2027, en el orden de §5.1: decidida, % propio, cola larga, sin base y libre.
 * Desviación: la fila sin `propuesto` (que `metaDeGM` deja fuera de la meta) es `sin_base` aunque tenga un `decidido`; si no, su
 * aporte restaría de `Meta_libre` algo que nunca sumó a `Meta_GM` y `Σ fijas + Σ A = Meta_GM` se rompería.
 */
export function estadoFilaMeta(f: FilaMeta, o: OpcionesMeta): EstadoMetaFila {
  if (f.propuesto === null) return "sin_base";
  if (f.decidido !== null) return "fija_decidida";
  if (f.crecimiento_pct !== null) return "fija_pct";
  if (!o.incluir_cola_larga && f.propuesto < o.umbral_cola_larga && !f.revision_cola_larga) return "fija_cola_larga";
  return "libre";
}

const porClave = <T extends { clave: string }>(a: T, b: T): number => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0);

export type EntradaPlanMeta = {
  filas: readonly FilaMeta[];
  g: number | null;
  sobre_base: SobreBase;
  fuente: FuenteMeta;
  crecimiento_id: string | null;
  version: number | null;
  opciones: OpcionesMeta;
};

export type PlanMeta = {
  /** `null` sin `g` (`sin_meta`): solo natural y razones. */
  meta: MetaGMApi | null;
  /** `fila_id → P^GM` de las filas con base. */
  p_gm: ReadonlyMap<string, number>;
  estados: ReadonlyMap<string, EstadoMetaFila>;
  /** `fila_id → aporte` de las fijas (su vigente). */
  aportes: ReadonlyMap<string, number>;
  /** Las libres, ordenadas por `clave`. */
  libres: readonly FilaMeta[];
  avisos: AvisoIa[];
};

/** Meta del GM, fijas y meta libre (D3, D4, D6, D18). */
export function planMeta(e: EntradaPlanMeta): PlanMeta {
  const m = metaDeGM({ filas: e.filas, g: e.g, sobre_base: e.sobre_base, fuente: e.fuente });
  const estados = new Map<string, EstadoMetaFila>();
  const aportes = new Map<string, number>();
  const libres: FilaMeta[] = [];
  const detalle = { decididas: 0, pct_propio: 0, cola_larga: 0 };
  let filasFijas = 0;
  for (const f of e.filas) {
    const estado = estadoFilaMeta(f, e.opciones);
    estados.set(f.fila_id, estado);
    if (estado === "libre") {
      libres.push(f);
      continue;
    }
    if (estado === "sin_base") continue;
    const aporte = estado === "fija_decidida" ? (f.decidido ?? 0) : (f.vigente ?? f.propuesto ?? 0);
    aportes.set(f.fila_id, aporte);
    filasFijas += 1;
    if (estado === "fija_decidida") detalle.decididas += aporte;
    else if (estado === "fija_pct") detalle.pct_propio += aporte;
    else detalle.cola_larga += aporte;
  }
  libres.sort(porClave);

  const avisos: AvisoIa[] = [];
  if (e.fuente === "resto_provisional") avisos.push("meta_provisional");
  if (m.meta_gm === null || e.g === null) return { meta: null, p_gm: m.p_gm, estados, aportes, libres, avisos };

  const fijas = detalle.decididas + detalle.pct_propio + detalle.cola_larga;
  const meta_libre = m.meta_gm - fijas;
  if (meta_libre < 0) avisos.push("fijadas_exceden_meta");
  return {
    meta: {
      pct: e.g,
      sobre_base: e.sobre_base,
      fuente: e.fuente,
      crecimiento_id: e.crecimiento_id,
      version: e.version,
      meta_gm: m.meta_gm,
      fijas,
      fijas_detalle: detalle,
      meta_libre,
      filas_libres: libres.length,
      filas_fijas: filasFijas,
      fuera_base: m.fuera_base,
    },
    p_gm: m.p_gm,
    estados,
    aportes,
    libres,
    avisos,
  };
}

// ─── Asignación de la meta libre ───

export type PesoFilaMeta = {
  fila_id: string;
  clave: string;
  /** `P^GM_f`: respaldo cuando el modelo no dio cifra. */
  p_gm: number;
  /** `meta_y1_modelo` de la propuesta vigente; `null` = descartada, faltó en la respuesta o fila nueva. */
  meta_y1_modelo: number | null;
  natural_y1: number | null;
  /** `B^s`. */
  base_s: number | null;
};

export type Asignacion = {
  /** `fila_id → A_f`; `null` si no hay reparto (sin meta o `Meta_libre < 0`). */
  a: Map<string, number> | null;
  avisos_fila: Map<string, AvisoIa[]>;
  avisos_gm: AvisoIa[];
};

const suma = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Cadena de pesos (I3): `meta_y1_modelo`, si es nulo `P^GM`; con `Σ w = 0`, `natural`, luego `B^s`, luego pesos iguales.
 * Nunca se pasa un nulo a `repartirEntero`, que lo trataría como 0 y daría `A = 0`.
 */
function pesosDe(filas: readonly PesoFilaMeta[]): number[] {
  const positivos = (xs: readonly number[]) => xs.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let w = positivos(filas.map((f) => f.meta_y1_modelo ?? f.p_gm));
  if (suma(w) > 0) return w;
  w = positivos(filas.map((f) => f.natural_y1 ?? 0));
  if (suma(w) > 0) return w;
  w = positivos(filas.map((f) => f.base_s ?? 0));
  if (suma(w) > 0) return w;
  return filas.map(() => 1);
}

/**
 * D7. Reparte `Meta_libre` entre las libres con `repartirEntero` (mayor resto, empate al primero por `clave`):
 * `Σ A = Meta_libre` y `Σ fijas + Σ A = Meta_GM`, siempre. `meta_libre` nula o negativa = sin reparto.
 */
export function asignarMeta(metaLibre: number | null, filas: readonly PesoFilaMeta[]): Asignacion {
  const avisos_fila = new Map<string, AvisoIa[]>();
  const avisos_gm: AvisoIa[] = [];
  if (metaLibre === null) return { a: null, avisos_fila, avisos_gm };
  if (metaLibre < 0) return { a: null, avisos_fila, avisos_gm: ["fijadas_exceden_meta"] };
  const orden = [...filas].sort((x, y) => porClave(x, y) || (x.fila_id < y.fila_id ? -1 : x.fila_id > y.fila_id ? 1 : 0));
  const a = new Map<string, number>();
  if (orden.length === 0) return { a, avisos_fila, avisos_gm };
  for (const f of orden) if (f.meta_y1_modelo === null) avisos_fila.set(f.fila_id, ["sin_propuesta_ia"]);
  const reparto = repartirEntero(metaLibre, pesosDe(orden)) ?? orden.map(() => 0);
  orden.forEach((f, i) => a.set(f.fila_id, reparto[i]));
  return { a, avisos_fila, avisos_gm };
}

// ─── Modo jerárquico (R28) ───

export type PesoLinea = PesoFilaMeta;

/** Sub-meta de cada línea (`fila_id` = id de la línea): `asignarMeta` sobre las líneas con el peso de la llamada `lineas` o `Σ P^GM` de sus libres. */
export function subMetasPorLinea(metaLibre: number | null, lineas: readonly PesoLinea[]): Map<string, number> | null {
  return asignarMeta(metaLibre, lineas).a;
}

/**
 * El peso final de una fila en jerárquico es su `meta_y1` escalado a la sub-meta de su línea. Devuelve `fila_id → peso` (entero);
 * la suma de cada línea es su sub-meta. Una fila sin cifra toma `P^GM`.
 */
export function escalarASubMetas(subMetas: ReadonlyMap<string, number>, filas: readonly (PesoFilaMeta & { l: string })[]): Map<string, number> {
  const salida = new Map<string, number>();
  const porLinea = new Map<string, (PesoFilaMeta & { l: string })[]>();
  for (const f of filas) porLinea.set(f.l, [...(porLinea.get(f.l) ?? []), f]);
  for (const [l, grupo] of porLinea) {
    const sub = subMetas.get(l);
    if (sub === undefined) continue;
    const a = asignarMeta(sub, grupo).a;
    if (a) for (const [id, v] of a) salida.set(id, v);
  }
  return salida;
}

// ─── Lo que se muestra por fila y por GM ───

export type IndicadoresFila = {
  brecha_u: number | null;
  brecha_pct: number | null;
  contra_metodo_u: number;
  pct_sobre_corregida: number | null;
  pct_sobre_real: number | null;
};

/** `brecha = A − natural`, `contra_metodo = A − P^M`, `% sobre 2026 corregido = A ÷ B' − 1` y `% sobre real = A ÷ B − 1`. */
export function indicadoresFila(a: { a: number; natural_y1: number | null; p_metodo: number | null; base: number | null; base_corregida: number | null }): IndicadoresFila {
  const pct = (num: number, den: number | null): number | null => (den !== null && den > 0 ? (num / den - 1) * 100 : null);
  return {
    brecha_u: a.natural_y1 === null ? null : a.a - a.natural_y1,
    brecha_pct: a.natural_y1 === null ? null : pct(a.a, a.natural_y1),
    contra_metodo_u: a.a - (a.p_metodo ?? 0),
    pct_sobre_corregida: pct(a.a, a.base_corregida),
    pct_sobre_real: pct(a.a, a.base),
  };
}

/** Orden de la tabla del detalle: `|contra_metodo_u|` descendente, empate por `clave`. */
export function ordenarPorContraMetodo<T extends { clave: string; contra_metodo_u: number | null }>(filas: readonly T[]): T[] {
  return [...filas].sort((x, y) => Math.abs(y.contra_metodo_u ?? 0) - Math.abs(x.contra_metodo_u ?? 0) || porClave(x, y));
}

export type NivelBrecha = "muy_forzada" | "forzada" | "normal" | "cede";

export function nivelBrecha(brechaPct: number | null): NivelBrecha {
  if (brechaPct === null) return "normal";
  if (brechaPct >= UMBRAL_BRECHA_MUY_FORZADA_PCT) return "muy_forzada";
  if (brechaPct >= UMBRAL_BRECHA_FORZADA_PCT) return "forzada";
  if (brechaPct <= UMBRAL_BRECHA_CEDE_PCT) return "cede";
  return "normal";
}

/** Filas con brecha `≥ +10 %` y `≤ −10 %` (columnas «Forzadas / ceden»). */
export function contarForzadas(brechasPct: readonly (number | null)[]): { forzadas: number; ceden: number } {
  let forzadas = 0;
  let ceden = 0;
  for (const b of brechasPct) {
    const n = nivelBrecha(b);
    if (n === "forzada" || n === "muy_forzada") forzadas += 1;
    else if (n === "cede") ceden += 1;
  }
  return { forzadas, ceden };
}

/** Aviso `brecha_extrema`: `A ÷ natural ∉ [0,5, 2]`; con natural 0 y `A > 0` también (§5.8). No recorta nada. */
export function avisoBrechaExtrema(a: number, natural: number | null): AvisoIa | null {
  if (natural === null) return null;
  if (natural <= 0) return a > 0 ? "brecha_extrema" : null;
  const r = a / natural;
  return r < RANGO_BRECHA_EXTREMA.min || r > RANGO_BRECHA_EXTREMA.max ? "brecha_extrema" : null;
}

/**
 * Esfuerzo del GM: `Meta_libre ÷ Σ natural − 1` en %. Solo suman las filas con natural; `null` si la suma es 0 o no hay meta libre.
 */
export function esfuerzoGM(metaLibre: number | null, naturales: readonly (number | null)[]): number | null {
  if (metaLibre === null) return null;
  const total = suma(naturales.filter((n): n is number => n !== null));
  return total > 0 ? (metaLibre / total - 1) * 100 : null;
}

/** Banderas del GM puestas por el código: `meta_exigente` desde +10 % y `meta_holgada` desde −5 %. */
export function banderasEsfuerzo(esfuerzoPct: number | null): Extract<BanderaIa, "meta_exigente" | "meta_holgada">[] {
  if (esfuerzoPct === null) return [];
  if (esfuerzoPct >= UMBRAL_ESFUERZO_EXIGENTE_PCT) return ["meta_exigente"];
  if (esfuerzoPct <= UMBRAL_ESFUERZO_HOLGADO_PCT) return ["meta_holgada"];
  return [];
}
