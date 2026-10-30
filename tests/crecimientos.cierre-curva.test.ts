import { describe, expect, it } from "vitest";
import { armarFactorY, cerrarConjunto, cierreDeGM, comoDiagnostico, diagnosticoVeranoGM, variacionCierre, type CurvaDeAgrupacion, type EntradaCierreGM } from "@/lib/crecimientos/cierre-curva";
import { aniosDeRed, calcularRedes, ventaTotalPorTienda } from "@/lib/crecimientos/comparables";
import { baseDefectoDe, type FilaBase } from "@/lib/crecimientos/referencias";
import { crearPhi, type SerieGM } from "@/lib/crecimientos/series";
import type { ReferenciaApi } from "@/lib/crecimientos/tipos-api";
import { correccionMaterial } from "@/lib/proyeccion/factor-nino";

/**
 * R8, R9 y R30 (ficha 06e §5.1 y §5.3): el ejemplo A (HOMBRE · URBANO) da 55 000 / 58 750 / +1,9 % / +8,8 % sobre `C(2026)` y 56 100 /
 * 59 925 sobre `M(2027)`. Sintético: `Y = 2026`, `k = setiembre`, nueve tiendas comunes (T1 a T9) y T10, que abrió en marzo de 2025.
 */

const PUBLICADOS = new Set<string>();
for (let a = 2024; a <= 2026; a++) for (let m = 1; m <= 12; m++) if (a < 2026 || m <= 9) PUBLICADOS.add(`${a}-${String(m).padStart(2, "0")}`);
const mes = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;

const TIENDAS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];
const CY = new Set(TIENDAS);
const MISMAS = new Set([...TIENDAS, "t10"]);
const CODIGOS = new Map([...TIENDAS, "t10"].map((t) => [t, t.toUpperCase()]));

/** Una curva con `acum` acumulado en los nueve primeros meses (repartido parejo) y los tres últimos dados. */
const curva = (id: string, version: number, acum: number, cola: [number, number, number]): CurvaDeAgrupacion => ({
  id,
  version,
  c: [...Array.from({ length: 9 }, () => acum / 9), ...cola],
});
const CURVAS = new Map<string, CurvaDeAgrupacion>([
  ["abrigos", curva("c-abrigos", 3, 0.8, [0.05, 0.07, 0.08])],
  ["polos", curva("c-polos", 2, 0.73, [0.08, 0.09, 0.1])],
]);
const NOMBRES = new Map([
  ["abrigos", "ABRIGOS HO"],
  ["polos", "POLOS HO"],
]);

/** Reparte `total` entre las tiendas en partes iguales, ene–`hasta` de `anio`. */
function serie(a: string | null, temp: string, tiendas: string[], anio: number, total: number, hasta = 12, desde = 1): SerieGM[] {
  const meses = hasta - desde + 1;
  return tiendas.map((t) => {
    const u: Record<string, number> = {};
    for (let m = desde; m <= hasta; m++) u[mes(anio, m)] = total / tiendas.length / meses;
    return { g: "h", m: "u", temp, a, t, u };
  });
}
const juntar = (...xs: SerieGM[][]): SerieGM[] => {
  // Una serie por (agrupación, tienda): une los años.
  const porClave = new Map<string, SerieGM>();
  for (const s of xs.flat()) {
    const k = `${s.a}|${s.t}`;
    const previa = porClave.get(k);
    porClave.set(k, previa ? { ...previa, u: { ...previa.u, ...s.u } } : s);
  }
  return [...porClave.values()];
};

const PERIODOS = [{ id: "p26", desde: "2026-01", hasta: "2026-12", motivo: "Niño", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true }];
const phiNino = (f: number) => crearPhi(PERIODOS, [{ anio: 2026, temporada: "invierno", ratio_calculado: f, ratio_aplicado: null }]);
const SIN_NINO = crearPhi([], []);

