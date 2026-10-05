import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { esExcel, hojaATabla, libroATabla, nombreBase } from "@/lib/arbol/leer-archivo";

function libroDe(filas: unknown[][], nombreHoja = "Sheet1"): XLSX.WorkBook {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filas), nombreHoja);
  return libro;
}

describe("hojaATabla", () => {
  it("usa la primera fila como cabecera y devuelve texto", () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      ["Género Lukers", "GRUPO_PRODUCTO", "LINEA SAP", "EQUIVALENCIAS_LK"],
      ["H", "URBANO", "DENIM", "DENIM SLIM"],
      ["H", "URBANO", "DENIM", 5],
    ]);
    const t = hojaATabla(XLSX.utils, hoja);
    expect(t.columnas).toEqual(["Género Lukers", "GRUPO_PRODUCTO", "LINEA SAP", "EQUIVALENCIAS_LK"]);
    expect(t.filas).toHaveLength(2);
    expect(t.filas[1]["EQUIVALENCIAS_LK"]).toBe("5");
  });

  it("descarta filas vacías, columnas sin nombre y recorta espacios", () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      [" GENERO ", "MUNDO", ""],
      ["BEBE", "", "x"],
      ["", "", ""],
      [null, null, null],
      ["M", "CASUAL", ""],
    ]);
    const t = hojaATabla(XLSX.utils, hoja);
    expect(t.columnas).toEqual(["GENERO", "MUNDO"]);
    expect(t.filas).toEqual([
      { GENERO: "BEBE", MUNDO: "" },
      { GENERO: "M", MUNDO: "CASUAL" },
    ]);
  });

  it("salta filas en blanco antes de la cabecera", () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      ["", ""],
      ["A", "B"],
      ["1", "2"],
    ]);
    expect(hojaATabla(XLSX.utils, hoja).filas).toEqual([{ A: "1", B: "2" }]);
  });

  it("hoja vacía devuelve tabla vacía", () => {
    expect(hojaATabla(XLSX.utils, XLSX.utils.aoa_to_sheet([]))).toEqual({ columnas: [], filas: [] });
  });
});

describe("libroATabla", () => {
  it("lee la primera hoja por defecto y lista todas", () => {
    const libro = libroDe([["A"], ["1"]], "Datos");
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["B"], ["2"]]), "Otra");
    const t = libroATabla(XLSX.utils, libro);
    expect(t.hojas).toEqual(["Datos", "Otra"]);
    expect(t.hoja).toBe("Datos");
    expect(t.filas).toEqual([{ A: "1" }]);
  });

  it("lee la hoja pedida", () => {
    const libro = libroDe([["A"], ["1"]], "Datos");
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["B"], ["2"]]), "Otra");
    expect(libroATabla(XLSX.utils, libro, "Otra").filas).toEqual([{ B: "2" }]);
  });

  it("lee un .xls real generado en memoria", () => {
    const libro = libroDe([["GENERO_LK", "MUNDO"], ["H", "URBANO"]]);
    const binario = XLSX.write(libro, { type: "array", bookType: "biff8" });
    const releido = XLSX.read(binario, { type: "array" });
    expect(libroATabla(XLSX.utils, releido).filas).toEqual([{ GENERO_LK: "H", MUNDO: "URBANO" }]);
  });
});

describe("nombres", () => {
  it("reconoce extensiones de Excel", () => {
    expect(esExcel("arbol.xlsx")).toBe(true);
    expect(esExcel("ARBOL.XLS")).toBe(true);
    expect(esExcel("arbol.csv")).toBe(false);
  });
  it("quita la extensión", () => {
    expect(nombreBase("arbol-lineas.xls")).toBe("arbol-lineas");
    expect(nombreBase("arbol.csv")).toBe("arbol");
  });
});
