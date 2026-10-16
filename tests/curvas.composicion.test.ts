import { describe, expect, it } from "vitest";
import { armarComposicion, armarRedPorAnio, contextoComposicion, leerComposicion, principales } from "@/lib/curvas/composicion";
import { huellaRed } from "@/lib/curvas/huellas";
import { tiendasQueEntran } from "@/lib/curvas/red";
import type { RedAnio } from "@/lib/curvas/tipos-api";
import { EQ, GML, OTRA_AGRUPACION, SINT_INV_G3, T1, T2, TIENDAS, sintInv, type OpcionesSintInv } from "./curvas.composicion.fixture";

const gmlDe = (c: ReturnType<typeof armarComposicion>, id: string) => c.gml.find((g) => g.gml_id === id)!;
const anioDe = (g: ReturnType<typeof gmlDe>, anio: number) => g.por_anio.find((a) => a.anio === anio)!;
const armar = (o: OpcionesSintInv = {}) => {
  const f = sintInv(o);
  return { f, c: armarComposicion(f.lectura, f.maestro, f.ctx) };
};

describe("regla 61 · armarRedPorAnio", () => {
  const red = (anio: number, tiendas: [string, boolean][], sinRed = false): RedAnio => ({
    anio,
    tiendas: tiendas.map(([tienda_id, entra]) => ({ tienda_id, entra, motivos: [], meses_sin_venta: [], primer_mes_con_venta: null, entra_desde: null, unidades: 1, peso: 0.5, participacion: null, eat_vs_red: null, distinta: false })),
    total_unidades: 2,
    dominante: null,
    peso_mayor: null,
    sin_red: sinRed,
    participacion: null,
    ruido_normal: null,
  });
  it("las tiendas que entran de cada año, ordenadas; un año sin red → []", () => {
    const redes = [red(2025, [["t9", true], ["t1", true], ["t5", false]]), red(2024, [["t2", true]]), red(2026, [["t1", false]], true)];
    expect(armarRedPorAnio(redes)).toEqual({ "2024": ["t2"], "2025": ["t1", "t9"], "2026": [] });
    expect(Object.keys(armarRedPorAnio(redes))).toEqual(["2024", "2025", "2026"]);
    expect([...tiendasQueEntran(redes[0])].sort()).toEqual(["t1", "t9"]);
  });
  it("de un cálculo real: ambas tiendas; con tiendas_excluidas cambia p_red pero no huellaRed", () => {
    const base = sintInv();
    expect(armarRedPorAnio(base.entrada.redes)).toEqual({ "2024": [T1, T2], "2025": [T1, T2], "2026": [T1, T2] });
    const sin = sintInv({ parametros: { tiendas_excluidas: [T2] } });
    expect(armarRedPorAnio(sin.entrada.redes)).toEqual({ "2024": [T1], "2025": [T1], "2026": [T1] });
    expect(huellaRed(TIENDAS)).toBe(huellaRed(TIENDAS));
  });
});

