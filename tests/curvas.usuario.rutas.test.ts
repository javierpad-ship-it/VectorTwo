import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AprobarCurvaRespuesta, CurvaVigenteApi, DetalleFotoApi, EstadoCurvasApi, TrabajoAgrupacionApi, VersionesAgrupacionApi } from "@/lib/curvas/tipos-api";
import { estadoFalso } from "./curvas.fake-db";

vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./curvas.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { GET as estado } from "@/app/api/curvas/route";
import { POST as calcular } from "@/app/api/curvas/agrupaciones/[id]/calcular/route";
import { GET as versiones } from "@/app/api/curvas/agrupaciones/[id]/versiones/route";
import { GET as detalleFoto } from "@/app/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]/route";
import { DELETE as retirar, PUT as aprobar } from "@/app/api/curvas/agrupaciones/[id]/route";
import { GET as vigentes } from "@/app/api/curvas/vigentes/route";
import { vaciarCacheVenta } from "@/lib/curvas/cache-venta";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { ABRIGO_ID } from "./curvas.fixture";
import { A, INACTIVA, INEXISTENTE, SIN_CURVA, VACIA, abrirCon, cuerpoAprobar, ctx, get, json, leer, sembrar } from "./curvas.rutas.soporte";

/**
 * Casos 39 y 40 de la 06c: aprobar la curva del usuario (`U`) y `F`/`T`, el orden de los 409, lo que guarda la
 * fila y la foto, y cómo la ven la lista, las versiones, «Ver foto» y `/api/curvas/vigentes`.
 */

const ID = A[ABRIGO_ID];
const USUARIO = [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4];
const PEGADO = { tipo: "pegado", referencia: null };
const abrir = (id: string = ID, cuerpo: Record<string, unknown> = {}, consulta = "") => abrirCon(calcular as never, id, cuerpo, consulta);
const put = (cuerpo: unknown, id: string = ID) => aprobar(json(cuerpo, "PUT") as NextRequest, ctx(id));
const cuerpoU = (t: TrabajoAgrupacionApi, extra: Record<string, unknown> = {}) => cuerpoAprobar(t, "U", { curva_usuario: USUARIO, partida: PEGADO, nota: "Mi criterio comercial", ...extra });
const filas = () => estadoFalso.tablas.curvas_estacionalidad;

