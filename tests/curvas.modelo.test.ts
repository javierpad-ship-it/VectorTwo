import { describe, expect, it } from "vitest";
import { listarMeses } from "@/lib/ventas/periodo";
import { formatearPuntos } from "@/lib/formato";
import { banda, estabilidad, nivelEstabilidad, recomendar, redondearJson } from "@/lib/curvas/modelo";
import { eat } from "@/lib/curvas/backtesting";
import type { CodigoAviso } from "@/lib/curvas/tipos-api";
import {
  ABRIGO_2024,
  ABRIGO_2025,
  ABRIGO_ID,
  CONSTANTE_ID,
  PEQUENA_ID,
  PUBLICADOS,
  T1,
  T4,
  VERANO_2024,
  VERANO_ID,
  agrupacionDe,
  agrupacionesFixture,
  corridaFixture,
  periodoFx,
  suma,
} from "./curvas.fixture";

const aviso = (a: ReturnType<typeof agrupacionDe>, codigo: CodigoAviso) => a.avisos.filter((x) => x.codigo === codigo);
const anio = (a: ReturnType<typeof agrupacionDe>, y: number) => a.anios.find((x) => x.anio === y)!;
const por = (v: number[], k: number) => v.map((x) => x * k);

describe("caso 1 · clasificación", () => {
  const s = corridaFixture("base");
  it("ABRIGO: 2023 atipico_completo (12), 2024 y 2025 normal, 2026 en_curso", () => {
    const a = agrupacionDe(s, ABRIGO_ID);
    expect(a.anios.map((x) => x.clase)).toEqual(["atipico_completo", "normal", "normal", "en_curso"]);
    expect(anio(a, 2023).meses_atipicos).toBe(12);
    expect(anio(a, 2026).meses_atipicos).toBe(9);
    expect(anio(a, 2026).meses_cargados).toBe(9);
  });
  it("VERANO: 2023 con_huecos (4); toda temporada: todos normales", () => {
    expect(anio(agrupacionDe(s, VERANO_ID), 2023)).toMatchObject({ clase: "con_huecos", meses_atipicos: 4 });
    expect(agrupacionDe(s, CONSTANTE_ID).anios.map((x) => x.clase)).toEqual(["normal", "normal", "normal", "en_curso"]);
  });
  it("«siete huecos»: ABRIGO 2023 atipico_completo (7), nunca imputado", () => {
    const x = corridaFixture("siete_huecos", { tratamiento_atipicos: "imputar" });
    const a = anio(agrupacionDe(x, ABRIGO_ID), 2023);
    expect(a).toMatchObject({ clase: "atipico_completo", meses_atipicos: 7, tratamiento: "descartado", imputados: [] });
    const auto = anio(agrupacionDe(corridaFixture("siete_huecos"), ABRIGO_ID), 2023);
    expect(auto.tratamiento).not.toBe("imputado");
  });
  it("un periodo con las tres temporadas afecta a las tres", () => {
    const todas = periodoFx("t", "2024-03", "2024-04", ["invierno", "verano", "todo_el_ano"]);
    const x = corridaFixture("base", {}, { periodos: [todas] });
    for (const id of [ABRIGO_ID, VERANO_ID, CONSTANTE_ID]) expect(anio(agrupacionDe(x, id), 2024).clase).toBe("con_huecos");
  });
});

describe("06e · bloque periodo del efecto (aditivo, sin cambio de cifras)", () => {
  const filas = corridaFixture("base").efecto_atipico.por_temporada;
  const fila = (anio: number, temporada: string) => filas.find((f) => f.anio === anio && f.temporada === temporada);
  it("invierno 2023 (periodo de los doce meses): el relativo del periodo coincide con ratio_relativo y las columnas de siempre no cambian", () => {
    const f = fila(2023, "invierno");
    expect(f).toMatchObject({ ratio_volumen: 0.65, ratio_control: 1, ratio_relativo: 0.65, meses_comparados: 12 });
    expect(f?.periodo).toMatchObject({ ratio_volumen: 0.65, ratio_control: 1, relativo: 0.65, meses_periodo: 12, meses_periodo_con_dato: 12 });
  });
  it("verano 2023 mide solo set–dic: el ratio del periodo es el de volumen del año completo porque el fixture escala todo el año", () => {
    const f = fila(2023, "verano");
    expect(f?.periodo?.meses_periodo).toBe(4);
    expect(f?.periodo?.meses_periodo_con_dato).toBe(4);
    expect(f?.periodo?.meses.filter((m) => m.en_periodo).map((m) => m.m)).toEqual([9, 10, 11, 12]);
    expect(f?.ratio_volumen).toBe(1.46);
  });
  it("2026 en curso: 9 meses con dato y el resto sin publicar; todo_el_ano y la red no llevan periodo", () => {
    expect(fila(2026, "invierno")?.periodo).toMatchObject({ meses_periodo: 12, meses_periodo_con_dato: 9, ratio_fuera: null });
    expect(fila(2026, "verano")?.periodo).toMatchObject({ meses_periodo: 4, meses_periodo_con_dato: 1 });
    expect(fila(2026, "todo_el_ano")?.periodo).toBeUndefined();
    expect(fila(2026, "red")?.periodo).toBeUndefined();
  });
});

