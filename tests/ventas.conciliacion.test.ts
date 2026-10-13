import { describe, expect, it } from "vitest";
import {
  conciliarFilasConQlik,
  coincideConQlik,
  estadoQlik,
  formatearPorcentaje,
  leerConciliacionGuardada,
  leerFilaConciliacionGuardada,
  NOTA_CONCILIACION_080,
  textoEstadoQlik,
} from "@/lib/ventas/conciliacion";
import { armarReporteMes, coincideConQlik as coincideDesdeInforme, conciliarMes } from "@/lib/ventas/informe";
import { tallyVacio, type Tally } from "@/lib/ventas/acumulador";
import {
  BASE_CONCILIACION,
  MEDIDAS_VENTA,
  TOLERANCIA_UNIDADES,
  type FilaConciliacion,
  type InformeMes,
} from "@/lib/ventas/tipos";
import { conciliarConQlik } from "@/app/(app)/planificacion/venta-stock/plan";
import { informe as armar } from "./ventas.fixture";

/**
 * Cifras SINTÉTICAS del ejemplo de la ficha 05c: un mes con archivo de 66 128
 * unidades, sin_clasificar 11 366, comparable 54 762, cargado 54 700 y 62 de una
 * tienda desconocida; y soles: comparable S/ 1 000 000.
 */
const tally = (t: Partial<Tally>): Tally => ({ ...tallyVacio(), ...t });
// En céntimos: S/ 1 005 000 de archivo, de los cuales S/ 5 000 sin clasificar.
const ARCHIVO = tally({ filas: 4, unidades: 66_128, venta: 100_500_000, costo: 40_000_000, stock_unidades: 500, stock_valorizado: 20_000_000 });
const NO_COMPARABLE = tally({ filas: 1, unidades: 11_366, venta: 500_000, costo: 100_000, stock_unidades: 50, stock_valorizado: 2_000_000 });
const EXCLUIDO = tally({ filas: 2, unidades: 11_428, venta: 600_000, costo: 100_000, stock_unidades: 60, stock_valorizado: 2_100_000 });
const CARGADO = tally({ filas: 2, unidades: 54_700, venta: 99_900_000, costo: 39_900_000, stock_unidades: 440, stock_valorizado: 17_900_000 });

const fila = (qlik: Parameters<typeof conciliarMes>[4]) => {
  const filas = conciliarMes(ARCHIVO, EXCLUIDO, CARGADO, NO_COMPARABLE, qlik);
  return Object.fromEntries(filas.map((f) => [f.medida, f])) as Record<(typeof MEDIDAS_VENTA)[number], FilaConciliacion>;
};