describe("caso 32 · pesos y totales (SINT_INV)", () => {
  const { f, c } = armar();
  it("pesos 0.60 / 0.35 / 0.05 en 2024 y 2025; Σ unidades = resultado.anios[].unidades", () => {
    for (const anio of [2024, 2025]) {
      expect(anioDe(gmlDe(c, GML.G1), anio).peso).toBeCloseTo(0.6, 9);
      expect(anioDe(gmlDe(c, GML.G2), anio).peso).toBeCloseTo(0.35, 9);
      expect(anioDe(gmlDe(c, GML.G3), anio).peso).toBeCloseTo(0.05, 9);
      const suma = c.gml.reduce((s, g) => s + anioDe(g, anio).unidades, 0);
      expect(suma).toBeCloseTo(f.resultado.anios.find((a) => a.anio === anio)!.unidades, 6);
      expect(c.gml.reduce((s, g) => s + anioDe(g, anio).peso, 0)).toBeCloseTo(1, 6);
    }
    expect(c.anios.map((a) => a.unidades.toFixed(0))).toEqual(["2000", "2200", "1850"]);
  });
  it("E4 lleva las 100 y 110 de G3; las equivalencias suman las unidades de su GML", () => {
    const g3 = gmlDe(c, GML.G3);
    expect(g3.equivalencias.map((e) => e.id)).toEqual([EQ.E4]);
    expect(g3.equivalencias[0].por_anio.slice(0, 2).map((x) => x.unidades)).toEqual([100, 110]);
    expect(g3.equivalencias[0].es_generica).toBe(true);
    for (const g of c.gml) for (const a of g.por_anio) expect(g.equivalencias.reduce((s, e) => s + (e.por_anio.find((x) => x.anio === a.anio)?.unidades ?? 0), 0)).toBeCloseTo(a.unidades, 6);
  });
  it("los tres son principales (menos de 12); G3 no es válido en ningún año: curva null, se_aparta false, aviso pocas_unidades", () => {
    expect(c.gml.every((g) => g.principal)).toBe(true);
    expect([c.principales, c.otros, c.pct_principales]).toEqual([3, 0, 1]);
    const g3 = gmlDe(c, GML.G3);
    expect(g3.por_anio.map((a) => a.valido)).toEqual([false, false, false]);
    expect([g3.curva, g3.anios_curva, g3.se_aparta]).toEqual([null, [], false]);
    expect(g3.avisos).toContain("pocas_unidades");
  });
  it("el nivel, la vigencia y los nombres vienen del maestro; ordenados por género, mundo y línea", () => {
    expect(c.gml.map((g) => `${g.genero} · ${g.mundo} · ${g.linea}`)).toEqual(["HOMBRE · FORMAL · ABRIGO", "HOMBRE · URBANO · CASACA", "HOMBRE · URBANO · CHOMPA"]);
    expect(c.gml.every((g) => g.nivel === "GML" && g.vigente)).toBe(true);
    expect([c.equivalencias_activas, c.equivalencias_inactivas_con_venta, c.equivalencias_sin_venta]).toEqual([4, 0, []]);
  });
  it("el contexto trae los parámetros, la huella del cálculo y el hasta", () => {
    expect([c.huella_calculo, c.hasta_periodo, c.con_calculo, c.umbral_forma, c.min_unidades]).toEqual(["huella-calculo-sint", "2026-09", true, 3, 120]);
  });
});

describe("caso 33 · curva de la agrupación, ruido y A", () => {
  const { f } = armar();
  it("ruido_normal = 3.8; A y sus EAT: fuera de muestra 3.8, en muestra 1.9", () => {
    expect(f.resultado.ruido_normal).toBeCloseTo(3.8, 6);
    const a = f.resultado.candidatas.find((x) => x.modelo === "A")!;
    expect(a.eat).toBeCloseTo(3.8, 6);
    expect(a.eat_en_muestra).toBeCloseTo(1.9, 6);
    expect((a.curva as number[]).map((x) => Math.round(x * 10000) / 100)).toEqual([4.3, 4.4, 6.4, 8.3, 11.05, 14.65, 13.6, 11.65, 9.75, 6.9, 5, 4]);
  });
  it("la participación de 2024 es 0.95·S + 0.05·D y la de 2025 igual salvo mayo y junio", () => {
    const p24 = f.resultado.anios.find((a) => a.anio === 2024)!.participacion as number[];
    expect(p24.map((x) => Math.round(x * 100000) / 1000)).toEqual([4.3, 4.4, 6.4, 8.3, 12, 13.7, 13.6, 11.65, 9.75, 6.9, 5, 4]);
    const p25 = f.resultado.anios.find((a) => a.anio === 2025)!.participacion as number[];
    expect([p25[4], p25[5]].map((x) => Math.round(x * 1000) / 10)).toEqual([10.1, 15.6]);
  });
});

