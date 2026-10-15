import { aPeriodo, recortarPeriodo } from "@/lib/ventas/periodo";
import { corrimientoCircular, eat, mesMayor } from "./backtesting";
import { MESES_ANIO, sumar } from "./anios";
import {
  TEMPORADAS_AGRUPACION,
  type AlcancePeriodo,
  type AnioAtipicidadApi,
  type ClaseDeAnioApi,
  type PeriodoDeAnio,
  type ResumenAnios,
  type TemporadaAgrupacion,
  type TratamientoAnio,
  type TratamientoAtipicos,
  type VeredictoForma,
  type ClaseAnioCurva,
  type FormaAnioParcial,
  type VolumenAnioApi,
} from "./tipos-api";

/**
 * Periodos atípicos y temporada (docs/modulos/06-curvas-estacionalidad.md,
 * "Periodos atípicos", "Lectura para M7" y reglas 6, 6b y 8e). Funciones puras:
 * sin base, sin HTTP, sin importar nada de `@supabase/*` ni de componentes.
 *
 * `claseDeAnio` es el contrato que M7 importa tal cual (y que sirve a
 * `GET /api/periodos-atipicos/anios`): su forma de salida no cambia; lo que M6
 * añada irá en campos nuevos. Un test fija las claves y los tipos.
 *
 * Los meses viajan como `aaaa-mm`. Una agrupación solo aporta su `temporada`:
 *   - un periodo aplica si su `temporada` está en el conjunto `temporadas` del
 *     periodo (de una a tres); con `temporadas` nulo (filas del paso 1) el
 *     conjunto se deriva de `alcance` (`invierno` → {invierno}, `todas` → las tres);
 *   - `alcance` es un espejo heredado: SOLO `temporadasDePeriodo` y
 *     `alcanceEspejo` lo leen para decidir (M7 lee `temporadas`);
 *   - un periodo inactivo no aplica nunca; dos periodos solapados cuentan cada
 *     mes una vez (se toma la unión).
 */

/** Lo que estas funciones necesitan de un periodo (`PeriodoAtipicoApi` encaja). */
export type PeriodoParaClase = {
  id: string;
  desde: string;
  hasta: string;
  motivo: string;
  /** Espejo heredado: solo `temporadasDePeriodo` lo lee, y solo si `temporadas` es nulo. */
  alcance: AlcancePeriodo;
  /** Conjunto de temporadas; `null`/ausente en filas del paso 1. */
  temporadas?: readonly TemporadaAgrupacion[] | null;
  activo: boolean;
};

export type AgrupacionParaClase = { temporada: TemporadaAgrupacion };

// ─── Meses ───

/** Número de mes absoluto (`año × 12 + mes − 1`): permite comparar y recorrer rangos sin fechas. */
function indiceMes(periodo: string): number {
  const [anio, mes] = recortarPeriodo(periodo).split("-").map(Number);
  return anio * 12 + (mes - 1);
}

function periodoDeIndice(indice: number): string {
  return aPeriodo(Math.floor(indice / 12), (indice % 12) + 1);
}

