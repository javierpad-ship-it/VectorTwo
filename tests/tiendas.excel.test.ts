import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { hojaATabla } from "@/lib/arbol/leer-archivo";
import { planificarImportacionTiendas } from "@/lib/tiendas/importar";

/** Serie de Excel sin depender de la zona horaria. */
const serie = (a: number, m: number, d: number) => Date.UTC(a, m - 1, d) / 86_400_000 + 25_569;

describe("importar tiendas desde un Excel con fechas reales", () => {
  it("las celdas de fecha se cargan con el día y el mes correctos (antes se rechazaban o se leían al revés)", () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      ["Cod.Tda", "Tda#", "Tienda", "Zona", "Razon Social", "Fecha Apertura"],
      ["R401", 101, "LUKERS IQUITOS", "SUR ORIENTE", "ORIENTE SAC", ""],
      ["R402", 102, "LUKERS TARAPOTO", "SUR ORIENTE", "ORIENTE SAC", ""],
      ["R403", 103, "LUKERS PIURA", "CENTRO NORTE", "LUKERS SAC", ""],
    ]);
    hoja["F2"] = { t: "n", v: serie(2019, 3, 15), z: "m/d/yy" }; // 15 de marzo: mes 15 no existe leído día primero
    hoja["F3"] = { t: "n", v: serie(2019, 3, 5), z: "m/d/yy" }; // 5 de marzo: leído día primero sería 3 de mayo
    hoja["F4"] = { t: "n", v: serie(2027, 1, 31), z: "dd/mm/yyyy" };

    const { filas } = hojaATabla(XLSX.utils, hoja);
    const entrada = filas.map((f) => ({
      codigo: f["Cod.Tda"],
      nombre: f["Tienda"],
      tipo: "",
      zona: f["Zona"],
      razon_social: f["Razon Social"],
      fecha_apertura: f["Fecha Apertura"],
      fecha_cierre: "",
      venta_esperada: "",
    }));

    const { reporte, tiendas } = planificarImportacionTiendas(entrada, { tiendas: [] }, "2026-10-08");
    expect(reporte.omitidas).toEqual([]);
    expect(reporte.crear.tiendas).toBe(3);
    expect(tiendas.map((t) => [t.codigo, t.fecha_apertura])).toEqual([
      ["R401", "2019-03-15"],
      ["R402", "2019-03-05"],
      ["R403", "2027-01-31"],
    ]);
  });
});
