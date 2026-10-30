import { redondear } from "@/lib/curvas/anios";
import { agregarFilas, type FilaCrecimiento } from "@/lib/proyeccion/crecimientos";
import type { AgregadoCrecimientoApi, SobreBase } from "@/lib/proyeccion/tipos-api";
import { hayNino, unidades, unidadesPorTienda, type OpcionesSuma, type Phi, type SerieGM } from "./series";
import type { CierreGMApi, MotivoNuloReferencia, ReaprobarApi, ReferenciaApi, TipoReferencia, VarianteBase } from "./tipos-api";

/**
 * Cifras de referencia de «Cómo crece» (ficha 06d §5.1 y 06e §5.1, fórmulas exactas). Lógica PURA. Desde `0.14.0` un % nuevo es «sobre
 * 2026 corregido del Niño»: cada referencia lleva su `equivalente.corregido` (lo que se escribiría) y su `equivalente.bruto` (lo que
 * da sobre lo vendido). Ninguna cifra sugiere un %: el planner decide (decisión 33).
 *
 *   Cierre por curva   K ÷ U(Y−1) − 1 (real) y K' ÷ U'(Y−1) − 1 (corregido) sobre C(Y), de `cierre-curva.ts`
 *   Acumulado          Σ_{m≤k} U(Y) ÷ Σ_{m≤k} U(Y−1) − 1  sobre C(Y), real y con U' = U ÷ φ
 *   Año completo Z     U(Z) ÷ U(Z−1) − 1  sobre C(Z), real y con U' = U ÷ φ
 *   Aplicado hoy       % efectivo de la foto de la proyección de referencia (≥ método 5), con su `sobre_base`
 *
 * «Cierre proyectado» y «Sin Niño + rebote» ya no son bases elegibles (D11): la cifra de la proyección queda como dato
 * (`cierre_proyeccion`, `base_corregida`).
 */

/** Versión mínima del método de la proyección que sirve de referencia (06e: `B'` en `base_normalizada`). */
export const METODO_MIN_REFERENCIA = 5;

export const UMBRAL_FRAGIL_TIENDAS = 3;
export const UMBRAL_FRAGIL_UNIDADES = 120;
export const UMBRAL_EXTREMO_PCT = 50;
export const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"] as const;

const r2 = (n: number) => redondear(n, 2);

// ─── La proyección de referencia ───

/** Una fila base (tienda nula) de la proyección de referencia, con su registro de `Y` y el de `Y+1`. */
export type FilaBase = {
  fila_id: string;
  genero_id: string;
  mundo_id: string;
  /** `genero_id|mundo_id`. */
  gm: string;
  temporada: string;
  /** Registro de `Y`: `decidido ?? propuesto`. */
  vigente_y: number | null;
  meses_y: readonly number[] | null;
  /** Registro de `Y+1`. */
  b: number | null;
  bn: number | null;
  crecimiento_pct: number | null;
  decidido: number | null;
  propuesto: number | null;
};

export type EstadoProyeccionReferencia = "valida" | "metodo_anterior" | "sin_base";

/** Lo que las referencias toman de la proyección elegida (ya reducido por el servicio). */
export type ProyeccionParaReferencias = {
  estado: EstadoProyeccionReferencia;
  /** Tiendas de `parametros.bloques[Y].mismas`. */
  mismas: ReadonlySet<string>;
  /** Todas las filas base activas con GM conocido. */
  filas: readonly FilaBase[];
  /** `claveGM → %` del GM aprobado que aplicó el último cálculo (la foto); solo géneros detallados. */
  pctPorGM: ReadonlyMap<string, number>;
  /** El Resto aplicado: `crecimiento_resto_usado.pct` o, sin él, `crecimiento_pct_defecto`. */
  restoPct: number;
  /** 06e: `claveGM → sobre_base` de la foto (`null` = escrita antes de `0.14.0`: `bruta`). Sin entrada se lee `bruta`. */
  sobrePorGM?: ReadonlyMap<string, SobreBase>;
  /** 06e: `sobre_base` del Resto aplicado (`crecimiento_resto_usado.sobre_base`); el provisional es `corregida`. Sin dato, `bruta`. */
  restoSobre?: SobreBase;
  /** 06e: `resumen.gm_con_nino` (claves `genero_id|mundo_id` y `resto`); `null` si la proyección no lo trae. */
  gmConNino?: ReadonlySet<string> | null;
  /** 06e (M8): `resumen.gm_fuera_base`. */
  gmFueraBase?: ReadonlyMap<string, { filas: number; unidades: number }>;
};

