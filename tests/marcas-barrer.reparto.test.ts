import { describe, expect, it } from "vitest";
import { agruparPequenas, expandirResto, repartirProporcional } from "@/lib/marcas-barrer/resto";
import {
  aplicarAlcance,
  mesesDeVentana,
  normalizarAlcance,
  puedeAprobar,
  renormalizarResto,
  repartoAnual,
  repartoPorTemporada,
  repartoVectores,
  type SeriesNormalizadas,
} from "@/lib/marcas-barrer/reparto";
import { aniosCompletos, eat, estacionalidadGml, estacionalidadPropia, veredicto } from "@/lib/marcas-barrer/estacionalidad";
import { tendencia } from "@/lib/marcas-barrer/tendencia";
import { aniosEvaluables, errorReparto, eatPp, veredictoError } from "@/lib/marcas-barrer/error";
import { repartoSegunCerrada, mesesSiguientes, aniosDeLaCerrada } from "@/lib/marcas-barrer/cerrada";
import { TEMPORADAS_DEFECTO, type TemporadasConfig } from "@/lib/marcas-barrer/tipos-api";
import { AM, CLAVE, MARCA, NODO, cerradaB } from "./marcas-barrer.fixture";

/** Reglas 3 a 8 y 10 de la ficha 12 sobre series sintéticas simples (la prueba del método completo está en marcas-barrer.modelo). */

const MESES = mesesDeVentana("2026-09", 24);
const serie = (porMes: (mes: string) => number): Map<string, number> => new Map(MESES.map((m) => [m, porMes(m)]));
const series = (def: Record<string, (mes: string) => number>): SeriesNormalizadas => new Map(Object.entries(def).map(([k, f]) => [k, serie(f)]));
const suma = (m: Map<string, number> | null | undefined) => [...(m?.values() ?? [])].reduce((a, b) => a + b, 0);

describe("ventana", () => {
  it("24 meses hasta 2026-09 es oct-2024 → set-2026", () => {
    expect(MESES).toHaveLength(24);
    expect(MESES[0]).toBe("2024-10");
    expect(MESES[23]).toBe("2026-09");
    expect(mesesDeVentana("2026-09", 12)[0]).toBe("2025-10");
    expect(mesesDeVentana("2026-09", 36)[0]).toBe("2023-10");
  });
});

describe("regla 3: alcance", () => {
  const filas = [
    { id: "denim", genero_id: "H", mundo_id: "U", linea_id: "l1" },
    { id: "polo", genero_id: "H", mundo_id: "C", linea_id: "l2" },
    { id: "sandalia", genero_id: "M", mundo_id: "C", linea_id: "l3" },
  ];
  it("con alcance HOMBRE la sandalia sale (fuera); sin alcance entra; ejes combinados", () => {
    const sin = aplicarAlcance(filas, normalizarAlcance({}));
    expect(sin.dentro).toHaveLength(3);
    expect(sin.fuera).toEqual([]);
    const hombre = aplicarAlcance(filas, normalizarAlcance({ generos: ["H"] }));
    expect(hombre.dentro.map((f) => f.id)).toEqual(["denim", "polo"]);
    expect(hombre.fuera.map((f) => f.id)).toEqual(["sandalia"]);
    expect(aplicarAlcance(filas, normalizarAlcance({ generos: ["H"], mundos: ["C"] })).dentro.map((f) => f.id)).toEqual(["polo"]);
    expect(aplicarAlcance(filas, normalizarAlcance({ lineas: ["l3", "l1"] })).dentro.map((f) => f.id)).toEqual(["denim", "sandalia"]);
  });
  it("normalizarAlcance ordena y quita repetidos", () => {
    expect(normalizarAlcance({ generos: ["b", "a", "b"], mundos: undefined })).toEqual({ generos: ["a", "b"], mundos: [], lineas: [] });
    expect(normalizarAlcance(null)).toEqual({ generos: [], mundos: [], lineas: [] });
  });
});

