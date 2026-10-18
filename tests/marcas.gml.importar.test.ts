import { describe, expect, it } from "vitest";
import { aplicarPlanGml, leerModalidadDestino, planificarImportacionGml, type EstadoImportacionGml } from "@/lib/marcas/gml/importar";
import { modalidadEfectiva } from "@/lib/marcas/reglas";
import type { FilaImportacionGml, MotivoOmisionGml } from "@/lib/marcas/tipos-api";
import { arbolFixture, marcasFixture } from "./marcas.gml.fixture";

/** Reglas 14 a 16 y caso 10 de 02b: importador de la hoja de marcas relevantes por GML. */

const f = (marca: string, genero: string, mundo: string, linea: string, nota = "", modalidad = ""): FilaImportacionGml => ({ marca, genero, mundo, linea, nota, modalidad });

/** ALFA al barrer y sin GML, GAMMA sin casilla, TERNO inactiva en N3 (el nodo). */
function estado(cambio: Partial<EstadoImportacionGml> = {}): EstadoImportacionGml {
  const arbol = arbolFixture();
  arbol.nodos = arbol.nodos.map((n) => (n.id === "n3" ? { ...n, activo: false } : n));
  return {
    ...arbol,
    marcas: marcasFixture().map((m) => (m.id === "m-alfa" ? { ...m, modalidad_tratamiento: "barrido" } : m)),
    asignaciones: [],
    ...cambio,
  };
}

/** El CSV de ejemplo de la ficha, sin la fila de encabezado (la fila 1 es la primera de datos). */
const CSV: FilaImportacionGml[] = [
  f("ALFA", "HOMBRE", "URBANO", "DENIM", "Licencia de denim", "POR_GML"),
  f("ALFA", "MUJER", "URBANO", "DENIM"),
  f("ALFA", "HOMBRE", "FORMAL", "TERNO"),
  f("GAMMA", "HOMBRE", "URBANO", "DENIM"),
  f("ALFA", "hombre", "urbano", "denim", "repetida"),
  f("ZETA", "HOMBRE", "URBANO", "DENIM"),
  f("ALFA", "HOMBRE", "URBANO", "CORBATA"),
  f("ALFA", "", "URBANO", "DENIM"),
  f("TOTAL", "", "", ""),
];

const motivo = (fila: FilaImportacionGml, e = estado()): MotivoOmisionGml | undefined =>
  planificarImportacionGml([fila], e).reporte.omitidas[0]?.motivo;

