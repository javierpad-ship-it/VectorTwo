import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ComposicionAgrupacionApi, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { estadoFalso, type ArgsComposicion } from "./curvas.fake-db";

vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./curvas.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { POST as composicion } from "@/app/api/curvas/agrupaciones/[id]/composicion/route";
import { POST as calcular } from "@/app/api/curvas/agrupaciones/[id]/calcular/route";
import { tamanioCacheComposicion, vaciarCacheComposicion } from "@/lib/curvas/cache-composicion";
import { tamanioCacheVenta, vaciarCacheVenta } from "@/lib/curvas/cache-venta";
import { ABRIGO_ID, PUBLICADOS, T1, T3, filasFixture } from "./curvas.fixture";
import { A, GML_N1, GML_N2, INEXISTENTE, VACIA, ctx, dia1, json, leer, sembrar } from "./curvas.rutas.soporte";

/**
 * `POST /api/curvas/agrupaciones/[id]/composicion` (06c, reglas 61 a 65 y caso 41). La base falsa responde
 * `venta_composicion_agrupacion` con la venta del fixture de ABRIGO repartida entre dos GML (n1 con dos
 * equivalencias y n2 con una), filtrada por la red (`p_red`) y el tope (`p_hasta`) que manda la ruta.
 */

const ID = A[ABRIGO_ID];
const URL = "http://localhost/api/curvas";

/** Lo que devolvería la función SQL con la venta de ABRIGO: n1 = 2/3 de cada mes, n2 = 1/3; e-0-1 y e-0-2 se reparten n1. */
function respuestaComposicion(args: ArgsComposicion) {
  const nodos: { gml_id: string; periodo: string; unidades: number }[] = [];
  const porEq = new Map<string, number>();
  const filas = filasFixture("base").filter((f) => f.agrupacion_id === ABRIGO_ID);
  const porMes = new Map<string, number>();
  for (const f of filas) {
    const anio = f.periodo.slice(0, 4);
    if (!(args.p_red[anio] ?? []).includes(f.tienda_id)) continue;
    if (`${f.periodo}-01` > args.p_hasta) continue;
    porMes.set(f.periodo, (porMes.get(f.periodo) ?? 0) + f.unidades);
  }
  for (const [periodo, u] of [...porMes].sort()) {
    nodos.push({ gml_id: GML_N1, periodo: `${periodo}-01`, unidades: (u * 2) / 3 }, { gml_id: GML_N2, periodo: `${periodo}-01`, unidades: u / 3 });
    const anio = periodo.slice(0, 4);
    porEq.set(`e-0-1|${GML_N1}|${anio}`, (porEq.get(`e-0-1|${GML_N1}|${anio}`) ?? 0) + u / 3);
    porEq.set(`e-0-2|${GML_N1}|${anio}`, (porEq.get(`e-0-2|${GML_N1}|${anio}`) ?? 0) + u / 3);
    porEq.set(`e-0-3|${GML_N2}|${anio}`, (porEq.get(`e-0-3|${GML_N2}|${anio}`) ?? 0) + u / 3);
  }
  return {
    nodos,
    equivalencias: [...porEq].map(([k, unidades]) => {
      const [equivalencia_id, gml_id, anio] = k.split("|");
      return { equivalencia_id, gml_id, anio: Number(anio), unidades };
    }),
    otras: [],
    cargas: Object.fromEntries(PUBLICADOS.map((m) => [dia1(m), `carga-${m}`])),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  vaciarCacheVenta();
  vaciarCacheComposicion();
  sembrar();
  estadoFalso.composicion = { respuesta: respuestaComposicion, error: null };
});
afterEach(() => {
  vi.useRealTimers();
});

const pedir = (id: string, cuerpo: unknown = {}) => composicion(json(cuerpo, "POST", `/agrupaciones/${id}/composicion`), ctx(id));
const abrir = async (cuerpo: Record<string, unknown> = {}) => (await leer<TrabajoAgrupacionApi>(await calcular(json(cuerpo), ctx(ID)))).data;

