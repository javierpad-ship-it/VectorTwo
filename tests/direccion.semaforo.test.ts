import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MAX_LECTURAS_VENTA, MENSAJE_COLA_LLENA, PLAZO_COLA_VENTA_MS, REINTENTAR_TRAS_S, Semaforo } from "@/lib/direccion/semaforo";
import { semaforoVenta, vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { estadoDireccion, estadoRol, reiniciar } from "./direccion.fake-db";
import { G_HOMBRE, G_MUJER, M_URBANO, reiniciarNino, sembrarCaso } from "./direccion.fixture";
import { leer, pedir, relojDePrueba } from "./direccion.soporte";

/**
 * Ficha 14 · T3 (informe de seguridad, hallazgo medio): a lo sumo dos lecturas de `tablero_venta` a la vez en el proceso; las demás esperan en cola
 * hasta `PLAZO_COLA_VENTA_MS` y, si no entran, la ruta responde `503 lectura_lenta` con `Retry-After`. Ningún dato real.
 */

/** Deja correr las promesas pendientes sin mover el reloj (también con temporizadores falsos). */
const vueltas = async (n = 50) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r));
};

describe("Semaforo (puro)", () => {
  afterEach(() => vi.useRealTimers());

  it("deja pasar `maximo` a la vez; el tercero espera y entra cuando uno libera, en orden de llegada", async () => {
    const s = new Semaforo(2);
    const a = await s.adquirir(1000);
    const b = await s.adquirir(1000);
    expect(a && b).toBeTruthy();
    expect(s.enCurso).toBe(2);
    let c: (() => void) | null | undefined;
    let d: (() => void) | null | undefined;
    void s.adquirir(1000).then((x) => (c = x));
    void s.adquirir(1000).then((x) => (d = x));
    await vueltas(5);
    expect([c, d, s.enCola]).toEqual([undefined, undefined, 2]);
    a?.();
    await vueltas(5);
    expect(typeof c).toBe("function");
    expect(d).toBeUndefined();
    expect(s.enCurso).toBe(2);
    // Liberar dos veces no da cupo de más.
    a?.();
    await vueltas(5);
    expect(d).toBeUndefined();
    b?.();
    c?.();
    await vueltas(5);
    d?.();
    expect([s.enCurso, s.enCola]).toEqual([0, 0]);
  });

  it("si el plazo vence en cola devuelve `null` y sale de la cola; el cupo no se pierde", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const s = new Semaforo(1);
    const a = await s.adquirir(100);
    let b: (() => void) | null | undefined;
    void s.adquirir(100).then((x) => (b = x));
    await vueltas(5);
    expect(s.enCola).toBe(1);
    vi.advanceTimersByTime(101);
    await vueltas(5);
    expect(b).toBeNull();
    expect(s.enCola).toBe(0);
    a?.();
    expect(s.enCurso).toBe(0);
    expect(typeof (await s.adquirir(100))).toBe("function");
  });

  it("`conPermiso` libera también cuando la lectura falla o lanza", async () => {
    const s = new Semaforo(1);
    await expect(s.conPermiso(100, async () => Promise.reject(new Error("se cayó")))).rejects.toThrow("se cayó");
    expect(s.enCurso).toBe(0);
    const r = await s.conPermiso(100, async () => ({ data: null, error: { code: "57014" } }));
    expect(r).toEqual({ cupo: true, valor: { data: null, error: { code: "57014" } } });
    expect(s.enCurso).toBe(0);
  });
});

