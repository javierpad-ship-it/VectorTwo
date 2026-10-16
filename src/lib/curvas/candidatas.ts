import { MODELOS_PROPIOS, RECENCIA_F, type DetalleF, type ModeloCurva, type ModeloPropio } from "./tipos-api";
import { MESES_ANIO, normalizarCurva, participacion, sumar } from "./anios";
import { curvaF, rhoDe } from "./avanzada";

/**
 * Candidatas propias `A` a `F` (docs/modulos/06-curvas-estacionalidad.md,
 * "Paso 2" y reglas 11 y 12b; `F`, el modelo avanzado, en `avanzada.ts` y la 06c). Funciones puras. Cada una devuelve una curva de
 * doce participaciones que suma exactamente 1 (`normalizarCurva`) o `null` con
 * su motivo. SOLO reciben los años de ajuste (un año `escaso` no mueve `A`: lo
 * garantiza quien llama, y un test lo comprueba de punta a punta).
 *
 * `T` (curva de la temporada, prestada) no se calcula aquí: es `A` sobre la
 * serie agregada de la temporada, así que `modelo.ts` la arma con `curvaA`.
 */

/** Un año de ajuste tal como lo ven las candidatas. */
export type AnioAjuste = {
  anio: number;
  /** Participación del año usada en el ajuste (tal cual o imputada); suma 1. */
  participacion: readonly number[];
  /** Unidades totales del año sobre la red (el peso de `B`; para años imputados, las de la medida real). */
  unidades_total: number;
  /** Unidades mensuales de cada tienda de la red en ESTA agrupación (12 por tienda); solo lo usa `E`. */
  tiendas: ReadonlyArray<readonly number[]>;
  /**
   * 06c. El año es `normal` (sin meses atípicos): solo lo usa `rhoDe` para el ruido de `F`. Sin dato se
   * toma como normal.
   */
  normal?: boolean;
};

export type CandidataCruda = {
  modelo: ModeloPropio;
  curva: number[] | null;
  motivo: string | null;
  /** Solo `F` con curva. */
  detalle_f?: DetalleF;
};

function ordenarPorAnio(anios: readonly AnioAjuste[]): AnioAjuste[] {
  return [...anios].sort((a, b) => a.anio - b.anio);
}

/** Media ponderada de las participaciones (sin normalizar); `null` sin años o con pesos sin suma. */
function mediaPonderada(curvas: ReadonlyArray<readonly number[]>, pesos: readonly number[]): number[] | null {
  const total = sumar(pesos);
  if (curvas.length === 0 || !(total > 0)) return null;
  const salida = Array.from({ length: MESES_ANIO }, () => 0);
  curvas.forEach((c, i) => {
    for (let m = 0; m < MESES_ANIO; m++) salida[m] += (c[m] * pesos[i]) / total;
  });
  return salida;
}

/** `A`. Promedio simple de la participación de cada año. */
export function curvaA(anios: readonly AnioAjuste[]): number[] | null {
  const media = mediaPonderada(
    anios.map((a) => a.participacion),
    anios.map(() => 1)
  );
  return media && normalizarCurva(media);
}

/** `B`. `Σ_Y u_m(Y) ÷ Σ_Y Σ_k u_k(Y)`: los años grandes pesan más (en años imputados, medidas reescaladas). */
export function curvaB(anios: readonly AnioAjuste[]): number[] | null {
  const media = mediaPonderada(
    anios.map((a) => a.participacion),
    anios.map((a) => a.unidades_total)
  );
  return media && normalizarCurva(media);
}

/** `C`. Pesos `1, 2, …, n` del año más antiguo al más reciente. */
export function curvaC(anios: readonly AnioAjuste[]): number[] | null {
  const orden = ordenarPorAnio(anios);
  const media = mediaPonderada(
    orden.map((a) => a.participacion),
    orden.map((_, i) => i + 1)
  );
  return media && normalizarCurva(media);
}

/** Pesos de la media móvil circular de tres meses (anterior, propio, siguiente). */
export const PESOS_SUAVIZADO = [0.25, 0.5, 0.25] as const;

/** `D`. `A` con media móvil circular de tres meses (diciembre y enero son vecinos), renormalizada. */
export function curvaD(anios: readonly AnioAjuste[]): number[] | null {
  const base = mediaPonderada(
    anios.map((a) => a.participacion),
    anios.map(() => 1)
  );
  if (!base) return null;
  const suave = base.map(
    (_, m) =>
      PESOS_SUAVIZADO[0] * base[(m + MESES_ANIO - 1) % MESES_ANIO] +
      PESOS_SUAVIZADO[1] * base[m] +
      PESOS_SUAVIZADO[2] * base[(m + 1) % MESES_ANIO]
  );
  return normalizarCurva(suave);
}

