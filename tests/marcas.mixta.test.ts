import { describe, expect, it } from "vitest";
import { claveFlujo, construirConfigFlujo, textoClaveFlujo } from "@/lib/marcas/gml/flujo";
import { aplicarPlanAsignacion, planificarAsignacionBloque, type CuerpoAsignacion } from "@/lib/marcas/gml/asignar";
import { cambioMarca, motivoIgnorada, motivoPendiente, requiereModalidadDestino, type MarcaGml } from "@/lib/marcas/gml/reglas";
import { armarVigentes, armarVistaGml, contarAsignaciones, unidadesFlujoEspecial, type EstadoVistaGml } from "@/lib/marcas/gml/vista";
import { asignarGmlSchema, crearGmlEspecialSchema } from "@/lib/marcas/gml/esquemas";
import { modalidadEfectiva } from "@/lib/marcas/reglas";
import { armarFilasMarcas, type MarcaLeida } from "@/lib/marcas/filas";
import { aplicarPlanMarcas, leerTratamientoMarca, planificarImportacionMarcas, type EstadoImportacionMarcas } from "@/lib/marcas/importar";
import { unidadDeMarca } from "@/lib/marcas/conjuntos/reglas";
import { AGR, EQUIVALENCIAS, HECHOS_TODOS, asignacionesFixture, estadoFixture } from "./marcas.gml.fixture";

/**
 * M12 · modalidad `mixta` (ficha 12, 6.1 y 6.2, reglas 13 y 14 de 8): `por_gml` + `resto_al_barrer`. Una mixta tiene GML
 * específicos (entran al flujo de ese GML) y el resto de su venta va al flujo al barrer, no a "otras".
 */

/** GAMMA mixta (RECONOCIDO) relevante solo en N3; el resto del fixture, igual. */
function conGammaMixta(): EstadoVistaGml {
  const base = estadoFixture();
  return {
    ...base,
    marcas: base.marcas.map((m) =>
      m.id === "m-gamma" ? { ...m, tratamiento_especial: true, modalidad_tratamiento: "por_gml", resto_al_barrer: true } : m
    ),
    asignaciones: [
      ...asignacionesFixture(),
      { id: "a-g1", marca_id: "m-gamma", genero_mundo_linea_id: "n3", nota: null, activo: true, created_at: "2026-10-12T00:00:00Z" },
    ],
  };
}
const gamma = (e: EstadoVistaGml) => e.marcas.find((m) => m.id === "m-gamma") as MarcaGml;

describe("modalidad efectiva (regla 13)", () => {
  it("GAMMA con la bandera es mixta; sin ella, por_gml; sin casilla, null", () => {
    const e = conGammaMixta();
    expect(modalidadEfectiva(gamma(e))).toBe("mixta");
    expect(modalidadEfectiva({ ...gamma(e), resto_al_barrer: false })).toBe("por_gml");
    expect(modalidadEfectiva({ ...gamma(e), tratamiento_especial: false })).toBeNull();
  });
  it("la fila de /api/marcas lleva modalidad_efectiva = mixta y conserva la columna cruda por_gml", () => {
    const e = conGammaMixta();
    const marcas = e.marcas.map((m) => ({ ...m, resto_al_barrer: m.id === "m-gamma", agrupacion_marca: null, created_at: "", updated_at: "" })) as unknown as MarcaLeida[];
    const filas = armarFilasMarcas(marcas, marcas, contarAsignaciones(e));
    const g = filas.find((f) => f.id === "m-gamma");
    expect(g?.modalidad_efectiva).toBe("mixta");
    expect(g?.modalidad_tratamiento).toBe("por_gml");
    expect(g?.gml_vigentes).toBe(1);
  });
});

