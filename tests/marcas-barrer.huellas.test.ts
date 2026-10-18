import { describe, expect, it } from "vitest";
import {
  diferenciaMaximaPp,
  huellaAnalisis,
  huellaCargasBarrer,
  huellaConfig,
  huellaFlujo,
  huellaNiveles,
  miembrosDeUnidad,
  motivosObsoleto,
  partesHuellaConfig,
  type EntradaHuellaConfig,
} from "@/lib/marcas-barrer/huellas";
import { construirConfigFlujo } from "@/lib/marcas/gml/flujo";
import { TEMPORADAS_DEFECTO, UMBRAL_OBSOLETO_PP, VERSION_METODO_BARRER } from "@/lib/marcas-barrer/tipos-api";
import { AM, EQ, GEN, MARCA, NODO, asignacionesB, configB, equivalenciasB, estadoB, marcasB } from "./marcas-barrer.fixture";

/** Regla 11 de la ficha 12 (huellas y umbral de obsolescencia) y la `huella_flujo` de M7 (regla 17). */

const entrada = (c: Partial<EntradaHuellaConfig> = {}): EntradaHuellaConfig => ({
  modalidad: "barrido",
  agrupacion_marca_id: AM.pre,
  gml_especificos: [],
  miembros: [MARCA.betaUno],
  temporadas: TEMPORADAS_DEFECTO,
  modo: "por_temporada",
  alcance: { generos: [], mundos: [], lineas: [] },
  fuente: "historico",
  normaliza_nino: true,
  niveles: new Map([[NODO.denim, "GML"], [NODO.polo, "GML"]]),
  ventana_meses: 24,
  ...c,
});

describe("huella_config: cada pieza de la configuración la cambia", () => {
  const base = huellaConfig(entrada());
  const cambios: [string, Partial<EntradaHuellaConfig>][] = [
    ["la modalidad", { modalidad: "mixta" }],
    ["la agrupación de la marca", { agrupacion_marca_id: AM.rec }],
    ["un GML específico vigente", { gml_especificos: [NODO.camisa] }],
    ["un miembro del conjunto", { miembros: [MARCA.betaUno, MARCA.gamma] }],
    ["las fechas de las temporadas (decisión 31)", { temporadas: { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } } }],
    ["el modo", { modo: "anual" }],
    ["el alcance (género)", { alcance: { generos: [GEN.hombre], mundos: [], lineas: [] } }],
    ["la fuente", { fuente: "cerrada" }],
    ["la normalización del Niño", { normaliza_nino: false }],
    ["el nivel de una g", { niveles: new Map([[NODO.denim, "GMLE"], [NODO.polo, "GML"]]) }],
    ["la ventana", { ventana_meses: 12 }],
  ];
  for (const [que, cambio] of cambios) {
    it(`cambia con ${que}`, () => expect(huellaConfig(entrada(cambio))).not.toBe(base));
  }
  it("no depende del orden de entrada ni de repetir el cálculo", () => {
    expect(huellaConfig(entrada())).toBe(base);
    expect(huellaConfig(entrada({ miembros: [MARCA.gamma, MARCA.betaUno] }))).toBe(huellaConfig(entrada({ miembros: [MARCA.betaUno, MARCA.gamma] })));
    expect(huellaConfig(entrada({ niveles: new Map([[NODO.polo, "GML"], [NODO.denim, "GML"]]) }))).toBe(base);
  });
  it("tiene tres partes (cfg.niv.ven) para decir cuál cambió", () => {
    const p = partesHuellaConfig(base)!;
    expect(p.cfg).toHaveLength(12);
    expect(huellaNiveles(new Map([[NODO.denim, "GML"], [NODO.polo, "GML"]]))).toBe(p.niv);
    expect(partesHuellaConfig("basura")).toBeNull();
    expect(partesHuellaConfig(huellaConfig(entrada({ ventana_meses: 36 })))!.cfg).toBe(p.cfg);
    expect(partesHuellaConfig(huellaConfig(entrada({ ventana_meses: 36 })))!.ven).not.toBe(p.ven);
  });
  it("VERSION_METODO_BARRER es 2 y está dentro de la huella (el método nuevo invalida los repartos)", () => {
    expect(VERSION_METODO_BARRER).toBe(2);
  });
});

