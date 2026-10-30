import { describe, expect, it } from "vitest";
import {
  bootstrapPorGM,
  COBERTURA_MIN,
  crearAleatorio,
  DEFINICION_PLIEGUE,
  eatPp,
  estabilidadEntre,
  evaluarPliegue,
  mejoraMinima,
  MIN_FILAS_D25,
  naturalMetodo,
  naturalTendencia,
  repartoMetodo,
  repartoTendencia,
  resultadosDeEvaluacion,
  SEMILLA_BOOTSTRAP,
  veredictoDistribucionY1,
  wape,
  type EntradaVeredicto,
  type FilaEvaluada,
  type GMEvaluado,
  type ResultadoPliegue,
} from "@/lib/ia/evaluacion";
import type { GrupoGeneroIa } from "@/lib/ia/tipos-api";
import { repartirEntero } from "@/lib/proyeccion/reparto";

/** R22 puro (ficha 07e, §5.4): métricas, bootstrap con semilla y veredicto de `distribucion_y1`. Sintético. */

const fila = (id: string, real: number, base_s: number, tendencia_pct: number | null, reparto_ia: number | null, natural_ia: number | null): FilaEvaluada => ({ id, real, base_s, tendencia_pct, reparto_ia, natural_ia });

/** Ejemplo D: un GM, tres filas libres, meta oráculo 1 800. */
const ejemploD: GMEvaluado = {
  clave: "g",
  grupo: "HOMBRE",
  filas: [fila("a", 1000, 900, 2, 1040, 980), fila("b", 500, 520, 10, 470, 520), fila("c", 300, 280, -10, 290, 290)],
};

describe("R22 · ejemplo D", () => {
  it("reparto del método parejo: 953 · 551 · 296 → WAPE 5,67 %", () => {
    expect(repartoMetodo(1800, ejemploD.filas)).toEqual([953, 551, 296]);
    expect(wape([953, 551, 296], [1000, 500, 300])).toBeCloseTo(102 / 1800, 10);
  });
  it("reparto de tendencia: pesos 918 · 572 · 252 → 949 · 591 · 260 → WAPE 10,11 %", () => {
    expect(repartoTendencia(1800, ejemploD.filas)).toEqual([949, 591, 260]);
    expect(wape([949, 591, 260], [1000, 500, 300])).toBeCloseTo(182 / 1800, 10);
  });
  it("natural: parejo 5,62 %, tendencia 11,22 %, IA 2,78 %", () => {
    const real = [1000, 500, 300];
    expect(naturalMetodo(1800, ejemploD.filas).map((x) => Math.round(x * 10) / 10)).toEqual([952.9, 550.6, 296.5]);
    expect(wape(naturalMetodo(1800, ejemploD.filas), real)).toBeCloseTo(0.0562, 4);
    expect(naturalTendencia(ejemploD.filas).map((x) => Math.round(x))).toEqual([918, 572, 252]);
    expect(wape(naturalTendencia(ejemploD.filas), real)).toBeCloseTo(0.1122, 4);
    expect(wape([980, 520, 290], real)).toBeCloseTo(50 / 1800, 10);
  });
  it("evaluarPliegue: rival = método, mejora 21,6 %, EAT 2,83 pp frente a 2,22 pp, natural 2,78 % ≤ 5,62 %", () => {
    const r = evaluarPliegue([ejemploD]);
    expect(r.reparto).toMatchObject({ filas: 3, gms: 1, rival: "metodo" });
    expect(r.reparto.wape_metodo).toBeCloseTo(0.0567, 4);
    expect(r.reparto.wape_tendencia).toBeCloseTo(0.1011, 4);
    expect(r.reparto.wape_ia).toBeCloseTo(0.0444, 4);
    expect(r.reparto.mejora).toBeCloseTo(0.2157, 4);
    expect(r.reparto.eat_metodo_pp).toBeCloseTo(2.83, 2);
    expect(r.reparto.eat_ia_pp).toBeCloseTo(2.22, 2);
    expect(r.natural.rival).toBe("metodo");
    expect(r.natural.wape_ia).toBeCloseTo(0.0278, 4);
    expect(r.natural.wape_rival).toBeCloseTo(0.0562, 4);
    expect(r.natural.wape_ia as number).toBeLessThanOrEqual(r.natural.wape_rival as number);
    expect(eatPp([1040, 470, 290], [1000, 500, 300])).toBeCloseTo(2.22, 2);
  });
  it("sin tendencia (D24) el rival es el método y la tendencia coincide con él", () => {
    const r = evaluarPliegue([ejemploD], { usarTendencia: false });
    expect(r.reparto.wape_tendencia).toBe(r.reparto.wape_metodo);
    expect(r.natural.rival).toBe("metodo");
  });
});