describe("cambioMarca con modalidad destino (regla 13)", () => {
  const e = estadoFixture();
  const beta = e.marcas.find((m) => m.id === "m-beta") as MarcaGml;
  const epsilon = e.marcas.find((m) => m.id === "m-epsilon") as MarcaGml;
  const alfa = e.marcas.find((m) => m.id === "m-alfa") as MarcaGml;
  const sin = e.marcas.find((m) => m.id === "m-delta") as MarcaGml;

  it("barrido con destino mixta → { de: barrido, a: mixta }; con por_gml → por_gml", () => {
    expect(cambioMarca(beta, "mixta")).toEqual({ de: "barrido", a: "mixta" });
    expect(cambioMarca(beta, "por_gml")).toEqual({ de: "barrido", a: "por_gml" });
    expect(cambioMarca(epsilon, "mixta")).toEqual({ de: "sin_modalidad", a: "mixta" });
  });
  it("sin casilla pasa siempre a por_gml; por_gml o mixta no cambian", () => {
    expect(cambioMarca({ ...beta, tratamiento_especial: false }, "mixta")).toEqual({ de: "sin_tratamiento", a: "por_gml" });
    expect(cambioMarca(alfa, "mixta")).toBeNull();
    expect(cambioMarca(sin)).toBeNull();
    expect(cambioMarca(gamma(conGammaMixta()), "por_gml")).toBeNull();
  });
  it("solo exigen destino las marcas al barrer o marcadas sin modalidad", () => {
    expect(requiereModalidadDestino(cambioMarca(beta))).toBe(true);
    expect(requiereModalidadDestino(cambioMarca(epsilon))).toBe(true);
    expect(requiereModalidadDestino(cambioMarca({ ...beta, tratamiento_especial: false }))).toBe(false);
    expect(requiereModalidadDestino(cambioMarca(alfa))).toBe(false);
  });
});

describe("asignar el primer GML a una marca al barrer (regla 13, caso 8)", () => {
  const e = estadoFixture();
  const estado = { marcas: e.marcas, nodos: e.nodos, asignaciones: e.asignaciones };
  const cuerpo = (extra: Partial<CuerpoAsignacion> = {}): CuerpoAsignacion =>
    ({ forma: "cartesiano", accion: "asignar", marca_ids: ["m-beta", "m-gamma"], nodo_ids: ["n1"], nota: null, ...extra }) as CuerpoAsignacion;

  it("sin modalidad_destino el plan marca a BETA en requieren_destino (el handler responde 409 modalidad_destino_requerida)", () => {
    const plan = planificarAsignacionBloque(cuerpo(), estado);
    expect(plan.requieren_destino).toEqual([{ marca_id: "m-beta", marca: "BETA" }]);
  });
  it("con mixta: BETA pasa a mixta, GAMMA (sin tratamiento) a por_gml; la mixta queda en marcar_mixta_ids", () => {
    const plan = planificarAsignacionBloque(cuerpo({ modalidad_destino: "mixta" }), estado);
    expect(plan.requieren_destino).toEqual([]);
    expect(plan.reporte.cambios_marca).toEqual([
      { marca_id: "m-beta", marca: "BETA", de: "barrido", a: "mixta" },
      { marca_id: "m-gamma", marca: "GAMMA", de: "sin_tratamiento", a: "por_gml" },
    ]);
    expect(plan.marcar_ids).toEqual(["m-beta", "m-gamma"]);
    expect(plan.marcar_mixta_ids).toEqual(["m-beta"]);
  });
  it("aplicar en memoria deja a BETA mixta y GAMMA por_gml; replanificar no cambia nada", () => {
    const plan = planificarAsignacionBloque(cuerpo({ modalidad_destino: "mixta" }), estado);
    const despues = aplicarPlanAsignacion(estado, plan);
    const beta = despues.marcas.find((m) => m.id === "m-beta") as MarcaGml;
    expect(modalidadEfectiva(beta)).toBe("mixta");
    expect(modalidadEfectiva(despues.marcas.find((m) => m.id === "m-gamma") as MarcaGml)).toBe("por_gml");
    const otra = planificarAsignacionBloque(cuerpo({ modalidad_destino: "mixta" }), despues);
    expect(otra.reporte.asignadas).toBe(0);
    expect(otra.reporte.cambios_marca).toEqual([]);
    expect(otra.requieren_destino).toEqual([]);
  });
  it("una marca que ya es mixta no pide destino al recibir más GML", () => {
    const m = conGammaMixta();
    const plan = planificarAsignacionBloque(
      { forma: "pares", accion: "asignar", pares: [{ marca_id: "m-gamma", nodo_id: "n1" }], nota: null },
      { marcas: m.marcas, nodos: m.nodos, asignaciones: m.asignaciones }
    );
    expect(plan.requieren_destino).toEqual([]);
    expect(plan.reporte.cambios_marca).toEqual([]);
  });
  it("zod: modalidad_destino ∈ {por_gml, mixta}; barrido no es destino", () => {
    const UUID = "123e4567-e89b-42d3-a456-426614174000";
    expect(crearGmlEspecialSchema.parse({ marca_id: UUID, genero_mundo_linea_id: UUID, modalidad_destino: "mixta" }).modalidad_destino).toBe("mixta");
    expect(crearGmlEspecialSchema.safeParse({ marca_id: UUID, genero_mundo_linea_id: UUID, modalidad_destino: "barrido" }).success).toBe(false);
    expect(crearGmlEspecialSchema.parse({ marca_id: UUID, genero_mundo_linea_id: UUID }).modalidad_destino).toBeUndefined();
    const bloque = asignarGmlSchema.parse({ forma: "pares", accion: "asignar", pares: [{ marca_id: UUID, nodo_id: UUID }], modalidad_destino: "por_gml" });
    expect(bloque.modalidad_destino).toBe("por_gml");
  });
});

