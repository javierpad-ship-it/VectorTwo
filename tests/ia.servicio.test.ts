import { beforeEach, describe, expect, it, vi } from "vitest";
import { estado as base, reiniciar, sembrarIa, ProveedorDinamico, type Fila } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa, sembrarCorrida } from "./ia.contexto-falso";
import { CLAVE_GM, FILAS_A, GEN_H, sembrarConfig, sembrarGM, type EscenarioSembrado } from "./ia.escenario";
import { valida } from "./ia.proveedor-falso";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteIaFalso } = await import("./ia.fake-db");
  return { supabaseAdmin: () => clienteIaFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const c = await import("./ia.contexto-falso");
  const falso = await import("./proyeccion.contexto-falso");
  return {
    ...real,
    cargarCatalogo: async () => ({ data: { catalogo: c.ctxIa.catalogo, equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }),
    cargarContextoCalculo: async () => ({ data: falso.contextoFalso(), respuesta: null }),
  };
});
vi.mock("@/lib/ia/entorno", async () => ({ leerEntornoIa: (await import("./ia.contexto-falso")).entornoFalso }));
vi.mock("@/lib/ia/proveedores", async () => ({ adaptadorDelEntorno: (await import("./ia.contexto-falso")).adaptadorFalso, proveedoresRegistrados: () => ["openai"] }));

import { aceptarIaFila, evaluarServicio, guardarConfiguracionIa, iniciarCorrida, leerConfiguracionIa, leerEntradaIa, leerEstadoIa, leerFilasIa, leerGMDetalle, leerUsoIa, terminarCorrida } from "@/lib/ia/servicio";
import { pasoGM } from "@/lib/ia/servicio-pasos";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canonico } from "@/lib/ia/canonico";
import { huellaEntrada } from "@/lib/ia/huellas";
import { VERSION_METODO } from "@/lib/proyeccion/tipos";
import type { PasoGMApi } from "@/lib/ia/tipos-api";

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filas = (t: string): Fila[] => base.tablas[t] ?? [];
let esc: EscenarioSembrado;
let prov: ProveedorDinamico;

type Cuerpo = Record<string, unknown> & { codigo?: string; motivo?: string; estimacion?: Record<string, number>; valor_actual?: number };
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

function iniciar(semilla = FILAS_A, extraConfig: Fila = {}) {
  esc = sembrarGM(semilla);
  ctxIa.catalogo = esc.catalogo;
  return sembrarConfig(extraConfig);
}

/** Genera la propuesta del GM de punta a punta con una corrida ya creada. */
async function generar(configId: string, guion?: ProveedorDinamico, regenerar = false) {
  if (guion) ctxIa.proveedor = guion;
  for (const c of filas("ia_corridas")) if (c.estado === "en_curso") c.estado = "cancelada";
  const { corridaId } = sembrarCorrida(esc.proyeccionId, { configuracionId: configId, corrida: { ultima_actividad_at: new Date().toISOString(), alcance: { gms: "todos", regenerar, semilla: null } } });
  for (let i = 0; i < 6; i++) {
    const r = await pasoGM(esc.proyeccionId, corridaId, CLAVE_GM, ACTOR);
    if (r.respuesta) throw new Error(`paso falló ${r.respuesta.status}`);
    if ((r.data as PasoGMApi).siguiente === "hecho") return corridaId;
  }
  throw new Error("no terminó");
}

/** Los naturales y repartos del ejemplo A de la ficha (§5.6): 10 300 · 6 600 · 5 100 y 11 000 · 6 700 · 5 000. */
function proveedorEjemploA() {
  return new ProveedorDinamico([
    valida({ version_salida: 2, filas: [
      { f: "f001", natural_y1: 10300, razon_natural: "Crece 3 %.", banderas: [], confianza: "alta" },
      { f: "f002", natural_y1: 6600, razon_natural: "Crece 10 %.", banderas: [], confianza: "media" },
      { f: "f003", natural_y1: 5100, razon_natural: "Crece 2 %.", banderas: ["nino"], confianza: "media" },
    ] }),
    valida({ version_salida: 2, razon_gm: "Se empuja DENIM.", banderas_gm: [], filas: [
      { f: "f001", meta_y1: 11000, razon: "DENIM absorbe el esfuerzo.", banderas: [] },
      { f: "f002", meta_y1: 6700, razon: "POLO queda en su natural.", banderas: [] },
      { f: "f003", meta_y1: 5000, razon: "CASACA cede.", banderas: [] },
    ] }),
  ]);
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  reiniciarCtxIa();
  prov = new ProveedorDinamico();
  ctxIa.proveedor = prov;
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
});

