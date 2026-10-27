import { describe, expect, it } from "vitest";
import { extenderDemanda, fueraDeRango, imi, peorSenal, proyectarFila, senalMes, usaExtension, vpm } from "@/lib/flujo/imi";
import { calcularSerieReferencia } from "./flujo.fixture";
import { DEMANDA_CASO1 } from "./flujo.soporte";

/** Reglas 5 (VPM e IMI), 6 (saldo secuencial y señal), 7 (exceso) y 27 (una sola aritmética) de la ficha 08. */

const cerca = (a: number | null, b: number, d = 1e-9) => expect(Math.abs((a as number) - b)).toBeLessThan(d);
const ext = extenderDemanda(DEMANDA_CASO1, true);
const rango = { imi_min: 4, imi_max: 8 };

describe("VPM e IMI (regla 5)", () => {
  it("VPM de set con los doce meses siguientes [150, 150, 150, 160 × 9] = 157,5 e imi(700) = 4,44", () => {
    const siguientes = [150, 150, 150, ...Array.from({ length: 9 }, () => 160)];
    expect(siguientes).toHaveLength(12);
    cerca(vpm(siguientes, -1), 157.5);
    cerca(imi(700, 157.5), 4.444444444, 1e-6);
    cerca(vpm(ext, -1), 157.5);
  });

  it("el VPM de oct es 158,33 (nov-26 … oct-27) y el de dic-27 repite los últimos doce", () => {
    cerca(vpm(ext, 0), 158.3333333, 1e-6);
    cerca(vpm(ext, 1), 159.1666667, 1e-6);
    cerca(vpm(ext, 14), (160 * 11 + 183) / 12, 1e-9);
  });

  it("imi con stock cero o negativo es 0; sin demanda futura es nulo (sin_demanda)", () => {
    expect(imi(0, 157.5)).toBe(0);
    expect(imi(-10, 157.5)).toBe(0);
    expect(imi(700, 0)).toBeNull();
    expect(vpm([0, 0, 0], -1)).toBe(0);
  });

  it("más allá del horizonte se repite el último año (extendido); con menos de doce meses, la serie en ciclo", () => {
    expect(ext).toHaveLength(15 + 12);
    expect(ext.slice(15)).toEqual(DEMANDA_CASO1.slice(3));
    expect(extenderDemanda([10, 20, 30], true)).toEqual([10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30]);
    expect(extenderDemanda(DEMANDA_CASO1, false)).toEqual(DEMANDA_CASO1);
    expect(usaExtension(2, 15, true)).toBe(false);
    expect(usaExtension(3, 15, true)).toBe(true);
    expect(usaExtension(3, 15, false)).toBe(false);
  });

  it("sin extender, el VPM de los últimos meses promedia los que queden", () => {
    const plana = extenderDemanda(DEMANDA_CASO1, false);
    cerca(vpm(plana, 13), 183, 1e-9);
    expect(vpm(plana, 14)).toBe(0);
  });

  it("fuera_de_rango ⇔ imi < 4 o > 8; sin IMI no hay alerta", () => {
    expect(fueraDeRango(3.9, rango)).toBe(true);
    expect(fueraDeRango(4, rango)).toBe(false);
    expect(fueraDeRango(8, rango)).toBe(false);
    expect(fueraDeRango(8.1, rango)).toBe(true);
    expect(fueraDeRango(null, rango)).toBe(false);
  });
});

