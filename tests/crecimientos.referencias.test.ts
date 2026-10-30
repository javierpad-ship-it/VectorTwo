import { describe, expect, it } from "vitest";
import { baseCorregidaDe, calcularReaprobar, calcularReferencias, equivalenteDe, equivalenteReal, estadoDeProyeccion, METODO_MIN_REFERENCIA, periodoTocaNino, reboteDe, valorDeBase, type EntradaReferencias, type FilaBase, type ProyeccionParaReferencias } from "@/lib/crecimientos/referencias";
import { crearPhi, type SerieGM } from "@/lib/crecimientos/series";
import type { CierreGMApi } from "@/lib/crecimientos/tipos-api";
import { MESES_Y_HU, TOTAL_HU, repartir } from "./crecimientos.fixture";

/**
 * R10 y R28 (ficha 06e §5.4): las referencias dan su `equivalente.corregido` y `equivalente.bruto`; `sin_nino_mas_rebote` es siempre `null`; la
 * variante por defecto es `corregido`; «Aplicado hoy» de una `bruta` da 7,66 en el ejemplo D (dos decimales) y «Reaprobar» deja quieto el
 * total del GM. HOMBRE · URBANO (invierno, Niño de 2026 con φ = 0,80 en junio a agosto; 2025 normal). Sintético: `Y = 2026`, `k = setiembre`,
 * tres tiendas (T1, T2, T3) con pesos 50 / 30 / 20.
 */

const TIENDAS = ["T1", "T2", "T3"];
const PESOS = [0.5, 0.3, 0.2];
const CODIGOS = new Map(TIENDAS.map((t) => [t, t]));

function serieDeAnios(porAnio: Record<number, number[]>, temp = "invierno", tiendas = TIENDAS, pesos = PESOS): SerieGM[] {
  return tiendas.map((t, i) => {
    const u: Record<string, number> = {};
    for (const [anio, totales] of Object.entries(porAnio)) totales.forEach((total, m) => (u[`${anio}-${String(m + 1).padStart(2, "0")}`] = repartir(total, pesos)[i] as number));
    return { g: "h", m: "u", temp, t, u };
  });
}

// 2024 como en la ficha: 2025 es 5,0 % sobre 2024.
const POR_ANIO: Record<number, number[]> = { ...TOTAL_HU, 2024: [...Array.from({ length: 11 }, () => 4286), 4283] };

const phi = crearPhi(
  [
    { id: "p26", desde: "2026-06", hasta: "2026-08", motivo: "Niño", alcance: "invierno", temporadas: ["invierno"], activo: true },
    { id: "p23", desde: "2023-06", hasta: "2023-08", motivo: "Niño", alcance: "invierno", temporadas: ["invierno"], activo: true },
  ],
  [
    { anio: 2026, temporada: "invierno", ratio_calculado: 0.8, ratio_aplicado: null },
    { anio: 2023, temporada: "invierno", ratio_calculado: 0.9, ratio_aplicado: null },
  ]
);

const fila = (extra: Partial<FilaBase> = {}): FilaBase => ({
  fila_id: "f1",
  genero_id: "h",
  mundo_id: "u",
  gm: "h|u",
  temporada: "invierno",
  vigente_y: 55620,
  meses_y: MESES_Y_HU,
  b: 58900,
  bn: 63100,
  crecimiento_pct: null,
  decidido: null,
  propuesto: null,
  ...extra,
});

const proyeccion = (extra: Partial<ProyeccionParaReferencias> = {}): ProyeccionParaReferencias => ({
  estado: "valida",
  mismas: new Set(TIENDAS),
  filas: [fila()],
  pctPorGM: new Map(),
  restoPct: 5,
  ...extra,
});

function entrada(extra: Partial<EntradaReferencias> = {}): EntradaReferencias {
  const p = proyeccion();
  return {
    entradas: serieDeAnios(POR_ANIO),
    y: 2026,
    k: 9,
    comparables: () => new Set(TIENDAS),
    phi,
    tiendas: CODIGOS,
    aniosCompletos: [2025, 2024],
    proyeccion: p,
    filas: p.filas,
    pctAplicado: 5,
    sobreAplicado: "bruta",
    ...extra,
  };
}

