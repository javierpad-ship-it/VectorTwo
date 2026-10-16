import { describe, expect, it } from "vitest";
import { armarExplicacionF, curvaF, explicarF, lambdaContraccion, pesosRecencia, rhoDe, type EvaluacionF } from "@/lib/curvas/avanzada";
import { eat } from "@/lib/curvas/backtesting";
import { calcularCandidatas, curvaA, curvaC, marcarIguales, type AnioAjuste } from "@/lib/curvas/candidatas";
import { huellaCalculo, parametrosCanonicos } from "@/lib/curvas/huellas";
import { VERSION_MODELO, ajustarFPliegue, curvaTDe, recomendar } from "@/lib/curvas/modelo";
import { normalizarCurva } from "@/lib/curvas/anios";
import { evaluarEstadoVigente } from "@/lib/curvas/obsolescencia";
import { parametrosDeJson, resumenParametros } from "@/lib/curvas/reglas";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import { P2, P3, S, S_2023, S_2025, T_TEMPORADA, calcularAvanzada } from "./curvas.avanzada.fixture";

const frac = (pct: readonly number[]) => pct.map((x) => x / 100);
const anio = (a: number, pct: readonly number[], extra: Partial<AnioAjuste> = {}): AnioAjuste => ({ anio: a, participacion: frac(pct), unidades_total: 1200, tiendas: [], ...extra });
const cercanos = (a: readonly number[], b: readonly number[], d = 6) => a.forEach((v, m) => expect(v).toBeCloseTo(b[m], d));