/** `aaaa-mm` válido: mes 01 a 12. */
function mesBienFormado(valor: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

/** Regla del rango: ambos meses bien formados y `hasta >= desde` (un solo mes es `desde = hasta`). */
export function rangoValido(desde: string, hasta: string): boolean {
  return mesBienFormado(desde) && mesBienFormado(hasta) && hasta >= desde;
}

/** Cuántos meses cubre el rango (inclusive); 0 si está invertido. */
export function contarMeses(desde: string, hasta: string): number {
  return Math.max(0, indiceMes(hasta) - indiceMes(desde) + 1);
}

/**
 * Conjunto efectivo de temporadas de un periodo, sin repetidos y en el orden
 * canónico (`TEMPORADAS_AGRUPACION`). Con `temporadas` nulo o vacío (filas del
 * paso 1) se deriva de `alcance`: `todas` → las tres; cualquier otro → {invierno}.
 */
export function temporadasDePeriodo(periodo: Pick<PeriodoParaClase, "alcance" | "temporadas">): TemporadaAgrupacion[] {
  const dadas = periodo.temporadas;
  if (dadas && dadas.length > 0) return TEMPORADAS_AGRUPACION.filter((t) => dadas.includes(t));
  return periodo.alcance === "todas" ? [...TEMPORADAS_AGRUPACION] : ["invierno"];
}

/**
 * Espejo heredado de `alcance` para un conjunto de temporadas: `todas` si cubre
 * las tres, `invierno` en cualquier otro caso (así lo exige su `check`).
 */
export function alcanceEspejo(temporadas: readonly TemporadaAgrupacion[]): AlcancePeriodo {
  return TEMPORADAS_AGRUPACION.every((t) => temporadas.includes(t)) ? "todas" : "invierno";
}

/**
 * Reconcilia `temporadas` y el `alcance` heredado de un cuerpo de alta o edición:
 * con `temporadas` manda ese conjunto; solo con `alcance`, se traduce; con los
 * dos, deben ser coherentes (`alcance` = espejo del conjunto), si no hay
 * `contradiccion`. Sin ninguno de los dos, `null` (nada que escribir).
 */
export function resolverTemporadas(entrada: {
  temporadas?: readonly TemporadaAgrupacion[] | undefined;
  alcance?: AlcancePeriodo | undefined;
}): { temporadas: TemporadaAgrupacion[]; alcance: AlcancePeriodo; contradiccion: boolean } | null {
  if (entrada.temporadas && entrada.temporadas.length > 0) {
    const temporadas = temporadasDePeriodo({ alcance: "invierno", temporadas: entrada.temporadas });
    const espejo = alcanceEspejo(temporadas);
    return { temporadas, alcance: espejo, contradiccion: entrada.alcance !== undefined && entrada.alcance !== espejo };
  }
  if (entrada.alcance !== undefined) {
    const temporadas = temporadasDePeriodo({ alcance: entrada.alcance, temporadas: null });
    return { temporadas, alcance: alcanceEspejo(temporadas), contradiccion: false };
  }
  return null;
}

/** ¿Este periodo ajusta a una agrupación de esa temporada? Inactivo nunca. */
export function periodoAplica(
  periodo: Pick<PeriodoParaClase, "alcance" | "temporadas" | "activo">,
  temporada: TemporadaAgrupacion
): boolean {
  if (!periodo.activo) return false;
  return temporadasDePeriodo(periodo).includes(temporada);
}

function mesesEnRango(desde: string, hasta: string, minIndice: number, maxIndice: number): string[] {
  const inicio = Math.max(indiceMes(desde), minIndice);
  const fin = Math.min(indiceMes(hasta), maxIndice);
  const meses: string[] = [];
  for (let i = inicio; i <= fin; i++) meses.push(periodoDeIndice(i));
  return meses;
}

// ─── Regla 6: meses atípicos de una agrupación ───

/** La unión de los rangos activos cuyo alcance aplica a la agrupación, como `aaaa-mm`. */
export function mesesAtipicos(periodos: readonly PeriodoParaClase[], agrupacion: AgrupacionParaClase): Set<string> {
  const meses = new Set<string>();
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    for (const m of mesesEnRango(p.desde, p.hasta, -Infinity, Infinity)) meses.add(m);
  }
  return meses;
}

// ─── Regla 6b: clase de un año (contrato para M7) ───

/**
 * Clase de un año para una agrupación:
 *   - `normal`: ningún mes del año cae en un periodo activo que aplica;
 *   - `atipico`: al menos uno, con la lista ordenada de esos meses y los
 *     periodos que los cubren (por `desde`, luego `id`).
 * `completo` solo si los 12 meses están publicados en M5. Un año en curso o con
 * meses sin cargar es `completo: false`, y sus meses atípicos pueden estar en
 * el futuro (un periodo de 2026 declarado antes de cargar diciembre ya cuenta).
 */
