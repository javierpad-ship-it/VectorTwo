import { MESES_ANIO, redondear, sumar } from "./anios";
import { tiendasComunes } from "./red";
import {
  TEMPORADAS_AGRUPACION,
  type AvisoCurva,
  type ClaseAnioCurva,
  type CrecimientoNormal,
  type EfectoAtipicoCorrida,
  type EfectoTemporadaAnio,
  type MesPeriodoEfectoApi,
  type PeriodoEfectoApi,
  type RedAnio,
  type TemporadaAgrupacion,
  type TemporadaORed,
  type VeredictoForma,
} from "./tipos-api";

/**
 * Efecto de un periodo atípico en el VOLUMEN (docs/modulos/06-curvas-estacionalidad.md,
 * "Efecto de un periodo atípico", reglas 8d a 8f). Funciones puras.
 *
 * El volumen se mide sobre TIENDAS COMUNES (`red(Y) ∩ red(N)`) frente al año
 * normal más cercano `N`: las cifras en crudo (todas las tiendas) mezclan el
 * efecto del año con la entrada y salida de tiendas.
 */

// ─── Reglas 8d y 8e ───

/** Regla 8d. `Σ_{m∈M} u_Y,m ÷ Σ_{m∈M} u_N,m` con `M` los meses de la máscara; `null` si la referencia es 0. */
export function ratioVolumen(
  unidadesAnio: readonly number[],
  unidadesReferencia: readonly number[],
  meses: readonly boolean[]
): number | null {
  let y = 0;
  let n = 0;
  let hay = false;
  for (let m = 0; m < MESES_ANIO; m++) {
    if (!meses[m]) continue;
    hay = true;
    y += unidadesAnio[m];
    n += unidadesReferencia[m];
  }
  if (!hay || !(n > 0)) return null;
  return y / n;
}

/** Regla 8d. Ratio mes a mes; `null` donde el mes no está en la máscara o la referencia vale 0. */
export function ratioMensual(
  unidadesAnio: readonly number[],
  unidadesReferencia: readonly number[],
  meses: readonly boolean[]
): (number | null)[] {
  return Array.from({ length: MESES_ANIO }, (_, m) =>
    meses[m] && unidadesReferencia[m] > 0 ? unidadesAnio[m] / unidadesReferencia[m] : null
  );
}

/** Regla 8e. El año normal más cercano a `anioY` (empate: el anterior); `null` sin normales. */
export function referenciaVolumen(anioY: number, aniosNormales: readonly number[]): number | null {
  let mejor: number | null = null;
  for (const n of [...aniosNormales].sort((a, b) => a - b)) {
    if (n === anioY) continue;
    if (mejor === null || Math.abs(n - anioY) < Math.abs(mejor - anioY)) mejor = n;
  }
  return mejor;
}

// ─── Medición de un año contra su referencia ───

/** Una serie anual con su desglose por tienda (lo que necesita la medición sobre tiendas comunes). */
export type SerieParaVolumen = {
  anio: number;
  unidades: readonly number[];
  publicados: readonly boolean[];
  /** Unidades mensuales (12) de cada tienda de la red del año. */
  por_tienda: ReadonlyMap<string, readonly number[]>;
};

export type VolumenMedido = {
  ratio_volumen: number | null;
  meses_comparados: number;
  anio_referencia: number | null;
  por_anio_normal: { anio: number; ratio: number | null }[];
  tiendas_comunes: number;
  unidades: number;
  unidades_referencia: number;
  ratio_mensual: (number | null)[];
};

export function sumaComunes(serie: SerieParaVolumen, comunes: ReadonlySet<string>): number[] {
  const meses = Array.from({ length: MESES_ANIO }, () => 0);
  for (const id of comunes) {
    const u = serie.por_tienda.get(id);
    if (!u) continue;
    for (let m = 0; m < MESES_ANIO; m++) meses[m] += u[m];
  }
  return meses;
}

function medirContra(
  y: SerieParaVolumen,
  n: SerieParaVolumen,
  redes: ReadonlyMap<number, RedAnio>
): { ratio: number | null; comunes: number; mascara: boolean[]; uY: number[]; uN: number[] } {
  const comunes = tiendasComunes(redes.get(y.anio), redes.get(n.anio));
  const mascara = Array.from({ length: MESES_ANIO }, (_, m) => y.publicados[m] && n.publicados[m]);
  const uY = sumaComunes(y, comunes);
  const uN = sumaComunes(n, comunes);
  return { ratio: comunes.size === 0 ? null : ratioVolumen(uY, uN, mascara), comunes: comunes.size, mascara, uY, uN };
}