async function aprobarU(extra: Record<string, unknown> = {}, id: string = ID) {
  const t = await abrir(id);
  const r = await put(cuerpoU(t, extra), id);
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
  return { t, ...(await leer<AprobarCurvaRespuesta>(r)).data };
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

describe("caso 39 · aprobar la curva del usuario", () => {
  it("sin nota → 409 nota_requerida (siempre, aunque U sea lo único que se aprueba)", async () => {
    const t = await abrir();
    const { nota: _n, ...sinNota } = cuerpoU(t) as Record<string, unknown>;
    void _n;
    const r = await put(sinNota);
    expect(r.status).toBe(409);
    const cuerpo = await leer(r);
    expect(cuerpo.codigo).toBe("nota_requerida");
    expect(cuerpo.error).toMatch(/aprobaste tu propia curva \(U\)/);
    expect((await put(cuerpoU(t, { nota: "   " }))).status).toBe(409);
    expect(filas()).toEqual([]);
    expect(estadoFalso.tablas.corridas_estacionalidad).toEqual([]);
  });

  it("con nota → 201: v1 con modelo U, origen propia, origen_curva usuario, recomendada false, eat null y curva_manual con lo medido en muestra", async () => {
    const { t, curva, foto_id } = await aprobarU();
    expect(curva).toMatchObject({ version: 1, estado: "vigente", modelo: "U", origen: "propia", origen_curva: "usuario", recomendada: false, eat: null, error_max: null, nota: "Mi criterio comercial", medida: "unidades" });
    expect(curva.curva[4]).toBe(0.11);
    expect(curva.curva[5]).toBe(0.14);
    expect(curva.curva.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(curva.curva_manual).toMatchObject({ valores_ingresados: USUARIO, partida: PEGADO, en_muestra: true, igual_a: null });
    expect(typeof curva.curva_manual?.eat_en_muestra).toBe("number");
    expect(curva.curva_manual?.eat_en_muestra_por_anio.length).toBeGreaterThan(0);
    const fila = filas()[0];
    expect(fila).toMatchObject({ modelo: "U", origen: "propia", origen_curva: "usuario", recomendada: false, eat: null, error_max: null, p05: 0.11, p06: 0.14 });
    expect((fila.anios_utilizados as { recomendada_entonces: string | null }).recomendada_entonces).toBe(t.calculo?.resultado.recomendada);
    expect((fila.anios_utilizados as { version_modelo: number }).version_modelo).toBe(VERSION_MODELO);
    // La foto: resultado tal cual salió del cálculo (SIN candidata U) y la curva del usuario en resumen.curva_usuario.
    const foto = estadoFalso.tablas.corridas_estacionalidad.find((f) => f.id === foto_id)!;
    const resultado = foto.resultado as { agrupaciones: { candidatas: { modelo: string }[] }[] };
    expect(resultado.agrupaciones[0].candidatas.map((c) => c.modelo)).toEqual(["A", "B", "C", "D", "E", "F", "T"]);
    const resumen = foto.resumen as { curva_usuario: { valores_ingresados: number[]; curva: number[]; partida: unknown; eat_en_muestra: number | null; igual_a: unknown } };
    expect(resumen.curva_usuario.valores_ingresados).toEqual(USUARIO);
    expect(resumen.curva_usuario.curva).toEqual(curva.curva);
    expect(resumen.curva_usuario.partida).toEqual(PEGADO);
    expect(resumen.curva_usuario.eat_en_muestra).toBeCloseTo(curva.curva_manual!.eat_en_muestra as number, 6);
  });

  it("partida opcional: sin ella queda en_blanco; los valores_ingresados se guardan tal como se enviaron (antes de normalizar)", async () => {
    const t = await abrir();
    const cuerpo = cuerpoU(t, { curva_usuario: [5.04, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4], partida: undefined });
    const r = await put(cuerpo);
    expect(r.status).toBe(201);
    const { curva } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva.curva_manual?.partida).toEqual({ tipo: "en_blanco", referencia: null });
    expect(curva.curva_manual?.valores_ingresados[0]).toBe(5.04);
    expect(curva.curva.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
  });

  it("repetir con version_vigente 1 → 409 sin_cambio; cambiar un valor → v2; otros valores con la misma partida no son sin_cambio", async () => {
    await aprobarU();
    const t = await abrir();
    expect(t.vigente?.modelo).toBe("U");
    const r = await put(cuerpoU(t));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_cambio");
    const cambiada = [5, 5, 6, 8, 12, 13, 13, 12, 10, 7, 5, 4];
    const r2 = await put(cuerpoU(t, { curva_usuario: cambiada }));
    expect(r2.status).toBe(201);
    expect((await leer<AprobarCurvaRespuesta>(r2)).data.curva.version).toBe(2);
    expect(filas().filter((f) => f.estado === "vigente")).toHaveLength(1);
    expect(filas().filter((f) => f.estado === "reemplazada")).toHaveLength(1);
  });

  it("después, aprobar A → v3 con origen_curva sistema y curva_manual null", async () => {
    await aprobarU();
    const t = await abrir();
    const r = await put(cuerpoAprobar(t, "A", { nota: "vuelvo a la del sistema" }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    const { curva } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva).toMatchObject({ version: 2, modelo: "A", origen_curva: "sistema", curva_manual: null, origen: "propia" });
    expect(filas().find((f) => f.version === 2)).toMatchObject({ origen_curva: "sistema", curva_manual: null });
  });

  it("con sin_venta (agrupación VACÍA) → 409 prerrequisitos: con cero venta no se aprueba U", async () => {
    const t = await abrir(VACIA);
    expect(t.prerrequisitos.bloquea.map((p) => p.codigo)).toContain("sin_venta");
    const r = await put(cuerpoU(t), VACIA);
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("prerrequisitos");
    expect(filas()).toEqual([]);
  });

  it("U se aprueba aunque el sistema no tenga ninguna candidata (origen null); A en esa misma agrupación → 409 sin_curva_posible", async () => {
    const t = await abrir(SIN_CURVA);
    expect(t.prerrequisitos.bloquea).toEqual([]);
    expect(t.calculo?.resultado.origen).toBeNull();
    expect(t.calculo?.resultado.recomendada).toBeNull();
    expect((await put(cuerpoAprobar(t, "A", { nota: "x" }), SIN_CURVA)).status).toBe(409);
    const r = await put(cuerpoU(t), SIN_CURVA);
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    const { curva } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva).toMatchObject({ modelo: "U", origen_curva: "usuario" });
    expect(curva.curva_manual?.igual_a).toBeNull();
  });

  it("el orden de los 409 de U: hasta_periodo_sin_cargar · inactiva · prerrequisitos · datos_cambiados · vigente_cambiada · sin_cambio · nota", async () => {
    const t = await abrir();
    const cod = async (cuerpo: unknown, id: string = ID) => (await leer(await put(cuerpo, id))).codigo;
    // Datos cambiados antes que vigente_cambiada y que la nota.
    expect(await cod({ ...cuerpoU(t, { nota: undefined }), huella_calculo: "f".repeat(32), version_vigente: 7 })).toBe("datos_cambiados");
    expect(await cod({ ...cuerpoU(t, { nota: undefined }), version_vigente: 7 })).toBe("vigente_cambiada");
    expect(await cod(cuerpoU(t, { nota: undefined }))).toBe("nota_requerida");
    // Hasta no publicado antes que cualquier otra cosa; con U gana incluso a «inactiva» (con A gana inactiva).
    const inactiva = await abrir(INACTIVA);
    const mal = { ...cuerpoU(inactiva), parametros: { ...inactiva.parametros, hasta_periodo: "2027-01" } };
    expect(await cod(mal, INACTIVA)).toBe("hasta_periodo_sin_cargar");
    expect(await cod({ ...cuerpoAprobar(inactiva, "A", { nota: "x" }), parametros: { ...inactiva.parametros, hasta_periodo: "2027-01" } }, INACTIVA)).toBe("agrupacion_inactiva");
    expect(await cod(cuerpoU(inactiva), INACTIVA)).toBe("agrupacion_inactiva");
    // Prerrequisitos antes que datos cambiados.
    const vacia = await abrir(VACIA);
    expect(await cod({ ...cuerpoU(vacia), huella_calculo: "f".repeat(32) }, VACIA)).toBe("prerrequisitos");
    expect(filas()).toEqual([]);
  });

  it("400: U sin curva_usuario, curva que no suma 100, A o F con curva_usuario o partida; 404 agrupación inexistente", async () => {
    const t = await abrir();
    const base = cuerpoU(t);
    const { curva_usuario: _c, ...sinCurva } = base as Record<string, unknown>;
    void _c;
    expect((await put(sinCurva)).status).toBe(400);
    expect((await put({ ...base, curva_usuario: USUARIO.map((x) => x + 1) })).status).toBe(400);
    expect((await put({ ...base, curva_usuario: USUARIO.slice(1) })).status).toBe(400);
    expect((await put({ ...base, modelo: "A" })).status).toBe(400);
    expect((await put({ ...cuerpoAprobar(t, "F", { nota: "x" }), curva_usuario: USUARIO })).status).toBe(400);
    expect((await put({ ...cuerpoAprobar(t, "F", { nota: "x" }), partida: PEGADO })).status).toBe(400);
    expect((await put({ ...base, partida: { tipo: "candidata", referencia: "U" } })).status).toBe(400);
    expect((await put(base, INEXISTENTE)).status).toBe(404);
    expect(filas()).toEqual([]);
  });

  it("partir de una candidata guarda la partida y, si la curva es igual a A, igual_a = A", async () => {
    const t = await abrir();
    const a = t.calculo!.resultado.candidatas.find((c) => c.modelo === "A")!.curva as number[];
    const valores = a.map((x) => Math.round(x * 1e6) / 1e4);
    const r = await put(cuerpoU(t, { curva_usuario: valores, partida: { tipo: "candidata", referencia: "A" } }));
    // Los porcentajes con cuatro decimales pueden sumar 100 ± 0.05: pasan.
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    const { curva } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva.curva_manual?.partida).toEqual({ tipo: "candidata", referencia: "A" });
    expect(curva.curva_manual?.igual_a).toBe("A");
  });
});

describe("aprobar F y T como cualquier candidata", () => {
  it("F: origen_curva avanzada, modelo F, eat de su backtesting (null con dos años de ajuste); sin_cambio con la misma huella", async () => {
    const t = await abrir();
    const f = t.calculo!.resultado.candidatas.find((c) => c.modelo === "F")!;
    expect(f.curva).not.toBeNull();
    const r = await put(cuerpoAprobar(t, "F", { nota: "pruebo el modelo avanzado" }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    const { curva, foto_id } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva).toMatchObject({ modelo: "F", origen: "propia", origen_curva: "avanzada", curva_manual: null });
    expect(curva.eat).toBe(f.eat === null ? null : Math.round(f.eat * 100) / 100);
    expect(curva.recomendada).toBe(t.calculo?.resultado.recomendada === "F");
    // La foto trae F con detalle_f y explicacion_f para reproducirla.
    const foto = estadoFalso.tablas.corridas_estacionalidad.find((x) => x.id === foto_id)!;
    const candF = (foto.resultado as { agrupaciones: { candidatas: { modelo: string; detalle_f?: { lambda: number }; explicacion_f?: { frase: string } }[] }[] }).agrupaciones[0].candidatas.find((c) => c.modelo === "F")!;
    expect(candF.detalle_f).toBeDefined();
    expect(candF.explicacion_f?.frase).toMatch(/^F se apoya en/);
    const t2 = await abrir();
    const otra = await put(cuerpoAprobar(t2, "F", { nota: "otra vez" }));
    expect(otra.status).toBe(409);
    expect((await leer(otra)).codigo).toBe("sin_cambio");
  });
  it("T: origen prestada y, desde la 06c, el EAT de su backtesting", async () => {
    const t = await abrir();
    const tt = t.calculo!.resultado.candidatas.find((c) => c.modelo === "T")!;
    const r = await put(cuerpoAprobar(t, "T", { nota: "uso la de la temporada" }));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(201);
    const { curva } = (await leer<AprobarCurvaRespuesta>(r)).data;
    expect(curva).toMatchObject({ modelo: "T", origen: "prestada", origen_curva: "sistema", curva_manual: null });
    expect(curva.eat).toBe(tt.eat === null ? null : Math.round(tt.eat * 100) / 100);
  });
  it("?modelo=F y ?modelo=T eligen la candidata del comparador de calcular", async () => {
    await aprobarU();
    const f = await abrir(ID, {}, "?modelo=F");
    expect(f.comparador?.modelo).toBe("F");
    expect(f.comparador?.vigente).toHaveLength(12);
    const tt = await abrir(ID, {}, "?modelo=T");
    expect(tt.comparador?.modelo).toBe("T");
  });
});

describe("caso 40 · lista, avisos y consumo", () => {
  it("la lista da estado curva_usuario y vigente.modelo U; resumen.curvas_usuario = 1 y obsoletas = 0", async () => {
    await aprobarU();
    const r = await estado();
    const e = (await leer<EstadoCurvasApi>(r)).data;
    const abrigo = e.agrupaciones.find((a) => a.id === ID)!;
    expect(abrigo.estado).toBe("curva_usuario");
    expect(abrigo.vigente).toMatchObject({ modelo: "U", origen_curva: "usuario", recomendada: false, eat: null });
    expect(abrigo.vigente?.curva_manual?.valores_ingresados).toEqual(USUARIO);
    expect(abrigo.obsoleta).toBeNull();
    expect(e.resumen.curvas_usuario).toBe(1);
    expect(e.resumen.obsoletas).toBe(0);
    expect(e.resumen.con_curva_vigente).toBe(1);
  });

  it("un mes republicado y una equivalencia movida NO la vuelven obsoleta: sigue curva_usuario con avisos cambio_desde_aprobacion", async () => {
    await aprobarU();
    // Republicar un mes (otro carga_id) y mover una equivalencia a otra agrupación.
    const carga = estadoFalso.tablas.cargas_venta_stock.find((c) => c.periodo === "2026-05-01")!;
    carga.id = "carga-republicada";
    const eq = estadoFalso.tablas.equivalencias.find((x) => x.id === "e-0-1")!;
    eq.agrupacion_estacionalidad_id = A.constante;
    const e = (await leer<EstadoCurvasApi>(await estado())).data;
    const abrigo = e.agrupaciones.find((a) => a.id === ID)!;
    expect(abrigo.estado).toBe("curva_usuario");
    expect(abrigo.obsoleta).toBeNull();
    const cambios = abrigo.avisos_vigente.filter((a) => a.codigo === "cambio_desde_aprobacion");
    expect(cambios.map((c) => c.motivo).sort()).toEqual(["carga_nueva", "composicion_cambiada"]);
    expect(cambios.find((c) => c.motivo === "carga_nueva")?.detalle).toMatch(/republicado/);
    expect(cambios.find((c) => c.motivo === "composicion_cambiada")?.detalle).toMatch(/composición/);
    expect(e.resumen).toMatchObject({ curvas_usuario: 1, obsoletas: 0 });
    // calcular lo dice igual: sin `obsoleta`, con los avisos.
    const t = await abrir();
    expect(t.obsoleta).toBeNull();
    expect(t.avisos_vigente.some((a) => a.codigo === "cambio_desde_aprobacion")).toBe(true);
  });

  it("control: la misma novedad sí vuelve obsoleta a una curva del sistema", async () => {
    const t = await abrir();
    const r = await put(cuerpoAprobar(t, "A", { nota: "x" }));
    expect(r.status).toBe(201);
    estadoFalso.tablas.cargas_venta_stock.find((c) => c.periodo === "2026-05-01")!.id = "carga-republicada";
    const abrigo = (await leer<EstadoCurvasApi>(await estado())).data.agrupaciones.find((a) => a.id === ID)!;
    expect(abrigo.estado).toBe("obsoleta");
    expect(abrigo.obsoleta?.motivos.map((m) => m.codigo)).toContain("carga_nueva");
    expect(abrigo.avisos_vigente.some((a) => a.codigo === "cambio_desde_aprobacion")).toBe(false);
  });

  it("las vigentes del sistema reciben «modelo_anterior» con una foto de la versión 1 (aviso, no obsolescencia)", async () => {
    const t = await abrir();
    await put(cuerpoAprobar(t, "A", { nota: "x" }));
    for (const c of filas()) (c.anios_utilizados as { version_modelo: number }).version_modelo = 1;
    for (const f of estadoFalso.tablas.corridas_estacionalidad) (f.resumen as { version_modelo: number }).version_modelo = 1;
    const abrigo = (await leer<EstadoCurvasApi>(await estado())).data.agrupaciones.find((a) => a.id === ID)!;
    expect(abrigo.estado).not.toBe("obsoleta");
    expect(abrigo.avisos_vigente.map((a) => a.codigo)).toContain("modelo_anterior");
  });

  it("versiones: la U trae origen_curva y curva_manual; la de A, origen_curva sistema y curva_manual null", async () => {
    await aprobarU();
    const t = await abrir();
    await put(cuerpoAprobar(t, "A", { nota: "x" }));
    const v = (await leer<VersionesAgrupacionApi>(await versiones(get(), ctx(ID)))).data.versiones;
    expect(v.map((x) => [x.version, x.modelo, x.origen_curva, x.curva_manual === null])).toEqual([[2, "A", "sistema", true], [1, "U", "usuario", false]]);
    expect(v[1].eat).toBeNull();
  });

  it("«Ver foto» de una versión U: curva_de_la_foto.modelo U, resultado.candidatas sin U, datos en muestra en resumen.curva_usuario y comparador consigo misma (0)", async () => {
    const { foto_id } = await aprobarU();
    const r = await detalleFoto(get(), { params: Promise.resolve({ id: foto_id, agrupacionId: ID }) } as never);
    expect(r.status).toBe(200);
    const d = (await leer<DetalleFotoApi>(r)).data;
    expect(d.curva_de_la_foto).toMatchObject({ modelo: "U", origen_curva: "usuario" });
    expect(d.resultado.candidatas.map((c) => c.modelo)).not.toContain("U");
    expect(d.foto.resumen.curva_usuario?.valores_ingresados).toEqual(USUARIO);
    expect(d.curva_de_la_foto?.curva).toEqual(d.foto.resumen.curva_usuario?.curva);
    expect(d.comparador).toMatchObject({ modelo: "U", eat_vs_vigente: 0, difiere: false, comparable_con_vigente: true });
    // Con ?modelo=F se compara una candidata de la foto contra la curva del usuario.
    const f = await detalleFoto(get("", "?modelo=F"), { params: Promise.resolve({ id: foto_id, agrupacionId: ID }) } as never);
    expect((await leer<DetalleFotoApi>(f)).data.comparador?.modelo).toBe("F");
  });

  it("«Ver foto» de una versión F trae la candidata F con su detalle_f", async () => {
    const t = await abrir();
    const r = await put(cuerpoAprobar(t, "F", { nota: "x" }));
    const { foto_id } = (await leer<AprobarCurvaRespuesta>(r)).data;
    const d = (await leer<DetalleFotoApi>(await detalleFoto(get(), { params: Promise.resolve({ id: foto_id, agrupacionId: ID }) } as never))).data;
    expect(d.curva_de_la_foto?.modelo).toBe("F");
    expect(d.resultado.candidatas.find((c) => c.modelo === "F")?.detalle_f).toBeDefined();
  });

  it("/api/curvas/vigentes lleva origen_curva y modelo U; la curva suma 1 y acumulada[11] = 1", async () => {
    await aprobarU();
    const filasV = (await leer<CurvaVigenteApi[]>(await vigentes())).data;
    const u = filasV.find((x) => x.agrupacion_id === ID)!;
    expect(u).toMatchObject({ modelo: "U", origen: "propia", origen_curva: "usuario", version: 1 });
    expect(u.curva.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    expect(u.acumulada[11]).toBe(1);
  });

  it("retirar una U funciona como cualquier curva", async () => {
    await aprobarU();
    const r = await retirar(get(), ctx(ID));
    expect(r.status).toBe(200);
    expect(filas()[0].estado).toBe("retirada");
  });
});
