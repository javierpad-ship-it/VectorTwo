import { describe, expect, it } from "vitest";
import {
  ID_SIN_ATRIBUIR,
  atribuirAnual,
  atribuirMensual,
  atribuirTiendas,
  repartirMayorResto,
  semillasMensuales,
  type EntradaTiendas,
  type FilaMensual,
  type HistoriaVenta,
  type TiendaAtribuible,
} from "@/lib/direccion/atribucion";
import { atribuirBase } from "@/lib/proyeccion/venta-por-tienda";
import {
  ESPERADO,
  HU_B,
  HU_BASE_2026,
  HU_BASE_2026_MESES,
  HU_BASE_2027,
  HU_BASE_2027_MESES,
  HU_T10_2026,
  K,
  T01,
  T02,
  T03,
  T04,
  T10,
  Y,
  completaCaso,
  publicadoCaso,
  suma,
  ventaHU,
} from "./direccion.fixture";

/** Ficha 14, §3.4 y R8 (sintético). R3 contra `armarVentaPorTienda` va en `tests/direccion.tablero.test.ts`, sobre la base falsa. */

const realAc = (id: string) => suma([1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => ventaHU(id, Y, m)));

const TIENDAS_HU: TiendaAtribuible[] = [
  { id: T01, codigo: "T01", clase: "misma", real: realAc(T01) },
  { id: T02, codigo: "T02", clase: "misma", real: realAc(T02) },
  { id: T03, codigo: "T03", clase: "misma", real: realAc(T03) },
  { id: T04, codigo: "T04", clase: "sale", real: realAc(T04) },
  { id: T10, codigo: "T10", clase: "entra", real: realAc(T10) },
];

const HISTORIA: HistoriaVenta = { venta: ventaHU, publicado: publicadoCaso, completa: completaCaso };

const entradaHU = (extra: Partial<EntradaTiendas> = {}): EntradaTiendas => ({
  tiendas: TIENDAS_HU,
  baseEnCurso: HU_BASE_2026,
  B: HU_B,
  baseSiguiente: HU_BASE_2027,
  vigenteSinB: 0,
  paraBase: new Map([[T10, HU_T10_2026]]),
  anio: Y,
  k: K,
  mesesBaseEnCurso: HU_BASE_2026_MESES,
  mesesBaseSiguiente: HU_BASE_2027_MESES,
  historia: HISTORIA,
  ...extra,
});

// ─── Generador con semilla fija (mulberry32): la prueba de propiedad es reproducible ───

