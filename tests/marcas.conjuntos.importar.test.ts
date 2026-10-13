import { describe, expect, it } from "vitest";
import {
  aplicarPlanConjuntos,
  planificarImportacionConjuntos,
  type EstadoImportacionConjuntos,
} from "@/lib/marcas/conjuntos/importar";
import { aplicarPlanMarcas, planificarImportacionMarcas, type EstadoImportacionMarcas } from "@/lib/marcas/importar";
import type { FilaImportacionConjunto, FilaImportacionMarca, MotivoOmisionConjunto } from "@/lib/marcas/tipos-api";
import { AGRUPACIONES, marcasFixture, marcasSinConjuntos } from "./marcas.gml.fixture";

/** Regla 25 y caso 21 de 02b: importador de conjuntos y columna CONJUNTO del importador de marcas. */

const fila = (marca: string, conjunto: string): FilaImportacionConjunto => ({ marca, conjunto });
const estado = (sinConjuntos = true): EstadoImportacionConjuntos => ({
  agrupaciones: AGRUPACIONES.map((a) => ({ id: a.id, nombre: a.nombre, activo: a.activo })),
  marcas: (sinConjuntos ? marcasSinConjuntos() : marcasFixture()).map((m) => ({
    id: m.id,
    nombre: m.nombre,
    codigo: m.codigo ?? "",
    activo: m.activo,
    agrupacion_marca_id: m.agrupacion_marca_id,
    conjunto_marca_id: m.conjunto_marca_id,
  })),
});
const motivo = (f: FilaImportacionConjunto[], e = estado()): (MotivoOmisionConjunto | undefined)[] =>
  planificarImportacionConjuntos(f, e).reporte.omitidas.map((o) => o.motivo);

/** El CSV de ejemplo de la ficha, sin encabezado: la fila 1 es `ALFA JEANS,ALFA`. */
const CSV = [
  fila("ALFA JEANS", "ALFA"),
  fila("ALFA KIDS", "ALFA"),
  fila("BETA UNO", "BETA HOLDING"),
  fila("BETA DOS", "BETA HOLDING"),
  fila("ALFA", "ALFA"),
  fila("VARIOS", "ALFA"),
  fila("ZETA", "ALFA"),
  fila("ALFA JEANS", "BETA HOLDING"),
  fila("GAMMA", "ALFA JEANS"),
];

describe("caso 21: el CSV de ejemplo (ALFA existe y BETA HOLDING no)", () => {
  const plan = planificarImportacionConjuntos(CSV, estado());
  const { reporte } = plan;

  it("4 a asignar (las filas 1 a 4 de datos = líneas 2 a 5 del archivo)", () => {
    expect(reporte.asignar).toBe(4);
    expect(plan.asignaciones.map((a) => `${a.marca_nombre}→${a.cabeza_nombre}`)).toEqual([
      "ALFA JEANS→ALFA",
      "ALFA KIDS→ALFA",
      "BETA UNO→BETA HOLDING",
      "BETA DOS→BETA HOLDING",
    ]);
    expect(reporte.cambios).toEqual([]);
  });
  it("conjuntos_a_crear = [BETA HOLDING → PREMIUM (de BETA UNO)] y la cabeza nueva se prepara con su código", () => {
    expect(reporte.conjuntos_a_crear).toEqual([{ conjunto: "BETA HOLDING", agrupacion: "PREMIUM", de: "BETA UNO" }]);
    expect(plan.cabezas_nuevas).toEqual([{ nombre: "BETA HOLDING", codigo: "BETA_HOLDING", agrupacion_marca_id: "ag-pre" }]);
    expect(plan.asignaciones[2].cabeza_id).toBeNull();
    expect(plan.asignaciones[3].cabeza_id).toBeNull();
    expect(plan.asignaciones[0].cabeza_id).toBe("m-alfa");
  });
  it("omitidas: conjunto_igual_marca, marca_generica, marca_desconocida, duplicada_en_archivo y conjunto_es_miembro", () => {
    expect(reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [5, "conjunto_igual_marca"],
      [6, "marca_generica"],
      [7, "marca_desconocida"],
      [8, "duplicada_en_archivo"],
      [9, "conjunto_es_miembro"],
    ]);
    expect(reporte.omitidas[3]).toMatchObject({ fila_original: 1, detalle: "conjunto distinto: BETA HOLDING", marca: "ALFA JEANS", conjunto: "BETA HOLDING" });
    expect(reporte.omitidas[1]).toMatchObject({ marca: "VARIOS", conjunto: "ALFA" });
  });
  it("aplicar y reimportar → asignar = 0, cambios = [], conjuntos_a_crear = []", () => {
    const despues = aplicarPlanConjuntos(estado(), plan);
    expect(despues.marcas.find((m) => m.nombre === "BETA HOLDING")).toMatchObject({ agrupacion_marca_id: "ag-pre", activo: true });
    expect(despues.marcas.find((m) => m.id === "m-beta-uno")?.conjunto_marca_id).toBe(despues.marcas.find((m) => m.nombre === "BETA HOLDING")?.id);
    const otra = planificarImportacionConjuntos(CSV, despues);
    expect(otra.reporte.asignar).toBe(0);
    expect(otra.reporte.cambios).toEqual([]);
    expect(otra.reporte.conjuntos_a_crear).toEqual([]);
    expect(otra.cabezas_nuevas).toEqual([]);
    expect(otra.asignaciones).toEqual([]);
    expect(otra.reporte.existentes).toBe(4);
    expect(otra.reporte.omitidas.map((o) => o.motivo)).toEqual(reporte.omitidas.map((o) => o.motivo).map((m) => (m === "conjunto_es_miembro" ? "conjunto_es_miembro" : m)));
  });
  it("recibidas = procesadas + omitidas", () => {
    expect(reporte.totales).toEqual({ recibidas: 9, procesadas: 4, omitidas: 5 });
  });
});