const CIERRE: CierreGMApi = {
  k: 9,
  tiendas: 3,
  vendido: 41200,
  vendido_corregido: 44200,
  cierre: 55000,
  cierre_corregido: 58750,
  anterior: 54000,
  anterior_corregido: 54000,
  pct: 1.85,
  pct_corregido: 8.8,
  base_curva: { tiendas: 4, tiendas_fuera_cy: ["T10"], real: 56100, corregida: 59925 },
  avance: 0.8,
  avance_bajo: false,
  agrupaciones_avance_bajo: [],
  sin_curva_pct: null,
  hay_nino: true,
  correccion_curva_pct: 6.82,
  factor_parcial: true,
  sin_factor: false,
  motivo_nulo: null,
};

describe("R10 · las referencias con equivalente corregido y real", () => {
  const r = calcularReferencias(entrada({ cierre: CIERRE }));

  it("Acumulado: +3,0 % real, +10,5 % corregido, cobertura 74 %; el equivalente corregido es el % sin Niño y la variante por defecto, corregido", () => {
    const a = r.acumulado;
    expect(a).toMatchObject({ tipo: "acumulado", anio: 2026, tiendas: 3, anterior: 40000, actual: 41200, fragil: false, extremo: false, motivo_nulo: null, variante_defecto: "corregido" });
    expect(a.pct_bruto).toBe(3);
    expect(a.pct_sin_nino).toBe(10.5);
    expect(a.equivalente).toEqual({ corregido: 10.5, bruto: 3, sin_nino_mas_rebote: null });
    expect(a.cobertura_pct).toBeCloseTo(74, 0);
    expect(a.etiqueta).toBe("Acumulado ene–set 2026");
    expect(a.periodo).toBe("ene–set 2026 frente a ene–set 2025");
  });

  it("Cierre por curva: 55 000 contra 54 000 (+1,9 % real), 58 750 corregido (+8,8 %) y equivalente corregido 8,8", () => {
    const c = r.cierre_curva;
    expect(c).toMatchObject({ tipo: "cierre_curva", anio: 2026, tiendas: 3, anterior: 54000, actual: 55000, motivo_nulo: null, variante_defecto: "corregido", etiqueta: "Cierre 2026 por curva" });
    expect(c.pct_bruto).toBe(1.85);
    expect(c.pct_sin_nino).toBe(8.8);
    expect(c.equivalente).toEqual({ corregido: 8.8, bruto: 1.85, sin_nino_mas_rebote: null });
  });

  it("Año completo 2025: +5,0 % (años normales) y el equivalente corregido es el mismo; 2024 frente a 2023 (Niño): el real es mayor que el corregido", () => {
    const a = r.anios_completos.find((x) => x.anio === 2025)!;
    expect(a.pct_bruto).toBeCloseTo(5, 1);
    expect(a.equivalente.corregido).toBeCloseTo(5, 1);
    expect(a.variante_defecto).toBe("corregido");
    expect(r.anios_completos.map((x) => x.anio)).toEqual([2025, 2024]);
    const b = r.anios_completos.find((x) => x.anio === 2024)!;
    expect(b.pct_bruto).toBeCloseTo((51429 / 48000 - 1) * 100, 1);
    expect(b.pct_sin_nino).toBeLessThan(b.pct_bruto as number);
    expect(b.equivalente.corregido).toBe(b.pct_sin_nino);
  });

  it("la corrección del Niño es Σ B' ÷ Σ B − 1 = +7,1 % y la base corregida 63 100", () => {
    expect(r.correccion_nino_pct).toBeCloseTo(7.13, 2);
    expect(r.rebote_nino_pct).toBe(r.correccion_nino_pct);
    expect(reboteDe([fila()])).toBeCloseTo(7.13, 2);
    expect(r.base_siguiente).toBe(58900);
    expect(r.base_corregida).toBe(63100);
    expect(baseCorregidaDe([fila(), fila({ fila_id: "x", b: null, bn: null })])).toBe(63100);
  });

  it("Aplicado hoy de una versión bruta (5 % sobre 58 900): 61 845 real, equivalente corregido −2,0 y el bruto, el mismo 5", () => {
    const a = r.aplicado_hoy;
    expect(a).toMatchObject({ tipo: "aplicado_hoy", anterior: 58900, actual: 61845, pct_bruto: 5, motivo_nulo: null, variante_defecto: "corregido" });
    expect(a.pct_sin_nino).toBeCloseTo(-1.99, 1);
    expect(a.equivalente.bruto).toBe(5);
    expect(a.equivalente.corregido).toBeCloseTo(-1.99, 1);
    expect(a.equivalente.sin_nino_mas_rebote).toBeNull();
  });

  it("Aplicado hoy de una versión corregida: el % aplicado es el corregido y el real se calcula contra Σ B", () => {
    const c = calcularReferencias(entrada({ cierre: CIERRE, sobreAplicado: "corregida", pctAplicado: 8 })).aplicado_hoy;
    expect(c).toMatchObject({ anterior: 63100, pct_sin_nino: 8, motivo_nulo: null });
    expect(c.actual).toBeCloseTo(63100 * 1.08, 1);
    expect(c.pct_bruto).toBeCloseTo((63100 * 1.08) / 58900 * 100 - 100, 1);
    expect(c.equivalente.corregido).toBe(8);
    expect(c.equivalente.bruto).toBe(c.pct_bruto);
  });

  it("el orden de la pantalla: cierre por curva, acumulado, años completos y aplicado hoy; «cierre proyectado» ya no está", () => {
    expect(r.todas.map((x) => x.tipo)).toEqual(["cierre_curva", "acumulado", "anio_completo", "anio_completo", "aplicado_hoy"]);
    expect(r.unidades_anterior).toBe(54000);
  });

  it("valorDeBase: corregido y bruto; la variante retirada y la referencia ausente dan null", () => {
    expect(valorDeBase(r.acumulado, "corregido")).toBe(10.5);
    expect(valorDeBase(r.acumulado, "bruto")).toBe(3);
    expect(valorDeBase(r.acumulado, "sin_nino_mas_rebote")).toBeNull();
    expect(valorDeBase(undefined, "corregido")).toBeNull();
  });
});