describe("caso 34 · se aparta contra el RESTO (SINT_INV_G3)", () => {
  const { c } = armar(SINT_INV_G3);
  it("pesos 0.5455 / 0.3182 / 0.1364 en 2024 y G3 es válido (300 y 330 ≥ 120)", () => {
    expect(anioDe(gmlDe(c, GML.G1), 2024).peso).toBeCloseTo(0.5455, 4);
    expect(anioDe(gmlDe(c, GML.G2), 2024).peso).toBeCloseTo(0.3182, 4);
    expect(anioDe(gmlDe(c, GML.G3), 2024).peso).toBeCloseTo(0.1364, 4);
    expect(gmlDe(c, GML.G3).por_anio.slice(0, 2).map((a) => a.valido)).toEqual([true, true]);
  });
  it("eat_vs_resto: G3 56.0 y 60.0; G1 16.8 y 18.0", () => {
    expect(anioDe(gmlDe(c, GML.G3), 2024).eat_vs_resto).toBeCloseTo(56, 6);
    expect(anioDe(gmlDe(c, GML.G3), 2025).eat_vs_resto).toBeCloseTo(60, 6);
    expect(anioDe(gmlDe(c, GML.G1), 2024).eat_vs_resto).toBeCloseTo(16.8, 6);
    expect(anioDe(gmlDe(c, GML.G1), 2025).eat_vs_resto).toBeCloseTo(18, 6);
  });
  it("ruido propio: G1 EAT(S, S′) = 4; G3 EAT(D, D) = 0; umbrales 4.0 y 3.45 (max de los tres)", () => {
    expect(gmlDe(c, GML.G1).ruido_propio).toBeCloseTo(4, 6);
    expect(gmlDe(c, GML.G3).ruido_propio).toBeCloseTo(0, 6);
    expect(c.ruido_normal).toBeCloseTo(3.4545, 3);
    expect(gmlDe(c, GML.G1).umbral).toBeCloseTo(4, 6);
    expect(gmlDe(c, GML.G3).umbral).toBeCloseTo(3.4545, 3);
  });
  it("los tres se apartan (la agrupación mezcla dos formas)", () => {
    expect(c.gml.map((g) => g.se_aparta)).toEqual([true, true, true]);
    expect(gmlDe(c, GML.G1).avisos).toContain("se_aparta");
    expect(gmlDe(c, GML.G1).por_anio.slice(0, 2).map((a) => a.distinta)).toEqual([true, true]);
  });
  it("con umbral_forma = 20 solo G3 se aparta (56 > 20; 16.8 y 11.2 no)", () => {
    const { c: alto } = armar({ ...SINT_INV_G3, parametros: { umbral_forma: 20 } });
    expect(alto.gml.map((g) => [g.linea, g.se_aparta])).toEqual([["ABRIGO", true], ["CASACA", false], ["CHOMPA", false]]);
  });
  it("la curva del GML es A sobre sus años válidos", () => {
    const g3 = gmlDe(c, GML.G3);
    expect(g3.anios_curva).toEqual([2024, 2025]);
    expect((g3.curva as number[]).map((x) => Math.round(x * 100))).toEqual([10, 12, 14, 14, 12, 8, 6, 5, 5, 5, 5, 4]);
  });
});

describe("caso 35 · otras agrupaciones", () => {
  it("G1 también vende 400 u. en otra agrupación en 2025: pct = 400 ÷ (1 320 + 400) = 0.2326 y aviso en_otras_agrupaciones", () => {
    const { c } = armar({ otras2025: 400 });
    const g1 = gmlDe(c, GML.G1);
    expect(g1.otras_agrupaciones).toHaveLength(1);
    expect(g1.otras_agrupaciones[0]).toMatchObject({ agrupacion_id: OTRA_AGRUPACION, nombre: "OTRA AGRUPACIÓN", unidades: 400 });
    expect(g1.otras_agrupaciones[0].pct_de_su_venta).toBeCloseTo(400 / 1720, 6);
    expect(g1.avisos).toContain("en_otras_agrupaciones");
    expect(gmlDe(c, GML.G2).otras_agrupaciones).toEqual([]);
    expect(gmlDe(c, GML.G2).avisos).not.toContain("en_otras_agrupaciones");
  });
});

