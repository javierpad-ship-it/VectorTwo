import { describe, expect, it } from "vitest";
import { armarPctDirectoObservado } from "@/lib/intercompany/reglas";
import {
  conciliarFila,
  conciliarMes,
  pctDirectoObservado,
  pctDirectoObservado12m,
  posibleDobleConteo,
  reclasificacionProbable,
  sugerenciasDeFila,
  validarAceptacion,
  type MesConciliado,
} from "@/lib/flujo/conciliacion";
import type { EntregaCandidata } from "@/lib/flujo/ingresos";

/** Reglas 4b, 4c, 4d, 23 y 34 de la ficha 08 (conciliación de los meses cerrados y sugerencias voraces). */

const UMBRALES = { u: 10, pct: 20 };
const mes = (periodo: string, stockInicio: number | null, stockFin: number, venta: number, recepciones = 0, entregas = 0) =>
  conciliarMes({ periodo, venta, stock_inicio: stockInicio, stock_fin: stockFin, recepciones, entregas, umbrales: UMBRALES });

describe("conciliarMes (regla 4b)", () => {
  it("stock ago 1 990, stock set 700, venta set 1 410 → Ing = 120", () => {
    const m = mes("2026-09", 1990, 700, 1410);
    expect(m.ingreso_inferido).toBe(120);
    expect(m.salida_inferida).toBe(0);
    expect(m.sin_registrar).toBe(120);
    expect(m.avisos).toContain("ingreso_sin_registrar");
  });

  it("con una recepción registrada de 100: sin_registrar = 20, bajo el umbral (10 u y 20 % de 120 = 24) → sin aviso", () => {
    const m = mes("2026-09", 1990, 700, 1410, 100);
    expect(m.sin_registrar).toBe(20);
    expect(m.avisos).toEqual([]);
  });

  it("recepciones 950 e Ing = 850 → recepcion_sin_respaldo de 100 (umbral absoluto, como el ejemplo de la ficha)", () => {
    const m = mes("2026-09", 2300, 1950, 1200, 950);
    expect(m.ingreso_inferido).toBe(850);
    expect(m.sin_respaldo).toBe(100);
    expect(m.sin_registrar).toBe(0);
    expect(m.avisos).toEqual(["recepcion_sin_respaldo"]);
  });

  it("una diferencia de respaldo bajo el umbral absoluto no avisa", () => {
    expect(mes("2026-09", 1000, 1100, 150, 255).avisos).toEqual([]);
    expect(mes("2026-09", 1000, 1100, 150, 270).avisos).toEqual(["recepcion_sin_respaldo"]);
  });

  it("Ing = −40 → salida_neta, con la salida inferida y sin sugerencia", () => {
    const m = mes("2026-09", 1000, 960, 0);
    expect(m.ingreso_bruto).toBe(-40);
    expect(m.ingreso_inferido).toBe(0);
    expect(m.salida_inferida).toBe(40);
    expect(m.avisos).toEqual(["salida_neta"]);
  });

  it("el mes anterior sin publicar → sin_mes_anterior y nada que conciliar", () => {
    const m = mes("2026-09", null, 700, 1410);
    expect(m.ingreso_inferido).toBeNull();
    expect(m.salida_inferida).toBeNull();
    expect(m.sin_registrar).toBe(0);
    expect(m.sin_respaldo).toBe(0);
    expect(m.avisos).toEqual(["sin_mes_anterior"]);
  });

  it("las transferencias CD → tienda no producen ingreso: a nivel cadena el stock total no cambia", () => {
    // CD 600 + tiendas 400 = 1 000 → CD 400 + tiendas 600 = 1 000 con venta 0
    const antes = 600 + 400;
    const despues = 400 + 600;
    expect(mes("2026-09", antes, despues, 0).ingreso_inferido).toBe(0);
    expect(mes("2026-09", antes, despues, 0).avisos).toEqual([]);
  });

  it("devuelve un registro sin escrituras (solo datos)", () => {
    const m = mes("2026-09", 1990, 700, 1410);
    expect(Object.keys(m).sort()).toEqual(
      ["avisos", "entregas_programadas", "ingreso_bruto", "ingreso_inferido", "periodo", "recepciones_registradas", "salida_inferida", "sin_registrar", "sin_respaldo", "stock_fin", "stock_inicio", "sugerencias", "venta"].sort()
    );
  });
});

