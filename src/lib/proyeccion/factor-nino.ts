import { medirPeriodo, type SerieParaVolumen } from "@/lib/curvas/efecto";
import type { RedAnio } from "@/lib/curvas/tipos-api";
import {
  FORMULA_FACTOR_RELATIVO,
  MIN_MESES_FACTOR,
  UMBRAL_CORRECCION_NINO,
  type DiagnosticoFactorApi,
  type EstadoFactorY,
  type MotivoDesfaseFactor,
  type TemporadaFactor,
} from "./tipos-api";

/**
 * Factor del Niño relativo y materialidad de la corrección (ficha 06e, §3.3 y §5.2). Lógica PURA, sin I/O: la usan igual el servidor
 * (sincronizar, cerrar), la pantalla de GM y las pruebas. Las constantes y los tipos viven en `tipos-api.ts` y se reexportan aquí.
 */

export { FORMULA_FACTOR_RELATIVO, MIN_MESES_FACTOR, UMBRAL_CORRECCION_NINO };
export type { DiagnosticoFactorApi, EstadoFactorY, MotivoDesfaseFactor };

/** Holgura relativa para que un 0,50 % exacto no se pierda por el redondeo binario (`1005 ÷ 1000 − 1` da 0,004999…). */
const HOLGURA = 1e-9;

/**
 * D8. ¿La corrección del Niño es material? `base > 0` y `|B' ÷ B − 1| ≥ UMBRAL_CORRECCION_NINO`. Es la única función de umbral:
 * `hay_nino` (pantalla) y `gm_con_nino` (M7) la llaman con las mismas `Σ B` y `Σ B'`.
 */
export function correccionMaterial(base: number, baseCorregida: number): boolean {
  if (!Number.isFinite(base) || !Number.isFinite(baseCorregida) || !(base > 0)) return false;
  return Math.abs(baseCorregida - base) >= UMBRAL_CORRECCION_NINO * base * (1 - HOLGURA);
}

export type EntradaFactorRelativo = {
  temporada: TemporadaFactor;
  anioY: number;
  anioRef: number;
  /** Series de la temporada (con su desglose por tienda y los meses publicados) del año atípico y del normal de referencia. */
  serieY: SerieParaVolumen;
  serieRef: SerieParaVolumen;
  /** Series de `todo_el_ano` (el control) de los mismos años. */
  controlY: SerieParaVolumen;
  controlRef: SerieParaVolumen;
  redes: ReadonlyMap<number, RedAnio>;
  /** Doce posiciones, enero primero: el mes es atípico de la temporada en `anioY` (publicado o no). */
  mesesPeriodo: readonly boolean[];
};

export type ResultadoFactorRelativo = {
  /** `ρ_P`. */
  ratio_volumen: number | null;
  /** `κ_P`. */
  ratio_control: number | null;
  /** `ρ_P ÷ κ_P` sin redondear; `null` si `κ_P` es nulo o 0. */
  relativo: number | null;
  /** `round4(relativo)` con al menos `MIN_MESES_FACTOR` meses del periodo con dato; si no, `null` (lo escribe el planner). */
  ratio_calculado: number | null;
  meses_periodo_con_dato: number;
  ratio_fuera: number | null;
  diagnostico: DiagnosticoFactorApi;
};

const redondear4 = (x: number): number => Math.round((x + Number.EPSILON * Math.sign(x)) * 1e4) / 1e4;

/**
 * Regla R23 (§5.2). `ρ_P ÷ κ_P` sobre los meses del periodo atípico publicados en ambos años y las tiendas comunes de `Y` y su referencia.
 * Con `P` igual a todos los meses publicados da el `ratio_relativo` de `efectoAtipicoCorrida`.
 */
export function factorRelativoPeriodo(e: EntradaFactorRelativo): ResultadoFactorRelativo {
  const p = medirPeriodo({
    y: e.serieY,
    referencia: e.serieRef,
    controlY: e.controlY,
    controlReferencia: e.controlRef,
    redes: e.redes,
    mesesPeriodo: e.mesesPeriodo,
  });
  const suficiente = p.relativo !== null && p.meses_periodo_con_dato >= MIN_MESES_FACTOR;
  return {
    ratio_volumen: p.ratio_volumen,
    ratio_control: p.ratio_control,
    relativo: p.relativo,
    ratio_calculado: suficiente && p.relativo !== null ? redondear4(p.relativo) : null,
    meses_periodo_con_dato: p.meses_periodo_con_dato,
    ratio_fuera: p.ratio_fuera,
    diagnostico: { meses: p.meses, ratio_fuera: p.ratio_fuera, meses_periodo: p.meses_periodo, meses_periodo_con_dato: p.meses_periodo_con_dato },
  };
}

/**
 * Lo que `estadoFactorY` necesita de una fila de `factores_volumen_atipico`. Las columnas de `0.14.0` son opcionales: una fila escrita
 * por `0.13.x` las trae `null` y queda con la fórmula anterior.
 */
export type FactorParaEstado = {
  calculado_at: string | null;
  formula?: string | null;
  huella_cargas: string | null;
  huella_composicion?: string | null;
  parcial: boolean;
  meses_comparados: number | null;
  ratio_calculado: number | null;
  ratio_aplicado: number | null;
  aplicado_huella?: string | null;
};

export type HoyFactor = {
  /** `huellaCargas` de hoy, del mismo conjunto de cargas con que se sincroniza. */
  huella_cargas: string;
  /** Huella de composición de hoy de las agrupaciones de la temporada y de `todo_el_ano`. */
  huella_composicion: string;
  /** Meses del periodo de `Y` publicados hoy (en `Y` y en la referencia). */
  meses_periodo_publicados: number;
};

/**
 * R24 (B2). Estado de un factor de `Y`, en este orden: `faltante` (sin valor efectivo), `desfasado` (ya sincronizado y con fórmula,
 * cargas, meses o composición viejos; se arregla con «Sincronizar»), `sin_confirmar` (parcial y sin `ratio_aplicado` escrito sobre el
 * cálculo vigente; se arregla escribiendo el valor) u `ok`. `motivos_desfase` solo viene con `desfasado`.
 */
export function estadoFactorY(f: FactorParaEstado, hoy: HoyFactor): { estado: EstadoFactorY; motivos_desfase: MotivoDesfaseFactor[] } {
  const efectivo = f.ratio_aplicado ?? f.ratio_calculado;
  if (efectivo === null) return { estado: "faltante", motivos_desfase: [] };

  if (f.calculado_at !== null) {
    const motivos: MotivoDesfaseFactor[] = [];
    if ((f.formula ?? null) !== FORMULA_FACTOR_RELATIVO) motivos.push("formula");
    if (f.huella_cargas !== hoy.huella_cargas) motivos.push("cargas");
    if (f.parcial && (f.meses_comparados ?? 0) < hoy.meses_periodo_publicados) motivos.push("meses");
    if ((f.huella_composicion ?? null) !== hoy.huella_composicion) motivos.push("composicion");
    if (motivos.length > 0) return { estado: "desfasado", motivos_desfase: motivos };
  }

  const confirmado = f.ratio_aplicado !== null && f.aplicado_huella != null && f.aplicado_huella === f.huella_cargas;
  if (f.parcial && !confirmado) return { estado: "sin_confirmar", motivos_desfase: [] };
  return { estado: "ok", motivos_desfase: [] };
}
