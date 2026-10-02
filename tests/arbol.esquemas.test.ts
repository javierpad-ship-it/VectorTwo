import { describe, expect, it } from "vitest";
import {
  crearCatalogoSchema,
  crearEquivalenciaSchema,
  crearLineaSchema,
  editarCatalogoSchema,
  editarEquivalenciaSchema,
  editarLineaSchema,
  editarNodoSchema,
  importarSchema,
} from "@/lib/arbol/esquemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("crearCatalogoSchema", () => {
  it("normaliza el nombre y deriva el código si falta", () => {
    expect(crearCatalogoSchema.parse({ nombre: "  niñas  " })).toEqual({ nombre: "NIÑAS", codigo: "NINAS" });
  });
  it("respeta el código enviado, normalizado a ASCII", () => {
    expect(crearCatalogoSchema.parse({ nombre: "Hombre", codigo: "h", orden: 10 })).toEqual({
      nombre: "HOMBRE",
      codigo: "H",
      orden: 10,
    });
  });
  it("un código vacío equivale a no mandarlo", () => {
    expect(crearCatalogoSchema.parse({ nombre: "Sin asignar", codigo: "  " }).codigo).toBe("SIN_ASIGNAR");
  });
  it("rechaza nombre vacío, orden negativo y nombres sin letras ni dígitos", () => {
    expect(crearCatalogoSchema.safeParse({ nombre: "   " }).success).toBe(false);
    expect(crearCatalogoSchema.safeParse({ nombre: "X", orden: -1 }).success).toBe(false);
    const r = crearCatalogoSchema.safeParse({ nombre: "---" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/código/);
  });
});

describe("editarCatalogoSchema", () => {
  it("es parcial pero no vacío", () => {
    expect(editarCatalogoSchema.safeParse({}).success).toBe(false);
    expect(editarCatalogoSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(editarCatalogoSchema.parse({ nombre: "formal ", codigo: "formal" })).toEqual({ nombre: "FORMAL", codigo: "FORMAL" });
  });
});

describe("crearLineaSchema / editarLineaSchema", () => {
  it("temporada por defecto y código derivado", () => {
    expect(crearLineaSchema.parse({ nombre: "  camisa   manga larga " })).toEqual({
      nombre: "CAMISA MANGA LARGA",
      codigo: "CAMISA_MANGA_LARGA",
      temporada: "Todo el año",
    });
  });
  it("valida la temporada", () => {
    expect(crearLineaSchema.safeParse({ nombre: "X", temporada: "verano" }).success).toBe(false);
    expect(editarLineaSchema.parse({ temporada: "Invierno" })).toEqual({ temporada: "Invierno" });
  });
  it("no acepta orden", () => {
    const r = crearLineaSchema.parse({ nombre: "X", orden: 5 });
    expect(r).not.toHaveProperty("orden");
  });
});

describe("editarNodoSchema", () => {
  it("exige al menos activo o mundo_id, con uuid válido", () => {
    expect(editarNodoSchema.safeParse({}).success).toBe(false);
    expect(editarNodoSchema.safeParse({ mundo_id: "no-uuid" }).success).toBe(false);
    expect(editarNodoSchema.parse({ mundo_id: UUID })).toEqual({ mundo_id: UUID });
  });
});

describe("crearEquivalenciaSchema", () => {
  it("una real lleva nombre normalizado y código derivado", () => {
    expect(crearEquivalenciaSchema.parse({ genero_mundo_linea_id: UUID, nombre: " polo m/c " })).toEqual({
      genero_mundo_linea_id: UUID,
      nombre: "POLO M/C",
      codigo: "POLO_M_C",
      es_generica: false,
    });
  });
  it("vacío, '-' o SIN EQUIVALENCIA crean la genérica con nombre y código fijos", () => {
    for (const nombre of ["", "   ", "-", "sin equivalencia", "SIN EQUIVALENCIA"]) {
      expect(crearEquivalenciaSchema.parse({ genero_mundo_linea_id: UUID, nombre, codigo: "LO_QUE_SEA" })).toEqual({
        genero_mundo_linea_id: UUID,
        nombre: "SIN EQUIVALENCIA",
        codigo: "SIN_EQUIVALENCIA",
        es_generica: true,
      });
    }
  });
  it("rechaza nodo inválido y nombres sin código posible", () => {
    expect(crearEquivalenciaSchema.safeParse({ genero_mundo_linea_id: "x", nombre: "A" }).success).toBe(false);
    expect(crearEquivalenciaSchema.safeParse({ genero_mundo_linea_id: UUID, nombre: "¿?" }).success).toBe(false);
  });
});

describe("editarEquivalenciaSchema", () => {
  it("parcial, no vacío, normaliza", () => {
    expect(editarEquivalenciaSchema.safeParse({}).success).toBe(false);
    expect(editarEquivalenciaSchema.parse({ nombre: "jogger", activo: true })).toEqual({ nombre: "JOGGER", activo: true });
  });
});

describe("importarSchema", () => {
  it("acepta el cuerpo de la especificación", () => {
    const r = importarSchema.parse({
      modo: "previsualizar",
      filas: [{ genero: "H", mundo: "URBANO", linea: "PANTALON", equivalencia: "" }],
    });
    expect(r.filas).toHaveLength(1);
  });
  it("rechaza modo desconocido, sin filas o más de 10 000", () => {
    expect(importarSchema.safeParse({ modo: "x", filas: [] }).success).toBe(false);
    expect(importarSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    const fila = { genero: "H", mundo: "", linea: "L", equivalencia: "" };
    expect(importarSchema.safeParse({ modo: "aplicar", filas: Array(10_001).fill(fila) }).success).toBe(false);
  });
});
