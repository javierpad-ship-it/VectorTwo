import { describe, expect, it } from "vitest";
import { abrirCargaSchema, marcasNuevasSchema, medidasSchema, previsualizarSchema, publicarSchema, tandaSchema } from "@/lib/ventas/esquemas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const dic = { tiendas: [U1], equivalencias: [U2], marcas: [U3] };
const filaOk = [0, 0, 0, 0, 5, 100.5, 40, 20, 80.25];

const tanda = (filas: unknown[], diccionario: unknown = dic) => ({ tanda: 1, diccionario, filas });

describe("tandaSchema (regla 35)", () => {
  it("acepta una tanda válida, también con negativos y 10 000 filas", () => {
    expect(tandaSchema.safeParse(tanda([filaOk])).success).toBe(true);
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 1, -3, -50.5, -10, -2, -1.5]])).success).toBe(true);
    expect(tandaSchema.safeParse(tanda(Array.from({ length: 10_000 }, () => filaOk))).success).toBe(true);
  });

  it("rechaza índices fuera del diccionario", () => {
    expect(tandaSchema.safeParse(tanda([[1, 0, 0, 0, 1, 1, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 1, 0, 0, 1, 1, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 0, 1, 0, 1, 1, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[-1, 0, 0, 0, 1, 1, 1, 1, 1]])).success).toBe(false);
    const r = tandaSchema.safeParse(tanda([filaOk, [5, 0, 0, 0, 1, 1, 1, 1, 1]]));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("fuera de su diccionario");
  });

  it("rechaza talla distinta de 0 o 1", () => {
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 2, 1, 1, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, -1, 1, 1, 1, 1, 1]])).success).toBe(false);
  });

  it("rechaza NaN, Infinity y enteros con decimales", () => {
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 1, Number.NaN, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 1, Number.POSITIVE_INFINITY, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 1.5, 1, 1, 1, 1]])).success).toBe(false); // unidades
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 1, 1, 1, 2.5, 1]])).success).toBe(false); // stock
    expect(tandaSchema.safeParse(tanda([[0.5, 0, 0, 0, 1, 1, 1, 1, 1]])).success).toBe(false); // índice
  });

  it("rechaza cifras que no caben en la base", () => {
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 3_000_000_000, 1, 1, 1, 1]])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([[0, 0, 0, 0, 1, 1e13, 1, 1, 1]])).success).toBe(false);
  });

  it("rechaza más de 10 000 filas, tandas vacías y uuids inválidos", () => {
    expect(tandaSchema.safeParse(tanda(Array.from({ length: 10_001 }, () => filaOk))).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([])).success).toBe(false);
    expect(tandaSchema.safeParse(tanda([filaOk], { ...dic, tiendas: ["no-es-uuid"] })).success).toBe(false);
    expect(tandaSchema.safeParse({ ...tanda([filaOk]), tanda: 0 }).success).toBe(false);
  });
});

describe("previsualizarSchema (regla 35)", () => {
  const base = { tiendas: ["LUKERS UNO"], combinaciones: [{ genero: "H", mundo: "C", linea: "D", equivalencia: "" }], marcas: ["ALFA"], periodos: ["2026-09"] };

  it("acepta una petición válida y rechaza periodos mal formados", () => {
    expect(previsualizarSchema.safeParse(base).success).toBe(true);
    for (const p of ["2026-9", "2026-13", "2026-00", "202609", "2026-09-01", "septiembre"]) {
      expect(previsualizarSchema.safeParse({ ...base, periodos: [p] }).success, p).toBe(false);
    }
  });

  it("respeta los topes de cada lista", () => {
    expect(previsualizarSchema.safeParse({ ...base, tiendas: Array.from({ length: 501 }, (_, i) => `T${i}`) }).success).toBe(false);
    expect(previsualizarSchema.safeParse({ ...base, marcas: Array.from({ length: 5_001 }, (_, i) => `M${i}`) }).success).toBe(false);
    expect(previsualizarSchema.safeParse({ ...base, periodos: Array.from({ length: 121 }, () => "2026-09") }).success).toBe(false);
    expect(previsualizarSchema.safeParse({ ...base, tiendas: ["x".repeat(201)] }).success).toBe(false);
  });
});

describe("abrirCargaSchema (regla 35)", () => {
  const archivo = { filas: 10, unidades: 5, venta_soles: 100, costo_vendido: 40, stock_unidades: 7, stock_valorizado: 70 };
  const base = { periodo: "2026-09", archivo_nombre: "ventas.csv", archivo, reporte: { a: 1 } };

  it("completa los booleanos con falso", () => {
    const r = abrirCargaSchema.parse(base);
    expect(r).toMatchObject({ reemplazar: false, mes_abierto: false, forzar_incompleto: false });
  });

  it("rechaza un `reporte` de más de 200 KB", () => {
    const grande = { texto: "x".repeat(200 * 1024 + 10) };
    const r = abrirCargaSchema.safeParse({ ...base, reporte: grande });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("200 KB");
    expect(abrirCargaSchema.safeParse({ ...base, reporte: { texto: "x".repeat(150 * 1024) } }).success).toBe(true);
  });

  it("rechaza periodo malo, nombre de archivo largo y medidas incompletas", () => {
    expect(abrirCargaSchema.safeParse({ ...base, periodo: "2026-9" }).success).toBe(false);
    expect(abrirCargaSchema.safeParse({ ...base, archivo_nombre: "x".repeat(256) }).success).toBe(false);
    expect(abrirCargaSchema.safeParse({ ...base, archivo: { filas: 1 } }).success).toBe(false);
  });
});

describe("medidasSchema, publicarSchema y marcasNuevasSchema", () => {
  it("medidas: filas y unidades enteras, filas no negativas", () => {
    const m = { filas: 1, unidades: 1, venta_soles: 1.5, costo_vendido: 1, stock_unidades: 1, stock_valorizado: 1 };
    expect(medidasSchema.safeParse(m).success).toBe(true);
    expect(medidasSchema.safeParse({ ...m, filas: -1 }).success).toBe(false);
    expect(medidasSchema.safeParse({ ...m, unidades: 1.5 }).success).toBe(false);
    expect(publicarSchema.safeParse({ esperado: m }).success).toBe(true);
    expect(publicarSchema.safeParse({}).success).toBe(false);
  });

  it("marcas nuevas: al menos una, nombre de hasta 120 y agrupación uuid", () => {
    expect(marcasNuevasSchema.safeParse({ nombres: ["ALFA"], agrupacion_marca_id: U1 }).success).toBe(true);
    expect(marcasNuevasSchema.safeParse({ nombres: [], agrupacion_marca_id: U1 }).success).toBe(false);
    expect(marcasNuevasSchema.safeParse({ nombres: ["x".repeat(121)], agrupacion_marca_id: U1 }).success).toBe(false);
    expect(marcasNuevasSchema.safeParse({ nombres: ["ALFA"], agrupacion_marca_id: "x" }).success).toBe(false);
    expect(marcasNuevasSchema.safeParse({ nombres: [""], agrupacion_marca_id: U1 }).success).toBe(false);
  });
});