/**
 * Mide el volumen de un año atípico `y` frente a `anioReferencia` (de `candidatos`,
 * los años normales con su serie) sobre tiendas comunes, con el ratio contra
 * cada año normal como sensibilidad. Sin referencia o sin tiendas comunes, los
 * ratios son `null` (aviso `sin_referencia_volumen`).
 */
export function medirVolumen(
  y: SerieParaVolumen,
  anioReferencia: number | null,
  candidatos: readonly SerieParaVolumen[],
  redes: ReadonlyMap<number, RedAnio>
): VolumenMedido {
  const referencia = candidatos.find((c) => c.anio === anioReferencia) ?? null;
  const porAnioNormal = candidatos.map((c) => ({ anio: c.anio, ratio: medirContra(y, c, redes).ratio }));
  if (!referencia) {
    return {
      ratio_volumen: null,
      meses_comparados: y.publicados.filter(Boolean).length,
      anio_referencia: anioReferencia,
      por_anio_normal: porAnioNormal,
      tiendas_comunes: 0,
      unidades: 0,
      unidades_referencia: 0,
      ratio_mensual: Array.from({ length: MESES_ANIO }, () => null),
    };
  }
  const medido = medirContra(y, referencia, redes);
  const enMascara = (v: readonly number[]) => sumar(v.filter((_, m) => medido.mascara[m]));
  return {
    ratio_volumen: medido.ratio,
    meses_comparados: medido.mascara.filter(Boolean).length,
    anio_referencia: referencia.anio,
    por_anio_normal: porAnioNormal,
    tiendas_comunes: medido.comunes,
    unidades: enMascara(medido.uY),
    unidades_referencia: enMascara(medido.uN),
    ratio_mensual: ratioMensual(medido.uY, medido.uN, medido.mascara),
  };
}

// ─── 06e §5.2: efecto medido solo en los meses del periodo ───

export type EntradaPeriodo = {
  y: SerieParaVolumen;
  referencia: SerieParaVolumen;
  /** Serie de `todo_el_ano` del mismo año y de la referencia; `null` si no hay (el control sale nulo). */
  controlY: SerieParaVolumen | null;
  controlReferencia: SerieParaVolumen | null;
  redes: ReadonlyMap<number, RedAnio>;
  /** Doce posiciones: el mes es atípico de la temporada en `y` (publicado o no). */
  mesesPeriodo: readonly boolean[];
};

const cociente = (a: number | null, b: number | null): number | null => (a !== null && b !== null && b > 0 ? a / b : null);

/**
 * 06e §5.2. `ρ_P`, `κ_P`, su cociente, el ratio fuera del periodo y el desglose de los doce meses, sobre `Q = tiendasComunes(red(Y),
 * red(N))`. `P` = `mesesPeriodo` ∩ publicados de ambos años. Con `P` igual a todos los meses publicados, `relativo` coincide con el
 * `ratio_relativo` de `efectoAtipicoCorrida`. Sin tiendas comunes todos los ratios salen `null`.
 */
