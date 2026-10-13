import { describe, expect, it } from "vitest";
import { editarNodoSchema } from "@/lib/arbol/esquemas";
import { importarNivelSchema, nivelBloqueSchema } from "@/lib/arbol/nivel/esquemas";

/** Regla 17 de 02b: esquemas del nivel de planificación. */

const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));

describe("editarNodoSchema", () => {
  it("acepta nivel_planificacion GML y GMLE y rechaza otro valor", () => {
    expect(editarNodoSchema.parse({ nivel_planificacion: "GML" })).toEqual({ nivel_planificacion: "GML" });
    expect(editarNodoSchema.parse({ nivel_planificacion: "GMLE" })).toEqual({ nivel_planificacion: "GMLE" });
    const r = editarNodoSchema.safeParse({ nivel_planificacion: "X" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("El nivel de planificación debe ser GML o GMLE.");
    expect(editarNodoSchema.safeParse({ nivel_planificacion: "gml" }).success).toBe(false);
  });
  it("sigue exigiendo algo que actualizar y acepta combinarlo con lo de M1", () => {
    expect(editarNodoSchema.safeParse({}).success).toBe(false);
    expect(editarNodoSchema.parse({ activo: false, nivel_planificacion: "GMLE" })).toEqual({ activo: false, nivel_planificacion: "GMLE" });
  });
});

describe("nivelBloqueSchema", () => {
  it("rechaza lista vacía, más de 600 y no uuid", () => {
    expect(nivelBloqueSchema.safeParse({ nivel: "GMLE", nodo_ids: [] }).success).toBe(false);
    expect(nivelBloqueSchema.safeParse({ nivel: "GMLE", nodo_ids: ids(601) }).success).toBe(false);
    expect(nivelBloqueSchema.safeParse({ nivel: "GMLE", nodo_ids: ids(600) }).success).toBe(true);
    expect(nivelBloqueSchema.safeParse({ nivel: "GMLE", nodo_ids: ["no-uuid"] }).success).toBe(false);
  });
  it("el nivel es obligatorio y solo GML o GMLE", () => {
    expect(nivelBloqueSchema.safeParse({ nodo_ids: ids(1) }).success).toBe(false);
    expect(nivelBloqueSchema.safeParse({ nivel: "LINEA", nodo_ids: ids(1) }).success).toBe(false);
    expect(nivelBloqueSchema.parse({ nivel: "GML", nodo_ids: ids(2) }).nivel).toBe("GML");
  });
});

describe("importarNivelSchema", () => {
  const fila = { genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", nivel: "GMLE" };
  it("modo válido y entre 1 y 10 000 filas", () => {
    expect(importarNivelSchema.safeParse({ modo: "previsualizar", filas: [fila] }).success).toBe(true);
    expect(importarNivelSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarNivelSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 10_001 }, () => fila) }).success).toBe(false);
    expect(importarNivelSchema.safeParse({ modo: "ya", filas: [fila] }).success).toBe(false);
    expect(importarNivelSchema.safeParse({ modo: "aplicar", filas: [{ genero: "H", mundo: "U", linea: "D" }] }).success).toBe(false);
  });
});
