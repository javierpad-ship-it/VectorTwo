import { describe, expect, it } from "vitest";
import type { FilaCrecimiento } from "@/lib/proyeccion/crecimientos";
import type { TiendaVentaApi, VentaPorTiendaApi } from "@/lib/proyeccion/tipos-api";
import {
  agregarSeries,
  armarVentaPorTienda,
  paresVariacion,
  periodosVenta,
  variacionVenta,
  vigentesDeTiendasNuevas,
  type EntradaVentaPorTienda,
  type FilaTiendaNueva,
  type SerieVentaTienda,
} from "@/lib/proyeccion/venta-por-tienda";
import { columnasPorTienda, hojasPorTienda, motivosPresentes, tablaPorTienda, textoLeyendaMotivos } from "../src/app/(app)/planificacion/proyeccion/venta-por-tienda-vista";
import { AM, bloquesFixture, cargasFixture, entradaMujerUrbano, maestroVenta, seriesMujerUrbano, T, Y } from "./proyeccion.venta-por-tienda.fixture";

/**
 * 07f · casos borde de QA (ficha §7), sobre la lógica pura y la vista: devoluciones netas negativas, un solo mes cargado, corte en diciembre (`k = 12`), un Resto con 365
 * nodos, `base.total` fraccionario, formato de miles y etiquetas del Excel. Sintético: ningún dato real de Lukers.
 */

const armar = (extra: Parameters<typeof entradaMujerUrbano>[0] = {}) => armarVentaPorTienda(entradaMujerUrbano(extra));
const tienda = (r: VentaPorTiendaApi, codigo: string): TiendaVentaApi => {
  const t = r.tiendas.find((x) => x.codigo === codigo);
  if (!t) throw new Error(`falta la tienda ${codigo}`);
  return t;
};
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** El invariante de §3.3 en enteros: Σ vigente de la base + «sin atribuir» = Σ B (redondeada). */
const cuadre = (r: VentaPorTiendaApi) => suma(r.tiendas.filter((t) => t.grupo === "base").map((t) => t.vigente?.u ?? 0)) + r.base.sin_atribuir;
const mes = (anio: number, m: number) => `${anio}-${String(m).padStart(2, "0")}`;

describe("tienda con devoluciones netas negativas", () => {
  // T02 devuelve más de lo que vende de enero a septiembre de 2026 (−50 u al mes, −2 500 S/ al mes) y de enero a septiembre de 2025.
  const sinT02 = seriesMujerUrbano().filter((s) => !(s.t === T.T02 && (s.p >= "2025-01" && s.p <= "2025-09" ? true : s.p >= "2026-01")));
  const negativas: SerieVentaTienda[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ t: T.T02, p: mes(2025, i + 1), u: -20, s: -1000 })),
    ...Array.from({ length: 9 }, (_, i) => ({ t: T.T02, p: mes(2026, i + 1), u: -50, s: -2500 })),
  ];
  const r = armar({ series: [...sinT02, ...negativas] });

  it("suma las unidades y los soles negativos tal cual", () => {
    const t = tienda(r, "T02");
    expect(t.periodos["2026-ac"]).toMatchObject({ u: -450, s: -22500 });
    expect(t.periodos["2025-ac"]).toMatchObject({ u: -180, s: -9000 });
  });

  it("pesa 0 en el reparto: su vigente es 0 y todo R se reparte entre T01 y T03; el cuadre se mantiene", () => {
    expect(tienda(r, "T02").vigente?.u).toBe(0);
    expect(tienda(r, "T01").vigente!.u + tienda(r, "T03").vigente!.u).toBe(14000);
    expect(r.base.sin_atribuir).toBe(0);
    expect(cuadre(r)).toBe(15600);
    expect(r.base.total).toBe(15600);
  });

  it("su variación frente a un periodo anterior negativo es «sin dato»; frente a uno positivo, un % negativo", () => {
    expect(variacionVenta(-180, -450)).toEqual({ pct: null, motivo: "sin_dato" });
    expect(variacionVenta(2500, -450).pct).toBeCloseTo(-118, 5);
    const fila = tablaPorTienda(r).filas.find((f) => f.codigo === "T02");
    expect(fila?.variaciones["2026-ac"].u.motivo).toBe("sin_dato");
    expect(fila?.variaciones["2026-ac"].lineas.map((l) => l.texto)).toEqual(["—"]);
  });

  it("los subtotales usan la suma con signo", () => {
    const base = r.totales.base.periodos["2026-ac"];
    expect(base.u).toBe(6000 + 1000 + 1200 - 450);
  });
});