describe("conciliarFila", () => {
  const lectura = (datos: Record<string, [number, number]>) => (m: string) => (datos[m] ? { stock: datos[m][0], venta: datos[m][1] } : null);

  it("concilia solo los meses publicados y usa el mes anterior de cada uno", () => {
    const filas = conciliarFila({
      meses: ["2026-07", "2026-08", "2026-09"],
      lectura: lectura({ "2026-08": [1990, 1500], "2026-09": [700, 1410] }),
      recepciones: new Map([["2026-09", 100]]),
      entregas: new Map([["2026-09", 500]]),
      umbrales: UMBRALES,
    });
    expect(filas.map((f) => f.periodo)).toEqual(["2026-08", "2026-09"]);
    expect(filas[0].avisos).toEqual(["sin_mes_anterior"]);
    expect(filas[1]).toMatchObject({ ingreso_inferido: 120, recepciones_registradas: 100, entregas_programadas: 500, stock_inicio: 1990 });
  });
});

describe("reclasificación probable (regla 4b)", () => {
  it("+300 y −290 en la misma línea → ambas filas", () => {
    const marcadas = reclasificacionProbable([
      { clave: "a", grupo: "denim", ingreso_bruto: 300 },
      { clave: "b", grupo: "denim", ingreso_bruto: -290 },
      { clave: "c", grupo: "denim", ingreso_bruto: 5 },
    ]);
    expect([...marcadas].sort()).toEqual(["a", "b"]);
  });

  it("magnitudes que difieren más de 20 % o líneas distintas no se marcan", () => {
    expect(reclasificacionProbable([{ clave: "a", grupo: "g1", ingreso_bruto: 300 }, { clave: "b", grupo: "g1", ingreso_bruto: -100 }]).size).toBe(0);
    expect(reclasificacionProbable([{ clave: "a", grupo: "g1", ingreso_bruto: 300 }, { clave: "b", grupo: "g2", ingreso_bruto: -290 }]).size).toBe(0);
    expect(reclasificacionProbable([{ clave: "a", grupo: "g1", ingreso_bruto: null }, { clave: "b", grupo: "g1", ingreso_bruto: -290 }]).size).toBe(0);
  });
});

// ─── Sugerencias voraces (§0.5, regla 34) ───

const cand = (p: Partial<EntregaCandidata> & Pick<EntregaCandidata, "periodo" | "pendiente">): EntregaCandidata => ({
  compra_id: "c-1",
  compra_numero: "C-000001",
  fecha_compra: "2026-06-10",
  linea_id: "l-1",
  entrega_id: `e-${p.periodo}-${p.compra_numero ?? "C-000001"}`,
  tipo: "especifica",
  unidades: p.pendiente,
  vencida: p.periodo <= "2026-09",
  boton: true,
  proveedor_nombre: "Proveedor Norte",
  estado: "confirmada",
  marca_id: null,
  agrupacion_marca_id: null,
  tallas: "ambas",
  ...p,
});

/** Un mes conciliado con `sin_registrar` (con el aviso si pasa el umbral). */
const mesConSinRegistrar = (periodo: string, sinRegistrar: number): Pick<MesConciliado, "periodo" | "sin_registrar" | "avisos"> => ({
  periodo,
  sin_registrar: sinRegistrar,
  avisos: sinRegistrar >= 10 ? ["ingreso_sin_registrar"] : [],
});

const K = "2026-09";

