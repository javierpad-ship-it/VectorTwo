import { describe, expect, it } from "vitest";
import { calcularGeometriaCurvas } from "../src/lib/curvas/grafico";
import {
  COLOR_DESCARTADO,
  aniosConAtipicos,
  bandaParaGrafico,
  construirSeries,
  esAnioNino,
  etiquetaSerieAnio,
  puntosLiquidacion,
  serieDeAnio,
} from "../src/components/curvas/series";
import { anio, curvaConPico, PLANA } from "./curvas.pantalla.fixture";

describe("serieDeAnio", () => {
  it("participación: las fracciones del año, 12 valores", () => {
    const s = serieDeAnio(anio(2024), "participacion")!;
    expect(s.clave).toBe("anio-2024");
    expect(s.valores).toHaveLength(12);
    expect(s.valores[0]).toBeCloseTo(1 / 12, 9);
    expect(s.trazo).toBe("continuo");
    expect(s.opacidad).toBe(1);
    expect(s.porDefecto).toBe(true);
  });

  it("unidades: las de la red por mes", () => {
    const s = serieDeAnio(anio(2024, { meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }), "unidades")!;
    expect(s.valores).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("el año en curso usa la participación parcial, discontinuo y solo con los meses cargados", () => {
    const parcial = Array.from({ length: 12 }, (_, i) => (i < 9 ? 1 / 9 : 0));
    const s = serieDeAnio(anio(2026, { clase: "en_curso", meses_cargados: 9, participacion: null, participacion_parcial: parcial }), "participacion")!;
    expect(s.trazo).toBe("discontinuo");
    expect(s.valores.slice(0, 9).every((v) => v !== null)).toBe(true);
    expect(s.valores.slice(9)).toEqual([null, null, null]);
    expect(s.etiqueta).toBe("2026 (parcial, ene–set)");
  });

  it("un año en curso en unidades también corta en el último mes cargado", () => {
    const s = serieDeAnio(anio(2026, { clase: "en_curso", meses_cargados: 3, meses: Array.from({ length: 12 }, (_, i) => (i < 3 ? 10 : 0)) }), "unidades")!;
    expect(s.valores).toEqual([10, 10, 10, null, null, null, null, null, null, null, null, null]);
  });

  it("un año sin participación (sin red o sin volumen) no genera serie", () => {
    expect(serieDeAnio(anio(2022, { participacion: null, participacion_real: null, unidades: 0, meses: Array(12).fill(0) }), "participacion")).toBeNull();
    expect(serieDeAnio(anio(2022, { unidades: 0, meses: Array(12).fill(0) }), "unidades")).toBeNull();
  });

  it("escasos y descartados se atenúan; los descartados, además, van en gris; todos se ven al abrir (se pueden apagar en la leyenda)", () => {
    const escaso = serieDeAnio(anio(2023, { escaso: true }), "participacion")!;
    expect(escaso.opacidad).toBeLessThan(1);
    expect(escaso.porDefecto).toBe(true);
    const descartado = serieDeAnio(anio(2023, { clase: "atipico_completo", tratamiento: "descartado" }), "participacion")!;
    expect(descartado.color).toBe(COLOR_DESCARTADO);
    expect(descartado.opacidad).toBeLessThan(1);
    expect(descartado.porDefecto).toBe(true);
  });

  it("los años del Niño llevan otro trazo (guion y punto); el año en curso, discontinuo; el resto, continuo", () => {
    expect(serieDeAnio(anio(2023, { clase: "atipico_completo", tratamiento: "incluido" }), "participacion")!.trazo).toBe("punteado");
    expect(serieDeAnio(anio(2023, { clase: "con_huecos", tratamiento: "imputado" }), "participacion")!.trazo).toBe("punteado");
    expect(serieDeAnio(anio(2023, { clase: "atipico_completo", tratamiento: "descartado" }), "participacion")!.trazo).toBe("punteado");
    expect(serieDeAnio(anio(2024), "participacion")!.trazo).toBe("continuo");
    const parcial = Array.from({ length: 12 }, (_, i) => (i < 9 ? 1 / 9 : 0));
    expect(serieDeAnio(anio(2026, { clase: "en_curso", meses_cargados: 9, participacion: null, participacion_parcial: parcial }), "participacion")!.trazo).toBe("discontinuo");
    expect(esAnioNino(anio(2023, { clase: "atipico_completo" }))).toBe(true);
    expect(esAnioNino(anio(2023))).toBe(false);
  });

  it("imputados se mantienen en 1-12 (contrato del backend) y en unidades no hay imputación", () => {
    const a = anio(2023, { clase: "con_huecos", tratamiento: "imputado", imputados: [9, 10, 11, 12], atipicos: ["2023-09", "2023-12"], liquidacion: ["2023-07"] });
    const s = serieDeAnio(a, "participacion")!;
    expect(s.imputados).toEqual([9, 10, 11, 12]);
    expect(s.mesesAtipicos).toEqual([9, 12]);
    expect(s.mesesLiquidacion).toEqual([7]);
    expect(serieDeAnio(a, "unidades")!.imputados).toEqual([]);
  });
});

describe("etiquetaSerieAnio", () => {
  it("normal: solo el año", () => expect(etiquetaSerieAnio(anio(2024))).toBe("2024"));
  it("atípico completo descartado y escaso", () => {
    expect(etiquetaSerieAnio(anio(2023, { clase: "atipico_completo", tratamiento: "descartado", escaso: true }))).toBe("2023 (atípico completo, descartado, escaso)");
  });
  it("con huecos imputado", () => {
    expect(etiquetaSerieAnio(anio(2023, { clase: "con_huecos", meses_atipicos: 4, tratamiento: "imputado" }))).toBe("2023 (4 meses atípicos, imputado)");
  });
});

describe("construirSeries", () => {
  const anios = [anio(2025), anio(2023), anio(2024)];
  it("años ordenados del más antiguo al más reciente, y encima T, vigente y propuesta", () => {
    const s = construirSeries(anios, { modo: "participacion", propuesta: { etiqueta: "A", curva: PLANA }, vigente: { etiqueta: "v1", curva: PLANA }, temporada: { curva_T: PLANA } });
    expect(s.map((x) => x.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025", "temporada", "vigente", "propuesta"]);
    expect(s.find((x) => x.clave === "temporada")!.porDefecto).toBe(false);
    expect(s.find((x) => x.clave === "propuesta")!.grosor!).toBeGreaterThan(s.find((x) => x.clave === "vigente")!.grosor!);
  });

  it("en unidades solo van los años", () => {
    const s = construirSeries(anios, { modo: "unidades", propuesta: { etiqueta: "A", curva: PLANA }, vigente: null, temporada: { curva_T: PLANA } });
    expect(s.map((x) => x.clave)).toEqual(["anio-2023", "anio-2024", "anio-2025"]);
  });

  it("sin vigente ni T no se dibujan", () => {
    const s = construirSeries([], { modo: "participacion", propuesta: { etiqueta: "A", curva: PLANA }, vigente: null, temporada: { curva_T: null } });
    expect(s.map((x) => x.clave)).toEqual(["propuesta"]);
  });
});

describe("ayudas para la geometría del backend", () => {
  it("años con atípicos, puntos de liquidación y banda en el formato de calcularGeometriaCurvas", () => {
    const s = construirSeries([anio(2023, { atipicos: ["2023-01"], liquidacion: ["2023-07"] }), anio(2024), anio(2026, { clase: "en_curso", meses_cargados: 3, participacion: null, participacion_parcial: PLANA, atipicos: ["2026-02"], liquidacion: ["2026-03"] })], {
      modo: "participacion",
    });
    expect(aniosConAtipicos(s)).toEqual([2023, 2026]);
    expect(puntosLiquidacion(s)).toEqual([
      { clave: "anio-2023", mes: 7 },
      { clave: "anio-2026", mes: 3 },
    ]);
    expect(bandaParaGrafico([{ min: 0.1, max: 0.2 }])).toBeNull();
    expect(bandaParaGrafico(null)).toBeNull();
    const b = bandaParaGrafico(Array.from({ length: 12 }, (_, i) => ({ min: i / 100, max: i / 50 })))!;
    expect(b.min).toHaveLength(12);
    expect(b.max[11]).toBeCloseTo(0.22, 9);
  });

  it("integración: las series alimentan la geometría (líneas, banda, bandas atípicas y puntos de liquidación)", () => {
    const series = construirSeries([anio(2024, { participacion: curvaConPico(6, 0.3), atipicos: ["2024-03"], liquidacion: ["2024-06"] }), anio(2025)], {
      modo: "participacion",
      propuesta: { etiqueta: "A", curva: PLANA },
    });
    const g = calcularGeometriaCurvas({
      series,
      banda: bandaParaGrafico(Array.from({ length: 12 }, () => ({ min: 0.05, max: 0.3 }))),
      mesesAtipicos: [3],
      liquidacion: puntosLiquidacion(series),
      modo: "participacion",
    });
    expect(g.lineas.map((l) => l.clave)).toEqual(["anio-2024", "anio-2025", "propuesta"]);
    expect(g.banda).not.toBeNull();
    expect(g.bandasAtipicas.map((b) => b.mes)).toEqual([3]);
    expect(g.puntosLiquidacion.map((p) => [p.clave, p.mes])).toEqual([["anio-2024", 6]]);
    expect(g.lineas[0].aria).toContain("2024");
  });
});

// ─── 06b, regla 47 y caso 21: todos los años con red se ven ───

import { celdaAnioMes, filasCsvAnioMes, formatearPp as formatearPpPantalla } from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import { formatearPp } from "../src/lib/formato";
import { ABRIGO_ID, agrupacionDe, corridaFixture } from "./curvas.fixture";
import { prepararTrabajo } from "../src/lib/curvas/trabajo";
import { insumosFixture, parametros } from "./curvas.fixture";

describe("regla 47 · un año descartado sigue dibujado (participacion_real ?? participacion)", () => {
  it("un año descartado (participacion null, participacion_real con curva) produce serie gris y tenue, visible al abrir; y celdas en la tabla", () => {
    const d = anio(2023, { tratamiento: "descartado", participacion: null, participacion_real: curvaConPico(6, 0.3), en_ajuste: false });
    const s = serieDeAnio(d, "participacion")!;
    expect(s.color).toBe(COLOR_DESCARTADO);
    expect(s.porDefecto).toBe(true);
    expect(s.opacidad).toBeLessThan(1);
    expect(s.valores[5]).toBeCloseTo(0.3, 9);
    const celda = celdaAnioMes(d, 5);
    expect(celda.participacion).toBeCloseTo(0.3, 9);
  });
  it("un año imputado dibuja la participación imputada con sus meses imputados (la real queda para el detalle)", () => {
    const imputada = curvaConPico(3, 0.2);
    const d = anio(2024, { tratamiento: "imputado", participacion: imputada, participacion_real: curvaConPico(3, 0.4), imputados: [3, 4] });
    const s = serieDeAnio(d, "participacion")!;
    expect(s.valores[2]).toBeCloseTo(0.2, 9);
    expect(s.imputados).toEqual([3, 4]);
  });
  it("un año sin red, sin volumen o incompleto (sin participación real) no se dibuja", () => {
    expect(serieDeAnio(anio(2022, { participacion: null, participacion_real: null, unidades: 0, meses: Array(12).fill(0) }), "participacion")).toBeNull();
    expect(serieDeAnio(anio(2022, { clase: "incompleto", meses_cargados: 7, participacion: null, participacion_real: null, unidades: 0, meses: Array(12).fill(0) }), "participacion")).toBeNull();
    expect(celdaAnioMes(anio(2022, { participacion: null, participacion_real: null }), 0).participacion).toBeNull();
  });
  it("caso 21 · fixture «forma corrida» (2023 descartado): el gráfico tiene cuatro series y el CSV incluye 2023 con su participación real", () => {
    const a = agrupacionDe(corridaFixture("forma_corrida"), ABRIGO_ID);
    expect(a.anios.find((x) => x.anio === 2023)).toMatchObject({ tratamiento: "descartado", participacion: null });
    const series = construirSeries(a.anios, { modo: "participacion" });
    expect(series.map((s) => s.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(series.find((s) => s.anio === 2023)).toMatchObject({ color: COLOR_DESCARTADO, porDefecto: true });
    const csv = filasCsvAnioMes(a.anios, null, null);
    const col2023 = csv.campos.indexOf("2023 (%)");
    expect(col2023).toBeGreaterThan(0);
    expect(csv.datos.every((fila) => typeof fila[col2023] === "number")).toBe(true);
  });
  it("con anios_excluidos = [2024] el año sigue en el gráfico, en gris", () => {
    const r = prepararTrabajo(insumosFixture(ABRIGO_ID), parametros({ anios_excluidos: [2024] }), undefined);
    const a = r.trabajo!.salida!.resultado.agrupaciones[0];
    const series = construirSeries(a.anios, { modo: "participacion" });
    expect(series.find((s) => s.anio === 2024)).toMatchObject({ color: COLOR_DESCARTADO, porDefecto: true });
  });
  it("formato (Q4): formatearPp de la pantalla y el compartido dan el mismo texto", () => {
    expect(formatearPpPantalla(27.43)).toBe(formatearPp(27.43));
    expect(formatearPpPantalla(27.43)).toBe("27.4 pp");
  });
});
