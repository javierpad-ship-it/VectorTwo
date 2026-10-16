import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ENTRADAS_CACHE_COMPOSICION,
  MAX_LECTURAS_COMPOSICION,
  TTL_CACHE_COMPOSICION_MS,
  claveComposicion,
  huellaRedPorAnio,
  leerComposicionCacheada,
  tamanioCacheComposicion,
  vaciarCacheComposicion,
  type ClaveComposicion,
} from "@/lib/curvas/cache-composicion";
import { huellaCargas } from "@/lib/curvas/huellas";
import type { LecturaComposicion } from "@/lib/curvas/composicion";

const cargas = { "2026-01": "c1" };
const lectura = (extra: Partial<LecturaComposicion> = {}): LecturaComposicion => ({ nodos: [{ gml_id: "g", periodo: "2026-01", unidades: 5 }], equivalencias: [], otras: [], cargas, ...extra });
const clave = (extra: Partial<ClaveComposicion> = {}): ClaveComposicion => ({ id: "a1", cargas_huella: huellaCargas(cargas), composicion: "k", red_huella: huellaRedPorAnio({ "2026": ["t1"] }), hasta: "2026-09", ...extra });
const ok = (l: LecturaComposicion = lectura()) => async () => ({ data: l, error: null as null });

beforeEach(() => vaciarCacheComposicion());

