import { describe, expect, it } from "vitest";
import {
  aCentimos,
  aEntero,
  centimosASoles,
  leerNumero,
  pareceComaDecimal,
  redondear2,
  todasEnteras,
} from "@/lib/ventas/numeros";

describe("leerNumero (regla 5)", () => {
  it("lee enteros, miles en grupos de tres, negativos y notación científica", () => {
    expect(leerNumero("7913")).toBe(7913);
    expect(leerNumero("7,913")).toBe(7913);
    expect(leerNumero("1,234,567.5")).toBe(1234567.5);
    expect(leerNumero("-12.5")).toBe(-12.5);
    expect(leerNumero("(12.5)")).toBe(-12.5);
    expect(leerNumero("1e3")).toBe(1000);
    expect(leerNumero(" 42 ")).toBe(42);
    expect(leerNumero(7)).toBe(7);
  });

  it("no adivina la coma decimal ni acepta basura", () => {
    for (const v of ["12,5", "1.234,56", "1,23", "abc", "", "1,2345", "  ", "--1"]) {
      expect(leerNumero(v)).toBe("invalido");
    }
    expect(leerNumero(Number.NaN)).toBe("invalido");
  });

  it("nunca devuelve -0", () => {
    expect(Object.is(leerNumero("-0"), -0)).toBe(false);
    expect(leerNumero("-0")).toBe(0);
    expect(Object.is(leerNumero("(0)"), -0)).toBe(false);
  });
});

describe("redondear2 y aEntero (reglas 6 y 7)", () => {
  it("redondea mitad hacia afuera con tolerancia al ruido de coma flotante", () => {
    expect(redondear2(205.70999999999998)).toBe(205.71);
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(-1.005)).toBe(-1.01);
    expect(redondear2(0.004)).toBe(0);
    expect(redondear2(0.5)).toBe(0.5);
  });

  it("nunca produce -0", () => {
    expect(Object.is(redondear2(-0.004), -0)).toBe(false);
    expect(redondear2(-0.004)).toBe(0);
    expect(Object.is(aCentimos(-0.001), -0)).toBe(false);
  });

  it("convierte a céntimos y de vuelta", () => {
    expect(aCentimos(205.7)).toBe(20570);
    expect(aCentimos(-12.34)).toBe(-1234);
    expect(centimosASoles(1005)).toBe(10.05);
  });

  it("aEntero redondea y avisa solo de decimales reales", () => {
    expect(aEntero(3)).toEqual({ valor: 3, tuvoDecimales: false });
    expect(aEntero(2.6)).toEqual({ valor: 3, tuvoDecimales: true });
    expect(aEntero(-2.5)).toEqual({ valor: -3, tuvoDecimales: true });
    expect(aEntero(7913.0000000001)).toEqual({ valor: 7913, tuvoDecimales: false });
  });
});

describe("redondeo de montos grandes (sin épsilon relativo)", () => {
  it("no mueve los montos que ya tienen 2 decimales", () => {
    expect(redondear2(5_000_000)).toBe(5_000_000);
    expect(redondear2(30_000_000)).toBe(30_000_000);
    expect(redondear2(123_456_789.01)).toBe(123_456_789.01);
    expect(redondear2(999_999_999_999.99)).toBe(999_999_999_999.99);
    expect(redondear2(-5_000_000)).toBe(-5_000_000);
    expect(redondear2(-30_000_000.03)).toBe(-30_000_000.03);
    expect(redondear2(-123_456_789.01)).toBe(-123_456_789.01);
    expect(aCentimos(30_000_000)).toBe(3_000_000_000);
    expect(aCentimos(123_456_789.01)).toBe(12_345_678_901);
    expect(aCentimos(-123_456_789.01)).toBe(-12_345_678_901);
  });

  it("sigue corrigiendo el ruido de coma flotante y redondeando mitad hacia afuera", () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(-1.005)).toBe(-1.01);
    expect(redondear2(205.70999999999998)).toBe(205.71);
    expect(redondear2(1_000_000.005)).toBe(1_000_000.01);
    expect(redondear2(0.1 + 0.2)).toBe(0.3);
    expect(aCentimos(0.1 + 0.2)).toBe(30);
  });

  it("es idempotente y ida y vuelta exacta con céntimos enteros (semilla fija)", () => {
    let a = 12345;
    const rng = () => {
      a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
      return a / 4294967296;
    };
    for (let i = 0; i < 20_000; i++) {
      const c = Math.floor(rng() * 1e14); // hasta S/ 1 000 000 000 000,00
      const soles = centimosASoles(c);
      expect(aCentimos(soles), `c=${c}`).toBe(c);
      expect(redondear2(soles), `c=${c}`).toBe(soles);
      expect(aCentimos(-soles)).toBe(c === 0 ? 0 : -c);
    }
  });

  it("aEntero no corrompe unidades grandes", () => {
    expect(aEntero(2_000_000_000)).toEqual({ valor: 2_000_000_000, tuvoDecimales: false });
    expect(aEntero(-2_147_483_647)).toEqual({ valor: -2_147_483_647, tuvoDecimales: false });
    expect(aEntero(123_456_789.4)).toEqual({ valor: 123_456_789, tuvoDecimales: true });
  });
});

describe("pareceComaDecimal y todasEnteras (reglas 8 y 9)", () => {
  it("más del 1 % con forma `\\d+,\\d{1,2}`", () => {
    const base = Array.from({ length: 100 }, () => "1234");
    expect(pareceComaDecimal([...base, "12,5", "3,25"])).toBe(true);
    expect(pareceComaDecimal([...base, "12,5"])).toBe(false); // exactamente 1/101 < 1 %
    expect(pareceComaDecimal(["7,913", "1,234,567", "1234"])).toBe(false);
    expect(pareceComaDecimal(["1.234,56", "10", "20"])).toBe(true);
    expect(pareceComaDecimal([])).toBe(false);
  });

  it("detecta el export en soles enteros", () => {
    expect(todasEnteras([100, 250, -3])).toBe(true);
    expect(todasEnteras([100, 250.5])).toBe(false);
    expect(todasEnteras([])).toBe(true);
  });
});
