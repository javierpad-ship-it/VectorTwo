import { describe, expect, it } from "vitest";
import {
  ALTAS_PRELLENADAS,
  TODAS_LAS_TEMPORADAS,
  alternarTemporada,
  altasFaltantes,
  anioBase,
  atajoAnioCompleto,
  atajoDesdeSetiembre,
  atajoEnCurso,
  sonTodas,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/atajos";

describe("anioBase", () => {
  it("usa el año del mes «desde» si ya está escrito", () => {
    expect(anioBase("2023-05", "2026-09", 2030)).toBe(2023);
  });
  it("sin «desde» usa el año del último mes cargado", () => {
    expect(anioBase("", "2026-09", 2030)).toBe(2026);
  });
  it("sin nada usa el año de hoy", () => {
    expect(anioBase("", null, 2031)).toBe(2031);
    expect(anioBase("2023-1", null, 2031)).toBe(2031);
  });
});

describe("atajos de rango", () => {
  it("año completo: enero a diciembre", () => {
    expect(atajoAnioCompleto(2023)).toEqual({ desde: "2023-01", hasta: "2023-12" });
  });
  it("desde setiembre: setiembre a diciembre", () => {
    expect(atajoDesdeSetiembre(2026)).toEqual({ desde: "2026-09", hasta: "2026-12" });
  });
  it("en curso: el año del último mes cargado, enero a diciembre", () => {
    expect(atajoEnCurso("2026-09", 2030)).toEqual({ desde: "2026-01", hasta: "2026-12" });
    expect(atajoEnCurso(null, 2027)).toEqual({ desde: "2027-01", hasta: "2027-12" });
  });
});

describe("temporadas del periodo", () => {
  it("«Todas» marca las tres", () => {
    expect(sonTodas(TODAS_LAS_TEMPORADAS)).toBe(true);
    expect(sonTodas(["invierno", "verano"])).toBe(false);
  });
  it("alternar marca y desmarca y conserva el orden del contrato", () => {
    expect(alternarTemporada(["invierno"], "verano")).toEqual(["invierno", "verano"]);
    expect(alternarTemporada(["verano"], "invierno")).toEqual(["invierno", "verano"]);
    expect(alternarTemporada(["invierno", "verano"], "invierno")).toEqual(["verano"]);
    expect(alternarTemporada(["todo_el_ano"], "invierno")).toEqual(["invierno", "todo_el_ano"]);
  });
  it("puede quedar vacío (el formulario lo rechaza)", () => {
    expect(alternarTemporada(["verano"], "verano")).toEqual([]);
  });
});

describe("los cuatro altas confirmados", () => {
  it("son las cuatro de la ficha, sin «marzo a mayo»", () => {
    expect(ALTAS_PRELLENADAS.map((a) => [a.desde, a.hasta, a.temporadas.join("+")])).toEqual([
      ["2023-01", "2023-12", "invierno"],
      ["2023-09", "2023-12", "verano"],
      ["2026-01", "2026-12", "invierno"],
      ["2026-09", "2026-12", "verano"],
    ]);
    expect(ALTAS_PRELLENADAS.some((a) => a.desde.endsWith("-03") || a.motivo.toLowerCase().includes("marzo"))).toBe(false);
    expect(ALTAS_PRELLENADAS.every((a) => a.motivo.includes("Niño costero"))).toBe(true);
  });

  it("claves únicas", () => {
    expect(new Set(ALTAS_PRELLENADAS.map((a) => a.clave)).size).toBe(4);
  });

  it("sin periodos faltan los cuatro; con uno creado faltan tres", () => {
    expect(altasFaltantes([])).toHaveLength(4);
    const restantes = altasFaltantes([{ desde: "2023-01-01", hasta: "2023-12-01", temporadas: ["invierno"] }]);
    expect(restantes.map((a) => a.clave)).toEqual(["2023-verano", "2026-invierno", "2026-verano"]);
  });

  it("el mismo rango con otro conjunto de temporadas no cuenta como creado", () => {
    expect(altasFaltantes([{ desde: "2023-01", hasta: "2023-12", temporadas: ["invierno", "verano"] }])).toHaveLength(4);
  });
});
