import { diasDelMes, indiceMes, partesDeFecha } from "./calendario";
import { repartirEntero } from "./reparto";
import { MESES_MIN_AVANCE, RAMPA_MAX, type AvisoFila, type Metodo, type Subbloque } from "./tipos-api";

/**
 * Tiendas nuevas (ficha 07, paso 4 y reglas 19 a 23). Puro.
 *
 * El año de una tienda nueva sale de tres insumos: su venta esperada `E` (soles por mes, sin IGV, de la
 * tienda madura), la composición del referente (`s_f`, `p_f`; unidades maduras por fila
 * `Md_f = E × 12 × s_f ÷ p_f`) y la rampa de maduración `r_m`, todo repartido con la curva de la unidad.
 */

// ─── Rampa ───

/** Regla 19: valores en `(0, RAMPA_MAX]`, de uno a seis. Devuelve el motivo del rechazo o `null`. */
export function motivoRampaInvalida(rampa: readonly number[]): string | null {
  if (rampa.length < 1 || rampa.length > 6) return "La rampa necesita entre 1 y 6 valores.";
  for (const v of rampa) {
    if (!Number.isFinite(v) || v <= 0) return "Cada valor de la rampa debe ser mayor que 0.";
    if (v > RAMPA_MAX) return `Cada valor de la rampa debe ser como máximo ${RAMPA_MAX}.`;
  }
  return null;
}

/**
 * `r_m` de los doce meses de `anio` para una tienda que abre en `apertura` (`aaaa-mm-dd`). Se cuenta desde el
 * mes de apertura, también si cruza al año siguiente: 0 antes de abrir; en el mes de apertura
 * `rampa[0] × días abiertos ÷ días del mes`; luego `rampa[1]`, `rampa[2]`, …; después 1.
 */
export function rampaMensual(apertura: string, rampa: readonly number[], anio: number): number[] {
  const { anio: aa, mes: am, dia } = partesDeFecha(apertura);
  const base = indiceMes(aa, am);
  return Array.from({ length: 12 }, (_, i) => {
    const j = indiceMes(anio, i + 1) - base;
    if (j < 0) return 0;
    if (j === 0) {
      const dias = diasDelMes(aa, am);
      return (rampa[0] ?? 1) * ((dias - dia + 1) / dias);
    }
    return rampa[j] ?? 1;
  });
}

/** Una tienda ya madura o sin rampa: `r_m = 1` en todos los meses. */
export const RAMPA_PLANA: readonly number[] = Array.from({ length: 12 }, () => 1);

/**
 * Meses COMPLETOS cerrados desde la apertura hasta `k` del año `anio` (el mes de apertura cuenta solo si la
 * tienda abrió el día 1).
 */
export function mesesCompletos(apertura: string, anio: number, k: number): number {
  const { anio: aa, mes: am, dia } = partesDeFecha(apertura);
  const primero = indiceMes(aa, am) + (dia === 1 ? 0 : 1);
  return Math.max(0, indiceMes(anio, k) - primero + 1);
}

/** `Σ_{m ∈ [desde, hasta)} c_m × r_m × φ_m` (índices de 0 a 12). */
export function sumaCurva(
  curva: readonly number[],
  r: readonly number[],
  phi: readonly number[] | null,
  desde = 0,
  hasta = 12
): number {
  let s = 0;
  for (let m = Math.max(0, desde); m < Math.min(12, hasta); m++) s += curva[m] * (r[m] ?? 1) * (phi ? (phi[m] ?? 1) : 1);
  return s;
}

// ─── Avance propio (B1) ───

export type ResultadoAvancePropio = {
  vendido: number;
  vendido_normalizado: number;
  /** `Σ_{m≤k} c_m r_m`: con la rampa en el denominador (B1), no `C_k`. */
  denominador: number;
  /** Total maduro `A_t = V' ÷ Σ_{m≤k} c_m r_m`; `null` sin denominador. */
  A: number | null;
  /** `Σ_{m>k} c_m r_m φ_m`. */
  factor_resto: number;
  /** `A × factor_resto` sin redondear. */
  resto: number | null;
  /** `A^{(3)}`: la misma cuenta con los últimos tres meses cerrados. */
  A_tres_meses: number | null;
};

