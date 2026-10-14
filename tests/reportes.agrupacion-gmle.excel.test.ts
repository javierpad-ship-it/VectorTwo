import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { construirHoja } from "@/components/importador/excel";
import { COLUMNAS_DETALLE, encabezados, filasDetalle } from "@/lib/reportes/descargas";
import { FILTROS_VACIOS, enriquecerEquivalencias, filtrarReporte } from "@/lib/reportes/filtros";
import { crearReporteSintetico } from "./reportes.agrupacion-gmle.vista.fixture";

// SheetJS real (sin mock): lo que se comprueba es lo que acaba en el archivo.
const PELIGROSAS = ["=1+1", "+x", "@SUM(A1)", "-A1"];

describe("hoja de Excel de las descargas (SheetJS real)", () => {
  it("los textos que parecen fórmula quedan como celdas de texto, sin fórmula", () => {
    const hoja = construirHoja(XLSX, ["TEXTO"], PELIGROSAS.map((t) => [t]));
    PELIGROSAS.forEach((texto, i) => {
      const celda = hoja[`A${i + 2}`];
      expect(celda.t).toBe("s");
      expect(celda.v).toBe(texto);
      expect(celda.f).toBeUndefined();
    });
  });

  it("también en la hoja del Detalle y tras escribir y releer el libro .xlsx", () => {
    const reporte = crearReporteSintetico();
    const base = filtrarReporte(enriquecerEquivalencias(reporte), FILTROS_VACIOS).slice(0, PELIGROSAS.length);
    const filas = base.map((f, i) => ({ ...f, equivalencia: PELIGROSAS[i], codigo: PELIGROSAS[i] }));
    const campos = encabezados(COLUMNAS_DETALLE);
    const hoja = construirHoja(XLSX, campos, filasDetalle(filas));

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "REPORTE");
    const bytes = XLSX.write(libro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const releido = XLSX.read(bytes, { type: "array" }).Sheets.REPORTE;

    const columna = (titulo: string) => String.fromCharCode(65 + campos.indexOf(titulo));
    for (const titulo of ["EQUIVALENCIA", "CODIGO"]) {
      PELIGROSAS.forEach((texto, i) => {
        const celda = releido[`${columna(titulo)}${i + 2}`];
        expect(celda.t).toBe("s");
        expect(celda.v).toBe(texto);
        expect(celda.f).toBeUndefined();
      });
    }
    expect(Object.values(releido).some((c) => typeof c === "object" && c !== null && "f" in c)).toBe(false);
  });

  it("el encabezado es la primera fila y los anchos acompañan a las columnas", () => {
    const hoja = construirHoja(XLSX, ["A", "B"], [["uno", 2]]);
    expect(hoja.A1.v).toBe("A");
    expect(hoja.B2).toMatchObject({ t: "n", v: 2 });
    expect(hoja["!cols"]).toHaveLength(2);
  });
});
