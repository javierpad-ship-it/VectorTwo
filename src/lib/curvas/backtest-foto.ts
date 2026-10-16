import { redondear, sumar } from "./anios";
import { backtest, promediarPliegues } from "./backtesting";
import { curvaF, rhoDe } from "./avanzada";
import { TOLERANCIA_IGUAL, curvaA, type AnioAjuste } from "./candidatas";
import { ajustarFPliegue, curvaTDe, recomendar, type CandidataParaRecomendar } from "./modelo";
import type { AgrupacionResultado, ModeloCurva, ParametrosCurvas, TemporadaResultado } from "./tipos-api";

/**
 * Backtest OFFLINE de una foto de aprobación (docs/modulos/06c-curvas-composicion-y-curva-usuario.md,
 * "Backtest offline reproducible", condición de aceptación de la entrega). Funciones puras que usan igual el
 * script `scripts/backtest-fotos.ts` (sobre las fotos reales de `vector-two`) y la prueba de CI
 * (`tests/curvas.avanzada.backtest.test.ts`, sobre agrupaciones sintéticas).
 *
 * De cada foto toma `resultado.agrupaciones[0].anios` (participaciones usadas, clases y `en_ajuste`) y la serie
 * de su temporada (`resultado.temporadas`), y recalcula dejando un año fuera `A`, `F` (con `ρ` y `T` del
 * pliegue solo de entrenamiento) y `T`, el margen y la recomendación, con las funciones puras del módulo.
 * El criterio es la HONESTIDAD del sistema, no que `F` gane.
 */

export type FotoParaBacktest = {
  /** `resultado.agrupaciones[0]`. */
  agrupacion: Pick<AgrupacionResultado, "anios" | "candidatas" | "ruido_normal">;
  /** La serie de su temporada (`resultado.temporadas` de su temporada); `null` si la foto no la trae. */
  temporada: Pick<TemporadaResultado, "anios" | "curva_T"> | null;
  parametros: Pick<ParametrosCurvas, "margen_ruido" | "recencia_f">;
};

type AnioFoto = { anio: number; clase: string; en_ajuste: boolean; participacion: number[] | null; unidades: number };

function aAnioAjuste(a: AnioFoto): AnioAjuste {
  return { anio: a.anio, participacion: a.participacion as number[], unidades_total: a.unidades, tiendas: [], normal: a.clase === "normal" };
}

/** Los años de ajuste (con participación) de una lista de años de foto. */
export function aniosAjusteDeFoto(anios: readonly AnioFoto[]): AnioAjuste[] {
  return anios.filter((a) => a.en_ajuste && a.participacion).map(aAnioAjuste).sort((x, y) => x.anio - y.anio);
}

/** Inclina la participación de un año (el mes mayor ×1,1) y la renormaliza: la misma venta total, otra forma. */
export function perturbarParticipacion(p: readonly number[]): number[] {
  let mayor = 0;
  for (let m = 1; m < p.length; m++) if (p[m] > p[mayor]) mayor = m;
  const inclinada = p.map((x, m) => (m === mayor ? x * 1.1 : x));
  const total = sumar(inclinada);
  return inclinada.map((x) => x / total);
}

export type PliegueBacktest = {
  anio_prueba: number;
  rho: number;
  lambda: number;
  eat_f: number;
  /** `ρ`, `λ` y la curva de `F` de este pliegue NO cambiaron al perturbar el año de prueba (en `F` y en la serie de la temporada). */
  sin_fuga: boolean;
};

export type ResultadoBacktestFoto = {
  anios_ajuste: number[];
  ruido_normal: number | null;
  margen: number | null;
  /** (a) La `A` recalculada coincide con la `A` de la foto (`TOLERANCIA_IGUAL`). */
  a_coincide: boolean | null;
  /** (a) y su EAT coincide con `candidatas[A].eat` a dos decimales. */
  eat_a_coincide: boolean | null;
  eat_a: number | null;
  eat_f: number | null;
  eat_t: number | null;
  pruebas_f: number;
  pruebas_t: number;
  recomendada: ModeloCurva | null;
  motivo: string | null;
  /** (b) `F` o `T` quedó recomendada sin ganar a `A` por más del margen. */
  viola_margen: boolean;
  /** (c) por pliegue. */
  pliegues: PliegueBacktest[];
  /** (c) en todos los pliegues. */
  sin_fuga: boolean;
};

