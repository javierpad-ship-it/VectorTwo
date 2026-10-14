import { beforeEach, describe, expect, it, vi } from "vitest";

const capturas = vi.hoisted(() => ({
  csv: [] as { fields: string[]; data: (string | number)[][]; nombre: string }[],
  excel: [] as { fields: string[]; data: (string | number)[][]; hoja: string; nombre: string }[],
}));
vi.mock("@/components/importador/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/importador/csv")>()),
  descargarCsv: (fields: string[], data: (string | number)[][], nombre: string) => void capturas.csv.push({ fields, data, nombre }),
}));
vi.mock("@/components/importador/excel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/importador/excel")>()),
  descargarExcel: async (fields: string[], data: (string | number)[][], hoja: string, nombre: string) => {
    capturas.excel.push({ fields, data, hoja, nombre });
  },
}));

import { generarCsv } from "@/components/importador/csv";
import {
  COLUMNAS_AGRUPACIONES_VACIAS,
  COLUMNAS_DETALLE,
  COLUMNAS_LINEAS_PARTIDAS,
  COLUMNAS_NODOS_MIXTOS,
  COLUMNAS_RESUMEN,
  HOJA_REPORTE,
  descargarVistaCsv,
  descargarVistaExcel,
  encabezados,
  filasAgrupacionesVacias,
  filasDetalle,
  filasLineasPartidas,
  filasNodosMixtos,
  filasResumen,
  nombreArchivoGmle,
} from "@/lib/reportes/descargas";
import {
  FILTROS_VACIOS,
  armarNodosMixtos,
  armarResumenAgrupaciones,
  enriquecerEquivalencias,
  filtrarEstructura,
  filtrarReporte,
  ordenarFilas,
} from "@/lib/reportes/filtros";
import { columnasDetalle } from "../src/app/(app)/maestros/agrupacion-gmle/detalle-tab";
import { columnasDeTabla } from "../src/app/(app)/maestros/agrupacion-gmle/comunes";
import { crearReporteSintetico } from "./reportes.agrupacion-gmle.vista.fixture";

const reporte = crearReporteSintetico();
const detalle = enriquecerEquivalencias(reporte);
const resumen = armarResumenAgrupaciones(reporte, filtrarEstructura(detalle, FILTROS_VACIOS));
const mixtos = armarNodosMixtos(reporte.nodos, reporte.agrupaciones);
const vacias = reporte.agrupaciones.filter((a) => a.anomalias.includes("agrupacion_vacia"));

beforeEach(() => {
  capturas.csv.length = 0;
  capturas.excel.length = 0;
});