export function claseDeAnio(
  anio: number,
  agrupacion: AgrupacionParaClase,
  periodos: readonly PeriodoParaClase[],
  mesesPublicados: Iterable<string>
): ClaseDeAnioApi {
  const publicados = new Set<string>();
  for (const m of mesesPublicados) publicados.add(recortarPeriodo(m));

  const primero = anio * 12;
  const ultimo = anio * 12 + 11;
  const meses = new Set<string>();
  const cubren: PeriodoParaClase[] = [];
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    const delAnio = mesesEnRango(p.desde, p.hasta, primero, ultimo);
    if (delAnio.length === 0) continue;
    cubren.push(p);
    for (const m of delAnio) meses.add(m);
  }

  const orden = (a: PeriodoParaClase, b: PeriodoParaClase) =>
    recortarPeriodo(a.desde).localeCompare(recortarPeriodo(b.desde)) || a.id.localeCompare(b.id);
  const periodosDelAnio: PeriodoDeAnio[] = cubren
    .sort(orden)
    .map((p) => {
      const temporadas = temporadasDePeriodo(p);
      return { id: p.id, motivo: p.motivo, alcance: alcanceEspejo(temporadas), temporadas };
    });

  let completo = true;
  for (let m = 1; m <= 12; m++) {
    if (!publicados.has(aPeriodo(anio, m))) {
      completo = false;
      break;
    }
  }

  const mesesOrdenados = [...meses].sort();
  return {
    anio,
    clase: mesesOrdenados.length > 0 ? "atipico" : "normal",
    meses_atipicos: mesesOrdenados,
    periodos: periodosDelAnio,
    completo,
  };
}

/**
 * Años que evalúa `GET /api/periodos-atipicos/anios`.
 *   - Con `desde` y `hasta`: todos los años de ese rango (inclusive).
 *   - Si no: del año del primer mes publicado al del último, más los años de los
 *     meses de periodos activos que aplican y caen DESPUÉS del último mes
 *     publicado (un periodo de 2026 o 2027 declarado antes de cargar esos meses).
 *     Sin ningún mes publicado, los años de los periodos que aplican. Si solo
 *     viene un extremo, recorta ese conjunto por defecto.
 */
export function aniosAEvaluar(entrada: {
  agrupacion: AgrupacionParaClase;
  periodos: readonly PeriodoParaClase[];
  mesesPublicados: Iterable<string>;
  desde?: number;
  hasta?: number;
}): number[] {
  const { agrupacion, periodos, desde, hasta } = entrada;
  if (desde !== undefined && hasta !== undefined) {
    const anios: number[] = [];
    for (let a = desde; a <= hasta; a++) anios.push(a);
    return anios;
  }

  const publicados = [...entrada.mesesPublicados].map(recortarPeriodo).sort();
  const anios = new Set<number>();
  let ultimoPublicado = -Infinity;
  if (publicados.length > 0) {
    const primerAnio = Number(publicados[0].slice(0, 4));
    const ultimoAnio = Number(publicados[publicados.length - 1].slice(0, 4));
    for (let a = primerAnio; a <= ultimoAnio; a++) anios.add(a);
    ultimoPublicado = indiceMes(publicados[publicados.length - 1]);
  }
  for (const p of periodos) {
    if (!periodoAplica(p, agrupacion.temporada)) continue;
    for (const m of mesesEnRango(p.desde, p.hasta, ultimoPublicado + 1, Infinity)) anios.add(Number(m.slice(0, 4)));
  }

  return [...anios]
    .filter((a) => (desde === undefined || a >= desde) && (hasta === undefined || a <= hasta))
    .sort((a, b) => a - b);
}

/**
 * Los años evaluados con su clase y el resumen. `volumenDeAnio` (opcional) da el
 * factor de volumen (calculado a demanda) para un año atípico; sin él
 * `ratio_volumen` y `volumen` son `null`.
 */
