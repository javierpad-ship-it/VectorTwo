import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estado as base, reiniciar, ProveedorDinamico, ROL } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa, sembrarCorrida } from "./ia.contexto-falso";
import { CLAVE_GM, sembrarConfig, sembrarGM, type EscenarioSembrado } from "./ia.escenario";
import { aprobarCrecimientosFalsos, reiniciarContexto } from "./proyeccion.contexto-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./ia.fake-db")).guardIaFalso());
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

import { GET as estadoIa } from "@/app/api/proyeccion/proyecciones/[id]/ia/route";
import { POST as iniciarCorrida } from "@/app/api/proyeccion/proyecciones/[id]/ia/corridas/route";
import { POST as pasoCorrida } from "@/app/api/proyeccion/proyecciones/[id]/ia/corridas/[corridaId]/gm/[clave]/paso/route";
import { POST as terminarCorrida } from "@/app/api/proyeccion/proyecciones/[id]/ia/corridas/[corridaId]/terminar/route";
import { GET as detalleGM } from "@/app/api/proyeccion/proyecciones/[id]/ia/gm/[clave]/route";
import { GET as filasIa } from "@/app/api/proyeccion/proyecciones/[id]/ia/filas/route";
import { POST as aceptarIa } from "@/app/api/proyeccion/proyecciones/[id]/ia/filas/[filaId]/aceptar/route";
import { GET as leerConfig, POST as guardarConfig } from "@/app/api/ia/configuracion/route";
import { GET as listarEvaluaciones, POST as crearEvaluacion } from "@/app/api/ia/evaluaciones/route";
import { GET as leerEvaluacion } from "@/app/api/ia/evaluaciones/[id]/route";
import { POST as cancelarEvaluacion } from "@/app/api/ia/evaluaciones/[id]/cancelar/route";
import { POST as prepararPliegue } from "@/app/api/ia/evaluaciones/[id]/pliegues/[pliegue]/preparar/route";
import { POST as pasoEvaluacion } from "@/app/api/ia/evaluaciones/[id]/gm/[clave]/paso/route";
import { GET as uso } from "@/app/api/ia/uso/route";
import { GET as entrada } from "@/app/api/ia/entradas/[id]/route";

