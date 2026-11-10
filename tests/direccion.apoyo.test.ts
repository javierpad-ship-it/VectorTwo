import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./direccion.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./direccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/direccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/direccion/contexto")>();
  const fx = await import("./direccion.fixture");
  return { ...real, leerMaestros: async () => ({ data: fx.maestrosCaso(), respuesta: null }), leerNinoDeHoy: async () => ({ data: fx.ninoCaso.valor, respuesta: null }) };
});
vi.mock("@/lib/tiendas/estado", async (original) => {
  const soporte = await import("./direccion.soporte");
  return { ...(await original<typeof import("@/lib/tiendas/estado")>()), hoyLima: () => soporte.relojDePrueba.hoy };
});

import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { armarApoyo, mesesDeCobertura, valorizar, type EntradaApoyo } from "@/lib/direccion/apoyo";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import type { ApoyoApi } from "@/lib/direccion/tipos-api";
import { base, estadoDireccion } from "./direccion.fake-db";
import { AM_B, G_HOMBRE, L2_HU, M_URBANO, T03 } from "./direccion.fixture";
import { lectorDeTablero, montarCaso } from "./direccion.montaje";

/** Ficha 14 · R11: soles y cobertura de apoyo (se calculan al mostrar, rotulados; nunca se guardan). Sintético. */

const ver = lectorDeTablero(tablero);
beforeEach(() => montarCaso(vaciarCachesDireccion));
const HU = { generos: G_HOMBRE, mundo_id: M_URBANO };
const soles = (a: ApoyoApi, anio: number, tipo: string) => a.soles.anios.find((x) => x.anio === anio && x.tipo === tipo)?.s;

describe("valorizar (puro)", () => {
  const pares = { gml: ["g1", "g2"], am: ["a1"], filas: [[0, 0, 100, 1000], [1, 0, 50, 200]] as [number, number, number, number][] };

  it("Σ pares (unidades proyectadas × precio medio de 12 meses del par)", () => {
    const precios = { gml: ["g1", "g2"], am: ["a1"], filas: [[0, 0, 10, 500], [1, 0, 20, 400]] as [number, number, number, number][] };
    const v = valorizar(pares, precios);
    // g1: S/ 50 por unidad; g2: S/ 20.
    expect(v.enCursoResto).toBe(100 * 50 + 50 * 20);
    expect(v.siguiente).toBe(1000 * 50 + 200 * 20);
    expect(v.precio_medio).toBe(30);
    expect(v.u_sin_precio).toBe(0);
  });

  it("un par sin venta en la ventana usa el precio medio del recorte y sus unidades se cuentan en `u_sin_precio`", () => {
    const precios = { gml: ["g1"], am: ["a1"], filas: [[0, 0, 10, 500]] as [number, number, number, number][] };
    const v = valorizar(pares, precios);
    expect(v.precio_medio).toBe(50);
    expect(v.siguiente).toBe(1000 * 50 + 200 * 50);
    expect(v.u_sin_precio).toBe(50 + 200);
  });

  it("sin ninguna venta en la ventana no hay precio: los soles estimados son 0 y todo queda «sin precio»", () => {
    const v = valorizar(pares, { gml: [], am: [], filas: [] });
    expect(v).toEqual({ enCursoResto: 0, siguiente: 0, precio_medio: null, u_sin_precio: 1350 });
  });

  it("un par con unidades netas negativas o soles en 0 no da precio propio", () => {
    const precios = { gml: ["g1", "g2"], am: ["a1"], filas: [[0, 0, 10, 500], [1, 0, -5, -100]] as [number, number, number, number][] };
    const v = valorizar(pares, precios);
    expect(v.precio_medio).toBe(80);
    expect(v.u_sin_precio).toBe(250);
  });
});

describe("armarApoyo (puro)", () => {
  const entrada = (extra: Partial<EntradaApoyo> = {}): EntradaApoyo => ({
    anio: 2026,
    k: 9,
    kPrima: 10,
    ultimoPublicado: "2026-10",
    solesAnio: new Map([[2023, 100], [2024, 200], [2025, 300], [2026, 250]]),
    solesEnCursoHastaK: 220,
    pares: { gml: ["g1"], am: ["a1"], filas: [[0, 0, 10, 100]] },
    precios: { gml: ["g1"], am: ["a1"], filas: [[0, 0, 4, 40]] },
    unidadesConjunto: null,
    stock: { por_tienda: [[0, 30], [1, 20]], cd: 70 },
    proyectado12: 240,
    real12: 480,
    exactitud: "exacto",
    ...extra,
  });

  it("años reales, el año en curso real y estimado, y el año siguiente estimado, cada uno con su tipo", () => {
    const a = armarApoyo(entrada());
    expect(a.soles.anios).toEqual([
      { anio: 2023, s: 100, tipo: "real" },
      { anio: 2024, s: 200, tipo: "real" },
      { anio: 2025, s: 300, tipo: "real" },
      { anio: 2026, s: 250, tipo: "real_parcial" },
      { anio: 2026, s: 220 + 10 * 10, tipo: "estimado" },
      { anio: 2027, s: 1000, tipo: "estimado" },
    ]);
    expect(a.soles.ventana).toEqual({ desde: "2025-11", hasta: "2026-10" });
    expect(a.soles.precio_medio).toBe(10);
  });

  it("cobertura = stock (tiendas + CD) ÷ (unidades de 12 meses ÷ 12); sin venta, `null`", () => {
    const a = armarApoyo(entrada());
    expect(a.cobertura).toEqual({ periodo: "2026-10", stock_tiendas: 50, stock_cd: 70, imi_proyectado: 120 / (240 / 12), imi_real: 120 / (480 / 12), exactitud: "exacto" });
    expect(mesesDeCobertura(100, 0)).toBeNull();
    expect(mesesDeCobertura(100, null)).toBeNull();
    const sinCd = armarApoyo(entrada({ stock: { por_tienda: [[0, 30]], cd: null }, exactitud: "estimado" }));
    expect(sinCd.cobertura).toMatchObject({ stock_tiendas: 30, stock_cd: null, imi_proyectado: 30 / 20, exactitud: "estimado" });
  });

  it("con un conjunto de tiendas, sus unidades se valorizan al precio medio de lo proyectado en el recorte", () => {
    const a = armarApoyo(entrada({ unidadesConjunto: { enCursoResto: 3, siguiente: 25 } }));
    expect(soles(a, 2026, "estimado")).toBe(220 + 3 * 10);
    expect(soles(a, 2027, "estimado")).toBe(250);
  });
});