describe("descarga = tabla (regla 11)", () => {
  it("cada fila tiene tantas celdas como columnas, en cada vista", () => {
    const casos: [readonly unknown[], (string | number)[][]][] = [
      [COLUMNAS_RESUMEN, filasResumen(resumen)],
      [COLUMNAS_DETALLE, filasDetalle(detalle)],
      [COLUMNAS_LINEAS_PARTIDAS, filasLineasPartidas(reporte.lineas_partidas)],
      [COLUMNAS_NODOS_MIXTOS, filasNodosMixtos(mixtos)],
      [COLUMNAS_AGRUPACIONES_VACIAS, filasAgrupacionesVacias(vacias)],
    ];
    for (const [columnas, filas] of casos) {
      expect(filas.length).toBeGreaterThan(0);
      for (const fila of filas) expect(fila).toHaveLength(columnas.length);
    }
  });

  it("el Detalle lleva las 15 columnas de la ficha, en su orden", () => {
    expect(encabezados(COLUMNAS_DETALLE)).toEqual([
      "AGRUPACION",
      "TEMPORADA",
      "GENERO",
      "MUNDO",
      "LINEA",
      "NIVEL",
      "UNIDAD",
      "EQUIVALENCIA",
      "CODIGO",
      "GENERICA",
      "ACTIVA",
      "NODO_VIGENTE",
      "AGRUPACION_NODO",
      "MAYORITARIA",
      "ANOMALIAS",
    ]);
  });

  it("las columnas de pantalla tienen las mismas claves, títulos y orden que las de la descarga", () => {
    expect(columnasDetalle(new Map()).map((c) => c.clave)).toEqual(COLUMNAS_DETALLE.map((c) => c.clave));
    expect(columnasDetalle(new Map()).map((c) => c.titulo)).toEqual(encabezados(COLUMNAS_DETALLE));
    for (const columnas of [COLUMNAS_RESUMEN, COLUMNAS_LINEAS_PARTIDAS, COLUMNAS_NODOS_MIXTOS, COLUMNAS_AGRUPACIONES_VACIAS]) {
      const pantalla = columnasDeTabla(columnas as never);
      expect(pantalla.map((c) => c.clave)).toEqual(columnas.map((c) => c.clave));
      expect(pantalla.every((c) => c.ordenable)).toBe(true);
    }
  });

  it("las claves de columna no se repiten en ninguna vista", () => {
    for (const columnas of [COLUMNAS_RESUMEN, COLUMNAS_DETALLE, COLUMNAS_LINEAS_PARTIDAS, COLUMNAS_NODOS_MIXTOS, COLUMNAS_AGRUPACIONES_VACIAS]) {
      const claves = columnas.map((c) => c.clave);
      expect(new Set(claves).size).toBe(claves.length);
    }
  });

  it("la descarga sigue el orden visible y solo lo filtrado", () => {
    const filtradas = filtrarReporte(detalle, { ...FILTROS_VACIOS, genero: "MUJER" });
    const visibles = ordenarFilas(filtradas, COLUMNAS_DETALLE.find((c) => c.clave === "equivalencia")?.valor, { clave: "equivalencia", dir: "desc" });
    const filas = filasDetalle(visibles);
    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f[7])).toEqual(["SIN EQUIVALENCIA", "ESTAMPADO", "CASACA", "BASICO"]);
  });
});

describe("contenido de las filas", () => {
  const fila = (id: string) => {
    const f = detalle.find((x) => x.id === id);
    if (!f) throw new Error(id);
    return filasDetalle([f])[0];
  };

  it("Detalle: genérica discrepante de un nodo mixto", () => {
    expect(fila("e4")).toEqual([
      "PANTALONES VERANO",
      "Verano",
      "HOMBRE",
      "URBANO",
      "PANTALON",
      "GML",
      "Nodo",
      "SIN EQUIVALENCIA",
      "SIN_EQUIVALENCIA",
      "Sí",
      "Sí",
      "Sí",
      "Mixta",
      "PANTALONES INVIERNO",
      "generica_discrepante; nodo_gml_mixto; linea_partida",
    ]);
  });
  it("Detalle: nodo GMLE, sin agrupación, y fila inactiva o de nodo no vigente", () => {
    const sin = fila("e9");
    expect(sin.slice(0, 2)).toEqual(["", ""]);
    expect(sin[5]).toBe("GMLE");
    expect(sin[6]).toBe("Equivalencia");
    expect(sin[12]).toBe("—");
    expect(sin[14]).toBe("sin_agrupacion");
    expect(fila("e11").slice(6, 12)).toEqual(["—", "PARKA", "PARKA", "No", "No", "Sí"]);
    expect(fila("e12")[11]).toBe("No");
    // Nodo no vigente (n5): «—» y no «Sin».
    expect(fila("e12")[12]).toBe("—");
    // Nodo vigente sin agrupación (n4): «Sin» se conserva.
    expect(fila("e10")[12]).toBe("Sin");
    expect(fila("e12")[14]).toBe("");
  });
  it("Resumen: «Sin agrupación» al final, inactiva marcada y sin género literal", () => {
    const filas = filasResumen(resumen);
    expect(filas.at(-1)?.[0]).toBe("Sin agrupación");
    expect(filas.map((f) => f[0])).toContain("VIEJA (inactiva)");
    expect(filas[0]).toEqual(["PANTALONES INVIERNO", "Invierno", "HOMBRE; MUJER", 0, 1, 1, 3, 0, 2, ""]);
    expect(filas.find((f) => f[0] === "VACIA")?.[9]).toBe("agrupacion_vacia");
    const sinGenero = filasResumen([{ ...resumen[0], generos: [] }]);
    expect(sinGenero[0][2]).toBe("Sin género");
  });
  it("Líneas partidas, nodos mixtos y agrupaciones vacías", () => {
    expect(filasLineasPartidas(reporte.lineas_partidas)).toEqual([
      ["HOMBRE", "PANTALON", 2, "PANTALONES INVIERNO (2: URBANO) · PANTALONES VERANO (4: URBANO, FORMAL)"],
    ]);
    expect(filasNodosMixtos(mixtos)).toEqual([["HOMBRE / URBANO / PANTALON", "2 PANTALONES INVIERNO · 2 PANTALONES VERANO", "PANTALONES INVIERNO", 4]]);
    expect(filasAgrupacionesVacias(vacias)).toEqual([["VACIA", "Toda temporada", "HOMBRE"]]);
  });
});

