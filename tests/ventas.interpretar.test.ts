import { describe, expect, it } from "vitest";
import { camposDeMascara, esComodin, interpretarFila, normalizarMarca } from "@/lib/ventas/interpretar";
import { fila } from "./ventas.fixture";

describe("interpretarFila: normalización (reglas 12 y 13)", () => {
  it("`PANTALON  VARIOS` y `pantalon varios` dan la misma clave", () => {
    const a = interpretarFila(fila({ equivalencia: "PANTALON  VARIOS" }));
    const b = interpretarFila(fila({ equivalencia: "pantalon varios" }));
    expect(a.tipo).toBe("cargable");
    expect(b.tipo).toBe("cargable");
    if (a.tipo === "cargable" && b.tipo === "cargable") expect(a.combinacion).toEqual(b.combinacion);
  });

  it("equivalencia vacía da SIN EQUIVALENCIA y `-` da el nombre de la línea (la misma clave que escribirlo)", () => {
    const vacia = interpretarFila(fila({ equivalencia: "" }));
    const guion = interpretarFila(fila({ equivalencia: "-" }));
    const literal = interpretarFila(fila({ equivalencia: "denim" }));
    if (vacia.tipo !== "cargable" || guion.tipo !== "cargable" || literal.tipo !== "cargable") throw new Error("debían ser cargables");
    expect(vacia.combinacion.equivalencia).toBe("SIN EQUIVALENCIA");
    expect(vacia.combinacion.equivalencia_original).toBe("");
    expect(guion.combinacion.equivalencia).toBe("DENIM");
    expect(guion.combinacion.equivalencia_original).toBe("-");
    expect(guion.combinacion.equivalencia).toBe(literal.combinacion.equivalencia);
  });

  it("marca vacía o `-` es SIN MARCA y los comodines se reconocen", () => {
    expect(normalizarMarca("")).toBe("SIN MARCA");
    expect(normalizarMarca(" - ")).toBe("SIN MARCA");
    expect(normalizarMarca("  alfa  plus ")).toBe("ALFA PLUS");
    expect(esComodin("VARIOS")).toBe(true);
    expect(esComodin("OTROS")).toBe(true);
    expect(esComodin("SIN MARCA")).toBe(true);
    expect(esComodin("ALFA")).toBe(false);
    const f = interpretarFila(fila({ marca: "-" }));
    expect(f.tipo === "cargable" && f.marca).toBe("SIN MARCA");
  });

  it("la talla Revisar, `-` y vacío conservan su origen como categoría", () => {
    const cat = (talla: string) => {
      const f = interpretarFila(fila({ talla }));
      return f.tipo === "cargable" ? f.talla : null;
    };
    expect([cat("Central"), cat("Extrema"), cat("Revisar"), cat("-"), cat("")]).toEqual([0, 1, 2, 3, 4]);
  });

  it("números a céntimos y unidades enteras", () => {
    const f = interpretarFila(fila({ venta_soles: "205.70999999999998", unidades: "2.6" }));
    if (f.tipo !== "cargable") throw new Error("debía ser cargable");
    expect(f.medidas.venta).toBe(20571);
    expect(f.medidas.unidades).toBe(3);
    expect(f.extras.decimales_unidades).toBe(true);
    expect(f.extras.centavos).toBe(true);
  });
});

