import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { NodoInfo } from "@/lib/arbol/nivel/indice";
import { estadoFalso } from "./curvas.fake-db";
import { bd, reiniciarBd } from "./marcas-barrer.fake-db";
import { esc, reiniciarEsc, rpcFalso } from "./marcas-barrer.escenario";

// Los módulos de la base y del contexto se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteBd } = await import("./marcas-barrer.fake-db");
  return { supabaseAdmin: () => clienteBd() };
});
vi.mock("@/lib/marcas/gml/estado", async () => {
  const { esc: e } = await import("./marcas-barrer.escenario");
  return { cargarEstadoGml: async () => ({ error: null, estado: e.estado(), marcas: e.estado().marcas, arbol: {} }) };
});
vi.mock("@/lib/proyeccion/contexto", async () => {
  const { ctxFalso } = await import("./marcas-barrer.escenario");
  return { cargarContextoCalculo: async () => ({ data: ctxFalso(), respuesta: null }) };
});
vi.mock("@/lib/arbol/consultas", async (original) => {
  const real = await original<typeof import("@/lib/arbol/consultas")>();
  const { equivalenciasFalsas } = await import("./marcas-barrer.escenario");
  return { ...real, leerEquivalencias: async () => ({ data: equivalenciasFalsas(), error: null }) };
});
vi.mock("@/lib/proyeccion/servicio", async () => {
  const { respuestaCerrada } = await import("./marcas-barrer.escenario");
  return { leerProyeccionCerrada: async (anio: number) => respuestaCerrada(anio) };
});

import { GET as lista } from "@/app/api/marcas-barrer/route";
import { GET as analisis } from "@/app/api/marcas-barrer/[marcaId]/route";
import { GET as versiones, POST as aprobar } from "@/app/api/marcas-barrer/[marcaId]/repartos/route";
import { GET as vigentes } from "@/app/api/marcas-barrer/vigentes/route";
import type { AnalisisMarcaApi, ListaBarrerApi, RepartoApi, RepartosVigentesApi } from "@/lib/marcas-barrer/tipos-api";
import { AM, CLAVE, GEN, MARCA, NODO, estadoB, hechosBeta, marcasB, asignacionesB, OTROS } from "./marcas-barrer.fixture";

/**
 * Handlers de M12 con el servicio REAL: permisos (401 y 403), validaciones (400), 404 y 409, el flujo de aprobar (versiones,
 * idempotencia, `huella`), el contrato de M8 (`vigentes`) y la obsolescencia sin recalcular (reglas 12 y casos 8 a 11 de la ficha).
 */

const URL_BASE = "http://localhost/api/marcas-barrer";
const get = (ruta = "", consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const post = (ruta: string, cuerpo: unknown) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (marcaId: string) => ({ params: Promise.resolve({ marcaId }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const cuerpoBase = (a: AnalisisMarcaApi, extra: Record<string, unknown> = {}) => ({
  ventana_meses: a.parametros.ventana_meses,
  modo: a.parametros.modo,
  fuente: "historico",
  alcance: {},
  normaliza_nino: a.parametros.normaliza_nino,
  huella: a.huella,
  filas: [] as unknown[],
  ...extra,
});

async function analizar(marcaId: string, consulta = "") {
  const r = await analisis(get(`/${marcaId}`, consulta), ctx(marcaId));
  return { r, cuerpo: await leer<AnalisisMarcaApi>(r) };
}

async function aprobarBeta(extra: Record<string, unknown> = {}, consulta = "") {
  const { cuerpo } = await analizar(MARCA.beta, consulta);
  const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(cuerpo.data, extra)), ctx(MARCA.beta));
  return { r, analisis: cuerpo.data, cuerpo: await leer<RepartoApi>(r) };
}

const versionesDb = () => bd.tablas.repartos_marca_barrido;
const filasDb = () => bd.tablas.reparto_marca_barrido_gml;

beforeEach(() => {
  reiniciarBd();
  reiniciarEsc();
  estadoFalso.rol = "planner";
  bd.rpc = rpcFalso;
});

describe("permisos: sin sesión 401 y comprador 403 en las cinco rutas, sin tocar datos", () => {
  for (const rol of ["sin_sesion", "comprador"] as const) {
    it(`${rol}`, async () => {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await lista(get())).status).toBe(esperado);
      expect((await analisis(get(`/${MARCA.beta}`), ctx(MARCA.beta))).status).toBe(esperado);
      expect((await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta))).status).toBe(esperado);
      expect((await aprobar(post(`/${MARCA.beta}/repartos`, {}), ctx(MARCA.beta))).status).toBe(esperado);
      expect((await vigentes(get("/vigentes"))).status).toBe(esperado);
      expect(bd.tablasTocadas).toEqual([]);
      expect(bd.llamadasRpc).toEqual([]);
      expect(esc.llamadasCerrada).toEqual([]);
    });
  }
});