export const MOTIVO_SIN_TIENDAS_VALIDAS = "sin_tiendas_validas";

/**
 * `E`. Por año, la media simple de la participación de cada tienda con al menos
 * `minUnidadesAno` unidades en la agrupación; `E` es `A` sobre esas curvas anuales
 * (los años sin ninguna tienda válida no aportan). Sin ninguna → `null`.
 */
export function curvaE(anios: readonly AnioAjuste[], minUnidadesAno: number): number[] | null {
  const porAnio: number[][] = [];
  for (const a of anios) {
    const curvas: number[][] = [];
    for (const unidades of a.tiendas) {
      if (sumar(unidades) < minUnidadesAno) continue;
      const p = participacion(unidades);
      if (p) curvas.push(p);
    }
    const media = mediaPonderada(
      curvas,
      curvas.map(() => 1)
    );
    if (media) porAnio.push(media);
  }
  const final = mediaPonderada(
    porAnio,
    porAnio.map(() => 1)
  );
  return final && normalizarCurva(final);
}

/**
 * Lo que `F` necesita además de los años: el peso de la recencia, la curva de la temporada a la que
 * contrae (`null` = sin serie: no contrae) y el ruido `ρ` entre años normales. En el backtesting los dos
 * últimos se calculan SOLO con los años de entrenamiento de cada pliegue (sin fuga).
 */
export type OpcionesAvanzada = { recencia: number; t: readonly number[] | null; rho: number | null };

/**
 * Las seis candidatas propias, en el orden de desempate `A, B, C, D, E, F`. Sin `avanzada`, `F` se
 * calcula sin `T` (`λ = 0`: la base por recencia) y con el ruido de los propios años.
 */
export function calcularCandidatas(anios: readonly AnioAjuste[], minUnidadesAno: number, avanzada?: OpcionesAvanzada): CandidataCruda[] {
  const opciones = avanzada ?? { recencia: RECENCIA_F, t: null, rho: rhoDe(anios) };
  const f = curvaF(anios, opciones.rho, opciones.t, opciones.recencia);
  const curvas: Record<ModeloPropio, number[] | null> = {
    A: curvaA(anios),
    B: curvaB(anios),
    C: curvaC(anios),
    D: curvaD(anios),
    E: curvaE(anios, minUnidadesAno),
    F: f?.curva ?? null,
  };
  return MODELOS_PROPIOS.map((modelo) => ({
    modelo,
    curva: curvas[modelo],
    motivo: curvas[modelo] === null ? (modelo === "E" ? MOTIVO_SIN_TIENDAS_VALIDAS : "sin_anos_ajuste") : null,
    ...(modelo === "F" && f ? { detalle_f: f.detalle } : {}),
  }));
}

/**
 * Tolerancia para decir que dos curvas son la misma. La ficha dice `max |Δp| < 1e-6`;
 * como cada curva ya está redondeada a seis decimales (y su mes mayor ajustado para
 * sumar 1), dos curvas matemáticamente iguales pueden diferir unas millonésimas por
 * el redondeo, así que se tolera 5e-6.
 */
export const TOLERANCIA_IGUAL = 5e-6;

/**
 * Regla 12b. Una candidata cuya curva es idéntica a la de otra ANTERIOR en el
 * orden de desempate recibe `igual_a` (la primera que la repite); la pantalla la
 * muestra como "Igual a A". Las candidatas sin curva y la primera nunca la llevan.
 * Desde la 06c acepta también `T` (siempre la última: su igual es siempre una propia).
 */
export function marcarIguales(
  candidatas: ReadonlyArray<{ modelo: ModeloCurva; curva: readonly number[] | null }>
): Map<ModeloCurva, ModeloPropio> {
  const iguales = new Map<ModeloCurva, ModeloPropio>();
  candidatas.forEach((c, i) => {
    if (!c.curva) return;
    for (let j = 0; j < i; j++) {
      const otra = candidatas[j];
      if (!otra.curva) continue;
      let max = 0;
      for (let m = 0; m < MESES_ANIO; m++) max = Math.max(max, Math.abs(c.curva[m] - otra.curva[m]));
      if (max < TOLERANCIA_IGUAL) {
        iguales.set(c.modelo, otra.modelo as ModeloPropio);
        return;
      }
    }
  });
  return iguales;
}
