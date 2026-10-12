import { describe, expect, it } from "vitest";
import type { EstadoImportacion } from "@/lib/arbol/importar";
import { crearSugeridor, similitud, sugerirMapeo, MAX_SUGERENCIAS, UMBRAL_FUERTE, UMBRAL_SUGERENCIA } from "@/lib/ventas/sugerir-mapeo";
import { crearIndiceDestinos } from "@/lib/ventas/resolver";
import { ARBOL_SUGERENCIA } from "./ventas.fixture";

/**
 * Sugerencia automática de destino (M5b, regla 13 y "Casos de prueba" de la
 * ficha 05b). Árbol sintético `ARBOL_SUGERENCIA`.
 *
 * Nota: la ficha da 0,86 para SKINY → SKINNY y 0,91 para PANTALÓN DRIL →
 * PANTALON DRILL; el Dice sobre bigramas que la propia ficha define da 0,89 y
 * 0,96 (4 bigramas comunes de 4+5; 11 de 11+12). Se prueba el valor del
 * algoritmo, que es el contrato (los casos se clasifican igual: ambas son fuertes).
 */

const sug = (g: string, m: string, l: string, e: string, estado: EstadoImportacion = ARBOL_SUGERENCIA) =>
  sugerirMapeo({ genero: g, mundo: m, linea: l, equivalencia: e }, estado);

describe("similitud: Dice sobre bigramas de aCodigo", () => {
  it("1 si coinciden sin tildes ni signos; 0 si alguno tiene menos de 2 caracteres", () => {
    expect(similitud("SKÍNNY", "SKINNY")).toBe(1);
    expect(similitud("Pantalón  Drill", "PANTALON-DRILL")).toBe(1);
    expect(similitud("A", "A B")).toBe(0);
    expect(similitud("", "DENIM")).toBe(0);
    expect(similitud("-", "DENIM")).toBe(0);
  });

  it("2·|A∩B| / (|A|+|B|) con multiconjuntos, a dos decimales", () => {
    expect(similitud("HOMBRES", "HOMBRE")).toBe(0.91); // 10 / 11
    expect(similitud("SKINY", "SKINNY")).toBe(0.89); // 8 / 9
    expect(similitud("PANTALÓN DRIL", "PANTALON DRILL")).toBe(0.96); // 22 / 23
    expect(similitud("JEAN", "DENIM")).toBe(0);
    // multiconjunto: AAA tiene 2 bigramas AA; AAAA tiene 3 → 2·2 / 5
    expect(similitud("AAA", "AAAA")).toBe(0.8);
  });

  it("es simétrica y tolera reordenar palabras", () => {
    expect(similitud("PANTALON DENIM", "DENIM PANTALON")).toBe(similitud("DENIM PANTALON", "PANTALON DENIM"));
    expect(similitud("PANTALON DENIM", "DENIM PANTALON")).toBeGreaterThan(0.8);
  });
});

