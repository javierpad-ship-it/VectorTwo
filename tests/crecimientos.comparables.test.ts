import { describe, expect, it } from "vitest";
import type { TiendaMaestro } from "@/lib/curvas/tipos";
import { aniosDeRed, calcularRedes, comparablesDe, motivoFuera, PARAMETROS_RED_GM, ventaTotalPorTienda } from "@/lib/crecimientos/comparables";
import { armarSeriesAnios, crearPhi, type SerieGM } from "@/lib/crecimientos/series";

/**
 * Regla 12 (ficha 06d §5.2): `C(Y)` excluye la tienda nueva de `Y−1` y los cierres de `Y` hasta `k`, e incluye un cierre posterior a
 * `k`; la serie sin Niño con φ = 1 es idéntica a la bruta. Todo sintético: `Y = 2026`, `k = setiembre`.
 */

const publicados: string[] = [];
for (let a = 2024; a <= 2026; a++) for (let m = 1; m <= 12; m++) if (a < 2026 || m <= 9) publicados.push(`${a}-${String(m).padStart(2, "0")}`);

const tienda = (id: string, extra: Partial<TiendaMaestro> = {}): TiendaMaestro => ({ id, codigo: id.toUpperCase(), nombre: id, tipo: "Tienda", activo: true, fecha_apertura: "2020-01-01", fecha_cierre: null, ...extra });

/** Una serie con `u` unidades al mes en los meses publicados entre `desde` y `hasta`. */
function serie(t: string, u: number, desde = "2024-01", hasta = "2026-09", g = "g", m = "m", temp = "todo_el_ano"): SerieGM {
  const unidades: Record<string, number> = {};
  for (const p of publicados) if (p >= desde && p <= hasta) unidades[p] = u;
  return { g, m, temp, t, u: unidades };
}

const tiendas = [
  tienda("a"), // todo el periodo
  tienda("nueva", { fecha_apertura: "2025-06-01" }), // abrió a mitad de Y−1
  tienda("cierra_antes", { fecha_cierre: "2026-06-30" }), // cierra en Y antes de k
  tienda("cierra_despues", { fecha_cierre: "2026-12-31" }), // cierra en Y después de k
  tienda("sin_venta_set"), // sin venta en setiembre de 2026
  tienda("cd", { tipo: "Centro de Distribución" }),
];
const series: SerieGM[] = [serie("a", 100), serie("nueva", 100, "2025-06"), serie("cierra_antes", 100, "2024-01", "2026-06"), serie("cierra_despues", 100), serie("sin_venta_set", 100, "2024-01", "2026-08"), serie("cd", 100)];

describe("regla 12 · C(Y): mismas tiendas", () => {
  const redes = calcularRedes(tiendas, ventaTotalPorTienda(series), aniosDeRed(publicados, "2026-09"), "2026-09", publicados);

  it("C(2026) excluye la tienda nueva de 2025, los cierres de 2026 hasta setiembre y la que no vendió en un mes exigido", () => {
    const c = comparablesDe(redes, 2026);
    expect([...c].sort()).toEqual(["a", "cierra_despues"]);
  });

  it("un cierre posterior a k sigue en C(Y): su ene–k es comparable", () => {
    expect(comparablesDe(redes, 2026).has("cierra_despues")).toBe(true);
    expect(comparablesDe(redes, 2026).has("cierra_antes")).toBe(false);
  });

  it("C(2025) mira 2024 y 2025 completos: la nueva de 2025 no entra y el cierre de 2026 sí (cerró después)", () => {
    expect([...comparablesDe(redes, 2025)].sort()).toEqual(["a", "cierra_antes", "cierra_despues", "sin_venta_set"]);
  });

  it("sin red de un año no hay comparables, y el centro de distribución nunca entra", () => {
    expect(comparablesDe(redes, 2024).size).toBe(0);
    for (const z of [2025, 2026]) expect(comparablesDe(redes, z).has("cd")).toBe(false);
  });

  it("explica por qué una tienda con venta no está en C(Y)", () => {
    expect(motivoFuera(redes, 2026, "a")).toBeNull();
    expect(motivoFuera(redes, 2026, "nueva")).toMatch(/no estuvo abierta todo el periodo en 2025/);
    expect(motivoFuera(redes, 2026, "cierra_antes")).toMatch(/2026/);
    expect(motivoFuera(redes, 2026, "sin_venta_set")).toMatch(/meses sin venta en 2026/);
  });

  it("los parámetros de red son los de M6 sin la regla de tienda nueva", () => {
    expect(PARAMETROS_RED_GM).toMatchObject({ solo_tiendas_completas: true, exigir_venta_todo_el_ano: true, meses_tienda_nueva: 0 });
  });
});

describe("ventaTotalPorTienda y aniosDeRed", () => {
  it("suma las series de todos los GM por tienda y mes, en orden estable", () => {
    const venta = ventaTotalPorTienda([serie("a", 10, "2024-01", "2024-02", "g1"), serie("a", 5, "2024-01", "2024-02", "g2"), serie("b", 1, "2024-02", "2024-02")]);
    expect(venta).toEqual([
      { tienda_id: "a", periodo: "2024-01", unidades: 15 },
      { tienda_id: "a", periodo: "2024-02", unidades: 15 },
      { tienda_id: "b", periodo: "2024-02", unidades: 1 },
    ]);
  });

  it("los años de la red van del primer mes publicado al del último cerrado", () => {
    expect(aniosDeRed(publicados, "2026-09")).toEqual([2024, 2025, 2026]);
    expect(aniosDeRed([], "2026-09")).toEqual([]);
  });
});

describe("regla 12 · la serie sin Niño con φ = 1 es idéntica a la bruta", () => {
  it("sin periodos atípicos, meses_sin_nino = meses y total_sin_nino = total", () => {
    const entradas = [serie("a", 120, "2024-01", "2026-09", "g", "m", "invierno")];
    const s = armarSeriesAnios({
      entradas,
      tiendas: new Set(["a"]),
      anios: [2024, 2025, 2026],
      publicados: new Set(publicados),
      y: 2026,
      k: 9,
      phi: crearPhi([], []),
      proyectado: null,
    });
    for (const a of s) {
      expect(a.meses_sin_nino).toEqual(a.meses);
      expect(a.total_sin_nino).toBe(a.total);
    }
    expect(s[2]?.meses.slice(9)).toEqual([null, null, null]);
    expect(s[2]?.origen.slice(9)).toEqual([null, null, null]);
    expect(s[2]?.forma.every((v) => v === null)).toBe(true);
    expect(s[1]?.forma[0]).toBeCloseTo(100 / 12, 3);
  });

  it("con un periodo atípico y su factor la serie sin Niño sube en esos meses y lo demás queda igual", () => {
    const periodos = [{ id: "p", desde: "2026-06", hasta: "2026-08", motivo: "Niño", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true }];
    const factores = [{ anio: 2026, temporada: "invierno" as const, ratio_calculado: 0.5, ratio_aplicado: null }];
    const [s] = armarSeriesAnios({
      entradas: [serie("a", 100, "2026-01", "2026-09", "g", "m", "invierno")],
      tiendas: new Set(["a"]),
      anios: [2026],
      publicados: new Set(publicados),
      y: 2026,
      k: 9,
      phi: crearPhi(periodos, factores),
      proyectado: null,
    });
    expect(s?.meses[5]).toBe(100);
    expect(s?.meses_sin_nino[5]).toBe(200);
    expect(s?.meses_sin_nino[0]).toBe(100);
  });
});