/** Regla 21. `A_t = V_t' ÷ Σ_{m≤k} c_m r_m` y `resto = A_t × Σ_{m>k} c_m r_m φ_m`. */
export function avancePropio(args: {
  serie: readonly number[];
  k: number;
  curva: readonly number[];
  /** `r_m` del año (doce valores). */
  rampa: readonly number[];
  factoresMes: readonly number[];
}): ResultadoAvancePropio {
  const { serie, k, curva, rampa, factoresMes } = args;
  let vendido = 0;
  let vNorm = 0;
  for (let m = 0; m < k && m < 12; m++) {
    const v = Math.max(0, serie[m] ?? 0);
    vendido += v;
    vNorm += v / ((factoresMes[m] ?? 1) > 0 ? (factoresMes[m] ?? 1) : 1);
  }
  const denominador = sumaCurva(curva, rampa, null, 0, k);
  const factorResto = sumaCurva(curva, rampa, factoresMes, k, 12);
  const A = denominador > 0 ? vNorm / denominador : null;

  // Últimos tres meses cerrados.
  const desde = Math.max(0, k - 3);
  let v3 = 0;
  for (let m = desde; m < k; m++) {
    v3 += Math.max(0, serie[m] ?? 0) / ((factoresMes[m] ?? 1) > 0 ? (factoresMes[m] ?? 1) : 1);
  }
  const den3 = sumaCurva(curva, rampa, null, desde, k);
  return {
    vendido,
    vendido_normalizado: vNorm,
    denominador,
    A,
    factor_resto: factorResto,
    resto: A === null ? null : A * factorResto,
    A_tres_meses: den3 > 0 && k >= 1 ? v3 / den3 : null,
  };
}

// ─── Propuesta de una fila de tienda ───

export type EntradaFilaTienda = {
  /** `true` si es el año en curso (`Y`): hay meses reales hasta `k`. */
  esAnioEnCurso: boolean;
  /** `k` en `Y`; 0 en el año siguiente. */
  k: number;
  subbloque: Subbloque;
  /** Meses completos cerrados desde la apertura (solo en `Y`). */
  nCompletos: number;
  /** Real de la tienda en la fila, doce meses (ceros fuera de `k`). */
  real: readonly number[];
  curva: readonly number[] | null;
  /** `r_m` del año. */
  rampa: readonly number[];
  phi: readonly number[];
  /** `Md_f`: unidades maduras por fila (`null` sin venta esperada). */
  maduras: number | null;
  /** `A_{t,f}` implícito del año `Y` (solo año siguiente de una tienda que abrió en `Y`); `null` si no hay. */
  maduroPrevio: number | null;
  /** `g_f` en porcentaje. */
  crecimiento: number;
};

export type ResultadoFilaTienda = {
  vendido: number;
  propuesto: number | null;
  metodo: Metodo;
  /** Avance propio (año en curso): la cifra por venta esperada; con `apertura`: la cifra por avance propio. */
  referencia_alternativa: number | null;
  /** `A^{(3)}`, solo con `avance_propio`. */
  referencia_tres_meses: number | null;
  /** Total maduro por avance propio (`A_{t,f}`), cuando aplica. */
  maduro_propio: number | null;
  /** `V'` (vendido de `1..k` normalizado por el Niño) y `Σ c·r` de `1..k`: lo que dividen para dar `A` (solo con `avance_propio`). */
  vendido_normalizado: number | null;
  denominador: number | null;
  avisos: AvisoFila[];
};

const redondear = (x: number) => Math.max(0, Math.round(x));