describe("servicio: ¿puede la IA trabajar hoy? (R17)", () => {
  const motivo = async () => (await ok(evaluarServicio(supabaseAdmin(), ACTOR.id))).api.motivo;

  it("cada causa apaga el servicio con su motivo, en el orden de la ficha", async () => {
    expect(await motivo()).toBe("sin_configuracion");
    ctxIa.proveedorId = null;
    expect(await motivo()).toBe("sin_proveedor");
    ctxIa.proveedorId = "claude";
    expect(await motivo()).toBe("sin_proveedor");
    ctxIa.proveedorId = "openai";
    ctxIa.hayClave = false;
    expect(await motivo()).toBe("sin_clave");
    ctxIa.hayClave = true;
    ctxIa.desactivada = true;
    expect(await motivo()).toBe("desactivada_entorno");
    ctxIa.desactivada = false;
    sembrarConfig();
    const cfg = base.tablas.ia_configuraciones[0];
    expect(await motivo()).toBeNull();
    cfg.proveedor = "otro";
    expect(await motivo()).toBe("proveedor_distinto");
    cfg.proveedor = "openai";
    ctxIa.modelos = ["modelo-z"];
    expect(await motivo()).toBe("modelo_no_permitido");
    ctxIa.modelos = ["modelo-a"];
    cfg.capacidades = [];
    expect(await motivo()).toBe("sin_capacidades");
  });

  it("una clave rechazada hace poco y el tope mensual también la apagan; se trae el gasto", async () => {
    const cfg = sembrarConfig();
    const { corridaId, gmIds } = sembrarCorrida("p", { corrida: { proyeccion_id: null } });
    const llamada = (extra: Fila) => sembrarIa("ia_llamadas", [{ corrida_id: corridaId, corrida_gm_id: gmIds[0], paso: "n1", tipo_llamada: "natural", intento: 1, huella_llamada: "h".repeat(64), bytes_entrada: 1, filas_enviadas: 1, duracion_ms: 1, perfil_id: ACTOR.id, estado: "ok", ...extra }]);
    llamada({ costo_usd: 59.99 });
    let s = (await ok(evaluarServicio(supabaseAdmin(), ACTOR.id))).api;
    expect(s).toMatchObject({ disponible: true, gasto_mes_usd: 59.99, gasto_dia_usuario_usd: 59.99, tope_usd_mes: 60 });
    llamada({ costo_usd: 0.02 });
    s = (await ok(evaluarServicio(supabaseAdmin(), ACTOR.id))).api;
    expect(s.motivo).toBe("tope_mensual");
    base.tablas.ia_llamadas.length = 0;
    llamada({ estado: "clave_invalida" });
    expect((await ok(evaluarServicio(supabaseAdmin(), ACTOR.id))).api.motivo).toBe("clave_invalida");
    void cfg;
  });

  it("nunca devuelve la clave: solo el proveedor y los modelos permitidos", async () => {
    sembrarConfig();
    const s = await ok(evaluarServicio(supabaseAdmin(), ACTOR.id));
    expect(JSON.stringify(s.api)).not.toMatch(/key|clave/i);
    expect(s.api).toMatchObject({ proveedor: "openai", modelos_permitidos: ["modelo-a", "modelo-b"] });
  });
});