describe("GET /api/marcas-barrer: la lista (paso 0)", () => {
  it("una fila por marca al barrer o mixta (ALFA, por_gml, no sale), con sus unidades, la parte específica y 'sin reparto'", async () => {
    const r = await lista(get());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const { data } = await leer<ListaBarrerApi>(r);
    expect(data.datos).toMatchObject({ hasta_periodo: "2026-09", desde_periodo: "2024-10", ventana: 24, cargas: 24 });
    expect(data.marcas.map((m) => m.nombre)).toEqual(["BETA", "GAMMA", "DELTA"]);
    const beta = data.marcas[0];
    expect(beta).toMatchObject({ modalidad: "barrido", unidades_ventana: 4370, unidades_barrer: 4370, unidades_especificas: 0, gml_con_venta: 12, gml_pequenos: 9, gml_especificos: 0, estado: "sin_reparto", vigente: null, miembros: ["BETA UNO"] });
    expect(beta.share_barrido).toBe(1);
    expect(beta.agrupacion_marca).toEqual({ id: AM.pre, nombre: "PREMIUM" });
    expect(beta.avisos).toContain("sin_reparto");
    const gamma = data.marcas[1];
    expect(gamma).toMatchObject({ modalidad: "mixta", unidades_ventana: 2400, unidades_barrer: 1440, unidades_especificas: 960, gml_con_venta: 1, gml_especificos: 1 });
    expect(gamma.share_barrido).toBeCloseTo(0.6, 9);
    expect(data.marcas[2]).toMatchObject({ nombre: "DELTA", unidades_ventana: 0, share_barrido: null });
    expect(data.marcas[2].avisos).toEqual(expect.arrayContaining(["sin_venta_barrer", "sin_reparto"]));
    expect(data.resumen).toEqual({ marcas: 3, sin_reparto: 3, obsoletas: 0, mixtas: 1, inestables: 0, unidades_barrer: 5810 });
    // Los ids de género, mundo y línea de la venta al barrer sirven para los filtros de la lista.
    expect(beta.genero_ids).toEqual([GEN.hombre, GEN.mujer].sort());
  });
  it("la lista sale de la función resumen: no lee hechos por mes (una sola llamada, la del resumen)", async () => {
    await lista(get());
    expect(bd.llamadasRpc.map((l) => l.nombre)).toEqual(["venta_marca_gml_resumen"]);
    expect(bd.llamadasRpc[0].args).toMatchObject({ p_desde: "2024-10-01", p_hasta: "2026-09-01", p_umbral_pequeno: 50 });
  });
  it("?ventana= 12 y 36; otro valor → 400 con el mensaje", async () => {
    expect((await leer<ListaBarrerApi>(await lista(get("", "?ventana=12")))).data.datos.desde_periodo).toBe("2025-10");
    expect((await leer<ListaBarrerApi>(await lista(get("", "?ventana=36")))).data.datos.desde_periodo).toBe("2023-10");
    const mala = await lista(get("", "?ventana=7"));
    expect(mala.status).toBe(400);
    expect((await leer(mala)).error).toBe("ventana: La ventana debe ser 12, 24, 36 meses.");
    expect((await lista(get("", "?ventana=abc"))).status).toBe(400);
  });
  it("GET no escribe: ninguna operación de escritura sobre las tablas de repartos", async () => {
    await lista(get());
    await analizar(MARCA.beta);
    expect(versionesDb()).toEqual([]);
    expect(filasDb()).toEqual([]);
  });
});

describe("GET /api/marcas-barrer/[marcaId]: el análisis", () => {
  it("BETA: reparto por temporada, huella, sin vigente y avisos", async () => {
    const { r, cuerpo } = await analizar(MARCA.beta);
    expect(r.status).toBe(200);
    const a = cuerpo.data;
    expect(a.marca).toMatchObject({ id: MARCA.beta, nombre: "BETA", modalidad: "barrido", agrupacion_marca: "PREMIUM", miembros: ["BETA UNO"] });
    expect(a.parametros).toMatchObject({ ventana_meses: 24, modo: "por_temporada", modo_efectivo: "por_temporada", normaliza_nino: true, hasta_periodo: "2026-09" });
    expect(a.parametros.fuente_disponible).toEqual(["historico", "cerrada"]);
    expect(a.filas.length).toBe(12);
    expect(a.restos).toHaveLength(2);
    expect(typeof a.huella).toBe("string");
    expect(a.vigente).toBeNull();
    expect(a.obsoleto).toEqual([]);
    expect(a.avisos).toContain("sin_reparto");
    expect(a.share_barrido).toBe(1);
    // La cerrada de M7 se pidió por los dos años que cubren los doce meses siguientes.
    expect(esc.llamadasCerrada).toEqual([2026, 2027]);
  });
  it("parámetros por la URL: ventana, modo, normaliza_nino y alcance por ids", async () => {
    const { cuerpo } = await analizar(MARCA.beta, `?ventana=12&modo=anual&normaliza_nino=0&genero=${GEN.hombre}`);
    const a = cuerpo.data;
    expect(a.parametros).toMatchObject({ ventana_meses: 12, modo: "anual", modo_efectivo: "anual", normaliza_nino: false });
    expect(a.parametros.alcance).toEqual({ generos: [GEN.hombre], mundos: [], lineas: [] });
    expect(a.fuera_de_alcance).toEqual([{ ruta: "MUJER · CASUAL · SANDALIA", unidades: 240 }]);
  });
  it("sin proyección cerrada el análisis sigue: p2.cerrada es null y avisa sin_cerrada", async () => {
    esc.hayCerrada = false;
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    expect(a.parametros.fuente_disponible).toEqual(["historico"]);
    expect(a.avisos).toContain("sin_cerrada");
    expect(a.filas[0].p2[0].cerrada).toBeNull();
  });
  it("404 si la marca no existe o el id no es UUID; 409 modalidad_no_barrer (ALFA por_gml) y marca_en_conjunto (BETA UNO)", async () => {
    expect((await analizar(INEXISTENTE)).r.status).toBe(404);
    expect((await analizar("no-es-uuid")).r.status).toBe(404);
    const alfa = await analizar(MARCA.alfa);
    expect(alfa.r.status).toBe(409);
    expect(alfa.cuerpo.codigo).toBe("modalidad_no_barrer");
    expect(alfa.cuerpo.error).toContain("ALFA");
    const miembro = await analizar(MARCA.betaUno);
    expect(miembro.r.status).toBe(409);
    expect(miembro.cuerpo.codigo).toBe("marca_en_conjunto");
    expect(miembro.cuerpo.error).toBe("BETA UNO cuenta como BETA: el reparto se aprueba en BETA.");
  });
  it("apagar la bandera de la mixta (GAMMA) → 409 modalidad_no_barrer", async () => {
    esc.estado = () => estadoB({ marcas: marcasB().map((m) => (m.id === MARCA.gamma ? { ...m, resto_al_barrer: false } : m)) });
    const g = await analizar(MARCA.gamma);
    expect(g.r.status).toBe(409);
    expect(g.cuerpo.codigo).toBe("modalidad_no_barrer");
  });
  it("una agrupación inactiva deja a la marca fuera del análisis (409)", async () => {
    esc.estado = () => estadoB({ agrupaciones: estadoB().agrupaciones.map((a) => (a.id === AM.pre ? { ...a, activo: false } : a)) });
    expect((await analizar(MARCA.beta)).r.status).toBe(409);
  });
  it("validaciones de la consulta (400): ventana, modo, normaliza_nino y ids del alcance", async () => {
    for (const q of ["?ventana=5", "?modo=por_mes", "?normaliza_nino=quizas", "?genero=no-uuid", "?mundo=1,2", "?lineas=x"]) {
      const r = await analisis(get(`/${MARCA.beta}`, q), ctx(MARCA.beta));
      expect(r.status, q).toBe(400);
    }
  });
  it("sin meses publicados y cerrados → 409 sin_datos (el análisis y aprobar); la lista sigue sin fallar", async () => {
    esc.k = "";
    const a = await analizar(MARCA.beta);
    expect(a.r.status).toBe(409);
    expect(a.cuerpo.codigo).toBe("sin_datos");
    const cuerpo = { ventana_meses: 24, modo: "por_temporada", fuente: "historico", alcance: {}, normaliza_nino: true, huella: "h", filas: [] };
    expect((await leer(await aprobar(post(`/${MARCA.beta}/repartos`, cuerpo), ctx(MARCA.beta)))).codigo).toBe("sin_datos");
    const l = await leer<ListaBarrerApi>(await lista(get()));
    expect(l.data.datos).toMatchObject({ hasta_periodo: null, desde_periodo: null, cargas: 0 });
    expect(l.data.marcas.every((m) => m.unidades_ventana === 0)).toBe(true);
  });
});

