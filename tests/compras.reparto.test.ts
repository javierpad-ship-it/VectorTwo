import { describe, expect, it } from "vitest";
import { dentroDelAlcance, hayRepartoCambio, repartirLinea, sumarRepartos, temporadaDeEntrega, type NodoAlcance } from "@/lib/compras/reparto";
import { GEN, MARCA_M8, MUN, NODO_M8 } from "./compras.fixture";
import { BETA_V2, GAMMA_V1, estadoImportacionBase } from "./compras.estado.fixture";

/** Reglas 11 y 11b de la ficha 08: reparto de un lote de una marca por entrega y temporadas editables. */

const nodos = new Map<string, NodoAlcance>(estadoImportacionBase().nodos.map((n) => [n.id, { genero_id: n.genero_id, mundo_id: n.mundo_id, linea_id: n.linea_id }]));

const porGml = (filas: { genero_mundo_linea_id: string; unidades: number }[]) => Object.fromEntries(filas.map((f) => [f.genero_mundo_linea_id, f.unidades]));

describe("repartirLinea: vector por temporada de cada entrega (regla 11)", () => {
  it("usa el vector de verano para dic y el de invierno para jun (dos repartos, sumados en `filas`)", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, [{ periodo: "2026-12", unidades: 600 }, { periodo: "2027-06", unidades: 400 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega.map((p) => p.temporada)).toEqual(["verano", "invierno"]);
    // dic (verano .59 / .293 / .117 sobre 600): 354 · 176 · 70 (mayor resto).
    expect(porGml(r.por_entrega[0].filas)).toEqual({ [NODO_M8.urbano]: 354, [NODO_M8.polo]: 176, [NODO_M8.sandalia]: 70 });
    // jun (invierno .5 / .4 / .1 sobre 400): 200 · 160 · 40.
    expect(porGml(r.por_entrega[1].filas)).toEqual({ [NODO_M8.urbano]: 200, [NODO_M8.polo]: 160, [NODO_M8.sandalia]: 40 });
    expect(porGml(r.filas)).toEqual({ [NODO_M8.urbano]: 554, [NODO_M8.polo]: 336, [NODO_M8.sandalia]: 110 });
    expect(r.filas.reduce((a, f) => a + f.unidades, 0)).toBe(1000);
    expect(r.version).toBe(2);
  });

  it("sin alcance, 1 000 u en una entrega de verano dan 590 / 293 / 117", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, [{ periodo: "2026-12", unidades: 1000 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(porGml(r.filas)).toEqual({ [NODO_M8.urbano]: 590, [NODO_M8.polo]: 293, [NODO_M8.sandalia]: 117 });
  });

  it("con alcance HOMBRE filtra la sandalia y renormaliza: 668 / 332", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta, alcance: { generos: [GEN.hombre] } }, [{ periodo: "2026-12", unidades: 1000 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(porGml(r.filas)).toEqual({ [NODO_M8.urbano]: 668, [NODO_M8.polo]: 332 });
  });

  it("un alcance que deja 0 GML responde alcance_vacio", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta, alcance: { generos: [GEN.mujer], mundos: [MUN.urbano] } }, [{ periodo: "2026-12", unidades: 100 }], BETA_V2, nodos);
    expect(r).toMatchObject({ ok: false, motivo: "alcance_vacio" });
  });

  it("sin reparto vigente responde sin_reparto", () => {
    expect(repartirLinea({ marca_id: MARCA_M8.delta }, [{ periodo: "2026-12", unidades: 100 }], null, nodos)).toMatchObject({ ok: false, motivo: "sin_reparto" });
  });

  it("cada entrega suma exactamente sus unidades y las filas guardan reparto, versión, temporada y error", () => {
    const entregas = [{ periodo: "2026-12", unidades: 400 }, { periodo: "2027-01", unidades: 350 }, { periodo: "2027-02", unidades: 250 }];
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, entregas, BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega.map((p) => p.filas.reduce((a, f) => a + f.unidades, 0))).toEqual([400, 350, 250]);
    expect(r.por_entrega[0].filas.map((f) => f.unidades)).toEqual([236, 117, 47]);
    for (const f of r.por_entrega.flatMap((p) => p.filas)) {
      expect(f).toMatchObject({ marca_id: MARCA_M8.beta, reparto_id: BETA_V2.reparto_id, reparto_version: 2, temporada: "verano", error_reparto_pp: 8 });
    }
    expect(r.por_entrega.map((p) => p.filas[0].entrega_periodo)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });

  it("las entregas se reparten ordenadas por mes aunque lleguen desordenadas, y los periodos aaaa-mm-dd se llevan a su mes", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, [{ periodo: "2027-06-01", unidades: 100 }, { periodo: "2026-12", unidades: 100 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega.map((p) => p.periodo)).toEqual(["2026-12", "2027-06"]);
  });

  it("con modo anual usa un solo vector para todas las entregas y no guarda temporada", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.gamma }, [{ periodo: "2026-12", unidades: 120 }, { periodo: "2027-06", unidades: 80 }], GAMMA_V1, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega.map((p) => p.temporada)).toEqual([null, null]);
    expect(porGml(r.filas)).toEqual({ [NODO_M8.urbano]: 200 });
  });

  it("una entrega con 0 unidades no lleva filas", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, [{ periodo: "2026-12", unidades: 0 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega[0].filas).toEqual([]);
  });
});