describe("caso 1b · volumen y forma con el fixture base", () => {
  const a = agrupacionDe(corridaFixture("base"), ABRIGO_ID);
  it("ratio_volumen(2023) = 0,65 sobre {T1} frente a 2024; ratio_volumen(2026) = 0,65 frente a 2025 con 9 meses", () => {
    const v2023 = a.efecto_atipico.volumen.find((v) => v.anio === 2023)!;
    expect(v2023).toMatchObject({ ratio_volumen: 0.65, tiendas_comunes: 1, anio_referencia: 2024, meses_comparados: 12 });
    expect(v2023.por_anio_normal.map((p) => p.anio)).toEqual([2024, 2025]);
    const v2026 = a.efecto_atipico.volumen.find((v) => v.anio === 2026)!;
    expect(v2026).toMatchObject({ ratio_volumen: 0.65, anio_referencia: 2025, meses_comparados: 9 });
    expect(v2026.tiendas_comunes).toBe(3);
  });
  it("la forma de 2023 queda a la mitad del ruido entre normales (misma forma que 2024): estable, incluido, tres pliegues", () => {
    const f = a.efecto_atipico.forma!;
    expect(f.ruido_normal).toBeCloseTo(5.71, 1);
    expect(f.umbral_efectivo).toBeCloseTo(f.ruido_normal!, 6);
    const p2023 = f.por_anio.find((x) => x.anio === 2023)!;
    expect(p2023.parcial).toBe(false);
    if (!p2023.parcial) {
      expect(p2023.diferencia_anio).toBeCloseTo(f.ruido_normal! / 2, 1);
      expect(p2023.veredicto).toBe("forma_estable");
      expect(p2023.tratamiento_aplicado).toBe("incluido");
    }
    expect(anio(a, 2023)).toMatchObject({ tratamiento: "incluido", en_ajuste: true });
    expect(a.candidatas.find((c) => c.modelo === "A")?.pliegues).toBe(3);
  });
  it("avisos pocos_anos_normales y ano_atipico_completo presentes", () => {
    expect(aviso(a, "pocos_anos_normales")).toHaveLength(1);
    expect(aviso(a, "ano_atipico_completo")).toHaveLength(1);
  });
});

describe("caso 1c · forma corrida", () => {
  const a = agrupacionDe(corridaFixture("forma_corrida"), ABRIGO_ID);
  it("diferencia ≈ 40 pp > max(3; 5,7) → forma_cambia, corrimiento −1, 2023 descartado", () => {
    const f = a.efecto_atipico.forma!;
    const p = f.por_anio.find((x) => x.anio === 2023)!;
    if (p.parcial) throw new Error("debería ser completo");
    expect(p.diferencia_anio).toBeGreaterThan(30);
    expect(p.diferencia_anio).toBeLessThan(50);
    expect(p.veredicto).toBe("forma_cambia");
    expect(p.corrimiento_pico).toBe(-1);
    expect(p.tratamiento_aplicado).toBe("descartado");
    expect(anio(a, 2023)).toMatchObject({ tratamiento: "descartado", en_ajuste: false });
    expect(aviso(a, "forma_cambia")).toHaveLength(1);
  });
  it("y el ratio_volumen(2023) = 0,65 sigue igual", () => {
    expect(a.efecto_atipico.volumen.find((v) => v.anio === 2023)?.ratio_volumen).toBe(0.65);
  });
});

describe("caso 1d · ruido (B1)", () => {
  it("ABRIGO 2023 a ≈ 24 pp con ruido 5,7 → forma_cambia", () => {
    const a = agrupacionDe(corridaFixture("ruido"), ABRIGO_ID);
    const p = a.efecto_atipico.forma!.por_anio.find((x) => x.anio === 2023)!;
    if (p.parcial) throw new Error("debería ser completo");
    expect(p.diferencia_anio).toBeGreaterThan(20);
    expect(p.veredicto).toBe("forma_cambia");
  });
  // 2024 y 2025 difieren 30 pp entre sí; 2023 difiere 24 de la referencia: estable porque el umbral efectivo es 30.
  const dos025Distinto = por(ABRIGO_2024, 1).map((_, m) => (m === 3 ? 120 + 150 : m === 5 ? 240 - 150 : ABRIGO_2024[m]));
  const opciones = { abrigo: { 2023: ABRIGO_2024.map((_, m) => ABRIGO_2024[m === 3 ? 5 : m === 5 ? 3 : m]), 2024: ABRIGO_2024, 2025: dos025Distinto } };
  it("con 2024 y 2025 a 30 pp entre sí y 2023 a 24 pp de la referencia → forma_estable (umbral efectivo 30)", () => {
    const a = agrupacionDe(corridaFixture("base", {}, opciones), ABRIGO_ID);
    const f = a.efecto_atipico.forma!;
    expect(f.ruido_normal).toBeCloseTo(30, 0);
    expect(f.umbral_efectivo).toBeCloseTo(30, 0);
    expect(f.veredicto).toBe("forma_estable");
  });
  it("con piso 40 queda estable en los dos casos", () => {
    expect(agrupacionDe(corridaFixture("ruido", { umbral_forma: 40 }), ABRIGO_ID).efecto_atipico.forma?.veredicto).toBe("forma_estable");
    expect(agrupacionDe(corridaFixture("base", { umbral_forma: 40 }, opciones), ABRIGO_ID).efecto_atipico.forma?.veredicto).toBe("forma_estable");
  });
});