describe("M5c regla 9 · conciliación con la base comparable (ejemplo de la ficha)", () => {
  it("las cinco cifras del ejemplo", () => {
    const f = fila(undefined).unidades;
    expect(f).toMatchObject({ archivo: 66_128, no_comparable: 11_366, comparable: 54_762, cargado: 54_700, excluido: 11_428, descuadre: 0 });
    expect(f.estado_qlik).toBe("sin_qlik");
  });

  it("QlikView = 54 762 coincide; 54 763 difiere con diferencia −1 (con unidades exactas)", () => {
    const exacto = fila({ unidades: 54_762 }).unidades;
    expect(exacto).toMatchObject({ estado_qlik: "coincide", diferencia_qlik: 0, qlik: 54_762 });
    const uno = fila({ unidades: 54_763 }).unidades;
    expect(uno.diferencia_qlik).toBe(-1);
    expect(uno.diferencia_relativa).toBeCloseTo(1 / 54_763, 10);
    // 1 unidad de diferencia: difiere solo si la tolerancia de unidades es menor que 1
    expect(uno.estado_qlik).toBe(1 <= TOLERANCIA_UNIDADES ? "coincide" : "difiere");
  });

  it("contra el archivo completo (66 128) ya no coincide: la base es el comparable", () => {
    expect(fila({ unidades: 66_128 }).unidades.estado_qlik).toBe("difiere");
  });

  it("soles: la diferencia relativa se mide contra QlikView (< 0,1 %): 1 000 000 frente a 1 000 999 coincide (0,0999 %) y frente a 1 001 000 difiere (0,1 %)", () => {
    // QlikView = 1 000 000; el comparable del mes es 1 000 999 (archivo 1 005 999 − 5 000 sin clasificar) o 1 001 000.
    const venta = (comparableSoles: number, qlik: number) => {
      const archivo = tally({ filas: 1, venta: (comparableSoles + 5000) * 100 });
      const nc = tally({ filas: 0, venta: 5000 * 100 });
      return conciliarMes(archivo, nc, tally({}), nc, { venta_soles: qlik }).find((f) => f.medida === "venta_soles") as FilaConciliacion;
    };
    expect(venta(1_000_999, 1_000_000)).toMatchObject({ comparable: 1_000_999, estado_qlik: "coincide", diferencia_qlik: 999 });
    expect(venta(1_001_000, 1_000_000)).toMatchObject({ comparable: 1_001_000, estado_qlik: "difiere", diferencia_qlik: 1000 });
    expect(venta(999_001, 1_000_000).estado_qlik).toBe("coincide");
    expect(venta(999_000, 1_000_000).estado_qlik).toBe("difiere");
    // QlikView 1 001 000 con comparable 1 000 000: 1 000 / 1 001 000 = 0,0999 % → también coincide
    expect(venta(1_000_000, 1_001_000).estado_qlik).toBe("coincide");
    // y el comparable del ejemplo (S/ 1 000 000 exactos) frente a su propio total
    expect(fila({ venta_soles: 1_000_000 }).venta_soles).toMatchObject({ comparable: 1_000_000, estado_qlik: "coincide", diferencia_qlik: 0 });
  });

  it("sin totales: sin_qlik y no es un error", () => {
    for (const f of Object.values(fila({}))) {
      expect(f.estado_qlik).toBe("sin_qlik");
      expect(f.qlik).toBeNull();
      expect(f.diferencia_qlik).toBeNull();
      expect(f.diferencia_relativa).toBeNull();
    }
    expect(estadoQlik("unidades", null, 5)).toBe("sin_qlik");
    expect(estadoQlik("unidades", Number.NaN, 5)).toBe("sin_qlik");
  });

  it("conciliarConQlik (plan.ts) da el mismo estado que conciliarMes para los mismos totales, ambos sobre `comparable`", () => {
    const sinTotales = Object.values(fila(undefined));
    const casos = [
      { unidades: 54_762, venta_soles: 1_000_000, costo_vendido: 399_000 * 1, stock_unidades: 390, stock_valorizado: 150_000 },
      { unidades: 54_763, venta_soles: 1_001_000, costo_vendido: 1, stock_unidades: 1, stock_valorizado: 1 },
      { unidades: 66_128 },
      {},
    ];
    for (const totales of casos) {
      const completo = Object.values(fila(totales));
      const reconciliado = conciliarConQlik(sinTotales, totales);
      expect(reconciliado.map((f) => f.estado_qlik)).toEqual(completo.map((f) => f.estado_qlik));
      expect(reconciliado.map((f) => f.diferencia_qlik)).toEqual(completo.map((f) => f.diferencia_qlik));
      expect(reconciliado.map((f) => f.diferencia_relativa)).toEqual(completo.map((f) => f.diferencia_relativa));
      expect(reconciliado.map((f) => f.qlik)).toEqual(completo.map((f) => f.qlik));
    }
    expect(conciliarFilasConQlik(sinTotales, { unidades: 54_762 })[0].estado_qlik).toBe("coincide");
  });

  it("escribir y borrar un total vuelve a sin_qlik", () => {
    const con = conciliarConQlik(Object.values(fila(undefined)), { unidades: 54_762 });
    expect(con[0].estado_qlik).toBe("coincide");
    expect(conciliarConQlik(con, undefined).every((f) => f.estado_qlik === "sin_qlik" && f.qlik === null)).toBe(true);
  });
});

