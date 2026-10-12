import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";
import { esConflictoOrigenMapeo } from "@/lib/ventas/consultas";
import {
  crearMapeosSchema,
  editarMapeoSchema,
  importarMapeosSchema,
  origenMapeoSchema,
  sugerirSchema,
} from "@/lib/ventas/esquemas";

/** Esquemas zod y errores de base de los mapeos de combinación (M5b). */

const U1 = "11111111-1111-4111-8111-111111111111";
const origen = { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" };
const crear = (mapeos: unknown[], extra: Record<string, unknown> = {}) => crearMapeosSchema.safeParse({ mapeos, ...extra });
const mensaje = (r: { success: boolean; error?: { issues: { message: string }[] } }) => (r.success ? null : (r.error?.issues[0]?.message ?? ""));

describe("origenMapeoSchema", () => {
  it("acepta uno, dos o tres piezas de la terna y la equivalencia con o sin comodín", () => {
    expect(origenMapeoSchema.safeParse(origen).success).toBe(true);
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: "*" }).success).toBe(true);
    expect(origenMapeoSchema.safeParse({ genero: "", mundo: "", linea: "DENIM", equivalencia: "SIN EQUIVALENCIA" }).success).toBe(true);
    expect(origenMapeoSchema.safeParse({ genero: "HOMBRE", mundo: "", linea: "", equivalencia: "X" }).success).toBe(true);
  });

  it("rechaza los tres en blanco (también con solo espacios)", () => {
    const r = origenMapeoSchema.safeParse({ genero: "", mundo: "  ", linea: "", equivalencia: "X" });
    expect(r.success).toBe(false);
    expect(mensaje(r)).toContain("al menos género, mundo o línea");
  });

  it("sin comodines en género, mundo ni línea; en la equivalencia solo `*` solo", () => {
    for (const campo of ["genero", "mundo", "linea"] as const) {
      const r = origenMapeoSchema.safeParse({ ...origen, [campo]: "*" });
      expect(r.success, campo).toBe(false);
      expect(mensaje(r)).toContain("solo se admite en la equivalencia");
    }
    expect(origenMapeoSchema.safeParse({ ...origen, linea: "DEN*" }).success).toBe(false);
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: "JE*" }).success).toBe(false);
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: " * " }).success).toBe(true);
  });

  it("la equivalencia no puede quedar vacía y ninguna pieza pasa de 120 caracteres", () => {
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: "  " }).success).toBe(false);
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: "A".repeat(121) }).success).toBe(false);
    expect(origenMapeoSchema.safeParse({ ...origen, equivalencia: "A".repeat(120) }).success).toBe(true);
    expect(origenMapeoSchema.safeParse({ ...origen, genero: "A".repeat(121) }).success).toBe(false);
  });
});

