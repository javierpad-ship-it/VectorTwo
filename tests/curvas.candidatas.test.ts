import { describe, expect, it } from "vitest";
import { calcularCandidatas, curvaA, curvaB, curvaC, curvaD, curvaE, marcarIguales, type AnioAjuste } from "@/lib/curvas/candidatas";
import { MODELOS, MODELOS_PROPIOS } from "@/lib/curvas/tipos-api";
import { normalizarCurva, participacion } from "@/lib/curvas/anios";

const un = (anio: number, meses: number[], tiendas: number[][] = []): AnioAjuste => ({
  anio,
  participacion: participacion(meses)!,
  unidades_total: meses.reduce((s, x) => s + x, 0),
  tiendas,
});
const picoEn = (m: number, grande = 100) => Array.from({ length: 12 }, (_, i) => (i === m ? grande : 0));
const suma = (v: readonly number[]) => v.reduce((s, x) => s + Math.round(x * 1e6), 0);

describe("regla 11 · candidatas", () => {
  it("A con dos años [p, q] = (p + q) / 2", () => {
    const a = curvaA([un(2024, picoEn(0)), un(2025, picoEn(1))])!;
    expect(a[0]).toBeCloseTo(0.5, 6);
    expect(a[1]).toBeCloseTo(0.5, 6);
  });
  it("B con 100 y 300 unidades pesa 1:3", () => {
    const b = curvaB([un(2024, picoEn(0, 100)), un(2025, picoEn(1, 300))])!;
    expect(b[0]).toBeCloseTo(0.25, 6);
    expect(b[1]).toBeCloseTo(0.75, 6);
  });
  it("C pesa 1:2:3 del más antiguo al más reciente (sin importar el orden de entrada)", () => {
    const c = curvaC([un(2025, picoEn(2)), un(2023, picoEn(0)), un(2024, picoEn(1))])!;
    expect(c[0]).toBeCloseTo(1 / 6, 6);
    expect(c[1]).toBeCloseTo(2 / 6, 6);
    expect(c[2]).toBeCloseTo(3 / 6, 6);
  });
  it("D deja plana una curva plana y reparte un pico en 0,25 · 0,5 · 0,25 con diciembre y enero vecinos", () => {
    const plana = curvaD([un(2024, Array(12).fill(10)), un(2025, Array(12).fill(10))])!;
    for (const v of plana) expect(v).toBeCloseTo(1 / 12, 4); // el mes mayor absorbe el redondeo
    const pico = curvaD([un(2024, picoEn(5)), un(2025, picoEn(5))])!;
    expect(pico[4]).toBeCloseTo(0.25, 6);
    expect(pico[5]).toBeCloseTo(0.5, 6);
    expect(pico[6]).toBeCloseTo(0.25, 6);
    const enero = curvaD([un(2024, picoEn(0)), un(2025, picoEn(0))])!;
    expect(enero[11]).toBeCloseTo(0.25, 6);
    expect(enero[0]).toBeCloseTo(0.5, 6);
    expect(enero[1]).toBeCloseTo(0.25, 6);
  });
  it("E con dos tiendas de formas distintas es la media simple (E ≠ B)", () => {
    const tiendas = [picoEn(0, 100), picoEn(6, 900)];
    const anios = [un(2024, picoEn(0, 100).map((x, i) => x + picoEn(6, 900)[i]), tiendas), un(2025, picoEn(0, 100).map((x, i) => x + picoEn(6, 900)[i]), tiendas)];
    const e = curvaE(anios, 50)!;
    expect(e[0]).toBeCloseTo(0.5, 6);
    expect(e[6]).toBeCloseTo(0.5, 6);
    const b = curvaB(anios)!;
    expect(b[6]).toBeCloseTo(0.9, 6);
    expect(e[6]).not.toBeCloseTo(b[6], 2);
  });
  it("E ignora la tienda bajo min_unidades_ano y es null (sin_tiendas_validas) si ninguna llega", () => {
    const tiendas = [picoEn(0, 100), picoEn(6, 900)];
    const anio = (n: number) => un(n, picoEn(0, 100).map((x, i) => x + picoEn(6, 900)[i]), tiendas);
    const e = curvaE([anio(2024), anio(2025)], 120)!;
    expect(e[6]).toBeCloseTo(1, 6);
    expect(curvaE([anio(2024), anio(2025)], 5000)).toBeNull();
    const todas = calcularCandidatas([anio(2024), anio(2025)], 5000);
    expect(todas.find((c) => c.modelo === "E")).toMatchObject({ curva: null, motivo: "sin_tiendas_validas" });
  });
  it("cada candidata devuelve una curva que suma exactamente 1", () => {
    const anios = [un(2023, [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41], [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]), un(2024, [41, 37, 31, 29, 23, 19, 17, 13, 11, 7, 5, 3], [[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]])];
    for (const c of calcularCandidatas(anios, 1)) {
      expect(c.curva).not.toBeNull();
      expect(suma(c.curva!)).toBe(1_000_000);
    }
  });
  it("las candidatas solo ven los años que reciben: un año distinto mueve A (la exclusión de escasos es de quien llama)", () => {
    const base = [un(2024, picoEn(0)), un(2025, picoEn(0))];
    const conExtra = [...base, un(2026, picoEn(5))];
    expect(curvaA(base)![5]).toBe(0);
    expect(curvaA(conExtra)![5]).toBeGreaterThan(0.3);
  });
});

describe("regla 12 · catálogo MODELOS", () => {
  it("A, B, C, D, E en ese orden y T marcada prestada; nombres y descripciones no vacíos", () => {
    expect(MODELOS.map((m) => m.codigo)).toEqual(["A", "B", "C", "D", "E", "T"]);
    expect(MODELOS.filter((m) => m.prestada).map((m) => m.codigo)).toEqual(["T"]);
    for (const m of MODELOS) {
      expect(m.nombre.trim()).not.toBe("");
      expect(m.descripcion.trim()).not.toBe("");
    }
    expect(MODELOS_PROPIOS).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("regla 12b · marcarIguales", () => {
  it("una curva idéntica a otra anterior recibe igual_a; D no", () => {
    const anios = [un(2024, [10, 20, 30, 40, 50, 60, 50, 40, 30, 20, 10, 5]), un(2025, [10, 20, 30, 40, 50, 60, 50, 40, 30, 20, 10, 5])];
    const crudas = calcularCandidatas(anios, 1);
    const iguales = marcarIguales(crudas);
    // Mismas dos curvas: A = B = C. E (sin tiendas) es null.
    expect(iguales.get("B")).toBe("A");
    expect(iguales.get("C")).toBe("A");
    expect(iguales.has("D")).toBe(false);
    expect(iguales.has("A")).toBe(false);
  });
  it("la que repite a una anterior apunta a la primera del orden; las null no participan", () => {
    const a = normalizarCurva(Array(12).fill(1));
    const iguales = marcarIguales([
      { modelo: "A", curva: a },
      { modelo: "B", curva: null },
      { modelo: "C", curva: a },
      { modelo: "D", curva: a },
    ]);
    expect(iguales.get("C")).toBe("A");
    expect(iguales.get("D")).toBe("A");
  });
});