describe("POST /api/marcas-barrer/[marcaId]/repartos: aprobar (casos 8 y 9)", () => {
  it("v1 sin ajuste: 201, a nombre de quien aprueba y con su fecha; guarda una fila por g y temporada que suman 1; la lista y el análisis lo ven al día", async () => {
    const { r, cuerpo, analisis: a } = await aprobarBeta();
    expect(r.status).toBe(201);
    const v = cuerpo.data;
    expect(v).toMatchObject({ marca_id: MARCA.beta, version: 1, vigente: true, ventana_meses: 24, modo: "por_temporada", fuente: "historico", hasta_periodo: "2026-09", normaliza_nino: true, aprobada_por_nombre: "Javier", nota: null });
    expect(v.aprobada_por_id).toBe("99999999-9999-4999-8999-999999999999");
    expect(v.aprobada_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(v.share_barrido).toBe(1);
    expect(v.huella_config.split(".")).toHaveLength(3);
    expect(v.huella_cargas).toHaveLength(32);
    expect(v.alcance).toEqual({ generos: [], mundos: [], lineas: [] });
    expect(v.filas.filter((f) => f.temporada === "verano")).toHaveLength(9);
    expect(v.filas.filter((f) => f.temporada === "invierno")).toHaveLength(6);
    for (const t of ["verano", "invierno"]) expect(Math.round(v.filas.filter((f) => f.temporada === t).reduce((x, f) => x + f.participacion_vigente, 0) * 1e4)).toBe(10000);
    expect(v.filas.find((f) => f.gml_id === NODO.denim && f.temporada === "verano")?.ruta).toBe("HOMBRE · URBANO · DENIM");
    expect(v.factores_usados.map((f) => [f.anio, f.temporada])).toEqual([[2026, "invierno"], [2026, "verano"]]);
    expect(versionesDb()).toHaveLength(1);
    expect(versionesDb()[0].vigente).toBe(true);
    expect(filasDb().length).toBe(15);

    const despues = (await analizar(MARCA.beta)).cuerpo.data;
    expect(despues.vigente).toMatchObject({ version: 1, modo: "por_temporada", fuente: "historico", aprobada_por_nombre: "Javier" });
    expect(despues.obsoleto).toEqual([]);
    expect(despues.vigente?.diferencia_pp).toBeLessThan(0.01);
    expect(despues.avisos).not.toContain("sin_reparto");
    // La huella no cambió porque el reparto vigente no entra en ella.
    expect(despues.huella).toBe(a.huella);
    const fila = (await leer<ListaBarrerApi>(await lista(get()))).data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(fila).toMatchObject({ estado: "al_dia", vigente: { version: 1, aprobada_por_nombre: "Javier" }, diferencia_pp: 0 });
    expect(fila.avisos).not.toContain("sin_reparto");
  });

  it("otra vez con la misma huella → v2 y v1.vigente = false: siempre UNA vigente por marca", async () => {
    await aprobarBeta();
    const v2 = await aprobarBeta();
    expect(v2.r.status).toBe(201);
    expect(v2.cuerpo.data.version).toBe(2);
    expect(versionesDb().map((v) => [v.version, v.vigente])).toEqual([[1, false], [2, true]]);
    expect(versionesDb().filter((v) => v.vigente)).toHaveLength(1);
    const todas = await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)));
    expect(todas.data.map((v) => [v.version, v.vigente])).toEqual([[2, true], [1, false]]);
    expect(todas.data[0].filas.length).toBe(15);
  });

  it("sin nota con ventana de 12 → 409 nota_requerida y no escribe; con nota aprueba", async () => {
    const { cuerpo: a } = await analizar(MARCA.beta, "?ventana=12");
    const sin = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data)), ctx(MARCA.beta));
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("nota_requerida");
    expect(versionesDb()).toHaveLength(0);
    const con = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data, { nota: "ventana corta" })), ctx(MARCA.beta));
    expect(con.status).toBe(201);
    expect((await leer<RepartoApi>(con)).data).toMatchObject({ ventana_meses: 12, nota: "ventana corta" });
  });

  it("ajustar DENIM (verano) a 0,50: sin renormalizar → suma_invalida; renormalizado sin nota → nota_requerida; con nota → v1 con el ajuste", async () => {
    const { cuerpo: c } = await analizar(MARCA.beta);
    const a = c.data;
    const denim = a.filas.find((f) => f.clave === CLAVE.denim)!.p2.find((p) => p.temporada === "verano")!.historico;
    const mala = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a, { nota: "x", filas: [{ genero_mundo_linea_id: NODO.denim, equivalencia_id: null, temporada: "verano", participacion_ajustada: 0.5 }] })), ctx(MARCA.beta));
    expect(mala.status).toBe(409);
    expect((await leer(mala)).codigo).toBe("suma_invalida");
    const filas = a.filas
      .filter((f) => f.p2.some((p) => p.temporada === "verano" && p.historico > 0))
      .map((f) => ({
        genero_mundo_linea_id: f.gml_id,
        equivalencia_id: f.equivalencia_id,
        temporada: "verano",
        participacion_ajustada: f.clave === CLAVE.denim ? 0.5 : (f.p2.find((p) => p.temporada === "verano")!.historico * 0.5) / (1 - denim),
      }));
    const sinNota = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a, { filas })), ctx(MARCA.beta));
    expect(sinNota.status).toBe(409);
    expect((await leer(sinNota)).codigo).toBe("nota_requerida");
    expect(versionesDb()).toHaveLength(0);
    const ok = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a, { filas, nota: "BETA se compra más en DENIM" })), ctx(MARCA.beta));
    expect(ok.status).toBe(201);
    const v = (await leer<RepartoApi>(ok)).data;
    const d = v.filas.find((f) => f.gml_id === NODO.denim && f.temporada === "verano")!;
    expect(d).toMatchObject({ participacion_ajustada: 0.5 });
    expect(d.participacion_calculada).toBeCloseTo(denim, 3);
    expect(v.nota).toBe("BETA se compra más en DENIM");
    // El análisis siguiente muestra lo ajustado en la columna del vigente.
    const siguiente = (await analizar(MARCA.beta)).cuerpo.data;
    expect(siguiente.filas.find((f) => f.clave === CLAVE.denim)!.p2.find((p) => p.temporada === "verano")).toMatchObject({ ajustado_vigente: 0.5 });
  });

  it("con una huella distinta de la del análisis → 409 huella_cambiada y no escribe", async () => {
    const { cuerpo: a } = await analizar(MARCA.beta);
    const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data, { huella: "huella-vieja" })), ctx(MARCA.beta));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("huella_cambiada");
    expect(versionesDb()).toHaveLength(0);
    expect(filasDb()).toHaveLength(0);
  });

  it("fuente cerrada: sin cerrada → 409 sin_cerrada; con cerrada y nota → v1 con fuente cerrada y el reparto 50/50", async () => {
    esc.hayCerrada = false;
    const { cuerpo: a } = await analizar(MARCA.beta);
    const sin = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data, { fuente: "cerrada", nota: "x" })), ctx(MARCA.beta));
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("sin_cerrada");
    esc.hayCerrada = true;
    const { cuerpo: b } = await analizar(MARCA.beta);
    expect((await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(b.data, { fuente: "cerrada" })), ctx(MARCA.beta))).status).toBe(409);
    const ok = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(b.data, { fuente: "cerrada", nota: "usar la cerrada" })), ctx(MARCA.beta));
    expect(ok.status).toBe(201);
    const v = (await leer<RepartoApi>(ok)).data;
    expect(v.fuente).toBe("cerrada");
    expect(v.filas.find((f) => f.gml_id === NODO.denim && f.temporada === "verano")?.participacion_vigente).toBe(0.5);
  });

  it("una fila que no pertenece al reparto → 409 fila_desconocida", async () => {
    const { cuerpo: a } = await analizar(MARCA.beta);
    const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data, { nota: "x", filas: [{ genero_mundo_linea_id: INEXISTENTE, temporada: "verano", participacion_ajustada: 0.5 }] })), ctx(MARCA.beta));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("fila_desconocida");
  });

  it("DELTA sin venta: el análisis avisa sin_venta_barrer y aprobar → 409 suma_invalida", async () => {
    esc.estado = () => estadoB();
    const { cuerpo: a } = await analizar(MARCA.delta);
    expect(a.data.avisos).toContain("sin_venta_barrer");
    expect(a.data.filas).toEqual([]);
    const r = await aprobar(post(`/${MARCA.delta}/repartos`, cuerpoBase(a.data)), ctx(MARCA.delta));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("suma_invalida");
  });

  it("marca no al barrer, miembro de un conjunto, inexistente o con id mal formado", async () => {
    const cuerpo = {
      ventana_meses: 24, modo: "por_temporada", fuente: "historico", alcance: {}, normaliza_nino: true, huella: "h", filas: [],
    };
    const alfa = await aprobar(post(`/${MARCA.alfa}/repartos`, cuerpo), ctx(MARCA.alfa));
    expect(alfa.status).toBe(409);
    expect((await leer(alfa)).codigo).toBe("modalidad_no_barrer");
    const miembro = await aprobar(post(`/${MARCA.betaUno}/repartos`, cuerpo), ctx(MARCA.betaUno));
    expect((await leer(miembro)).codigo).toBe("marca_en_conjunto");
    expect((await aprobar(post(`/${INEXISTENTE}/repartos`, cuerpo), ctx(INEXISTENTE))).status).toBe(404);
    expect((await aprobar(post("/x/repartos", cuerpo), ctx("x"))).status).toBe(404);
    expect(versionesDb()).toHaveLength(0);
  });

  it("validaciones del cuerpo (400): ventana, modo (por_mes es de la segunda entrega), fuente, ids, participación fuera de 0 a 1, nota larga", async () => {
    const { cuerpo: a } = await analizar(MARCA.beta);
    const base = cuerpoBase(a.data);
    const casos: [string, Record<string, unknown>][] = [
      ["ventana", { ventana_meses: 18 }],
      ["modo", { modo: "por_mes" }],
      ["fuente", { fuente: "magia" }],
      ["alcance", { alcance: { generos: ["no-uuid"] } }],
      ["huella", { huella: "" }],
      ["normaliza", { normaliza_nino: "si" }],
      ["participacion", { filas: [{ genero_mundo_linea_id: NODO.denim, temporada: "verano", participacion_ajustada: 1.5 }] }],
      ["id", { filas: [{ genero_mundo_linea_id: "x", temporada: "verano", participacion_ajustada: 0.1 }] }],
      ["temporada", { filas: [{ genero_mundo_linea_id: NODO.denim, temporada: "primavera", participacion_ajustada: 0.1 }] }],
      ["nota", { nota: "x".repeat(301) }],
    ];
    for (const [que, c] of casos) {
      const r = await aprobar(post(`/${MARCA.beta}/repartos`, { ...base, ...c }), ctx(MARCA.beta));
      expect(r.status, que).toBe(400);
    }
    expect((await aprobar(new NextRequest(`${URL_BASE}/${MARCA.beta}/repartos`, { method: "POST", body: "no es json", headers: { "content-type": "application/json" } }), ctx(MARCA.beta))).status).toBe(400);
    expect(versionesDb()).toHaveLength(0);
  });

  it("sin transacción: si fallan las filas se borra la versión a medio escribir y la vigente anterior sigue siendo la vigente", async () => {
    await aprobarBeta();
    bd.fallo = (tabla, modo) => (tabla === "reparto_marca_barrido_gml" && modo === "insert" ? { code: "23503", message: "fk", details: null, hint: null } : null);
    const r = await aprobarBeta();
    expect(r.r.status).toBe(409);
    bd.fallo = null;
    expect(versionesDb().map((v) => [v.version, v.vigente])).toEqual([[1, true]]);
    expect(filasDb().every((f) => f.reparto_id === versionesDb()[0].id)).toBe(true);
    // Repetir completa lo que faltó.
    const otra = await aprobarBeta();
    expect(otra.cuerpo.data.version).toBe(2);
  });

  it("si no se puede encender la versión nueva se devuelve la anterior a vigente y se borra la nueva", async () => {
    await aprobarBeta();
    let intentos = 0;
    bd.fallo = (tabla, modo, carga) => {
      if (tabla === "repartos_marca_barrido" && modo === "update" && (carga as { vigente?: boolean }).vigente === true) {
        intentos += 1;
        // Falla el encendido de la nueva (dos intentos) pero no el restablecimiento de la anterior.
        return intentos <= 2 ? { code: "57014", message: "timeout", details: null, hint: null } : null;
      }
      return null;
    };
    const r = await aprobarBeta();
    expect(r.r.status).toBeGreaterThanOrEqual(400);
    bd.fallo = null;
    expect(versionesDb().map((v) => [v.version, v.vigente])).toEqual([[1, true]]);
  });

  it("H3: si encender la versión nueva choca con el único parcial de vigente (23505) → 409 huella_cambiada, sin reintentar, y la nueva se borra", async () => {
    await aprobarBeta();
    let intentos = 0;
    bd.fallo = (tabla, modo, carga) => {
      if (tabla === "repartos_marca_barrido" && modo === "update" && (carga as { vigente?: boolean }).vigente === true) {
        intentos += 1;
        return { code: "23505", message: 'duplicate key value violates unique constraint "repartos_marca_barrido_vigente_uniq"', details: null, hint: null };
      }
      return null;
    };
    const r = await aprobarBeta();
    expect(r.r.status).toBe(409);
    expect(r.cuerpo.codigo).toBe("huella_cambiada");
    expect(r.cuerpo.error).toContain("al mismo tiempo");
    // Un intento al encender la nueva (no se reintenta un 23505) y uno al devolver la anterior.
    expect(intentos).toBe(2);
    bd.fallo = null;
    expect(versionesDb().map((v) => v.version)).toEqual([1]);
  });

  it("dos aprobaciones a la vez (choque de versión) → 409 con el mensaje de volver a cargar", async () => {
    const { cuerpo: a } = await analizar(MARCA.beta);
    bd.fallo = (tabla, modo) => (tabla === "repartos_marca_barrido" && modo === "insert" ? { code: "23505", message: 'duplicate key value violates unique constraint "repartos_marca_barrido_marca_version_key"', details: null, hint: null } : null);
    const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data)), ctx(MARCA.beta));
    expect(r.status).toBe(409);
    expect((await leer(r)).error).toContain("al mismo tiempo");
  });
});

