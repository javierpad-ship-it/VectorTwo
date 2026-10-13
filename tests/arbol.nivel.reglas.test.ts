import { describe, expect, it } from "vitest";
import { armarArbol, nivelDeNodo, type NodoEntrada } from "@/lib/arbol/armar-arbol";
import { indexarNodos, motivoNodoNoVigente, compararNodos } from "@/lib/arbol/nivel/indice";
import { leerNivel, planificarNivelBloque, resumenNiveles, unidadesDeNodo } from "@/lib/arbol/nivel/reglas";

/** Reglas 1 y 2 de 02b: unidades de un nodo, resumen y bloque; el nivel viaja en el árbol. */

const generos = [{ id: "g1", codigo: "H", nombre: "HOMBRE", orden: 10, activo: true }];
const mundos = [{ id: "m1", codigo: "URBANO", nombre: "URBANO", orden: 10, activo: true }];
const lineas = [
  { id: "l1", codigo: "DENIM", nombre: "DENIM", temporada: "Todo el año", activo: true },
  { id: "l2", codigo: "TERNO", nombre: "TERNO", temporada: "Todo el año", activo: true },
  { id: "l3", codigo: "POLO", nombre: "POLO", temporada: "Verano", activo: false },
];
const nodos: NodoEntrada[] = [
  { id: "n1", genero_id: "g1", mundo_id: "m1", linea_id: "l1", activo: true, nivel_planificacion: "GMLE" },
  { id: "n2", genero_id: "g1", mundo_id: "m1", linea_id: "l2", activo: true, nivel_planificacion: "GML" },
  { id: "n3", genero_id: "g1", mundo_id: "m1", linea_id: "l3", activo: true, nivel_planificacion: "GMLE" }, // línea inactiva
];
const eq = (id: string, nodo: string, activo = true, generica = false) => ({
  id,
  genero_mundo_linea_id: nodo,
  codigo: id.toUpperCase(),
  nombre: id.toUpperCase(),
  es_generica: generica,
  activo,
  agrupacion_estacionalidad_id: null,
});
const equivalencias = [eq("a", "n1"), eq("b", "n1"), eq("g", "n1", true, true), eq("c", "n1", false), eq("d", "n2"), eq("e", "n3")];

describe("unidadesDeNodo (regla 1)", () => {
  const eqsN1 = equivalencias.filter((e) => e.genero_mundo_linea_id === "n1");
  it("GML → una unidad con equivalencia_id null", () => {
    expect(unidadesDeNodo({ id: "n2", nivel_planificacion: "GML", vigente: true }, eqsN1)).toEqual([{ gml_id: "n2", equivalencia_id: null }]);
  });
  it("GMLE → una por equivalencia activa, la genérica incluida", () => {
    expect(unidadesDeNodo({ id: "n1", nivel_planificacion: "GMLE", vigente: true }, eqsN1)).toEqual([
      { gml_id: "n1", equivalencia_id: "a" },
      { gml_id: "n1", equivalencia_id: "b" },
      { gml_id: "n1", equivalencia_id: "g" },
    ]);
  });
  it("un nodo no vigente no produce ninguna", () => {
    expect(unidadesDeNodo({ id: "n1", nivel_planificacion: "GMLE", vigente: false }, eqsN1)).toEqual([]);
    expect(unidadesDeNodo({ id: "n2", nivel_planificacion: "GML", vigente: false }, eqsN1)).toEqual([]);
  });
});

describe("armarArbol con nivel de planificación", () => {
  const arbol = armarArbol(generos, mundos, lineas, nodos, equivalencias, [], { incluirInactivos: true });
  const linea = (nombre: string) => arbol.generos[0].mundos[0].lineas.find((l) => l.nombre === nombre);

  it("cada nodo sale con su nivel; sin dato se lee GML", () => {
    expect(linea("DENIM")?.nivel_planificacion).toBe("GMLE");
    expect(linea("TERNO")?.nivel_planificacion).toBe("GML");
    const sinNivel = armarArbol(generos, mundos, lineas, [{ id: "n9", genero_id: "g1", mundo_id: "m1", linea_id: "l1", activo: true }], [], [], { incluirInactivos: false });
    expect(sinNivel.generos[0].mundos[0].lineas[0].nivel_planificacion).toBe("GML");
    expect(nivelDeNodo({ nivel_planificacion: "otro" })).toBe("GML");
  });
  it("resumenNiveles solo cuenta nodos vigentes y equivalencias activas", () => {
    // n1 (GMLE vigente): a, b y la genérica; c está inactiva. n3 es GMLE pero su línea está inactiva.
    expect(resumenNiveles(arbol)).toEqual({ nodos_gmle: 1, equivalencias_en_gmle: 3 });
    expect(arbol.resumen).toMatchObject({ nodos_gmle: 1, equivalencias_en_gmle: 3 });
  });
  it("sin inactivos, el resumen cuenta lo devuelto", () => {
    const activos = armarArbol(generos, mundos, lineas, nodos, equivalencias, [], { incluirInactivos: false });
    expect(activos.resumen).toMatchObject({ nodos: 2, nodos_gmle: 1, equivalencias_en_gmle: 3 });
  });
});

