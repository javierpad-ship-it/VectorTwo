import { describe, expect, it } from "vitest";
import { extenderDemanda } from "@/lib/flujo/imi";
import { indexarReglas, proyectarFilaConSubflujos, reglasDeFila, subflujosDeFila, type SubflujoEntrada } from "@/lib/flujo/subflujo";
import { aplicable, parteDeMarca } from "@/lib/intercompany/reglas";
import { subflujoIntercompany } from "@/lib/intercompany/subflujo";
import { filasCerrada0100, filasCerrada0101, MARCA, NODO } from "./intercompany.fixture";
import { DEMANDA_CASO1, MARCA_M8, NODO_M8, REGLA_JH, participaciones } from "./flujo.soporte";
import type { ReglaFlujoApi } from "@/lib/flujo/tipos-api";

/** Reglas 2 (subflujo), 27 (una sola aritmética) y 28 (fila con subflujo) de la ficha 08, y `parteDeMarca` de M13. */

const periodos = Array.from({ length: 15 }, (_, i) => {
  const idx = 2026 * 12 + 9 + i;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
});
const cerca = (a: number | null, b: number, d = 1e-6) => expect(Math.abs((a as number) - b)).toBeLessThan(d);
const plana = (v: number) => periodos.map(() => v);

describe("parteDeMarca (refactor de M13)", () => {
  it("usa por_marca si la fila lo trae", () => {
    const camisa = filasCerrada0101().find((f) => f.gml_id === NODO.camisa)!;
    expect(parteDeMarca(camisa, MARCA.jh)).toBe(0.4);
    expect(parteDeMarca(camisa, MARCA.alfa)).toBe(0.35);
    expect(parteDeMarca(camisa, MARCA.donatelli)).toBe(0);
  });

  it("sin por_marca (cerrada 0.10.0) suma las participaciones de por_clave_flujo con esa marca", () => {
    const camisa = filasCerrada0100().find((f) => f.gml_id === NODO.camisa)!;
    expect(parteDeMarca(camisa, MARCA.jh)).toBe(0.4);
    expect(parteDeMarca({ por_marca: null, por_clave_flujo: [{ marca_id: MARCA.jh, participacion: 0.1 }, { marca_id: MARCA.jh, participacion: 0.15 }, { marca_id: null, participacion: 0.75 }] }, MARCA.jh)).toBeCloseTo(0.25, 12);
  });

  it("aplicable sigue dando lo mismo (usa parteDeMarca)", () => {
    expect(aplicable({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa }, filasCerrada0101()).aplicable).toBe(true);
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.camisa }, filasCerrada0100()).aplicable).toBe(false);
    expect(aplicable({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.camisa }, null).aplicable).toBeNull();
  });
});

describe("reglasDeFila (regla 2)", () => {
  const indice = (...reglas: ReglaFlujoApi[]) => indexarReglas(reglas);

  it("la regla vigente en k'+1 de cada marca con regla en el nodo", () => {
    const r = reglasDeFila(NODO_M8.camisa, "eq", indice(REGLA_JH), periodos);
    expect(r.vigentes.map((x) => [x.marca_id, x.regla.id])).toEqual([[MARCA_M8.jh, REGLA_JH.id]]);
    expect(r.cambian).toEqual([]);
    expect(r.futuras).toEqual([]);
  });

  it("otro nodo no tiene reglas", () => {
    expect(reglasDeFila(NODO_M8.urbano, null, indice(REGLA_JH), periodos).vigentes).toEqual([]);
  });

  it("si otra regla de la misma clave entra antes de H: la de k'+1 manda y se informa el mes del cambio", () => {
    const futura = { ...REGLA_JH, id: "r2", vigente_desde: "2026-12" };
    const r = reglasDeFila(NODO_M8.camisa, null, indice(REGLA_JH, futura), periodos);
    expect(r.vigentes[0].regla.id).toBe(REGLA_JH.id);
    expect(r.cambian).toEqual([{ marca_id: MARCA_M8.jh, desde: "2026-12" }]);
  });

  it("una regla que entra después de H no cambia nada", () => {
    expect(reglasDeFila(NODO_M8.camisa, null, indice(REGLA_JH, { ...REGLA_JH, id: "r2", vigente_desde: "2028-01" }), periodos).cambian).toEqual([]);
  });

  it("sin regla en k'+1 pero con una después → regla futura y sin vigentes", () => {
    const r = reglasDeFila(NODO_M8.camisa, null, indice({ ...REGLA_JH, vigente_desde: "2027-02" }), periodos);
    expect(r.vigentes).toEqual([]);
    expect(r.futuras).toEqual([MARCA_M8.jh]);
  });

  it("la regla de la equivalencia manda sobre la del GML y no cierra la del GML para otras equivalencias", () => {
    const deEq = { ...REGLA_JH, id: "r-eq", equivalencia_id: "eq-larga", pct_directo: 50 };
    expect(reglasDeFila(NODO_M8.camisa, "eq-larga", indice(REGLA_JH, deEq), periodos).vigentes[0].regla.id).toBe("r-eq");
    expect(reglasDeFila(NODO_M8.camisa, "eq-corta", indice(REGLA_JH, deEq), periodos).vigentes[0].regla.id).toBe(REGLA_JH.id);
  });
});