const U = "http://localhost/api";
const get = (ruta: string) => new NextRequest(`${U}${ruta}`);
const enviar = (ruta: string, cuerpo: unknown = {}) => new NextRequest(`${U}${ruta}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;
const leer = async (r: Response) => (await r.json()) as { data?: unknown; error?: string; codigo?: string; estimacion?: Record<string, number> } & Record<string, unknown>;
const ID = "00000000-0000-4000-8000-0000000000aa";
let esc: EscenarioSembrado;

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  reiniciarCtxIa();
  ctxIa.proveedor = new ProveedorDinamico();
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
  ROL.actual = "planner";
});

/** Cada ruta con una llamada válida, para probar los guards sin depender de los datos. */
const PLANIFICACION: [string, () => Promise<Response>][] = [
  ["GET …/ia", () => estadoIa(get(`/proyeccion/proyecciones/${ID}/ia`), ctx({ id: ID }))],
  ["POST …/ia/corridas", () => iniciarCorrida(enviar("/x", { gms: "todos", costo_confirmado_usd: 0 }), ctx({ id: ID }))],
  ["POST …/paso", () => pasoCorrida(enviar("/x", {}), ctx({ id: ID, corridaId: ID, clave: CLAVE_GM }))],
  ["POST …/terminar", () => terminarCorrida(enviar("/x", {}), ctx({ id: ID, corridaId: ID }))],
  ["GET …/ia/gm/[clave]", () => detalleGM(get("/x"), ctx({ id: ID, clave: CLAVE_GM }))],
  ["GET …/ia/filas", () => filasIa(get("/x"), ctx({ id: ID }))],
  ["POST …/aceptar", () => aceptarIa(enviar("/x", { anio: 2027, propuesta_fila_id: ID, valor_esperado: 1 }), ctx({ id: ID, filaId: ID }))],
];
const ADMIN: [string, () => Promise<Response>][] = [
  ["GET configuracion", () => leerConfig()],
  ["POST configuracion", () => guardarConfig(enviar("/x", {}))],
  ["GET evaluaciones", () => listarEvaluaciones()],
  ["POST evaluaciones", () => crearEvaluacion(enviar("/x", {}))],
  ["GET evaluaciones/[id]", () => leerEvaluacion(get("/x"), ctx({ id: ID }))],
  ["POST cancelar", () => cancelarEvaluacion(enviar("/x"), ctx({ id: ID }))],
  ["POST preparar", () => prepararPliegue(enviar("/x", {}), ctx({ id: ID, pliegue: "D25" }))],
  ["POST evaluaciones paso", () => pasoEvaluacion(enviar("/x", { pliegue: "D25" }), ctx({ id: ID, clave: CLAVE_GM }))],
  ["GET uso", () => uso(get("/api/ia/uso"))],
  ["GET entradas/[id]", () => entrada(get("/x"), ctx({ id: ID }))],
];

describe("permisos (R18)", () => {
  it.each(PLANIFICACION)("%s: sin sesión 401 y el comprador 403", async (_n, llamar) => {
    ROL.actual = "sin_sesion";
    expect((await llamar()).status).toBe(401);
    ROL.actual = "comprador";
    expect((await llamar()).status).toBe(403);
  });

  it.each(ADMIN)("%s: sin sesión 401; el comprador y el planner 403", async (_n, llamar) => {
    ROL.actual = "sin_sesion";
    expect((await llamar()).status).toBe(401);
    ROL.actual = "comprador";
    expect((await llamar()).status).toBe(403);
    ROL.actual = "planner";
    expect((await llamar()).status).toBe(403);
  });

  it("los rechazos por rol no tocan la base ni llaman al proveedor", async () => {
    ROL.actual = "comprador";
    for (const [, llamar] of [...PLANIFICACION, ...ADMIN]) await llamar();
    expect(Object.keys(base.tablas).filter((t) => t.startsWith("ia_"))).toEqual([]);
    expect((ctxIa.proveedor as ProveedorDinamico).llamadas).toBe(0);
  });

  it("el admin también puede las rutas del planner", async () => {
    ROL.actual = "admin";
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    expect((await estadoIa(get("/x"), ctx({ id: esc.proyeccionId }))).status).toBe(200);
  });
});

describe("formas de respuesta", () => {
  it("GET …/ia → { data: EstadoIaProyeccionApi }; un id mal formado es 404", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    const r = await estadoIa(get("/x"), ctx({ id: esc.proyeccionId }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const { data } = (await leer(r)) as { data: Record<string, unknown> };
    expect(Object.keys(data).sort()).toEqual(["corrida_en_curso", "estimacion_pendientes", "gms", "prerrequisitos", "servicio"]);
    expect((await estadoIa(get("/x"), ctx({ id: "no-es-uuid" }))).status).toBe(404);
  });

  it("POST …/ia/corridas con costo 0 → 409 costo_no_confirmado + estimacion; confirmado → 201 con { corrida, plan, estimacion }", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    sembrarConfig();
    const sin = await iniciarCorrida(enviar("/x", { gms: "pendientes", costo_confirmado_usd: 0 }), ctx({ id: esc.proyeccionId }));
    expect(sin.status).toBe(409);
    const cuerpo = await leer(sin);
    expect(cuerpo.codigo).toBe("costo_no_confirmado");
    expect(Object.keys(cuerpo.estimacion ?? {}).sort()).toEqual(["costo_usd", "filas", "gms", "llamadas", "reusables", "tokens_entrada", "tokens_salida", "tope_usd"]);
    const ok = await iniciarCorrida(enviar("/x", { gms: "pendientes", costo_confirmado_usd: cuerpo.estimacion?.costo_usd }), ctx({ id: esc.proyeccionId }));
    expect(ok.status).toBe(201);
    const { data } = (await leer(ok)) as { data: { corrida: { id: string }; plan: unknown[]; estimacion: unknown } };
    expect(Object.keys(data).sort()).toEqual(["corrida", "estimacion", "plan"]);
    expect(data.plan).toEqual([{ gm_clave: CLAVE_GM, modo: "directo", llamadas: 2, reusa: false }]);

    // Cuerpos inválidos: zod con mensaje en castellano.
    const mal = await iniciarCorrida(enviar("/x", { gms: "algunos", costo_confirmado_usd: 1 }), ctx({ id: esc.proyeccionId }));
    expect(mal.status).toBe(400);
    expect((await leer(mal)).error).toMatch(/pendientes|todos/);
    const extra = await iniciarCorrida(enviar("/x", { gms: "todos", costo_confirmado_usd: 1, otro: 1 }), ctx({ id: esc.proyeccionId }));
    expect(extra.status).toBe(400);

    // Paso: 200 con PasoGMApi; terminar: 200 con CorridaApi.
    const paso = await pasoCorrida(enviar("/x", {}), ctx({ id: esc.proyeccionId, corridaId: data.corrida.id, clave: CLAVE_GM }));
    expect(paso.status).toBe(200);
    const p = ((await leer(paso)) as { data: Record<string, unknown> }).data;
    expect(Object.keys(p).sort()).toEqual(["corrida", "esperar_ms", "estado", "gm_clave", "pasos_hechos", "pasos_total", "pliegue", "siguiente"]);
    expect(p).toMatchObject({ pliegue: null, estado: "en_proceso", siguiente: "continuar" });
    const fin = await terminarCorrida(enviar("/x", { cancelar: true }), ctx({ id: esc.proyeccionId, corridaId: data.corrida.id }));
    expect(((await leer(fin)) as { data: { estado: string } }).data.estado).toBe("cancelada");
    expect((await pasoCorrida(enviar("/x", {}), ctx({ id: esc.proyeccionId, corridaId: data.corrida.id, clave: CLAVE_GM }))).status).toBe(409);
  });

  it("GET …/ia/gm/[clave] y …/ia/filas con IA apagada: 409 con código; GM inexistente: 404", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    const apagada = await detalleGM(get("/x"), ctx({ id: esc.proyeccionId, clave: CLAVE_GM }));
    expect(apagada.status).toBe(409);
    expect((await leer(apagada)).codigo).toBe("ia_no_disponible");
    sembrarConfig();
    expect((await detalleGM(get("/x"), ctx({ id: esc.proyeccionId, clave: "nada" }))).status).toBe(404);
    const d = await detalleGM(get("/x"), ctx({ id: esc.proyeccionId, clave: CLAVE_GM }));
    expect(d.status).toBe(200);
    expect(((await leer(d)) as { data: { estado: string } }).data.estado).toBe("sin_propuesta");
    const f = await filasIa(get("/x?linea_id=no-uuid"), ctx({ id: esc.proyeccionId }));
    expect(f.status).toBe(400);
    expect(((await leer(await filasIa(get("/x"), ctx({ id: esc.proyeccionId })))) as { data: { filas: unknown[] } }).data.filas).toEqual([]);
  });

  it("POST …/aceptar valida el cuerpo (zod estricto) antes de tocar nada", async () => {
    esc = sembrarGM();
    ctxIa.catalogo = esc.catalogo;
    const r = await aceptarIa(enviar("/x", { anio: 2027, propuesta_fila_id: "no-uuid", valor_esperado: 1 }), ctx({ id: esc.proyeccionId, filaId: esc.filaIds[0] }));
    expect(r.status).toBe(400);
    const s = await aceptarIa(enviar("/x", { anio: 2027, propuesta_fila_id: ID, valor_esperado: -1 }), ctx({ id: esc.proyeccionId, filaId: esc.filaIds[0] }));
    expect(s.status).toBe(400);
  });

  it("configuración: GET devuelve { vigente, versiones, servicio, prompts }; POST guarda con 201", async () => {
    ROL.actual = "admin";
    const g = ((await leer(await leerConfig())) as { data: Record<string, unknown> }).data;
    expect(Object.keys(g).sort()).toEqual(["avisos", "prompts", "servicio", "versiones", "vigente"]);
    expect(g.vigente).toBeNull();
    const cuerpo = { modelo: "modelo-a", version_prompt: "v1", capacidades: [], evaluacion_id: null, tope_usd_corrida: 10, tope_usd_mes: 60, tope_usd_dia_usuario: 15, max_filas_llamada: 60, incluir_cola_larga: false, presupuesto_razonamiento: 0, precios: { entrada: 2, entrada_cache: 0.5, salida: 8 }, terminos_extra: [], version_vigente: null };
    const ok = await guardarConfig(enviar("/x", cuerpo));
    expect(ok.status).toBe(201);
    expect(((await leer(ok)) as { data: { proveedor: string; version: number } }).data).toMatchObject({ proveedor: "openai", version: 1 });
    // El cuerpo no admite `proveedor`: lo pone el servidor.
    expect((await guardarConfig(enviar("/x", { ...cuerpo, proveedor: "otro", version_vigente: 1 }))).status).toBe(400);
    // La entrada en caché no puede costar más que la entrada normal; puede ser 0.
    expect((await guardarConfig(enviar("/x", { ...cuerpo, precios: { entrada: 2, entrada_cache: 5, salida: 8 }, version_vigente: 1 }))).status).toBe(400);
    expect((await guardarConfig(enviar("/x", { ...cuerpo, precios: { entrada: 2, entrada_cache: 0, salida: 8 }, version_vigente: 1 }))).status).toBe(201);
  });

  it("uso y entradas: formas y 404", async () => {
    ROL.actual = "admin";
    const u = ((await leer(await uso(get("/api/ia/uso?mes=2026-10")))) as { data: Record<string, unknown> }).data;
    expect(Object.keys(u).sort()).toEqual(["corridas", "costo_usd", "mes", "por_dia", "tope_usd_mes"]);
    expect((await uso(get("/api/ia/uso?mes=2026-13"))).status).toBe(400);
    expect((await entrada(get("/x"), ctx({ id: ID }))).status).toBe(404);
    expect((await entrada(get("/x"), ctx({ id: "no" }))).status).toBe(404);
    void sembrarCorrida;
  });
});