describe("un solo mes cargado", () => {
  const unMes: SerieVentaTienda[] = seriesMujerUrbano().filter((s) => s.p === "2026-01");
  const r = armar({ series: unMes, cargas: { "2026-01": "carga-unica" } });

  it("no inventa años completos: solo quedan los cortes ene–set, con sus meses faltantes", () => {
    expect(r.periodos.map((p) => p.clave)).toEqual(["2025-ac", "2026-ac"]);
    expect(r.periodos.find((p) => p.clave === "2025-ac")?.meses_faltantes).toHaveLength(9);
    expect(r.periodos.find((p) => p.clave === "2026-ac")?.meses_faltantes).toEqual(Array.from({ length: 8 }, (_, i) => mes(2026, i + 2)));
  });

  it("las variaciones salen «incompleto» y se avisa de los meses faltantes", () => {
    const fila = tablaPorTienda(r).filas.find((f) => f.codigo === "T01");
    expect(fila?.variaciones["2026-ac"].u.motivo).toBe("incompleto");
    expect(fila?.variaciones["2026-ac"].s?.motivo).toBe("incompleto");
    expect(r.avisos.map((a) => a.codigo)).toContain("meses_faltantes");
  });

  it("el cuadre con Σ B no depende de la venta cargada", () => {
    expect(r.base.total).toBe(15600);
    expect(cuadre(r)).toBe(15600);
  });

  it("sin ningún mes publicado, ninguna cifra rompe y todo va a «sin atribuir»", () => {
    const vacio = armar({ series: [], cargas: {} });
    expect(vacio.periodos.map((p) => p.clave)).toEqual(["2025-ac", "2026-ac"]);
    expect(cuadre(vacio)).toBe(15600);
    expect(vacio.base.sin_atribuir).toBe(14000);
  });
});

describe("k = 12 (corte en diciembre)", () => {
  it("periodosVenta no repite el año completo: «2025» y «2025 ene–dic» eran la misma columna", () => {
    const publicados = new Set(Object.keys(cargasFixture()));
    const claves = periodosVenta(Y, 12, publicados).map((p) => p.clave);
    expect(claves).toEqual(["2023", "2024", "2025", "2026-ac"]);
    expect(new Set(claves).size).toBe(claves.length);
    // Con otro corte el «mismo corte» del año anterior sí se muestra.
    expect(periodosVenta(Y, 9, publicados).map((p) => p.clave)).toEqual(["2023", "2024", "2025", "2025-ac", "2026-ac"]);
  });

  it("si el año anterior no tiene ningún mes publicado, el corte ene–dic del año anterior se conserva (no hay otra columna que lo cubra)", () => {
    const claves = periodosVenta(Y, 12, new Set(["2026-01"])).map((p) => p.clave);
    expect(claves).toEqual(["2025-ac", "2026-ac"]);
  });

  it("el año en curso se compara con el año anterior completo", () => {
    const publicados = new Set(Object.keys(cargasFixture()));
    expect(paresVariacion(Y, periodosVenta(Y, 12, publicados))).toEqual([
      { clave: "2024", contra: "2023" },
      { clave: "2025", contra: "2024" },
      { clave: "2026-ac", contra: "2025" },
      { clave: "vigente", contra: "2025" },
    ]);
  });

  it("la respuesta y la tabla no duplican columnas ni títulos, y la variación del año en curso existe", () => {
    const cargas = { ...cargasFixture(), [mes(2026, 10)]: "c10", [mes(2026, 11)]: "c11", [mes(2026, 12)]: "c12" };
    const r = armar({ k: 12, hastaPeriodo: "2026-12", cargas });
    expect(r.periodos.map((p) => p.clave)).toEqual(["2023", "2024", "2025", "2026-ac"]);
    const titulos = columnasPorTienda(r).filter((c) => c.tipo === "periodo").map((c) => c.titulo);
    expect(titulos).toEqual(["2023", "2024", "2025", "2026 ene–dic (real)"]);
    const t01 = tablaPorTienda(r).filas.find((f) => f.codigo === "T01");
    // T01: 2026 ene–dic real 6 000 frente a 2025 completo 7 000.
    expect(t01?.variaciones["2026-ac"].u.pct).toBeCloseTo(((6000 - 7000) / 7000) * 100, 5);
    expect(t01?.variaciones["2026-ac"].titulo).toContain("2026 ene–dic (real) frente a 2025.");
    expect(cuadre(r)).toBe(15600);
  });

  it("agregarSeries no cuenta dos veces diciembre de 2025 con un solo periodo para el año", () => {
    const periodos = periodosVenta(Y, 12, new Set(Object.keys(cargasFixture())));
    const c = agregarSeries([{ t: "t", p: "2025-12", u: 7, s: 70 }], periodos).get("t");
    expect(Object.keys(c ?? {})).toEqual(["2025"]);
  });
});

