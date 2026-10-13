import { describe, expect, it } from "vitest";
import { aplicarPlanNivel, planificarImportacionNivel, type EstadoImportacionNivel } from "@/lib/arbol/nivel/importar";
import { resolverGml } from "@/lib/arbol/nivel/resolver";
import { planificarImportacionGml } from "@/lib/marcas/gml/importar";
import type { FilaImportacionNivel, MotivoOmisionNivel } from "@/lib/arbol/tipos";
import { arbolFixture, marcasFixture } from "./marcas.gml.fixture";

/** Reglas 3 y 4 y caso 12 de 02b: importador de niveles y `resolverGml` compartida. */

const f = (genero: string, mundo: string, linea: string, nivel: string): FilaImportacionNivel => ({ genero, mundo, linea, nivel });
const estado = (): EstadoImportacionNivel => arbolFixture();
const motivo = (fila: FilaImportacionNivel, e = estado()): MotivoOmisionNivel | undefined =>
  planificarImportacionNivel([fila], e).reporte.omitidas[0]?.motivo;

describe("caso 12: N1,GMLE y N2,GML más una fila con un nodo que no existe", () => {
  const filas = [f("HOMBRE", "URBANO", "DENIM", "GMLE"), f("MUJER", "URBANO", "DENIM", "GML"), f("HOMBRE", "URBANO", "CORBATA", "GMLE")];
  const plan = planificarImportacionNivel(filas, estado());

  it("dos cambios (N1 GML → GMLE y N2 GMLE → GML) y una omitida gml_inexistente", () => {
    expect(plan.reporte.cambios).toEqual([
      { fila: 1, ruta: "HOMBRE · URBANO · DENIM", de: "GML", a: "GMLE" },
      { fila: 2, ruta: "MUJER · URBANO · DENIM", de: "GMLE", a: "GML" },
    ]);
    expect(plan.cambios).toEqual([
      { nodo_id: "n1", nivel: "GMLE" },
      { nodo_id: "n2", nivel: "GML" },
    ]);
    expect(plan.reporte.omitidas).toHaveLength(1);
    expect(plan.reporte.omitidas[0]).toMatchObject({ fila: 3, motivo: "gml_inexistente", detalle: "CORBATA no está en HOMBRE · URBANO", nivel: "GMLE" });
    expect(plan.reporte.totales).toEqual({ recibidas: 3, procesadas: 2, omitidas: 1 });
    expect(plan.reporte.muestra.cambios).toEqual(["HOMBRE · URBANO · DENIM: GML → GMLE", "MUJER · URBANO · DENIM: GMLE → GML"]);
  });
  it("reimportar tras aplicar → cambios = 0 (el archivo manda pero ya coincide)", () => {
    const despues = aplicarPlanNivel(estado(), plan);
    const otra = planificarImportacionNivel(filas, despues);
    expect(otra.reporte.cambios).toEqual([]);
    expect(otra.cambios).toEqual([]);
    expect(otra.reporte.sin_cambio).toBe(2);
    expect(otra.reporte.totales).toEqual({ recibidas: 3, procesadas: 2, omitidas: 1 });
  });
  it("los nodos ausentes del archivo no se tocan y no se crea árbol", () => {
    const despues = aplicarPlanNivel(estado(), plan);
    expect(despues.nodos.find((n) => n.id === "n3")?.nivel_planificacion).toBe("GML");
    expect(despues.nodos).toHaveLength(3);
    expect(despues.lineas).toEqual(estado().lineas);
  });
  it("no muta el estado recibido", () => {
    const e = estado();
    const copia = JSON.stringify(e);
    aplicarPlanNivel(e, planificarImportacionNivel(filas, e));
    expect(JSON.stringify(e)).toBe(copia);
  });
});

