import { describe, expect, it } from "vitest";
import { pctDirectoObservado, subflujoIntercompany, type EntradaSubflujo } from "@/lib/intercompany/subflujo";

/** Regla 5 y caso 3 de la ficha 13: el subflujo de JH en CAMISA › M. LARGA × RECONOCIDO (D = 1 200, part = 0,40). */

const plana = (n: number, d = 1200) => Array.from({ length: n }, () => d);
const entrada = (extra: Partial<EntradaSubflujo> = {}): EntradaSubflujo => ({
  // 24 meses de demanda: 12 proyectados más los 12 del horizonte del VPM.
  demanda: plana(24),
  parte: 0.4,
  stock_inicial: 900,
  regla: { imi_min: 4, imi_max: 8, pct_directo: 80 },
  meses: 12,
  ...extra,
});

describe("regla 5: subflujo intercompany", () => {
  it("D = 1 200, part 0,40, 80 %, 4–8, S = 900, sin ingresos → D^B 480, R^B 384, S 804, VPM 480, imi 1,675, objetivo 1 920, compra 1 116, falta", () => {
    const m = subflujoIntercompany(entrada())[0];
    expect(m.demanda).toBe(480);
    expect(m.reposicion_directa).toBe(384);
    expect(m.stock).toBe(804);
    expect(m.vpm).toBe(480);
    expect(m.imi).toBeCloseTo(1.675, 9);
    expect(m.objetivo).toBe(1920);
    expect(m.tope).toBe(3840);
    expect(m.compra).toBe(1116);
    expect(m.stock_con_compras).toBe(1920);
    expect(m.exceso).toBe(0);
    expect(m.senal).toBe("falta");
  });

  it("con la regla editada a 2–4: objetivo 960 y compra 156", () => {
    const m = subflujoIntercompany(entrada({ regla: { imi_min: 2, imi_max: 4, pct_directo: 80 } }))[0];
    expect(m.objetivo).toBe(960);
    expect(m.tope).toBe(1920);
    expect(m.compra).toBe(156);
  });

  it("con pct = 0 no hay reposición directa y la compra sube; con 100 % la reposición iguala a la demanda", () => {
    const cero = subflujoIntercompany(entrada({ regla: { imi_min: 4, imi_max: 8, pct_directo: 0 } }))[0];
    expect(cero.reposicion_directa).toBe(0);
    expect(cero.stock).toBe(420);
    expect(cero.compra).toBe(1920 - 420);
    expect(cero.compra).toBeGreaterThan(1116);
    const cien = subflujoIntercompany(entrada({ regla: { imi_min: 4, imi_max: 8, pct_directo: 100 } }))[0];
    expect(cien.reposicion_directa).toBe(cien.demanda);
    expect(cien.stock).toBe(900);
  });

  it("propiedad: R^B ≤ D^B en todos los meses y para cualquier porcentaje de 0 a 100", () => {
    const demanda = [300, 0, 1200, 450, 80, 999, 0, 10, 700, 650, 20, 1500, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400];
    for (const pct of [0, 0.5, 33.33, 80, 99.99, 100]) {
      for (const m of subflujoIntercompany({ demanda, parte: 0.37, stock_inicial: 500, regla: { imi_min: 4, imi_max: 8, pct_directo: pct }, meses: 12 })) {
        expect(m.reposicion_directa).toBeLessThanOrEqual(m.demanda + 1e-9);
      }
    }
  });

  it("un ingreso (entrega de una línea de M9, p. ej. intercompany_directo) cuenta: el stock es completo y la compra baja", () => {
    const sin = subflujoIntercompany(entrada());
    const ingresos = Array.from({ length: 12 }, (_, i) => (i === 1 ? 300 : 0));
    const con = subflujoIntercompany(entrada({ ingresos }));
    expect(con[0].compra).toBe(sin[0].compra);
    expect(con[1].ingresos).toBe(300);
    expect(con[1].stock).toBe(sin[1].stock + 300);
    expect(con[1].compra).toBeLessThan(sin[1].compra);
  });

  it("la compra es secuencial: el stock con compras de un mes es la base del siguiente", () => {
    const m = subflujoIntercompany(entrada());
    // Mes 2: el stock llega a 1 920 con la compra; vuelve a faltar lo que se vendió menos lo repuesto (480 − 384 = 96).
    expect(m[1].compra).toBeCloseTo(96, 9);
    expect(m[1].stock_con_compras).toBeCloseTo(1920, 9);
    // El stock sin compras sigue bajando 96 al mes.
    expect(m[1].stock).toBeCloseTo(804 - 96, 9);
  });

  it("señales: ok dentro del rango, exceso sobre el tope, y exceso medido sobre el stock sin compras", () => {
    const ok = subflujoIntercompany(entrada({ stock_inicial: 2400 }))[0];
    expect(ok.imi).toBeCloseTo((2400 - 96) / 480, 9);
    expect(ok.senal).toBe("ok");
    expect(ok.compra).toBe(0);
    const exceso = subflujoIntercompany(entrada({ stock_inicial: 5000 }))[0];
    expect(exceso.senal).toBe("exceso");
    expect(exceso.exceso).toBeCloseTo(5000 - 96 - 3840, 9);
  });

  it("sin demanda futura el imi es null (señal sin_demanda) y no hay objetivo", () => {
    const m = subflujoIntercompany({ demanda: [100, 0, 0], parte: 0.4, stock_inicial: 50, regla: { imi_min: 4, imi_max: 8, pct_directo: 80 } });
    expect(m[1].imi).toBeNull();
    expect(m[1].senal).toBe("sin_demanda");
    expect(m[1].objetivo).toBe(0);
  });

  it("regla 8: determinista (misma entrada, misma salida) y no muta la entrada", () => {
    const e = entrada();
    const copia = JSON.stringify(e);
    expect(subflujoIntercompany(e)).toEqual(subflujoIntercompany(e));
    expect(JSON.stringify(e)).toBe(copia);
  });

  it("la demanda del resto de la fila (720) no entra: el subflujo solo trabaja con D × part_B", () => {
    expect(subflujoIntercompany(entrada())[0].demanda).toBe(1200 * 0.4);
    expect(1200 - 480).toBe(720);
  });
});

describe("regla 7: % directo observado", () => {
  it("max(0, Ing − R) ÷ V; null sin venta", () => {
    expect(pctDirectoObservado(384, 0, 480)).toBeCloseTo(0.8, 12);
    expect(pctDirectoObservado(384, 384, 480)).toBe(0);
    expect(pctDirectoObservado(100, 384, 480)).toBe(0);
    expect(pctDirectoObservado(384, 0, 0)).toBeNull();
  });
  it("la conciliación del caso 3 (stock ago 996, set 900, venta 480) da Ing 384 y 80 %", () => {
    const ing = 900 - 996 + 480;
    expect(ing).toBe(384);
    expect(pctDirectoObservado(ing, 0, 480)).toBeCloseTo(0.8, 12);
  });
});