/** Ejemplo A: ABRIGOS (invierno, 12 000 hasta setiembre) y POLOS (todo el año, 29 200); 2025 con 54 000 en total; T10 aparte. */
const ENTRADAS_A = juntar(
  serie("abrigos", "invierno", TIENDAS, 2026, 12000, 9),
  serie("polos", "todo_el_ano", TIENDAS, 2026, 29200, 9),
  serie("abrigos", "invierno", TIENDAS, 2025, 14000),
  serie("polos", "todo_el_ano", TIENDAS, 2025, 40000),
  // T10: ABRIGOS 240 (corregido 300) y POLOS 584 hasta setiembre de 2026; nada en 2025 entero (abrió en marzo).
  serie("abrigos", "invierno", ["t10"], 2026, 240, 9),
  serie("polos", "todo_el_ano", ["t10"], 2026, 584, 9)
);

const entrada = (extra: Partial<EntradaCierreGM> = {}): EntradaCierreGM => ({
  entradas: ENTRADAS_A,
  y: 2026,
  k: 9,
  publicados: PUBLICADOS,
  cy: CY,
  mismas: MISMAS,
  codigos: CODIGOS,
  phi: phiNino(0.8),
  curvas: CURVAS,
  nombres: NOMBRES,
  ...extra,
});

describe("R8 · cierre por curva: el ejemplo A", () => {
  const r = cierreDeGM(entrada());

  it("sobre C(2026): 55 000 real, 58 750 corregido, +1,9 % y +8,8 %", () => {
    expect(r.api.vendido).toBeCloseTo(41200, 1);
    expect(r.api.vendido_corregido).toBeCloseTo(44200, 1);
    expect(r.api.cierre).toBeCloseTo(55000, 1);
    expect(r.api.cierre_corregido).toBeCloseTo(58750, 1);
    expect(r.api.anterior).toBeCloseTo(54000, 1);
    expect(r.api.pct).toBeCloseTo(1.85, 2);
    expect(r.api.pct_corregido).toBeCloseTo(8.8, 1);
    expect(r.api.tiendas).toBe(9);
    expect(r.api.motivo_nulo).toBeNull();
  });

  it("por agrupación: ABRIGOS 15 000 / 18 750 y POLOS 40 000 / 40 000, con su curva, su avance y su factor", () => {
    const abrigos = r.por_agrupacion.find((a) => a.agrupacion_id === "abrigos")!;
    expect(abrigos).toMatchObject({ nombre: "ABRIGOS HO", temporada: "invierno", curva: { id: "c-abrigos", version: 3 }, avance: 0.8, avance_bajo: false });
    expect(abrigos.cierre).toBeCloseTo(15000, 1);
    expect(abrigos.cierre_corregido).toBeCloseTo(18750, 1);
    expect(abrigos.vendido_corregido).toBeCloseTo(15000, 1);
    expect(abrigos.factor_meses).toEqual(Array(12).fill(0.8));
    // Oct, nov y dic: 750, 1 050 y 1 200 reales; 937,5 · 1 312,5 · 1 500 corregidos (18 750 × la curva).
    expect(abrigos.meses.slice(9)).toEqual([750, 1050, 1200]);
    expect(abrigos.meses_corregidos.slice(9)).toEqual([937.5, 1312.5, 1500]);
    const polos = r.por_agrupacion.find((a) => a.agrupacion_id === "polos")!;
    expect(polos.cierre).toBeCloseTo(40000, 1);
    expect(polos.cierre_corregido).toBeCloseTo(40000, 1);
    expect(polos.meses.slice(9)).toEqual([3200, 3600, 4000]);
  });

  it("la serie corregida de oct, nov y dic del GM: 4 137,5 · 4 912,5 · 5 500 (el ejemplo suma las dos agrupaciones)", () => {
    const corregidos = r.cy.meses_corregidos.slice(9) as number[];
    expect(corregidos[0]).toBeCloseTo(937.5 + 3200, 1);
    expect(corregidos[1]).toBeCloseTo(1312.5 + 3600, 1);
    expect(corregidos[2]).toBeCloseTo(1500 + 4000, 1);
  });

  it("sobre M(2027) (las nueve y T10): 56 100 real y 59 925 corregido, corrección +6,8 % y material", () => {
    expect(r.api.base_curva).toMatchObject({ tiendas: 10, tiendas_fuera_cy: ["T10"] });
    expect(r.api.base_curva?.real).toBeCloseTo(56100, 1);
    expect(r.api.base_curva?.corregida).toBeCloseTo(59925, 1);
    expect(r.api.correccion_curva_pct).toBeCloseTo(6.82, 1);
    expect(r.api.hay_nino).toBe(true);
    expect(r.serie_base_curva?.real.reduce((a, b) => a + b, 0)).toBeCloseTo(56100, 0);
    expect(r.serie_base_curva?.corregida.reduce((a, b) => a + b, 0)).toBeCloseTo(59925, 0);
    // T10 solo aporta a la base por curva: ABRIGOS 300 real y 375 corregido; POLOS 800.
    const abrigos = r.por_agrupacion.find((a) => a.agrupacion_id === "abrigos")!;
    expect(abrigos.base_curva).toBeCloseTo(15300, 1);
    expect(abrigos.base_curva_corregida).toBeCloseTo(19125, 1);
  });

  it("la vista previa del ejemplo: 59 925 × 1,08 = 64 719 sobre las tiendas de 2027 y +15,4 % sobre 56 100", () => {
    const corregida = r.api.base_curva?.corregida as number;
    expect(Math.round(corregida * 1.08)).toBe(64719);
    expect((corregida * 1.08) / (r.api.base_curva?.real as number) - 1).toBeCloseTo(0.1536, 3);
  });

  it("con k = 12 el cierre es la venta real y el corregido es real ÷ φ", () => {
    const completo = new Set<string>();
    for (let a = 2024; a <= 2026; a++) for (let m = 1; m <= 12; m++) completo.add(mes(a, m));
    const entradas = juntar(serie("abrigos", "invierno", TIENDAS, 2026, 12000), serie("abrigos", "invierno", TIENDAS, 2025, 14000));
    const c = cierreDeGM(entrada({ entradas, k: 12, publicados: completo }));
    expect(c.api.cierre).toBeCloseTo(12000, 1);
    expect(c.api.cierre_corregido).toBeCloseTo(15000, 1);
  });
});

