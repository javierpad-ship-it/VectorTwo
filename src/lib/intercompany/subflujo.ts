/**
 * Subflujo intercompany de una marca `B` dentro de la fila GML-AM de M8 (ficha 13, sección 5, reglas 5 y 7). Lógica PURA: vive
 * aquí para que la prueba sea compartida con M8, que la importa. Sin reloj (recibe los meses) y determinista.
 *
 *   D^B_m   = D_m × part_B                                   demanda COMPLETA de la marca
 *   R^B_m   = D^B_m × pct ÷ 100                              reposición directa esperada (ingreso, no recorte); R ≤ D siempre
 *   S^B_m   = S^B_{m−1} + I^B_m + R^B_m − D^B_m              stock completo, sin compras (puede ser negativo: no se recorta)
 *   VPM^B_m = Σ_{j=m+1}^{m+12} D^B_j ÷ 12                    venta promedio mensual de los doce meses siguientes
 *   imi^B_m = S^B_m ÷ VPM^B_m                                sobre la demanda completa
 *   obj^B_m = min_B × VPM^B_m      tope^B_m = max_B × VPM^B_m
 *   C^B_m   = max(0, obj^B_m − (S*^B_{m−1} + I^B_m + R^B_m − D^B_m))   secuencial: S* incluye las compras anteriores
 *   X^B_m   = max(0, S^B_m − tope^B_m)
 */

export type ReglaSubflujo = { imi_min: number; imi_max: number; pct_directo: number };

export type EntradaSubflujo = {
  /** Demanda de la FILA completa `D_m` por mes, desde el primer mes proyectado y con el horizonte para el `VPM` (12 meses más allá del último a calcular). */
  demanda: readonly number[];
  /** Participación de la marca en la fila (`part_B`, fracción 0–1). */
  parte: number;
  /** Stock completo de la marca en el último mes cerrado (`S^B_k`: CD + tiendas, sin restar lo que llegó directo). */
  stock_inicial: number;
  /** Ingresos `I^B_m` (líneas de M9 con marca `B` que caen en el GML, cualquier destino) por mes; falta = 0. */
  ingresos?: readonly number[];
  regla: ReglaSubflujo;
  /** Cuántos meses calcular (los primeros `n` de `demanda`); por defecto, todos. Los últimos meses del horizonte promedian los que queden (menos de doce). */
  meses?: number;
};

export type SenalSubflujo = "falta" | "ok" | "exceso" | "sin_demanda";

export type MesSubflujo = {
  /** Posición del mes (0 = primer mes proyectado). */
  indice: number;
  demanda: number;
  reposicion_directa: number;
  ingresos: number;
  /** `S^B_m` sin compras. */
  stock: number;
  vpm: number;
  /** `null` si el `VPM` es 0. */
  imi: number | null;
  objetivo: number;
  tope: number;
  /** `C^B_m`: lo que el CD debe aportar este mes. */
  compra: number;
  /** `S*^B_m`: el stock con las compras de este mes y los anteriores. */
  stock_con_compras: number;
  exceso: number;
  senal: SenalSubflujo;
};

const VENTANA_VPM = 12;

/** Regla 5: el subflujo de una marca intercompany mes a mes. */
export function subflujoIntercompany(e: EntradaSubflujo): MesSubflujo[] {
  const n = Math.min(e.demanda.length, e.meses ?? e.demanda.length);
  const dB = e.demanda.map((d) => d * e.parte);
  const salida: MesSubflujo[] = [];
  let stock = e.stock_inicial;
  let stockConCompras = e.stock_inicial;

  for (let m = 0; m < n; m++) {
    const reposicion = (dB[m] * e.regla.pct_directo) / 100;
    const ingresos = e.ingresos?.[m] ?? 0;
    stock = stock + ingresos + reposicion - dB[m];

    // `VPM` sobre los hasta doce meses siguientes que haya en el horizonte (con el horizonte completo es la fórmula exacta).
    const siguientes = dB.slice(m + 1, m + 1 + VENTANA_VPM);
    const vpm = siguientes.length === 0 ? 0 : siguientes.reduce((a, x) => a + x, 0) / siguientes.length;
    const imi = vpm > 0 ? stock / vpm : null;
    const objetivo = e.regla.imi_min * vpm;
    const tope = e.regla.imi_max * vpm;

    const sinCompra = stockConCompras + ingresos + reposicion - dB[m];
    const compra = Math.max(0, objetivo - sinCompra);
    stockConCompras = sinCompra + compra;

    salida.push({
      indice: m,
      demanda: dB[m],
      reposicion_directa: reposicion,
      ingresos,
      stock,
      vpm,
      imi,
      objetivo,
      tope,
      compra,
      stock_con_compras: stockConCompras,
      exceso: Math.max(0, stock - tope),
      senal: imi === null ? "sin_demanda" : imi < e.regla.imi_min ? "falta" : imi > e.regla.imi_max ? "exceso" : "ok",
    });
  }
  return salida;
}

/**
 * Regla 7 (la usa la conciliación de M8): `max(0, Ing − R) ÷ V`, el % directo observado como fracción 0–1; `null` si `V = 0`.
 * Informativo: nunca cambia la regla. Devuelve FRACCIÓN 0–1 (la unidad de la ficha 8, 4c); el contrato de M13
 * (`PctDirectoObservado.valor`) va en puntos 0–100: convertir con `armarPctDirectoObservado` de `reglas.ts`.
 */
export function pctDirectoObservado(ingresoInferido: number, reposicionEsperada: number, venta: number): number | null {
  if (venta === 0) return null;
  return Math.max(0, ingresoInferido - reposicionEsperada) / venta;
}
