import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estado as base, reiniciar, estadoAprobacion, type Fila } from "./aprobacion.fake-db";
import { ROL } from "./ia.fake-db";
import { ctxIa, reiniciarCtxIa } from "./ia.contexto-falso";
import { FILAS_A, sembrarGM, type EscenarioSembrado } from "./ia.escenario";
import { aprobarCrecimientosFalsos, reiniciarContexto } from "./proyeccion.contexto-falso";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./ia.fake-db")).guardIaFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteAprobacionFalso } = await import("./aprobacion.fake-db");
  return { supabaseAdmin: () => clienteAprobacionFalso() };
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
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const RUIDO = ["config_cambiada", "tiendas_cambiadas", "factores_cambiados"];
  return {
    ...real,
    desactualizadaDe: async (...args: Parameters<typeof real.desactualizadaDe>) => {
      const r = await real.desactualizadaDe(...args);
      return r.respuesta ? r : { data: r.data.filter((m) => !RUIDO.includes(m.codigo)), respuesta: null };
    },
  };
});
vi.mock("@/lib/ia/entorno", async () => ({ leerEntornoIa: (await import("./ia.contexto-falso")).entornoFalso }));
vi.mock("@/lib/ia/proveedores", async () => ({ adaptadorDelEntorno: (await import("./ia.contexto-falso")).adaptadorFalso, proveedoresRegistrados: () => ["openai"] }));

