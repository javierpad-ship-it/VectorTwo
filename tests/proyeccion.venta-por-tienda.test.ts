import { describe, expect, it } from "vitest";
import {
  agregarSeries,
  armarVentaPorTienda,
  atribuirBase,
  clasificarTiendasVenta,
  clavePeriodoAc,
  desdeVentaTienda,
  paresVariacion,
  periodoCompleto,
  periodosVenta,
  variacionVenta,
  variacionesDeCifras,
  vigentesDeTiendasNuevas,
} from "@/lib/proyeccion/venta-por-tienda";
import type { TiendaVentaApi, VentaPorTiendaApi } from "@/lib/proyeccion/tipos-api";
import { bloquesDeAnio } from "@/lib/proyeccion/bloques";
import { bloquesFixture, cargasFixture, entradaMujerUrbano, maestroVenta, NODO, T, TIENDAS_CALCULO, TIENDAS_HOY, ventaTiendaFalsa, Y } from "./proyeccion.venta-por-tienda.fixture";

/**
 * 07f · lógica pura de «Ver por tienda» (ficha §6, reglas 2, 3, 4, 6, 7 y 8, y el caso sintético de §8). Sin base ni HTTP: las rutas se prueban en
 * `proyeccion.venta-por-tienda-rutas.test.ts`.
 */

const armar = (extra: Parameters<typeof entradaMujerUrbano>[0] = {}) => armarVentaPorTienda(entradaMujerUrbano(extra));
const tienda = (r: VentaPorTiendaApi, codigo: string): TiendaVentaApi => {
  const t = r.tiendas.find((x) => x.codigo === codigo);
  if (!t) throw new Error(`falta la tienda ${codigo}`);
  return t;
};
const redondear = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Variaciones de una tienda como las calcula la pantalla: el vigente es «completo» si estuvo abierta todo el año en curso. */
function variaciones(r: VentaPorTiendaApi, t: TiendaVentaApi) {
  return variacionesDeCifras({
    anio: r.anio_en_curso,
    periodos: r.periodos,
    cifras: t.periodos,
    vigente: t.vigente?.u ?? null,
    completo: (clave) => (clave === "vigente" ? periodoCompleto(t.fecha_apertura, t.fecha_cierre, r.anio_en_curso, 12) : (t.periodos[clave]?.completo ?? false)),
  });
}
const par = (r: VentaPorTiendaApi, t: TiendaVentaApi, clave: string) => {
  const v = variaciones(r, t).find((x) => x.clave === clave);
  if (!v) throw new Error(`falta la variación ${clave}`);
  return v;
};