/**
 * Regla 20 a 22. Propuesta de UNA fila de tienda nueva:
 *   - año en curso, `n ≥ 3` meses completos → `avance_propio` (resto por su propio avance con la rampa en el
 *     denominador), con los últimos tres meses y la venta esperada al lado;
 *   - año en curso, `n < 3` → `apertura`: vendido + venta esperada desde `k + 1`;
 *   - año siguiente de una tienda que abrió en `Y` → `maduro_propio`: `A_{t,f} × (1 + g) × Σ c_m r_m φ_m`;
 *   - año siguiente de una apertura → `apertura`: `Md_f × Σ c_m r_m φ_m`.
 */
export function proponerFilaTienda(e: EntradaFilaTienda): ResultadoFilaTienda {
  const vendido = e.esAnioEnCurso ? e.real.slice(0, e.k).reduce((a, b) => a + Math.max(0, b), 0) : 0;
  if (e.curva === null) {
    return { vendido, propuesto: null, metodo: "sin_propuesta", referencia_alternativa: null, referencia_tres_meses: null, maduro_propio: null, vendido_normalizado: null, denominador: null, avisos: ["sin_curva"] };
  }
  const curva = e.curva;
  const anioCompleto = sumaCurva(curva, e.rampa, e.phi, 0, 12);
  const porEsperada = e.maduras === null ? null : redondear(e.maduras * anioCompleto);

  if (!e.esAnioEnCurso) {
    if (e.subbloque === "nuevas_anterior" && e.maduroPrevio !== null) {
      const propuesto = redondear(e.maduroPrevio * (1 + e.crecimiento / 100) * anioCompleto);
      return { vendido, propuesto, metodo: "maduro_propio", referencia_alternativa: porEsperada, referencia_tres_meses: null, maduro_propio: e.maduroPrevio, vendido_normalizado: null, denominador: null, avisos: [] };
    }
    const avisos: AvisoFila[] = e.maduras === null ? ["sin_venta_esperada"] : [];
    return { vendido, propuesto: porEsperada, metodo: porEsperada === null ? "sin_propuesta" : "apertura", referencia_alternativa: null, referencia_tres_meses: null, maduro_propio: null, vendido_normalizado: null, denominador: null, avisos };
  }

  const propio = avancePropio({ serie: e.real, k: e.k, curva, rampa: e.rampa, factoresMes: e.phi });
  if (e.nCompletos >= MESES_MIN_AVANCE && propio.resto !== null) {
    return {
      vendido,
      propuesto: vendido + redondear(propio.resto),
      metodo: "avance_propio",
      referencia_alternativa: porEsperada,
      referencia_tres_meses: propio.A_tres_meses === null ? null : redondear(propio.A_tres_meses),
      maduro_propio: propio.A,
      vendido_normalizado: propio.vendido_normalizado,
      denominador: propio.denominador,
      avisos: [],
    };
  }

  // Menos de tres meses completos: por venta esperada desde k + 1; el avance propio queda como referencia.
  const alternativa = propio.resto !== null && vendido > 0 ? vendido + redondear(propio.resto) : null;
  if (e.maduras === null) {
    return { vendido, propuesto: null, metodo: "sin_propuesta", referencia_alternativa: alternativa, referencia_tres_meses: null, maduro_propio: propio.A, vendido_normalizado: null, denominador: null, avisos: ["sin_venta_esperada"] };
  }
  const resto = e.maduras * sumaCurva(curva, e.rampa, e.phi, e.k, 12);
  return { vendido, propuesto: vendido + redondear(resto), metodo: "apertura", referencia_alternativa: alternativa, referencia_tres_meses: null, maduro_propio: propio.A, vendido_normalizado: null, denominador: null, avisos: [] };
}

/**
 * Regla 22, la cuenta inversa: `A_{t,f} = vigente_{t,f,Y} ÷ Σ_{m∈Y} c_m r_m φ_m` (el total maduro implícito en lo
 * vigente de `Y`). Con `φ` de unos es la fórmula de la ficha.
 */
