import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import { generarCsv } from "@/components/importador/csv";

describe("generarCsv (M-4: inyección de fórmulas)", () => {
  it("una celda que empieza por = sale con apóstrofo delante", () => {
    const csv = generarCsv(["NOMBRE"], [['=HYPERLINK("x")']]);
    expect(csv).toBe('NOMBRE\r\n"\'=HYPERLINK(""x"")"');
    const leido = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
    expect(leido[1][0]).toBe(`'=HYPERLINK("x")`);
  });

  it("escapa también +, - y @ al inicio de una fórmula", () => {
    for (const valor of ["+1+1", "-2+3", "@SUM(A1)", "-cmd|' /C calc'!A0", "\t=1+1"]) {
      const leido = Papa.parse<string[]>(generarCsv(["C"], [[valor]]), { skipEmptyLines: true }).data;
      expect(leido[1][0], valor).toBe(`'${valor}`);
    }
  });

  it("no toca texto normal, el guion solo, números ni números con signo", () => {
    const csv = generarCsv(["A", "B", "C", "D", "E"], [["POLO BASICO", "-", 12, -5, "-5,25"]]);
    const leido = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
    expect(leido[1]).toEqual(["POLO BASICO", "-", "12", "-5", "-5,25"]);
  });

  it("un encabezado con fórmula también se escapa", () => {
    expect(generarCsv(["=1+1"], [["x"]]).startsWith(`"'=1+1"`)).toBe(true);
  });
});
