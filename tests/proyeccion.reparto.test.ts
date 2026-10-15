import { describe, expect, it } from "vitest";
import { repartirEntero, repartirResto } from "@/lib/proyeccion/reparto";
import { CURVA_PLANA, CURVA_VERANO } from "./proyeccion.fixture";

const suma = (x: readonly number[]) => x.reduce((a, b) => a + b, 0);

describe("reparto entero (reglas 15 y 16)", () => {
  it("1 001 con curva plana: cinco meses de 84 y siete de 83 (los mayores restos, el más temprano primero)", () => {
    const m = repartirEntero(1001, CURVA_PLANA) as number[];
    expect(m.filter((x) => x === 84)).toHaveLength(5);
    expect(m.filter((x) => x === 83)).toHaveLength(7);
    expect(m.slice(0, 5)).toEqual([84, 84, 84, 84, 84]);
  });

  it("la suma es exactamente el total para 0 a 5 000 (propiedad), con curvas planas y de verano", () => {
    for (let total = 0; total <= 5000; total += 7) {
      expect(suma(repartirEntero(total, CURVA_PLANA) as number[])).toBe(total);
      expect(suma(repartirEntero(total, CURVA_VERANO) as number[])).toBe(total);
    }
    expect(suma(repartirEntero(4999, CURVA_VERANO) as number[])).toBe(4999);
  });

  it("total 0 → doce ceros; pesos nulos → null; pesos que suman cero → reparto parejo", () => {
    expect(repartirEntero(0, CURVA_PLANA)).toEqual(Array(12).fill(0));
    expect(repartirEntero(10, null)).toBeNull();
    expect(suma(repartirEntero(10, Array(12).fill(0)) as number[])).toBe(10);
  });

  it("repartirResto: los meses ≤ k son el real, el resto va con la curva y los orígenes lo dicen", () => {
    const real = [100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 0, 0];
    const r = repartirResto(1800, real, 9, CURVA_PLANA);
    expect(r.meses).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 300, 300, 300]);
    expect(suma(r.meses as number[])).toBe(1800);
    expect(r.origen_meses).toEqual([...Array(9).fill("real"), ...Array(3).fill("proyectado")]);
  });

  it("repartirResto con k = 0 (año siguiente) es todo proyectado; sin curva → null; resto negativo se trunca a 0", () => {
    expect(repartirResto(120, [], 0, CURVA_PLANA).origen_meses?.every((o) => o === "proyectado")).toBe(true);
    expect(repartirResto(120, [], 0, null)).toEqual({ meses: null, origen_meses: null });
    const r = repartirResto(50, Array(12).fill(10), 9, CURVA_PLANA);
    expect(r.meses?.slice(9)).toEqual([0, 0, 0]);
  });
});
