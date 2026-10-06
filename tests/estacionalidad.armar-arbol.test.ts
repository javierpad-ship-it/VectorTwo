import { describe, expect, it } from "vitest";
import { armarArbol } from "@/lib/arbol/armar-arbol";
import { estadoFx } from "./estacionalidad.fixture";

const armar = (conAgrupaciones: boolean, incluirInactivos: boolean) => {
  const e = estadoFx();
  return armarArbol(e.generos, e.mundos, e.lineas, e.nodos, e.equivalencias, conAgrupaciones ? e.agrupaciones : [], {
    incluirInactivos,
  });
};

const equivalenciasDe = (arbol: ReturnType<typeof armar>, g: string, m: string, linea: string) =>
  arbol.generos
    .find((x) => x.codigo === g)
    ?.mundos.find((x) => x.codigo === m)
    ?.lineas.find((x) => x.nombre === linea)?.equivalencias ?? [];

describe("armarArbol con agrupaciones (regla 18)", () => {
  it("cada equivalencia trae agrupacion_estacionalidad con { id, nombre, activo } o null", () => {
    const eqs = equivalenciasDe(armar(true, false), "H", "URBANO", "PANTALON");
    expect(eqs.map((e) => [e.id, e.agrupacion_estacionalidad])).toEqual([
      ["e3", { id: "a-old", nombre: "VIEJA", activo: false }],
      ["e12", null], // apunta a una agrupación que no está en la lista
      ["e2", { id: "a-inv", nombre: "PANTALONES INVIERNO", activo: true }],
      ["e1", null],
    ]);
    expect(Object.keys(eqs[2].agrupacion_estacionalidad ?? {}).sort()).toEqual(["activo", "id", "nombre"]);
  });
  it("resumen.equivalencias_sin_agrupacion cuenta las faltantes entre las devueltas", () => {
    expect(armar(true, false).resumen).toEqual({
      generos: 2,
      mundos: 2,
      lineas: 2,
      nodos: 3,
      equivalencias: 7,
      equivalencias_sin_agrupacion: 5, // e1, e3 (inactiva), e12, e5, e7
    });
    // Con inactivos salen 12 equivalencias, pero e4 (inactiva) y las de nodos no vigentes nunca son faltantes.
    expect(armar(true, true).resumen).toMatchObject({ equivalencias: 12, equivalencias_sin_agrupacion: 5 });
  });
  it("con agrupaciones = [] todas salen con null y todas las activas vigentes cuentan como faltantes", () => {
    const arbol = armar(false, false);
    const todas = arbol.generos.flatMap((g) => g.mundos.flatMap((m) => m.lineas.flatMap((l) => l.equivalencias)));
    expect(todas).toHaveLength(7);
    expect(todas.every((e) => e.agrupacion_estacionalidad === null)).toBe(true);
    expect(arbol.resumen.equivalencias_sin_agrupacion).toBe(7);
  });
  it("no muta las entradas", () => {
    const e = estadoFx();
    const copia = JSON.parse(JSON.stringify(e));
    armarArbol(e.generos, e.mundos, e.lineas, e.nodos, e.equivalencias, e.agrupaciones, { incluirInactivos: true });
    expect(e).toEqual(copia);
  });
});
