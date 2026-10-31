import { beforeEach, describe, expect, it, vi } from "vitest";
import { estado as base, estadoIa, reiniciar, ProveedorDinamico, type Fila } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa } from "./ia.contexto-falso";
import { sembrarConfig } from "./ia.escenario";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";
import { N, construirVenta, tiendas as tiendasFixture, type Hecho } from "./proyeccion.fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteIaFalso } = await import("./ia.fake-db");
  return { supabaseAdmin: () => clienteIaFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const falso = await import("./proyeccion.contexto-falso");
  return {
    ...real,
    cargarCatalogo: async () => ({ data: { catalogo: falso.catalogoFalso(), equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }),
    cargarContextoCalculo: async () => ({ data: falso.contextoFalso(), respuesta: null }),
  };
});
vi.mock("@/lib/ia/entorno", async () => ({ leerEntornoIa: (await import("./ia.contexto-falso")).entornoFalso }));
vi.mock("@/lib/ia/proveedores", async () => ({ adaptadorDelEntorno: (await import("./ia.contexto-falso")).adaptadorFalso, proveedoresRegistrados: () => ["openai"] }));

import { cancelarEvaluacion, iniciarEvaluacion, leerEvaluacionApi, listarEvaluaciones, pasoEvaluacion, prepararPliegue, estimarEvaluacion } from "@/lib/ia/servicio-evaluacion";
import type { EvaluacionCuerpo } from "@/lib/ia/servicio-evaluacion";
import type { PasoGMApi, PliegueIa, ResultadosEvaluacionApi } from "@/lib/ia/tipos-api";

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filas = (t: string): Fila[] => base.tablas[t] ?? [];
const PRECIOS = { entrada: 2, entrada_cache: 0.5, salida: 8 };
let prov: ProveedorDinamico;

type Cuerpo = Record<string, unknown> & { codigo?: string; estimacion?: Record<string, number> };
async function ok<T>(r: Promise<{ data: T | null; respuesta: Response | null }>): Promise<T> {
  const x = await r;
  if (x.respuesta) throw new Error(`falló con ${x.respuesta.status}: ${JSON.stringify(await x.respuesta.json())}`);
  return x.data as T;
}
async function falla(r: Promise<{ data: unknown; respuesta: Response | null }>): Promise<{ status: number; cuerpo: Cuerpo }> {
  const x = await r;
  if (!x.respuesta) throw new Error("se esperaba un error");
  return { status: x.respuesta.status, cuerpo: (await x.respuesta.json()) as Cuerpo };
}

const cuerpoEv = (extra: Partial<EvaluacionCuerpo> = {}): EvaluacionCuerpo => ({ modelo: "modelo-a", version_prompt: "v1", precios: PRECIOS, tope_usd: 50, costo_confirmado_usd: 100, ...extra }) as EvaluacionCuerpo;

