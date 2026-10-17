import { esConstante } from "./nino";
import { repartirEntero } from "./reparto";
import type { AvisoFila, Metodo } from "./tipos-api";

/**
 * Año siguiente de una fila base (ficha 07, paso 2 y reglas 12 a 14; método 4 de la 0.10.8, ficha 07c §2.4). Puro.
 *
 *   B   = vigente de Y de la fila base
 *         + Σ vigente de Y de las tiendas nuevas de Y que pasan a M(Y+1)
 *         − Σ aporte de Y de las tiendas de M(Y) que no están en M(Y+1)      (sin normalizar por el Niño)
 *   P   = round(B × (1 + g))                                                  % BRUTO: no depende de φ_Y ni de φ_{Y+1}
 *   P_m = P repartido con c_m × φ_{Y+1,m}                                     φ_{Y+1} solo da forma al reparto
 *   B'  = B normalizado por el Niño de Y (B ÷ φ si φ es constante; mes a mes si no)
 *   B'' = B' × Σ_m c_m φ_{Y+1,m}                                              lo que vendería con 0 % si Y hubiera sido normal
 *
 * `B''` solo es una referencia (rebote del Niño): no entra en la propuesta. Con el método 3 se calculaba
 * `P = round(B' × (1 + g) × Σ c φ_{Y+1})` y el % no era el de la variación bruta.
 *
 * Cualquier cambio de un sumando recalcula `P` en el acto, sin releer venta (B2).
 */

/** Un sumando de la base: positivo (tienda nueva que entra) o negativo (tienda que sale). */
export type AporteBase = {
  signo: 1 | -1;
  /** Total de `Y` del aporte (vigente de la tienda nueva, o aporte de la que sale). `null` = sin cifra: no suma. */
  total: number | null;
  /** Reparto mensual del aporte, si se conoce. */
  meses: readonly number[] | null;
};

export type EntradaSiguiente = {
  /** Total vigente de `Y` de la fila base (`decidido ?? propuesto`); `null` = sin base. */
  baseVigente: number | null;
  /** Doce meses de la fila base en `Y` (real + resto). */
  mesesBase: readonly number[] | null;
  aportesTiendas: readonly AporteBase[];
  /** `φ_{Y,m}`. */
  factoresMesEnCurso: readonly number[];
  /** `g` en porcentaje (5 = 5 %). */
  crecimiento: number;
  curva: readonly number[] | null;
  /** `φ_{Y+1,m}`. */
  factoresMesObjetivo: readonly number[];
};

export type ResultadoSiguiente = {
  /** `B`: base del año siguiente (suma de sumandos), sin normalizar. */
  base: number | null;
  /** `B'`: la base normalizada por el Niño de `Y` (a nivel de `Y`). */
  base_nino: number | null;
  /** `B'' = B' × Σ c φ_{Y+1}`: lo que la fila vendería en `Y+1` con 0 % si `Y` hubiera sido un año normal. Solo referencia. */
  base_normalizada: number | null;
  propuesto: number | null;
  metodo: Metodo;
  meses: number[] | null;
  avisos: AvisoFila[];
};

/** Reparto mensual de la base: fila base + aportes con signo. `null` si falta algún reparto. */
function mesesDeBase(e: EntradaSiguiente): number[] | null {
  if (e.mesesBase === null) return null;
  const meses = [...e.mesesBase];
  for (const a of e.aportesTiendas) {
    if (a.total === null) continue;
    if (a.meses === null) return null;
    for (let i = 0; i < 12; i++) meses[i] += a.signo * (a.meses[i] ?? 0);
  }
  return meses.map((m) => Math.max(0, m));
}

export function proponerSiguiente(e: EntradaSiguiente): ResultadoSiguiente {
  if (e.baseVigente === null) {
    return { base: null, base_nino: null, base_normalizada: null, propuesto: null, metodo: "sin_propuesta", meses: null, avisos: ["sin_base"] };
  }
  let base = e.baseVigente;
  for (const a of e.aportesTiendas) if (a.total !== null) base += a.signo * a.total;
  base = Math.max(0, base);

  if (e.curva === null) {
    return { base, base_nino: null, base_normalizada: null, propuesto: null, metodo: "sin_propuesta", meses: null, avisos: ["sin_curva"] };
  }

  // B' = Σ b_m ÷ φ_m; con φ constante se cancela y B' = B ÷ φ (sin pasar por los meses enteros).
  let baseNormalizada: number;
  if (esConstante(e.factoresMesEnCurso)) {
    baseNormalizada = base / (e.factoresMesEnCurso[0] > 0 ? e.factoresMesEnCurso[0] : 1);
  } else {
    const meses = mesesDeBase(e);
    if (meses === null) {
      // Sin reparto mensual de algún sumando: se normaliza con la forma de la curva.
      const pesos = e.curva.map((c, i) => c * (e.factoresMesEnCurso[i] ?? 1));
      const suma = pesos.reduce((a, b) => a + b, 0);
      baseNormalizada = suma > 0 ? base / suma : base;
    } else {
      baseNormalizada = meses.reduce((s, m, i) => s + m / (e.factoresMesEnCurso[i] > 0 ? e.factoresMesEnCurso[i] : 1), 0);
      // Ajuste de la parte entera del reparto: B' conserva la escala de B.
      const sumaMeses = meses.reduce((a, b) => a + b, 0);
      if (sumaMeses > 0 && Math.abs(sumaMeses - base) > 0) baseNormalizada *= base / sumaMeses;
    }
  }

  // Método 4: el % es bruto sobre `B`; `φ_{Y+1}` solo pondera el reparto mensual.
  const pesos = e.curva.map((c, i) => c * (e.factoresMesObjetivo[i] ?? 1));
  const propuesto = Math.max(0, Math.round(base * (1 + e.crecimiento / 100)));
  return {
    base,
    base_nino: baseNormalizada,
    base_normalizada: baseNormalizada * pesos.reduce((a, b) => a + b, 0),
    propuesto,
    metodo: "crecimiento",
    meses: repartirEntero(propuesto, pesos),
    avisos: [],
  };
}

/** Regla 12: el aporte de Y de una tienda de `M(Y)` que sale de `M(Y+1)`: su parte del cierre propuesto de la fila. */
export function aporteSaliente(args: {
  /** Cierre propuesto de la fila base de `Y` (o su decidido si no hay propuesta). */
  cierreBase: number | null;
  /** Vendido de la fila base de `Y` (todas las tiendas de `M(Y)`). */
  vendidoBase: number;
  /** Vendido de la tienda que sale hasta `k`. */
  vendidoTienda: number;
}): number {
  if (args.cierreBase === null || !(args.vendidoBase > 0)) return 0;
  return Math.round((args.cierreBase * args.vendidoTienda) / args.vendidoBase);
}
