import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { escenario, tablaDe, PERFILES } from "./compras.fake-db";
import { entrarComo, escriturasAgr, estadoRepartos, iniciarAgrupadores, llamadasRpc, reemplazos } from "./agrupadores.fake-db";

// Los módulos de la base y de las fuentes se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./compras.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteAgrupadores } = await import("./agrupadores.fake-db");
  return { supabaseAdmin: () => clienteAgrupadores() };
});
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerCerradaParaFlujo: async (anio: number) => ({ data: falso.cerradaFalsa(anio), respuesta: null }) };
});
vi.mock("@/lib/marcas-barrer/servicio", async (original) => {
  const real = await original<typeof import("@/lib/marcas-barrer/servicio")>();
  const falso = await import("./compras.fake-db");
  const mio = await import("./agrupadores.fake-db");
  return {
    ...real,
    leerRepartosVigentes: async () => ({ data: falso.repartosVigentesFalsos(), respuesta: null }),
    leerRepartosPorId: async (_d: unknown, ids: string[]) => ({ data: ids.length === 0 ? [] : [mio.repartoV2(mio.estadoRepartos.sinInvierno)], respuesta: null }),
  };
});
vi.mock("@/lib/intercompany/servicio", async (original) => {
  const real = await original<typeof import("@/lib/intercompany/servicio")>();
  return { ...real, leerVigentes: async () => ({ data: { reglas: [], marcas: [] }, respuesta: null }) };
});
vi.mock("@/lib/marcas/gml/estado", async () => {
  const falso = await import("./compras.fake-db");
  return { cargarEstadoGml: async () => ({ error: null, ...falso.estadoGmlFalso() }) };
});
vi.mock("@/lib/arbol/consultas", async (original) => {
  const real = await original<typeof import("@/lib/arbol/consultas")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerEquivalencias: async () => ({ data: falso.equivalenciasDelEscenario(), error: null }) };
});
vi.mock("@/lib/responsables/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return {
    leerAsignaciones: async () => ({ data: falso.escenario.asignaciones.map((a, i) => ({ id: `asig-${i}`, ...a })), error: null }),
    leerPerfiles: async () => ({ data: [], error: null }),
  };
});
vi.mock("@/lib/tiendas/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return { leerTiendas: async () => ({ data: falso.tiendasFalsas(), error: null }) };
});
vi.mock("@/lib/proyeccion/contexto", async () => ({
  cargarContextoCalculo: async () => ({ data: { nodos: [], vigentes: [], agrupaciones: [], periodosClase: [], factores: [], hastaDefecto: "2026-09" }, respuesta: null }),
}));

import { GET as listaViajes, POST as crearViaje } from "@/app/api/compras/viajes/route";
import { GET as unViaje, PATCH as editarViaje } from "@/app/api/compras/viajes/[id]/route";
import { POST as estadoViaje } from "@/app/api/compras/viajes/[id]/estado/route";
import { POST as comprasDeViaje } from "@/app/api/compras/viajes/[id]/compras/route";
import { GET as listaEmbarques, POST as crearEmbarque } from "@/app/api/compras/embarques/route";
import { GET as unEmbarque, PATCH as editarEmbarque } from "@/app/api/compras/embarques/[id]/route";
import { POST as estadoEmbarque } from "@/app/api/compras/embarques/[id]/estado/route";
import { POST as crearPaquete } from "@/app/api/compras/embarques/[id]/paquetes/route";
import { PATCH as editarPaquete } from "@/app/api/compras/paquetes/[id]/route";
import { POST as estadoPaquete } from "@/app/api/compras/paquetes/[id]/estado/route";
import { POST as moverPaquete } from "@/app/api/compras/paquetes/[id]/mover/route";
import { POST as asignar } from "@/app/api/compras/embarques/[id]/asignar/route";
import { POST as quitar } from "@/app/api/compras/embarques/[id]/quitar/route";
import { POST as aPaquete } from "@/app/api/compras/embarques/[id]/paquete/route";
import { POST as cambiarFecha } from "@/app/api/compras/embarques/[id]/fecha/route";
import { POST as cambiarFechas } from "@/app/api/compras/embarques/[id]/fechas/route";
import { POST as ingresoPaquete } from "@/app/api/compras/paquetes/[id]/ingreso/route";
import { POST as pasarPendientes } from "@/app/api/compras/embarques/[id]/pasar-pendientes/route";
import { GET as opciones } from "@/app/api/compras/agrupadores/opciones/route";
import { GET as sinAsignar } from "@/app/api/compras/agrupadores/sin-asignar/route";
import { GET as historial } from "@/app/api/compras/agrupadores/historial/route";
import { POST as importarAgrupadores } from "@/app/api/compras/agrupadores/importar/route";
import { PUT as viajeActivo } from "@/app/api/compras/viaje-activo/route";
import { POST as importarCompras } from "@/app/api/compras/importar/route";
import { describirErrorDb } from "@/lib/api/errores-db";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { listarCompras, reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { comprasQuerySchema } from "@/lib/compras/esquemas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  EmbarqueApi,
  EmbarqueDetalleApi,
  OpcionesAgrupadoresApi,
  PlanFechasApi,
  PlanMovimientoApi,
  ReporteImportacionAgrupadoresApi,
  RespuestaAsignarViajeApi,
  RespuestaMovimientoApi,
  RespuestaViajesApi,
  SinAgrupadorApi,
  ViajeApi,
  ViajeDetalleApi,
} from "@/lib/compras/agrupadores/tipos-api";
import type { ReporteImportacionComprasApi } from "@/lib/compras/tipos-api";
import { filasImportacionEjemplo } from "./compras.fixture";
import {
  ASIGNACION_AGR,
  COMPRA_AGR,
  EMBARQUE_AGR,
  ENTREGA_AGR,
  LINEA_AGR,
  PAQUETE_AGR,
  PERFIL_AGR,
  VIAJE_AGR,
  archivoAgrupadores19b,
  archivoAgrupadores19c,
} from "./agrupadores.fixture";

/**
 * Handlers de 08b-1 (T3b) con el servicio REAL y una base en memoria (`tests/agrupadores.fake-db.ts`; la `0032` está aplicada en Vector2 solo a
 * medias, así que nada de aquí depende de ella): R15 (permisos por rol y por acción), R16 (solo `rpc`, ver la prueba estática), R17 a R19
 * (concurrencia: `agrupador_cambio`, `compra_cambio`, reintento solo con la huella idéntica), R21 (columnas de agrupador del importador de
 * compras), R22 (la cookie), R23 (IDOR) y los casos 1 a 19c de la ficha. La base falsa simula las funciones con los espejos puros de
 * `src/lib/compras/agrupadores`; el humo de SQL lo prueba la base.
 */

const URL_BASE = "http://localhost/api";
const get = (ruta: string, consulta = "", cabeceras: Record<string, string> = {}) => new NextRequest(`${URL_BASE}${ruta}${consulta}`, { headers: cabeceras });
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const E = EMBARQUE_AGR;
const fila = (t: string, id: unknown) => tablaDe(t).find((f) => f.id === id);
const compraPorNumero = (n: string) => tablaDe("compras").find((c) => c.numero === n)!;
const revisionEmbarque = (id: string) => Number(fila("compra_embarques", id)?.revision);
const revisionCompra = (id: string) => Number(fila("compras", id)?.revision);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  iniciarAgrupadores();
  entrarComo("c1");
  reiniciarCaches();
  reiniciarCacheCatalogo();
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Atajos de las llamadas ───

const asignarItems = (embarque: string, cuerpo: Record<string, unknown>, consulta = "") => asignar(enviar("POST", `/compras/embarques/${embarque}/asignar${consulta}`, cuerpo), ctx(embarque));
const fechaDe = (embarque: string, cuerpo: Record<string, unknown>, consulta = "") => cambiarFecha(enviar("POST", `/compras/embarques/${embarque}/fecha${consulta}`, cuerpo), ctx(embarque));
const fechasDe = (embarque: string, cuerpo: Record<string, unknown>, consulta = "") => cambiarFechas(enviar("POST", `/compras/embarques/${embarque}/fechas${consulta}`, cuerpo), ctx(embarque));
const ingresoDe = (paquete: string, cuerpo: Record<string, unknown>, consulta = "") => ingresoPaquete(enviar("POST", `/compras/paquetes/${paquete}/ingreso${consulta}`, cuerpo), ctx(paquete));
const quitarDe = (embarque: string, cuerpo: Record<string, unknown>, consulta = "") => quitar(enviar("POST", `/compras/embarques/${embarque}/quitar${consulta}`, cuerpo), ctx(embarque));

/** Las asignaciones del caso 1 ya hechas: l1 nov 300 → 261101 / paquete 261101 y dic 200 → 261201. */
const conCaso1 = () => iniciarAgrupadores({ caso1: true });

// ─── R15: sesión y rol ───