describe("guards", () => {
  it("sin sesión 401 y comprador 403, sin leer nada", async () => {
    for (const [rol, status] of [["sin_sesion", 401], ["comprador", 403]] as const) {
      estadoFalso.rol = rol;
      expect((await pedir(ID)).status).toBe(status);
    }
    expect(estadoFalso.llamadasComposicion).toEqual([]);
    expect(estadoFalso.llamadasVenta).toEqual([]);
  });
});

describe("regla 65 · POST …/composicion", () => {
  it("200 con la forma del contrato y la MISMA huella_calculo que calcular; no escribe nada", async () => {
    const trabajo = await abrir();
    const r = await pedir(ID);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const c = (await leer<ComposicionAgrupacionApi>(r)).data;
    expect(c.huella_calculo).toBe(trabajo.huella_calculo);
    expect(c).toMatchObject({ hasta_periodo: "2026-09", con_calculo: true, umbral_forma: 3, min_unidades: 120 });
    expect(c.ruido_normal).toBe(trabajo.calculo?.resultado.ruido_normal);
    expect(c.gml.map((g) => [g.gml_id, g.genero, g.mundo, g.linea, g.nivel, g.vigente])).toEqual([
      [GML_N1, "HOMBRE", "URBANO", "CASACA", "GML", true],
      [GML_N2, "HOMBRE", "URBANO", "CHOMPA", "GML", true],
    ]);
    expect(c.duracion_ms).toBeGreaterThanOrEqual(0);
    expect(c.equivalencias_activas).toBe(3);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
  it("Σ unidades de los GML por año = resultado.anios[].unidades de calcular; Σ pesos = 1", async () => {
    const trabajo = await abrir();
    const c = (await leer<ComposicionAgrupacionApi>(await pedir(ID))).data;
    for (const a of trabajo.calculo!.resultado.anios.filter((x) => x.unidades > 0)) {
      const delAnio = c.gml.map((g) => g.por_anio.find((x) => x.anio === a.anio)!);
      expect(delAnio.reduce((s, x) => s + x.unidades, 0)).toBeCloseTo(a.unidades, 6);
      expect(delAnio.reduce((s, x) => s + x.peso, 0)).toBeCloseTo(1, 6);
    }
    expect(c.anios.map((a) => [a.anio, a.clase, a.en_ajuste])).toEqual(trabajo.calculo!.resultado.anios.map((a) => [a.anio, a.clase, a.en_ajuste]));
    const n1 = c.gml.find((g) => g.gml_id === GML_N1)!;
    expect(n1.equivalencias.map((e) => e.codigo)).toEqual(["E01", "E02"]);
    expect(c.gml.find((g) => g.gml_id === GML_N2)!.equivalencias[0].es_generica).toBe(true);
  });
  it("la ruta arma p_red desde el cálculo (tiendas que entran por año, ordenadas) y p_hasta como primer día del último mes; nunca del cuerpo", async () => {
    await pedir(ID);
    expect(estadoFalso.llamadasComposicion).toHaveLength(1);
    const l = estadoFalso.llamadasComposicion[0];
    expect(l.p_agrupacion_id).toBe(ID);
    expect(l.p_hasta).toBe("2026-09-01");
    expect(Object.keys(l.p_red)).toEqual(["2023", "2024", "2025", "2026"]);
    for (const tiendas of Object.values(l.p_red)) expect(tiendas).toEqual([...tiendas].sort());
    expect(l.p_red["2023"]).toEqual([T1]);
    // El cuerpo no puede traer p_red ni p_hasta: es el mismo cuerpo estricto de `calcular`.
    expect((await pedir(ID, { p_red: { "2024": ["x"] } })).status).toBe(400);
    expect((await pedir(ID, { p_hasta: "2026-01-01" })).status).toBe(400);
  });
  it("hasta_periodo del cuerpo cambia p_hasta y los totales; uno no publicado es 409 hasta_periodo_sin_cargar", async () => {
    const r = await pedir(ID, { hasta_periodo: "2026-07" });
    expect(r.status).toBe(200);
    expect(estadoFalso.llamadasComposicion[0].p_hasta).toBe("2026-07-01");
    expect((await leer<ComposicionAgrupacionApi>(r)).data.hasta_periodo).toBe("2026-07");
    const mal = await pedir(ID, { hasta_periodo: "2027-01" });
    expect(mal.status).toBe(409);
    expect((await leer(mal)).codigo).toBe("hasta_periodo_sin_cargar");
  });
  it("dos llamadas con la misma huella dan gml idéntico y la segunda sale de la caché (una sola llamada a la base)", async () => {
    const a = (await leer<ComposicionAgrupacionApi>(await pedir(ID))).data;
    const b = (await leer<ComposicionAgrupacionApi>(await pedir(ID))).data;
    expect(b.gml).toEqual(a.gml);
    expect(b.huella_calculo).toBe(a.huella_calculo);
    expect(estadoFalso.llamadasComposicion).toHaveLength(1);
    expect(estadoFalso.llamadasVenta).toHaveLength(1);
  });
  it("caché y semáforo PROPIOS: abrir la composición no mete nada en la caché de venta ni al revés", async () => {
    await pedir(ID);
    expect(tamanioCacheComposicion()).toBe(1);
    expect(tamanioCacheVenta()).toBe(1);
    await calcular(json({}), ctx(A[ABRIGO_ID]));
    expect(tamanioCacheComposicion()).toBe(1);
    expect(tamanioCacheVenta()).toBe(1);
    vaciarCacheComposicion();
    expect(tamanioCacheComposicion()).toBe(0);
    expect(tamanioCacheVenta()).toBe(1);
  });
  it("caso 41 · un parámetro de la red (meses_tienda_nueva = 3) cambia p_red, totales y pesos y la huella del cálculo", async () => {
    // (`tiendas_excluidas` pide UUID y las tiendas del fixture no lo son; el efecto sobre p_red es el mismo: T3 sale de la red de 2026.)
    const base = (await leer<ComposicionAgrupacionApi>(await pedir(ID))).data;
    const nueva = await pedir(ID, { meses_tienda_nueva: 3 });
    expect(nueva.status).toBe(200);
    const cNueva = (await leer<ComposicionAgrupacionApi>(nueva)).data;
    expect(estadoFalso.llamadasComposicion).toHaveLength(2);
    const [l1, l2] = estadoFalso.llamadasComposicion;
    expect(l1.p_red["2026"]).toContain(T3);
    expect(l2.p_red["2026"]).not.toContain(T3);
    expect(l2.p_red["2025"]).toEqual(l1.p_red["2025"]);
    expect(cNueva.huella_calculo).not.toBe(base.huella_calculo);
    const total = (c: ComposicionAgrupacionApi, anio: number) => c.gml.reduce((s, g) => s + (g.por_anio.find((x) => x.anio === anio)?.unidades ?? 0), 0);
    expect(total(cNueva, 2026)).toBeLessThan(total(base, 2026));
    expect(total(cNueva, 2024)).toBeCloseTo(total(base, 2024), 6);
    // Misma huella que `calcular` con el mismo cuerpo.
    expect(cNueva.huella_calculo).toBe((await abrir({ meses_tienda_nueva: 3 })).huella_calculo);
  });
  it("un parámetro que no toca la red (umbral_forma) cambia la huella pero reutiliza la lectura de la caché (misma red, mismo tope)", async () => {
    await pedir(ID);
    const r = await pedir(ID, { umbral_forma: 5 });
    expect(r.status).toBe(200);
    expect((await leer<ComposicionAgrupacionApi>(r)).data.umbral_forma).toBe(5);
    expect(estadoFalso.llamadasComposicion).toHaveLength(1);
  });
  it("caso 41 · anios_excluidos = [2024]: el año sale de la curva del GML (anios_curva)", async () => {
    const todos = (await leer<ComposicionAgrupacionApi>(await pedir(ID))).data;
    const sin = (await leer<ComposicionAgrupacionApi>(await pedir(ID, { anios_excluidos: [2024] }))).data;
    expect(todos.gml[0].anios_curva).toContain(2024);
    expect(sin.gml[0].anios_curva).not.toContain(2024);
    expect(sin.gml[0].por_anio.find((a) => a.anio === 2024)).toMatchObject({ en_ajuste: false, valido: false });
  });
  it("con un bloqueo que deja red (periodos de la temporada sin cargar) responde 200 con con_calculo = false, se_aparta null y sin_calculo", async () => {
    estadoFalso.tablas.periodos_atipicos = [];
    const trabajo = await abrir();
    expect(trabajo.calculo).toBeNull();
    expect(trabajo.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("periodos_temporada_faltantes");
    const r = await pedir(ID);
    expect(r.status).toBe(200);
    const c = (await leer<ComposicionAgrupacionApi>(r)).data;
    expect(c.con_calculo).toBe(false);
    expect(c.huella_calculo).toBe(trabajo.huella_calculo);
    expect(c.ruido_normal).toBeNull();
    for (const g of c.gml) {
      expect(g.se_aparta).toBeNull();
      expect(g.umbral).toBeNull();
      expect(g.avisos).toContain("sin_calculo");
      expect(g.por_anio.every((a) => !a.valido && a.distinta === null)).toBe(true);
    }
    expect(c.gml[0].por_anio.find((a) => a.anio === 2025)!.unidades).toBeGreaterThan(0);
    expect(c.principales).toBeGreaterThan(0);
  });
  it("una agrupación sin venta (VACÍA) responde 200 con pesos en cero y el aviso sin_venta", async () => {
    estadoFalso.composicion.respuesta = () => ({ nodos: [], equivalencias: [], otras: [], cargas: Object.fromEntries(PUBLICADOS.map((m) => [dia1(m), `carga-${m}`])) });
    const r = await pedir(VACIA);
    expect(r.status).toBe(200);
    const c = (await leer<ComposicionAgrupacionApi>(r)).data;
    expect(c.con_calculo).toBe(false);
    expect(c.gml.every((g) => g.avisos.includes("sin_venta"))).toBe(true);
    expect(c.equivalencias_sin_venta).toEqual(["e-3-1"]);
  });
  it("409 sin_datos si no hay ningún mes publicado y cerrado", async () => {
    estadoFalso.venta.porId[ID] = { ...(estadoFalso.venta.porId[ID] as object), meses_publicados: [], cargas: {} };
    const r = await pedir(ID);
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_datos");
    expect(estadoFalso.llamadasComposicion).toEqual([]);
  });
  it("404 agrupación inexistente o id mal formado; 400 cuerpo inválido o claves desconocidas", async () => {
    expect((await pedir(INEXISTENTE)).status).toBe(404);
    expect((await pedir("no-uuid")).status).toBe(404);
    expect((await composicion(new NextRequest(URL, { method: "POST", body: "no es json" }), ctx(ID))).status).toBe(400);
    for (const mal of [{ meses_tienda_nueva: 40 }, { marcar_referencia: true }, { recencia_f: 2 }]) expect((await pedir(ID, mal)).status, JSON.stringify(mal)).toBe(400);
  });
  it("un error de la función es 500 genérico (sin el mensaje de Postgres); una respuesta con otra forma, 500 con mensaje", async () => {
    estadoFalso.composicion.error = { code: "XX000", message: "boom interno" };
    const r1 = await pedir(ID);
    expect(r1.status).toBe(500);
    expect((await leer(r1)).error).not.toMatch(/boom/);
    estadoFalso.composicion.error = null;
    estadoFalso.composicion.respuesta = () => ({ nodos: "mal" });
    const r2 = await pedir(ID);
    expect(r2.status).toBe(500);
    expect((await leer(r2)).error).toMatch(/incompleta/);
    expect(tamanioCacheComposicion()).toBe(0);
  });
  it("si se publicó una carga mientras se leía (cargas distintas de las de la venta), 409 datos_cambiados", async () => {
    estadoFalso.composicion.respuesta = (args) => ({ ...respuestaComposicion(args), cargas: { ...respuestaComposicion(args).cargas, "2026-09-01": "otra-carga" } });
    const r = await pedir(ID);
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiados");
  });
});
