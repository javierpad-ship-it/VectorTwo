import { describe, expect, it } from "vitest";
import { describirErrorDb, MENSAJE_CALCULO_EN_CURSO } from "@/lib/api/errores-db";

describe("errores-db · M6 paso 2", () => {
  it("el lock de aviso del cálculo (55P03 o el mensaje calculo_en_curso) → 409 con mensaje de pantalla", () => {
    expect(describirErrorDb("55P03", "calculo_en_curso")).toEqual({ status: 409, mensaje: MENSAJE_CALCULO_EN_CURSO });
    expect(describirErrorDb(null, "ERROR: calculo_en_curso")).toMatchObject({ status: 409 });
    expect(MENSAJE_CALCULO_EN_CURSO).toMatch(/otro cálculo/);
  });
  it("el único parcial de curvas vigentes → 409 «ya tiene una curva vigente»", () => {
    const r = describirErrorDb("23505", 'duplicate key value violates unique constraint "curvas_estacionalidad_vigente_uniq"');
    expect(r).toEqual({ status: 409, mensaje: "Esa agrupación ya tiene una curva vigente; vuelve a cargar." });
  });
  it("un único de versión y el de corrida de referencia tienen mensaje propio", () => {
    expect(describirErrorDb("23505", 'duplicate key value violates unique constraint "curvas_estacionalidad_agrupacion_version_key"').mensaje).toMatch(/versión/);
    expect(describirErrorDb("23505", 'duplicate key value violates unique constraint "corridas_estacionalidad_referencia_uniq"').mensaje).toMatch(/referencia/);
  });
  it("la FK de la agrupación: eliminar con curvas es 409 legible; asignar una inexistente es 404", () => {
    const eliminar = describirErrorDb(
      "23503",
      'update or delete on table "agrupaciones_estacionalidad" violates foreign key constraint "curvas_estacionalidad_agrupacion_fkey" on table "curvas_estacionalidad"'
    );
    expect(eliminar.status).toBe(409);
    expect(eliminar.mensaje).toMatch(/tiene curvas/);
    const asignar = describirErrorDb(
      "23503",
      'insert or update on table "curvas_estacionalidad" violates foreign key constraint "curvas_estacionalidad_agrupacion_fkey"'
    );
    expect(asignar.status).toBe(404);
  });
  it("la FK de la corrida", () => {
    expect(
      describirErrorDb("23503", 'update or delete on table "corridas_estacionalidad" violates foreign key constraint "curvas_estacionalidad_corrida_id_fkey" on table "curvas_estacionalidad"').mensaje
    ).toMatch(/curvas aprobadas/);
  });
  it("los checks de la curva y de periodos con temporadas", () => {
    const check = (n: string) => describirErrorDb("23514", `new row violates check constraint "${n}"`);
    expect(check("curvas_estacionalidad_suma_check")).toMatchObject({ status: 400, mensaje: expect.stringMatching(/sumar 1/) });
    expect(check("curvas_estacionalidad_p03_check").mensaje).toMatch(/entre 0 y 1/);
    expect(check("curvas_estacionalidad_nota_len_check").mensaje).toMatch(/300/);
    expect(check("periodos_atipicos_temporadas_check").mensaje).toMatch(/una a tres/);
    expect(check("corridas_estacionalidad_resultado_size_check").mensaje).toMatch(/demasiado grande/);
  });
});