describe("regla 62 · participación, negativos, válidos y principales", () => {
  it("un GML con unidades ≤ 0 en el año: participación null, peso con signo y aviso unidades_negativas si es negativo", () => {
    const f = sintInv();
    const lectura = { ...f.lectura, nodos: f.lectura.nodos.map((n) => (n.gml_id === GML.G3 && n.periodo.startsWith("2025") ? { ...n, unidades: -n.unidades } : n)) };
    const c = armarComposicion(lectura, f.maestro, f.ctx);
    const a = anioDe(gmlDe(c, GML.G3), 2025);
    expect(a.unidades).toBeCloseTo(-110, 6);
    expect(a.participacion).toBeNull();
    expect(a.peso).toBeLessThan(0);
    expect(gmlDe(c, GML.G3).avisos).toContain("unidades_negativas");
    expect(gmlDe(c, GML.G1).avisos).not.toContain("unidades_negativas");
  });
  it("un mes negativo con total positivo se trunca a 0 antes de repartir", () => {
    const f = sintInv();
    const nodos = f.lectura.nodos.map((n) => (n.gml_id === GML.G1 && n.periodo === "2024-02" ? { ...n, unidades: -10 } : n));
    const c = armarComposicion({ ...f.lectura, nodos }, f.maestro, f.ctx);
    const p = anioDe(gmlDe(c, GML.G1), 2024).participacion as number[];
    expect(p[1]).toBe(0);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(gmlDe(c, GML.G1).avisos).toContain("unidades_negativas");
  });
  it("valido ⇔ en_ajuste y unidades ≥ min_unidades_ano; el año en curso es parcial y nunca válido", () => {
    const { c } = armar();
    const g1 = gmlDe(c, GML.G1);
    expect(g1.por_anio.map((a) => [a.anio, a.en_ajuste, a.valido])).toEqual([[2024, true, true], [2025, true, true], [2026, false, false]]);
    expect(anioDe(g1, 2026).participacion?.slice(9)).toEqual([0, 0, 0]);
    expect(anioDe(g1, 2026).distinta).toBeNull();
  });
  it("principales: con 12 GML o menos todos; con más, por unidades del último año hasta 85 % o 12", () => {
    const g = (id: string, unidades: number) => ({ id, nombre: id, unidades });
    expect(principales([g("a", 5), g("b", 1)])).toEqual(["a", "b"]);
    const muchos = [g("g1", 700), g("g2", 200), g("g3", 50), ...Array.from({ length: 12 }, (_, i) => g(`h${i + 1}`, 4))];
    // 700 + 200 = 900 de 998 = 90 %: se llega al 85 % con dos.
    expect(principales(muchos)).toEqual(["g1", "g2"]);
    const parejos = Array.from({ length: 30 }, (_, i) => g(`p${String(i).padStart(2, "0")}`, 10));
    expect(principales(parejos)).toHaveLength(12);
    expect(principales(parejos, 0.5)).toHaveLength(15 > 12 ? 12 : 15);
    expect(principales(Array.from({ length: 20 }, (_, i) => g(`q${i}`, 0)))).toHaveLength(12);
  });
  it("con más de 12 GML marca solo los principales y cuenta los otros", () => {
    const f = sintInv();
    const extra = Array.from({ length: 13 }, (_, i) => ({ id: `extra-${i}`, genero: "MUJER", mundo: "CASUAL", linea: `LINEA ${i}`, nivel: "GML" as const, vigente: true }));
    const nodos = extra.flatMap((g) => [{ gml_id: g.id, periodo: "2025-03", unidades: 1 }]);
    const c = armarComposicion({ ...f.lectura, nodos: [...f.lectura.nodos, ...nodos] }, { ...f.maestro, gml: [...f.maestro.gml, ...extra] }, f.ctx);
    expect(c.gml).toHaveLength(16);
    // G1 (60 %) y G2 (35 %) ya cubren el 85 % del último año de ajuste: G3 y los 13 nuevos son «Otros».
    expect(c.principales).toBe(2);
    expect(c.otros).toBe(14);
    expect(c.pct_principales).toBeCloseTo(2090 / 2213, 4);
    expect(c.gml.filter((g) => g.principal).map((g) => g.gml_id).sort()).toEqual([GML.G1, GML.G2]);
  });
});