describe("regla 3: cada motivo en su condición", () => {
  it("nivel_vacio y nivel_invalido", () => {
    expect(motivo(f("HOMBRE", "URBANO", "DENIM", "  "))).toBe("nivel_vacio");
    const r = planificarImportacionNivel([f("HOMBRE", "URBANO", "DENIM", "TODO")], estado()).reporte.omitidas[0];
    expect(r).toMatchObject({ motivo: "nivel_invalido", detalle: "TODO", nivel: "TODO" });
  });
  it("fila_total y los motivos de resolverGml", () => {
    expect(motivo(f("TOTAL", "", "", ""))).toBe("fila_total");
    expect(motivo(f("", "URBANO", "DENIM", "GML"))).toBe("genero_vacio");
    expect(motivo(f("PERRO", "URBANO", "DENIM", "GML"))).toBe("genero_desconocido");
    expect(motivo(f("HOMBRE", "", "DENIM", "GML"))).toBe("mundo_vacio");
    expect(motivo(f("HOMBRE", "NADA", "DENIM", "GML"))).toBe("mundo_desconocido");
    expect(motivo(f("HOMBRE", "URBANO", "", "GML"))).toBe("linea_vacia");
    expect(motivo(f("HOMBRE", "URBANO", "NADA", "GML"))).toBe("linea_desconocida");
    expect(motivo(f("HOMBRE", "URBANO", "CORBATA", "GML"))).toBe("gml_inexistente");
  });
  it("inactivos: género, mundo, línea y nodo", () => {
    const e = estado();
    e.generos = e.generos.map((g) => (g.id === "g-m" ? { ...g, activo: false } : g));
    expect(motivo(f("MUJER", "URBANO", "DENIM", "GML"), e)).toBe("genero_inactivo");
    const e2 = estado();
    e2.mundos = e2.mundos.map((m) => (m.id === "mu-for" ? { ...m, activo: false } : m));
    expect(motivo(f("HOMBRE", "FORMAL", "TERNO", "GML"), e2)).toBe("mundo_inactivo");
    const e3 = estado();
    e3.lineas = e3.lineas.map((l) => (l.id === "l-terno" ? { ...l, activo: false } : l));
    expect(motivo(f("HOMBRE", "FORMAL", "TERNO", "GML"), e3)).toBe("linea_inactiva");
    const e4 = estado();
    e4.nodos = e4.nodos.map((n) => (n.id === "n3" ? { ...n, activo: false } : n));
    expect(motivo(f("HOMBRE", "FORMAL", "TERNO", "GML"), e4)).toBe("gml_inactivo");
  });
  it("duplicada_en_archivo con fila_original y, si el nivel difiere, detalle", () => {
    const r = planificarImportacionNivel(
      [f("HOMBRE", "URBANO", "DENIM", "GMLE"), f("hombre", "urbano", "denim", "GML"), f("HOMBRE", "URBANO", "DENIM", "GMLE")],
      estado()
    ).reporte;
    expect(r.omitidas[0]).toMatchObject({ fila: 2, motivo: "duplicada_en_archivo", fila_original: 1, detalle: "nivel distinto: GML" });
    expect(r.omitidas[1]).toMatchObject({ fila: 3, motivo: "duplicada_en_archivo", fila_original: 1 });
    expect(r.omitidas[1].detalle).toBeUndefined();
    expect(r.cambios).toHaveLength(1);
  });
  it("nivel acepta GML, GMLE y los sinónimos LINEA y EQUIVALENCIA sin distinguir caja", () => {
    const plan = planificarImportacionNivel(
      [f("HOMBRE", "URBANO", "DENIM", "equivalencia"), f("MUJER", "URBANO", "DENIM", "Linea"), f("HOMBRE", "FORMAL", "TERNO", "gmle")],
      estado()
    );
    expect(plan.cambios).toEqual([
      { nodo_id: "n1", nivel: "GMLE" },
      { nodo_id: "n2", nivel: "GML" },
      { nodo_id: "n3", nivel: "GMLE" },
    ]);
  });
  it("un nodo con el nivel que ya tiene es sin_cambio; nunca entra en cambios", () => {
    const plan = planificarImportacionNivel([f("HOMBRE", "URBANO", "DENIM", "GML")], estado());
    expect(plan.reporte).toMatchObject({ cambios: [], sin_cambio: 1 });
    expect(plan.reporte.totales.procesadas).toBe(1);
  });
  it("la fila omitida lleva la fila completa tal como se normalizó", () => {
    const r = planificarImportacionNivel([f(" hombre ", "urbano", "denim", " x ")], estado()).reporte.omitidas[0];
    expect(r).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", nivel: "X" });
  });
});

describe("regla 4: resolverGml es una sola para los dos importadores", () => {
  const e = estado();
  const casos: [string, string, string][] = [
    ["", "URBANO", "DENIM"],
    ["PERRO", "URBANO", "DENIM"],
    ["HOMBRE", "NADA", "DENIM"],
    ["HOMBRE", "URBANO", "NADA"],
    ["HOMBRE", "URBANO", "CORBATA"],
    ["TOTAL", "", ""],
  ];
  it("ante la misma fila devuelven el mismo motivo", () => {
    for (const [genero, mundo, linea] of casos) {
      const nivel = planificarImportacionNivel([f(genero, mundo, linea, "GMLE")], e).reporte.omitidas[0]?.motivo;
      // En el importador de marcas, TOTAL en la marca es fila_total antes de mirar el GML: aquí la marca es válida.
      const gml = planificarImportacionGml([{ marca: "GAMMA", genero, mundo, linea, nota: "" }], { ...e, marcas: marcasFixture(), asignaciones: [] }).reporte.omitidas[0]?.motivo;
      expect(gml, `${genero}|${mundo}|${linea}`).toBe(nivel);
    }
  });
  it("resuelve por código o por nombre, solo entre activos, y el nodo por la tripleta", () => {
    const r = resolverGml({ genero: "hombre", mundo: "Urbano", linea: "denim" }, e);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nodo.id).toBe("n1");
    const porCodigo = resolverGml({ genero: "H", mundo: "URBANO", linea: "DENIM" }, { ...e, generos: e.generos.map((g) => (g.id === "g-h" ? { ...g, codigo: "H" } : g)) });
    expect(porCodigo.ok).toBe(true);
  });
  it("gml_inexistente trae el detalle 'LINEA no está en GENERO · MUNDO'", () => {
    const r = resolverGml({ genero: "HOMBRE", mundo: "URBANO", linea: "CORBATA" }, e);
    expect(r).toMatchObject({ ok: false, motivo: "gml_inexistente", detalle: "CORBATA no está en HOMBRE · URBANO" });
  });
  it("nunca crea árbol: el estado queda igual", () => {
    const copia = JSON.stringify(e);
    resolverGml({ genero: "NUEVO", mundo: "NUEVO", linea: "NUEVA" }, e);
    expect(JSON.stringify(e)).toBe(copia);
  });
});
