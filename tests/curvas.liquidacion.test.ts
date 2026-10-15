import { describe, expect, it } from "vitest";
import { cvMensual, mesesEnLiquidacion } from "@/lib/curvas/liquidacion";

const mes = (i: number) => `2025-${String(i + 1).padStart(2, "0")}`;
const serie = (cvs: (number | null)[]) => cvs.map((cv, i) => ({ periodo: mes(i), cv }));

describe("regla 10 · cvMensual", () => {
  it("costo ÷ venta a cuatro decimales; venta 0 (o negativa) → null", () => {
    expect(cvMensual(300, 100)).toBe(0.3333);
    expect(cvMensual(0, 50)).toBeNull();
    expect(cvMensual(-10, 5)).toBeNull();
  });
});

describe("regla 9 · mesesEnLiquidacion", () => {
  const doce = (extra: Record<number, number | null> = {}) => serie(Array.from({ length: 12 }, (_, i) => (i in extra ? extra[i] : 0.5)));
  it("marca el mes cuyo CV supera la mediana en más del umbral relativo (caso 6: diciembre)", () => {
    expect(mesesEnLiquidacion(doce({ 11: 0.7 }), [], 0.15)).toEqual(["2025-12"]);
  });
  it("0,70 no supera 0,5 × 1,5 = 0,75", () => {
    expect(mesesEnLiquidacion(doce({ 11: 0.7 }), [], 0.5)).toEqual([]);
  });
  it("la mediana se calcula sobre los meses no atípicos", () => {
    const cvs = serie([0.9, 0.9, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    // Con los tres primeros atípicos fuera, la mediana es 0,5 y los atípicos (0,9) quedan marcados igual.
    expect(mesesEnLiquidacion(cvs, ["2025-01", "2025-02", "2025-03"], 0.15)).toEqual(["2025-01", "2025-02", "2025-03"]);
    // Sin excluirlos, la mediana sigue en 0,5 (nueve de doce): también se marcan.
    expect(mesesEnLiquidacion(cvs, [], 0.15)).toHaveLength(3);
  });
  it("con menos de tres meses válidos no marca nada; los CV nulos no cuentan", () => {
    expect(mesesEnLiquidacion(serie([0.5, 0.9]), [], 0.15)).toEqual([]);
    expect(mesesEnLiquidacion(serie([null, null, 0.5, 0.5, 0.9]), [], 0.15)).toEqual(["2025-05"]);
  });
});