function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("repartirMayorResto", () => {
  it("reparte en enteros, suma exacta y empate por posición", () => {
    expect(repartirMayorResto(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(repartirMayorResto(42940, [15000, 9000, 5000])).toEqual([22210, 13326, 7404]);
    expect(repartirMayorResto(7, [0, 3, -5, 4])).toEqual([0, 3, 0, 4]);
  });
  it("sin pesos o sin total: ceros", () => {
    expect(repartirMayorResto(10, [0, 0])).toEqual([0, 0]);
    expect(repartirMayorResto(0, [1, 2])).toEqual([0, 0]);
    expect(repartirMayorResto(-3, [1, 2])).toEqual([0, 0]);
  });
});

describe("atribuirMensual (§3.4 C)", () => {
  it("T = 0: todas las celdas en 0 y todo queda sin atribuir", () => {
    const r = atribuirMensual({ filas: [{ id: "a", orden: 0, total: 0, semilla: [1, 1, 1] }], columnas: [5, 0, 7] });
    expect(r.celdas.get("a")).toEqual([0, 0, 0]);
    expect(r.sinAtribuir).toEqual([5, 0, 7]);
  });

  it("C = 0: cada fila se reparte por su semilla y «sin atribuir» es negativo", () => {
    const r = atribuirMensual({
      filas: [
        { id: "a", orden: 0, total: 10, semilla: [1, 1, 2] },
        { id: "b", orden: 1, total: 3, semilla: [0, 0, 0] },
      ],
      columnas: [0, 0, 0],
    });
    expect(r.celdas.get("a")).toEqual([3, 2, 5]);
    expect(r.celdas.get("b")).toEqual([1, 1, 1]);
    expect(r.sinAtribuir).toEqual([-4, -3, -6]);
  });

  it("una fila sin total y una columna en 0 quedan fuera: sus celdas son 0", () => {
    const r = atribuirMensual({
      filas: [
        { id: "a", orden: 0, total: 30, semilla: [1, 5, 1] },
        { id: "b", orden: 1, total: 0, semilla: [9, 9, 9] },
        { id: "c", orden: 2, total: 12, semilla: [1, 5, 1] },
      ],
      columnas: [20, 0, 22],
    });
    expect(r.celdas.get("b")).toEqual([0, 0, 0]);
    expect(r.celdas.get("a")?.[1]).toBe(0);
    expect(r.celdas.get("c")?.[1]).toBe(0);
    expect(suma(r.celdas.get("a") ?? [])).toBe(30);
    expect(suma(r.celdas.get("c") ?? [])).toBe(12);
    expect(r.sinAtribuir).toEqual([0, 0, 0]);
  });

  it("T ≠ C: cada columna recibe su parte de T y el resto queda sin atribuir, con su signo", () => {
    const mas = atribuirMensual({ filas: [{ id: "a", orden: 0, total: 100, semilla: [1, 1] }], columnas: [30, 30] });
    expect(mas.celdas.get("a")).toEqual([50, 50]);
    expect(mas.sinAtribuir).toEqual([-20, -20]);
    const menos = atribuirMensual({ filas: [{ id: "a", orden: 0, total: 10, semilla: [1, 1] }], columnas: [30, 10] });
    expect(menos.celdas.get("a")).toEqual([8, 2]);
    expect(menos.sinAtribuir).toEqual([22, 8]);
  });

  it("no depende del orden en que llegan las filas (se ordenan por `orden` e `id`)", () => {
    const filas: FilaMensual[] = [
      { id: "x", orden: 2, total: 17, semilla: [0.2, 0.3, 0.5] },
      { id: "y", orden: 0, total: 23, semilla: [0.5, 0.3, 0.2] },
      { id: "z", orden: 1, total: 5, semilla: [0.1, 0.1, 0.8] },
    ];
    const columnas = [15, 14, 16];
    const a = atribuirMensual({ filas, columnas });
    const b = atribuirMensual({ filas: [...filas].reverse(), columnas });
    for (const f of filas) expect(b.celdas.get(f.id)).toEqual(a.celdas.get(f.id));
    expect(b.sinAtribuir).toEqual(a.sinAtribuir);
  });

  it("rechaza totales o columnas negativos o no enteros (quien llama debe decidir antes qué hacer)", () => {
    expect(() => atribuirMensual({ filas: [{ id: "a", orden: 0, total: -1, semilla: [1] }], columnas: [1] })).toThrow(RangeError);
    expect(() => atribuirMensual({ filas: [{ id: "a", orden: 0, total: 1.5, semilla: [1] }], columnas: [1] })).toThrow(RangeError);
    expect(() => atribuirMensual({ filas: [{ id: "a", orden: 0, total: 1, semilla: [1] }], columnas: [-2] })).toThrow(RangeError);
  });

  it("propiedad (6 000 casos con semilla fija): sin celdas negativas, filas y columnas exactas, determinista, y sin «sin atribuir» si T = C", () => {
    const azar = generador(20261110);
    const entero = (max: number) => Math.floor(azar() * (max + 1));
    const elegir = <T,>(v: readonly T[]): T => v[Math.floor(azar() * v.length)];
    let conTC = 0;
    let conCeros = 0;
    let conSinAtribuirNegativo = 0;
    let noConvergen = 0;
    for (let caso = 0; caso < 6000; caso++) {
      const nFilas = 1 + entero(11);
      const nCols = elegir([3, 6, 12]);
      const filas: FilaMensual[] = Array.from({ length: nFilas }, (_, i) => ({
        id: `f${String(i).padStart(2, "0")}`,
        orden: elegir([i, i, i, 0]),
        total: elegir([0, 1, 2, 3, 7, 10, 35, 50, 1000, entero(20000)]),
        semilla: Array.from({ length: nCols }, () => elegir([0, 0, azar(), 1e-6, 0.01, 1, -3, Number.NaN])),
      }));
      let columnas = Array.from({ length: nCols }, () => elegir([0, 0, 1, 2, entero(40), entero(30000)]));
      const T = suma(filas.map((f) => f.total));
      // Uno de cada cuatro casos se fuerza a `T = C` (las columnas son un reparto de T).
      if (caso % 4 === 0) columnas = repartirMayorResto(T, columnas.some((c) => c > 0) ? columnas : columnas.map(() => 1));
      const C = suma(columnas);

      const r = atribuirMensual({ filas, columnas });
      if (!r.convergio) noConvergen += 1;
      if (filas.some((f) => f.total === 0) || columnas.some((c) => c === 0)) conCeros += 1;

      const etiqueta = `caso ${caso}`;
      for (const f of filas) {
        const celdas = r.celdas.get(f.id);
        expect(celdas, etiqueta).toBeDefined();
        if (!celdas) continue;
        expect(celdas.length, etiqueta).toBe(nCols);
        expect(celdas.every((c) => Number.isInteger(c) && c >= 0), `${etiqueta}: celda negativa o no entera en ${f.id}`).toBe(true);
        expect(suma(celdas), `${etiqueta}: fila ${f.id}`).toBe(f.total);
        // Una fila sin total no recibe nada; una columna en 0 tampoco (salvo el caso sin columnas, C = 0).
        if (f.total === 0) expect(suma(celdas), etiqueta).toBe(0);
        if (C > 0) columnas.forEach((c, m) => c === 0 && expect(celdas[m], `${etiqueta}: columna ${m} en 0`).toBe(0));
      }
      for (let m = 0; m < nCols; m++) {
        const recibido = suma(filas.map((f) => r.celdas.get(f.id)?.[m] ?? 0));
        expect(recibido + r.sinAtribuir[m], `${etiqueta}: columna ${m}`).toBe(columnas[m]);
      }
      if (T === C) {
        conTC += 1;
        expect(r.sinAtribuir.every((x) => x === 0), `${etiqueta}: T = C`).toBe(true);
      }
      if (r.sinAtribuir.some((x) => x < 0)) conSinAtribuirNegativo += 1;

      // Determinista: la misma entrada da la misma salida, también con las filas en otro orden.
      if (caso % 10 === 0) {
        const otra = atribuirMensual({ filas: [...filas].reverse(), columnas });
        // Con `orden` repetido el desempate es el `id`, así que el resultado no depende del orden de llegada.
        for (const f of filas) expect(otra.celdas.get(f.id), `${etiqueta}: determinismo`).toEqual(r.celdas.get(f.id));
      }
    }
    // El generador cubre de verdad lo que la ficha pide.
    expect(conTC).toBeGreaterThan(1000);
    expect(conCeros).toBeGreaterThan(3000);
    expect(conSinAtribuirNegativo).toBeGreaterThan(500);
    // El ajuste converge prácticamente siempre; si no, el redondeo acotado mantiene los invariantes (ya comprobados arriba).
    expect(noConvergen).toBeLessThan(600);
  });

  it("si el ajuste no converge, el redondeo acotado sigue cuadrando filas y columnas", () => {
    // Semillas casi incompatibles con los totales (la fila grande solo «quiere» la columna chica): la convergencia es lenta.
    const filas: FilaMensual[] = [
      { id: "a", orden: 0, total: 20000, semilla: [1, 0, 0] },
      { id: "b", orden: 1, total: 1, semilla: [0, 1, 1] },
      { id: "c", orden: 2, total: 3, semilla: [1, 0, 1] },
    ];
    const columnas = [1, 10001, 10002];
    const r = atribuirMensual({ filas, columnas });
    for (const f of filas) {
      expect(suma(r.celdas.get(f.id) ?? [])).toBe(f.total);
      expect((r.celdas.get(f.id) ?? []).every((c) => c >= 0)).toBe(true);
    }
    columnas.forEach((c, m) => expect(suma(filas.map((f) => r.celdas.get(f.id)?.[m] ?? 0)) + r.sinAtribuir[m]).toBe(c));
    expect(r.sinAtribuir).toEqual([0, 0, 0]);
  });
});

describe("atribuirAnual (§3.4 A y B) con el caso de §6.1", () => {
  const anual = atribuirAnual(entradaHU());

  it("año en curso: la regla 111 de 07f para las `misma` y `L` para la que sale", () => {
    expect(anual.enCurso.get(T01)).toBe(ESPERADO.a2026[T01]);
    expect(anual.enCurso.get(T02)).toBe(ESPERADO.a2026[T02]);
    expect(anual.enCurso.get(T03)).toBe(ESPERADO.a2026[T03]);
    expect(anual.enCurso.get(T10)).toBe(HU_T10_2026);
    expect(anual.L).toBe(2961);
    expect(anual.enCurso.get(T04)).toBe(ESPERADO.a2026[T04]);
    expect(anual.sinAtribuir07f).toBe(0);
    expect(anual.sinAtribuirSale).toBe(0);
  });

  it("es la MISMA función de 07f con las mismas entradas (R3)", () => {
    const de07f = atribuirBase({
      total: HU_B,
      entran: new Map([[T10, HU_T10_2026]]),
      mismas: TIENDAS_HU.filter((t) => t.clase === "misma").map((t) => ({ tienda_id: t.id, codigo: t.codigo, real: t.real })),
    });
    for (const [id, v] of de07f.porTienda) expect(anual.enCurso.get(id)).toBe(v);
    expect(anual.sinAtribuir07f).toBe(de07f.sinAtribuir);
  });

  it("invariante del año en curso, exacto en enteros", () => {
    const mismas = suma([T01, T02, T03].map((t) => anual.enCurso.get(t) ?? 0));
    expect(mismas + anual.sinAtribuir07f + (anual.enCurso.get(T04) ?? 0) + anual.sinAtribuirSale).toBe(HU_BASE_2026);
  });

  it("año siguiente: la base atribuida por el crecimiento del recorte", () => {
    for (const t of [T01, T02, T03, T10]) expect(anual.siguiente.get(t)).toBe(ESPERADO.a2027[t]);
    expect(suma([...anual.siguiente.values()]) + anual.sinAtribuirSiguiente).toBe(HU_BASE_2027);
    expect(anual.sinAtribuirSiguiente).toBe(0);
    expect(anual.siguiente.has(T04)).toBe(false);
  });

  it("con filas sin B, L va entero a «sin atribuir» y la que sale no recibe nada (M-D)", () => {
    const r = atribuirAnual(entradaHU({ vigenteSinB: 40 }));
    expect(r.filasSinB).toBe(true);
    expect(r.enCurso.get(T04)).toBe(0);
    expect(r.sinAtribuirSale).toBe(2961);
    expect(suma([T01, T02, T03].map((t) => r.enCurso.get(t) ?? 0)) + r.sinAtribuir07f + r.sinAtribuirSale).toBe(HU_BASE_2026);
  });

  it("L ≤ 0, sin tiendas que salen o todas con peso 0: todo L queda sin atribuir", () => {
    const negativo = atribuirAnual(entradaHU({ baseEnCurso: 42000 }));
    expect(negativo.L).toBe(-940);
    expect(negativo.sinAtribuirSale).toBe(-940);
    expect(negativo.enCurso.get(T04)).toBe(0);

    const sinSale = atribuirAnual(entradaHU({ tiendas: TIENDAS_HU.filter((t) => t.clase !== "sale") }));
    expect(sinSale.sinAtribuirSale).toBe(2961);

    const pesoCero = atribuirAnual(entradaHU({ tiendas: TIENDAS_HU.map((t) => (t.clase === "sale" ? { ...t, real: -5 } : t)) }));
    expect(pesoCero.sinAtribuirSale).toBe(2961);
    expect(pesoCero.enCurso.get(T04)).toBe(0);
  });

  it("ninguna `misma` vendió en el recorte: la base queda sin atribuir y también el año siguiente, salvo lo de la que entra", () => {
    const r = atribuirAnual(entradaHU({ tiendas: TIENDAS_HU.map((t) => (t.clase === "misma" ? { ...t, real: 0 } : t)) }));
    expect(r.sinAtribuir07f).toBe(HU_B - HU_T10_2026);
    for (const t of [T01, T02, T03]) {
      expect(r.enCurso.get(t)).toBe(0);
      expect(r.siguiente.get(t)).toBe(0);
    }
    // El 2027 se reparte entre T10 (4 100) y la fila «sin atribuir» (42 940), que no es una tienda.
    expect((r.siguiente.get(T10) ?? 0) + r.sinAtribuirSiguiente).toBe(HU_BASE_2027);
    expect(r.siguiente.has(ID_SIN_ATRIBUIR)).toBe(false);
    expect(r.sinAtribuirSiguiente).toBeGreaterThan(40000);
  });

  it("sin base B (método anterior): nada se atribuye a las mismas tiendas y todo cuadra", () => {
    const r = atribuirAnual(entradaHU({ B: null, paraBase: new Map() }));
    for (const t of [T01, T02, T03, T04]) expect(r.enCurso.get(t)).toBe(0);
    expect(r.sinAtribuir07f + r.sinAtribuirSale).toBe(HU_BASE_2026);
    expect(suma([...r.siguiente.values()]) + r.sinAtribuirSiguiente).toBe(HU_BASE_2027);
  });
});

describe("semillasMensuales (§3.4 C)", () => {
  const filas = [
    { id: T01, total: ESPERADO.a2027[T01] },
    { id: T02, total: ESPERADO.a2027[T02] },
    { id: T03, total: ESPERADO.a2027[T03] },
    { id: T10, total: ESPERADO.a2027[T10] },
  ];
  const meses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it("participación del mismo mes del último año completo, entre las tiendas con historia completa", () => {
    const s = semillasMensuales({ filas, meses, anioReferencia: Y - 1, historia: HISTORIA });
    // Enero de 2025: T01 1 607, T02 996, T03 338 (T10 no tiene historia completa y no entra en el denominador).
    expect(s.get(T03)?.[0]).toBeCloseTo(338 / (1607 + 996 + 338), 12);
    expect(s.get(T01)?.[11]).toBeCloseTo(3100 / (3100 + 2098 + 900), 12);
  });

  it("una tienda sin historia completa en el año de referencia usa su participación anual en TODOS los meses (R8)", () => {
    const s = semillasMensuales({ filas, meses, anioReferencia: Y - 1, historia: HISTORIA });
    const anual = ESPERADO.a2027[T10] / HU_BASE_2027;
    expect(s.get(T10)).toEqual(meses.map(() => anual));
  });

  it("un mes sin carga en el año de referencia se toma del año previo", () => {
    const sinMarzo: HistoriaVenta = { ...HISTORIA, publicado: (anio, mes) => !(anio === Y - 1 && mes === 3) && publicadoCaso(anio, mes) };
    const s = semillasMensuales({ filas, meses, anioReferencia: Y - 1, historia: sinMarzo });
    const marzo2024 = (t: string) => ventaHU(t, Y - 2, 3);
    expect(s.get(T03)?.[2]).toBeCloseTo(marzo2024(T03) / (marzo2024(T01) + marzo2024(T02) + marzo2024(T03)), 12);
    // Los demás meses siguen saliendo de 2025.
    expect(s.get(T03)?.[0]).toBeCloseTo(338 / (1607 + 996 + 338), 12);
  });

  it("venta ≤ 0 en el mes: el mismo mes del año previo si sirve; si no, la participación anual", () => {
    const sinVenta: HistoriaVenta = { ...HISTORIA, venta: (t, anio, mes) => (t === T03 && anio === Y - 1 && mes === 5 ? 0 : ventaHU(t, anio, mes)) };
    const s = semillasMensuales({ filas, meses, anioReferencia: Y - 1, historia: sinVenta });
    const mayo2024 = (t: string) => ventaHU(t, Y - 2, 5);
    expect(s.get(T03)?.[4]).toBeCloseTo(mayo2024(T03) / (mayo2024(T01) + mayo2024(T02) + mayo2024(T03)), 12);

    const niPrevio: HistoriaVenta = { ...HISTORIA, venta: (t, anio, mes) => (t === T03 && mes === 5 ? -4 : ventaHU(t, anio, mes)) };
    const s2 = semillasMensuales({ filas, meses, anioReferencia: Y - 1, historia: niPrevio });
    expect(s2.get(T03)?.[4]).toBeCloseTo(ESPERADO.a2027[T03] / HU_BASE_2027, 12);
  });

  it("la fila «sin atribuir» usa su parte del total en todos los meses", () => {
    const s = semillasMensuales({ filas: [...filas, { id: ID_SIN_ATRIBUIR, total: 5030 }], meses, anioReferencia: Y - 1, historia: HISTORIA });
    expect(s.get(ID_SIN_ATRIBUIR)).toEqual(meses.map(() => 5030 / (HU_BASE_2027 + 5030)));
  });
});

describe("atribuirTiendas (§3.4 D) con el caso de §6.1", () => {
  const r = atribuirTiendas(entradaHU());

  it("T03 en 2026: real exacto de enero a setiembre y 659, 673 y 1 072 de octubre a diciembre (7 404)", () => {
    const t03 = r.enCurso.porTienda.get(T03);
    expect(t03?.anual).toBe(7404);
    expect(t03?.meses.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => ventaHU(T03, Y, m)));
    expect(t03?.meses.slice(9)).toEqual(ESPERADO.t03_oct_dic);
    expect(suma((t03?.meses ?? []).map((x) => x ?? 0))).toBe(7404);
  });

  it("T04 (sale) en 2026: 2 961, con 226, 260 y 475 de octubre a diciembre", () => {
    const t04 = r.enCurso.porTienda.get(T04);
    expect(t04?.anual).toBe(2961);
    expect(t04?.meses.slice(9)).toEqual(ESPERADO.t04_oct_dic);
  });

  it("la que entra (T10) no se atribuye en el año en curso: su 2026 son sus filas de tienda", () => {
    expect(r.enCurso.porTienda.has(T10)).toBe(false);
    expect(r.enCurso.mensual).toBe(true);
  });

  it("2026: por mes, Σ tiendas + sin atribuir = meses de la base; por tienda, Σ meses = total anual", () => {
    for (let m = 0; m < 12; m++) {
      const tiendas = suma([...r.enCurso.porTienda.values()].map((t) => t.meses[m] ?? 0));
      expect(tiendas + (r.enCurso.sinAtribuirMes[m] ?? 0)).toBe(HU_BASE_2026_MESES[m]);
    }
    for (const t of r.enCurso.porTienda.values()) expect(suma(t.meses.map((x) => x ?? 0))).toBe(t.anual);
    expect(r.enCurso.sinAtribuir).toBe(0);
    expect(r.enCurso.sinAtribuirMes.every((x) => x === 0)).toBe(true);
  });

  it("T03 en 2027: 7 917, con el redondeo de §3.4 C mes a mes", () => {
    const t03 = r.siguiente.porTienda.get(T03);
    expect(t03?.anual).toBe(7917);
    expect(t03?.meses).toEqual(ESPERADO.t03_2027);
  });

  it("2027: cada mes suma la columna de la base, ninguna celda es negativa y cada tienda suma su total", () => {
    for (let m = 0; m < 12; m++) {
      expect(suma([...r.siguiente.porTienda.values()].map((t) => t.meses[m] ?? 0))).toBe(HU_BASE_2027_MESES[m]);
    }
    for (const [id, t] of r.siguiente.porTienda) {
      expect(t.anual).toBe(ESPERADO.a2027[id]);
      expect(suma(t.meses.map((x) => x ?? 0))).toBe(t.anual);
      expect(t.meses.every((x) => (x ?? 0) >= 0)).toBe(true);
    }
    expect(r.siguiente.sinAtribuirMes.every((x) => x === 0)).toBe(true);
  });

  it("T03: participación anual 15,7 % de la base y, por mes de 2025, de 11,5 % (enero) a 22,8 % (junio)", () => {
    expect(ESPERADO.a2026[T03] / HU_B).toBeCloseTo(0.157, 3);
    const partes = r.siguiente.participacionMes.get(T03) ?? [];
    expect(partes[0]).toBeCloseTo(0.115, 3);
    expect(partes[5]).toBeCloseTo(0.228, 3);
    expect(Math.min(...partes.map((x) => x ?? 1))).toBeCloseTo(0.115, 3);
    expect(Math.max(...partes.map((x) => x ?? 0))).toBeCloseTo(0.228, 3);
    // T10 no tiene historia completa en 2025: usa su participación anual y aquí va `null` en todos los meses.
    expect(r.siguiente.participacionMes.get(T10)).toEqual(new Array(12).fill(null));
  });

  it("T10 (sin historia completa en 2025) sigue la forma de la red: su parte de cada mes es casi constante", () => {
    const t10 = r.siguiente.porTienda.get(T10);
    const partes = (t10?.meses ?? []).map((x, m) => (x ?? 0) / HU_BASE_2027_MESES[m]);
    const media = ESPERADO.a2027[T10] / HU_BASE_2027;
    for (const p of partes) expect(Math.abs(p - media)).toBeLessThan(0.02);
  });

  it("con A_t − real_t < 0 no hay reparto mensual de k+1 a 12; el total anual sí (atribucion_sin_mensual)", () => {
    // La base B quedó por debajo de lo ya vendido: a cada `misma` le toca menos de lo que vendió de enero a setiembre.
    const x = atribuirTiendas(entradaHU({ B: 30000 }));
    expect((x.anual.enCurso.get(T03) ?? 0) - 5000).toBeLessThan(0);
    expect(x.enCurso.mensual).toBe(false);
    for (const t of x.enCurso.porTienda.values()) {
      expect(t.meses.slice(9)).toEqual([null, null, null]);
      expect(t.meses.slice(0, 9).every((v) => v !== null)).toBe(true);
    }
    expect(x.enCurso.sinAtribuirMes.slice(9)).toEqual([null, null, null]);
    // El total anual sigue siendo el de la regla 111 y el año siguiente se reparte igual.
    expect(suma([T01, T02, T03].map((t) => x.anual.enCurso.get(t) ?? 0)) + x.anual.sinAtribuir07f).toBe(30000 - HU_T10_2026);
    expect(suma([T01, T02, T03, T04].map((t) => x.anual.enCurso.get(t) ?? 0)) + x.enCurso.sinAtribuir).toBe(HU_BASE_2026);
    expect(suma([...x.siguiente.porTienda.values()].map((t) => t.anual))).toBe(HU_BASE_2027);
  });

  it("un «sin atribuir» anual negativo no impide el reparto mensual: aparece, con su signo, en el mes", () => {
    // Sin tiendas que salen y con la base de 2026 del recorte 539 u por debajo de lo atribuido a las `misma`: L < 0.
    const sinSale = TIENDAS_HU.filter((t) => t.clase !== "sale");
    const octDic = [3000, 3200, 7201];
    const x = atribuirTiendas(entradaHU({ tiendas: sinSale, baseEnCurso: 42940 - 539, mesesBaseEnCurso: [...HU_BASE_2026_MESES.slice(0, 9), ...octDic] }));
    expect(x.anual.L).toBe(-539);
    expect(x.enCurso.sinAtribuir).toBe(-539);
    expect(x.enCurso.mensual).toBe(true);
    // Las `misma` reparten 13 940 u en tres meses donde el bloque proyecta 13 401: la diferencia sale, con su signo, en «sin atribuir».
    const sinMes = x.enCurso.sinAtribuirMes.slice(9).map((v) => v ?? 0);
    expect(suma(sinMes)).toBe(-539);
    expect(sinMes.every((v) => v <= 0)).toBe(true);
    for (let m = 9; m < 12; m++) {
      const tiendas = suma([...x.enCurso.porTienda.values()].map((t) => t.meses[m] ?? 0));
      expect(tiendas + (x.enCurso.sinAtribuirMes[m] ?? 0)).toBe(octDic[m - 9]);
    }
    for (const t of x.enCurso.porTienda.values()) {
      expect(t.meses.every((v) => v !== null && v >= 0)).toBe(true);
      expect(suma(t.meses.map((v) => v ?? 0))).toBe(t.anual);
    }
  });

  it("k = 12: no hay proyectado del año en curso y solo se reparte el año siguiente", () => {
    const x = atribuirTiendas(entradaHU({ k: 12 }));
    expect(x.enCurso.mensual).toBe(true);
    expect(x.enCurso.porTienda.get(T03)?.meses.every((v) => v !== null)).toBe(true);
    expect(suma([...x.siguiente.porTienda.values()].map((t) => t.anual))).toBe(HU_BASE_2027);
  });

  it("recorte sin venta en ninguna tienda: todo a «sin atribuir», nada a una tienda", () => {
    const sinVenta: HistoriaVenta = { ...HISTORIA, venta: () => 0 };
    const x = atribuirTiendas(entradaHU({ tiendas: TIENDAS_HU.map((t) => ({ ...t, real: 0 })), paraBase: new Map(), historia: sinVenta }));
    for (const t of x.enCurso.porTienda.values()) expect(t.anual).toBe(0);
    expect(x.enCurso.sinAtribuir).toBe(HU_BASE_2026);
    for (const t of x.siguiente.porTienda.values()) expect(t.anual).toBe(0);
    expect(x.siguiente.sinAtribuir).toBe(HU_BASE_2027);
    for (let m = 0; m < 12; m++) expect(x.siguiente.sinAtribuirMes[m]).toBe(HU_BASE_2027_MESES[m]);
  });
});
