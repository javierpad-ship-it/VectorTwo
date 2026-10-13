import { describe, expect, it } from "vitest";
import { armarVigentes, armarVistaGml, contarAsignaciones, describirAsignacion, unidadesFlujoEspecial, type EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { motivoIgnorada, motivoPendiente } from "@/lib/marcas/gml/reglas";
import { unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import { arbolFixture, asignacionesFixture, estadoFixture, indiceFixture, AGR } from "./marcas.gml.fixture";

/** Reglas 9 a 11 y casos 1, 3, 4, 5, 13, 14 y 15 de 02b. */

const nombres = (v: ReturnType<typeof armarVistaGml>) => v.marcas.map((m) => m.nombre);
const marca = (v: ReturnType<typeof armarVistaGml>, nombre: string) => {
  const m = v.marcas.find((x) => x.nombre === nombre);
  if (!m) throw new Error(`falta ${nombre}`);
  return m;
};
const conAlfa = (cambio: Record<string, unknown>): EstadoVistaGml => {
  const e = estadoFixture();
  return { ...e, marcas: e.marcas.map((m) => (m.id === "m-alfa" ? { ...m, ...cambio } : m)) };
};
const conTernoInactivo = (): EstadoVistaGml => {
  const arbol = arbolFixture();
  arbol.lineas = arbol.lineas.map((l) => (l.id === "l-terno" ? { ...l, activo: false } : l));
  return estadoFixture({ nodos: indiceFixture(arbol) });
};

describe("caso 1: vista base", () => {
  const v = armarVistaGml(estadoFixture());

  it("ALFA tiene 3 GML vigentes; BETA es barrido; DELTA queda pendiente sin_gml", () => {
    const alfa = marca(v, "ALFA");
    expect(alfa.gml).toHaveLength(3);
    expect(alfa.gml.every((g) => g.vigente && g.motivo_ignorada === null)).toBe(true);
    expect(alfa.pendiente).toBe(false);
    expect(marca(v, "BETA").modalidad_efectiva).toBe("barrido");
    expect(marca(v, "BETA").gml).toEqual([]);
    expect(marca(v, "DELTA")).toMatchObject({ pendiente: true, motivo_pendiente: "sin_gml", modalidad_efectiva: "por_gml" });
  });
  it("ÉPSILON (casilla sin modalidad) se lee barrido y queda como sin_modalidad", () => {
    expect(marca(v, "ÉPSILON")).toMatchObject({
      modalidad_tratamiento: null,
      modalidad_efectiva: "barrido",
      pendiente: true,
      motivo_pendiente: "sin_modalidad",
    });
  });
  it("el resumen del caso 1", () => {
    expect(v.resumen).toEqual({
      marcadas: 4,
      por_gml: 2,
      barrido: 1,
      sin_modalidad: 1,
      asignaciones: 4,
      asignaciones_vigentes: 3,
      asignaciones_ignoradas: 1,
      pendientes_sin_gml: 1,
      nodos_con_relevantes: 3,
      nodos_con_mas_de_4_por_agrupacion: 0,
    });
  });
  it("lista las marcas marcadas o con GML conservados, por nombre; las inactivas solo con el interruptor", () => {
    expect(nombres(v)).toEqual(["ALFA", "ALFA KIDS", "BETA", "DELTA", "ÉPSILON"]);
    const e = estadoFixture();
    const conOmega = {
      ...e,
      asignaciones: [...e.asignaciones, { id: "a9", marca_id: "m-omega", genero_mundo_linea_id: "n1", nota: null, activo: true, created_at: "" }],
    };
    expect(nombres(armarVistaGml(conOmega))).not.toContain("OMEGA");
    expect(nombres(armarVistaGml(conOmega, { incluirInactivas: true }))).toContain("OMEGA");
    expect(marca(armarVistaGml(conOmega, { incluirInactivas: true }), "OMEGA").gml[0].motivo_ignorada).toBe("marca_sin_tratamiento");
  });
  it("trae el conjunto de cada marca y los nombres de sus miembros", () => {
    expect(marca(v, "ALFA").miembros).toEqual(["ALFA JEANS", "ALFA KIDS"]);
    expect(marca(v, "ALFA KIDS").conjunto).toEqual({ id: "m-alfa", nombre: "ALFA" });
    expect(marca(v, "BETA").miembros).toEqual(["BETA DOS", "BETA UNO"]);
  });
});

describe("regla 10: vigencia, motivos y vista inversa", () => {
  it("la asignación propia de ALFA KIDS sale en_conjunto aunque la marca esté marcada (caso 15)", () => {
    const kids = marca(armarVistaGml(estadoFixture()), "ALFA KIDS");
    expect(kids.gml).toHaveLength(1);
    expect(kids.gml[0]).toMatchObject({ vigente: false, motivo_ignorada: "en_conjunto", detalle: "cuenta como ALFA" });
    expect(kids.pendiente).toBe(false);
  });
  it("prioridad en_conjunto > marca_sin_tratamiento > marca_no_vigente > marca_en_barrido > gml_no_vigente", () => {
    const e = estadoFixture();
    const kids = e.marcas.find((m) => m.id === "m-alfa-kids")!;
    const nodo1 = e.nodos.get("n1")!;
    const unidadKids = unidadDeMarca(kids, e.marcas);
    expect(motivoIgnorada({ ...kids, tratamiento_especial: false }, e.agrupaciones[0], unidadKids, nodo1, "ALFA")?.motivo).toBe("en_conjunto");
    const alfa = e.marcas.find((m) => m.id === "m-alfa")!;
    const unidad = unidadDeMarca(alfa, e.marcas);
    const nodoMuerto = { ...nodo1, vigente: false, motivo_no_vigente: "línea X inactiva" };
    const inactiva = { id: "x", nombre: "X", activo: false };
    expect(motivoIgnorada({ ...alfa, tratamiento_especial: false, activo: false, modalidad_tratamiento: "barrido" }, inactiva, unidad, nodoMuerto)?.motivo).toBe("marca_sin_tratamiento");
    expect(motivoIgnorada({ ...alfa, activo: false, modalidad_tratamiento: "barrido" }, e.agrupaciones[0], unidad, nodoMuerto)?.motivo).toBe("marca_no_vigente");
    expect(motivoIgnorada({ ...alfa, modalidad_tratamiento: "barrido" }, e.agrupaciones[0], unidad, nodoMuerto)?.motivo).toBe("marca_en_barrido");
    expect(motivoIgnorada(alfa, e.agrupaciones[0], unidad, nodoMuerto)).toEqual({ motivo: "gml_no_vigente", detalle: "línea X inactiva" });
    expect(motivoIgnorada(alfa, e.agrupaciones[0], unidad, nodo1)).toBeNull();
  });
  it("por_nodo trae exactamente los nodos con alguna asignación, agrupadas por agrupación, cada marca una vez", () => {
    const v = armarVistaGml(estadoFixture());
    expect(v.por_nodo.map((n) => n.genero_mundo_linea_id).sort()).toEqual(["n1", "n2", "n3"]);
    const n3 = v.por_nodo.find((n) => n.genero_mundo_linea_id === "n3")!;
    expect(n3.relevantes_vigentes).toBe(1);
    expect(n3.agrupaciones).toHaveLength(1);
    expect(n3.agrupaciones[0]).toMatchObject({ agrupacion_marca_id: AGR.rec, nombre: "RECONOCIDO" });
    expect(n3.agrupaciones[0].marcas).toEqual([
      { marca_id: "m-alfa", nombre: "ALFA", vigente: true },
      { marca_id: "m-alfa-kids", nombre: "ALFA KIDS", vigente: false },
    ]);
    const n2 = v.por_nodo.find((n) => n.genero_mundo_linea_id === "n2")!;
    expect(n2.nivel_planificacion).toBe("GMLE");
  });
  it("el resumen es consistente: marcadas = por_gml + barrido + sin_modalidad y asignaciones = vigentes + ignoradas", () => {
    for (const estado of [estadoFixture(), conAlfa({ modalidad_tratamiento: "barrido" }), conTernoInactivo()]) {
      const { resumen } = armarVistaGml(estado);
      expect(resumen.marcadas).toBe(resumen.por_gml + resumen.barrido + resumen.sin_modalidad);
      expect(resumen.asignaciones).toBe(resumen.asignaciones_vigentes + resumen.asignaciones_ignoradas);
    }
  });
  it("filtra por marca o por nodo sin alterar el resumen global", () => {
    const todo = armarVistaGml(estadoFixture());
    const porMarca = armarVistaGml(estadoFixture(), { marcaId: "m-beta" });
    expect(nombres(porMarca)).toEqual(["BETA"]);
    expect(porMarca.resumen).toEqual(todo.resumen);
    const porNodo = armarVistaGml(estadoFixture(), { nodoId: "n3" });
    expect(porNodo.por_nodo.map((n) => n.genero_mundo_linea_id)).toEqual(["n3"]);
    expect(nombres(porNodo)).toEqual(["ALFA", "ALFA KIDS"]);
    expect(porNodo.marcas[0].gml.map((g) => g.genero_mundo_linea_id)).toEqual(["n3"]);
  });
  it("las asignaciones con activo = false se leen como ausentes", () => {
    const e = estadoFixture();
    const v = armarVistaGml({ ...e, asignaciones: e.asignaciones.map((a) => (a.id === "a1" ? { ...a, activo: false } : a)) });
    expect(marca(v, "ALFA").gml).toHaveLength(2);
  });
  it("aviso suave: más de 4 relevantes vigentes en una agrupación de un GML", () => {
    const e = estadoFixture();
    const extra = ["x1", "x2", "x3", "x4"].map((id) => ({ id: `m-${id}`, nombre: id.toUpperCase(), codigo: id, agrupacion_marca_id: AGR.rec, activo: true, tratamiento_especial: true, modalidad_tratamiento: "por_gml", conjunto_marca_id: null }));
    const asign = extra.map((m) => ({ id: `a-${m.id}`, marca_id: m.id, genero_mundo_linea_id: "n1", nota: null, activo: true, created_at: "" }));
    const v = armarVistaGml({ ...e, marcas: [...e.marcas, ...extra], asignaciones: [...e.asignaciones, ...asign] });
    expect(v.resumen.nodos_con_mas_de_4_por_agrupacion).toBe(1);
  });
});

describe("casos 3, 4 y 5: efectos sobre las asignaciones", () => {
  it("caso 3: TERNO inactiva → ALFA→N3 gml_no_vigente con el padre; reactivar la devuelve", () => {
    const alfa = marca(armarVistaGml(conTernoInactivo()), "ALFA");
    const n3 = alfa.gml.find((g) => g.genero_mundo_linea_id === "n3");
    expect(n3).toMatchObject({ vigente: false, motivo_ignorada: "gml_no_vigente", detalle: "línea TERNO inactiva" });
    expect(alfa.gml.filter((g) => g.vigente)).toHaveLength(2);
    expect(marca(armarVistaGml(estadoFixture()), "ALFA").gml.every((g) => g.vigente)).toBe(true);
  });
  it("caso 4: ALFA a barrido → sus 3 pares quedan marca_en_barrido; volver a por_gml los restaura", () => {
    const alfa = marca(armarVistaGml(conAlfa({ modalidad_tratamiento: "barrido" })), "ALFA");
    expect(alfa.gml.map((g) => g.motivo_ignorada)).toEqual(["marca_en_barrido", "marca_en_barrido", "marca_en_barrido"]);
    expect(alfa.pendiente).toBe(false);
    expect(marca(armarVistaGml(conAlfa({ modalidad_tratamiento: "por_gml" })), "ALFA").gml.every((g) => g.vigente)).toBe(true);
  });
  it("caso 5: desmarcar ALFA conserva los pares como marca_sin_tratamiento", () => {
    const v = armarVistaGml(conAlfa({ tratamiento_especial: false, modalidad_tratamiento: null, nota_tratamiento: null }));
    const alfa = marca(v, "ALFA");
    expect(alfa.gml).toHaveLength(3);
    expect(alfa.gml.every((g) => g.motivo_ignorada === "marca_sin_tratamiento")).toBe(true);
    expect(alfa.modalidad_efectiva).toBeNull();
    expect(v.resumen.marcadas).toBe(3);
  });
});

describe("regla 9: motivoPendiente", () => {
  const e = estadoFixture();
  const m = (id: string) => e.marcas.find((x) => x.id === id)!;
  const rec = e.agrupaciones[0];
  it("marcada, vigente, por_gml y sin GML vigentes → sin_gml", () => {
    expect(motivoPendiente(m("m-delta"), rec, 0)).toBe("sin_gml");
    expect(motivoPendiente(m("m-delta"), rec, 1)).toBeNull();
  });
  it("marcada con modalidad nula → sin_modalidad; marcada no vigente → marca_no_vigente", () => {
    expect(motivoPendiente(m("m-epsilon"), e.agrupaciones[1], 0)).toBe("sin_modalidad");
    expect(motivoPendiente({ ...m("m-delta"), activo: false }, rec, 0)).toBe("marca_no_vigente");
    expect(motivoPendiente(m("m-delta"), { ...rec, activo: false }, 0)).toBe("marca_no_vigente");
  });
  it("barrido nunca es pendiente, ni una marca sin casilla ni un miembro de un conjunto efectivo", () => {
    expect(motivoPendiente(m("m-beta"), e.agrupaciones[1], 0)).toBeNull();
    expect(motivoPendiente(m("m-gamma"), rec, 0)).toBeNull();
    expect(motivoPendiente(m("m-delta"), rec, 0, true)).toBeNull();
  });
});

describe("agrupación inactiva", () => {
  it("la asignación se acepta pero nace ignorada como marca_no_vigente", () => {
    const e = estadoFixture();
    const estado = { ...e, agrupaciones: e.agrupaciones.map((g) => (g.id === AGR.rec ? { ...g, activo: false } : g)) };
    const alfa = marca(armarVistaGml(estado), "ALFA");
    expect(alfa.vigente).toBe(false);
    expect(alfa.gml.every((g) => g.motivo_ignorada === "marca_no_vigente")).toBe(true);
    expect(alfa.motivo_pendiente).toBe("marca_no_vigente");
    expect(unidadesFlujoEspecial(estado).unidades.some((u) => u.marca_id === "m-alfa")).toBe(false);
  });
});

describe("caso 13: eliminar una marca se lleva sus GML", () => {
  it("GAMMA no tiene ninguno (gml_eliminados = 0) y ALFA tiene 3", () => {
    const conteo = contarAsignaciones(estadoFixture());
    expect(conteo.get("m-gamma")).toEqual({ asignados: 0, vigentes: 0 });
    expect(conteo.get("m-alfa")).toEqual({ asignados: 3, vigentes: 3 });
    expect(conteo.get("m-alfa-kids")).toEqual({ asignados: 1, vigentes: 0 });
  });
});

/** Port independiente de la vista SQL de vigentes (los mismos joins y filtros que `0010`). */
function vistaSql(estado: EstadoVistaGml) {
  const marcas = estado.marcas;
  const agr = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const esUnidad = (id: string) => {
    const m = marcas.find((x) => x.id === id)!;
    const c = m.conjunto_marca_id ? marcas.find((x) => x.id === m.conjunto_marca_id) : undefined;
    const unidad = c && c.activo ? c.id : m.id;
    return unidad === m.id;
  };
  const barrido = marcas
    .filter((m) => esUnidad(m.id) && m.activo && agr.get(m.agrupacion_marca_id)?.activo && m.tratamiento_especial && (m.modalidad_tratamiento ?? "barrido") === "barrido")
    .map((m) => ({ marca_id: m.id, agrupacion_marca_id: m.agrupacion_marca_id, modalidad: "barrido", genero_mundo_linea_id: null as string | null }));
  const porGml = estado.asignaciones
    .filter((a) => a.activo)
    .flatMap((a) => {
      const m = marcas.find((x) => x.id === a.marca_id)!;
      const n = estado.nodos.get(a.genero_mundo_linea_id)!;
      const ok = esUnidad(m.id) && m.activo && agr.get(m.agrupacion_marca_id)?.activo && m.tratamiento_especial && m.modalidad_tratamiento === "por_gml" && n.vigente;
      return ok ? [{ marca_id: m.id, agrupacion_marca_id: m.agrupacion_marca_id, modalidad: "por_gml", genero_mundo_linea_id: n.id as string | null }] : [];
    });
  return [...barrido, ...porGml];
}
const ordenar = <T extends { marca_id: string; genero_mundo_linea_id: string | null }>(xs: T[]) =>
  [...xs].sort((a, b) => `${a.marca_id}|${a.genero_mundo_linea_id}`.localeCompare(`${b.marca_id}|${b.genero_mundo_linea_id}`));

describe("caso 14: la vista SQL coincide con unidadesFlujoEspecial", () => {
  for (const [nombre, estado] of [
    ["caso 1 (base)", estadoFixture()],
    ["caso 3 (TERNO inactiva)", conTernoInactivo()],
    ["caso 4 (ALFA a barrido)", conAlfa({ modalidad_tratamiento: "barrido" })],
    ["cabeza inactiva (caso 17)", conAlfa({ activo: false })],
    ["ALFA desmarcada (caso 5)", conAlfa({ tratamiento_especial: false, modalidad_tratamiento: null })],
  ] as const) {
    it(nombre, () => {
      expect(ordenar(unidadesFlujoEspecial(estado).unidades)).toEqual(ordenar(vistaSql(estado)));
    });
  }
  it("base: ALFA×3 por_gml, BETA y ÉPSILON al barrer; DELTA no aparece y va a pendientes; un miembro nunca produce unidades", () => {
    const { unidades, pendientes } = unidadesFlujoEspecial(estadoFixture());
    expect(unidades.filter((u) => u.marca_id === "m-alfa" && u.modalidad === "por_gml")).toHaveLength(3);
    expect(unidades.filter((u) => u.modalidad === "barrido").map((u) => u.marca_id).sort()).toEqual(["m-beta", "m-epsilon"]);
    expect(unidades.some((u) => u.marca_id === "m-delta")).toBe(false);
    expect(unidades.some((u) => u.marca_id === "m-alfa-kids")).toBe(false);
    expect(pendientes).toEqual([
      { marca_id: "m-delta", marca: "DELTA", motivo: "sin_gml" },
      { marca_id: "m-epsilon", marca: "ÉPSILON", motivo: "sin_modalidad" },
    ]);
  });
  it("desactivar DENIM saca los pares de ALFA en N1 y N2 (caso 18 de SQL)", () => {
    const arbol = arbolFixture();
    arbol.lineas = arbol.lineas.map((l) => (l.id === "l-denim" ? { ...l, activo: false } : l));
    const { unidades } = unidadesFlujoEspecial(estadoFixture({ nodos: indiceFixture(arbol) }));
    expect(unidades.filter((u) => u.marca_id === "m-alfa").map((u) => u.genero_mundo_linea_id)).toEqual(["n3"]);
  });
});

describe("armarVigentes: lo que consumen M7 y M8", () => {
  const v = armarVigentes(estadoFixture(), "2026-10-13T00:00:00.000Z");

  it("los GML vigentes con sus relevantes por agrupación (y los miembros de cada una)", () => {
    // Orden de pantalla: género, mundo y línea (HOMBRE · FORMAL · TERNO antes que HOMBRE · URBANO · DENIM).
    expect(v.gml.map((g) => g.genero_mundo_linea_id)).toEqual(["n3", "n1", "n2"]);
    const n1 = v.gml.find((g) => g.genero_mundo_linea_id === "n1")!;
    expect(n1).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", nivel_planificacion: "GML" });
    expect(n1.agrupaciones).toEqual([
      {
        agrupacion_marca_id: AGR.rec,
        agrupacion: "RECONOCIDO",
        relevantes: [{ marca_id: "m-alfa", marca: "ALFA", miembros: ["ALFA JEANS", "ALFA KIDS"] }],
      },
    ]);
  });
  it("las marcas al barrer (BETA con sus miembros; ÉPSILON, sin modalidad, también), el mapa de unidades y las pendientes", () => {
    expect(v.barrido.map((b) => b.marca)).toEqual(["BETA", "ÉPSILON"]);
    expect(v.barrido[0]).toMatchObject({ marca_id: "m-beta", agrupacion: "PREMIUM", miembros: ["BETA DOS", "BETA UNO"] });
    expect(v.unidades.map((x) => x.marca_id).sort()).toEqual(["m-alfa-jeans", "m-alfa-kids", "m-beta-dos", "m-beta-uno"]);
    expect(v.unidades.every((x) => ["m-alfa", "m-beta"].includes(x.unidad_marca_id))).toBe(true);
    expect(v.pendientes.map((p) => `${p.marca}:${p.motivo}`)).toEqual(["DELTA:sin_gml", "ÉPSILON:sin_modalidad"]);
    expect(v.nodos_gmle).toBe(1);
    expect(v.calculado_at).toBe("2026-10-13T00:00:00.000Z");
  });
  it("un GML no vigente no aparece", () => {
    const sinTerno = armarVigentes(conTernoInactivo(), "x");
    expect(sinTerno.gml.map((g) => g.genero_mundo_linea_id)).not.toContain("n3");
  });
});

describe("describirAsignacion", () => {
  it("considera la marca ya marcada por_gml (la respuesta de POST tras asignar)", () => {
    const e = estadoFixture();
    const gamma = e.marcas.find((m) => m.id === "m-gamma")!;
    const fila = { id: "a-nueva", marca_id: "m-gamma", genero_mundo_linea_id: "n1", nota: null, activo: true, created_at: "x" };
    expect(describirAsignacion(fila, gamma, e)).toMatchObject({ vigente: false, motivo_ignorada: "marca_sin_tratamiento" });
    expect(describirAsignacion(fila, { ...gamma, tratamiento_especial: true, modalidad_tratamiento: "por_gml" }, e)).toMatchObject({
      vigente: true,
      motivo_ignorada: null,
      genero: "HOMBRE",
      linea: "DENIM",
    });
    expect(describirAsignacion({ ...fila, genero_mundo_linea_id: "no" }, gamma, e)).toBeUndefined();
  });
  it("las asignaciones del fixture no se mutan", () => {
    const antes = JSON.stringify(asignacionesFixture());
    armarVistaGml(estadoFixture());
    expect(JSON.stringify(asignacionesFixture())).toBe(antes);
  });
});
