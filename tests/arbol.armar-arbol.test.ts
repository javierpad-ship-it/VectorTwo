import { describe, expect, it } from "vitest";
import {
  armarArbol,
  nodoVigente,
  ordenarEquivalencias,
  type EquivalenciaEntrada,
  type GeneroEntrada,
  type LineaEntrada,
  type MundoEntrada,
  type NodoEntrada,
} from "@/lib/arbol/armar-arbol";

const generos: GeneroEntrada[] = [
  { id: "g-m", codigo: "M", nombre: "MUJER", orden: 20, activo: true },
  { id: "g-h", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true },
  { id: "g-x", codigo: "OTROS", nombre: "OTROS", orden: 80, activo: false },
];

const mundos: MundoEntrada[] = [
  { id: "m-sa", codigo: "SIN_ASIGNAR", nombre: "SIN ASIGNAR", orden: 999, activo: true },
  { id: "m-ur", codigo: "URBANO", nombre: "URBANO", orden: 20, activo: true },
  { id: "m-ca", codigo: "CASUAL", nombre: "CASUAL", orden: 10, activo: true },
  { id: "m-fo", codigo: "FORMAL", nombre: "FORMAL", orden: 40, activo: false },
];

const lineas: LineaEntrada[] = [
  { id: "l-pant", codigo: "PANTALON", nombre: "PANTALON", temporada: "Todo el año", activo: true },
  { id: "l-blu", codigo: "BLUSA", nombre: "BLUSA", temporada: "Verano", activo: true },
  { id: "l-abr", codigo: "ABRIGO", nombre: "ABRIGO", temporada: "Invierno", activo: false },
];