describe("GET /api/marcas-barrer/[marcaId]/repartos", () => {
  it("todas las versiones de la más nueva a la más vieja, con filas; 404 si la marca no existe; una marca sin versiones devuelve []", async () => {
    expect((await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)))).data).toEqual([]);
    await aprobarBeta();
    await aprobarBeta({ nota: "segunda" });
    const r = await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)));
    expect(r.data.map((v) => v.version)).toEqual([2, 1]);
    expect(r.data[0].nota).toBe("segunda");
    expect((await versiones(get(`/${INEXISTENTE}/repartos`), ctx(INEXISTENTE))).status).toBe(404);
    expect((await versiones(get("/x/repartos"), ctx("x"))).status).toBe(404);
  });
  it("se ven también las versiones de una marca que ya no es al barrer", async () => {
    await aprobarBeta();
    esc.estado = () => estadoB({ marcas: marcasB().map((m) => (m.id === MARCA.beta ? { ...m, modalidad_tratamiento: "por_gml" } : m)) });
    expect((await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)))).data).toHaveLength(1);
  });
});

describe("caso 11: GET /api/marcas-barrer/vigentes (el contrato de M8)", () => {
  it("?marca_ids=BETA,GAMMA,DELTA → BETA v2 con modo, alcance, error y filas; sin_reparto = GAMMA y DELTA", async () => {
    await aprobarBeta();
    await aprobarBeta();
    const r = await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta},${MARCA.gamma},${MARCA.delta}`));
    expect(r.status).toBe(200);
    const { data } = await leer<RepartosVigentesApi>(r);
    expect(data.repartos).toHaveLength(1);
    expect(data.repartos[0]).toMatchObject({ marca_id: MARCA.beta, version: 2, modo: "por_temporada", fuente: "historico", hasta_periodo: "2026-09", alcance: { generos: [], mundos: [], lineas: [] } });
    expect(data.repartos[0]).toHaveProperty("error_reparto_pp");
    expect(data.repartos[0].filas).toHaveLength(15);
    expect(data.repartos[0].filas[0]).toEqual({ gml_id: expect.any(String), equivalencia_id: null, temporada: "invierno", participacion: expect.any(Number) });
    expect(data.sin_reparto.sort()).toEqual([MARCA.gamma, MARCA.delta].sort());
  });
  it("las nueve filas de los pequeños viajan una por g (el resto no se ve en el contrato)", async () => {
    await aprobarBeta();
    const { data } = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`)));
    const verano = data.repartos[0].filas.filter((f) => f.temporada === "verano");
    expect(verano).toHaveLength(9);
    expect(verano.map((f) => f.gml_id)).toEqual(expect.arrayContaining(NODO.c));
  });
  it("sin marca_ids devuelve todos los vigentes y, en sin_reparto, las marcas al barrer o mixtas que aún no tienen", async () => {
    await aprobarBeta();
    const { data } = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes")));
    expect(data.repartos.map((x) => x.marca_id)).toEqual([MARCA.beta]);
    expect(data.sin_reparto.sort()).toEqual([MARCA.gamma, MARCA.delta].sort());
  });
  it("una marca sin nada aprobado: sin_reparto y repartos = []; marca_ids mal formados → 400", async () => {
    const { data } = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`)));
    expect(data).toEqual({ repartos: [], sin_reparto: [MARCA.beta] });
    expect((await vigentes(get("/vigentes", "?marca_ids=uno,dos"))).status).toBe(400);
  });
  it("no recalcula: ninguna función SQL de venta se llama", async () => {
    await aprobarBeta();
    bd.llamadasRpc = [];
    await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`));
    expect(bd.llamadasRpc).toEqual([]);
  });
});

