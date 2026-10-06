import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

const unico = (indice: string) =>
  describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`, "Key (nombre)=(X) already exists.");

const check = (nombre: string) =>
  describirErrorDb("23514", `new row for relation "agrupaciones_estacionalidad" violates check constraint "${nombre}"`);

describe("errores-db · únicos de M3", () => {
  it("código y nombre de agrupaciones de estacionalidad", () => {
    expect(unico("agrupaciones_estacionalidad_codigo_uniq")).toEqual({
      status: 409,
      mensaje: "Ya existe una agrupación de estacionalidad con ese código.",
    });
    expect(unico("agrupaciones_estacionalidad_nombre_uniq")).toEqual({
      status: 409,
      mensaje: "Ya existe una agrupación de estacionalidad con ese nombre.",
    });
  });
  it("los de M1 y M2 siguen igual", () => {
    expect(unico("agrupaciones_marca_codigo_uniq").mensaje).toMatch(/agrupación de marca/);
    expect(unico("equivalencias_nodo_nombre_uniq").mensaje).toMatch(/equivalencia/);
  });
});

describe("errores-db · checks de M3", () => {
  it("descripción larga", () => {
    expect(check("agrupaciones_estacionalidad_descripcion_len_check")).toEqual({
      status: 400,
      mensaje: "La descripción no puede superar 500 caracteres.",
    });
  });
  it("longitudes de código y nombre", () => {
    expect(check("agrupaciones_estacionalidad_codigo_len_check").mensaje).toMatch(/1 y 40/);
    expect(check("agrupaciones_estacionalidad_nombre_len_check").mensaje).toMatch(/1 y 120/);
  });
});

describe("errores-db · FK equivalencias → agrupaciones_estacionalidad", () => {
  it("borrar una agrupación con equivalencias → 409 'Desactívala'", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "agrupaciones_estacionalidad" violates foreign key constraint "equivalencias_agrupacion_estacionalidad_id_fkey" on table "equivalencias"'
    );
    expect(r).toEqual({
      status: 409,
      mensaje: "No se puede eliminar la agrupación de estacionalidad: tiene equivalencias. Desactívala.",
    });
  });
  it("asignar una agrupación inexistente → 404", () => {
    const r = describirErrorDb(
      "23503",
      'insert or update on table "equivalencias" violates foreign key constraint "equivalencias_agrupacion_estacionalidad_id_fkey"'
    );
    expect(r).toEqual({ status: 404, mensaje: "Agrupación de estacionalidad no encontrada." });
  });
  it("la FK de equivalencias → nodo conserva el mensaje genérico", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "genero_mundo_linea" violates foreign key constraint "equivalencias_genero_mundo_linea_id_fkey" on table "equivalencias"'
    );
    expect(r).toEqual({ status: 409, mensaje: "No se puede eliminar: tiene registros asociados. Desactívalo." });
  });
});

describe("errores-db · géneros de una agrupación (agrupacion_estacionalidad_genero)", () => {
  it("único de la pareja → 409 'Esa agrupación ya incluye ese género.'", () => {
    const r = describirErrorDb(
      "23505",
      'duplicate key value violates unique constraint "agrupacion_estacionalidad_genero_par_uniq"',
      "Key (agrupacion_estacionalidad_id, genero_id)=(a, b) already exists."
    );
    expect(r).toEqual({ status: 409, mensaje: "Esa agrupación ya incluye ese género." });
  });
  it("borrar un género con agrupaciones asignadas → 409", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "generos" violates foreign key constraint "agrupacion_estacionalidad_genero_genero_id_fkey" on table "agrupacion_estacionalidad_genero"'
    );
    expect(r).toEqual({
      status: 409,
      mensaje:
        "No se puede eliminar el género: tiene agrupaciones de estacionalidad asignadas. Quítalo de ellas o desactívalo.",
    });
  });
  it("asignar un género inexistente → 404 'Género no encontrado.'", () => {
    const r = describirErrorDb(
      "23503",
      'insert or update on table "agrupacion_estacionalidad_genero" violates foreign key constraint "agrupacion_estacionalidad_genero_genero_id_fkey"'
    );
    expect(r).toEqual({ status: 404, mensaje: "Género no encontrado." });
  });
  it("asignar géneros a una agrupación inexistente → 404 'Agrupación de estacionalidad no encontrada.'", () => {
    const r = describirErrorDb(
      "23503",
      'insert or update on table "agrupacion_estacionalidad_genero" violates foreign key constraint "agrupacion_estacionalidad_genero_agrupacion_id_fkey"'
    );
    expect(r).toEqual({ status: 404, mensaje: "Agrupación de estacionalidad no encontrada." });
  });
  it("las FK de equivalencias y los únicos de agrupaciones no se confunden con las nuevas", () => {
    expect(
      describirErrorDb(
        "23503",
        'insert or update on table "equivalencias" violates foreign key constraint "equivalencias_agrupacion_estacionalidad_id_fkey"'
      ).mensaje
    ).toBe("Agrupación de estacionalidad no encontrada.");
    expect(unico("agrupaciones_estacionalidad_nombre_uniq").mensaje).toBe(
      "Ya existe una agrupación de estacionalidad con ese nombre."
    );
  });
});
