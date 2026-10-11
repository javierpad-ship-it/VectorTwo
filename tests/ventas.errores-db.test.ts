import { describe, expect, it } from "vitest";
import { describirErrorDb } from "@/lib/api/errores-db";
import { leerResultadoPublicar, comoObjeto, nombreDeUsuario } from "@/lib/ventas/http";

const msgEliminar = (tabla: string, fk: string) =>
  `update or delete on table "${tabla}" violates foreign key constraint "${fk}" on table "venta_stock_mensual"`;
const msgAsignar = (fk: string) => `insert or update on table "venta_stock_mensual" violates foreign key constraint "${fk}"`;

describe("errores de Postgres de M5", () => {
  const casos: [string, string, string, string][] = [
    ["marcas", "venta_stock_mensual_marca_id_fkey", "Marca no encontrada.", "marca"],
    ["tiendas", "venta_stock_mensual_tienda_id_fkey", "Tienda no encontrada.", "tienda"],
    ["equivalencias", "venta_stock_mensual_equivalencia_id_fkey", "Equivalencia no encontrada.", "equivalencia"],
    ["agrupaciones_talla", "venta_stock_mensual_agrupacion_talla_id_fkey", "Agrupación de talla no encontrada.", "talla"],
  ];

  it.each(casos)("eliminar %s con histórico responde 409 y la rama asignar 404", (tabla, fk, noEncontrada) => {
    expect(describirErrorDb("23503", msgEliminar(tabla, fk))).toEqual({
      status: 409,
      mensaje: "No se puede eliminar: tiene venta o stock cargados. Desactívala.",
    });
    expect(describirErrorDb("23503", msgAsignar(fk))).toEqual({ status: 404, mensaje: noEncontrada });
  });

  it("los únicos de cargas", () => {
    expect(describirErrorDb("23505", 'duplicate key value violates unique constraint "cargas_periodo_en_curso_uniq"')).toEqual({
      status: 409,
      mensaje: "Ya hay una carga en curso de ese mes.",
    });
    expect(describirErrorDb("23505", 'duplicate key value violates unique constraint "cargas_periodo_publicada_uniq"').mensaje).toBe(
      "Ese mes ya tiene una carga publicada."
    );
  });
});

describe("ayudas de los handlers", () => {
  it("interpreta el jsonb de la publicación", () => {
    const medido = { filas: 3, unidades: 4, venta_soles: 5.5, costo_vendido: 2, stock_unidades: 1, stock_valorizado: 9 };
    expect(leerResultadoPublicar({ ok: true, medido, reemplaza: null })).toEqual({ ok: true, medido, reemplaza: null });
    expect(leerResultadoPublicar({ ok: true, medido, reemplaza: { id: "c1", filas: 7 } })).toMatchObject({
      reemplaza: { id: "c1", filas: 7 },
    });
    expect(leerResultadoPublicar({ ok: false, motivo: "no_en_curso" })).toEqual({ ok: false, motivo: "no_en_curso" });
    expect(leerResultadoPublicar({ ok: false, motivo: "no_concilia", esperado: { ...medido, filas: 9 }, medido })).toEqual({
      ok: false,
      motivo: "no_concilia",
      esperado: { ...medido, filas: 9 },
      medido,
    });
    expect(leerResultadoPublicar(null)).toEqual({ ok: false, motivo: "no_en_curso" });
    expect(leerResultadoPublicar("raro")).toEqual({ ok: false, motivo: "no_en_curso" });
  });

  it("nombre de usuario y objetos", () => {
    expect(nombreDeUsuario({ nombre: " Ana ", email: "a@x.pe" })).toBe("Ana");
    expect(nombreDeUsuario({ nombre: null, email: "a@x.pe" })).toBe("a@x.pe");
    expect(nombreDeUsuario({ nombre: "  ", email: "a@x.pe" })).toBe("a@x.pe");
    expect(comoObjeto([1])).toBeNull();
    expect(comoObjeto({ a: 1 })).toEqual({ a: 1 });
  });
});
