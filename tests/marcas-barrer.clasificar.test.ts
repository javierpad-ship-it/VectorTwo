import { describe, expect, it } from "vitest";
import { clasificarHechos, restoDelGml } from "@/lib/marcas-barrer/clasificar";
import { claveG } from "@/lib/marcas-barrer/tipos";
import { CLAVE, EQ, MARCA, NODO, OTROS, configB, estadoB, hechosBeta, hechosGamma, ventaDe } from "./marcas-barrer.fixture";

/** Reglas 1 y 2 de la ficha 12: universo y partición `u + e + resto = U`. */

const suma = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("clasificarHechos · BETA al barrer (caso 1)", () => {
  const v = ventaDe(hechosBeta(), OTROS);
  const { series, omitidos } = clasificarHechos(v.hechos, v.totales, configB(), MARCA.beta);

  it("u por g: DENIM 2 400, POLO 1 200, SANDALIA 480 (con BETA UNO ya sumada en la cabeza) y los nueve pequeños 290", () => {
    expect(suma(series.get(CLAVE.denim)!.u)).toBe(2400);
    expect(suma(series.get(CLAVE.polo)!.u)).toBe(1200);
    expect(suma(series.get(CLAVE.sandalia)!.u)).toBe(480);
    const pequenos = [...CLAVE.c, ...CLAVE.u].reduce((a, c) => a + suma(series.get(c)!.u), 0);
    expect(pequenos).toBe(290);
    expect(omitidos).toBe(0);
  });
  it("toda la venta de una barrido es parte al barrer: e = 0", () => {
    for (const s of series.values()) expect(suma(s.e)).toBe(0);
  });
  it("partición: u + e + resto = U en cada (g, mes) y U nunca queda por debajo de lo que vendió la marca", () => {
    for (const s of series.values()) {
      for (const mes of s.u.keys()) {
        expect((s.u.get(mes) ?? 0) + (s.e.get(mes) ?? 0) + restoDelGml(s, mes)).toBe(s.U.get(mes));
        expect(restoDelGml(s, mes)).toBeGreaterThanOrEqual(0);
      }
    }
    // DENIM: 100 de BETA y 900 de las demás marcas cada mes.
    expect(series.get(CLAVE.denim)!.U.get("2025-03")).toBe(1000);
    expect(restoDelGml(series.get(CLAVE.denim)!, "2025-03")).toBe(900);
  });
  it("los hechos de otra unidad de marca no cuentan (la función SQL puede devolver varias a la vez)", () => {
    const mezcla = ventaDe([...hechosBeta(), ...hechosGamma()], OTROS);
    const solo = clasificarHechos(mezcla.hechos, mezcla.totales, configB(), MARCA.beta).series;
    expect(suma(solo.get(CLAVE.denim)!.u)).toBe(2400);
    expect(solo.has(CLAVE.camisaLarga)).toBe(false);
  });
});

describe("clasificarHechos · GAMMA mixta (caso 7)", () => {
  const v = ventaDe(hechosGamma(), OTROS);
  const { series } = clasificarHechos(v.hechos, v.totales, configB(), MARCA.gamma);

  it("CAMISA › MANGA LARGA (relevante) es parte específica e; DENIM (no relevante) es parte al barrer u", () => {
    const camisa = series.get(CLAVE.camisaLarga)!;
    expect(suma(camisa.e)).toBe(960);
    expect(suma(camisa.u)).toBe(0);
    const denim = series.get(CLAVE.denim)!;
    expect(suma(denim.u)).toBe(1440);
    expect(suma(denim.e)).toBe(0);
  });
  it("sin la asignación de GAMMA a CAMISA, esa venta pasa a la parte al barrer", () => {
    const sinGml = configB(estadoB({ asignaciones: [] }));
    const s = clasificarHechos(v.hechos, v.totales, sinGml, MARCA.gamma).series;
    expect(suma(s.get(CLAVE.camisaLarga)!.u)).toBe(960);
    expect(suma(s.get(CLAVE.camisaLarga)!.e)).toBe(0);
  });
  it("un hecho de un nodo GMLE sin equivalencia conocida se omite sin romper", () => {
    const r = clasificarHechos(
      [{ unidad_marca_id: MARCA.gamma, gml_id: "nodo-desconocido", equivalencia_id: null, periodo: "2025-01-01", unidades: 5 }],
      [],
      configB(),
      MARCA.gamma
    );
    expect(r.omitidos).toBe(1);
    expect(r.series.size).toBe(0);
  });
  it("la clave de una g de un nodo GMLE lleva la equivalencia; la de un GML no", () => {
    expect(claveG(NODO.camisa, EQ.camisaLarga)).toBe(CLAVE.camisaLarga);
    expect(CLAVE.denim.endsWith("|")).toBe(true);
  });
});