describe("caso 1e · verano", () => {
  const a = agrupacionDe(corridaFixture("base"), VERANO_ID);
  it("ratio_volumen(2023) = 1,46; forma_cambia, mes de mayor diferencia 12, corrimiento −1", () => {
    expect(a.efecto_atipico.volumen.find((v) => v.anio === 2023)?.ratio_volumen).toBe(1.46);
    const p = a.efecto_atipico.forma!.por_anio.find((x) => x.anio === 2023)!;
    if (p.parcial) throw new Error("debería ser completo");
    expect(p.veredicto).toBe("forma_cambia");
    expect(p.mes_mayor_diferencia).toBe(12);
    expect(p.corrimiento_pico).toBe(-1);
  });
  it("con auto queda imputado y el peso imputado es Σ r_9..12 ≈ 0,46", () => {
    const x = anio(a, 2023);
    expect(x).toMatchObject({ tratamiento: "imputado", imputados: [9, 10, 11, 12] });
    expect(x.peso_imputado).toBeCloseTo(0.46, 2);
    expect(x.participacion?.slice(8).reduce((s, v) => s + v, 0)).toBeCloseTo(0.46, 2);
    expect(suma(x.participacion!)).toBeCloseTo(1, 6);
  });
  it("con max_meses_hueco = 3 los cuatro meses ya son atipico_completo y se descarta", () => {
    const b = agrupacionDe(corridaFixture("base", { max_meses_hueco: 3 }), VERANO_ID);
    expect(anio(b, 2023)).toMatchObject({ clase: "atipico_completo", tratamiento: "descartado" });
  });
});

describe("caso 1g · forma parcial doble (I7)", () => {
  const a = agrupacionDe(corridaFixture("base"), ABRIGO_ID);
  it("la red completa de 2026 incluye a T3 y las tiendas comunes con 2025 no: diferencia mayor en la completa; ninguna cambia el tratamiento", () => {
    const p = a.efecto_atipico.forma!.por_anio.find((x) => x.anio === 2026)!;
    if (!p.parcial) throw new Error("debería ser parcial");
    expect(p.red_completa!.diferencia_anio).toBeGreaterThan(p.tiendas_comunes!.diferencia_anio);
    expect(p.veredicto).toBeNull();
    expect(p.tratamiento_aplicado).toBeNull();
    expect(anio(a, 2026).tratamiento).toBeNull();
    expect(anio(a, 2026).en_ajuste).toBe(false);
  });
});

describe("caso 2 · participación y red", () => {
  const s = corridaFixture("base");
  it("participación 2024 de ABRIGO con la red por defecto", () => {
    const p = anio(agrupacionDe(s, ABRIGO_ID), 2024).participacion!;
    const esperado = [0.02, 0.02, 0.06, 0.12, 0.2, 0.24, 0.16, 0.08, 0.04, 0.02, 0.02, 0.02];
    p.forEach((v, m) => expect(v).toBeCloseTo(esperado[m], 6));
  });
  it("con solo_tiendas_completas y exigir_venta apagados, p_12 de 2025 sube (T3 vende ya en diciembre)", () => {
    const base = anio(agrupacionDe(s, ABRIGO_ID), 2025).participacion![11];
    const abierta = corridaFixture("base", { solo_tiendas_completas: false, exigir_venta_todo_el_ano: false });
    expect(anio(agrupacionDe(abierta, ABRIGO_ID), 2025).participacion![11]).toBeGreaterThan(base);
  });
  it("caso 2c: el aviso tienda_distinta nombra a T3 y 2026; T2 no", () => {
    const a = agrupacionDe(s, ABRIGO_ID);
    const textos = aviso(a, "tienda_distinta").map((x) => x.detalle);
    expect(textos.some((t) => t.includes("2026") && t.includes("T3"))).toBe(true);
    expect(textos.some((t) => t.includes("T2"))).toBe(false);
    const t3 = anio(a, 2026).por_tienda.find((t) => t.tienda_id === "t3")!;
    expect(t3.distinta).toBe(true);
    expect(t3.peso).toBeGreaterThan(0.05);
  });
  it("tienda_dominante se emite con año y peso sobre la agrupación", () => {
    const a = agrupacionDe(s, ABRIGO_ID);
    expect(aviso(a, "tienda_dominante").some((x) => /2024.*T1.*100 %/.test(x.detalle))).toBe(true);
    expect(anio(a, 2024).peso_tienda_mayor).toBeGreaterThan(0.35);
  });
  it("las unidades de la red por mes figuran en cada año y suman las unidades del año", () => {
    const x = anio(agrupacionDe(s, ABRIGO_ID), 2024);
    expect(x.meses).toEqual(ABRIGO_2024);
    expect(x.unidades).toBe(1000);
    expect(anio(agrupacionDe(s, ABRIGO_ID), 2025).unidades).toBe(suma(ABRIGO_2025));
  });
});