describe("permisos (R15): sesión, comprador que escribe y lo que solo hacen admin y planner", () => {
  const todas = () => [
    () => listaViajes(get("/compras/viajes")),
    () => unViaje(get("/x"), ctx(VIAJE_AGR.v261001)),
    () => listaEmbarques(get("/compras/embarques")),
    () => unEmbarque(get("/x"), ctx(E.e261101)),
    () => opciones(),
    () => sinAsignar(get("/compras/agrupadores/sin-asignar")),
    () => historial(get("/compras/agrupadores/historial", `?viaje_id=${VIAJE_AGR.v261001}`)),
    () => crearViaje(enviar("POST", "/compras/viajes")),
    () => editarViaje(enviar("PATCH", "/x"), ctx(VIAJE_AGR.v261001)),
    () => estadoViaje(enviar("POST", "/x"), ctx(VIAJE_AGR.v261001)),
    () => comprasDeViaje(enviar("POST", "/x"), ctx(VIAJE_AGR.v261001)),
    () => crearEmbarque(enviar("POST", "/compras/embarques")),
    () => editarEmbarque(enviar("PATCH", "/x"), ctx(E.e261101)),
    () => estadoEmbarque(enviar("POST", "/x"), ctx(E.e261101)),
    () => crearPaquete(enviar("POST", "/x"), ctx(E.e261101)),
    () => editarPaquete(enviar("PATCH", "/x"), ctx(PAQUETE_AGR.p261101)),
    () => estadoPaquete(enviar("POST", "/x"), ctx(PAQUETE_AGR.p261101)),
    () => moverPaquete(enviar("POST", "/x"), ctx(PAQUETE_AGR.p261101)),
    () => asignarItems(E.e261101, {}),
    () => quitarDe(E.e261101, {}),
    () => aPaquete(enviar("POST", "/x"), ctx(E.e261101)),
    () => fechaDe(E.e261101, {}),
    () => fechasDe(E.e261101, {}),
    () => ingresoPaquete(enviar("POST", "/x", {}), ctx(PAQUETE_AGR.p261101)),
    () => pasarPendientes(enviar("POST", "/x"), ctx(E.e261101)),
    () => importarAgrupadores(enviar("POST", "/compras/agrupadores/importar")),
    () => viajeActivo(enviar("PUT", "/compras/viaje-activo")),
  ];

  it("sin sesión: 401 en todas las rutas y no llega a la base", async () => {
    escenario.usuario = { rol: "sin_sesion", perfil: PERFILES.planner };
    for (const f of todas()) expect((await f()).status).toBe(401);
    expect(escenario.llamadas).toEqual([]);
  });

  it("el comprador escribe: crea viaje, embarque y paquete, asigna, cambia fechas, importa y fija el viaje activo (200 o 201, nunca 403)", async () => {
    entrarComo("c2");
    const v = await crearViaje(enviar("POST", "/compras/viajes", { nombre: "Viaje C2", fecha_inicio: "2026-11-02", responsable_id: PERFIL_AGR.c2 }));
    expect(v.status).toBe(201);
    const e = await crearEmbarque(enviar("POST", "/compras/embarques", { nombre: "Embarque C2", tipo: "importacion", viaje_id: null, responsable_id: null, fecha_llegada_estimada: "2027-02-10" }));
    expect(e.status).toBe(201);
    const idNuevo = (await leer<{ embarque: EmbarqueDetalleApi }>(e)).data.embarque;
    const p = await crearPaquete(enviar("POST", `/compras/embarques/${idNuevo.id}/paquetes`, { revision_embarque: idNuevo.revision, nombre: "Paquete C2", responsable_id: null }), ctx(idNuevo.id));
    expect(p.status).toBe(201);
    expect((await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] })).status).toBe(200);
    expect((await fechaDe(E.e261201, { revision: revisionEmbarque(E.e261201), fecha_llegada_estimada: "2026-12-15", motivo: "Ajuste del proveedor" })).status).toBe(200);
    expect((await importarAgrupadores(enviar("POST", "/compras/agrupadores/importar", { modo: "previsualizar", archivo_nombre: "a.csv", filas: archivoAgrupadores19b() }))).status).toBe(200);
    expect((await viajeActivo(enviar("PUT", "/compras/viaje-activo", { viaje_id: "todos" }))).status).toBe(200);
  });

  it("el comprador recibe 403 al cerrar, reabrir y cancelar un viaje, al cancelar un paquete y al cancelar un embarque; en tránsito sí puede (R15, caso 19a)", async () => {
    entrarComo("c2");
    const antes = escriturasAgr().length;
    for (const accion of ["cerrar", "reabrir", "cancelar"]) {
      const r = await estadoViaje(enviar("POST", "/x", { revision: 2, accion, motivo: "m" }), ctx(VIAJE_AGR.v261001));
      expect(r.status, accion).toBe(403);
    }
    expect((await estadoPaquete(enviar("POST", "/x", { revision: 1, accion: "cancelar", motivo: "m" }), ctx(PAQUETE_AGR.p261102))).status).toBe(403);
    expect((await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "cancelar", motivo: "No sale" }), ctx(E.e270301))).status).toBe(403);
    expect(escriturasAgr().length).toBe(antes);
    const t = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "en_transito" }), ctx(E.e270301));
    expect(t.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(t)).data.embarque.estado).toBe("en_transito");
  });

  it("admin y planner cierran, reabren y cancelan; cancelar exige motivo", async () => {
    entrarComo("a");
    const cierre = await estadoViaje(enviar("POST", "/x", { revision: 2, accion: "cerrar" }), ctx(VIAJE_AGR.v261001));
    expect(cierre.status).toBe(200);
    expect((await leer<{ viaje: ViajeApi }>(cierre)).data.viaje).toMatchObject({ estado: "cerrado", revision: 3 });
    entrarComo("pl");
    expect((await estadoViaje(enviar("POST", "/x", { revision: 3, accion: "reabrir" }), ctx(VIAJE_AGR.v261001))).status).toBe(200);
    const sinMotivo = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "cancelar" }), ctx(E.e270301));
    expect(sinMotivo.status).toBe(409);
    expect((await leer(sinMotivo)).codigo).toBe("motivo_requerido");
    const cancela = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "cancelar", motivo: "Ya no sale" }), ctx(E.e270301));
    expect(cancela.status).toBe(200);
    // una acción que no es de ese tipo no existe para él
    const mala = await estadoViaje(enviar("POST", "/x", { revision: 3, accion: "en_transito" }), ctx(VIAJE_AGR.v261001));
    expect((await leer(mala)).codigo).toBe("transicion_invalida");
  });

  it("las respuestas no se guardan en caché", async () => {
    expect((await listaViajes(get("/compras/viajes"))).headers.get("Cache-Control")).toBe("no-store");
  });
});

// ─── Lecturas ───