describe("pendientes y asignaciones ignoradas de una mixta", () => {
  it("mixta sin GML vigentes → mixta_sin_gml; por_gml sin GML sigue siendo sin_gml; con GML no es pendiente", () => {
    const e = conGammaMixta();
    const ag = e.agrupaciones.find((a) => a.id === AGR.rec);
    expect(motivoPendiente(gamma(e), ag, 0)).toBe("mixta_sin_gml");
    expect(motivoPendiente(gamma(e), ag, 1)).toBeNull();
    expect(motivoPendiente({ ...gamma(e), resto_al_barrer: false }, ag, 0)).toBe("sin_gml");
  });
  it("las asignaciones de una mixta cuentan (no son marca_en_barrido); las de una barrido siguen ignoradas", () => {
    const e = conGammaMixta();
    const ag = e.agrupaciones.find((a) => a.id === AGR.rec);
    const nodo = e.nodos.get("n3");
    const unidad = unidadDeMarca(gamma(e), e.marcas);
    expect(motivoIgnorada(gamma(e), ag, unidad, nodo)).toBeNull();
    expect(motivoIgnorada({ ...gamma(e), modalidad_tratamiento: "barrido", resto_al_barrer: false }, ag, unidad, nodo)).toEqual({ motivo: "marca_en_barrido" });
  });
  it("el estado de la pantalla cuenta las mixtas aparte: marcadas = por_gml + barrido + mixta + sin_modalidad", () => {
    const v = armarVistaGml(conGammaMixta());
    expect(v.resumen).toMatchObject({ marcadas: 5, por_gml: 2, barrido: 1, mixta: 1, sin_modalidad: 1 });
    expect(v.resumen.marcadas).toBe(v.resumen.por_gml + v.resumen.barrido + v.resumen.mixta + v.resumen.sin_modalidad);
    const g = v.marcas.find((m) => m.id === "m-gamma");
    expect(g?.modalidad_efectiva).toBe("mixta");
    expect(g?.gml.map((x) => x.vigente)).toEqual([true]);
    expect(g?.pendiente).toBe(false);
  });
  it("una mixta sin GML aparece como pendiente mixta_sin_gml", () => {
    const e = conGammaMixta();
    const sinGml = { ...e, asignaciones: asignacionesFixture() };
    const g = armarVistaGml(sinGml).marcas.find((m) => m.id === "m-gamma");
    expect(g?.motivo_pendiente).toBe("mixta_sin_gml");
    // El resumen la cuenta aparte, sin tocar `pendientes_sin_gml` (que sigue siendo solo las `sin_gml`).
    const conMixta = armarVistaGml(sinGml).resumen;
    expect(conMixta.pendientes_mixta_sin_gml).toBe(1);
    expect(conMixta.pendientes_sin_gml).toBe(armarVistaGml(conGammaMixta()).resumen.pendientes_sin_gml);
    expect(armarVistaGml(conGammaMixta()).resumen.pendientes_mixta_sin_gml).toBe(0);
    expect(unidadesFlujoEspecial(sinGml).pendientes).toContainEqual({ marca_id: "m-gamma", marca: "GAMMA", motivo: "mixta_sin_gml" });
  });
});