/** `venta_lineas_ia` con los hechos del fixture de M7 (solo unidades; sin el CD). */
function ventaLineasDeHechos(hechos: readonly Hecho[]) {
  return (args: { p_gml_ids: string[]; p_grupos: Record<string, string>; p_desde: string; p_hasta: string }) => {
    const nodoGMLE = new Set<string>([N.abrigo]);
    const celdas = new Map<string, { gml: string; am: string; eq: string | null; clave: string; periodo: string; u: number }>();
    for (const h of hechos) {
      if (h.tienda === "CD") continue;
      const gml = N[h.nodo];
      if (!args.p_gml_ids.includes(gml)) continue;
      const periodo = `${h.periodo}-01`;
      if (periodo < args.p_desde || periodo > args.p_hasta) continue;
      const eq = nodoGMLE.has(gml) ? h.eq : null;
      const clave = args.p_grupos[h.tienda] ?? "00000";
      const k = [gml, h.agm, eq, clave, periodo].join("|");
      const c = celdas.get(k) ?? { gml, am: h.agm, eq, clave, periodo, u: 0 };
      c.u += h.unidades;
      celdas.set(k, c);
    }
    const lista = [...celdas.values()].sort((a, b) => (a.gml + a.am + (a.eq ?? "") < b.gml + b.am + (b.eq ?? "") ? -1 : 1) || (a.clave < b.clave ? -1 : 1) || (a.periodo < b.periodo ? -1 : 1));
    const dicFilas: [string, string, string | null][] = [];
    const claves: string[] = [...new Set(lista.map((c) => c.clave))].sort();
    const desde = lista.reduce((m, c) => (c.periodo < m ? c.periodo : m), "9999-99-99");
    const out = { dic: { filas: dicFilas, claves, desde }, f: [] as number[], c: [] as number[], p: [] as number[], u: [] as number[], cargas: {} };
    for (const c of lista) {
      let i = dicFilas.findIndex((x) => x[0] === c.gml && x[1] === c.am && x[2] === c.eq);
      if (i < 0) i = dicFilas.push([c.gml, c.am, c.eq]) - 1;
      out.f.push(i);
      out.c.push(claves.indexOf(c.clave));
      out.p.push((Number(c.periodo.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(c.periodo.slice(5, 7)) - Number(desde.slice(5, 7)));
      out.u.push(c.u);
    }
    return out;
  };
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  reiniciarCtxIa();
  prov = new ProveedorDinamico();
  ctxIa.proveedor = prov;
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
  base.venta = (args) =>
    construirVenta(contexto.hechos, tiendasFixture(), { anio: Number(String(args.p_desde).slice(0, 4)) + 3, detalle: args.p_tiendas_detalle, desdeW12: String(args.p_desde_w12).slice(0, 7) });
  estadoIa.ventaLineas = ventaLineasDeHechos(contexto.hechos);
});

describe("iniciar una evaluación", () => {
  it("sin proveedor, sin clave, con un modelo no permitido o con IA desactivada: 409", async () => {
    ctxIa.proveedorId = null;
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("sin_proveedor");
    ctxIa.proveedorId = "openai";
    ctxIa.hayClave = false;
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("ia_sin_clave");
    ctxIa.hayClave = true;
    expect((await falla(iniciarEvaluacion(cuerpoEv({ modelo: "modelo-z" }), ACTOR))).cuerpo.codigo).toBe("modelo_no_permitido");
    ctxIa.desactivada = true;
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("ia_no_disponible");
    expect(filas("ia_evaluaciones")).toHaveLength(0);
  });

  it("pide confirmar el costo (con la estimación) y respeta el tope de la evaluación", async () => {
    const sin = await falla(iniciarEvaluacion(cuerpoEv({ costo_confirmado_usd: 0 }), ACTOR));
    expect(sin.cuerpo.codigo).toBe("costo_no_confirmado");
    expect(sin.cuerpo.estimacion).toMatchObject({ llamadas: 192, tope_usd: 50 });
    expect(sin.cuerpo.estimacion?.costo_usd).toBeGreaterThan(0);
    expect((await falla(iniciarEvaluacion(cuerpoEv({ tope_usd: 0.01 }), ACTOR))).cuerpo.codigo).toBe("tope_evaluacion");
    expect(estimarEvaluacion(3, 36, PRECIOS, 50)).toMatchObject({ gms: 108, llamadas: 192 });
  });

  it("crea la evaluación y su corrida con un GM por pliegue; E25 exige D25; una a la vez; 3 por mes", async () => {
    expect((await falla(iniciarEvaluacion(cuerpoEv({ pliegues: ["E25"] }), ACTOR))).cuerpo.codigo).toBe("pliegues_invalidos");
    const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    expect(r.evaluacion).toMatchObject({ estado: "en_curso", intento: 1, proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", costo_usd: 0, tope_usd: 50 });
    expect(r.evaluacion.parametros).toMatchObject({ pliegues: ["D25", "E25", "D24"], mejora_min: 0.05, intento: 1, semilla_bootstrap: 20261030 });
    expect(r.plan).toHaveLength(9);
    expect(r.plan.slice(0, 3).every((p) => p.pliegue === "D25")).toBe(true);
    expect(filas("ia_corridas")[0]).toMatchObject({ tipo: "evaluacion", evaluacion_id: r.evaluacion.id, proyeccion_id: null, configuracion_id: null });
    expect(filas("ia_corrida_gms")).toHaveLength(9);
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("evaluacion_en_curso");
    await ok(cancelarEvaluacion(r.evaluacion.id));
    await ok(iniciarEvaluacion(cuerpoEv(), ACTOR).then(async (x) => (x.data ? (await cancelarEvaluacion(x.data.evaluacion.id), x) : x)));
    await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    const cuarta = await falla(iniciarEvaluacion(cuerpoEv(), ACTOR));
    expect(["limite_evaluaciones_mes", "evaluacion_en_curso"]).toContain(cuarta.cuerpo.codigo);
    const todas = await ok(listarEvaluaciones());
    expect(todas.map((e) => e.intento)).toEqual([3, 2, 1]);
    expect(todas.map((e) => e.estado)).toEqual(["en_curso", "cancelada", "cancelada"]);
  });

  it("el cuarto intento del mes se rechaza aunque no haya ninguna en curso", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
      await ok(cancelarEvaluacion(r.evaluacion.id));
    }
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("limite_evaluaciones_mes");
  });

  it("el tope del mes de la configuración vigente cuenta (y la evaluación puede hacerse sin configuración)", async () => {
    sembrarConfig({ tope_usd_mes: 1 });
    expect((await falla(iniciarEvaluacion(cuerpoEv(), ACTOR))).cuerpo.codigo).toBe("tope_mensual");
  });

  it("cancelar deja constancia: nada se borra", async () => {
    const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    const c = await ok(cancelarEvaluacion(r.evaluacion.id));
    expect(c.estado).toBe("cancelada");
    expect(filas("ia_corridas")[0].estado).toBe("cancelada");
    expect((await ok(cancelarEvaluacion(r.evaluacion.id))).estado).toBe("cancelada");
    expect((await falla(prepararPliegue(r.evaluacion.id, "D25"))).cuerpo.codigo).toBe("evaluacion_terminada");
    expect((await falla(leerEvaluacionApi("00000000-0000-4000-8000-00000000ffff"))).status).toBe(404);
  });
});

describe("preparar los pliegues y correr los pasos", () => {
  async function correrTodo() {
    const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    const preparados = new Set<string>();
    for (const item of r.plan) {
      if (!preparados.has(item.pliegue)) {
        await ok(prepararPliegue(r.evaluacion.id, item.pliegue as PliegueIa));
        preparados.add(item.pliegue);
      }
      for (let i = 0; i < 10; i++) {
        const x = await pasoEvaluacion(r.evaluacion.id, item.gm_clave, item.pliegue as PliegueIa, ACTOR);
        if (x.respuesta) throw new Error(`paso falló ${x.respuesta.status} ${JSON.stringify(await x.respuesta.json())}`);
        const p = x.data as PasoGMApi;
        if (p.siguiente === "hecho" || p.siguiente === "fallido") break;
      }
    }
    return r;
  }

  it("E25 no se prepara antes que D25", async () => {
    const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    expect((await falla(prepararPliegue(r.evaluacion.id, "E25"))).cuerpo.codigo).toBe("pliegue_sin_preparar");
    expect((await falla(prepararPliegue(r.evaluacion.id, "N26"))).status).toBe(404);
  });

  it("prepara D25 en memoria (sin escribir proyecciones), guarda los bloques y la referencia; la entrada no lleva años reales ni nada posterior al corte", async () => {
    const r = await ok(iniciarEvaluacion(cuerpoEv(), ACTOR));
    const n = await ok(prepararPliegue(r.evaluacion.id, "D25"));
    expect(n.gms).toBe(3);
    expect(filas("proyecciones")).toHaveLength(0);
    expect(filas("proyeccion_filas")).toHaveLength(0);
    const preparadas = filas("ia_corrida_gms").filter((g) => g.pliegue === "D25" && g.estado === "pendiente");
    expect(preparadas.length).toBeGreaterThan(0);
    const g = preparadas[0];
    expect(g.referencia).toMatchObject({ corte: "2024-12", predice: 2025 });
    expect(Array.isArray(g.plan)).toBe(true);
    expect((g.bloque_ids as string[]).length).toBeGreaterThan(0);
    const bloque = filas("ia_entradas").find((e) => e.id === (g.bloque_ids as string[])[0]) as Fila;
    expect(bloque.huella).toMatch(/^[0-9a-f]{64}$/);
    // La referencia lleva el real del año predicho y los rivales; el real nunca sale (no está en `ia_entradas.diccionario`).
    const ref = g.referencia as { meta_oraculo: number; filas: Record<string, { real: number; base_s: number; metodo: number; tendencia: number }> };
    expect(ref.meta_oraculo).toBe(Object.values(ref.filas).reduce((s, f) => s + f.real, 0));
    expect(Object.values(ref.filas).reduce((s, f) => s + f.metodo, 0)).toBe(ref.meta_oraculo);
    expect(Object.values(ref.filas).reduce((s, f) => s + f.tendencia, 0)).toBe(ref.meta_oraculo);
    // Idempotente.
    expect((await ok(prepararPliegue(r.evaluacion.id, "D25"))).gms).toBe(3);
  });

  it("corre los tres pliegues sin reusar nunca (cada paso llama), y con pocas filas el veredicto es `sin_dato`", async () => {
    const r = await correrTodo();
    const e = await ok(leerEvaluacionApi(r.evaluacion.id));
    expect(e.estado).toBe("completa");
    expect(e.veredicto).toEqual({ distribucion_y1: "sin_dato", regla_que_fallo: "sin_dato" });
    const gms = filas("ia_corrida_gms");
    expect(gms.every((g) => ["hecho", "sin_filas_libres", "fallido", "bloqueado_privacidad"].includes(g.estado as string))).toBe(true);
    const hechos = gms.filter((g) => g.estado === "hecho");
    expect(hechos.length).toBeGreaterThan(0);
    // Dos llamadas por GM hecho y por pliegue (natural y reparto): D25 y E25 usan la misma entrada y aun así llaman las dos.
    expect(prov.llamadas).toBe(2 * hechos.length);
    expect(hechos.filter((g) => g.pliegue === "E25").length).toBe(hechos.filter((g) => g.pliegue === "D25").length);
    const d25 = hechos.filter((g) => g.pliegue === "D25");
    const e25 = hechos.filter((g) => g.pliegue === "E25");
    expect(e25.map((g) => g.huella_gm)).toEqual(d25.map((g) => g.huella_gm));
    // Resultados: estabilidad 0 (el proveedor falso contesta lo mismo) y cobertura plena.
    const res = e.resultados as ResultadosEvaluacionApi;
    expect(res.estabilidad).toBe(0);
    expect(res.cobertura).toBe(1);
    expect(res.d25?.reparto.filas).toBeGreaterThan(0);
    expect(res.d25?.reparto.wape_ia).not.toBeNull();
    expect(e.costo_usd).toBeGreaterThan(0);
    expect(e.terminada_at).not.toBeNull();
    expect(filas("ia_corridas")[0].estado).toBe("completa");
    // La evaluación terminada responde igual a un paso de un GM que ya estaba hecho.
    const item = hechos[0];
    const otra = await pasoEvaluacion(r.evaluacion.id, item.gm_clave as string, item.pliegue as PliegueIa, ACTOR);
    expect((otra.data as PasoGMApi).siguiente).toBe("hecho");
  });

  it("un tope detiene la evaluación: queda `fallida` y registrada", async () => {
    const r = await ok(iniciarEvaluacion(cuerpoEv({ tope_usd: 50 }), ACTOR));
    base.tablas.ia_evaluaciones[0].tope_usd = 0.001;
    await ok(prepararPliegue(r.evaluacion.id, "D25"));
    const item = r.plan.find((p) => filas("ia_corrida_gms").some((g) => g.pliegue === p.pliegue && g.gm_clave === p.gm_clave && g.estado === "pendiente" && g.plan))!;
    const x = await falla(pasoEvaluacion(r.evaluacion.id, item.gm_clave, "D25", ACTOR));
    expect(x.cuerpo.codigo).toBe("tope_corrida");
    expect(prov.llamadas).toBe(0);
    expect(filas("ia_evaluaciones")[0].estado).toBe("fallida");
  });
});