describe("temporadas editables (regla 11b, §0.2 #8)", () => {
  it("la temporada sale de las `temporadas_usadas` del reparto, no de parámetros globales", () => {
    expect(temporadaDeEntrega("2026-10", BETA_V2)).toBe("verano");
    expect(temporadaDeEntrega("2026-04", BETA_V2)).toBe("invierno");
    // Un reparto v3 calculado con verano 11→4 e invierno 5→10: abril es verano, octubre es invierno.
    const v3 = { ...BETA_V2, temporadas_usadas: { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } } };
    expect(temporadaDeEntrega("2026-04", v3)).toBe("verano");
    expect(temporadaDeEntrega("2026-10", v3)).toBe("invierno");
  });

  it("un reparto v2 con las fechas por defecto sigue usando verano en octubre aunque Parámetros cambie (no hay otra entrada)", () => {
    const r = repartirLinea({ marca_id: MARCA_M8.beta }, [{ periodo: "2026-10", unidades: 100 }], BETA_V2, nodos);
    if (!r.ok) throw new Error("debía repartir");
    expect(r.por_entrega[0].temporada).toBe("verano");
  });

  it("con modo anual la temporada es null", () => {
    expect(temporadaDeEntrega("2026-10", GAMMA_V1)).toBeNull();
  });
});

describe("alcance, sumas y reparto_cambio", () => {
  it("dentroDelAlcance exige todas las listas no vacías; sin alcance todo entra", () => {
    expect(dentroDelAlcance(NODO_M8.polo, null, nodos)).toBe(true);
    expect(dentroDelAlcance(NODO_M8.polo, { generos: [], mundos: [] }, nodos)).toBe(true);
    expect(dentroDelAlcance(NODO_M8.polo, { generos: [GEN.hombre], mundos: [MUN.casual] }, nodos)).toBe(true);
    expect(dentroDelAlcance(NODO_M8.polo, { generos: [GEN.hombre], mundos: [MUN.urbano] }, nodos)).toBe(false);
    expect(dentroDelAlcance("desconocido", { generos: [GEN.hombre] }, nodos)).toBe(false);
  });

  it("sumarRepartos junta las entregas por (marca, GML, equivalencia)", () => {
    const f = (g: string, u: number) => ({ marca_id: MARCA_M8.beta, genero_mundo_linea_id: g, equivalencia_id: null, unidades: u });
    expect(sumarRepartos([f("a", 1), f("b", 2), f("a", 3)])).toEqual([f("a", 4), f("b", 2)]);
  });

  it("hayRepartoCambio: otra versión vigente activa el aviso; sin reparto_id (mezcla) nunca", () => {
    expect(hayRepartoCambio([{ reparto_id: "v2" }], "v2")).toBe(false);
    expect(hayRepartoCambio([{ reparto_id: "v2" }], "v3")).toBe(true);
    expect(hayRepartoCambio([{ reparto_id: "v2" }], null)).toBe(true);
    expect(hayRepartoCambio([{ reparto_id: null }], "v3")).toBe(false);
    expect(hayRepartoCambio([], "v3")).toBe(false);
  });
});