describe("lecturas: viajes, embarques, opciones, sin asignar e historial", () => {
  it("GET viajes: totales del caso (1 500 u, US$ 41 500, 2 embarques) y los asignables sin el planner ni el inactivo (caso 9)", async () => {
    const r = await leer<RespuestaViajesApi>(await listaViajes(get("/compras/viajes")));
    expect(r.data.viajes).toHaveLength(1);
    expect(r.data.viajes[0]).toMatchObject({
      codigo: "261001",
      estado: "abierto",
      responsable: { perfil_id: PERFIL_AGR.c1, nombre: "Comprador C1" },
      responsable_valido: true,
      totales: { compras: 1, unidades: 1500, costo: { PEN: 0, USD: 41500 }, embarques: 2, unidades_sin_embarque: 1500 },
      avisos: [],
    });
    expect(r.data.asignables.map((a) => a.perfil_id).sort()).toEqual([PERFIL_AGR.a, PERFIL_AGR.c1, PERFIL_AGR.c2].sort());
  });

  it("GET viajes: «Mis viajes», estado y texto son filtros", async () => {
    entrarComo("c2");
    expect((await leer<RespuestaViajesApi>(await listaViajes(get("/compras/viajes", "?mio=1")))).data.viajes).toEqual([]);
    entrarComo("c1");
    expect((await leer<RespuestaViajesApi>(await listaViajes(get("/compras/viajes", "?mio=1")))).data.viajes).toHaveLength(1);
    expect((await leer<RespuestaViajesApi>(await listaViajes(get("/compras/viajes", "?estado=cerrado")))).data.viajes).toEqual([]);
    expect((await leer<RespuestaViajesApi>(await listaViajes(get("/compras/viajes", "?q=feria")))).data.viajes).toHaveLength(1);
    expect((await listaViajes(get("/compras/viajes", "?estado=raro"))).status).toBe(400);
  });

  it("GET viaje: el viaje, sus compras y sus embarques; un id mal formado o desconocido es 404", async () => {
    const r = await leer<ViajeDetalleApi>(await unViaje(get("/x"), ctx(VIAJE_AGR.v261001)));
    expect(r.data.compras.map((c) => [c.numero, c.unidades, c.unidades_sin_embarque])).toEqual([["C-000101", 1500, 1500]]);
    expect(r.data.embarques.map((e) => e.codigo).sort()).toEqual(["261101", "261201"]);
    expect((await unViaje(get("/x"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await unViaje(get("/x"), ctx("no-es-uuid"))).status).toBe(404);
  });

  it("GET embarques: totales, responsable efectivo y avisos de cada uno (caso 9: heredado, faltante y sin responsable)", async () => {
    conCaso1();
    const r = await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques")));
    const porCodigo = new Map(r.data.embarques.map((e) => [e.codigo, e]));
    expect([...porCodigo.keys()].sort()).toEqual(["261101", "261102", "261201", "270301"]);
    expect(porCodigo.get("261101")).toMatchObject({
      responsable_efectivo: { perfil_id: PERFIL_AGR.c1, origen: "viaje" },
      totales: { paquetes: 2, compras: 1, lineas: 1, unidades: 300, recibidas: 0, pendientes: 300, historicas: 0, costo: { PEN: 0, USD: 11400 } },
      recepcion: "sin_recibir",
      avisos: [],
    });
    expect(porCodigo.get("261102")?.responsable_efectivo?.perfil_id).toBe(PERFIL_AGR.c3);
    expect(porCodigo.get("261102")?.avisos).toContain("sin_responsable");
    expect(porCodigo.get("270301")?.responsable_efectivo).toBeNull();
    expect(porCodigo.get("270301")?.avisos).toContain("sin_responsable");
    expect(porCodigo.get("261201")?.totales).toMatchObject({ unidades: 200, pendientes: 200 });
  });

  it("GET embarques: filtros por viaje (`sin_viaje` pide los locales), tipo, mes de llegada, «Mis embarques» y atrasados", async () => {
    const codigos = async (consulta: string) => (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques", consulta)))).data.embarques.map((e) => e.codigo).sort();
    expect(await codigos(`?viaje_id=${VIAJE_AGR.v261001}`)).toEqual(["261101", "261201"]);
    expect(await codigos("?viaje_id=sin_viaje")).toEqual(["261102", "270301"]);
    expect(await codigos("?tipo=local")).toEqual(["261102"]);
    expect(await codigos("?desde=2026-12&hasta=2027-03")).toEqual(["261201", "270301"]);
    expect(await codigos("?mio=1")).toEqual(["261101", "261201"]);
    expect(await codigos("?atrasados=1")).toEqual([]);
    expect(await codigos("?reprogramados=1")).toEqual([]);
    vi.setSystemTime(new Date("2026-11-25T15:00:00.000Z"));
    // 08b-1b: «atrasado» = algún hito vencido (también un Zarpe previsto que ya pasó): 261201 salía el 12-nov.
    expect(await codigos("?atrasados=1")).toEqual(["261101", "261102", "261201"]);
    expect((await listaEmbarques(get("/compras/embarques", "?viaje_id=basura"))).status).toBe(400);
  });

  it("GET embarque: paquetes con su responsable y las asignaciones con su compra y línea; las históricas, marcadas", async () => {
    conCaso1();
    const r = await leer<{ embarque: EmbarqueDetalleApi }>(await unEmbarque(get("/x"), ctx(E.e261101)));
    const e = r.data.embarque;
    expect(e.paquetes.map((p) => [p.codigo, p.responsable_efectivo?.perfil_id, p.responsable_efectivo?.origen])).toEqual([
      ["261101", PERFIL_AGR.c2, "propio"],
      ["261102", PERFIL_AGR.c1, "viaje"],
    ]);
    expect(e.paquetes[0].totales).toMatchObject({ asignaciones: 1, unidades: 300, pendientes: 300 });
    expect(e.asignaciones).toHaveLength(1);
    expect(e.asignaciones[0]).toMatchObject({
      id: ASIGNACION_AGR.l1NovP261101,
      periodo: "2026-11",
      unidades: 300,
      recibidas: 0,
      recibidas_estimadas: true,
      pendiente: 300,
      historica: false,
      paquete_id: PAQUETE_AGR.p261101,
      compra: { numero: "C-000101", revision: 3, viaje_id: VIAJE_AGR.v261001, proveedor: { nombre: "Feria Sur" } },
      linea: { tipo: "especifica", marca: "ALFA", costo_unitario: 38, moneda: "USD" },
    });
    // la compra se cancela: la asignación pasa a histórica y el embarque se puede cancelar
    compraPorNumero("C-000101").estado = "cancelada";
    const hist = (await leer<{ embarque: EmbarqueDetalleApi }>(await unEmbarque(get("/x"), ctx(E.e261101)))).data.embarque;
    expect(hist.asignaciones[0]).toMatchObject({ historica: true, pendiente: 0 });
    expect(hist.totales).toMatchObject({ unidades: 0, historicas: 300 });
    expect(hist.avisos).toContain("asignaciones_historicas");
    expect((await unEmbarque(get("/x"), ctx(INEXISTENTE))).status).toBe(404);
  });

  it("opciones: viajes, embarques, paquetes abiertos, asignables y puertos ya usados", async () => {
    const r = await leer<OpcionesAgrupadoresApi>(await opciones());
    expect(r.data.viajes.map((v) => v.codigo)).toEqual(["261001"]);
    expect(r.data.embarques.map((e) => e.codigo).sort()).toEqual(["261101", "261102", "261201", "270301"]);
    expect(r.data.paquetes.map((p) => p.codigo).sort()).toEqual(["261101", "261102"]);
    expect(r.data.asignables.map((a) => a.rol).sort()).toEqual(["admin", "comprador", "comprador"]);
    expect(r.data.puertos).toEqual(["Puerto Sur"]);
  });

  it("sin asignar: las entregas con unidades sin embarque (no las del caso 1) y las compras sin viaje; respeta el viaje y el proveedor", async () => {
    conCaso1();
    const r = await leer<SinAgrupadorApi>(await sinAsignar(get("/compras/agrupadores/sin-asignar")));
    // l2 (lote BETA: mar 600 y abr 400), C-000102 (nov 400) y C-000103 en borrador (nov 120); l1 ya está toda asignada
    expect(r.data.entregas.map((e) => [e.compra.numero, e.periodo, e.sin_asignar]).sort()).toEqual([
      ["C-000101", "2027-03", 600],
      ["C-000101", "2027-04", 400],
      ["C-000102", "2026-11", 400],
      ["C-000103", "2026-11", 120],
    ]);
    expect(r.data.compras_sin_viaje.map((c) => c.numero).sort()).toEqual(["C-000102", "C-000103"]);
    expect(r.data.compras_sin_viaje[0]).toMatchObject({ origen: "comprador" });
    const delViaje = await leer<SinAgrupadorApi>(await sinAsignar(get("/compras/agrupadores/sin-asignar", `?viaje_id=${VIAJE_AGR.v261001}`)));
    expect(delViaje.data.entregas.map((e) => e.compra.numero)).toEqual(["C-000101", "C-000101"]);
    expect(delViaje.data.compras_sin_viaje.map((c) => c.numero).sort()).toEqual(["C-000102", "C-000103"]);
    const locales = await leer<SinAgrupadorApi>(await sinAsignar(get("/compras/agrupadores/sin-asignar", "?viaje_id=sin_viaje&proveedor_id=" + COMPRA_PROVEEDOR_NORTE())));
    expect(locales.data.entregas.map((e) => e.compra.numero)).toEqual(["C-000102"]);
    const enMes = await leer<SinAgrupadorApi>(await sinAsignar(get("/compras/agrupadores/sin-asignar", "?desde=2027-04")));
    expect(enMes.data.entregas.map((e) => e.periodo)).toEqual(["2027-04"]);
  });

  it("historial: los eventos del agrupador con su autor; un agrupador que no existe es 404 y pedir dos a la vez, 400", async () => {
    await crearViaje(enviar("POST", "/compras/viajes", { nombre: "Otro viaje", fecha_inicio: "2026-11-03", responsable_id: PERFIL_AGR.c2 }));
    const nuevo = tablaDe("compra_viajes").find((v) => v.nombre === "Otro viaje")!;
    const r = await leer<{ eventos: { accion: string; usuario_nombre: string }[] }>(await historial(get("/x", `?viaje_id=${nuevo.id}`)));
    expect(r.data.eventos.map((e) => [e.accion, e.usuario_nombre])).toEqual([["crear", "Comprador C1"]]);
    expect((await historial(get("/x", `?viaje_id=${INEXISTENTE}`))).status).toBe(404);
    expect((await historial(get("/x", `?embarque_id=${E.e261101}&viaje_id=${nuevo.id}`))).status).toBe(400);
    expect((await historial(get("/x"))).status).toBe(400);
  });
});

const COMPRA_PROVEEDOR_NORTE = () => String(compraPorNumero("C-000102").proveedor_id);

// ─── Viajes ───

describe("viajes: crear, editar y asignar compras (casos 6, 9 y 19a)", () => {
  const nuevoViaje = (extra: Record<string, unknown> = {}) => ({ nombre: "Taller Lima · nov", fecha_inicio: "2026-10-20", responsable_id: PERFIL_AGR.c2, ...extra });

  it("crea con el código propuesto aamm## del mes de inicio (261002, porque 261001 ya existe) y deja el evento", async () => {
    const r = await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje()));
    expect(r.status).toBe(201);
    const { viaje } = (await leer<{ viaje: ViajeApi }>(r)).data;
    expect(viaje).toMatchObject({ codigo: "261002", estado: "abierto", revision: 0, responsable: { perfil_id: PERFIL_AGR.c2 }, totales: { compras: 0, embarques: 0 } });
    expect(llamadasRpc("guardar_viaje")[0].args).toMatchObject({ p_revision: null, p_viaje: { nombre: "Taller Lima · nov", fecha_fin: null } });
    expect(tablaDe("compra_agrupador_eventos").map((e) => e.accion)).toEqual(["crear"]);
  });

  it("un planner no puede ser responsable (R26); el código a mano duplicado o fuera de formato se rechaza", async () => {
    const pl = await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje({ responsable_id: PERFIL_AGR.pl })));
    expect(pl.status).toBe(409);
    expect((await leer(pl)).codigo).toBe("responsable_no_asignable");
    const duplicado = await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje({ codigo: "261001" })));
    expect((await leer(duplicado)).codigo).toBe("codigo_duplicado");
    expect(duplicado.status).toBe(409);
    expect((await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje({ codigo: "no válido!" })))).status).toBe(400);
    expect((await crearViaje(enviar("POST", "/compras/viajes", { ...nuevoViaje(), clave_rara: 1 }))).status).toBe(400);
    expect((await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje({ fecha_fin: "2026-10-01" })))).status).toBe(400);
  });

  it("caso 6: con 99 usado, `correlativo_agotado`; un código escrito a mano ocupa su correlativo", async () => {
    await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje({ codigo: "261099" })));
    const r = await crearViaje(enviar("POST", "/compras/viajes", nuevoViaje()));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("correlativo_agotado");
  });

  it("edita con la revisión vigente: una revisión vieja da `agrupador_cambio` (dos pestañas) y sin revisión es 400", async () => {
    const cuerpo = { revision: 2, nombre: "Feria Sur · oct-2026 (ajustado)", fecha_inicio: "2026-10-05", fecha_fin: "2026-10-12", responsable_id: PERFIL_AGR.c1, destino: "Ciudad Sur" };
    const r = await editarViaje(enviar("PATCH", "/x", cuerpo), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(200);
    expect((await leer<{ viaje: ViajeApi }>(r)).data.viaje).toMatchObject({ nombre: "Feria Sur · oct-2026 (ajustado)", revision: 3 });
    const vieja = await editarViaje(enviar("PATCH", "/x", cuerpo), ctx(VIAJE_AGR.v261001));
    expect(vieja.status).toBe(409);
    expect((await leer(vieja)).codigo).toBe("agrupador_cambio");
    const { revision: _r, ...sinRevision } = cuerpo;
    void _r;
    expect((await editarViaje(enviar("PATCH", "/x", sinRevision), ctx(VIAJE_AGR.v261001))).status).toBe(400);
    expect((await editarViaje(enviar("PATCH", "/x", cuerpo), ctx(INEXISTENTE))).status).toBe(404);
  });

  it("caso 19a: con el viaje cerrado un comprador le añade y le quita compras con el aviso `viaje_cerrado`; reabrirlo le da 403; cancelado bloquea", async () => {
    entrarComo("a");
    await estadoViaje(enviar("POST", "/x", { revision: 2, accion: "cerrar" }), ctx(VIAJE_AGR.v261001));
    entrarComo("c2");
    const c102 = compraPorNumero("C-000102");
    const r = await comprasDeViaje(enviar("POST", "/x", { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c102.id, revision: c102.revision }] }), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaAsignarViajeApi>(r);
    expect(data.avisos).toEqual([{ aviso: "viaje_cerrado", detalle: "El viaje 261001 está cerrado: igual se registra." }]);
    expect(data.compras).toEqual([{ id: c102.id, revision: 2 }]);
    expect(data.viaje.totales.compras).toBe(2);
    expect(c102.viaje_id).toBe(VIAJE_AGR.v261001);
    const quita = await comprasDeViaje(enviar("POST", "/x", { viaje_id: null, compras: [{ id: c102.id, revision: 2 }] }), ctx(VIAJE_AGR.v261001));
    expect(quita.status).toBe(200);
    expect(c102.viaje_id).toBeNull();
    expect((await estadoViaje(enviar("POST", "/x", { revision: 3, accion: "reabrir" }), ctx(VIAJE_AGR.v261001))).status).toBe(403);
    // cancelado: bloquea
    fila("compra_viajes", VIAJE_AGR.v261001)!.estado = "cancelado";
    const c103 = compraPorNumero("C-000103");
    const bloqueada = await comprasDeViaje(enviar("POST", "/x", { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c103.id, revision: c103.revision }] }), ctx(VIAJE_AGR.v261001));
    expect((await leer(bloqueada)).codigo).toBe("viaje_cancelado");
  });

  it("R23: quitar compras de un viaje que no son de ese viaje es 404 `no_pertenece`; revisión vieja de la compra, 409 `compra_cambio`; viaje del cuerpo distinto del de la ruta, 400", async () => {
    const c102 = compraPorNumero("C-000102");
    const ajena = await comprasDeViaje(enviar("POST", "/x", { viaje_id: null, compras: [{ id: c102.id, revision: c102.revision }] }), ctx(VIAJE_AGR.v261001));
    expect(ajena.status).toBe(404);
    const cuerpoAjena = await leer(ajena);
    expect(cuerpoAjena.codigo).toBe("no_pertenece");
    expect(cuerpoAjena.error).toMatch(/viaje cambió.*vuelve a leer/);
    const vieja = await comprasDeViaje(enviar("POST", "/x", { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c102.id, revision: 0 }] }), ctx(VIAJE_AGR.v261001));
    expect((await leer(vieja)).codigo).toBe("compra_cambio");
    const otro = await comprasDeViaje(enviar("POST", "/x", { viaje_id: INEXISTENTE, compras: [{ id: c102.id, revision: 1 }] }), ctx(VIAJE_AGR.v261001));
    expect(otro.status).toBe(400);
    expect(llamadasRpc("asignar_viaje_compras")).toHaveLength(1);
  });

  it("B2: una compra repetida en `compras` se procesa una vez (una sola entrada y una sola revisión nueva); el mismo id con dos revisiones es 409 `compra_cambio` sin tocar la base", async () => {
    const c102 = compraPorNumero("C-000102");
    const revision = Number(c102.revision);
    const doble = await comprasDeViaje(enviar("POST", "/x", { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c102.id, revision }, { id: c102.id, revision }] }), ctx(VIAJE_AGR.v261001));
    expect(doble.status, JSON.stringify(await doble.clone().json())).toBe(200);
    expect((await leer<RespuestaAsignarViajeApi>(doble)).data.compras).toEqual([{ id: c102.id, revision: revision + 1 }]);
    expect(llamadasRpc("asignar_viaje_compras")).toHaveLength(1);
    expect((llamadasRpc("asignar_viaje_compras")[0].args.p_compras as unknown[]).length).toBe(1);

    const distintas = await comprasDeViaje(enviar("POST", "/x", { viaje_id: null, compras: [{ id: c102.id, revision: revision + 1 }, { id: c102.id, revision }] }), ctx(VIAJE_AGR.v261001));
    expect(distintas.status).toBe(409);
    expect((await leer(distintas)).codigo).toBe("compra_cambio");
    expect(llamadasRpc("asignar_viaje_compras")).toHaveLength(1);
  });

  it("cancelar un viaje con compras o embarques sin cancelar: `tiene_compras`", async () => {
    entrarComo("a");
    const r = await estadoViaje(enviar("POST", "/x", { revision: 2, accion: "cancelar", motivo: "Se suspendió" }), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("tiene_compras");
  });
});

// ─── Embarques y paquetes ───