describe("R9 · sin Niño no hay línea corregida", () => {
  it("con φ = 1 en todos los meses el corregido es el real, hay_nino es false y K'_M = K_M", () => {
    const r = cierreDeGM(entrada({ phi: SIN_NINO }));
    expect(r.api.hay_nino).toBe(false);
    expect(r.api.cierre_corregido).toBeCloseTo(r.api.cierre as number, 6);
    expect(r.api.pct_corregido).toBeCloseTo(r.api.pct as number, 6);
    expect(r.api.base_curva?.corregida).toBeCloseTo(r.api.base_curva?.real as number, 6);
    expect(r.api.correccion_curva_pct).toBe(0);
  });

  it("con φ constante el cierre real no depende de φ (0,70 o 0,80 dan lo mismo); lo corregido sí", () => {
    const a = cierreDeGM(entrada({ phi: phiNino(0.8) }));
    const b = cierreDeGM(entrada({ phi: phiNino(0.7) }));
    expect(a.api.cierre).toBeCloseTo(b.api.cierre as number, 6);
    expect((b.api.cierre_corregido as number) / (a.api.cierre_corregido as number)).toBeGreaterThan(1);
    // El abrigo corregido con 0,70 es el de 0,80 × 0,80 ÷ 0,70.
    const abrigoA = a.por_agrupacion.find((x) => x.agrupacion_id === "abrigos")!;
    const abrigoB = b.por_agrupacion.find((x) => x.agrupacion_id === "abrigos")!;
    expect((abrigoB.cierre_corregido as number) / (abrigoA.cierre_corregido as number)).toBeCloseTo(0.8 / 0.7, 6);
  });

  it("la materialidad la decide correccionMaterial: un GM al +0,49 % no tiene Niño y uno al +0,50 % sí", () => {
    expect(correccionMaterial(10000, 10049)).toBe(false);
    expect(correccionMaterial(10000, 10050)).toBe(true);
    expect(correccionMaterial(10000, 9950)).toBe(true);
  });
});