describe("regla 4: p2 anual y por temporada", () => {
  // DENIM 100 u/mes parejo; POLO vende 100 u/mes en verano y 20 en invierno; SANDALIA solo en verano.
  const verano = (m: string) => [10, 11, 12, 1, 2, 3].includes(Number(m.slice(5, 7)));
  const s = series({ denim: () => 100, polo: (m) => (verano(m) ? 100 : 20), sandalia: (m) => (verano(m) ? 50 : 0) });
  const claves = ["denim", "polo", "sandalia"];

  it("anual: una sola distribución que suma 1 sobre la ventana", () => {
    const v = repartoAnual(s, claves, MESES)!;
    expect(suma(v)).toBeCloseTo(1, 12);
    expect(v.get("denim")).toBeCloseTo(2400 / 4440, 9);
    expect(v.get("polo")).toBeCloseTo(1440 / 4440, 9);
  });
  it("por temporada: cada temporada suma 1 (± 1e-9) y sus vectores difieren", () => {
    const r = repartoPorTemporada(s, claves, MESES);
    expect(r.modo_efectivo).toBe("por_temporada");
    expect(suma(r.vectores.get("verano"))).toBeCloseTo(1, 9);
    expect(suma(r.vectores.get("invierno"))).toBeCloseTo(1, 9);
    expect(r.vectores.get("verano")!.get("sandalia")).toBeCloseTo(600 / 3000, 9);
    // En invierno la sandalia no vende: no entra al vector.
    expect(r.vectores.get("invierno")!.has("sandalia")).toBe(false);
    expect(r.vectores.get("verano")!.get("denim")).toBeCloseTo(1200 / (1200 + 1200 + 600), 9);
    expect(r.vectores.get("invierno")!.get("denim")).toBeCloseTo(1200 / (1200 + 240), 9);
  });
  it("con las temporadas editadas (verano nov→abr) abril pasa a verano y los dos vectores cambian", () => {
    const editadas: TemporadasConfig = { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } };
    const base = repartoVectores(s, claves, MESES, "por_temporada", TEMPORADAS_DEFECTO);
    const nueva = repartoVectores(s, claves, MESES, "por_temporada", editadas);
    expect(nueva.meses_por_temporada).toEqual({ verano: 12, invierno: 12 });
    expect(nueva.vectores.get("verano")!.get("denim")).not.toBeCloseTo(base.vectores.get("verano")!.get("denim")!, 4);
    expect(nueva.vectores.get("invierno")!.get("denim")).not.toBeCloseTo(base.vectores.get("invierno")!.get("denim")!, 4);
    expect(suma(nueva.vectores.get("verano"))).toBeCloseTo(1, 9);
  });
  it("una temporada con menos de 6 meses en la ventana cae a anual con aviso temporada_corta", () => {
    const corta: TemporadasConfig = { verano: { desde_mes: 1, hasta_mes: 2 }, invierno: { desde_mes: 3, hasta_mes: 12 } };
    const r = repartoVectores(s, claves, MESES, "por_temporada", corta);
    expect(r.modo_efectivo).toBe("anual");
    expect(r.avisos).toContain("temporada_corta");
    expect([...r.vectores.keys()]).toEqual(["anual"]);
    expect(suma(r.vectores.get("anual"))).toBeCloseTo(1, 9);
  });
  it("una temporada sin una sola unidad vendida también cae a anual (no hay vector fiable)", () => {
    const soloVerano = series({ denim: (m) => (verano(m) ? 100 : 0) });
    const r = repartoVectores(soloVerano, ["denim"], MESES, "por_temporada");
    expect(r.modo_efectivo).toBe("anual");
    expect(r.avisos).toContain("temporada_corta");
  });
  it("sin venta al barrer en la ventana → null y sin_venta_barrer", () => {
    const r = repartoVectores(series({ denim: () => 0 }), ["denim"], MESES, "anual");
    expect(r.vectores.get("anual")).toBeNull();
    expect(r.avisos).toContain("sin_venta_barrer");
    expect(repartoAnual(series({}), [], MESES)).toBeNull();
  });
  it("las g con unidades netas negativas (devoluciones) no entran", () => {
    const v = repartoAnual(series({ denim: () => 100, neg: () => -5 }), ["denim", "neg"], MESES)!;
    expect(v.has("neg")).toBe(false);
    expect(v.get("denim")).toBe(1);
  });
});

