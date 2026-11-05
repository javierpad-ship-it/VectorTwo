import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import {
  BYTES_EXCEL_MAX,
  MENSAJE_EXCEL_PESADO,
  OPCIONES_LECTURA_EXCEL,
  esExcel,
  exigirExcelLiviano,
  hojaATabla,
  leerArchivoTabular,
  libroATabla,
  nombreBase,
  serieAFechaIso,
} from "@/lib/arbol/leer-archivo";

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

describe("fechas de Excel", () => {
  // Serie de Excel de una fecha: días desde 1899-12-30. Calculada sin depender de la zona horaria.
  const serie = (a: number, m: number, d: number) => Date.UTC(a, m - 1, d) / 86_400_000 + 25_569;
  const celdaFecha = (a: number, m: number, d: number, formato = "m/d/yy") => ({ t: "n" as const, v: serie(a, m, d), z: formato });

  function hojaConFechas(...fechas: ReturnType<typeof celdaFecha>[]) {
    const hoja = XLSX.utils.aoa_to_sheet([["Cod.Tda", "Tienda", "Fecha Apertura"], ...fechas.map((_, i) => [`R40${i}`, `T${i}`, ""])]);
    fechas.forEach((f, i) => {
      hoja[`C${i + 2}`] = f;
    });
    return hoja;
  }

  it("una celda de fecha sale como aaaa-mm-dd, no como mes/día/año", () => {
    const t = hojaATabla(XLSX.utils, hojaConFechas(celdaFecha(2019, 3, 15), celdaFecha(2019, 3, 5)));
    expect(t.filas.map((f) => f["Fecha Apertura"])).toEqual(["2019-03-15", "2019-03-05"]);
  });

  it("reconoce formatos de fecha con día primero, nombres de mes y configuración regional", () => {
    const t = hojaATabla(
      XLSX.utils,
      hojaConFechas(
        celdaFecha(2026, 10, 5, "dd/mm/yyyy"),
        celdaFecha(2026, 10, 5, "d-mmm-yy"),
        celdaFecha(2026, 10, 5, "[$-F800]dddd, mmmm dd, yyyy"),
        celdaFecha(2026, 10, 5, "yyyy-mm-dd")
      )
    );
    expect(t.filas.map((f) => f["Fecha Apertura"])).toEqual(["2026-10-05", "2026-10-05", "2026-10-05", "2026-10-05"]);
  });

  it("un número que no es fecha queda como estaba", () => {
    const hoja = hojaConFechas({ t: "n", v: 85000, z: "#,##0.00" } as ReturnType<typeof celdaFecha>);
    expect(hojaATabla(XLSX.utils, hoja).filas[0]["Fecha Apertura"]).toBe("85,000.00");
  });

  it("una hora sola no se confunde con una fecha", () => {
    const hoja = hojaConFechas({ t: "n", v: 0.5, z: "h:mm" } as ReturnType<typeof celdaFecha>);
    expect(hojaATabla(XLSX.utils, hoja).filas[0]["Fecha Apertura"]).toBe("12:00");
  });

  it("un texto con la fecha escrita a mano no se toca", () => {
    const hoja = XLSX.utils.aoa_to_sheet([["Fecha"], ["15/03/2019"]]);
    expect(hojaATabla(XLSX.utils, hoja).filas).toEqual([{ Fecha: "15/03/2019" }]);
  });

  it("sobrevive a guardar y releer el libro con el formato de celda", () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hojaConFechas(celdaFecha(2019, 3, 15), celdaFecha(2019, 3, 5)), "Tiendas");
    const bytes = XLSX.write(libro, { type: "array", bookType: "xlsx" });
    const releido = XLSX.read(bytes, { type: "array", cellNF: true });
    expect(libroATabla(XLSX.utils, releido).filas.map((f) => f["Fecha Apertura"])).toEqual(["2019-03-15", "2019-03-05"]);
  });

  it("serieAFechaIso rechaza lo que no es una serie válida", () => {
    expect(serieAFechaIso(serie(2019, 3, 15))).toBe("2019-03-15");
    expect(serieAFechaIso(0)).toBeNull();
    expect(serieAFechaIso(Number.NaN)).toBeNull();
  });
});

