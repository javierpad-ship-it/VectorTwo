import { describe, expect, it } from "vitest";
import { SEED_AGRUPACIONES_MARCA } from "@/lib/marcas/seed";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";

describe("SEED_AGRUPACIONES_MARCA (regla 5)", () => {
  it("son las cinco agrupaciones de Javier, en su orden", () => {
    expect(SEED_AGRUPACIONES_MARCA.map((a) => a.codigo)).toEqual([
      "ULTRA_LOW",
      "MID_VALUE",
      "VALOR",
      "RECONOCIDO",
      "PREMIUM",
    ]);
    expect(SEED_AGRUPACIONES_MARCA.map((a) => a.nombre)).toEqual([
      "ULTRA LOW",
      "MID VALUE",
      "VALOR",
      "RECONOCIDO",
      "PREMIUM",
    ]);
  });

  it("los nombres ya están normalizados (mayúsculas, sin espacios sobrantes)", () => {
    for (const a of SEED_AGRUPACIONES_MARCA) expect(normalizarNombre(a.nombre)).toBe(a.nombre);
  });

  it("el código es exactamente el que derivaría aCodigo del nombre", () => {
    for (const a of SEED_AGRUPACIONES_MARCA) expect(aCodigo(a.nombre)).toBe(a.codigo);
  });

  it("orden estrictamente creciente y el '1 · 2 · 3 · 4 · 5' de Javier es orden / 10", () => {
    const ordenes = SEED_AGRUPACIONES_MARCA.map((a) => a.orden);
    for (let i = 1; i < ordenes.length; i++) expect(ordenes[i]).toBeGreaterThan(ordenes[i - 1]);
    expect(ordenes.map((o) => o / 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it("no repite códigos ni nombres", () => {
    expect(new Set(SEED_AGRUPACIONES_MARCA.map((a) => a.codigo)).size).toBe(SEED_AGRUPACIONES_MARCA.length);
    expect(new Set(SEED_AGRUPACIONES_MARCA.map((a) => a.nombre)).size).toBe(SEED_AGRUPACIONES_MARCA.length);
  });
});