describe("regla 5: resto", () => {
  const nueve = [10, 15, 20, 25, 30, 35, 40, 12, 18].map((u, i) => ({
    clave: `g${i}|`,
    genero_id: "H",
    mundo_id: i < 6 ? "C" : "U",
    unidades_ventana: u,
  }));
  it("con umbral 50, nueve g de 10 a 40 u se agrupan en dos restos por género × mundo; las de 50 o más quedan solas", () => {
    const { grandes, restos } = agruparPequenas([...nueve, { clave: "grande|", genero_id: "H", mundo_id: "U", unidades_ventana: 50 }], 50);
    expect(grandes.map((g) => g.clave)).toEqual(["grande|"]);
    expect(restos.map((r) => [r.grupo_resto, r.miembros.length])).toEqual([["H|C", 6], ["H|U", 3]]);
  });
  it("expandirResto devuelve una fila por g con grupo_resto y suma exacta igual a la participación del resto, en proporción a Σũ", () => {
    const filas = expandirResto("H|C", 0.0231, [
      { clave: "a|", peso: 10 },
      { clave: "b|", peso: 20 },
      { clave: "c|", peso: 30 },
    ]);
    expect(filas.map((f) => f.clave)).toEqual(["a|", "b|", "c|"]);
    expect(filas.every((f) => f.grupo_resto === "H|C")).toBe(true);
    expect(Math.round(filas.reduce((a, f) => a + f.participacion, 0) * 1e4)).toBe(231);
    expect(filas[2].participacion).toBeGreaterThan(filas[1].participacion);
    expect(filas[1].participacion).toBeGreaterThan(filas[0].participacion);
  });
  it("un resto editado por el planner se reparte entre sus miembros en proporción a Σũ (suma exacta aunque no sea múltiplo)", () => {
    const partes = repartirProporcional(0.0777, [1, 1, 1]);
    expect(Math.round(partes.reduce((a, b) => a + b, 0) * 1e4)).toBe(777);
    expect(repartirProporcional(1, [0, 0])).toEqual([0.5, 0.5]);
    expect(repartirProporcional(1, [])).toEqual([]);
  });
});

