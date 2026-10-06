import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

const unico = (indice: string) =>
  describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`, "Key (upper(codigo))=(R401) already exists.");

const check = (nombre: string) => describirErrorDb("23514", `new row for relation "tiendas" violates check constraint "${nombre}"`);

describe("errores-db · únicos de M4", () => {
  it("código y nombre de tienda", () => {
    expect(unico("tiendas_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe una tienda con ese código." });
    expect(unico("tiendas_nombre_uniq")).toEqual({ status: 409, mensaje: "Ya existe una tienda con ese nombre." });
  });
  it("los de M1–M3 siguen igual", () => {
    expect(unico("marcas_codigo_uniq").mensaje).toBe("Ya existe una marca con ese código.");
    expect(unico("lineas_nombre_uniq").mensaje).toBe("Ya existe una línea con ese nombre.");
  });
});

describe("errores-db · checks de M4 (nombres reales de la migración)", () => {
  it("tipo, fechas y venta", () => {
    expect(check("tiendas_tipo_check")).toEqual({ status: 400, mensaje: "El tipo debe ser Tienda o Centro de Distribución." });
    expect(check("tiendas_cierre_requiere_apertura_check")).toEqual({
      status: 400,
      mensaje: "Para registrar un cierre, la tienda necesita fecha de apertura.",
    });
    expect(check("tiendas_cierre_apertura_check")).toEqual({
      status: 400,
      mensaje: "La fecha de cierre no puede ser anterior a la de apertura.",
    });
    expect(check("tiendas_venta_no_negativa_check")).toEqual({ status: 400, mensaje: "La venta esperada no puede ser negativa." });
    expect(check("tiendas_venta_solo_tienda_check")).toEqual({
      status: 400,
      mensaje: "Un centro de distribución no lleva venta esperada.",
    });
  });
  it("longitudes: zona y razón social propias; código y nombre por los genéricos", () => {
    expect(check("tiendas_zona_len_check").mensaje).toBe("La zona no puede superar 120 caracteres.");
    expect(check("tiendas_razon_social_len_check").mensaje).toBe("La razón social no puede superar 120 caracteres.");
    expect(check("tiendas_codigo_len_check").mensaje).toBe("El código debe tener entre 1 y 40 caracteres.");
    expect(check("tiendas_nombre_len_check").mensaje).toBe("El nombre debe tener entre 1 y 120 caracteres.");
  });
});