describe("regla 12 y casos 8 y 9: obsoleto no recalcula; solo se marca", () => {
  const hechosOctubre = (denim: number) => [
    { unidad: MARCA.beta, nodo: NODO.denim, eq: null, mes: "2026-10", u: denim },
    { unidad: MARCA.beta, nodo: NODO.polo, eq: null, mes: "2026-10", u: 50 },
    { unidad: MARCA.beta, nodo: NODO.sandalia, eq: null, mes: "2026-10", u: 20 },
  ];
  const otrosOctubre = [
    { nodo: NODO.denim, mes: "2026-10", u: 900 },
    { nodo: NODO.polo, mes: "2026-10", u: 350 },
    { nodo: NODO.sandalia, mes: "2026-10", u: 480 },
  ];
  const foto = () => JSON.stringify([versionesDb(), filasDb()]);

  it("publicar un mes que mueve poco el p2: no es obsoleto (al día con diferencia); el POST con la huella vieja → huella_cambiada", async () => {
    const aprobada = await aprobarBeta();
    const antes = foto();
    esc.k = "2026-10";
    esc.hechos = [...esc.hechos, ...hechosOctubre(100)];
    esc.otros = [...esc.otros, ...otrosOctubre];
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    expect(a.obsoleto).toEqual([]);
    expect(a.vigente?.diferencia_pp).toBeLessThan(5);
    expect(a.vigente?.version).toBe(1);
    expect(foto()).toBe(antes);
    // H1 (auditoría 0.11.0): la LISTA no calcula la diferencia exacta con cargas nuevas: es conservadora y marca `cargas_nuevas`;
    // el detalle (arriba) dice que en realidad está al día porque el reparto casi no se movió.
    const fila = (await leer<ListaBarrerApi>(await lista(get()))).data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(fila).toMatchObject({ estado: "obsoleto", obsoleto: ["cargas_nuevas"], diferencia_pp: null });
    // El POST con la huella vieja no sirve (los datos cambiaron aunque el reparto casi no): hay que volver a cargar el análisis.
    const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(aprobada.analisis)), ctx(MARCA.beta));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("huella_cambiada");
    expect(foto()).toBe(antes);
  });

  it("H1: con cargas nuevas la lista marca cargas_nuevas SIN calcular la diferencia (ni leer venta por marca ni la cerrada); el detalle sí la calcula", async () => {
    await aprobarBeta();
    esc.k = "2026-10";
    esc.hechos = [...esc.hechos, ...hechosOctubre(100)];
    esc.otros = [...esc.otros, ...otrosOctubre];
    bd.llamadasRpc = [];
    esc.llamadasCerrada = [];
    const l = await leer<ListaBarrerApi>(await lista(get()));
    const fila = l.data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(fila).toMatchObject({ estado: "obsoleto", obsoleto: ["cargas_nuevas"], diferencia_pp: null });
    expect(l.data.resumen.obsoletas).toBe(1);
    // Una sola llamada a la base (el resumen) y ninguna lectura de la cerrada, por muchas marcas que haya con cargas nuevas.
    expect(bd.llamadasRpc.map((x) => x.nombre)).toEqual(["venta_marca_gml_resumen"]);
    expect(esc.llamadasCerrada).toEqual([]);
    // El cálculo exacto queda en el detalle de la marca.
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    expect(a.vigente?.diferencia_pp).not.toBeNull();
    expect(a.vigente!.diferencia_pp!).toBeLessThan(5);
    expect(a.obsoleto).toEqual([]);
  });

  it("publicar un mes que mueve mucho el p2 → cargas_nuevas, el vigente no cambia y el POST con la huella vieja → 409 huella_cambiada", async () => {
    const { analisis: viejo } = await aprobarBeta();
    const antes = foto();
    esc.k = "2026-10";
    // Un octubre enorme de DENIM desplaza el reparto de verano más de 5 pp.
    esc.hechos = [...esc.hechos, ...hechosOctubre(3000)];
    esc.otros = [...esc.otros, ...otrosOctubre];
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    expect(a.obsoleto).toEqual(["cargas_nuevas"]);
    expect(a.vigente?.diferencia_pp).toBeGreaterThan(5);
    expect(a.vigente?.version).toBe(1);
    expect(foto()).toBe(antes); // no recalcula
    const fila = (await leer<ListaBarrerApi>(await lista(get()))).data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(fila).toMatchObject({ estado: "obsoleto", obsoleto: ["cargas_nuevas"], diferencia_pp: null });
    expect((await leer<ListaBarrerApi>(await lista(get()))).data.resumen.obsoletas).toBe(1);
    const r = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(viejo)), ctx(MARCA.beta));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("huella_cambiada");
    expect(foto()).toBe(antes);
    // Con la huella nueva se puede aprobar la v2, a decisión del planner.
    const ok = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a)), ctx(MARCA.beta));
    expect(ok.status).toBe(201);
    expect((await leer<RepartoApi>(ok)).data.version).toBe(2);
  });

  it("caso 8: asignar el primer GML a BETA y pasarla a mixta deja su reparto vigente en config_cambiada (no se recalcula)", async () => {
    await aprobarBeta();
    const antes = foto();
    esc.estado = () =>
      estadoB({
        marcas: marcasB().map((m) => (m.id === MARCA.beta ? { ...m, modalidad_tratamiento: "por_gml", resto_al_barrer: true } : m)),
        asignaciones: [...asignacionesB(), { id: "a-beta", marca_id: MARCA.beta, genero_mundo_linea_id: NODO.camisa, nota: null, activo: true, created_at: "" }],
      });
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    expect(a.marca.modalidad).toBe("mixta");
    expect(a.obsoleto).toContain("config_cambiada");
    expect(a.vigente?.version).toBe(1);
    expect(foto()).toBe(antes);
    const fila = (await leer<ListaBarrerApi>(await lista(get()))).data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(fila).toMatchObject({ modalidad: "mixta", estado: "obsoleto" });
    expect(fila.obsoleto).toContain("config_cambiada");
  });

  it("otra ventana en pantalla marca ventana_distinta sin tocar nada; el nivel de una g (GML → GMLE) marca nivel_cambiado", async () => {
    await aprobarBeta();
    const a12 = (await analizar(MARCA.beta, "?ventana=12")).cuerpo.data;
    expect(a12.obsoleto).toContain("ventana_distinta");
    expect(a12.vigente?.version).toBe(1);
    const lista12 = (await leer<ListaBarrerApi>(await lista(get("", "?ventana=12")))).data.marcas.find((m) => m.id === MARCA.beta)!;
    expect(lista12.obsoleto).toContain("ventana_distinta");
    esc.estado = () => {
      const e = estadoB();
      const nodos = new Map(e.nodos);
      nodos.set(NODO.polo, { ...(e.nodos.get(NODO.polo) as NodoInfo), nivel_planificacion: "GMLE" });
      return { ...e, nodos };
    };
    // POLO pasa a GMLE: su unidad deja de ser GML y sus hechos (sin equivalencia) no la encuentran: el análisis lo ve como cambio de nivel.
    const nivel = await analizar(MARCA.beta);
    expect(nivel.r.status).toBe(200);
    expect(nivel.cuerpo.data.obsoleto).toContain("nivel_cambiado");
  });

  it("fuera de la lista de obsoletas: la marca sin reparto aparece como sin_reparto y no como obsoleta", async () => {
    const { data } = await leer<ListaBarrerApi>(await lista(get()));
    expect(data.marcas.every((m) => m.estado === "sin_reparto")).toBe(true);
    expect(data.resumen.obsoletas).toBe(0);
  });
});