describe("embarques y paquetes: crear, editar, estados (casos 6 y 10)", () => {
  const nuevo = (extra: Record<string, unknown> = {}) => ({ nombre: "Embarque nov", tipo: "importacion", viaje_id: VIAJE_AGR.v261001, responsable_id: null, fecha_llegada_estimada: "2026-11-30", puerto_embarque: "Puerto Sur", ...extra });

  it("caso 10: un embarque local con viaje y una salida posterior a la llegada son 409 sin llamar a la base", async () => {
    const local = await crearEmbarque(enviar("POST", "/compras/embarques", nuevo({ tipo: "local" })));
    expect(local.status).toBe(409);
    expect((await leer(local)).codigo).toBe("local_con_viaje");
    const salida = await crearEmbarque(enviar("POST", "/compras/embarques", nuevo({ fecha_salida_estimada: "2026-12-05" })));
    expect(salida.status).toBe(409);
    expect((await leer(salida)).codigo).toBe("salida_despues_de_llegada");
    expect(escriturasAgr()).toEqual([]);
    expect((await crearEmbarque(enviar("POST", "/compras/embarques", { nombre: "Sin fecha", tipo: "importacion", viaje_id: null, responsable_id: null }))).status).toBe(400);
  });

  it("caso 6: sin código recibe el siguiente del mes (261103); a mano `261101` es duplicado; con 99 usado, `correlativo_agotado`; local sin viaje se crea", async () => {
    const r = await crearEmbarque(enviar("POST", "/compras/embarques", nuevo()));
    expect(r.status).toBe(201);
    const e = (await leer<{ embarque: EmbarqueDetalleApi }>(r)).data.embarque;
    expect(e).toMatchObject({ codigo: "261103", estado: "planificado", revision: 0, puerto_embarque: "Puerto Sur", viaje: { codigo: "261001" }, paquetes: [], asignaciones: [] });
    expect((await leer(await crearEmbarque(enviar("POST", "/compras/embarques", nuevo({ codigo: "261101" }))))).codigo).toBe("codigo_duplicado");
    await crearEmbarque(enviar("POST", "/compras/embarques", nuevo({ codigo: "261199" })));
    expect((await leer(await crearEmbarque(enviar("POST", "/compras/embarques", nuevo())))).codigo).toBe("correlativo_agotado");
    const local = await crearEmbarque(enviar("POST", "/compras/embarques", nuevo({ tipo: "local", viaje_id: null, codigo: "261300" })));
    expect(local.status).toBe(201);
  });

  it("un viaje cerrado se acepta con el aviso `viaje_cerrado`; uno cancelado bloquea", async () => {
    fila("compra_viajes", VIAJE_AGR.v261001)!.estado = "cerrado";
    const r = await leer<{ embarque: EmbarqueDetalleApi }>(await crearEmbarque(enviar("POST", "/compras/embarques", nuevo())));
    expect(r.data.embarque.avisos).toContain("viaje_cerrado");
    fila("compra_viajes", VIAJE_AGR.v261001)!.estado = "cancelado";
    const c = await crearEmbarque(enviar("POST", "/compras/embarques", nuevo()));
    expect((await leer(c)).codigo).toBe("viaje_cancelado");
  });

  it("editar: la llegada va por movimiento (`fecha_por_movimiento`, sin llamar a la base); la salida y el puerto sí se editan sin mover entregas", async () => {
    conCaso1();
    const base = { revision: 1, nombre: "Nov-26 · Feria Sur", tipo: "importacion", viaje_id: VIAJE_AGR.v261001, responsable_id: null, puerto_embarque: "Puerto Sur" };
    const llegada = await editarEmbarque(enviar("PATCH", "/x", { ...base, fecha_llegada_estimada: "2026-11-25" }), ctx(E.e261101));
    expect(llegada.status).toBe(409);
    expect((await leer(llegada)).codigo).toBe("fecha_por_movimiento");
    expect(escriturasAgr()).toEqual([]);
    const antes = tablaDe("compra_linea_entregas").map((e) => `${e.id}:${e.periodo}:${e.unidades}`).sort();
    // F22: la salida NO se escribe al editar. Una distinta (o `null` con una guardada) es `fecha_por_movimiento`; la misma, o ausente, conserva.
    const otraSalida = await editarEmbarque(enviar("PATCH", "/x", { ...base, fecha_salida_estimada: "2026-10-28" }), ctx(E.e261101));
    expect((await leer(otraSalida)).codigo).toBe("fecha_por_movimiento");
    const salidaNula = await editarEmbarque(enviar("PATCH", "/x", { ...base, fecha_salida_estimada: null }), ctx(E.e261101));
    expect((await leer(salidaNula)).codigo).toBe("fecha_por_movimiento");
    expect(escriturasAgr()).toEqual([]);
    const ok = await editarEmbarque(enviar("PATCH", "/x", { ...base, puerto_embarque: "Puerto Norte", fecha_salida_estimada: "2026-10-25", fecha_llegada_estimada: "2026-11-20" }), ctx(E.e261101));
    expect(ok.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(ok)).data.embarque).toMatchObject({ puerto_embarque: "Puerto Norte", fecha_salida_estimada: "2026-10-25", revision: 2 });
    expect(tablaDe("compra_linea_entregas").map((e) => `${e.id}:${e.periodo}:${e.unidades}`).sort()).toEqual(antes);
    // Sin la clave de la salida: se conserva (antes el servicio mandaba `null` y la borraba).
    const sinSalida = await editarEmbarque(enviar("PATCH", "/x", { ...base, revision: 2, nombre: "Nov-26 · Feria Sur (editado)" }), ctx(E.e261101));
    expect(sinSalida.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(sinSalida)).data.embarque).toMatchObject({ fecha_salida_estimada: "2026-10-25", fecha_llegada_estimada: "2026-11-20", revision: 3 });
    expect(fila("compra_embarques", E.e261101)?.fecha_salida_estimada).toBe("2026-10-25");
    const claves = llamadasRpc("guardar_embarque").at(-1)?.args.p_embarque as Record<string, unknown>;
    expect(Object.keys(claves)).not.toContain("fecha_salida_estimada");
    expect((await leer(await editarEmbarque(enviar("PATCH", "/x", base), ctx(E.e261101)))).codigo).toBe("agrupador_cambio");
    const { revision: _r, ...sinRevision } = base;
    void _r;
    expect((await editarEmbarque(enviar("PATCH", "/x", sinRevision), ctx(E.e261101))).status).toBe(400);
    expect((await editarEmbarque(enviar("PATCH", "/x", base), ctx(INEXISTENTE))).status).toBe(404);
  });

  it("caso 7: cancelar un embarque con asignaciones activas es 409; sin ellas (o con la compra cancelada), el admin lo cancela y queda inmutable", async () => {
    conCaso1();
    entrarComo("a");
    const con = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "cancelar", motivo: "No sale" }), ctx(E.e261201));
    expect(con.status).toBe(409);
    expect((await leer(con)).codigo).toBe("tiene_asignaciones_activas");
    compraPorNumero("C-000101").estado = "cancelada";
    const cancelado = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "cancelar", motivo: "No sale" }), ctx(E.e261201));
    expect(cancelado.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(cancelado)).data.embarque.estado).toBe("cancelado");
    const editar = await editarEmbarque(enviar("PATCH", "/x", { revision: 2, nombre: "x", tipo: "importacion", viaje_id: null, responsable_id: null }), ctx(E.e261201));
    expect((await leer(editar)).codigo).toBe("no_editable");
  });

  it("paquetes: crear con la revisión del embarque (que sube), editar, cancelar (planner) y `embarque_no_editable` en un embarque cancelado", async () => {
    const r = await crearPaquete(enviar("POST", "/x", { revision_embarque: 1, nombre: "Paquete nuevo", responsable_id: PERFIL_AGR.c2 }), ctx(E.e261101));
    expect(r.status).toBe(201);
    const e = (await leer<{ embarque: EmbarqueDetalleApi }>(r)).data.embarque;
    expect(e.revision).toBe(2);
    expect(e.paquetes.map((p) => p.codigo)).toEqual(["261101", "261102", "261103"]);
    const stale = await crearPaquete(enviar("POST", "/x", { revision_embarque: 1, nombre: "Otro", responsable_id: null }), ctx(E.e261101));
    expect((await leer(stale)).codigo).toBe("agrupador_cambio");
    const nuevoId = e.paquetes[2].id;
    const edit = await editarPaquete(enviar("PATCH", "/x", { revision_embarque: 2, nombre: "Paquete renombrado", responsable_id: null }), ctx(nuevoId));
    expect(edit.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(edit)).data.embarque.paquetes[2]).toMatchObject({ nombre: "Paquete renombrado", responsable_efectivo: { origen: "viaje" } });
    const pl = await crearPaquete(enviar("POST", "/x", { revision_embarque: 3, nombre: "Responsable planner", responsable_id: PERFIL_AGR.pl }), ctx(E.e261101));
    expect((await leer(pl)).codigo).toBe("responsable_no_asignable");
    entrarComo("pl");
    const cancela = await estadoPaquete(enviar("POST", "/x", { revision: 3, accion: "cancelar", motivo: "No se usa" }), ctx(nuevoId));
    expect(cancela.status).toBe(200);
    expect((await leer<{ embarque: EmbarqueDetalleApi }>(cancela)).data.embarque.paquetes[2].estado).toBe("cancelado");
    // embarque cancelado: no admite paquetes
    fila("compra_embarques", E.e270301)!.estado = "cancelado";
    const cerrado = await crearPaquete(enviar("POST", "/x", { revision_embarque: 1, nombre: "Tarde", responsable_id: null }), ctx(E.e270301));
    expect((await leer(cerrado)).codigo).toBe("embarque_no_editable");
  });
});

// ─── Movimientos ───

