import { describe, expect, it } from "vitest";
import { fichaLineaSchema, idRutaSchema, limpiarFotosSchema } from "@/lib/fotos/esquemas";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("fichaLineaSchema", () => {
  it("acepta descripción y modelo con sus valores anteriores; recorta y vacío pasa a null", () => {
    const r = fichaLineaSchema.parse({ descripcion: "  Jean slim azul medio ", modelo: "", antes: { descripcion: null, modelo: " DL-2231 " } });
    expect(r).toEqual({ descripcion: "Jean slim azul medio", modelo: null, antes: { descripcion: null, modelo: "DL-2231" } });
  });

  it("exige los dos campos y `antes` (null explícito, no ausente)", () => {
    expect(fichaLineaSchema.safeParse({ descripcion: "x", antes: { descripcion: null, modelo: null } }).success).toBe(false);
    expect(fichaLineaSchema.safeParse({ descripcion: null, modelo: null }).success).toBe(false);
  });

  it("respeta los largos (200 y 60) y rechaza claves desconocidas, entre ellas `revision`", () => {
    const antes = { descripcion: null, modelo: null };
    expect(fichaLineaSchema.safeParse({ descripcion: "a".repeat(201), modelo: null, antes }).success).toBe(false);
    expect(fichaLineaSchema.safeParse({ descripcion: "a".repeat(200), modelo: "m".repeat(61), antes }).success).toBe(false);
    expect(fichaLineaSchema.safeParse({ descripcion: "a".repeat(200), modelo: "m".repeat(60), antes }).success).toBe(true);
    expect(fichaLineaSchema.safeParse({ descripcion: null, modelo: null, antes, revision: 3 }).success).toBe(false);
  });
});

describe("otros esquemas de fotos", () => {
  it("limpiar exige confirmar: true", () => {
    expect(limpiarFotosSchema.safeParse({ confirmar: true }).success).toBe(true);
    expect(limpiarFotosSchema.safeParse({ confirmar: false }).success).toBe(false);
    expect(limpiarFotosSchema.safeParse({}).success).toBe(false);
  });

  it("los ids de la ruta son UUID", () => {
    expect(idRutaSchema.safeParse(UUID).success).toBe(true);
    expect(idRutaSchema.safeParse("no-es-uuid").success).toBe(false);
  });
});