describe("GET …/ia y POST …/ia/corridas", () => {
  it("con la IA apagada devuelve el estado (no un error) y M7 queda igual", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    const e = await ok(leerEstadoIa(esc.proyeccionId, ACTOR));
    expect(e.servicio).toMatchObject({ disponible: false, motivo: "sin_configuracion" });
    expect(e.gms).toHaveLength(1);
    expect(e.gms[0]).toMatchObject({ gm_clave: CLAVE_GM, genero: "HOMBRE", mundo: "URBANO", estado: "sin_propuesta", es_resto: false });
    expect(e.gms[0].meta).toMatchObject({ meta_gm: 26006, fijas: 3386, meta_libre: 22620, pct: 8, sobre_base: "corregida", fuente: "gm", version: 1 });
    expect(e.prerrequisitos.bloquea).toEqual([]);
    expect(e.prerrequisitos.avisa).toContain("decisiones_y_pendientes");
    expect(e.corrida_en_curso).toBeNull();
  });

  it("con `costo_confirmado_usd: 0` responde 409 `costo_no_confirmado` con la estimación en el cuerpo", async () => {
    iniciar();
    const r = await falla(iniciarCorrida(esc.proyeccionId, { gms: "pendientes", regenerar: false, costo_confirmado_usd: 0 }, ACTOR));
    expect(r.status).toBe(409);
    expect(r.cuerpo.codigo).toBe("costo_no_confirmado");
    expect(r.cuerpo.estimacion).toMatchObject({ gms: 1, llamadas: 2, filas: 3, tope_usd: 10, reusables: 0 });
    expect(r.cuerpo.estimacion?.costo_usd).toBeGreaterThan(0);
    expect(filas("ia_corridas")).toHaveLength(0);
  });

  it("confirmado el costo crea la corrida y sus GM en `pendiente`; una segunda corrida es 409 `corrida_en_curso` (R20)", async () => {
    iniciar();
    const est = (await falla(iniciarCorrida(esc.proyeccionId, { gms: "pendientes", regenerar: false, costo_confirmado_usd: 0 }, ACTOR))).cuerpo.estimacion as Record<string, number>;
    const r = await ok(iniciarCorrida(esc.proyeccionId, { gms: "pendientes", regenerar: false, costo_confirmado_usd: est.costo_usd }, ACTOR));
    expect(r.corrida).toMatchObject({ estado: "en_curso", gm_total: 1, gm_hechos: 0, proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", costo_usd: 0 });
    expect(r.plan).toEqual([{ gm_clave: CLAVE_GM, modo: "directo", llamadas: 2, reusa: false }]);
    expect(filas("ia_corrida_gms")[0]).toMatchObject({ estado: "pendiente", pliegue: "", gm_clave: CLAVE_GM });
    expect(filas("ia_corridas")[0]).toMatchObject({ tipo: "propuesta", anio_en_curso: 2026, k: 9, costo_estimado_usd: est.costo_usd });
    const otra = await falla(iniciarCorrida(esc.proyeccionId, { gms: "todos", regenerar: false, costo_confirmado_usd: 100 }, ACTOR));
    expect(otra.cuerpo.codigo).toBe("corrida_en_curso");
    // Terminar: sin GM hechos queda `parcial`; cancelar, `cancelada`.
    const t = await ok(terminarCorrida(esc.proyeccionId, r.corrida.id, { cancelar: false }));
    expect(t.estado).toBe("parcial");
    expect((await ok(terminarCorrida(esc.proyeccionId, r.corrida.id, { cancelar: true }))).estado).toBe("parcial");
  });

  it("los 409 de arranque: apagada, capacidad, cerrada, método viejo, tope por corrida y GM desconocido", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    const pedir = (extra: Record<string, unknown> = {}) => falla(iniciarCorrida(esc.proyeccionId, { gms: "todos", regenerar: false, costo_confirmado_usd: 100, ...extra } as never, ACTOR));
    expect((await pedir()).cuerpo).toMatchObject({ codigo: "ia_no_disponible", motivo: "sin_configuracion" });
    sembrarConfig({ capacidades: ["distribucion_y1"] });
    const cfg = base.tablas.ia_configuraciones[0];
    cfg.capacidades = [];
    expect((await pedir()).cuerpo.codigo).toBe("ia_no_disponible");
    cfg.capacidades = ["distribucion_y1"];
    base.tablas.proyecciones[0].resumen = { ...(base.tablas.proyecciones[0].resumen as object), version_metodo: VERSION_METODO - 1 };
    expect((await pedir()).cuerpo.codigo).toBe("version_metodo");
    base.tablas.proyecciones[0].resumen = { ...(base.tablas.proyecciones[0].resumen as object), version_metodo: VERSION_METODO };
    cfg.tope_usd_corrida = 0.01;
    expect((await pedir()).cuerpo.codigo).toBe("tope_corrida");
    cfg.tope_usd_corrida = 10;
    expect((await pedir({ gms: [`${GEN_H}.00000000-0000-4000-8000-000000099999`] })).cuerpo.codigo).toBe("gm_no_encontrado");
    base.tablas.proyecciones[0].estado = "cerrada";
    expect((await pedir()).cuerpo.codigo).toBe("cerrada");
  });

  it("una proyección desactualizada por venta nueva no deja generar", async () => {
    iniciar();
    contexto.publicadaAt = "2026-10-20T10:00:00.000Z";
    const r = await falla(iniciarCorrida(esc.proyeccionId, { gms: "todos", regenerar: false, costo_confirmado_usd: 100 }, ACTOR));
    expect(r.cuerpo.codigo).toBe("proyeccion_desactualizada");
  });
});