describe("vista de vigentes (equivalente de la vista SQL): una mixta, dos clases de fila", () => {
  it("GAMMA produce una fila de GML nulo (barrido) y una por GML vigente (por_gml); BETA una; ALFA una por GML", () => {
    const filas = unidadesFlujoEspecial(conGammaMixta()).unidades;
    const de = (id: string) => filas.filter((f) => f.marca_id === id).map((f) => `${f.modalidad}|${f.genero_mundo_linea_id ?? "-"}`).sort();
    expect(de("m-gamma")).toEqual(["barrido|-", "por_gml|n3"]);
    expect(de("m-beta")).toEqual(["barrido|-"]);
    expect(de("m-alfa")).toEqual(["por_gml|n1", "por_gml|n2", "por_gml|n3"]);
  });
  it("una mixta sin GML vigentes aparece solo con la fila nula", () => {
    const e = conGammaMixta();
    const filas = unidadesFlujoEspecial({ ...e, asignaciones: asignacionesFixture() }).unidades.filter((f) => f.marca_id === "m-gamma");
    expect(filas).toEqual([{ marca_id: "m-gamma", agrupacion_marca_id: AGR.rec, modalidad: "barrido", genero_mundo_linea_id: null }]);
  });
  it("armarVigentes: mixtas[] con sus GML específicos; barrido[] solo trae las marcas al barrer puras; el GML específico está en gml[]", () => {
    const v = armarVigentes(conGammaMixta(), "2026-10-17T00:00:00Z");
    expect(v.mixtas.map((m) => m.marca)).toEqual(["GAMMA"]);
    expect(v.mixtas[0].gml_especificos).toEqual([{ genero_mundo_linea_id: "n3" }]);
    expect(v.barrido.map((b) => b.marca)).toEqual(["BETA", "ÉPSILON"]); // ÉPSILON: marcada sin modalidad, se lee barrido
    const n3 = v.gml.find((g) => g.genero_mundo_linea_id === "n3");
    expect(n3?.agrupaciones.find((a) => a.agrupacion_marca_id === AGR.rec)?.relevantes.map((r) => r.marca)).toContain("GAMMA");
    expect(v.pendientes.map((p) => p.marca)).not.toContain("GAMMA");
  });
  it("sin mixtas, mixtas = [] (contrato aditivo)", () => {
    expect(armarVigentes(estadoFixture(), "2026-10-17T00:00:00Z").mixtas).toEqual([]);
  });
});

