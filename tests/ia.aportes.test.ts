import { describe, expect, it } from "vitest";
import { aporteSalientesFila, aportesDeFila, senalesTiendas } from "@/lib/ia/aportes";
import { proponerSiguiente } from "@/lib/proyeccion/siguiente";

/** R8 (ficha 07e): aportes de tiendas (ejemplo I). `entrantes − salientes = B − vigente_Y` y la señal desde el 10 %. */

describe("R8 · ejemplo I", () => {
  it("aporte_salientes = 400, B = 9 600 y aporte_entrantes = 2 200", () => {
    const salientes = aporteSalientesFila({ cierreBase: 8000, vendidoBase: 6000, salientes: [{ vendido: 300 }] });
    expect(salientes).toBe(400);
    const a = aportesDeFila({ base: 9600, vigenteY: 7800, salientes });
    expect(a).toEqual({ entrantes: 2200, salientes: 400, base_truncada: false });
    expect(a.entrantes - a.salientes).toBe(9600 - 7800);
  });

  it("la identidad vale con el método real: `proponerSiguiente` con entrantes y salientes", () => {
    const factores = Array.from({ length: 12 }, () => 1);
    const curva = Array.from({ length: 12 }, () => 1 / 12);
    const casos: { vigente: number; entran: number[]; salen: number[] }[] = [
      { vigente: 7800, entran: [2200], salen: [400] },
      { vigente: 5000, entran: [], salen: [] },
      { vigente: 5000, entran: [100, 250], salen: [50] },
      { vigente: 12000, entran: [0], salen: [900, 40] },
    ];
    for (const c of casos) {
      const r = proponerSiguiente({
        baseVigente: c.vigente,
        mesesBase: factores.map(() => c.vigente / 12),
        aportesTiendas: [...c.entran.map((t) => ({ signo: 1 as const, total: t, meses: null })), ...c.salen.map((t) => ({ signo: -1 as const, total: t, meses: null }))],
        factoresMesEnCurso: factores,
        crecimiento: 8,
        curva,
        factoresMesObjetivo: factores,
      });
      const salientes = c.salen.reduce((x, y) => x + y, 0);
      const a = aportesDeFila({ base: r.base ?? 0, vigenteY: c.vigente, salientes });
      expect(a.entrantes).toBe(c.entran.reduce((x, y) => x + y, 0));
      expect(a.entrantes - a.salientes).toBe((r.base ?? 0) - c.vigente);
    }
  });

  it("con B truncada en 0 por el max(0, …), los entrantes son 0 y se avisa que la identidad no vale", () => {
    expect(aportesDeFila({ base: 0, vigenteY: 1000, salientes: 1500 })).toEqual({ entrantes: 0, salientes: 1500, base_truncada: true });
    expect(aportesDeFila({ base: 0, vigenteY: 1000, salientes: 1000 }).base_truncada).toBe(false);
  });

  it("sin cierre de la fila o sin vendido, una tienda que sale aporta 0", () => {
    expect(aporteSalientesFila({ cierreBase: null, vendidoBase: 6000, salientes: [{ vendido: 300 }] })).toBe(0);
    expect(aporteSalientesFila({ cierreBase: 8000, vendidoBase: 0, salientes: [{ vendido: 300 }] })).toBe(0);
  });

  it("señal tiendas_entrantes desde el 10 % de B (2 200 ≥ 10 % de 9 600) y tiendas_salientes igual", () => {
    expect(senalesTiendas({ entrantes: 2200, salientes: 400 }, 9600)).toEqual(["tiendas_entrantes"]);
    expect(senalesTiendas({ entrantes: 960, salientes: 960 }, 9600)).toEqual(["tiendas_entrantes", "tiendas_salientes"]);
    expect(senalesTiendas({ entrantes: 959, salientes: 959 }, 9600)).toEqual([]);
    expect(senalesTiendas({ entrantes: 5, salientes: 0 }, 0)).toEqual([]);
    expect(senalesTiendas({ entrantes: 5, salientes: 0 }, null)).toEqual([]);
  });
});
