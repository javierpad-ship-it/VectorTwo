import { describe, expect, it } from "vitest";
import {
  avisosDeDemanda,
  claveDeFila,
  demandaDeFila,
  diferenciaMeses,
  filasFlujo,
  mesesEntre,
  planHorizonte,
  sumarMes,
  type FilaCerradaFlujo,
} from "@/lib/flujo/filas";
import { AGR_M8, DEMANDA_CASO1, NODO_M8, cerradaDeFila, participaciones, MARCA_M8 } from "./flujo.soporte";

/** Reglas 1 (filas), 29 (filas sin curva) y 33 (horizonte) de la ficha 08. */

const fila = (p: Partial<FilaCerradaFlujo> & Pick<FilaCerradaFlujo, "total" | "meses">): FilaCerradaFlujo => ({
  gml_id: NODO_M8.urbano,
  equivalencia_id: null,
  agrupacion_marca_id: AGR_M8.reconocido,
  tienda_id: null,
  anio: 2026,
  ...p,
});

const meses = (desdeOct: number): number[] => [0, 0, 0, 0, 0, 0, 0, 0, 0, desdeOct, desdeOct, desdeOct];
const periodos = mesesEntre("2026-10", "2026-12");

describe("meses", () => {
  it("sumarMes y mesesEntre cruzan el fin de año", () => {
    expect(sumarMes("2026-11", 3)).toBe("2027-02");
    expect(sumarMes("2026-01", -1)).toBe("2025-12");
    expect(mesesEntre("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(mesesEntre("2027-02", "2026-11")).toEqual([]);
    expect(diferenciaMeses("2026-09", "2027-01")).toBe(4);
  });
});

describe("filasFlujo (regla 1)", () => {
  it("una fila por (g, a): suma los bloques y las tiendas; Σ_f D_m = el total mensual de la cerrada", () => {
    const cerrada = [
      fila({ total: 450, meses: meses(150) }), // mismas
      fila({ total: 90, meses: meses(30), tienda_id: "t-nueva" }), // tienda nueva
      fila({ gml_id: NODO_M8.polo, total: 300, meses: meses(100) }),
    ];
    const filas = filasFlujo(cerrada, [], 2026);
    expect(filas).toHaveLength(2);
    const denim = filas.find((f) => f.gml_id === NODO_M8.urbano)!;
    expect(demandaDeFila(denim, periodos)).toEqual([180, 180, 180]);
    const total = periodos.map((_, i) => filas.reduce((a, f) => a + demandaDeFila(f, periodos)[i], 0));
    expect(total).toEqual([280, 280, 280]);
    expect(denim.clave).toBe(claveDeFila({ gml_id: NODO_M8.urbano, equivalencia_id: null, agrupacion_marca_id: AGR_M8.reconocido }));
    expect(denim.en_cerrada).toBe(true);
    expect(denim.sin_curva).toBe(false);
  });

  it("usa el año de cada mes: las filas de 2026 y de 2027 se leen juntas", () => {
    const cerrada = cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: DEMANDA_CASO1 });
    const [denim] = filasFlujo(cerrada, [], 2026);
    expect(denim.demanda.get("2026-10")).toBe(150);
    expect(denim.demanda.get("2027-11")).toBe(160);
    expect(denim.demanda.get("2027-12")).toBe(183);
  });

  it("una fila sin proyección nace de un stock o un ingreso sin fila en la cerrada: demanda 0 y aviso", () => {
    const cerrada = cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: [100, 100, 100] });
    const huerfana = { gml_id: NODO_M8.sandalia, equivalencia_id: null, agrupacion_marca_id: AGR_M8.valor };
    const existente = { gml_id: NODO_M8.urbano, equivalencia_id: null, agrupacion_marca_id: AGR_M8.reconocido };
    const filas = filasFlujo(cerrada, [huerfana, existente], 2026);
    expect(filas).toHaveLength(2);
    const f = filas.find((x) => x.gml_id === NODO_M8.sandalia)!;
    expect(f.en_cerrada).toBe(false);
    expect(demandaDeFila(f, periodos)).toEqual([0, 0, 0]);
    expect(avisosDeDemanda(f)).toEqual(["fila_sin_proyeccion"]);
    expect(avisosDeDemanda(filas.find((x) => x.gml_id === NODO_M8.urbano)!)).toEqual([]);
  });

  it("el orden es estable (por clave) y las participaciones salen de la fila base, no de la tienda", () => {
    const partic = participaciones({ [MARCA_M8.jh]: 0.4 });
    const cerrada = [
      ...cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: [10, 10, 10], tienda: "t1", partic }),
      ...cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: [10, 10, 10], partic }),
    ];
    const [f] = filasFlujo(cerrada, [], 2026);
    expect(f.participaciones).toEqual(partic);
    const solo = filasFlujo(cerradaDeFila({ gml: NODO_M8.urbano, agr: AGR_M8.reconocido, demanda: [10], tienda: "t1" }), [], 2026);
    expect(solo[0].participaciones).toBeNull();
    const a = filasFlujo([...cerrada].reverse(), [], 2026).map((x) => x.clave);
    expect(a).toEqual([...a].sort());
  });
});

