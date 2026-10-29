import { describe, expect, it } from "vitest";
import { efectoAtipicoCorrida, medirPeriodo, type AnioDeGrupo, type GrupoParaEfecto, type SerieParaVolumen } from "@/lib/curvas/efecto";
import type { RedAnio } from "@/lib/curvas/tipos-api";

/**
 * R23 (06e §5.2, sintético): el efecto medido solo en los meses del periodo atípico. Aditivo: las columnas de «Años Niño»
 * (todos los meses publicados) no cambian.
 */

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
const publicados = (n: number) => Array.from({ length: 12 }, (_, m) => m < n);
const mascara = (...meses: number[]) => Array.from({ length: 12 }, (_, m) => meses.includes(m + 1));

/** Serie con la misma venta por tienda (`a` y `b`) cada mes: `porMes[m]` es el total del mes sobre las dos tiendas. */
function serie(anio: number, porMes: number[], publicadosN: number): SerieParaVolumen {
  const u = Array.from({ length: 12 }, (_, m) => (m < publicadosN ? (porMes[m] ?? 0) : 0));
  return {
    anio,
    unidades: u,
    publicados: publicados(publicadosN),
    por_tienda: new Map([
      ["a", u.map((x) => x / 2)],
      ["b", u.map((x) => x / 2)],
    ]),
  };
}

const cada = (valor: number, n: number) => Array.from({ length: n }, () => valor);

describe("R23 · medirPeriodo (ejemplo G: verano, N = 2025, periodo set–dic, k = 9)", () => {
  // ene–ago: 2025 = 50 000 (6 250 por mes), 2026 = 60 000 (7 500); setiembre 7 000 → 13 300. Control: ×0,95 todos los meses.
  const verano25 = serie(2025, [...cada(6250, 8), 7000, 8000, 9000, 9500], 12);
  const verano26 = serie(2026, [...cada(7500, 8), 13300], 9);
  const control25 = serie(2025, cada(10000, 12), 12);
  const control26 = serie(2026, cada(9500, 9), 9);
  const entrada = { y: verano26, referencia: verano25, controlY: control26, controlReferencia: control25, redes: REDES, mesesPeriodo: mascara(9, 10, 11, 12) };

  it("1,90 / 1,20 / 0,95 / 2,00 con un solo mes del periodo; los meses sin publicar no entran", () => {
    const p = medirPeriodo(entrada);
    expect(p.ratio_volumen).toBeCloseTo(1.9, 10);
    expect(p.ratio_fuera).toBeCloseTo(1.2, 10);
    expect(p.ratio_control).toBeCloseTo(0.95, 10);
    expect(p.relativo).toBeCloseTo(2, 10);
    expect(p.ratio_volumen! / p.ratio_fuera!).toBeCloseTo(1.58, 2);
    expect(p.meses_periodo).toBe(4);
    expect(p.meses_periodo_con_dato).toBe(1);
    expect(p.meses).toHaveLength(12);
    expect(p.meses[8]).toMatchObject({ m: 9, en_periodo: true, u: 13300, u_ref: 7000 });
    expect(p.meses[8].ratio).toBeCloseTo(1.9, 10);
    expect(p.meses[8].control).toBeCloseTo(0.95, 10);
    expect(p.meses[8].relativo).toBeCloseTo(2, 10);
    expect(p.meses[0]).toMatchObject({ m: 1, en_periodo: false });
    expect(p.meses[0].ratio).toBeCloseTo(1.2, 10);
    expect(p.meses[9]).toMatchObject({ m: 10, en_periodo: false, u: 0, ratio: null, control: null, relativo: null });
  });

  it("con setiembre y octubre publicados el periodo tiene dos meses y usa solo esos", () => {
    const y = serie(2026, [...cada(7500, 8), 13300, 12000], 10);
    const c = serie(2026, cada(9500, 10), 10);
    const p = medirPeriodo({ ...entrada, y, controlY: c });
    expect(p.meses_periodo_con_dato).toBe(2);
    expect(p.ratio_volumen).toBeCloseTo((13300 + 12000) / (7000 + 8000), 10);
    expect(p.ratio_control).toBeCloseTo(0.95, 10);
    expect(p.relativo).toBeCloseTo((25300 / 15000) / 0.95, 10);
  });

  it("sin tiendas comunes, o sin control, los ratios salen null", () => {
    const sinComunes = new Map([
      [2025, red(2025, ["a"])],
      [2026, red(2026, ["z"])],
    ]);
    const a = medirPeriodo({ ...entrada, redes: sinComunes });
    expect(a).toMatchObject({ ratio_volumen: null, ratio_control: null, relativo: null, ratio_fuera: null });
    const b = medirPeriodo({ ...entrada, controlY: null, controlReferencia: null });
    expect(b.ratio_volumen).toBeCloseTo(1.9, 10);
    expect(b).toMatchObject({ ratio_control: null, relativo: null });
  });
});

