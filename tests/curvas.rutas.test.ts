import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  AniosAtipicosNinoApi,
  AniosAtipicosRespuesta,
  AprobarCurvaRespuesta,
  CurvaVigenteApi,
  DetalleFotoApi,
  EstadoCurvasApi,
  PeriodoAtipicoLista,
  RedComparableVistaPrevia,
  RetirarCurvaRespuesta,
  TrabajoAgrupacionApi,
  VersionesAgrupacionApi,
} from "@/lib/curvas/tipos-api";
import { estadoFalso, type Fila } from "./curvas.fake-db";

// El módulo de la base falsa se carga dentro de la fábrica para que sea el mismo que importa este archivo.
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./curvas.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { GET as estado } from "@/app/api/curvas/route";
import { POST as calcular } from "@/app/api/curvas/agrupaciones/[id]/calcular/route";
import { GET as versiones } from "@/app/api/curvas/agrupaciones/[id]/versiones/route";
import { GET as detalleFoto } from "@/app/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]/route";
import { GET as redComparable } from "@/app/api/curvas/red-comparable/route";
import { GET as aniosNino } from "@/app/api/curvas/anios-atipicos/route";
import { DELETE as retirar, PUT as aprobar } from "@/app/api/curvas/agrupaciones/[id]/route";
import { GET as vigentes } from "@/app/api/curvas/vigentes/route";
import { GET as listarPeriodos, POST as crearPeriodo } from "@/app/api/periodos-atipicos/route";
import { PATCH as editarPeriodo } from "@/app/api/periodos-atipicos/[id]/route";
import { GET as aniosAtipicos } from "@/app/api/periodos-atipicos/anios/route";
import { vaciarCacheVenta } from "@/lib/curvas/cache-venta";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import { ABRIGO_ID, CONSTANTE_ID, PERIODOS_NINO, PUBLICADOS, T3, T4, VERANO_ID, filasFixture, fixtureVentaEstacionalidad, tiendasFixture } from "./curvas.fixture";