describe("filas sin curva (regla 29)", () => {
  it("meses = null con total 0 aporta 0 y no avisa nada", () => {
    const [f] = filasFlujo([fila({ total: 0, meses: null })], [], 2026);
    expect(f.sin_curva).toBe(false);
    expect(f.unidades_sin_curva).toBe(0);
    expect(avisosDeDemanda(f)).toEqual([]);
  });

  it("si todas las filas con total > 0 vienen sin meses → sin_curva; cuenta su venta anual", () => {
    const [f] = filasFlujo([fila({ total: 1200, meses: null }), fila({ total: 0, meses: null, tienda_id: "t1" })], [], 2026);
    expect(f.sin_curva).toBe(true);
    expect(f.venta_anual).toBe(1200);
    expect(avisosDeDemanda(f)).toEqual(["sin_curva"]);
    expect(demandaDeFila(f, periodos)).toEqual([0, 0, 0]);
  });

  it("una base con curva y una de tienda sin curva con total 120 → demanda sin esos 120 y demanda_parcial_sin_curva", () => {
    const [f] = filasFlujo([fila({ total: 450, meses: meses(150) }), fila({ total: 120, meses: null, tienda_id: "t1" })], [], 2026);
    expect(f.sin_curva).toBe(false);
    expect(f.unidades_sin_curva).toBe(120);
    expect(demandaDeFila(f, periodos)).toEqual([150, 150, 150]);
    expect(avisosDeDemanda(f)).toEqual(["demanda_parcial_sin_curva"]);
  });

  it("con total 0 en la tienda no hay aviso parcial", () => {
    const [f] = filasFlujo([fila({ total: 450, meses: meses(150) }), fila({ total: 0, meses: null, tienda_id: "t1" })], [], 2026);
    expect(f.unidades_sin_curva).toBe(0);
    expect(avisosDeDemanda(f)).toEqual([]);
  });
});

describe("horizonte (regla 33)", () => {
  it("k' = set-2026 y la cerrada 2026 → horizonte oct-26 … dic-27 (en_curso)", () => {
    const p = planHorizonte("2026-09", [2026]);
    expect(p).toMatchObject({ anio: 2026, cubre: "en_curso", horizonte: { desde: "2026-10", hasta: "2027-12" }, anios_a_leer: [2026, 2027], horizonte_corto: false });
  });

  it("k' = dic-2026 y solo la cerrada 2026 → anio 2027, siguiente, ene-27 … dic-27 con horizonte_corto", () => {
    const p = planHorizonte("2026-12", [2026]);
    expect(p).toMatchObject({ anio: 2027, cubre: "siguiente", anio_cerrada: 2026, horizonte: { desde: "2027-01", hasta: "2027-12" }, anios_a_leer: [2027], horizonte_corto: true });
  });

  it("k' = dic-2026 y solo la cerrada 2025 → sin cerrada (404 sin_cerrada)", () => {
    expect(planHorizonte("2026-12", [2025])).toBeNull();
    expect(planHorizonte("2026-12", [])).toBeNull();
  });

  it("caso 15: solo la cerrada de 2025 y k' = dic-2025 → ene-26 … dic-26, horizonte corto", () => {
    const p = planHorizonte("2025-12", [2025]);
    expect(p).toMatchObject({ anio: 2026, cubre: "siguiente", horizonte: { desde: "2026-01", hasta: "2026-12" }, horizonte_corto: true });
  });

  it("con k' = dic y la cerrada del año siguiente el horizonte llega a 24 meses", () => {
    const p = planHorizonte("2026-12", [2027, 2026])!;
    expect(p.cubre).toBe("en_curso");
    expect(mesesEntre(p.horizonte.desde, p.horizonte.hasta)).toHaveLength(24);
  });

  it("si hay las dos cerradas manda la del año de k'+1", () => {
    expect(planHorizonte("2026-09", [2025, 2026])?.anio_cerrada).toBe(2026);
  });
});
