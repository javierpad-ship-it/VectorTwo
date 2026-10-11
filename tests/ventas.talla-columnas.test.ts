import { describe, expect, it } from "vitest";
import { detectarMapeo, mapeoCompleto } from "@/components/importador/mapeo";
import { CAMPOS_ARCHIVO_VENTA, ENCABEZADOS_QLIKVIEW } from "@/lib/ventas/columnas";
import { codigoTalla, mapearTalla } from "@/lib/ventas/talla";
import { CAMPOS_VENTA } from "@/lib/ventas/tipos";

describe("mapearTalla (regla 10)", () => {
  it("Central y Extrema se reconocen sin distinguir caja ni plural", () => {
    for (const v of ["Central", "CENTRAL", "centrales", " Central "]) {
      expect(mapearTalla(v)).toEqual({ agrupacion: "CENTRALES", revisar: false, original: null });
    }
    for (const v of ["Extrema", "EXTREMAS"]) {
      expect(mapearTalla(v)).toEqual({ agrupacion: "EXTREMAS", revisar: false, original: null });
    }
  });

  it("`Revisar`, `-` y vacío van a CENTRALES con aviso y su valor original", () => {
    expect(mapearTalla("Revisar")).toEqual({ agrupacion: "CENTRALES", revisar: true, original: "REVISAR" });
    expect(mapearTalla("-")).toEqual({ agrupacion: "CENTRALES", revisar: true, original: "-" });
    expect(mapearTalla("")).toEqual({ agrupacion: "CENTRALES", revisar: true, original: "" });
    expect(mapearTalla("   ")).toEqual({ agrupacion: "CENTRALES", revisar: true, original: "" });
  });

  it("cualquier otro valor es desconocido", () => {
    expect(mapearTalla("XL")).toBeNull();
    expect(mapearTalla("Revisar 2")).toBeNull();
  });

  it("el código que viaja en las tandas", () => {
    expect(codigoTalla("CENTRALES")).toBe(0);
    expect(codigoTalla("EXTREMAS")).toBe(1);
  });
});

describe("detectarMapeo con los 14 encabezados de QlikView (regla 11)", () => {
  it("mapea los 14 campos con los nombres exactos", () => {
    const m = detectarMapeo([...ENCABEZADOS_QLIKVIEW], CAMPOS_ARCHIVO_VENTA);
    expect(mapeoCompleto(m, CAMPOS_ARCHIVO_VENTA)).toBe(true);
    for (const campo of CAMPOS_VENTA) expect(m[campo]).not.toBe("");
    expect(m.anio).toBe("AÑO");
    expect(m.venta_soles).toBe("Vta S/");
    expect(m.stock_valorizado).toBe("Stk Val Act");
    expect(m.talla).toBe("TALLA_e");
  });

  it("también con la forma canónica", () => {
    const canonicas = [
      "MES",
      "TIENDA",
      "GENERO",
      "MUNDO",
      "LINEA",
      "EQUIVALENCIA",
      "MARCA",
      "TALLA",
      "UNIDADES",
      "VENTA_SOLES",
      "COSTO_VENDIDO",
      "STOCK_UNIDADES",
      "STOCK_VALORIZADO",
    ];
    const m = detectarMapeo(canonicas, CAMPOS_ARCHIVO_VENTA);
    expect(mapeoCompleto(m, CAMPOS_ARCHIVO_VENTA)).toBe(true);
    expect(m.anio).toBe(""); // opcional: sin año, el mes trae el año
    expect(m.stock_unidades).toBe("STOCK_UNIDADES");
    expect(m.stock_valorizado).toBe("STOCK_VALORIZADO");
  });

  it("una cabecera con BOM delante mapea igual", () => {
    const columnas = ENCABEZADOS_QLIKVIEW.map((c, i) => (i === 0 ? `﻿${c}`.trim() : c));
    const m = detectarMapeo(columnas, CAMPOS_ARCHIVO_VENTA);
    expect(mapeoCompleto(m, CAMPOS_ARCHIVO_VENTA)).toBe(true);
    expect(m.anio).not.toBe("");
    // y aun sin el `trim` del lector, `aCodigo` descarta lo que no sea letra o dígito
    const crudo = detectarMapeo([`﻿${ENCABEZADOS_QLIKVIEW[0]}`, ...ENCABEZADOS_QLIKVIEW.slice(1)], CAMPOS_ARCHIVO_VENTA);
    expect(crudo.anio).not.toBe("");
  });

  it("sin la columna del mes el mapeo queda incompleto", () => {
    const m = detectarMapeo(ENCABEZADOS_QLIKVIEW.filter((c) => c !== "MES"), CAMPOS_ARCHIVO_VENTA);
    expect(mapeoCompleto(m, CAMPOS_ARCHIVO_VENTA)).toBe(false);
  });
});