describe("regla 79 · pesosRecencia", () => {
  it("con dos años y 0.75: 3/7 y 4/7", () => {
    const p = pesosRecencia([2024, 2025], 0.75);
    expect(p[0]).toBeCloseTo(3 / 7, 12);
    expect(p[1]).toBeCloseTo(4 / 7, 12);
  });
  it("con tres años: 0.5625, 0.75 y 1 entre 2.3125 (24 / 32 / 43 %)", () => {
    const p = pesosRecencia([2023, 2024, 2025], 0.75);
    cercanos(p, [0.5625 / 2.3125, 0.75 / 2.3125, 1 / 2.3125], 12);
    expect(p.map((x) => Math.round(x * 100))).toEqual([24, 32, 43]);
  });
  it("con recencia 1 son iguales; siempre suman 1; no dependen del orden de entrada", () => {
    expect(pesosRecencia([2023, 2024, 2025, 2026], 1)).toEqual([0.25, 0.25, 0.25, 0.25]);
    for (const r of [0.5, 0.6, 0.75, 0.9, 1]) expect(pesosRecencia([2023, 2024, 2025], r).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(pesosRecencia([2025, 2023, 2024], 0.75)).toEqual(pesosRecencia([2023, 2024, 2025], 0.75));
    expect(pesosRecencia([], 0.75)).toEqual([]);
  });
});

describe("regla 80 · lambdaContraccion", () => {
  it("los valores de la ficha", () => {
    expect(lambdaContraccion(16 / 3, 4.7568, 3)).toBeCloseTo(0.2953, 4);
    expect(lambdaContraccion(4, 6.2857, 2)).toBeCloseTo(0.1684, 4);
    expect(lambdaContraccion(8, 4.5714, 2)).toBeCloseTo(0.6049, 4);
    expect(lambdaContraccion(30, 10, 2)).toBeCloseTo(0.8182, 4);
  });
  it("casos límite: δ = 0 → 1; δ > 0 y ρ = 0 → 0; sin T → 0; nunca fuera de [0, 1]", () => {
    expect(lambdaContraccion(5, 0, 3)).toBe(1);
    expect(lambdaContraccion(0, 2, 3)).toBe(0);
    expect(lambdaContraccion(null, 2, 3)).toBe(0);
    expect(lambdaContraccion(5, null, 3)).toBe(0);
    expect(lambdaContraccion(0, 0, 3)).toBe(1);
    for (const rho of [0, 0.1, 5, 100, 1e6]) {
      for (const delta of [0, 1e-9, 0.5, 20, 200]) {
        for (const n of [2, 3, 5]) {
          const l = lambdaContraccion(rho, delta, n);
          expect(l).toBeGreaterThanOrEqual(0);
          expect(l).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("rhoDe", () => {
  it("promedio de EAT entre pares de años normales: (4 + 4 + 8) ÷ 3", () => {
    expect(rhoDe([anio(2023, S_2023), anio(2024, S), anio(2025, S_2025)])).toBeCloseTo(16 / 3, 9);
  });
  it("con menos de dos normales, el promedio de todos los pares; con un solo año, null", () => {
    const sinNormales = [anio(2023, S_2023, { normal: false }), anio(2024, S, { normal: false }), anio(2025, S_2025, { normal: true })];
    expect(rhoDe(sinNormales)).toBeCloseTo(16 / 3, 9);
    expect(rhoDe([anio(2024, S)])).toBeNull();
    expect(rhoDe([])).toBeNull();
  });
  it("solo los normales cuentan cuando hay dos o más", () => {
    expect(rhoDe([anio(2023, S_2023, { normal: false }), anio(2024, S), anio(2025, S_2025)])).toBeCloseTo(4, 9);
  });
});

describe("regla 82 · curvaF con P3", () => {
  const ajuste = [anio(2023, S_2023), anio(2024, S), anio(2025, S_2025)];
  const t = normalizarCurva(frac(T_TEMPORADA));
  const r = curvaF(ajuste, rhoDe(ajuste), t, 0.75)!;
  it("reproduce pesos, base, δ, λ y la curva contraída del caso 42", () => {
    expect(r.detalle.pesos_anios.map((p) => p.anio)).toEqual([2023, 2024, 2025]);
    expect(r.detalle.pesos_anios.map((p) => Math.round(p.peso * 100))).toEqual([24, 32, 43]);
    expect(r.detalle.base[4] * 100).toBeCloseTo(11.6216, 3);
    expect(r.detalle.base[5] * 100).toBeCloseTo(14.3784, 3);
    expect(r.detalle.delta).toBeCloseTo(4.7568, 3);
    expect(r.detalle.lambda).toBeCloseTo(0.2953, 4);
    cercanos(r.curva.map((x) => x * 100), [4, 4, 6.5906, 8, 11.7333, 14.2667, 14, 12, 10, 6.4094, 5, 4], 3);
    expect(r.curva.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(r.detalle.contraida).toEqual(r.curva);
  });
  it("sin T no contrae (λ = 0, δ = null); con recencia 1 es idéntica a A y se marca igual_a = A", () => {
    const sinT = curvaF(ajuste, rhoDe(ajuste), null, 1)!;
    expect([sinT.detalle.lambda, sinT.detalle.delta, sinT.detalle.t_usada]).toEqual([0, null, null]);
    expect(sinT.curva).toEqual(curvaA(ajuste));
    const crudas = calcularCandidatas(ajuste, 1, { recencia: 1, t: null, rho: rhoDe(ajuste) });
    expect(marcarIguales(crudas).get("F")).toBe("A");
  });
  it("con recencia 0.5 y dos años la base coincide con C (1/3 y 2/3); con 0.75 nunca", () => {
    const dos = [anio(2024, S), anio(2025, S_2025)];
    cercanos(curvaF(dos, 4, null, 0.5)!.curva, curvaC(dos)!, 6);
    const c = curvaC(dos)!;
    const f = curvaF(dos, 4, null, 0.75)!.curva;
    expect(Math.max(...f.map((v, m) => Math.abs(v - c[m])))).toBeGreaterThan(1e-3);
  });
  it("sin años de ajuste, null", () => {
    expect(curvaF([], null, t, 0.75)).toBeNull();
  });
  it("δ = 0 → λ = 1: F es T; ρ = 0 y δ > 0 → F es la base", () => {
    const iguales = curvaF([anio(2024, S), anio(2025, S)], 0, normalizarCurva(frac(S)), 0.75)!;
    expect(iguales.detalle.lambda).toBe(1);
    cercanos(iguales.curva, normalizarCurva(frac(S)), 6);
    const sinRuido = curvaF([anio(2024, S), anio(2025, S)], 0, t, 0.75)!;
    expect(sinRuido.detalle.lambda).toBe(0);
    cercanos(sinRuido.curva, normalizarCurva(frac(S)), 6);
  });
});

describe("regla 85 · explicarF", () => {
  const ajuste = [anio(2023, S_2023), anio(2024, S), anio(2025, S_2025)];
  const t = normalizarCurva(frac(T_TEMPORADA));
  const detalle = curvaF(ajuste, rhoDe(ajuste), t, 0.75)!.detalle;
  const evaluacion: EvaluacionF = { eat: 5.128, pruebas: 3, eat_a: 4, margen: 1.333, recomendada: "A" };
  it("la frase del caso 44 (es-PE)", () => {
    expect(explicarF(detalle, "invierno", 3, evaluacion)).toBe(
      "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque sus años normales difieren 5.3 pp entre sí y su curva está a 4.8 pp de la de la temporada. Se equivoca 5.1 pp en 3 pruebas frente a 4.0 de A; no mejora a A: se recomienda A."
    );
  });
  it("sin evaluación solo trae la primera parte", () => {
    expect(explicarF(detalle, "verano", 3)).toMatch(/^F se apoya en 2023 \(24 %\).*hacia la curva de verano \(T\).*temporada\.$/);
  });
  it("sin T: «no contrae: la temporada no tiene serie»", () => {
    const sinT = curvaF(ajuste, rhoDe(ajuste), null, 0.75)!.detalle;
    expect(explicarF(sinT, "invierno", 3)).toContain("no contrae: la temporada no tiene serie");
  });
  it("λ ≥ 0.9: «casi es la curva de la temporada»; λ = 0.8182 no", () => {
    const casi = { ...detalle, lambda: 0.95 };
    expect(explicarF(casi, "invierno", 3)).toContain("casi es la curva de la temporada");
    expect(explicarF({ ...detalle, lambda: 0.8182 }, "invierno", 3)).not.toContain("casi es la curva");
  });
  it("con n = 2: «se muestra pero no compite…»", () => {
    expect(explicarF(detalle, "invierno", 2)).toContain("se muestra pero no compite: con un solo año de entrenamiento por prueba no hay backtesting honesto");
  });
  it("cuando F gana por más del margen dice que mejora y que se recomienda F; si no llega, que no llega al margen", () => {
    expect(explicarF(detalle, "invierno", 3, { eat: 2, pruebas: 3, eat_a: 4, margen: 1, recomendada: "F" })).toContain("mejora a A en 2.0 pp, más que el margen (1.0): se recomienda F.");
    expect(explicarF(detalle, "invierno", 3, { eat: 3.5, pruebas: 3, eat_a: 4, margen: 1, recomendada: "A" })).toContain("mejora a A en 0.5 pp, pero no llega al margen (1.0): se recomienda A.");
  });
  it("armarExplicacionF copia pesos, ρ, δ, λ y los pliegues", () => {
    const e = armarExplicacionF(detalle, "x");
    expect([e.rho, e.delta, e.lambda, e.frase, e.anios]).toEqual([detalle.rho, detalle.delta, detalle.lambda, "x", detalle.pesos_anios]);
  });
});

describe("casos 42 a 44 · P3 de punta a punta", () => {
  const { agrupacion: a, temporada } = calcularAvanzada({ anios: P3 });
  const c = (m: string) => a.candidatas.find((x) => x.modelo === m)!;
  it("ruido_normal = (4 + 4 + 8) ÷ 3 y margen = 0.25 × 5.333", () => {
    expect(a.ruido_normal).toBeCloseTo(5.3333, 3);
    expect(a.margen).toBeCloseTo(1.3333, 3);
    cercanos((temporada?.curva_T ?? []).map((x) => x * 100), T_TEMPORADA, 6);
  });
  it("las candidatas salen en el orden A, B, C, D, E, F, T", () => {
    expect(a.candidatas.map((x) => x.modelo)).toEqual(["A", "B", "C", "D", "E", "F", "T"]);
  });
  it("F: detalle_f reproduce el caso 44 (pesos, ρ, δ, λ, T y los pliegues con su ρ y λ)", () => {
    const d = c("F").detalle_f!;
    expect(d.pesos_anios.map((p) => [p.anio, Math.round(p.peso * 10000) / 10000])).toEqual([[2023, 0.2432], [2024, 0.3243], [2025, 0.4324]]);
    expect(d.rho).toBeCloseTo(5.3333, 3);
    expect(d.delta).toBeCloseTo(4.7568, 3);
    expect(d.lambda).toBeCloseTo(0.2953, 4);
    cercanos((d.t_usada ?? []).map((x) => x * 100), T_TEMPORADA, 6);
    expect(d.por_pliegue.map((p) => [p.anio_prueba, p.rho])).toEqual([[2023, 4], [2024, 8], [2025, 4]]);
    cercanos(d.por_pliegue.map((p) => p.lambda), [0.1684, 0.6049, 0.1968], 4);
    cercanos(d.por_pliegue.map((p) => p.eat), [6.574, 2.645, 6.164], 2);
    cercanos(d.contraida.map((x) => x * 100), [4, 4, 6.5906, 8, 11.7333, 14.2667, 14, 12, 10, 6.4094, 5, 4], 3);
  });
  it("backtesting pliegue a pliegue: EAT_F 5.128, EAT_A 4.0, EAT_T 6.667", () => {
    expect(c("F").eat).toBeCloseTo(5.128, 2);
    expect(c("A").eat).toBeCloseTo(4, 6);
    expect(c("T").eat).toBeCloseTo(6.6667, 3);
    expect([c("F").pruebas, c("T").pruebas, c("A").pruebas]).toEqual([3, 3, 3]);
    // El pliegue «sin 2023»: A → 6.0 y T → 8.0 (caso 43).
    expect(c("A").eat_por_pliegue.find((p) => p.anio === 2023)?.eat).toBeCloseTo(6, 6);
    expect(c("T").eat_por_pliegue.find((p) => p.anio === 2023)?.eat).toBeCloseTo(8, 6);
    expect(c("A").eat_por_pliegue.find((p) => p.anio === 2024)?.eat).toBeCloseTo(0, 6);
  });
  it("regla 84: gana A (menor_error) aunque F y T tengan EAT; la frase de F dice que no mejora", () => {
    expect([a.recomendada, a.motivo_recomendacion, a.origen]).toEqual(["A", "menor_error", "propia"]);
    expect(c("F").explicacion_f?.frase).toBe(
      "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque sus años normales difieren 5.3 pp entre sí y su curva está a 4.8 pp de la de la temporada. Se equivoca 5.1 pp en 3 pruebas frente a 4.0 de A; no mejora a A: se recomienda A."
    );
    expect(c("F").explicacion_f?.por_pliegue).toEqual(c("F").detalle_f?.por_pliegue);
  });
  it("cada candidata con curva lleva su EAT en muestra (la curva completa contra sus años): A 2.667 con tres años", () => {
    expect(c("A").eat_en_muestra).toBeCloseTo(2.6667, 3);
    for (const x of a.candidatas) expect(x.eat_en_muestra).not.toBeNull();
  });
  it("T y F también llevan EAT parcial del año en curso e «Igual a» cuando coinciden con una anterior", () => {
    expect(c("T").eat_parcial).not.toBeNull();
    expect(c("F").eat_parcial).not.toBeNull();
    expect(c("B").igual_a).toBe("A");
    expect(c("E").igual_a).toBe("A");
    expect(c("T").igual_a).toBeNull();
  });
});

describe("caso 45 · P2: dos años de ajuste", () => {
  const { agrupacion: a } = calcularAvanzada({ anios: P2 });
  const c = (m: string) => a.candidatas.find((x) => x.modelo === m)!;
  it("F existe pero no compite: eat null, pruebas 0, motivo «sin_backtesting_honesto»; la curva es la q del pliegue «sin 2023»", () => {
    const f = c("F");
    expect([f.eat, f.error_max, f.pruebas, f.pliegues, f.motivo]).toEqual([null, null, 0, 0, "sin_backtesting_honesto"]);
    expect(f.curva).not.toBeNull();
    expect(f.detalle_f?.pesos_anios.map((p) => p.peso)[0]).toBeCloseTo(3 / 7, 5);
    expect(f.detalle_f?.rho).toBeCloseTo(4, 5);
    expect(f.detalle_f?.lambda).toBeCloseTo(0.1684, 4);
    expect(f.detalle_f?.por_pliegue).toEqual([]);
    cercanos(
      (f.curva as number[]).map((x) => x * 100),
      [4, 4, 6.3367, 8, 11.0496, 14.9504, 14, 12, 10, 6.6632, 5, 4],
      3
    );
    expect(f.explicacion_f?.frase).toContain("se muestra pero no compite");
  });
  it("A = S con mayo 11 y junio 15, EAT 4.0 (dos pliegues); T 6.0; margen 1.0 → A", () => {
    expect(c("A").eat).toBeCloseTo(4, 6);
    expect(c("A").pruebas).toBe(2);
    expect(c("T").eat).toBeCloseTo(6, 6);
    expect(a.margen).toBeCloseTo(1, 6);
    expect(a.recomendada).toBe("A");
  });
  it("si T fuera la A del pliegue (δ de A a T = 0) hay empate con A: EAT_T = (4 + 4) ÷ 2 = 4.0 y gana A", () => {
    // La temporada sigue a la propia agrupación (año a año), así que la T del pliegue es la A del pliegue.
    const r = calcularAvanzada({ anios: P2, temporada: { 2024: S, 2025: S_2025, 2026: S } });
    const t = r.agrupacion.candidatas.find((x) => x.modelo === "T")!;
    expect(t.eat).toBeCloseTo(4, 6);
    expect(r.agrupacion.candidatas.find((x) => x.modelo === "A")!.eat).toBeCloseTo(4, 6);
    expect(r.agrupacion.recomendada).toBe("A");
  });
  it("F con un solo año de ajuste es null como las demás propias; T sigue siendo la propuesta (prestada)", () => {
    const r = calcularAvanzada({ anios: { 2025: S_2025, 2026: S } });
    const f = r.agrupacion.candidatas.find((x) => x.modelo === "F")!;
    expect([f.curva, f.motivo]).toEqual([null, "sin_anos_ajuste"]);
    expect([r.agrupacion.recomendada, r.agrupacion.motivo_recomendacion, r.agrupacion.origen]).toEqual(["T", "prestada", "prestada"]);
  });
});

describe("regla 81 · sin fuga de información", () => {
  const { agrupacion: a, temporada } = calcularAvanzada({ anios: P3 });
  const ajuste: AnioAjuste[] = a.anios.filter((x) => x.en_ajuste).map((x) => ({ anio: x.anio, participacion: x.participacion as number[], unidades_total: x.unidades, tiendas: [], normal: x.clase === "normal" }));
  const delTemporada: AnioAjuste[] = (temporada?.anios ?? []).filter((x) => x.en_ajuste).map((x) => ({ anio: x.anio, participacion: x.participacion as number[], unidades_total: x.unidades, tiendas: [] }));

  it("cambiar el año de prueba (misma forma o con mayo distinto, en el ajuste y en la serie de la temporada) no cambia ρ, λ ni la curva de su pliegue", () => {
    const base = ajustarFPliegue({ ajuste, aniosTemporada: delTemporada, entrenamiento: [2024, 2025], prueba: 2023, recencia: 0.75 })!;
    const tocar = (lista: AnioAjuste[], f: (p: number[]) => number[]) => lista.map((x) => (x.anio === 2023 ? { ...x, participacion: f([...x.participacion]), unidades_total: x.unidades_total * 1.1 } : x));
    const mayoDistinto = (p: number[]) => {
      const q = [...p];
      q[4] += 0.05;
      q[5] -= 0.05;
      return q;
    };
    for (const f of [(p: number[]) => p, mayoDistinto]) {
      const r = ajustarFPliegue({ ajuste: tocar(ajuste, f), aniosTemporada: tocar(delTemporada, f), entrenamiento: [2024, 2025], prueba: 2023, recencia: 0.75 })!;
      expect(r.detalle.rho).toBe(base.detalle.rho);
      expect(r.detalle.lambda).toBe(base.detalle.lambda);
      expect(r.curva).toEqual(base.curva);
    }
    expect(base.detalle.rho).toBeCloseTo(4, 9);
    expect(base.detalle.lambda).toBeCloseTo(0.1684, 4);
  });
  it("sí cambia el EAT medido contra el año de prueba", () => {
    const real = ajuste.find((x) => x.anio === 2023)!.participacion;
    const f = ajustarFPliegue({ ajuste, aniosTemporada: delTemporada, entrenamiento: [2024, 2025], prueba: 2023, recencia: 0.75 })!;
    const otro = real.map((v, m) => (m === 4 ? v + 0.05 : m === 5 ? v - 0.05 : v));
    expect(eat(f.curva, otro)).not.toBeCloseTo(eat(f.curva, real), 3);
  });
  it("curvaTDe excluye el año de prueba (T del pliegue) y con todos excluidos es null", () => {
    const sinTemporada = [anio(2023, S_2023), anio(2024, S)];
    expect(curvaTDe(sinTemporada, 2023)).toEqual(curvaA([anio(2024, S)]));
    expect(curvaTDe(sinTemporada)).toEqual(curvaA(sinTemporada));
    expect(curvaTDe([anio(2024, S)], 2024)).toBeNull();
    expect(curvaTDe([], 2024)).toBeNull();
  });
  it("con un solo año de entrenamiento no hay pliegue de F", () => {
    expect(ajustarFPliegue({ ajuste, aniosTemporada: delTemporada, entrenamiento: [2024], prueba: 2023, recencia: 0.75 })).toBeNull();
  });
});

describe("regla 83 · T con backtesting", () => {
  it("T.eat es el promedio de EAT(T del pliegue, real); en P3: (8 + 4 + 8) ÷ 3; sin años de temporada en un pliegue, ese pliegue se omite", () => {
    const { agrupacion } = calcularAvanzada({ anios: P3 });
    const t = agrupacion.candidatas.find((x) => x.modelo === "T")!;
    expect(t.eat_por_pliegue.map((p) => [p.anio, Math.round(p.eat * 1000) / 1000])).toEqual([[2023, 8], [2024, 4], [2025, 8]]);
    expect(t.eat).toBeCloseTo(20 / 3, 6);
    expect(t.pruebas).toBe(3);
  });
  it("T sin serie utilizable: sin curva ni EAT (sin_anos_utilizables) y F no contrae", () => {
    const { agrupacion } = calcularAvanzada({ anios: P3, temporada: null });
    const t = agrupacion.candidatas.find((x) => x.modelo === "T")!;
    expect([t.curva, t.eat, t.pruebas, t.motivo]).toEqual([null, null, 0, "sin_anos_utilizables"]);
    const f = agrupacion.candidatas.find((x) => x.modelo === "F")!;
    expect([f.detalle_f?.t_usada, f.detalle_f?.delta, f.detalle_f?.lambda]).toEqual([null, null, 0]);
    expect(f.explicacion_f?.frase).toContain("no contrae: la temporada no tiene serie");
  });
  it("un pliegue sin ningún año de temporada de entrenamiento se omite (como en las demás)", () => {
    // La temporada solo tiene 2023: al dejar 2023 fuera no queda T, así que T solo se mide en 2024 y 2025.
    const { agrupacion } = calcularAvanzada({ anios: P3, temporada: { 2023: S } });
    const t = agrupacion.candidatas.find((x) => x.modelo === "T")!;
    expect(t.eat_por_pliegue.map((p) => p.anio)).toEqual([2024, 2025]);
    expect(t.pruebas).toBe(2);
  });
});

describe("regla 84 · recomendar con F y T", () => {
  const cand = (modelo: "A" | "B" | "C" | "D" | "E" | "F" | "T", eatV: number | null, curva: number[] | null = Array(12).fill(1 / 12)) => ({ modelo, curva, eat: eatV });
  const margen = 1.333;
  const ruido = 5.3333;
  it("P3: EAT_A 4.0, EAT_F 5.128, EAT_T 6.667 → A (menor_error, es la mejor)", () => {
    const r = recomendar([cand("A", 4), cand("F", 5.128), cand("T", 6.667)], ruido, 0.25);
    expect([r.recomendada, r.motivo, r.mejor]).toEqual(["A", "menor_error", "A"]);
    expect(r.margen).toBeCloseTo(margen, 3);
  });
  it("EAT_F = EAT_A − 1.0 sigue A (sin_evidencia); EAT_F = EAT_A − 2.0 → F (menor_error)", () => {
    const poco = recomendar([cand("A", 4), cand("F", 3)], ruido, 0.25);
    expect([poco.recomendada, poco.motivo, poco.mejor]).toEqual(["A", "sin_evidencia", "F"]);
    const mucho = recomendar([cand("A", 4), cand("F", 2)], ruido, 0.25);
    expect([mucho.recomendada, mucho.motivo]).toEqual(["F", "menor_error"]);
  });
  it("T gana solo si supera el margen (T prestada); si F también mejora pero T es la mejor, T", () => {
    const t = recomendar([cand("A", 4), cand("F", 3.9), cand("T", 2)], ruido, 0.25);
    expect([t.recomendada, t.motivo, t.mejor]).toEqual(["T", "menor_error", "T"]);
    const noLlega = recomendar([cand("A", 4), cand("T", 3)], ruido, 0.25);
    expect([noLlega.recomendada, noLlega.motivo]).toEqual(["A", "sin_evidencia"]);
  });
  it("orden de desempate A, B, C, D, E, F, T: con empate gana la primera", () => {
    expect(recomendar([cand("A", 4), cand("F", 4), cand("T", 4)], ruido, 0.25).recomendada).toBe("A");
    expect(recomendar([cand("A", 6), cand("B", 2), cand("F", 2), cand("T", 2)], ruido, 0.25).recomendada).toBe("B");
    expect(recomendar([cand("A", 6), cand("F", 2), cand("T", 2)], ruido, 0.25).recomendada).toBe("F");
  });
  it("F sin EAT (dos años) no compite; T nunca se recomienda sin EAT salvo que no haya propias (prestada)", () => {
    const sinEatF = recomendar([cand("A", 4), cand("F", null), cand("T", 6)], ruido, 0.25);
    expect(sinEatF.recomendada).toBe("A");
    const tSinEat = recomendar([cand("A", 4), cand("T", null)], ruido, 0.25);
    expect(tSinEat.recomendada).toBe("A");
    const sinPropias = recomendar([cand("A", null, null), cand("T", null)], ruido, 0.25);
    expect([sinPropias.recomendada, sinPropias.motivo, sinPropias.margen]).toEqual(["T", "prestada", null]);
    expect(recomendar([cand("A", null, null), cand("T", null, null)], ruido, 0.25).recomendada).toBeNull();
  });
  it("el margen sigue siendo max(0.05, margen_ruido × ruido)", () => {
    expect(recomendar([cand("A", 4), cand("F", 3)], null, 0.25).margen).toBe(0.05);
    expect(recomendar([cand("A", 4), cand("F", 3)], 8, 0.25).margen).toBeCloseTo(2, 9);
  });
});

describe("caso 46 · agrupación pequeña y año del Niño", () => {
  it("ρ = 30, δ = 10, n = 2 → λ = 0.8182 (no llega a «casi es la curva de la temporada»)", () => {
    const l = lambdaContraccion(30, 10, 2);
    expect(l).toBeCloseTo(0.8182, 4);
    const detalle = curvaF([anio(2024, S), anio(2025, S_2025)], 30, normalizarCurva(frac(T_TEMPORADA)), 0.75)!.detalle;
    expect(explicarF({ ...detalle, lambda: l }, "invierno", 2)).not.toContain("casi es la curva");
  });
  it("un año atípico descartado no entra: F se ajusta con los demás como A (tratamiento descartar)", () => {
    const periodos = [{ id: "nino-2023", desde: "2023-01", hasta: "2023-12", motivo: "Niño", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true }];
    const r = calcularAvanzada({ anios: P3, periodos, parametros: { tratamiento_atipicos: "descartar" } });
    expect(r.agrupacion.anios.find((x) => x.anio === 2023)?.tratamiento).toBe("descartado");
    const f = r.agrupacion.candidatas.find((x) => x.modelo === "F")!;
    expect(f.detalle_f?.pesos_anios.map((p) => p.anio)).toEqual([2024, 2025]);
    expect(f.motivo).toBe("sin_backtesting_honesto");
  });
  it("un año imputado usa la participación imputada (entra con ella en F)", () => {
    const periodos = [{ id: "huecos-2023", desde: "2023-03", hasta: "2023-05", motivo: "Niño", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true }];
    const r = calcularAvanzada({ anios: P3, periodos, parametros: { tratamiento_atipicos: "imputar" } });
    const a2023 = r.agrupacion.anios.find((x) => x.anio === 2023)!;
    expect(a2023.tratamiento).toBe("imputado");
    expect(a2023.participacion).not.toBeNull();
    const f = r.agrupacion.candidatas.find((x) => x.modelo === "F")!;
    expect(f.detalle_f?.pesos_anios.map((p) => p.anio)).toEqual([2023, 2024, 2025]);
  });
  it("un año escaso (menos de min_unidades_ano) no entra en F", () => {
    const r = calcularAvanzada({ anios: P3, total: (a) => (a === 2023 ? 60 : 1200) });
    expect(r.agrupacion.anios.find((x) => x.anio === 2023)?.escaso).toBe(true);
    const f = r.agrupacion.candidatas.find((x) => x.modelo === "F")!;
    expect(f.detalle_f?.pesos_anios.map((p) => p.anio)).toEqual([2024, 2025]);
  });
});

describe("regla 86 · versión, huella y recencia_f", () => {
  it("VERSION_MODELO = 2", () => {
    expect(VERSION_MODELO).toBe(2);
  });
  it("una foto con version_modelo = 1 recibe modelo_anterior (aviso, no obsolescencia)", () => {
    const base = {
      red_comparable: [],
      cargas: {},
      equivalencias: 1,
      huella_composicion: "h",
      atipicos: [],
      temporada: "invierno" as const,
      version_modelo: 1,
    };
    const actual = { red_comparable: [], cargas: {}, equivalencias: 1, huella_composicion: "h", atipicos: [], temporada: "invierno" as const, tiendas: new Map() };
    const e = evaluarEstadoVigente(base, actual);
    expect(e.motivos).toEqual([]);
    expect(e.avisos.map((x) => x.codigo)).toEqual(["modelo_anterior"]);
    expect(evaluarEstadoVigente({ ...base, version_modelo: 2 }, actual).avisos).toEqual([]);
  });
  it("recencia_f entra en los parámetros canónicos y en la huella de cálculo", () => {
    expect(PARAMETROS_POR_DEFECTO.recencia_f).toBe(0.75);
    expect(parametrosCanonicos(PARAMETROS_POR_DEFECTO)).toContain('"recencia_f":0.75');
    const partes = { cargas_huella: "c", red_huella: "r", composicion_huella: "k", temporada: "invierno" as const, huella_temporada: "t", hasta_periodo: "2026-09", periodos: [] };
    const a = huellaCalculo({ ...partes, parametros: PARAMETROS_POR_DEFECTO });
    const b = huellaCalculo({ ...partes, parametros: { ...PARAMETROS_POR_DEFECTO, recencia_f: 0.9 } });
    expect(a).not.toBe(b);
  });
  it("parametrosDeJson de una foto vieja lo rellena con 0.75; resumenParametros lo lista si no es el defecto", () => {
    const vieja = { ...PARAMETROS_POR_DEFECTO } as Record<string, unknown>;
    delete vieja.recencia_f;
    expect(parametrosDeJson(vieja).recencia_f).toBe(0.75);
    expect(parametrosDeJson({ ...vieja, recencia_f: 0.9 }).recencia_f).toBe(0.9);
    expect(resumenParametros(PARAMETROS_POR_DEFECTO)).toEqual([]);
    expect(resumenParametros({ ...PARAMETROS_POR_DEFECTO, recencia_f: 0.9 })).toContain("recencia F: 0.90");
  });
  it("cambiar recencia_f cambia la curva de F del cálculo (y 1 da pesos iguales)", () => {
    const x = calcularAvanzada({ anios: P3 }).agrupacion.candidatas.find((c) => c.modelo === "F")!;
    const y = calcularAvanzada({ anios: P3, parametros: { recencia_f: 1 } }).agrupacion.candidatas.find((c) => c.modelo === "F")!;
    expect(x.curva).not.toEqual(y.curva);
    expect(y.detalle_f?.pesos_anios.every((p) => Math.abs(p.peso - 1 / 3) < 1e-6)).toBe(true);
  });
});
