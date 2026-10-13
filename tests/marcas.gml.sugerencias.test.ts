import { describe, expect, it } from "vitest";
import { armarSugerencias, mesesAntes, resolverRango, type FilaSugerenciaSql } from "@/lib/marcas/gml/sugerencias";
import { esMarcaGenerica, unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import type { EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { arbolFixture, estadoFixture, EQUIVALENCIAS, HECHOS_SUELTOS, HECHOS_TODOS, indiceFixture, AGR } from "./marcas.gml.fixture";

/**
 * Casos 11 y 20 de 02b. La agregación va en SQL (`sugerir…`); aquí se emula con
 * las mismas reglas de la función (unidad de marca, agrupación de la unidad,
 * exclusión previa, top por GML × agrupación, participación a 6 decimales) para
 * probar lo que hace Node con su resultado.
 */

type Hecho = { marca_id: string; equivalencia_id: string; unidades: number };
const PRECIO = 10;

type OpcionesSql = { top: number; medida?: "venta_soles" | "unidades"; min?: number };

/** Emula `sugerir_marcas_relevantes_v2`: orden por medida, participación sobre el total completo, top y mínimo en SQL. */
function simularSql(estado: EstadoVistaGml, hechos: Hecho[], { top, medida = "venta_soles", min = 0 }: OpcionesSql): FilaSugerenciaSql[] {
  const excluir = new Set(estado.marcas.filter((m) => esMarcaGenerica(m.nombre)).map((m) => m.id));
  const agregado = new Map<string, FilaSugerenciaSql>();
  for (const h of hechos) {
    const marca = estado.marcas.find((m) => m.id === h.marca_id)!;
    const unidad = unidadDeMarca(marca, estado.marcas).unidad_marca_id;
    if (excluir.has(unidad)) continue;
    const cabeza = estado.marcas.find((m) => m.id === unidad)!;
    const nodo = EQUIVALENCIAS.find((e) => e.id === h.equivalencia_id)!.genero_mundo_linea_id;
    const k = `${nodo}|${cabeza.agrupacion_marca_id}|${unidad}`;
    const previo = agregado.get(k) ?? {
      genero_mundo_linea_id: nodo,
      agrupacion_marca_id: cabeza.agrupacion_marca_id,
      marca_id: unidad,
      unidades: 0,
      venta_soles: 0,
      participacion: 0,
      rango: 0,
    };
    previo.unidades += h.unidades;
    previo.venta_soles += h.unidades * PRECIO;
    agregado.set(k, previo);
  }
  const medir = (f: FilaSugerenciaSql) => (medida === "unidades" ? f.unidades : f.venta_soles);
  const grupos = new Map<string, FilaSugerenciaSql[]>();
  for (const f of agregado.values()) {
    const k = `${f.genero_mundo_linea_id}|${f.agrupacion_marca_id}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  const salida: FilaSugerenciaSql[] = [];
  for (const lista of grupos.values()) {
    const total = lista.reduce((s, f) => s + medir(f), 0);
    lista
      .sort((a, b) => medir(b) - medir(a) || (a.marca_id < b.marca_id ? -1 : 1))
      .forEach((f, i) => {
        const part = total > 0 ? Math.round((medir(f) / total) * 1e6) / 1e6 : 0;
        if (i + 1 <= top && part >= min) salida.push({ ...f, participacion: part, rango: i + 1 });
      });
  }
  return salida;
}

const SQL4 = { top: 4, min: 0.05 };
const fila = (s: ReturnType<typeof armarSugerencias>["sugerencias"], nodo: string, agr: string, marca: string) =>
  s.find((x) => x.genero_mundo_linea_id === nodo && x.agrupacion_marca_id === agr && x.marca_id === marca);

describe("caso 11: sugerencias sobre los hechos sueltos (top 4, mín. 5 %)", () => {
  const estado = estadoFixture();
  const { sugerencias, resumen } = armarSugerencias(simularSql(estado, HECHOS_SUELTOS, SQL4), estado);

  it("N1 RECONOCIDO: ALFA 62,5 % ya_relevante y GAMMA 37,5 % nueva", () => {
    expect(fila(sugerencias, "n1", AGR.rec, "m-alfa")).toMatchObject({ participacion: 0.625, estado: "ya_relevante", rango: 1, unidades: 500, venta_soles: 5000, miembros: 2 });
    expect(fila(sugerencias, "n1", AGR.rec, "m-gamma")).toMatchObject({ participacion: 0.375, estado: "nueva", rango: 2 });
  });
  it("N1 PREMIUM: BETA 100 % marca_al_barrer", () => {
    expect(fila(sugerencias, "n1", AGR.pre, "m-beta")).toMatchObject({ participacion: 1, estado: "marca_al_barrer", agrupacion: "PREMIUM" });
  });
  it("N3 RECONOCIDO: GAMMA 60 % nueva y ALFA 40 % ya_relevante", () => {
    expect(fila(sugerencias, "n3", AGR.rec, "m-gamma")).toMatchObject({ participacion: 0.6, estado: "nueva", rango: 1 });
    expect(fila(sugerencias, "n3", AGR.rec, "m-alfa")).toMatchObject({ participacion: 0.4, estado: "ya_relevante", rango: 2 });
  });
  it("la fila trae el GML, su nivel y la agrupación en claro", () => {
    expect(fila(sugerencias, "n2", AGR.rec, "m-alfa")).toMatchObject({
      genero: "MUJER",
      mundo: "URBANO",
      linea: "DENIM",
      nivel_planificacion: "GMLE",
      agrupacion: "RECONOCIDO",
      marca: "ALFA",
    });
  });
  it("el resumen cuenta nodos, pares y estados", () => {
    expect(resumen).toEqual({ nodos: 3, pares: sugerencias.length, nuevas: 2, ya_relevantes: 3, al_barrer: 2 });
  });
  it("nada por debajo de la participación mínima", () => {
    const hechos = [...HECHOS_SUELTOS, { marca_id: "m-delta", equivalencia_id: "e1a", unidades: 10 }];
    const r = armarSugerencias(simularSql(estado, hechos, SQL4), estado);
    expect(fila(r.sugerencias, "n1", AGR.rec, "m-delta")).toBeUndefined(); // 10 de 810: 1,2 %
    expect(r.sugerencias.every((s) => s.participacion >= 0.05)).toBe(true);
    const sinMinimo = armarSugerencias(simularSql(estado, hechos, { top: 4, min: 0 }), estado);
    expect(fila(sinMinimo.sugerencias, "n1", AGR.rec, "m-delta")).toBeDefined();
  });
  it("VARIOS, OTROS y SIN MARCA no se sugieren (se excluyen antes de agregar)", () => {
    const hechos = [...HECHOS_SUELTOS, { marca_id: "m-varios", equivalencia_id: "e1a", unidades: 5000 }];
    const r = armarSugerencias(simularSql(estado, hechos, SQL4), estado);
    expect(r.sugerencias.some((s) => s.marca_id === "m-varios")).toBe(false);
    expect(fila(r.sugerencias, "n1", AGR.rec, "m-alfa")?.participacion).toBe(0.625);
  });
  it("top limita las filas por GML × agrupación", () => {
    const uno = armarSugerencias(simularSql(estado, HECHOS_SUELTOS, { top: 1, min: 0.05 }), estado);
    expect(uno.sugerencias.every((s) => s.rango === 1)).toBe(true);
    expect(fila(uno.sugerencias, "n1", AGR.rec, "m-gamma")).toBeUndefined();
  });
  it("la participación de cada (GML, agrupación) suma 1 cuando el top cubre todas", () => {
    const r = armarSugerencias(simularSql(estado, HECHOS_SUELTOS, { top: 10 }), estado);
    const sumas = new Map<string, number>();
    for (const s of r.sugerencias) sumas.set(`${s.genero_mundo_linea_id}|${s.agrupacion_marca_id}`, (sumas.get(`${s.genero_mundo_linea_id}|${s.agrupacion_marca_id}`) ?? 0) + s.participacion);
    for (const total of sumas.values()) expect(total).toBeCloseTo(1, 6);
  });
});

describe("caso 20: sugerencias con conjuntos (todos los hechos)", () => {
  const estado = estadoFixture();
  const { sugerencias } = armarSugerencias(simularSql(estado, HECHOS_TODOS, SQL4), estado);

  it("N1 RECONOCIDO: ALFA 68,4 % (650 de 950) ya_relevante con miembros = 2, y GAMMA 31,6 %", () => {
    const alfa = fila(sugerencias, "n1", AGR.rec, "m-alfa");
    expect(alfa).toMatchObject({ unidades: 650, estado: "ya_relevante", miembros: 2 });
    expect(alfa?.participacion).toBeCloseTo(0.684211, 6);
    expect(fila(sugerencias, "n1", AGR.rec, "m-gamma")?.participacion).toBeCloseTo(0.315789, 6);
  });
  it("N1 PREMIUM: BETA 100 % (BETA + BETA UNO) marca_al_barrer", () => {
    expect(fila(sugerencias, "n1", AGR.pre, "m-beta")).toMatchObject({ participacion: 1, unidades: 250, estado: "marca_al_barrer", miembros: 2 });
  });
  it("ALFA aparece una sola vez por GML y agrupación, y ningún miembro aparece como fila propia", () => {
    expect(sugerencias.filter((s) => s.genero_mundo_linea_id === "n1" && s.marca_id === "m-alfa")).toHaveLength(1);
    expect(sugerencias.some((s) => ["m-alfa-jeans", "m-alfa-kids", "m-beta-uno", "m-beta-dos"].includes(s.marca_id))).toBe(false);
  });
  it("las filas son por la agrupación de la unidad: ALFA JEANS (VALOR) no abre una fila de VALOR", () => {
    expect(sugerencias.some((s) => s.agrupacion_marca_id === AGR.val)).toBe(false);
  });
});

describe("estado de la sugerencia frente a la configuración", () => {
  it("marca_inactiva, nodo_no_vigente y nueva para una marca sin casilla", () => {
    const arbol = arbolFixture();
    arbol.lineas = arbol.lineas.map((l) => (l.id === "l-terno" ? { ...l, activo: false } : l));
    const e = estadoFixture({ nodos: indiceFixture(arbol) });
    const hechos = [...HECHOS_SUELTOS, { marca_id: "m-omega", equivalencia_id: "e1a", unidades: 400 }];
    const { sugerencias } = armarSugerencias(simularSql(e, hechos, SQL4), e);
    expect(fila(sugerencias, "n1", AGR.rec, "m-omega")?.estado).toBe("marca_inactiva");
    expect(fila(sugerencias, "n3", AGR.rec, "m-gamma")?.estado).toBe("nodo_no_vigente");
    expect(fila(sugerencias, "n1", AGR.rec, "m-gamma")?.estado).toBe("nueva");
  });
});

describe("medida = unidades (la hace SQL; Node no reordena ni recalcula)", () => {
  it("la función v2 ordena y mide con unidades; la salida conserva ese orden, rango y participación", () => {
    const e = estadoFixture();
    // ALFA vende menos unidades pero más soles que GAMMA: por unidades manda GAMMA.
    const hechos = [
      { marca_id: "m-alfa", equivalencia_id: "e1a", unidades: 100 },
      { marca_id: "m-gamma", equivalencia_id: "e1a", unidades: 300 },
    ];
    const filas = simularSql(e, hechos, { top: 4, medida: "unidades" });
    const r = armarSugerencias(filas, e);
    expect(r.sugerencias.map((s) => [s.marca, s.rango, s.participacion])).toEqual([
      ["GAMMA", 1, 0.75],
      ["ALFA", 2, 0.25],
    ]);
  });
  it("armarSugerencias no filtra ni reordena lo que ya viene de SQL", () => {
    const e = estadoFixture();
    const filas: FilaSugerenciaSql[] = [
      { genero_mundo_linea_id: "n1", agrupacion_marca_id: AGR.rec, marca_id: "m-gamma", unidades: 1, venta_soles: 10, participacion: 0.01, rango: 2 },
      { genero_mundo_linea_id: "n1", agrupacion_marca_id: AGR.rec, marca_id: "m-alfa", unidades: 9, venta_soles: 90, participacion: 0.99, rango: 1 },
    ];
    const r = armarSugerencias(filas, e);
    expect(r.sugerencias.map((s) => [s.marca, s.rango, s.participacion])).toEqual([["ALFA", 1, 0.99], ["GAMMA", 2, 0.01]]);
  });
});

describe("rango de meses", () => {
  it("mesesAntes cruza el año", () => {
    expect(mesesAntes("2026-09", 11)).toBe("2025-10");
    expect(mesesAntes("2026-01", 1)).toBe("2025-12");
    expect(mesesAntes("2026-03", 0)).toBe("2026-03");
  });
  it("por defecto: hasta = el último mes publicado y desde = once meses antes", () => {
    const publicados = ["2026-07", "2026-08", "2026-09", "2024-01"];
    expect(resolverRango(publicados)).toEqual({ desde: "2025-10", hasta: "2026-09", meses_publicados: 3 });
  });
  it("respeta desde y hasta y cuenta solo los publicados dentro", () => {
    expect(resolverRango(["2026-07", "2026-08", "2026-09"], "2026-08", "2026-09")).toEqual({ desde: "2026-08", hasta: "2026-09", meses_publicados: 2 });
  });
  it("sin meses publicados en el rango → null (la API responde 409)", () => {
    expect(resolverRango([])).toBeNull();
    expect(resolverRango(["2026-07"], "2025-01", "2025-06")).toBeNull();
    expect(resolverRango(["no-es-un-mes"])).toBeNull();
  });
});
