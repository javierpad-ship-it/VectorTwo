import { describe, expect, it } from "vitest";
import {
  agrupacionesDestino,
  agrupacionesParaFiltro,
  agrupacionesParaGeneros,
  agrupacionesSinGenero,
  avisoNoPermitidas,
  explicarSinDestinos,
  generosDeSeleccion,
  ordenarPorNombre,
  type AgrupacionConGeneros,
} from "@/lib/estacionalidad/generos";
import { mapaColores } from "@/lib/estacionalidad/colores";

const H = "g-h";
const M = "g-m";
const N = "g-n";

/** Como la producción: dos con HOMBRE, dos sin género; más una de HOMBRE+MUJER, una de MUJER y una inactiva. */
const A: AgrupacionConGeneros[] = [
  { id: "aase", nombre: "AASE_INVIERNO", orden: 1, activo: true, genero_ids: [] },
  { id: "lig", nombre: "TES HO INV LIGERO", orden: 2, activo: true, genero_ids: [] },
  { id: "pes", nombre: "TES HO INV PESADO", orden: 3, activo: true, genero_ids: [H] },
  { id: "ase1", nombre: "ASESORIA 1", orden: 4, activo: true, genero_ids: [H] },
  { id: "ase10", nombre: "ASESORIA 10", orden: 5, activo: true, genero_ids: [H, M] },
  { id: "muj", nombre: "ÁNGEL MUJER", orden: 6, activo: true, genero_ids: [M] },
  { id: "vieja", nombre: "VIEJA", orden: 0, activo: false, genero_ids: [H, M] },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("ordenarPorNombre", () => {
  it("alfabético, sin acentos y con números naturales; no muta la entrada", () => {
    const copia = [...A];
    expect(ids(ordenarPorNombre(A))).toEqual(["aase", "muj", "ase1", "ase10", "lig", "pes", "vieja"]);
    expect(A).toEqual(copia);
  });

  it("no cambia los colores: siguen la posición por `orden, nombre` del catálogo", () => {
    const antes = mapaColores(A);
    const ordenadas = ordenarPorNombre(A);
    const despues = mapaColores(ordenadas);
    for (const a of A) expect(despues.get(a.id)).toEqual(antes.get(a.id));
    // El orden de presentación sí difiere del de colores.
    expect(ids(ordenadas)).not.toEqual(ids([...A].sort((a, b) => a.orden - b.orden)));
  });
});

describe("agrupacionesParaGeneros", () => {
  it("sin géneros pedidos: todas las activas con género, por nombre (las sin género y las inactivas no)", () => {
    expect(ids(agrupacionesParaGeneros(A, []))).toEqual(["muj", "ase1", "ase10", "pes"]);
  });

  it("un género: solo las activas que lo incluyen", () => {
    expect(ids(agrupacionesParaGeneros(A, [H]))).toEqual(["ase1", "ase10", "pes"]);
    expect(ids(agrupacionesParaGeneros(A, [M]))).toEqual(["muj", "ase10"]);
  });

  it("varios géneros: deben incluirlos todos", () => {
    expect(ids(agrupacionesParaGeneros(A, [H, M]))).toEqual(["ase10"]);
    expect(agrupacionesParaGeneros(A, [H, M, N])).toEqual([]);
  });

  it("un género sin ninguna agrupación activa que lo incluya: vacío", () => {
    expect(agrupacionesParaGeneros(A, [N])).toEqual([]);
  });
});

describe("agrupacionesParaFiltro", () => {
  it('"" = todos los géneros: todas las activas con género', () => {
    expect(ids(agrupacionesParaFiltro(A, ""))).toEqual(["muj", "ase1", "ase10", "pes"]);
  });
  it("un género concreto: solo las que lo incluyen, aunque tengan 0 equivalencias", () => {
    expect(ids(agrupacionesParaFiltro(A, H))).toEqual(["ase1", "ase10", "pes"]);
  });
});

describe("generosDeSeleccion", () => {
  const eqs = [
    { id: "e1", genero_id: H },
    { id: "e2", genero_id: H },
    { id: "e3", genero_id: M },
    { id: "e4", genero_id: N },
  ];
  it("géneros distintos de las filas elegidas", () => {
    expect(generosDeSeleccion(eqs, new Set(["e1", "e2"]))).toEqual([H]);
    expect(generosDeSeleccion(eqs, ["e1", "e3"])).toEqual([H, M]);
  });
  it("selección vacía o con ids que no están en la lista: sin géneros", () => {
    expect(generosDeSeleccion(eqs, new Set())).toEqual([]);
    expect(generosDeSeleccion(eqs, ["otro"])).toEqual([]);
  });
});

describe("agrupacionesDestino (filtro de género ∩ selección)", () => {
  it("selección vacía y filtro Todos: todas las activas con género", () => {
    expect(ids(agrupacionesDestino(A, "", []))).toEqual(["muj", "ase1", "ase10", "pes"]);
  });
  it("filtro Todos: manda la selección", () => {
    expect(ids(agrupacionesDestino(A, "", [H]))).toEqual(["ase1", "ase10", "pes"]);
    expect(ids(agrupacionesDestino(A, "", [H, M]))).toEqual(["ase10"]);
    expect(agrupacionesDestino(A, "", [H, N])).toEqual([]);
  });
  it("género filtrado: se reduce al filtro (la selección es de ese género)", () => {
    expect(ids(agrupacionesDestino(A, M, [M]))).toEqual(["muj", "ase10"]);
    expect(ids(agrupacionesDestino(A, M, []))).toEqual(["muj", "ase10"]);
  });
  it("si filtro y selección discreparan, es la intersección", () => {
    expect(ids(agrupacionesDestino(A, H, [M]))).toEqual(["ase10"]);
  });
});

describe("agrupacionesSinGenero", () => {
  it("por defecto solo las activas, por nombre", () => {
    expect(ids(agrupacionesSinGenero(A))).toEqual(["aase", "lig"]);
  });
  it("con soloActivas=false suma las inactivas sin género", () => {
    const con = [...A, { id: "x", nombre: "X", orden: 9, activo: false, genero_ids: [] }];
    expect(ids(agrupacionesSinGenero(con, false))).toEqual(["aase", "lig", "x"]);
  });
});

describe("explicarSinDestinos", () => {
  const nombre = (id: string) => ({ [H]: "HOMBRE", [M]: "MUJER", [N]: "NIÑO" })[id] ?? id;

  it("null si hay destinos", () => {
    expect(explicarSinDestinos(A, "", [], nombre)).toBeNull();
    expect(explicarSinDestinos(A, H, [H], nombre)).toBeNull();
  });
  it("mezcla de géneros sin agrupación que los cubra a todos", () => {
    expect(explicarSinDestinos(A, "", [M, N], nombre)?.texto).toBe(
      "Ninguna agrupación incluye todos los géneros seleccionados (MUJER, NIÑO). Filtra por género o asigna por partes."
    );
    expect(explicarSinDestinos(A, "", [M, N], nombre)?.tipo).toBe("mezcla");
  });
  it("un género que nadie incluye: sea por filtro o por selección", () => {
    const esperado = "Ninguna agrupación activa incluye el género NIÑO. Añádelo a una en la pestaña Agrupaciones.";
    expect(explicarSinDestinos(A, N, [], nombre)).toEqual({ tipo: "genero", texto: esperado });
    expect(explicarSinDestinos(A, "", [N], nombre)).toEqual({ tipo: "genero", texto: esperado });
  });
  it("ninguna agrupación activa con género", () => {
    const solo = A.filter((a) => a.genero_ids.length === 0);
    expect(explicarSinDestinos(solo, "", [], nombre)?.tipo).toBe("ninguna");
  });
});

describe("avisoNoPermitidas", () => {
  it("null si no hay", () => {
    expect(avisoNoPermitidas([])).toBeNull();
  });
  it("cuenta y lista los géneros sin repetir", () => {
    expect(
      avisoNoPermitidas([
        { id: "1", genero: "MUJER" },
        { id: "2", genero: "HOMBRE" },
        { id: "3", genero: "MUJER" },
      ])
    ).toBe("3 equivalencias no se asignaron porque la agrupación no incluye su género: HOMBRE, MUJER.");
    expect(avisoNoPermitidas([{ id: "1", genero: "HOMBRE" }])).toBe(
      "1 equivalencia no se asignó porque la agrupación no incluye su género: HOMBRE."
    );
  });
});