/**
 * Referencia de proyección válida (I1): `version_metodo ≥ 5` y `Σ B` de las filas base de `Y+1` no nulo y positivo. Si no, B, B',
 * la corrección del Niño y «Aplicado hoy» son `null` con su motivo.
 */
export function estadoDeProyeccion(versionMetodo: number | null, filas: readonly Pick<FilaBase, "b">[]): EstadoProyeccionReferencia {
  if (versionMetodo === null || versionMetodo < METODO_MIN_REFERENCIA) return "metodo_anterior";
  const total = filas.reduce((a, f) => a + (f.b ?? 0), 0);
  return total > 0 ? "valida" : "sin_base";
}

/** Las filas de un GM o del Resto como entran a `agregarFilas` (07c). */
export function filasCrecimiento(filas: readonly FilaBase[]): FilaCrecimiento[] {
  return filas.map((f) => ({
    fila_id: f.fila_id,
    genero_id: f.genero_id,
    mundo_id: f.mundo_id,
    crecimiento_pct: f.crecimiento_pct,
    decidido: f.decidido,
    propuesto: f.propuesto,
    base_siguiente: f.b,
    base_normalizada: f.bn,
    // Método 5: el % propio de una fila es «sobre corregido» (R4).
    sobre_base: "corregida" as const,
  }));
}

export const agregadoDe = (filas: readonly FilaBase[]): AgregadoCrecimientoApi => agregarFilas(filasCrecimiento(filas));

/** `Σ B` de las filas (con base); `null` sin filas o sin ninguna base. */
export function baseSiguienteDe(filas: readonly FilaBase[]): number | null {
  const conBase = filas.filter((f) => f.b !== null);
  return conBase.length === 0 ? null : conBase.reduce((a, f) => a + (f.b as number), 0);
}

/** `Σ B'` de las filas con base (`bn`, y `b` si la fila no trae `bn`); `null` sin base. */
export function baseCorregidaDe(filas: readonly FilaBase[]): number | null {
  const conBase = filas.filter((f) => f.b !== null);
  return conBase.length === 0 ? null : conBase.reduce((a, f) => a + (f.bn ?? (f.b as number)), 0);
}

/** La corrección del Niño `Σ B' ÷ Σ B − 1` en %, sobre las filas con base; `null` sin base. Con un año normal da 0. */
export function reboteDe(filas: readonly FilaBase[]): number | null {
  const b = baseSiguienteDe(filas);
  const bc = baseCorregidaDe(filas);
  return b !== null && bc !== null && b > 0 ? r2((bc / b - 1) * 100) : null;
}

// ─── Equivalencias ───

/** Lo que una cifra significa para `Y+1`: `corregido` (lo que se escribiría) y `bruto` (sobre lo vendido). `sin_nino_mas_rebote` ya no existe. */
export function equivalenteDe(bruto: number | null, corregido: number | null): ReferenciaApi["equivalente"] {
  return { corregido, bruto, sin_nino_mas_rebote: null };
}

/** El % de la referencia en la variante elegida (`corregido` o `bruto`); `null` si no se pudo calcular o la variante está retirada. */
export function valorDeBase(ref: ReferenciaApi | undefined, variante: VarianteBase): number | null {
  if (!ref) return null;
  if (variante === "corregido") return ref.equivalente.corregido ?? null;
  if (variante === "bruto") return ref.equivalente.bruto;
  return null;
}

/** El % equivalente sobre 2026 real de un % escrito sobre 2026 corregido: `(1 + g) × B' ÷ B − 1`. `null` sin bases. */
export function equivalenteReal(pctCorregido: number, base: number | null, baseCorregida: number | null): number | null {
  if (base === null || baseCorregida === null || !(base > 0)) return null;
  return r2(((1 + pctCorregido / 100) * baseCorregida / base - 1) * 100);
}

const redondearUnidades = (x: number): number => Math.max(0, Math.round(x));

