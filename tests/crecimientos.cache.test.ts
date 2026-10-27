import { beforeEach, describe, expect, it } from "vitest";
import {
  claveCacheGM,
  leerVentaGMCacheada,
  MAX_ENTRADAS_CACHE_GM,
  tamanioCacheGM,
  TTL_CACHE_GM_MS,
  vaciarCacheGM,
  type ClaveCacheGM,
} from "@/lib/crecimientos/cache";
import { huellaCargas } from "@/lib/curvas/huellas";
import type { VentaGeneroMundo } from "@/lib/crecimientos/series";

/**
 * Regla 17 (ficha 06d §2.4, M1): la clave de la caché incluye las tres marcas de tiempo del árbol, así que cambiar el GM de un nodo
 * o la agrupación de una equivalencia cambia la clave aunque las cargas sean las mismas. TTL 120 s, 2 entradas, una lectura a la vez,
 * congelado en profundidad. Sintético.
 */

const cargas = { "2026-08": "c8", "2026-09": "c9" };
const venta = (extra: Partial<VentaGeneroMundo> = {}): VentaGeneroMundo => ({ series: [{ g: "g", m: "m", temp: "invierno", t: "t", u: { "2026-08": 10 } }], cargas, ...extra });
const clave = (extra: Partial<ClaveCacheGM> = {}): ClaveCacheGM => ({
  desde: "2023-01-01",
  cargas_huella: huellaCargas(cargas),
  marcas: { nodos: "n", equivalencias: "e", agrupaciones: "a" },
  ...extra,
});

beforeEach(() => vaciarCacheGM());

describe("regla 17 · la clave", () => {
  it("cambia con p_desde, las cargas y cada una de las tres marcas de tiempo", () => {
    const k = claveCacheGM(clave());
    for (const c of [
      { desde: "2024-01-01" },
      { cargas_huella: "otra" },
      { marcas: { nodos: "n2", equivalencias: "e", agrupaciones: "a" } },
      { marcas: { nodos: "n", equivalencias: "e2", agrupaciones: "a" } },
      { marcas: { nodos: "n", equivalencias: "e", agrupaciones: "a2" } },
    ]) {
      expect(claveCacheGM(clave(c)), JSON.stringify(c)).not.toBe(k);
    }
  });

  it("mover un nodo de mundo (marca nueva) lee otra vez aunque las cargas sean las mismas", async () => {
    let llamadas = 0;
    const cargar = async () => (llamadas++, { data: venta(), error: null });
    await leerVentaGMCacheada(clave(), cargar);
    await leerVentaGMCacheada(clave(), cargar);
    expect(llamadas).toBe(1);
    await leerVentaGMCacheada(clave({ marcas: { nodos: "mover", equivalencias: "e", agrupaciones: "a" } }), cargar);
    expect(llamadas).toBe(2);
    await leerVentaGMCacheada(clave({ marcas: { nodos: "n", equivalencias: "e", agrupaciones: "cambio de temporada" } }), cargar);
    expect(llamadas).toBe(3);
  });
});

describe("la caché de venta por género × mundo", () => {
  it("la segunda lectura sale de la memoria y lo guardado está congelado en profundidad", async () => {
    const a = await leerVentaGMCacheada(clave(), async () => ({ data: venta(), error: null }));
    expect(a.cacheada).toBe(false);
    const b = await leerVentaGMCacheada(clave(), async () => ({ data: venta({ series: [] }), error: null }));
    expect(b.cacheada).toBe(true);
    expect(b.data?.series).toHaveLength(1);
    expect(Object.isFrozen(b.data)).toBe(true);
    expect(Object.isFrozen(b.data?.series)).toBe(true);
    expect(Object.isFrozen(b.data?.series[0])).toBe(true);
    expect(Object.isFrozen(b.data?.series[0]?.u)).toBe(true);
    expect(() => {
      (b.data?.series[0]?.u as Record<string, number>)["2026-08"] = 99;
    }).toThrow();
  });

  it("caduca a los 120 s", async () => {
    let t = 1_000;
    const ahora = () => t;
    let llamadas = 0;
    const cargar = async () => (llamadas++, { data: venta(), error: null });
    await leerVentaGMCacheada(clave(), cargar, { ahora });
    t += TTL_CACHE_GM_MS - 1;
    expect((await leerVentaGMCacheada(clave(), cargar, { ahora })).cacheada).toBe(true);
    t += 2;
    expect((await leerVentaGMCacheada(clave(), cargar, { ahora })).cacheada).toBe(false);
    expect(llamadas).toBe(2);
  });

  it("conserva a lo sumo 2 entradas: sale la menos usada", async () => {
    expect(MAX_ENTRADAS_CACHE_GM).toBe(2);
    const cargar = async () => ({ data: venta(), error: null });
    const k = (n: string) => clave({ desde: n });
    await leerVentaGMCacheada(k("1"), cargar);
    await leerVentaGMCacheada(k("2"), cargar);
    await leerVentaGMCacheada(k("1"), cargar); // reinsertar la deja como la más reciente
    await leerVentaGMCacheada(k("3"), cargar);
    expect(tamanioCacheGM()).toBe(2);
    expect((await leerVentaGMCacheada(k("1"), cargar)).cacheada).toBe(true);
    expect((await leerVentaGMCacheada(k("2"), cargar)).cacheada).toBe(false);
  });

  it("las lecturas en curso de la misma clave se juntan en una sola llamada", async () => {
    let llamadas = 0;
    const cargar = () =>
      new Promise<{ data: VentaGeneroMundo; error: null }>((resolver) => {
        llamadas++;
        setTimeout(() => resolver({ data: venta(), error: null }), 5);
      });
    const [a, b, c] = await Promise.all([leerVentaGMCacheada(clave(), cargar), leerVentaGMCacheada(clave(), cargar), leerVentaGMCacheada(clave(), cargar)]);
    expect(llamadas).toBe(1);
    expect(a.data).toBe(b.data);
    expect(b.data).toBe(c.data);
  });

  it("corre una lectura a la vez: la segunda de otra clave espera a la primera", async () => {
    const eventos: string[] = [];
    const lenta = (nombre: string) => async () => {
      eventos.push(`inicio ${nombre}`);
      await new Promise((r) => setTimeout(r, 5));
      eventos.push(`fin ${nombre}`);
      return { data: venta(), error: null };
    };
    await Promise.all([leerVentaGMCacheada(clave({ desde: "a" }), lenta("a")), leerVentaGMCacheada(clave({ desde: "b" }), lenta("b"))]);
    expect(eventos).toEqual(["inicio a", "fin a", "inicio b", "fin b"]);
  });

  it("con error o sin datos no se guarda nada", async () => {
    const e = await leerVentaGMCacheada(clave(), async () => ({ data: null, error: { message: "falló" } }));
    expect(e.error).toEqual({ message: "falló" });
    const v = await leerVentaGMCacheada(clave(), async () => ({ data: null, error: null }));
    expect(v.data).toBeNull();
    expect(tamanioCacheGM()).toBe(0);
  });

  it("si la función devuelve otras cargas (una publicación en medio) se guarda bajo la clave REAL", async () => {
    const nuevas = { ...cargas, "2026-10": "c10" };
    await leerVentaGMCacheada(clave(), async () => ({ data: venta({ cargas: nuevas }), error: null }));
    expect((await leerVentaGMCacheada(clave({ cargas_huella: huellaCargas(nuevas) }), async () => ({ data: null, error: null }))).cacheada).toBe(true);
    expect((await leerVentaGMCacheada(clave(), async () => ({ data: venta(), error: null }))).cacheada).toBe(false);
  });
});