describe("R8 · sin curva, meses faltantes y sin venta", () => {
  it("una agrupación sin curva se cierra con la compuesta del GM y deja sin_curva_pct", () => {
    const entradas = juntar(serie("abrigos", "invierno", TIENDAS, 2026, 12000, 9), serie("abrigos", "invierno", TIENDAS, 2025, 14000), serie("nueva", "todo_el_ano", TIENDAS, 2026, 900, 9), serie("nueva", "todo_el_ano", TIENDAS, 2025, 1000));
    const r = cierreDeGM(entrada({ entradas, phi: SIN_NINO }));
    const nueva = r.por_agrupacion.find((a) => a.agrupacion_id === "nueva")!;
    expect(nueva.curva).toBeNull();
    // Con una sola curva en el GM, la compuesta es la de ABRIGOS (C_9 = 0,80): T' = 900 ÷ 0,80.
    expect(nueva.cierre).toBeCloseTo(1125, 1);
    expect(r.api.sin_curva_pct).toBeCloseTo((900 / (12000 + 900)) * 100, 1);
    expect(r.api.motivo_nulo).toBeNull();
  });

  it("un GM sin ninguna curva da cierre null con sin_curva (y la base por curva también)", () => {
    const entradas = juntar(serie("nueva", "todo_el_ano", TIENDAS, 2026, 900, 9), serie("nueva", "todo_el_ano", TIENDAS, 2025, 1000));
    const r = cierreDeGM(entrada({ entradas, curvas: new Map() }));
    expect(r.api.cierre).toBeNull();
    expect(r.api.cierre_corregido).toBeNull();
    expect(r.api.motivo_nulo).toBe("sin_curva");
    expect(r.api.base_curva?.real).toBeNull();
    expect(r.serie_base_curva).toBeNull();
  });

  it("sin agrupación activa (a null) también cae a la compuesta", () => {
    const entradas = juntar(serie("abrigos", "invierno", TIENDAS, 2026, 12000, 9), serie("abrigos", "invierno", TIENDAS, 2025, 14000), serie(null, "sin_agrupacion", TIENDAS, 2026, 400, 9));
    const r = cierreDeGM(entrada({ entradas, phi: SIN_NINO }));
    const sin = r.por_agrupacion.find((a) => a.agrupacion_id === null)!;
    expect(sin).toMatchObject({ nombre: "Sin agrupación activa", curva: null });
    expect(sin.cierre).toBeCloseTo(500, 1);
  });

  it("un mes ≤ k sin publicar da null con meses_faltantes (M5)", () => {
    const sinAgosto = new Set([...PUBLICADOS].filter((m) => m !== "2026-08"));
    const r = cierreDeGM(entrada({ publicados: sinAgosto }));
    expect(r.api.motivo_nulo).toBe("meses_faltantes");
    expect(r.api.cierre).toBeNull();
    expect(r.api.vendido).toBeGreaterThan(0);
    expect(r.por_agrupacion.every((a) => a.cierre === null)).toBe(true);
  });

  it("sin meses cerrados de Y (k null) no hay cierre", () => {
    const r = cierreDeGM(entrada({ k: null }));
    expect(r.api).toMatchObject({ k: null, cierre: null, motivo_nulo: "sin_venta", base_curva: null });
  });

  it("max(0, ·): una agrupación con devoluciones netas en un mes no resta", () => {
    const entradas: SerieGM[] = [{ g: "h", m: "u", temp: "todo_el_ano", a: "polos", t: "t1", u: { "2026-01": -50, "2026-02": 100 } }];
    const c = cerrarConjunto({ entradas, y: 2026, k: 2, publicados: new Set(["2026-01", "2026-02"]), tiendas: new Set(["t1"]), phi: SIN_NINO, curvas: new Map([["polos", curva("p", 1, 0.2, [0.1, 0.1, 0.6])]]), nombres: NOMBRES });
    expect(c.vendido).toBe(100);
  });
});

