import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";

const check = (tabla: string, nombre: string) =>
  describirErrorDb("23514", `new row for relation "${tabla}" violates check constraint "${nombre}"`);

describe("errores-db · checks de periodos_atipicos (M6 paso 1)", () => {
  it("cada check de la migración 0011 tiene un mensaje propio en castellano y status 400", () => {
    const esperados: Array<[string, RegExp]> = [
      ["periodos_atipicos_desde_dia1_check", /primer día/],
      ["periodos_atipicos_hasta_dia1_check", /primer día/],
      ["periodos_atipicos_rango_check", /no puede ser anterior/],
      ["periodos_atipicos_motivo_len_check", /1 y 120/],
      ["periodos_atipicos_descripcion_len_check", /500/],
      ["periodos_atipicos_alcance_check", /invierno o todas/],
    ];
    for (const [nombre, patron] of esperados) {
      const r = check("periodos_atipicos", nombre);
      expect(r.status, nombre).toBe(400);
      expect(r.mensaje, nombre).toMatch(patron);
      expect(r.mensaje, nombre).not.toBe("Los datos no cumplen las reglas de la base.");
    }
  });
  it("el check de temporada de la agrupación", () => {
    expect(check("agrupaciones_estacionalidad", "agrupaciones_estacionalidad_temporada_check")).toEqual({
      status: 400,
      mensaje: "La temporada debe ser invierno, verano o todo_el_ano.",
    });
  });
  it("no confunde el check de temporada de la agrupación con el de la línea de M1", () => {
    expect(check("lineas", "lineas_temporada_check").mensaje).toBe("La temporada debe ser Verano, Invierno o Todo el año.");
  });
});
