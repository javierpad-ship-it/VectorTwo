import { describe, expect, it } from "vitest";
import { leerUnidades, pctParaObjetivo } from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/vista";

describe("objetivo a mano en Aprobar (género × mundo)", () => {
  it("lee unidades con o sin separadores de miles", () => {
    expect(leerUnidades("64719")).toBe(64719);
    expect(leerUnidades("64 719")).toBe(64719);
    expect(leerUnidades("64,719")).toBe(64719);
    expect(leerUnidades("64.719")).toBe(64719);
    expect(leerUnidades("1 234 567")).toBe(1234567);
    expect(leerUnidades(" 65000 ")).toBe(65000);
  });

  it("un solo separador con uno o dos decimales es decimal", () => {
    expect(leerUnidades("64,5")).toBe(64.5);
    expect(leerUnidades("64.25")).toBe(64.25);
  });

  it("rechaza lo que no es un número mayor que cero", () => {
    for (const t of ["", "  ", "abc", "0", "-5", "12a", "1,2,3", "64 7190000x"]) expect(leerUnidades(t)).toBeNull();
  });

  it("el crecimiento necesario es objetivo ÷ base corregida − 1", () => {
    expect(pctParaObjetivo(65000, { corregida: 50000 })).toBeCloseTo(30, 10);
    expect(pctParaObjetivo(45000, { corregida: 50000 })).toBeCloseTo(-10, 10);
    expect(pctParaObjetivo(50000, { corregida: 50000 })).toBe(0);
  });

  it("sin objetivo o sin base (o base cero) no hay crecimiento", () => {
    expect(pctParaObjetivo(null, { corregida: 50000 })).toBeNull();
    expect(pctParaObjetivo(65000, null)).toBeNull();
    expect(pctParaObjetivo(65000, { corregida: 0 })).toBeNull();
  });
});