describe("regla 13: los diez casos de la ficha", () => {
  it("1. HOMBRE / URBANO / DENIM / SKINY → SKINNY fuerte; SLIM queda fuera; una sola sugerencia", () => {
    const r = sug("HOMBRE", "URBANO", "DENIM", "SKINY");
    expect(r).toEqual([
      {
        equivalencia_id: "s1-skinny",
        genero: "HOMBRE",
        mundo: "URBANO",
        linea: "DENIM",
        equivalencia: "SKINNY",
        puntuacion: 0.89,
        razon: "similar 0,89",
        fuerte: true,
      },
    ]);
  });

  it("2. HOMBRE / URBANO / DENIM / SKÍNNY → SKINNY 1,00 «mismo nombre sin tildes ni signos»", () => {
    const r = sug("HOMBRE", "URBANO", "DENIM", "SKÍNNY");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ equivalencia_id: "s1-skinny", puntuacion: 1, razon: "mismo nombre sin tildes ni signos", fuerte: true });
  });

  it("3. HOMBRE / URBANO / DENIM / BOOTCUT → la genérica con 0,50, no fuerte", () => {
    const r = sug("HOMBRE", "URBANO", "DENIM", "BOOTCUT");
    expect(r).toEqual([
      {
        equivalencia_id: "s1-gen",
        genero: "HOMBRE",
        mundo: "URBANO",
        linea: "DENIM",
        equivalencia: "SIN EQUIVALENCIA",
        puntuacion: 0.5,
        razon: "única opción: genérica del nodo",
        fuerte: false,
      },
    ]);
  });

  it("4. HOMBRE / URBANO / JEAN / JEAN (venía «-») → sin sugerencia", () => {
    expect(sug("HOMBRE", "URBANO", "JEAN", "JEAN")).toEqual([]);
  });

  it("5. HOMBRE / URBANO / PANTALÓN DRIL / PANTALÓN DRIL → la equivalencia que se llama como la línea nueva, fuerte", () => {
    const r = sug("HOMBRE", "URBANO", "PANTALÓN DRIL", "PANTALÓN DRIL");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      equivalencia_id: "s2-drill",
      linea: "PANTALON DRILL",
      equivalencia: "PANTALON DRILL",
      puntuacion: 0.96,
      razon: "línea similar 0,96 · equivalencia igual a la línea",
      fuerte: true,
    });
  });

  it("6. HOMBRES / URBANO / DENIM / SLIM → sustituto HOMBRE (0,91) y SLIM 1,00 → 0,91 fuerte", () => {
    const r = sug("HOMBRES", "URBANO", "DENIM", "SLIM");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ equivalencia_id: "s1-slim", genero: "HOMBRE", puntuacion: 0.91, fuerte: true });
    expect(r[0].razon).toContain("género HOMBRES → HOMBRE (0,91)");
    expect(r[0].razon).toContain("mismo nombre");
  });

  it("7. HOMBRE / (vacío) / DENIM / SKINNY → HOMBRE/URBANO/DENIM → SKINNY 0,67; MUJER queda fuera (contradice el género)", () => {
    const r = sug("HOMBRE", "", "DENIM", "SKINNY");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      equivalencia_id: "s1-skinny",
      genero: "HOMBRE",
      mundo: "URBANO",
      puntuacion: 0.67,
      razon: "línea igual · 2 de 3 piezas conocidas",
      fuerte: false,
    });
    expect(r.some((x) => x.genero === "MUJER")).toBe(false);
  });

  it("8. (vacío) / (vacío) / DENIM / MOM → todas por debajo de 0,5 → sin sugerencia", () => {
    expect(sug("", "", "DENIM", "MOM")).toEqual([]);
  });

  it("9. HOMBRE / CASUAL / CHOMPA / CHOMPA (línea inactiva) → sin sugerencia", () => {
    expect(sug("HOMBRE", "CASUAL", "CHOMPA", "CHOMPA")).toEqual([]);
  });

  it("10. determinismo: el mismo origen y árbol dan lo mismo en dos llamadas y con los nodos y equivalencias en otro orden", () => {
    const barajado: EstadoImportacion = {
      generos: [...ARBOL_SUGERENCIA.generos].reverse(),
      mundos: [...ARBOL_SUGERENCIA.mundos].reverse(),
      lineas: [...ARBOL_SUGERENCIA.lineas].reverse(),
      nodos: [...ARBOL_SUGERENCIA.nodos].reverse(),
      equivalencias: [...ARBOL_SUGERENCIA.equivalencias].reverse(),
    };
    const origenes: [string, string, string, string][] = [
      ["HOMBRE", "URBANO", "DENIM", "SKINY"],
      ["HOMBRE", "URBANO", "DENIM", "BOOTCUT"],
      ["HOMBRES", "URBANO", "DENIM", "SLIM"],
      ["HOMBRE", "", "DENIM", "SKINNY"],
      ["", "URBANO", "DENIM", "SKINNY"],
      ["HOMBRE", "URBANO", "PANTALÓN DRIL", "PANTALÓN DRIL"],
      ["MUJER", "URBANO", "DENIM", "MON"],
    ];
    for (const [g, m, l, e] of origenes) {
      expect(sug(g, m, l, e)).toEqual(sug(g, m, l, e));
      expect(sug(g, m, l, e, barajado), `${g}/${m}/${l}/${e}`).toEqual(sug(g, m, l, e));
    }
  });
});