describe("movimientos de entregas: vista previa, escritura y reintento con la huella (R19, casos 2 a 5 y 11)", () => {
  const itemC102 = (rev = 1) => ({ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: rev });

  it("caso 2: la vista previa no escribe; C2 asigna C-000102 a 261201 y la entrega pasa a diciembre con la revisión +1 y el evento de C2", async () => {
    entrarComo("c2");
    const prev = await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] }, "?previsualizar=1");
    expect(prev.status).toBe(200);
    const plan = (await leer<PlanMovimientoApi>(prev)).data;
    expect(plan).toMatchObject({ operacion: "asignar", compras_afectadas: 1, lineas: 1, unidades_movidas: 400 });
    expect(plan.huella_plan).toHaveLength(64);
    expect(plan.movimientos[0]).toMatchObject({ compra_numero: "C-000102", unidades: 400, de: { periodo: "2026-11", embarque: null }, a: { periodo: "2026-12", embarque: { codigo: "261201" } } });
    expect(escriturasAgr()).toEqual([]);

    const r = await asignarItems(E.e261201, { revision: 1, paquete_id: null, huella_plan: plan.huella_plan, items: [itemC102()] });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.embarque.codigo).toBe("261201");
    expect(data.embarque.asignaciones.map((a) => [a.compra.numero, a.periodo, a.unidades])).toEqual([["C-000102", "2026-12", 400]]);
    expect(data.embarque.revision).toBe(2);
    expect(data.compras).toEqual([{ id: COMPRA_AGR.c102, revision: 2 }]);
    expect(data.embarques_tocados).toEqual([]);
    expect(revisionCompra(COMPRA_AGR.c102)).toBe(2);
    expect(tablaDe("compra_agrupador_eventos").filter((e) => e.accion === "asignar").map((e) => e.usuario_nombre)).toEqual(["Comprador C2"]);
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(1);
  });

  it("caso 17: asignar 300 de una entrega de nov de 500 a dic con 100 sin embarque en dic; y `excede_entrega` cuando se pide más de lo que hay", async () => {
    tablaDe("compra_linea_entregas").find((e) => e.id === ENTREGA_AGR.c102Nov)!.unidades = 500;
    tablaDe("compra_lineas").find((l) => l.id === LINEA_AGR.l102)!.unidades = 600;
    tablaDe("compra_linea_entregas").push({ id: "b8000000-0000-4000-8000-000000000999", linea_id: LINEA_AGR.l102, periodo: "2026-12-01", unidades: 100, origen: "manual", activo: true });
    const r = await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 300, compra_revision: 1 }] });
    expect(r.status).toBe(200);
    const porMes = tablaDe("compra_linea_entregas").filter((e) => e.linea_id === LINEA_AGR.l102).map((e) => [String(e.periodo).slice(0, 7), e.unidades]).sort();
    expect(porMes).toEqual([["2026-11", 200], ["2026-12", 400]]);
    const exceso = await asignarItems(E.e261201, { revision: 2, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 300, compra_revision: 2 }] });
    expect(exceso.status).toBe(409);
    const cuerpo = await leer(exceso);
    expect(cuerpo.codigo).toBe("excede_entrega");
    expect(cuerpo.error).toMatch(/Solo hay 200 u sin asignar/);
  });

  it("asignar a un paquete: `paquete_de_otro_embarque` y `embarque_no_editable` (cancelado) y `compra_no_asignable` (cancelada)", async () => {
    const otro = await asignarItems(E.e261201, { revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [itemC102()] });
    expect(otro.status).toBe(409);
    expect((await leer(otro)).codigo).toBe("paquete_de_otro_embarque");
    const bien = await asignarItems(E.e261101, { revision: 1, paquete_id: PAQUETE_AGR.p261102, items: [itemC102()] });
    expect(bien.status).toBe(200);
    fila("compra_embarques", E.e270301)!.estado = "cancelado";
    expect((await leer(await asignarItems(E.e270301, { revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c103Nov, unidades: 120, compra_revision: 1 }] }))).codigo).toBe("embarque_no_editable");
    compraPorNumero("C-000103").estado = "cancelada";
    expect((await leer(await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c103Nov, unidades: 120, compra_revision: 1 }] }))).codigo).toBe("compra_no_asignable");
  });

  it("R23: una entrega que no existe y una asignación de otro embarque son 404 `no_pertenece`; nada se escribe", async () => {
    conCaso1();
    const antes = escriturasAgr().length;
    const entrega = await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [{ entrega_id: INEXISTENTE, unidades: 10, compra_revision: 1 }] });
    expect(entrega.status).toBe(404);
    expect((await leer(entrega)).codigo).toBe("no_pertenece");
    // la asignación del 261101 no es del 261201
    const ajena = await quitarDe(E.e261201, { revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 3 }] });
    expect(ajena.status).toBe(404);
    const cuerpoAjena = await leer(ajena);
    expect(cuerpoAjena.codigo).toBe("no_pertenece");
    // B1: el texto dice que el embarque cambió y que se vuelve a leer (no «no pertenece a este embarque»)
    expect(cuerpoAjena.error).toMatch(/embarque cambió.*vuelve a leer/);
    const paquete = await aPaquete(enviar("POST", "/x", { revision: 1, paquete_id: null, asignaciones: [ASIGNACION_AGR.l1NovP261101] }), ctx(E.e261201));
    expect(paquete.status).toBe(404);
    expect((await leer(paquete)).codigo).toBe("no_pertenece");
    expect(escriturasAgr().length).toBe(antes);
    // un embarque que no existe
    expect((await asignarItems(INEXISTENTE, { revision: 1, paquete_id: null, items: [itemC102()] })).status).toBe(404);
    // un embarque ajeno al paquete que se mueve
    const mover = await moverPaquete(enviar("POST", "/x", { revision: 1, embarque_destino_id: INEXISTENTE, revision_destino: 1, motivo: "m" }), ctx(PAQUETE_AGR.p261101));
    expect(mover.status).toBe(404);
  });

  it("R19: con la compra cambiada y la MISMA huella reintenta una vez; con otra, 409 `plan_cambio`; sin huella, 409 `compra_cambio`", async () => {
    const plan = (await leer<PlanMovimientoApi>(await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] }, "?previsualizar=1"))).data;
    // otra persona edita algo de la compra que no cambia el plan: su revisión sube
    fila("compras", COMPRA_AGR.c102)!.revision = 2;
    const sinHuella = await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] });
    expect(sinHuella.status).toBe(409);
    expect((await leer(sinHuella)).codigo).toBe("compra_cambio");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(0);

    const igual = await asignarItems(E.e261201, { revision: 1, paquete_id: null, huella_plan: plan.huella_plan, items: [itemC102()] });
    expect(igual.status, JSON.stringify(await leer(igual.clone()))).toBe(200);
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(1);
    expect(revisionCompra(COMPRA_AGR.c102)).toBe(3);
  });

  it("R19: si lo que se iba a mover cambió (otra huella), 409 `plan_cambio` y nada se escribe", async () => {
    const plan = (await leer<PlanMovimientoApi>(await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] }, "?previsualizar=1"))).data;
    fila("compras", COMPRA_AGR.c102)!.revision = 2;
    tablaDe("compra_linea_entregas").find((e) => e.id === ENTREGA_AGR.c102Nov)!.unidades = 350;
    const r = await asignarItems(E.e261201, { revision: 1, paquete_id: null, huella_plan: plan.huella_plan, items: [{ ...itemC102(), unidades: 350 }] });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("plan_cambio");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(0);
  });

  it("R19: si la función dice `compra_cambio` (carrera tras la lectura), reintenta UNA vez con la huella idéntica; si sigue, 409 `plan_cambio`; sin huella, `compra_cambio`", async () => {
    const cuerpo = { revision: 1, paquete_id: null, items: [itemC102()] };
    const plan = (await leer<PlanMovimientoApi>(await asignarItems(E.e261201, cuerpo, "?previsualizar=1"))).data;
    let n = 0;
    reemplazos.aplicar_movimiento_agrupador = () => (n++ === 0 ? { data: { ok: false, motivo: "compra_cambio" }, error: null } : null);
    const reintento = await asignarItems(E.e261201, { ...cuerpo, huella_plan: plan.huella_plan });
    expect(reintento.status).toBe(200);
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(2);

    // siempre falla: un solo reintento y se rinde
    iniciarAgrupadores();
    entrarComo("c1");
    reemplazos.aplicar_movimiento_agrupador = () => ({ data: { ok: false, motivo: "compra_cambio" }, error: null });
    const rinde = await asignarItems(E.e261201, { ...cuerpo, huella_plan: plan.huella_plan });
    expect(rinde.status).toBe(409);
    expect((await leer(rinde)).codigo).toBe("plan_cambio");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(2);

    iniciarAgrupadores();
    entrarComo("c1");
    reemplazos.aplicar_movimiento_agrupador = () => ({ data: { ok: false, motivo: "compra_cambio" }, error: null });
    const sin = await asignarItems(E.e261201, cuerpo);
    expect((await leer(sin)).codigo).toBe("compra_cambio");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(1);
  });

  it("un fallo interno de la base (AG002) es un 500 y no un 409; los motivos desconocidos tampoco se disfrazan de 409", async () => {
    reemplazos.aplicar_movimiento_agrupador = () => ({ data: null, error: { code: "AG002", message: "plan inconsistente: las entregas que dejo la base no coinciden con el plan", details: null, hint: null } });
    const r = await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await leer(r))).not.toMatch(/plan inconsistente/);
    reemplazos.aplicar_movimiento_agrupador = () => ({ data: { ok: false, motivo: "algo_nuevo" }, error: null });
    expect((await asignarItems(E.e261201, { revision: 1, paquete_id: null, items: [itemC102()] })).status).toBe(500);
  });

  it("`agrupador_cambio`: con la revisión vieja del embarque no se escribe (la del embarque nunca se refresca sola)", async () => {
    const r = await asignarItems(E.e261201, { revision: 0, paquete_id: null, items: [itemC102()] });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("agrupador_cambio");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(0);
  });

  it("caso 3: C1 cambia la llegada de 261101 al 03-dic: l1 queda en dic 500 con dos asignaciones y el aviso `entregas_fusionadas`; el motivo es obligatorio", async () => {
    conCaso1();
    const cuerpo = { revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Retraso del proveedor" };
    expect((await fechaDe(E.e261101, { ...cuerpo, motivo: "  " })).status).toBe(400);
    const prev = (await leer<PlanMovimientoApi>(await fechaDe(E.e261101, cuerpo, "?previsualizar=1"))).data;
    expect(prev).toMatchObject({ operacion: "cambiar_fecha", unidades_movidas: 300, compras_afectadas: 1 });
    expect(prev.avisos.map((a) => a.aviso)).toContain("entregas_fusionadas");
    expect(escriturasAgr()).toEqual([]);

    const r = await fechaDe(E.e261101, { ...cuerpo, huella_plan: prev.huella_plan });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.embarque).toMatchObject({ fecha_llegada_estimada: "2026-12-03", periodo_llegada: "2026-12", revision: 2 });
    expect(data.avisos.map((a) => a.aviso)).toContain("entregas_fusionadas");
    const entregasL1 = tablaDe("compra_linea_entregas").filter((e) => e.linea_id === LINEA_AGR.l1).map((e) => [String(e.periodo).slice(0, 7), e.unidades]);
    expect(entregasL1).toEqual([["2026-12", 500]]);
    expect(tablaDe("compra_entrega_asignaciones").map((a) => [a.embarque_id, a.unidades]).sort()).toEqual([[E.e261101, 300], [E.e261201, 200]].sort());
    expect(data.compras).toEqual([{ id: COMPRA_AGR.c101, revision: 4 }]);
    expect(data.embarque.asignaciones[0]).toMatchObject({ periodo: "2026-12", unidades: 300 });
  });

  it("R5: cambiar la llegada dentro del mismo mes no toca compras ni revisiones; una salida posterior a la nueva llegada es 409", async () => {
    conCaso1();
    const r = await fechaDe(E.e261101, { revision: 1, fecha_llegada_estimada: "2026-11-28", motivo: "Ajuste menor" });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.compras).toEqual([]);
    expect(revisionCompra(COMPRA_AGR.c101)).toBe(3);
    expect(data.embarque).toMatchObject({ fecha_llegada_estimada: "2026-11-28", revision: 2 });
    // la salida del 261101 es el 25-oct: una llegada anterior es imposible
    const mala = await fechaDe(E.e261101, { revision: 2, fecha_llegada_estimada: "2026-10-20", motivo: "Adelanto" });
    expect(mala.status).toBe(409);
    expect((await leer(mala)).codigo).toBe("salida_despues_de_llegada");
  });

  it("quitar: las unidades quedan sin embarque en el mismo mes; vale también en un embarque cancelado (B1)", async () => {
    conCaso1();
    const prev = (await leer<PlanMovimientoApi>(await quitarDe(E.e261201, { revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1Dic261201, compra_revision: 3 }] }, "?previsualizar=1"))).data;
    expect(prev.movimientos[0]).toMatchObject({ unidades: 200, de: { periodo: "2026-12", embarque: { codigo: "261201" } }, a: { periodo: "2026-12", embarque: null } });
    fila("compra_embarques", E.e261201)!.estado = "cancelado";
    const r = await quitarDe(E.e261201, { revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1Dic261201, compra_revision: 3 }], huella_plan: prev.huella_plan });
    expect(r.status).toBe(200);
    expect((await leer<RespuestaMovimientoApi>(r)).data.embarque.asignaciones).toEqual([]);
    expect(tablaDe("compra_entrega_asignaciones").map((a) => a.id)).toEqual([ASIGNACION_AGR.l1NovP261101]);
    expect(tablaDe("compra_linea_entregas").find((e) => e.id === ENTREGA_AGR.l1Dic)?.unidades).toBe(200);
  });

  it("mover a paquete (mismo embarque): no mueve meses; `paquete_de_otro_embarque` si el paquete es de otro", async () => {
    conCaso1();
    const r = await aPaquete(enviar("POST", "/x", { revision: 1, paquete_id: PAQUETE_AGR.p261102, asignaciones: [ASIGNACION_AGR.l1NovP261101] }), ctx(E.e261101));
    expect(r.status).toBe(200);
    expect((await leer<RespuestaMovimientoApi>(r)).data.embarque.asignaciones[0]).toMatchObject({ paquete_id: PAQUETE_AGR.p261102, periodo: "2026-11" });
    const otro = await aPaquete(enviar("POST", "/x", { revision: 1, paquete_id: PAQUETE_AGR.p261101, asignaciones: [ASIGNACION_AGR.l1Dic261201] }), ctx(E.e261201));
    expect((await leer(otro)).codigo).toBe("paquete_de_otro_embarque");
  });

  it("M1: el plan trae TODAS las compras del embarque, pero solo las TOCADAS suben de revisión, salen en `compras` y quedan en el evento del embarque", async () => {
    conCaso1();
    // C-000102 también viaja en el 261101 (sin paquete): mover el paquete 261101 al 261201 no cambia nada de ella.
    tablaDe("compra_entrega_asignaciones").push({ id: "a9000000-0000-4000-8000-000000000099", entrega_id: ENTREGA_AGR.c102Nov, embarque_id: E.e261101, paquete_id: null, unidades: 400, activo: true });
    const revisionC102 = revisionCompra(COMPRA_AGR.c102);
    const cuerpo = { revision: 1, embarque_destino_id: E.e261201, revision_destino: 1, motivo: "Pasa al embarque de diciembre" };
    const r = await moverPaquete(enviar("POST", "/x", cuerpo), ctx(PAQUETE_AGR.p261101));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    const enviado = escenario.llamadas.find((l) => l.nombre === "aplicar_movimiento_agrupador")?.args.p_plan as { compras: { id: string }[] };
    expect(enviado.compras.map((c) => c.id).sort()).toEqual([COMPRA_AGR.c101, COMPRA_AGR.c102].sort());
    expect(data.compras).toEqual([{ id: COMPRA_AGR.c101, revision: 4 }]);
    expect(revisionCompra(COMPRA_AGR.c101)).toBe(4);
    expect(revisionCompra(COMPRA_AGR.c102)).toBe(revisionC102);
    const eventos = tablaDe("compra_agrupador_eventos").filter((e) => e.accion === "mover_paquete");
    expect(eventos.length).toBeGreaterThan(0);
    for (const e of eventos) expect(e.compras).toEqual([{ compra_id: COMPRA_AGR.c101, revision_nueva: 4 }]);
  });

  it("pasar pendientes: lo pendiente va a otro embarque en curso con su motivo; sin pendientes, 409 `sin_pendientes`", async () => {
    conCaso1();
    const cuerpo = { revision: 1, embarque_destino_id: E.e261201, revision_destino: 1, paquete_destino_id: null, motivo: "No alcanzó el cupo" };
    const prev = (await leer<PlanMovimientoApi>(await pasarPendientes(enviar("POST", "/x?previsualizar=1", cuerpo), ctx(E.e261101)))).data;
    expect(prev).toMatchObject({ operacion: "pasar_pendientes", unidades_movidas: 300 });
    const r = await pasarPendientes(enviar("POST", "/x", { ...cuerpo, huella_plan: prev.huella_plan }), ctx(E.e261101));
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.embarque.codigo).toBe("261101");
    expect(data.embarques_tocados).toEqual([{ id: E.e261201, codigo: "261201", revision: 2 }]);
    expect(tablaDe("compra_entrega_asignaciones").every((a) => a.embarque_id === E.e261201)).toBe(true);
    // el 261201 ahora no tiene nada pendiente de l1 si todo se recibió
    tablaDe("compra_lineas").find((l) => l.id === LINEA_AGR.l1)!.unidades_recibidas = 500;
    const sin = await pasarPendientes(enviar("POST", "/x", { revision: 2, embarque_destino_id: E.e270301, revision_destino: 1, paquete_destino_id: null, motivo: "x" }), ctx(E.e261201));
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("sin_pendientes");
  });

  it("mover un paquete a otro embarque (motivo obligatorio): la respuesta es el embarque de destino y el de origen va en `embarques_tocados`", async () => {
    conCaso1();
    const cuerpo = { revision: 1, embarque_destino_id: E.e261201, revision_destino: 1, motivo: "Pasa al embarque de diciembre" };
    expect((await moverPaquete(enviar("POST", "/x", { ...cuerpo, motivo: "" }), ctx(PAQUETE_AGR.p261101))).status).toBe(400);
    const prev = (await leer<PlanMovimientoApi>(await moverPaquete(enviar("POST", "/x?previsualizar=1", cuerpo), ctx(PAQUETE_AGR.p261101)))).data;
    expect(prev.unidades_movidas).toBe(300);
    const r = await moverPaquete(enviar("POST", "/x", { ...cuerpo, huella_plan: prev.huella_plan }), ctx(PAQUETE_AGR.p261101));
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.embarque.codigo).toBe("261201");
    expect(data.embarque.paquetes.map((p) => p.codigo)).toContain("261101");
    expect(data.embarques_tocados.map((e) => e.codigo)).toEqual(["261101"]);
    expect(fila("compra_paquetes", PAQUETE_AGR.p261101)?.embarque_id).toBe(E.e261201);
    expect(tablaDe("compra_entrega_asignaciones").every((a) => a.embarque_id === E.e261201)).toBe(true);
    // mismo embarque de destino: no tiene sentido
    const igual = await moverPaquete(enviar("POST", "/x", { revision: 2, embarque_destino_id: E.e261201, revision_destino: 2, motivo: "x" }), ctx(PAQUETE_AGR.p261101));
    expect(igual.status).toBe(404);
  });

  it("caso 5: un lote cambia de temporada al mover su embarque (aviso `cambia_temporada`), se reparte de nuevo con el vector de invierno y, sin ese vector, `reparto_sin_vector`", async () => {
    const asig = await asignarItems(E.e270301, { revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l2Mar, unidades: 600, compra_revision: 3 }] });
    expect(asig.status, JSON.stringify(await leer(asig.clone()))).toBe(200);
    const cuerpo = { revision: 2, fecha_llegada_estimada: "2027-04-10", motivo: "La fábrica se atrasó" };
    const prev = (await leer<PlanMovimientoApi>(await fechaDe(E.e270301, cuerpo, "?previsualizar=1"))).data;
    expect(prev.avisos.find((a) => a.aviso === "cambia_temporada")?.detalle).toMatch(/verano → invierno/);

    estadoRepartos.sinInvierno = true;
    const sin = await fechaDe(E.e270301, cuerpo);
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("reparto_sin_vector");
    expect(llamadasRpc("aplicar_movimiento_agrupador")).toHaveLength(1);

    estadoRepartos.sinInvierno = false;
    const r = await fechaDe(E.e270301, { ...cuerpo, huella_plan: prev.huella_plan });
    expect(r.status, JSON.stringify(await leer(r.clone()))).toBe(200);
    const abril = tablaDe("compra_linea_entregas").find((e) => e.linea_id === LINEA_AGR.l2 && String(e.periodo).startsWith("2027-04"))!;
    expect(abril.unidades).toBe(1000);
    expect(tablaDe("compra_linea_entregas").some((e) => e.linea_id === LINEA_AGR.l2 && String(e.periodo).startsWith("2027-03"))).toBe(false);
    const repartos = tablaDe("compra_linea_repartos").filter((x) => x.entrega_id === abril.id);
    expect(repartos.reduce((s, x) => s + Number(x.unidades), 0)).toBe(1000);
    expect(repartos.map((x) => x.unidades).sort()).toEqual([300, 300, 400]);
    expect(repartos.every((x) => x.temporada === "invierno")).toBe(true);
  });
});

