import { describe, expect, it } from "vitest";
import { metaDeGM, type FilaParaMeta } from "@/lib/proyeccion/meta-gm";

/**
 * R2 (ficha 07e): `metaDeGM`. `P^GM = propuesto` sin % propio y `round(B^s × (1 + g/100))` con % propio; `bruta` usa `B` y `corregida` `B'`;
 * las filas sin `propuesto` quedan fuera. Sin filas apartadas ni % propio, `Meta_GM = Σ P^M` exacto. Sintético.
 */

const fila = (o: Partial<FilaParaMeta> & { fila_id: string }): FilaParaMeta => ({ propuesto: null, base: null, base_corregida: null, crecimiento_pct: null, ...o });

describe("R2 · metaDeGM", () => {
  it("sin % propio, Meta_GM = Σ propuesto exacto (también con B' de fracción ,5)", () => {
    // B' = 1000,5 y g = 8 %: round(1080,54) = 1081. Sumar propuestos (no recalcular) evita diferencias de redondeo con la Matriz.
    const filas = [
      fila({ fila_id: "a", propuesto: 1081, base: 1000, base_corregida: 1000.5 }),
      fila({ fila_id: "b", propuesto: 541, base: 500, base_corregida: 500.5 }),
      fila({ fila_id: "c", propuesto: 3, base: 3, base_corregida: 2.5 }),
    ];
    const m = metaDeGM({ filas, g: 8, sobre_base: "corregida", fuente: "gm" });
    expect(m.meta_gm).toBe(1081 + 541 + 3);
    expect([...m.p_gm]).toEqual([["a", 1081], ["b", 541], ["c", 3]]);
    expect(m.fuera_base).toEqual({ filas: 0, unidades: 0 });
  });

  it("con % propio recalcula con el % del GM: corregida usa B' y bruta usa B", () => {
    const filas = [fila({ fila_id: "a", propuesto: 9999, base: 8000, base_corregida: 10000, crecimiento_pct: 30 }), fila({ fila_id: "b", propuesto: 500, base: 500, base_corregida: 500 })];
    const corregida = metaDeGM({ filas, g: 8, sobre_base: "corregida", fuente: "gm" });
    expect(corregida.p_gm.get("a")).toBe(10800);
    expect(corregida.meta_gm).toBe(10800 + 500);
    const bruta = metaDeGM({ filas, g: 8, sobre_base: "bruta", fuente: "gm" });
    expect(bruta.p_gm.get("a")).toBe(8640);
    expect(bruta.meta_gm).toBe(8640 + 500);
  });

  it("una fila sin propuesto queda fuera y se cuenta con sus unidades", () => {
    const filas = [
      fila({ fila_id: "a", propuesto: 100, base: 90, base_corregida: 90 }),
      fila({ fila_id: "x", propuesto: null, base: 70, base_corregida: null, vigente: 40 }),
      fila({ fila_id: "y", propuesto: null, vigente: null }),
    ];
    const m = metaDeGM({ filas, g: 5, sobre_base: "corregida", fuente: "resto" });
    expect(m.meta_gm).toBe(100);
    expect(m.p_gm.has("x")).toBe(false);
    expect(m.fuera_base).toEqual({ filas: 2, unidades: 40 });
    expect(m.fuente).toBe("resto");
  });

  it("sin g el GM no tiene meta, pero conserva el propuesto de cada fila", () => {
    const m = metaDeGM({ filas: [fila({ fila_id: "a", propuesto: 100, base: 90, base_corregida: 90, crecimiento_pct: 20 })], g: null, sobre_base: "corregida", fuente: "gm" });
    expect(m.meta_gm).toBeNull();
    expect(m.p_gm.get("a")).toBe(100);
  });

  it("g negativo nunca da una propuesta negativa", () => {
    const m = metaDeGM({ filas: [fila({ fila_id: "a", propuesto: 0, base: 10, base_corregida: 10, crecimiento_pct: 1 })], g: -100, sobre_base: "corregida", fuente: "gm" });
    expect(m.p_gm.get("a")).toBe(0);
  });
});