export function aniosAtipicidad(entrada: {
  agrupacion: AgrupacionParaClase;
  periodos: readonly PeriodoParaClase[];
  mesesPublicados: Iterable<string>;
  desde?: number;
  hasta?: number;
  volumenDeAnio?: (anio: number) => { ratio_volumen: number | null; volumen: VolumenAnioApi | null } | null;
}): { anios: AnioAtipicidadApi[]; resumen: ResumenAnios } {
  const publicados = [...entrada.mesesPublicados].map(recortarPeriodo);
  const anios = aniosAEvaluar({ ...entrada, mesesPublicados: publicados }).map((anio): AnioAtipicidadApi => {
    const clase = claseDeAnio(anio, entrada.agrupacion, entrada.periodos, publicados);
    const v = clase.clase === "atipico" ? (entrada.volumenDeAnio?.(anio) ?? null) : null;
    return { ...clase, ratio_volumen: v?.ratio_volumen ?? null, volumen: v?.volumen ?? null };
  });
  return {
    anios,
    resumen: {
      anios_atipicos: anios.filter((a) => a.clase === "atipico").map((a) => a.anio),
      anios_normales_completos: anios.filter((a) => a.clase === "normal" && a.completo).map((a) => a.anio),
    },
  };
}

// ─── Regla 8e: temporada sugerida desde las líneas de M1 ───

const TEMPORADA_DE_LINEA: Readonly<Record<string, TemporadaAgrupacion>> = {
  Verano: "verano",
  Invierno: "invierno",
  "Todo el año": "todo_el_ano",
};

/** `lineas.temporada` de M1 (`Verano` / `Invierno` / `Todo el año`) a su código; lo desconocido es `todo_el_ano`. */
export function temporadaDeLinea(temporada: string): TemporadaAgrupacion {
  return TEMPORADA_DE_LINEA[temporada] ?? "todo_el_ano";
}

/**
 * Temporada mayoritaria por conteo entre las líneas de las equivalencias de
 * una agrupación (una entrada por equivalencia: la `temporada` de su línea).
 * Empate por el primer lugar o lista vacía: `todo_el_ano`.
 */
export function temporadaSugerida(lineas: ReadonlyArray<string | { temporada: string }>): TemporadaAgrupacion {
  const conteo = new Map<TemporadaAgrupacion, number>();
  for (const l of lineas) {
    const t = temporadaDeLinea(typeof l === "string" ? l : l.temporada);
    conteo.set(t, (conteo.get(t) ?? 0) + 1);
  }
  let mejor: TemporadaAgrupacion = "todo_el_ano";
  let max = 0;
  let empate = false;
  for (const [t, n] of conteo) {
    if (n > max) {
      mejor = t;
      max = n;
      empate = false;
    } else if (n === max) {
      empate = true;
    }
  }
  return empate ? "todo_el_ano" : mejor;
}

/**
 * Aviso `temporada_sugerida_distinta` (I5): la fijada no coincide con la
 * sugerida, pero SOLO cuando la sugerida es `invierno` o `verano`. Si las líneas
 * no informan (`todo_el_ano`, como las 87 del árbol real) no hay nada que
 * sugerir y no avisa; tampoco sin equivalencias activas.
 */
export function temporadaSugeridaDistinta(
  temporada: TemporadaAgrupacion,
  sugerida: TemporadaAgrupacion,
  equivalenciasActivas: number
): boolean {
  return equivalenciasActivas > 0 && sugerida !== "todo_el_ano" && temporada !== sugerida;
}

/** La sugerida solo se muestra cuando informa (`invierno` o `verano`); si no, `null` (I5). */
export function temporadaSugeridaVisible(sugerida: TemporadaAgrupacion): TemporadaAgrupacion | null {
  return sugerida === "todo_el_ano" ? null : sugerida;
}

// ═══════════════════════════════════════════════════════════════════════════
// Paso 2: tratamiento de los años atípicos (reglas 7 a 8c y 8g)
// ═══════════════════════════════════════════════════════════════════════════

/** Regla 8. Referencia `r`: promedio simple de las participaciones de los años normales; sin normales, `null`. */
export function referencia(aniosNormales: ReadonlyArray<readonly number[]>): number[] | null {
  if (aniosNormales.length === 0) return null;
  const r = Array.from({ length: MESES_ANIO }, () => 0);
  for (const p of aniosNormales) for (let m = 0; m < MESES_ANIO; m++) r[m] += p[m] / aniosNormales.length;
  return r;
}