describe("R30 · avance bajo (M2)", () => {
  // Dos agrupaciones: A con C_k 0,10 y el 25 % de ΣT'; B con C_k ≈ 0,57. El avance ponderado es 0,45.
  const curvaA = curva("ca", 1, 0.1, [0.3, 0.3, 0.3]);
  const curvaB = curva("cb", 1, 1700 / 3000, [0.2, 0.1, 0.1333333333]);
  const curvas = new Map<string, CurvaDeAgrupacion>([
    ["a", curvaA],
    ["b", curvaB],
  ]);
  const entradas = juntar(serie("a", "todo_el_ano", TIENDAS, 2026, 100, 9), serie("b", "todo_el_ano", TIENDAS, 2026, 1700, 9), serie("a", "todo_el_ano", TIENDAS, 2025, 1000), serie("b", "todo_el_ano", TIENDAS, 2025, 3000));

  it("una agrupación con C_k 0,10 y el 25 % de ΣT' marca el GM aunque el avance ponderado sea 0,45", () => {
    const r = cierreDeGM(entrada({ entradas, curvas, nombres: new Map([["a", "FRAGIL"], ["b", "SOLIDA"]]), phi: SIN_NINO }));
    expect(r.api.avance).toBeCloseTo(0.45, 3);
    expect(r.api.avance_bajo).toBe(true);
    expect(r.api.agrupaciones_avance_bajo).toEqual(["FRAGIL"]);
    expect(r.por_agrupacion.find((x) => x.agrupacion_id === "a")?.avance_bajo).toBe(true);
    expect(r.por_agrupacion.find((x) => x.agrupacion_id === "b")?.avance_bajo).toBe(false);
  });

  it("con la agrupación frágil por debajo del 20 % y el avance ≥ 0,30 el GM no se marca", () => {
    const chico = juntar(serie("a", "todo_el_ano", TIENDAS, 2026, 40, 9), serie("b", "todo_el_ano", TIENDAS, 2026, 1700, 9), serie("a", "todo_el_ano", TIENDAS, 2025, 1000), serie("b", "todo_el_ano", TIENDAS, 2025, 3000));
    const r = cierreDeGM(entrada({ entradas: chico, curvas, phi: SIN_NINO }));
    expect(r.api.avance_bajo).toBe(false);
    expect(r.api.agrupaciones_avance_bajo).toEqual(["a"]);
  });

  it("con avance ponderado < 0,30 también se marca", () => {
    const c = cierreDeGM(entrada({ entradas: juntar(serie("a", "todo_el_ano", TIENDAS, 2026, 100, 9), serie("a", "todo_el_ano", TIENDAS, 2025, 1000)), curvas, phi: SIN_NINO }));
    expect(c.api.avance).toBeCloseTo(0.1, 3);
    expect(c.api.avance_bajo).toBe(true);
  });

  it("la base por defecto pasa a «Año completo» con avance bajo y es «Cierre por curva» si no", () => {
    const ref = (tipo: ReferenciaApi["tipo"], anio: number, corregido: number | null): ReferenciaApi => ({
      tipo,
      anio,
      variante_defecto: "corregido",
      etiqueta: tipo,
      periodo: "",
      tiendas: 3,
      anterior: 1000,
      actual: 1100,
      pct_bruto: 10,
      pct_sin_nino: corregido,
      equivalente: { corregido, bruto: 10, sin_nino_mas_rebote: null },
      fragil: false,
      extremo: false,
      tienda_mayor: null,
      cobertura_pct: null,
      motivo_nulo: corregido === null ? "sin_curva" : null,
    });
    const refs = [ref("cierre_curva", 2026, 8.8), ref("acumulado", 2026, 10.5), ref("anio_completo", 2025, 5), ref("anio_completo", 2024, 4)];
    expect(baseDefectoDe(refs, false)).toEqual({ tipo: "cierre_curva", anio: null, variante: "corregido" });
    expect(baseDefectoDe(refs, true)).toEqual({ tipo: "anio_completo", anio: 2025, variante: "corregido" });
    // Sin cierre calculable cae al año completo más reciente.
    expect(baseDefectoDe([ref("cierre_curva", 2026, null), ...refs.slice(1)], false)).toEqual({ tipo: "anio_completo", anio: 2025, variante: "corregido" });
    expect(baseDefectoDe([], false)).toBeNull();
  });
});