describe("lectura de Excel endurecida", () => {
  const archivoDe = (bytes: ArrayBuffer | Uint8Array, nombre: string) => new File([bytes as BlobPart], nombre);

  it("un Excel de más de 50 MB se rechaza antes de leerlo a memoria", async () => {
    const arrayBuffer = vi.fn();
    const enorme = { name: "venta.xlsx", size: BYTES_EXCEL_MAX + 1, arrayBuffer } as unknown as File;
    await expect(leerArchivoTabular(enorme)).rejects.toThrow("Ese Excel pesa demasiado: guárdalo como CSV");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(MENSAJE_EXCEL_PESADO).toBe("Ese Excel pesa demasiado: guárdalo como CSV");
  });

  it("el tope es exactamente 50 MB: el límite pasa, un byte más no", () => {
    expect(BYTES_EXCEL_MAX).toBe(50 * 1024 * 1024);
    expect(() => exigirExcelLiviano({ size: BYTES_EXCEL_MAX })).not.toThrow();
    expect(() => exigirExcelLiviano({ size: BYTES_EXCEL_MAX + 1 })).toThrow(MENSAJE_EXCEL_PESADO);
  });

  it("las opciones de lectura conservan cellNF y recortan lo que la app no usa", () => {
    expect(OPCIONES_LECTURA_EXCEL).toEqual({
      type: "array",
      cellNF: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
    });
  });

  it("con las opciones recortadas las fechas y los números con formato salen igual", async () => {
    const hoja = XLSX.utils.aoa_to_sheet([["Fecha", "Monto"], [0, 85000]]);
    hoja.A2 = { t: "n", v: 43539, z: "dd/mm/yyyy" } as XLSX.CellObject; // 15/03/2019
    hoja.B2.z = "#,##0.00";
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Hoja1");
    const bytes = XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const t = await leerArchivoTabular(archivoDe(bytes, "tiendas.xlsx"));
    expect(t.filas).toEqual([{ Fecha: "2019-03-15", Monto: "85,000.00" }]);
  });

  it("un .xls (BIFF8) sigue leyéndose por el camino real del importador", async () => {
    const libro = libroDe([["GENERO_LK", "MUNDO", "Fecha"], ["H", "URBANO", 0]]);
    libro.Sheets.Sheet1.C2 = { t: "n", v: 43539, z: "dd/mm/yyyy" } as XLSX.CellObject;
    const binario = XLSX.write(libro, { type: "array", bookType: "biff8" }) as ArrayBuffer;
    const t = await leerArchivoTabular(archivoDe(binario, "arbol.xls"));
    expect(t.hojas).toEqual(["Sheet1"]);
    expect(t.filas).toEqual([{ GENERO_LK: "H", MUNDO: "URBANO", Fecha: "2019-03-15" }]);
  });

  it("nombres de hoja como __proto__ y constructor no contaminan Object.prototype", async () => {
    const libro = XLSX.utils.book_new();
    for (const nombre of ["__proto__", "constructor", "Normal"]) {
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["A"], [nombre]]), nombre);
    }
    expect(() => libroATabla(XLSX.utils, libro, "__proto__")).not.toThrow();
    expect(libroATabla(XLSX.utils, libro, "constructor").filas).toEqual([{ A: "constructor" }]);

    // Y por el camino completo: escribir el libro, releerlo con las opciones de la app y tabularlo.
    const bytes = XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const t = await leerArchivoTabular(archivoDe(bytes, "raro.xlsx"), "constructor");
    expect(t.hojas).toEqual(expect.arrayContaining(["__proto__", "constructor", "Normal"]));
    expect(t.filas).toEqual([{ A: "constructor" }]);

    const basura = Object.prototype as Record<string, unknown>;
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    for (const clave of ["A", "!ref", "t", "v", "w", "SheetNames", "Sheets", "polluted"]) expect(basura[clave], clave).toBeUndefined();
    expect(({} as Record<string, unknown>)["!ref"]).toBeUndefined();
  });
});
