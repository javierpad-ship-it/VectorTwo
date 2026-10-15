import { describe, expect, it } from "vitest";
import {
  backtest,
  corrimientoCircular,
  eat,
  errorMax,
  mesMayor,
  pliegues,
  promediarPliegues,
  validacionParcial,
} from "@/lib/curvas/backtesting";
import { MIN_MESES_VALIDACION_PARCIAL } from "@/lib/curvas/tipos-api";

const plana = Array(12).fill(1 / 12);
const unoSolo = (m: number) => Array.from({ length: 12 }, (_, i) => (i === m ? 1 : 0));

describe("regla 13 · eat y errorMax", () => {
  it("curvas iguales → 0; sin ningún mes en común → 200", () => {
    expect(eat(plana, plana)).toBe(0);
    expect(eat(unoSolo(0), unoSolo(1))).toBe(200);
  });
  it("errorMax es la mayor diferencia mensual, en puntos", () => {
    expect(errorMax(unoSolo(0), unoSolo(1))).toBe(100);
    expect(errorMax(plana, plana)).toBe(0);
  });
});

describe("regla 14 · pliegues", () => {
  it("n años de ajuste dan n pliegues con n − 1 años de entrenamiento y sin el año de prueba", () => {
    const p = pliegues([2025, 2023, 2024]);
    expect(p.map((x) => x.prueba)).toEqual([2023, 2024, 2025]);
    for (const x of p) {
      expect(x.entrenamiento).toHaveLength(2);
      expect(x.entrenamiento).not.toContain(x.prueba);
    }
  });
  it("con un año (o ninguno) no hay pliegues", () => {
    expect(pliegues([2024])).toEqual([]);
    expect(pliegues([])).toEqual([]);
  });
  it("eat es el promedio de los pliegues (20 y 30 → 25) y se guarda la EAT por pliegue", () => {
    const m = promediarPliegues([
      { anio: 2024, eat: 20, error_max: 4 },
      { anio: 2025, eat: 30, error_max: 8 },
    ]);
    expect(m).toEqual({ eat: 25, error_max: 6 });
    expect(promediarPliegues([])).toBeNull();
  });
});

describe("regla 15 · backtest", () => {
  it("el real de cada pliegue es la participación del año de prueba; se omiten los pliegues sin curva", () => {
    const reales: Record<number, number[]> = { 2023: unoSolo(0), 2024: unoSolo(1), 2025: unoSolo(1) };
    const r = backtest(
      [2023, 2024, 2025],
      (entrenamiento) => (entrenamiento.length === 2 ? unoSolo(1) : null),
      (anio) => reales[anio]
    );
    expect(r.map((x) => [x.anio, x.eat])).toEqual([
      [2023, 200],
      [2024, 0],
      [2025, 0],
    ]);
    expect(backtest([2023, 2024], () => null, (a) => reales[a])).toEqual([]);
  });
});

describe("regla 16 · validacionParcial", () => {
  const publicados = (k: number) => Array.from({ length: 12 }, (_, m) => m < k);
  const meses = (k: number, v = 10) => Array.from({ length: 12 }, (_, m) => (m < k ? v : 0));
  it("con k − |A| < 6 meses útiles → null", () => {
    expect(MIN_MESES_VALIDACION_PARCIAL).toBe(6);
    expect(validacionParcial(plana, { anio: 2026, meses: meses(9), publicados: publicados(9) }, ["2026-01", "2026-02", "2026-03", "2026-04"])).toBeNull();
    expect(validacionParcial(plana, { anio: 2026, meses: meses(5), publicados: publicados(5) }, [])).toBeNull();
  });
  it("renormaliza la curva a los meses útiles: curva plana contra un año plano → 0", () => {
    expect(validacionParcial(plana, { anio: 2026, meses: meses(9), publicados: publicados(9) }, [])).toBeCloseTo(0, 9);
  });
  it("excluye los atípicos: 9 cargados menos setiembre = 8 útiles", () => {
    const v = validacionParcial(plana, { anio: 2026, meses: meses(9), publicados: publicados(9) }, ["2026-09"]);
    expect(v).toBeCloseTo(0, 9);
  });
});

describe("utilidades de círculo", () => {
  it("corrimientoCircular: negativo = se adelanta; envuelve enero y diciembre", () => {
    expect(corrimientoCircular(5, 6)).toBe(-1);
    expect(corrimientoCircular(12, 1)).toBe(-1);
    expect(corrimientoCircular(1, 12)).toBe(1);
    expect(corrimientoCircular(7, 1)).toBe(-6);
    expect(corrimientoCircular(4, 4)).toBe(0);
  });
  it("mesMayor (1 a 12) con máscara opcional", () => {
    expect(mesMayor(unoSolo(4))).toBe(5);
    expect(mesMayor([5, 9, 1], [true, false, true])).toBe(1);
  });
});