/**
 * I3 · Reaprobar una versión `bruta` en un GM con Niño material. `F` = las filas base del GM que siguen al GM (con base, sin % propio y sin
 * total de `Y+1` decidido; si no queda ninguna, todas las que tienen base). `pct_equivalente` es el % sobre corregido que deja quieto el
 * total de `F` (`round2(((1 + g) × Σ_F B ÷ Σ_F B' − 1) × 100)`, el que precarga «Reaprobar»). El impacto compara, fila a fila, lo que da hoy la
 * versión `bruta` (`round(B (1+g))`) con lo que daría la corregida con ese equivalente (`round(B' (1+eq))`). Una fila decidida no se mueve:
 * se cuenta aparte si su propuesta cambiaría. `null` sin base o con `Σ_F B' = 0`.
 */
export function calcularReaprobar(filas: readonly FilaBase[], pctBruta: number): NonNullable<ReaprobarApi> | null {
  const conBase = filas.filter((f) => f.b !== null);
  const siguen = conBase.filter((f) => f.decidido === null && f.crecimiento_pct === null);
  const base = siguen.length > 0 ? siguen : conBase;
  const sumaB = base.reduce((a, f) => a + (f.b as number), 0);
  const sumaBc = base.reduce((a, f) => a + (f.bn ?? (f.b as number)), 0);
  if (!(sumaB > 0) || !(sumaBc > 0)) return null;
  const equivalente = r2(((1 + pctBruta / 100) * (sumaB / sumaBc) - 1) * 100);

  const antes = (f: FilaBase) => redondearUnidades((f.b as number) * (1 + pctBruta / 100));
  const despues = (f: FilaBase) => redondearUnidades((f.bn ?? (f.b as number)) * (1 + equivalente / 100));
  let totalAntes = 0;
  let totalDespues = 0;
  let suben = 0;
  let bajan = 0;
  let movidas = 0;
  for (const f of siguen) {
    const a = antes(f);
    const d = despues(f);
    totalAntes += a;
    totalDespues += d;
    if (d > a) suben += 1;
    else if (d < a) bajan += 1;
    movidas += Math.abs(d - a);
  }
  const decididas = conBase.filter((f) => f.decidido !== null && antes(f) !== despues(f)).length;
  return {
    pct_equivalente: equivalente,
    total_antes: totalAntes,
    total_despues: totalDespues,
    filas_suben: suben,
    filas_bajan: bajan,
    unidades_movidas: Math.round(movidas / 2),
    decididas_con_propuesta_cambio: decididas,
  };
}

// ─── Una referencia ───

export type EntradaReferencias = {
  entradas: readonly SerieGM[];
  /** `Y` y su último mes cerrado `k` (1 a 12); `k = null` si `Y` no tiene meses cerrados. */
  y: number;
  k: number | null;
  /** `C(Z)`. */
  comparables: (z: number) => ReadonlySet<string>;
  phi: Phi;
  /** `tienda_id → código`. */
  tiendas: ReadonlyMap<string, string>;
  /** Años completos `Z` para «Año completo» (`Y−1` y `Y−2` con los doce meses publicados). */
  aniosCompletos: readonly number[];
  /** `null` = no hay proyección de referencia. */
  proyeccion: ProyeccionParaReferencias | null;
  /** Filas base del GM (o del Resto). */
  filas: readonly FilaBase[];
  /** El % que la foto aplica a este GM (o el Resto); `null` sin proyección. */
  pctAplicado: number | null;
  /** 06e: sobre qué base se aplicó `pctAplicado` (la foto). Sin dato, `bruta`. */
  sobreAplicado?: SobreBase;
  /** 06e: el cierre por curva sobre `C(Y)` (`cierre-curva.ts`); sin él no hay referencia «Cierre por curva». */
  cierre?: CierreGMApi | null;
};

export type ResultadoReferencias = {
  cierre_curva: ReferenciaApi;
  acumulado: ReferenciaApi;
  anios_completos: ReferenciaApi[];
  aplicado_hoy: ReferenciaApi;
  /** En el orden de la pantalla: cierre por curva, acumulado, años completos y aplicado hoy. */
  todas: ReferenciaApi[];
  /** `U(Y−1)` de las mismas tiendas `C(Y)` (año completo). */
  unidades_anterior: number | null;
  /** `Σ B` y `Σ B'` de las filas base de la proyección de referencia (≥ 5); `null` sin ella. */
  base_siguiente: number | null;
  base_corregida: number | null;
  /** `Σ B' ÷ Σ B − 1` en %: la corrección del Niño de la proyección de referencia. */
  correccion_nino_pct: number | null;
  /** Mismo valor que `correccion_nino_pct` (el campo conserva su nombre en la API). */
  rebote_nino_pct: number | null;
};

