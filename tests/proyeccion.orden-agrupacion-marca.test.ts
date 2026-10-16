import { describe, expect, it } from "vitest";
import { compararAgrupacionMarca } from "@/lib/proyeccion/matriz";
import { ordenMarcaDe } from "@/lib/proyeccion/persistencia";

/** Las agrupaciones de marca salen PREMIUM → ULTRA LOW según `orden`; sin orden, por nombre. */

const f = (agrupacion_marca: string, agrupacion_marca_orden?: number) => ({ agrupacion_marca, agrupacion_marca_orden });

describe("compararAgrupacionMarca", () => {
  it("ordena por el orden del catálogo, no por nombre", () => {
    const filas = [f("ULTRA LOW", 50), f("MID VALUE", 40), f("PREMIUM", 10), f("VALOR", 30), f("RECONOCIDO", 20)];
    expect(filas.sort(compararAgrupacionMarca).map((x) => x.agrupacion_marca)).toEqual(["PREMIUM", "RECONOCIDO", "VALOR", "MID VALUE", "ULTRA LOW"]);
  });
  it("sin orden cae al nombre, y las que no tienen orden van después de las que sí", () => {
    expect([f("B"), f("A")].sort(compararAgrupacionMarca).map((x) => x.agrupacion_marca)).toEqual(["A", "B"]);
    expect([f("A"), f("Z", 10)].sort(compararAgrupacionMarca).map((x) => x.agrupacion_marca)).toEqual(["Z", "A"]);
  });
});

describe("ordenMarcaDe", () => {
  it("lee el orden del catálogo y manda al final lo desconocido", () => {
    const c = { ordenAgrupacionesMarca: new Map([["p", 10]]) };
    expect(ordenMarcaDe("p", c)).toBe(10);
    expect(ordenMarcaDe("x", c)).toBe(Number.MAX_SAFE_INTEGER);
    expect(ordenMarcaDe("x", {})).toBe(Number.MAX_SAFE_INTEGER);
  });
});