describe("el Resto con 365 nodos", () => {
  const N = 365;
  const nodos = Array.from({ length: N }, (_, i) => `c0000009-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const meses: string[] = [...Array.from({ length: 12 }, (_, i) => mes(2025, i + 1)), ...Array.from({ length: 9 }, (_, i) => mes(2026, i + 1))];

  function entradaResto(): EntradaVentaPorTienda {
    const series: SerieVentaTienda[] = [];
    // La función SQL ya devuelve una serie por tienda × mes (no una por nodo): 3 tiendas × 21 meses, con la venta de los 365 nodos sumada.
    for (const t of [T.T01, T.T02, T.T03]) for (const p of meses) series.push({ t, p, u: 10 * N, s: 500 * N });
    const cargas = Object.fromEntries(Object.keys(cargasFixture()).map((p) => [p, `carga-${p}`]));
    const filasBase: FilaCrecimiento[] = nodos.map((n, i) => ({ fila_id: `fila-${i}`, genero_id: "g", mundo_id: "m", crecimiento_pct: null, decidido: null, propuesto: null, base_siguiente: 100, base_normalizada: 100, sobre_base: "corregida" as const }));
    const nuevas: FilaTiendaNueva[] = nodos.map((n) => ({ tienda_id: T.T10, clave: `${T.T10}|${n}||${AM.rec}`, vigente: 10 }));
    const conB = new Set(nodos.map((n) => `|${n}||${AM.rec}`));
    return {
      conjunto: { clave: "resto", nombre: "Resto", es_resto: true },
      anio: Y,
      hastaPeriodo: "2026-09",
      k: 9,
      versionMetodo: 5,
      series,
      cargas,
      bloquesY: bloquesFixture()[Y],
      bloquesSig: bloquesFixture()[Y + 1],
      maestro: maestroVenta(),
      filasBase,
      vigentes: vigentesDeTiendasNuevas(nuevas, conB),
      fueraBase: null,
    };
  }

  it("cuadra exacto y la lógica pura responde en un tiempo razonable", () => {
    const entrada = entradaResto();
    const t0 = performance.now();
    const r = armarVentaPorTienda(entrada);
    const tabla = tablaPorTienda(r);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    expect(r.base.total).toBe(N * 100);
    expect(cuadre(r)).toBe(N * 100);
    // T10 entra con 365 × 10 = 3 650 exactos; el resto (32 850) se reparte en tres partes iguales (mismo real ene–set).
    expect(tienda(r, "T10").vigente).toMatchObject({ u: 3650, exacto: true });
    for (const c of ["T01", "T02", "T03"]) expect(tienda(r, c).vigente?.u).toBe(10950);
    expect(tabla.filas.find((f) => f.tipo === "subtotal_base")?.vigente?.valor?.u).toBe(N * 100);
  });
});

describe("base.total fraccionario (H8)", () => {
  const fila = (i: number, b: number): FilaCrecimiento => ({ fila_id: `f${i}`, genero_id: "g", mundo_id: "m", crecimiento_pct: null, decidido: null, propuesto: null, base_siguiente: b, base_normalizada: b, sobre_base: "corregida" });
  const r = armar({ filasBase: [fila(1, 100.4), fila(2, 50.4)], vigentes: { paraBase: new Map(), todas: new Map() }, fueraBase: null });

  it("base.total es el agregado tal cual (150,8) y el reparto cuadra contra su redondeo (151), con diferencia de a lo sumo 0,5", () => {
    expect(r.base.total).toBeCloseTo(150.8, 9);
    expect(cuadre(r)).toBe(Math.round(r.base.total as number));
    expect(cuadre(r)).toBe(151);
    expect(Math.abs(cuadre(r) - (r.base.total as number))).toBeLessThanOrEqual(0.5);
  });

  it("el subtotal de la tabla muestra Σ B tal cual y no se rompe por el redondeo", () => {
    const sub = tablaPorTienda(r).filas.find((f) => f.tipo === "subtotal_base");
    expect(sub?.vigente?.valor?.u).toBeCloseTo(150.8, 9);
    expect(sub?.vigente?.principal).toBe("151 u");
  });
});

describe("formato y etiquetas", () => {
  it("H2: los avisos usan el formato es-PE de la tabla (coma de miles), no el espacio", () => {
    const sin = armar({ series: [] });
    const aviso = sin.avisos.find((a) => a.codigo === "sin_atribuir")?.mensaje ?? "";
    expect(aviso).toContain("14,000 u");
    expect(aviso).not.toMatch(/\d \d{3} u/);
    const fuera = armar({ fueraBase: { filas: 2, unidades: 12345 } }).avisos.find((a) => a.codigo === "filas_sin_base")?.mensaje ?? "";
    expect(fuera).toContain("12,345 u");
  });

  it("H3: septiembre se abrevia «set» en los textos de la API y de la vista", () => {
    const r = armar({ series: [], cargas: { ...cargasFixture(["2025-09"]) } });
    expect(r.avisos.find((a) => a.codigo === "meses_faltantes")?.mensaje).toContain("set 2025");
    expect(r.avisos.map((a) => a.mensaje).join(" ")).not.toMatch(/\bsep\b/);
  });

  it("H9: el Excel escribe la etiqueta del motivo y no el código crudo", () => {
    const r = armar();
    const { POR_TIENDA } = hojasPorTienda({ datos: r, proyeccion: "p", fecha: "f" });
    const celdas = POR_TIENDA.flat().filter((c): c is string => typeof c === "string");
    for (const crudo of ["sin_dato", "incompleto_", "nueva_"]) expect(celdas.some((c) => c.includes(crudo)), crudo).toBe(false);
    const cab = POR_TIENDA[0] as string[];
    const col = cab.indexOf("VAR 2026 ENE–SET (REAL) MOTIVO");
    expect(col).toBeGreaterThan(-1);
    const t09 = POR_TIENDA.find((f) => f[1] === "T09");
    expect(t09?.[col]).toBe("—");
    const t10 = POR_TIENDA.find((f) => f[1] === "T10");
    expect(t10?.[col]).toBe("nueva");
  });

  it("H6: la leyenda visible solo nombra los motivos que aparecen en la tabla", () => {
    const filas = tablaPorTienda(armar()).filas;
    const motivos = motivosPresentes(filas);
    expect(motivos).toEqual(expect.arrayContaining(["nueva", "parcial", "sin_dato"]));
    const texto = textoLeyendaMotivos(motivos) ?? "";
    expect(texto).toContain("«nueva»");
    expect(texto).toContain("«—»");
    expect(textoLeyendaMotivos([])).toBeNull();
    expect(motivosPresentes([])).toEqual([]);
  });
});
