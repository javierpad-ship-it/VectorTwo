import { describe, expect, it } from "vitest";
import {
  aplicarMiembrosEnMemoria,
  avisosConjunto,
  esCabeza,
  esMarcaGenerica,
  motivoRechazoConjunto,
  planificarMiembrosBloque,
  resumenConjuntos,
  unidadDeMarca,
  type MiembroParaAvisos,
} from "@/lib/marcas/conjuntos/reglas";
import { armarVistaConjuntos } from "@/lib/marcas/conjuntos/vista";
import { contarAsignaciones } from "@/lib/marcas/gml/vista";
import { AGRUPACIONES, estadoFixture, marcasFixture } from "./marcas.gml.fixture";

/** Reglas 20 a 23 y casos 15, 17, 18 y 22 de 02b: conjuntos de marcas. */

const marcas = () => marcasFixture();
const get = (lista: ReturnType<typeof marcas>, id: string) => lista.find((m) => m.id === id)!;
const sinAlfa = () => marcas().map((m) => (m.id === "m-alfa" ? { ...m, activo: false } : m));

describe("caso 15: unidadDeMarca (regla 20)", () => {
  const todas = marcas();
  it("ALFA JEANS → ALFA, ALFA KIDS → ALFA, BETA UNO → BETA, BETA DOS (inactiva) → BETA, GAMMA → GAMMA", () => {
    expect(unidadDeMarca(get(todas, "m-alfa-jeans"), todas)).toMatchObject({ unidad_marca_id: "m-alfa", en_conjunto: true });
    expect(unidadDeMarca(get(todas, "m-alfa-kids"), todas).unidad_marca_id).toBe("m-alfa");
    expect(unidadDeMarca(get(todas, "m-beta-uno"), todas).unidad_marca_id).toBe("m-beta");
    // La membresía de una marca desactivada sigue valiendo: su histórico se queda en el conjunto.
    expect(unidadDeMarca(get(todas, "m-beta-dos"), todas)).toMatchObject({ unidad_marca_id: "m-beta", en_conjunto: true });
    expect(unidadDeMarca(get(todas, "m-gamma"), todas)).toEqual({ unidad_marca_id: "m-gamma", en_conjunto: false, cabeza_inactiva: false, cadena: false });
  });
  it("una cabeza es su propia unidad", () => {
    expect(unidadDeMarca(get(todas, "m-alfa"), todas)).toMatchObject({ unidad_marca_id: "m-alfa", en_conjunto: false });
  });
  it("con ALFA desactivada, ALFA JEANS vuelve a ser ella misma con cabeza_inactiva", () => {
    const lista = sinAlfa();
    expect(unidadDeMarca(get(lista, "m-alfa-jeans"), lista)).toEqual({ unidad_marca_id: "m-alfa-jeans", en_conjunto: false, cabeza_inactiva: true, cadena: false });
  });
  it("una cadena (solo desde el SQL Editor) se resuelve un solo nivel con aviso cadena", () => {
    const lista = marcas().map((m) => (m.id === "m-gamma" ? { ...m, conjunto_marca_id: "m-alfa-jeans" } : m));
    expect(unidadDeMarca(get(lista, "m-gamma"), lista)).toEqual({ unidad_marca_id: "m-alfa-jeans", en_conjunto: true, cabeza_inactiva: false, cadena: true });
  });
  it("esCabeza = tiene al menos un miembro", () => {
    expect(esCabeza({ id: "m-alfa" }, todas)).toBe(true);
    expect(esCabeza({ id: "m-beta" }, todas)).toBe(true);
    expect(esCabeza({ id: "m-gamma" }, todas)).toBe(false);
    expect(esCabeza({ id: "m-alfa-jeans" }, todas)).toBe(false);
  });
  it("la asignación propia de ALFA KIDS no produce unidad de flujo (se prueba en la vista)", () => {
    expect(contarAsignaciones(estadoFixture()).get("m-alfa-kids")).toEqual({ asignados: 1, vigentes: 0 });
  });
});

