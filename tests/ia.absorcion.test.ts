import { describe, expect, it } from "vitest";
import { calcularAbsorcion, type FilaAbsorcion } from "@/lib/ia/absorcion";
import { crearAleatorio } from "@/lib/ia/evaluacion";
import { asignarMeta, planMeta, type FilaMeta, type PesoFilaMeta } from "@/lib/ia/meta";
import { filasMetaA, OPCIONES_META } from "./ia.fixture";

/**
 * R5 y R7 (ficha 07e): absorción sobre el ejemplo A (ejemplos B y H). Lo guardado al generar: pesos del modelo 11 000 · 6 700 · 5 000,
 * `meta_y1_al_generar` 10 961 · 6 677 · 4 982, aporte fijo de f4 3 300 y `Meta_GM` 26 006.
 */

const MODELO: Record<string, number> = { f1: 11000, f2: 6700, f3: 5000 };
const AL_GENERAR: Record<string, number> = { f1: 10961, f2: 6677, f3: 4982 };

/** Estado de hoy a partir de las filas de M7 (con sus decisiones) y la propuesta guardada. */
function hoy(filas: FilaMeta[]) {
  const plan = planMeta({ filas, g: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: "c1", version: 1, opciones: OPCIONES_META });
  const pesos: PesoFilaMeta[] = plan.libres.map((f) => ({ fila_id: f.fila_id, clave: f.clave, p_gm: plan.p_gm.get(f.fila_id) ?? 0, meta_y1_modelo: MODELO[f.fila_id] ?? null, natural_y1: null, base_s: f.base_corregida }));
  const a = asignarMeta(plan.meta?.meta_libre ?? null, pesos).a;
  const filasAbs: FilaAbsorcion[] = filas.map((f) => ({
    fila_id: f.fila_id,
    a_hoy: a?.get(f.fila_id) ?? null,
    aporte_hoy: plan.aportes.get(f.fila_id) ?? null,
    meta_y1_al_generar: AL_GENERAR[f.fila_id] ?? null,
    aporte_fijo_al_generar: f.fila_id === "f4" ? 3300 : null,
  }));
  return { plan, a, abs: calcularAbsorcion({ filas: filasAbs, meta_gm_hoy: plan.meta?.meta_gm ?? 0, meta_gm_al_generar: 26006 }) };
}

const fijar = (filas: FilaMeta[], id: string, valor: number): FilaMeta[] => filas.map((f) => (f.fila_id === id ? { ...f, decidido: valor, vigente: valor } : f));

describe("R7 · ejemplo B: fijar f1 en 11 500", () => {
  it("absorbido −309 y −230, GM 4,62 % → no es meta_movida ni absorcion_alta", () => {
    const { abs } = hoy(fijar(filasMetaA(), "f1", 11500));
    expect(abs.filas.get("f2")?.absorbido_u).toBe(-309);
    expect(abs.filas.get("f2")?.absorbido_pct).toBeCloseTo(-4.63, 2);
    expect(abs.filas.get("f3")?.absorbido_u).toBe(-230);
    expect(abs.filas.get("f3")?.absorbido_pct).toBeCloseTo(-4.62, 2);
    expect(abs.gm.absorbido_pct).toBeCloseTo(4.62, 2);
    expect(abs.meta_movida).toBe(false);
    expect([...abs.filas.values()].some((f) => f.avisos.includes("absorcion_alta"))).toBe(false);
  });
});

