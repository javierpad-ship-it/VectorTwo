import { describe, expect, it } from "vitest";
import { mesesDe, motivoTemporadasInvalidas, temporadaDe } from "@/lib/marcas-barrer/temporadas";
import { TEMPORADAS_DEFECTO, type TemporadasConfig } from "@/lib/marcas-barrer/tipos-api";

/** Decisión 31 de Javier: verano oct–mar e invierno abr–sep por defecto, con fechas editables; `temporadaDe` es la única que decide. */

describe("temporadaDe y mesesDe", () => {
  it("por defecto: octubre a marzo es verano y abril a septiembre es invierno", () => {
    for (const m of [10, 11, 12, 1, 2, 3]) expect(temporadaDe(m)).toBe("verano");
    for (const m of [4, 5, 6, 7, 8, 9]) expect(temporadaDe(m)).toBe("invierno");
    expect(mesesDe("verano")).toEqual([1, 2, 3, 10, 11, 12]);
    expect(mesesDe("invierno")).toEqual([4, 5, 6, 7, 8, 9]);
  });
  it("con las fechas editadas (verano nov→abr) abril pasa a verano y octubre a invierno", () => {
    const t: TemporadasConfig = { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } };
    expect(temporadaDe(4, t)).toBe("verano");
    expect(temporadaDe(10, t)).toBe("invierno");
    expect(mesesDe("verano", t)).toEqual([1, 2, 3, 4, 11, 12]);
  });
  it("rechaza temporadas que no cubren los doce meses o que se solapan", () => {
    const hueco: TemporadasConfig = { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 5, hasta_mes: 9 } };
    expect(motivoTemporadasInvalidas(hueco)).toMatch(/doce meses/);
    expect(() => temporadaDe(4, hueco)).toThrow(/doce meses/);
    const solapa: TemporadasConfig = { verano: { desde_mes: 10, hasta_mes: 4 }, invierno: { desde_mes: 4, hasta_mes: 9 } };
    expect(motivoTemporadasInvalidas(solapa)).toMatch(/solapan/);
    expect(() => mesesDe("verano", solapa)).toThrow(/solapan/);
    expect(motivoTemporadasInvalidas({ verano: { desde_mes: 0, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } })).toMatch(/del 1 al 12/);
    expect(motivoTemporadasInvalidas(TEMPORADAS_DEFECTO)).toBeNull();
  });
  it("un mes fuera de 1 a 12 lanza", () => {
    expect(() => temporadaDe(13)).toThrow();
    expect(() => temporadaDe(0)).toThrow();
  });
});