describe("motivoRechazoConjunto (regla 21)", () => {
  const todas = marcas();
  const r = (marcaId: string, cabezaId: string | undefined, lista = todas) =>
    motivoRechazoConjunto(get(lista, marcaId), cabezaId ? lista.find((m) => m.id === cabezaId) : undefined, lista);

  it("cabeza inexistente → cabeza_no_encontrada (404)", () => {
    expect(r("m-gamma", undefined)).toMatchObject({ motivo: "cabeza_no_encontrada", status: 404 });
  });
  it("la marca como su propia cabeza → conjunto_propio (409)", () => {
    expect(r("m-alfa", "m-alfa")).toMatchObject({ motivo: "conjunto_propio", status: 409 });
  });
  it("cabeza inactiva → cabeza_inactiva (409)", () => {
    expect(r("m-gamma", "m-omega")).toMatchObject({ motivo: "cabeza_inactiva", status: 409 });
  });
  it("la cabeza es miembro de otro conjunto → cabeza_es_miembro (409, sin cadenas)", () => {
    const x = r("m-gamma", "m-alfa-jeans");
    expect(x).toMatchObject({ motivo: "cabeza_es_miembro", status: 409 });
    expect(x?.mensaje).toContain("ALFA");
  });
  it("la marca tiene miembros → marca_es_cabeza (409, quita primero sus miembros)", () => {
    const x = r("m-beta", "m-alfa");
    expect(x).toMatchObject({ motivo: "marca_es_cabeza", status: 409 });
    expect(x?.mensaje).toContain("con 2 marcas");
  });
  it("VARIOS, OTROS y SIN MARCA no entran ni sirven de cabeza → marca_generica (409)", () => {
    expect(r("m-varios", "m-alfa")?.motivo).toBe("marca_generica");
    expect(r("m-otros", "m-alfa")?.motivo).toBe("marca_generica");
    expect(r("m-sin-marca", "m-alfa")?.motivo).toBe("marca_generica");
    expect(r("m-gamma", "m-varios")?.motivo).toBe("marca_generica");
  });
  it("casos permitidos: marca suelta, desactivada (su histórico cuenta) y de otra agrupación", () => {
    expect(r("m-gamma", "m-alfa")).toBeNull();
    expect(r("m-omega", "m-alfa")).toBeNull();
    expect(r("m-alfa-jeans", "m-gamma")).toBeNull(); // cambiar de conjunto
    expect(get(todas, "m-gamma-sport").agrupacion_marca_id).not.toBe(get(todas, "m-alfa").agrupacion_marca_id);
    expect(r("m-gamma-sport", "m-alfa")).toBeNull(); // agrupación distinta: solo aviso
  });
  it("esMarcaGenerica por nombre normalizado", () => {
    expect(esMarcaGenerica(" varios ")).toBe(true);
    expect(esMarcaGenerica("Sin  Marca")).toBe(true);
    expect(esMarcaGenerica("VARIOS 2")).toBe(false);
  });
});

describe("avisosConjunto (regla 22)", () => {
  const paraAvisos = (lista: ReturnType<typeof marcas>, ids: string[], asignados: Record<string, number> = {}): MiembroParaAvisos[] =>
    ids.map((id) => ({ ...get(lista, id), gml_asignados: asignados[id] ?? 0 }));

  it("agrupacion_distinta por cada miembro cuya agrupación difiere de la cabeza", () => {
    const lista = marcas();
    const a = avisosConjunto(get(lista, "m-alfa"), paraAvisos(lista, ["m-alfa-jeans", "m-alfa-kids"]));
    expect(a.por_miembro.get("m-alfa-jeans")).toContain("agrupacion_distinta");
    expect(a.por_miembro.get("m-alfa-kids")).not.toContain("agrupacion_distinta");
    expect(a.conjunto).toEqual(["agrupacion_distinta"]);
  });
  it("config_propia_ignorada por cada miembro con casilla, modalidad o asignaciones propias", () => {
    const lista = marcas();
    const a = avisosConjunto(get(lista, "m-alfa"), paraAvisos(lista, ["m-alfa-jeans", "m-alfa-kids"], { "m-alfa-kids": 1 }));
    expect(a.por_miembro.get("m-alfa-kids")).toEqual(["config_propia_ignorada"]);
    expect(a.por_miembro.get("m-alfa-jeans")).toEqual(["agrupacion_distinta"]);
    // Las asignaciones propias bastan aunque no tenga casilla.
    const b = avisosConjunto(get(lista, "m-beta"), paraAvisos(lista, ["m-beta-uno"], { "m-beta-uno": 2 }));
    expect(b.por_miembro.get("m-beta-uno")).toContain("config_propia_ignorada");
  });
  it("cabeza_inactiva en el conjunto y en cada miembro; entonces la config propia ya no está ignorada", () => {
    const lista = sinAlfa();
    const a = avisosConjunto(get(lista, "m-alfa"), paraAvisos(lista, ["m-alfa-jeans", "m-alfa-kids"], { "m-alfa-kids": 1 }));
    expect(a.conjunto).toContain("cabeza_inactiva");
    expect(a.por_miembro.get("m-alfa-kids")).toEqual(["cabeza_inactiva"]);
  });
  it("cadena cuando la cabeza es a su vez miembro", () => {
    const lista = marcas();
    const a = avisosConjunto({ ...get(lista, "m-alfa-jeans") }, paraAvisos(lista, ["m-gamma"]));
    expect(a.conjunto).toContain("cadena");
    expect(a.por_miembro.get("m-gamma")).toContain("cadena");
  });
  it("un conjunto sin nada raro no tiene avisos", () => {
    const lista = marcas();
    expect(avisosConjunto(get(lista, "m-beta"), paraAvisos(lista, ["m-beta-uno"])).conjunto).toEqual([]);
  });
});