describe("sugerenciasDeFila (regla 34)", () => {
  it("una entrega vencida de 500 en ago con sin_registrar ago 200 y set 400: una sola sugerencia, en ago por 200", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-08", 200), mesConSinRegistrar("2026-09", 400)], [cand({ periodo: "2026-08", pendiente: 500 })], K);
    expect([...r.por_mes.keys()]).toEqual(["2026-08"]);
    expect(r.por_mes.get("2026-08")).toHaveLength(1);
    expect(r.por_mes.get("2026-08")![0]).toMatchObject({ tipo: "vencida", unidades: 200, periodo_entrega: "2026-08" });
    expect(r.posible_doble_conteo).toBe(200);
  });

  it("tras aceptarla (la recepción baja sin_registrar de ago a 0 y el pendiente a 300) la siguiente lectura sugiere 300 en set", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-08", 0), mesConSinRegistrar("2026-09", 400)], [cand({ periodo: "2026-08", pendiente: 300 })], K);
    expect(r.por_mes.get("2026-09")![0]).toMatchObject({ unidades: 300 });
    expect(r.por_mes.has("2026-08")).toBe(false);
  });

  it("dos vencidas (jul 100, ago 300) con sin_registrar solo en ago (250): jul 100 y ago 150, ambas en ago, sin repetir unidades", () => {
    const r = sugerenciasDeFila(
      [mesConSinRegistrar("2026-07", 0), mesConSinRegistrar("2026-08", 250)],
      [cand({ periodo: "2026-07", pendiente: 100, compra_numero: "C-000001" }), cand({ periodo: "2026-08", pendiente: 300, compra_numero: "C-000002", linea_id: "l-2" })],
      K
    );
    const ago = r.por_mes.get("2026-08")!;
    expect(ago.map((s) => [s.periodo_entrega, s.unidades])).toEqual([["2026-07", 100], ["2026-08", 150]]);
    expect(r.posible_doble_conteo).toBe(250);
  });

  it("una entrega adelantada de nov de una compra de oct no se sugiere en set", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-09", 400)], [cand({ periodo: "2026-11", pendiente: 200, fecha_compra: "2026-10-05" })], K);
    expect(r.por_mes.size).toBe(0);
  });

  it("una adelantada de una compra anterior sí se sugiere (tipo adelantada) en el primer mes desde la compra", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-07", 300), mesConSinRegistrar("2026-08", 300), mesConSinRegistrar("2026-09", 300)], [cand({ periodo: "2026-11", pendiente: 200, fecha_compra: "2026-08-02" })], K);
    expect(r.por_mes.has("2026-07")).toBe(false);
    expect(r.por_mes.get("2026-08")![0]).toMatchObject({ tipo: "adelantada", unidades: 200, periodo_entrega: "2026-11" });
  });

  it("un mes bajo el umbral no sugiere", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-09", 9)], [cand({ periodo: "2026-09", pendiente: 500 })], K);
    expect(r.por_mes.size).toBe(0);
    expect(r.posible_doble_conteo).toBe(0);
  });

  it("las vencidas van antes que las adelantadas y se ordenan por periodo, número de compra y línea", () => {
    const r = sugerenciasDeFila(
      [mesConSinRegistrar("2026-09", 250)],
      [
        cand({ periodo: "2026-11", pendiente: 100, compra_numero: "C-000001", fecha_compra: "2026-05-01", linea_id: "l-a" }),
        cand({ periodo: "2026-09", pendiente: 150, compra_numero: "C-000007", linea_id: "l-b" }),
        cand({ periodo: "2026-09", pendiente: 100, compra_numero: "C-000003", linea_id: "l-c" }),
      ],
      K
    );
    expect(r.por_mes.get("2026-09")!.map((s) => [s.compra_numero, s.unidades])).toEqual([["C-000003", 100], ["C-000007", 150]]);
    expect(r.doble_conteo_vencidas).toBe(250);
  });

  it("caso B1: la entrega de oct pendiente de 200 se sugiere en oct; las adelantadas solo si también llegaron", () => {
    const oct = (sinRegistrar: number) => [mesConSinRegistrar("2026-10", sinRegistrar)];
    const vencida = cand({ periodo: "2026-10", pendiente: 200, entrega_id: "e-oct" });
    const adelantada = cand({ periodo: "2026-11", pendiente: 200, entrega_id: "e-nov", fecha_compra: "2026-09-20", linea_id: "l-1" });
    const solo = sugerenciasDeFila(oct(200), [vencida, adelantada], "2026-10");
    expect(solo.por_mes.get("2026-10")!.map((s) => [s.tipo, s.entrega_id, s.unidades])).toEqual([["vencida", "e-oct", 200]]);
    const ambas = sugerenciasDeFila(oct(400), [vencida, adelantada], "2026-10");
    expect(ambas.por_mes.get("2026-10")!.map((s) => [s.tipo, s.entrega_id, s.unidades])).toEqual([["vencida", "e-oct", 200], ["adelantada", "e-nov", 200]]);
    expect(sugerenciasDeFila(oct(5), [vencida], "2026-10").por_mes.size).toBe(0);
  });

  it("una sugerencia de lote lleva boton = false y cuenta igual para el doble conteo", () => {
    const r = sugerenciasDeFila([mesConSinRegistrar("2026-09", 100)], [cand({ periodo: "2026-09", pendiente: 100, boton: false, tipo: "barrer_marca" })], K);
    expect(r.por_mes.get("2026-09")![0].boton).toBe(false);
    expect(r.posible_doble_conteo).toBe(100);
  });

  it("posibleDobleConteo suma las unidades de las sugerencias de los meses", () => {
    expect(posibleDobleConteo({ conciliacion: [{ sugerencias: [{ unidades: 100 }, { unidades: 50 }] }, { sugerencias: [] }, { sugerencias: [{ unidades: 7 }] }] })).toBe(157);
  });
});