describe("marcas: frágil, extremo, tienda mayor y cobertura", () => {
  it("la tienda mayor trae su aporte y el % sin ella", () => {
    const m = calcularReferencias(entrada()).acumulado.tienda_mayor;
    // T1 pesa 50 % de las 40 000 u. de 2025 ene–set. Sin ella: (41 200 − T1) ÷ (40 000 − T1) − 1.
    expect(m?.codigo).toBe("T1");
    expect(m?.aporte_pct).toBeCloseTo(50, 0);
    const t1ant = suma(TOTAL_HU[2025]!.slice(0, 9).map((v) => repartir(v, PESOS)[0] as number));
    const t1act = suma(TOTAL_HU[2026]!.map((v) => repartir(v, PESOS)[0] as number));
    expect(m?.pct_sin_ella).toBeCloseTo(((41200 - t1act) / (40000 - t1ant) - 1) * 100, 1);
  });

  it("frágil con menos de 3 tiendas o menos de 120 u. en el periodo anterior", () => {
    const dos = calcularReferencias(entrada({ entradas: serieDeAnios(POR_ANIO, "invierno", ["T1", "T2"], [0.6, 0.4]) })).acumulado;
    expect(dos.tiendas).toBe(2);
    expect(dos.fragil).toBe(true);
    const chico = calcularReferencias(entrada({ entradas: serieDeAnios({ 2025: Array(12).fill(10), 2026: Array(9).fill(12) }, "todo_el_ano") })).acumulado;
    expect(chico.anterior).toBe(90);
    expect(chico.fragil).toBe(true);
    expect(calcularReferencias(entrada()).acumulado.fragil).toBe(false);
  });

  it("extremo con |% bruto| > 50, sin bloquear nada", () => {
    const e = calcularReferencias(entrada({ entradas: serieDeAnios({ 2025: Array(12).fill(1000), 2026: Array(9).fill(2500) }, "todo_el_ano") })).acumulado;
    expect(e.pct_bruto).toBe(150);
    expect(e.extremo).toBe(true);
    const justo = calcularReferencias(entrada({ entradas: serieDeAnios({ 2025: Array(12).fill(1000), 2026: Array(9).fill(1500) }, "todo_el_ano") })).acumulado;
    expect(justo.pct_bruto).toBe(50);
    expect(justo.extremo).toBe(false);
  });

  it("k = diciembre: el acumulado cubre el año completo (cobertura 100 %)", () => {
    const a = calcularReferencias(entrada({ k: 12, entradas: serieDeAnios({ 2025: Array(12).fill(1000), 2026: Array(12).fill(1100) }, "todo_el_ano") })).acumulado;
    expect(a.cobertura_pct).toBe(100);
    expect(a.periodo).toBe("ene–dic 2026 frente a ene–dic 2025");
    expect(a.pct_bruto).toBe(10);
  });

  it("sin Niño con φ = 1 el corregido es idéntico al real (todo el año)", () => {
    const a = calcularReferencias(entrada({ entradas: serieDeAnios({ 2025: Array(12).fill(1000), 2026: Array(9).fill(1100) }, "todo_el_ano") })).acumulado;
    expect(a.pct_sin_nino).toBe(a.pct_bruto);
    expect(a.equivalente.corregido).toBe(a.equivalente.bruto);
  });
});

