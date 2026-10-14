import { describe, expect, it } from "vitest";
import { PAGINA_FILAS, ampliarLimite, filasPorAnadir, hayMasFilas, limitarFilas, normalizarLimite } from "@/lib/reportes/paginacion";

const filas = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginación del Detalle (M11)", () => {
  it("la página inicial es de 200 filas", () => {
    expect(PAGINA_FILAS).toBe(200);
  });

  it("limitarFilas conserva el orden, no muta la entrada y no pasa del total", () => {
    const todas = filas(500);
    const copia = [...todas];
    const primeras = limitarFilas(todas, 200);
    expect(primeras).toHaveLength(200);
    expect(primeras).toEqual(copia.slice(0, 200));
    expect(todas).toEqual(copia);
    expect(limitarFilas(filas(30), 200)).toEqual(filas(30));
    expect(limitarFilas([], 200)).toEqual([]);
  });

  it("normalizarLimite descarta valores negativos, no enteros o no finitos", () => {
    expect(normalizarLimite(-5, 10)).toBe(0);
    expect(normalizarLimite(Number.NaN, 10)).toBe(0);
    expect(normalizarLimite(3.9, 10)).toBe(3);
    expect(normalizarLimite(50, 10)).toBe(10);
    expect(normalizarLimite(5, -1)).toBe(0);
  });

  it("filasPorAnadir y ampliarLimite avanzan de a una página y se detienen en el total", () => {
    expect(filasPorAnadir(200, 2336)).toBe(200);
    expect(ampliarLimite(200, 2336)).toBe(400);
    // Última página parcial: 2 336 = 11 × 200 + 136.
    expect(filasPorAnadir(2200, 2336)).toBe(136);
    expect(ampliarLimite(2200, 2336)).toBe(2336);
    expect(filasPorAnadir(2336, 2336)).toBe(0);
    expect(ampliarLimite(2336, 2336)).toBe(2336);
    expect(ampliarLimite(200, 2336, 50)).toBe(250);
  });

  it("hayMasFilas es falso cuando todo cabe o ya se muestra todo", () => {
    expect(hayMasFilas(200, 2336)).toBe(true);
    expect(hayMasFilas(200, 200)).toBe(false);
    expect(hayMasFilas(200, 12)).toBe(false);
    expect(hayMasFilas(200, 0)).toBe(false);
  });

  it("recorrer todas las páginas muestra cada fila exactamente una vez", () => {
    const todas = filas(2336);
    let limite = PAGINA_FILAS;
    let vueltas = 0;
    while (hayMasFilas(limite, todas.length)) {
      limite = ampliarLimite(limite, todas.length);
      vueltas++;
    }
    expect(vueltas).toBe(11);
    expect(limitarFilas(todas, limite)).toEqual(todas);
  });
});