describe("R7 · ejemplo H", () => {
  it("f1 en 12 000: −595 y −444, GM 8,91 % → meta_movida; ninguna fila pasa del 10 %; desglose", () => {
    const { a, abs } = hoy(fijar(filasMetaA(), "f1", 12000));
    expect([a?.get("f2"), a?.get("f3")]).toEqual([6082, 4538]);
    expect(abs.filas.get("f2")?.absorbido_u).toBe(-595);
    expect(abs.filas.get("f3")?.absorbido_u).toBe(-444);
    expect(abs.gm.absorbido_pct).toBeCloseTo(8.91, 2);
    expect(abs.meta_movida).toBe(true);
    expect(abs.avisos_gm).toEqual(["meta_movida"]);
    expect([...abs.filas.values()].some((f) => f.avisos.length > 0)).toBe(false);
    expect(abs.gm).toMatchObject({ delta_meta_u: 0, desviacion_fijadas_u: 1039, otros_u: 0, absorbido_u: -1039 });
  });

  it("f1 en 12 500: −882 (−13,21 %) y −657 (−13,19 %) → absorcion_alta en las dos", () => {
    const { a, abs } = hoy(fijar(filasMetaA(), "f1", 12500));
    expect([a?.get("f2"), a?.get("f3")]).toEqual([5795, 4325]);
    expect(abs.filas.get("f2")?.absorbido_u).toBe(-882);
    expect(abs.filas.get("f2")?.absorbido_pct).toBeCloseTo(-13.21, 2);
    expect(abs.filas.get("f3")?.absorbido_pct).toBeCloseTo(-13.19, 2);
    expect(abs.filas.get("f2")?.avisos).toEqual(["absorcion_alta"]);
    expect(abs.filas.get("f3")?.avisos).toEqual(["absorcion_alta"]);
  });

  it("decidir el 2026 de f1 (B' 10 500): Meta_GM 26 546, 11 223 · 6 836 · 5 101, GM 2,39 % → al día; delta +540", () => {
    const filas = filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, propuesto: 11340, base_corregida: 10500, vigente: 11340 } : f));
    const { plan, a, abs } = hoy(filas);
    expect(plan.meta?.meta_gm).toBe(26546);
    expect(plan.meta?.meta_libre).toBe(23160);
    expect([a?.get("f1"), a?.get("f2"), a?.get("f3")]).toEqual([11223, 6836, 5101]);
    expect([abs.filas.get("f1")?.absorbido_u, abs.filas.get("f2")?.absorbido_u, abs.filas.get("f3")?.absorbido_u]).toEqual([262, 159, 119]);
    expect(abs.gm.absorbido_pct).toBeCloseTo(2.39, 2);
    expect(abs.meta_movida).toBe(false);
    expect(abs.gm).toMatchObject({ delta_meta_u: 540, desviacion_fijadas_u: 0, otros_u: 0, absorbido_u: 540 });
  });
});

