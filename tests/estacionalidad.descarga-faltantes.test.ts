import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectarMapeo, mapeoCompleto } from "@/components/importador/mapeo";
import type { CampoImportador } from "@/components/importador/tipos";
import type { EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";

const capturas = vi.hoisted(() => ({
  csv: [] as { fields: string[]; data: (string | number)[][]; nombre: string }[],
  excel: [] as { fields: string[]; data: (string | number)[][]; hoja: string; nombre: string }[],
}));
vi.mock("@/components/importador/csv", () => ({
  descargarCsv: (fields: string[], data: (string | number)[][], nombre: string) => void capturas.csv.push({ fields, data, nombre }),
}));
vi.mock("@/components/importador/excel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/importador/excel")>()),
  descargarExcel: async (fields: string[], data: (string | number)[][], hoja: string, nombre: string) => {
    capturas.excel.push({ fields, data, hoja, nombre });
  },
}));

import { anchosColumnas } from "@/components/importador/excel";
import {
  ENCABEZADOS_FALTANTES,
  descargarFaltantesCsv,
  descargarFaltantesExcel,
  filasFaltantes,
} from "../src/app/(app)/maestros/estacionalidad/comunes";

const catalogos = {
  generos: [{ id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true }],
  mundos: [{ id: "m-u", codigo: "URBANO", nombre: "URBANO", orden: 10, activo: true }],
  lineas: [
    { id: "l-p", codigo: "PANTALON", nombre: "PANTALON", temporada: "Todo el año" as const, activo: true },
    { id: "l-c", codigo: "CHAQUETA", nombre: "CHAQUETA", temporada: "Invierno" as const, activo: true },
  ],
};

const equivalencia = (id: string, nombre: string, linea: string, esGenerica: boolean): EquivalenciaPlana => ({
  id,
  codigo: nombre.replace(/ /g, "_"),
  nombre,
  es_generica: esGenerica,
  activo: true,
  nodo_id: "n1",
  genero_id: "g-h",
  mundo_id: "m-u",
  linea_id: linea,
  vigente: true,
  ruta: `HOMBRE / URBANO / ${linea === "l-p" ? "PANTALON" : "CHAQUETA"}`,
  agrupacion: null,
  faltante: true,
  motivo_faltante: "sin_agrupacion",
});

const FALTANTES: EquivalenciaPlana[] = [
  equivalencia("e1", "SIN EQUIVALENCIA", "l-p", true),
  equivalencia("e2", "JOGGER", "l-p", false),
  equivalencia("e3", "CHAQUETA", "l-c", false), // se llama como la línea: sale con su nombre literal
];

beforeEach(() => {
  capturas.csv.length = 0;
  capturas.excel.length = 0;
});

describe("descarga de faltantes: encabezados y filas", () => {
  it("los encabezados son las cinco columnas del importador más TEMPORADA", () => {
    expect(ENCABEZADOS_FALTANTES).toEqual(["GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "AGRUPACION", "TEMPORADA"]);
  });

  it("la genérica sale con EQUIVALENCIA vacía; AGRUPACION y TEMPORADA salen vacías para completarlas", () => {
    expect(filasFaltantes(FALTANTES, catalogos)).toEqual([
      ["HOMBRE", "URBANO", "PANTALON", "", "", ""],
      ["HOMBRE", "URBANO", "PANTALON", "JOGGER", "", ""],
      ["HOMBRE", "URBANO", "CHAQUETA", "CHAQUETA", "", ""],
    ]);
    for (const f of filasFaltantes(FALTANTES, catalogos)) expect(f).toHaveLength(ENCABEZADOS_FALTANTES.length);
  });

  it("sin catálogos cae en la ruta de la fila", () => {
    expect(filasFaltantes([FALTANTES[1]], { generos: [], mundos: [], lineas: [] })).toEqual([
      ["HOMBRE", "URBANO", "PANTALON", "JOGGER", "", ""],
    ]);
  });

  it("el CSV y el Excel salen con los mismos encabezados y exactamente las mismas filas", async () => {
    descargarFaltantesCsv(FALTANTES, catalogos, "f.csv");
    await descargarFaltantesExcel(FALTANTES, catalogos, "f.xlsx");
    expect(capturas.csv).toHaveLength(1);
    expect(capturas.excel).toHaveLength(1);
    expect(capturas.excel[0].fields).toEqual(capturas.csv[0].fields);
    expect(capturas.excel[0].data).toEqual(capturas.csv[0].data);
    expect(capturas.csv[0].fields).toEqual(ENCABEZADOS_FALTANTES);
    expect(capturas.csv[0].data).toEqual(filasFaltantes(FALTANTES, catalogos));
    expect(capturas.csv[0].nombre).toBe("f.csv");
    expect(capturas.excel[0]).toMatchObject({ hoja: "ASIGNAR", nombre: "f.xlsx" });
  });
});

describe("anchosColumnas", () => {
  it("mínimo 10, máximo 60 y, en medio, el texto más largo más 2", () => {
    const anchos = anchosColumnas(["A", "NOMBRE LARGO AQUI", "C", "D"], [
      ["x", "y", "z".repeat(100), "w".repeat(20)],
      ["xx", "yy", "z", "w"],
    ]);
    expect(anchos).toEqual([{ wch: 10 }, { wch: 19 }, { wch: 60 }, { wch: 22 }]);
  });

  it("sin filas usa el largo del encabezado y respeta el mínimo", () => {
    expect(anchosColumnas(ENCABEZADOS_FALTANTES, [])).toEqual([{ wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 11 }]);
    expect(anchosColumnas(["A"], [[1], [22]])).toEqual([{ wch: 10 }]); // acepta números
  });
});

/**
 * El importador de equivalencias no exporta sus campos: se leen del propio
 * fuente (el bloque `CAMPOS`) para comprobar el autodetectado sin tocar ese archivo.
 */
function camposDelImportadorDeEquivalencias(): CampoImportador<string>[] {
  const fuente = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/maestros/estacionalidad/importar-estacionalidad.tsx"), "utf8");
  const bloque = /const CAMPOS:[^=]*=\s*\[([\s\S]*?)\n\];/.exec(fuente)?.[1] ?? "";
  const campos: CampoImportador<string>[] = [];
  for (const m of bloque.matchAll(/campo:\s*"(\w+)"[\s\S]*?alias:\s*\[([^\]]*)\]([\s\S]*?)\}/g)) {
    campos.push({
      campo: m[1],
      etiqueta: m[1],
      alias: [...m[2].matchAll(/"([^"]+)"/g)].map((a) => a[1]),
      ...(/opcional:\s*true/.test(m[3]) ? { opcional: true } : {}),
    });
  }
  return campos;
}

describe("el CSV de faltantes entra tal cual al importador de equivalencias", () => {
  it("el mapeo autodetecta las seis columnas y queda completo", () => {
    const campos = camposDelImportadorDeEquivalencias();
    expect(campos.map((c) => c.campo)).toEqual(["genero", "mundo", "linea", "equivalencia", "agrupacion", "temporada"]);
    const mapeo = detectarMapeo(ENCABEZADOS_FALTANTES, campos);
    expect(mapeo).toEqual({
      genero: "GENERO",
      mundo: "MUNDO",
      linea: "LINEA",
      equivalencia: "EQUIVALENCIA",
      agrupacion: "AGRUPACION",
      temporada: "TEMPORADA",
    });
    expect(mapeoCompleto(mapeo, campos)).toBe(true);
    expect(campos.find((c) => c.campo === "temporada")?.opcional).toBe(true);
  });
});
