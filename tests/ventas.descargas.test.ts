import { describe, expect, it } from "vitest";
import { tablaCombinacionesDesconocidas, tablaOmitidas } from "@/lib/ventas/descargas";
import { crearPeticionPrevisualizar } from "@/lib/ventas/previsualizar";
import { previsualizarSchema } from "@/lib/ventas/esquemas";
import { acumular, informe } from "./ventas.fixture";

describe("petición de previsualizar", () => {
  it("manda solo los valores distintos, en el orden de los diccionarios, y pasa el esquema", () => {
    const acum = acumular([
      { tienda: "LUKERS UNO", marca: "ALFA", equivalencia: "-" },
      { tienda: "LUKERS UNO", marca: "BETA", equivalencia: "DENIM" }, // misma clave que el `-`
      { tienda: "LUKERS DOS", marca: "ALFA", mes: "Ago" },
    ]);
    const p = crearPeticionPrevisualizar(acum);
    expect(p.tiendas).toEqual(["LUKERS UNO", "LUKERS DOS"]);
    expect(p.marcas).toEqual(["ALFA", "BETA"]);
    expect(p.periodos).toEqual(["2026-08", "2026-09"]);
    // `-` y el nombre literal de la línea son la misma combinación: una sola entrada.
    expect(p.combinaciones.map((c) => c.equivalencia)).toEqual(["DENIM", "PANTALON VARIOS"]);
    expect(previsualizarSchema.safeParse(p).success).toBe(true);
  });
});

describe("descargas del reporte previo", () => {
  const r = informe([
    {},
    { tienda: "LOCAL X" },
    { genero: "MUJER", mundo: "URBANO", linea: "POLO", equivalencia: "-" },
    { genero: "MUJER", mundo: "URBANO", linea: "POLO", equivalencia: "" },
    { tienda: "OFICINA CENTRAL" },
    { mes: "xx" },
  ]);

  it("omitidas: una fila por valor con motivo, filas, primera fila y pesos", () => {
    const t = tablaOmitidas(r.informe);
    expect(t.campos.slice(0, 6)).toEqual(["PERIODO", "MOTIVO", "TIPO", "VALOR", "FILAS", "PRIMERA_FILA"]);
    const de = (motivo: string) => t.datos.find((f) => f[1] === motivo);
    expect(de("Tienda que no existe en el sistema")).toEqual(["2026-09", "Tienda que no existe en el sistema", "ERROR", "LOCAL X", 1, 2, 1000, 400, 10, 20, 800]);
    expect(de("Tienda desactivada")?.[2]).toBe("DECISION");
    expect(de("Mes o año no reconocido")?.[0]).toBe("(sin mes)");
    expect(t.datos.every((f) => f.length === t.campos.length)).toBe(true);
  });

  it("formato árbol: la equivalencia como vino y las columnas extra que el importador ignora", () => {
    const t = tablaCombinacionesDesconocidas(r.combinacionesDesconocidas);
    expect(t.campos).toEqual(["GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "FILAS", "VENTA", "STOCK_VALORIZADO", "MOTIVO"]);
    expect(t.datos.map((f) => [f[3], f[7]]).sort()).toEqual([
      ["", "nodo_inexistente"],
      ["-", "nodo_inexistente"],
    ]);
  });
});
