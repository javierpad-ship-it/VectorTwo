import { describe, expect, it } from "vitest";
import { claveDeFila } from "@/lib/flujo/filas";
import { filaDeHecho, stockDelFlujo, stockPorFila, ventaDeCadena } from "@/lib/flujo/stock";
import type { StockFlujoJson } from "@/lib/flujo/tipos";
import { construirConfigFlujo } from "@/lib/marcas/gml/flujo";
import { AGR, EQUIVALENCIAS, estadoFixture } from "./marcas.gml.fixture";

/** Regla 3 de la ficha 08: el stock de CD + tiendas por fila `(g, a)`, clasificado con `claveFlujo`. */

const config = () => construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
const clave = (gml: string, eq: string | null, agr: string) => claveDeFila({ gml_id: gml, equivalencia_id: eq, agrupacion_marca_id: agr });

const json = (filas: StockFlujoJson["filas"], extra: Partial<StockFlujoJson> = {}): StockFlujoJson => ({
  carga_id: "carga-2026-09",
  periodo: "2026-09-01",
  publicada: true,
  equivalencias: ["e1a", "e1b", "e2a", "e2b", "e3"],
  marcas: ["m-alfa", "m-beta", "m-gamma"],
  filas,
  excluido: { stock: 0, unidades: 0 },
  ...extra,
});

// [i_equivalencia, i_marca, stock_cd, stock_tiendas, unidades, stock_inactivas, unidades_inactivas]
const FILAS: StockFlujoJson["filas"] = [
  [0, 0, 100, 200, 400, 0, 0], // e1a · ALFA
  [1, 0, 0, 100, 100, 0, 0], // e1b · ALFA
  [0, 2, 50, 250, 300, 0, 0], // e1a · GAMMA
  [0, 1, 40, 160, 200, 0, 0], // e1a · BETA (barrido)
  [4, 0, 10, 30, 40, 0, 0], // e3 · ALFA
  [4, 2, 20, 40, 60, 0, 0], // e3 · GAMMA
  [4, 1, 5, 5, 10, 0, 0], // e3 · BETA
  [2, 0, 30, 70, 100, 0, 0], // e2a · ALFA
  [3, 0, 0, 20, 20, 0, 0], // e2b · ALFA
];

describe("stockPorFila (regla 3)", () => {
  const mes = stockPorFila(json(FILAS), config());

  it("clasifica con claveFlujo: ALFA relevante en N1, otras RECONOCIDO (GAMMA) en la misma fila de agrupación", () => {
    const f = mes.filas.get(clave("n1", null, AGR.rec))!;
    expect(f.cd).toBe(150);
    expect(f.tiendas).toBe(550);
    expect(stockDelFlujo(f)).toBe(700);
    expect(f.unidades).toBe(800);
    expect([...f.por_marca.keys()].sort()).toEqual(["m-alfa", "m-gamma"]);
    expect(f.por_marca.get("m-alfa")).toMatchObject({ cd: 100, tiendas: 300 });
  });

  it("BETA al barrer en DENIM cuenta en la fila de su agrupación (PREMIUM) del mismo nodo: no se descarta", () => {
    const f = mes.filas.get(clave("n1", null, AGR.pre))!;
    expect(stockDelFlujo(f)).toBe(200);
    expect(f.por_marca.get("m-beta")).toMatchObject({ cd: 40, tiendas: 160 });
    expect(mes.filas.get(clave("n3", null, AGR.pre))).toMatchObject({ cd: 5, tiendas: 5 });
  });

  it("en un nodo GMLE la fila lleva la equivalencia; en un GML, no", () => {
    expect(mes.filas.get(clave("n2", "e2a", AGR.rec))).toBeDefined();
    expect(mes.filas.get(clave("n2", "e2b", AGR.rec))).toBeDefined();
    expect(mes.filas.get(clave("n1", "e1a", AGR.rec))).toBeUndefined();
  });

  it("Σ_f S_k' = el stock total del mes (sin negativos) y no queda nada sin clave", () => {
    const total = FILAS.reduce((a, f) => a + f[2] + f[3], 0);
    const suma = [...mes.filas.values()].reduce((a, f) => a + stockDelFlujo(f), 0);
    expect(suma).toBe(total);
    expect(mes.sin_clave).toEqual({ stock: 0, unidades: 0 });
    expect(mes.filas.size).toBe(6);
  });

  it("un stock negativo se trunca a 0 por fila con aviso; la suma de tiendas positivas y negativas se hace antes", () => {
    const filas: StockFlujoJson["filas"] = [
      [4, 2, 20, -50, 60, 0, 0], // e3 · GAMMA: −30 → 0
      [4, 0, 10, 30, 40, 0, 0], // e3 · ALFA
    ];
    const m = stockPorFila(json(filas), config());
    const f = m.filas.get(clave("n3", null, AGR.rec))!;
    // Misma fila (otras RECONOCIDO de N3 y ALFA relevante): 20 + 10 en CD, −50 + 30 en tiendas → 10 en total
    expect(f.negativo).toBe(false);
    expect(stockDelFlujo(f)).toBe(10);
    const solo = stockPorFila(json([[4, 2, 20, -50, 60, 0, 0]]), config());
    const g = solo.filas.get(clave("n3", null, AGR.rec))!;
    expect(g.negativo).toBe(true);
    expect(stockDelFlujo(g)).toBe(0);
    expect(g.cd).toBe(0);
    expect(g.tiendas).toBe(0);
    expect(g.cadena).toBe(0);
  });

  it("las tiendas inactivas no cuentan en el flujo (cd + tiendas) pero sí en la cadena de la conciliación", () => {
    const m = stockPorFila(json([[0, 0, 100, 200, 400, 300, 50]], { excluido: { stock: 300, unidades: 50 } }), config());
    const f = m.filas.get(clave("n1", null, AGR.rec))!;
    expect(stockDelFlujo(f)).toBe(300);
    expect(f.inactivas).toBe(300);
    expect(f.cadena).toBe(600);
    expect(ventaDeCadena(f)).toBe(450);
    expect(m.excluido).toEqual({ stock: 300, unidades: 50 });
  });

  it("una marca o equivalencia desconocida suma a sin_clave y nunca rompe", () => {
    const m = stockPorFila(
      json(
        [
          [0, 0, 100, 200, 400, 0, 0],
          [0, 3, 7, 13, 5, 0, 0], // marca fuera de la lista
        ],
        { marcas: ["m-alfa", "m-beta", "m-gamma", "m-fantasma"] }
      ),
      config()
    );
    expect(m.sin_clave).toEqual({ stock: 20, unidades: 5 });
    expect(m.filas.size).toBe(1);
    expect(filaDeHecho("m-fantasma", "e1a", config())).toBeNull();
    expect(filaDeHecho("m-alfa", "e-fantasma", config())).toBeNull();
  });

  it("un mes no publicado no trae filas", () => {
    const m = stockPorFila(json(FILAS, { publicada: false }), config());
    expect(m.publicada).toBe(false);
    expect(m.filas.size).toBe(0);
  });

  it("el periodo llega como la fecha de la base y sale como aaaa-mm", () => {
    expect(mes.periodo).toBe("2026-09");
  });
});
