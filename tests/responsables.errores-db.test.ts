import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

describe("regla 14 · errores-db de M1b", () => {
  it("único de la pareja → 409 'ya tiene responsable'", () => {
    expect(
      describirErrorDb(
        "23505",
        'duplicate key value violates unique constraint "responsables_genero_mundo_par_uniq"',
        "Key (genero_id, mundo_id)=(a, b) already exists."
      )
    ).toEqual({ status: 409, mensaje: "Esa combinación género-mundo ya tiene responsable." });
  });

  it("asignar a un usuario que ya no existe → 404", () => {
    expect(
      describirErrorDb(
        "23503",
        'insert or update on table "responsables_genero_mundo" violates foreign key constraint "responsables_genero_mundo_perfil_id_fkey"'
      )
    ).toEqual({ status: 404, mensaje: "Usuario no encontrado." });
  });

  it("asignar a un género o mundo que ya no existe → 404", () => {
    expect(
      describirErrorDb(
        "23503",
        'insert or update on table "responsables_genero_mundo" violates foreign key constraint "responsables_genero_mundo_genero_id_fkey"'
      )
    ).toEqual({ status: 404, mensaje: "Género no encontrado." });
    expect(
      describirErrorDb(
        "23503",
        'insert or update on table "responsables_genero_mundo" violates foreign key constraint "responsables_genero_mundo_mundo_id_fkey"'
      )
    ).toEqual({ status: 404, mensaje: "Mundo no encontrado." });
  });

  it("eliminar un género sin nodos pero con responsables → 409 claro", () => {
    expect(
      describirErrorDb(
        "23503",
        'update or delete on table "generos" violates foreign key constraint "responsables_genero_mundo_genero_id_fkey" on table "responsables_genero_mundo"',
        'Key (id)=(x) is still referenced from table "responsables_genero_mundo".'
      )
    ).toEqual({
      status: 409,
      mensaje: "No se puede eliminar el género: tiene responsables asignados. Quítalos o desactívalo.",
    });
  });

  it("eliminar un mundo sin nodos pero con responsables → 409 claro", () => {
    expect(
      describirErrorDb(
        "23503",
        'update or delete on table "mundos" violates foreign key constraint "responsables_genero_mundo_mundo_id_fkey" on table "responsables_genero_mundo"'
      )
    ).toEqual({
      status: 409,
      mensaje: "No se puede eliminar el mundo: tiene responsables asignados. Quítalos o desactívalo.",
    });
  });

  it("la FK del perfil, al borrar, cae al texto genérico (con cascade no debería verse)", () => {
    expect(
      describirErrorDb(
        "23503",
        'update or delete on table "perfiles" violates foreign key constraint "responsables_genero_mundo_perfil_id_fkey" on table "responsables_genero_mundo"'
      )
    ).toEqual({ status: 409, mensaje: "No se puede eliminar: tiene registros asociados. Desactívalo." });
  });

  it("no pisa las FK ni los únicos de M1–M4", () => {
    expect(
      describirErrorDb(
        "23503",
        'update or delete on table "generos" violates foreign key constraint "agrupacion_estacionalidad_genero_genero_id_fkey" on table "agrupacion_estacionalidad_genero"'
      ).mensaje
    ).toMatch(/agrupaciones de estacionalidad/);
    expect(
      describirErrorDb("23505", 'duplicate key value violates unique constraint "genero_mundo_linea_tripleta_uniq"').mensaje
    ).toBe("Esa línea ya existe en ese género y mundo.");
    expect(
      describirErrorDb(
        "23503",
        'update or delete on table "generos" violates foreign key constraint "genero_mundo_linea_genero_id_fkey" on table "genero_mundo_linea"'
      ).mensaje
    ).toBe("No se puede eliminar: tiene registros asociados. Desactívalo.");
  });
});