describe("regla 25: cada motivo en su condición", () => {
  it("marca_vacia y fila_total", () => {
    expect(motivo([fila("  ", "ALFA")])).toEqual(["marca_vacia"]);
    expect(motivo([fila("TOTAL", "")])).toEqual(["fila_total"]);
  });
  it("marca_generica: VARIOS, OTROS y SIN MARCA como marca o como conjunto", () => {
    expect(motivo([fila("VARIOS", "ALFA"), fila("OTROS", "ALFA"), fila("SIN MARCA", "ALFA")])).toEqual(["marca_generica", "marca_generica", "marca_generica"]);
    expect(motivo([fila("GAMMA", "VARIOS")])).toEqual(["marca_generica"]);
  });
  it("conjunto_igual_marca y marca_desconocida (no crea marcas miembro)", () => {
    expect(motivo([fila("alfa", "ALFA")])).toEqual(["conjunto_igual_marca"]);
    const plan = planificarImportacionConjuntos([fila("ZETA", "ALFA")], estado());
    expect(plan.reporte.omitidas[0]).toMatchObject({ motivo: "marca_desconocida", detalle: "ZETA" });
    expect(plan.asignaciones).toEqual([]);
    expect(plan.cabezas_nuevas).toEqual([]);
  });
  it("marca_es_cabeza: una cabeza con miembros no puede entrar en otro conjunto", () => {
    expect(motivo([fila("ALFA", "BETA HOLDING")], estado(false))).toEqual(["marca_es_cabeza"]);
  });
  it("conjunto_es_miembro, en la base y dentro del mismo archivo (sin cadenas, sin importar el orden)", () => {
    expect(motivo([fila("GAMMA", "ALFA JEANS")], estado(false))).toEqual(["conjunto_es_miembro"]);
    expect(motivo([fila("ALFA JEANS", "ALFA"), fila("GAMMA", "ALFA JEANS")])).toEqual(["conjunto_es_miembro"]);
    // Al revés: primero la marca pasa a ser cabeza y después se le quiere dar un conjunto → marca_es_cabeza.
    expect(motivo([fila("GAMMA", "ALFA JEANS"), fila("ALFA JEANS", "ALFA")])).toEqual(["marca_es_cabeza"]);
  });
  it("cabeza_inactiva: una marca desactivada no sirve de cabeza", () => {
    expect(motivo([fila("GAMMA", "OMEGA")])).toEqual(["cabeza_inactiva"]);
  });
  it("una marca desactivada sí puede ser miembro (su histórico cuenta)", () => {
    const plan = planificarImportacionConjuntos([fila("OMEGA", "ALFA")], estado());
    expect(plan.reporte.asignar).toBe(1);
  });
  it("duplicada_en_archivo por marca, con fila_original y detalle si el conjunto difiere", () => {
    const r = planificarImportacionConjuntos([fila("GAMMA", "ALFA"), fila("gamma", "ALFA"), fila("GAMMA", "BETA")], estado()).reporte;
    expect(r.omitidas[0]).toMatchObject({ fila: 2, motivo: "duplicada_en_archivo", fila_original: 1 });
    expect(r.omitidas[0].detalle).toBeUndefined();
    expect(r.omitidas[1].detalle).toBe("conjunto distinto: BETA");
  });
  it("la marca y el conjunto se reconocen por nombre o por código", () => {
    const plan = planificarImportacionConjuntos([fila("gamma_sport", "gamma")], estado());
    expect(plan.asignaciones).toEqual([{ marca_id: "m-gamma-sport", marca_nombre: "GAMMA SPORT", cabeza_id: "m-gamma", cabeza_nombre: "GAMMA" }]);
  });
});

