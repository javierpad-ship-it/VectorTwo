import { describe, expect, it } from "vitest";
import { calcularGeometriaCurvas, etiquetaEjeY, lecturaMes, maximoComun, trazoMiniCurva, type SerieGrafico } from "@/lib/curvas/grafico";
import { readFileSync } from "node:fs";
import path from "node:path";

const serie = (clave: string, valores: (number | null)[], extra: Partial<SerieGrafico> = {}): SerieGrafico => ({
  clave,
  etiqueta: clave,
  valores,
  color: "#000",
  ...extra,
});
const plana = Array(12).fill(1 / 12);

describe("calcularGeometriaCurvas", () => {
  it("doce columnas de enero a diciembre dentro del área, con el centro de cada mes como x de los puntos", () => {
    const g = calcularGeometriaCurvas({ modo: "participacion", series: [serie("a", plana)] });
    expect(g.ticksX).toHaveLength(12);
    expect(g.ticksX[0].etiqueta).toBe("Ene");
    expect(g.ticksX[11].etiqueta).toBe("Dic");
    expect(g.ticksX[0].x).toBeGreaterThan(g.area.x);
    expect(g.ticksX[11].x).toBeLessThan(g.area.x + g.area.ancho);
    expect(g.lineas[0].puntos.map((p) => p.x)).toEqual(g.ticksX.map((t) => t.x));
  });
  it("la escala incluye el cero y el máximo, con porcentajes en el eje Y", () => {
    const g = calcularGeometriaCurvas({ modo: "participacion", series: [serie("a", [0.02, 0.24, ...Array(10).fill(0.01)])] });
    expect(g.escala.min).toBe(0);
    expect(g.escala.max).toBeGreaterThanOrEqual(0.24);
    expect(g.ticksY[0].etiqueta).toMatch(/%$/);
    expect(g.ticksY.some((t) => t.valor === 0)).toBe(true);
  });
  it("un valor mayor queda más arriba (y menor)", () => {
    const g = calcularGeometriaCurvas({ modo: "participacion", series: [serie("a", [0.05, 0.2, ...Array(10).fill(0.1)])] });
    const [p0, p1] = g.lineas[0].puntos;
    expect(p1.y).toBeLessThan(p0.y);
  });
  it("los valores null cortan el trazo: un año en curso no llega a diciembre", () => {
    const g = calcularGeometriaCurvas({ modo: "unidades", series: [serie("2026", [10, 20, 30, null, null, null, null, null, null, null, null, null], { trazo: "discontinuo" })] });
    expect(g.lineas[0].puntos).toHaveLength(3);
    expect(g.lineas[0].tramos).toHaveLength(1);
    const hueco = calcularGeometriaCurvas({ modo: "unidades", series: [serie("x", [1, null, 3, ...Array(9).fill(null)])] });
    expect(hueco.lineas[0].tramos).toHaveLength(2);
  });
  it("los meses imputados generan tramos aparte (punteados)", () => {
    const g = calcularGeometriaCurvas({ modo: "participacion", series: [serie("2023", plana, { imputados: [9, 10, 11, 12] })] });
    expect(g.lineas[0].tramosImputados.length).toBe(4);
  });
  it("la banda mínimo-máximo es un polígono cerrado y se incluye en la escala", () => {
    const min = Array(12).fill(0.05);
    const max = Array(12).fill(0.3);
    const g = calcularGeometriaCurvas({ modo: "participacion", series: [serie("a", plana)], banda: { min, max } });
    expect(g.banda).toMatch(/^M.*Z$/);
    expect(g.escala.max).toBeGreaterThanOrEqual(0.3);
    expect(calcularGeometriaCurvas({ modo: "participacion", series: [serie("a", plana)] }).banda).toBeNull();
  });
  it("bandas verticales de meses atípicos y puntos ámbar de liquidación", () => {
    const g = calcularGeometriaCurvas({
      modo: "participacion",
      series: [serie("2025", plana)],
      mesesAtipicos: [3, 4, 5, 5],
      liquidacion: [{ clave: "2025", mes: 12 }, { clave: "no-existe", mes: 1 }],
    });
    expect(g.bandasAtipicas.map((b) => b.mes)).toEqual([3, 4, 5]);
    expect(g.puntosLiquidacion).toHaveLength(1);
    expect(g.puntosLiquidacion[0].x).toBe(g.lineas[0].puntos[11].x);
  });
  it("aria por polilínea y lectura por mes", () => {
    const series = [serie("2024", plana), serie("2025", [null, ...plana.slice(1)])];
    const g = calcularGeometriaCurvas({ modo: "participacion", series });
    expect(g.lineas[0].aria).toContain("Ene");
    expect(lecturaMes(1, series, "participacion")).toContain("2024");
    expect(lecturaMes(1, series, "participacion")).not.toContain("2025");
  });
  it("sin datos no revienta", () => {
    const g = calcularGeometriaCurvas({ modo: "unidades", series: [] });
    expect(g.lineas).toEqual([]);
    expect(g.ticksY.length).toBeGreaterThan(1);
  });
  it("etiquetaEjeY: porcentaje con coma y unidades con separador de miles", () => {
    expect(etiquetaEjeY(0.123, "participacion")).toMatch(/12[.,]3 %/);
    expect(etiquetaEjeY(12345, "unidades")).toMatch(/12.345|12,345|12\s345/);
  });
});

describe("mini curvas", () => {
  it("maximoComun ignora lo nulo y trazoMiniCurva da doce puntos", () => {
    expect(maximoComun([0.1, 0.4], null, undefined, [0.2])).toBe(0.4);
    expect(maximoComun(null)).toBe(0);
    const d = trazoMiniCurva(plana, 100, 30, maximoComun(plana));
    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/[ML]/g)).toHaveLength(12);
    expect(trazoMiniCurva(plana, 100, 30, 0)).toContain(`${30 - 2}`);
  });
});

describe("pureza (regla 31)", () => {
  it("grafico.ts no importa de @supabase/* ni de React", () => {
    const texto = readFileSync(path.resolve(__dirname, "../src/lib/curvas/grafico.ts"), "utf8");
    expect(texto).not.toMatch(/from\s+["'](?:@supabase|react)/);
  });
});