describe("caso 2d · serie con ceros y mes negativo", () => {
  it("una agrupación sin filas en un mes publicado tiene 0 ese mes y el año sigue completo", () => {
    const s = corridaFixture("base", {}, { sinFilasEn: [] , abrigo: { 2023: por(ABRIGO_2024, 0.65).map((x, m) => (m === 1 ? 0 : x)), 2024: ABRIGO_2024, 2025: ABRIGO_2025 } });
    const x = anio(agrupacionDe(s, ABRIGO_ID), 2023);
    expect(x.meses[1]).toBe(0);
    expect(x.clase).toBe("atipico_completo");
  });
  it("−3 en T1 y +2 en T4 suman −1: se trunca a 0 con el aviso mes_negativo", () => {
    const filas = [
      { agrupacion_id: ABRIGO_ID, tienda_id: T1, periodo: "2024-02", unidades: -3, venta_soles: 0, costo_vendido: 0 },
      { agrupacion_id: ABRIGO_ID, tienda_id: T4, periodo: "2024-02", unidades: 2, venta_soles: 0, costo_vendido: 0 },
    ];
    const s = corridaFixture("base", {}, { abrigo: { 2023: por(ABRIGO_2024, 0.65), 2024: ABRIGO_2024.map((x, m) => (m === 1 ? 0 : x)), 2025: ABRIGO_2025 }, extra: filas });
    const a = agrupacionDe(s, ABRIGO_ID);
    expect(anio(a, 2024).meses[1]).toBe(0);
    expect(aviso(a, "mes_negativo")[0]?.detalle).toContain("2024-02");
  });
  it("la suma que sigue positiva NO avisa (una tienda negativa compensa con otra)", () => {
    const filas = [
      { agrupacion_id: ABRIGO_ID, tienda_id: T1, periodo: "2024-02", unidades: -5, venta_soles: 0, costo_vendido: 0 },
      { agrupacion_id: ABRIGO_ID, tienda_id: T4, periodo: "2024-02", unidades: 20, venta_soles: 0, costo_vendido: 0 },
    ];
    const s = corridaFixture("base", {}, { abrigo: { 2023: por(ABRIGO_2024, 0.65), 2024: ABRIGO_2024.map((x, m) => (m === 1 ? 0 : x)), 2025: ABRIGO_2025 }, extra: filas });
    const a = agrupacionDe(s, ABRIGO_ID);
    expect(anio(a, 2024).meses[1]).toBe(15);
    expect(aviso(a, "mes_negativo")).toHaveLength(0);
  });
});

describe("caso 3 · imputación (fixture «huecos»)", () => {
  it("con auto los meses 3 a 5 valen r y la suma es 1", () => {
    const a = agrupacionDe(corridaFixture("huecos"), ABRIGO_ID);
    const x = anio(a, 2023);
    expect(x).toMatchObject({ clase: "con_huecos", tratamiento: "imputado", imputados: [3, 4, 5] });
    const r = [2, 3, 4].map((m) => (anio(a, 2024).participacion![m] + anio(a, 2025).participacion![m]) / 2);
    [2, 3, 4].forEach((m, i) => expect(x.participacion![m]).toBeCloseTo(r[i], 5));
    expect(suma(x.participacion!)).toBeCloseTo(1, 5);
  });
  it("con descartar, anios_ajuste = [2024, 2025]; con incluir, A baja en marzo–mayo", () => {
    const d = corridaFixture("huecos", { tratamiento_atipicos: "descartar" });
    expect(agrupacionDe(d, ABRIGO_ID).anios.filter((x) => x.en_ajuste).map((x) => x.anio)).toEqual([2024, 2025]);
    expect(d.resultado.temporadas.find((t) => t.temporada === "invierno")?.anios_ajuste).toEqual([2024, 2025]);
    const aA = (s: ReturnType<typeof corridaFixture>) => agrupacionDe(s, ABRIGO_ID).candidatas.find((c) => c.modelo === "A")!.curva!;
    const inc = aA(corridaFixture("huecos", { tratamiento_atipicos: "incluir" }));
    const des = aA(d);
    for (const m of [2, 3, 4]) expect(inc[m]).toBeLessThan(des[m]);
  });
});

