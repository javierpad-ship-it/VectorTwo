import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  AniosAtipicosNinoApi,
  AniosAtipicosRespuesta,
  CalcularRespuesta,
  CorridaDetalleApi,
  CorridaListaApi,
  CurvaVigenteApi,
  DetalleAgrupacionApi,
  ElegirCurvaRespuesta,
  EstadoCurvasApi,
  MarcarReferenciaRespuesta,
  PeriodoAtipicoLista,
  RedComparableVistaPrevia,
  RetirarCurvaRespuesta,
} from "@/lib/curvas/tipos-api";
import { estadoFalso, type Fila } from "./curvas.fake-db";

// El módulo de la base falsa se carga dentro de la fábrica para que sea el mismo que importa este archivo.
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./curvas.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { GET as estado } from "@/app/api/curvas/route";
import { POST as calcular } from "@/app/api/curvas/calcular/route";
import { GET as listarCorridas } from "@/app/api/curvas/corridas/route";
import { GET as leerCorrida, PATCH as marcarReferencia } from "@/app/api/curvas/corridas/[id]/route";
import { GET as detalleAgrupacion } from "@/app/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]/route";
import { GET as redComparable } from "@/app/api/curvas/red-comparable/route";
import { GET as aniosNino } from "@/app/api/curvas/anios-atipicos/route";
import { DELETE as retirar, PUT as elegir } from "@/app/api/curvas/agrupaciones/[id]/route";
import { GET as vigentes } from "@/app/api/curvas/vigentes/route";
import { GET as listarPeriodos, POST as crearPeriodo } from "@/app/api/periodos-atipicos/route";
import { PATCH as editarPeriodo } from "@/app/api/periodos-atipicos/[id]/route";
import { GET as aniosAtipicos } from "@/app/api/periodos-atipicos/anios/route";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { ABRIGO_ID, CONSTANTE_ID, PERIODOS_NINO, PUBLICADOS, T4, VERANO_ID, filasFixture, tiendasFixture } from "./curvas.fixture";

