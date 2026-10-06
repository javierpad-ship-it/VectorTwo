import { describe, expect, it } from "vitest";
import {
  MENSAJE_DESCRIPCION_LARGA,
  asignarSchema,
  crearAgrupacionSchema,
  editarAgrupacionSchema,
  filaImportacionEstacionalidadSchema,
  importarEstacionalidadSchema,
} from "@/lib/estacionalidad/esquemas";
import { editarEquivalenciaSchema } from "@/lib/arbol/esquemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const UUID2 = "223e4567-e89b-42d3-a456-426614174000";

describe("crearAgrupacionSchema (regla 1)", () => {
  it("normaliza el nombre, deriva el código y deja la descripción en null si no viene", () => {
    expect(crearAgrupacionSchema.parse({ nombre: " pantalones  invierno " })).toEqual({
      nombre: "PANTALONES INVIERNO",
      codigo: "PANTALONES_INVIERNO",
      descripcion: null,
    });
  });
  it("respeta el código enviado (a ASCII) y vacío lo deriva", () => {
    expect(crearAgrupacionSchema.parse({ nombre: "Pantalones-Invierno", codigo: "pant inv 2" }).codigo).toBe("PANT_INV_2");
    expect(crearAgrupacionSchema.parse({ nombre: "Pantalones-Invierno", codigo: "  " }).codigo).toBe("PANTALONES_INVIERNO");
  });
  it("recorta la descripción sin pasarla a mayúsculas; vacía → null", () => {
    expect(crearAgrupacionSchema.parse({ nombre: "X", descripcion: "  Pico en mayo-junio  " }).descripcion).toBe(
      "Pico en mayo-junio"
    );
    expect(crearAgrupacionSchema.parse({ nombre: "X", descripcion: "   " }).descripcion).toBeNull();
    expect(crearAgrupacionSchema.parse({ nombre: "X", descripcion: null }).descripcion).toBeNull();
  });
  it("rechaza más de 500 caracteres de descripción", () => {
    const r = crearAgrupacionSchema.safeParse({ nombre: "X", descripcion: "a".repeat(501) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MENSAJE_DESCRIPCION_LARGA);
    expect(crearAgrupacionSchema.safeParse({ nombre: "X", descripcion: "a".repeat(500) }).success).toBe(true);
  });
  it("orden entero ≥ 0 opcional", () => {
    expect(crearAgrupacionSchema.parse({ nombre: "X", orden: 10 }).orden).toBe(10);
    expect(crearAgrupacionSchema.safeParse({ nombre: "X", orden: -1 }).success).toBe(false);
    expect(crearAgrupacionSchema.safeParse({ nombre: "X", orden: 1.5 }).success).toBe(false);
  });
  it("nombre vacío → rechazo", () => {
    expect(crearAgrupacionSchema.safeParse({ nombre: "   " }).success).toBe(false);
    expect(crearAgrupacionSchema.safeParse({}).success).toBe(false);
  });
});

describe("editarAgrupacionSchema (regla 2)", () => {
  it("cuerpo vacío → rechazo", () => {
    const r = editarAgrupacionSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("No hay nada que actualizar.");
  });
  it("descripcion: null es válido y activo es booleano", () => {
    expect(editarAgrupacionSchema.parse({ descripcion: null })).toEqual({ descripcion: null });
    expect(editarAgrupacionSchema.parse({ descripcion: "" })).toEqual({ descripcion: null });
    expect(editarAgrupacionSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(editarAgrupacionSchema.safeParse({ activo: "no" }).success).toBe(false);
  });
  it("una clave ausente sigue ausente (no pisa la descripción al cambiar el orden)", () => {
    expect(editarAgrupacionSchema.parse({ orden: 3 })).toEqual({ orden: 3 });
  });
  it("normaliza nombre y código", () => {
    expect(editarAgrupacionSchema.parse({ nombre: " abrigos ", codigo: "abr-x" })).toEqual({ nombre: "ABRIGOS", codigo: "ABR_X" });
  });
});

describe("editarEquivalenciaSchema con agrupacion_estacionalidad_id (regla 3)", () => {
  it("acepta UUID o null; solo ese campo es un cuerpo válido", () => {
    expect(editarEquivalenciaSchema.parse({ agrupacion_estacionalidad_id: UUID })).toEqual({
      agrupacion_estacionalidad_id: UUID,
    });
    expect(editarEquivalenciaSchema.parse({ agrupacion_estacionalidad_id: null })).toEqual({
      agrupacion_estacionalidad_id: null,
    });
  });
  it("un valor que no es UUID → rechazo", () => {
    expect(editarEquivalenciaSchema.safeParse({ agrupacion_estacionalidad_id: "abc" }).success).toBe(false);
    expect(editarEquivalenciaSchema.safeParse({ agrupacion_estacionalidad_id: 5 }).success).toBe(false);
  });
  it("sigue aceptando los campos de M1 y rechazando el cuerpo vacío y el nombre '-'", () => {
    expect(editarEquivalenciaSchema.parse({ activo: false, agrupacion_estacionalidad_id: UUID })).toEqual({
      activo: false,
      agrupacion_estacionalidad_id: UUID,
    });
    expect(editarEquivalenciaSchema.safeParse({}).success).toBe(false);
    expect(editarEquivalenciaSchema.safeParse({ nombre: "-" }).success).toBe(false);
  });
});

describe("asignarSchema", () => {
  it("agrupacion_id nulo = quitar; ids UUID entre 1 y 2 000", () => {
    expect(asignarSchema.parse({ agrupacion_id: null, equivalencia_ids: [UUID] })).toEqual({
      agrupacion_id: null,
      equivalencia_ids: [UUID],
    });
    expect(asignarSchema.parse({ agrupacion_id: UUID, equivalencia_ids: [UUID, UUID2] }).equivalencia_ids).toHaveLength(2);
    expect(asignarSchema.safeParse({ agrupacion_id: UUID, equivalencia_ids: [] }).success).toBe(false);
    expect(asignarSchema.safeParse({ agrupacion_id: UUID, equivalencia_ids: ["x"] }).success).toBe(false);
    expect(asignarSchema.safeParse({ agrupacion_id: "x", equivalencia_ids: [UUID] }).success).toBe(false);
    expect(asignarSchema.safeParse({ equivalencia_ids: [UUID] }).success).toBe(false);
  });
  it("2 001 ids → rechazo", () => {
    const ids = Array.from({ length: 2001 }, () => UUID);
    const r = asignarSchema.safeParse({ agrupacion_id: UUID, equivalencia_ids: ids });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/2000/);
    expect(asignarSchema.safeParse({ agrupacion_id: UUID, equivalencia_ids: ids.slice(0, 2000) }).success).toBe(true);
  });
});

describe("importarEstacionalidadSchema", () => {
  const fila = { genero: "HOMBRE", mundo: "URBANO", linea: "PANTALON", equivalencia: "", agrupacion: "X" };
  it("exige las cinco columnas como texto", () => {
    expect(filaImportacionEstacionalidadSchema.parse(fila)).toEqual(fila);
    expect(filaImportacionEstacionalidadSchema.safeParse({ ...fila, agrupacion: undefined }).success).toBe(false);
    expect(filaImportacionEstacionalidadSchema.safeParse({ ...fila, equivalencia: 3 }).success).toBe(false);
  });
  it("modo previsualizar o aplicar; entre 1 y 10 000 filas", () => {
    expect(importarEstacionalidadSchema.parse({ modo: "aplicar", filas: [fila] }).modo).toBe("aplicar");
    expect(importarEstacionalidadSchema.safeParse({ modo: "simular", filas: [fila] }).success).toBe(false);
    expect(importarEstacionalidadSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(
      importarEstacionalidadSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 10_001 }, () => fila) }).success
    ).toBe(false);
  });
});
