import { describe, expect, it } from "vitest";
import { MENSAJE_DB_INESPERADO, describirErrorDb, nombreConstraint } from "@/lib/api/errores-db";

const unico = (indice: string) =>
  describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`, "Key (nombre)=(X) already exists.");

describe("nombreConstraint", () => {
  it("saca el nombre del índice del mensaje de Postgres", () => {
    expect(nombreConstraint('duplicate key value violates unique constraint "lineas_nombre_uniq"')).toBe("lineas_nombre_uniq");
    expect(nombreConstraint("sin constraint")).toBeNull();
  });
});

describe("describirErrorDb · 23505 único → 409", () => {
  it("deduce el recurso y el campo por el nombre del índice", () => {
    expect(unico("generos_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe un género con ese código." });
    expect(unico("generos_nombre_uniq").mensaje).toMatch(/género con ese nombre/);
    expect(unico("mundos_nombre_uniq").mensaje).toMatch(/mundo con ese nombre/);
    expect(unico("lineas_codigo_uniq").mensaje).toMatch(/línea con ese código/);
    expect(unico("lineas_nombre_uniq").mensaje).toMatch(/línea con ese nombre/);
    expect(unico("agrupaciones_talla_codigo_uniq").mensaje).toMatch(/agrupación de talla/);
  });
  it("distingue la tripleta y las equivalencias", () => {
    expect(unico("genero_mundo_linea_tripleta_uniq").mensaje).toMatch(/ya existe en ese género y mundo/);
    expect(unico("equivalencias_nodo_nombre_uniq").mensaje).toMatch(/equivalencia con ese nombre/);
    expect(unico("equivalencias_nodo_codigo_uniq").mensaje).toMatch(/equivalencia con ese código/);
    expect(unico("equivalencias_nodo_generica_uniq").mensaje).toMatch(/SIN EQUIVALENCIA/);
  });
  it("cae en un mensaje genérico 'Ya existe' si no reconoce el índice", () => {
    const r = unico("otra_cosa_uniq");
    expect(r.status).toBe(409);
    expect(r.mensaje).toMatch(/^Ya existe/);
  });
  it("todos los mensajes de único empiezan por 'Ya existe' o describen el duplicado", () => {
    for (const idx of ["generos_codigo_uniq", "lineas_nombre_uniq", "equivalencias_nodo_codigo_uniq"]) {
      expect(unico(idx).mensaje).toMatch(/^Ya existe/);
    }
  });
});

describe("describirErrorDb · 23503 FK → 409", () => {
  it("sugiere desactivar", () => {
    const r = describirErrorDb(
      "23503",
      'update or delete on table "lineas" violates foreign key constraint "genero_mundo_linea_linea_id_fkey" on table "genero_mundo_linea"'
    );
    expect(r).toEqual({ status: 409, mensaje: "No se puede eliminar: tiene registros asociados. Desactívalo." });
  });
});

describe("describirErrorDb · 23514 check → 400", () => {
  it("explica la temporada", () => {
    const r = describirErrorDb("23514", 'new row for relation "lineas" violates check constraint "lineas_temporada_check"');
    expect(r.status).toBe(400);
    expect(r.mensaje).toMatch(/Verano, Invierno o Todo el año/);
  });
  it("explica las longitudes", () => {
    expect(describirErrorDb("23514", 'violates check constraint "generos_nombre_len_check"').mensaje).toMatch(/1 y 120/);
    expect(describirErrorDb("23514", 'violates check constraint "lineas_codigo_len_check"').mensaje).toMatch(/1 y 40/);
  });
  it("tiene un mensaje por defecto", () => {
    expect(describirErrorDb("23514", 'violates check constraint "rara_check"')).toEqual({
      status: 400,
      mensaje: "Los datos no cumplen las reglas de la base.",
    });
  });
});

describe("describirErrorDb · resto → 500", () => {
  it("nunca filtra el mensaje de Postgres a la pantalla: siempre el genérico", () => {
    expect(describirErrorDb("42P01", 'relation "x" does not exist')).toEqual({ status: 500, mensaje: MENSAJE_DB_INESPERADO });
    expect(describirErrorDb("PGRST116", "JSON object requested, multiple (or no) rows returned")).toEqual({
      status: 500,
      mensaje: MENSAJE_DB_INESPERADO,
    });
    expect(describirErrorDb(undefined, "")).toEqual({ status: 500, mensaje: MENSAJE_DB_INESPERADO });
    expect(MENSAJE_DB_INESPERADO).toBe("Error inesperado en la base de datos.");
  });
});