const rangoTexto = (hasta: number) => (hasta <= 1 ? "ene" : `ene–${MESES_CORTOS[hasta - 1]}`);

function vacia(tipo: TipoReferencia, anio: number, etiqueta: string, periodo: string, motivo: MotivoNuloReferencia, tiendas = 0): ReferenciaApi {
  return {
    tipo,
    anio,
    variante_defecto: "corregido",
    etiqueta,
    periodo,
    tiendas,
    anterior: null,
    actual: null,
    pct_bruto: null,
    pct_sin_nino: null,
    equivalente: { corregido: null, bruto: null, sin_nino_mas_rebote: null },
    fragil: false,
    extremo: false,
    tienda_mayor: null,
    cobertura_pct: null,
    motivo_nulo: motivo,
  };
}

const pct = (actual: number, anterior: number): number | null => (anterior > 0 ? r2((actual / anterior - 1) * 100) : null);

type Cifras = {
  tiendas: number;
  anterior: number;
  actual: number;
  bruto: number | null;
  sin: number | null;
  fragil: boolean;
  extremo: boolean;
  mayor: ReferenciaApi["tienda_mayor"];
  motivo: MotivoNuloReferencia | null;
};

/** Cifras de `Z` frente a `Z−1` en los meses `1..hasta` sobre las tiendas dadas (acumulado y año completo). */
function cifrasComparadas(e: EntradaReferencias, z: number, hasta: number, tiendas: ReadonlySet<string>): Cifras {
  const o: OpcionesSuma = { tiendas, hasta };
  const anteriorPorTienda = unidadesPorTienda(e.entradas, z - 1, o);
  const actualPorTienda = unidadesPorTienda(e.entradas, z, o);
  const conVenta = new Set([...anteriorPorTienda.entries(), ...actualPorTienda.entries()].filter(([, u]) => u !== 0).map(([t]) => t));
  const anterior = [...anteriorPorTienda.values()].reduce((a, b) => a + b, 0);
  const actual = [...actualPorTienda.values()].reduce((a, b) => a + b, 0);
  const anteriorSin = unidades(e.entradas, z - 1, { ...o, phi: e.phi });
  const actualSin = unidades(e.entradas, z, { ...o, phi: e.phi });
  const bruto = pct(actual, anterior);

  let mayor: ReferenciaApi["tienda_mayor"] = null;
  let mayorId: string | null = null;
  for (const [t, u] of anteriorPorTienda) if (u > 0 && (mayorId === null || u > (anteriorPorTienda.get(mayorId) as number) || (u === anteriorPorTienda.get(mayorId) && t < mayorId))) mayorId = t;
  if (mayorId !== null && anterior > 0) {
    const ant = anteriorPorTienda.get(mayorId) as number;
    const act = actualPorTienda.get(mayorId) ?? 0;
    mayor = {
      codigo: e.tiendas.get(mayorId) ?? mayorId,
      aporte_pct: r2((ant / anterior) * 100),
      pct_sin_ella: conVenta.size > 1 ? pct(actual - act, anterior - ant) : null,
    };
  }

  const sinVenta = conVenta.size === 0 || (anterior === 0 && actual === 0);
  return {
    tiendas: conVenta.size,
    anterior: r2(anterior),
    actual: r2(actual),
    bruto,
    sin: pct(actualSin, anteriorSin),
    fragil: conVenta.size < UMBRAL_FRAGIL_TIENDAS || anterior < UMBRAL_FRAGIL_UNIDADES,
    extremo: bruto !== null && Math.abs(bruto) > UMBRAL_EXTREMO_PCT,
    mayor,
    motivo: sinVenta ? "sin_venta" : bruto === null ? "denominador_cero" : null,
  };
}

function aReferencia(tipo: TipoReferencia, anio: number, etiqueta: string, periodo: string, c: Cifras, cobertura: number | null): ReferenciaApi {
  return {
    tipo,
    anio,
    variante_defecto: "corregido",
    etiqueta,
    periodo,
    tiendas: c.tiendas,
    anterior: c.motivo === "sin_venta" ? null : c.anterior,
    actual: c.motivo === "sin_venta" ? null : c.actual,
    pct_bruto: c.bruto,
    pct_sin_nino: c.sin,
    equivalente: equivalenteDe(c.bruto, c.sin),
    fragil: c.fragil,
    extremo: c.extremo,
    tienda_mayor: c.mayor,
    cobertura_pct: cobertura,
    motivo_nulo: c.motivo,
  };
}

