import { redondear } from "@/lib/curvas/anios";
import { agregarFilas, type FilaCrecimiento } from "@/lib/proyeccion/crecimientos";
import type { AgregadoCrecimientoApi } from "@/lib/proyeccion/tipos-api";
import { VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import { hayNino, unidades, unidadesPorTienda, type OpcionesSuma, type Phi, type SerieGM } from "./series";
import type { MotivoNuloReferencia, ReferenciaApi, TipoReferencia, VarianteBase } from "./tipos-api";

/**
 * Cifras de referencia de «Cómo crece» (ficha 06d §5.1, fórmulas exactas). Lógica PURA. Todo en unidades y en % BRUTO salvo donde
 * se dice «sin Niño». Ninguna cifra sugiere un %: el planner decide (decisión 33).
 *
 *   Acumulado          Σ_{m≤k} U(Y) ÷ Σ_{m≤k} U(Y−1) − 1  sobre C(Y)
 *   Cierre proyectado  Σ vigente_Y de las filas base del GM ÷ U(Y−1) de sus mismas tiendas de Y − 1
 *   Año completo Z     U(Z) ÷ U(Z−1) − 1  sobre C(Z)
 *   Aplicado hoy       % efectivo de la foto de la proyección de referencia
 *   Sin Niño           U' = U ÷ φ (los dos años), equivalente para Y+1: (1 + g_sin)(1 + ρ) − 1
 */

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
};

/**
 * Referencia de proyección válida (I1): `version_metodo ≥ 4` y `Σ B` de las filas base de `Y+1` no nulo y positivo. Si no, B, ρ,
 * «Cierre proyectado» y «Aplicado hoy» son `null` con su motivo.
 */
export function estadoDeProyeccion(versionMetodo: number | null, filas: readonly Pick<FilaBase, "b">[]): EstadoProyeccionReferencia {
  if (versionMetodo === null || versionMetodo < VERSION_METODO) return "metodo_anterior";
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
  }));
}

export const agregadoDe = (filas: readonly FilaBase[]): AgregadoCrecimientoApi => agregarFilas(filasCrecimiento(filas));

/** `Σ B` de las filas (con base); `null` sin filas o sin ninguna base. */
export function baseSiguienteDe(filas: readonly FilaBase[]): number | null {
  const conBase = filas.filter((f) => f.b !== null);
  return conBase.length === 0 ? null : conBase.reduce((a, f) => a + (f.b as number), 0);
}

/** `ρ = Σ B'' ÷ Σ B − 1` en %, sobre las filas con base; `null` sin base. Con un año normal da 0. */
export function reboteDe(filas: readonly FilaBase[]): number | null {
  let b = 0;
  let bn = 0;
  for (const f of filas) {
    if (f.b === null) continue;
    b += f.b;
    bn += f.bn ?? f.b;
  }
  return b > 0 ? r2((bn / b - 1) * 100) : null;
}

// ─── Equivalencias ───

/** Lo que una cifra significa para `Y+1`: la bruta, igual; la «sin Niño», con el rebote `ρ` (en %). */
export function equivalenteDe(bruto: number | null, sinNino: number | null, rebotePct: number | null): ReferenciaApi["equivalente"] {
  return {
    bruto,
    sin_nino_mas_rebote: sinNino !== null && rebotePct !== null ? r2(((1 + sinNino / 100) * (1 + rebotePct / 100) - 1) * 100) : null,
  };
}

/** El valor bruto-equivalente de una referencia en la variante elegida; `null` si no se pudo calcular. */
export function valorDeBase(ref: ReferenciaApi | undefined, variante: VarianteBase): number | null {
  if (!ref) return null;
  return variante === "bruto" ? ref.equivalente.bruto : ref.equivalente.sin_nino_mas_rebote;
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
};

export type ResultadoReferencias = {
  acumulado: ReferenciaApi;
  cierre_proyectado: ReferenciaApi;
  anios_completos: ReferenciaApi[];
  aplicado_hoy: ReferenciaApi;
  /** En el orden de la pantalla: acumulado, cierre proyectado, años completos y aplicado hoy. */
  todas: ReferenciaApi[];
  /** `U(Y−1)` de las mismas tiendas `C(Y)` (año completo). */
  unidades_anterior: number | null;
  base_siguiente: number | null;
  rebote_nino_pct: number | null;
};

