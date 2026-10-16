import { formatearPuntos } from "@/lib/formato";
import { MESES_ANIO, normalizarCurva, sumar } from "./anios";
import { eat } from "./backtesting";
import type { AnioAjuste } from "./candidatas";
import { ETIQUETA_TEMPORADA, type DetalleF, type ExplicacionF, type ModeloCurva, type TemporadaAgrupacion } from "./tipos-api";

/**
 * Candidata `F · modelo avanzado` (docs/modulos/06c-curvas-composicion-y-curva-usuario.md,
 * "Candidata F (corregida)"). TypeScript puro y determinista: sin reloj, sin azar, sin
 * servicios externos (se comprueba en un test estático). Dos pasos, cada uno con lectura
 * en palabras:
 *
 *  1. Base por recencia: `b_m = Σ_Y w_Y · p_m(Y)` con `w_Y ∝ recencia^(n−k)` (`k` = posición
 *     del año, del más antiguo `1` al más reciente `n`).
 *  2. Contracción hacia la temporada (heurística con la forma de la contracción empírica; NO
 *     es James–Stein exacto): `q_m = (1 − λ)·b_m + λ·T_m` con `λ = ρ² ÷ (ρ² + n·δ²)`, donde `ρ`
 *     es el ruido entre años normales, `δ = EAT(b, T)` y `n` los años de ajuste.
 *
 * SIN suavizado (el revisor midió que empeora a `A` y aplana picos reales). Y sin fuga en el
 * backtesting: quien llama calcula `ρ` y `T` de cada pliegue solo con los años de
 * entrenamiento (`rhoDe(entrenamiento)` y `curvaTDe(años de la temporada, prueba)`).
 */

type AnioParaRuido = Pick<AnioAjuste, "anio" | "participacion"> & { normal?: boolean };

/**
 * Pesos `recencia^(n−k)` normalizados (suman 1), uno por año en orden ASCENDENTE de año
 * (no depende del orden de entrada). Con `recencia = 1` son iguales; con dos años y `0,75`,
 * `3/7` y `4/7`; con tres, `24 / 32 / 43 %`. Sin años, vacío.
 */
export function pesosRecencia(anios: readonly number[], recencia: number): number[] {
  const n = anios.length;
  if (n === 0) return [];
  const crudos = [...anios].sort((a, b) => a - b).map((_, i) => recencia ** (n - 1 - i));
  const total = sumar(crudos);
  return crudos.map((w) => w / total);
}

/**
 * `λ = ρ² ÷ (ρ² + n·δ²)` en `[0, 1]`. Casos límite definidos: sin `T` (`δ = null`) → `0`;
 * `δ = 0` (la base ya es `T`) → `1`; `δ > 0` y `ρ = 0` (o sin `ρ`) → `0`.
 */
export function lambdaContraccion(rho: number | null, delta: number | null, n: number): number {
  if (delta === null) return 0;
  if (delta <= 1e-12) return 1;
  if (rho === null || !(rho > 0)) return 0;
  const lambda = rho ** 2 / (rho ** 2 + n * delta ** 2);
  return Math.min(1, Math.max(0, lambda));
}

/**
 * Ruido `ρ` entre los años dados: EAT promedio entre pares de los años NORMALES (`normal !== false`);
 * con menos de dos normales, el promedio de EAT entre todos los pares; `null` con un solo año (o ninguno).
 * Para el pliegue se llama solo con los años de entrenamiento: nunca ve el año de prueba.
 */
export function rhoDe(anios: readonly AnioParaRuido[]): number | null {
  const ordenados = [...anios].sort((a, b) => a.anio - b.anio);
  const normales = ordenados.filter((a) => a.normal !== false);
  const base = normales.length >= 2 ? normales : ordenados;
  if (base.length < 2) return null;
  const pares: number[] = [];
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) pares.push(eat(base[i].participacion, base[j].participacion));
  }
  return sumar(pares) / pares.length;
}

/**
 * `F`. `ajuste` son los años de ajuste (ya con el tratamiento del Niño aplicado); `rho` el ruido entre años
 * normales (`rhoDe`); `t` la curva de la temporada (`null` si no tiene serie: no contrae); `recencia` en
 * `[0,5, 1]`. Devuelve la curva (seis decimales, suma 1) y el detalle que la reproduce paso a paso
 * (`por_pliegue` vacío: lo llena el backtesting); `null` sin años de ajuste.
 */
export function curvaF(
  ajuste: readonly Pick<AnioAjuste, "anio" | "participacion">[],
  rho: number | null,
  t: readonly number[] | null,
  recencia: number
): { curva: number[]; detalle: DetalleF } | null {
  if (ajuste.length === 0) return null;
  const orden = [...ajuste].sort((a, b) => a.anio - b.anio);
  const pesos = pesosRecencia(
    orden.map((a) => a.anio),
    recencia
  );
  const base = Array.from({ length: MESES_ANIO }, () => 0);
  orden.forEach((a, i) => {
    for (let m = 0; m < MESES_ANIO; m++) base[m] += pesos[i] * a.participacion[m];
  });
  const delta = t === null ? null : eat(base, t);
  const lambda = lambdaContraccion(rho, delta, orden.length);
  const contraida = base.map((b, m) => (t === null ? b : (1 - lambda) * b + lambda * t[m]));
  const curva = normalizarCurva(contraida);
  return {
    curva,
    detalle: {
      pesos_anios: orden.map((a, i) => ({ anio: a.anio, peso: pesos[i] })),
      rho: rho ?? 0,
      delta,
      lambda,
      t_usada: t === null ? null : [...t],
      base: normalizarCurva(base),
      contraida: curva,
      por_pliegue: [],
    },
  };
}

