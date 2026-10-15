import { describe, expect, it } from "vitest";
import {
  aniosDeCorrida,
  armarSerieAnual,
  clasificarAnio,
  curvaAcumulada,
  hastaPorDefecto,
  mesesDelAnio,
  mesesFaltantes,
  normalizarCurva,
  participacion,
  serieDeAgrupacion,
} from "@/lib/curvas/anios";
import { listarMeses } from "@/lib/ventas/periodo";

const PUBLICADOS = listarMeses("2023-01", "2026-09");
const sinAtipicos: string[] = [];

describe("regla 1 · clasificarAnio", () => {
  it("doce publicados y ningún atípico: normal", () => {
    expect(clasificarAnio(2024, PUBLICADOS, sinAtipicos, 4, "2026-09")).toEqual({ clase: "normal", meses_atipicos: [], meses_cargados: 12 });
  });
  it("de 1 a maxHuecos atípicos: con_huecos con la lista", () => {
    const r = clasificarAnio(2023, PUBLICADOS, ["2023-03", "2023-04", "2023-05"], 4, "2026-09");
    expect(r.clase).toBe("con_huecos");
    expect(r.meses_atipicos).toEqual(["2023-03", "2023-04", "2023-05"]);
    expect(clasificarAnio(2023, PUBLICADOS, ["2023-09", "2023-10", "2023-11", "2023-12"], 4, "2026-09").clase).toBe("con_huecos");
  });
  it("más de maxHuecos, doce incluidos: atipico_completo con n meses (I2)", () => {
    expect(clasificarAnio(2023, PUBLICADOS, mesesDelAnio(2023), 4, "2026-09")).toMatchObject({ clase: "atipico_completo" });
    const siete = mesesDelAnio(2023).slice(2, 9);
    expect(clasificarAnio(2023, PUBLICADOS, siete, 4, "2026-09")).toMatchObject({ clase: "atipico_completo" });
    expect(clasificarAnio(2023, PUBLICADOS, siete, 4, "2026-09").meses_atipicos).toHaveLength(7);
    // El umbral es parámetro: con 3, cuatro meses ya son un año atípico completo.
    expect(clasificarAnio(2023, PUBLICADOS, ["2023-09", "2023-10", "2023-11", "2023-12"], 3, "2026-09").clase).toBe("atipico_completo");
  });
  it("algún mes sin publicar: incompleto (y no entra en nada)", () => {
    const faltando = PUBLICADOS.filter((m) => m !== "2024-05");
    expect(clasificarAnio(2024, faltando, sinAtipicos, 4, "2026-09")).toMatchObject({ clase: "incompleto", meses_cargados: 11 });
  });
  it("el año de hasta_periodo con menos de doce meses es en_curso; los atípicos se cuentan entre los cargados", () => {
    expect(clasificarAnio(2026, PUBLICADOS, sinAtipicos, 4, "2026-09")).toMatchObject({ clase: "en_curso", meses_cargados: 9 });
    const atipicos = mesesDelAnio(2026);
    expect(clasificarAnio(2026, PUBLICADOS, atipicos, 4, "2026-09").meses_atipicos).toHaveLength(9);
  });
  it("si hasta_periodo es diciembre el año queda completo", () => {
    const todo = listarMeses("2023-01", "2026-12");
    expect(clasificarAnio(2026, todo, sinAtipicos, 4, "2026-12").clase).toBe("normal");
  });
});