describe("G · cómo crece el verano atípicamente", () => {
  // Verano, 9 tiendas comunes, N = 2025, periodo set–dic de 2026, k = 9. ene–ago: 50 000 → 60 000; setiembre: 7 000 → 13 300; la red ×0,95.
  const verano = juntar(
    serie("camisetas", "verano", TIENDAS, 2025, 50000, 8),
    serie("camisetas", "verano", TIENDAS, 2025, 7000, 9, 9),
    serie("camisetas", "verano", TIENDAS, 2025, 4000, 12, 10),
    serie("camisetas", "verano", TIENDAS, 2026, 60000, 8),
    serie("camisetas", "verano", TIENDAS, 2026, 13300, 9, 9)
  );
  const control = juntar(serie("polos", "todo_el_ano", TIENDAS, 2025, 120000), serie("polos", "todo_el_ano", TIENDAS, 2026, 9 * 9500, 9));
  const tiendas = TIENDAS.map((id) => ({ id, codigo: id, nombre: id, tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: null }));
  const publicados = [...PUBLICADOS];
  const redes = calcularRedes(tiendas, ventaTotalPorTienda([...verano, ...control]), aniosDeRed(publicados, "2026-09"), "2026-09", publicados);
  const mesesPeriodo = Array.from({ length: 12 }, (_, m) => m >= 8);

  it("un mes del periodo: ρ 1,90, ratio fuera 1,20, red 0,95, exceso propio 1,58 y sobre la red 2,00", () => {
    const d = diagnosticoVeranoGM({ entradasVerano: verano, control, y: 2026, anioRef: 2025, publicados: PUBLICADOS, mesesPeriodo, redes });
    expect(d).not.toBeNull();
    const setiembre = d!.meses[8]!;
    expect(setiembre).toMatchObject({ m: 9, en_periodo: true });
    expect(setiembre.ratio).toBeCloseTo(1.9, 3);
    expect(setiembre.control).toBeCloseTo(0.95, 3);
    expect(d!.ratio_fuera).toBeCloseTo(1.2, 3);
    expect(d!.exceso_propio).toBeCloseTo(1.9 / 1.2, 3);
    expect(d!.exceso_red).toBeCloseTo(2.0, 3);
    expect(d!.meses_periodo_con_dato).toBe(1);
    // Los meses fuera del periodo aparecen sin resaltar, para ver la tendencia.
    expect(d!.meses[0]).toMatchObject({ m: 1, en_periodo: false });
    expect(d!.meses[0]!.ratio).toBeCloseTo(1.2, 3);
  });

  it("sin referencia, sin venta de verano o sin meses del periodo no hay diagnóstico", () => {
    const base = { entradasVerano: verano, control, y: 2026, publicados: PUBLICADOS, mesesPeriodo, redes };
    expect(diagnosticoVeranoGM({ ...base, anioRef: null })).toBeNull();
    expect(diagnosticoVeranoGM({ ...base, anioRef: 2025, entradasVerano: [] })).toBeNull();
    expect(diagnosticoVeranoGM({ ...base, anioRef: 2025, mesesPeriodo: Array(12).fill(false) })).toBeNull();
  });
});