/** Pliegues de `F` y `T` y la recomendación recalculada de una foto. */
export function backtestDeFoto(foto: FotoParaBacktest): ResultadoBacktestFoto {
  const ajuste = aniosAjusteDeFoto(foto.agrupacion.anios);
  const aniosTemporada = foto.temporada ? aniosAjusteDeFoto(foto.temporada.anios) : [];
  const nums = ajuste.map((a) => a.anio);
  const recencia = foto.parametros.recencia_f;
  const realDe = (anio: number) => ajuste.find((a) => a.anio === anio)?.participacion.slice() ?? null;
  const pruebaDe = (entrenamiento: readonly number[]) => nums.find((n) => !entrenamiento.includes(n));

  // A completa y su backtesting.
  const aCompleta = ajuste.length > 0 ? curvaA(ajuste) : null;
  const aFoto = foto.agrupacion.candidatas.find((c) => c.modelo === "A") ?? null;
  const porPliegueA = backtest(nums, (entrenamiento) => curvaA(ajuste.filter((a) => entrenamiento.includes(a.anio))), realDe);
  const promedioA = promediarPliegues(porPliegueA);
  let aCoincide: boolean | null = null;
  if (aCompleta && aFoto?.curva) {
    aCoincide = aCompleta.every((v, m) => Math.abs(v - (aFoto.curva as number[])[m]) < TOLERANCIA_IGUAL);
  }
  // "A dos decimales": las participaciones de la foto vienen redondeadas a seis decimales, así que el EAT puede
  // moverse unas milésimas contra el de la foto; se tolera hasta una centésima en vez de comparar el redondeo.
  const eatACoincide = promedioA && aFoto && aFoto.eat !== null ? Math.abs(redondear(promedioA.eat, 2) - redondear(aFoto.eat, 2)) <= 0.01 : null;

  // F: ρ y T de cada pliegue solo con el entrenamiento.
  const curvaT = foto.temporada?.curva_T ?? curvaTDe(aniosTemporada);
  const ajustarF = (entrenamiento: readonly number[]) => {
    const prueba = pruebaDe(entrenamiento);
    return prueba === undefined ? null : ajustarFPliegue({ ajuste, aniosTemporada, entrenamiento, prueba, recencia });
  };
  const porPliegueF = backtest(nums, (entrenamiento) => ajustarF(entrenamiento)?.curva ?? null, realDe);
  const promedioF = promediarPliegues(porPliegueF);

  // T: la T de la temporada sin el año de prueba.
  const porPliegueT = backtest(
    nums,
    (entrenamiento) => {
      const prueba = pruebaDe(entrenamiento);
      return prueba === undefined ? null : curvaTDe(aniosTemporada, prueba);
    },
    realDe
  );
  const promedioT = promediarPliegues(porPliegueT);

  // (c) Perturbar el año de prueba (en el ajuste y en la serie de la temporada) no cambia ρ, λ ni la curva de F del pliegue.
  const pliegues: PliegueBacktest[] = porPliegueF.map((pl) => {
    const entrenamiento = nums.filter((n) => n !== pl.anio);
    const normal = ajustarF(entrenamiento);
    const perturba = (lista: readonly AnioAjuste[]) => lista.map((a) => (a.anio === pl.anio ? { ...a, participacion: perturbarParticipacion(a.participacion), unidades_total: a.unidades_total * 1.1 } : a));
    const distinta = ajustarFPliegue({ ajuste: perturba(ajuste), aniosTemporada: perturba(aniosTemporada), entrenamiento, prueba: pl.anio, recencia });
    const igual = !!normal && !!distinta && normal.detalle.rho === distinta.detalle.rho && normal.detalle.lambda === distinta.detalle.lambda && normal.curva.every((v, m) => v === distinta.curva[m]);
    return { anio_prueba: pl.anio, rho: normal?.detalle.rho ?? 0, lambda: normal?.detalle.lambda ?? 0, eat_f: pl.eat, sin_fuga: igual };
  });

  // Recomendación con las funciones del módulo: B…E tal como salieron en la foto; A, F y T recalculadas.
  const candidatas: CandidataParaRecomendar[] = foto.agrupacion.candidatas
    .filter((c) => !["A", "F", "T"].includes(c.modelo))
    .map((c) => ({ modelo: c.modelo, curva: c.curva, eat: c.eat }));
  if (aCompleta) candidatas.push({ modelo: "A", curva: aCompleta, eat: promedioA?.eat ?? null });
  // `F` con todos los años de ajuste (la que se muestra), con el ruido de esos años y la `T` completa.
  const fCompleta = ajuste.length >= 2 ? curvaF(ajuste, rhoDe(ajuste), curvaT, recencia) : null;
  if (fCompleta) candidatas.push({ modelo: "F", curva: fCompleta.curva, eat: promedioF?.eat ?? null });
  if (curvaT) candidatas.push({ modelo: "T", curva: curvaT, eat: promedioT?.eat ?? null });
  const rec = recomendar(candidatas, foto.agrupacion.ruido_normal, foto.parametros.margen_ruido);
  const eatDe = (m: ModeloCurva | null) => candidatas.find((c) => c.modelo === m)?.eat ?? null;
  const eatA = eatDe("A");
  const eatRec = eatDe(rec.recomendada);
  const violaMargen = (rec.recomendada === "F" || rec.recomendada === "T") && rec.motivo === "menor_error" && (eatRec === null || eatA === null || rec.margen === null || eatRec >= eatA - rec.margen);

  return {
    anios_ajuste: nums,
    ruido_normal: foto.agrupacion.ruido_normal,
    margen: rec.margen,
    a_coincide: aCoincide,
    eat_a_coincide: eatACoincide,
    eat_a: promedioA?.eat ?? null,
    eat_f: promedioF?.eat ?? null,
    eat_t: promedioT?.eat ?? null,
    pruebas_f: porPliegueF.length,
    pruebas_t: porPliegueT.length,
    recomendada: rec.recomendada,
    motivo: rec.motivo,
    viola_margen: violaMargen,
    pliegues,
    sin_fuga: pliegues.every((p) => p.sin_fuga),
  };
}