describe("subflujosDeFila", () => {
  const llamar = (partic: ReturnType<typeof participaciones> | null, reglas: ReglaFlujoApi[], aplicableNodo = true, proyectada = true) =>
    subflujosDeFila({
      gml_id: NODO_M8.camisa,
      equivalencia_id: null,
      participaciones: partic,
      proyectada,
      indice: indexarReglas(reglas),
      periodos,
      aplicableEnNodo: () => aplicableNodo,
      stockDeMarca: () => 900,
      ingresosDeMarca: () => plana(0),
    });

  it("con part_B > 0 arma el subflujo con el stock y los ingresos de la marca", () => {
    const r = llamar(participaciones({ [MARCA_M8.jh]: 0.4 }), [REGLA_JH]);
    expect(r.subflujos).toHaveLength(1);
    expect(r.subflujos[0]).toMatchObject({ marca_id: MARCA_M8.jh, part: 0.4, stock_k: 900 });
    expect(r.avisos).toEqual([]);
  });

  it("sin participaciones → sin_participaciones; una fila sin proyección no lleva subflujo ni avisos", () => {
    expect(llamar(null, [REGLA_JH])).toEqual({ subflujos: [], avisos: ["sin_participaciones"] });
    expect(llamar(null, [REGLA_JH], true, false)).toEqual({ subflujos: [], avisos: [] });
  });

  it("no aplicable en el nodo → intercompany_no_aplicable; aplicable en otra fila del nodo → sin aviso", () => {
    expect(llamar(participaciones({ [MARCA_M8.alfa]: 0.4 }), [REGLA_JH], false).avisos).toEqual(["intercompany_no_aplicable"]);
    expect(llamar(participaciones({ [MARCA_M8.alfa]: 0.4 }), [REGLA_JH], true).avisos).toEqual([]);
  });

  it("sin reglas en el nodo no hay nada que avisar", () => {
    expect(llamar(participaciones({ [MARCA_M8.jh]: 0.4 }), [])).toEqual({ subflujos: [], avisos: [] });
  });
});