describe("regla 25: el archivo manda, CONJUNTO vacío no opina", () => {
  it("una marca en otro conjunto se cambia y aparece en cambios (de → a)", () => {
    const plan = planificarImportacionConjuntos([fila("ALFA JEANS", "GAMMA"), fila("BETA UNO", "BETA")], estado(false));
    expect(plan.reporte.cambios).toEqual([{ fila: 1, marca: "ALFA JEANS", de: "ALFA", a: "GAMMA" }]);
    expect(plan.reporte.existentes).toBe(1);
    expect(plan.reporte.asignar).toBe(0);
    expect(plan.asignaciones).toHaveLength(1);
    const despues = aplicarPlanConjuntos(estado(false), plan);
    expect(despues.marcas.find((m) => m.id === "m-alfa-jeans")?.conjunto_marca_id).toBe("m-gamma");
    expect(planificarImportacionConjuntos([fila("ALFA JEANS", "GAMMA")], despues).reporte.cambios).toEqual([]);
  });
  it("CONJUNTO vacío no saca a nadie de su conjunto", () => {
    const plan = planificarImportacionConjuntos([fila("ALFA JEANS", ""), fila("GAMMA", "   ")], estado(false));
    expect(plan.reporte.sin_opinion).toBe(2);
    expect(plan.reporte.omitidas).toEqual([]);
    expect(plan.asignaciones).toEqual([]);
    expect(plan.reporte.totales.procesadas).toBe(2);
  });
  it("conjuntos_a_crear lleva la agrupación de la primera fila que nombra la cabeza", () => {
    const plan = planificarImportacionConjuntos([fila("GAMMA SPORT", "GAMMA HOLDING"), fila("ALFA JEANS", "GAMMA HOLDING")], estado());
    expect(plan.reporte.conjuntos_a_crear).toEqual([{ conjunto: "GAMMA HOLDING", agrupacion: "VALOR", de: "GAMMA SPORT" }]);
    expect(plan.cabezas_nuevas).toHaveLength(1);
    expect(plan.asignaciones.map((a) => a.cabeza_id)).toEqual([null, null]);
  });
  it("el código de una cabeza nueva no choca con otra del mismo archivo", () => {
    const plan = planificarImportacionConjuntos([fila("GAMMA", "NUEVA CASA"), fila("GAMMA SPORT", "NUEVA-CASA")], estado());
    expect(plan.cabezas_nuevas.map((c) => c.codigo)).toEqual(["NUEVA_CASA", "NUEVA_CASA_2"]);
  });
  it("un conjunto cuyo código coincide con una marca existente es esa marca (nombre o código)", () => {
    const e = estado();
    e.marcas = [...e.marcas, { id: "x", nombre: "OTRA", codigo: "NUEVA_CASA", activo: true, agrupacion_marca_id: "ag-rec", conjunto_marca_id: null }];
    const plan = planificarImportacionConjuntos([fila("GAMMA", "nueva casa")], e);
    expect(plan.cabezas_nuevas).toEqual([]);
    expect(plan.asignaciones[0]).toMatchObject({ cabeza_id: "x", cabeza_nombre: "OTRA" });
  });
  it("una cabeza nueva en una agrupación inactiva se omite (agrupacion_inactiva) y no se crea", () => {
    const e = estado();
    e.agrupaciones = e.agrupaciones.map((a) => (a.id === "ag-val" ? { ...a, activo: false } : a));
    // GAMMA SPORT está en VALOR (inactiva): la cabeza nueva iría ahí.
    const plan = planificarImportacionConjuntos([fila("GAMMA SPORT", "GAMMA HOLDING"), fila("GAMMA", "GAMMA HOLDING")], e);
    expect(plan.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[1, "agrupacion_inactiva"]]);
    expect(plan.reporte.omitidas[0].detalle).toContain("VALOR");
    // La segunda fila (GAMMA está en RECONOCIDO, activa) sí crea la cabeza con su agrupación.
    expect(plan.cabezas_nuevas).toEqual([{ nombre: "GAMMA HOLDING", codigo: "GAMMA_HOLDING", agrupacion_marca_id: "ag-rec" }]);
    expect(plan.reporte.conjuntos_a_crear).toEqual([{ conjunto: "GAMMA HOLDING", agrupacion: "RECONOCIDO", de: "GAMMA" }]);
    // Si la cabeza ya existe, la agrupación inactiva de la marca no importa.
    const existente = planificarImportacionConjuntos([fila("GAMMA SPORT", "GAMMA")], e);
    expect(existente.reporte.asignar).toBe(1);
  });
  it("gana lo primero: el resultado depende del orden de las filas (determinista)", () => {
    const aBeforeB = planificarImportacionConjuntos([fila("GAMMA", "ALFA JEANS"), fila("ALFA JEANS", "ALFA")], estado());
    expect(aBeforeB.asignaciones.map((a) => `${a.marca_nombre}→${a.cabeza_nombre}`)).toEqual(["GAMMA→ALFA JEANS"]);
    expect(aBeforeB.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "marca_es_cabeza"]]);

    const bBeforeA = planificarImportacionConjuntos([fila("ALFA JEANS", "ALFA"), fila("GAMMA", "ALFA JEANS")], estado());
    expect(bBeforeA.asignaciones.map((a) => `${a.marca_nombre}→${a.cabeza_nombre}`)).toEqual(["ALFA JEANS→ALFA"]);
    expect(bBeforeA.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "conjunto_es_miembro"]]);

    // Mismo archivo, mismo resultado.
    const otra = planificarImportacionConjuntos([fila("GAMMA", "ALFA JEANS"), fila("ALFA JEANS", "ALFA")], estado());
    expect(JSON.stringify(otra)).toBe(JSON.stringify(aBeforeB));
  });
  it("no muta el estado recibido", () => {
    const e = estado();
    const copia = JSON.stringify(e);
    aplicarPlanConjuntos(e, planificarImportacionConjuntos(CSV, e));
    expect(JSON.stringify(e)).toBe(copia);
  });
});

