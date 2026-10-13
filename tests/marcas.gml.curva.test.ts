import { describe, expect, it } from "vitest";
import { curvaUnidad } from "@/lib/marcas/gml/curva";
import { EQUIVALENCIAS } from "./marcas.gml.fixture";

/** Regla 13 y caso 7 de 02b: la curva de una unidad a partir de las curvas vigentes de M6. */

const S1 = [0.05, 0.05, 0.05, 0.08, 0.1, 0.1, 0.12, 0.12, 0.1, 0.1, 0.08, 0.05];
const S2 = [0.3, 0.2, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.04, 0.03, 0.03];
const suma = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);
const curvas = new Map<string, readonly number[]>([
  ["s1", S1],
  ["s2", S2],
]);
const delNodo = (nodo: string) => EQUIVALENCIAS.filter((e) => e.genero_mundo_linea_id === nodo);
const pesosN1 = new Map([
  ["e1a", 700],
  ["e1b", 100],
]);

describe("curvaUnidad", () => {
  it("las curvas del fixture suman 1 y son distintas", () => {
    expect(suma(S1)).toBeCloseTo(1, 12);
    expect(suma(S2)).toBeCloseTo(1, 12);
    expect(S1).not.toEqual(S2);
  });

  it("GMLE → la curva vigente de la agrupación de su equivalencia", () => {
    const r = curvaUnidad({ nivel: "GMLE", equivalencia_id: "e2a" }, delNodo("n2"), curvas, new Map());
    expect(r.curva).toEqual(S1);
    expect(r.avisos).toEqual([]);
    expect(curvaUnidad({ nivel: "GMLE", equivalencia_id: "e1b" }, delNodo("n1"), curvas, new Map()).curva).toEqual(S2);
  });

  it("GMLE sin curva para su agrupación → null", () => {
    expect(curvaUnidad({ nivel: "GMLE", equivalencia_id: "e1b" }, delNodo("n1"), new Map([["s1", S1]]), new Map()).curva).toBeNull();
    expect(curvaUnidad({ nivel: "GMLE", equivalencia_id: "no-existe" }, delNodo("n1"), curvas, new Map()).curva).toBeNull();
  });

  it("GML con todas las equivalencias en la misma agrupación → esa curva exacta", () => {
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n2"), curvas, new Map([["e2a", 30], ["e2b", 70]]));
    expect(r.curva).toEqual(S1);
    expect(r.avisos).toEqual([]);
  });

  it("caso 7: pesos E1a 700/800 y E1b 100/800 → 0,875·S1 + 0,125·S2, que suma 1", () => {
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), curvas, pesosN1);
    expect(r.avisos).toEqual([]);
    expect(r.curva).not.toBeNull();
    const curva = r.curva as number[];
    curva.forEach((x, m) => expect(x).toBeCloseTo(0.875 * S1[m] + 0.125 * S2[m], 12));
    expect(suma(curva)).toBeCloseTo(1, 12);
  });

  it("los pesos se renormalizan: no importa la escala (700/100 = 0,875/0,125)", () => {
    const a = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), curvas, pesosN1).curva as number[];
    const b = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), curvas, new Map([["e1a", 0.875], ["e1b", 0.125]])).curva as number[];
    a.forEach((x, m) => expect(x).toBeCloseTo(b[m], 12));
  });

  it("una equivalencia con venta y sin curva → curva_incompleta y la mezcla sale de las que sí tienen (S1)", () => {
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), new Map([["s1", S1]]), pesosN1);
    expect(r.avisos).toEqual(["curva_incompleta"]);
    expect(r.curva).toEqual(S1);
  });

  it("una equivalencia sin venta (peso 0) y sin curva no avisa", () => {
    const sinCurva = [{ id: "e1a", agrupacion_estacionalidad_id: "s1" }, { id: "e1x", agrupacion_estacionalidad_id: null }];
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, sinCurva, curvas, new Map([["e1a", 10], ["e1x", 0]]));
    expect(r.avisos).toEqual([]);
    expect(r.curva).toEqual(S1);
  });

  it("sin ninguna curva → null (con aviso si había venta)", () => {
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), new Map(), pesosN1);
    expect(r.curva).toBeNull();
    expect(r.avisos).toEqual(["curva_incompleta"]);
    expect(curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n1"), curvas, new Map()).curva).toBeNull();
  });

  it("no muta las curvas de entrada", () => {
    const copia = [...S1];
    const r = curvaUnidad({ nivel: "GML", equivalencia_id: null }, delNodo("n2"), curvas, new Map([["e2a", 1]]));
    (r.curva as number[])[0] = 99;
    expect(S1).toEqual(copia);
  });
});
