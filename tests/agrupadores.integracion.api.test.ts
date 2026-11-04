import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { escenario } from "./compras.fake-db";
import { entrarComo, iniciarAgrupadores } from "./agrupadores.fake-db";

// Mismo montaje que `agrupadores.handlers.test.ts` (T3b): servicio y handlers REALES sobre una base en memoria.
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

import { GET as listaViajes } from "@/app/api/compras/viajes/route";
import { GET as unViaje } from "@/app/api/compras/viajes/[id]/route";
import { POST as comprasDeViaje } from "@/app/api/compras/viajes/[id]/compras/route";
import { GET as listaEmbarques } from "@/app/api/compras/embarques/route";
import { POST as asignar } from "@/app/api/compras/embarques/[id]/asignar/route";
import { GET as opciones } from "@/app/api/compras/agrupadores/opciones/route";
import { GET as sinAsignar } from "@/app/api/compras/agrupadores/sin-asignar/route";
import { PUT as viajeActivo } from "@/app/api/compras/viaje-activo/route";
import { POST as importarCompras } from "@/app/api/compras/importar/route";
import { listarCompras, leerCompra, reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { comprasQuerySchema } from "@/lib/compras/esquemas";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { DetalleCompra } from "../src/components/compras/detalle-compra";
import { ListaCompras } from "../src/components/compras/lista-compras";
import { ReporteAgrupadoresCompras } from "../src/components/compras/reporte-agrupadores-compras";
import { entregasSinEmbarqueDeCompra, embarquesDeCompra, opcionesEmbarqueFiltro, unidadesSinEmbarque } from "../src/components/compras/vista-agrupadores-compras";
import { esPlan, urlEmbarques, urlSinAsignar } from "../src/lib/compras/agrupadores/use-agrupadores";
import { viajeActivoEfectivo, viajeParaApi, viajesParaSelector } from "../src/components/compras/agrupadores/vista-agrupadores";
import { urlCompras } from "../src/lib/compras/use-compras";
import type { EmbarqueApi, OpcionesAgrupadoresApi, PlanMovimientoApi, RespuestaAsignarViajeApi, RespuestaMovimientoApi, RespuestaViajesApi, SinAgrupadorApi, ViajeDetalleApi } from "../src/lib/compras/agrupadores/tipos-api";
import type { CompraApi, ReporteImportacionComprasApi } from "../src/lib/compras/tipos-api";
import { filasImportacionEjemplo } from "./compras.fixture";
import { ENTREGA_AGR, EMBARQUE_AGR as E, PERFIL_AGR, VIAJE_AGR } from "./agrupadores.fixture";

/**
 * Contrato T3a ↔ T3b ↔ T4 (08b-1): lo que las pantallas piden y esperan contra los handlers y el servicio REALES (con la base en memoria de
 * `agrupadores.fake-db.ts`, que simula las funciones de la `0032` con los espejos de T2). Las URL que arman los hooks de T3a y T4 se pasan
 * tal cual por los esquemas de consulta reales; las respuestas se leen con la forma que usan los componentes y se dibujan con ellos.
 */

const URL_BASE = "http://localhost";
const pedir = (url: string) => new NextRequest(`${URL_BASE}${url}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) => new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => ((await r.json()) as { data: T; error?: string; codigo?: string });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noop = () => {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  iniciarAgrupadores({ caso1: true });
  entrarComo("c1");
  reiniciarCaches();
  reiniciarCacheCatalogo();
});
afterEach(() => {
  vi.useRealTimers();
});

const usuario = () => ({ id: PERFIL_AGR.c1, nombre: "Comprador C1", rol: "comprador" as const });
const lista = async (consulta: Record<string, string>): Promise<CompraApi[]> => {
  const r = await listarCompras(supabaseAdmin() as never, usuario(), comprasQuerySchema.parse(consulta), null);
  if (r.respuesta) throw new Error("listarCompras falló");
  return r.data;
};
/** Los parámetros de una URL como los lee el servidor (lo que arma `urlCompras` debe pasar por `comprasQuerySchema`). */
const consultaDe = (url: string): Record<string, string> => Object.fromEntries(new URL(`${URL_BASE}${url}`).searchParams.entries());

describe("Compras (T4) contra la API real: lista, filtros y detalle", () => {
  it("las URL que arma la pantalla (viaje activo y embarque) las aceptan los esquemas reales y filtran como se espera", async () => {
    expect((await lista(consultaDe(urlCompras({ viaje_id: VIAJE_AGR.v261001 })))).map((c) => c.numero)).toEqual(["C-000101"]);
    expect((await lista(consultaDe(urlCompras({ viaje_id: "sin_viaje" })))).map((c) => c.numero).sort()).toEqual(["C-000102", "C-000103"]);
    expect((await lista(consultaDe(urlCompras({ embarque_id: E.e261201 })))).map((c) => c.numero)).toEqual(["C-000101"]);
    expect((await lista(consultaDe(urlCompras({})))).length).toBe(3);
    // «Todos» no manda viaje_id (`viajeParaApi`).
    expect(viajeParaApi("todos")).toBeUndefined();
    expect(viajeParaApi("sin_viaje")).toBe("sin_viaje");
  });

  it("la lista real se dibuja: viaje, embarques con su enlace y lo que queda sin embarque", async () => {
    const compras = await lista({});
    const c101 = compras.find((c) => c.numero === "C-000101")!;
    const embarques = embarquesDeCompra(c101);
    expect(embarques.map((e) => e.codigo)).toEqual(["261101", "261201"]);
    expect(unidadesSinEmbarque(c101)).toBe(1000); // el lote BETA de 1 000 u no tiene embarque
    const h = html(createElement(ListaCompras, { compras, enlace: (c) => `/compras/registro?compra=${c.id}` }));
    for (const t of ["C-000101", "261001", "261101", "261201", "1.000 u sin embarque".replace(".", ",")]) expect(h.includes(t) || h.includes(t.replace(",", " ")) || h.includes(t.replace(",", ".")), t).toBe(true);
    expect(h).toContain(`/compras/agrupadores?embarque=${E.e261101}`);
  });

  it("el detalle real (GET /api/compras/[id]) trae viaje, asignaciones y sin_embarque y la pantalla los muestra con los botones de los tres roles", async () => {
    const compras = await lista({});
    const id = compras.find((c) => c.numero === "C-000101")!.id;
    const r = await leerCompra(supabaseAdmin() as never, usuario(), id, null);
    expect(r.respuesta).toBeNull();
    const c = r.data!;
    expect(c.viaje).toMatchObject({ codigo: "261001", estado: "abierto" });
    expect(c.lineas.flatMap((l) => l.entregas).every((e) => Array.isArray(e.asignaciones) && typeof e.sin_embarque === "number")).toBe(true);
    // El comprador no escribe M8 (`puedeEscribir = false`) y aun así cambia el viaje y asigna a un embarque (decisión 92).
    const h = html(createElement(DetalleCompra, { compra: c, puedeEscribir: false, onConfirmarIngreso: noop, onQuitarIngreso: noop, onCancelar: noop, onCambiarViaje: noop, onAsignarEmbarque: noop }));
    for (const t of ["261001 · Feria Sur", "Embarque 261101 · P 261101 · 300 u", "Embarque 261201", "sin embarque", ">Cambiar<", "Asignar a embarque…"]) expect(h, t).toContain(t);
    // Las entregas sin embarque que ofrece son las del lote BETA.
    expect(entregasSinEmbarqueDeCompra(c).map((e) => e.sin_asignar)).toEqual([600, 400]);
  });

  it("asignar a un embarque desde Compras: el cuerpo que arma la pantalla (entregaComoSinEmbarque) lo acepta el handler real", async () => {
    const c102 = (await lista({})).find((c) => c.numero === "C-000102")!;
    const [e] = entregasSinEmbarqueDeCompra(c102);
    expect(e).toMatchObject({ entrega_id: ENTREGA_AGR.c102Nov, sin_asignar: 400, compra: { revision: c102.revision } });
    const emb = (await leer<EmbarqueApi>(await listaEmbarques(pedir("/api/compras/embarques")))).data as unknown as { embarques: EmbarqueApi[] };
    const destino = emb.embarques.find((x) => x.codigo === "261201")!;
    const cuerpo = { revision: destino.revision, paquete_id: null, items: [{ entrega_id: e.entrega_id, unidades: e.sin_asignar, compra_revision: e.compra.revision }] };
    const prev = await leer<PlanMovimientoApi>(await asignar(enviar("POST", `/api/compras/embarques/${destino.id}/asignar?previsualizar=1`, cuerpo), ctx(destino.id)));
    expect(esPlan(prev.data)).toBe(true);
    const real = await asignar(enviar("POST", `/api/compras/embarques/${destino.id}/asignar`, { ...cuerpo, huella_plan: prev.data.huella_plan }), ctx(destino.id));
    expect(real.status, JSON.stringify(await real.clone().json())).toBe(200);
    const r = await leer<RespuestaMovimientoApi>(real);
    expect(esPlan(r.data)).toBe(false);
    expect(r.data.embarque.codigo).toBe("261201");
    // Releída la compra, el chip aparece en dic-26 (la entrega pasó al mes del embarque) y ya no queda nada sin embarque.
    const despues = (await lista({})).find((c) => c.numero === "C-000102")!;
    expect(embarquesDeCompra(despues).map((x) => x.codigo)).toEqual(["261201"]);
    expect(unidadesSinEmbarque(despues)).toBe(0);
    expect(despues.revision).toBe(c102.revision + 1);
  });

  it("cambiar el viaje de una compra (comprador): POST /viajes/[id]/compras responde { viaje, compras, avisos } y sube la revisión", async () => {
    const c102 = (await lista({})).find((c) => c.numero === "C-000102")!;
    const cuerpo = { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c102.id, revision: c102.revision }] };
    const r = await comprasDeViaje(enviar("POST", `/api/compras/viajes/${VIAJE_AGR.v261001}/compras`, cuerpo), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaAsignarViajeApi>(r)).data;
    expect(Array.isArray(d.avisos)).toBe(true);
    expect(d.compras).toEqual([{ id: c102.id, revision: c102.revision + 1 }]);
    expect((await lista({})).find((c) => c.numero === "C-000102")?.viaje?.codigo).toBe("261001");
    // Con la revisión vieja, `compra_cambio` (la pantalla relee con `pideRelectura`).
    const viejo = await comprasDeViaje(enviar("POST", `/api/compras/viajes/${VIAJE_AGR.v261001}/compras`, { viaje_id: null, compras: [{ id: c102.id, revision: c102.revision }] }), ctx(VIAJE_AGR.v261001));
    expect(viejo.status).toBe(409);
    expect((await leer(viejo)).codigo).toBe("compra_cambio");
    // Quitarlo: la ruta es la del viaje actual y `viaje_id` va nulo.
    const nueva = (await lista({})).find((c) => c.numero === "C-000102")!;
    const quitar = await comprasDeViaje(enviar("POST", `/api/compras/viajes/${VIAJE_AGR.v261001}/compras`, { viaje_id: null, compras: [{ id: nueva.id, revision: nueva.revision }] }), ctx(VIAJE_AGR.v261001));
    expect(quitar.status).toBe(200);
    expect((await lista({})).find((c) => c.numero === "C-000102")?.viaje).toBeNull();
  });

  it("un viaje cerrado igual acepta compras y avisa (decisión 95): el aviso llega en `avisos` para mostrarse", async () => {
    const { tablaDe } = await import("./compras.fake-db");
    tablaDe("compra_viajes").find((v) => v.id === VIAJE_AGR.v261001)!.estado = "cerrado";
    const c102 = (await lista({})).find((c) => c.numero === "C-000102")!;
    const r = await comprasDeViaje(enviar("POST", `/api/compras/viajes/${VIAJE_AGR.v261001}/compras`, { viaje_id: VIAJE_AGR.v261001, compras: [{ id: c102.id, revision: c102.revision }] }), ctx(VIAJE_AGR.v261001));
    expect(r.status).toBe(200);
    expect((await leer<RespuestaAsignarViajeApi>(r)).data.avisos.map((a) => a.aviso)).toEqual(["viaje_cerrado"]);
  });
});

describe("Lo que T3a asume de las lecturas de T3b", () => {
  it("viajes: `{ viajes, asignables }`; el viaje activo por defecto sale del responsable (C1 es responsable del 261001)", async () => {
    const d = (await leer<RespuestaViajesApi>(await listaViajes(pedir("/api/compras/viajes")))).data;
    expect(d.viajes.map((v) => v.codigo)).toEqual(["261001"]);
    expect(d.asignables.length).toBeGreaterThan(0);
    expect(viajeActivoEfectivo(null, d.viajes, PERFIL_AGR.c1)).toBe(VIAJE_AGR.v261001);
    expect(viajeActivoEfectivo(null, d.viajes, PERFIL_AGR.c2)).toBe("todos");
    expect(viajeActivoEfectivo("basura-que-ya-no-existe", d.viajes, PERFIL_AGR.c2)).toBe("todos");
  });

  it("detalle del viaje: `{ viaje, compras, embarques }`", async () => {
    const d = (await leer<ViajeDetalleApi>(await unViaje(pedir("/x"), ctx(VIAJE_AGR.v261001)))).data;
    expect(d.viaje.codigo).toBe("261001");
    expect(d.compras.map((c) => c.numero)).toEqual(["C-000101"]);
    expect(d.embarques.length).toBeGreaterThan(0);
  });

  it("embarques: las URL de los filtros de T3a pasan por el esquema real", async () => {
    const r = await listaEmbarques(pedir(urlEmbarques({ viaje_id: VIAJE_AGR.v261001, estado: "planificado", tipo: "importacion", desde: "2026-11", hasta: "2026-12", atrasados: false })));
    expect(r.status).toBe(200);
    // La API no promete orden: la pantalla ordena por llegada y código (`ordenarEmbarques`).
    expect((await leer<{ embarques: EmbarqueApi[] }>(r)).data.embarques.map((e) => e.codigo).sort()).toEqual(["261101", "261201"]);
    expect((await listaEmbarques(pedir(urlEmbarques({ viaje_id: "sin_viaje" })))).status).toBe(200);
  });

  it("opciones: viajes, embarques, paquetes, asignables y puertos; el filtro de embarque de Compras sale de ahí", async () => {
    const d = (await leer<OpcionesAgrupadoresApi>(await opciones())).data;
    expect(d.viajes.length).toBeGreaterThan(0);
    expect(d.embarques.length).toBeGreaterThan(0);
    expect(Array.isArray(d.puertos)).toBe(true);
    expect(opcionesEmbarqueFiltro(d.embarques).map((o) => o.nombre.split(" · ")[0])).toEqual(expect.arrayContaining(["Embarque 261101", "Embarque 261201"]));
    expect(viajesParaSelector(d.viajes).map((v) => v.codigo)).toEqual(["261001"]);
  });

  it("sin-asignar: entregas con `sin_asignar` y `compra.revision`, y compras sin viaje con `revision` y `origen`", async () => {
    const r = await sinAsignar(pedir(urlSinAsignar({ viaje_id: undefined })));
    const d = (await leer<SinAgrupadorApi>(r)).data;
    expect(d.entregas.every((e) => typeof e.sin_asignar === "number" && typeof e.compra.revision === "number")).toBe(true);
    expect(d.compras_sin_viaje.every((c) => typeof c.revision === "number" && typeof c.origen === "string")).toBe(true);
    expect((await sinAsignar(pedir(urlSinAsignar({ desde: "2026-11", hasta: "2026-12", proveedor_id: undefined })))).status).toBe(200);
  });

  it("viaje-activo: `{ viaje_activo }` y una cookie; un viaje que no existe da 404", async () => {
    const r = await viajeActivo(enviar("PUT", "/api/compras/viaje-activo", { viaje_id: VIAJE_AGR.v261001 }));
    expect(r.status).toBe(200);
    expect((await leer<{ viaje_activo: string }>(r)).data.viaje_activo).toBe(VIAJE_AGR.v261001);
    expect(r.headers.get("set-cookie") ?? "").toContain("v2_viaje_activo=");
    expect((await viajeActivo(enviar("PUT", "/api/compras/viaje-activo", { viaje_id: "00000000-0000-4000-8000-999999999999" }))).status).toBe(404);
  });
});

describe("Importador de compras (T4) como comprador, con VIAJE, EMBARQUE y PAQUETE", () => {
  const gamma = (ordinal: string, extra: Record<string, string> = {}) => ({ ...filasImportacionEjemplo()[1], linea_ordinal: ordinal, llegada: "2026-12", recibidas: "", ...extra });

  it("el comprador previsualiza y aplica sin carga inicial: sale 200, en borrador, y el reporte trae `agrupadores` para dibujarlo", async () => {
    escenario.contadorNumero = 200;
    entrarComo("c1");
    const filas = [gamma("1", { viaje: "261001", embarque: "261201" }), gamma("2", { embarque: "999999" })];
    const prev = await importarCompras(enviar("POST", "/api/compras/importar", { modo: "previsualizar", carga_inicial: false, filas }));
    const cuerpo = await leer<ReporteImportacionComprasApi>(prev);
    expect(prev.status, JSON.stringify(cuerpo)).toBe(200);
    expect(cuerpo.data.agrupadores?.map((a) => [a.fila, a.resultado, a.motivo ?? null])).toEqual([[1, "asignado", null], [2, "omitido", "embarque_desconocido"]]);
    const h = html(createElement(ReporteAgrupadoresCompras, { filas: cuerpo.data.agrupadores ?? [], aplicado: false }));
    expect(h).toContain("Viaje 261001");
    expect(h).toContain("El embarque no existe");

    const aplicar = await importarCompras(enviar("POST", "/api/compras/importar", { modo: "aplicar", carga_inicial: false, filas }));
    const fin = await leer<ReporteImportacionComprasApi>(aplicar);
    expect(aplicar.status, JSON.stringify(fin)).toBe(200);
    expect(fin.data.aplicadas).toHaveLength(1);
    const { tablaDe } = await import("./compras.fake-db");
    const nueva = tablaDe("compras").find((c) => c.numero === "C-000200")!;
    expect(nueva.estado).toBe("borrador");
    expect(nueva.origen).toBe("comprador");
    expect(nueva.viaje_id).toBe(VIAJE_AGR.v261001);
  });

  it("el comprador con carga inicial recibe 403 con el mensaje que la pantalla muestra tal cual", async () => {
    entrarComo("c1");
    const r = await importarCompras(enviar("POST", "/api/compras/importar", { modo: "previsualizar", carga_inicial: true, filas: [gamma("1")] }));
    expect(r.status).toBe(403);
    expect((await leer(r)).error).toMatch(/carga inicial/i);
  });

  it("el planner sigue importando la carga inicial con las mismas columnas", async () => {
    escenario.contadorNumero = 200;
    entrarComo("a");
    const r = await importarCompras(enviar("POST", "/api/compras/importar", { modo: "previsualizar", carga_inicial: true, filas: [gamma("1", { viaje: "261001", embarque: "261201" })] }));
    expect(r.status).toBe(200);
    expect((await leer<ReporteImportacionComprasApi>(r)).data.agrupadores?.[0]).toMatchObject({ resultado: "asignado" });
  });
});