describe("R22 · métricas auxiliares", () => {
  it("una tendencia se limita a [−50 %, +100 %]; sin tendencia cuenta 0", () => {
    const f = [fila("a", 1, 100, 500, null, null), fila("b", 1, 100, -500, null, null), fila("c", 1, 100, null, null, null)];
    expect(naturalTendencia(f)).toEqual([200, 50, 100]);
  });
  it("estabilidad = Σ |A¹ − A²| ÷ Σ A¹ (por GM y fila)", () => {
    const a: GMEvaluado[] = [{ clave: "g", grupo: "MUJER", filas: [fila("x", 0, 0, null, 100, null), fila("y", 0, 0, null, 200, null)] }];
    const b: GMEvaluado[] = [{ clave: "g", grupo: "MUJER", filas: [fila("x", 0, 0, null, 110, null), fila("y", 0, 0, null, 190, null)] }];
    expect(estabilidadEntre(a, b)).toBeCloseTo(20 / 300, 10);
    expect(estabilidadEntre(a, a)).toBe(0);
    expect(estabilidadEntre(a, [])).toBeNull();
  });
  it("una fila sin respuesta se cuenta con lo del método y baja la cobertura", () => {
    const sin = { ...ejemploD, filas: ejemploD.filas.map((f, i) => (i === 0 ? { ...f, reparto_ia: null, natural_ia: null } : f)) };
    const r = evaluarPliegue([sin]);
    expect(r.cobertura).toEqual({ validas: 4, pedidas: 6 });
  });
  it("WAPE nulo si el real suma 0", () => {
    expect(wape([1, 2], [0, 0])).toBeNull();
  });
  it("los pliegues por defecto y sus cortes", () => {
    expect(DEFINICION_PLIEGUE.D25).toEqual({ corte: "2024-12", anio_en_curso: 2024, k: 12, predice: 2025 });
    expect(DEFINICION_PLIEGUE.E25).toEqual(DEFINICION_PLIEGUE.D25);
    expect(DEFINICION_PLIEGUE.D24.corte).toBe("2023-12");
  });
});

