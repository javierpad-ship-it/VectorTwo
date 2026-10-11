import { describe, expect, it } from "vitest";
import {
  esMesCerrado,
  leerPeriodo,
  leerPeriodoDetallado,
  listarMeses,
  mesAnterior,
  periodoADb,
  recortarPeriodo,
  ultimoMesCerrado,
} from "@/lib/ventas/periodo";

describe("leerPeriodo con año (reglas 1 y 3)", () => {
  it("lee abreviaturas, nombres y números sin distinguir caja ni acentos", () => {
    expect(leerPeriodo("2026", "Set")).toBe("2026-09-01");
    expect(leerPeriodo("2026", "sep")).toBe("2026-09-01");
    expect(leerPeriodo("2026", "SEPTIEMBRE")).toBe("2026-09-01");
    expect(leerPeriodo("2026", "Setiembre")).toBe("2026-09-01");
    expect(leerPeriodo(2026, 9)).toBe("2026-09-01");
    expect(leerPeriodo("2026", "09")).toBe("2026-09-01");
    expect(leerPeriodo("2026", "Ene")).toBe("2026-01-01");
    expect(leerPeriodo("2023", "dic")).toBe("2023-12-01");
    expect(leerPeriodo("2026", "Sept")).toBe("2026-09-01");
  });

  it("rechaza lo que no es un mes o un año válido", () => {
    expect(leerPeriodo("2026", "Sep.")).toBe("invalido");
    expect(leerPeriodo("2026", "13")).toBe("invalido");
    expect(leerPeriodo("2026", "0")).toBe("invalido");
    expect(leerPeriodo("2026", "")).toBe("invalido");
    expect(leerPeriodo("2026", "xx")).toBe("invalido");
    expect(leerPeriodo("26", "09")).toBe("invalido");
    expect(leerPeriodo("1999", "09")).toBe("invalido");
    expect(leerPeriodo("2101", "09")).toBe("invalido");
  });
});

describe("nombres de mes que son propiedades de Object", () => {
  it("`constructor`, `__proto__`, `toString` y `hasOwnProperty` no son meses", () => {
    for (const v of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(leerPeriodo("2026", v), v).toBe("invalido");
    }
  });
});

describe("leerPeriodo sin año (regla 2)", () => {
  it("lee aaaa-mm, aaaa/mm, mm/aaaa, ISO y dd/mm/aaaa", () => {
    expect(leerPeriodo(null, "2026-09")).toBe("2026-09-01");
    expect(leerPeriodo(null, "2026/09")).toBe("2026-09-01");
    expect(leerPeriodo(null, "09/2026")).toBe("2026-09-01");
    expect(leerPeriodo(null, "2026-09-15")).toBe("2026-09-01");
    expect(leerPeriodo(null, "15/09/2026")).toBe("2026-09-01");
    expect(leerPeriodo("", "2026-09")).toBe("2026-09-01");
  });

  it("`09/05/2026` es 9 de mayo (día primero) y el día distinto de 1 se informa", () => {
    expect(leerPeriodo(null, "09/05/2026")).toBe("2026-05-01");
    expect(leerPeriodoDetallado(null, "09/05/2026")).toEqual({ periodo: "2026-05-01", dia_distinto_de_1: true });
    expect(leerPeriodoDetallado(null, "2026-09-01")).toEqual({ periodo: "2026-09-01", dia_distinto_de_1: false });
  });

  it("rechaza lo inválido y los días inexistentes", () => {
    expect(leerPeriodo(null, "2026-13")).toBe("invalido");
    expect(leerPeriodo(null, "31/02/2026")).toBe("invalido");
    expect(leerPeriodo(null, "")).toBe("invalido");
    expect(leerPeriodo(null, "septiembre")).toBe("invalido");
    expect(leerPeriodo(null, "9")).toBe("invalido");
  });
});

describe("esMesCerrado (regla 4) y utilidades de periodo", () => {
  it("el mes en curso no está cerrado", () => {
    expect(esMesCerrado("2026-09", "2026-10-11")).toBe(true);
    expect(esMesCerrado("2026-10", "2026-10-11")).toBe(false);
    expect(esMesCerrado("2026-09", "2026-10-01")).toBe(true);
    expect(esMesCerrado("2026-09-01", "2026-09-30")).toBe(false);
  });

  it("calcula último cerrado, anterior y rangos", () => {
    expect(ultimoMesCerrado("2026-10-11")).toBe("2026-09");
    expect(ultimoMesCerrado("2026-01-05")).toBe("2025-12");
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(listarMeses("2023-01", "2026-09")).toHaveLength(45);
    expect(listarMeses("2026-09", "2026-08")).toEqual([]);
    expect(listarMeses("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodoADb("2026-09")).toBe("2026-09-01");
    expect(recortarPeriodo("2026-09-01")).toBe("2026-09");
  });
});
