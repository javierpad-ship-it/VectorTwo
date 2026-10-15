import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraficoCurvas } from "../src/components/curvas/grafico-curvas";
import { MiniCurva } from "../src/components/curvas/mini-curva";
import { CandidatasTabla } from "../src/app/(app)/planificacion/curvas-estacionalidad/candidatas-tabla";
import { ComparadorCurvas } from "../src/app/(app)/planificacion/curvas-estacionalidad/comparador-curvas";
import { TablaAnioMes } from "../src/app/(app)/planificacion/curvas-estacionalidad/tabla-anio-mes";
import { RedComparable } from "../src/app/(app)/planificacion/curvas-estacionalidad/red-comparable";
import { EfectoNinoDetalle } from "../src/app/(app)/planificacion/curvas-estacionalidad/efecto-nino-detalle";
import { compararCurvas, redVistaDesdeRed } from "../src/app/(app)/planificacion/curvas-estacionalidad/vista";
import type { AgrupacionResultado, CandidataApi, RedAnioApi } from "../src/lib/curvas/tipos-api";
import { anio, curvaConPico, PLANA } from "./curvas.pantalla.fixture";

/** Humo de render con datos sintéticos: ningún componente de presentación debe lanzar y los textos clave deben salir. */

const parcial = Array.from({ length: 12 }, (_, i) => (i < 9 ? 1 / 9 : 0));
const anios = [
  anio(2023, { clase: "atipico_completo", tratamiento: "incluido", meses_atipicos: 12, atipicos: ["2023-01", "2023-02"], liquidacion: ["2023-07"] }),
  anio(2024, { participacion: curvaConPico(6, 0.3), participacion_real: curvaConPico(6, 0.3) }),
  anio(2025, { escaso: true }),
  anio(2026, { clase: "en_curso", meses_cargados: 9, meses_atipicos: 1, participacion: null, participacion_parcial: parcial, en_ajuste: false, atipicos: ["2026-02"] }),
];

const candidata = (modelo: CandidataApi["modelo"], extra: Partial<CandidataApi> = {}): CandidataApi => ({
  modelo,
  curva: [...PLANA],
  motivo: null,
  eat: 29.1,
  error_max: 7,
  pliegues: 2,
  eat_por_pliegue: [
    { anio: 2024, eat: 28, error_max: 6 },
    { anio: 2025, eat: 30.2, error_max: 8 },
  ],
  eat_parcial: null,
  igual_a: null,
  prestada: false,
  ...extra,
});