describe("R22 · bootstrap por GM", () => {
  const gms = Array.from({ length: 12 }, (_, i) => ({ real: 1000 + i * 37, e_metodo: 90 + (i % 5) * 8, e_tendencia: 110 + (i % 3) * 5, e_ia: 40 + (i % 4) * 6 }));
  it("la misma semilla da el mismo percentil dos veces; otra semilla, otro valor", () => {
    const a = bootstrapPorGM(gms);
    const b = bootstrapPorGM(gms);
    expect(a).toEqual(b);
    expect(a.semilla).toBe(SEMILLA_BOOTSTRAP);
    expect(a.remuestreos).toBe(1000);
    expect(bootstrapPorGM(gms, 1000, 1).p5).not.toBe(a.p5);
  });
  it("IA claramente mejor: p5 > 0; IA peor: p5 < 0", () => {
    const mejor = bootstrapPorGM(gms);
    expect(mejor.p5).toBeGreaterThan(0);
    expect(mejor.p5 as number).toBeLessThan(mejor.p95 as number);
    const peor = bootstrapPorGM(gms.map((g) => ({ ...g, e_ia: g.e_metodo * 1.5 })));
    expect((peor.p95 as number)).toBeLessThan(0);
  });
  it("sin GM con real, todo nulo", () => {
    expect(bootstrapPorGM([])).toMatchObject({ p5: null, p95: null, media: null });
  });
  it("el generador es determinista", () => {
    const a = crearAleatorio(5);
    const b = crearAleatorio(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

// ─── Un pliegue sintético con la IA claramente mejor que sus rivales ───

function pliegueSintetico(opciones: { semilla: number; ruidoIA: number; gms?: number }): GMEvaluado[] {
  const azar = crearAleatorio(opciones.semilla);
  const grupos: GrupoGeneroIa[] = ["HOMBRE", "MUJER", "RESTO"];
  const salida: GMEvaluado[] = [];
  for (let g = 0; g < (opciones.gms ?? 9); g++) {
    const n = 8;
    const base = Array.from({ length: n }, () => 200 + Math.floor(azar() * 1800));
    const crecimiento = Array.from({ length: n }, () => -0.1 + azar() * 0.4);
    const real = base.map((b, i) => Math.round(b * (1 + crecimiento[i])));
    const meta = real.reduce((a, b) => a + b, 0);
    const ia = repartirEntero(
      meta,
      real.map((r) => Math.max(1, r * (1 + (azar() - 0.5) * 2 * opciones.ruidoIA)))
    ) as number[];
    salida.push({
      clave: `g${g}`,
      grupo: grupos[g % 3],
      filas: base.map((b, i) => fila(`f${String(i).padStart(2, "0")}`, real[i], b, crecimiento[i] * 30 + (azar() - 0.5) * 20, ia[i], Math.round(real[i] * (1 + (azar() - 0.5) * 2 * opciones.ruidoIA)))),
    });
  }
  return salida;
}

describe("R22 · veredicto", () => {
  const d25Gana = pliegueSintetico({ semilla: 1, ruidoIA: 0.02 });
  const e25Gana = d25Gana.map((g) => ({ ...g, filas: g.filas.map((f) => ({ ...f, reparto_ia: (f.reparto_ia ?? 0) + (f.id === "f00" ? 1 : 0) })) }));
  const d24Gana = pliegueSintetico({ semilla: 2, ruidoIA: 0.02, gms: 6 });
  const ok25 = evaluarPliegue(d25Gana);
  const ok24 = evaluarPliegue(d24Gana, { usarTendencia: false });
  const base: EntradaVeredicto = { d25: ok25, d24: ok24, estabilidad: 0.02, mejora_min: 0.05 };
  const con = (parche: Partial<EntradaVeredicto>) => veredictoDistribucionY1({ ...base, ...parche });
  const conD25 = (parche: Partial<ResultadoPliegue>) => con({ d25: { ...ok25, ...parche } });

  it("con todas las condiciones, gana (y la IA del pliegue sintético supera de verdad a los rivales)", () => {
    expect(ok25.reparto.filas).toBeGreaterThanOrEqual(MIN_FILAS_D25);
    expect(ok25.reparto.mejora).toBeGreaterThan(0.5);
    expect(ok25.bootstrap.p5).toBeGreaterThan(0);
    expect(ok25.gms_evaluados).toBe(9);
    expect(ok25.gms_ganados).toBe(9);
    expect(con({})).toEqual({ distribucion_y1: "gana", regla_que_fallo: null });
  });

  it("resultadosDeEvaluacion arma los resultados y el veredicto de punta a punta", () => {
    const r = resultadosDeEvaluacion({ d25: d25Gana, e25: e25Gana, d24: d24Gana, mejora_min: 0.05 });
    expect(r.veredicto).toEqual({ distribucion_y1: "gana", regla_que_fallo: null });
    expect(r.resultados.estabilidad).toBeLessThan(0.05);
    expect(r.resultados.cobertura).toBe(1);
    expect(r.resultados.d25?.por_genero.HOMBRE.filas).toBeGreaterThan(0);
    expect(r.resultados.d24?.reparto.rival).toBe("metodo");
    // Misma entrada y semilla: mismo resultado.
    expect(resultadosDeEvaluacion({ d25: d25Gana, e25: e25Gana, d24: d24Gana, mejora_min: 0.05 })).toEqual(r);
  });

  it("1 · mejora sobre el mejor rival: 4,9 % falla con MEJORA_MIN 0,05; 9,9 % falla con 0,10; el límite exacto pasa", () => {
    const mej = (mejora: number, min: number) => con({ d25: { ...ok25, reparto: { ...ok25.reparto, mejora } }, mejora_min: min });
    expect(mej(0.049, 0.05)).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "mejora" });
    expect(mej(0.099, 0.1)).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "mejora" });
    expect(mej(0.05, 0.05).distribucion_y1).toBe("gana");
    expect(mej(0.1, 0.1).distribucion_y1).toBe("gana");
    expect(mej(0.099, 0.05).distribucion_y1).toBe("gana");
    expect(conD25({ reparto: { ...ok25.reparto, mejora: null } }).regla_que_fallo).toBe("mejora");
  });

  it("2 · bootstrap: percentil 5 ≤ 0 falla", () => {
    expect(conD25({ bootstrap: { ...ok25.bootstrap, p5: 0 } })).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "bootstrap" });
    expect(conD25({ bootstrap: { ...ok25.bootstrap, p5: -0.001 } }).regla_que_fallo).toBe("bootstrap");
    expect(conD25({ bootstrap: { ...ok25.bootstrap, p5: null } }).regla_que_fallo).toBe("bootstrap");
    expect(conD25({ bootstrap: { ...ok25.bootstrap, p5: 0.0001 } }).distribucion_y1).toBe("gana");
  });

  it("3 · gana en menos de la mitad de los GM con ≥ 5 filas libres: falla; en la mitad, pasa", () => {
    expect(conD25({ gms_evaluados: 5, gms_ganados: 2 })).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "mayoria_gm" });
    expect(conD25({ gms_evaluados: 4, gms_ganados: 2 }).distribucion_y1).toBe("gana");
    expect(conD25({ gms_evaluados: 5, gms_ganados: 3 }).distribucion_y1).toBe("gana");
    expect(conD25({ gms_evaluados: 0, gms_ganados: 0 }).regla_que_fallo).toBe("mayoria_gm");
  });

  it("4 · un género más de un 10 % relativo peor que el mejor rival falla (11 % sí, 10 % no)", () => {
    const peorQue = (rel: number, g: GrupoGeneroIa) => conD25({ por_genero: { ...ok25.por_genero, [g]: { ...ok25.por_genero[g], wape_rival: 0.1, wape_ia: 0.1 * (1 + rel) } } });
    for (const g of ["HOMBRE", "MUJER", "RESTO"] as GrupoGeneroIa[]) {
      expect(peorQue(0.11, g)).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "genero" });
      expect(peorQue(0.1, g).distribucion_y1).toBe("gana");
    }
  });

  it("5 · natural peor que alguno de los rivales falla", () => {
    expect(conD25({ natural: { ...ok25.natural, wape_ia: 0.2, wape_rival: 0.19 } })).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "natural" });
    expect(conD25({ natural: { ...ok25.natural, wape_ia: 0.19, wape_rival: 0.19 } }).distribucion_y1).toBe("gana");
    expect(conD25({ natural: { ...ok25.natural, wape_ia: null } }).regla_que_fallo).toBe("natural");
  });

  it("6 · D24, contraste: 11 % peor que el método falla; 10 % pasa", () => {
    const d24 = (rel: number) => con({ d24: { ...ok24, reparto: { ...ok24.reparto, wape_metodo: 0.1, wape_ia: 0.1 * (1 + rel) } } });
    expect(d24(0.11)).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "contraste_d24" });
    expect(d24(0.1).distribucion_y1).toBe("gana");
  });

  it("7 · cobertura 97 % falla (98 % pasa) y estabilidad 6 % falla (5 % pasa)", () => {
    const cob = (validas: number, pedidas: number) => con({ d25: { ...ok25, cobertura: { validas, pedidas } }, d24: { ...ok24, cobertura: { validas: 0, pedidas: 0 } } });
    expect(cob(97, 100)).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "cobertura" });
    expect(cob(98, 100).distribucion_y1).toBe("gana");
    expect(COBERTURA_MIN).toBe(0.98);
    expect(con({ estabilidad: 0.06 })).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "estabilidad" });
    expect(con({ estabilidad: 0.05 }).distribucion_y1).toBe("gana");
  });

  it("con menos de 50 filas libres en D25 (o sin D25, D24 o estabilidad), sin_dato", () => {
    expect(conD25({ reparto: { ...ok25.reparto, filas: 49 } })).toEqual({ distribucion_y1: "sin_dato", regla_que_fallo: "sin_dato" });
    expect(conD25({ reparto: { ...ok25.reparto, filas: 50 } }).distribucion_y1).toBe("gana");
    expect(con({ d25: null }).distribucion_y1).toBe("sin_dato");
    expect(con({ d24: null }).distribucion_y1).toBe("sin_dato");
    expect(con({ estabilidad: null }).distribucion_y1).toBe("sin_dato");
  });

  it("una IA que no supera al método (reparte igual que él) no gana: falla la mejora", () => {
    const igual = d25Gana.map((g) => ({ ...g, filas: g.filas.map((f, i, todas) => ({ ...f, reparto_ia: repartoMetodo(g.filas.reduce((a, x) => a + x.real, 0), todas)[i] })) }));
    const r = resultadosDeEvaluacion({ d25: igual, e25: igual, d24: d24Gana, mejora_min: 0.05 });
    expect(r.veredicto).toEqual({ distribucion_y1: "no_gana", regla_que_fallo: "mejora" });
  });
});

describe("R22 · MEJORA_MIN sube a 0,10 desde la segunda versión de prompt evaluada", () => {
  it("la primera versión evaluada (cualquier modelo) usa 0,05; las siguientes, 0,10", () => {
    expect(mejoraMinima("v1", [])).toBe(0.05);
    expect(mejoraMinima("v1", ["v1"])).toBe(0.05);
    expect(mejoraMinima("v2", ["v1"])).toBe(0.1);
    expect(mejoraMinima("v2", ["v1", "v2"])).toBe(0.1);
    expect(mejoraMinima("v3", ["v1", "v2"])).toBe(0.1);
  });
});
