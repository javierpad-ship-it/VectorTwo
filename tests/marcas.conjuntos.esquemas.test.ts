import { describe, expect, it } from "vitest";
import { importarConjuntosSchema, miembrosSchema, sugerenciasConjuntosQuerySchema } from "@/lib/marcas/conjuntos/esquemas";

/** Regla 17 de 02b: esquemas zod de los conjuntos de marcas. */

const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));

describe("miembrosSchema", () => {
  const base = { cabeza_marca_id: id(900), accion: "asignar", marca_ids: ids(2) };
  it("acepta asignar y quitar", () => {
    expect(miembrosSchema.safeParse(base).success).toBe(true);
    expect(miembrosSchema.safeParse({ ...base, accion: "quitar" }).success).toBe(true);
  });
  it("rechaza lista vacía, más de 200 y acción desconocida", () => {
    expect(miembrosSchema.safeParse({ ...base, marca_ids: [] }).success).toBe(false);
    expect(miembrosSchema.safeParse({ ...base, marca_ids: ids(201) }).success).toBe(false);
    expect(miembrosSchema.safeParse({ ...base, marca_ids: ids(200) }).success).toBe(true);
    expect(miembrosSchema.safeParse({ ...base, accion: "mover" }).success).toBe(false);
  });
  it("exige uuid en la cabeza y en las marcas", () => {
    expect(miembrosSchema.safeParse({ ...base, cabeza_marca_id: "ALFA" }).success).toBe(false);
    expect(miembrosSchema.safeParse({ ...base, marca_ids: ["x"] }).success).toBe(false);
  });
});

describe("sugerenciasConjuntosQuerySchema", () => {
  it("umbral por defecto 0,5 y acotado a 0,3..0,9", () => {
    expect(sugerenciasConjuntosQuerySchema.parse({}).umbral).toBe(0.5);
    expect(sugerenciasConjuntosQuerySchema.parse({ umbral: "0.3" }).umbral).toBe(0.3);
    expect(sugerenciasConjuntosQuerySchema.parse({ umbral: "0.9" }).umbral).toBe(0.9);
    expect(sugerenciasConjuntosQuerySchema.safeParse({ umbral: "0.29" }).success).toBe(false);
    expect(sugerenciasConjuntosQuerySchema.safeParse({ umbral: "0.91" }).success).toBe(false);
    expect(sugerenciasConjuntosQuerySchema.safeParse({ umbral: "alto" }).success).toBe(false);
  });
});

describe("importarConjuntosSchema", () => {
  const fila = { marca: "ALFA JEANS", conjunto: "ALFA" };
  it("modo válido y entre 1 y 10 000 filas", () => {
    expect(importarConjuntosSchema.safeParse({ modo: "previsualizar", filas: [fila] }).success).toBe(true);
    expect(importarConjuntosSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarConjuntosSchema.safeParse({ modo: "ya", filas: [fila] }).success).toBe(false);
    expect(importarConjuntosSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 10_001 }, () => fila) }).success).toBe(false);
    expect(importarConjuntosSchema.safeParse({ modo: "aplicar", filas: [{ marca: "A" }] }).success).toBe(false);
  });
});