const A = {
  [ABRIGO_ID]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  [VERANO_ID]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  [CONSTANTE_ID]: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;
const INACTIVA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const URL = "http://localhost/api/curvas";
const get = (ruta = "", consulta = "") => new NextRequest(`${URL}${ruta}${consulta}`);
const json = (cuerpo: unknown, metodo = "POST", ruta = "") =>
  new NextRequest(`${URL}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const ctx2 = (id: string, agrupacionId: string) => ({ params: Promise.resolve({ id, agrupacionId }) }) as never;
const dia1 = (m: string) => `${m}-01`;

function sembrar() {
  const filas = filasFixture("base").map((f) => ({
    agrupacion_id: f.agrupacion_id === null ? null : (A[f.agrupacion_id as keyof typeof A] ?? f.agrupacion_id),
    tienda_id: f.tienda_id,
    periodo: dia1(f.periodo),
    unidades: f.unidades,
    venta_soles: f.venta_soles,
    costo_vendido: f.costo_vendido,
  }));
  estadoFalso.rol = "planner";
  estadoFalso.siguienteId = 100;
  estadoFalso.llamadasAgregado = 0;
  estadoFalso.tablasLeidas = new Set();
  estadoFalso.fallarInsert = {};
  estadoFalso.agregado = { data: { refresco: { filas: 85385, duracion_ms: 1234, refrescada_at: "2026-10-14T10:00:00Z" }, filas }, error: null };
  estadoFalso.ventaTienda = ventaPorTienda(filasFixture("base")).map((v) => ({ ...v, periodo: dia1(v.periodo) }));
  const agr = (id: string, nombre: string, temporada: string, activo = true, orden = 0): Fila => ({ id, nombre, codigo: nombre.slice(0, 3), activo, orden, temporada, descripcion: null });
  estadoFalso.tablas = {
    agrupaciones_estacionalidad: [
      agr(A[ABRIGO_ID], "ABRIGO", "invierno"),
      agr(A[VERANO_ID], "VERANO", "verano"),
      agr(A[CONSTANTE_ID], "CONSTANTE", "todo_el_ano"),
      agr(INACTIVA, "INACTIVA", "verano", false),
    ],
    agrupacion_estacionalidad_genero: [{ id: "g1", agrupacion_estacionalidad_id: A[ABRIGO_ID], genero_id: "h" }],
    generos: [{ id: "h", nombre: "HOMBRE", orden: 1 }],
    genero_mundo_linea: [{ id: "n1", linea_id: "l1" }],
    lineas: [{ id: "l1", temporada: "Todo el año" }],
    equivalencias: [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID]].flatMap((a, i) =>
      [1, 2, 3].map((k) => ({ id: `e-${i}-${k}`, agrupacion_estacionalidad_id: a, activo: true, genero_mundo_linea_id: "n1" }))
    ),
    tiendas: tiendasFixture("base").map((t) => ({ ...t, razon_social: null, zona: null, venta_esperada_promedio: null })),
    cargas_venta_stock: PUBLICADOS.map((m) => ({ id: `carga-${m}`, periodo: dia1(m), estado: "publicada" })),
    periodos_atipicos: PERIODOS_NINO.map((p, i) => ({
      id: `00000000-0000-4000-8000-0000000000${10 + i}`,
      desde: dia1(p.desde),
      hasta: dia1(p.hasta),
      motivo: p.motivo,
      descripcion: null,
      alcance: "invierno",
      temporadas: p.temporadas,
      activo: true,
      created_at: "x",
      updated_at: "x",
    })),
    corridas_estacionalidad: [],
    curvas_estacionalidad: [],
  };
}

async function calcularOk(cuerpo: Record<string, unknown> = {}) {
  const r = await calcular(json(cuerpo));
  expect(r.status).toBe(201);
  return (await leer<CalcularRespuesta>(r)).data.corrida;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  sembrar();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("guards: toda la API de M6 exige planner", () => {
  it("sin sesión 401 y comprador 403 en todos los handlers, y no se toca nada", async () => {
    const uuid = A[ABRIGO_ID];
    for (const rol of ["sin_sesion", "comprador"] as const) {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      const respuestas = await Promise.all([
        estado(get()),
        calcular(json({})),
        listarCorridas(),
        leerCorrida(get(), ctx(uuid)),
        marcarReferencia(json({ referencia: true }, "PATCH"), ctx(uuid)),
        detalleAgrupacion(get(), ctx2(uuid, uuid)),
        redComparable(get("/red-comparable")),
        aniosNino(get("/anios-atipicos")),
        elegir(json({ corrida_id: uuid, modelo: "A" }, "PUT"), ctx(uuid)),
        retirar(get(), ctx(uuid)),
        vigentes(),
        listarPeriodos(get()),
        crearPeriodo(json({ desde: "2023-03", hasta: "2023-05", motivo: "x" })),
        editarPeriodo(json({ activo: false }, "PATCH"), ctx(uuid)),
        aniosAtipicos(get("/anios")),
      ]);
      for (const r of respuestas) expect(r.status).toBe(esperado);
    }
    expect(estadoFalso.llamadasAgregado).toBe(0);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
});

describe("POST /api/curvas/calcular", () => {
  it("201: guarda la corrida, la marca como referencia y llama al agregado una sola vez", async () => {
    const corrida = await calcularOk();
    expect(corrida).toMatchObject({ hasta_periodo: "2026-09", referencia: true, usuario_nombre: "Javier" });
    expect(corrida.parametros).toMatchObject({ umbral_forma: 3, meses_tienda_nueva: 0 });
    expect(corrida.resumen.agrupaciones_activas).toBe(3);
    expect(corrida.resumen.agrupaciones_activas).toBe(corrida.resumen.propias + corrida.resumen.prestadas + corrida.resumen.sin_venta);
    expect(corrida.resumen.agregado).toMatchObject({ filas_mv: 85385, duracion_ms: 1234 });
    expect(corrida.resumen.meses_publicados).toEqual({ desde: "2023-01", hasta: "2026-09", faltantes: [] });
    expect(Object.keys(corrida.resumen.cargas)).toHaveLength(45);
    expect(corrida.resumen.red_huella).toMatch(/^[0-9a-f]{32}$/);
    const sinAgrupacion = (estadoFalso.agregado.data as { filas: { agrupacion_id: string | null; unidades: number }[] }).filas
      .filter((f) => f.agrupacion_id === null)
      .reduce((s, f) => s + f.unidades, 0);
    expect(corrida.resumen.unidades_sin_agrupacion).toBe(sinAgrupacion);
    expect(sinAgrupacion).toBeGreaterThan(0);
    expect(estadoFalso.llamadasAgregado).toBe(1);
    const guardada = estadoFalso.tablas.corridas_estacionalidad[0];
    expect(guardada.hasta_periodo).toBe("2026-09-01");
    expect(JSON.stringify(guardada.resultado).length).toBeLessThan(500_000);
    expect((guardada.red_comparable as unknown[]).length).toBe(4);
    expect(guardada.perfil_id).toBe("99999999-9999-4999-8999-999999999999");
  });
  it("la primera corrida es referencia; la segunda no la mueve; marcar_referencia sí; siempre a lo sumo una", async () => {
    const c1 = await calcularOk();
    const c2 = await calcularOk();
    expect([c1.referencia, c2.referencia]).toEqual([true, false]);
    const c3 = await calcularOk({ marcar_referencia: true });
    expect(c3.referencia).toBe(true);
    const marcas = estadoFalso.tablas.corridas_estacionalidad.filter((c) => c.referencia === true);
    expect(marcas.map((c) => c.id)).toEqual([c3.id]);
  });
  it("hasta_periodo explícito y parámetros se guardan; un mes no publicado es 409 hasta_periodo_sin_cargar", async () => {
    const corrida = await calcularOk({ hasta_periodo: "2025-12", meses_tienda_nueva: 12, umbral_forma: 5 });
    expect(corrida.hasta_periodo).toBe("2025-12");
    expect(corrida.parametros).toMatchObject({ meses_tienda_nueva: 12, umbral_forma: 5 });
    const r = await calcular(json({ hasta_periodo: "2026-10" }));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("hasta_periodo_sin_cargar");
  });
  it("sin meses publicados: 409 sin_datos y no se refresca nada", async () => {
    estadoFalso.tablas.cargas_venta_stock = [];
    const r = await calcular(json({}));
    expect(r.status).toBe(409);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await leer(r)).codigo).toBe("sin_datos");
    expect(estadoFalso.llamadasAgregado).toBe(0);
  });
  it("dos cálculos a la vez: el segundo recibe 55P03 y responde 409 calculo_en_curso, sin guardar nada", async () => {
    estadoFalso.agregado = { data: null, error: { code: "55P03", message: "calculo_en_curso" } };
    const r = await calcular(json({}));
    expect(r.status).toBe(409);
    const cuerpo = await leer(r);
    expect(cuerpo.codigo).toBe("calculo_en_curso");
    expect(cuerpo.error).toMatch(/otro cálculo/);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
  });
  it("otro error de la función se traduce a 500 genérico; un agregado incompleto, 500 con mensaje", async () => {
    estadoFalso.agregado = { data: null, error: { code: "XX000", message: "boom" } };
    const r1 = await calcular(json({}));
    expect(r1.status).toBe(500);
    expect((await leer(r1)).error).not.toMatch(/boom/);
    estadoFalso.agregado = { data: { filas: "no es un arreglo" }, error: null };
    expect((await calcular(json({}))).status).toBe(500);
  });
  it("400 con parámetros fuera de rango; las claves recortadas no llegan a los parámetros guardados", async () => {
    expect((await calcular(json({ meses_tienda_nueva: 40 }))).status).toBe(400);
    expect((await calcular(json({ umbral_forma: 0 }))).status).toBe(400);
    const corrida = await calcularOk({ medida: "venta_soles", umbral_sustitucion: 0.5, referencia_volumen: "promedio" });
    expect(JSON.stringify(corrida.parametros)).not.toMatch(/medida|sustitucion|referencia_volumen/);
  });
  it("un fallo al guardar devuelve la marca a la corrida de referencia anterior", async () => {
    await calcularOk();
    estadoFalso.fallarInsert.corridas_estacionalidad = { code: "XX000", message: "se cayó" };
    const r = await calcular(json({ marcar_referencia: true }));
    expect(r.status).toBe(500);
    expect(estadoFalso.tablas.corridas_estacionalidad.filter((c) => c.referencia === true)).toHaveLength(1);
  });
});

describe("GET /api/curvas y lecturas de la corrida (no leen la vista materializada)", () => {
  it("sin corrida: estado vacío con las agrupaciones activas y la inactiva sin curva fuera", async () => {
    const r = await estado(get());
    const e = (await leer<EstadoCurvasApi>(r)).data;
    expect(r.status).toBe(200);
    expect(e.corrida).toBeNull();
    expect(e.agrupaciones.map((a) => a.nombre)).toEqual(["ABRIGO", "CONSTANTE", "VERANO"]);
    expect(e.datos).toMatchObject({ desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" });
    expect(e.periodos_atipicos).toHaveLength(4);
    expect(e.resumen.sin_revisar_toda_temporada).toBe(1);
    expect(e.agrupaciones[0].temporada_sugerida).toBeNull();
    expect(e.agrupaciones[0].generos).toEqual(["HOMBRE"]);
    expect(e.agrupaciones[0].equivalencias_activas).toBe(3);
  });
  it("con corrida: propuesta por agrupación, unidades sin agrupación del resumen y ninguna lectura de la vista", async () => {
    await calcularOk();
    const antes = estadoFalso.llamadasAgregado;
    const e = (await leer<EstadoCurvasApi>(await estado(get()))).data;
    expect(e.corrida?.referencia).toBe(true);
    expect(e.corridas).toHaveLength(1);
    expect(e.agrupaciones.every((a) => a.propuesta !== null)).toBe(true);
    expect(e.resumen.unidades_sin_agrupacion).toBeGreaterThan(0);
    expect(estadoFalso.llamadasAgregado).toBe(antes);
    expect([...estadoFalso.tablasLeidas].some((t) => t.includes("venta_mensual_estacionalidad"))).toBe(false);
  });
  it("?corrida_id elige la corrida; uno inexistente o que no es UUID, 404", async () => {
    const c1 = await calcularOk();
    const c2 = await calcularOk({ hasta_periodo: "2025-12" });
    const e = (await leer<EstadoCurvasApi>(await estado(get("", `?corrida_id=${c2.id}`)))).data;
    expect(e.corrida?.id).toBe(c2.id);
    expect((await estado(get("", "?corrida_id=00000000-0000-4000-8000-999999999999"))).status).toBe(404);
    expect((await estado(get("", "?corrida_id=x"))).status).toBe(404);
    expect(c1.id).not.toBe(c2.id);
  });
  it("GET /corridas: las últimas sin resultado", async () => {
    await calcularOk();
    await calcularOk();
    const lista = (await leer<CorridaListaApi[]>(await listarCorridas())).data;
    expect(lista).toHaveLength(2);
    expect(JSON.stringify(lista)).not.toContain('"resultado"');
    expect(lista[0].created_at >= lista[1].created_at).toBe(true);
  });
  it("GET /corridas/[id]: resultado, red con código y nombre de tienda, efecto y agrupaciones", async () => {
    const c = await calcularOk();
    const r = await leerCorrida(get(`/corridas/${c.id}`), ctx(c.id));
    const d = (await leer<CorridaDetalleApi>(r)).data;
    expect(d.resultado.agrupaciones).toHaveLength(3);
    expect(d.red_comparable).toHaveLength(4);
    expect(d.red_comparable[3].tiendas.find((t) => t.codigo === "T3")).toMatchObject({ entra: true, nombre: "Tienda T3" });
    expect(d.efecto_atipico.por_temporada.length).toBeGreaterThan(0);
    expect(d.agrupaciones.map((a) => a.nombre).sort()).toEqual(["ABRIGO", "CONSTANTE", "VERANO"]);
    expect((await leerCorrida(get(), ctx("no-es-uuid"))).status).toBe(404);
    expect((await leerCorrida(get(), ctx("00000000-0000-4000-8000-999999999999"))).status).toBe(404);
  });
  it("PATCH /corridas/[id]: marca la referencia, quita la anterior y 404 si no existe", async () => {
    const c1 = await calcularOk();
    const c2 = await calcularOk();
    const r = await marcarReferencia(json({ referencia: true }, "PATCH"), ctx(c2.id));
    expect(r.status).toBe(200);
    expect((await leer<MarcarReferenciaRespuesta>(r)).data.corrida).toMatchObject({ id: c2.id, referencia: true });
    expect(estadoFalso.tablas.corridas_estacionalidad.filter((c) => c.referencia === true).map((c) => c.id)).toEqual([c2.id]);
    expect((await marcarReferencia(json({ referencia: false }, "PATCH"), ctx(c1.id))).status).toBe(400);
    expect((await marcarReferencia(json({ referencia: true }, "PATCH"), ctx("00000000-0000-4000-8000-999999999999"))).status).toBe(404);
  });
  it("GET /corridas/[id]/agrupaciones/[agrupacionId]: el detalle tal como lo guardó la corrida", async () => {
    const c = await calcularOk();
    const r = await detalleAgrupacion(get(), ctx2(c.id, A[ABRIGO_ID]));
    const d = (await leer<DetalleAgrupacionApi>(r)).data;
    expect(d.agrupacion).toMatchObject({ nombre: "ABRIGO", temporada: "invierno", generos: ["HOMBRE"] });
    expect(d.resultado.agrupacion_id).toBe(A[ABRIGO_ID]);
    expect(d.temporada_curva?.temporada).toBe("invierno");
    expect(d.tiendas.map((t) => t.codigo)).toContain("T1");
    expect(d.vigente).toBeNull();
    expect(d.comparador).toBeNull();
    expect((await detalleAgrupacion(get(), ctx2(c.id, "00000000-0000-4000-8000-999999999999"))).status).toBe(404);
    expect((await detalleAgrupacion(get(), ctx2(c.id, "x"))).status).toBe(404);
    expect((await detalleAgrupacion(get("", "?modelo=F"), ctx2(c.id, A[ABRIGO_ID]))).status).toBe(400);
  });
});

describe("PUT / DELETE /api/curvas/agrupaciones/[id] (una por una)", () => {
  it("elegir B con nota crea la v1 no recomendada; elegir A crea la v2 y la v1 queda reemplazada; comparador en el detalle", async () => {
    const c = await calcularOk();
    const r1 = await elegir(json({ corrida_id: c.id, modelo: "B", nota: "prefiero B" }, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r1.status).toBe(201);
    const v1 = (await leer<ElegirCurvaRespuesta>(r1)).data.curva;
    expect(v1).toMatchObject({ version: 1, modelo: "B", recomendada: false, origen: "propia", medida: "unidades", estado: "vigente", nota: "prefiero B", usuario_nombre: "Javier" });
    expect(v1.curva.reduce((s, x) => s + Math.round(x * 1e6), 0)).toBe(1_000_000);

    const r2 = await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r2.status).toBe(201);
    const v2 = (await leer<ElegirCurvaRespuesta>(r2)).data.curva;
    expect(v2).toMatchObject({ version: 2, modelo: "A", recomendada: true });
    const filas = estadoFalso.tablas.curvas_estacionalidad;
    expect(filas.filter((f) => f.estado === "vigente")).toHaveLength(1);
    expect(filas.find((f) => f.id === v1.id)?.estado).toBe("reemplazada");

    const detalle = (await leer<DetalleAgrupacionApi>(await detalleAgrupacion(get("", "?modelo=B"), ctx2(c.id, A[ABRIGO_ID])))).data;
    expect(detalle.vigente?.version).toBe(2);
    expect(detalle.comparador).toMatchObject({ modelo: "B" });
    expect(detalle.comparador?.eat_vs_vigente).toBeGreaterThan(0);
    expect(detalle.comparador?.diferencia_por_mes).toHaveLength(12);
  });
  it("misma corrida y modelo que la vigente: 409 sin_cambio", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    const r = await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_cambio");
    expect(estadoFalso.tablas.curvas_estacionalidad).toHaveLength(1);
  });
  it("elegir T guarda origen prestada, sin EAT, y anios_utilizados lleva las tres huellas", async () => {
    const c = await calcularOk();
    const r = await elegir(json({ corrida_id: c.id, modelo: "T" }, "PUT"), ctx(A[VERANO_ID]));
    expect(r.status).toBe(201);
    expect((await leer<ElegirCurvaRespuesta>(r)).data.curva).toMatchObject({ modelo: "T", origen: "prestada", eat: null, error_max: null, recomendada: false });
    const au = estadoFalso.tablas.curvas_estacionalidad[0].anios_utilizados as Record<string, unknown>;
    expect(au.red_huella).toMatch(/^[0-9a-f]{32}$/);
    expect(au.cargas_huella).toMatch(/^[0-9a-f]{32}$/);
    expect(au.composicion).toMatchObject({ equivalencias: 3 });
    expect((au.composicion as { huella: string }).huella).toMatch(/^[0-9a-f]{32}$/);
  });
  it("404 agrupación o corrida inexistente, 409 inactiva, 400 modelo F/G/H y UUID inválido", async () => {
    const c = await calcularOk();
    const inexistente = "00000000-0000-4000-8000-999999999999";
    expect((await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(inexistente))).status).toBe(404);
    expect((await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx("no-uuid"))).status).toBe(404);
    expect((await elegir(json({ corrida_id: inexistente, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(404);
    const inactiva = await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(INACTIVA));
    expect(inactiva.status).toBe(409);
    for (const m of ["F", "G", "H"]) expect((await elegir(json({ corrida_id: c.id, modelo: m }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await elegir(json({ corrida_id: "x", modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
  it("candidata no disponible: 409 candidata_no_disponible (agrupación que la corrida no calculó)", async () => {
    const c = await calcularOk();
    estadoFalso.tablas.agrupaciones_estacionalidad.push({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", nombre: "NUEVA", codigo: "NUE", activo: true, orden: 9, temporada: "invierno" });
    const r = await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("candidata_no_disponible");
  });
  it("un fallo al guardar la versión nueva devuelve la anterior a vigente", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "B" }, "PUT"), ctx(A[ABRIGO_ID]));
    estadoFalso.fallarInsert.curvas_estacionalidad = { code: "XX000", message: "se cayó" };
    const r = await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(500);
    expect(estadoFalso.tablas.curvas_estacionalidad.filter((f) => f.estado === "vigente")).toHaveLength(1);
  });
  it("retirar deja la agrupación sin vigente; retirar otra vez es 404", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    const r = await retirar(get(), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(200);
    expect((await leer<RetirarCurvaRespuesta>(r)).data.estado).toBe("retirada");
    expect(estadoFalso.tablas.curvas_estacionalidad[0].estado).toBe("retirada");
    expect((await retirar(get(), ctx(A[ABRIGO_ID]))).status).toBe(404);
    const e = (await leer<EstadoCurvasApi>(await estado(get()))).data;
    expect(e.agrupaciones.find((a) => a.id === A[ABRIGO_ID])?.vigente).toBeNull();
  });
});

describe("GET /api/curvas/vigentes", () => {
  it("devuelve las curvas vigentes de las activas con curva suma 1, acumulada que termina en 1, versión y huellas", async () => {
    const c = await calcularOk();
    for (const id of [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID]]) {
      expect((await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(id))).status).toBe(201);
    }
    const filas = (await leer<CurvaVigenteApi[]>(await vigentes())).data;
    expect(filas).toHaveLength(3);
    for (const f of filas) {
      expect(f.curva.reduce((s, x) => s + Math.round(x * 1e6), 0)).toBe(1_000_000);
      expect(f.acumulada).toHaveLength(12);
      expect(f.acumulada[11]).toBe(1);
      expect(f).toMatchObject({ version: 1, modelo: "A", medida: "unidades", corrida_id: c.id });
      expect(f.huellas.composicion).toMatch(/^[0-9a-f]{32}$/);
      expect(f.curva_id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(filas.map((f) => f.codigo)).toEqual([...filas.map((f) => f.codigo)].sort());
  });
  it("una agrupación inactiva con curva no sale en vigentes, pero sí en el estado (al final)", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    const fila = estadoFalso.tablas.curvas_estacionalidad[0];
    fila.agrupacion_estacionalidad_id = INACTIVA;
    expect((await leer<CurvaVigenteApi[]>(await vigentes())).data).toHaveLength(0);
    const e = (await leer<EstadoCurvasApi>(await estado(get()))).data;
    expect(e.agrupaciones.at(-1)).toMatchObject({ id: INACTIVA, activo: false });
    expect(e.resumen.inactivas_con_curva).toBe(1);
  });
});

describe("obsolescencia en GET /api/curvas", () => {
  it("corregir la apertura de una tienda marca la curva como obsoleta con el motivo; revertir lo quita", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    const sinCambio = (await leer<EstadoCurvasApi>(await estado(get()))).data;
    expect(sinCambio.agrupaciones.find((a) => a.id === A[ABRIGO_ID])?.obsoleta).toBeNull();
    expect(sinCambio.resumen.obsoletas).toBe(0);

    const t4 = estadoFalso.tablas.tiendas.find((t) => t.id === T4)!;
    const original = t4.fecha_apertura;
    t4.fecha_apertura = "2024-03-01";
    const marcado = (await leer<EstadoCurvasApi>(await estado(get()))).data;
    const abrigo = marcado.agrupaciones.find((a) => a.id === A[ABRIGO_ID])!;
    expect(abrigo.obsoleta?.motivos.map((m) => m.codigo)).toContain("tienda_sale_red");
    expect(abrigo.obsoleta?.motivos[0].detalle).toContain("T4");
    expect(marcado.resumen.obsoletas).toBe(1);

    t4.fecha_apertura = original;
    expect((await leer<EstadoCurvasApi>(await estado(get()))).data.resumen.obsoletas).toBe(0);
  });
  it("publicar un mes nuevo, mover una equivalencia o cambiar la temporada marcan la curva con su motivo", async () => {
    const c = await calcularOk();
    await elegir(json({ corrida_id: c.id, modelo: "A" }, "PUT"), ctx(A[ABRIGO_ID]));
    const codigos = async () =>
      (await leer<EstadoCurvasApi>(await estado(get()))).data.agrupaciones.find((a) => a.id === A[ABRIGO_ID])?.obsoleta?.motivos.map((m) => m.codigo) ?? [];

    estadoFalso.tablas.cargas_venta_stock.push({ id: "carga-2026-10", periodo: "2026-10-01", estado: "publicada" });
    expect(await codigos()).toEqual(["carga_nueva"]);
    estadoFalso.tablas.cargas_venta_stock.pop();

    estadoFalso.tablas.equivalencias.push({ id: "e-nueva", agrupacion_estacionalidad_id: A[ABRIGO_ID], activo: true, genero_mundo_linea_id: "n1" });
    expect(await codigos()).toEqual(["composicion_cambiada"]);
    estadoFalso.tablas.equivalencias.pop();

    estadoFalso.tablas.agrupaciones_estacionalidad[0].temporada = "todo_el_ano";
    expect(await codigos()).toEqual(["temporada_cambiada"]);
  });
});

describe("periodos atípicos con temporadas", () => {
  it("POST con temporadas escribe el conjunto y el espejo; GET las devuelve con agrupaciones afectadas", async () => {
    const r = await crearPeriodo(json({ desde: "2027-01", hasta: "2027-03", motivo: "Prueba", temporadas: ["invierno", "verano", "todo_el_ano"] }, "POST", "/x"));
    expect(r.status).toBe(201);
    const fila = estadoFalso.tablas.periodos_atipicos.at(-1)!;
    expect(fila).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" });
    const lista = (await leer<PeriodoAtipicoLista[]>(await listarPeriodos(get()))).data;
    const nuevo = lista.find((p) => p.motivo === "Prueba")!;
    expect(nuevo).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas", agrupaciones_afectadas: 3, meses: 3 });
    const verano = lista.find((p) => p.temporadas.join() === "verano")!;
    expect(verano.agrupaciones_afectadas).toBe(1);
  });
  it("POST contradictorio (temporadas e alcance) 400; solo alcance (cliente viejo) se traduce", async () => {
    expect((await crearPeriodo(json({ desde: "2027-01", hasta: "2027-03", motivo: "X", temporadas: ["verano"], alcance: "todas" }))).status).toBe(400);
    const r = await crearPeriodo(json({ desde: "2027-01", hasta: "2027-03", motivo: "Viejo", alcance: "todas" }));
    expect(r.status).toBe(201);
    expect(estadoFalso.tablas.periodos_atipicos.at(-1)).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" });
  });
  it("PATCH con temporadas reescribe conjunto y espejo", async () => {
    const id = estadoFalso.tablas.periodos_atipicos[0].id as string;
    const r = await editarPeriodo(json({ temporadas: ["verano"] }, "PATCH"), ctx(id));
    expect(r.status).toBe(200);
    expect(estadoFalso.tablas.periodos_atipicos[0]).toMatchObject({ temporadas: ["verano"], alcance: "invierno" });
  });
});

describe("GET /api/periodos-atipicos/anios con la corrida de referencia (caso 11)", () => {
  it("sin corrida de referencia: ratio_volumen y volumen nulos, corrida_id nulo", async () => {
    const r = await aniosAtipicos(get("/anios", "?temporada=invierno"));
    const d = (await leer<AniosAtipicosRespuesta>(r)).data;
    expect(d.corrida_id).toBeNull();
    expect(d.anios.every((a) => a.ratio_volumen === null && a.volumen === null)).toBe(true);
    expect(d.resumen.anios_atipicos).toEqual([2023, 2026]);
  });
  it("con referencia: el ratio de la temporada con control, relativo y crecimiento; con ?agrupacion_id suma el de la agrupación", async () => {
    const c = await calcularOk();
    const d = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=invierno")))).data;
    expect(d.corrida_id).toBe(c.id);
    const a2023 = d.anios.find((a) => a.anio === 2023)!;
    expect(a2023.ratio_volumen).toBe(0.65);
    expect(a2023.volumen).toMatchObject({ nivel: "temporada", temporada: "invierno", ratio_control: 1, ratio_relativo: 0.65, agrupaciones: 1, anio_referencia: 2024, corrida_id: c.id });
    expect(a2023.volumen?.crecimiento_normal).toBeCloseTo(1.236, 3);
    expect(d.anios.find((a) => a.anio === 2024)?.volumen).toBeNull();

    const ag = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", `?agrupacion_id=${A[ABRIGO_ID]}`)))).data;
    expect(ag.anios.find((a) => a.anio === 2023)?.volumen?.ratio_agrupacion).toBe(0.65);
    const ver = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=verano")))).data;
    expect(ver.anios.find((a) => a.anio === 2023)?.ratio_volumen).toBe(1.46);
  });
  it("PATCH de la referencia mueve el corrida_id que devuelve /anios y sus ratios", async () => {
    const c1 = await calcularOk();
    const c2 = await calcularOk({ hasta_periodo: "2025-12" });
    expect((await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=invierno")))).data.corrida_id).toBe(c1.id);
    await marcarReferencia(json({ referencia: true }, "PATCH"), ctx(c2.id));
    const d = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=invierno")))).data;
    expect(d.corrida_id).toBe(c2.id);
    // La corrida hasta 2025-12 no tiene 2026: ya no hay ratio para ese año.
    expect(d.anios.find((a) => a.anio === 2026)?.volumen ?? null).toBeNull();
    expect(d.anios.find((a) => a.anio === 2023)?.ratio_volumen).toBe(0.65);
  });
});

describe("GET /api/curvas/anios-atipicos y /red-comparable", () => {
  it("sin corrida: corrida null y los periodos activos", async () => {
    const d = (await leer<AniosAtipicosNinoApi>(await aniosNino(get("/anios-atipicos")))).data;
    expect(d).toMatchObject({ corrida: null, efecto: null, anios: [], agrupaciones: [], temporadas: [] });
    expect(d.periodos).toHaveLength(4);
  });
  it("con corrida de referencia: efecto, años por temporada, agrupaciones y temporadas; no lee la vista", async () => {
    const c = await calcularOk();
    const llamadas = estadoFalso.llamadasAgregado;
    const d = (await leer<AniosAtipicosNinoApi>(await aniosNino(get("/anios-atipicos")))).data;
    expect(d.corrida?.id).toBe(c.id);
    expect(d.efecto?.por_temporada.some((f) => f.temporada === "invierno" && f.anio === 2023)).toBe(true);
    expect(d.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(d.anios[0].clase_por_temporada).toMatchObject({ invierno: "atipico_completo", verano: "con_huecos", todo_el_ano: "normal" });
    expect(d.anios[3].completo).toBe(false);
    expect(d.agrupaciones.map((a) => a.nombre).sort()).toEqual(["ABRIGO", "CONSTANTE", "VERANO"]);
    expect(d.temporadas).toHaveLength(3);
    expect(estadoFalso.llamadasAgregado).toBe(llamadas);
  });
  it("red-comparable sin corrida: años con pesos, perfiles y distinta; parámetros por query; 400 y 409", async () => {
    const r = await redComparable(get("/red-comparable"));
    const d = (await leer<RedComparableVistaPrevia>(r)).data;
    expect(d.hasta_periodo).toBe("2026-09");
    expect(d.anios.map((a) => a.tiendas.filter((t) => t.entra).length)).toEqual([1, 2, 3, 4]);
    expect(d.anios[3].tiendas.find((t) => t.codigo === "T3")).toMatchObject({ entra: true, distinta: true });
    expect(d.anios[3].tiendas.every((t) => typeof t.nombre === "string")).toBe(true);
    const con12 = (await leer<RedComparableVistaPrevia>(await redComparable(get("/red-comparable", "?meses_tienda_nueva=12")))).data;
    expect(con12.anios[3].tiendas.find((t) => t.codigo === "T3")).toMatchObject({ entra: false, motivos: ["tienda_nueva"], entra_desde: 2027 });
    expect((await redComparable(get("/red-comparable", "?meses_tienda_nueva=99"))).status).toBe(400);
    expect(estadoFalso.llamadasAgregado).toBe(0);
    estadoFalso.tablas.cargas_venta_stock = [];
    expect((await redComparable(get("/red-comparable"))).status).toBe(409);
  });
});