// ─── Importador de agrupadores ───

describe("importador de agrupadores (§3.11, R25): previsualizar, aplicar, idempotencia y `vuelve_a_previsualizar`", () => {
  const importar = async (modo: "previsualizar" | "aplicar", filas = archivoAgrupadores19b()) => {
    const r = await importarAgrupadores(enviar("POST", "/compras/agrupadores/importar", { modo, archivo_nombre: "agrupadores.csv", filas }));
    return { r, cuerpo: await leer<ReporteImportacionAgrupadoresApi>(r) };
  };

  it("caso 19b: previsualizar da 9 nuevas (la del viaje sin código «se numera al aplicar») y no escribe; aplicar crea todo en una llamada", async () => {
    const prev = await importar("previsualizar");
    expect(prev.r.status).toBe(200);
    expect(prev.cuerpo.data.resumen).toMatchObject({ nuevas: 9, iguales: 0, cambiadas: 0, omitidas: 0 });
    expect(prev.cuerpo.data.filas.find((f) => f.fila === 2)?.codigo_final).toBeNull();
    expect(escriturasAgr()).toEqual([]);

    const ap = await importar("aplicar");
    expect(ap.r.status, JSON.stringify(ap.cuerpo)).toBe(200);
    expect(ap.cuerpo.data.creados).toHaveLength(9);
    expect(ap.cuerpo.data.creados?.find((c) => c.tipo === "viaje" && c.codigo !== "261201")?.codigo).toBe("270101");
    expect(llamadasRpc("importar_agrupadores")).toHaveLength(1);
    expect(tablaDe("compra_viajes")).toHaveLength(3);
    expect(tablaDe("compra_embarques")).toHaveLength(7);
    expect(tablaDe("compra_paquetes")).toHaveLength(6);
    expect(tablaDe("compra_agrupador_eventos").filter((e) => e.motivo === "Importado de agrupadores.csv")).toHaveLength(9);
  });

  it("reimportar el mismo archivo da 9 `igual` y no vuelve a llamar a la base (no duplica nada)", async () => {
    await importar("aplicar");
    const otra = await importar("aplicar");
    expect(otra.cuerpo.data.resumen).toMatchObject({ nuevas: 0, iguales: 9, cambiadas: 0 });
    expect(llamadasRpc("importar_agrupadores")).toHaveLength(1);
    expect(tablaDe("compra_viajes")).toHaveLength(3);
  });

  it("caso 19c: una llegada cambiada es `cambiada_requiere_edicion`, un responsable planner `responsable_no_asignable` y una referencia sin código `referencia_sin_codigo`", async () => {
    await importar("aplicar");
    const { cuerpo } = await importar("previsualizar", archivoAgrupadores19c());
    const motivo = (fila: number) => cuerpo.data.filas.find((f) => f.fila === fila);
    expect(motivo(4)).toMatchObject({ clasificacion: "cambiada" });
    expect(motivo(4)?.detalle).toMatch(/2027-01-25 → 2027-01-30|2027-01-30/);
    expect(motivo(5)).toMatchObject({ clasificacion: "omitida", motivo: "responsable_no_asignable" });
    expect(motivo(11)).toMatchObject({ clasificacion: "omitida", motivo: "referencia_sin_codigo" });
    expect(motivo(1)?.clasificacion).toBe("igual");
  });

  it("si alguien creó una de las claves entre previsualizar y aplicar: 409 `vuelve_a_previsualizar` (R25) y no se duplica nada", async () => {
    reemplazos.importar_agrupadores = () => ({ data: { ok: false, motivo: "clave_existente", tipo: "viaje", fila: 1 }, error: null });
    const { r, cuerpo } = await importar("aplicar");
    expect(r.status).toBe(409);
    expect(cuerpo.codigo).toBe("vuelve_a_previsualizar");
    expect(cuerpo.error).toMatch(/vuelve a previsualizar/);
    expect(tablaDe("compra_viajes")).toHaveLength(1);
  });

  it("más de 1 000 filas y un cuerpo de más de 6 MB se rechazan antes de tocar la base", async () => {
    const f = archivoAgrupadores19b()[0];
    const muchas = Array.from({ length: 1001 }, (_, i) => ({ ...f, fila: i + 1 }));
    expect((await importar("previsualizar", muchas)).r.status).toBe(400);
    const grande = await importarAgrupadores(enviar("POST", "/compras/agrupadores/importar", { modo: "previsualizar", archivo_nombre: "x".repeat(7 * 1024 * 1024), filas: [f] }));
    expect(grande.status).toBe(413);
    expect(escriturasAgr()).toEqual([]);
  });

  it("un responsable que no existe o un lote ya existente: se omite con su motivo; el archivo vacío es 400", async () => {
    const filas = [{ fila: 1, tipo: "VIAJE", codigo: "270901", nombre: "Viaje X", fecha_inicio: "2027-09-01", responsable: "nadie@ejemplo.test" }];
    expect((await importar("previsualizar", filas)).cuerpo.data.filas[0]).toMatchObject({ clasificacion: "omitida", motivo: "responsable_desconocido" });
    expect((await importar("previsualizar", [])).r.status).toBe(400);
  });
});

// ─── Viaje activo (R22) ───

