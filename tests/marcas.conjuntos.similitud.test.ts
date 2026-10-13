import { describe, expect, it } from "vitest";
import { sugerirConjuntos, type MarcaParaSugerir } from "@/lib/marcas/conjuntos/similitud";
import { similitud } from "@/lib/ventas/sugerir-mapeo";
import { AGRUPACIONES, marcasFixture, marcasSinConjuntos } from "./marcas.gml.fixture";

/** Regla 24 y caso 19 de 02b: sugerencia de conjuntos por parecido de nombre. */

const nombreAgrupacion = new Map(AGRUPACIONES.map((a) => [a.id, a.nombre]));
const paraSugerir = (lista = marcasSinConjuntos()): MarcaParaSugerir[] =>
  lista.map((m) => ({ ...m, agrupacion_nombre: nombreAgrupacion.get(m.agrupacion_marca_id) ?? "" }));
const m = (id: string, nombre: string, extra: Partial<MarcaParaSugerir> = {}): MarcaParaSugerir => ({
  id,
  nombre,
  activo: true,
  agrupacion_marca_id: "ag-rec",
  conjunto_marca_id: null,
  agrupacion_nombre: "RECONOCIDO",
  ...extra,
});
const nombres = (g: { marcas: { nombre: string }[] }) => g.marcas.map((x) => x.nombre);

describe("caso 19: sugerencias de conjuntos sobre el fixture sin conjuntos (umbral 0,5)", () => {
  const grupos = sugerirConjuntos(paraSugerir(), 0.5);

  it("{ALFA, ALFA JEANS, ALFA KIDS} con cabeza ALFA por primera palabra común", () => {
    const g = grupos.find((x) => nombres(x).includes("ALFA"));
    expect(g && nombres(g)).toEqual(["ALFA", "ALFA JEANS", "ALFA KIDS"]);
    expect(g?.cabeza).toEqual({ id: "m-alfa", nombre: "ALFA" });
    expect(g?.cabeza_id).toBe("m-alfa");
    expect(g?.razones.some((r) => r.razon === "primera_palabra" && r.detalle === "primera palabra común: ALFA")).toBe(true);
  });
  it("{GAMMA, GAMMA SPORT} con cabeza GAMMA", () => {
    const g = grupos.find((x) => nombres(x).includes("GAMMA"));
    expect(g && nombres(g)).toEqual(["GAMMA", "GAMMA SPORT"]);
    expect(g?.cabeza.nombre).toBe("GAMMA");
    expect(g?.razones[0]).toMatchObject({ a: "GAMMA", b: "GAMMA SPORT", razon: "primera_palabra" });
  });
  it("{BETA, BETA UNO, BETA DOS} cabeza BETA", () => {
    const g = grupos.find((x) => nombres(x).includes("BETA"));
    expect(g && nombres(g)).toEqual(["BETA", "BETA DOS", "BETA UNO"]);
    expect(g?.cabeza.nombre).toBe("BETA");
  });
  it("{DELTA, DELTO} por similitud de nombres (los bigramas DE, EL y LT de 4 cada uno: 0,75)", () => {
    const g = grupos.find((x) => nombres(x).includes("DELTA"));
    expect(g && nombres(g)).toEqual(["DELTA", "DELTO"]);
    expect(g?.razones).toEqual([{ a: "DELTA", b: "DELTO", razon: "similar", similitud: 0.75, detalle: "similar 0,75" }]);
    expect(similitud("DELTA", "DELTO")).toBe(0.75);
  });
  it("OMEGA (inactiva) y ÉPSILON no están en ningún grupo; VARIOS, OTROS y SIN MARCA nunca", () => {
    const todos = grupos.flatMap(nombres);
    for (const fuera of ["OMEGA", "ÉPSILON", "VARIOS", "OTROS", "SIN MARCA"]) expect(todos).not.toContain(fuera);
  });
  it("ordenados por tamaño de grupo y deterministas", () => {
    expect(grupos.map((g) => g.marcas.length)).toEqual([3, 3, 2, 2]);
    expect(grupos.map((g) => g.cabeza.nombre)).toEqual(["ALFA", "BETA", "DELTA", "GAMMA"]);
    expect(JSON.stringify(sugerirConjuntos(paraSugerir(), 0.5))).toBe(JSON.stringify(grupos));
  });
  it("cada marca trae su agrupación en claro", () => {
    const g = grupos.find((x) => nombres(x).includes("GAMMA SPORT"));
    expect(g?.marcas.find((x) => x.nombre === "GAMMA SPORT")?.agrupacion_marca).toEqual({ id: "ag-val", nombre: "VALOR" });
  });
});

