import { describe, expect, it } from "vitest";
import { trocear } from "@/lib/aprobacion/trocear";
import { MAX_FILAS_LOTE } from "@/lib/aprobacion/tipos-api";

/** R16 · tandas de un lote grande: ninguna pasa de 300, ningún GM queda partido y el orden es estable. */

type Item = { fila_id: string; gm: string };
const gmDe = (i: Item) => i.gm;

/** Generador pseudoaleatorio con semilla (sin `Math.random`: las pruebas son repetibles). */
function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** `tamanios[i]` filas para el GM `gm-i`. */
function itemsDe(tamanios: readonly number[]): Item[] {
  return tamanios.flatMap((n, g) => Array.from({ length: n }, (_, i) => ({ fila_id: `f-${String(g).padStart(2, "0")}-${String(i).padStart(3, "0")}`, gm: `gm-${String(g).padStart(2, "0")}` })));
}

/** Tamaños con la forma de la ficha: 36 GM, mediana 9, máximo 119, unas 680 filas. */
function tamaniosReales(): number[] {
  const r = aleatorio(7);
  const t = Array.from({ length: 36 }, (_, i) => (i < 10 ? 0 : Math.max(1, Math.round(r() * r() * 60))));
  t[3] = 119;
  t[17] = 112;
  t[21] = 98;
  return t;
}

describe("R16 · trocear", () => {
  it("con la forma de la ficha: ninguna tanda pasa de 300, ningún GM queda partido y no se pierde ni se repite una fila", () => {
    const items = itemsDe(tamaniosReales());
    expect(items.length).toBeGreaterThan(300);
    const { tandas, gm_partidos } = trocear(items, gmDe);
    expect(gm_partidos).toEqual([]);
    expect(tandas.every((t) => t.length > 0 && t.length <= MAX_FILAS_LOTE)).toBe(true);
    expect(tandas.length).toBeGreaterThanOrEqual(Math.ceil(items.length / MAX_FILAS_LOTE));
    expect(tandas.flat().map((i) => i.fila_id).sort()).toEqual(items.map((i) => i.fila_id).sort());
    const tandaDe = new Map<string, number>();
    tandas.forEach((t, n) => t.forEach((i) => tandaDe.set(i.gm, Math.min(tandaDe.get(i.gm) ?? n, n))));
    tandas.forEach((t, n) => t.forEach((i) => expect(tandaDe.get(i.gm)).toBe(n)));
  });

  it("varias semillas y máximos: la invariante se cumple siempre", () => {
    for (const semilla of [1, 2, 3, 4, 5]) {
      const r = aleatorio(semilla);
      const tamanios = Array.from({ length: 20 }, () => 1 + Math.floor(r() * 40));
      for (const max of [40, 100, 300]) {
        const items = itemsDe(tamanios);
        const { tandas, gm_partidos } = trocear(items, gmDe, max);
        expect(gm_partidos).toEqual([]);
        expect(tandas.every((t) => t.length <= max)).toBe(true);
        const gmsPorTanda = tandas.map((t) => new Set(t.map(gmDe)));
        for (let a = 0; a < gmsPorTanda.length; a++) for (let b = a + 1; b < gmsPorTanda.length; b++) for (const gm of gmsPorTanda[a]) expect(gmsPorTanda[b].has(gm)).toBe(false);
        expect(tandas.reduce((s, t) => s + t.length, 0)).toBe(items.length);
      }
    }
  });

  it("el orden es estable: no depende del orden de entrada (GM por clave, filas por fila_id)", () => {
    const items = itemsDe([30, 5, 80, 12, 60, 140, 20]);
    const r = aleatorio(11);
    const barajadas = [...items].sort(() => r() - 0.5);
    const a = trocear(items, gmDe, 100);
    const b = trocear(barajadas, gmDe, 100);
    expect(b).toEqual(a);
    expect(a.tandas.flat().map((i) => i.fila_id)).toEqual(
      [...a.tandas.flat()].sort((x, y) => (x.gm < y.gm ? -1 : x.gm > y.gm ? 1 : x.fila_id < y.fila_id ? -1 : 1)).map((i) => i.fila_id)
    );
  });

  it("llena cada tanda con GM completos y abre otra cuando el siguiente no cabe", () => {
    const { tandas } = trocear(itemsDe([200, 150, 100]), gmDe);
    expect(tandas.map((t) => t.length)).toEqual([200, 250]);
    expect(trocear(itemsDe([100, 100, 100]), gmDe).tandas.map((t) => t.length)).toEqual([300]);
    expect(trocear(itemsDe([100, 100, 100, 1]), gmDe).tandas.map((t) => t.length)).toEqual([300, 1]);
  });

  it("un GM con más filas que el máximo no tiene remedio: se parte y se informa", () => {
    const { tandas, gm_partidos } = trocear(itemsDe([10, 650]), gmDe);
    expect(gm_partidos).toEqual(["gm-01"]);
    expect(tandas.map((t) => t.length)).toEqual([10, 300, 300, 50]);
    expect(tandas.every((t) => t.length <= MAX_FILAS_LOTE)).toBe(true);
  });

  it("sin filas no hay tandas; un máximo inválido es un error", () => {
    expect(trocear([], gmDe)).toEqual({ tandas: [], gm_partidos: [] });
    expect(() => trocear(itemsDe([1]), gmDe, 0)).toThrow();
    expect(() => trocear(itemsDe([1]), gmDe, 1.5)).toThrow();
  });
});
