import { describe, expect, it } from "vitest";
import {
  asignarGmlSchema,
  crearGmlEspecialSchema,
  editarGmlEspecialSchema,
  estadoGmlQuerySchema,
  importarGmlSchema,
  sugerenciasQuerySchema,
} from "@/lib/marcas/gml/esquemas";
import { crearMarcaSchema, editarMarcaSchema, MENSAJE_MODALIDAD_SIN_TRATAMIENTO } from "@/lib/marcas/esquemas";
import { parametrosNoVacios, pideInactivas } from "@/lib/marcas/query";

/** Regla 17 de 02b: esquemas zod de marcas relevantes y de la modalidad. */

const id = (n: number) => `123e4567-e89b-42d3-a456-${String(n).padStart(12, "0")}`;
const UUID = id(1);
const uuids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));

describe("crearMarcaSchema y editarMarcaSchema aceptan la modalidad", () => {
  it("modalidad ∈ {por_gml, barrido, null}; otra cosa → 400 con el mensaje de la ficha", () => {
    for (const m of ["por_gml", "barrido"] as const) {
      expect(editarMarcaSchema.parse({ modalidad_tratamiento: m })).toEqual({ modalidad_tratamiento: m });
      expect(crearMarcaSchema.parse({ nombre: "A", agrupacion_marca_id: UUID, tratamiento_especial: true, modalidad_tratamiento: m }).modalidad_tratamiento).toBe(m);
    }
    expect(editarMarcaSchema.parse({ modalidad_tratamiento: null })).toEqual({ modalidad_tratamiento: null });
    const r = editarMarcaSchema.safeParse({ modalidad_tratamiento: "otra" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("La modalidad debe ser por_gml o barrido.");
  });
  it("crear con casilla y sin modalidad → barrido; sin casilla → null", () => {
    expect(crearMarcaSchema.parse({ nombre: "A", agrupacion_marca_id: UUID, tratamiento_especial: true }).modalidad_tratamiento).toBe("barrido");
    expect(crearMarcaSchema.parse({ nombre: "A", agrupacion_marca_id: UUID, tratamiento_especial: true, modalidad_tratamiento: null }).modalidad_tratamiento).toBe("barrido");
    expect(crearMarcaSchema.parse({ nombre: "A", agrupacion_marca_id: UUID }).modalidad_tratamiento).toBeNull();
  });
  it("crear con modalidad pero sin casilla → 400 (mismo refine que la nota)", () => {
    const r = crearMarcaSchema.safeParse({ nombre: "A", agrupacion_marca_id: UUID, modalidad_tratamiento: "por_gml" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe(MENSAJE_MODALIDAD_SIN_TRATAMIENTO);
    expect(r.error?.issues[0].path).toEqual(["modalidad_tratamiento"]);
  });
  it("editarMarcaSchema acepta conjunto_marca_id uuid o null y rechaza otra cosa", () => {
    expect(editarMarcaSchema.parse({ conjunto_marca_id: UUID })).toEqual({ conjunto_marca_id: UUID });
    expect(editarMarcaSchema.parse({ conjunto_marca_id: null })).toEqual({ conjunto_marca_id: null });
    expect(editarMarcaSchema.safeParse({ conjunto_marca_id: "ALFA" }).success).toBe(false);
  });
});

describe("crearGmlEspecialSchema y editarGmlEspecialSchema", () => {
  it("exige los dos uuid; la nota se recorta y '' o null → null", () => {
    expect(crearGmlEspecialSchema.parse({ marca_id: UUID, genero_mundo_linea_id: id(2) })).toEqual({ marca_id: UUID, genero_mundo_linea_id: id(2), nota: null });
    expect(crearGmlEspecialSchema.parse({ marca_id: UUID, genero_mundo_linea_id: id(2), nota: "  Jeans " }).nota).toBe("Jeans");
    expect(crearGmlEspecialSchema.parse({ marca_id: UUID, genero_mundo_linea_id: id(2), nota: "   " }).nota).toBeNull();
    expect(crearGmlEspecialSchema.safeParse({ marca_id: "x", genero_mundo_linea_id: id(2) }).success).toBe(false);
    expect(crearGmlEspecialSchema.safeParse({ marca_id: UUID }).success).toBe(false);
  });
  it("la nota no pasa de 200 caracteres", () => {
    const r = crearGmlEspecialSchema.safeParse({ marca_id: UUID, genero_mundo_linea_id: id(2), nota: "x".repeat(201) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("La nota no puede superar 200 caracteres.");
    expect(editarGmlEspecialSchema.safeParse({ nota: "x".repeat(200) }).success).toBe(true);
    expect(editarGmlEspecialSchema.parse({ nota: null })).toEqual({ nota: null });
    expect(editarGmlEspecialSchema.parse({ nota: "  " })).toEqual({ nota: null });
  });
  it("PATCH exige la clave nota: un cuerpo vacío no borra la nota sin querer", () => {
    const r = editarGmlEspecialSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Envía la nota (o null para borrarla).");
  });
});

describe("asignarGmlSchema", () => {
  const cart = (marcas: number, nodos: number) => ({ forma: "cartesiano", accion: "asignar", marca_ids: uuids(marcas), nodo_ids: uuids(nodos) });

  it("acepta las dos formas", () => {
    expect(asignarGmlSchema.safeParse(cart(2, 3)).success).toBe(true);
    expect(asignarGmlSchema.safeParse({ forma: "pares", accion: "quitar", pares: [{ marca_id: UUID, nodo_id: id(2) }] }).success).toBe(true);
  });
  it("rechaza más de 200 marcas, más de 600 nodos y más de 5 000 pares", () => {
    expect(asignarGmlSchema.safeParse(cart(201, 1)).success).toBe(false);
    expect(asignarGmlSchema.safeParse(cart(1, 601)).success).toBe(false);
    expect(asignarGmlSchema.safeParse(cart(200, 25)).success).toBe(true); // 5 000 justos
    const r = asignarGmlSchema.safeParse(cart(200, 26)); // 5 200
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Se admiten hasta 5 000 pares por bloque.");
    const pares = Array.from({ length: 5001 }, (_, i) => ({ marca_id: id(i % 9 + 1), nodo_id: id(i % 7 + 1) }));
    expect(asignarGmlSchema.safeParse({ forma: "pares", accion: "asignar", pares }).success).toBe(false);
  });
  it("rechaza forma o accion desconocidas, listas vacías y ids que no son uuid", () => {
    expect(asignarGmlSchema.safeParse({ ...cart(1, 1), forma: "otra" }).success).toBe(false);
    expect(asignarGmlSchema.safeParse({ ...cart(1, 1), accion: "borrar" }).success).toBe(false);
    expect(asignarGmlSchema.safeParse({ ...cart(1, 1), marca_ids: [] }).success).toBe(false);
    expect(asignarGmlSchema.safeParse({ ...cart(1, 1), nodo_ids: ["no-uuid"] }).success).toBe(false);
    expect(asignarGmlSchema.safeParse({ forma: "pares", accion: "asignar", pares: [] }).success).toBe(false);
    expect(asignarGmlSchema.safeParse({ accion: "asignar" }).success).toBe(false);
  });
  it("la nota opcional se normaliza", () => {
    const r = asignarGmlSchema.parse({ ...cart(1, 1), nota: " x " });
    expect(r.nota).toBe("x");
    expect(asignarGmlSchema.parse(cart(1, 1)).nota).toBeNull();
  });
});

describe("sugerenciasQuerySchema", () => {
  it("aplica los valores por defecto de la ficha", () => {
    expect(sugerenciasQuerySchema.parse({})).toEqual({ top: 4, min_participacion: 0.05, medida: "venta_soles" });
  });
  it("rechaza top fuera de 1..10 y min_participacion fuera de 0..0,5", () => {
    expect(sugerenciasQuerySchema.safeParse({ top: "0" }).success).toBe(false);
    expect(sugerenciasQuerySchema.safeParse({ top: "11" }).success).toBe(false);
    expect(sugerenciasQuerySchema.safeParse({ top: "2.5" }).success).toBe(false);
    expect(sugerenciasQuerySchema.safeParse({ top: "10" }).success).toBe(true);
    expect(sugerenciasQuerySchema.safeParse({ min_participacion: "-0.1" }).success).toBe(false);
    expect(sugerenciasQuerySchema.safeParse({ min_participacion: "0.51" }).success).toBe(false);
    expect(sugerenciasQuerySchema.parse({ min_participacion: "0.5" }).min_participacion).toBe(0.5);
    expect(sugerenciasQuerySchema.parse({ min_participacion: "0" }).min_participacion).toBe(0);
  });
  it("medida y meses", () => {
    expect(sugerenciasQuerySchema.parse({ medida: "unidades" }).medida).toBe("unidades");
    expect(sugerenciasQuerySchema.safeParse({ medida: "costo" }).success).toBe(false);
    expect(sugerenciasQuerySchema.parse({ desde: "2025-10", hasta: "2026-09" })).toMatchObject({ desde: "2025-10", hasta: "2026-09" });
    expect(sugerenciasQuerySchema.safeParse({ desde: "2025-13" }).success).toBe(false);
    expect(sugerenciasQuerySchema.safeParse({ desde: "2026-10", hasta: "2026-01" }).success).toBe(false);
  });
});

describe("estadoGmlQuerySchema, importarGmlSchema y query strings", () => {
  it("marca_id y nodo_id son uuid opcionales", () => {
    expect(estadoGmlQuerySchema.parse({})).toEqual({});
    expect(estadoGmlQuerySchema.safeParse({ marca_id: "x" }).success).toBe(false);
  });
  it("importarGmlSchema: nota por defecto '', entre 1 y 10 000 filas", () => {
    const fila = { marca: "A", genero: "H", mundo: "U", linea: "D" };
    expect(importarGmlSchema.parse({ modo: "previsualizar", filas: [fila] }).filas[0].nota).toBe("");
    expect(importarGmlSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarGmlSchema.safeParse({ modo: "ya", filas: [fila] }).success).toBe(false);
    expect(importarGmlSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 10_001 }, () => fila) }).success).toBe(false);
  });
  it("un parámetro vacío cuenta como ausente (no se convierte en 0)", () => {
    const p = new URLSearchParams("top=&desde= 2025-10 &medida=unidades");
    expect(parametrosNoVacios(p, ["top", "desde", "hasta", "medida"])).toEqual({ desde: "2025-10", medida: "unidades" });
    expect(sugerenciasQuerySchema.parse(parametrosNoVacios(p, ["top", "desde", "hasta", "medida"])).top).toBe(4);
  });
  it("incluir_inactivas acepta 1 y true (y la grafía incluir_inactivos)", () => {
    expect(pideInactivas(new URLSearchParams("incluir_inactivas=1"))).toBe(true);
    expect(pideInactivas(new URLSearchParams("incluir_inactivos=true"))).toBe(true);
    expect(pideInactivas(new URLSearchParams("incluir_inactivas=0"))).toBe(false);
    expect(pideInactivas(new URLSearchParams(""))).toBe(false);
  });
});