describe("regla 24: señales y candidatas", () => {
  it("BETA UNO y BETA DOS sin BETA: grupo sin cabeza obvia; propone la primera de nombre más corto", () => {
    const g = sugerirConjuntos([m("1", "BETA UNO"), m("2", "BETA DOS")]);
    expect(g).toHaveLength(1);
    expect(g[0].cabeza.nombre).toBe("BETA UNO");
  });
  it("ALFA y OMEGA no se parecen: nada", () => {
    expect(sugerirConjuntos([m("1", "ALFA"), m("2", "OMEGA")])).toEqual([]);
  });
  it("las palabras vacías no cuentan como primera palabra (NEW ALFA no es ALFA)", () => {
    expect(sugerirConjuntos([m("1", "NEW ALFA"), m("2", "NEW BETA")], 0.9)).toEqual([]);
    expect(sugerirConjuntos([m("1", "THE GAMMA"), m("2", "THE DELTA")], 0.9)).toEqual([]);
  });
  it("la primera palabra necesita al menos 3 letras", () => {
    expect(sugerirConjuntos([m("1", "AB UNO"), m("2", "AB DOS")], 0.9)).toEqual([]);
  });
  it("solo marcas activas, sin conjunto, que no son cabeza ni genéricas", () => {
    const marcas = [
      m("1", "ALFA"), // cabeza (tiene un miembro): no se ofrece de nuevo
      m("2", "ALFA JEANS", { conjunto_marca_id: "1" }), // ya está en un conjunto
      m("3", "ALFA KIDS", { activo: false }), // inactiva
      m("4", "ALFA SPORT"),
      m("5", "ALFA TEEN"),
      m("6", "VARIOS"), // genérica
      m("7", "VARIOS UNO"),
      m("8", "VARIOS DOS"),
    ];
    const g = sugerirConjuntos(marcas);
    expect(g.map(nombres)).toEqual([["ALFA SPORT", "ALFA TEEN"], ["VARIOS DOS", "VARIOS UNO"]]);
    const todos = g.flatMap(nombres);
    for (const fuera of ["ALFA", "ALFA JEANS", "ALFA KIDS", "VARIOS"]) expect(todos).not.toContain(fuera);
  });
  it("las componentes conexas se juntan por cadena de parecidos", () => {
    const g = sugerirConjuntos([m("1", "SOL"), m("2", "SOL NORTE"), m("3", "SOL SUR"), m("4", "SOLAR")], 0.9);
    expect(g).toHaveLength(1);
    expect(g[0].marcas.map((x) => x.nombre)).toEqual(["SOL", "SOL NORTE", "SOL SUR"]);
  });
  it("un umbral más alto deja fuera lo que solo se parece un poco", () => {
    const marcas = [m("1", "DELTA"), m("2", "DELTO")];
    expect(sugerirConjuntos(marcas, 0.5)).toHaveLength(1);
    expect(sugerirConjuntos(marcas, 0.9)).toEqual([]);
  });
  it("nunca escribe: no muta las marcas recibidas", () => {
    const lista = paraSugerir();
    const copia = JSON.stringify(lista);
    sugerirConjuntos(lista);
    expect(JSON.stringify(lista)).toBe(copia);
    expect(marcasFixture().length).toBeGreaterThan(0);
  });
});