describe("R23 · bloque periodo en efectoAtipicoCorrida", () => {
  const anio25 = (porMes: number[]): AnioDeGrupo => ({ ...serie(2025, porMes, 12), clase: "normal", meses_atipicos: 0 });
  const anio26 = (porMes: number[], atipicos: boolean[] | undefined): AnioDeGrupo => ({
    ...serie(2026, porMes, 9),
    clase: "en_curso",
    meses_atipicos: atipicos ? atipicos.filter(Boolean).length : 12,
    ...(atipicos ? { mascara_atipicos: atipicos } : {}),
  });
  const grupos = (atipicos: boolean[] | undefined): GrupoParaEfecto[] => [
    { temporada: "invierno", agrupaciones: 1, anios: [anio25(cada(1000, 12)), anio26(cada(660, 9), atipicos)] },
    { temporada: "todo_el_ano", agrupaciones: 1, anios: [anio25(cada(2000, 12)), anio26(cada(1880, 9), undefined)] },
  ];
  const corrida = (g: GrupoParaEfecto[]) => efectoAtipicoCorrida(g, [REDES.get(2025)!, REDES.get(2026)!], { umbral_forma: 3, margen_ruido: 0.25 });
  const fila = (e: ReturnType<typeof corrida>, temporada: string) => e.por_temporada.find((f) => f.anio === 2026 && f.temporada === temporada);

  it("invierno 2026 con el periodo ene–dic: el relativo del periodo es el ratio_relativo de siempre (0,66 ÷ 0,94 = 0,702)", () => {
    const f = fila(corrida(grupos(mascara(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))), "invierno");
    expect(f?.ratio_volumen).toBeCloseTo(0.66, 10);
    expect(f?.ratio_control).toBeCloseTo(0.94, 10);
    expect(f?.ratio_relativo).toBeCloseTo(0.66 / 0.94, 10);
    expect(f?.periodo).toBeDefined();
    expect(f?.periodo?.relativo).toBeCloseTo(f?.ratio_relativo ?? NaN, 10);
    expect(f?.periodo?.ratio_volumen).toBeCloseTo(0.66, 10);
    expect(f?.periodo?.ratio_control).toBeCloseTo(0.94, 10);
    expect(f?.periodo).toMatchObject({ meses_periodo: 12, meses_periodo_con_dato: 9, ratio_fuera: null });
  });

  it("un periodo parcial (jul–dic) usa solo esos meses; las columnas de siempre siguen midiendo todos los publicados", () => {
    const g = grupos(mascara(7, 8, 9, 10, 11, 12));
    g[0] = { ...g[0], anios: [g[0].anios[0], anio26([...cada(500, 6), 800, 800, 800], mascara(7, 8, 9, 10, 11, 12))] };
    const f = fila(corrida(g), "invierno");
    expect(f?.ratio_volumen).toBeCloseTo((3000 + 2400) / 9000, 10);
    expect(f?.periodo?.ratio_volumen).toBeCloseTo(2400 / 3000, 10);
    expect(f?.periodo?.ratio_fuera).toBeCloseTo(3000 / 6000, 10);
    expect(f?.periodo?.meses_periodo_con_dato).toBe(3);
  });

  it("solo las filas de invierno y verano llevan periodo, y sin máscara no hay bloque (aditivo)", () => {
    const con = corrida(grupos(mascara(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)));
    expect(fila(con, "todo_el_ano")?.periodo).toBeUndefined();
    const sin = corrida(grupos(undefined));
    expect(fila(sin, "invierno")?.periodo).toBeUndefined();
    expect(fila(sin, "invierno")?.ratio_relativo).toBeCloseTo(0.66 / 0.94, 10);
    expect(JSON.stringify(fila(sin, "invierno"))).not.toContain("periodo");
  });
});