const rangoTexto = (hasta: number) => (hasta <= 1 ? "ene" : `ene–${MESES_CORTOS[hasta - 1]}`);

function vacia(tipo: TipoReferencia, anio: number, etiqueta: string, periodo: string, motivo: MotivoNuloReferencia, tiendas = 0): ReferenciaApi {
  return {
    tipo,
    anio,
    variante_defecto: "bruto",
    etiqueta,
    periodo,
    tiendas,
    anterior: null,
    actual: null,
    pct_bruto: null,
    pct_sin_nino: null,
    equivalente: { bruto: null, sin_nino_mas_rebote: null },
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
  nino: boolean;
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
    nino: hayNino(e.entradas, z, e.phi, o) || hayNino(e.entradas, z - 1, e.phi, o),
    motivo: sinVenta ? "sin_venta" : bruto === null ? "denominador_cero" : null,
  };
}

function aReferencia(tipo: TipoReferencia, anio: number, etiqueta: string, periodo: string, c: Cifras, rebote: number | null, cobertura: number | null): ReferenciaApi {
  const equivalente = equivalenteDe(c.bruto, c.sin, rebote);
  return {
    tipo,
    anio,
    variante_defecto: c.nino && equivalente.sin_nino_mas_rebote !== null ? "sin_nino_mas_rebote" : "bruto",
    etiqueta,
    periodo,
    tiendas: c.tiendas,
    anterior: c.motivo === "sin_venta" ? null : c.anterior,
    actual: c.motivo === "sin_venta" ? null : c.actual,
    pct_bruto: c.bruto,
    pct_sin_nino: c.sin,
    equivalente,
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

/** Lo proyectado de `Y` por las filas base, mes a mes, bruto y sin Niño (para dibujar la curva de `Y`). */
export function proyectadoDeFilas(filas: readonly FilaBase[], y: number, phi: Phi): { anio: number; meses: number[]; mesesSinNino: number[] } | null {
  const conMeses = filas.filter((f) => f.meses_y !== null && f.meses_y.length === 12);
  if (conMeses.length === 0) return null;
  const meses = Array.from({ length: 12 }, () => 0);
  const sin = Array.from({ length: 12 }, () => 0);
  for (const f of conMeses) {
    const f12 = phi.de(f.temporada, y);
    (f.meses_y as readonly number[]).forEach((v, m) => {
      meses[m] = (meses[m] as number) + v;
      const fi = f12[m] as number;
      sin[m] = (sin[m] as number) + (fi > 0 ? v / fi : v);
    });
  }
  return { anio: y, meses, mesesSinNino: sin };
}

/** `Σ vigente_Y` de las filas y la misma suma con cada mes ÷ el φ de `Y` de su temporada (la fila escalada a su vigente). */
function cierreDeFilas(filas: readonly FilaBase[], y: number, phi: Phi): { actual: number; actualSin: number | null } {
  let actual = 0;
  let actualSin: number | null = 0;
  for (const f of filas) {
    const v = f.vigente_y ?? 0;
    actual += v;
    const meses = f.meses_y;
    if (actualSin === null) continue;
    if (v === 0) continue;
    const suma = meses ? meses.reduce((a, b) => a + b, 0) : 0;
    if (!meses || meses.length !== 12 || !(suma > 0)) {
      actualSin = null;
      continue;
    }
    const f12 = phi.de(f.temporada, y);
    const normalizada = meses.reduce((a, mes, m) => a + (f12[m] as number > 0 ? mes / (f12[m] as number) : mes), 0);
    actualSin += normalizada * (v / suma);
  }
  return { actual, actualSin };
}

/** Todas las referencias de un GM (o del Resto) con sus dos variantes. */
export function calcularReferencias(e: EntradaReferencias): ResultadoReferencias {
  const motivoProy = motivoDeProyeccion(e);
  const valida = motivoProy === null && e.proyeccion !== null;
  const rebote = valida ? reboteDe(e.filas) : null;
  const base = valida ? baseSiguienteDe(e.filas) : null;
  const k = e.k;

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
    acumulado = aReferencia("acumulado", e.y, `Acumulado ${rangoTexto(k)} ${e.y}`, `${rangoTexto(k)} ${e.y} frente a ${rangoTexto(k)} ${e.y - 1}`, c, rebote, cobertura);
    unidadesAnterior = anual > 0 ? r2(anual) : null;
  }

  // Cierre proyectado.
  let cierre: ReferenciaApi;
  const etiquetaCierre = `Cierre proyectado ${e.y}`;
  const periodoCierre = `${e.y} proyectado frente a ${e.y - 1}`;
  if (motivoProy !== null || e.proyeccion === null) {
    cierre = vacia("cierre_proyectado", e.y, etiquetaCierre, periodoCierre, motivoProy ?? "sin_referencia");
  } else {
    const mismas = e.proyeccion.mismas;
    const o: OpcionesSuma = { tiendas: mismas };
    const anteriorPorTienda = unidadesPorTienda(e.entradas, e.y - 1, o);
    const conVenta = [...anteriorPorTienda.entries()].filter(([, u]) => u > 0);
    const anterior = conVenta.reduce((a, [, u]) => a + u, 0);
    const anteriorSin = unidades(e.entradas, e.y - 1, { ...o, phi: e.phi });
    const { actual, actualSin } = cierreDeFilas(e.filas, e.y, e.phi);
    const bruto = pct(actual, anterior);
    let mayor: ReferenciaApi["tienda_mayor"] = null;
    if (conVenta.length > 0 && anterior > 0) {
      const [id, u] = conVenta.reduce((m, x) => (x[1] > m[1] || (x[1] === m[1] && x[0] < m[0]) ? x : m));
      mayor = { codigo: e.tiendas.get(id) ?? id, aporte_pct: r2((u / anterior) * 100), pct_sin_ella: null };
    }
    const c: Cifras = {
      tiendas: conVenta.length,
      anterior: r2(anterior),
      actual: r2(actual),
      bruto,
      sin: actualSin === null ? null : pct(actualSin, anteriorSin),
      fragil: conVenta.length < UMBRAL_FRAGIL_TIENDAS || anterior < UMBRAL_FRAGIL_UNIDADES,
      extremo: bruto !== null && Math.abs(bruto) > UMBRAL_EXTREMO_PCT,
      mayor,
      nino: hayNino(e.entradas, e.y, e.phi, o),
      motivo: conVenta.length === 0 ? "sin_venta" : bruto === null ? "denominador_cero" : null,
    };
    cierre = aReferencia("cierre_proyectado", e.y, etiquetaCierre, periodoCierre, c, rebote, null);
  }

  // Años completos.
  const completos = [...e.aniosCompletos]
    .sort((a, b) => b - a)
    .map((z) => {
      const c = cifrasComparadas(e, z, 12, e.comparables(z));
      return aReferencia("anio_completo", z, `Año completo ${z}`, `${z} frente a ${z - 1}`, c, rebote, null);
    });

  // Aplicado hoy.
  let aplicado: ReferenciaApi;
  const etiquetaAplicado = "Aplicado hoy";
  const periodoAplicado = `${e.y + 1} aplicado en la proyección frente a ${e.y} de las mismas tiendas`;
  if (motivoProy !== null || e.proyeccion === null || e.pctAplicado === null || base === null) {
    aplicado = vacia("aplicado_hoy", e.y, etiquetaAplicado, periodoAplicado, motivoProy ?? "sin_base");
  } else {
    const g = e.pctAplicado;
    const sin = rebote === null ? null : r2(((1 + g / 100) / (1 + rebote / 100) - 1) * 100);
    aplicado = {
      tipo: "aplicado_hoy",
      anio: e.y,
      variante_defecto: "bruto",
      etiqueta: etiquetaAplicado,
      periodo: periodoAplicado,
      tiendas: e.proyeccion.mismas.size,
      anterior: r2(base),
      actual: r2(base * (1 + g / 100)),
      pct_bruto: r2(g),
      pct_sin_nino: sin,
      equivalente: equivalenteDe(r2(g), sin, rebote),
      fragil: base < UMBRAL_FRAGIL_UNIDADES,
      extremo: Math.abs(g) > UMBRAL_EXTREMO_PCT,
      tienda_mayor: null,
      cobertura_pct: null,
      motivo_nulo: null,
    };
  }

  return {
    acumulado,
    cierre_proyectado: cierre,
    anios_completos: completos,
    aplicado_hoy: aplicado,
    todas: [acumulado, cierre, ...completos, aplicado],
    unidades_anterior: unidadesAnterior,
    base_siguiente: base,
    rebote_nino_pct: rebote,
  };
}