describe("proyectarFilaConSubflujos (reglas 27 y 28)", () => {
  const demanda = plana(1200);
  const jh: SubflujoEntrada = { marca_id: MARCA_M8.jh, regla: REGLA_JH, part: 0.4, stock_k: 900, ingresos: plana(0) };
  const base = { periodos, demanda, extender: true, stock_k: 2300, ingresos: plana(0), rango: { imi_min: 4, imi_max: 8 }, sin_curva: false, meses_tarjeta: 6 };

  it("el subflujo es exactamente el de M13 (misma función, mismas cifras)", () => {
    const p = proyectarFilaConSubflujos({ ...base, subflujos: [jh] });
    const m13 = subflujoIntercompany({ demanda: extenderDemanda(demanda, true), parte: 0.4, stock_inicial: 900, regla: { imi_min: 4, imi_max: 8, pct_directo: 80 }, meses: 15 });
    p.subflujos[0].componente.meses.forEach((m, i) => {
      cerca(m.stock, m13[i].stock);
      cerca(m.saldo, m13[i].compra);
      cerca(m.exceso, m13[i].exceso);
      cerca(m.vpm, m13[i].vpm);
    });
  });

  it("CAMISA: S_fila_oct = 2 300 + 384 − 1 200 = 1 484 = 680 + 804 y la fila baja 816 por mes", () => {
    const p = proyectarFilaConSubflujos({ ...base, subflujos: [jh] });
    cerca(p.meses[0].stock, 1484);
    cerca(p.resto!.meses[0].stock + p.subflujos[0].componente.meses[0].stock, 1484);
    cerca(p.meses[0].stock - p.meses[1].stock, 816);
    cerca(p.meses[0].reposicion, 384);
    cerca(p.meses[1].reposicion, 384);
  });

  it("sin subflujos el único componente es la fila entera: R = 0 y todo como siempre", () => {
    const p = proyectarFilaConSubflujos({ ...base, demanda: plana(100), stock_k: 700, subflujos: [] });
    expect(p.resto).toBeNull();
    expect(p.subflujos).toEqual([]);
    p.meses.forEach((m) => expect(m.reposicion).toBe(0));
    cerca(p.meses[0].stock, 600);
  });

  it("dos subflujos: el resto toma 1 − Σ part, el stock y los ingresos que sobran", () => {
    const donatelli: SubflujoEntrada = { marca_id: MARCA_M8.donatelli, regla: { ...REGLA_JH, id: "r-d", marca_id: MARCA_M8.donatelli, imi_min: 3, imi_max: 6, pct_directo: 60 }, part: 0.2, stock_k: 300, ingresos: plana(0) };
    const p = proyectarFilaConSubflujos({ ...base, subflujos: [jh, donatelli] });
    cerca(p.resto!.meses[0].demanda, 480);
    cerca(p.resto!.meses[0].stock, 2300 - 900 - 300 - 480);
    cerca(p.meses[0].saldo, p.resto!.meses[0].saldo + p.subflujos[0].componente.meses[0].saldo + p.subflujos[1].componente.meses[0].saldo);
    cerca(p.meses[0].reposicion, 384 + 240 * 0.6);
  });

  it("un ingreso de la marca no entra al resto (I^resto = I − Σ I^B)", () => {
    const conIngreso = { ...jh, ingresos: periodos.map((_, i) => (i === 1 ? 300 : 0)) };
    const p = proyectarFilaConSubflujos({ ...base, ingresos: periodos.map((_, i) => (i === 1 ? 500 : 0)), subflujos: [conIngreso] });
    expect(p.resto!.meses[1].ingresos).toBe(200);
    expect(p.subflujos[0].componente.meses[1].ingresos).toBe(300);
    expect(p.meses[1].ingresos).toBe(500);
  });

  it("la señal de cada subflujo en la tarjeta es la peor de sus primeros meses", () => {
    const p = proyectarFilaConSubflujos({ ...base, subflujos: [jh] });
    expect(p.subflujos[0].senal_resumen).toBe("falta");
    cerca(p.subflujos[0].saldo_n_meses, p.subflujos[0].componente.meses.slice(0, 6).reduce((a, m) => a + m.saldo, 0));
  });

  it("una fila sin curva no lleva subflujos ni saldo, y su stock solo sube con los ingresos", () => {
    const p = proyectarFilaConSubflujos({ ...base, sin_curva: true, subflujos: [jh], ingresos: periodos.map((_, i) => (i === 2 ? 100 : 0)) });
    expect(p.subflujos).toEqual([]);
    expect(p.meses.map((m) => m.stock)).toEqual(periodos.map((_, i) => (i >= 2 ? 2400 : 2300)));
    expect(p.meses.every((m) => m.senal === "sin_curva" && m.imi === null && m.saldo === 0 && m.exceso === 0)).toBe(true);
    expect(p.imi_k).toBeNull();
  });

  it("el flujo con la demanda de DENIM y sin subflujos da el IMI de set 4,44", () => {
    const p = proyectarFilaConSubflujos({ ...base, demanda: DEMANDA_CASO1, stock_k: 700, subflujos: [] });
    cerca(p.imi_k, 700 / 157.5);
    cerca(p.vpm_k, 157.5);
  });
});