describe("caso 4 · candidatas y T", () => {
  const tresIguales = { verano: { 2023: VERANO_2024, 2024: VERANO_2024, 2025: VERANO_2024 } };
  it("VERANO con tres años idénticos: A = B = C (igual_a A), D difiere, EAT 0, recomendada A, estabilidad 1, banda ancho 0", () => {
    const s = corridaFixture("base", {}, { ...tresIguales, periodos: [] });
    const a = agrupacionDe(s, VERANO_ID);
    const c = (m: string) => a.candidatas.find((x) => x.modelo === m)!;
    expect(c("A").eat).toBeCloseTo(0, 4);
    expect(c("B").igual_a).toBe("A");
    expect(c("C").igual_a).toBe("A");
    expect(c("D").igual_a).toBeNull();
    expect(c("D").eat).toBeGreaterThan(1);
    expect(a.recomendada).toBe("A");
    expect(a.motivo_recomendacion).toBe("menor_error");
    expect(a.estabilidad).toBeCloseTo(1, 6);
    expect(a.nivel_estabilidad).toBe("alta");
    for (const b of a.banda!) expect(b.max - b.min).toBeLessThan(1e-5);
  });
  describe("PEQUEÑA (fixture «escasa»)", () => {
    const s = corridaFixture("escasa");
    const a = agrupacionDe(s, PEQUENA_ID);
    it("2023 y 2025 son escasos: un solo año de ajuste, sin propias, recomendada T prestada", () => {
      expect(anio(a, 2023).escaso).toBe(true);
      expect(anio(a, 2025).escaso).toBe(true);
      expect(anio(a, 2024)).toMatchObject({ escaso: false, en_ajuste: true });
      expect(a.anios.filter((x) => x.en_ajuste)).toHaveLength(1);
      expect(a.candidatas.filter((c) => c.modelo !== "T").every((c) => c.curva === null)).toBe(true);
      expect(a.recomendada).toBe("T");
      expect(a.motivo_recomendacion).toBe("prestada");
      expect(a.origen).toBe("prestada");
      expect(a.candidatas.find((c) => c.modelo === "T")).toMatchObject({ prestada: true, eat: null });
      expect(a.estabilidad).toBeNull();
      expect(a.banda).toBeNull();
    });
    it("avisos pocos_anos_ajuste, escaso, prestada y cambio_volumen_extremo (90 → 400)", () => {
      expect(aviso(a, "pocos_anos_ajuste")).toHaveLength(1);
      expect(aviso(a, "escaso")[0].detalle).toContain("2023");
      expect(aviso(a, "prestada")).toHaveLength(1);
      expect(aviso(a, "cambio_volumen_extremo").some((x) => x.detalle.includes("2023 a 2024"))).toBe(true);
    });
    it("T es la curva agregada de toda temporada (CONSTANTE + PEQUEÑA)", () => {
      const t = s.resultado.temporadas.find((x) => x.temporada === "todo_el_ano")!;
      expect(t.agrupaciones).toBe(2);
      expect(a.candidatas.find((c) => c.modelo === "T")?.curva).toEqual(t.curva_T);
      expect(suma(t.curva_T!.map((v) => v * 1e6))).toBeCloseTo(1e6, 0);
    });
  });
  it("cambio_volumen_extremo con 100 y 400 (cociente 4 > 3) y no con 100 y 250", () => {
    const mk = (a: number, b: number) =>
      agrupacionDe(
        corridaFixture("base", {}, { periodos: [], abrigo: { 2023: ABRIGO_2024, 2024: por(ABRIGO_2024, a / 1000), 2025: por(ABRIGO_2024, b / 1000) } }),
        ABRIGO_ID
      );
    expect(aviso(mk(1000, 4000), "cambio_volumen_extremo").length).toBeGreaterThan(0);
    expect(aviso(mk(100, 250), "cambio_volumen_extremo").some((x) => x.detalle.includes("2024 a 2025"))).toBe(false);
  });
});

describe("caso 5 · recomendación relativa (I1)", () => {
  const a = agrupacionDe(corridaFixture("base"), ABRIGO_ID);
  it("A y B difieren menos que el margen (0,25 × ruido) y gana A; la EAT por pliegue de A trae 2023, 2024 y 2025", () => {
    const cand = (m: string) => a.candidatas.find((c) => c.modelo === m)!;
    expect(Math.abs(cand("A").eat! - cand("B").eat!)).toBeLessThan(a.margen!);
    expect(a.margen).toBeCloseTo(0.25 * 5.7087, 2);
    expect(a.recomendada).toBe("A");
    expect(cand("A").eat_por_pliegue.map((p) => p.anio)).toEqual([2023, 2024, 2025]);
    expect(cand("A").eat).toBeCloseTo(cand("A").eat_por_pliegue.reduce((s, p) => s + p.eat, 0) / 3, 4);
  });
  it("el margen_ruido es un parámetro: con 0 el margen baja al empate mínimo", () => {
    expect(agrupacionDe(corridaFixture("base", { margen_ruido: 0 }), ABRIGO_ID).margen).toBe(0.05);
  });
  it("la frase comparativa existe cuando hay propias", () => {
    expect(a.comparacion?.frase).toMatch(/se equivoca/);
    expect(a.comparacion?.pliegues).toBe(3);
  });
});

