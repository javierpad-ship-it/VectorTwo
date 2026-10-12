import { describe, expect, it } from "vitest";
import { FILTRO_ARBOL_VACIO, filtrarPorArbol, lineasVigentes, resumenLineas } from "@/lib/estacionalidad/filtro-arbol";
import type { EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";

function eq(nombre: string, linea: string, genero = "g1", mundo = "m1"): EquivalenciaPlana {
  return {
    id: `${genero}-${mundo}-${linea}-${nombre}`,
    nombre,
    codigo: nombre,
    genero_id: genero,
    mundo_id: mundo,
    linea_id: linea,
    ruta: `G / M / ${linea}`,
  } as unknown as EquivalenciaPlana;
}

const FILAS = [eq("A1", "abrigos"), eq("A2", "abrigos"), eq("C1", "casacas"), eq("P1", "pijamas"), eq("C2", "casacas", "g2")];

describe("filtrarPorArbol con varias líneas", () => {
  it("sin líneas marcadas deja pasar todas", () => {
    expect(filtrarPorArbol(FILAS, FILTRO_ARBOL_VACIO)).toHaveLength(5);
  });

  it("una línea filtra solo esa", () => {
    expect(filtrarPorArbol(FILAS, { ...FILTRO_ARBOL_VACIO, lineaIds: ["pijamas"] }).map((e) => e.nombre)).toEqual(["P1"]);
  });

  it("dos líneas (abrigos y casacas) pasan juntas", () => {
    const r = filtrarPorArbol(FILAS, { ...FILTRO_ARBOL_VACIO, lineaIds: ["abrigos", "casacas"] });
    expect(r.map((e) => e.nombre)).toEqual(["A1", "A2", "C1", "C2"]);
  });

  it("se combina con género y no con lo que no coincide", () => {
    const r = filtrarPorArbol(FILAS, { ...FILTRO_ARBOL_VACIO, generoId: "g1", lineaIds: ["abrigos", "casacas"] });
    expect(r.map((e) => e.nombre)).toEqual(["A1", "A2", "C1"]);
  });
});

describe("lineasVigentes y resumenLineas", () => {
  const disponibles = [
    { id: "abrigos", nombre: "ABRIGOS" },
    { id: "casacas", nombre: "CASACAS" },
    { id: "pijamas", nombre: "PIJAMAS" },
  ];

  it("descarta las líneas que ya no están disponibles", () => {
    expect(lineasVigentes(["abrigos", "fantasma"], disponibles)).toEqual(["abrigos"]);
  });

  it("resume: todas, una, dos por nombre y más como conteo", () => {
    expect(resumenLineas([], disponibles)).toBe("Todas");
    expect(resumenLineas(["pijamas"], disponibles)).toBe("PIJAMAS");
    expect(resumenLineas(["abrigos", "casacas"], disponibles)).toBe("ABRIGOS, CASACAS");
    expect(resumenLineas(["abrigos", "casacas", "pijamas"], disponibles)).toBe("3 líneas");
  });
});