export function maduroDeVigente(args: {
  vigente: number | null;
  curva: readonly number[] | null;
  rampa: readonly number[];
  phi: readonly number[];
}): number | null {
  if (args.vigente === null || args.curva === null) return null;
  const den = sumaCurva(args.curva, args.rampa, args.phi, 0, 12);
  return den > 0 ? args.vigente / den : null;
}

/** Regla 22. `maduroSiguiente` = `A_{t,f} × (1 + g) × Σ_m c_m r_m φ_{Y+1,m}`. */
export function maduroSiguiente(args: {
  maduro: number;
  crecimiento: number;
  curva: readonly number[];
  rampa: readonly number[];
  phi: readonly number[];
}): number {
  return redondear(args.maduro * (1 + args.crecimiento / 100) * sumaCurva(args.curva, args.rampa, args.phi, 0, 12));
}

// ─── Decisión por tienda ───

export type FilaEscalable = {
  id: string;
  propuesto: number | null;
  /** Cifra fijada a mano para esa fila (opcional). */
  fijada: number | null;
  /** Peso de respaldo (la composición `s_f`) si ninguna fila tiene propuesta. */
  peso: number;
};

/**
 * Regla 23. Reparte el total decidido `D` de la tienda entre sus filas: las fijadas conservan su cifra y las demás
 * se escalan por `(D − Σ fijadas) ÷ Σ propuestas no fijadas`. Con `Σ fijadas > D` el resto queda en 0 y aviso
 * `fijadas_exceden`. La suma final es `D` (mayores restos).
 */
export function escalarTienda(
  filas: readonly FilaEscalable[],
  decidido: number
): { asignado: Map<string, number>; escaladas: Set<string>; avisos: AvisoFila[] } {
  const asignado = new Map<string, number>();
  const escaladas = new Set<string>();
  const avisos: AvisoFila[] = [];
  const D = Math.max(0, Math.round(decidido));

  let fijadas = 0;
  const libres: FilaEscalable[] = [];
  for (const f of filas) {
    if (f.fijada !== null) {
      asignado.set(f.id, f.fijada);
      fijadas += f.fijada;
    } else {
      libres.push(f);
    }
  }
  const resto = D - fijadas;
  if (resto < 0) avisos.push("fijadas_exceden");
  const repartible = Math.max(0, resto);

  const sumaPropuestas = libres.reduce((a, f) => a + Math.max(0, f.propuesto ?? 0), 0);
  const sumaPesos = libres.reduce((a, f) => a + Math.max(0, f.peso), 0);
  const pesos = libres.map((f) => (sumaPropuestas > 0 ? Math.max(0, f.propuesto ?? 0) : sumaPesos > 0 ? Math.max(0, f.peso) : 1));
  const reparto = repartirEntero(repartible, pesos) ?? [];
  libres.forEach((f, i) => {
    asignado.set(f.id, reparto[i] ?? 0);
    escaladas.add(f.id);
  });
  return { asignado, escaladas, avisos };
}

// ─── Perfil de una apertura histórica ───

/**
 * Regla 24. `ratio_j = (v_j ÷ c_j) ÷ A` para los seis primeros meses desde la apertura, con `A` el total maduro
 * desestacionalizado de los meses 7 a 12 (`Σ v ÷ Σ c`). `unidades` y `curva` van alineadas desde el mes de apertura
 * (la curva ya es la del mes calendario de cada posición). Con menos de doce meses posteriores a la apertura,
 * `null`. Informativo: orienta la rampa, no cambia ninguna cifra.
 */
export function perfilApertura(unidades: readonly number[], curva: readonly number[]): number[] | null {
  if (unidades.length < 12 || curva.length < 12) return null;
  let v = 0;
  let c = 0;
  for (let j = 6; j < 12; j++) {
    v += Math.max(0, unidades[j]);
    c += curva[j];
  }
  if (!(c > 0) || !(v > 0)) return null;
  const A = v / c;
  return Array.from({ length: 6 }, (_, j) => (curva[j] > 0 ? Math.max(0, unidades[j]) / curva[j] / A : 0));
}