describe("crearMapeosSchema", () => {
  const item = { origen, equivalencia_id: U1 };

  it("1 a 500 items; `reemplazar` es falso por defecto", () => {
    const r = crear([item]);
    expect(r.success && r.data.reemplazar).toBe(false);
    expect(crear([item], { reemplazar: true }).success).toBe(true);
    expect(crear([]).success).toBe(false);
    expect(crear(Array.from({ length: 500 }, () => item)).success).toBe(true);
    expect(crear(Array.from({ length: 501 }, () => item)).success).toBe(false);
  });

  it("equivalencia_id uuid, motivo de la lista de once y nota hasta 200", () => {
    expect(crear([{ ...item, equivalencia_id: "no-uuid" }]).success).toBe(false);
    expect(crear([{ ...item, motivo_origen: "clasificacion_incompleta" }]).success).toBe(true);
    expect(crear([{ ...item, motivo_origen: "sin_clasificar" }]).success).toBe(false);
    expect(crear([{ ...item, nota: "x".repeat(200) }]).success).toBe(true);
    const larga = crear([{ ...item, nota: "x".repeat(201) }]);
    expect(mensaje(larga)).toContain("200");
  });

  it("el mensaje de error nombra la posición del item", () => {
    const r = crearMapeosSchema.safeParse({ mapeos: [item, { origen: { ...origen, genero: "*" }, equivalencia_id: U1 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path.slice(0, 2)).toEqual(["mapeos", 1]);
  });
});

describe("editarMapeoSchema", () => {
  it("al menos un campo; la nota puede ser null para borrarla", () => {
    expect(editarMapeoSchema.safeParse({}).success).toBe(false);
    expect(editarMapeoSchema.safeParse({ nota: null }).success).toBe(true);
    expect(editarMapeoSchema.safeParse({ activo: false }).success).toBe(true);
    expect(editarMapeoSchema.safeParse({ equivalencia_id: U1 }).success).toBe(true);
    expect(editarMapeoSchema.safeParse({ equivalencia_id: "x" }).success).toBe(false);
    expect(editarMapeoSchema.safeParse({ activo: "si" }).success).toBe(false);
    expect(editarMapeoSchema.safeParse({ nota: "x".repeat(201) }).success).toBe(false);
  });
});

describe("sugerirSchema", () => {
  it("1 a 500 orígenes sin `*`; admite orígenes con piezas en blanco", () => {
    expect(sugerirSchema.safeParse({ combinaciones: [origen, { genero: "", mundo: "", linea: "DENIM", equivalencia: "MOM" }] }).success).toBe(true);
    expect(sugerirSchema.safeParse({ combinaciones: [] }).success).toBe(false);
    expect(sugerirSchema.safeParse({ combinaciones: Array.from({ length: 501 }, () => origen) }).success).toBe(false);
    expect(sugerirSchema.safeParse({ combinaciones: [{ ...origen, equivalencia: "*" }] }).success).toBe(false);
    expect(sugerirSchema.safeParse({ combinaciones: [{ ...origen, genero: "*" }] }).success).toBe(false);
  });
});

describe("importarMapeosSchema", () => {
  const fila = {
    ORIGEN_GENERO: "HOMBRE",
    ORIGEN_MUNDO: "CASUAL",
    ORIGEN_LINEA: "DENIM",
    ORIGEN_EQUIVALENCIA: "JEAN",
    DESTINO_GENERO: "HOMBRE",
    DESTINO_MUNDO: "CASUAL",
    DESTINO_LINEA: "DENIM",
    DESTINO_EQUIVALENCIA: "-",
  };

  it("modo previsualizar o aplicar; 1 a 5 000 filas; NOTA opcional", () => {
    expect(importarMapeosSchema.safeParse({ modo: "previsualizar", filas: [fila] }).success).toBe(true);
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: [{ ...fila, NOTA: "x" }] }).success).toBe(true);
    expect(importarMapeosSchema.safeParse({ modo: "otro", filas: [fila] }).success).toBe(false);
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: [] }).success).toBe(false);
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 5_000 }, () => fila) }).success).toBe(true);
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: Array.from({ length: 5_001 }, () => fila) }).success).toBe(false);
  });

  it("las celdas son texto de hasta 120 caracteres; una fila sin columnas obligatorias se rechaza", () => {
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: [{ ...fila, ORIGEN_LINEA: "A".repeat(121) }] }).success).toBe(false);
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: [{ ...fila, ORIGEN_LINEA: 5 }] }).success).toBe(false);
    const incompleta: Record<string, string> = { ...fila };
    delete incompleta.DESTINO_LINEA;
    expect(importarMapeosSchema.safeParse({ modo: "aplicar", filas: [incompleta] }).success).toBe(false);
  });
});

describe("errores de Postgres de los mapeos", () => {
  it("origen repetido (único) → 409 con mensaje propio", () => {
    expect(describirErrorDb("23505", 'duplicate key value violates unique constraint "mapeos_combinacion_origen_uniq"')).toEqual({
      status: 409,
      mensaje: "Ese origen ya tiene un mapeo.",
    });
  });

  it("checks: nota, terna vacía, equivalencia vacía y largos → 400", () => {
    const check = (n: string) => describirErrorDb("23514", `new row for relation "mapeos_combinacion" violates check constraint "${n}"`);
    expect(check("mapeos_combinacion_nota_len_check")).toMatchObject({ status: 400, mensaje: "La nota no puede superar 200 caracteres." });
    expect(check("mapeos_combinacion_terna_no_vacia_check").mensaje).toContain("al menos género, mundo o línea");
    expect(check("mapeos_combinacion_origen_equivalencia_check").mensaje).toContain("equivalencia de origen");
    expect(check("mapeos_combinacion_origen_linea_len_check").mensaje).toContain("120");
  });

  it("FK al destino: guardar contra una equivalencia que ya no existe → 404", () => {
    const fk = "mapeos_combinacion_equivalencia_id_fkey";
    expect(describirErrorDb("23503", `insert or update on table "mapeos_combinacion" violates foreign key constraint "${fk}"`)).toEqual({
      status: 404,
      mensaje: "Equivalencia no encontrada.",
    });
  });
});

describe("carrera en el alta: el 23505 del origen se reconoce para responder 409 origen_repetido", () => {
  const unico = 'duplicate key value violates unique constraint "mapeos_combinacion_origen_uniq"';
  it("solo el único del origen cuenta", () => {
    expect(esConflictoOrigenMapeo({ code: "23505", message: unico, details: "" })).toBe(true);
    expect(esConflictoOrigenMapeo({ code: "23505", message: "duplicate key", details: 'Key … constraint "mapeos_combinacion_origen_uniq"' })).toBe(true);
    expect(esConflictoOrigenMapeo({ code: "23505", message: 'violates unique constraint "marcas_nombre_uniq"', details: "" })).toBe(false);
    expect(esConflictoOrigenMapeo({ code: "23503", message: unico, details: "" })).toBe(false);
  });
});