describe("caso 10: el CSV de ejemplo", () => {
  const plan = planificarImportacionGml(CSV, estado());
  const { reporte } = plan;

  it("3 asignaciones a crear (las filas 1, 2 y 4 de datos = líneas 2, 3 y 5 del archivo)", () => {
    expect(reporte.crear.asignaciones).toBe(3);
    expect(plan.asignaciones).toEqual([
      { marca_id: "m-alfa", genero_mundo_linea_id: "n1", nota: "Licencia de denim" },
      { marca_id: "m-alfa", genero_mundo_linea_id: "n2", nota: null },
      { marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: null },
    ]);
    expect(reporte.crear.por_marca).toEqual([
      { marca_id: "m-alfa", marca: "ALFA", asignaciones: 2 },
      { marca_id: "m-gamma", marca: "GAMMA", asignaciones: 1 },
    ]);
  });
  it("cambios_marca: ALFA barrido → por_gml y GAMMA sin_tratamiento → por_gml", () => {
    expect(reporte.cambios_marca).toEqual([
      { marca_id: "m-alfa", marca: "ALFA", de: "barrido", a: "por_gml" },
      { marca_id: "m-gamma", marca: "GAMMA", de: "sin_tratamiento", a: "por_gml" },
    ]);
    expect(plan.marcar_ids).toEqual(["m-alfa", "m-gamma"]);
  });
  it("omitidas con su motivo y la fila completa", () => {
    expect(reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual([
      [3, "gml_inactivo"],
      [5, "duplicada_en_archivo"],
      [6, "marca_desconocida"],
      [7, "gml_inexistente"],
      [8, "genero_vacio"],
      [9, "fila_total"],
    ]);
    const dup = reporte.omitidas[1];
    expect(dup).toMatchObject({ fila_original: 1, marca: "ALFA", genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", nota: "repetida" });
    expect(dup.detalle).toBe("nota distinta: repetida");
    expect(reporte.omitidas[3].detalle).toBe("CORBATA no está en HOMBRE · URBANO");
    expect(reporte.omitidas[4]).toMatchObject({ marca: "ALFA", genero: "", mundo: "URBANO", linea: "DENIM" });
  });
  it("aplicar y reimportar → nada nuevo (regla 16)", () => {
    const despues = aplicarPlanGml(estado(), plan);
    const otra = planificarImportacionGml(CSV, despues);
    expect(otra.reporte.crear.asignaciones).toBe(0);
    expect(otra.reporte.crear.por_marca).toEqual([]);
    expect(otra.reporte.cambios_marca).toEqual([]);
    expect(otra.reporte.existentes.asignaciones).toBe(3);
    expect(otra.reporte.omitidas.map((o) => [o.fila, o.motivo])).toEqual(reporte.omitidas.map((o) => [o.fila, o.motivo]));
  });
  it("recibidas = procesadas + omitidas y procesadas = crear + existentes", () => {
    expect(reporte.totales).toEqual({ recibidas: 9, procesadas: 3, omitidas: 6 });
    const despues = planificarImportacionGml(CSV, aplicarPlanGml(estado(), plan)).reporte;
    expect(despues.totales.recibidas).toBe(despues.totales.procesadas + despues.totales.omitidas);
    expect(despues.totales.procesadas).toBe(despues.crear.asignaciones + despues.existentes.asignaciones);
  });
  it("el reporte trae la muestra de lo que se creará", () => {
    expect(reporte.muestra.asignaciones[0]).toBe("ALFA → HOMBRE · URBANO · DENIM");
  });
});

describe("regla 14: cada motivo en su condición", () => {
  it("marca_vacia y fila_total", () => {
    expect(motivo(f("  ", "HOMBRE", "URBANO", "DENIM"))).toBe("marca_vacia");
    expect(motivo(f("total", "", "", ""))).toBe("fila_total");
  });
  it("marca_desconocida y marca_inactiva", () => {
    expect(motivo(f("ZETA", "HOMBRE", "URBANO", "DENIM"))).toBe("marca_desconocida");
    expect(motivo(f("OMEGA", "HOMBRE", "URBANO", "DENIM"))).toBe("marca_inactiva");
  });
  it("marca_en_conjunto: un miembro no recibe GML, hay que usar la cabeza", () => {
    const r = planificarImportacionGml([f("ALFA JEANS", "HOMBRE", "URBANO", "DENIM")], estado()).reporte.omitidas[0];
    expect(r.motivo).toBe("marca_en_conjunto");
    expect(r.detalle).toBe("ALFA JEANS cuenta como ALFA");
  });
  it("género, mundo y línea: vacío, desconocido e inactivo", () => {
    const e = estado();
    e.generos = [...e.generos, { id: "g-x", codigo: "NINO", nombre: "NINO", activo: false }];
    e.mundos = [...e.mundos, { id: "mu-x", codigo: "RI", nombre: "RI", activo: false }];
    e.lineas = [...e.lineas, { id: "l-x", codigo: "POLO", nombre: "POLO", activo: false }];
    expect(motivo(f("GAMMA", "", "URBANO", "DENIM"), e)).toBe("genero_vacio");
    expect(motivo(f("GAMMA", "PERRO", "URBANO", "DENIM"), e)).toBe("genero_desconocido");
    expect(motivo(f("GAMMA", "NINO", "URBANO", "DENIM"), e)).toBe("genero_inactivo");
    expect(motivo(f("GAMMA", "HOMBRE", "", "DENIM"), e)).toBe("mundo_vacio");
    expect(motivo(f("GAMMA", "HOMBRE", "NADA", "DENIM"), e)).toBe("mundo_desconocido");
    expect(motivo(f("GAMMA", "HOMBRE", "RI", "DENIM"), e)).toBe("mundo_inactivo");
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", ""), e)).toBe("linea_vacia");
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", "NADA"), e)).toBe("linea_desconocida");
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", "POLO"), e)).toBe("linea_inactiva");
  });
  it("gml_inexistente y gml_inactivo", () => {
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", "CORBATA"))).toBe("gml_inexistente");
    expect(motivo(f("GAMMA", "HOMBRE", "FORMAL", "TERNO"))).toBe("gml_inactivo");
  });
  it("nota_larga a partir de 201 caracteres", () => {
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", "DENIM", "x".repeat(201)))).toBe("nota_larga");
    expect(motivo(f("GAMMA", "HOMBRE", "URBANO", "DENIM", "x".repeat(200)))).toBeUndefined();
  });
  it("duplicada_en_archivo con la fila original", () => {
    const r = planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM"), f("gamma", "hombre", "urbano", "denim")], estado()).reporte.omitidas[0];
    expect(r).toMatchObject({ fila: 2, motivo: "duplicada_en_archivo", fila_original: 1 });
    expect(r.detalle).toBeUndefined();
  });
  it("la marca se reconoce por nombre normalizado y por código", () => {
    const porNombre = planificarImportacionGml([f("  gamma  sport ", "HOMBRE", "URBANO", "DENIM")], estado());
    expect(porNombre.asignaciones[0].marca_id).toBe("m-gamma-sport");
    const porCodigo = planificarImportacionGml([f("epsilon", "HOMBRE", "URBANO", "DENIM", "", "POR_GML")], estado());
    expect(porCodigo.asignaciones[0].marca_id).toBe("m-epsilon");
    const porCodigoGuion = planificarImportacionGml([f("Gamma-Sport", "HOMBRE", "URBANO", "DENIM")], estado());
    expect(porCodigoGuion.asignaciones[0].marca_id).toBe("m-gamma-sport");
  });
  it("la fila de una marca sin casilla NO se omite: la marca entra en cambios_marca", () => {
    const { reporte } = planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM")], estado());
    expect(reporte.omitidas).toEqual([]);
    expect(reporte.cambios_marca).toEqual([{ marca_id: "m-gamma", marca: "GAMMA", de: "sin_tratamiento", a: "por_gml" }]);
  });
});

describe("regla 15: el plan nunca crea árbol ni marcas y respeta lo existente", () => {
  it("un par existente nunca entra en crear; una nota distinta va a diferencias y no se escribe", () => {
    const e = estado({ asignaciones: [{ id: "a1", marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: "vieja", activo: true }] });
    const plan = planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM", "nueva"), f("GAMMA", "MUJER", "URBANO", "DENIM")], e);
    expect(plan.asignaciones).toEqual([{ marca_id: "m-gamma", genero_mundo_linea_id: "n2", nota: null }]);
    expect(plan.reporte.existentes.asignaciones).toBe(1);
    expect(plan.reporte.diferencias).toEqual([
      { fila: 1, marca: "GAMMA", ruta: "HOMBRE · URBANO · DENIM", campo: "nota", en_base: "vieja", en_archivo: "nueva" },
    ]);
  });
  it("sin nota en el archivo no hay diferencia", () => {
    const e = estado({ asignaciones: [{ id: "a1", marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: "vieja", activo: true }] });
    expect(planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM")], e).reporte.diferencias).toEqual([]);
  });
  it("cambios_marca = exactamente las marcas no por_gml con al menos una asignación nueva", () => {
    const filas = [
      f("ALFA", "HOMBRE", "URBANO", "DENIM", "", "POR_GML"), // barrido → por_gml
      f("BETA", "HOMBRE", "URBANO", "DENIM", "", "MIXTA"), // barrido → mixta
      f("DELTA", "HOMBRE", "URBANO", "DENIM"), // ya por_gml: sin cambio de marca
      f("ÉPSILON", "HOMBRE", "URBANO", "DENIM", "", "por gml"), // sin modalidad → por_gml
      f("ÉPSILON", "MUJER", "URBANO", "DENIM"),
    ];
    const { reporte } = planificarImportacionGml(filas, estado());
    expect(reporte.cambios_marca.map((c) => `${c.marca}:${c.de}:${c.a}`)).toEqual([
      "ALFA:barrido:por_gml",
      "BETA:barrido:mixta",
      "ÉPSILON:sin_modalidad:por_gml",
    ]);
  });
  it("una marca no por_gml cuyas filas son todas existentes o rechazadas no cambia", () => {
    const e = estado({ asignaciones: [{ id: "a1", marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: null, activo: true }] });
    const { reporte } = planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM")], e);
    expect(reporte.cambios_marca).toEqual([]);
  });
  it("no muta el estado ni las filas recibidas", () => {
    const e = estado();
    const copia = JSON.stringify(e);
    const filas = CSV.map((x) => ({ ...x }));
    aplicarPlanGml(e, planificarImportacionGml(filas, e));
    expect(JSON.stringify(e)).toBe(copia);
    expect(filas).toEqual(CSV);
  });
});

describe("M12: modalidad destino al asignar el primer GML a una marca al barrer (regla 13)", () => {
  const sinModalidad = (fila: FilaImportacionGml) => planificarImportacionGml([fila], estado());

  it("una marca al barrer sin la columna MODALIDAD → la fila se omite con modalidad_destino_requerida", () => {
    const { reporte, asignaciones, marcar_ids } = sinModalidad(f("BETA", "HOMBRE", "URBANO", "DENIM"));
    expect(reporte.omitidas.map((o) => o.motivo)).toEqual(["modalidad_destino_requerida"]);
    expect(reporte.omitidas[0].detalle).toBe("BETA");
    expect(reporte.totales).toEqual({ recibidas: 1, procesadas: 0, omitidas: 1 });
    expect(asignaciones).toEqual([]);
    expect(marcar_ids).toEqual([]);
  });
  it("una marca marcada sin modalidad se lee como al barrer: también la exige", () => {
    expect(sinModalidad(f("ÉPSILON", "HOMBRE", "URBANO", "DENIM")).reporte.omitidas[0].motivo).toBe("modalidad_destino_requerida");
  });
  it("un texto que no es POR_GML ni MIXTA → modalidad_invalida con el texto", () => {
    const r = sinModalidad(f("BETA", "HOMBRE", "URBANO", "DENIM", "", "barrido")).reporte.omitidas[0];
    expect(r.motivo).toBe("modalidad_invalida");
    expect(r.detalle).toBe("BARRIDO");
    expect(r.modalidad).toBe("BARRIDO");
  });
  it("MIXTA: la marca pasa a mixta (marcar_mixta_ids) y al aplicar su modalidad efectiva es mixta", () => {
    const e = estado();
    const plan = planificarImportacionGml([f("BETA", "HOMBRE", "URBANO", "DENIM", "", "mixta")], e);
    expect(plan.reporte.cambios_marca).toEqual([{ marca_id: "m-beta", marca: "BETA", de: "barrido", a: "mixta" }]);
    expect(plan.marcar_ids).toEqual(["m-beta"]);
    expect(plan.marcar_mixta_ids).toEqual(["m-beta"]);
    const despues = aplicarPlanGml(e, plan);
    const beta = despues.marcas.find((m) => m.id === "m-beta");
    expect(modalidadEfectiva({ tratamiento_especial: true, modalidad_tratamiento: beta?.modalidad_tratamiento ?? null, resto_al_barrer: beta?.resto_al_barrer })).toBe("mixta");
  });
  it("POR_GML deja marcar_mixta_ids vacío y la bandera apagada", () => {
    const e = estado();
    const plan = planificarImportacionGml([f("BETA", "HOMBRE", "URBANO", "DENIM", "", "POR_GML")], e);
    expect(plan.marcar_mixta_ids).toEqual([]);
    expect(aplicarPlanGml(e, plan).marcas.find((m) => m.id === "m-beta")?.resto_al_barrer).toBe(false);
  });
  it("manda la primera fila que dice la modalidad: las demás filas de la marca la heredan", () => {
    const plan = planificarImportacionGml(
      [f("BETA", "HOMBRE", "URBANO", "DENIM", "", "MIXTA"), f("BETA", "MUJER", "URBANO", "DENIM"), f("BETA", "HOMBRE", "FORMAL", "TERNO", "", "POR_GML")],
      estado({ asignaciones: [] })
    );
    expect(plan.asignaciones.map((a) => a.genero_mundo_linea_id)).toEqual(["n1", "n2"]);
    expect(plan.reporte.cambios_marca).toEqual([{ marca_id: "m-beta", marca: "BETA", de: "barrido", a: "mixta" }]);
  });
  it("un par que ya existe no necesita modalidad (no cambia la marca) y una marca sin tratamiento ignora la columna", () => {
    const e = estado({ asignaciones: [{ id: "a1", marca_id: "m-beta", genero_mundo_linea_id: "n1", nota: null, activo: true }] });
    const existente = planificarImportacionGml([f("BETA", "HOMBRE", "URBANO", "DENIM")], e);
    expect(existente.reporte.omitidas).toEqual([]);
    expect(existente.reporte.existentes.asignaciones).toBe(1);
    expect(existente.reporte.cambios_marca).toEqual([]);
    const gamma = planificarImportacionGml([f("GAMMA", "HOMBRE", "URBANO", "DENIM", "", "mixta")], estado());
    expect(gamma.reporte.cambios_marca).toEqual([{ marca_id: "m-gamma", marca: "GAMMA", de: "sin_tratamiento", a: "por_gml" }]);
    expect(gamma.marcar_mixta_ids).toEqual([]);
  });
  it("leerModalidadDestino: POR_GML / POR GML / MIXTA, vacío y otro texto", () => {
    expect(leerModalidadDestino("POR_GML")).toBe("por_gml");
    expect(leerModalidadDestino(" por gml ")).toBe("por_gml");
    expect(leerModalidadDestino("Mixta")).toBe("mixta");
    expect(leerModalidadDestino("  ")).toBe("vacia");
    expect(leerModalidadDestino("barrido")).toBeNull();
  });
});