describe("R11 · soles y cobertura del caso de §6.1", () => {
  it("HOMBRE · URBANO: soles reales por año y estimados de 2026 cierre (S/ 2 600 052) y 2027 (S/ 2 740 816)", async () => {
    const t = await ver(HU);
    const a = t.apoyo;
    expect(soles(a, 2023, "real")).toBe(1880000);
    expect(soles(a, 2024, "real")).toBe(2016000);
    // 2025: enero a octubre a S/ 50 y noviembre y diciembre a S/ 52 (así el precio medio de los últimos 12 meses es S/ 52 exacto).
    expect(soles(a, 2025, "real")).toBe(36455 * 50 + 10545 * 52);
    expect(soles(a, 2026, "real_parcial")).toBe(1991600);
    // 1 768 000 (real ene–set) + 16 001 u × S/ 52.
    expect(soles(a, 2026, "estimado")).toBe(1768000 + 16001 * 52);
    expect(soles(a, 2026, "estimado")).toBe(2600052);
    expect(soles(a, 2027, "estimado")).toBe(2740816);
    expect(a.soles.precio_medio).toBe(52);
    expect(a.soles.ventana).toEqual({ desde: "2025-11", hasta: "2026-10" });
    expect(a.soles.u_sin_precio).toBe(0);
    expect(a.soles.anios.map((x) => x.tipo)).toEqual(["real", "real", "real", "real_parcial", "estimado", "estimado"]);
  });

  it("HOMBRE · URBANO: stock 30 000 (18 000 en tiendas y 12 000 en el CD); 6,9 meses con lo proyectado y 7,4 con lo real", async () => {
    const a = (await ver(HU)).apoyo;
    expect(a.cobertura.periodo).toBe("2026-10");
    expect(a.cobertura.stock_tiendas).toBe(18000);
    expect(a.cobertura.stock_cd).toBe(12000);
    // Proyectado nov 2026 – oct 2027 = 52 058 u; real nov 2025 – oct 2026 = 48 845 u.
    expect(a.cobertura.imi_proyectado).toBeCloseTo(30000 / (52058 / 12), 9);
    expect(a.cobertura.imi_proyectado).toBeCloseTo(6.9, 1);
    expect(a.cobertura.imi_real).toBeCloseTo(30000 / (48845 / 12), 9);
    expect(a.cobertura.imi_real).toBeCloseTo(7.4, 1);
    expect(a.cobertura.exactitud).toBe("exacto");
  });

  it("con T03: solo su stock, sin CD, 3,8 meses y «estimado»; los soles estimados son los de sus unidades atribuidas", async () => {
    const a = (await ver({ ...HU, tiendas: T03 })).apoyo;
    expect(a.cobertura).toMatchObject({ stock_tiendas: 2500, stock_cd: null, exactitud: "estimado" });
    expect(a.cobertura.imi_proyectado).toBeCloseTo(3.8, 1);
    expect(soles(a, 2027, "estimado")).toBe(7917 * 52);
    expect(soles(a, 2026, "estimado")).toBe(5000 * 52 + 2404 * 52);
    expect(soles(a, 2025, "real")).toBe(6000 * 50 + 1500 * 52);
  });

  it("un par proyectado que no vendió en los últimos 12 meses se valoriza al precio del recorte y se informa", async () => {
    // Se quita toda la venta de L2 · AM-B desde noviembre de 2025.
    estadoDireccion.hechos = estadoDireccion.hechos.filter((h) => !(h.gml_id === L2_HU && estadoDireccion.amDeUnidad.get(estadoDireccion.unidadDe.get(h.marca_id) ?? "") === AM_B && h.periodo >= "2025-11"));
    const a = (await ver(HU)).apoyo;
    // L2 · AM-B proyecta 4 300 u en 2027 y lo que le queda de 2026 (300 + 340 + 1 221).
    expect(a.soles.u_sin_precio).toBe(4300 + 300 + 340 + 1221);
    expect(a.soles.precio_medio).toBe(52);
    expect(soles(a, 2027, "estimado")).toBe(2740816);
  });

  it("los soles no se guardan ni salen del tablero: ninguna tabla cambia y ninguna otra función los recibe", async () => {
    const antes = JSON.stringify(base.tablas);
    await ver(HU);
    expect(JSON.stringify(base.tablas)).toBe(antes);
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
  });
});