// ─── Explicación en palabras del planner ───

const porcentaje = (x: number) => `${Math.round(x * 100)} %`;

function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Lo que el backtesting dice de `F`, para cerrar la explicación. */
export type EvaluacionF = {
  eat: number | null;
  pruebas: number;
  eat_a: number | null;
  margen: number | null;
  /** La candidata que el sistema recomienda. */
  recomendada: ModeloCurva | null;
};

/**
 * La frase que se lee debajo de la fila `F` (es-PE, `formatearPuntos`):
 * "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque
 * sus años normales difieren 5.3 pp entre sí y su curva está a 4.8 pp de la de la temporada. Se equivoca 5.1 pp
 * en 3 pruebas frente a 4.0 de A; no mejora a A: se recomienda A."
 * Sin `T`: "no contrae: la temporada no tiene serie"; con `λ ≥ 0,9`: "casi es la curva de la temporada…"; con
 * dos años de ajuste: "se muestra pero no compite…". `evaluacion` es opcional (la pone `proponer` cuando
 * ya conoce la recomendación).
 */
export function explicarF(detalle: DetalleF, temporada: TemporadaAgrupacion | null, n: number, evaluacion?: EvaluacionF): string {
  const pesos = detalle.pesos_anios.map((p) => `${p.anio} (${porcentaje(p.peso)})`);
  const nombreTemporada = temporada === null ? "su temporada" : ETIQUETA_TEMPORADA[temporada].toLowerCase();
  let contraccion: string;
  if (detalle.t_usada === null) {
    contraccion = "no contrae: la temporada no tiene serie";
  } else if (detalle.lambda >= 0.9) {
    contraccion = `contrae un ${porcentaje(detalle.lambda)} hacia la curva de ${nombreTemporada} (T): casi es la curva de la temporada, esta agrupación aporta pocos datos frente a su ruido`;
  } else if (Math.round(detalle.lambda * 100) === 0) {
    contraccion = `no contrae hacia la curva de ${nombreTemporada} (T): sus años normales difieren ${formatearPuntos(detalle.rho)} pp entre sí y su curva ya está a ${formatearPuntos(detalle.delta ?? 0)} pp de la de la temporada`;
  } else {
    contraccion = `contrae un ${porcentaje(detalle.lambda)} hacia la curva de ${nombreTemporada} (T) porque sus años normales difieren ${formatearPuntos(detalle.rho)} pp entre sí y su curva está a ${formatearPuntos(detalle.delta ?? 0)} pp de la de la temporada`;
  }
  let frase = `F se apoya en ${enumerar(pesos)}; ${contraccion}.`;
  if (n === 2) {
    frase += " F se muestra pero no compite: con un solo año de entrenamiento por prueba no hay backtesting honesto.";
  }
  if (evaluacion && evaluacion.eat !== null && evaluacion.pruebas > 0) {
    const base = `Se equivoca ${formatearPuntos(evaluacion.eat)} pp en ${evaluacion.pruebas} ${evaluacion.pruebas === 1 ? "prueba" : "pruebas"}`;
    const cierre = evaluacion.recomendada ? `: se recomienda ${evaluacion.recomendada}.` : ".";
    if (evaluacion.eat_a === null) {
      frase += ` ${base}${evaluacion.recomendada ? `. Se recomienda ${evaluacion.recomendada}.` : "."}`;
    } else if (evaluacion.eat >= evaluacion.eat_a) {
      frase += ` ${base} frente a ${formatearPuntos(evaluacion.eat_a)} de A; no mejora a A${cierre}`;
    } else {
      const gana = evaluacion.eat_a - evaluacion.eat;
      const margen = evaluacion.margen === null ? "" : ` (${formatearPuntos(evaluacion.margen)})`;
      const llega = evaluacion.recomendada === "F";
      frase += ` ${base} frente a ${formatearPuntos(evaluacion.eat_a)} de A; mejora a A en ${formatearPuntos(gana)} pp${llega ? `, más que el margen${margen}` : `, pero no llega al margen${margen}`}${cierre}`;
    }
  }
  return frase;
}

/** `explicacion_f` a partir del detalle y la frase ya armada. */
export function armarExplicacionF(detalle: DetalleF, frase: string): ExplicacionF {
  return {
    anios: detalle.pesos_anios,
    rho: detalle.rho,
    delta: detalle.delta,
    lambda: detalle.lambda,
    frase,
    por_pliegue: detalle.por_pliegue,
  };
}