describe("R7 · umbrales", () => {
  const dosFilas = (a1: number, a2: number): FilaAbsorcion[] => [
    { fila_id: "a", a_hoy: a1, aporte_hoy: null, meta_y1_al_generar: 5000, aporte_fijo_al_generar: null },
    { fila_id: "b", a_hoy: a2, aporte_hoy: null, meta_y1_al_generar: 5000, aporte_fijo_al_generar: null },
  ];
  it("meta_movida en 5,01 % sí, en 4,99 % y en 5,00 % no", () => {
    expect(calcularAbsorcion({ filas: dosFilas(5251, 4750), meta_gm_hoy: 10001, meta_gm_al_generar: 10000 }).meta_movida).toBe(true);
    expect(calcularAbsorcion({ filas: dosFilas(5250, 4751), meta_gm_hoy: 10001, meta_gm_al_generar: 10000 }).meta_movida).toBe(false);
    expect(calcularAbsorcion({ filas: dosFilas(5250, 4750), meta_gm_hoy: 10000, meta_gm_al_generar: 10000 }).meta_movida).toBe(false);
  });
  it("absorcion_alta en 10,01 % sí, en 9,99 % y en 10,00 % no", () => {
    const una = (a: number) => calcularAbsorcion({ filas: [{ fila_id: "a", a_hoy: a, aporte_hoy: null, meta_y1_al_generar: 10000, aporte_fijo_al_generar: null }], meta_gm_hoy: a, meta_gm_al_generar: 10000 }).filas.get("a")?.avisos;
    expect(una(11001)).toEqual(["absorcion_alta"]);
    expect(una(10999)).toEqual([]);
    expect(una(11000)).toEqual([]);
    expect(una(8999)).toEqual(["absorcion_alta"]);
    expect(una(9001)).toEqual([]);
  });
  it("referencia 0: el % por fila es nulo", () => {
    const r = calcularAbsorcion({ filas: [{ fila_id: "a", a_hoy: 5, aporte_hoy: null, meta_y1_al_generar: 0, aporte_fijo_al_generar: null }], meta_gm_hoy: 5, meta_gm_al_generar: 0 });
    expect(r.filas.get("a")?.absorbido_pct).toBeNull();
    expect(r.gm.absorbido_pct).toBeNull();
    expect(r.meta_movida).toBe(false);
  });
  it("las libres nuevas y las filas que salieron caen en otros_u", () => {
    const r = calcularAbsorcion({
      filas: [
        { fila_id: "a", a_hoy: 1000, aporte_hoy: null, meta_y1_al_generar: 1000, aporte_fijo_al_generar: null },
        { fila_id: "nueva", a_hoy: 300, aporte_hoy: null, meta_y1_al_generar: null, aporte_fijo_al_generar: null },
      ],
      meta_gm_hoy: 1300,
      meta_gm_al_generar: 1000,
    });
    expect(r.gm).toMatchObject({ delta_meta_u: 300, desviacion_fijadas_u: 0, absorbido_u: 0, otros_u: 300 });
  });
});

describe("R7 · aceptar la IA y el orden", () => {
  it("aceptar la IA de una fila a su cifra vigente deja absorbido_u igual (y las demás no absorben nada)", () => {
    const antes = hoy(filasMetaA());
    expect(antes.abs.gm.absorbido_u).toBe(0);
    for (const id of ["f1", "f2", "f3"]) {
      const vigente = antes.a?.get(id) ?? 0;
      const despues = hoy(fijar(filasMetaA(), id, vigente));
      expect(despues.abs.gm.absorbido_u).toBe(antes.abs.gm.absorbido_u);
      expect(despues.abs.gm.absorbido_pct).toBe(0);
      expect(despues.abs.gm.desviacion_fijadas_u).toBe(0);
      expect(despues.abs.meta_movida).toBe(false);
      for (const otra of ["f1", "f2", "f3"].filter((x) => x !== id)) expect(despues.abs.filas.get(otra)?.absorbido_u).toBe(0);
    }
  });

  it("propiedad: el resultado no depende del orden en que se fijaron las filas", () => {
    const azar = crearAleatorio(777);
    const decisiones: [string, number][] = [["f1", 11800], ["f2", 6000]];
    const aplicar = (orden: [string, number][]) => {
      let filas = filasMetaA();
      for (const [id, v] of orden) filas = fijar(filas, id, v);
      const h = hoy(filas);
      return JSON.stringify({ gm: h.abs.gm, filas: [...h.abs.filas], a: [...(h.a ?? [])] });
    };
    const referencia = aplicar(decisiones);
    for (let i = 0; i < 20; i++) {
      const barajado = [...decisiones].sort(() => azar() - 0.5);
      expect(aplicar(barajado)).toBe(referencia);
    }
  });

  it("una fila fija al generar cuenta su desviación si hoy aporta otra cifra", () => {
    const r = calcularAbsorcion({
      filas: [{ fila_id: "f4", a_hoy: null, aporte_hoy: 3500, meta_y1_al_generar: null, aporte_fijo_al_generar: 3300 }],
      meta_gm_hoy: 26206,
      meta_gm_al_generar: 26006,
    });
    expect(r.gm).toMatchObject({ delta_meta_u: 200, desviacion_fijadas_u: 200, absorbido_u: 0, otros_u: 0 });
  });
});