describe("viaje activo (R22): una cookie por navegador, que ninguna ruta lee y que no da permisos", () => {
  const poner = (viaje_id: string) => viajeActivo(enviar("PUT", "/compras/viaje-activo", { viaje_id }));

  it("guarda la cookie `v2_viaje_activo` (un año, path=/, lax, sin httpOnly) con un viaje existente, `todos` o `sin_viaje`", async () => {
    const r = await poner(VIAJE_AGR.v261001);
    expect(r.status).toBe(200);
    expect((await leer<{ viaje_activo: string }>(r)).data.viaje_activo).toBe(VIAJE_AGR.v261001);
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`v2_viaje_activo=${VIAJE_AGR.v261001}`);
    expect(cookie).toMatch(/Max-Age=31536000/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/HttpOnly/i);
    for (const v of ["todos", "sin_viaje"]) expect((await poner(v)).headers.get("set-cookie")).toContain(`v2_viaje_activo=${v}`);
  });

  it("un viaje que no existe o está cancelado es 404 `no_encontrado` y no escribe la cookie; un texto basura es 400", async () => {
    const no = await poner(INEXISTENTE);
    expect(no.status).toBe(404);
    expect(no.headers.get("set-cookie")).toBeNull();
    fila("compra_viajes", VIAJE_AGR.v261001)!.estado = "cancelado";
    expect((await poner(VIAJE_AGR.v261001)).status).toBe(404);
    expect((await poner("basura")).status).toBe(400);
  });

  it("las rutas de lectura ignoran la cookie: con el viaje activo puesto devuelven lo mismo que sin él", async () => {
    const cookie = { cookie: `v2_viaje_activo=${VIAJE_AGR.v261001}` };
    const sin = (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques")))).data.embarques;
    const con = (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques", "", cookie)))).data.embarques;
    expect(con.map((e) => e.id)).toEqual(sin.map((e) => e.id));
    expect(con).toHaveLength(4);
    const s2 = (await leer<SinAgrupadorApi>(await sinAsignar(get("/x", "", cookie)))).data;
    expect(s2.entregas.length).toBeGreaterThan(0);
    // y la cookie no da permisos: un planner con el viaje del comprador sigue siendo planner, y el comprador con cualquier cookie sigue sin cerrar
    entrarComo("c1");
    const r = await estadoViaje(new NextRequest(`${URL_BASE}/x`, { method: "POST", body: JSON.stringify({ revision: 2, accion: "cerrar" }), headers: { "content-type": "application/json", ...cookie } }), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(403);
  });
});

// ─── Cambios aditivos en M8 ───

describe("cambios aditivos de M8: GET /api/compras con viaje y embarque, y las columnas VIAJE, EMBARQUE y PAQUETE del importador (R21, casos 12 a 15)", () => {
  const usuario = () => ({ id: PERFIL_AGR.a, nombre: "Admin A", rol: "admin" as const });
  const lista = async (consulta: Record<string, string>) => {
    const r = await listarCompras(supabaseAdmin() as never, usuario(), comprasQuerySchema.parse(consulta), null);
    if (r.respuesta) throw new Error("listarCompras falló");
    return r.data;
  };

  it("cada compra trae su viaje y cada entrega, sus asignaciones y lo que está sin embarque; se filtra por `viaje_id`, `sin_viaje` y `embarque_id`", async () => {
    conCaso1();
    const todas = await lista({});
    const c101 = todas.find((c) => c.numero === "C-000101")!;
    expect(c101.viaje).toEqual({ id: VIAJE_AGR.v261001, codigo: "261001", nombre: "Feria Sur · oct-2026", estado: "abierto" });
    const l1 = c101.lineas.find((l) => l.id === LINEA_AGR.l1)!;
    expect(l1.entregas.map((e) => [e.periodo, e.asignaciones?.map((a) => [a.embarque.codigo, a.paquete?.codigo ?? null, a.unidades]), e.sin_embarque])).toEqual([
      ["2026-11", [["261101", "261101", 300]], 0],
      ["2026-12", [["261201", null, 200]], 0],
    ]);
    const l2 = c101.lineas.find((l) => l.id === LINEA_AGR.l2)!;
    expect(l2.entregas.map((e) => [e.asignaciones, e.sin_embarque])).toEqual([[[], 600], [[], 400]]);
    expect(todas.find((c) => c.numero === "C-000102")?.viaje).toBeNull();
    expect((await lista({ viaje_id: VIAJE_AGR.v261001 })).map((c) => c.numero)).toEqual(["C-000101"]);
    expect((await lista({ viaje_id: "sin_viaje" })).map((c) => c.numero).sort()).toEqual(["C-000102", "C-000103"]);
    expect((await lista({ embarque_id: E.e261201 })).map((c) => c.numero)).toEqual(["C-000101"]);
    expect(await lista({ embarque_id: E.e270301 })).toEqual([]);
    expect(() => comprasQuerySchema.parse({ viaje_id: "basura" })).toThrow();
  });

  /** Las filas del importador de compras: una línea de GAMMA con una sola entrega en diciembre (la que cabe en el embarque 261201). */
  const gamma = (ordinal: string, extra: Record<string, string> = {}) => ({ ...filasImportacionEjemplo()[1], linea_ordinal: ordinal, llegada: "2026-12", recibidas: "", ...extra });
  const importarCompras_ = async (modo: "previsualizar" | "aplicar", filas: Record<string, string>[]) => {
    escenario.usuario = { rol: "planner", perfil: PERFILES.planner };
    const r = await importarCompras(enviar("POST", "/compras/importar", { modo, carga_inicial: true, filas }));
    return { r, cuerpo: await leer<ReporteImportacionComprasApi>(r) };
  };
  const calls = () => escenario.llamadas.map((l) => l.nombre).filter((n) => ["importar_compra", "asignar_viaje_compras", "aplicar_movimiento_agrupador"].includes(n));

  it("clasifica primero como M8 y evalúa las columnas: asignado, embarque desconocido, llegada distinta del embarque y entregas con embarque (casos 13 y 14)", async () => {
    escenario.contadorNumero = 200;
    const filas = [
      gamma("1", { viaje: "261001", embarque: "261201" }),
      gamma("2", { embarque: "999999" }),
      gamma("3", { llegada: "2026-11", embarque: "261201" }),
      { ...gamma("4", { embarque: "261201" }), entregas: "2026-12:100;2027-01:100" },
    ];
    const { r, cuerpo } = await importarCompras_("previsualizar", filas);
    expect(r.status, JSON.stringify(cuerpo)).toBe(200);
    const rep = cuerpo.data;
    expect(rep.totales).toMatchObject({ recibidas: 4, nuevas: 1, omitidas: 3 });
    expect(rep.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "embarque_desconocido"], [3, "llegada_distinta_del_embarque"], [4, "entregas_con_embarque"]]);
    expect(rep.compras_a_crear.map((c) => c.lineas_nuevas)).toEqual([1]);
    expect(rep.agrupadores?.map((a) => [a.fila, a.resultado, a.motivo ?? null])).toEqual([
      [1, "asignado", null],
      [2, "omitido", "embarque_desconocido"],
      [3, "omitido", "llegada_distinta_del_embarque"],
      [4, "omitido", "entregas_con_embarque"],
    ]);
    expect(rep.agrupadores?.[0]).toMatchObject({ viaje: { codigo: "261001" }, embarque: { codigo: "261201" } });
    expect(calls()).toEqual([]);
  });

  it("aplicar: tres llamadas en tres transacciones por compra (importar, viaje, asignar); la línea queda en el embarque y la compra en el viaje (R21)", async () => {
    escenario.contadorNumero = 200;
    const { r, cuerpo } = await importarCompras_("aplicar", [gamma("1", { viaje: "261001", embarque: "261201" })]);
    expect(r.status, JSON.stringify(cuerpo)).toBe(200);
    expect(calls()).toEqual(["importar_compra", "asignar_viaje_compras", "aplicar_movimiento_agrupador"]);
    expect(cuerpo.data.agrupadores?.[0]).toMatchObject({ resultado: "asignado" });
    expect(cuerpo.data.agrupadores?.[0].no_asignado).toBeUndefined();
    const compra = tablaDe("compras").find((c) => c.numero === "C-000200")!;
    expect(compra.viaje_id).toBe(VIAJE_AGR.v261001);
    const asignaciones = tablaDe("compra_entrega_asignaciones");
    expect(asignaciones.map((a) => [a.embarque_id, a.paquete_id ?? null, a.unidades])).toEqual([[E.e261201, null, 200]]);
    // caso 15: reimportar es idempotente; la fila sigue `igual` y no vuelve a asignar ni a avisar
    const otra = await importarCompras_("aplicar", [gamma("1", { viaje: "261001", embarque: "261201" })]);
    expect(otra.cuerpo.data.totales).toMatchObject({ nuevas: 0, iguales: 1 });
    expect(otra.cuerpo.data.agrupadores?.[0]).toMatchObject({ resultado: "sin_cambio", avisos: [] });
    expect(calls()).toHaveLength(3);
    // una `igual` ya asignada a otro embarque no se toca: `agrupador_distinto`
    const distinto = await importarCompras_("aplicar", [gamma("1", { embarque: "270301" })]);
    expect(distinto.cuerpo.data.agrupadores?.[0]).toMatchObject({ resultado: "sin_cambio", avisos: ["agrupador_distinto"] });
    expect(tablaDe("compra_entrega_asignaciones")).toHaveLength(1);
  });

  it("caso 12: una línea `igual` sin asignación recibe el embarque al reimportar con la columna; el viaje cerrado se acepta con el aviso", async () => {
    escenario.contadorNumero = 200;
    await importarCompras_("aplicar", [gamma("1")]);
    expect(tablaDe("compra_entrega_asignaciones")).toEqual([]);
    fila("compra_viajes", VIAJE_AGR.v261001)!.estado = "cerrado";
    const { cuerpo } = await importarCompras_("aplicar", [gamma("1", { embarque: "261201", viaje: "261001" })]);
    expect(cuerpo.data.totales).toMatchObject({ nuevas: 0, iguales: 1 });
    expect(cuerpo.data.agrupadores?.[0]).toMatchObject({ resultado: "asignado", avisos: ["viaje_cerrado"] });
    expect(tablaDe("compra_entrega_asignaciones").map((a) => a.unidades)).toEqual([200]);
    expect(tablaDe("compras").find((c) => c.numero === "C-000200")?.viaje_id).toBe(VIAJE_AGR.v261001);
  });

  it("un corte entre las transacciones deja la compra importada sin agrupador y el reporte lo dice (§3.9, punto 4)", async () => {
    escenario.contadorNumero = 200;
    reemplazos.aplicar_movimiento_agrupador = () => ({ data: { ok: false, motivo: "embarque_no_editable" }, error: null });
    const { r, cuerpo } = await importarCompras_("aplicar", [gamma("1", { viaje: "261001", embarque: "261201" })]);
    expect(r.status).toBe(200);
    expect(cuerpo.data.aplicadas).toHaveLength(1);
    expect(cuerpo.data.agrupadores?.[0]).toMatchObject({ resultado: "sin_cambio", no_asignado: { motivo: "embarque_no_editable" } });
    expect(tablaDe("compras").find((c) => c.numero === "C-000200")?.viaje_id).toBe(VIAJE_AGR.v261001);
    expect(tablaDe("compra_entrega_asignaciones")).toEqual([]);
  });

  it("el guard de la carga inicial no cambia: el comprador recibe 403 y no se toca la base", async () => {
    entrarComo("c1");
    const r = await importarCompras(enviar("POST", "/compras/importar", { modo: "aplicar", carga_inicial: true, filas: [gamma("1", { embarque: "261201" })] }));
    expect(r.status).toBe(403);
    expect(calls()).toEqual([]);
  });
});

describe("errores de Postgres que la persona puede provocar: mensajes útiles (red de seguridad bajo los motivos de las funciones)", () => {
  const unico = (indice: string) => describirErrorDb("23505", `duplicate key value violates unique constraint "${indice}"`);
  it("los códigos repetidos de viajes, embarques y paquetes y la asignación repetida dicen qué pasó", () => {
    expect(unico("compra_viajes_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe un viaje con ese código." });
    expect(unico("compra_embarques_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe un embarque con ese código." });
    expect(unico("compra_paquetes_codigo_uniq")).toEqual({ status: 409, mensaje: "Ya existe un paquete con ese código." });
    expect(unico("compra_entrega_asignaciones_clave_uniq").mensaje).toMatch(/ya está asignada/);
  });
  it("una FK de agrupadores: apuntar a un viaje que no existe es 404 y borrar uno con hijos, 409", () => {
    expect(describirErrorDb("23503", 'insert or update on table "compras" violates foreign key constraint "compras_viaje_id_fkey"')).toEqual({ status: 404, mensaje: "No encontramos ese viaje." });
    expect(describirErrorDb("23503", 'update or delete on table "compra_viajes" violates foreign key constraint "compra_embarques_viaje_id_fkey"').status).toBe(409);
  });
});

// ─── 08b-1b T3a-1: fechas logísticas, ingreso por paquete, lista de embarques ───