describe("regla 13: invariantes", () => {
  const origenes = (() => {
    const gs = ["HOMBRE", "HOMBRES", "MUJER", "", "XX"];
    const ms = ["URBANO", "URBANA", "CASUAL", "", "ZZ"];
    const ls = ["DENIM", "DENIN", "PANTALON DRILL", "PANTALON DRIL", "POLO", "CHOMPA", "", "JEAN"];
    const es = ["SKINNY", "SKINY", "MOM", "DENIM", "POLO BASICO", "PANTALON DRILL", "SIN EQUIVALENCIA", "BOOTCUT", "-"];
    const lista: [string, string, string, string][] = [];
    for (const g of gs) for (const m of ms) for (const l of ls) for (const e of es) lista.push([g, m, l, e === "-" ? l || "SIN EQUIVALENCIA" : e]);
    return lista;
  })();
  const vigentes = crearIndiceDestinos(ARBOL_SUGERENCIA);
  const sugerir = crearSugeridor(ARBOL_SUGERENCIA);

  it("nunca más de 3, nunca una puntuación menor a 0,5, siempre vigentes, ordenadas y `fuerte` coherente", () => {
    let conSugerencia = 0;
    for (const [g, m, l, e] of origenes) {
      const r = sugerir({ genero: g, mundo: m, linea: l, equivalencia: e });
      expect(r.length).toBeLessThanOrEqual(MAX_SUGERENCIAS);
      if (r.length > 0) conSugerencia += 1;
      r.forEach((s, i) => {
        expect(s.puntuacion).toBeGreaterThanOrEqual(UMBRAL_SUGERENCIA);
        expect(s.puntuacion).toBeLessThanOrEqual(1);
        expect(Math.round(s.puntuacion * 100) / 100).toBe(s.puntuacion);
        expect(vigentes.vigente(s.equivalencia_id)).toBe(true);
        expect(s.fuerte).toBe(s.puntuacion >= UMBRAL_FUERTE);
        expect(s.razon.length).toBeGreaterThan(0);
        if (i > 0) expect(r[i - 1].puntuacion).toBeGreaterThanOrEqual(s.puntuacion);
      });
      expect(new Set(r.map((s) => s.equivalencia_id)).size).toBe(r.length);
    }
    expect(conSugerencia).toBeGreaterThan(50);
  });

  it("los tres en blanco no tienen sugerencia", () => {
    expect(sug("", "", "", "SIN EQUIVALENCIA")).toEqual([]);
  });

  it("ninguna sugerencia apunta a piezas desactivadas (línea CHOMPA, o una equivalencia o género inactivos)", () => {
    const estado: EstadoImportacion = {
      ...ARBOL_SUGERENCIA,
      equivalencias: ARBOL_SUGERENCIA.equivalencias.map((e) => (e.id === "s1-skinny" ? { ...e, activo: false } : e)),
    };
    const r = sug("HOMBRE", "URBANO", "DENIM", "SKINNY", estado);
    expect(r.map((s) => s.equivalencia_id)).not.toContain("s1-skinny");
    // SKINNY inactiva: queda SLIM? (similitud 0) no; la genérica entra con 0,50
    expect(r[0]).toMatchObject({ equivalencia_id: "s1-gen", puntuacion: 0.5 });
    const sinGenero: EstadoImportacion = { ...ARBOL_SUGERENCIA, generos: ARBOL_SUGERENCIA.generos.map((g) => (g.id === "g-h" ? { ...g, activo: false } : g)) };
    expect(sug("HOMBRE", "URBANO", "DENIM", "SKINNY", sinGenero)).toEqual([]);
  });

  it("desempata por nombre: dos candidatas con la misma puntuación salen en orden alfabético", () => {
    // PANTALON DENIM / DENIM PANTALON son equivalentes para el Dice; ambas caen igual contra el origen.
    const estado: EstadoImportacion = {
      ...ARBOL_SUGERENCIA,
      equivalencias: [
        ...ARBOL_SUGERENCIA.equivalencias,
        { id: "z-b", genero_mundo_linea_id: "s1", nombre: "DENIM PANTALON", codigo: "DENIM_PANTALON", es_generica: false, activo: true },
        { id: "z-a", genero_mundo_linea_id: "s1", nombre: "PANTALON DENIM", codigo: "PANTALON_DENIM", es_generica: false, activo: true },
      ],
    };
    const r = sug("HOMBRE", "URBANO", "DENIM", "DENIM PANTALONES", estado);
    const nombres = r.map((s) => s.equivalencia);
    expect(nombres.indexOf("DENIM PANTALON")).toBeLessThan(nombres.indexOf("PANTALON DENIM"));
  });
});