describe("GET no escribe, costo estimado del servidor y orden de las comprobaciones (QA y seguridad de 0.15.0)", () => {
  it("GET …/ia muestra caducada una corrida sin actividad (en memoria) y no escribe nada; el siguiente POST sí la abandona", async () => {
    const cfg = iniciar();
    sembrarCorrida(esc.proyeccionId, { configuracionId: cfg.id as string, corrida: { ultima_actividad_at: new Date(Date.now() - 31 * 60_000).toISOString() } });
    const foto = () => Object.fromEntries(Object.entries(base.tablas).map(([t, f]) => [t, JSON.stringify(f)]));
    const antes = foto();
    const e = await ok(leerEstadoIa(esc.proyeccionId, ACTOR));
    expect(e.corrida_en_curso).toBeNull();
    const despues = foto();
    expect(Object.keys(despues).filter((t) => despues[t] !== (antes[t] ?? "[]"))).toEqual([]);
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "en_curso", terminada_at: null });

    // Una corrida viva sí se muestra (y tampoco se toca).
    filas("ia_corridas")[0].ultima_actividad_at = new Date().toISOString();
    expect((await ok(leerEstadoIa(esc.proyeccionId, ACTOR))).corrida_en_curso).toMatchObject({ estado: "en_curso" });

    // La mutación ocurre en el POST: iniciar una corrida nueva abandona la caducada.
    filas("ia_corridas")[0].ultima_actividad_at = new Date(Date.now() - 31 * 60_000).toISOString();
    await ok(iniciarCorrida(esc.proyeccionId, { gms: "todos", regenerar: false, costo_confirmado_usd: 100 }, ACTOR));
    expect(filas("ia_corridas")[0]).toMatchObject({ estado: "abandonada" });
    expect(filas("ia_corridas")).toHaveLength(2);
  });

  it("la corrida y la evaluación guardan la estimación del servidor, no lo que manda el cliente", async () => {
    iniciar();
    const est = (await falla(iniciarCorrida(esc.proyeccionId, { gms: "pendientes", regenerar: false, costo_confirmado_usd: 0 }, ACTOR))).cuerpo.estimacion as Record<string, number>;
    expect(est.costo_usd).toBeLessThan(100);
    await ok(iniciarCorrida(esc.proyeccionId, { gms: "pendientes", regenerar: false, costo_confirmado_usd: 100 }, ACTOR));
    expect(Number(filas("ia_corridas")[0].costo_estimado_usd)).toBe(est.costo_usd);
  });

  it("las lecturas del GM y de las filas comprueban el servicio ANTES de cargar la proyección (H7)", async () => {
    const cfg = iniciar();
    void cfg;
    ctxIa.hayClave = false;
    const inexistente = "00000000-0000-4000-8000-0000000fffff";
    // Con la IA apagada la respuesta es 409 de servicio aunque la proyección ni exista: no se leyó nada pesado para llegar a ella.
    expect((await falla(leerGMDetalle(inexistente, CLAVE_GM, ACTOR))).cuerpo).toMatchObject({ codigo: "ia_no_disponible", motivo: "sin_clave" });
    expect((await falla(leerFilasIa(inexistente, {}, ACTOR))).cuerpo).toMatchObject({ codigo: "ia_no_disponible", motivo: "sin_clave" });
    // Con el servicio al día, la misma petición sí llega a la proyección y responde 404.
    ctxIa.hayClave = true;
    expect((await falla(leerGMDetalle(inexistente, CLAVE_GM, ACTOR))).status).toBe(404);
    expect((await falla(leerFilasIa(inexistente, {}, ACTOR))).status).toBe(404);
  });
});

