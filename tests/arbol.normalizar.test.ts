import { describe, expect, it } from "vitest";
import {
  aCodigo,
  esEquivalenciaGenerica,
  esTemporada,
  normalizarNombre,
} from "@/lib/arbol/normalizar";

describe("normalizarNombre", () => {
  it("recorta, colapsa espacios y pasa a mayúsculas en español", () => {
    expect(normalizarNombre(" pantalón   cargo ")).toBe("PANTALÓN CARGO");
    expect(normalizarNombre("niñas")).toBe("NIÑAS");
  });
  it("unifica NFC y NFD", () => {
    const compuesta = "niñas";
    const descompuesta = "niñas";
    expect(normalizarNombre(compuesta)).toBe(normalizarNombre(descompuesta));
  });
  it("tolera valores no string", () => {
    expect(normalizarNombre(null)).toBe("");
    expect(normalizarNombre(undefined)).toBe("");
    expect(normalizarNombre(42)).toBe("");
  });
});

describe("aCodigo", () => {
  it("quita eñes, acentos y separadores", () => {
    expect(aCodigo("Niñas")).toBe("NINAS");
    expect(aCodigo("SIN ASIGNAR")).toBe("SIN_ASIGNAR");
    expect(aCodigo("POLO M/C")).toBe("POLO_M_C");
    expect(aCodigo("H")).toBe("H");
    expect(aCodigo("Camisón  -- térmico")).toBe("CAMISON_TERMICO");
  });
  it("devuelve vacío si no queda nada", () => {
    expect(aCodigo("  --  ")).toBe("");
    expect(aCodigo("")).toBe("");
  });
  it("respeta el máximo y solo usa [A-Z0-9_]", () => {
    const largo = aCodigo("a".repeat(100) + " b");
    expect(largo.length).toBeLessThanOrEqual(40);
    expect(largo).toMatch(/^[A-Z0-9_]+$/);
    expect(largo.endsWith("_")).toBe(false);
  });
});

describe("esEquivalenciaGenerica", () => {
  it("reconoce vacío, guion y el nombre genérico", () => {
    expect(esEquivalenciaGenerica("")).toBe(true);
    expect(esEquivalenciaGenerica("   ")).toBe(true);
    expect(esEquivalenciaGenerica("-")).toBe(true);
    expect(esEquivalenciaGenerica("sin equivalencia")).toBe(true);
    expect(esEquivalenciaGenerica(null)).toBe(true);
  });
  it("una equivalencia real no es genérica", () => {
    expect(esEquivalenciaGenerica("VARIOS")).toBe(false);
    expect(esEquivalenciaGenerica("--x")).toBe(false);
  });
});

describe("esTemporada", () => {
  it("distingue caja", () => {
    expect(esTemporada("Verano")).toBe(true);
    expect(esTemporada("verano")).toBe(false);
    expect(esTemporada("Todo el año")).toBe(true);
  });
});