describe("planificarNivelBloque (regla 2)", () => {
  const base = [
    { id: "n1", nivel_planificacion: "GML" as const },
    { id: "n2", nivel_planificacion: "GMLE" as const },
    { id: "n3", nivel_planificacion: "GML" as const },
  ];
  it("deduplica; inexistentes → no_encontrados; igual nivel → sin_cambio; el resto → cambiados", () => {
    const r = planificarNivelBloque(["n1", "n1", "n2", "n3", "fantasma"], "GMLE", base);
    expect(r).toEqual({ nivel: "GMLE", ids_a_cambiar: ["n1", "n3"], cambiados: 2, sin_cambio: 1, no_encontrados: ["fantasma"] });
  });
  it("|ids únicos| = cambiados + sin_cambio + |no_encontrados|", () => {
    const ids = ["n1", "n2", "x", "y", "n3", "n1"];
    const r = planificarNivelBloque(ids, "GML", base);
    expect(r.cambiados + r.sin_cambio + r.no_encontrados.length).toBe(new Set(ids).size);
  });
  it("es idempotente: aplicar y repetir da cambiados = 0", () => {
    const primero = planificarNivelBloque(["n1", "n3"], "GMLE", base);
    const despues = base.map((n) => (primero.ids_a_cambiar.includes(n.id) ? { ...n, nivel_planificacion: "GMLE" as const } : n));
    const segundo = planificarNivelBloque(["n1", "n3"], "GMLE", despues);
    expect(segundo).toMatchObject({ cambiados: 0, sin_cambio: 2, ids_a_cambiar: [] });
  });
});

describe("leerNivel", () => {
  it("GML y GMLE, con LINEA y EQUIVALENCIA como sinónimos y sin distinguir caja ni tildes", () => {
    expect(leerNivel("GML")).toBe("GML");
    expect(leerNivel("gmle")).toBe("GMLE");
    expect(leerNivel("Línea")).toBe("GML");
    expect(leerNivel(" linea ")).toBe("GML");
    expect(leerNivel("equivalencia")).toBe("GMLE");
    expect(leerNivel("X")).toBeNull();
    expect(leerNivel("")).toBeNull();
  });
});

describe("indexarNodos", () => {
  const indice = indexarNodos({ generos, mundos, lineas, nodos });
  it("trae la ruta, el nivel y la vigencia con el motivo cuando no es vigente", () => {
    expect(indice.get("n1")).toMatchObject({ ruta: "HOMBRE · URBANO · DENIM", nivel_planificacion: "GMLE", vigente: true, motivo_no_vigente: null });
    expect(indice.get("n3")).toMatchObject({ vigente: false, motivo_no_vigente: "línea POLO inactiva" });
  });
  it("motivoNodoNoVigente junta los padres inactivos", () => {
    const activo = { nombre: "X", activo: true };
    const inactivo = { nombre: "X", activo: false };
    expect(motivoNodoNoVigente({ nodo: true, genero: activo, mundo: activo, linea: activo })).toBeNull();
    expect(motivoNodoNoVigente({ nodo: false, genero: inactivo, mundo: activo, linea: activo })).toBe("nodo inactivo y género X inactivo");
    expect(motivoNodoNoVigente({ nodo: true, genero: activo, mundo: inactivo, linea: inactivo })).toBe("mundo X inactivo y línea X inactiva");
  });
  it("compararNodos ordena por género, mundo y línea", () => {
    const lista = [...indice.values()].sort(compararNodos).map((n) => n.linea);
    expect(lista).toEqual(["DENIM", "POLO", "TERNO"]);
  });
});