function motivoDeProyeccion(e: EntradaReferencias): MotivoNuloReferencia | null {
  if (e.proyeccion === null) return "sin_referencia";
  if (e.proyeccion.estado === "metodo_anterior") return "metodo_anterior";
  if (e.proyeccion.estado === "sin_base" || e.filas.length === 0 || baseSiguienteDe(e.filas) === null) return "sin_base";
  return null;
}

/** «Cierre por curva» (D10, D11) a partir del cierre del GM sobre `C(Y)`. Sin cierre, o con un motivo de `null`, queda vacía con su motivo. */
function referenciaCierreCurva(e: EntradaReferencias): ReferenciaApi {
  const etiqueta = `Cierre ${e.y} por curva`;
  const periodo = `${e.y} cerrado con la curva frente a ${e.y - 1} de las mismas tiendas`;
  const c = e.cierre ?? null;
  if (c === null) return vacia("cierre_curva", e.y, etiqueta, periodo, e.k === null ? "sin_venta" : "sin_curva");
  if (c.motivo_nulo !== null || c.cierre === null || c.anterior === null) return vacia("cierre_curva", e.y, etiqueta, periodo, c.motivo_nulo ?? "sin_venta", c.tiendas);
  const bruto = c.pct;
  return {
    tipo: "cierre_curva",
    anio: e.y,
    variante_defecto: "corregido",
    etiqueta,
    periodo,
    tiendas: c.tiendas,
    anterior: c.anterior,
    actual: c.cierre,
    pct_bruto: bruto,
    pct_sin_nino: c.pct_corregido,
    equivalente: equivalenteDe(bruto, c.pct_corregido),
    fragil: c.tiendas < UMBRAL_FRAGIL_TIENDAS || c.anterior < UMBRAL_FRAGIL_UNIDADES,
    extremo: bruto !== null && Math.abs(bruto) > UMBRAL_EXTREMO_PCT,
    tienda_mayor: null,
    cobertura_pct: null,
    motivo_nulo: bruto === null ? "denominador_cero" : null,
  };
}