const resultado = {
  agrupacion_id: "a1",
  temporada: "invierno",
  temporada_sugerida: null,
  origen: "propia",
  composicion: { equivalencias: 10, huella: "x" },
  efecto_atipico: {
    volumen: [
      { anio: 2023, clase: "atipico_completo", ratio_volumen: 0.63, meses_comparados: 12, anio_referencia: 2024, por_anio_normal: [{ anio: 2024, ratio: 0.63 }, { anio: 2025, ratio: 0.61 }], tiendas_comunes: 7, unidades: 1, unidades_referencia: 2, ratio_mensual: Array(12).fill(0.6) },
    ],
    forma: {
      veredicto: "forma_estable",
      umbral: 3,
      ruido_normal: 33,
      umbral_efectivo: 33,
      diferencia_forma: 9.8,
      c_inc: null,
      c_sin: null,
      por_anio: [
        { anio: 2023, parcial: false, diferencia_anio: 31.2, pico: 6, pico_referencia: 6, corrimiento_pico: 0, mes_mayor_diferencia: 4, veredicto: "forma_estable", tratamiento_aplicado: "incluido" },
        { anio: 2026, parcial: true, meses_comparados: 9, red_completa: { diferencia_anio: 12.1, pico: 7 }, tiendas_comunes: { diferencia_anio: 9.4, pico: 7, tiendas: 9 }, veredicto: null, tratamiento_aplicado: null },
      ],
    },
  },
  anios,
  candidatas: [
    candidata("A"),
    candidata("B", { igual_a: "A" }),
    candidata("C"),
    candidata("D"),
    candidata("E", { curva: null, motivo: "sin_tiendas_validas", eat: null, pliegues: 0, eat_por_pliegue: [] }),
    candidata("T", { eat: null, error_max: null, pliegues: 0, eat_por_pliegue: [], prestada: true }),
  ],
  recomendada: "A",
  motivo_recomendacion: "sin_evidencia",
  margen: 8.25,
  comparacion: { mejor: "B", eat_mejor: 27.4, eat_a: 29.1, margen: 8.25, pliegues: 2, frase: "B se equivoca 27.4 pp frente a 29.1 de A en 2 pruebas; se recomienda A" },
  estabilidad: 0.7,
  nivel_estabilidad: "media",
  banda: Array.from({ length: 12 }, () => ({ min: 0.05, max: 0.12 })),
  cv_mensual: [],
  avisos: [],
} as unknown as AgrupacionResultado;

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("humo de render de la pantalla de curvas", () => {
  it("gráfico: leyenda con todas las series, banda y tabla alternativa referenciada", () => {
    const h = html(
      createElement(GraficoCurvas, {
        resultado,
        propuesta: { etiqueta: "A · Promedio simple", curva: PLANA },
        vigente: { etiqueta: "v1 · A", curva: curvaConPico(6, 0.2) },
        temporada: { curva_T: PLANA },
        idTabla: "tabla-x",
      })
    );
    expect(h).toContain("aria-describedby=\"tabla-x\"");
    expect(h).toContain("2026 (parcial, ene–set)");
    expect(h).toContain("2023 (atípico completo)");
    expect(h).toContain("Curva de la temporada (T)");
    expect(h).toContain("Banda mín–máx");
    expect(h).toContain("<path");
    expect(h).toContain("Participación (%)");
  });

  it("tabla año × mes: 12 meses, cabeceras por año, propuesta, vigente y diferencia; «—» en el año en curso", () => {
    const h = html(
      createElement(TablaAnioMes, {
        id: "t",
        anios,
        propuesta: { etiqueta: "A", curva: PLANA },
        vigente: { etiqueta: "v1", curva: curvaConPico(1, 0.2) },
        umbralDominante: 0.3,
        nombreArchivo: "x.csv",
      })
    );
    for (const m of ["Ene", "Feb", "Dic"]) expect(h).toContain(`>${m}</th>`);
    expect(h).toContain("parcial, ene–set, atípico");
    expect(h).toContain("Dominante");
    expect(h).toContain("Escaso");
    expect(h).toContain("Diferencia (pp)");
    expect(h).toContain("Mes sin cargar");
    expect(h).toContain("<caption");
  });

  it("candidatas: frase comparativa, recomendada, igual a A, no disponible y prestada; sin botón de aprobar", () => {
    const h = html(createElement(CandidatasTabla, { resultado, seleccionada: "A", onSeleccionar: () => {} }));
    expect(h).toContain("B se equivoca 27.4 pp");
    expect(h).toContain("Recomendada");
    expect(h).toContain("Igual a A");
    expect(h).toContain("No disponible");
    expect(h).toContain("Prestada (temporada)");
    expect(h).toContain("Ver por pliegue");
    expect(h).not.toContain("Aprobar");
  });

  it("comparador: con vigente muestra diferencia y EAT; sin vigente avisa de la versión 1", () => {
    const prop = { etiqueta: "A", curva: PLANA };
    const vig = { etiqueta: "v1 · A", curva: curvaConPico(1, 0.2) };
    const con = html(createElement(ComparadorCurvas, { propuesta: prop, vigente: vig, comparacion: compararCurvas(vig.curva, prop.curva, true) }));
    expect(con).toContain("EAT entre ambas");
    expect(con).toContain("Diferencia (pp)");
    const sin = html(createElement(ComparadorCurvas, { propuesta: prop, vigente: null, comparacion: null }));
    expect(sin).toContain("versión 1");
  });

  it("efecto del Niño: volumen, forma con las tres cifras, año en curso con dos formas y sin etiqueta de sustitución", () => {
    const h = html(createElement(EfectoNinoDetalle, { resultado }));
    expect(h).toContain("×0.63");
    expect(h).toContain("estable respecto al ruido");
    expect(h).toContain("Red completa de 2026");
    expect(h).toContain("Tiendas comunes");
    expect(h.toLowerCase()).not.toContain("sustitución");
  });

  it("mini curva: dos trazos; sin curvas, un guion", () => {
    expect(html(createElement(MiniCurva, { vigente: PLANA, propuesta: curvaConPico(2, 0.3) })).match(/<path/g)).toHaveLength(2);
    expect(html(createElement(MiniCurva, {}))).toContain("—");
  });

  it("red comparable: Entra con peso, Fuera con motivo, Dominante y Distinta", () => {
    const tienda = (id: string, extra: Record<string, unknown> = {}) => ({
      tienda_id: id,
      codigo: id.toUpperCase(),
      nombre: `TIENDA ${id.toUpperCase()}`,
      entra: true,
      motivos: [],
      meses_sin_venta: [],
      primer_mes_con_venta: null,
      entra_desde: null,
      unidades: 100,
      peso: 0.38,
      participacion: PLANA,
      eat_vs_red: 3,
      distinta: false,
      ...extra,
    });
    const red = [
      { anio: 2025, tiendas: [tienda("t1"), tienda("t2", { entra: false, peso: 0, motivos: ["tienda_nueva"], entra_desde: 2026 })], total_unidades: 1, dominante: "t1", peso_mayor: 0.38, sin_red: false, participacion: PLANA, ruido_normal: null },
      { anio: 2026, tiendas: [tienda("t1", { peso: 0.26 }), tienda("t2", { peso: 0.22, distinta: true, eat_vs_red: 14.2 })], total_unidades: 1, dominante: null, peso_mayor: 0.26, sin_red: false, participacion: PLANA, ruido_normal: 30 },
    ] as unknown as RedAnioApi[];
    const h = html(createElement(RedComparable, { red: redVistaDesdeRed(red), referencia: "la red", pie: "pie" }));
    expect(h).toContain("Entra");
    expect(h).toContain("38.0 %");
    expect(h).toContain("Tienda nueva: entra en 2026");
    expect(h).toContain("Dominante");
    expect(h).toContain("Distinta · 14.2 pp");
    expect(h).toContain("1 de 2 tiendas · la mayor pesa 38.0 %");
  });
});