describe("CSV y Excel", () => {
  it("el CSV pasa por generarCsv y escapa una equivalencia que parece fórmula", () => {
    const peligrosa = detalle.map((f) => (f.id === "e1" ? { ...f, equivalencia: "=SUMA(1)", codigo: "+CMD" } : f));
    const csv = generarCsv(encabezados(COLUMNAS_DETALLE), filasDetalle(peligrosa));
    expect(csv).toContain("'=SUMA(1)");
    expect(csv).toContain("'+CMD");
    expect(csv).not.toMatch(/(^|,|\n)=SUMA/);
    expect(csv.split("\r\n")[0]).toBe(encabezados(COLUMNAS_DETALLE).join(","));
  });
  it("descargarVistaCsv entrega encabezados, filas y nombre con la fecha", () => {
    descargarVistaCsv("detalle", COLUMNAS_DETALLE, detalle);
    expect(capturas.csv).toHaveLength(1);
    expect(capturas.csv[0].fields).toEqual(encabezados(COLUMNAS_DETALLE));
    expect(capturas.csv[0].data).toHaveLength(detalle.length);
    expect(capturas.csv[0].nombre).toMatch(/^agrupacion-gmle-detalle-\d{4}-\d{2}-\d{2}\.csv$/);
  });
  it("descargarVistaExcel usa la hoja REPORTE y el mismo contenido que el CSV", async () => {
    await descargarVistaExcel("resumen", COLUMNAS_RESUMEN, resumen);
    expect(capturas.excel).toHaveLength(1);
    expect(capturas.excel[0].hoja).toBe(HOJA_REPORTE);
    expect(capturas.excel[0].hoja).toBe("REPORTE");
    expect(capturas.excel[0].fields).toEqual(encabezados(COLUMNAS_RESUMEN));
    expect(capturas.excel[0].data).toEqual(filasResumen(resumen));
    expect(capturas.excel[0].nombre).toMatch(/^agrupacion-gmle-resumen-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
  it("nombres de archivo por vista, con la fecha local", () => {
    const fecha = new Date(2026, 9, 4, 23, 59);
    expect(nombreArchivoGmle("resumen", "csv", fecha)).toBe("agrupacion-gmle-resumen-2026-10-04.csv");
    expect(nombreArchivoGmle("anomalias-nodos-mixtos", "xlsx", fecha)).toBe("agrupacion-gmle-anomalias-nodos-mixtos-2026-10-04.xlsx");
    expect(nombreArchivoGmle("anomalias-equivalencias", "csv", fecha)).toBe("agrupacion-gmle-anomalias-equivalencias-2026-10-04.csv");
  });
});
