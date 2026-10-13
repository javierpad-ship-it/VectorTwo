import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

/** M2b: los errores de Postgres que el usuario puede provocar se traducen a mensajes de pantalla. */

const unico = (indice: string) =>
  describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`, "Key (marca_id, genero_mundo_linea_id)=(a, b) already exists.");
const check = (tabla: string, nombre: string) => describirErrorDb("23514", `new row for relation "${tabla}" violates check constraint "${nombre}"`);
const borrar = (padre: string, fk: string, hijo: string) =>
  describirErrorDb("23503", `update or delete on table "${padre}" violates foreign key constraint "${fk}" on table "${hijo}"`);
const asignar = (hijo: string, fk: string) =>
  describirErrorDb("23503", `insert or update on table "${hijo}" violates foreign key constraint "${fk}"`);

describe("errores-db · M2b: único", () => {
  it("el par marca × GML repetido → 409", () => {
    expect(unico("marca_gml_especial_par_uniq")).toEqual({ status: 409, mensaje: "Esa marca ya es relevante en ese GML." });
  });
});

describe("errores-db · M2b: checks", () => {
  it("nivel de planificación, modalidad y nota", () => {
    expect(check("genero_mundo_linea", "genero_mundo_linea_nivel_check")).toEqual({
      status: 400,
      mensaje: "El nivel de planificación debe ser GML o GMLE.",
    });
    expect(check("marcas", "marcas_modalidad_valor_check")).toEqual({ status: 400, mensaje: "La modalidad debe ser por_gml o barrido." });
    expect(check("marcas", "marcas_modalidad_sin_tratamiento_check")).toEqual({
      status: 400,
      mensaje: "La modalidad solo se guarda si la marca tiene tratamiento especial.",
    });
    expect(check("marca_gml_especial", "marca_gml_especial_nota_len_check")).toEqual({
      status: 400,
      mensaje: "La nota no puede superar 200 caracteres.",
    });
  });
  it("una marca no puede ser su propio conjunto", () => {
    expect(check("marcas", "marcas_conjunto_no_propio_check")).toEqual({ status: 400, mensaje: "Una marca no puede ser su propio conjunto." });
  });
  it("las notas de M2 siguen igual", () => {
    expect(check("marcas", "marcas_nota_sin_tratamiento_check").mensaje).toBe("La nota solo se guarda si la marca tiene tratamiento especial.");
  });
});

describe("errores-db · M2b: llaves foráneas", () => {
  it("eliminar un nodo con marcas relevantes → 409; asignar a un nodo inexistente → 404", () => {
    expect(borrar("genero_mundo_linea", "marca_gml_especial_gml_id_fkey", "marca_gml_especial")).toEqual({
      status: 409,
      mensaje: "No se puede eliminar el nodo: tiene marcas relevantes asignadas. Quítalas o desactívalo.",
    });
    expect(asignar("marca_gml_especial", "marca_gml_especial_gml_id_fkey")).toEqual({
      status: 404,
      mensaje: "Nodo género-mundo-línea no encontrado.",
    });
  });
  it("asignar a una marca inexistente → 404", () => {
    expect(asignar("marca_gml_especial", "marca_gml_especial_marca_id_fkey")).toEqual({ status: 404, mensaje: "Marca no encontrada." });
  });
  it("eliminar la cabeza de un conjunto con marcas → 409; apuntar a una cabeza inexistente → 404", () => {
    expect(borrar("marcas", "marcas_conjunto_marca_id_fkey", "marcas")).toEqual({
      status: 409,
      mensaje: "No se puede eliminar la marca: es cabeza de un conjunto con marcas. Quítalas o desactívala.",
    });
    expect(asignar("marcas", "marcas_conjunto_marca_id_fkey")).toEqual({ status: 404, mensaje: "Marca cabeza no encontrada." });
  });
  it("las otras FK de marcas siguen con su mensaje", () => {
    expect(borrar("marcas", "venta_stock_mensual_marca_id_fkey", "venta_stock_mensual").mensaje).toBe(
      "No se puede eliminar: tiene venta o stock cargados. Desactívala."
    );
    expect(borrar("agrupaciones_marca", "marcas_agrupacion_marca_id_fkey", "marcas").mensaje).toBe(
      "No se puede eliminar la agrupación de marca: tiene marcas. Desactívala."
    );
  });
});
