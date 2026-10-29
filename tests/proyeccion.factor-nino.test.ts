import { describe, expect, it } from "vitest";
import type { SerieParaVolumen } from "@/lib/curvas/efecto";
import type { RedAnio } from "@/lib/curvas/tipos-api";
import {
  FORMULA_FACTOR_RELATIVO,
  MIN_MESES_FACTOR,
  UMBRAL_CORRECCION_NINO,
  correccionMaterial,
  estadoFactorY,
  factorRelativoPeriodo,
  type FactorParaEstado,
  type HoyFactor,
} from "@/lib/proyeccion/factor-nino";
import * as tiposApi from "@/lib/proyeccion/tipos-api";

/** 06e (sintético): R15 `correccionMaterial`, R23 factor relativo del periodo (ejemplo G) y R24 `estadoFactorY` (ejemplo H). */

describe("R15 · correccionMaterial", () => {
  it("el umbral es 0,5 % y es el mismo que reexporta tipos-api", () => {
    expect(UMBRAL_CORRECCION_NINO).toBe(0.005);
    expect(tiposApi.UMBRAL_CORRECCION_NINO).toBe(UMBRAL_CORRECCION_NINO);
    expect(MIN_MESES_FACTOR).toBe(2);
  });

  it("+0,49 % no es material y +0,50 % sí, con cualquier tamaño de base (sin errores de coma flotante)", () => {
    for (const base of [1000, 10_000, 56_100, 123_456, 7, 1_000_000]) {
      expect(correccionMaterial(base, base * 1.0049)).toBe(false);
      expect(correccionMaterial(base, base * 1.005)).toBe(true);
    }
    expect(correccionMaterial(1000, 1005)).toBe(true);
    expect(correccionMaterial(1000, 1004)).toBe(false);
  });

  it("vale en los dos sentidos: una corrección a la baja (verano) también es material", () => {
    expect(correccionMaterial(12000, 10000)).toBe(true);
    expect(correccionMaterial(1000, 995)).toBe(true);
    expect(correccionMaterial(1000, 996)).toBe(false);
  });

  it("los ejemplos de la ficha: +6,8 % es material y +0,1 % (ejemplo E) no", () => {
    expect(correccionMaterial(56100, 59925)).toBe(true);
    expect(correccionMaterial(10000, 10010)).toBe(false);
  });

  it("sin base (0, negativa, NaN o infinita) no hay corrección material", () => {
    expect(correccionMaterial(0, 100)).toBe(false);
    expect(correccionMaterial(-5, 100)).toBe(false);
    expect(correccionMaterial(Number.NaN, 100)).toBe(false);
    expect(correccionMaterial(100, Number.NaN)).toBe(false);
    expect(correccionMaterial(100, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("sin corrección (B' = B) no es material", () => {
    expect(correccionMaterial(1000, 1000)).toBe(false);
  });
});

// ─── R23 ───

const red = (anio: number, ids: string[]): RedAnio => ({
  anio,
  tiendas: ids.map((tienda_id) => ({ tienda_id, entra: true, motivos: [], meses_sin_venta: [], primer_mes_con_venta: null, entra_desde: null, unidades: 0, peso: 0, participacion: null, eat_vs_red: null, distinta: false })),
  total_unidades: 0,
  dominante: null,
  peso_mayor: null,
  sin_red: false,
  participacion: null,
  ruido_normal: null,
});
const REDES = new Map([2025, 2026].map((a) => [a, red(a, ["a", "b"])]));
const mascara = (...meses: number[]) => Array.from({ length: 12 }, (_, m) => meses.includes(m + 1));
const cada = (valor: number, n: number) => Array.from({ length: n }, () => valor);

function serie(anio: number, porMes: number[], publicados: number): SerieParaVolumen {
  const u = Array.from({ length: 12 }, (_, m) => (m < publicados ? (porMes[m] ?? 0) : 0));
  return {
    anio,
    unidades: u,
    publicados: Array.from({ length: 12 }, (_, m) => m < publicados),
    por_tienda: new Map([
      ["a", u.map((x) => x / 2)],
      ["b", u.map((x) => x / 2)],
    ]),
  };
}

const entradaDe = (e: Partial<Parameters<typeof factorRelativoPeriodo>[0]> & Pick<Parameters<typeof factorRelativoPeriodo>[0], "serieY" | "serieRef" | "controlY" | "controlRef" | "mesesPeriodo">) => ({
  temporada: "verano" as const,
  anioY: 2026,
  anioRef: 2025,
  redes: REDES,
  ...e,
});

describe("R23 · factorRelativoPeriodo", () => {
  it("ejemplo G (verano, un mes del periodo): 1,90 / 1,20 / 0,95 / 2,00 y ratio_calculado null con dato frágil", () => {
    const r = factorRelativoPeriodo(
      entradaDe({
        serieRef: serie(2025, [...cada(6250, 8), 7000, 8000, 9000, 9500], 12),
        serieY: serie(2026, [...cada(7500, 8), 13300], 9),
        controlRef: serie(2025, cada(10000, 12), 12),
        controlY: serie(2026, cada(9500, 9), 9),
        mesesPeriodo: mascara(9, 10, 11, 12),
      })
    );
    expect(r.ratio_volumen).toBeCloseTo(1.9, 10);
    expect(r.ratio_control).toBeCloseTo(0.95, 10);
    expect(r.relativo).toBeCloseTo(2, 10);
    expect(r.ratio_fuera).toBeCloseTo(1.2, 10);
    expect(r.ratio_volumen! / r.ratio_fuera!).toBeCloseTo(1.58, 2);
    expect(r.meses_periodo_con_dato).toBe(1);
    expect(r.ratio_calculado).toBeNull();
    expect(r.diagnostico).toMatchObject({ meses_periodo: 4, meses_periodo_con_dato: 1, ratio_fuera: r.ratio_fuera });
    expect(r.diagnostico.meses).toHaveLength(12);
    expect(r.diagnostico.meses.filter((m) => m.en_periodo).map((m) => m.m)).toEqual([9]);
  });

  it("con dos meses del periodo con dato calcula y redondea a 4 decimales", () => {
    const r = factorRelativoPeriodo(
      entradaDe({
        serieRef: serie(2025, [...cada(6250, 8), 7000, 8000, 9000, 9500], 12),
        serieY: serie(2026, [...cada(7500, 8), 13300, 12000], 10),
        controlRef: serie(2025, cada(10000, 12), 12),
        controlY: serie(2026, cada(9500, 10), 10),
        mesesPeriodo: mascara(9, 10, 11, 12),
      })
    );
    expect(r.meses_periodo_con_dato).toBe(2);
    expect(r.ratio_calculado).toBe(Math.round(((25300 / 15000) / 0.95) * 1e4) / 1e4);
    expect(r.ratio_calculado).toBe(1.7754);
  });

  it("invierno 2026 con P = todos los meses publicados: 0,66 ÷ 0,94 = 0,7021 y la tabla trae los doce meses sin ratio_fuera", () => {
    const r = factorRelativoPeriodo(
      entradaDe({
        temporada: "invierno",
        serieRef: serie(2025, cada(1000, 12), 12),
        serieY: serie(2026, cada(660, 9), 9),
        controlRef: serie(2025, cada(2000, 12), 12),
        controlY: serie(2026, cada(1880, 9), 9),
        mesesPeriodo: mascara(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
      })
    );
    expect(r.ratio_volumen).toBeCloseTo(0.66, 10);
    expect(r.ratio_control).toBeCloseTo(0.94, 10);
    expect(r.ratio_calculado).toBe(0.7021);
    expect(r.ratio_fuera).toBeNull();
    expect(r.diagnostico).toMatchObject({ meses_periodo: 12, meses_periodo_con_dato: 9, ratio_fuera: null });
    expect(r.diagnostico.meses.filter((m) => m.en_periodo)).toHaveLength(9);
    expect(r.diagnostico.meses[0].relativo).toBeCloseTo(0.66 / 0.94, 10);
  });

  it("control nulo o cero: relativo y ratio_calculado null aunque haya meses suficientes", () => {
    const r = factorRelativoPeriodo(
      entradaDe({
        temporada: "invierno",
        serieRef: serie(2025, cada(1000, 12), 12),
        serieY: serie(2026, cada(660, 9), 9),
        controlRef: serie(2025, cada(2000, 12), 12),
        controlY: serie(2026, cada(0, 9), 9),
        mesesPeriodo: mascara(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
      })
    );
    expect(r.ratio_control).toBe(0);
    expect(r.relativo).toBeNull();
    expect(r.ratio_calculado).toBeNull();
    expect(r.ratio_volumen).toBeCloseTo(0.66, 10);
  });

  it("sin ningún mes del periodo publicado en ambos años: sin datos del periodo", () => {
    const r = factorRelativoPeriodo(
      entradaDe({
        serieRef: serie(2025, cada(1000, 12), 12),
        serieY: serie(2026, cada(1000, 8), 8),
        controlRef: serie(2025, cada(2000, 12), 12),
        controlY: serie(2026, cada(2000, 8), 8),
        mesesPeriodo: mascara(9, 10, 11, 12),
      })
    );
    expect(r).toMatchObject({ ratio_volumen: null, ratio_control: null, relativo: null, ratio_calculado: null, meses_periodo_con_dato: 0 });
    expect(r.ratio_fuera).toBeCloseTo(1, 10);
  });
});

// ─── R24 ───

describe("R24 · estadoFactorY", () => {
  const HOY: HoyFactor = { huella_cargas: "h-set", huella_composicion: "c1", meses_periodo_publicados: 9 };
  const factor = (extra: Partial<FactorParaEstado> = {}): FactorParaEstado => ({
    calculado_at: "2026-10-29T10:00:00Z",
    formula: FORMULA_FACTOR_RELATIVO,
    huella_cargas: "h-set",
    huella_composicion: "c1",
    parcial: true,
    meses_comparados: 9,
    ratio_calculado: 0.7,
    ratio_aplicado: 0.7,
    aplicado_huella: "h-set",
    ...extra,
  });

  it("ok: al día y confirmado", () => {
    expect(estadoFactorY(factor(), HOY)).toEqual({ estado: "ok", motivos_desfase: [] });
  });

  it("faltante: sin valor efectivo, aunque esté desfasado", () => {
    expect(estadoFactorY(factor({ ratio_calculado: null, ratio_aplicado: null }), HOY).estado).toBe("faltante");
    expect(estadoFactorY(factor({ ratio_calculado: null, ratio_aplicado: null, huella_cargas: "vieja" }), HOY).estado).toBe("faltante");
    // Con solo el calculado o solo el aplicado hay efectivo.
    expect(estadoFactorY(factor({ ratio_calculado: null }), HOY).estado).toBe("ok");
  });

  it("desfasado por fórmula: null (fórmula anterior) o distinta de relativo_periodo", () => {
    expect(estadoFactorY(factor({ formula: null }), HOY)).toEqual({ estado: "desfasado", motivos_desfase: ["formula"] });
    expect(estadoFactorY(factor({ formula: undefined }), HOY).motivos_desfase).toEqual(["formula"]);
    expect(estadoFactorY(factor({ formula: "volumen" }), HOY).motivos_desfase).toEqual(["formula"]);
  });

  it("desfasado por cargas: la huella de hoy no es la del cálculo", () => {
    expect(estadoFactorY(factor({ huella_cargas: "h-ago" }), HOY)).toEqual({ estado: "desfasado", motivos_desfase: ["cargas"] });
  });

  it("desfasado por meses: parcial con menos meses comparados que los publicados hoy; uno completo no", () => {
    expect(estadoFactorY(factor({ meses_comparados: 8 }), HOY)).toEqual({ estado: "desfasado", motivos_desfase: ["meses"] });
    expect(estadoFactorY(factor({ meses_comparados: null }), HOY).motivos_desfase).toEqual(["meses"]);
    expect(estadoFactorY(factor({ parcial: false, meses_comparados: 8 }), HOY).estado).toBe("ok");
    expect(estadoFactorY(factor({ meses_comparados: 10 }), HOY).estado).toBe("ok");
  });

  it("desfasado por composición: la huella de composición cambió o falta", () => {
    expect(estadoFactorY(factor({ huella_composicion: "c0" }), HOY)).toEqual({ estado: "desfasado", motivos_desfase: ["composicion"] });
    expect(estadoFactorY(factor({ huella_composicion: null }), HOY).motivos_desfase).toEqual(["composicion"]);
  });

  it("junta todos los motivos en el orden fórmula, cargas, meses, composición", () => {
    const f = factor({ formula: null, huella_cargas: "x", meses_comparados: 1, huella_composicion: "y" });
    expect(estadoFactorY(f, HOY).motivos_desfase).toEqual(["formula", "cargas", "meses", "composicion"]);
  });

  it("nunca sincronizado (calculado_at null) no es desfasado: solo vale lo que escribió el planner", () => {
    const f = factor({ calculado_at: null, formula: null, huella_cargas: null, huella_composicion: null, parcial: false, ratio_calculado: null, aplicado_huella: null });
    expect(estadoFactorY(f, HOY)).toEqual({ estado: "ok", motivos_desfase: [] });
  });

  it("sin_confirmar: parcial con ratio_aplicado nulo, o con aplicado_huella distinta o ausente", () => {
    expect(estadoFactorY(factor({ ratio_aplicado: null }), HOY)).toEqual({ estado: "sin_confirmar", motivos_desfase: [] });
    expect(estadoFactorY(factor({ aplicado_huella: "h-ago" }), HOY).estado).toBe("sin_confirmar");
    expect(estadoFactorY(factor({ aplicado_huella: null }), HOY).estado).toBe("sin_confirmar");
    expect(estadoFactorY(factor({ aplicado_huella: undefined }), HOY).estado).toBe("sin_confirmar");
  });

  it("un factor no parcial con calculado y sin aplicado está ok (no hay nada que confirmar)", () => {
    expect(estadoFactorY(factor({ parcial: false, ratio_aplicado: null, aplicado_huella: null, meses_comparados: 12 }), HOY).estado).toBe("ok");
  });

  it("el desfase manda sobre sin_confirmar", () => {
    expect(estadoFactorY(factor({ huella_cargas: "x", ratio_aplicado: null }), HOY).estado).toBe("desfasado");
  });

  it("ejemplo H: confirmado → mes nuevo (desfasado) → sincronizar (sin_confirmar) → escribir el valor (ok)", () => {
    // 29/10: Javier confirma invierno 0,70 con las cargas de setiembre.
    const confirmado = factor();
    expect(estadoFactorY(confirmado, HOY).estado).toBe("ok");
    // Noviembre: se publica octubre. La fila vieja queda desfasada por cargas y por meses (9 < 10).
    const hoyOct: HoyFactor = { huella_cargas: "h-oct", huella_composicion: "c1", meses_periodo_publicados: 10 };
    expect(estadoFactorY(confirmado, hoyOct)).toEqual({ estado: "desfasado", motivos_desfase: ["cargas", "meses"] });
    // «Sincronizar» recalcula 0,71 con las cargas de octubre y no toca lo escrito por Javier (0,70, aplicado_huella de setiembre).
    const sincronizado = factor({ ratio_calculado: 0.71, huella_cargas: "h-oct", meses_comparados: 10 });
    expect(estadoFactorY(sincronizado, hoyOct)).toEqual({ estado: "sin_confirmar", motivos_desfase: [] });
    // Javier escribe 0,71 (o reescribe 0,70): se guarda aplicado_huella = huella_cargas de la fila.
    expect(estadoFactorY({ ...sincronizado, ratio_aplicado: 0.71, aplicado_huella: "h-oct" }, hoyOct)).toEqual({ estado: "ok", motivos_desfase: [] });
    expect(estadoFactorY({ ...sincronizado, ratio_aplicado: 0.7, aplicado_huella: "h-oct" }, hoyOct).estado).toBe("ok");
  });

  it("verano con un mes del periodo: sin calculado y con aplicado escrito sobre las cargas de hoy queda ok", () => {
    const f = factor({ ratio_calculado: null, ratio_aplicado: 1.5, meses_comparados: 1, aplicado_huella: "h-set" });
    expect(estadoFactorY(f, { ...HOY, meses_periodo_publicados: 1 })).toEqual({ estado: "ok", motivos_desfase: [] });
    expect(estadoFactorY({ ...f, ratio_aplicado: null }, { ...HOY, meses_periodo_publicados: 1 }).estado).toBe("faltante");
  });
});