describe("lectura y «Aceptar IA» (R21)", () => {
  it("el reparto vigente suma la meta y las brechas son las del ejemplo A", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const d = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(d.estado).toBe("al_dia");
    expect(d.natural_libres).toBe(22000);
    expect(d.esfuerzo_pct).toBeCloseTo(2.818, 2);
    expect(d.filas.map((f) => f.linea)).toEqual(["CASACA", "POLO", "DENIM", "BUZO"]);
    const libres = d.filas.filter((f) => f.estado_meta === "libre");
    expect(libres.map((f) => [f.linea, f.meta_y1, f.brecha_u, f.contra_metodo_u])).toEqual([["CASACA", 4982, -118, -418], ["POLO", 6677, 77, 197], ["DENIM", 10961, 661, 161]]);
    expect(libres.reduce((s, f) => s + (f.meta_y1 as number), 0)).toBe(22620);
    expect(libres.find((f) => f.linea === "DENIM")?.brecha_pct).toBeCloseTo(6.4, 0);
    expect(libres.find((f) => f.linea === "CASACA")).toMatchObject({ pct_sobre_corregida: expect.closeTo(-0.36, 1), pct_sobre_real: expect.closeTo(24.55, 1) });
    expect(d.filas.find((f) => f.linea === "BUZO")).toMatchObject({ estado_meta: "fija_decidida", meta_y1: null, aceptable: { y1: false } });
    expect(d.contexto.cola_larga).toEqual({ filas: 1, unidades: 86 });
    expect(d.propuesta).toMatchObject({ proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", costo_usd: 0.0526 });
  });

  it("GET …/ia/filas devuelve las filas por fila_id y respeta el filtro de línea", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const todas = await ok(leerFilasIa(esc.proyeccionId, {}, ACTOR));
    expect(todas.filas).toHaveLength(4);
    const linea = Object.values(esc.catalogo.nodos.entries().next().value as [string, { linea_id: string }])[1] as { linea_id: string };
    const una = await ok(leerFilasIa(esc.proyeccionId, { linea_id: linea.linea_id }, ACTOR));
    expect(una.filas).toHaveLength(1);
    const apagada = await falla(leerFilasIa(esc.proyeccionId, {}, ACTOR).then(async () => ((ctxIa.hayClave = false), leerFilasIa(esc.proyeccionId, {}, ACTOR))));
    expect(apagada.cuerpo.codigo).toBe("ia_no_disponible");
  });

  it("acepta a la cifra vigente: decide con origen manual y la traza; las demás libres no cambian; Σ fijas + Σ A = meta", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const antes = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    const denim = antes.filas.find((f) => f.linea === "DENIM")!;
    const r = await ok(aceptarIaFila(esc.proyeccionId, denim.fila_id, { anio: 2027, propuesta_fila_id: denim.propuesta_fila_id, valor_esperado: 10961 }, ACTOR));
    expect(r).toMatchObject({ decidido: 10961, origen: "manual", decision_ia: { propuesta_fila_id: denim.propuesta_fila_id, proveedor: "openai", modelo: "modelo-a", version_prompt: "v1" } });
    const registro = filas("proyeccion_fila_anios").find((a) => a.fila_id === denim.fila_id && a.anio === 2027) as Fila;
    expect(registro).toMatchObject({ decidido: 10961, origen: "manual", decision_ia_fila_id: denim.propuesta_fila_id });
    const despues = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(despues.filas.find((f) => f.linea === "POLO")?.meta_y1).toBe(6677);
    expect(despues.filas.find((f) => f.linea === "CASACA")?.meta_y1).toBe(4982);
    expect(despues.filas.find((f) => f.linea === "DENIM")).toMatchObject({ estado_meta: "fija_decidida", meta_y1: null });
    expect(despues.absorcion?.absorbido_u).toBe(0);
    expect(despues.estado).toBe("al_dia");
  });

  it("los rechazos: valor distinto, fila ajena, fila fija, año y propuesta no vigente", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const d = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    const denim = d.filas.find((f) => f.linea === "DENIM")!;
    const polo = d.filas.find((f) => f.linea === "POLO")!;
    const buzo = d.filas.find((f) => f.linea === "BUZO")!;
    const aceptar = (fila: typeof denim, extra: Record<string, unknown> = {}) => falla(aceptarIaFila(esc.proyeccionId, fila.fila_id, { anio: 2027, propuesta_fila_id: fila.propuesta_fila_id, valor_esperado: fila.meta_y1 ?? 0, ...extra } as never, ACTOR));
    const cambio = await aceptar(denim, { valor_esperado: 10000 });
    expect(cambio).toMatchObject({ status: 409, cuerpo: { codigo: "ia_valor_cambio", valor_actual: 10961 } });
    expect(filas("proyeccion_fila_anios").find((a) => a.fila_id === denim.fila_id && a.anio === 2027)?.decidido).toBeNull();
    expect((await aceptar(denim, { propuesta_fila_id: polo.propuesta_fila_id })).cuerpo.codigo).toBe("ia_fila_ajena");
    expect((await aceptar(buzo)).cuerpo.codigo).toBe("fila_no_libre");
    expect((await aceptar(denim, { anio: 2026 })).cuerpo.codigo).toBe("anio_no_admitido");
    // Una propuesta más reciente deja la anterior como no vigente.
    await generar(cfg.id as string, proveedorEjemploA(), true);
    expect((await aceptar(denim)).cuerpo.codigo).toBe("ia_no_vigente");
    base.tablas.proyecciones[0].estado = "cerrada";
    expect((await aceptar(denim)).cuerpo.codigo).toBe("cerrada");
  });

  it("si cambia la historia (recalculada o con venta nueva) la propuesta queda desactualizada y no se acepta", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const d = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    const denim = d.filas.find((f) => f.linea === "DENIM")!;
    const { vaciarCacheHuellas } = await import("@/lib/ia/contexto-gm");
    vaciarCacheHuellas();
    const fila = filas("proyeccion_filas").find((f) => f.id === denim.fila_id) as Fila;
    ((fila.historico as { anios: { meses: { unidades: number }[] }[] }).anios[0].meses[0]).unidades += 5;
    const hoy = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(hoy).toMatchObject({ estado: "desactualizada", motivos: ["historia_cambiada"] });
    expect(hoy.filas.every((f) => !f.aceptable.y1)).toBe(true);
    const r = await falla(aceptarIaFila(esc.proyeccionId, denim.fila_id, { anio: 2027, propuesta_fila_id: denim.propuesta_fila_id, valor_esperado: 10961 }, ACTOR));
    expect(r.cuerpo.codigo).toBe("ia_desactualizada");
  });

  it("fijar una fila a mano mueve a las demás libres (ejemplo B) y una decisión que no es de la IA limpia la traza", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string, proveedorEjemploA());
    const d = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    const denim = d.filas.find((f) => f.linea === "DENIM")!;
    await ok(decidirFila(esc.proyeccionId, denim.fila_id, 2027, { decidido: 11500, origen: "manual" }, ACTOR));
    const b = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(b.filas.filter((f) => f.estado_meta === "libre").map((f) => [f.linea, f.meta_y1, f.absorbido_u])).toEqual([["CASACA", 4752, -230], ["POLO", 6368, -309]]);
    expect(b.absorcion).toMatchObject({ absorbido_u: -539, delta_meta_u: 0, desviacion_fijadas_u: 11500 - 10961 });
    expect(b.absorcion?.absorbido_pct).toBeCloseTo(4.62, 1);
    expect(b.estado).toBe("al_dia");
    await ok(decidirFila(esc.proyeccionId, denim.fila_id, 2027, { decidido: 12000, origen: "manual" }, ACTOR));
    const h = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(h.estado).toBe("meta_movida");
    expect(h.absorcion?.absorbido_pct).toBeCloseTo(8.91, 1);
    // Fijar de más: las libres quedan sin cifra y el GM avisa.
    await ok(decidirFila(esc.proyeccionId, denim.fila_id, 2027, { decidido: 25000, origen: "manual" }, ACTOR));
    const x = await ok(leerGMDetalle(esc.proyeccionId, CLAVE_GM, ACTOR));
    expect(x.filas.filter((f) => f.estado_meta === "libre").every((f) => f.meta_y1 === null)).toBe(true);
    expect(filas("proyeccion_fila_anios").find((a) => a.fila_id === denim.fila_id && a.anio === 2027)?.decision_ia_fila_id ?? null).toBeNull();
  });
});

