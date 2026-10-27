import { describe, expect, it } from "vitest";
import { calcularReferencias, equivalenteDe, estadoDeProyeccion, proyectadoDeFilas, reboteDe, valorDeBase, type EntradaReferencias, type FilaBase, type ProyeccionParaReferencias } from "@/lib/crecimientos/referencias";
import { crearPhi, type SerieGM } from "@/lib/crecimientos/series";
import { MESES_Y_HU, TOTAL_HU, repartir } from "./crecimientos.fixture";

/**
 * Regla 12 (ficha 06d §5.2): el ejemplo de §5.1 debe dar 3,0 / 10,5 / 18,4 / 5,0 / 12,5 / −2,0 y cobertura 74 %. HOMBRE · URBANO
 * (invierno, Niño de 2026 con φ = 0,80 en junio a agosto; 2025 normal). Una referencia de método 3 da `null` con `metodo_anterior`.
 * Sintético: `Y = 2026`, `k = setiembre`, tres tiendas (T1, T2, T3) con pesos 50 / 30 / 20.
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
    ...extra,
  };
}

describe("regla 12 · el ejemplo de la ficha (§5.1)", () => {
  const r = calcularReferencias(entrada());

  it("Acumulado: +3,0 % bruto, +10,5 % sin Niño, +18,4 % equivalente y cobertura 74 %", () => {
    const a = r.acumulado;
    expect(a).toMatchObject({ tipo: "acumulado", anio: 2026, tiendas: 3, anterior: 40000, actual: 41200, fragil: false, extremo: false, motivo_nulo: null, variante_defecto: "sin_nino_mas_rebote" });
    expect(a.pct_bruto).toBe(3);
    expect(a.pct_sin_nino).toBe(10.5);
    expect(a.equivalente.bruto).toBe(3);
    expect(a.equivalente.sin_nino_mas_rebote).toBeCloseTo(18.4, 1);
    expect(a.cobertura_pct).toBeCloseTo(74, 0);
    expect(a.etiqueta).toBe("Acumulado ene–set 2026");
    expect(a.periodo).toBe("ene–set 2026 frente a ene–set 2025");
  });

  it("ρ = 63 100 ÷ 58 900 − 1 = +7,1 %", () => {
    expect(r.rebote_nino_pct).toBeCloseTo(7.13, 2);
    expect(reboteDe([fila()])).toBeCloseTo(7.13, 2);
    expect(r.base_siguiente).toBe(58900);
  });

  it("Cierre proyectado: +3,0 % bruto, +10,4 % sin Niño, +18,3 % equivalente", () => {
    const c = r.cierre_proyectado;
    expect(c).toMatchObject({ tipo: "cierre_proyectado", tiendas: 3, anterior: 54000, actual: 55620, motivo_nulo: null });
    expect(c.pct_bruto).toBe(3);
    expect(c.pct_sin_nino).toBeCloseTo(10.4, 1);
    expect(c.equivalente.sin_nino_mas_rebote).toBeCloseTo(18.3, 1);
    expect(c.cobertura_pct).toBeNull();
  });

  it("Año completo 2025: +5,0 % (años normales) y equivalente +12,5 % con rebote", () => {
    const a = r.anios_completos.find((x) => x.anio === 2025)!;
    expect(a.pct_bruto).toBeCloseTo(5, 1);
    expect(a.pct_sin_nino).toBeCloseTo(5, 1);
    expect(a.equivalente.sin_nino_mas_rebote).toBeCloseTo(12.5, 1);
    expect(a.variante_defecto).toBe("bruto");
    expect(r.anios_completos.map((x) => x.anio)).toEqual([2025, 2024]);
  });

  it("Año completo 2024 frente a 2023 (Niño): el bruto es mayor que el sin Niño", () => {
    const a = r.anios_completos.find((x) => x.anio === 2024)!;
    expect(a.pct_bruto).toBeCloseTo(((51429 / 48000 - 1) * 100), 1);
    expect(a.pct_sin_nino).toBeLessThan(a.pct_bruto as number);
    expect(a.variante_defecto).toBe("sin_nino_mas_rebote");
  });

  it("Aplicado hoy: 5 % sobre 58 900 = 61 845 y −2,0 % sin Niño", () => {
    const a = r.aplicado_hoy;
    expect(a).toMatchObject({ tipo: "aplicado_hoy", anterior: 58900, actual: 61845, pct_bruto: 5, motivo_nulo: null });
    expect(a.pct_sin_nino).toBeCloseTo(-2, 1);
    expect(a.equivalente.bruto).toBe(5);
    expect(a.equivalente.sin_nino_mas_rebote).toBeCloseTo(5, 1);
  });

  it("el orden de la pantalla: acumulado, cierre proyectado, años completos y aplicado hoy", () => {
    expect(r.todas.map((x) => x.tipo)).toEqual(["acumulado", "cierre_proyectado", "anio_completo", "anio_completo", "aplicado_hoy"]);
    expect(r.unidades_anterior).toBe(54000);
  });

  it("valorDeBase elige la variante pedida; con una referencia ausente da null", () => {
    expect(valorDeBase(r.acumulado, "bruto")).toBe(3);
    expect(valorDeBase(r.acumulado, "sin_nino_mas_rebote")).toBeCloseTo(18.4, 1);
    expect(valorDeBase(undefined, "bruto")).toBeNull();
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

  it("sin Niño con φ = 1 es idéntico al bruto (todo el año)", () => {
    const a = calcularReferencias(entrada({ entradas: serieDeAnios({ 2025: Array(12).fill(1000), 2026: Array(9).fill(1100) }, "todo_el_ano") })).acumulado;
    expect(a.pct_sin_nino).toBe(a.pct_bruto);
    expect(a.variante_defecto).toBe("bruto");
  });
});

describe("referencias que dependen de la proyección: motivos nulos", () => {
  it("método anterior: cierre proyectado, aplicado hoy, B y ρ son null y la variante con rebote también", () => {
    const p = proyeccion({ estado: "metodo_anterior", filas: [] });
    const r = calcularReferencias(entrada({ proyeccion: p, filas: [], pctAplicado: null }));
    for (const ref of [r.cierre_proyectado, r.aplicado_hoy]) {
      expect(ref.motivo_nulo).toBe("metodo_anterior");
      expect(ref.pct_bruto).toBeNull();
      expect(ref.anterior).toBeNull();
    }
    expect(r.base_siguiente).toBeNull();
    expect(r.rebote_nino_pct).toBeNull();
    expect(r.acumulado.pct_bruto).toBe(3);
    expect(r.acumulado.equivalente.sin_nino_mas_rebote).toBeNull();
    expect(r.acumulado.variante_defecto).toBe("bruto");
    expect(r.anios_completos[0]?.equivalente.sin_nino_mas_rebote).toBeNull();
  });

  it("sin proyección elegida: sin_referencia; sin base: sin_base; GM sin filas base: sin_base", () => {
    expect(calcularReferencias(entrada({ proyeccion: null, filas: [], pctAplicado: null })).cierre_proyectado.motivo_nulo).toBe("sin_referencia");
    const sinBase = proyeccion({ estado: "sin_base", filas: [fila({ b: null, bn: null })] });
    expect(calcularReferencias(entrada({ proyeccion: sinBase, filas: sinBase.filas })).aplicado_hoy.motivo_nulo).toBe("sin_base");
    expect(calcularReferencias(entrada({ filas: [] })).cierre_proyectado.motivo_nulo).toBe("sin_base");
  });

  it("un año normal da rebote 0 y el equivalente sin Niño es el mismo número", () => {
    const f = fila({ bn: 58900 });
    const r = calcularReferencias(entrada({ filas: [f], proyeccion: proyeccion({ filas: [f] }) }));
    expect(r.rebote_nino_pct).toBe(0);
    expect(r.acumulado.equivalente.sin_nino_mas_rebote).toBe(r.acumulado.pct_sin_nino);
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

  it("estadoDeProyeccion: método ≥ 4 y Σ B positiva", () => {
    expect(estadoDeProyeccion(4, [{ b: 10 }])).toBe("valida");
    expect(estadoDeProyeccion(3, [{ b: 10 }])).toBe("metodo_anterior");
    expect(estadoDeProyeccion(null, [{ b: 10 }])).toBe("metodo_anterior");
    expect(estadoDeProyeccion(4, [{ b: null }, { b: 0 }])).toBe("sin_base");
    expect(estadoDeProyeccion(4, [])).toBe("sin_base");
  });
});

describe("equivalencias y lo proyectado", () => {
  it("equivalenteDe: la bruta se queda; la sin Niño suma el rebote; sin rebote es null", () => {
    expect(equivalenteDe(3, 10.5, 7.13)).toEqual({ bruto: 3, sin_nino_mas_rebote: 18.38 });
    expect(equivalenteDe(3, 10.5, null)).toEqual({ bruto: 3, sin_nino_mas_rebote: null });
    expect(equivalenteDe(null, null, 7)).toEqual({ bruto: null, sin_nino_mas_rebote: null });
  });

  it("proyectadoDeFilas suma los meses de Y de las filas y su versión sin Niño por la temporada de cada fila", () => {
    const p = proyectadoDeFilas([fila(), fila({ fila_id: "f2", temporada: "todo_el_ano", meses_y: Array(12).fill(100), vigente_y: 1200 })], 2026, phi)!;
    expect(p.anio).toBe(2026);
    expect(p.meses[0]).toBe(4500);
    expect(p.mesesSinNino[5]).toBeCloseTo(5333 / 0.8 + 100, 2);
    expect(p.mesesSinNino[0]).toBe(4500);
    expect(proyectadoDeFilas([fila({ meses_y: null })], 2026, phi)).toBeNull();
  });
});

function suma(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
