import { describe, expect, it } from "vitest";
import { factorDe, factoresMes, normalizar, esConstante, factorMasReciente } from "@/lib/proyeccion/nino";
import { AG, CURVA_INVIERNO, CURVA_VERANO, factores, periodos } from "./proyeccion.fixture";

const inv = (peso = 1) => ({ agrupacion_id: AG.inv, temporada: "invierno" as const, peso, curva: CURVA_INVIERNO });
const ver = (peso = 1) => ({ agrupacion_id: AG.ver, temporada: "verano" as const, peso, curva: CURVA_VERANO });

describe("factor del Niño por mes (reglas 5 a 7)", () => {
  it("una sola agrupación: el factor de la temporada en los meses atípicos y 1 fuera", () => {
    const i = factoresMes([inv()], periodos(), factores(), 2026);
    expect(i.factores.every((f) => f === 0.66)).toBe(true);
    const v = factoresMes([ver()], periodos(), factores(), 2026);
    expect(v.factores.slice(0, 8).every((f) => f === 1)).toBe(true);
    expect(v.factores.slice(8)).toEqual([1.24, 1.24, 1.24, 1.24]);
    expect(v.mesesAtipicos).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("todo_el_ano nunca se ajusta; un año normal da unos", () => {
    const t = factoresMes([{ agrupacion_id: AG.denim, temporada: "todo_el_ano", peso: 1, curva: null }], periodos(), factores(), 2026);
    expect(t.factores.every((f) => f === 1)).toBe(true);
    expect(factoresMes([inv()], periodos(), factores(), 2025).factores.every((f) => f === 1)).toBe(true);
    expect(factoresMes([inv()], periodos(), factores(), 2023).factores[0]).toBe(0.63);
  });

  it("GML que mezcla temporadas: ponderado por peso × curva en cada mes (caso 20)", () => {
    const r = factoresMes([inv(0.8), ver(0.2)], periodos(), factores(), 2026);
    // Setiembre: invierno 0,66 (curva 0,04) y verano 1,24 (curva 0,08).
    const esperado = (0.8 * 0.04 * 0.66 + 0.2 * 0.08 * 1.24) / (0.8 * 0.04 + 0.2 * 0.08);
    expect(r.factores[8]).toBeCloseTo(esperado, 10);
    expect(r.factores[8]).toBeCloseTo(0.853333, 5);
    // Marzo: solo el invierno es atípico; el verano vale 1 en marzo, así que el promedio NO es 0,66 sino 0,745
    // (la ficha dice 0,66; la fórmula de la sección 3 da esto).
    const marzo = (0.8 * 0.06 * 0.66 + 0.2 * 0.08 * 1) / (0.8 * 0.06 + 0.2 * 0.08);
    expect(r.factores[2]).toBeCloseTo(marzo, 10);
    // Un mes donde ninguna equivalencia es atípica vale 1 (año 2025).
    expect(factoresMes([inv(0.8), ver(0.2)], periodos(), factores(), 2025).factores.every((f) => f === 1)).toBe(true);
  });

  it("factorDe: aplicado manda sobre calculado; sin ninguno, nulo; mes atípico sin factor → 1 y sin_factor", () => {
    const f = factores();
    expect(factorDe(f, 2026, "invierno")).toBe(0.66);
    f[2].ratio_aplicado = 0.7;
    expect(factorDe(f, 2026, "invierno")).toBe(0.7);
    expect(factorDe(f, 2030, "invierno")).toBeNull();
    const sin = factoresMes([inv()], periodos(), [], 2026);
    expect(sin.factores.every((x) => x === 1)).toBe(true);
    expect(sin.avisos).toContain("sin_factor");
  });

  it("año objetivo atípico sin fila propia: usa el efectivo del último año de la temporada con aviso objetivo_atipico", () => {
    const extra = [...periodos(), { id: "p-inv-2027", desde: "2027-01", hasta: "2027-12", motivo: "Niño 2027", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true }];
    const r = factoresMes([inv()], extra, factores(), 2027, { objetivo: true });
    expect(r.factores.every((x) => x === 0.66)).toBe(true);
    expect(r.avisos).toContain("objetivo_atipico");
    expect(factorMasReciente(factores(), 2027, "verano")).toEqual({ anio: 2026, ratio: 1.24 });
    // Un año posterior sin periodos: unos y sin avisos.
    expect(factoresMes([inv()], periodos(), factores(), 2027, { objetivo: true })).toMatchObject({ avisos: [] });
  });

  it("normalizar divide mes a mes; con unos es idéntica; esConstante", () => {
    expect(normalizar([66, 132], [0.66, 0.66])).toEqual([100, 200]);
    expect(normalizar([5, 7], [1, 1])).toEqual([5, 7]);
    expect(esConstante([0.66, 0.66, 0.66])).toBe(true);
    expect(esConstante([1, 1.24])).toBe(false);
  });
});