describe("configuración (R23), uso y auditoría", () => {
  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    modelo: "modelo-a",
    version_prompt: "v1" as const,
    capacidades: [] as "distribucion_y1"[],
    evaluacion_id: null,
    tope_usd_corrida: 10,
    tope_usd_mes: 60,
    tope_usd_dia_usuario: 15,
    max_filas_llamada: 60,
    incluir_cola_larga: false,
    presupuesto_razonamiento: 0,
    precios: { entrada: 2, entrada_cache: 0.5, salida: 8 },
    terminos_extra: ["Nombre de la Empresa"],
    nota: null,
    version_vigente: null,
    ...extra,
  });
  const evaluacion = (extra: Fila = {}) => sembrarIa("ia_evaluaciones", [{ proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", estado: "completa", parametros: {}, veredicto: { distribucion_y1: "gana", regla_que_fallo: null }, tope_usd: 50, ...extra }])[0];

  it("el proveedor lo pone el servidor y la versión sube; la anterior pasa a `reemplazada`", async () => {
    const a = await ok(guardarConfiguracionIa(cuerpo() as never, ACTOR));
    expect(a).toMatchObject({ version: 1, estado: "vigente", proveedor: "openai", capacidades: [] });
    const b = await ok(guardarConfiguracionIa(cuerpo({ version_vigente: 1, nota: "segunda" }) as never, ACTOR));
    expect(b.version).toBe(2);
    expect(filas("ia_configuraciones").map((c) => [c.version, c.estado])).toEqual([[1, "reemplazada"], [2, "vigente"]]);
    const c = await falla(guardarConfiguracionIa(cuerpo({ version_vigente: 1 }) as never, ACTOR));
    expect(c.cuerpo.codigo).toBe("vigente_cambiada");
    const lectura = await ok(leerConfiguracionIa(ACTOR));
    expect(lectura.vigente?.version).toBe(2);
    expect(lectura.versiones.map((v) => v.version)).toEqual([2, 1]);
    expect(lectura.prompts).toEqual(["v1"]);
    expect(lectura.servicio).toMatchObject({ proveedor: "openai", modelos_permitidos: ["modelo-a", "modelo-b"] });
  });

  it("sin proveedor, con un modelo no permitido y encendiendo sin evaluación, o con una de otro modelo o que no gana: 409", async () => {
    ctxIa.proveedorId = null;
    expect((await falla(guardarConfiguracionIa(cuerpo() as never, ACTOR))).cuerpo.codigo).toBe("sin_proveedor");
    ctxIa.proveedorId = "openai";
    expect((await falla(guardarConfiguracionIa(cuerpo({ modelo: "modelo-z" }) as never, ACTOR))).cuerpo.codigo).toBe("modelo_no_permitido");
    expect((await falla(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"] }) as never, ACTOR))).cuerpo.codigo).toBe("capacidad_sin_evaluacion");
    const otro = evaluacion({ modelo: "modelo-b" });
    expect((await falla(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: otro.id }) as never, ACTOR))).cuerpo.codigo).toBe("evaluacion_otro_modelo");
    const otraProveedor = evaluacion({ proveedor: "anthropic" });
    expect((await falla(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: otraProveedor.id }) as never, ACTOR))).cuerpo.codigo).toBe("evaluacion_otro_modelo");
    const pierde = evaluacion({ veredicto: { distribucion_y1: "no_gana", regla_que_fallo: "mejora" } });
    expect((await falla(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: pierde.id }) as never, ACTOR))).cuerpo.codigo).toBe("evaluacion_no_gana");
    expect(filas("ia_configuraciones")).toHaveLength(0);
  });

  it("encender una capacidad exige al menos un término privado (el nombre de la empresa): 409 `terminos_extra_requeridos`", async () => {
    const e = evaluacion();
    const sin = await falla(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: e.id, terminos_extra: [] }) as never, ACTOR));
    expect(sin).toMatchObject({ status: 409, cuerpo: { codigo: "terminos_extra_requeridos" } });
    expect(String(sin.cuerpo.error)).toMatch(/nombre de la empresa/);
    expect(filas("ia_configuraciones")).toHaveLength(0);
    // Con la IA apagada no se exige; con un término, sí se guarda.
    expect((await ok(guardarConfiguracionIa(cuerpo({ terminos_extra: [] }) as never, ACTOR))).capacidades).toEqual([]);
    const c = await ok(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: e.id, version_vigente: 1 }) as never, ACTOR));
    expect(c.terminos_extra).toEqual(["Nombre de la Empresa"]);
  });

  it("con una evaluación ganadora del mismo proveedor, modelo y prompt enciende la capacidad", async () => {
    const e = evaluacion();
    const c = await ok(guardarConfiguracionIa(cuerpo({ capacidades: ["distribucion_y1"], evaluacion_id: e.id }) as never, ACTOR));
    expect(c).toMatchObject({ capacidades: ["distribucion_y1"], evaluacion_id: e.id, proveedor: "openai" });
    const s = await ok(evaluarServicio(supabaseAdmin(), ACTOR.id));
    expect(s.api).toMatchObject({ disponible: true, evaluacion: { id: e.id, veredicto: { distribucion_y1: "gana" } } });
  });

  it("R34: si producción respondió con un modelo que la evaluación no observó, la configuración lo avisa (sin apagar nada)", async () => {
    const e = evaluacion();
    const cfg = sembrarConfig({ evaluacion_id: e.id });
    const ev = sembrarIa("ia_corridas", [{ tipo: "evaluacion", evaluacion_id: e.id, proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", alcance: {}, costo_estimado_usd: 1, estado: "completa" }])[0];
    const prod = sembrarIa("ia_corridas", [{ tipo: "propuesta", configuracion_id: cfg.id, proveedor: "openai", modelo: "modelo-a", version_prompt: "v1", alcance: {}, costo_estimado_usd: 1 }])[0];
    const gm = sembrarIa("ia_corrida_gms", [{ corrida_id: prod.id, gm_clave: "x" }])[0];
    const llamada = (corrida: Fila, modelo: string) => sembrarIa("ia_llamadas", [{ corrida_id: corrida.id, corrida_gm_id: gm.id, paso: "n1", tipo_llamada: "natural", intento: 1, huella_llamada: "h".repeat(64), bytes_entrada: 1, filas_enviadas: 1, duracion_ms: 1, estado: "ok", modelo_respuesta: modelo }]);
    llamada(ev, "modelo-a-2026-01");
    llamada(prod, "modelo-a-2026-01");
    expect((await ok(leerConfiguracionIa(ACTOR))).avisos).toEqual([]);
    llamada(prod, "modelo-a-2026-09");
    const avisos = (await ok(leerConfiguracionIa(ACTOR))).avisos;
    expect(avisos).toEqual([{ codigo: "modelo_efectivo_distinto", observados: ["modelo-a-2026-01"], produccion: ["modelo-a-2026-01", "modelo-a-2026-09"] }]);
    expect((await ok(evaluarServicio(supabaseAdmin(), ACTOR.id))).api.motivo).toBeNull();
  });

  it("uso del mes: costo por día y corridas, todo derivado de las llamadas", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string);
    const u = await ok(leerUsoIa(undefined));
    expect(u.costo_usd).toBe(0.0526);
    expect(u.tope_usd_mes).toBe(60);
    expect(u.por_dia).toEqual([{ dia: u.por_dia[0].dia, costo_usd: 0.0526, llamadas: 2 }]);
    expect(u.corridas).toHaveLength(1);
    expect(u.corridas[0]).toMatchObject({ gm_hechos: 1, costo_usd: 0.0526 });
    expect((await ok(leerUsoIa("2020-01"))).costo_usd).toBe(0);
  });

  it("la entrada guardada se puede auditar: el JSON canónico descomprimido coincide con su huella", async () => {
    const cfg = iniciar();
    await generar(cfg.id as string);
    const entrada = filas("ia_entradas").find((e) => e.tipo === "bloque") as Fila;
    const a = await ok(leerEntradaIa(entrada.id as string));
    expect(a.huella).toBe(entrada.huella);
    expect(huellaEntrada(a.contenido as never)).toBe(entrada.huella);
    expect(canonico(a.contenido as never).length).toBe(entrada.bytes);
    expect(JSON.stringify(a.contenido)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect((await falla(leerEntradaIa("00000000-0000-4000-8000-00000000ffff"))).status).toBe(404);
  });
});