describe("interpretarFila: precedencia de motivos (reglas 14 a 16)", () => {
  const motivo = (extra: Parameters<typeof fila>[0]) => {
    const f = interpretarFila(fila(extra));
    return f.tipo === "excluida" ? f.motivo : f.tipo;
  };

  it("fila_total gana a todo", () => {
    expect(motivo({ tienda: "TOTAL", mes: "xx", venta_soles: "abc" })).toBe("fila_total");
    expect(motivo({ marca: "total" })).toBe("fila_total");
    expect(motivo({ genero: "Total", mundo: "" })).toBe("fila_total");
  });

  it("mes_invalido gana a número inválido; número inválido a fila en cero", () => {
    expect(motivo({ mes: "xx", venta_soles: "abc" })).toBe("mes_invalido");
    expect(motivo({ venta_soles: "12,5", unidades: "0", costo_vendido: "0", stock_unidades: "0", stock_valorizado: "0" })).toBe("numero_invalido");
  });

  it("fila_en_cero gana a sin_clasificar; sin_clasificar a tienda_vacia", () => {
    const ceros = { unidades: "0", venta_soles: "0", costo_vendido: "0", stock_unidades: "0", stock_valorizado: "0" };
    expect(motivo({ ...ceros, genero: "", mundo: "", linea: "" })).toBe("fila_en_cero");
    expect(motivo({ genero: "", mundo: "", linea: "", tienda: "" })).toBe("sin_clasificar");
    expect(motivo({ tienda: "" })).toBe("tienda_vacia");
  });

  it("M5b (regla 6): uno o dos de género, mundo y línea en blanco ya no se excluyen aquí (decide el resolutor) y ceden ante tienda y talla", () => {
    // Antes salían como clasificacion_incompleta; ahora son `cargable` con el campo vacío y entran al diccionario de combinaciones.
    const f = interpretarFila(fila({ genero: "HOMBRE", mundo: "", linea: "DENIM", equivalencia: "-" }));
    expect(f.tipo).toBe("cargable");
    if (f.tipo === "cargable") {
      expect(f.combinacion).toMatchObject({ genero: "HOMBRE", mundo: "", linea: "DENIM", equivalencia: "DENIM", equivalencia_original: "-" });
    }
    expect(motivo({ genero: "HOMBRE", mundo: "", linea: "" })).toBe("cargable");
    expect(motivo({ mundo: "" })).toBe("cargable");
    // tienda_vacia y talla_desconocida ganan a la clasificación incompleta.
    expect(motivo({ genero: "HOMBRE", mundo: "", linea: "", tienda: "" })).toBe("tienda_vacia");
    expect(motivo({ mundo: "", tienda: "" })).toBe("tienda_vacia");
    expect(motivo({ mundo: "", talla: "XL" })).toBe("talla_desconocida");
  });

  it("M5b: con la línea en blanco, `-` en la equivalencia no tiene nombre al que sustituirse y cae en SIN EQUIVALENCIA", () => {
    const f = interpretarFila(fila({ genero: "HOMBRE", mundo: "CASUAL", linea: "", equivalencia: "-" }));
    expect(f.tipo === "cargable" && f.combinacion.equivalencia).toBe("SIN EQUIVALENCIA");
  });

  it("una fila con talla desconocida y tienda válida queda para resolver (cede ante un error de tienda)", () => {
    expect(motivo({ talla: "XL" })).toBe("talla_desconocida");
  });

  it("sin_clasificar solo con los tres en blanco; con un ajuste negativo su peso es negativo", () => {
    const f = interpretarFila(fila({ genero: "", mundo: "", linea: "", venta_soles: "-50", stock_valorizado: "0", unidades: "-1", stock_unidades: "0", costo_vendido: "-20" }));
    expect(f.tipo).toBe("excluida");
    if (f.tipo === "excluida") {
      expect(f.motivo).toBe("sin_clasificar");
      expect(f.medidas.venta).toBe(-5000);
      expect(f.medidas.unidades).toBe(-1);
    }
  });

  it("fila_en_cero: una fila con solo stock no lo es", () => {
    const solo = interpretarFila(fila({ unidades: "0", venta_soles: "0", costo_vendido: "0", stock_unidades: "5", stock_valorizado: "100" }));
    expect(solo.tipo).toBe("cargable");
    const redondeada = interpretarFila(fila({ unidades: "0", venta_soles: "0.004", costo_vendido: "0", stock_unidades: "0", stock_valorizado: "0" }));
    expect(redondeada.tipo === "excluida" && redondeada.motivo).toBe("fila_en_cero");
  });

  it("agrupa el valor de cada motivo para el reporte", () => {
    const f = interpretarFila(fila({ venta_soles: "12,5" }));
    expect(f.tipo === "excluida" && f.valor).toBe("Venta (S/): 12,5");
    const g = interpretarFila(fila({ mes: "xx" }));
    expect(g.tipo === "excluida" && g.valor).toBe("2026 xx");
    expect(g.tipo === "excluida" && g.periodo).toBeNull();
  });
});

describe("interpretarFila: lectura", () => {
  it("cuenta celdas numéricas, coma decimal y campos vacíos", () => {
    const f = interpretarFila(fila({ venta_soles: "12,5", costo_vendido: "x", marca: "" }));
    expect(f.celdas_numericas).toBe(4); // unidades, venta (coma), stock, valorizado
    expect(f.celdas_coma).toBe(1);
    expect(camposDeMascara(f.vacios)).toEqual(["marca"]);
  });

  it("una fila completa no tiene campos vacíos", () => {
    expect(interpretarFila(fila()).vacios).toBe(0);
  });
});