export function medirPeriodo(e: EntradaPeriodo): PeriodoEfectoApi {
  const comunes = tiendasComunes(e.redes.get(e.y.anio), e.redes.get(e.referencia.anio));
  const uY = sumaComunes(e.y, comunes);
  const uN = sumaComunes(e.referencia, comunes);
  const cY = e.controlY && e.controlReferencia ? sumaComunes(e.controlY, comunes) : null;
  const cN = e.controlY && e.controlReferencia ? sumaComunes(e.controlReferencia, comunes) : null;

  const ambos = Array.from({ length: MESES_ANIO }, (_, m) => e.y.publicados[m] && e.referencia.publicados[m]);
  const periodo = Array.from({ length: MESES_ANIO }, (_, m) => Boolean(e.mesesPeriodo[m]) && ambos[m]);
  const fuera = Array.from({ length: MESES_ANIO }, (_, m) => ambos[m] && !e.mesesPeriodo[m]);
  const hay = comunes.size > 0;

  const rho = hay ? ratioVolumen(uY, uN, periodo) : null;
  const kappa = hay && cY && cN ? ratioVolumen(cY, cN, periodo) : null;
  const mensual = ratioMensual(uY, uN, ambos);
  const control = cY && cN ? ratioMensual(cY, cN, ambos) : null;

  const meses: MesPeriodoEfectoApi[] = Array.from({ length: MESES_ANIO }, (_, m) => ({
    m: m + 1,
    en_periodo: periodo[m],
    u: uY[m],
    u_ref: uN[m],
    ratio: mensual[m],
    control: control?.[m] ?? null,
    relativo: cociente(mensual[m], control?.[m] ?? null),
  }));

  return {
    meses_periodo: e.mesesPeriodo.filter(Boolean).length,
    meses_periodo_con_dato: periodo.filter((p, m) => p && uN[m] > 0).length,
    ratio_volumen: rho,
    ratio_control: kappa,
    relativo: cociente(rho, kappa),
    ratio_fuera: hay ? ratioVolumen(uY, uN, fuera) : null,
    meses,
  };
}

// ─── Regla 8f: efecto a nivel de corrida ───

export type AnioDeGrupo = SerieParaVolumen & {
  clase: ClaseAnioCurva;
  /** Meses atípicos que aplican (en el año en curso, los cargados). */
  meses_atipicos: number;
  /** 06e §5.2, opcional: doce posiciones, el mes es atípico de la temporada del grupo. Sin ella no hay bloque `periodo`. */
  mascara_atipicos?: readonly boolean[];
};

/** Una temporada (o la red entera) con la serie agregada de sus agrupaciones. */
export type GrupoParaEfecto = {
  temporada: TemporadaORed;
  agrupaciones: number;
  anios: readonly AnioDeGrupo[];
};

function esAtipico(a: AnioDeGrupo): boolean {
  return a.meses_atipicos > 0 && (a.clase === "con_huecos" || a.clase === "atipico_completo" || a.clase === "en_curso");
}

function normales(g: GrupoParaEfecto): AnioDeGrupo[] {
  return g.anios.filter((a) => a.clase === "normal" && a.publicados.every(Boolean));
}

/**
 * Regla 8f. Por temporada y año atípico: `ratio_volumen` sobre tiendas comunes;
 * `ratio_control` (el de `todo_el_ano` del mismo año, con el MISMO año de
 * referencia y por tanto las mismas tiendas comunes; `null` para la propia
 * `todo_el_ano`); `ratio_relativo = ratio_volumen ÷ ratio_control` (`null` si el
 * control es nulo o 0); `crecimiento_normal` (ratio entre los dos años normales
 * más recientes de la temporada sobre sus tiendas comunes; `null` con menos de
 * dos) y `agrupaciones: N`. La fila `red` suma todas las agrupaciones. NO existe
 * ninguna etiqueta de sustitución: es una tabla de ratios con sus controles.
 *
 * Las filas de `invierno` y `verano` salen solo para sus años atípicos; las de
 * `todo_el_ano` y `red`, para todos los años atípicos de cualquier temporada
 * (son el control).
 */
