import { describe, expect, it } from "vitest";
import { fechaLegible, leerFecha, leerMonto, leerTipo, montoLegible, textoLegible } from "@/lib/tiendas/fechas";

describe("leerFecha (regla 7)", () => {
  it("día primero en todos los separadores, e ISO con guion o barra", () => {
    for (const v of ["15/03/2019", "15-03-2019", "15.03.2019", "2019-03-15", "2019/03/15", " 15/03/2019 "]) {
      expect(leerFecha(v), v).toBe("2019-03-15");
    }
  });
  it("año de dos cifras → 20aa; siempre día primero", () => {
    expect(leerFecha("5/3/19")).toBe("2019-03-05");
    expect(leerFecha("03/05/2026")).toBe("2026-05-03");
    expect(leerFecha("1/1/27")).toBe("2027-01-01");
  });
  it("vacío → null", () => {
    expect(leerFecha("")).toBeNull();
    expect(leerFecha("  ")).toBeNull();
    expect(leerFecha(undefined)).toBeNull();
    expect(leerFecha(null)).toBeNull();
  });
  it("inválidas: día inexistente, mes 13, texto, dígitos pegados", () => {
    for (const v of ["31/02/2024", "2024-13-01", "ayer", "20240315", "2024-02-30", "0/1/2024", "32/01/2024", "15/03"]) {
      expect(leerFecha(v), v).toBe("invalida");
    }
    expect(leerFecha(12345)).toBe("invalida");
  });
  it("29 de febrero solo en bisiesto", () => {
    expect(leerFecha("29/02/2024")).toBe("2024-02-29");
    expect(leerFecha("29/02/2023")).toBe("invalida");
    expect(leerFecha("29/02/1900")).toBe("invalida");
    expect(leerFecha("29/02/2000")).toBe("2000-02-29");
  });
});

describe("leerMonto (regla 8)", () => {
  it("vacío → null; enteros; soles con miles", () => {
    expect(leerMonto("")).toBeNull();
    expect(leerMonto("   ")).toBeNull();
    expect(leerMonto("85000")).toBe(85000);
    expect(leerMonto("S/ 12,500.00")).toBe(12500);
    expect(leerMonto("S/.1,250.5")).toBe(1250.5);
    expect(leerMonto("s/ 1,250")).toBe(1250);
    expect(leerMonto("1,250,000.75")).toBe(1250000.75);
    expect(leerMonto(" 0 ")).toBe(0);
    expect(leerMonto("1 000")).toBe(1000); // la ficha quita espacios internos
  });
  it("punto decimal con redondeo a dos", () => {
    expect(leerMonto("12.345")).toBe(12.35);
    expect(leerMonto("12.5")).toBe(12.5);
    expect(leerMonto("0.004")).toBe(0);
  });
  it("inválidos: negativo, coma no seguida de tres dígitos, texto", () => {
    for (const v of ["-5", "12,5", "abc", "S/", "1,2345", "12.5.1", "1.000,50"]) expect(leerMonto(v), v).toBe("invalido");
  });
  it("números ya tipados se aceptan si no son negativos", () => {
    expect(leerMonto(85000)).toBe(85000);
    expect(leerMonto(-1)).toBe("invalido");
    expect(leerMonto(null)).toBeNull();
  });
});

describe("leerTipo (regla 9)", () => {
  it("Tienda: vacío, tienda, T", () => {
    for (const v of ["", "tienda", "T", " TIENDA ", "t"]) expect(leerTipo(v), v).toBe("Tienda");
    expect(leerTipo(undefined)).toBe("Tienda");
  });
  it("Centro de Distribución: CD, nombre completo con o sin acento, Almacén, Distribución", () => {
    for (const v of ["CD", "cd", "Centro de Distribución", "CENTRO DE DISTRIBUCION", "Almacén", "almacen", "Distribución"]) {
      expect(leerTipo(v), v).toBe("Centro de Distribución");
    }
  });
  it("otra cosa → null (no se infiere del código)", () => {
    for (const v of ["deposito", "X", "tiendas", "centro"]) expect(leerTipo(v), v).toBeNull();
  });
});

describe("legibles para el reporte de diferencias", () => {
  it("fechas dd/mm/aaaa, montos con dos decimales, nulos como —", () => {
    expect(fechaLegible("2019-03-15")).toBe("15/03/2019");
    expect(fechaLegible(null)).toBe("—");
    expect(montoLegible(85000)).toBe("85000.00");
    expect(montoLegible(12.5)).toBe("12.50");
    expect(montoLegible(null)).toBe("—");
    expect(textoLegible("LUKERS SAC")).toBe("LUKERS SAC");
    expect(textoLegible(null)).toBe("—");
  });
});