export type ResumenBacktest = {
  fotos: number;
  gana_a: number;
  gana_f: number;
  gana_t: number;
  otra: number;
  sin_recomendacion: number;
  ruido_minimo: number | null;
  ruido_maximo: number | null;
  /** (a) fotos cuya `A` o cuyo EAT de `A` no coincide con el de la foto. */
  a_no_coincide: number;
  /** (b) fotos con `F` o `T` recomendada sin ganar por más del margen. */
  violan_margen: number;
  /** (c) fotos con fuga. */
  con_fuga: number;
  /** `F` con menor EAT que `A` (aunque no se recomiende) y `T` con menor EAT que `A`. */
  f_menor_que_a: number;
  t_menor_que_a: number;
  cumple: boolean;
};

/** La tabla agregada (sin nombres de agrupaciones): cuántas gana cada una, ruido mínimo y máximo y los tres criterios. */
export function resumirBacktest(resultados: readonly ResultadoBacktestFoto[]): ResumenBacktest {
  const ruidos = resultados.map((r) => r.ruido_normal).filter((x): x is number => x !== null);
  const cuenta = (m: ModeloCurva) => resultados.filter((r) => r.recomendada === m).length;
  const gana_a = cuenta("A");
  const gana_f = cuenta("F");
  const gana_t = cuenta("T");
  const a_no_coincide = resultados.filter((r) => r.a_coincide === false || r.eat_a_coincide === false).length;
  const violan_margen = resultados.filter((r) => r.viola_margen).length;
  const con_fuga = resultados.filter((r) => !r.sin_fuga).length;
  return {
    fotos: resultados.length,
    gana_a,
    gana_f,
    gana_t,
    otra: resultados.filter((r) => r.recomendada !== null && !["A", "F", "T"].includes(r.recomendada)).length,
    sin_recomendacion: resultados.filter((r) => r.recomendada === null).length,
    ruido_minimo: ruidos.length > 0 ? Math.min(...ruidos) : null,
    ruido_maximo: ruidos.length > 0 ? Math.max(...ruidos) : null,
    a_no_coincide,
    violan_margen,
    con_fuga,
    f_menor_que_a: resultados.filter((r) => r.eat_f !== null && r.eat_a !== null && r.eat_f < r.eat_a).length,
    t_menor_que_a: resultados.filter((r) => r.eat_t !== null && r.eat_a !== null && r.eat_t < r.eat_a).length,
    cumple: a_no_coincide === 0 && violan_margen === 0 && con_fuga === 0,
  };
}