describe("tolerancia en unidades · un solo número (`TOLERANCIA_UNIDADES`)", () => {
  it("hoy las unidades son exactas", () => {
    expect(TOLERANCIA_UNIDADES).toBe(0);
  });

  // Parametrizado contra la constante: cambiar el valor en tipos.ts basta, no hay que tocar este test.
  const diferencias = Array.from({ length: Math.ceil(TOLERANCIA_UNIDADES) + 4 }, (_, i) => i);
  it.each(diferencias)("unidades y stock en unidades con diferencia %i (en ambos sentidos)", (d) => {
    const debeCoincidir = d <= TOLERANCIA_UNIDADES;
    for (const medida of ["unidades", "stock_unidades"] as const) {
      expect(coincideConQlik(medida, 1000, 1000 + d), `${medida} +${d}`).toBe(debeCoincidir);
      expect(coincideConQlik(medida, 1000, 1000 - d), `${medida} -${d}`).toBe(debeCoincidir);
      expect(estadoQlik(medida, 1000, 1000 + d)).toBe(debeCoincidir ? "coincide" : "difiere");
    }
    // `conciliarMes` y `conciliarConQlik` usan la misma constante
    const f = fila({ unidades: 54_762 + d }).unidades;
    expect(f.estado_qlik).toBe(debeCoincidir ? "coincide" : "difiere");
    const c = conciliarConQlik(Object.values(fila(undefined)), { unidades: 54_762 + d })[0];
    expect(c.estado_qlik).toBe(f.estado_qlik);
  });

  it("el parámetro explícito permite probar otros valores sin tocar la constante (±2)", () => {
    expect(coincideConQlik("unidades", 100, 102, 2)).toBe(true);
    expect(coincideConQlik("unidades", 100, 103, 2)).toBe(false);
    expect(coincideConQlik("unidades", 100, 98, 2)).toBe(true);
    expect(coincideDesdeInforme).toBe(coincideConQlik);
  });

  it("los soles no dependen de la tolerancia de unidades (siempre < 0,1 %)", () => {
    expect(coincideConQlik("venta_soles", 1_000_000, 1_000_999, 50)).toBe(true);
    expect(coincideConQlik("venta_soles", 1_000_000, 1_001_000, 50)).toBe(false);
  });
});

describe("M5c regla 10 · reporte guardado y lector de reportes de 0.8.0", () => {
  const informeMes = (r: ReturnType<typeof armar>): InformeMes => r.informe.meses[0];

  it("armarReporteMes guarda base_conciliacion = comparable y cada fila trae comparable y no_comparable", () => {
    const r = armar([{}, { genero: "", mundo: "", linea: "", unidades: "40", venta_soles: "400" }], {
      totalesQlik: { "2026-09": { unidades: 10 } },
    });
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "ejemplo.csv", totalesQlik: { unidades: 10 } });
    expect(reporte.base_conciliacion).toBe("comparable");
    expect(BASE_CONCILIACION).toBe("comparable");
    const filas = reporte.conciliacion as FilaConciliacion[];
    expect(filas).toHaveLength(5);
    for (const f of filas) {
      expect(typeof f.comparable).toBe("number");
      expect(typeof f.no_comparable).toBe("number");
    }
    expect(filas.find((f) => f.medida === "unidades")).toMatchObject({ archivo: 50, no_comparable: 40, comparable: 10, estado_qlik: "coincide" });
    expect(informeMes(r).conciliacion).toEqual(filas);
    // el reporte sobrevive al JSON y se lee tal cual
    const leido = leerConciliacionGuardada(JSON.parse(JSON.stringify(reporte)));
    expect(leido.base).toBe("comparable");
    expect(leido.filas).toEqual(filas);
  });

  it("una fila de 0.8.0 se completa con comparable = archivo, no_comparable = 0 y base archivo", () => {
    const vieja = {
      medida: "unidades",
      qlik: 100,
      archivo: 120,
      excluido: 20,
      cargado: 100,
      descuadre: 0,
      diferencia_qlik: 20,
      diferencia_relativa: 0.2,
      estado_qlik: "difiere",
    };
    const l = leerFilaConciliacionGuardada(vieja);
    expect(l?.base).toBe("archivo");
    expect(l?.fila).toEqual({ ...vieja, no_comparable: 0, comparable: 120 });
    const nueva = leerFilaConciliacionGuardada({ ...vieja, no_comparable: 20, comparable: 100 });
    expect(nueva?.base).toBe("comparable");
    expect(nueva?.fila.comparable).toBe(100);
  });

  it("un reporte sin base_conciliacion se lee como archivo (la pantalla muestra la nota); filas ilegibles se descartan", () => {
    const reporte = {
      conciliacion: [
        { medida: "unidades", qlik: null, archivo: 5, excluido: 0, cargado: 5, descuadre: 0, diferencia_qlik: null, diferencia_relativa: null, estado_qlik: "sin_qlik" },
        { medida: "raro", archivo: 1 },
        "basura",
        null,
      ],
    };
    const l = leerConciliacionGuardada(reporte);
    expect(l.base).toBe("archivo");
    expect(l.filas).toHaveLength(1);
    expect(l.filas[0]).toMatchObject({ comparable: 5, no_comparable: 0 });
    expect(NOTA_CONCILIACION_080).toContain("0.8.0");
    expect(leerConciliacionGuardada(null)).toEqual({ filas: [], base: "archivo" });
    expect(leerConciliacionGuardada({ conciliacion: "x" }).filas).toEqual([]);
  });
});