describe("temporadas_usadas (0024): cada versión guarda y devuelve las fechas con que se calculó", () => {
  const DEFECTO = { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } };
  const OTRAS = { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } };

  it("aprobar GUARDA las temporadas efectivas del análisis (validadas) y la respuesta las trae", async () => {
    const { r, cuerpo, analisis: a } = await aprobarBeta();
    expect(r.status).toBe(201);
    expect(a.parametros.temporadas).toEqual(DEFECTO);
    expect(versionesDb()[0].temporadas_usadas).toEqual(DEFECTO);
    expect(cuerpo.data.temporadas_usadas).toEqual(DEFECTO);
  });
  it("las versiones y los vigentes LEEN la columna de cada versión: una con otras fechas conserva las suyas", async () => {
    await aprobarBeta();
    // Una versión aprobada cuando las fechas eran otras (se simula en la fila guardada).
    versionesDb()[0].temporadas_usadas = OTRAS;
    const v1 = await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)));
    expect(v1.data[0].temporadas_usadas).toEqual(OTRAS);
    const vig1 = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`)));
    expect(vig1.data.repartos[0].temporadas_usadas).toEqual(OTRAS);

    // La v2, aprobada con las fechas de hoy, guarda las suyas y la v1 sigue con las de entonces.
    const v2 = await aprobarBeta();
    expect(v2.cuerpo.data.temporadas_usadas).toEqual(DEFECTO);
    const todas = await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)));
    expect(todas.data.map((v) => [v.version, v.temporadas_usadas])).toEqual([[2, DEFECTO], [1, OTRAS]]);
    const vig2 = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes")));
    expect(vig2.data.repartos).toHaveLength(1);
    expect(vig2.data.repartos[0]).toMatchObject({ version: 2, temporadas_usadas: DEFECTO });
  });
  it("cada marca devuelve en /vigentes las fechas de su versión vigente", async () => {
    await aprobarBeta();
    versionesDb()[0].temporadas_usadas = OTRAS;
    const { cuerpo: g } = await analizar(MARCA.gamma);
    const rg = await aprobar(post(`/${MARCA.gamma}/repartos`, cuerpoBase(g.data, { nota: "mixta" })), ctx(MARCA.gamma));
    expect(rg.status).toBe(201);
    const { data } = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta},${MARCA.gamma}`)));
    const porMarca = new Map(data.repartos.map((x) => [x.marca_id, x.temporadas_usadas]));
    expect(porMarca.get(MARCA.beta)).toEqual(OTRAS);
    expect(porMarca.get(MARCA.gamma)).toEqual(DEFECTO);
  });
  it("un valor malformado en la base cae al defecto sin fallar (versiones, vigentes y análisis)", async () => {
    await aprobarBeta();
    versionesDb()[0].temporadas_usadas = { verano: "octubre" };
    const todas = await leer<RepartoApi[]>(await versiones(get(`/${MARCA.beta}/repartos`), ctx(MARCA.beta)));
    expect(todas.data[0].temporadas_usadas).toEqual(DEFECTO);
    const vig = await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`)));
    expect(vig.data.repartos[0].temporadas_usadas).toEqual(DEFECTO);
    expect((await analizar(MARCA.beta)).r.status).toBe(200);
  });
  it("las fechas guardadas no cambian lo que el análisis calcula hoy ni el estado: la versión sigue al día", async () => {
    await aprobarBeta();
    versionesDb()[0].temporadas_usadas = OTRAS;
    const a = (await analizar(MARCA.beta)).cuerpo.data;
    // `huella_config` de la versión se calculó con las fechas por defecto, igual que hoy: nada cambió en la configuración.
    expect(a.obsoleto).toEqual([]);
    expect(a.vigente?.version).toBe(1);
  });
});

describe("el error del reparto aprobado viaja a la lista y a los vigentes", () => {
  it("la lista muestra el error de la última versión y 'inestables' cuenta las que pasan de 25 pp", async () => {
    esc.hechos = esc.hechos.filter((h) => h.unidad !== MARCA.beta).concat(
      hechosBeta().filter((h) => [NODO.denim, NODO.polo].includes(h.nodo)).map((h) => ({ ...h, u: h.nodo === NODO.denim ? (h.mes >= "2026-01" ? 30 : 70) : h.mes >= "2026-01" ? 70 : 30 }))
    );
    const { cuerpo: a } = await analizar(MARCA.beta, "?normaliza_nino=0");
    expect(a.data.error_reparto.veredicto).toBe("inestable");
    const ok = await aprobar(post(`/${MARCA.beta}/repartos`, cuerpoBase(a.data)), ctx(MARCA.beta));
    expect(ok.status).toBe(201);
    expect((await leer<RepartoApi>(ok)).data.error_reparto_pp).toBeCloseTo(40, 1);
    const l = (await leer<ListaBarrerApi>(await lista(get()))).data;
    const beta = l.marcas.find((m) => m.id === MARCA.beta)!;
    expect(beta.error_reparto.veredicto).toBe("inestable");
    expect(beta.error_reparto.pp).toBeCloseTo(40, 1);
    expect(l.resumen.inestables).toBe(1);
    const v = (await leer<RepartosVigentesApi>(await vigentes(get("/vigentes", `?marca_ids=${MARCA.beta}`)))).data;
    expect(v.repartos[0].error_reparto_pp).toBeCloseTo(40, 1);
    void OTROS;
  });
});