describe("saldo secuencial, exceso y señal (reglas 6 y 7)", () => {
  const sinCompras = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, rango });

  it("sin compras: S_oct = 550, imi_oct = 3,47, C_oct = 83,33 y C_nov = 153,33", () => {
    cerca(sinCompras[0].stock, 550);
    cerca(sinCompras[0].imi, 550 / 158.3333333, 1e-6);
    cerca(sinCompras[0].compra, 83.3333333, 1e-6);
    cerca(sinCompras[1].compra, 153.3333333, 1e-6);
  });

  it("con 500 u en nov: C_oct = 83,33, C_nov = C_dic = C_ene = 0, C_feb = 134,33 y C_mar = 160", () => {
    const ingresos = DEMANDA_CASO1.map((_, i) => (i === 1 ? 500 : 0));
    const m = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos, rango });
    cerca(m[0].compra, 83.3333333, 1e-6);
    expect([m[1].compra, m[2].compra, m[3].compra]).toEqual([0, 0, 0]);
    cerca(m[4].compra, 134.3333333, 1e-6);
    cerca(m[5].compra, 160, 1e-9);
    // Σ C = 377,67 («378» al redondear)
    cerca(m.slice(0, 6).reduce((a, x) => a + x.compra, 0), 377.6666667, 1e-6);
    cerca(m[1].stock, 900);
    cerca(m[1].imi, 900 / 159.1666667, 1e-6);
  });

  it("falta ⇔ C > 0: enero tiene imi 3,64 (< 4) pero la sugerencia de octubre ya lo cubre, así que su señal es al_dia", () => {
    const ingresos = DEMANDA_CASO1.map((_, i) => (i === 1 ? 500 : 0));
    const m = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos, rango });
    const ene = m[3];
    cerca(ene.stock, 590);
    expect(ene.imi).toBeLessThan(4);
    expect(ene.compra).toBe(0);
    expect(senalMes({ stock: ene.stock, compra: ene.compra, exceso: ene.exceso })).toBe("al_dia");
    expect(fueraDeRango(imi(ene.stock, ene.vpm), rango)).toBe(true);
    expect(senalMes({ stock: m[0].stock, compra: m[0].compra, exceso: m[0].exceso })).toBe("falta");
  });

  it("propiedad: con las sugerencias, el IMI queda ≥ 4 en todos los meses con demanda", () => {
    for (const stock of [0, 100, 700, 5000]) {
      const m = proyectarFila({ demanda: ext, n: 15, stock_inicial: stock, rango });
      m.forEach((x) => expect(x.stock_con_compras).toBeGreaterThanOrEqual(x.objetivo - 1e-6));
    }
  });

  it("monotonía: añadir un ingreso nunca sube un C_j; mover una entrega de nov a dic sube C_nov y baja C_dic", () => {
    const base = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, rango });
    const con = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos: DEMANDA_CASO1.map((_, i) => (i === 2 ? 300 : 0)), rango });
    con.forEach((x, i) => expect(x.compra).toBeLessThanOrEqual(base[i].compra + 1e-9));
    const nov = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos: DEMANDA_CASO1.map((_, i) => (i === 1 ? 300 : 0)), rango });
    const dic = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos: DEMANDA_CASO1.map((_, i) => (i === 2 ? 300 : 0)), rango });
    expect(dic[1].compra).toBeGreaterThan(nov[1].compra);
    expect(dic[2].compra).toBeLessThan(nov[2].compra);
  });

  it("exceso: 2 000 u en nov dejan S_nov = 2 400, tope_nov = 1 273 y X_nov = 1 127; imi_nov = 15,1", () => {
    const ingresos = DEMANDA_CASO1.map((_, i) => (i === 1 ? 2000 : 0));
    const m = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos, rango });
    cerca(m[1].stock, 2400);
    cerca(m[1].tope, 8 * 159.1666667, 1e-5);
    cerca(m[1].exceso, 1126.6666667, 1e-5);
    cerca(imi(m[1].stock, m[1].vpm), 15.0785, 1e-3);
    expect(senalMes({ stock: m[1].stock, compra: m[1].compra, exceso: m[1].exceso })).toBe("exceso");
  });

  it("quiebre > falta > exceso > al_dia; sin_demanda y sin_curva mandan y van al final", () => {
    expect(senalMes({ stock: -1, compra: 5, exceso: 0 })).toBe("quiebre");
    expect(senalMes({ stock: 10, compra: 5, exceso: 0 })).toBe("falta");
    expect(senalMes({ stock: 10, compra: 0, exceso: 3 })).toBe("exceso");
    expect(senalMes({ stock: 10, compra: 0, exceso: 0 })).toBe("al_dia");
    expect(senalMes({ stock: -1, compra: 5, exceso: 0 }, { sinDemanda: true })).toBe("sin_demanda");
    expect(senalMes({ stock: 10, compra: 0, exceso: 0 }, { sinCurva: true, sinDemanda: true })).toBe("sin_curva");
    expect(peorSenal(["al_dia", "exceso", "falta"])).toBe("falta");
    expect(peorSenal(["al_dia", "sin_demanda"])).toBe("al_dia");
    expect(peorSenal(["quiebre", "falta"])).toBe("quiebre");
    expect(peorSenal(["sin_demanda", "sin_curva"])).toBe("sin_demanda");
  });
});

describe("una sola aritmética (regla 27)", () => {
  it("proyectarFila coincide con las fórmulas de la sección 3 del fixture en S, VPM, C y X", () => {
    const ingresos = DEMANDA_CASO1.map((_, i) => (i === 1 ? 500 : 0));
    const ref = calcularSerieReferencia({ stock_k: 700, demanda: DEMANDA_CASO1, ingresos });
    const m = proyectarFila({ demanda: ext, n: 15, stock_inicial: 700, ingresos, rango });
    m.forEach((x, i) => {
      cerca(x.stock, ref.stock[i]);
      cerca(x.vpm, ref.vpm[i]);
      cerca(x.compra, ref.saldo[i]);
      cerca(x.exceso, ref.exceso[i]);
    });
  });

  it("propiedad: coincide con la referencia en demandas, stocks e ingresos al azar", () => {
    let semilla = 12345;
    const azar = () => {
      semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
      return semilla / 2 ** 32;
    };
    for (let caso = 0; caso < 60; caso++) {
      const n = 1 + Math.floor(azar() * 24);
      const demanda = Array.from({ length: n }, () => Math.round(azar() * 400));
      const ingresos = Array.from({ length: n }, () => (azar() < 0.2 ? Math.round(azar() * 1500) : 0));
      const stock = Math.round(azar() * 3000);
      const ref = calcularSerieReferencia({ stock_k: stock, demanda, ingresos });
      const m = proyectarFila({ demanda: extenderDemanda(demanda, true), n, stock_inicial: stock, ingresos, rango });
      m.forEach((x, i) => {
        cerca(x.stock, ref.stock[i], 1e-6);
        cerca(x.vpm, ref.vpm[i], 1e-9);
        if (demanda.some((d) => d > 0)) {
          cerca(x.compra, ref.saldo[i], 1e-6);
          cerca(x.exceso, ref.exceso[i], 1e-6);
        }
      });
    }
  });
});