describe("textos de estado de la conciliación", () => {
  const NB = " ";
  const base = { medida: "unidades" as const, estado_qlik: "coincide" as const, diferencia_qlik: 0 as number | null, diferencia_relativa: 0 as number | null };

  it("exacto, dentro de la tolerancia, difiere y sin total", () => {
    expect(textoEstadoQlik(base)).toEqual({ nivel: "exacto", texto: "Coincide (exacto)" });
    expect(textoEstadoQlik({ ...base, medida: "venta_soles", diferencia_qlik: -143, diferencia_relativa: 0.00004 })).toEqual({
      nivel: "tolerancia",
      texto: `Coincide dentro de la tolerancia: S/${NB}143 (0,004${NB}%)`,
    });
    expect(textoEstadoQlik({ ...base, estado_qlik: "difiere", diferencia_qlik: -1, diferencia_relativa: 1 / 54_763 }).texto).toBe(
      `Difiere: 1${NB}unidad (0,0018${NB}%)`
    );
    expect(textoEstadoQlik({ ...base, estado_qlik: "difiere", diferencia_qlik: 3, diferencia_relativa: 0.0003 }).texto).toBe(
      `Difiere: 3${NB}unidades (0,03${NB}%)`
    );
    expect(textoEstadoQlik({ ...base, medida: "costo_vendido", estado_qlik: "difiere", diferencia_qlik: 12_345, diferencia_relativa: 0.012 })).toEqual({
      nivel: "difiere",
      texto: `Difiere: S/${NB}12${NB}345 (1,2${NB}%)`,
    });
    expect(textoEstadoQlik({ ...base, estado_qlik: "sin_qlik", diferencia_qlik: null, diferencia_relativa: null }).nivel).toBe("sin_qlik");
  });

  it("formatearPorcentaje usa coma decimal y más decimales cuanto más pequeño", () => {
    expect(formatearPorcentaje(0.012)).toBe("1,2");
    expect(formatearPorcentaje(0.0999 / 100)).toBe("0,0999");
    expect(formatearPorcentaje(0.5 / 100)).toBe("0,5");
    expect(formatearPorcentaje(0)).toBe("0");
    expect(formatearPorcentaje(0.2)).toBe("20");
  });

  it("trunca en vez de redondear: 999,96 sobre 1 000 000 (0,099996 %) no se muestra como 0,1", () => {
    const fraccion = 999.96 / 1_000_000;
    expect(formatearPorcentaje(fraccion)).toBe("0,0999");
    expect(formatearPorcentaje(0.009996)).toBe("0,99");
    expect(formatearPorcentaje(0.09996)).toBe("9,9");
    expect(formatearPorcentaje(0.000000001)).toBe("<0,0001");
    // estado de la fila: QlikView 1 000 000, comparable 1 000 999,96 → coincide (< 0,1 %), sin leerse como 0,1
    const venta = (comparable: number) => {
      const archivo = tally({ filas: 1, venta: Math.round(comparable * 100) });
      return conciliarMes(archivo, tally({}), tally({}), tally({}), { venta_soles: 1_000_000 }).find((f) => f.medida === "venta_soles") as FilaConciliacion;
    };
    const coincide = venta(1_000_999.96);
    expect(coincide.estado_qlik).toBe("coincide");
    expect(textoEstadoQlik(coincide).texto).toBe(`Coincide dentro de la tolerancia: S/${NB}1${NB}000 (0,0999${NB}%)`);
    // y justo en 0,1 % difiere y se muestra 0,1
    const difiere = venta(1_001_000);
    expect(difiere.estado_qlik).toBe("difiere");
    expect(textoEstadoQlik(difiere).texto).toBe(`Difiere: S/${NB}1${NB}000 (0,1${NB}%)`);
  });
});