describe("regla 63 · curva y ruido propio del GML", () => {
  it("anios_excluidos saca el año también de la curva y del ruido propio (caso 41)", () => {
    const { c } = armar({ parametros: { anios_excluidos: [2024] } });
    const g1 = gmlDe(c, GML.G1);
    expect(g1.anios_curva).toEqual([2025]);
    expect(g1.ruido_propio).toBeNull();
    expect(g1.por_anio.find((a) => a.anio === 2024)).toMatchObject({ en_ajuste: false, valido: false });
  });
  it("sin años válidos la curva es null y el ruido propio null", () => {
    const { c } = armar();
    expect([gmlDe(c, GML.G3).curva, gmlDe(c, GML.G3).ruido_propio]).toEqual([null, null]);
  });
});

describe("regla 64 · sin cálculo y GML único", () => {
  it("con_calculo = false: unidades y pesos presentes, se_aparta y distinta null, umbral null, aviso sin_calculo, nada válido", () => {
    const f = sintInv();
    const ctx = contextoComposicion({ entrada: f.entrada, resultado: null, agrupacion_id: "agr-sint-inv", parametros: f.parametros, huella_calculo: "h" });
    expect(ctx.con_calculo).toBe(false);
    expect(ctx.anios.map((a) => [a.anio, a.clase, a.en_ajuste])).toEqual([[2024, "normal", false], [2025, "normal", false], [2026, "en_curso", false]]);
    const c = armarComposicion(f.lectura, f.maestro, ctx);
    expect(c.con_calculo).toBe(false);
    const g1 = gmlDe(c, GML.G1);
    expect(g1.se_aparta).toBeNull();
    expect(g1.umbral).toBeNull();
    expect(g1.por_anio.every((a) => a.distinta === null && a.eat_vs_resto === null && !a.valido)).toBe(true);
    expect(g1.avisos).toContain("sin_calculo");
    expect(anioDe(g1, 2024).unidades).toBeCloseTo(1200, 6);
    expect(anioDe(g1, 2024).peso).toBeCloseTo(0.6, 9);
    expect(g1.curva).toBeNull();
    // Los principales salen del último año completo con venta.
    expect(c.principales).toBe(3);
  });
  it("un único GML en la agrupación: resto vacío → eat_vs_resto null y nunca se aparta", () => {
    const f = sintInv();
    const solo = { ...f.lectura, nodos: f.lectura.nodos.filter((n) => n.gml_id === GML.G1), equivalencias: f.lectura.equivalencias.filter((e) => e.gml_id === GML.G1) };
    const c = armarComposicion(solo, { ...f.maestro, gml: f.maestro.gml.filter((g) => g.id === GML.G1), equivalencias: f.maestro.equivalencias.filter((e) => e.gml_id === GML.G1) }, f.ctx);
    expect(c.gml).toHaveLength(1);
    expect(c.gml[0].por_anio.every((a) => a.eat_vs_resto === null)).toBe(true);
    expect(c.gml[0].se_aparta).toBe(false);
  });
});