describe("regla 17 · recomendar", () => {
  const cand = (modelo: "A" | "B" | "C" | "D" | "E" | "T", eatV: number | null, curva = [1]) => ({ modelo, curva, eat: eatV });
  it("con ruido 33 y margen 0,25, B a 27,4 frente a A a 29,1 NO desbanca a A (margen 8,25); B a 20 sí", () => {
    const r = recomendar([cand("A", 29.1), cand("B", 27.4)], 33, 0.25);
    expect(r).toMatchObject({ recomendada: "A", motivo: "sin_evidencia" });
    expect(r.margen).toBeCloseTo(8.25, 6);
    expect(recomendar([cand("A", 29.1), cand("B", 20)], 33, 0.25)).toMatchObject({ recomendada: "B", motivo: "menor_error" });
  });
  it("sin ruido el margen es EMPATE_EAT (0,05): B mejor por 0,1 gana; por 0,03 no", () => {
    expect(recomendar([cand("A", 10), cand("B", 9.9)], null, 0.25)).toMatchObject({ recomendada: "B" });
    expect(recomendar([cand("A", 10), cand("B", 9.97)], null, 0.25)).toMatchObject({ recomendada: "A", motivo: "sin_evidencia" });
  });
  it("empate exacto entre las demás: la primera del orden; A mejor de todas: menor_error", () => {
    expect(recomendar([cand("A", 30), cand("B", 5), cand("C", 5)], 0, 0).recomendada).toBe("B");
    expect(recomendar([cand("A", 1), cand("B", 5)], 10, 0.25)).toMatchObject({ recomendada: "A", motivo: "menor_error" });
  });
  it("sin propias → T prestada; sin nada → null", () => {
    expect(recomendar([cand("T", null, [1])], null, 0.25)).toMatchObject({ recomendada: "T", motivo: "prestada" });
    expect(recomendar([{ modelo: "T", curva: null, eat: null }], null, 0.25)).toMatchObject({ recomendada: null, motivo: null });
    expect(recomendar([], null, 0.25).recomendada).toBeNull();
  });
  it("las candidatas sin curva o sin EAT no compiten", () => {
    expect(recomendar([cand("A", 10), { modelo: "B", curva: null, eat: null }, { modelo: "C", curva: [1], eat: null }], 5, 0.25).recomendada).toBe("A");
  });
});