// ─── Columna CONJUNTO del importador de marcas de M2 (pregunta 20) ───

const estadoMarcas = (): EstadoImportacionMarcas => ({
  agrupaciones: AGRUPACIONES.map((a) => ({ id: a.id, codigo: a.nombre.replace(/ /g, "_"), nombre: a.nombre, activo: a.activo })),
  marcas: marcasFixture().map((m) => ({
    id: m.id,
    codigo: m.codigo ?? "",
    nombre: m.nombre,
    agrupacion_marca_id: m.agrupacion_marca_id,
    tratamiento_especial: m.tratamiento_especial,
    activo: m.activo,
    conjunto_marca_id: m.conjunto_marca_id,
  })),
});
const fm = (marca: string, agrupacion: string, conjunto = "", tratamiento = ""): FilaImportacionMarca => ({
  marca,
  agrupacion,
  tratamiento_especial: tratamiento,
  conjunto,
});

describe("columna CONJUNTO del importador de marcas (M2)", () => {
  it("una marca nueva entra con su conjunto (la cabeza ya existe)", () => {
    const plan = planificarImportacionMarcas([fm("ALFA SPORT", "VALOR", "ALFA")], estadoMarcas());
    expect(plan.reporte.crear).toEqual({ marcas: 1, con_tratamiento_especial: 0, con_conjunto: 1 });
    expect(plan.conjuntos.asignaciones).toEqual([{ marca_id: null, marca_nombre: "ALFA SPORT", cabeza_id: "m-alfa", cabeza_nombre: "ALFA" }]);
    expect(plan.reporte.conjuntos).toEqual({ a_crear: [], omitidos: [] });
  });
  it("si la cabeza no existe se crea con la agrupación de la fila y se lista antes de aplicar", () => {
    const plan = planificarImportacionMarcas([fm("ZETA UNO", "PREMIUM", "ZETA HOLDING"), fm("ZETA DOS", "VALOR", "ZETA HOLDING")], estadoMarcas());
    expect(plan.reporte.conjuntos.a_crear).toEqual([{ conjunto: "ZETA HOLDING", agrupacion: "PREMIUM", de: "ZETA UNO" }]);
    expect(plan.conjuntos.cabezas_nuevas).toEqual([{ nombre: "ZETA HOLDING", codigo: "ZETA_HOLDING", agrupacion_marca_id: "ag-pre" }]);
    expect(plan.reporte.crear.con_conjunto).toBe(2);
  });
  it("la cabeza puede ser otra marca nueva del archivo, venga antes o después de sus miembros", () => {
    for (const filas of [
      [fm("OMEGA UNO", "VALOR", "OMEGA UNO"), fm("TETA", "VALOR", "TETA UNO"), fm("TETA UNO", "VALOR")],
      [fm("TETA UNO", "VALOR"), fm("TETA", "VALOR", "TETA UNO")],
    ]) {
      const plan = planificarImportacionMarcas(filas, estadoMarcas());
      const aTeta = plan.conjuntos.asignaciones.filter((a) => a.cabeza_nombre === "TETA UNO");
      expect(aTeta).toHaveLength(1);
      expect(aTeta[0].cabeza_id).toBeNull(); // se resuelve por nombre al escribir
      expect(plan.reporte.conjuntos.a_crear).toEqual([]); // no se crea una cabeza duplicada
    }
  });
  it("lo que no se puede aplicar no omite la marca: se crea sin conjunto y el motivo se lista", () => {
    const plan = planificarImportacionMarcas(
      [fm("ZETA UNO", "VALOR", "VARIOS"), fm("ZETA DOS", "VALOR", "ZETA DOS"), fm("ZETA TRES", "VALOR", "ALFA JEANS"), fm("ZETA CUATRO", "VALOR", "OMEGA")],
      estadoMarcas()
    );
    expect(plan.reporte.crear.marcas).toBe(4);
    expect(plan.reporte.crear.con_conjunto).toBe(0);
    expect(plan.reporte.conjuntos.omitidos.map((o) => [o.marca, o.motivo])).toEqual([
      ["ZETA UNO", "marca_generica"],
      ["ZETA DOS", "conjunto_igual_marca"],
      ["ZETA TRES", "conjunto_es_miembro"],
      ["ZETA CUATRO", "cabeza_inactiva"],
    ]);
    expect(plan.conjuntos.asignaciones).toEqual([]);
  });
  it("una marca existente con otro conjunto va a diferencias (campo conjunto) y no se modifica", () => {
    const plan = planificarImportacionMarcas([fm("ALFA JEANS", "VALOR", "GAMMA"), fm("ALFA KIDS", "RECONOCIDO", "ALFA", "SI"), fm("GAMMA", "RECONOCIDO", "ALFA")], estadoMarcas());
    expect(plan.reporte.diferencias).toEqual([
      { fila: 1, marca: "ALFA JEANS", campo: "conjunto", en_base: "ALFA", en_archivo: "GAMMA" },
      { fila: 3, marca: "GAMMA", campo: "conjunto", en_base: "(ninguno)", en_archivo: "ALFA" },
    ]);
    expect(plan.conjuntos.asignaciones).toEqual([]);
    expect(plan.reporte.crear.marcas).toBe(0);
  });
  it("sin columna (o vacía) nada cambia respecto a M2", () => {
    const plan = planificarImportacionMarcas([fm("ZETA", "VALOR"), fm("ALFA JEANS", "VALOR")], estadoMarcas());
    expect(plan.reporte.crear.con_conjunto).toBe(0);
    expect(plan.reporte.diferencias).toEqual([]);
    expect(plan.reporte.conjuntos).toEqual({ a_crear: [], omitidos: [] });
    expect(plan.conjuntos).toEqual({ cabezas_nuevas: [], asignaciones: [] });
  });
  it("aplicar y reimportar → nada nuevo ni diferencias", () => {
    const filas = [fm("ZETA UNO", "PREMIUM", "ZETA HOLDING"), fm("ZETA DOS", "VALOR", "ZETA HOLDING"), fm("ALFA SPORT", "VALOR", "ALFA")];
    const plan = planificarImportacionMarcas(filas, estadoMarcas());
    const despues = aplicarPlanMarcas(estadoMarcas(), plan);
    expect(despues.marcas.find((m) => m.nombre === "ZETA HOLDING")).toBeDefined();
    const holding = despues.marcas.find((m) => m.nombre === "ZETA HOLDING")!;
    expect(despues.marcas.find((m) => m.nombre === "ZETA UNO")?.conjunto_marca_id).toBe(holding.id);
    expect(despues.marcas.find((m) => m.nombre === "ALFA SPORT")?.conjunto_marca_id).toBe("m-alfa");
    const otra = planificarImportacionMarcas(filas, despues);
    expect(otra.reporte.crear).toEqual({ marcas: 0, con_tratamiento_especial: 0, con_conjunto: 0 });
    expect(otra.reporte.diferencias).toEqual([]);
    expect(otra.reporte.conjuntos).toEqual({ a_crear: [], omitidos: [] });
  });
});
