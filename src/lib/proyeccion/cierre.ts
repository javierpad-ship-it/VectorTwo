import { normalizar } from "./nino";
import { repartirResto } from "./reparto";
import type { AvisoFila, Metodo, OrigenMes } from "./tipos-api";

/**
 * Cierre del año en curso de una fila base (ficha 07, paso 1 y reglas 8 a 11). Puro.
 *
 *   V  = Σ_{m≤k} v_m                      (vendido real de M(Y))
 *   V' = Σ_{m≤k} v_m ÷ φ_m                (normalizado por el Niño)
 *   T' = V' ÷ C_k                         (total normalizado del año)
 *   P  = V + round(Σ_{m>k} T' c_m φ_m)    (cierre propuesto; redondea solo al final)
 *
 * Con poco avance (`C_k < umbral`) se propone el total del año de la última proyección
 * cerrada que lo cubrió (`plan_anterior`) con la cifra por avance al lado.
 */

export type EntradaCierre = {
  /** Doce meses del año en curso; solo cuentan los primeros `k`. */
  serie: readonly number[];
  /** Último mes cerrado, 1 a 12. */
  k: number;
  /** Curva de la fila (suma 1); `null` si no hay vigente. */
  curva: readonly number[] | null;
  /** `φ_{Y,m}` de la unidad (doce valores). */
  factoresMes: readonly number[];
  umbralAvance: number;
  /** Total de `Y` de la última cerrada que lo cubrió; `null` si no hay o no tiene esta fila. */
  planAnterior: number | null;
  /** ¿Hubo venta en `Y−1` (para el aviso `sin_venta_anio`)? */
  ventaAnioAnterior?: boolean;
};

export type ResultadoCierre = {
  vendido: number;
  /** `C_k`, el avance acumulado de la curva hasta `k`; `null` sin curva. */
  avance: number | null;
  /** `V'` normalizado. */
  vendido_normalizado: number;
  /** `T' = V' ÷ C_k`; `null` sin curva o sin avance. */
  total_normalizado: number | null;
  propuesto: number | null;
  metodo: Metodo;
  /** `V' ÷ C_k` redondeado cuando el método es `plan_anterior`. */
  referencia_alternativa: number | null;
  meses: number[] | null;
  origen_meses: OrigenMes[] | null;
  avisos: AvisoFila[];
};

/** `C_k = Σ_{j≤k} c_j`. */
export function avanceAcumulado(curva: readonly number[], k: number): number {
  let s = 0;
  for (let i = 0; i < k && i < curva.length; i++) s += curva[i];
  return s;
}

export function proponerCierre(e: EntradaCierre): ResultadoCierre {
  const k = Math.max(0, Math.min(12, e.k));
  const real = Array.from({ length: 12 }, (_, i) => (i < k ? Math.max(0, e.serie[i] ?? 0) : 0));
  const vendido = real.reduce((a, b) => a + b, 0);
  const vNormalizado = normalizar(real, e.factoresMes).reduce((a, b) => a + b, 0);
  const avisos: AvisoFila[] = [];

  const sinCurva: ResultadoCierre = {
    vendido,
    avance: null,
    vendido_normalizado: vNormalizado,
    total_normalizado: null,
    propuesto: null,
    metodo: "sin_propuesta",
    referencia_alternativa: null,
    meses: null,
    origen_meses: null,
    avisos: ["sin_curva"],
  };
  if (e.curva === null) return sinCurva;
  const ck = avanceAcumulado(e.curva, k);
  if (!(ck > 0)) return { ...sinCurva, avance: ck };

  const totalNormalizado = vNormalizado / ck;
  const porAvance = Math.max(
    vendido,
    vendido +
      Math.round(
        e.curva.reduce((s, c, i) => (i >= k ? s + totalNormalizado * c * (e.factoresMes[i] ?? 1) : s), 0)
      )
  );

  let propuesto = porAvance;
  let metodo: Metodo = "avance";
  let referencia: number | null = null;

  if (vendido === 0 && e.ventaAnioAnterior) avisos.push("sin_venta_anio");

  if (ck < e.umbralAvance) {
    if (e.planAnterior !== null) {
      propuesto = Math.max(vendido, Math.round(e.planAnterior));
      metodo = "plan_anterior";
      referencia = porAvance;
      avisos.push("plan_anterior");
    } else {
      avisos.push("avance_bajo");
    }
  }

  const { meses, origen_meses } = repartirResto(propuesto, real, k, e.curva, e.factoresMes);
  return {
    vendido,
    avance: ck,
    vendido_normalizado: vNormalizado,
    total_normalizado: totalNormalizado,
    propuesto,
    metodo,
    referencia_alternativa: referencia,
    meses,
    origen_meses,
    avisos,
  };
}

/**
 * Regla 18 / paso 7: el mismo método aplicado a `Y−1` con el mismo `k` (sin plan anterior: es la prueba del
 * método por avance). Devuelve `null` sin curva o sin avance.
 */
export function pruebaPorAvance(args: {
  serie: readonly number[];
  k: number;
  curva: readonly number[] | null;
  factoresMes: readonly number[];
}): number | null {
  const r = proponerCierre({ ...args, umbralAvance: 0, planAnterior: null });
  return r.propuesto;
}