describe("regla 2 · participacion", () => {
  it("[10, 20, 30, 40, 0, …] → [0.1, 0.2, 0.3, 0.4, 0, …]", () => {
    const p = participacion([10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p?.slice(0, 5)).toEqual([0.1, 0.2, 0.3, 0.4, 0]);
  });
  it("todo cero (o negativo) → null", () => {
    expect(participacion(Array(12).fill(0))).toBeNull();
    expect(participacion([-5, ...Array(11).fill(0)])).toBeNull();
  });
});

describe("regla 2b · serieDeAgrupacion", () => {
  const meses = ["2024-01", "2024-02", "2024-03"];
  it("un valor por mes publicado, 0 si no hay fila", () => {
    const r = serieDeAgrupacion([{ tienda_id: "t1", periodo: "2024-01", unidades: 10 }], meses, new Set(["t1"]));
    expect(r.valores).toEqual({ "2024-01": 10, "2024-02": 0, "2024-03": 0 });
    expect(r.negativos).toEqual([]);
  });
  it("suma solo las tiendas de la red y trunca a 0 DESPUÉS de sumar", () => {
    const filas = [
      { tienda_id: "t1", periodo: "2024-01", unidades: -5 },
      { tienda_id: "t2", periodo: "2024-01", unidades: 20 },
      { tienda_id: "t1", periodo: "2024-02", unidades: -5 },
      { tienda_id: "t2", periodo: "2024-02", unidades: 2 },
      { tienda_id: "fuera", periodo: "2024-03", unidades: 99 },
    ];
    const r = serieDeAgrupacion(filas, meses, new Set(["t1", "t2"]));
    expect(r.valores["2024-01"]).toBe(15);
    expect(r.valores["2024-02"]).toBe(0);
    expect(r.negativos).toEqual(["2024-02"]);
    expect(r.valores["2024-03"]).toBe(0);
  });
  it("una agrupación con filas solo en 2024 tiene 2023 y 2025 en ceros, no ausentes", () => {
    const publicados = listarMeses("2023-01", "2025-12");
    const filas = [{ tienda_id: "t1", periodo: "2024-06", unidades: 40 }];
    const { valores } = serieDeAgrupacion(filas, publicados, new Set(["t1"]));
    expect(Object.keys(valores)).toHaveLength(36);
    const s2023 = armarSerieAnual(2023, valores, publicados);
    const s2025 = armarSerieAnual(2025, valores, publicados);
    expect(s2023).toMatchObject({ meses: Array(12).fill(0), completo: true });
    expect(s2025.meses).toEqual(Array(12).fill(0));
    expect(participacion(s2023.meses)).toBeNull();
  });
  it("el año en curso marca como no publicados los meses posteriores a hasta", () => {
    const { valores } = serieDeAgrupacion([], PUBLICADOS, new Set(["t1"]));
    const s = armarSerieAnual(2026, valores, PUBLICADOS, "2026-09");
    expect(s.completo).toBe(false);
    expect(s.publicados.filter(Boolean)).toHaveLength(9);
  });
  it("un campo distinto de unidades se suma igual", () => {
    const r = serieDeAgrupacion([{ tienda_id: "t1", periodo: "2024-01", venta_soles: 1500 }], meses, new Set(["t1"]), "venta_soles");
    expect(r.valores["2024-01"]).toBe(1500);
  });
});

describe("regla 3 · normalizarCurva y curvaAcumulada", () => {
  const sumaMicro = (v: number[]) => v.reduce((s, x) => s + Math.round(x * 1e6), 0);
  it("suma exactamente 1,000000 y es idempotente", () => {
    const sucia = [1 / 3, 1 / 7, 1 / 11, 0.2, 0.05, 0.05, 0.05, 0.05, 0.05, 0.02, 0.01, 0.0013];
    const n = normalizarCurva(sucia);
    expect(sumaMicro(n)).toBe(1_000_000);
    expect(normalizarCurva(n)).toEqual(n);
  });
  it("con suma ≤ 0 devuelve ceros", () => {
    expect(normalizarCurva(Array(12).fill(0))).toEqual(Array(12).fill(0));
  });
  it("curvaAcumulada es creciente y termina en 1", () => {
    const c = normalizarCurva([5, 5, 10, 10, 20, 20, 10, 5, 5, 4, 3, 3]);
    const a = curvaAcumulada(c);
    expect(a).toHaveLength(12);
    for (let i = 1; i < 12; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
    expect(a[11]).toBe(1);
  });
});

describe("regla 5 · hastaPorDefecto y años de la corrida", () => {
  it("el último publicado que además está cerrado en Lima", () => {
    expect(hastaPorDefecto(PUBLICADOS, "2026-10-14")).toBe("2026-09");
    // Si el mes siguiente ya está publicado pero no cerrado, no cuenta.
    expect(hastaPorDefecto([...PUBLICADOS, "2026-10"], "2026-10-14")).toBe("2026-09");
    expect(hastaPorDefecto([...PUBLICADOS, "2026-10"], "2026-11-02")).toBe("2026-10");
    expect(hastaPorDefecto([], "2026-10-14")).toBeNull();
  });
  it("años del primer mes publicado al de hasta, y meses faltantes", () => {
    expect(aniosDeCorrida(PUBLICADOS, "2026-09")).toEqual([2023, 2024, 2025, 2026]);
    expect(mesesFaltantes(PUBLICADOS.filter((m) => m !== "2024-05"), "2026-09")).toEqual(["2024-05"]);
    expect(mesesFaltantes(PUBLICADOS, "2026-09")).toEqual([]);
  });
});