describe("tope de lecturas de venta en la ruta del tablero", () => {
  /** Puerta que retiene cada `tablero_venta` hasta `abrir()`. */
  let abrir: () => void = () => {};
  const cerrarPuerta = () => {
    let soltar: () => void = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    abrir = soltar;
    estadoDireccion.esperaVenta = () => puerta;
  };

  beforeEach(() => {
    reiniciar();
    reiniciarNino();
    vaciarCachesDireccion();
    estadoRol.rol = "planner";
    relojDePrueba.hoy = "2026-11-10";
    sembrarCaso();
  });
  afterEach(() => {
    abrir();
    vi.useRealTimers();
  });

  it("dos lecturas en curso ocupan el cupo; la tercera espera y entra al liberar; la misma clave comparte el vuelo y no cuenta doble", async () => {
    expect(MAX_LECTURAS_VENTA).toBe(2);
    cerrarPuerta();
    // A: con filtro de género pide dos ventas a la vez (la del recorte y la de la empresa entera).
    const a = tablero(pedir("/tablero", { generos: G_HOMBRE, mundo_id: M_URBANO }));
    await vueltas();
    expect(semaforoVenta.enCurso).toBe(2);
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(2);
    // B: otro recorte (espera en cola) y la venta sin filtros, que es la MISMA clave que la de A: se une a su vuelo y no pide cupo.
    const b = tablero(pedir("/tablero", { generos: G_MUJER, mundo_id: M_URBANO }));
    // C: el mismo recorte que A: comparte sus dos vuelos.
    const c = tablero(pedir("/tablero", { generos: G_HOMBRE, mundo_id: M_URBANO }));
    await vueltas();
    expect(semaforoVenta.enCurso).toBe(2);
    expect(semaforoVenta.enCola).toBe(1);
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(2);
    abrir();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect([ra.status, rb.status, rc.status]).toEqual([200, 200, 200]);
    // Recorte de A, empresa entera, tendencia y recorte de B: cuatro lecturas en total, nunca más de dos a la vez.
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(4);
    expect([semaforoVenta.enCurso, semaforoVenta.enCola]).toEqual([0, 0]);
  });

  it("si la cola no deja entrar a tiempo: `503 lectura_lenta` con `Retry-After`, sin llamar a la base; las que estaban en curso terminan bien", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cerrarPuerta();
    const a = tablero(pedir("/tablero", { generos: G_HOMBRE, mundo_id: M_URBANO }));
    await vueltas();
    expect(semaforoVenta.enCurso).toBe(2);
    // B: sin filtros y con desglose por línea pide UNA venta, con otra clave (no se une a ningún vuelo de A): espera en cola.
    const b = tablero(pedir("/tablero", { desglose: "linea" }));
    await vueltas();
    expect(semaforoVenta.enCola).toBe(1);
    vi.advanceTimersByTime(PLAZO_COLA_VENTA_MS + 1);
    // Leer el cuerpo de una respuesta usa temporizadores reales.
    vi.useRealTimers();
    const rb = await b;
    expect(rb.status).toBe(503);
    expect(rb.headers.get("Retry-After")).toBe(String(REINTENTAR_TRAS_S));
    expect(await leer(rb)).toEqual({ error: MENSAJE_COLA_LLENA, codigo: "lectura_lenta" });
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(2);
    abrir();
    expect((await a).status).toBe(200);
    expect([semaforoVenta.enCurso, semaforoVenta.enCola]).toEqual([0, 0]);
    // Lo que no entró no queda en la caché: al reintentar, se lee.
    estadoDireccion.esperaVenta = null;
    expect((await tablero(pedir("/tablero", { desglose: "linea" }))).status).toBe(200);
  });

  it("una lectura que falla libera su cupo", async () => {
    estadoDireccion.falloRpc = { nombre: "tablero_venta", code: "57014", message: "canceling statement due to statement timeout" };
    const r = await tablero(pedir("/tablero", {}));
    expect(r.status).toBe(503);
    expect([semaforoVenta.enCurso, semaforoVenta.enCola]).toEqual([0, 0]);
    expect((await tablero(pedir("/tablero", {}))).status).toBe(200);
    expect([semaforoVenta.enCurso, semaforoVenta.enCola]).toEqual([0, 0]);
  });
});