describe("referencias que dependen de la proyección o del cierre: motivos nulos", () => {
  it("método anterior: aplicado hoy, B y la corrección son null; el cierre por curva y el acumulado siguen", () => {
    const p = proyeccion({ estado: "metodo_anterior", filas: [] });
    const r = calcularReferencias(entrada({ proyeccion: p, filas: [], pctAplicado: null, cierre: CIERRE }));
    expect(r.aplicado_hoy).toMatchObject({ motivo_nulo: "metodo_anterior", pct_bruto: null, anterior: null });
    expect(r.base_siguiente).toBeNull();
    expect(r.base_corregida).toBeNull();
    expect(r.correccion_nino_pct).toBeNull();
    expect(r.acumulado.pct_bruto).toBe(3);
    expect(r.cierre_curva.pct_sin_nino).toBe(8.8);
  });

  it("sin proyección elegida: aplicado hoy sin_referencia; sin base: sin_base; GM sin filas base: sin_base", () => {
    expect(calcularReferencias(entrada({ proyeccion: null, filas: [], pctAplicado: null })).aplicado_hoy.motivo_nulo).toBe("sin_referencia");
    const sinBase = proyeccion({ estado: "sin_base", filas: [fila({ b: null, bn: null })] });
    expect(calcularReferencias(entrada({ proyeccion: sinBase, filas: sinBase.filas })).aplicado_hoy.motivo_nulo).toBe("sin_base");
    expect(calcularReferencias(entrada({ filas: [] })).aplicado_hoy.motivo_nulo).toBe("sin_base");
  });

  it("el cierre por curva sin cierre o con su motivo nulo queda vacío con ese motivo", () => {
    expect(calcularReferencias(entrada()).cierre_curva.motivo_nulo).toBe("sin_curva");
    expect(calcularReferencias(entrada({ k: null })).cierre_curva.motivo_nulo).toBe("sin_venta");
    const r = calcularReferencias(entrada({ cierre: { ...CIERRE, cierre: null, cierre_corregido: null, pct: null, pct_corregido: null, motivo_nulo: "meses_faltantes" } }));
    expect(r.cierre_curva).toMatchObject({ motivo_nulo: "meses_faltantes", pct_bruto: null, actual: null, variante_defecto: "corregido" });
    expect(r.cierre_curva.equivalente.corregido).toBeNull();
  });

  it("un año normal da corrección 0 y el equivalente corregido de una referencia es el mismo número", () => {
    const f = fila({ bn: 58900 });
    const r = calcularReferencias(entrada({ filas: [f], proyeccion: proyeccion({ filas: [f] }) }));
    expect(r.correccion_nino_pct).toBe(0);
    expect(r.acumulado.equivalente.corregido).toBe(r.acumulado.pct_sin_nino);
  });

  it("denominador cero o sin venta: cifras null con su motivo", () => {
    const sinAnterior = calcularReferencias(entrada({ entradas: serieDeAnios({ 2026: Array(9).fill(100) }, "todo_el_ano") })).acumulado;
    expect(sinAnterior.motivo_nulo).toBe("denominador_cero");
    expect(sinAnterior.pct_bruto).toBeNull();
    const sinNada = calcularReferencias(entrada({ entradas: [] })).acumulado;
    expect(sinNada.motivo_nulo).toBe("sin_venta");
    expect(sinNada.tiendas).toBe(0);
    const sinK = calcularReferencias(entrada({ k: null })).acumulado;
    expect(sinK.motivo_nulo).toBe("sin_venta");
  });

  it("estadoDeProyeccion: método ≥ 5 y Σ B positiva", () => {
    expect(METODO_MIN_REFERENCIA).toBe(5);
    expect(estadoDeProyeccion(5, [{ b: 10 }])).toBe("valida");
    expect(estadoDeProyeccion(4, [{ b: 10 }])).toBe("metodo_anterior");
    expect(estadoDeProyeccion(null, [{ b: 10 }])).toBe("metodo_anterior");
    expect(estadoDeProyeccion(5, [{ b: null }, { b: 0 }])).toBe("sin_base");
    expect(estadoDeProyeccion(5, [])).toBe("sin_base");
  });
});