describe("validarAceptacion (regla 23)", () => {
  const s = (p: Partial<ReturnType<typeof sug>> = {}) => ({ ...sug(), ...p });
  function sug() {
    return { tipo: "vencida" as const, linea_id: "l-1", compra_id: "c-1", compra_numero: "C-000009", entrega_id: "e-1", periodo_entrega: "2026-09", unidades: 500, boton: true };
  }

  it("acepta lo sugerido o menos", () => {
    expect(validarAceptacion([s()], { linea_id: "l-1", entrega_id: "e-1", unidades: 500 })).toMatchObject({ ok: true });
    expect(validarAceptacion([s()], { linea_id: "l-1", entrega_id: "e-1", unidades: 300 })).toMatchObject({ ok: true });
  });

  it("sin sugerencia para esa entrega o con más unidades de las propuestas → sugerencia_vencida", () => {
    expect(validarAceptacion([s()], { linea_id: "l-1", entrega_id: "otra", unidades: 100 })).toEqual({ ok: false, motivo: "sugerencia_vencida" });
    expect(validarAceptacion([], { linea_id: "l-1", entrega_id: "e-1", unidades: 100 })).toEqual({ ok: false, motivo: "sugerencia_vencida" });
    expect(validarAceptacion([s({ unidades: 200 })], { linea_id: "l-1", entrega_id: "e-1", unidades: 500 })).toEqual({ ok: false, motivo: "sugerencia_vencida" });
  });

  it("una sugerencia de lote (sin botón) → tipo_no_disponible", () => {
    expect(validarAceptacion([s({ boton: false })], { linea_id: "l-1", entrega_id: "e-1", unidades: 500 })).toEqual({ ok: false, motivo: "tipo_no_disponible" });
  });
});

describe("% directo observado (regla 4d y 27)", () => {
  it("JH con Ing = 384, Rec = 0 y V = 480 → 0,80 (fracción); V = 0 → null", () => {
    expect(pctDirectoObservado(384, 0, 480)).toBeCloseTo(0.8, 10);
    expect(pctDirectoObservado(384, 0, 0)).toBeNull();
    expect(pctDirectoObservado(100, 150, 480)).toBe(0);
  });

  it("sale en puntos 0–100 armado con armarPctDirectoObservado: { periodo, valor: 80 }, nunca 0,8", () => {
    expect(armarPctDirectoObservado("2026-09", pctDirectoObservado(384, 0, 480))).toEqual({ periodo: "2026-09", valor: 80 });
    expect(armarPctDirectoObservado("2026-09", null)).toBeNull();
  });

  it("el agregado de doce meses es Σ max(0, Ing − Rec) ÷ Σ V, en puntos, y solo cuenta los meses con mes anterior", () => {
    const meses = [
      { periodo: "2026-07", ingreso_inferido: null, recepciones_registradas: 0, venta: 480 },
      { periodo: "2026-08", ingreso_inferido: 300, recepciones_registradas: 100, venta: 480 },
      { periodo: "2026-09", ingreso_inferido: 384, recepciones_registradas: 0, venta: 480 },
    ];
    // (200 + 384) ÷ 960 = 60,83 %
    expect(pctDirectoObservado12m(meses)).toEqual({ desde: "2026-08", hasta: "2026-09", valor: 60.83 });
    expect(pctDirectoObservado12m([])).toBeNull();
    expect(pctDirectoObservado12m([{ periodo: "2026-08", ingreso_inferido: 10, recepciones_registradas: 0, venta: 0 }])).toBeNull();
  });
});
