import { describe, expect, it } from "vitest";
import { TAMANO_FLUJO_MAXIMO, TAMANO_FLUJO_TIPICO } from "@/lib/flujo/tipos";
import { construirFlujo } from "./flujo.fixture";

/**
 * Regla 32 de la ficha 08 (§0.6): `GET /api/flujo` con 1 600 filas ≤ 1,5 MB con el horizonte típico (15 meses: 16 periodos con `k'`)
 * y ≤ 2,5 MB con el máximo (24 meses: 25 periodos); la lista no trae historia, `vpm` ni `extendido`; `senal` y `fuera_de_rango`
 * llevan un carácter por periodo.
 */

const bytes = (valor: unknown) => Buffer.byteLength(JSON.stringify({ data: valor }), "utf8");

function claves(valor: unknown, acumulado = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((x) => claves(x, acumulado));
  else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.add(k);
      claves(v, acumulado);
    }
  }
  return acumulado;
}

describe("tamaño de GET /api/flujo (regla 32)", () => {
  const tipico = construirFlujo({ filas: 1600, horizonte: 15 });
  const maximo = construirFlujo({ filas: 1600, horizonte: 24 });

  it("el fixture tiene 1 600 filas distintas", () => {
    expect(tipico.filas).toHaveLength(1600);
    const llaves = new Set(tipico.filas.map((f) => `${f.gml_id}|${f.equivalencia_id}|${f.agrupacion_marca_id}`));
    expect(llaves.size).toBe(1600);
  });

  it(`≤ ${TAMANO_FLUJO_TIPICO / 1024 / 1024} MB con 16 periodos`, () => {
    expect(tipico.datos.periodos).toHaveLength(16);
    expect(bytes(tipico)).toBeLessThanOrEqual(TAMANO_FLUJO_TIPICO);
  });

  it(`≤ ${TAMANO_FLUJO_MAXIMO / 1024 / 1024} MB con 25 periodos`, () => {
    expect(maximo.datos.periodos).toHaveLength(25);
    expect(bytes(maximo)).toBeLessThanOrEqual(TAMANO_FLUJO_MAXIMO);
  });

  it("la lista no trae historia, vpm ni extendido", () => {
    const k = claves(tipico);
    for (const prohibida of ["historia", "vpm", "extendido", "meses", "conciliacion", "al_barrer", "subflujos"]) {
      expect(k.has(prohibida), prohibida).toBe(false);
    }
  });

  it("cada serie tiene un valor por periodo y las señales un carácter por periodo", () => {
    for (const flujo of [tipico, maximo]) {
      const n = flujo.datos.periodos.length;
      for (const serie of [flujo.totales, ...flujo.filas.map((f) => f.serie)]) {
        expect(serie.demanda).toHaveLength(n);
        expect(serie.ingresos).toHaveLength(n);
        expect(serie.stock).toHaveLength(n);
        expect(serie.imi).toHaveLength(n);
        expect(serie.saldo).toHaveLength(n);
        expect(serie.exceso).toHaveLength(n);
        if (serie.reposicion) expect(serie.reposicion).toHaveLength(n);
        expect(serie.senal).toHaveLength(n);
        expect(serie.senal[0]).toBe("-");
        expect(serie.senal).toMatch(/^-[qfxadc]+$/);
        expect(serie.fuera_de_rango).toHaveLength(n);
        expect(serie.fuera_de_rango).toMatch(/^[01]+$/);
      }
    }
  });

  it("unidades enteras e IMI con un decimal (redondeo al serializar)", () => {
    for (const f of tipico.filas) {
      for (const x of [...f.serie.demanda, ...f.serie.stock, ...f.serie.saldo, ...f.serie.exceso, ...f.serie.ingresos]) expect(Number.isInteger(x)).toBe(true);
      for (const x of f.serie.imi) if (x !== null) expect(Math.abs(x * 10 - Math.round(x * 10))).toBeLessThan(1e-9);
    }
  });
});