describe("regla 18 · estabilidad y banda", () => {
  const p = [0.1, 0.2, 0.3, 0.4, 0, 0, 0, 0, 0, 0, 0, 0];
  it("años idénticos → estabilidad 1 y banda de ancho 0; con un año → null", () => {
    expect(estabilidad([p, p, p])).toBe(1);
    for (const b of banda([p, p])!) expect(b.max - b.min).toBe(0);
    expect(estabilidad([p])).toBeNull();
    expect(banda([p])).toBeNull();
  });
  it("años distintos bajan la estabilidad y la banda va de mínimo a máximo", () => {
    const q = [0.4, 0.3, 0.2, 0.1, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(estabilidad([p, q])!).toBeLessThan(1);
    expect(banda([p, q])![0]).toEqual({ min: 0.1, max: 0.4 });
    expect(nivelEstabilidad(0.9)).toBe("alta");
    expect(nivelEstabilidad(0.75)).toBe("media");
    expect(nivelEstabilidad(0.3)).toBe("baja");
    expect(nivelEstabilidad(null)).toBeNull();
  });
});

describe("caso 6 · liquidación como señal", () => {
  const s = corridaFixture("base");
  const a = agrupacionDe(s, ABRIGO_ID);
  it("marca diciembre de 2025 de ABRIGO; liquidacion_fuerte no se emite (un solo mes)", () => {
    expect(anio(a, 2025).liquidacion).toEqual(["2025-12"]);
    expect(anio(a, 2024).liquidacion).toEqual([]);
    expect(aviso(a, "liquidacion_fuerte")).toHaveLength(0);
  });
  it("ninguna candidata cambia por la liquidación (la curva base refleja lo vendido)", () => {
    const sin = corridaFixture("base", { umbral_liquidacion: 0.5 });
    const curvas = (x: typeof s) => agrupacionDe(x, ABRIGO_ID).candidatas.map((c) => c.curva);
    expect(curvas(sin)).toEqual(curvas(s));
    expect(anio(agrupacionDe(sin, ABRIGO_ID), 2025).liquidacion).toEqual([]);
  });
  it("cv_mensual recoge el CV % por mes de los años utilizables", () => {
    const dic = a.cv_mensual.find((m) => m.periodo === "2025-12");
    expect(dic?.cv).toBeCloseTo(0.7, 4);
    expect(a.cv_mensual.find((m) => m.periodo === "2024-12")?.cv).toBeCloseTo(0.5, 4);
  });
  it("más de tres meses en liquidación emiten liquidacion_fuerte", () => {
    const filas = [1, 2, 3, 4].map((m) => ({ agrupacion_id: ABRIGO_ID, tienda_id: T1, periodo: `2024-0${m}`, unidades: 0, venta_soles: 1000, costo_vendido: 900 }));
    // Se reemplazan por filas con CV alto: se quitan los meses de ABRIGO y se vuelven a poner.
    const x = corridaFixture(
      "base",
      {},
      { abrigo: { 2023: por(ABRIGO_2024, 0.65), 2024: ABRIGO_2024.map((u, m) => (m < 4 ? 0 : u)), 2025: ABRIGO_2025 }, extra: filas.map((f) => ({ ...f, unidades: ABRIGO_2024[Number(f.periodo.slice(5)) - 1] })) }
    );
    expect(aviso(agrupacionDe(x, ABRIGO_ID), "liquidacion_fuerte").length).toBeGreaterThan(0);
  });
});

describe("caso 7 · validación parcial del año en curso", () => {
  const s = corridaFixture("base");
  it("VERANO 2026 (8 meses útiles): EAT parcial de A ≈ 0", () => {
    const a = agrupacionDe(s, VERANO_ID);
    expect(a.candidatas.find((c) => c.modelo === "A")?.eat_parcial).toBeCloseTo(0, 1);
  });
  it("ABRIGO 2026 → null (todos los meses cargados son atípicos); la lectura es la forma parcial", () => {
    const a = agrupacionDe(s, ABRIGO_ID);
    for (const c of a.candidatas) expect(c.eat_parcial).toBeNull();
    expect(a.efecto_atipico.forma?.por_anio.some((x) => x.parcial && x.anio === 2026)).toBe(true);
  });
  it("la validación parcial no entra en la recomendación", () => {
    const a = agrupacionDe(s, VERANO_ID);
    expect(a.recomendada).toBe("A");
  });
});

describe("caso 8 · pocos años", () => {
  const solo2023 = { publicados: listarMeses("2023-01", "2023-12"), hasta: "2023-12" };
  it("sin 2024 ni 2025, con imputar o descartar → sin años y sin T (null con sin_anos_utilizables)", () => {
    for (const t of ["imputar", "descartar"] as const) {
      const s = corridaFixture("base", { tratamiento_atipicos: t }, solo2023);
      const a = agrupacionDe(s, ABRIGO_ID);
      expect(anio(a, 2023).tratamiento).toBe("descartado");
      expect(a.recomendada).toBeNull();
      expect(a.origen).toBeNull();
      expect(aviso(a, "sin_anos_utilizables")).toHaveLength(1);
      // Hay venta (2023): no es `sin_venta` (regla 50); lo que falta es curva posible.
      expect(s.resumen.sin_venta).toBe(0);
    }
  });
  it("con auto → sin_comparacion, 2023 incluido, pero un solo año de ajuste → prestada igualmente (pocos_anos_ajuste)", () => {
    const s = corridaFixture("base", {}, solo2023);
    const a = agrupacionDe(s, ABRIGO_ID);
    expect(anio(a, 2023)).toMatchObject({ tratamiento: "incluido", en_ajuste: true });
    expect(a.efecto_atipico.forma?.veredicto).toBe("sin_comparacion");
    expect(a.recomendada).toBe("T");
    expect(a.origen).toBe("prestada");
    expect(aviso(a, "pocos_anos_ajuste")).toHaveLength(1);
    expect(aviso(a, "sin_referencia")).toHaveLength(1);
    expect(aviso(a, "sin_referencia_volumen")).toHaveLength(1);
  });
});

describe("caso 12 · determinismo y el año en curso no entra en el ajuste", () => {
  it("misma entrada, mismo resultado", () => {
    expect(corridaFixture("base")).toEqual(corridaFixture("base"));
  });
  it("cambiar 2026 no cambia ninguna curva, solo eat_parcial y la forma parcial", () => {
    const base = corridaFixture("base");
    const otro = corridaFixture("base", {}, {
      abrigo: { 2023: por(ABRIGO_2024, 0.65), 2024: ABRIGO_2024, 2025: ABRIGO_2025, 2026: [500, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0] },
      verano: { 2023: VERANO_2024.map((u, m) => (m >= 8 ? u * 2 : u)), 2024: VERANO_2024, 2025: por(VERANO_2024, 1.2), 2026: [1, 1, 1, 1, 1, 1, 1, 400, 1, 0, 0, 0] },
    });
    for (const id of [ABRIGO_ID, VERANO_ID]) {
      const x = agrupacionDe(base, id);
      const y = agrupacionDe(otro, id);
      expect(y.candidatas.map((c) => c.curva)).toEqual(x.candidatas.map((c) => c.curva));
      expect(y.candidatas.map((c) => c.eat)).toEqual(x.candidatas.map((c) => c.eat));
      expect(y.recomendada).toBe(x.recomendada);
    }
    expect(agrupacionDe(otro, VERANO_ID).candidatas.find((c) => c.modelo === "A")?.eat_parcial).not.toBe(
      agrupacionDe(base, VERANO_ID).candidatas.find((c) => c.modelo === "A")?.eat_parcial
    );
    expect(base.resultado.temporadas.map((t) => t.curva_T)).toEqual(otro.resultado.temporadas.map((t) => t.curva_T));
  });
});

describe("regla 19/20 · avisos exactamente en su condición", () => {
  it("meses_sin_cargar: un año con un mes sin publicar", () => {
    const publicados = PUBLICADOS.filter((m) => m !== "2024-05");
    const s = corridaFixture("base", {}, { publicados, sinFilasEn: ["2024-05"] });
    const a = agrupacionDe(s, CONSTANTE_ID);
    expect(anio(a, 2024).clase).toBe("incompleto");
    expect(aviso(a, "meses_sin_cargar")[0].detalle).toContain("2024");
    // Un año incompleto no entra en nada.
    expect(anio(a, 2024).en_ajuste).toBe(false);
    expect(aviso(agrupacionDe(corridaFixture("base"), CONSTANTE_ID), "meses_sin_cargar")).toHaveLength(0);
  });
  it("sin_venta: una agrupación sin ninguna fila", () => {
    const s = corridaFixture("base", {}, { sinAgrupacion: [CONSTANTE_ID] });
    const a = agrupacionDe(s, CONSTANTE_ID);
    expect(aviso(a, "sin_venta")).toHaveLength(1);
    expect(a.origen).toBeNull();
    expect(aviso(agrupacionDe(s, ABRIGO_ID), "sin_venta")).toHaveLength(0);
  });
  it("temporada_sugerida_distinta y temporadas_mezcladas salen de la entrada; no se emiten por defecto", () => {
    const agr = agrupacionesFixture("base").map((x) => (x.id === CONSTANTE_ID ? { ...x, temporada_sugerida: "invierno" as const, temporadas_mezcladas: true } : x));
    const a = agrupacionDe(corridaFixture("base", {}, { agrupaciones: agr }), CONSTANTE_ID);
    expect(aviso(a, "temporada_sugerida_distinta")).toHaveLength(1);
    expect(aviso(a, "temporadas_mezcladas")).toHaveLength(1);
    const b = agrupacionDe(corridaFixture("base"), CONSTANTE_ID);
    expect(aviso(b, "temporada_sugerida_distinta")).toHaveLength(0);
    expect(aviso(b, "temporadas_mezcladas")).toHaveLength(0);
    expect(a.temporada_sugerida).toBe("invierno");
  });
  it("sin_red_comparable: ningún año tiene tienda que cumpla", () => {
    const s = corridaFixture("base", { solo_tiendas_completas: true, meses_tienda_nueva: 24 });
    // Con 24 meses de tienda nueva T1 (abierta en 2020) sigue entrando: hay red en todos los años.
    expect(aviso(agrupacionDe(s, ABRIGO_ID), "sin_red_comparable")).toHaveLength(0);
    const sin = corridaFixture("base", {}, { periodos: [], hasta: "2026-09", extra: [] , sinFilasEn: PUBLICADOS.filter((m) => m.startsWith("2024")) });
    const a = agrupacionDe(sin, ABRIGO_ID);
    expect(aviso(a, "sin_red_comparable")[0].detalle).toContain("2024");
    expect(anio(a, 2024).en_ajuste).toBe(false);
  });
});

describe("regla 23 · identidad del resumen", () => {
  it("agrupaciones_activas = propias + prestadas + sin_venta y los años por clase suman los años de todas las agrupaciones", () => {
    for (const v of ["base", "escasa"] as const) {
      const s = corridaFixture(v);
      const r = s.resumen;
      expect(r.agrupaciones_activas).toBe(r.propias + r.prestadas + r.sin_venta);
      expect(r.agrupaciones_activas).toBe(s.resultado.agrupaciones.length);
      const total = Object.values(r.anios_por_clase).reduce((x, y) => x + y, 0);
      expect(total).toBe(s.resultado.agrupaciones.reduce((x, a) => x + a.anios.length, 0));
    }
  });
  it("el resultado es JSON puro con seis decimales como mucho", () => {
    const texto = JSON.stringify(corridaFixture("base").resultado);
    expect(texto.match(/\d+\.\d{7,}/g)).toBeNull();
    expect(redondearJson({ a: 1.23456789, b: [0.1234567891] })).toEqual({ a: 1.234568, b: [0.123457] });
  });
  it("formatearPuntos: formato es-PE de la pantalla (decimal con punto, un decimal)", () => {
    expect(formatearPuntos(33)).toBe("33.0");
    expect(formatearPuntos(27.43)).toBe("27.4");
    expect(formatearPuntos(8.25)).toBe("8.3");
  });
  it("los pesos y la EAT entre curvas usan puntos (eat de curvas iguales = 0)", () => {
    expect(eat([0.5, 0.5], [0.5, 0.5])).toBe(0);
  });
});
