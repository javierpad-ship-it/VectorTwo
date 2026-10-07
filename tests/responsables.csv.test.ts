import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { COLUMNAS_CSV_RESPONSABLES, estadoCsv, filasCsvResponsables } from "@/lib/responsables/csv";
import { ANA, LUIS, PLANNER, asignacion, generos, matriz, mundos, perfiles } from "./responsables.fixture";

describe("regla 13 · filasCsvResponsables", () => {
  it("columnas de la ficha", () => {
    expect([...COLUMNAS_CSV_RESPONSABLES]).toEqual(["GENERO", "MUNDO", "RESPONSABLE", "CORREO", "ESTADO"]);
  });

  it("una fila por celda, en el orden de la matriz, con los cuatro estados", () => {
    const m = matriz({
      perfiles: perfiles.map((p) => (p.id === LUIS ? { ...p, activo: false } : p)),
      asignaciones: [asignacion(1, 1, ANA), asignacion(1, 2, LUIS), asignacion(1, 3, PLANNER)],
    });
    const filas = filasCsvResponsables(m.celdas, m.generos, m.mundos);
    expect(filas).toHaveLength(40);
    expect(filas[0]).toEqual(["HOMBRE", "URBANO", "ANA RAMOS", "ana@lukers.pe", "Asignada"]);
    // Sin nombre, el correo hace de responsable.
    expect(filas[1]).toEqual(["HOMBRE", "FORMAL", "luis@lukers.pe", "luis@lukers.pe", "Responsable desactivado"]);
    expect(filas[2]).toEqual(["HOMBRE", "DEPORTE", "PAOLA", "paola@lukers.pe", "Responsable ya no es comprador"]);
    expect(filas[3]).toEqual(["HOMBRE", "PLAYA", "", "", "Sin responsable"]);
  });

  it("una celda no vigente sale como Inactiva", () => {
    const m = matriz({
      generos: generos.map((g, i) => (i === 0 ? { ...g, activo: false } : g)),
      incluirInactivos: true,
    });
    expect(estadoCsv(m.celdas[0])).toBe("Inactiva");
    expect(filasCsvResponsables(m.celdas, m.generos, m.mundos)[0][4]).toBe("Inactiva");
  });

  it("las comas y las comillas en los nombres sobreviven al CSV (las escapa Papa.unparse)", () => {
    const raros = [{ ...generos[0], nombre: 'NIÑO, "GRANDE"' }];
    const ms = [{ ...mundos[0], nombre: "SPORT, AIRE LIBRE" }];
    const ps = [{ ...perfiles[0], nombre: 'ANA "LA" RAMOS, JR' }];
    const m = matriz({ generos: raros, mundos: ms, perfiles: ps, asignaciones: [asignacion(1, 1, ANA)] });
    const filas = filasCsvResponsables(m.celdas, m.generos, m.mundos);
    const csv = Papa.unparse({ fields: [...COLUMNAS_CSV_RESPONSABLES], data: filas });
    const releido = Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;
    expect(releido[0]).toEqual([...COLUMNAS_CSV_RESPONSABLES]);
    expect(releido[1]).toEqual(['NIÑO, "GRANDE"', "SPORT, AIRE LIBRE", 'ANA "LA" RAMOS, JR', "ana@lukers.pe", "Asignada"]);
  });

  it("acentos intactos", () => {
    const m = matriz();
    expect(filasCsvResponsables(m.celdas, m.generos, m.mundos).some((f) => f[0] === "NIÑO")).toBe(true);
  });
});