describe("equivalencias", () => {
  it("equivalenteDe lleva corregido y bruto y nunca sin_nino_mas_rebote", () => {
    expect(equivalenteDe(3, 10.5)).toEqual({ corregido: 10.5, bruto: 3, sin_nino_mas_rebote: null });
    expect(equivalenteDe(null, null)).toEqual({ corregido: null, bruto: null, sin_nino_mas_rebote: null });
  });

  it("equivalenteReal: (1 + g) × B' ÷ B − 1; sin bases, null", () => {
    expect(equivalenteReal(8, 56100, 59925)).toBeCloseTo(15.36, 2);
    expect(equivalenteReal(8, null, 59925)).toBeNull();
    expect(equivalenteReal(8, 0, 1)).toBeNull();
  });
});

// El ejemplo D: ABRIGO B = 15 300 (B' = 19 125) y POLO B = 40 800 (sin Niño), versión bruta de 15 %.
const ABRIGO = fila({ fila_id: "abrigo", temporada: "invierno", b: 15300, bn: 19125 });
const POLO = fila({ fila_id: "polo", temporada: "todo_el_ano", b: 40800, bn: 40800 });

describe("R10 y R28 · «Aplicado hoy» de una bruta y reaprobar (ejemplo D)", () => {
  it("el equivalente corregido de una bruta de 15 % es 7,66 con dos decimales", () => {
    const p = proyeccion({ filas: [ABRIGO, POLO] });
    const a = calcularReferencias(entrada({ proyeccion: p, filas: p.filas, pctAplicado: 15, sobreAplicado: "bruta" })).aplicado_hoy;
    expect(a.equivalente.corregido).toBe(7.66);
    expect(a.equivalente.bruto).toBe(15);
    expect(a.pct_sin_nino).toBeCloseTo(7.66, 2);
  });

  it("reaprobar conserva el total del GM, sube el invierno y baja el todo el año", () => {
    const r = calcularReaprobar([ABRIGO, POLO], 15)!;
    expect(r.pct_equivalente).toBe(7.66);
    expect(r.total_antes).toBe(17595 + 46920);
    expect(r.total_despues).toBe(20590 + 43925);
    expect(r.total_despues).toBe(r.total_antes);
    expect(r).toMatchObject({ filas_suben: 1, filas_bajan: 1, unidades_movidas: 2995, decididas_con_propuesta_cambio: 0 });
  });

  it("con un decimal (7,7) el GM daría 64 540 (+25): por eso el equivalente lleva dos", () => {
    expect(Math.round(19125 * 1.077) + Math.round(40800 * 1.077)).toBe(64540);
  });

  it("una fila decidida no se mueve: cuenta como «propuesta cambió» y no entra en los totales", () => {
    const decidida = { ...ABRIGO, fila_id: "abrigo-decidida", decidido: 21000, propuesto: 17595 };
    const r = calcularReaprobar([decidida, POLO, fila({ fila_id: "otra", b: 10000, bn: 10000 })], 15)!;
    expect(r.decididas_con_propuesta_cambio).toBe(1);
    // F = POLO y la otra fila (las que siguen al GM): la decidida queda fuera.
    expect(r.total_antes).toBe(46920 + 11500);
    expect(r.pct_equivalente).toBe(15);
    expect(r.total_despues).toBe(r.total_antes);
    expect(r.filas_suben + r.filas_bajan).toBe(0);
  });

  it("una fila con % propio no sigue al GM; sin filas que sigan, se mide con todas; sin base, null", () => {
    const propia = { ...ABRIGO, fila_id: "propia", crecimiento_pct: 20 };
    const r = calcularReaprobar([propia, POLO], 15)!;
    expect(r.pct_equivalente).toBe(15);
    expect(calcularReaprobar([propia], 15)?.pct_equivalente).toBe(-8);
    expect(calcularReaprobar([], 15)).toBeNull();
    expect(calcularReaprobar([fila({ b: null, bn: null })], 15)).toBeNull();
  });
});

describe("R12 · el periodo de una referencia toca un año Niño", () => {
  const entradas = serieDeAnios(POR_ANIO);
  it("2026 (Niño de invierno) sí; 2025 frente a 2024 (normales) no; 2024 frente a 2023 (Niño de 2023) sí", () => {
    expect(periodoTocaNino({ tipo: "acumulado", anio: 2026 }, entradas, phi)).toBe(true);
    expect(periodoTocaNino({ tipo: "cierre_curva", anio: 2026 }, entradas, phi)).toBe(true);
    expect(periodoTocaNino({ tipo: "anio_completo", anio: 2025 }, entradas, phi)).toBe(false);
    expect(periodoTocaNino({ tipo: "anio_completo", anio: 2024 }, entradas, phi)).toBe(true);
  });
});

function suma(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