describe("equivalencias e inactivas", () => {
  it("una equivalencia desactivada con venta aparece (atenuada); sin venta no; una activa sin venta cuenta como sin venta", () => {
    const f = sintInv();
    const maestro = {
      ...f.maestro,
      equivalencias: [
        ...f.maestro.equivalencias,
        { id: "eq-5", gml_id: GML.G1, nombre: "VIEJA CON VENTA", codigo: "E5", es_generica: false, activo: false },
        { id: "eq-6", gml_id: GML.G1, nombre: "VIEJA SIN VENTA", codigo: "E6", es_generica: false, activo: false },
        { id: "eq-7", gml_id: GML.G2, nombre: "ACTIVA SIN VENTA", codigo: "E7", es_generica: false, activo: true },
      ],
    };
    const lectura = { ...f.lectura, equivalencias: [...f.lectura.equivalencias, { equivalencia_id: "eq-5", gml_id: GML.G1, anio: 2024, unidades: 12 }] };
    const c = armarComposicion(lectura, maestro, f.ctx);
    const g1 = gmlDe(c, GML.G1);
    expect(g1.equivalencias.map((e) => [e.codigo, e.activo])).toEqual([["E1", true], ["E2", true], ["E5", false]]);
    expect(c.equivalencias_inactivas_con_venta).toBe(1);
    expect(c.equivalencias_sin_venta).toEqual(["eq-7"]);
    expect(c.equivalencias_activas).toBe(5);
  });
  it("un GML cuyo nodo no está vigente lleva el aviso nodo_no_vigente", () => {
    const f = sintInv();
    const c = armarComposicion(f.lectura, { ...f.maestro, gml: f.maestro.gml.map((g) => (g.id === GML.G2 ? { ...g, vigente: false } : g)) }, f.ctx);
    expect(gmlDe(c, GML.G2).avisos).toContain("nodo_no_vigente");
    expect(gmlDe(c, GML.G1).avisos).not.toContain("nodo_no_vigente");
  });
  it("un GML sin venta (equivalencia activa sin filas) lleva el aviso sin_venta", () => {
    const f = sintInv();
    const c = armarComposicion(f.lectura, { ...f.maestro, gml: [...f.maestro.gml, { id: "gml-9", genero: "NIÑO", mundo: "X", linea: "Y", nivel: "GML", vigente: true }], equivalencias: [...f.maestro.equivalencias, { id: "eq-9", gml_id: "gml-9", nombre: "N", codigo: "E9", es_generica: false, activo: true }] }, f.ctx);
    expect(gmlDe(c, "gml-9").avisos).toContain("sin_venta");
    expect(anioDe(gmlDe(c, "gml-9"), 2025)).toMatchObject({ unidades: 0, peso: 0, participacion: null });
  });
});

describe("leerComposicion (forma de la función)", () => {
  const ok = { nodos: [{ gml_id: "g", periodo: "2024-01-01", unidades: 5 }], equivalencias: [{ equivalencia_id: "e", gml_id: "g", anio: 2024, unidades: "5" }], otras: [{ gml_id: "g", agrupacion_id: "a", anio: 2024, unidades: 3 }], cargas: { "2024-01-01": "c1" } };
  it("normaliza fechas a aaaa-mm y acepta números como texto", () => {
    expect(leerComposicion(ok)).toEqual({
      nodos: [{ gml_id: "g", periodo: "2024-01", unidades: 5 }],
      equivalencias: [{ equivalencia_id: "e", gml_id: "g", anio: 2024, unidades: 5 }],
      otras: [{ gml_id: "g", agrupacion_id: "a", anio: 2024, unidades: 3 }],
      cargas: { "2024-01": "c1" },
    });
  });
  it("devuelve null si falta una parte o una fila es inválida", () => {
    expect(leerComposicion(null)).toBeNull();
    expect(leerComposicion({ ...ok, cargas: undefined })).toBeNull();
    expect(leerComposicion({ ...ok, nodos: undefined })).toBeNull();
    expect(leerComposicion({ ...ok, nodos: [{ gml_id: 1, periodo: "2024-01-01", unidades: 5 }] })).toBeNull();
    expect(leerComposicion({ ...ok, cargas: { "2024-01-01": 5 } })).toBeNull();
    expect(leerComposicion({ nodos: [], equivalencias: [], otras: [], cargas: {} })).toEqual({ nodos: [], equivalencias: [], otras: [], cargas: {} });
  });
});

describe("determinismo", () => {
  it("dos armados con la misma lectura dan el mismo resultado", () => {
    const f = sintInv();
    expect(armarComposicion(f.lectura, f.maestro, f.ctx)).toEqual(armarComposicion(f.lectura, f.maestro, f.ctx));
  });
});