describe("regla 2 · reparto por mayor resto (atribuirBase)", () => {
  const mismas = (reales: number[]) => reales.map((real, i) => ({ tienda_id: `t${i + 1}`, codigo: `T0${i + 1}`, real }));

  it("R = 1 000 con tres mismas de real 1:1:1 da 334 / 333 / 333, en orden de código", () => {
    const r = atribuirBase({ total: 1000, entran: new Map(), mismas: mismas([100, 100, 100]) });
    expect([...r.porTienda]).toEqual([["t1", 334], ["t2", 333], ["t3", 333]]);
    expect(r.sinAtribuir).toBe(0);
    expect(r.resto).toBe(1000);
  });

  it("el empate se rompe por código de tienda aunque lleguen en otro orden", () => {
    const r = atribuirBase({
      total: 1000,
      entran: new Map(),
      mismas: [
        { tienda_id: "c", codigo: "T03", real: 5 },
        { tienda_id: "a", codigo: "T01", real: 5 },
        { tienda_id: "b", codigo: "T02", real: 5 },
      ],
    });
    expect(r.porTienda.get("a")).toBe(334);
    expect(r.porTienda.get("b")).toBe(333);
    expect(r.porTienda.get("c")).toBe(333);
  });

  it("con pesos 0 en todas, todo va a «sin atribuir»", () => {
    const r = atribuirBase({ total: 1000, entran: new Map(), mismas: mismas([0, 0, 0]) });
    expect([...r.porTienda.values()]).toEqual([0, 0, 0]);
    expect(r.sinAtribuir).toBe(1000);
  });

  it("una tienda con real negativo pesa 0 y las demás se reparten todo", () => {
    const r = atribuirBase({ total: 900, entran: new Map(), mismas: mismas([-50, 100, 200]) });
    expect(r.porTienda.get("t1")).toBe(0);
    expect(r.porTienda.get("t2")).toBe(300);
    expect(r.porTienda.get("t3")).toBe(600);
    expect(r.sinAtribuir).toBe(0);
  });

  it("sin tiendas mismas, todo va a «sin atribuir»", () => {
    const r = atribuirBase({ total: 500, entran: new Map([["e", 120]]), mismas: [] });
    expect(r.porTienda.get("e")).toBe(120);
    expect(r.sinAtribuir).toBe(380);
  });

  it("R < 0 (las que entran suman más que Σ B): las mismas quedan en 0 y lo que sobra, negativo, va a «sin atribuir»", () => {
    const r = atribuirBase({ total: 1000, entran: new Map([["e", 1300]]), mismas: mismas([10, 20]) });
    expect(r.resto).toBe(-300);
    expect(r.porTienda.get("t1")).toBe(0);
    expect(r.porTienda.get("t2")).toBe(0);
    expect(r.sinAtribuir).toBe(-300);
    expect(suma([...r.porTienda.values()]) + r.sinAtribuir).toBe(1000);
  });

  it("el cuadre Σ vigente + sin atribuir = Σ B es exacto en enteros para muchas combinaciones", () => {
    let semilla = 7;
    const azar = (n: number) => {
      semilla = (semilla * 48271) % 2147483647;
      return semilla % n;
    };
    for (let caso = 0; caso < 300; caso++) {
      const total = azar(100000);
      const entran = new Map(Array.from({ length: azar(3) }, (_, i) => [`e${i}`, azar(5000)] as [string, number]));
      const reales = Array.from({ length: azar(6) }, () => azar(4000) - 300);
      const r = atribuirBase({ total, entran, mismas: mismas(reales) });
      expect(suma([...r.porTienda.values()]) + r.sinAtribuir, `caso ${caso}`).toBe(total);
      for (const v of r.porTienda.values()) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("regla 3 · el vigente de las tiendas que entran", () => {
  it("suma las filas de tienda `nuevas` cuya fila base tiene B; una fila sin fila base o con B nulo no suma a la base", () => {
    const v = vigentesDeTiendasNuevas(
      [
        { tienda_id: "T10", clave: "T10|n1||a", vigente: 1000 },
        { tienda_id: "T10", clave: "T10|n2||b", vigente: 600 },
        { tienda_id: "T10", clave: "T10|n1||c", vigente: 50 },
        { tienda_id: "T10", clave: "T10|n1||z", vigente: 999 },
      ],
      new Set(["|n1||a", "|n2||b"])
    );
    expect(v.paraBase.get("T10")).toBe(1600);
    expect(v.todas.get("T10")).toBe(2649);
  });

  it("con el caso sintético: T10 entra con 1 600 exactos (decidido 600 sobre propuesto 500) y T11 va fuera con 700", () => {
    const r = armar();
    expect(tienda(r, "T10").vigente).toEqual({ u: 1600, real: 1200, proyectado: 400, exacto: true });
    expect(tienda(r, "T11").vigente).toEqual({ u: 700, real: 400, proyectado: 300, exacto: true });
  });
});

describe("caso sintético de la ficha §8 (MUJER · URBANO)", () => {
  const r = armar();

  it("la base: Σ B = 15 600 con T10 = 1 600, R = 14 000 y 8 400 / 4 200 / 1 400 para T01 / T02 / T03", () => {
    expect(r.base).toEqual({ total: 15600, corregida: 16400, tiendas: 4, entran: ["T10"], sin_atribuir: 0, motivo_nulo: null });
    expect(tienda(r, "T01").vigente).toEqual({ u: 8400, real: 6000, proyectado: 2400, exacto: false });
    expect(tienda(r, "T02").vigente).toEqual({ u: 4200, real: 3000, proyectado: 1200, exacto: false });
    expect(tienda(r, "T03").vigente).toEqual({ u: 1400, real: 1000, proyectado: 400, exacto: false });
    const base = r.tiendas.filter((t) => t.grupo === "base");
    expect(base.map((t) => t.codigo)).toEqual(["T01", "T02", "T10", "T03"]);
    expect(suma(base.map((t) => t.vigente?.u ?? 0)) + r.base.sin_atribuir).toBe(r.base.total);
    expect(r.totales.base.vigente).toBe(15600);
  });

  it("las cifras por periodo de cada tienda son las de la ficha", () => {
    const u = (codigo: string) => Object.fromEntries(Object.entries(tienda(r, codigo).periodos).map(([k, c]) => [k, c.u]));
    expect(u("T01")).toEqual({ "2023": 6000, "2024": 6300, "2025": 7000, "2025-ac": 5000, "2026-ac": 6000 });
    expect(u("T02")).toEqual({ "2023": 3000, "2024": 3200, "2025": 3500, "2025-ac": 2500, "2026-ac": 3000 });
    expect(u("T03")).toEqual({ "2023": 1200, "2024": 1100, "2025": 1400, "2025-ac": 1000, "2026-ac": 1000 });
    expect(u("T10")).toEqual({ "2023": 0, "2024": 0, "2025": 300, "2025-ac": 0, "2026-ac": 1200 });
    expect(u("T04")).toEqual({ "2023": 1000, "2024": 1000, "2025": 1100, "2025-ac": 800, "2026-ac": 800 });
    expect(u("T11")).toEqual({ "2023": 0, "2024": 0, "2025": 0, "2025-ac": 0, "2026-ac": 400 });
    expect(u("T09")).toEqual({ "2023": 900, "2024": 500, "2025": 0, "2025-ac": 0, "2026-ac": 0 });
  });

  it("el subtotal de la base: 10 200 / 10 600 / 12 200 / 8 500 / 11 200 y, fuera, T04, T11 y T09", () => {
    const base = Object.fromEntries(Object.entries(r.totales.base.periodos).map(([k, c]) => [k, c.u]));
    expect(base).toEqual({ "2023": 10200, "2024": 10600, "2025": 12200, "2025-ac": 8500, "2026-ac": 11200 });
    expect(r.tiendas.filter((t) => t.grupo === "fuera").map((t) => t.codigo)).toEqual(["T04", "T11", "T09"]);
    expect(r.totales.conjunto.periodos["2026-ac"]?.u).toBe(11200 + 800 + 400);
    expect(r.totales.fuera.vigente).toBeNull();
    expect(r.totales.conjunto.vigente).toBeNull();
  });

  it("T01: ene–set 2025 S/ 380 000 y ene–set 2026 S/ 480 000, +26,3 % en S/ frente a +20,0 % en u", () => {
    const t = tienda(r, "T01");
    expect(t.periodos["2025-ac"]).toMatchObject({ u: 5000, s: 380000 });
    expect(t.periodos["2026-ac"]).toMatchObject({ u: 6000, s: 480000 });
    const v = par(r, t, "2026-ac");
    expect(redondear(v.u.pct)).toBe(20);
    expect(redondear(v.s?.pct ?? null)).toBe(26.3);
  });

  it("T03: 2024 frente a 2023 da −8,3 % y 2025 frente a 2024, +27,3 %; el vigente de T03 frente a 2025 da 0,0 %", () => {
    const t = tienda(r, "T03");
    expect(redondear(par(r, t, "2024").u.pct)).toBe(-8.3);
    expect(redondear(par(r, t, "2025").u.pct)).toBe(27.3);
    expect(redondear(par(r, t, "vigente").u.pct)).toBe(0);
    expect(par(r, t, "vigente").s).toBeNull();
    expect(redondear(par(r, tienda(r, "T01"), "vigente").u.pct)).toBe(20);
  });

  it("T10 (entra): ene–set 2025 es 0, así que su variación es «nueva»; su 2025 es parcial y su vigente frente a 2025, «parcial»", () => {
    const t = tienda(r, "T10");
    expect(t.estado).toBe("entra");
    expect(t.periodos["2025"]?.completo).toBe(false);
    expect(t.periodos["2026-ac"]?.completo).toBe(true);
    expect(par(r, t, "2026-ac").u).toEqual({ pct: null, motivo: "nueva" });
    expect(par(r, t, "vigente").u).toEqual({ pct: null, motivo: "parcial" });
    expect(par(r, t, "2025").u.motivo).toBe("nueva");
  });

  it("T09 (cerró el 31 ago 2024): su 2024 es parcial y ya no vende; T04 y T11 no llevan reparto, T11 es exacto", () => {
    const t = tienda(r, "T09");
    expect(t.estado).toBe("cerro");
    expect(t.periodos["2024"]?.completo).toBe(false);
    expect(t.periodos["2023"]?.completo).toBe(true);
    expect(par(r, t, "2024").u.motivo).toBe("parcial");
    expect(t.vigente).toBeNull();
    expect(tienda(r, "T04").vigente).toBeNull();
    expect(tienda(r, "T11").vigente?.exacto).toBe(true);
  });

  it("el subtotal de la base con una tienda parcial: variación total y comparable (sin T10)", () => {
    const base = r.totales.base;
    const delGrupo = r.tiendas.filter((t) => t.grupo === "base");
    expect(base.no_comparables["2025"]).toEqual(["T10"]);
    expect(base.no_comparables["2025-ac"]).toEqual(["T10"]);
    expect(base.no_comparables["2026-ac"]).toBeUndefined();
    const sinParciales = (clave: string, contra: string) =>
      delGrupo.filter((t) => !(base.no_comparables[clave] ?? []).includes(t.codigo) && !(base.no_comparables[contra] ?? []).includes(t.codigo));
    const comparable = (clave: string, contra: string, valor: (t: TiendaVentaApi) => number, anterior: (t: TiendaVentaApi) => number) =>
      (suma(sinParciales(clave, contra).map(valor)) / suma(sinParciales(clave, contra).map(anterior)) - 1) * 100;
    // ene–set 2026 frente a ene–set 2025: +31,8 % total (11 200 ÷ 8 500) y +17,6 % sin T10.
    expect(redondear((11200 / 8500 - 1) * 100)).toBe(31.8);
    expect(redondear(comparable("2026-ac", "2025-ac", (t) => t.periodos["2026-ac"]?.u ?? 0, (t) => t.periodos["2025-ac"]?.u ?? 0))).toBe(17.6);
    // Cierre vigente frente a 2025: +27,9 % total (15 600 ÷ 12 200) y +17,6 % sin T10 (que no estuvo abierta todo 2025).
    expect(redondear(((r.base.total ?? 0) / 12200 - 1) * 100)).toBe(27.9);
    expect(redondear(comparable("2025", "2025", (t) => t.vigente?.u ?? 0, (t) => t.periodos["2025"]?.u ?? 0))).toBe(17.6);
  });

  it("regla 5: el CD, aunque la función devuelva una serie suya, no aparece en las tiendas ni en ningún total", () => {
    const entrada = entradaMujerUrbano();
    expect(entrada.series.some((s) => s.t === T.CD1)).toBe(true);
    expect(r.tiendas.some((t) => t.tienda_id === T.CD1 || t.codigo === "CD1")).toBe(false);
    // 9 000 u del CD por 9 meses de 2026 habrían movido el total del conjunto.
    expect(r.totales.conjunto.periodos["2026-ac"]?.u).toBe(12400);
    expect(r.totales.conjunto.periodos["2026-ac"]?.s).toBe(480000 + 3000 * 50 + 1000 * 50 + 1200 * 50 + 800 * 50 + 400 * 50);
  });

  it("los periodos: 2023, 2024, 2025 completos y los cortes ene–set de 2025 y 2026", () => {
    expect(r.periodos.map((p) => [p.clave, p.anio, p.hasta_mes, p.meses_faltantes.length])).toEqual([
      ["2023", 2023, 12, 0],
      ["2024", 2024, 12, 0],
      ["2025", 2025, 12, 0],
      ["2025-ac", 2025, 9, 0],
      ["2026-ac", 2026, 9, 0],
    ]);
    expect(r).toMatchObject({ anio_en_curso: 2026, anio_siguiente: 2027, hasta_periodo: "2026-09", k: 9, conjunto: { clave: expect.any(String), nombre: "MUJER · URBANO", es_resto: false } });
  });
});

describe("regla 4 · grupos de tiendas desde los bloques guardados", () => {
  const b = bloquesFixture();
  const clasificar = (ids: string[], maestro = maestroVenta()) => clasificarTiendasVenta({ anio: Y, bloquesY: b[Y], bloquesSig: b[Y + 1], ids, maestro });

  it("los siete estados salen de `bloques`, con su grupo y su texto", () => {
    const c = clasificar([T.T01, T.T10, T.T04, T.T11, T.T09, T.T12]);
    expect(c.get(T.T01)).toMatchObject({ grupo: "base", estado: "misma", estado_texto: "Misma tienda de 2026 y de 2027" });
    expect(c.get(T.T10)).toMatchObject({ grupo: "base", estado: "entra", estado_texto: "Abrió en nov 2025: entra en la base de 2027 con su 2026 vigente" });
    expect(c.get(T.T04)).toMatchObject({ grupo: "fuera", estado: "sale", estado_texto: "Cierra el 30 jun 2027: su 2026 sale de la base" });
    expect(c.get(T.T11)).toMatchObject({ grupo: "fuera", estado: "abrio_en_curso", estado_texto: "Abrió en may 2026: en 2027 va aparte (nueva del año anterior); entra en la base de 2028" });
    expect(c.get(T.T09)).toMatchObject({ grupo: "fuera", estado: "cerro", estado_texto: "Cerró el 31 ago 2024" });
    expect(c.get(T.T12)).toMatchObject({ grupo: "fuera", estado: "sin_bloque", estado_texto: "No existía al calcular: recalcula" });
    expect(c.get(T.T10)).toMatchObject({ fecha_apertura: "2025-11-15", fecha_cierre: null });
  });

  it("`otra`: una tienda desactivada al calcular usa el texto del motivo de Y+1", () => {
    const inactiva = TIENDAS_CALCULO.map((t) => (t.id === T.T03 ? { ...t, activo: false } : t));
    const c = clasificarTiendasVenta({ anio: Y, bloquesY: bloquesDeAnio(inactiva, Y), bloquesSig: bloquesDeAnio(inactiva, Y + 1), ids: [T.T03], maestro: maestroVenta() });
    expect(c.get(T.T03)).toMatchObject({ grupo: "fuera", estado: "otra", estado_texto: "Tienda desactivada" });
  });

  it("cambiar fecha_cierre en M4 después de calcular no mueve una tienda de grupo; el nombre y el código sí son los de hoy", () => {
    const hoy = TIENDAS_HOY.map((t) => (t.id === T.T03 ? { ...t, fecha_cierre: "2026-03-31", nombre: "Tienda 3 renombrada" } : t));
    const c = clasificar([T.T03], maestroVenta(hoy));
    expect(c.get(T.T03)).toMatchObject({ grupo: "base", estado: "misma", nombre: "Tienda 3 renombrada", fecha_cierre: null });
    const r = armar({ maestro: maestroVenta(hoy) });
    expect(tienda(r, "T03")).toMatchObject({ grupo: "base", estado: "misma" });
  });

  it("todas las mismas de Y+1 aparecen aunque no tengan venta (fila en ceros); fuera solo quien vendió o tiene vigente", () => {
    const r = armar({ series: entradaMujerUrbano().series.filter((s) => s.t !== T.T03 && s.t !== T.T04) });
    const t03 = tienda(r, "T03");
    expect(t03.grupo).toBe("base");
    expect(Object.values(t03.periodos).every((c) => c.u === 0 && c.s === 0)).toBe(true);
    expect(t03.vigente?.u).toBe(0);
    expect(r.base.tiendas).toBe(4);
    expect(r.tiendas.some((t) => t.codigo === "T04")).toBe(false);
    // T01 y T02 se reparten todo R (14 000) en proporción a 6 000 : 3 000.
    expect(tienda(r, "T01").vigente?.u).toBe(9333);
    expect(tienda(r, "T02").vigente?.u).toBe(4667);
    expect(suma(r.tiendas.filter((t) => t.grupo === "base").map((t) => t.vigente?.u ?? 0))).toBe(15600);
  });

  it("una tienda creada después de calcular, con venta, sale `sin_bloque` y avisa", () => {
    const entrada = entradaMujerUrbano();
    const r = armar({ series: [...entrada.series, { t: T.T12, p: "2026-03", u: 40, s: 2000 }] });
    expect(tienda(r, "T12")).toMatchObject({ grupo: "fuera", estado: "sin_bloque", vigente: null, fecha_apertura: "2024-02-01" });
    expect(r.avisos.find((a) => a.codigo === "sin_bloque")?.mensaje).toContain("T12");
    expect(r.base.total).toBe(15600);
  });
});

describe("regla 6 · el corte es el último mes cerrado de la proyección", () => {
  it("con venta de octubre y hasta_periodo = 2026-09, «2026 ene–set» no incluye octubre y «2025 ene–set» usa los mismos 9 meses", () => {
    const base = entradaMujerUrbano();
    const r = armar({ series: [...base.series, { t: T.T01, p: "2026-10", u: 5000, s: 400000 }, { t: T.T01, p: "2026-11", u: 100, s: 1 }] });
    expect(tienda(r, "T01").periodos["2026-ac"]).toMatchObject({ u: 6000, s: 480000 });
    // Octubre de 2025 (2 000 u / 3 meses de oct–dic) cuenta en 2025 completo y no en «2025 ene–set».
    expect(tienda(r, "T01").periodos["2025-ac"]?.u).toBe(5000);
    expect(tienda(r, "T01").periodos["2025"]?.u).toBe(7000);
    expect(r.periodos.find((p) => p.clave === "2026-ac")).toMatchObject({ anio: 2026, hasta_mes: 9 });
    expect(r.periodos.find((p) => p.clave === "2025-ac")).toMatchObject({ anio: 2025, hasta_mes: 9 });
  });

  it("con k = 6 los dos cortes son de seis meses", () => {
    const cargas = Object.fromEntries(Object.entries(cargasFixture()).filter(([p]) => p <= "2026-06"));
    const r = armar({ k: 6, hastaPeriodo: "2026-06", cargas });
    expect(r.periodos.slice(-2).map((p) => [p.clave, p.hasta_mes])).toEqual([["2025-ac", 6], ["2026-ac", 6]]);
    expect(tienda(r, "T01").periodos["2026-ac"]?.u).toBe(4002);
    expect(tienda(r, "T01").periodos["2025-ac"]?.u).toBe(3335);
  });
});

describe("regla 7 · variaciones", () => {
  it("nueva, sin_dato, parcial e incompleto; el resto es un %", () => {
    expect(variacionVenta(0, 50)).toEqual({ pct: null, motivo: "nueva" });
    expect(variacionVenta(0, 0)).toEqual({ pct: null, motivo: "sin_dato" });
    expect(variacionVenta(-5, 10)).toEqual({ pct: null, motivo: "sin_dato" });
    expect(variacionVenta(0, -3)).toEqual({ pct: null, motivo: "sin_dato" });
    expect(variacionVenta(100, 120, { parcial: true })).toEqual({ pct: null, motivo: "parcial" });
    expect(variacionVenta(100, 120, { incompleto: true })).toEqual({ pct: null, motivo: "incompleto" });
    expect(variacionVenta(100, 120)).toEqual({ pct: 20, motivo: null });
    expect(variacionVenta(3, 4).pct).toBeCloseTo(33.3333, 3);
    expect(variacionVenta(100, 0)).toEqual({ pct: -100, motivo: null });
  });

  it("precedencia: incompleto gana a todo; nueva y sin_dato ganan a parcial", () => {
    expect(variacionVenta(0, 10, { incompleto: true, parcial: true }).motivo).toBe("incompleto");
    expect(variacionVenta(0, 10, { parcial: true }).motivo).toBe("nueva");
    expect(variacionVenta(0, 0, { parcial: true }).motivo).toBe("sin_dato");
  });

  it("periodoCompleto: año completo y corte ene–k según apertura y cierre", () => {
    expect(periodoCompleto("2019-03-01", null, 2026, 12)).toBe(true);
    expect(periodoCompleto("2026-01-01", null, 2026, 12)).toBe(true);
    expect(periodoCompleto("2026-01-02", null, 2026, 12)).toBe(false);
    expect(periodoCompleto(null, null, 2026, 12)).toBe(false);
    expect(periodoCompleto("2019-03-01", "2026-12-31", 2026, 12)).toBe(true);
    expect(periodoCompleto("2019-03-01", "2026-12-30", 2026, 12)).toBe(false);
    expect(periodoCompleto("2019-03-01", "2026-09-30", 2026, 9)).toBe(true);
    expect(periodoCompleto("2019-03-01", "2026-09-29", 2026, 9)).toBe(false);
    expect(periodoCompleto("2019-03-01", "2024-02-29", 2024, 2)).toBe(true);
    expect(periodoCompleto("2019-03-01", "2024-02-28", 2024, 2)).toBe(false);
  });

  it("las comparaciones existentes: 2024÷2023, 2025÷2024, ene–set y el vigente solo en unidades", () => {
    const r = armar();
    expect(paresVariacion(2026, r.periodos)).toEqual([
      { clave: "2024", contra: "2023" },
      { clave: "2025", contra: "2024" },
      { clave: "2026-ac", contra: "2025-ac" },
      { clave: "vigente", contra: "2025" },
    ]);
    expect(variaciones(r, tienda(r, "T01")).map((v) => [v.clave, v.s === null])).toEqual([["2024", false], ["2025", false], ["2026-ac", false], ["vigente", true]]);
  });
});

describe("regla 8 · meses faltantes", () => {
  it("si falta 2024-03 en las cargas, el periodo 2024 trae meses_faltantes = [2024-03] y sus dos variaciones salen incompleto", () => {
    const r = armar({ cargas: cargasFixture(["2024-03"]) });
    expect(r.periodos.find((p) => p.clave === "2024")?.meses_faltantes).toEqual(["2024-03"]);
    expect(r.periodos.filter((p) => p.meses_faltantes.length > 0).map((p) => p.clave)).toEqual(["2024"]);
    const t = tienda(r, "T01");
    expect(par(r, t, "2024").u.motivo).toBe("incompleto");
    expect(par(r, t, "2024").s?.motivo).toBe("incompleto");
    expect(par(r, t, "2025").u.motivo).toBe("incompleto");
    expect(par(r, t, "2025").s?.motivo).toBe("incompleto");
    expect(par(r, t, "2026-ac").u.motivo).toBeNull();
    const aviso = r.avisos.find((a) => a.codigo === "meses_faltantes");
    expect(aviso?.mensaje).toContain("mar 2024");
  });

  it("un primer año que empieza en marzo cuenta enero y febrero como faltantes; un año sin ningún mes publicado no tiene columna", () => {
    const desdeMarzo = Object.fromEntries(Object.entries(cargasFixture()).filter(([p]) => p >= "2023-03"));
    expect(periodosVenta(2026, 9, new Set(Object.keys(desdeMarzo))).find((p) => p.clave === "2023")?.meses_faltantes).toEqual(["2023-01", "2023-02"]);
    const desde2024 = new Set(Object.keys(cargasFixture()).filter((p) => p >= "2024-01"));
    expect(periodosVenta(2026, 9, desde2024).map((p) => p.clave)).toEqual(["2024", "2025", "2025-ac", "2026-ac"]);
  });
});

describe("agregarSeries, periodos y rango", () => {
  it("suma en centavos, deja fuera lo que no cae en un periodo y un mes cuenta en todos los que lo contienen", () => {
    const periodos = periodosVenta(2026, 9, new Set(Object.keys(cargasFixture())));
    const a = agregarSeries(
      [
        { t: "x", p: "2025-02", u: 10, s: 0.1 },
        { t: "x", p: "2025-02", u: 5, s: 0.2 },
        { t: "x", p: "2025-12", u: 1, s: 1 },
        { t: "x", p: "2026-10", u: 99, s: 99 },
      ],
      periodos
    );
    expect(a.get("x")).toEqual({ "2025": { u: 16, s: 1.3 }, "2025-ac": { u: 15, s: 0.3 } });
  });

  it("el rango pedido es de enero de Y−3 al último mes cerrado", () => {
    expect(desdeVentaTienda(2026)).toBe("2023-01");
    expect(clavePeriodoAc(2026)).toBe("2026-ac");
    const v = ventaTiendaFalsa({ p_gml_ids: [NODO.mu1], p_desde: "2024-01-01", p_hasta: "2025-12-01" });
    expect(Object.keys(v.cargas)[0]).toBe("2024-01");
    expect(Object.keys(v.cargas).at(-1)).toBe("2025-12");
  });
});

describe("avisos", () => {
  it("filas_sin_base resume las filas sin curva; sin_atribuir explica por qué sobra base", () => {
    const r = armar();
    expect(r.avisos.find((a) => a.codigo === "filas_sin_base")?.mensaje).toBe("1 fila sin curva vendió 150 u en 2026: no entran en la base y sí en el real por tienda.");
    expect(r.avisos.some((a) => a.codigo === "sin_atribuir")).toBe(false);
    const sin = armar({ series: entradaMujerUrbano().series.filter((s) => s.p < "2026-01"), fueraBase: null });
    expect(sin.base.sin_atribuir).toBe(14000);
    expect(sin.avisos.find((a) => a.codigo === "sin_atribuir")?.mensaje).toContain("14,000 u");
    expect(suma(sin.tiendas.filter((t) => t.grupo === "base").map((t) => t.vigente?.u ?? 0)) + sin.base.sin_atribuir).toBe(15600);
  });

  it("método anterior o sin filas: sin base ni vigente, con las columnas reales", () => {
    const viejo = armar({ versionMetodo: 3 });
    expect(viejo.base).toMatchObject({ total: null, corregida: null, motivo_nulo: "metodo_anterior", sin_atribuir: 0 });
    expect(viejo.tiendas.every((t) => t.vigente === null)).toBe(true);
    expect(viejo.totales.base.vigente).toBeNull();
    expect(tienda(viejo, "T01").periodos["2026-ac"]?.u).toBe(6000);
    const vacio = armar({ filasBase: [] });
    expect(vacio.base).toMatchObject({ total: null, motivo_nulo: "sin_filas" });
    expect(vacio.tiendas.find((t) => t.codigo === "T01")?.periodos["2026-ac"]?.u).toBe(6000);
  });
});
