import { describe, expect, it } from "vitest";
import {
  MENSAJE_NOTA_LARGA,
  MENSAJE_NOTA_SIN_BANDERA,
  crearMarcaSchema,
  editarMarcaSchema,
  filaImportacionMarcaSchema,
  importarMarcasSchema,
} from "@/lib/marcas/esquemas";
import { crearCatalogoSchema } from "@/lib/arbol/esquemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("crearMarcaSchema (regla 16)", () => {
  it("normaliza el nombre y deriva el código si falta; tratamiento false y nota null por defecto", () => {
    expect(crearMarcaSchema.parse({ nombre: "  levi's ", agrupacion_marca_id: UUID })).toEqual({
      nombre: "LEVI'S",
      codigo: "LEVI_S",
      agrupacion_marca_id: UUID,
      tratamiento_especial: false,
      nota_tratamiento: null,
    });
  });
  it("respeta el código enviado (a ASCII) y H&M → H_M", () => {
    expect(crearMarcaSchema.parse({ nombre: "H&M", agrupacion_marca_id: UUID }).codigo).toBe("H_M");
    expect(crearMarcaSchema.parse({ nombre: "Levis", codigo: "lv", agrupacion_marca_id: UUID }).codigo).toBe("LV");
    expect(crearMarcaSchema.parse({ nombre: "Levis", codigo: "  ", agrupacion_marca_id: UUID }).codigo).toBe("LEVIS");
  });
  it("acepta nota con la bandera, recortada; '' se convierte en null", () => {
    const r = crearMarcaSchema.parse({
      nombre: "X",
      agrupacion_marca_id: UUID,
      tratamiento_especial: true,
      nota_tratamiento: "  Licencia  ",
    });
    expect(r.nota_tratamiento).toBe("Licencia");
    expect(
      crearMarcaSchema.parse({ nombre: "X", agrupacion_marca_id: UUID, tratamiento_especial: true, nota_tratamiento: "" })
        .nota_tratamiento
    ).toBeNull();
    expect(
      crearMarcaSchema.parse({ nombre: "X", agrupacion_marca_id: UUID, tratamiento_especial: false, nota_tratamiento: "  " })
        .nota_tratamiento
    ).toBeNull();
  });
  it("rechaza nota sin la bandera", () => {
    const r = crearMarcaSchema.safeParse({ nombre: "X", agrupacion_marca_id: UUID, nota_tratamiento: "Por qué" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe(MENSAJE_NOTA_SIN_BANDERA);
      expect(r.error.issues[0].path).toEqual(["nota_tratamiento"]);
    }
  });
  it("rechaza nota de más de 200", () => {
    const r = crearMarcaSchema.safeParse({
      nombre: "X",
      agrupacion_marca_id: UUID,
      tratamiento_especial: true,
      nota_tratamiento: "x".repeat(201),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MENSAJE_NOTA_LARGA);
  });
  it("rechaza agrupacion_marca_id que no sea UUID, nombre vacío y nombre sin letras ni dígitos", () => {
    expect(crearMarcaSchema.safeParse({ nombre: "X", agrupacion_marca_id: "abc" }).success).toBe(false);
    expect(crearMarcaSchema.safeParse({ nombre: "X" }).success).toBe(false);
    expect(crearMarcaSchema.safeParse({ nombre: "   ", agrupacion_marca_id: UUID }).success).toBe(false);
    const r = crearMarcaSchema.safeParse({ nombre: "---", agrupacion_marca_id: UUID });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/código/);
  });
  it("no acepta orden ni activo al crear", () => {
    const r = crearMarcaSchema.parse({ nombre: "X", agrupacion_marca_id: UUID, orden: 5, activo: false });
    expect(r).not.toHaveProperty("orden");
    expect(r).not.toHaveProperty("activo");
  });
});

describe("editarMarcaSchema (regla 16)", () => {
  it("rechaza el cuerpo vacío", () => {
    expect(editarMarcaSchema.safeParse({}).success).toBe(false);
  });
  it("es parcial: las claves ausentes siguen ausentes (no aparece nota_tratamiento: null)", () => {
    expect(editarMarcaSchema.parse({ nombre: "  levi's " })).toEqual({ nombre: "LEVI'S" });
    expect(editarMarcaSchema.parse({ activo: false })).toEqual({ activo: false });
    expect(editarMarcaSchema.parse({ agrupacion_marca_id: UUID })).toEqual({ agrupacion_marca_id: UUID });
  });
  it("normaliza nota y código", () => {
    expect(editarMarcaSchema.parse({ nota_tratamiento: "  x " })).toEqual({ nota_tratamiento: "x" });
    expect(editarMarcaSchema.parse({ nota_tratamiento: "" })).toEqual({ nota_tratamiento: null });
    expect(editarMarcaSchema.parse({ nota_tratamiento: null })).toEqual({ nota_tratamiento: null });
    expect(editarMarcaSchema.parse({ codigo: "levi s" })).toEqual({ codigo: "LEVI_S" });
  });
  it("rechaza nota larga, uuid inválido y tipos incorrectos", () => {
    expect(editarMarcaSchema.safeParse({ nota_tratamiento: "x".repeat(201) }).success).toBe(false);
    expect(editarMarcaSchema.safeParse({ agrupacion_marca_id: "nope" }).success).toBe(false);
    expect(editarMarcaSchema.safeParse({ tratamiento_especial: "si" }).success).toBe(false);
  });
});

describe("importarMarcasSchema", () => {
  it("tratamiento_especial es opcional y por defecto ''", () => {
    expect(filaImportacionMarcaSchema.parse({ marca: "A", agrupacion: "B" })).toEqual({
      marca: "A",
      agrupacion: "B",
      tratamiento_especial: "",
    });
  });
  it("exige modo válido y entre 1 y 10 000 filas", () => {
    expect(importarMarcasSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarMarcasSchema.safeParse({ modo: "ya", filas: [{ marca: "A", agrupacion: "B" }] }).success).toBe(false);
    expect(importarMarcasSchema.safeParse({ modo: "previsualizar", filas: [{ marca: "A", agrupacion: "B" }] }).success).toBe(
      true
    );
  });
});

describe("agrupaciones de marca reutilizan crearCatalogoSchema", () => {
  it("Mid Value → MID VALUE / MID_VALUE", () => {
    expect(crearCatalogoSchema.parse({ nombre: "Mid Value", orden: 20 })).toEqual({
      nombre: "MID VALUE",
      codigo: "MID_VALUE",
      orden: 20,
    });
  });
});
