import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { TAMANO_PAGINA, leerTodo } from "@/lib/arbol/consultas";

/**
 * `leerTodo` pagina con `range(desde, hasta)` hasta que una página viene corta.
 * Se prueba con un "cliente" falso que sirve un arreglo en memoria y anota qué
 * rangos le pidieron.
 */

type Fila = { id: number };

function errorPg(message: string): PostgrestError {
  return { name: "PostgrestError", message, details: "", hint: "", code: "XX000" } as PostgrestError;
}

/** Fuente falsa de `total` filas; opcionalmente falla en la página `fallaEn` (0-based). */
function fuente(total: number, fallaEn?: number) {
  const filas: Fila[] = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const rangos: Array<[number, number]> = [];
  const pagina = (desde: number, hasta: number) => {
    rangos.push([desde, hasta]);
    const indice = rangos.length - 1;
    if (fallaEn === indice) return Promise.resolve({ data: null, error: errorPg(`falla en página ${indice + 1}`) });
    return Promise.resolve({ data: filas.slice(desde, hasta + 1), error: null });
  };
  return { pagina, rangos };
}

describe("leerTodo", () => {
  it("usa páginas de 1000", () => {
    expect(TAMANO_PAGINA).toBe(1000);
  });

  it("2 345 filas → 3 páginas, en orden y sin perder ni repetir ninguna", async () => {
    const { pagina, rangos } = fuente(2345);
    const { data, error } = await leerTodo(pagina);
    expect(error).toBeNull();
    expect(data).toHaveLength(2345);
    expect(data[0]).toEqual({ id: 1 });
    expect(data[2344]).toEqual({ id: 2345 });
    expect(new Set(data.map((f) => f.id)).size).toBe(2345);
    expect(rangos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("1 000 filas exactas → 2 páginas (la segunda, vacía, confirma el final)", async () => {
    const { pagina, rangos } = fuente(1000);
    const { data, error } = await leerTodo(pagina);
    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
    expect(rangos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("0 filas → 1 página y arreglo vacío", async () => {
    const { pagina, rangos } = fuente(0);
    const { data, error } = await leerTodo(pagina);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(rangos).toEqual([[0, 999]]);
  });

  it("999 filas → 1 página (vino corta)", async () => {
    const { pagina, rangos } = fuente(999);
    const { data } = await leerTodo(pagina);
    expect(data).toHaveLength(999);
    expect(rangos).toHaveLength(1);
  });

  it("error en la 2.ª página → devuelve el error, no sigue pidiendo y conserva lo leído hasta ahí", async () => {
    const { pagina, rangos } = fuente(2345, 1);
    const { data, error } = await leerTodo(pagina);
    expect(error?.message).toBe("falla en página 2");
    expect(data).toHaveLength(1000);
    expect(rangos).toHaveLength(2);
  });

  it("`data: null` sin error se trata como página vacía", async () => {
    const { data, error } = await leerTodo<Fila>(() => Promise.resolve({ data: null, error: null }));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