describe("fechas logísticas (08b-1b §3.1 a §3.3): POST …/fechas, alias /fecha, ingreso por paquete y lecturas", () => {
  it("F44: solo el Arribo se aplica sin huella_plan; el Ingreso CD a otro mes la exige (`plan_cambio`), la vista previa la da y con ella se aplica", async () => {
    conCaso1();
    const arribo = await fechasDe(E.e261101, { revision: 1, fecha_arribo: "2026-11-10" });
    expect(arribo.status).toBe(200);
    const a = (await leer<RespuestaMovimientoApi>(arribo)).data;
    expect(a.embarque).toMatchObject({ fecha_puerto_estimada: "2026-11-10", revision: 2, fecha_llegada_estimada: "2026-11-20" });
    expect(a.compras).toEqual([]);
    expect(revisionCompra(COMPRA_AGR.c101)).toBe(3);

    const cuerpo = { revision: 2, fecha_ingreso_cd: "2026-12-03", motivo: "Aduana retiene el contenedor", causa: "aduana" };
    const sinHuella = await fechasDe(E.e261101, cuerpo);
    expect(sinHuella.status).toBe(409);
    expect((await leer(sinHuella)).codigo).toBe("plan_cambio");
    expect(escriturasAgr().filter((l) => l.nombre === "aplicar_movimiento_agrupador")).toHaveLength(1);

    const prev = (await leer<PlanFechasApi>(await fechasDe(E.e261101, cuerpo, "?previsualizar=1"))).data;
    expect(prev).toMatchObject({ reprograma: true, unidades_movidas: 300 });
    expect(prev.meses).toEqual([{ de: "2026-11", a: "2026-12", unidades: 300 }]);
    expect(prev.cambios.map((c) => c.hito)).toContain("ingreso_cd");
    expect(escriturasAgr().filter((l) => l.nombre === "aplicar_movimiento_agrupador")).toHaveLength(1);

    const otraHuella = await fechasDe(E.e261101, { ...cuerpo, huella_plan: "0".repeat(64) });
    expect((await leer(otraHuella)).codigo).toBe("plan_cambio");
    const r = await fechasDe(E.e261101, { ...cuerpo, huella_plan: prev.huella_plan });
    expect(r.status).toBe(200);
    expect((await leer<RespuestaMovimientoApi>(r)).data.embarque).toMatchObject({ fecha_llegada_estimada: "2026-12-03", periodo_llegada: "2026-12", revision: 3 });
    expect(escriturasAgr().at(-1)?.args.p_plan).toMatchObject({ causa: "aduana" });
  });

  it("reprogramar exige motivo y causa; sin ninguna clave de fecha es 400; las claves ausentes no viajan al plan", async () => {
    conCaso1();
    expect((await fechasDe(E.e261101, { revision: 1 })).status).toBe(400);
    const sinMotivo = await fechasDe(E.e261101, { revision: 1, fecha_ingreso_cd: "2026-11-28" });
    expect((await leer(sinMotivo)).codigo).toBe("motivo_requerido");
    const sinCausa = await fechasDe(E.e261101, { revision: 1, fecha_ingreso_cd: "2026-11-28", motivo: "Ajuste" });
    expect((await leer(sinCausa)).codigo).toBe("causa_requerida");
    expect(escriturasAgr()).toEqual([]);
    const ok = await fechasDe(E.e261101, { revision: 1, fecha_ingreso_cd: "2026-11-28", motivo: "Ajuste", causa: "programacion" });
    expect(ok.status).toBe(200);
    const emb = (escriturasAgr().at(-1)?.args.p_plan as { embarques: Record<string, unknown>[] }).embarques[0];
    expect(Object.keys(emb).sort()).toEqual(["fecha_llegada_estimada", "id", "revision"]);
    const igual = await fechasDe(E.e261101, { revision: 2, fecha_ingreso_cd: "2026-11-28" });
    expect((await leer(igual)).codigo).toBe("sin_cambios");
  });

  it("F23: el alias `/fecha` deja el embarque como `/fechas` con solo el Ingreso CD y causa `otro`", async () => {
    conCaso1();
    expect((await fechaDe(E.e261101, { revision: 1, fecha_llegada_estimada: "2026-11-28", motivo: "Ajuste menor" })).status).toBe(200);
    const alias = { ...fila("compra_embarques", E.e261101) };
    const aliasCompras = revisionCompra(COMPRA_AGR.c101);
    conCaso1();
    expect((await fechasDe(E.e261101, { revision: 1, fecha_ingreso_cd: "2026-11-28", motivo: "Ajuste menor", causa: "otro" })).status).toBe(200);
    const nuevo = fila("compra_embarques", E.e261101)!;
    for (const k of ["fecha_llegada_estimada", "periodo_llegada", "fecha_salida_estimada", "fecha_puerto_estimada", "revision"]) expect(nuevo[k]).toEqual(alias[k]);
    expect(revisionCompra(COMPRA_AGR.c101)).toBe(aliasCompras);
  });

  it("POST …/fechas: hito_confirmado sin otra fecha se acepta; en un embarque cancelado, `embarque_no_editable`; embarque desconocido, 404; revisión vieja, `agrupador_cambio`", async () => {
    conCaso1();
    vi.setSystemTime(new Date("2026-11-25T15:00:00.000Z"));
    const confirmar = await fechasDe(E.e261101, { revision: 1, hito_confirmado: "zarpe" });
    expect(confirmar.status).toBe(200);
    expect(fila("compra_embarques", E.e261101)?.hito_confirmado).toBe("zarpe");
    expect((await leer(await fechasDe(E.e261101, { revision: 1, fecha_arribo: "2026-11-10" }))).codigo).toBe("agrupador_cambio");
    expect((await fechasDe(INEXISTENTE, { revision: 1, fecha_arribo: "2026-11-10" })).status).toBe(404);
    fila("compra_embarques", E.e261201)!.estado = "cancelado";
    expect((await leer(await fechasDe(E.e261201, { revision: 1, fecha_arribo: "2026-12-01" }))).codigo).toBe("embarque_no_editable");
  });

  it("volver a planificado con un hito confirmado es 409 `hito_confirmado`", async () => {
    conCaso1();
    Object.assign(fila("compra_embarques", E.e261101)!, { estado: "en_transito", hito_confirmado: "zarpe" });
    const r = await estadoEmbarque(enviar("POST", "/x", { revision: 1, accion: "volver_a_planificado" }), ctx(E.e261101));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("hito_confirmado");
  });

  it("un interbloqueo o un candado que no llegó (`40P01`, `55P03`) es 409 `conflicto_reintentar`", async () => {
    conCaso1();
    for (const code of ["40P01", "55P03"]) {
      reemplazos.aplicar_movimiento_agrupador = () => ({ data: null, error: { code, message: "deadlock detected", details: null, hint: null } });
      const r = await fechasDe(E.e261101, { revision: 1, fecha_arribo: "2026-11-10" });
      expect(r.status).toBe(409);
      expect((await leer(r)).codigo).toBe("conflicto_reintentar");
    }
    reemplazos.guardar_embarque = () => ({ data: null, error: { code: "40P01", message: "deadlock detected", details: null, hint: null } });
    const e = await editarEmbarque(enviar("PATCH", "/x", { revision: 1, nombre: "x", tipo: "importacion", viaje_id: VIAJE_AGR.v261001, responsable_id: null }), ctx(E.e261101));
    expect((await leer(e)).codigo).toBe("conflicto_reintentar");
  });

  it("ingreso de un paquete: un mes distinto pide la huella (mueve la entrega); por debajo de la llegada se sube a ella con el aviso `ingreso_paquete_ajustado`", async () => {
    conCaso1();
    const cuerpo = { revision_embarque: 1, fecha_ingreso_stock: "2026-12-05", motivo: "El paquete sale después", causa: "programacion" };
    const sinHuella = await ingresoDe(PAQUETE_AGR.p261101, cuerpo);
    expect((await leer(sinHuella)).codigo).toBe("plan_cambio");
    const prev = (await leer<PlanFechasApi>(await ingresoDe(PAQUETE_AGR.p261101, cuerpo, "?previsualizar=1"))).data;
    expect(prev.meses).toEqual([{ de: "2026-11", a: "2026-12", unidades: 300 }]);
    const r = await ingresoDe(PAQUETE_AGR.p261101, { ...cuerpo, huella_plan: prev.huella_plan });
    expect(r.status).toBe(200);
    const { data } = await leer<RespuestaMovimientoApi>(r);
    expect(data.embarque.paquetes.find((p) => p.id === PAQUETE_AGR.p261101)).toMatchObject({ fecha_ingreso: "2026-12-05", ingreso_propio: true });
    expect(fila("compra_paquetes", PAQUETE_AGR.p261101)?.fecha_ingreso_estimada).toBe("2026-12-05");
    expect(data.embarque.asignaciones.find((x) => x.paquete_id === PAQUETE_AGR.p261101)).toMatchObject({ periodo: "2026-12", unidades: 300 });

    // Otro paquete, sin asignaciones: un ingreso anterior a la llegada (20-nov) se sube a ella (mismo mes: sin huella).
    const rev = revisionEmbarque(E.e261101);
    const ajustado = await ingresoDe(PAQUETE_AGR.p261102, { revision_embarque: rev, fecha_ingreso_stock: "2026-11-10", motivo: "Llega antes al almacén", causa: "programacion" });
    expect(ajustado.status).toBe(200);
    const aj = (await leer<RespuestaMovimientoApi>(ajustado)).data;
    expect(aj.avisos.map((x) => x.aviso)).toContain("ingreso_paquete_ajustado");
    expect(fila("compra_paquetes", PAQUETE_AGR.p261102)?.fecha_ingreso_estimada).toBe("2026-11-20");
    // Soltarlo: hereda el del embarque.
    const suelto = await ingresoDe(PAQUETE_AGR.p261102, { revision_embarque: revisionEmbarque(E.e261101), fecha_ingreso_stock: null, motivo: "Vuelve a seguir al embarque", causa: "programacion" });
    expect(suelto.status).toBe(200);
    expect(fila("compra_paquetes", PAQUETE_AGR.p261102)?.fecha_ingreso_estimada).toBeNull();
  });

  it("ingreso de un paquete: paquete desconocido, 404; paquete cancelado, `no_editable`; revisión vieja, `agrupador_cambio`", async () => {
    conCaso1();
    expect((await ingresoDe(INEXISTENTE, { revision_embarque: 1, fecha_ingreso_stock: "2026-11-25" })).status).toBe(404);
    expect((await leer(await ingresoDe(PAQUETE_AGR.p261101, { revision_embarque: 9, fecha_ingreso_stock: "2026-11-25" }))).codigo).toBe("agrupador_cambio");
    fila("compra_paquetes", PAQUETE_AGR.p261102)!.estado = "cancelado";
    expect((await leer(await ingresoDe(PAQUETE_AGR.p261102, { revision_embarque: 1, fecha_ingreso_stock: "2026-11-25" }))).codigo).toBe("no_editable");
  });

  it("lista y detalle de embarques traen hitos y reprogramaciones (agrupador_hitos_resumen); filtros `reprogramados` y `origen`", async () => {
    fila("compra_embarques", E.e261201)!.origen = "California";
    reemplazos.agrupador_hitos_resumen = () => ({ data: [{ embarque_id: E.e261201, paquete_id: null, hito: "ingreso_cd", fecha_original: "2026-12-01", reprogramaciones: 2, ultima_causa: "aduana" }], error: null });
    const codigos = async (consulta: string) => (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques", consulta)))).data.embarques.map((e) => e.codigo).sort();
    expect(await codigos("?reprogramados=1")).toEqual(["261201"]);
    expect(await codigos("?origen=california")).toEqual(["261201"]);
    expect(await codigos("?origen=Otro")).toEqual([]);
    const lista = (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques")))).data.embarques;
    const e = lista.find((x) => x.codigo === "261201")!;
    expect(e).toMatchObject({ origen: "California", reprogramaciones_total: 2 });
    expect(e.hitos?.map((h) => h.hito)).toEqual(["zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"]);
    expect(e.hitos?.find((h) => h.hito === "ingreso_cd")).toMatchObject({ fecha_original: "2026-12-01", reprogramaciones: 2 });
    const detalle = (await leer<{ embarque: EmbarqueDetalleApi }>(await unEmbarque(get("/x"), ctx(E.e261201)))).data.embarque;
    expect(detalle.reprogramaciones_total).toBe(2);
    expect(llamadasRpc("agrupador_hitos_resumen").length).toBeGreaterThan(0);
  });
});