describe("armarVistaConjuntos y resumen consistente (regla 22)", () => {
  const estado = estadoFixture();
  const vista = armarVistaConjuntos(
    estado.marcas.map((m) => ({ ...m, codigo: m.codigo ?? "" })),
    AGRUPACIONES.map((a) => ({ id: a.id, nombre: a.nombre })),
    contarAsignaciones(estado),
    new Set(["m-alfa"])
  );

  it("una fila por cabeza con al menos un miembro, por nombre", () => {
    expect(vista.conjuntos.map((c) => c.cabeza.nombre)).toEqual(["ALFA", "BETA"]);
    const alfa = vista.conjuntos[0];
    expect(alfa.cabeza).toMatchObject({ id: "m-alfa", activo: true, tratamiento_especial: true, modalidad_efectiva: "por_gml", gml_vigentes: 3, vende: true });
    expect(alfa.cabeza.agrupacion_marca).toEqual({ id: "ag-rec", nombre: "RECONOCIDO" });
    expect(alfa.efectivo).toBe(true);
    expect(alfa.avisos).toEqual(["agrupacion_distinta"]);
    expect(alfa.miembros.map((m) => m.nombre)).toEqual(["ALFA JEANS", "ALFA KIDS"]);
    expect(alfa.miembros[0]).toMatchObject({ agrupacion_marca: { nombre: "VALOR" }, avisos: ["agrupacion_distinta"] });
    expect(alfa.miembros[1].avisos).toEqual(["config_propia_ignorada"]);
  });
  it("BETA: miembro desactivado sigue en el conjunto y la cabeza no vende (cabeza al barrer)", () => {
    const beta = vista.conjuntos[1];
    expect(beta.cabeza).toMatchObject({ modalidad_efectiva: "barrido", vende: false, gml_vigentes: 0 });
    expect(beta.miembros.map((m) => [m.nombre, m.activo])).toEqual([["BETA DOS", false], ["BETA UNO", true]]);
    expect(beta.miembros[0].agrupacion_marca.nombre).toBe("MID VALUE");
    expect(beta.avisos).toEqual(["agrupacion_distinta"]);
  });
  it("resumen: marcas_en_conjunto = Σ miembros y conjuntos = cabezas con miembros", () => {
    expect(vista.resumen).toEqual({
      conjuntos: 2,
      marcas_en_conjunto: 4,
      cabezas_inactivas: 0,
      con_agrupacion_distinta: 2,
      miembros_con_config_propia: 1,
      cadenas: 0,
    });
    expect(resumenConjuntos(vista.conjuntos)).toEqual(vista.resumen);
  });
  it("caso 17: con ALFA desactivada el conjunto sigue listado, deja de ser efectivo y avisa", () => {
    const e = estadoFixture({ marcas: sinAlfa() });
    const v = armarVistaConjuntos(e.marcas.map((m) => ({ ...m, codigo: m.codigo ?? "" })), AGRUPACIONES.map((a) => ({ id: a.id, nombre: a.nombre })), contarAsignaciones(e), new Set());
    const alfa = v.conjuntos[0];
    expect(alfa).toMatchObject({ efectivo: false });
    expect(alfa.avisos).toContain("cabeza_inactiva");
    expect(alfa.miembros.every((m) => m.avisos.includes("cabeza_inactiva"))).toBe(true);
    expect(v.resumen.cabezas_inactivas).toBe(1);
  });
});