import { GET as aprobacion } from "@/app/api/proyeccion/proyecciones/[id]/aprobacion/route";
import { GET as listarLotes, POST as postLote } from "@/app/api/proyeccion/proyecciones/[id]/aprobacion/lotes/route";
import { GET as leerLote } from "@/app/api/proyeccion/proyecciones/[id]/aprobacion/lotes/[loteId]/route";
import { POST as revertir } from "@/app/api/proyeccion/proyecciones/[id]/aprobacion/lotes/[loteId]/revertir/route";
import { POST as revertirConfirmacion } from "@/app/api/proyeccion/proyecciones/[id]/aprobacion/confirmaciones/[confirmacionId]/revertir/route";
import type { AprobacionApi, LoteApi, ResultadoLoteApi } from "@/lib/aprobacion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion/proyecciones";
const get = (ruta: string) => new NextRequest(`${URL_BASE}${ruta}`);
const enviar = (ruta: string, cuerpo: unknown = {}) => new NextRequest(`${URL_BASE}${ruta}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (extra: Record<string, string>) => ({ params: Promise.resolve(extra) }) as never;
const INEXISTENTE = "00000000-0000-4000-8000-0000000fffff";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const filas = (t: string): Fila[] => base.tablas[t] ?? [];
let esc: EscenarioSembrado;

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  reiniciarCtxIa();
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
  ROL.actual = "planner";
  esc = sembrarGM(FILAS_A);
  ctxIa.catalogo = esc.catalogo;
});

const id = () => esc.proyeccionId;
const ruta = (extra = "") => `/${id()}/aprobacion${extra}`;

describe("R18 · permisos", () => {
  it("sin sesión 401 y comprador 403 en las seis rutas, sin tocar la base; con planner, sin caché", async () => {
    for (const rol of ["sin_sesion", "comprador"] as const) {
      ROL.actual = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      const p = ctx({ id: id(), loteId: uuid(1), confirmacionId: uuid(2) });
      expect((await aprobacion(get(`${ruta()}?anio=2027`), p)).status).toBe(esperado);
      expect((await listarLotes(get(ruta("/lotes")), p)).status).toBe(esperado);
      expect((await postLote(enviar(ruta("/lotes"), {}), p)).status).toBe(esperado);
      expect((await leerLote(get(ruta(`/lotes/${uuid(1)}`)), p)).status).toBe(esperado);
      expect((await revertir(enviar(ruta(`/lotes/${uuid(1)}/revertir`), {}), p)).status).toBe(esperado);
      expect((await revertirConfirmacion(enviar(ruta(`/confirmaciones/${uuid(2)}/revertir`), {}), p)).status).toBe(esperado);
    }
    expect(estadoAprobacion.llamadas).toBe(0);
    ROL.actual = "planner";
    const r = await aprobacion(get(`${ruta()}?anio=2027`), ctx({ id: id() }));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("la proyección inexistente o un id mal formado responde 404", async () => {
    expect((await aprobacion(get(`/${INEXISTENTE}/aprobacion?anio=2027`), ctx({ id: INEXISTENTE }))).status).toBe(404);
    expect((await aprobacion(get("/x/aprobacion?anio=2027"), ctx({ id: "no-es-uuid" }))).status).toBe(404);
    expect((await leerLote(get(ruta("/lotes/x")), ctx({ id: id(), loteId: "no-es-uuid" }))).status).toBe(404);
    expect((await leerLote(get(ruta(`/lotes/${INEXISTENTE}`)), ctx({ id: id(), loteId: INEXISTENTE }))).status).toBe(404);
    expect((await revertir(enviar(ruta(`/lotes/${INEXISTENTE}/revertir`), { lote_id: uuid(9) }), ctx({ id: id(), loteId: INEXISTENTE }))).status).toBe(404);
  });
});

describe("GET …/aprobacion", () => {
  it("valida la consulta (400) y el año (409 `anio_no_admitido`)", async () => {
    const p = ctx({ id: id() });
    expect((await aprobacion(get(`${ruta()}`), p)).status).toBe(400);
    expect((await aprobacion(get(`${ruta()}?anio=abc`), p)).status).toBe(400);
    expect((await aprobacion(get(`${ruta()}?anio=2027&modo=otro`), p)).status).toBe(400);
    expect((await aprobacion(get(`${ruta()}?anio=2027&extra=1`), p)).status).toBe(400);
    const r = await aprobacion(get(`${ruta()}?anio=2031`), p);
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("anio_no_admitido");
  });

  it("devuelve las filas, los GM y los pendientes; `reaprobables` viaja en los dos modos", async () => {
    const p = ctx({ id: id() });
    for (const modo of ["aprobar", "reaprobar"]) {
      const a = (await leer<AprobacionApi>(await aprobacion(get(`${ruta()}?anio=2027&modo=${modo}`), p))).data;
      expect(a).toMatchObject({ anio: 2027, anio_en_curso: 2026, modo, reaprobables: { y: 0, y1: 0 }, ia: { disponible: false } });
    }
    const a = (await leer<AprobacionApi>(await aprobacion(get(`${ruta()}?anio=2027`), p))).data;
    expect(a.filas.map((f) => f.linea).sort()).toEqual(["CASACA", "DENIM", "POLO"]);
    expect(a.pendientes_cierre.filas_y1).toBe(3);
  });
});

describe("POST …/lotes y revertir", () => {
  async function cuerpo(extra: Record<string, unknown> = {}) {
    const a = (await leer<AprobacionApi>(await aprobacion(get(`${ruta()}?anio=2027`), ctx({ id: id() })))).data;
    return {
      lote_id: uuid(101),
      confirmacion_id: uuid(201),
      anio: 2027,
      filas: a.filas.map((f) => ({ fila_id: f.fila_id, fuente: "metodo", valor_esperado: f.metodo.valor })),
      ...extra,
    };
  }
  const post = (c: unknown) => postLote(enviar(ruta("/lotes"), c), ctx({ id: id() }));

  it("R15 · cuerpos inválidos: 301 filas, fila repetida, sin huella al aplicar, «ia» sin propuesta, «metodo» con ella", async () => {
    const c = await cuerpo();
    const f = c.filas[0];
    expect((await post({ ...c, simular: true, filas: Array.from({ length: 301 }, (_, i) => ({ ...f, fila_id: uuid(1000 + i) })) })).status).toBe(400);
    expect((await post({ ...c, simular: true, filas: [f, f] })).status).toBe(400);
    expect((await post({ ...c, filas: [f] })).status).toBe(400);
    expect((await post({ ...c, simular: true, filas: [{ ...f, fuente: "ia" }] })).status).toBe(400);
    expect((await post({ ...c, simular: true, filas: [{ ...f, propuesta_fila_id: uuid(5) }] })).status).toBe(400);
    expect((await post({ ...c, simular: true, tipo: "reaprobar" })).status).toBe(400);
    expect((await post({ ...c, simular: true, desconocido: 1 })).status).toBe(400);
    expect(estadoAprobacion.llamadas).toBe(0);
  });

  it("simular responde 200 sin escribir; aplicar, 201; el reintento, 200 `repetido`; revertir, 201 y la historia lo refleja", async () => {
    const c = await cuerpo();
    const sim = await post({ ...c, simular: true });
    expect(sim.status).toBe(200);
    const s = (await leer<ResultadoLoteApi>(sim)).data;
    expect(s).toMatchObject({ simulado: true, lote: null });
    expect(estadoAprobacion.llamadas).toBe(0);
    const real = { ...c, huella_simulacion: s.huella_simulacion, revision_confirmada: true };
    const r1 = await post(real);
    expect(r1.status).toBe(201);
    const l1 = (await leer<ResultadoLoteApi>(r1)).data;
    expect(l1.lote?.id).toBe(c.lote_id);
    const r2 = await post(real);
    expect(r2.status).toBe(200);
    expect((await leer<ResultadoLoteApi>(r2)).data.repetido).toBe(true);
    expect(filas("proyeccion_lotes")).toHaveLength(1);

    const lista = (await leer<{ lotes: LoteApi[] }>(await listarLotes(get(ruta("/lotes")), ctx({ id: id() })))).data;
    expect(lista.lotes).toHaveLength(1);
    const uno = (await leer<LoteApi & { filas: unknown[] }>(await leerLote(get(ruta(`/lotes/${c.lote_id}`)), ctx({ id: id(), loteId: c.lote_id })))).data;
    expect(uno.filas).toHaveLength(3);

    const loteRev = uuid(102);
    expect((await revertir(enviar(ruta(`/lotes/${c.lote_id}/revertir`), { lote_id: loteRev, simular: true }), ctx({ id: id(), loteId: c.lote_id }))).status).toBe(200);
    const rev = await revertir(enviar(ruta(`/lotes/${c.lote_id}/revertir`), { lote_id: loteRev }), ctx({ id: id(), loteId: c.lote_id }));
    expect(rev.status).toBe(201);
    expect((await leer<ResultadoLoteApi>(rev)).data.totales.aplicadas).toBe(3);
    // Una reversión no se revierte.
    const otra = await revertir(enviar(ruta(`/lotes/${loteRev}/revertir`), { lote_id: uuid(103) }), ctx({ id: id(), loteId: loteRev }));
    expect(otra.status).toBe(409);
    expect((await leer(otra)).codigo).toBe("no_revertible");
  });

  it("revertir una confirmación: 400 si faltan identificadores; 201 con un resultado por tanda aplicada", async () => {
    const c = await cuerpo();
    const sim = (await leer<ResultadoLoteApi>(await post({ ...c, simular: true }))).data;
    await post({ ...c, huella_simulacion: sim.huella_simulacion, revision_confirmada: true });
    const p = ctx({ id: id(), confirmacionId: c.confirmacion_id });
    expect((await revertirConfirmacion(enviar(ruta(`/confirmaciones/${c.confirmacion_id}/revertir`), { lote_ids: [uuid(301), uuid(302)] }), p)).status).toBe(400);
    const r = await revertirConfirmacion(enviar(ruta(`/confirmaciones/${c.confirmacion_id}/revertir`), { lote_ids: [uuid(301)] }), p);
    expect(r.status).toBe(201);
    expect((await leer<ResultadoLoteApi[]>(r)).data).toHaveLength(1);
    expect((await revertirConfirmacion(enviar(ruta(`/confirmaciones/${uuid(7)}/revertir`), { lote_ids: [uuid(303)] }), ctx({ id: id(), confirmacionId: uuid(7) }))).status).toBe(404);
  });
});
