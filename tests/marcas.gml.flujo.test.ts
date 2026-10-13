import { describe, expect, it } from "vitest";
import { claveFlujo, construirConfigFlujo, textoClaveFlujo, unidadDeMarcaEnFlujo } from "@/lib/marcas/gml/flujo";
import type { EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { arbolFixture, estadoFixture, EQUIVALENCIAS, HECHOS_SUELTOS, HECHOS_TODOS, indiceFixture, AGR } from "./marcas.gml.fixture";

/**
 * Regla 12 y casos 2 a 6, 16 y 17 de 02b: `claveFlujo` reparte cada hecho en
 * una y solo una fila (partición completa y disjunta), evaluada sobre la unidad
 * de marca.
 */

type Hecho = { marca_id: string; equivalencia_id: string; unidades: number };

function repartir(estado: EstadoVistaGml, hechos: Hecho[]) {
  const config = construirConfigFlujo(estado, EQUIVALENCIAS);
  const filas = new Map<string, number>();
  for (const h of hechos) {
    const k = textoClaveFlujo(claveFlujo(h, config));
    filas.set(k, (filas.get(k) ?? 0) + h.unidades);
  }
  return filas;
}

const u = (gml: string, eq: string | null, agr: string, marca: string | null) =>
  textoClaveFlujo({ tipo: "unidad", gml_id: gml, equivalencia_id: eq, agrupacion_marca_id: agr, marca_id: marca });
const barrido = (marca: string) => textoClaveFlujo({ tipo: "barrido", marca_id: marca });
const suma = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const total = (hechos: Hecho[]) => hechos.reduce((a, h) => a + h.unidades, 0);
/** Todo lo de un nodo (sin el barrido): "mi flujo de Jeans". */
const delNodo = (m: Map<string, number>, nodo: string) =>
  [...m.entries()].filter(([k]) => k.startsWith(`unidad|${nodo}|`)).reduce((a, [, v]) => a + v, 0);

describe("claveFlujo · caso 2: reparto de los hechos sueltos", () => {
  const filas = repartir(estadoFixture(), HECHOS_SUELTOS);

  it("N1 (GML): ALFA 500, otras RECONOCIDO 300, otras PREMIUM 0 (BETA es barrido)", () => {
    expect(filas.get(u("n1", null, AGR.rec, "m-alfa"))).toBe(500);
    expect(filas.get(u("n1", null, AGR.rec, null))).toBe(300);
    expect(filas.get(u("n1", null, AGR.pre, null)) ?? 0).toBe(0);
  });
  it("N3: ALFA 40 y otras RECONOCIDO 60", () => {
    expect(filas.get(u("n3", null, AGR.rec, "m-alfa"))).toBe(40);
    expect(filas.get(u("n3", null, AGR.rec, null))).toBe(60);
  });
  it("N2 (GMLE): una unidad por equivalencia", () => {
    expect(filas.get(u("n2", "e2a", AGR.rec, "m-alfa"))).toBe(100);
    expect(filas.get(u("n2", "e2b", AGR.rec, "m-alfa"))).toBe(20);
  });
  it("BETA al barrer = 210, la suma es 1 230 y 'mi flujo de Jeans' (N1) = 800", () => {
    expect(filas.get(barrido("m-beta"))).toBe(210);
    expect(suma(filas)).toBe(1230);
    expect(delNodo(filas, "n1")).toBe(800);
  });
  it("partición completa y disjunta: Σ por clave = Σ hechos y no hay claves de más", () => {
    expect(suma(filas)).toBe(total(HECHOS_SUELTOS));
    expect(filas.size).toBe(7); // N1 (2), N3 (2), N2 (2) y el barrido de BETA
  });
});

describe("claveFlujo · caso 3: TERNO inactiva", () => {
  it("ALFA·E3 (40) va a otras RECONOCIDO de N3 (= 100); reactivar devuelve el caso 2", () => {
    const arbol = arbolFixture();
    arbol.lineas = arbol.lineas.map((l) => (l.id === "l-terno" ? { ...l, activo: false } : l));
    const filas = repartir(estadoFixture({ nodos: indiceFixture(arbol) }), HECHOS_SUELTOS);
    expect(filas.get(u("n3", null, AGR.rec, null))).toBe(100);
    expect(filas.has(u("n3", null, AGR.rec, "m-alfa"))).toBe(false);
    expect(suma(filas)).toBe(1230);
    expect(repartir(estadoFixture(), HECHOS_SUELTOS)).toEqual(repartir(estadoFixture(), HECHOS_SUELTOS));
    expect(repartir(estadoFixture(), HECHOS_SUELTOS).get(u("n3", null, AGR.rec, "m-alfa"))).toBe(40);
  });
});

describe("claveFlujo · casos 4 y 5: ALFA a barrido y desmarcada", () => {
  const conAlfa = (cambio: Record<string, unknown>) =>
    estadoFixture({ marcas: estadoFixture().marcas.map((m) => (m.id === "m-alfa" ? { ...m, ...cambio } : m)) });

  it("caso 4: toda su venta (660) va a barrido ALFA; volver a por_gml restaura el caso 2", () => {
    const filas = repartir(conAlfa({ modalidad_tratamiento: "barrido" }), HECHOS_SUELTOS);
    expect(filas.get(barrido("m-alfa"))).toBe(660);
    expect(filas.get(barrido("m-beta"))).toBe(210);
    expect(suma(filas)).toBe(1230);
    expect(repartir(conAlfa({ modalidad_tratamiento: "por_gml" }), HECHOS_SUELTOS)).toEqual(repartir(estadoFixture(), HECHOS_SUELTOS));
  });
  it("caso 5: desmarcar ALFA mueve su venta a 'otras' y conserva el total", () => {
    const filas = repartir(conAlfa({ tratamiento_especial: false, modalidad_tratamiento: null, nota_tratamiento: null }), HECHOS_SUELTOS);
    expect(filas.get(u("n1", null, AGR.rec, null))).toBe(800);
    expect(filas.get(u("n3", null, AGR.rec, null))).toBe(100);
    expect(filas.get(u("n2", "e2a", AGR.rec, null))).toBe(100);
    expect(filas.get(u("n1", null, AGR.rec, "m-alfa"))).toBeUndefined();
    expect(suma(filas)).toBe(1230);
  });
});

describe("claveFlujo · caso 6: N1 pasa a GMLE", () => {
  it("las claves de N1 llevan la equivalencia y la suma del nodo no cambia", () => {
    const arbol = arbolFixture();
    arbol.nodos = arbol.nodos.map((n) => (n.id === "n1" ? { ...n, nivel_planificacion: "GMLE" as const } : n));
    const filas = repartir(estadoFixture({ nodos: indiceFixture(arbol) }), HECHOS_SUELTOS);
    expect(filas.get(u("n1", "e1a", AGR.rec, "m-alfa"))).toBe(400);
    expect(filas.get(u("n1", "e1b", AGR.rec, "m-alfa"))).toBe(100);
    expect(filas.get(u("n1", "e1a", AGR.rec, null))).toBe(300);
    expect(delNodo(filas, "n1")).toBe(800);
    expect(suma(filas)).toBe(1230);
  });
  it("en un nodo GML la clave lleva null y en uno GMLE lleva la equivalencia", () => {
    const config = construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
    const gml = claveFlujo({ marca_id: "m-gamma", equivalencia_id: "e1a" }, config);
    const gmle = claveFlujo({ marca_id: "m-gamma", equivalencia_id: "e2a" }, config);
    expect(gml).toMatchObject({ tipo: "unidad", gml_id: "n1", equivalencia_id: null });
    expect(gmle).toMatchObject({ tipo: "unidad", gml_id: "n2", equivalencia_id: "e2a" });
  });
});

describe("claveFlujo · caso 16: reparto con conjuntos (todos los hechos)", () => {
  const filas = repartir(estadoFixture(), HECHOS_TODOS);

  it("N1: ALFA 650 (500 + ALFA JEANS 150, aunque esté en VALOR), otras RECONOCIDO 300, otras VALOR 0", () => {
    expect(filas.get(u("n1", null, AGR.rec, "m-alfa"))).toBe(650);
    expect(filas.get(u("n1", null, AGR.rec, null))).toBe(300);
    expect(filas.get(u("n1", null, AGR.val, null)) ?? 0).toBe(0);
  });
  it("N3: ALFA 70 (40 + ALFA KIDS 30) y otras RECONOCIDO 60; barrido BETA 280", () => {
    expect(filas.get(u("n3", null, AGR.rec, "m-alfa"))).toBe(70);
    expect(filas.get(u("n3", null, AGR.rec, null))).toBe(60);
    expect(filas.get(barrido("m-beta"))).toBe(280);
  });
  it("N2 igual que el caso 2, suma 1 480 y 'mi flujo de Jeans' (N1) = 950", () => {
    expect(filas.get(u("n2", "e2a", AGR.rec, "m-alfa"))).toBe(100);
    expect(filas.get(u("n2", "e2b", AGR.rec, "m-alfa"))).toBe(20);
    expect(suma(filas)).toBe(1480);
    expect(delNodo(filas, "n1")).toBe(950);
  });
  it("un hecho de ALFA JEANS recibe la clave de ALFA, nunca la suya", () => {
    const config = construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
    expect(unidadDeMarcaEnFlujo("m-alfa-jeans", config)).toBe("m-alfa");
    expect(claveFlujo({ marca_id: "m-alfa-jeans", equivalencia_id: "e1a" }, config)).toEqual({
      tipo: "unidad",
      gml_id: "n1",
      equivalencia_id: null,
      agrupacion_marca_id: AGR.rec,
      marca_id: "m-alfa",
    });
    expect(claveFlujo({ marca_id: "m-beta-dos", equivalencia_id: "e3" }, config)).toEqual({ tipo: "barrido", marca_id: "m-beta" });
  });
  it("cada hecho recibe exactamente una clave y el total se conserva", () => {
    const config = construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
    for (const h of HECHOS_TODOS) expect(textoClaveFlujo(claveFlujo(h, config))).toBeTruthy();
    expect(suma(filas)).toBe(total(HECHOS_TODOS));
  });
});

describe("claveFlujo · caso 17: cabeza inactiva", () => {
  const sinAlfa = () =>
    estadoFixture({ marcas: estadoFixture().marcas.map((m) => (m.id === "m-alfa" ? { ...m, activo: false } : m)) });

  it("ALFA JEANS vuelve a ser unidad propia en VALOR y sus 150 van a otras VALOR de N1", () => {
    const filas = repartir(sinAlfa(), HECHOS_TODOS);
    expect(filas.get(u("n1", null, AGR.val, null))).toBe(150);
  });
  it("ALFA KIDS vuelve a RECONOCIDO con su asignación propia: 30 como marca relevante de N3", () => {
    const filas = repartir(sinAlfa(), HECHOS_TODOS);
    expect(filas.get(u("n3", null, AGR.rec, "m-alfa-kids"))).toBe(30);
    expect(suma(filas)).toBe(1480);
  });
  it("reactivar ALFA restaura el caso 16 sin tocar nada", () => {
    expect(repartir(estadoFixture(), HECHOS_TODOS).get(u("n1", null, AGR.rec, "m-alfa"))).toBe(650);
  });
});

describe("claveFlujo · marca no vigente y errores", () => {
  it("marcada con la agrupación inactiva → 'otras' de su agrupación", () => {
    const e = estadoFixture();
    const estado = { ...e, agrupaciones: e.agrupaciones.map((g) => (g.id === AGR.rec ? { ...g, activo: false } : g)) };
    const filas = repartir(estado, HECHOS_SUELTOS.filter((h) => h.marca_id === "m-alfa" && h.equivalencia_id === "e1a"));
    expect(filas.get(u("n1", null, AGR.rec, null))).toBe(400);
  });
  it("una marca o equivalencia desconocida es un error claro, no una clave a medias", () => {
    const config = construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
    expect(() => claveFlujo({ marca_id: "x", equivalencia_id: "e1a" }, config)).toThrow(/Marca desconocida/);
    expect(() => claveFlujo({ marca_id: "m-gamma", equivalencia_id: "x" }, config)).toThrow(/Equivalencia desconocida/);
  });
  it("una marca por_gml no relevante en ese GML va a 'otras' (pregunta 1)", () => {
    const config = construirConfigFlujo(estadoFixture(), EQUIVALENCIAS);
    // DELTA es por_gml sin GML: toda su venta sería 'otras'.
    expect(claveFlujo({ marca_id: "m-delta", equivalencia_id: "e1a" }, config)).toMatchObject({ tipo: "unidad", marca_id: null, agrupacion_marca_id: AGR.rec });
  });
});