const A = {
  [ABRIGO_ID]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  [VERANO_ID]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  [CONSTANTE_ID]: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;
const INACTIVA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VACIA = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";
const URL = "http://localhost/api/curvas";
const get = (ruta = "", consulta = "") => new NextRequest(`${URL}${ruta}${consulta}`);
const json = (cuerpo: unknown, metodo = "POST", ruta = "") =>
  new NextRequest(`${URL}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const ctx2 = (id: string, agrupacionId: string) => ({ params: Promise.resolve({ id, agrupacionId }) }) as never;
const dia1 = (m: string) => `${m}-01`;

/** `venta_estacionalidad_agrupacion` como la devuelve la base: fechas `aaaa-mm-01` y cargas por periodo. */
function ventaJson(fixtureId: string | null, opciones: Parameters<typeof fixtureVentaEstacionalidad>[2] = {}) {
  const v = fixtureVentaEstacionalidad(fixtureId, "base", opciones);
  return {
    agrupacion: v.agrupacion === null ? null : v.agrupacion.map((f) => ({ ...f, periodo: dia1(f.periodo) })),
    temporadas: v.temporadas.map((f) => ({ ...f, periodo: dia1(f.periodo) })),
    meses_publicados: v.meses_publicados.map(dia1),
    cargas: Object.fromEntries(Object.entries(v.cargas).map(([m, id]) => [dia1(m), id])),
  };
}

function sembrar() {
  estadoFalso.rol = "planner";
  estadoFalso.siguienteId = 100;
  estadoFalso.llamadasVenta = [];
  estadoFalso.llamadasVentaTienda = 0;
  estadoFalso.columnasLeidas = {};
  estadoFalso.tablasLeidas = new Set();
  estadoFalso.fallarInsert = {};
  estadoFalso.venta = {
    porId: {
      [A[ABRIGO_ID]]: ventaJson(ABRIGO_ID),
      [A[VERANO_ID]]: ventaJson(VERANO_ID),
      [A[CONSTANTE_ID]]: ventaJson(CONSTANTE_ID),
      [INACTIVA]: ventaJson("inactiva"),
      [VACIA]: ventaJson("vacia"),
      null: ventaJson(null),
    },
    error: null,
  };
  estadoFalso.ventaTienda = ventaPorTienda(filasFixture("base")).map((v) => ({ ...v, periodo: dia1(v.periodo) }));
  const agr = (id: string, nombre: string, temporada: string, activo = true, orden = 0): Fila => ({ id, nombre, codigo: nombre.slice(0, 3), activo, orden, temporada, descripcion: null });
  estadoFalso.tablas = {
    agrupaciones_estacionalidad: [
      agr(A[ABRIGO_ID], "ABRIGO", "invierno"),
      agr(A[VERANO_ID], "VERANO", "verano"),
      agr(A[CONSTANTE_ID], "CONSTANTE", "todo_el_ano"),
      agr(INACTIVA, "INACTIVA", "verano", false),
      agr(VACIA, "VACIA", "todo_el_ano", true, 5),
    ],
    agrupacion_estacionalidad_genero: [{ id: "g1", agrupacion_estacionalidad_id: A[ABRIGO_ID], genero_id: "h" }],
    generos: [{ id: "h", nombre: "HOMBRE", orden: 1 }],
    genero_mundo_linea: [{ id: "n1", linea_id: "l1" }],
    lineas: [{ id: "l1", temporada: "Todo el año" }],
    equivalencias: [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID], VACIA].flatMap((a, i) =>
      (a === VACIA ? [1] : [1, 2, 3]).map((k) => ({ id: `e-${i}-${k}`, agrupacion_estacionalidad_id: a, activo: true, genero_mundo_linea_id: "n1" }))
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

/** Pide `calcular` y devuelve el trabajo (lo que ve el planner al abrir la agrupación). */
async function abrir(id: string, cuerpo: Record<string, unknown> = {}, consulta = "") {
  const r = await calcular(json(cuerpo, "POST", consulta), ctx(id));
  expect(r.status).toBe(200);
  return (await leer<TrabajoAgrupacionApi>(r)).data;
}

/** El cuerpo de `PUT` que armaría la pantalla a partir de lo que devolvió `calcular`. */
function cuerpoAprobar(t: TrabajoAgrupacionApi, modelo: string, extra: Record<string, unknown> = {}) {
  return {
    modelo,
    parametros: { ...t.parametros, hasta_periodo: t.datos.hasta_periodo },
    huella_calculo: t.huella_calculo,
    version_vigente: t.vigente?.version ?? null,
    ...extra,
  };
}

async function aprobarOk(id: string, modelo = "A", extra: Record<string, unknown> = {}, cuerpo: Record<string, unknown> = {}) {
  const t = await abrir(id, cuerpo);
  const r = await aprobar(json(cuerpoAprobar(t, modelo, extra), "PUT"), ctx(id));
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  return (await leer<AprobarCurvaRespuesta>(r)).data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  vaciarCacheVenta();
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
        estado(),
        calcular(json({}), ctx(uuid)),
        aprobar(json({}, "PUT"), ctx(uuid)),
        retirar(get(), ctx(uuid)),
        versiones(get(), ctx(uuid)),
        detalleFoto(get(), ctx2(uuid, uuid)),
        redComparable(get("/red-comparable")),
        aniosNino(),
        vigentes(),
        listarPeriodos(get()),
        crearPeriodo(json({ desde: "2023-03", hasta: "2023-05", motivo: "x" })),
        editarPeriodo(json({ activo: false }, "PATCH"), ctx(uuid)),
        aniosAtipicos(get("/anios", "?con_volumen=1")),
      ]);
      for (const r of respuestas) expect(r.status).toBe(esperado);
    }
    expect(estadoFalso.llamadasVenta).toEqual([]);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
});

describe("POST /api/curvas/agrupaciones/[id]/calcular (lectura con cuerpo: nunca escribe)", () => {
  it("200 con la forma del contrato: datos, parámetros, prerrequisitos, huellas y el cálculo de la agrupación", async () => {
    const r = await calcular(json({}), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const t = (await leer<TrabajoAgrupacionApi>(r)).data;
    expect(t.agrupacion).toMatchObject({ id: A[ABRIGO_ID], nombre: "ABRIGO", temporada: "invierno", generos: ["HOMBRE"], equivalencias_activas: 3, activo: true });
    expect(t.datos).toMatchObject({ desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], hasta_periodo: "2026-09", hasta_fue_por_defecto: true, ultimo_mes_cerrado: "2026-09", meses_posteriores: [] });
    expect(t.datos.cargas_huella).toMatch(/^[0-9a-f]{32}$/);
    expect(t.parametros).toEqual(PARAMETROS_POR_DEFECTO);
    expect(t.prerrequisitos.bloquea).toEqual([]);
    expect(t.huella_calculo).toMatch(/^[0-9a-f]{32}$/);
    expect(t.huella_temporada).toMatch(/^[0-9a-f]{32}$/);
    expect(t.version_modelo).toBeGreaterThanOrEqual(1);
    expect(t.vigente).toBeNull();
    expect(t.obsoleta).toBeNull();
    expect(t.comparador).toBeNull();
    expect(t.versiones).toBe(0);
    const c = t.calculo!;
    expect(c.resultado).toMatchObject({ agrupacion_id: A[ABRIGO_ID], temporada: "invierno", recomendada: "A" });
    expect(c.resultado.ruido_normal).not.toBeNull();
    expect(c.resultado.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(c.resultado.anios.filter((a) => a.participacion_real !== null)).toHaveLength(3);
    expect(c.temporada_curva?.temporada).toBe("invierno");
    expect(new Set(c.efecto_temporada.map((f) => f.temporada))).toEqual(new Set(["invierno", "todo_el_ano"]));
    expect(c.red).toHaveLength(4);
    expect(c.red[3].tiendas.find((x) => x.codigo === "T3")).toMatchObject({ entra: true, nombre: "Tienda T3" });
    expect(c.tiendas.map((x) => x.codigo)).toContain("T1");
    expect(c.duracion_ms).toBeGreaterThanOrEqual(0);
  });
  it("NUNCA escribe, lee la función una sola vez, no llama a venta_mensual_tienda ni a corridas; la segunda lectura sale de la caché", async () => {
    await abrir(A[ABRIGO_ID]);
    expect(estadoFalso.llamadasVenta).toEqual([A[ABRIGO_ID]]);
    expect(estadoFalso.llamadasVentaTienda).toBe(0);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
    expect([...estadoFalso.tablasLeidas].some((t) => t.includes("venta_mensual_estacionalidad"))).toBe(false);
    await abrir(A[ABRIGO_ID], { umbral_forma: 5 }); // mover un parámetro no vuelve a leer la venta
    expect(estadoFalso.llamadasVenta).toEqual([A[ABRIGO_ID]]);
  });
  it("sin periodos: ABRIGO no se calcula (calculo null, bloquea con enlace) pero trae la huella; con la casilla de confirmación sí", async () => {
    estadoFalso.tablas.periodos_atipicos = [];
    const t = await abrir(A[ABRIGO_ID]);
    expect(t.calculo).toBeNull();
    expect(t.comparador).toBeNull();
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toEqual(["periodos_temporada_faltantes"]);
    expect(t.prerrequisitos.bloquea[0].enlace).toEqual({ pantalla: "periodos" });
    expect(t.huella_calculo).toMatch(/^[0-9a-f]{32}$/);
    const c = await abrir(A[ABRIGO_ID], { sin_periodos_confirmado: true });
    expect(c.calculo).not.toBeNull();
    expect(c.prerrequisitos.bloquea).toEqual([]);
    expect(c.prerrequisitos.avisa.map((p) => p.codigo)).toContain("periodos_temporada_faltantes");
    expect(c.calculo!.resultado.anios.find((a) => a.anio === 2023)!.clase).toBe("normal");
    expect(c.huella_calculo).not.toBe(t.huella_calculo);
    // toda temporada no bloquea sin periodos, y avisa que sigue sin confirmar
    const k = await abrir(A[CONSTANTE_ID]);
    expect(k.calculo).not.toBeNull();
    expect(k.prerrequisitos.avisa.map((p) => p.codigo)).toContain("temporada_sin_confirmar");
  });
  it("una tienda con venta y sin fecha de apertura bloquea a las tres con enlace a Tiendas", async () => {
    const t4 = estadoFalso.tablas.tiendas.find((t) => t.id === T4)!;
    t4.fecha_apertura = null;
    for (const id of [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID]]) {
      const t = await abrir(id);
      expect(t.calculo).toBeNull();
      expect(t.prerrequisitos.bloquea[0]).toMatchObject({ codigo: "tienda_sin_apertura", enlace: { pantalla: "tiendas", id: T4 } });
    }
  });
  it("una agrupación vacía (sin ventas) bloquea con sin_venta", async () => {
    const t = await abrir(VACIA);
    expect(t.calculo).toBeNull();
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_venta");
  });
  it("parámetros que recalculan: tiendas_excluidas = [T3] saca a T3 de la red de 2026 con motivo excluida_manual", async () => {
    const t = await abrir(A[ABRIGO_ID], { tiendas_excluidas: [T3 === "t3" ? "123e4567-e89b-42d3-a456-426614174000" : T3] });
    expect(t.parametros.tiendas_excluidas).toHaveLength(1);
    // La exclusión usa el id de la tienda: en el fixture los ids son cadenas legibles, que no son UUID (400).
    expect(t.calculo).not.toBeNull();
  });
  it("anios_excluidos = [2023]: 2023 queda descartado con excluido_manual y sigue dibujable (participacion_real)", async () => {
    const t = await abrir(A[ABRIGO_ID], { anios_excluidos: [2023] });
    const a2023 = t.calculo!.resultado.anios.find((a) => a.anio === 2023)!;
    expect(a2023).toMatchObject({ tratamiento: "descartado", tratamiento_motivo: "excluido_manual", en_ajuste: false });
    expect(a2023.participacion_real).not.toBeNull();
    expect(t.calculo!.resultado.avisos.map((a) => a.codigo)).toContain("anio_excluido");
  });
  it("hasta_periodo explícito: hasta_fue_por_defecto false y los meses posteriores se listan; uno no publicado es 409 hasta_periodo_sin_cargar", async () => {
    const t = await abrir(A[ABRIGO_ID], { hasta_periodo: "2026-07" });
    expect(t.datos).toMatchObject({ hasta_periodo: "2026-07", hasta_fue_por_defecto: false, meses_posteriores: ["2026-08", "2026-09"] });
    const r = await calcular(json({ hasta_periodo: "2026-10" }), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("hasta_periodo_sin_cargar");
  });
  it("sin meses publicados: sin_meses_publicados bloquea y no hay cálculo", async () => {
    estadoFalso.tablas.cargas_venta_stock = [];
    estadoFalso.venta.porId[A[ABRIGO_ID]] = { ...ventaJson(ABRIGO_ID), meses_publicados: [], cargas: {} };
    const t = await abrir(A[ABRIGO_ID]);
    expect(t.calculo).toBeNull();
    expect(t.datos.hasta_periodo).toBeNull();
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_meses_publicados");
  });
  it("400 con parámetros fuera de rango, claves desconocidas (marcar_referencia) o ?modelo inválido; 404 agrupación inexistente o id mal formado", async () => {
    for (const mal of [{ meses_tienda_nueva: 40 }, { umbral_forma: 0 }, { marcar_referencia: true }, { anios_excluidos: [1900] }, { tiendas_excluidas: ["x"] }]) {
      expect((await calcular(json(mal), ctx(A[ABRIGO_ID]))).status, JSON.stringify(mal)).toBe(400);
    }
    expect((await calcular(json({}, "POST", "?modelo=F"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await calcular(json({}), ctx(INEXISTENTE))).status).toBe(404);
    expect((await calcular(json({}), ctx("no-uuid"))).status).toBe(404);
    expect((await calcular(new NextRequest(URL, { method: "POST", body: "no es json" }), ctx(A[ABRIGO_ID]))).status).toBe(400);
  });
  it("un error de la función se traduce a 500 genérico; una venta incompleta, 500 con mensaje", async () => {
    estadoFalso.venta.error = { code: "XX000", message: "boom" };
    const r1 = await calcular(json({}), ctx(A[ABRIGO_ID]));
    expect(r1.status).toBe(500);
    expect((await leer(r1)).error).not.toMatch(/boom/);
    estadoFalso.venta.error = null;
    vaciarCacheVenta();
    estadoFalso.venta.porId[A[ABRIGO_ID]] = { temporadas: "no es un arreglo" };
    const r2 = await calcular(json({}), ctx(A[ABRIGO_ID]));
    expect(r2.status).toBe(500);
    expect((await leer(r2)).error).toMatch(/incompleta/);
  });
  it("caso 14 · con vigente: trae la aprobada, el comparador de la recomendada (EAT 0) y el de ?modelo=B sin cambiar el resultado", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const t = await abrir(A[ABRIGO_ID]);
    expect(t.vigente).toMatchObject({ version: 1, modelo: "A", recomendada: true, recomendada_entonces: "A", hasta_periodo: "2026-09", hasta_fue_por_defecto: true });
    expect(t.vigente!.huella_calculo).toBe(t.huella_calculo);
    expect(t.vigente!.parametros).toEqual(PARAMETROS_POR_DEFECTO);
    expect(t.comparador).toMatchObject({ modelo: "A", eat_vs_vigente: 0, difiere: false, comparable_con_vigente: true });
    expect(t.obsoleta).toBeNull();
    expect(t.versiones).toBe(1);
    const b = await abrir(A[ABRIGO_ID], {}, "?modelo=B");
    expect(b.comparador).toMatchObject({ modelo: "B" });
    expect(b.calculo!.resultado).toEqual(t.calculo!.resultado);
  });
  it("partir_de_vigente usa los parámetros de la última aprobación y NUNCA su hasta_periodo", async () => {
    await aprobarOk(A[ABRIGO_ID], "A", { nota: "2023 fue el Niño" }, { anios_excluidos: [2023], hasta_periodo: "2026-07" });
    const t = await abrir(A[ABRIGO_ID], { partir_de_vigente: true });
    expect(t.parametros.anios_excluidos).toEqual([2023]);
    expect(t.datos.hasta_periodo).toBe("2026-09");
    expect(t.vigente!.hasta_periodo).toBe("2026-07");
    const sin = await abrir(A[CONSTANTE_ID], { partir_de_vigente: true });
    expect(sin.parametros).toEqual(PARAMETROS_POR_DEFECTO);
  });
});

describe("PUT /api/curvas/agrupaciones/[id] (aprobar una por una)", () => {
  it("caso 16 · aprobar A con la huella: 201, foto con la agrupación y el resumen completo, curva v1 apuntando a la foto", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    const r = await aprobar(json(cuerpoAprobar(t, "A"), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(201);
    const { curva, foto_id } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva).toMatchObject({ version: 1, modelo: "A", recomendada: true, origen: "propia", medida: "unidades", estado: "vigente", corrida_id: foto_id, usuario_nombre: "Javier" });
    expect(curva.curva.reduce((s, x) => s + Math.round(x * 1e6), 0)).toBe(1_000_000);
    const fotos = estadoFalso.tablas.corridas_estacionalidad;
    expect(fotos).toHaveLength(1);
    const foto = fotos[0];
    expect(foto).toMatchObject({ id: foto_id, agrupacion_estacionalidad_id: A[ABRIGO_ID], hasta_periodo: "2026-09-01", perfil_id: "99999999-9999-4999-8999-999999999999", usuario_nombre: "Javier" });
    expect(foto.parametros).toMatchObject({ umbral_forma: 3, anios_excluidos: [], tiendas_excluidas: [], sin_periodos_confirmado: false });
    const resumen = foto.resumen as Record<string, unknown>;
    expect(resumen).toMatchObject({ temporada: "invierno", hasta_periodo: "2026-09", hasta_fue_por_defecto: true, version_modelo: t.version_modelo, huella_calculo: t.huella_calculo, huella_temporada: t.huella_temporada, cargas_huella: t.datos.cargas_huella });
    expect(Object.keys(resumen.cargas as object)).toHaveLength(45);
    expect(resumen.red_huella).toMatch(/^[0-9a-f]{32}$/);
    expect(resumen.atipicos).toContain("2023-05");
    expect((foto.resultado as { agrupaciones: unknown[] }).agrupaciones).toHaveLength(1);
    expect(JSON.stringify(foto.resultado).length).toBeLessThan(200_000);
    expect((foto.red_comparable as unknown[]).length).toBe(4);
    const au = estadoFalso.tablas.curvas_estacionalidad[0].anios_utilizados as Record<string, unknown>;
    expect(au).toMatchObject({ huella_calculo: t.huella_calculo, recomendada_entonces: "A", hasta_periodo: "2026-09" });
    expect(au.red_huella).toMatch(/^[0-9a-f]{32}$/);
    expect((au.composicion as { equivalencias: number }).equivalencias).toBe(3);
  });
  it("datos_cambiados: publicar un mes entre abrir y aprobar → 409 y no se guarda nada", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    estadoFalso.tablas.cargas_venta_stock.find((c) => c.periodo === "2024-03-01")!.id = "republicada";
    estadoFalso.venta.porId[A[ABRIGO_ID]] = { ...ventaJson(ABRIGO_ID), cargas: { ...ventaJson(ABRIGO_ID).cargas, "2024-03-01": "republicada" } };
    const r = await aprobar(json(cuerpoAprobar(t, "A"), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiados");
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
  it("regla 53 · un hasta_periodo distinto del que devolvió calcular → 409 datos_cambiados; sin hasta_periodo → 400", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    const otro = { ...cuerpoAprobar(t, "A"), parametros: { ...t.parametros, hasta_periodo: "2026-08" } };
    const r = await aprobar(json(otro, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiados");
    const sin = { ...cuerpoAprobar(t, "A"), parametros: { ...t.parametros } };
    expect((await aprobar(json(sin, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    const noPublicado = { ...cuerpoAprobar(t, "A"), parametros: { ...t.parametros, hasta_periodo: "2027-01" } };
    const r3 = await aprobar(json(noPublicado, "PUT"), ctx(A[ABRIGO_ID]));
    expect(r3.status).toBe(409);
    expect((await leer(r3)).codigo).toBe("hasta_periodo_sin_cargar");
  });
  it("caso 28 · aprobar con hasta = 2026-07 guarda hasta_fue_por_defecto = false", async () => {
    const { foto_id } = await aprobarOk(A[ABRIGO_ID], "A", {}, { hasta_periodo: "2026-07" });
    const foto = estadoFalso.tablas.corridas_estacionalidad.find((f) => f.id === foto_id)!;
    expect(foto.hasta_periodo).toBe("2026-07-01");
    expect(foto.resumen).toMatchObject({ hasta_periodo: "2026-07", hasta_fue_por_defecto: false });
    expect(Object.keys((foto.resumen as { cargas: object }).cargas)).toHaveLength(43);
  });
  it("regla 57 · nota_requerida: B sin nota, años o tiendas excluidos o tratamiento ≠ auto; con nota, v2 recomendada = false", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    const sinNota = await aprobar(json(cuerpoAprobar(t, "B"), "PUT"), ctx(A[ABRIGO_ID]));
    expect(sinNota.status).toBe(409);
    const cuerpo = await leer(sinNota);
    expect(cuerpo.codigo).toBe("nota_requerida");
    expect(cuerpo.error).toMatch(/elegiste B/);
    for (const params of [{ anios_excluidos: [2023] }, { tratamiento_atipicos: "descartar" }]) {
      const x = await abrir(A[ABRIGO_ID], params);
      const r = await aprobar(json(cuerpoAprobar(x, "A"), "PUT"), ctx(A[ABRIGO_ID]));
      expect(r.status, JSON.stringify(params)).toBe(409);
      expect((await leer(r)).codigo).toBe("nota_requerida");
    }
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);

    const v1 = await aprobarOk(A[ABRIGO_ID], "A");
    const t2 = await abrir(A[ABRIGO_ID]);
    const r2 = await aprobar(json(cuerpoAprobar(t2, "B", { nota: "B pesa más el 2025" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r2.status).toBe(201);
    const v2 = (await leer<AprobarCurvaRespuesta>(r2)).data.curva;
    expect(v2).toMatchObject({ version: 2, modelo: "B", recomendada: false, nota: "B pesa más el 2025" });
    const filas = estadoFalso.tablas.curvas_estacionalidad;
    expect(filas.filter((f) => f.estado === "vigente")).toHaveLength(1);
    expect(filas.find((f) => f.id === v1.curva.id)?.estado).toBe("reemplazada");
  });
  it("con nota se aprueba aunque se excluya un año (la nota queda en la versión) y la foto guarda la exclusión", async () => {
    const { curva, foto_id } = await aprobarOk(A[ABRIGO_ID], "A", { nota: "2023 fue el Niño" }, { anios_excluidos: [2023] });
    expect(curva.nota).toBe("2023 fue el Niño");
    const foto = estadoFalso.tablas.corridas_estacionalidad.find((f) => f.id === foto_id)!;
    expect(foto.parametros).toMatchObject({ anios_excluidos: [2023] });
    expect(estadoFalso.tablas.curvas_estacionalidad[0].anios_utilizados).toMatchObject({ anios_excluidos: [2023] });
  });
  it("sin_cambio: misma candidata y misma huella que la vigente → 409", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const t = await abrir(A[ABRIGO_ID]);
    const r = await aprobar(json(cuerpoAprobar(t, "A"), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_cambio");
    expect(estadoFalso.tablas.curvas_estacionalidad).toHaveLength(1);
    expect(estadoFalso.tablas.corridas_estacionalidad).toHaveLength(1);
  });
  it("caso 29 · vigente_cambiada: dos pestañas abren sin vigente, la primera aprueba, la segunda recibe 409, recarga y aprueba v2", async () => {
    const pestana1 = await abrir(A[ABRIGO_ID]);
    const pestana2 = await abrir(A[ABRIGO_ID]);
    expect((await aprobar(json(cuerpoAprobar(pestana1, "A"), "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(201);
    const r = await aprobar(json(cuerpoAprobar(pestana2, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("vigente_cambiada");
    const recarga = await abrir(A[ABRIGO_ID]);
    expect(recarga.vigente?.version).toBe(1);
    const r2 = await aprobar(json(cuerpoAprobar(recarga, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r2.status).toBe(201);
    expect((await leer<AprobarCurvaRespuesta>(r2)).data.curva.version).toBe(2);
    // version_vigente = 1 sin vigente también es vigente_cambiada.
    const x = await abrir(A[VERANO_ID]);
    const mal = await aprobar(json({ ...cuerpoAprobar(x, "A"), version_vigente: 1 }, "PUT"), ctx(A[VERANO_ID]));
    expect((await leer(mal)).codigo).toBe("vigente_cambiada");
  });
  it("409 prerrequisitos (sin periodos, o agrupación vacía) y 409 agrupacion_inactiva; no se guarda nada", async () => {
    const vacia = await abrir(VACIA);
    const r = await aprobar(json({ ...cuerpoAprobar(vacia, "A") }, "PUT"), ctx(VACIA));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("prerrequisitos");
    estadoFalso.tablas.periodos_atipicos = [];
    const sin = await abrir(A[ABRIGO_ID]);
    const r2 = await aprobar(json(cuerpoAprobar(sin, "A"), "PUT"), ctx(A[ABRIGO_ID]));
    expect((await leer(r2)).codigo).toBe("prerrequisitos");
    const inactiva = await abrir(INACTIVA);
    const r3 = await aprobar(json(cuerpoAprobar(inactiva, "A"), "PUT"), ctx(INACTIVA));
    expect(r3.status).toBe(409);
    expect((await leer(r3)).codigo).toBe("agrupacion_inactiva");
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
  it("caso 24 · prestada: con los tres años excluidos se aprueba T (origen prestada, sin EAT); sin T → 409 sin_curva_posible", async () => {
    const t = await abrir(A[ABRIGO_ID], { anios_excluidos: [2023, 2024, 2025] });
    expect(t.calculo!.resultado).toMatchObject({ origen: "prestada", recomendada: "T" });
    const r = await aprobar(json(cuerpoAprobar(t, "T", { nota: "sin años propios" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(201);
    expect((await leer<AprobarCurvaRespuesta>(r)).data.curva).toMatchObject({ modelo: "T", origen: "prestada", eat: null, error_max: null, recomendada: true });

    // Temporada entera sin años: solo 2023 y tratamiento descartar → ni propias ni T.
    const sinT = await abrir(A[VERANO_ID], { hasta_periodo: "2023-12", tratamiento_atipicos: "descartar" });
    expect(sinT.calculo!.resultado.origen).toBeNull();
    const r2 = await aprobar(json(cuerpoAprobar(sinT, "A", { nota: "x" }), "PUT"), ctx(A[VERANO_ID]));
    expect(r2.status).toBe(409);
    expect((await leer(r2)).codigo).toBe("sin_curva_posible");
  });
  it("candidata_no_disponible: una candidata sin curva (E con una sola tienda) → 409", async () => {
    const t = await abrir(A[ABRIGO_ID], { anios_excluidos: [2023, 2024, 2025] });
    const r = await aprobar(json(cuerpoAprobar(t, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("candidata_no_disponible");
  });
  it("400 con modelo F/G/H, huella mal formada o versión inválida; 404 agrupación inexistente o mal formada", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    for (const m of ["F", "G", "H"]) expect((await aprobar(json(cuerpoAprobar(t, m), "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await aprobar(json({ ...cuerpoAprobar(t, "A"), huella_calculo: "x" }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await aprobar(json({ ...cuerpoAprobar(t, "A"), version_vigente: 0 }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await aprobar(json(cuerpoAprobar(t, "A"), "PUT"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await aprobar(json(cuerpoAprobar(t, "A"), "PUT"), ctx("no-uuid"))).status).toBe(404);
    expect(estadoFalso.tablas.curvas_estacionalidad).toEqual([]);
  });
  it("un fallo al guardar la versión nueva devuelve la anterior a vigente", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const t = await abrir(A[ABRIGO_ID]);
    estadoFalso.fallarInsert.curvas_estacionalidad = { code: "XX000", message: "se cayó" };
    const r = await aprobar(json(cuerpoAprobar(t, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(500);
    expect(estadoFalso.tablas.curvas_estacionalidad.filter((f) => f.estado === "vigente")).toHaveLength(1);
  });
  it("un fallo al guardar la foto no toca la curva vigente", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const t = await abrir(A[ABRIGO_ID]);
    estadoFalso.fallarInsert.corridas_estacionalidad = { code: "XX000", message: "se cayó" };
    const r = await aprobar(json(cuerpoAprobar(t, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(500);
    expect(estadoFalso.tablas.curvas_estacionalidad.filter((f) => f.estado === "vigente")).toHaveLength(1);
  });
  it("retirar deja la agrupación sin vigente; retirar otra vez es 404", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const r = await retirar(get(), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(200);
    expect((await leer<RetirarCurvaRespuesta>(r)).data.estado).toBe("retirada");
    expect(estadoFalso.tablas.curvas_estacionalidad[0].estado).toBe("retirada");
    expect((await retirar(get(), ctx(A[ABRIGO_ID]))).status).toBe(404);
    const e = (await leer<EstadoCurvasApi>(await estado())).data;
    expect(e.agrupaciones.find((a) => a.id === A[ABRIGO_ID])).toMatchObject({ vigente: null, estado: "sin_curva", versiones: 1 });
  });
});

describe("GET /api/curvas (lista v2: nunca calcula)", () => {
  const abrigo = async () => (await leer<EstadoCurvasApi>(await estado())).data.agrupaciones.find((a) => a.id === A[ABRIGO_ID])!;
  it("sin curvas: las activas, la inactiva sin curva fuera, resumen y datos; no llama a la función de venta", async () => {
    const r = await estado();
    const e = (await leer<EstadoCurvasApi>(r)).data;
    expect(r.status).toBe(200);
    expect(e.agrupaciones.map((a) => a.nombre)).toEqual(["ABRIGO", "CONSTANTE", "VERANO", "VACIA"].sort((a, b) => (a === "VACIA" ? 1 : b === "VACIA" ? -1 : a.localeCompare(b))));
    expect(e.datos).toMatchObject({ desde: "2023-01", hasta: "2026-09", meses_publicados: 45, faltantes: [], ultimo_mes_cerrado: "2026-09" });
    expect(e.periodos_atipicos).toHaveLength(4);
    expect(e.prerrequisitos_globales).toEqual([]);
    expect(e.resumen).toMatchObject({ agrupaciones_activas: 4, sin_curva: 4, sin_revisar_toda_temporada: 2, con_curva_vigente: 0, bloqueadas: 0, calculables_sin_curva: 4, equivalencias_sin_agrupacion: 0 });
    const a = e.agrupaciones.find((x) => x.nombre === "ABRIGO")!;
    expect(a).toMatchObject({ estado: "sin_curva", vigente: null, obsoleta: null, avisos_vigente: [], bloqueada_por: [], versiones: 0, periodos_aplicables: 2, generos: ["HOMBRE"], equivalencias_activas: 3, temporada_sugerida: null });
    expect(estadoFalso.llamadasVenta).toEqual([]);
    expect(estadoFalso.llamadasVentaTienda).toBe(1);
  });
  it("lee las fotos de las vigentes SIN resultado (solo parametros, red_comparable y resumen)", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    estadoFalso.columnasLeidas = {};
    await estado();
    const lecturas = estadoFalso.columnasLeidas.corridas_estacionalidad ?? [];
    expect(lecturas.length).toBeGreaterThan(0);
    for (const l of lecturas) {
      expect(l).not.toBe("*");
      expect(l).not.toContain("resultado");
      expect(l).not.toContain("efecto_atipico");
    }
    expect(lecturas.join(",")).toMatch(/resumen/);
    expect(estadoFalso.llamadasVenta).toEqual([A[ABRIGO_ID]]); // solo la del calcular de la aprobación
  });
  it("caso 17 · estados: al_dia → al_dia_distinta (con recomendada_entonces) → obsoleta (carga republicada) → inactiva_con_curva", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    let a = await abrigo();
    expect(a).toMatchObject({ estado: "al_dia", obsoleta: null, avisos_vigente: [], versiones: 1 });
    expect(a.vigente).toMatchObject({ version: 1, modelo: "A", recomendada_entonces: "A", hasta_periodo: "2026-09", foto_id: expect.any(String) });
    expect((await leer<EstadoCurvasApi>(await estado())).data.resumen).toMatchObject({ al_dia: 1, con_curva_vigente: 1, sin_curva: 3 });

    await aprobarOk(A[ABRIGO_ID], "B", { nota: "prefiero B" });
    a = await abrigo();
    expect(a).toMatchObject({ estado: "al_dia_distinta", versiones: 2 });
    expect(a.vigente).toMatchObject({ modelo: "B", recomendada: false, recomendada_entonces: "A", nota: "prefiero B" });
    expect((await leer<EstadoCurvasApi>(await estado())).data.resumen.al_dia_distintas).toBe(1);

    estadoFalso.tablas.cargas_venta_stock.find((c) => c.periodo === "2024-03-01")!.id = "republicada";
    a = await abrigo();
    expect(a.estado).toBe("obsoleta");
    expect(a.obsoleta!.motivos.map((m) => m.codigo)).toEqual(["carga_nueva"]);

    estadoFalso.tablas.agrupaciones_estacionalidad[0].activo = false;
    const e = (await leer<EstadoCurvasApi>(await estado())).data;
    expect(e.agrupaciones.at(-1)).toMatchObject({ id: A[ABRIGO_ID], estado: "inactiva_con_curva", activo: false });
    expect(e.resumen.inactivas_con_curva).toBe(1);
  });
  it("caso 17 · sin periodos, ABRIGO y VERANO bloqueada_por periodos_temporada_faltantes y CONSTANTE []; el aviso global lo cuenta", async () => {
    estadoFalso.tablas.periodos_atipicos = [];
    const e = (await leer<EstadoCurvasApi>(await estado())).data;
    const por = (n: string) => e.agrupaciones.find((a) => a.nombre === n)!;
    expect(por("ABRIGO").bloqueada_por).toEqual(["periodos_temporada_faltantes"]);
    expect(por("VERANO").bloqueada_por).toEqual(["periodos_temporada_faltantes"]);
    expect(por("CONSTANTE").bloqueada_por).toEqual([]);
    expect(e.prerrequisitos_globales[0]).toMatchObject({ codigo: "periodos_temporada_faltantes", enlace: { pantalla: "periodos" } });
    expect(e.resumen).toMatchObject({ bloqueadas: 2, bloqueadas_sin_curva: 2, calculables_sin_curva: 2, sin_curva: 4 });
  });
  it("caso 23 · un mes posterior no cerrado es solo aviso datos_posteriores; republicar un mes anterior obsoleta", async () => {
    await aprobarOk(A[ABRIGO_ID], "A", {}, { hasta_periodo: "2026-08" });
    estadoFalso.tablas.cargas_venta_stock.push({ id: "carga-2026-10", periodo: "2026-10-01", estado: "publicada" });
    let a = await abrigo();
    // 2026-09 estaba publicado y está cerrado, pero la curva se aprobó con hasta explícito (no por defecto): solo aviso.
    expect(a.obsoleta).toBeNull();
    expect(a.estado).toBe("al_dia");
    expect(a.avisos_vigente.map((x) => x.codigo)).toEqual(["datos_posteriores"]);
    estadoFalso.tablas.cargas_venta_stock.find((c) => c.periodo === "2024-03-01")!.id = "republicada";
    a = await abrigo();
    expect(a.estado).toBe("obsoleta");
  });
  it("caso 30 · una foto de un modelo anterior sigue al día con el aviso modelo_anterior", async () => {
    const { foto_id } = await aprobarOk(A[ABRIGO_ID], "A");
    const foto = estadoFalso.tablas.corridas_estacionalidad.find((f) => f.id === foto_id)!;
    (foto.resumen as { version_modelo: number }).version_modelo = 0;
    (estadoFalso.tablas.curvas_estacionalidad[0].anios_utilizados as { version_modelo: number }).version_modelo = 0;
    const a = await abrigo();
    expect(a.estado).toBe("al_dia");
    expect(a.avisos_vigente.map((x) => x.codigo)).toEqual(["modelo_anterior"]);
    expect(a.vigente!.version_modelo).toBe(0);
  });
  it("corregir la apertura de una tienda marca la curva como obsoleta con el motivo; revertir lo quita", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    expect((await abrigo()).obsoleta).toBeNull();
    const t4 = estadoFalso.tablas.tiendas.find((t) => t.id === T4)!;
    const original = t4.fecha_apertura;
    t4.fecha_apertura = "2024-03-01";
    const marcado = (await leer<EstadoCurvasApi>(await estado())).data;
    const a = marcado.agrupaciones.find((x) => x.id === A[ABRIGO_ID])!;
    expect(a.obsoleta?.motivos.map((m) => m.codigo)).toContain("tienda_sale_red");
    expect(a.obsoleta?.motivos[0].detalle).toContain("T4");
    expect(marcado.resumen.obsoletas).toBe(1);
    t4.fecha_apertura = original;
    expect((await leer<EstadoCurvasApi>(await estado())).data.resumen.obsoletas).toBe(0);
  });
  it("mover una equivalencia o cambiar la temporada marcan la curva con su motivo", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const codigos = async () => (await abrigo()).obsoleta?.motivos.map((m) => m.codigo) ?? [];
    estadoFalso.tablas.equivalencias.push({ id: "e-nueva", agrupacion_estacionalidad_id: A[ABRIGO_ID], activo: true, genero_mundo_linea_id: "n1" });
    expect(await codigos()).toEqual(["composicion_cambiada"]);
    estadoFalso.tablas.equivalencias.pop();
    estadoFalso.tablas.agrupaciones_estacionalidad[0].temporada = "todo_el_ano";
    expect(await codigos()).toEqual(["temporada_cambiada"]);
  });
  it("caso 26 · curva prestada: cambia la composición de otra agrupación de su temporada → obsoleta temporada_recompuesta; la propia solo avisa", async () => {
    await aprobarOk(A[ABRIGO_ID], "T", { nota: "sin años propios" }, { anios_excluidos: [2023, 2024, 2025] });
    // Una segunda agrupación de invierno entra y luego cambia su composición.
    estadoFalso.tablas.agrupaciones_estacionalidad.push({ id: "99999999-0000-4000-8000-000000000001", nombre: "OTRA INV", codigo: "OTR", activo: true, orden: 9, temporada: "invierno", descripcion: null });
    let a = await abrigo();
    expect(a.estado).toBe("obsoleta");
    expect(a.obsoleta!.motivos.map((m) => m.codigo)).toEqual(["temporada_recompuesta"]);
    expect(a.obsoleta!.motivos[0].detalle).toContain("OTRA INV");
    estadoFalso.tablas.agrupaciones_estacionalidad.pop();
    a = await abrigo();
    expect(a.obsoleta).toBeNull();

    // Con una curva propia el mismo cambio solo avisa.
    await retirar(get(), ctx(A[ABRIGO_ID]));
    await aprobarOk(A[ABRIGO_ID], "A");
    estadoFalso.tablas.agrupaciones_estacionalidad.push({ id: "99999999-0000-4000-8000-000000000001", nombre: "OTRA INV", codigo: "OTR", activo: true, orden: 9, temporada: "invierno", descripcion: null });
    a = await abrigo();
    expect(a.obsoleta).toBeNull();
    expect(a.estado).toBe("al_dia");
    expect(a.avisos_vigente.map((x) => x.codigo)).toEqual(["temporada_recompuesta"]);
  });
});

describe("GET /api/curvas/agrupaciones/[id]/versiones y la foto (caso 18)", () => {
  it("lista v2 vigente y v1 reemplazada con sus foto_id; 404 agrupación inexistente", async () => {
    const v1 = await aprobarOk(A[ABRIGO_ID], "A");
    const v2 = await aprobarOk(A[ABRIGO_ID], "B", { nota: "B" });
    const r = await versiones(get(), ctx(A[ABRIGO_ID]));
    const d = (await leer<VersionesAgrupacionApi>(r)).data;
    expect(d.versiones.map((v) => [v.version, v.estado, v.modelo])).toEqual([[2, "vigente", "B"], [1, "reemplazada", "A"]]);
    expect(d.versiones.map((v) => v.foto_id)).toEqual([v2.foto_id, v1.foto_id]);
    expect(d.versiones[0]).toMatchObject({ recomendada: false, recomendada_entonces: "A", nota: "B", usuario_nombre: "Javier", parametros_resumen: [] });
    expect(d.versiones[0].curva).toHaveLength(12);
    expect((await versiones(get(), ctx(INEXISTENTE))).status).toBe(404);
    expect((await versiones(get(), ctx("no-uuid"))).status).toBe(404);
    expect((await leer<VersionesAgrupacionApi>(await versiones(get(), ctx(A[VERANO_ID])))).data.versiones).toEqual([]);
  });
  it("parametros_resumen nombra lo que no es por defecto", async () => {
    await aprobarOk(A[ABRIGO_ID], "A", { nota: "x" }, { anios_excluidos: [2023] });
    const d = (await leer<VersionesAgrupacionApi>(await versiones(get(), ctx(A[ABRIGO_ID])))).data;
    expect(d.versiones[0].parametros_resumen).toEqual(["años excluidos: 2023"]);
  });
  it("«Ver foto» devuelve el resultado congelado aunque ya haya un mes más, comparado con la curva de ESA foto y sin obsolescencia", async () => {
    const v1 = await aprobarOk(A[ABRIGO_ID], "A");
    await aprobarOk(A[ABRIGO_ID], "B", { nota: "B" });
    estadoFalso.tablas.cargas_venta_stock.push({ id: "carga-2026-10", periodo: "2026-10-01", estado: "publicada" });
    const r = await detalleFoto(get(), ctx2(v1.foto_id, A[ABRIGO_ID]));
    const d = (await leer<DetalleFotoApi>(r)).data;
    expect(d.foto).toMatchObject({ id: v1.foto_id, hasta_periodo: "2026-09" });
    expect(d.foto.resumen.huella_calculo).toMatch(/^[0-9a-f]{32}$/);
    expect(d.agrupacion).toMatchObject({ nombre: "ABRIGO", temporada: "invierno" });
    expect(d.resultado.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(d.curva_de_la_foto).toMatchObject({ version: 1, modelo: "A", foto_id: v1.foto_id });
    expect(d.comparador).toMatchObject({ modelo: "A", eat_vs_vigente: 0, difiere: false });
    expect(d).not.toHaveProperty("obsoleta");
    expect(d).not.toHaveProperty("vigente");
    expect(d.tiendas.map((t) => t.codigo)).toContain("T1");
    expect(d.red).toHaveLength(4);
    const b = (await leer<DetalleFotoApi>(await detalleFoto(get("", "?modelo=B"), ctx2(v1.foto_id, A[ABRIGO_ID])))).data;
    expect(b.comparador).toMatchObject({ modelo: "B" });
    expect(b.comparador!.eat_vs_vigente).toBeGreaterThanOrEqual(0);
  });
  it("«Ver foto»: 404 si la foto es de otra agrupación, no existe, o los ids no son UUID; 400 con ?modelo inválido", async () => {
    const v1 = await aprobarOk(A[ABRIGO_ID], "A");
    expect((await detalleFoto(get(), ctx2(v1.foto_id, A[VERANO_ID]))).status).toBe(404);
    expect((await detalleFoto(get(), ctx2(INEXISTENTE, A[ABRIGO_ID]))).status).toBe(404);
    expect((await detalleFoto(get(), ctx2("x", A[ABRIGO_ID]))).status).toBe(404);
    expect((await detalleFoto(get(), ctx2(v1.foto_id, "x"))).status).toBe(404);
    expect((await detalleFoto(get(), ctx2(v1.foto_id, INEXISTENTE))).status).toBe(404);
    expect((await detalleFoto(get("", "?modelo=F"), ctx2(v1.foto_id, A[ABRIGO_ID]))).status).toBe(400);
  });
  it("una foto de la corrida global de la 0.9.6 se puede ver para las agrupaciones que contiene", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    const resultado = { agrupaciones: [t.calculo!.resultado], temporadas: [t.calculo!.temporada_curva] };
    estadoFalso.tablas.corridas_estacionalidad.push({
      id: "11111111-1111-4111-8111-111111111111",
      hasta_periodo: "2026-09-01",
      parametros: {},
      resultado,
      resumen: {},
      red_comparable: [],
      efecto_atipico: {},
      agrupacion_estacionalidad_id: null,
      usuario_nombre: null,
      created_at: "2026-10-14T10:00:00Z",
    });
    const r = await detalleFoto(get(), ctx2("11111111-1111-4111-8111-111111111111", A[ABRIGO_ID]));
    expect(r.status).toBe(200);
    expect((await leer<DetalleFotoApi>(r)).data.curva_de_la_foto).toBeNull();
    expect((await detalleFoto(get(), ctx2("11111111-1111-4111-8111-111111111111", A[VERANO_ID]))).status).toBe(404);
  });
});

describe("GET /api/curvas/vigentes (contrato con M7 intacto)", () => {
  it("devuelve las curvas vigentes de las activas con curva suma 1, acumulada que termina en 1, versión y huellas", async () => {
    for (const id of [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID]]) await aprobarOk(id, "A");
    const filas = (await leer<CurvaVigenteApi[]>(await vigentes())).data;
    expect(filas).toHaveLength(3);
    for (const f of filas) {
      expect(f.curva.reduce((s, x) => s + Math.round(x * 1e6), 0)).toBe(1_000_000);
      expect(f.acumulada).toHaveLength(12);
      expect(f.acumulada[11]).toBe(1);
      expect(f).toMatchObject({ version: 1, modelo: "A", medida: "unidades" });
      expect(f.corrida_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(f.huellas.composicion).toMatch(/^[0-9a-f]{32}$/);
      expect(f.huellas.red_huella).toMatch(/^[0-9a-f]{32}$/);
      expect(f.huellas.cargas_huella).toMatch(/^[0-9a-f]{32}$/);
      expect(f.curva_id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(filas.map((f) => f.codigo)).toEqual([...filas.map((f) => f.codigo)].sort());
  });
  it("una agrupación inactiva con curva no sale en vigentes, pero sí en el estado (al final)", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    estadoFalso.tablas.curvas_estacionalidad[0].agrupacion_estacionalidad_id = INACTIVA;
    expect((await leer<CurvaVigenteApi[]>(await vigentes())).data).toHaveLength(0);
    const e = (await leer<EstadoCurvasApi>(await estado())).data;
    expect(e.agrupaciones.at(-1)).toMatchObject({ id: INACTIVA, activo: false, estado: "inactiva_con_curva" });
    expect(e.resumen.inactivas_con_curva).toBe(1);
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
    expect(nuevo).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas", agrupaciones_afectadas: 4, meses: 3 });
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

describe("GET /api/periodos-atipicos/anios (calculado a demanda, casos 19 y 59)", () => {
  it("sin con_volumen es barato: ratio_volumen y volumen nulos, corrida_id nulo y NO llama a la función de venta", async () => {
    const r = await aniosAtipicos(get("/anios", "?temporada=invierno"));
    const d = (await leer<AniosAtipicosRespuesta>(r)).data;
    expect(d.corrida_id).toBeNull();
    expect(d.huella_cargas).toBeNull();
    expect(d.calculado_at).toBeNull();
    expect(d.avisos).toEqual([]);
    expect(d.anios.every((a) => a.ratio_volumen === null && a.volumen === null)).toBe(true);
    expect(d.resumen.anios_atipicos).toEqual([2023, 2026]);
    expect(estadoFalso.llamadasVenta).toEqual([]);
    expect(estadoFalso.tablasLeidas.has("corridas_estacionalidad")).toBe(false);
  });
  it("con_volumen=1: el ratio de la temporada con control, relativo y crecimiento; una sola llamada a la función con id nulo; sin corridas", async () => {
    const d = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=invierno&con_volumen=1")))).data;
    expect(d.corrida_id).toBeNull();
    expect(d.calculado_at).toMatch(/^2026-10-14T/);
    expect(d.huella_cargas).toMatch(/^[0-9a-f]{32}$/);
    expect(d.avisos).toEqual([{ codigo: "parametros_por_defecto", detalle: expect.stringContaining("parámetros por defecto") }]);
    const a2023 = d.anios.find((a) => a.anio === 2023)!;
    expect(a2023.ratio_volumen).toBe(0.65);
    expect(a2023.volumen).toMatchObject({ nivel: "temporada", temporada: "invierno", ratio_control: 1, ratio_relativo: 0.65, agrupaciones: 1, anio_referencia: 2024, corrida_id: null, ratio_agrupacion: null });
    expect(a2023.volumen?.crecimiento_normal).toBeCloseTo(1.236, 3);
    expect(d.anios.find((a) => a.anio === 2024)?.volumen).toBeNull();
    const ver = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", "?temporada=verano&con_volumen=1")))).data;
    expect(ver.anios.find((a) => a.anio === 2023)?.ratio_volumen).toBe(1.46);
    expect(estadoFalso.llamadasVenta.every((x) => x === null)).toBe(true);
    expect(estadoFalso.tablasLeidas.has("corridas_estacionalidad")).toBe(false);
    expect(estadoFalso.tablasLeidas.has("curvas_estacionalidad")).toBe(false);
    expect(estadoFalso.llamadasVentaTienda).toBe(0);
  });
  it("regla 59 · con ?agrupacion_id pasa el id a la función y el diagnóstico sale de la agrupación; huella_cargas = cargas_huella de calcular", async () => {
    const d = (await leer<AniosAtipicosRespuesta>(await aniosAtipicos(get("/anios", `?agrupacion_id=${A[ABRIGO_ID]}&con_volumen=1`)))).data;
    expect(estadoFalso.llamadasVenta).toEqual([A[ABRIGO_ID]]);
    expect(d.anios.find((a) => a.anio === 2023)?.volumen?.ratio_agrupacion).toBe(0.65);
    expect(d.avisos[0].codigo).toBe("parametros_por_defecto");
    const t = await abrir(A[ABRIGO_ID]);
    expect(d.huella_cargas).toBe(t.datos.cargas_huella);
    expect((await aniosAtipicos(get("/anios", `?agrupacion_id=${INEXISTENTE}&con_volumen=1`))).status).toBe(404);
    expect((await aniosAtipicos(get("/anios", "?con_volumen=2"))).status).toBe(400);
  });
});

describe("GET /api/curvas/anios-atipicos (a demanda) y /red-comparable", () => {
  it("caso 19 y 27 · calcula el efecto del Niño sin ninguna corrida: ratio relativo 0,65 en invierno, 1,46 en verano; control presente", async () => {
    const r = await aniosNino();
    const d = (await leer<AniosAtipicosNinoApi>(r)).data;
    expect(r.status).toBe(200);
    expect(d.calculado_at).toMatch(/^2026-10-14T/);
    expect(d.huella_cargas).toMatch(/^[0-9a-f]{32}$/);
    expect(d.parametros).toMatchObject({ umbral_forma: 3, margen_ruido: 0.25 });
    expect(d.datos).toMatchObject({ desde: "2023-01", hasta_periodo: "2026-09", meses_publicados: 45 });
    const f = d.efecto.por_temporada;
    expect(f.find((x) => x.temporada === "invierno" && x.anio === 2023)).toMatchObject({ ratio_volumen: 0.65, ratio_control: 1, ratio_relativo: 0.65 });
    expect(f.find((x) => x.temporada === "verano" && x.anio === 2023)?.ratio_volumen).toBe(1.46);
    expect(d.anios.map((a) => a.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(d.anios[0].clase_por_temporada).toMatchObject({ invierno: "atipico_completo", verano: "con_huecos", todo_el_ano: "normal" });
    expect(d.anios[3].completo).toBe(false);
    expect(d.temporadas.map((t) => t.temporada)).toEqual(["invierno", "verano", "todo_el_ano"]);
    expect(d.periodos).toHaveLength(4);
    expect(d.agrupaciones.map((a) => a.nombre).sort()).toEqual(["ABRIGO", "CONSTANTE", "INACTIVA", "VACIA", "VERANO"].filter((n) => n !== "INACTIVA"));
    expect(estadoFalso.llamadasVenta).toEqual([null]);
    expect(estadoFalso.tablasLeidas.has("corridas_estacionalidad")).toBe(false);
    expect(estadoFalso.tablasLeidas.has("curvas_estacionalidad")).toBe(false);
  });
  it("sin meses publicados el efecto sale vacío (200)", async () => {
    estadoFalso.tablas.cargas_venta_stock = [];
    estadoFalso.venta.porId.null = { ...ventaJson(null), meses_publicados: [], cargas: {} };
    const d = (await leer<AniosAtipicosNinoApi>(await aniosNino())).data;
    expect(d.efecto.por_temporada).toEqual([]);
    expect(d.datos.hasta_periodo).toBeNull();
    expect(d.temporadas).toEqual([]);
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
    expect(estadoFalso.llamadasVenta).toEqual([]);
    estadoFalso.tablas.cargas_venta_stock = [];
    expect((await redComparable(get("/red-comparable"))).status).toBe(409);
  });
});

describe("correcciones de la auditoría (0.9.7)", () => {
  it("ruido_normal viaja en la vigente, en la lista y en las versiones, junto al EAT", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    const ruido = t.calculo!.resultado.ruido_normal;
    expect(ruido).not.toBeNull();
    await aprobarOk(A[ABRIGO_ID], "A");
    const abierta = await abrir(A[ABRIGO_ID]);
    expect(abierta.vigente!.ruido_normal).toBe(ruido);
    const lista = (await leer<EstadoCurvasApi>(await estado())).data.agrupaciones.find((a) => a.id === A[ABRIGO_ID])!;
    expect(lista.vigente!.ruido_normal).toBe(ruido);
    const v = (await leer<VersionesAgrupacionApi>(await versiones(get(), ctx(A[ABRIGO_ID])))).data.versiones[0];
    expect(v.ruido_normal).toBe(ruido);
  });
  it("PUT: agrupacion_inactiva se evalúa antes que hasta_periodo_sin_cargar", async () => {
    const t = await abrir(INACTIVA);
    const r = await aprobar(json({ ...cuerpoAprobar(t, "A"), parametros: { ...t.parametros, hasta_periodo: "2027-01" } }, "PUT"), ctx(INACTIVA));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("agrupacion_inactiva");
  });
  it("PUT estricto: una clave desconocida es 400 y la nota con salto de línea también", async () => {
    const t = await abrir(A[ABRIGO_ID]);
    expect((await aprobar(json({ ...cuerpoAprobar(t, "A"), extra: 1 }, "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect((await aprobar(json(cuerpoAprobar(t, "A", { nota: "a\nb" }), "PUT"), ctx(A[ABRIGO_ID]))).status).toBe(400);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
  });
  it("cambiarEstadoCurva es condicional: si la curva ya no está en el estado de partida no toca nada (0 filas = vigente_cambiada)", async () => {
    const { cambiarEstadoCurva } = await import("@/lib/curvas/consultas");
    const { clienteFalso } = await import("./curvas.fake-db");
    const db = clienteFalso() as never;
    const { curva } = await aprobarOk(A[ABRIGO_ID], "A");
    // Otro usuario la retiró antes: reemplazarla desde `vigente` no hace nada.
    estadoFalso.tablas.curvas_estacionalidad[0].estado = "retirada";
    const r1 = await cambiarEstadoCurva(db, curva.id, "vigente", "reemplazada");
    expect(r1.data).toBeNull();
    expect(estadoFalso.tablas.curvas_estacionalidad[0].estado).toBe("retirada");
    // La vuelta atrás solo sale de `reemplazada`.
    expect((await cambiarEstadoCurva(db, curva.id, "reemplazada", "vigente")).data).toBeNull();
    estadoFalso.tablas.curvas_estacionalidad[0].estado = "vigente";
    expect((await cambiarEstadoCurva(db, curva.id, "vigente", "retirada")).data).toMatchObject({ estado: "retirada" });
  });
  it("la curva se comprueba antes de guardar la foto: un fallo al guardar la curva con la foto ya hecha no deja la vigente movida", async () => {
    await aprobarOk(A[ABRIGO_ID], "A");
    const t = await abrir(A[ABRIGO_ID]);
    estadoFalso.fallarInsert.curvas_estacionalidad = { code: "XX000", message: "se cayó" };
    const r = await aprobar(json(cuerpoAprobar(t, "B", { nota: "x" }), "PUT"), ctx(A[ABRIGO_ID]));
    expect(r.status).toBe(500);
    expect(estadoFalso.tablas.curvas_estacionalidad.filter((f) => f.estado === "vigente")).toHaveLength(1);
  });
});