/**
 * Regla 8a. Ruido normal: EAT entre los dos años normales; con tres o más, el
 * promedio de las EAT entre pares; con uno o ninguno, `null`. Es lo que se
 * aparta un año NORMAL de otro, la vara con la que se mide un año atípico.
 */
export function ruidoNormal(aniosNormales: ReadonlyArray<readonly number[]>): number | null {
  const n = aniosNormales.length;
  if (n < 2) return null;
  const pares: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pares.push(eat(aniosNormales[i], aniosNormales[j]));
  return sumar(pares) / pares.length;
}

/**
 * Regla 7. Imputa los meses atípicos `A` (números de mes 1 a 12) de un año con
 * la referencia `r`: para `m ∈ A`, `p_m = r_m`; para `m ∉ A`,
 * `p_m = u_m ÷ Σ_{k∉A} u_k × (1 − R_A)` con `R_A = Σ_{m∈A} r_m` (el `pesoImputado`).
 * La suma es 1. Si los meses no atípicos no tienen ventas no hay con qué
 * reescalar → `null`.
 */
export function imputarHuecos(
  medidas: readonly number[],
  A: readonly number[],
  r: readonly number[]
): { participacion: number[]; pesoImputado: number } | null {
  const marcados = new Set(A);
  let restoUnidades = 0;
  let pesoImputado = 0;
  for (let m = 1; m <= MESES_ANIO; m++) {
    if (marcados.has(m)) pesoImputado += r[m - 1];
    else restoUnidades += medidas[m - 1];
  }
  if (!(restoUnidades > 0)) return null;
  const p = medidas.map((u, i) =>
    marcados.has(i + 1) ? r[i] : (u / restoUnidades) * (1 - pesoImputado)
  );
  return { participacion: p, pesoImputado };
}

export type ComparacionForma = {
  veredicto: VeredictoForma;
  /** EAT del año frente a la referencia, en puntos; `null` sin referencia. */
  diferencia_anio: number | null;
  pico: number;
  pico_referencia: number | null;
  corrimiento_pico: number | null;
  mes_mayor_diferencia: number | null;
  /** `max(piso, ruido ?? 0)`. */
  umbral_efectivo: number;
};

/** Reparte una participación sobre los meses de la máscara y la renormaliza (los demás quedan en 0). */
export function renormalizarEn(p: readonly number[], mascara?: readonly boolean[]): number[] {
  if (!mascara) return [...p];
  const total = sumar(p.map((v, m) => (mascara[m] ? v : 0)));
  return p.map((v, m) => (mascara[m] && total > 0 ? v / total : 0));
}

/**
 * Regla 8b. Compara la forma de un año con la referencia, RELATIVA al ruido:
 * `umbral_efectivo = max(piso, ruido ?? 0)`; `forma_cambia` solo si
 * `diferencia_anio > umbral_efectivo`. Sin referencia, `sin_comparacion`.
 * `mesesComparados` (máscara de doce) limita la comparación a esos meses.
 */
export function compararFormaAnio(
  p: readonly number[],
  r: readonly number[] | null,
  umbralPiso: number,
  ruido: number | null,
  mesesComparados?: readonly boolean[]
): ComparacionForma {
  const umbralEfectivo = Math.max(umbralPiso, ruido ?? 0);
  const pp = renormalizarEn(p, mesesComparados);
  const pico = mesMayor(pp, mesesComparados);
  if (!r) {
    return {
      veredicto: "sin_comparacion",
      diferencia_anio: null,
      pico,
      pico_referencia: null,
      corrimiento_pico: null,
      mes_mayor_diferencia: null,
      umbral_efectivo: umbralEfectivo,
    };
  }
  const rr = renormalizarEn(r, mesesComparados);
  const diferencia = eat(pp, rr);
  const picoRef = mesMayor(rr, mesesComparados);
  const diffs = pp.map((v, m) => Math.abs(v - rr[m]));
  return {
    veredicto: diferencia > umbralEfectivo ? "forma_cambia" : "forma_estable",
    diferencia_anio: diferencia,
    pico,
    pico_referencia: picoRef,
    corrimiento_pico: corrimientoCircular(pico, picoRef),
    mes_mayor_diferencia: mesMayor(diffs, mesesComparados),
    umbral_efectivo: umbralEfectivo,
  };
}