export function efectoAtipicoCorrida(
  grupos: readonly GrupoParaEfecto[],
  redes: readonly RedAnio[],
  parametros: { umbral_forma: number; margen_ruido: number },
  extras: {
    forma?: EfectoAtipicoCorrida["forma"];
    avisos?: AvisoCurva[];
  } = {}
): EfectoAtipicoCorrida {
  const redPorAnio = new Map(redes.map((r) => [r.anio, r]));
  const propias = grupos.filter((g) => g.temporada !== "red");
  const red = grupos.find((g) => g.temporada === "red");
  const control = propias.find((g) => g.temporada === "todo_el_ano");

  const aniosEfecto = new Set<number>();
  for (const g of propias) for (const a of g.anios) if (esAtipico(a)) aniosEfecto.add(a.anio);

  const filas: EfectoTemporadaAnio[] = [];
  const crecimiento: CrecimientoNormal[] = [];

  const crecimientoDe = (g: GrupoParaEfecto): CrecimientoNormal | null => {
    const n = normales(g).sort((a, b) => a.anio - b.anio);
    if (n.length < 2) return null;
    const reciente = n[n.length - 1];
    const previo = n[n.length - 2];
    const medido = medirContra(reciente, previo, redPorAnio);
    return {
      temporada: g.temporada,
      anio: reciente.anio,
      anio_referencia: previo.anio,
      ratio: medido.ratio,
      tiendas_comunes: medido.comunes,
    };
  };

  const ordenGrupos: GrupoParaEfecto[] = [
    ...TEMPORADAS_AGRUPACION.flatMap((t) => propias.filter((g) => g.temporada === t)),
    ...(red ? [red] : []),
  ];

  for (const g of ordenGrupos) {
    const c = crecimientoDe(g);
    if (c) crecimiento.push({ ...c, ratio: c.ratio === null ? null : redondear(c.ratio, 6) });

    const propiosAtipicos = new Set(g.anios.filter(esAtipico).map((a) => a.anio));
    const anios = [...(g.temporada === "invierno" || g.temporada === "verano" ? propiosAtipicos : aniosEfecto)].sort(
      (a, b) => a - b
    );
    for (const anio of anios) {
      const serie = g.anios.find((a) => a.anio === anio);
      if (!serie) continue;
      const referencia = referenciaVolumen(anio, normales(g).map((a) => a.anio));
      const medido = medirVolumen(serie, referencia, normales(g), redPorAnio);

      let ratioControl: number | null = null;
      if (g.temporada !== "todo_el_ano" && g.temporada !== "red" && control && referencia !== null) {
        const sy = control.anios.find((a) => a.anio === anio);
        const sn = control.anios.find((a) => a.anio === referencia);
        if (sy && sn) ratioControl = medirContra(sy, sn, redPorAnio).ratio;
      }
      let periodo: PeriodoEfectoApi | undefined;
      const referenciaSerie = referencia === null ? undefined : g.anios.find((a) => a.anio === referencia);
      if ((g.temporada === "invierno" || g.temporada === "verano") && serie.mascara_atipicos && referenciaSerie) {
        periodo = medirPeriodo({
          y: serie,
          referencia: referenciaSerie,
          controlY: control?.anios.find((a) => a.anio === anio) ?? null,
          controlReferencia: control?.anios.find((a) => a.anio === referencia) ?? null,
          redes: redPorAnio,
          mesesPeriodo: serie.mascara_atipicos,
        });
      }
      const relativo =
        medido.ratio_volumen !== null && ratioControl !== null && ratioControl > 0
          ? medido.ratio_volumen / ratioControl
          : null;

      filas.push({
        anio,
        temporada: g.temporada,
        agrupaciones: g.agrupaciones,
        ratio_volumen: medido.ratio_volumen,
        ratio_control: ratioControl,
        ratio_relativo: relativo,
        crecimiento_normal: c?.ratio ?? null,
        anio_referencia: medido.anio_referencia,
        tiendas_comunes: medido.tiendas_comunes,
        meses_comparados: medido.meses_comparados,
        unidades: medido.unidades,
        unidades_referencia: medido.unidades_referencia,
        ratio_mensual: medido.ratio_mensual,
        ...(periodo ? { periodo } : {}),
      });
    }
  }

  return {
    umbral_forma: parametros.umbral_forma,
    margen_ruido: parametros.margen_ruido,
    por_temporada: filas,
    crecimiento_normal: crecimiento,
    forma: extras.forma ?? {},
    avisos: extras.avisos ?? [],
  };
}

/** Veredictos por temporada, para el bloque "Forma" de Años Niño. */
export function resumirFormaPorTemporada(
  agrupaciones: ReadonlyArray<{ temporada: TemporadaAgrupacion; veredicto: VeredictoForma | null; ruido_normal: number | null }>
): EfectoAtipicoCorrida["forma"] {
  const salida: EfectoAtipicoCorrida["forma"] = {};
  for (const a of agrupaciones) {
    if (a.veredicto === null) continue;
    const t = (salida[a.temporada] ??= { forma_estable: 0, forma_cambia: 0, sin_comparacion: 0, ruido_normal: [] });
    t[a.veredicto] += 1;
    if (a.ruido_normal !== null) t.ruido_normal.push(redondear(a.ruido_normal, 2));
  }
  return salida;
}
