import { subflujoIntercompany, type MesSubflujo } from "@/lib/intercompany/subflujo";
import { MESES_VPM } from "./tipos";
import { ORDEN_SENAL, type Senal } from "./tipos-api";

/**
 * IMI, VPM, saldo, exceso y señales (ficha 08, §3 y reglas 5, 6, 7, 27 y 28). Pura y determinista; todo en flotante, el redondeo es de
 * quien serializa o muestra (§0.15).
 *
 *   VPM_m  = Σ_{j=m+1}^{m+12} D_j ÷ 12      promedio de la demanda de los doce meses siguientes (extendida más allá del horizonte)
 *   imi_m  = S_m ÷ VPM_m                    `S ≤ 0` → 0; `VPM = 0` → nulo
 *   obj_m  = MIN × VPM_m     tope_m = MAX × VPM_m
 *   C_m    = max(0, obj_m − (S*_{m−1} + I_m − D_m)),  S*_m = S*_{m−1} + I_m + C_m − D_m      saldo por comprar, secuencial
 *   X_m    = max(0, S_m − tope_m)           exceso sobre el stock SIN sugerencias
 *
 * UNA SOLA ARITMÉTICA (§0.2 #14): `proyectarFila` es una envoltura de `subflujoIntercompany` de M13 con `parte = 1` y
 * `pct_directo = 0`; M8 no la copia.
 */

export type RangoImi = { imi_min: number; imi_max: number };

/** Promedio de `demanda[indice+1 … indice+12]` (con `indice = −1`, el VPM de `k'`); divide por los meses que haya. 0 si no hay ninguno. */
export function vpm(demanda: readonly number[], indice: number): number {
  const siguientes = demanda.slice(Math.max(0, indice + 1), Math.max(0, indice + 1 + MESES_VPM));
  return siguientes.length === 0 ? 0 : siguientes.reduce((a, x) => a + x, 0) / siguientes.length;
}

/** `S ÷ VPM`, con `S ≤ 0` → 0 y `VPM ≤ 0` → `null` (`sin_demanda`). */
export function imi(stock: number, vpmValor: number): number | null {
  if (!(vpmValor > 0)) return null;
  return stock <= 0 ? 0 : stock / vpmValor;
}

/** `true` si el IMI (sin sugerencias) sale de `[MIN, MAX]`; sin IMI (sin demanda) no hay alerta. */
export function fueraDeRango(imiValor: number | null, rango: RangoImi): boolean {
  return imiValor !== null && (imiValor < rango.imi_min || imiValor > rango.imi_max);
}

/**
 * Extiende la demanda `meses` más allá del horizonte repitiendo los últimos doce meses proyectados (con menos de doce, la serie en
 * ciclo). Sin extender, devuelve la demanda tal cual y el VPM de los últimos meses promedia los que queden.
 */
export function extenderDemanda(demanda: readonly number[], extender: boolean): number[] {
  const n = demanda.length;
  const ext = [...demanda];
  if (!extender || n === 0) return ext;
  for (let j = n; j < n + MESES_VPM; j++) ext.push(n >= MESES_VPM ? ext[j - MESES_VPM] : demanda[j % n]);
  return ext;
}

/** `true` si el VPM del mes `indice` (0 = `k'+1`) usó demanda repetida más allá del horizonte de `n` meses. */
export const usaExtension = (indice: number, n: number, extender: boolean): boolean => extender && indice + MESES_VPM > n - 1;

export type EntradaProyeccion = {
  /** Demanda de la fila de `k'+1 … H`, con la extensión ya aplicada si corresponde (`extenderDemanda`). */
  demanda: readonly number[];
  /** Meses a calcular (los primeros `n` de `demanda`). */
  n: number;
  stock_inicial: number;
  ingresos?: readonly number[];
  rango: RangoImi;
};

/** `proyectarFila`: el flujo de una fila (o del resto de una fila) sin reposición directa, con la aritmética de M13. */
export function proyectarFila(e: EntradaProyeccion): MesSubflujo[] {
  return subflujoIntercompany({
    demanda: e.demanda,
    parte: 1,
    stock_inicial: e.stock_inicial,
    ingresos: e.ingresos,
    regla: { imi_min: e.rango.imi_min, imi_max: e.rango.imi_max, pct_directo: 0 },
    meses: e.n,
  });
}

/**
 * La señal de un mes (M8 NO usa la `senal` de M13): `quiebre` ⇔ `S < 0`; `falta` ⇔ `C > 0` (así la señal y el saldo dicen lo mismo);
 * `exceso` ⇔ `X > 0`; si no, `al_dia`. `sin_demanda` (demanda 0 en todo el horizonte) y `sin_curva` mandan sobre el resto.
 */
export function senalMes(mes: { stock: number; compra: number; exceso: number }, opciones: { sinDemanda?: boolean; sinCurva?: boolean } = {}): Senal {
  if (opciones.sinCurva) return "sin_curva";
  if (opciones.sinDemanda) return "sin_demanda";
  if (mes.stock < 0) return "quiebre";
  if (mes.compra > 0) return "falta";
  if (mes.exceso > 0) return "exceso";
  return "al_dia";
}

/** La más grave: `quiebre` > `falta` > `exceso` > `al_dia`; `sin_demanda` y `sin_curva` se muestran aparte (van al final). */
export function peorSenal(senales: readonly Senal[]): Senal {
  return senales.reduce<Senal>((peor, s) => (ORDEN_SENAL[s] < ORDEN_SENAL[peor] ? s : peor), "sin_curva");
}