/**
 * Regla 8b (año en curso, I7). Forma parcial sobre los `k` meses cargados
 * (`publicados`), renormalizada, en DOS versiones: la red completa del año y las
 * tiendas comunes con el año de referencia. Es informativa (`parcial: true`) y
 * nunca cambia el tratamiento. Las participaciones de entrada ya vienen sobre los
 * meses cargados (o sin renormalizar: se renormalizan aquí).
 */
export function compararFormaParcial(
  anio: number,
  r: readonly number[] | null,
  publicados: readonly boolean[],
  redCompleta: readonly number[] | null,
  tiendasComunes: { participacion: readonly number[] | null; tiendas: number } | null
): FormaAnioParcial {
  const k = publicados.filter(Boolean).length;
  const version = (q: readonly number[] | null) => {
    if (!q || !r) return null;
    const qq = renormalizarEn(q, publicados);
    return { diferencia_anio: eat(qq, renormalizarEn(r, publicados)), pico: mesMayor(qq, publicados) };
  };
  const completa = version(redCompleta);
  const comunes = tiendasComunes ? version(tiendasComunes.participacion) : null;
  return {
    anio,
    parcial: true,
    meses_comparados: k,
    red_completa: completa,
    tiendas_comunes: comunes && tiendasComunes ? { ...comunes, tiendas: tiendasComunes.tiendas } : null,
    veredicto: null,
    tratamiento_aplicado: null,
  };
}

/**
 * Veredicto de forma de una agrupación: `forma_cambia` si algún año completo
 * lo es; `forma_estable` si todos los comparables lo son; `sin_comparacion` si
 * ninguno es comparable.
 */
export function compararFormaAgrupacion(veredictos: readonly VeredictoForma[]): VeredictoForma {
  if (veredictos.includes("forma_cambia")) return "forma_cambia";
  if (veredictos.includes("forma_estable")) return "forma_estable";
  return "sin_comparacion";
}

/**
 * Regla 8c. Tratamiento efectivo de un año atípico:
 *   - `incluir` → `incluido`; `descartar` → `descartado`;
 *   - `imputar`: `con_huecos` → `imputado` (con `sin_comparacion` no hay referencia
 *     con qué imputar: `descartado`); `atipico_completo` → `descartado` (nunca se imputa);
 *   - `auto`: `forma_estable` → `incluido`; `forma_cambia` → `imputado` (`con_huecos`)
 *     o `descartado` (`atipico_completo`); `sin_comparacion` → `incluido` (con aviso `sin_referencia`);
 *   - `en_curso` e `incompleto` → `null`; `normal` → `incluido`.
 */
export function tratamientoEfectivo(
  parametro: TratamientoAtipicos,
  veredicto: VeredictoForma,
  clase: ClaseAnioCurva
): TratamientoAnio | null {
  if (clase === "en_curso" || clase === "incompleto") return null;
  if (clase === "normal") return "incluido";
  if (parametro === "incluir") return "incluido";
  if (parametro === "descartar") return "descartado";
  if (parametro === "imputar") {
    if (clase === "atipico_completo") return "descartado";
    return veredicto === "sin_comparacion" ? "descartado" : "imputado";
  }
  if (veredicto === "forma_cambia") return clase === "con_huecos" ? "imputado" : "descartado";
  return "incluido";
}

/** Regla 8g. Aviso `pocos_anos_normales`: menos de tres años normales completos. */
export function pocosAniosNormales(anios: ReadonlyArray<{ clase: ClaseAnioCurva }>): boolean {
  return anios.filter((a) => a.clase === "normal").length < 3;
}