describe("factores de Y para la pantalla", () => {
  const HOY = { huella_cargas: "h_set", huella_composicion: "c1", meses_periodo_publicados: 9 };
  const fila = (extra: Record<string, unknown> = {}) => ({
    anio: 2026,
    temporada: "invierno",
    calculado_at: "2026-10-29T10:00:00Z",
    formula: "relativo_periodo",
    huella_cargas: "h_set",
    huella_composicion: "c1",
    parcial: true,
    meses_comparados: 9,
    ratio_calculado: 0.7,
    ratio_aplicado: 0.7,
    aplicado_huella: "h_set",
    ratio_volumen: 0.66,
    ratio_control: 0.94,
    diagnostico: null,
    ...extra,
  });

  it("confirmado por Javier: ok; con sus dos números y el origen aplicado", () => {
    const f = armarFactorY(fila(), 2026, "invierno", 12, HOY);
    expect(f).toMatchObject({ estado: "ok", efectivo: 0.7, origen: "aplicado", ratio_volumen: 0.66, ratio_control: 0.94, parcial: true, meses_periodo: 12 });
  });

  it("sin fila: faltante; con ratio_aplicado nulo y parcial: sin_confirmar; con huella vieja: desfasado", () => {
    expect(armarFactorY(undefined, 2026, "verano", 4, HOY)).toMatchObject({ estado: "faltante", efectivo: null, meses_periodo: 4 });
    expect(armarFactorY(fila({ ratio_aplicado: null, aplicado_huella: null }), 2026, "invierno", 12, HOY)).toMatchObject({ estado: "sin_confirmar", origen: "calculado" });
    expect(armarFactorY(fila(), 2026, "invierno", 12, { ...HOY, huella_cargas: "h_oct" })).toMatchObject({ estado: "desfasado" });
    expect(armarFactorY(fila({ formula: null }), 2026, "invierno", 12, HOY).estado).toBe("desfasado");
  });

  it("el diagnóstico guardado se lee con su forma; uno mal formado queda null", () => {
    const meses = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, en_periodo: i === 8, u: 10, u_ref: 5, ratio: 2, control: 0.95, relativo: 2.1 }));
    const bueno = armarFactorY(fila({ diagnostico: { meses, ratio_fuera: 1.2, meses_periodo: 4, meses_periodo_con_dato: 1 } }), 2026, "verano", 4, HOY);
    expect(bueno.diagnostico).toMatchObject({ ratio_fuera: 1.2, meses_periodo: 4, meses_periodo_con_dato: 1 });
    expect(bueno.meses_periodo_con_dato).toBe(1);
    expect(comoDiagnostico({ meses: [] })).toBeNull();
    expect(comoDiagnostico(null)).toBeNull();
    // El año de referencia que escribe sincronizarFactores viaja si está; si no, no aparece.
    const doce = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, en_periodo: false, u: 0, u_ref: 0, ratio: null, control: null, relativo: null }));
    expect(comoDiagnostico({ meses: doce, anio_ref: 2025 })?.anio_ref).toBe(2025);
    expect(comoDiagnostico({ meses: doce })).not.toHaveProperty("anio_ref");
    expect(comoDiagnostico({ meses: Array(12).fill({ m: "x" }) })).toBeNull();
  });

  it("variacionCierre: la fracción en que se mueve K'_M; null si falta alguno", () => {
    expect(variacionCierre(59925, 59925)).toBe(0);
    expect(variacionCierre(60225, 59925)).toBeCloseTo(0.005, 4);
    expect(variacionCierre(null, 1)).toBeNull();
    expect(variacionCierre(1, 0)).toBeNull();
  });
});

describe("filas base para la pantalla (sanidad de tipos)", () => {
  it("una FilaBase mínima compila con sus campos", () => {
    const f: FilaBase = { fila_id: "f", genero_id: "g", mundo_id: "m", gm: "g|m", temporada: "invierno", vigente_y: null, meses_y: null, b: 1, bn: 1, crecimiento_pct: null, decidido: null, propuesto: null };
    expect(f.gm).toBe("g|m");
  });
});