describe("motivosObsoleto (regla 11)", () => {
  const vigente = { huella_config: huellaConfig(entrada()), huella_cargas: "cargas-1" };
  const igual = { ...vigente };

  it("sin cambios: al día", () => {
    expect(motivosObsoleto(vigente, igual, 0)).toEqual({ motivos: [], al_dia: true, diferencia_pp: 0 });
  });
  it("config_cambiada, nivel_cambiado y ventana_distinta SIEMPRE, cada uno por su parte de la huella", () => {
    expect(motivosObsoleto(vigente, { ...igual, huella_config: huellaConfig(entrada({ modalidad: "mixta" })) }, 0).motivos).toEqual(["config_cambiada"]);
    expect(motivosObsoleto(vigente, { ...igual, huella_config: huellaConfig(entrada({ niveles: new Map([[NODO.denim, "GMLE"], [NODO.polo, "GML"]]) })) }, 0).motivos).toEqual(["nivel_cambiado"]);
    expect(motivosObsoleto(vigente, { ...igual, huella_config: huellaConfig(entrada({ ventana_meses: 12 })) }, 0).motivos).toEqual(["ventana_distinta"]);
    const todo = huellaConfig(entrada({ modalidad: "mixta", ventana_meses: 36, niveles: new Map([[NODO.denim, "GMLE"]]) }));
    expect(motivosObsoleto(vigente, { ...igual, huella_config: todo }, 0).motivos).toEqual(["config_cambiada", "nivel_cambiado", "ventana_distinta"]);
  });
  it("una huella guardada que no tiene la forma esperada se trata como configuración cambiada", () => {
    expect(motivosObsoleto({ ...vigente, huella_config: "vieja" }, igual, 0).motivos).toEqual(["config_cambiada"]);
  });
  it("cargas_nuevas solo si el p2 se mueve más de 5 pp: 1,2 pp es al día con la diferencia informativa; 6 pp es cargas_nuevas", () => {
    const conCargas = { ...igual, huella_cargas: "cargas-2" };
    const poco = motivosObsoleto(vigente, conCargas, 1.2);
    expect(poco).toEqual({ motivos: [], al_dia: true, diferencia_pp: 1.2 });
    expect(motivosObsoleto(vigente, conCargas, 5).motivos).toEqual([]);
    expect(motivosObsoleto(vigente, conCargas, 6).motivos).toEqual(["cargas_nuevas"]);
    expect(UMBRAL_OBSOLETO_PP).toBe(5);
    // Con las mismas cargas no hay cargas nuevas aunque la diferencia sea grande (no puede pasar: mismos datos).
    expect(motivosObsoleto(vigente, igual, 40).motivos).toEqual([]);
    // Sin diferencia calculada (null) tampoco.
    expect(motivosObsoleto(vigente, conCargas, null).motivos).toEqual([]);
  });
  it("el umbral es parámetro", () => {
    expect(motivosObsoleto(vigente, { ...igual, huella_cargas: "x" }, 3, 2).motivos).toEqual(["cargas_nuevas"]);
  });
});