/** Todas las referencias de un GM (o del Resto) con sus dos variantes. */
export function calcularReferencias(e: EntradaReferencias): ResultadoReferencias {
  const motivoProy = motivoDeProyeccion(e);
  const valida = motivoProy === null && e.proyeccion !== null;
  const rebote = valida ? reboteDe(e.filas) : null;
  const base = valida ? baseSiguienteDe(e.filas) : null;
  const baseCorregida = valida ? baseCorregidaDe(e.filas) : null;
  const k = e.k;

  // Cierre por curva.
  const cierreCurva = referenciaCierreCurva(e);

  // Acumulado.
  const cy = e.comparables(e.y);
  let acumulado: ReferenciaApi;
  let unidadesAnterior: number | null = null;
  if (k === null) {
    acumulado = vacia("acumulado", e.y, `Acumulado ${e.y}`, `sin meses cerrados de ${e.y}`, "sin_venta");
  } else {
    const c = cifrasComparadas(e, e.y, k, cy);
    const anual = unidades(e.entradas, e.y - 1, { tiendas: cy });
    const cobertura = anual > 0 ? r2((c.anterior / anual) * 100) : null;
    acumulado = aReferencia("acumulado", e.y, `Acumulado ${rangoTexto(k)} ${e.y}`, `${rangoTexto(k)} ${e.y} frente a ${rangoTexto(k)} ${e.y - 1}`, c, cobertura);
    unidadesAnterior = anual > 0 ? r2(anual) : null;
  }

  // Años completos.
  const completos = [...e.aniosCompletos]
    .sort((a, b) => b - a)
    .map((z) => {
      const c = cifrasComparadas(e, z, 12, e.comparables(z));
      return aReferencia("anio_completo", z, `Año completo ${z}`, `${z} frente a ${z - 1}`, c, null);
    });

  // Aplicado hoy.
  let aplicado: ReferenciaApi;
  const etiquetaAplicado = "Aplicado hoy";
  const periodoAplicado = `${e.y + 1} aplicado en la proyección frente a ${e.y} de las mismas tiendas`;
  if (motivoProy !== null || e.proyeccion === null || e.pctAplicado === null || base === null || baseCorregida === null) {
    aplicado = vacia("aplicado_hoy", e.y, etiquetaAplicado, periodoAplicado, motivoProy ?? "sin_base");
  } else {
    const g = e.pctAplicado;
    const sobre = e.sobreAplicado ?? "bruta";
    const baseDelPct = sobre === "corregida" ? baseCorregida : base;
    const total = baseDelPct * (1 + g / 100);
    const real = sobre === "corregida" ? r2((total / base - 1) * 100) : r2(g);
    const corregido = sobre === "corregida" ? r2(g) : baseCorregida > 0 ? r2((total / baseCorregida - 1) * 100) : null;
    // Una bruta: el % sobre corregido que deja quieto el total de las filas que siguen al GM (el que precarga «Reaprobar»).
    const reaprobar = sobre === "bruta" ? calcularReaprobar(e.filas, g) : null;
    aplicado = {
      tipo: "aplicado_hoy",
      anio: e.y,
      variante_defecto: "corregido",
      etiqueta: etiquetaAplicado,
      periodo: periodoAplicado,
      tiendas: e.proyeccion.mismas.size,
      anterior: r2(baseDelPct),
      actual: r2(total),
      pct_bruto: real,
      pct_sin_nino: corregido,
      equivalente: equivalenteDe(real, reaprobar ? reaprobar.pct_equivalente : corregido),
      fragil: base < UMBRAL_FRAGIL_UNIDADES,
      extremo: Math.abs(real) > UMBRAL_EXTREMO_PCT,
      tienda_mayor: null,
      cobertura_pct: null,
      motivo_nulo: null,
    };
  }

  return {
    cierre_curva: cierreCurva,
    acumulado,
    anios_completos: completos,
    aplicado_hoy: aplicado,
    todas: [cierreCurva, acumulado, ...completos, aplicado],
    unidades_anterior: unidadesAnterior,
    base_siguiente: base,
    base_corregida: baseCorregida,
    correccion_nino_pct: rebote,
    rebote_nino_pct: rebote,
  };
}

// ─── Base por defecto y R-N ───

/**
 * La base que se precarga al aprobar (D11, M2): «Cierre por curva · corregido» o, con avance bajo, «Año completo `Y−1` · corregido». Si la
 * elegida no se pudo calcular se cae a la siguiente que sí: año completo más reciente, acumulado, aplicado hoy. `null` si ninguna.
 */
export function baseDefectoDe(referencias: readonly ReferenciaApi[], avanceBajo: boolean): { tipo: TipoReferencia; anio: number | null; variante: "corregido" } | null {
  const calculable = (r: ReferenciaApi) => r.motivo_nulo === null && r.equivalente.corregido !== null;
  const cierre = referencias.find((r) => r.tipo === "cierre_curva" && calculable(r));
  const completo = [...referencias].filter((r) => r.tipo === "anio_completo" && calculable(r)).sort((a, b) => b.anio - a.anio)[0];
  const acumulado = referencias.find((r) => r.tipo === "acumulado" && calculable(r));
  const aplicado = referencias.find((r) => r.tipo === "aplicado_hoy" && calculable(r));
  const elegida = (avanceBajo ? [completo, cierre] : [cierre, completo]).concat([acumulado, aplicado]).find((r): r is ReferenciaApi => r !== undefined);
  if (!elegida) return null;
  return { tipo: elegida.tipo, anio: elegida.tipo === "anio_completo" ? elegida.anio : null, variante: "corregido" };
}

/**
 * R-N con variante `bruto` (R12): ¿el periodo que mide la referencia toca un año Niño del GM? El cierre, el acumulado y «Aplicado hoy»
 * miden `Y` (y `Y−1`, sin Niño o con el suyo, solo por comparar); un año completo `Z` mide `Z` y `Z−1`. Toca si algún mes con venta de esos
 * años lleva un factor distinto de 1.
 */
export function periodoTocaNino(ref: Pick<ReferenciaApi, "tipo" | "anio">, entradas: readonly SerieGM[], phi: Phi, tiendas?: ReadonlySet<string>): boolean {
  const anios = [ref.anio, ref.anio - 1];
  const opciones = tiendas ? { tiendas } : {};
  return anios.some((z) => hayNino(entradas, z, phi, opciones));
}