const nodos: NodoEntrada[] = [
  { id: "n1", genero_id: "g-h", mundo_id: "m-ur", linea_id: "l-pant", activo: true },
  { id: "n2", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-pant", activo: true },
  { id: "n3", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-blu", activo: true },
  { id: "n4", genero_id: "g-m", mundo_id: "m-ur", linea_id: "l-abr", activo: true }, // línea inactiva
  { id: "n5", genero_id: "g-h", mundo_id: "m-fo", linea_id: "l-pant", activo: true }, // mundo inactivo
  { id: "n6", genero_id: "g-h", mundo_id: "m-ca", linea_id: "l-blu", activo: false }, // nodo inactivo
  { id: "n7", genero_id: "g-x", mundo_id: "m-ur", linea_id: "l-pant", activo: true }, // género inactivo
  { id: "n8", genero_id: "g-m", mundo_id: "m-sa", linea_id: "l-blu", activo: true }, // SIN ASIGNAR
];

const equivalencias: EquivalenciaEntrada[] = [
  { id: "e1", genero_mundo_linea_id: "n1", codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true, activo: true },
  { id: "e2", genero_mundo_linea_id: "n1", codigo: "VARIOS", nombre: "VARIOS", es_generica: false, activo: true },
  { id: "e3", genero_mundo_linea_id: "n1", codigo: "JOGGER", nombre: "JOGGER", es_generica: false, activo: true },
  { id: "e4", genero_mundo_linea_id: "n1", codigo: "CARGO", nombre: "CARGO", es_generica: false, activo: false },
  { id: "e5", genero_mundo_linea_id: "n2", codigo: "VARIOS", nombre: "VARIOS", es_generica: false, activo: true },
];

const activos = () => armarArbol(generos, mundos, lineas, nodos, equivalencias, { incluirInactivos: false });
const todos = () => armarArbol(generos, mundos, lineas, nodos, equivalencias, { incluirInactivos: true });

const buscar = (arbol: ReturnType<typeof armarArbol>, g: string, m: string) =>
  arbol.generos.find((x) => x.codigo === g)?.mundos.find((x) => x.codigo === m);

describe("nodoVigente (regla 13)", () => {
  const on = { activo: true };
  const off = { activo: false };
  it("es la conjunción de los cuatro activo", () => {
    expect(nodoVigente(on, on, on, on)).toBe(true);
    expect(nodoVigente(off, on, on, on)).toBe(false);
    expect(nodoVigente(on, off, on, on)).toBe(false);
    expect(nodoVigente(on, on, off, on)).toBe(false);
    expect(nodoVigente(on, on, on, off)).toBe(false);
  });
});

describe("armarArbol · regla 12: todos los mundos bajo cada género", () => {
  it("devuelve los mundos activos en cada género aunque no tengan líneas", () => {
    const arbol = activos();
    for (const g of arbol.generos) {
      expect(g.mundos.map((m) => m.codigo)).toEqual(["CASUAL", "URBANO", "SIN_ASIGNAR"]);
    }
    expect(buscar(arbol, "H", "CASUAL")?.lineas).toEqual([]);
    expect(buscar(arbol, "H", "SIN_ASIGNAR")?.lineas).toEqual([]);
  });
  it("con incluirInactivos agrega también los mundos inactivos", () => {
    const arbol = todos();
    expect(arbol.generos[0].mundos.map((m) => m.codigo)).toEqual(["CASUAL", "URBANO", "FORMAL", "SIN_ASIGNAR"]);
  });
});

describe("armarArbol · regla 13: vigencia", () => {
  it("sin incluirInactivos omite géneros, mundos, líneas y equivalencias inactivos y nodos no vigentes", () => {
    const arbol = activos();
    expect(arbol.generos.map((g) => g.codigo)).toEqual(["H", "M"]);
    // n4 (línea inactiva) no aparece en M / URBANO
    expect(buscar(arbol, "M", "URBANO")?.lineas.map((l) => l.nombre)).toEqual(["BLUSA", "PANTALON"]);
    // n6 (nodo inactivo) no aparece en H / CASUAL
    expect(buscar(arbol, "H", "CASUAL")?.lineas).toEqual([]);
    // e4 inactiva no aparece en n1
    const pantalonH = buscar(arbol, "H", "URBANO")?.lineas[0];
    expect(pantalonH?.equivalencias.map((e) => e.codigo)).toEqual(["JOGGER", "VARIOS", "SIN_EQUIVALENCIA"]);
    expect(pantalonH?.vigente).toBe(true);
  });
  it("con incluirInactivos todo aparece con sus banderas", () => {
    const arbol = todos();
    expect(arbol.generos.map((g) => g.codigo)).toEqual(["H", "M", "OTROS"]);

    const abrigo = buscar(arbol, "M", "URBANO")?.lineas.find((l) => l.nombre === "ABRIGO");
    expect(abrigo).toMatchObject({ activo_linea: false, activo_nodo: true, vigente: false, temporada: "Invierno" });

    const enFormal = buscar(arbol, "H", "FORMAL")?.lineas[0];
    expect(enFormal).toMatchObject({ nombre: "PANTALON", activo_linea: true, activo_nodo: true, vigente: false });

    const blusaCasual = buscar(arbol, "H", "CASUAL")?.lineas[0];
    expect(blusaCasual).toMatchObject({ activo_nodo: false, vigente: false });

    const otros = buscar(arbol, "OTROS", "URBANO")?.lineas[0];
    expect(otros?.vigente).toBe(false);

    const pantalonH = buscar(arbol, "H", "URBANO")?.lineas[0];
    expect(pantalonH?.equivalencias.find((e) => e.codigo === "CARGO")?.activo).toBe(false);
  });
  it("cada línea trae la forma JSON de la especificación", () => {
    const linea = buscar(activos(), "H", "URBANO")?.lineas[0];
    expect(linea).toEqual({
      nodo_id: "n1",
      linea_id: "l-pant",
      codigo: "PANTALON",
      nombre: "PANTALON",
      temporada: "Todo el año",
      activo_linea: true,
      activo_nodo: true,
      vigente: true,
      equivalencias: [
        { id: "e3", codigo: "JOGGER", nombre: "JOGGER", es_generica: false, activo: true },
        { id: "e2", codigo: "VARIOS", nombre: "VARIOS", es_generica: false, activo: true },
        { id: "e1", codigo: "SIN_EQUIVALENCIA", nombre: "SIN EQUIVALENCIA", es_generica: true, activo: true },
      ],
    });
  });
});

describe("armarArbol · regla 14: orden", () => {
  it("géneros y mundos por orden, nombre; líneas por nombre; genérica al final", () => {
    const arbol = todos();
    expect(arbol.generos.map((g) => g.orden)).toEqual([10, 20, 80]);
    expect(arbol.generos[0].mundos.map((m) => m.orden)).toEqual([10, 20, 40, 999]);
    expect(buscar(arbol, "M", "URBANO")?.lineas.map((l) => l.nombre)).toEqual(["ABRIGO", "BLUSA", "PANTALON"]);
  });
  it("desempata por nombre con el mismo orden", () => {
    const empatados: GeneroEntrada[] = [
      { id: "b", codigo: "B", nombre: "BETA", orden: 0, activo: true },
      { id: "a", codigo: "A", nombre: "ALFA", orden: 0, activo: true },
    ];
    const arbol = armarArbol(empatados, [], [], [], [], { incluirInactivos: false });
    expect(arbol.generos.map((g) => g.nombre)).toEqual(["ALFA", "BETA"]);
  });
  it("ordenarEquivalencias deja la genérica al final aunque alfabéticamente vaya antes", () => {
    const lista = [
      { nombre: "ZETA", es_generica: false },
      { nombre: "SIN EQUIVALENCIA", es_generica: true },
      { nombre: "ALFA", es_generica: false },
    ];
    expect(ordenarEquivalencias(lista).map((e) => e.nombre)).toEqual(["ALFA", "ZETA", "SIN EQUIVALENCIA"]);
  });
});

describe("armarArbol · regla 15: resumen cuenta lo devuelto", () => {
  it("sin inactivos", () => {
    expect(activos().resumen).toEqual({
      generos: 2,
      mundos: 3,
      lineas: 2, // PANTALON y BLUSA
      nodos: 4, // n1, n2, n3, n8
      equivalencias: 4, // e1, e2, e3, e5
      nodos_sin_asignar: 1,
    });
  });
  it("con inactivos", () => {
    expect(todos().resumen).toEqual({
      generos: 3,
      mundos: 4,
      lineas: 3,
      nodos: 8,
      equivalencias: 5,
      nodos_sin_asignar: 1,
    });
  });
  it("no muta las entradas", () => {
    const copia = JSON.parse(JSON.stringify({ generos, mundos, lineas, nodos, equivalencias }));
    activos();
    todos();
    expect({ generos, mundos, lineas, nodos, equivalencias }).toEqual(copia);
  });
});
