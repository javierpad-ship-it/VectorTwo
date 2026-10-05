import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

const unico = (indice: string) =>
  describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`, "Key (nombre)=(X) already exists.");

const check = (nombre: string) => describirErrorDb("23514", `new row for relation "marcas" violates check constraint "${nombre}"`);

describe("errores-db · únicos de M2", () => {
  it("agrupaciones de marca", () => {
    expect(unico("agrupaciones_marca_codigo_uniq")).toEqual({
      status: 409,
      mensaje: "Ya existe una agrupación de marca con ese código.",
    });
    expect(unico("agrupaciones_marca_nombre_uniq")).toEqual({
      status: 409,
      mensaje: "Ya existe una agrupación de marca con ese nombre.",
    });
  });
  it("marcas", () => {
    expect(unico("marcas_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe una marca con ese código." });
    expect(unico("marcas_nombre_uniq")).toEqual({ status: 409, mensaje: "Ya existe una marca con ese nombre." });
  });
  it("los de M1 siguen igual", () => {
    expect(unico("lineas_nombre_uniq").mensaje).toBe("Ya existe una línea con ese nombre.");
    expect(unico("agrupaciones_talla_codigo_uniq").mensaje).toMatch(/agrupación de talla/);
  });
});

describe("errores-db · checks de M2", () => {
  it("nota larga y nota sin tratamiento", () => {
    expect(check("marcas_nota_len_check")).toEqual({ status: 400, mensaje: "La nota no puede superar 200 caracteres." });
    expect(check("marcas_nota_sin_tratamiento_check")).toEqual({
      status: 400,
      mensaje: "La nota solo se guarda si la marca tiene tratamiento especial.",
    });
  });
  it("longitudes de código y nombre de las tablas nuevas", () => {
    expect(check("marcas_codigo_len_check").mensaje).toMatch(/1 y 40/);
    expect(check("agrupaciones_marca_nombre_len_check").mensaje).toMatch(/1 y 120/);
  });
});

describe("errores-db · FK marcas → agrupaciones_marca", () => {
  it("borrar una agrupación con marcas → 409 con mensaje propio", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "agrupaciones_marca" violates foreign key constraint "marcas_agrupacion_marca_id_fkey" on table "marcas"'
    );
    expect(r).toEqual({ status: 409, mensaje: "No se puede eliminar la agrupación de marca: tiene marcas. Desactívala." });
  });
  it("asignar una agrupación inexistente → 404", () => {
    const r = describirErrorDb(
      "23503",
      'insert or update on table "marcas" violates foreign key constraint "marcas_agrupacion_marca_id_fkey"'
    );
    expect(r).toEqual({ status: 404, mensaje: "Agrupación de marca no encontrada." });
  });
  it("otras FK conservan el mensaje genérico", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "lineas" violates foreign key constraint "genero_mundo_linea_linea_id_fkey" on table "genero_mundo_linea"'
    );
    expect(r).toEqual({ status: 409, mensaje: "No se puede eliminar: tiene registros asociados. Desactívalo." });
  });
});