describe("caso 18: bloque de miembros ALFA ← [GAMMA, BETA UNO, VARIOS, ALFA, OMEGA, BETA]", () => {
  const ids = ["m-gamma", "m-beta-uno", "m-varios", "m-alfa", "m-omega", "m-beta"];
  const plan = planificarMiembrosBloque("m-alfa", "asignar", ids, marcas());

  it("GAMMA, BETA UNO (de BETA) y OMEGA (inactiva) se asignan; VARIOS, ALFA y BETA no", () => {
    expect(plan.reporte.asignadas).toBe(3);
    expect(plan.ids_a_escribir).toEqual(["m-gamma", "m-beta-uno", "m-omega"]);
    expect(plan.reporte.no_permitidas).toEqual([
      { marca_id: "m-varios", marca: "VARIOS", motivo: "marca_generica" },
      { marca_id: "m-alfa", marca: "ALFA", motivo: "conjunto_propio" },
      { marca_id: "m-beta", marca: "BETA", motivo: "marca_es_cabeza" },
    ]);
    expect(plan.reporte.cambiadas_de_conjunto).toEqual([{ marca_id: "m-beta-uno", marca: "BETA UNO", de_conjunto_id: "m-beta", de: "BETA" }]);
  });
  it("3 + 0 + 0 + 3 = 6 y repetir → asignadas = 0", () => {
    const r = plan.reporte;
    expect(r.asignadas + r.quitadas + r.sin_cambio + r.no_permitidas.length).toBe(6);
    const despues = aplicarMiembrosEnMemoria(marcas(), "m-alfa", "asignar", plan.ids_a_escribir);
    const otra = planificarMiembrosBloque("m-alfa", "asignar", ids, despues);
    expect(otra.reporte.asignadas).toBe(0);
    expect(otra.reporte.sin_cambio).toBe(3);
    expect(otra.reporte.no_permitidas).toHaveLength(3);
    expect(otra.reporte.cambiadas_de_conjunto).toEqual([]);
  });
  it("deduplica los ids", () => {
    const p = planificarMiembrosBloque("m-alfa", "asignar", ["m-gamma", "m-gamma", "m-gamma"], marcas());
    expect(p.reporte.asignadas).toBe(1);
  });
  it("quitar: miembro → quitadas, no miembro → sin_cambio; siempre se permite", () => {
    const p = planificarMiembrosBloque("m-alfa", "quitar", ["m-alfa-jeans", "m-gamma", "m-omega", "fantasma"], marcas());
    expect(p.reporte).toMatchObject({ quitadas: 1, sin_cambio: 2, asignadas: 0 });
    expect(p.reporte.no_permitidas).toEqual([{ marca_id: "fantasma", marca: "", motivo: "marca_no_encontrada" }]);
    expect(p.ids_a_escribir).toEqual(["m-alfa-jeans"]);
    const despues = aplicarMiembrosEnMemoria(marcas(), "m-alfa", "quitar", p.ids_a_escribir);
    expect(planificarMiembrosBloque("m-alfa", "quitar", ["m-alfa-jeans"], despues).reporte.quitadas).toBe(0);
  });
  it("quitar del conjunto devuelve a la marca su configuración propia (vuelve a ser su propia unidad)", () => {
    const despues = aplicarMiembrosEnMemoria(marcas(), "m-alfa", "quitar", ["m-alfa-kids"]);
    expect(unidadDeMarca(get(despues, "m-alfa-kids"), despues).unidad_marca_id).toBe("m-alfa-kids");
  });
  it("una cabeza inexistente rechaza a todas (la API responde 404 antes)", () => {
    const p = planificarMiembrosBloque("no-existe", "asignar", ["m-gamma"], marcas());
    expect(p.reporte.no_permitidas).toEqual([{ marca_id: "m-gamma", marca: "GAMMA", motivo: "cabeza_no_encontrada" }]);
  });
  it("no muta las marcas recibidas", () => {
    const lista = marcas();
    const copia = JSON.stringify(lista);
    aplicarMiembrosEnMemoria(lista, "m-alfa", "asignar", ["m-gamma"]);
    planificarMiembrosBloque("m-alfa", "asignar", ids, lista);
    expect(JSON.stringify(lista)).toBe(copia);
  });
});

describe("caso 22: eliminar ALFA con miembros", () => {
  it("es cabeza con 2 miembros (el handler responde 409) y, sin ellos, ya no lo es", () => {
    const lista = marcas();
    expect(esCabeza({ id: "m-alfa" }, lista)).toBe(true);
    const sinMiembros = aplicarMiembrosEnMemoria(lista, "m-alfa", "quitar", ["m-alfa-jeans", "m-alfa-kids"]);
    expect(esCabeza({ id: "m-alfa" }, sinMiembros)).toBe(false);
    expect(contarAsignaciones(estadoFixture({ marcas: sinMiembros })).get("m-alfa")?.asignados).toBe(3);
  });
});