describe("claveFlujo con mixta (regla 14)", () => {
  const config = construirConfigFlujo(conGammaMixta(), EQUIVALENCIAS);
  const clave = (equivalencia_id: string, marca_id = "m-gamma") => textoClaveFlujo(claveFlujo({ marca_id, equivalencia_id }, config));
  const u = (gml: string, marca: string | null) =>
    textoClaveFlujo({ tipo: "unidad", gml_id: gml, equivalencia_id: null, agrupacion_marca_id: AGR.rec, marca_id: marca });

  it("hecho de GAMMA en un GML donde es relevante → la fila de la marca", () => {
    expect(clave("e3")).toBe(u("n3", "m-gamma"));
  });
  it("hecho de GAMMA en otro GML → su flujo al barrer, no 'otras'", () => {
    expect(clave("e1a")).toBe(textoClaveFlujo({ tipo: "barrido", marca_id: "m-gamma" }));
    expect(clave("e2a")).toBe(textoClaveFlujo({ tipo: "barrido", marca_id: "m-gamma" }));
  });
  it("sus GML específicos están en relevantes (la mixta cuenta como relevante donde tiene asignación vigente)", () => {
    expect(config.relevantes.has("m-gamma|n3")).toBe(true);
    expect(config.marcas.get("m-gamma")?.modalidad).toBe("mixta");
  });
  it("mixta con agrupación inactiva (no vigente) → 'otras', como el resto de marcas", () => {
    const e = conGammaMixta();
    const inactiva = { ...e, agrupaciones: e.agrupaciones.map((a) => (a.id === AGR.rec ? { ...a, activo: false } : a)) };
    const c = construirConfigFlujo(inactiva, EQUIVALENCIAS);
    expect(textoClaveFlujo(claveFlujo({ marca_id: "m-gamma", equivalencia_id: "e1a" }, c))).toBe(u("n1", null));
  });
  it("la partición sigue completa y disjunta: cada hecho cae en una y solo una clave, y la suma se conserva", () => {
    const filas = new Map<string, number>();
    for (const h of HECHOS_TODOS) {
      const k = textoClaveFlujo(claveFlujo(h, config));
      filas.set(k, (filas.get(k) ?? 0) + h.unidades);
    }
    const total = HECHOS_TODOS.reduce((a, h) => a + h.unidades, 0);
    expect([...filas.values()].reduce((a, b) => a + b, 0)).toBe(total);
    // GAMMA: 300 (N1) al barrer, 60 (N3) en su fila; antes de ser mixta, esas 300 iban a otras RECONOCIDO de N1.
    expect(filas.get(textoClaveFlujo({ tipo: "barrido", marca_id: "m-gamma" }))).toBe(300);
    expect(filas.get(u("n3", "m-gamma"))).toBe(60);
  });
  it("un miembro de un conjunto cuya cabeza es mixta cuenta en la unidad de la cabeza", () => {
    const e = conGammaMixta();
    const conMiembro = {
      ...e,
      marcas: [
        ...e.marcas,
        { ...e.marcas.find((m) => m.id === "m-gamma-sport")!, conjunto_marca_id: "m-gamma" },
      ],
    };
    const eq = [...EQUIVALENCIAS];
    const c = construirConfigFlujo(conMiembro, eq);
    expect(textoClaveFlujo(claveFlujo({ marca_id: "m-gamma-sport", equivalencia_id: "e1a" }, c))).toBe(
      textoClaveFlujo({ tipo: "barrido", marca_id: "m-gamma" })
    );
    expect(textoClaveFlujo(claveFlujo({ marca_id: "m-gamma-sport", equivalencia_id: "e3" }, c))).toBe(u("n3", "m-gamma"));
  });
});

describe("importador de marcas: TRATAMIENTO_ESPECIAL = MIXTA", () => {
  const estado = (): EstadoImportacionMarcas => ({
    agrupaciones: [{ id: "a-1", codigo: "RECONOCIDO", nombre: "RECONOCIDO", activo: true }],
    marcas: [],
  });
  it("leerTratamientoMarca: MIXTA es marcada y mixta; SI marcada; NO no; otro texto es inválido", () => {
    expect(leerTratamientoMarca(" mixta ")).toEqual({ marcada: true, mixta: true });
    expect(leerTratamientoMarca("si")).toEqual({ marcada: true, mixta: false });
    expect(leerTratamientoMarca("")).toEqual({ marcada: false, mixta: false });
    expect(leerTratamientoMarca("quizá")).toBeNull();
  });
  it("una marca nueva MIXTA se crea con por_gml + resto_al_barrer; SI con barrido sin la bandera", () => {
    const plan = planificarImportacionMarcas(
      [
        { marca: "GAMMA", agrupacion: "RECONOCIDO", tratamiento_especial: "MIXTA" },
        { marca: "BETA", agrupacion: "RECONOCIDO", tratamiento_especial: "SI" },
        { marca: "DELTA", agrupacion: "RECONOCIDO", tratamiento_especial: "" },
      ],
      estado()
    );
    expect(plan.marcas).toEqual([
      { nombre: "GAMMA", codigo: "GAMMA", agrupacion_marca_id: "a-1", tratamiento_especial: true, modalidad_tratamiento: "por_gml", resto_al_barrer: true },
      { nombre: "BETA", codigo: "BETA", agrupacion_marca_id: "a-1", tratamiento_especial: true, modalidad_tratamiento: "barrido" },
      { nombre: "DELTA", codigo: "DELTA", agrupacion_marca_id: "a-1", tratamiento_especial: false, modalidad_tratamiento: null },
    ]);
    expect(plan.reporte.crear.con_tratamiento_especial).toBe(2);
    const despues = aplicarPlanMarcas(estado(), plan);
    expect(despues.marcas.find((m) => m.nombre === "GAMMA")?.resto_al_barrer).toBe(true);
    expect(planificarImportacionMarcas([{ marca: "X", agrupacion: "RECONOCIDO", tratamiento_especial: "tal vez" }], estado()).reporte.omitidas[0].motivo).toBe("tratamiento_invalido");
  });
});