describe("diferencia máxima, huella de cargas y del análisis", () => {
  it("diferenciaMaximaPp: lo que falta en un lado vale 0", () => {
    expect(diferenciaMaximaPp(new Map([["a", 0.5], ["b", 0.5]]), new Map([["a", 0.512], ["b", 0.488]]))).toBeCloseTo(1.2, 9);
    expect(diferenciaMaximaPp(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(100);
    expect(diferenciaMaximaPp(new Map(), new Map())).toBe(0);
  });
  it("huellaCargasBarrer cambia si cambia un carga_id o entra o sale un mes, y no depende del orden", () => {
    const a = huellaCargasBarrer({ "2026-08": "c1", "2026-09": "c2" });
    expect(huellaCargasBarrer({ "2026-09": "c2", "2026-08": "c1" })).toBe(a);
    expect(huellaCargasBarrer({ "2026-08": "c1", "2026-09": "c3" })).not.toBe(a);
    expect(huellaCargasBarrer({ "2026-08": "c1" })).not.toBe(a);
  });
  it("huellaAnalisis cambia con las cargas, la configuración o los vectores calculados (también con el de la cerrada)", () => {
    const h = { huella_cargas: "c", huella_config: "a.b.c" };
    const v = new Map([["verano|g", 0.5]]);
    const base = huellaAnalisis(h, v, null);
    expect(huellaAnalisis(h, new Map(v), null)).toBe(base);
    expect(huellaAnalisis({ ...h, huella_cargas: "d" }, v, null)).not.toBe(base);
    expect(huellaAnalisis({ ...h, huella_config: "a.b.d" }, v, null)).not.toBe(base);
    expect(huellaAnalisis(h, new Map([["verano|g", 0.51]]), null)).not.toBe(base);
    expect(huellaAnalisis(h, v, new Map([["verano|g", 1]]))).not.toBe(base);
    // Una diferencia por debajo de 1e-6 no cambia la huella (redondeo).
    expect(huellaAnalisis(h, new Map([["verano|g", 0.5 + 1e-9]]), null)).toBe(base);
  });
});

describe("huella_flujo de M7 (regla 17): la configuración de 02b", () => {
  const base = huellaFlujo(configB());

  it("es estable y cambia con la modalidad, un GML relevante, un miembro del conjunto, la vigencia o la agrupación de una marca marcada", () => {
    expect(huellaFlujo(configB())).toBe(base);
    const con = (f: (m: ReturnType<typeof marcasB>) => ReturnType<typeof marcasB>, asignaciones = asignacionesB()) =>
      huellaFlujo(construirConfigFlujo(estadoB({ marcas: f(marcasB()), asignaciones }), equivalenciasB()));
    // GAMMA mixta → por_gml (apagar la bandera).
    expect(con((ms) => ms.map((m) => (m.id === MARCA.gamma ? { ...m, resto_al_barrer: false } : m)))).not.toBe(base);
    // BETA barrido → por_gml.
    expect(con((ms) => ms.map((m) => (m.id === MARCA.beta ? { ...m, modalidad_tratamiento: "por_gml" } : m)))).not.toBe(base);
    // Otro GML relevante.
    expect(con((ms) => ms, [...asignacionesB(), { id: "a3", marca_id: MARCA.gamma, genero_mundo_linea_id: NODO.polo, nota: null, activo: true, created_at: "" }])).not.toBe(base);
    // Un miembro más en el conjunto de ALFA.
    expect(con((ms) => ms.map((m) => (m.id === MARCA.delta ? { ...m, conjunto_marca_id: MARCA.alfa } : m)))).not.toBe(base);
    // La agrupación inactiva deja a la marca no vigente.
    expect(huellaFlujo(construirConfigFlujo(estadoB({ agrupaciones: estadoB().agrupaciones.map((a) => (a.id === AM.pre ? { ...a, activo: false } : a)) }), equivalenciasB()))).not.toBe(base);
  });
  it("una marca nueva SIN tratamiento especial no cambia la huella (no cambia ninguna clave de flujo)", () => {
    const nueva = { ...marcasB()[1], id: "00000000-0000-4000-8000-00000000f999", nombre: "NUEVA", conjunto_marca_id: null };
    expect(huellaFlujo(construirConfigFlujo(estadoB({ marcas: [...marcasB(), nueva] }), equivalenciasB()))).toBe(base);
  });
  it("unir dos marcas SIN tratamiento en un conjunto no cambia la huella (no es config_cambiada falso)", () => {
    const sinTratamiento = (id: string, nombre: string) => ({ ...marcasB()[1], id, nombre, conjunto_marca_id: null });
    const x = sinTratamiento("00000000-0000-4000-8000-00000000f998", "X SIN");
    const y = sinTratamiento("00000000-0000-4000-8000-00000000f999", "Y SIN");
    const huella = (marcas: ReturnType<typeof marcasB>) => huellaFlujo(construirConfigFlujo(estadoB({ marcas }), equivalenciasB()));
    const separadas = huella([...marcasB(), x, y]);
    expect(separadas).toBe(base);
    expect(huella([...marcasB(), x, { ...y, conjunto_marca_id: x.id }])).toBe(separadas);
  });
  it("un conjunto sí cuenta si la marca o su cabeza tienen tratamiento (cambia a dónde va su venta)", () => {
    const sinTratamiento = { ...marcasB()[1], id: "00000000-0000-4000-8000-00000000f998", nombre: "X SIN", conjunto_marca_id: null };
    const huella = (marcas: ReturnType<typeof marcasB>) => huellaFlujo(construirConfigFlujo(estadoB({ marcas }), equivalenciasB()));
    // Una marca sin tratamiento que entra al conjunto de una cabeza marcada (DELTA, barrido).
    const sola = huella([...marcasB(), sinTratamiento]);
    expect(huella([...marcasB(), { ...sinTratamiento, conjunto_marca_id: MARCA.delta }])).not.toBe(sola);
    // Una marca marcada que pasa a miembro de una cabeza sin tratamiento: su venta deja el tratamiento.
    expect(huella([...marcasB(), sinTratamiento].map((m) => (m.id === MARCA.delta ? { ...m, conjunto_marca_id: sinTratamiento.id } : m)))).not.toBe(sola);
  });
  it("un cambio del árbol (una equivalencia más) tampoco: el nivel tiene su propio motivo en M7", () => {
    expect(huellaFlujo(construirConfigFlujo(estadoB(), [...equivalenciasB(), { id: EQ.camisaCorta + "x", genero_mundo_linea_id: NODO.denim }]))).toBe(base);
  });
  it("miembrosDeUnidad lista los miembros de la cabeza (sin la cabeza)", () => {
    expect(miembrosDeUnidad(configB(), MARCA.beta)).toEqual([MARCA.betaUno]);
    expect(miembrosDeUnidad(configB(), MARCA.gamma)).toEqual([]);
  });
});