describe("clave y huella de la red", () => {
  it("la clave describe id, cargas, composición, red y hasta", () => {
    expect(claveComposicion(clave())).toBe(["a1", huellaCargas(cargas), "k", "composicion", huellaRedPorAnio({ "2026": ["t1"] }), "2026-09"].join(" | "));
  });
  it("huellaRedPorAnio no depende del orden de los años ni de las tiendas; cambia con la red", () => {
    expect(huellaRedPorAnio({ "2025": ["b", "a"], "2024": ["c"] })).toBe(huellaRedPorAnio({ "2024": ["c"], "2025": ["a", "b"] }));
    expect(huellaRedPorAnio({ "2024": ["c"] })).not.toBe(huellaRedPorAnio({ "2024": ["c", "d"] }));
    expect(huellaRedPorAnio({ "2024": ["c"] })).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("caché de la composición", () => {
  it("la segunda lectura de la misma clave sale de la memoria (una sola llamada a la base)", async () => {
    let llamadas = 0;
    const cargar = async () => {
      llamadas += 1;
      return { data: lectura(), error: null as null };
    };
    const a = await leerComposicionCacheada(clave(), cargar);
    const b = await leerComposicionCacheada(clave(), cargar);
    expect([a.cacheada, b.cacheada, llamadas]).toEqual([false, true, 1]);
    expect(b.data).toEqual(a.data);
  });
  it("otra red, otro hasta u otra composición son otra entrada", async () => {
    let llamadas = 0;
    const cargar = async () => {
      llamadas += 1;
      return { data: lectura(), error: null as null };
    };
    await leerComposicionCacheada(clave(), cargar);
    await leerComposicionCacheada(clave({ red_huella: huellaRedPorAnio({ "2026": ["t1", "t2"] }) }), cargar);
    await leerComposicionCacheada(clave({ hasta: "2026-08" }), cargar);
    await leerComposicionCacheada(clave({ composicion: "otra" }), cargar);
    expect(llamadas).toBe(4);
    expect(tamanioCacheComposicion()).toBe(4);
  });
  it("caduca a los 120 s", async () => {
    let ahora = 1_000;
    let llamadas = 0;
    const cargar = async () => {
      llamadas += 1;
      return { data: lectura(), error: null as null };
    };
    await leerComposicionCacheada(clave(), cargar, { ahora: () => ahora });
    ahora += TTL_CACHE_COMPOSICION_MS - 1;
    expect((await leerComposicionCacheada(clave(), cargar, { ahora: () => ahora })).cacheada).toBe(true);
    ahora += 2;
    expect((await leerComposicionCacheada(clave(), cargar, { ahora: () => ahora })).cacheada).toBe(false);
    expect(llamadas).toBe(2);
    expect(TTL_CACHE_COMPOSICION_MS).toBe(120_000);
  });
  it("conserva a lo sumo 10 entradas; sale primero la menos usada", async () => {
    expect(MAX_ENTRADAS_CACHE_COMPOSICION).toBe(10);
    for (let i = 0; i < 10; i++) await leerComposicionCacheada(clave({ id: `a${i}` }), ok());
    await leerComposicionCacheada(clave({ id: "a0" }), ok()); // a0 pasa a ser la más reciente
    await leerComposicionCacheada(clave({ id: "nueva" }), ok());
    expect(tamanioCacheComposicion()).toBe(10);
    expect((await leerComposicionCacheada(clave({ id: "a0" }), ok())).cacheada).toBe(true);
    expect((await leerComposicionCacheada(clave({ id: "a1" }), ok())).cacheada).toBe(false);
  });
  it("con error o sin datos no guarda nada", async () => {
    const e = await leerComposicionCacheada(clave(), async () => ({ data: null, error: { code: "x" } }));
    expect(e.error).toEqual({ code: "x" });
    const n = await leerComposicionCacheada(clave({ id: "otra" }), async () => ({ data: null, error: null }));
    expect(n.data).toBeNull();
    expect(tamanioCacheComposicion()).toBe(0);
  });
  it("si la función devuelve otras cargas, la entrada se guarda bajo la clave REAL (no bajo la pedida)", async () => {
    const distintas = { "2026-01": "c1", "2026-02": "c2" };
    await leerComposicionCacheada(clave(), ok(lectura({ cargas: distintas })));
    const pedida = await leerComposicionCacheada(clave(), ok(lectura({ cargas: distintas })));
    expect(pedida.cacheada).toBe(false);
    const real = await leerComposicionCacheada(clave({ cargas_huella: huellaCargas(distintas) }), ok());
    expect(real.cacheada).toBe(true);
  });
  it("las lecturas en curso de la misma clave se juntan en una sola llamada", async () => {
    let llamadas = 0;
    let soltar: () => void = () => undefined;
    const puerta = new Promise<void>((r) => (soltar = r));
    const cargar = async () => {
      llamadas += 1;
      await puerta;
      return { data: lectura(), error: null as null };
    };
    const a = leerComposicionCacheada(clave(), cargar);
    const b = leerComposicionCacheada(clave(), cargar);
    soltar();
    const [ra, rb] = await Promise.all([a, b]);
    expect(llamadas).toBe(1);
    expect(rb.data).toEqual(ra.data);
  });
  it("a lo sumo 2 lecturas simultáneas: la tercera espera", async () => {
    expect(MAX_LECTURAS_COMPOSICION).toBe(2);
    let activas = 0;
    let maxima = 0;
    const soltadores: (() => void)[] = [];
    const cargar = async () => {
      activas += 1;
      maxima = Math.max(maxima, activas);
      await new Promise<void>((r) => soltadores.push(r));
      activas -= 1;
      return { data: lectura(), error: null as null };
    };
    const lecturas = [0, 1, 2, 3].map((i) => leerComposicionCacheada(clave({ id: `x${i}` }), cargar));
    await new Promise((r) => setTimeout(r, 5));
    expect(activas).toBe(2);
    while (soltadores.length > 0 || activas > 0) {
      soltadores.shift()?.();
      await new Promise((r) => setTimeout(r, 2));
    }
    await Promise.all(lecturas);
    expect(maxima).toBe(2);
  });
  it("lo guardado se congela en profundidad: quien lo lee no puede alterar lo que ve el siguiente", async () => {
    const a = await leerComposicionCacheada(clave(), ok());
    expect(() => {
      (a.data as LecturaComposicion).nodos[0].unidades = 999;
    }).toThrow();
    expect(Object.isFrozen(a.data)).toBe(true);
  });
});