describe("regla 6: error del reparto", () => {
  const claves = ["denim", "polo"];
  const cambia = (antes: [number, number], despues: [number, number]) =>
    series({ denim: (m) => (m >= "2026-01" ? despues[0] : antes[0]), polo: (m) => (m >= "2026-01" ? despues[1] : antes[1]) });

  it("con la mezcla idéntica → 0 pp y estable", () => {
    const r = errorReparto({ series: cambia([70, 30], [70, 30]), claves, meses: MESES, modo: "por_temporada" });
    expect(r.pp).toBeCloseTo(0, 9);
    expect(r.veredicto).toBe("estable");
    expect(r.anios.map((a) => a.anio)).toEqual([2026]);
  });
  it("DENIM de 70 % a 30 % de un año al otro → 40 pp e inestable", () => {
    const r = errorReparto({ series: cambia([70, 30], [30, 70]), claves, meses: MESES, modo: "por_temporada" });
    expect(r.pp).toBeCloseTo(40, 9);
    expect(r.veredicto).toBe("inestable");
    const anual = errorReparto({ series: cambia([70, 30], [30, 70]), claves, meses: MESES, modo: "anual" });
    expect(anual.pp).toBeCloseTo(40, 9);
  });
  it("sin un año con datos previos suficientes → null y sin_backtesting (ventana de 12 meses)", () => {
    const meses12 = mesesDeVentana("2026-09", 12);
    const s = new Map([["denim", new Map(meses12.map((m) => [m, 100]))]]);
    const r = errorReparto({ series: s, claves: ["denim"], meses: meses12, modo: "por_temporada" });
    expect(r.pp).toBeNull();
    expect(r.veredicto).toBeNull();
    expect(r.avisos).toEqual(["sin_backtesting"]);
    expect(aniosEvaluables(meses12)).toEqual([]);
  });
  it("con 36 meses hay dos años evaluables y el error es su promedio", () => {
    const meses36 = mesesDeVentana("2026-12", 36);
    const s: SeriesNormalizadas = new Map([
      ["denim", new Map(meses36.map((m) => [m, m >= "2026-01" ? 30 : 70]))],
      ["polo", new Map(meses36.map((m) => [m, m >= "2026-01" ? 70 : 30]))],
    ]);
    expect(aniosEvaluables(meses36)).toEqual([2025, 2026]);
    const r = errorReparto({ series: s, claves, meses: meses36, modo: "anual" });
    // 2025 se predice con 2024 (misma mezcla: 0 pp) y 2026 con 2024-25 (70/30 contra 30/70: 40 pp): promedio 20.
    expect(r.anios.map((a) => a.anio)).toEqual([2025, 2026]);
    expect(r.pp).toBeCloseTo(20, 9);
    expect(r.veredicto).toBe("dudoso");
  });
  it("EAT del reparto: 0 si iguales y 100 si no comparten ninguna g; veredictos con los umbrales 10 y 25", () => {
    expect(eatPp(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(0);
    expect(eatPp(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(100);
    expect([10, 10.1, 25, 25.1].map(veredictoError)).toEqual(["estable", "dudoso", "dudoso", "inestable"]);
    expect(veredictoError(null)).toBeNull();
  });
});

describe("regla 7: p2 según la cerrada", () => {
  const incluir = () => true;
  it("participaciones barrido de 0,12 en DENIM × PREMIUM y 0,30 en POLO × PREMIUM con las demandas del fixture → 50 / 50", () => {
    const r = repartoSegunCerrada({ filas: cerradaB(), marcaId: MARCA.beta, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "por_temporada", incluir });
    expect(r.avisos).toEqual([]);
    for (const llave of ["verano", "invierno"] as const) {
      const v = r.vectores!.get(llave)!;
      expect(v.get(CLAVE.denim)).toBeCloseTo(0.5, 9);
      expect(v.get(CLAVE.polo)).toBeCloseTo(0.5, 9);
      expect(suma(v)).toBeCloseTo(1, 9);
    }
    const anual = repartoSegunCerrada({ filas: cerradaB(), marcaId: MARCA.beta, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "anual", incluir });
    expect([...anual.vectores!.keys()]).toEqual(["anual"]);
  });
  it("la demanda de las filas de tienda suma a la celda, y el alcance deja fuera una g", () => {
    const filas = cerradaB().map((f) => (f.tienda_id === "T9" && f.gml_id === NODO.denim ? { ...f, meses: Array.from({ length: 12 }, () => 1000) } : f));
    const r = repartoSegunCerrada({ filas, marcaId: MARCA.beta, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "anual", incluir });
    // DENIM pasa a 2 000/mes × 0,12 = 240 contra POLO 120.
    expect(r.vectores!.get("anual")!.get(CLAVE.denim)).toBeCloseTo(240 / 360, 9);
    const sinPolo = repartoSegunCerrada({ filas, marcaId: MARCA.beta, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "anual", incluir: (c) => c !== CLAVE.polo });
    expect(sinPolo.vectores!.get("anual")!.get(CLAVE.denim)).toBe(1);
  });
  it("sin participación de la marca (otra marca, otra agrupación o cerrada de 0.10.0) → null y sin_cerrada", () => {
    expect(repartoSegunCerrada({ filas: cerradaB(), marcaId: MARCA.gamma, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "anual", incluir })).toMatchObject({ vectores: null, avisos: ["sin_cerrada"] });
    expect(repartoSegunCerrada({ filas: cerradaB(), marcaId: MARCA.beta, agrupacionMarcaId: AM.val, hasta: "2026-09", modo: "anual", incluir }).avisos).toEqual(["sin_cerrada"]);
    expect(repartoSegunCerrada({ filas: [], marcaId: MARCA.beta, agrupacionMarcaId: AM.pre, hasta: "2026-09", modo: "anual", incluir }).vectores).toBeNull();
  });
  it("los doce meses siguientes a k y los años de la cerrada que hay que pedir", () => {
    expect(mesesSiguientes("2026-09")[0]).toBe("2026-10");
    expect(mesesSiguientes("2026-09")[11]).toBe("2027-09");
    expect(aniosDeLaCerrada("2026-09")).toEqual([2026, 2027]);
    expect(aniosDeLaCerrada("2026-12")).toEqual([2027]);
  });
});

describe("regla 8: estacionalidad y tendencia", () => {
  it("la propia suma 1 sobre los años completos; sin año completo es null", () => {
    const completos = aniosCompletos(MESES);
    expect(completos).toEqual([2025]);
    const p = estacionalidadPropia(serie((m) => (m.slice(5, 7) === "01" ? 300 : 100)), completos)!;
    expect(p).toHaveLength(12);
    expect(suma(new Map(p.map((x, i) => [String(i), x])))).toBeCloseTo(1, 12);
    expect(p[0]).toBeCloseTo(300 / 1400, 12);
    expect(estacionalidadPropia(serie(() => 1), [])).toBeNull();
    expect(aniosCompletos(mesesDeVentana("2026-09", 12))).toEqual([]);
  });
  it("EAT de curvas iguales = 0 y de curvas disjuntas = 100; veredicto con 6 y 10", () => {
    const a = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(eat(a, a)).toBe(0);
    expect(eat(a, b)).toBe(100);
    expect([5.9, 6, 6.1, 10, 10.1].map(veredicto)).toEqual(["similar", "similar", "dudosa", "dudosa", "distinta"]);
    expect(veredicto(null)).toBeNull();
  });
  it("c^GML pondera las curvas por p2 y renormaliza sobre las g con curva (curva_incompleta si falta)", () => {
    const plana = Array.from({ length: 12 }, () => 1 / 12);
    const r = estacionalidadGml(new Map([["a", 0.5], ["b", 0.5]]), (c) => (c === "a" ? plana : null));
    expect(r.avisos).toEqual(["curva_incompleta"]);
    expect(r.curva![0]).toBeCloseTo(1 / 12, 12);
    expect(estacionalidadGml(new Map([["a", 1]]), () => null).curva).toBeNull();
  });
  it("tendencia: dos años completos → A₂ ÷ A₁ − 1; uno → null; A₁ = 0 → null", () => {
    const s = new Map([...Array.from({ length: 12 }, (_, i) => [`2024-${String(i + 1).padStart(2, "0")}`, 10] as const), ...Array.from({ length: 12 }, (_, i) => [`2025-${String(i + 1).padStart(2, "0")}`, 12] as const)]);
    expect(tendencia(s, [2024, 2025])).toBeCloseTo(0.2, 12);
    expect(tendencia(s, [2025])).toBeNull();
    expect(tendencia(new Map([["2024-01", 0], ["2025-01", 5]]), [2024, 2025])).toBeNull();
  });
});

describe("regla 10: ajuste", () => {
  it("renormalizarResto([50, 30, 17, 12] con la primera editada) → [50, 25,4, 14,4, 10,2] y suma 100,0", () => {
    const r = renormalizarResto([50, 30, 17, 12], [true, false, false, false]);
    expect(r).toEqual([50, 25.4, 14.4, 10.2]);
    expect(Math.round(r.reduce((a, b) => a + b, 0) * 10)).toBe(1000);
  });
  it("sin celdas libres o con lo editado por encima de 100 no toca nada; si las libres suman 0 reparte parejo", () => {
    expect(renormalizarResto([60, 40], [true, true])).toEqual([60, 40]);
    expect(renormalizarResto([120, 30], [true, false])).toEqual([120, 30]);
    expect(renormalizarResto([40, 0, 0], [true, false, false])).toEqual([40, 30, 30]);
  });
  it("puedeAprobar: cada vector suma 100 ± 0,05; al menos una fila; nota si hay ajuste, ventana ≠ 24, fuente cerrada o alcance", () => {
    const base = {
      vectores: new Map([["anual" as const, [0.5, 0.3, 0.2]]]),
      nota: undefined,
      hay_ajuste: false,
      ventana_meses: 24,
      fuente: "historico" as const,
      alcance_vacio: true,
    };
    expect(puedeAprobar(base)).toBeNull();
    expect(puedeAprobar({ ...base, vectores: new Map([["anual" as const, [0.5, 0.3, 0.2004]]]) })).toBeNull();
    expect(puedeAprobar({ ...base, vectores: new Map([["anual" as const, [0.5, 0.3, 0.19]]]) })).toBe("suma_invalida");
    expect(puedeAprobar({ ...base, vectores: new Map([["verano" as const, [0.5, 0.5]], ["invierno" as const, [0.5, 0.4]]]) })).toBe("suma_invalida");
    expect(puedeAprobar({ ...base, vectores: new Map() })).toBe("sin_filas");
    expect(puedeAprobar({ ...base, vectores: new Map([["anual" as const, [0, 0]]]) })).toBe("sin_filas");
    for (const cambio of [{ hay_ajuste: true }, { ventana_meses: 12 }, { fuente: "cerrada" as const }, { alcance_vacio: false }]) {
      expect(puedeAprobar({ ...base, ...cambio }), JSON.stringify(cambio)).toBe("nota_requerida");
      expect(puedeAprobar({ ...base, ...cambio, nota: "  " }), JSON.stringify(cambio)).toBe("nota_requerida");
      expect(puedeAprobar({ ...base, ...cambio, nota: "porque sí" }), JSON.stringify(cambio)).toBeNull();
    }
  });
});
