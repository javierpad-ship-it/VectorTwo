import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

// Los módulos de la base y del contexto se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./proyeccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/proyeccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/contexto")>();
  const falso = await import("./proyeccion.contexto-falso");
  return {
    ...real,
    cargarContextoCalculo: async () => ({ data: falso.contextoFalso(), respuesta: null }),
    cargarCatalogo: async () => ({ data: { catalogo: falso.catalogoFalso(), equivalencias: [], nodosDb: [] }, respuesta: null }),
    contarCurvasObsoletas: async () => ({ data: falso.contexto.obsoletas, respuesta: null }),
    leerVentaTiendaMeses: async () => ({ data: falso.ventaTiendaFalsa(), respuesta: null }),
  };
});
vi.mock("@/lib/curvas/lectura", async (original) => {
  const real = await original<typeof import("@/lib/curvas/lectura")>();
  const falso = await import("./proyeccion.contexto-falso");
  return { ...real, calcularEfectoNino: async () => ({ data: falso.contexto.efectoNino, respuesta: null }) };
});

import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { GET as tiendas } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { construirVenta, AM, GEN, LIN, MARCA, MUN, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import { totalLinea } from "@/lib/proyeccion/apertura-linea";
import type { ProyeccionApi, RespuestaDecidirFilaApi, RespuestaLineasApi, RespuestaMatrizApi, RespuestaTiendasApi } from "@/lib/proyeccion/tipos-api";


const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;

const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const DENIM = `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`;
const claveDe = (tienda: string, am: string) => `${tienda}|${N.denim}||${am}`;
const idFila = (clave: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave)?.id as string;
const registro = (clave: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(clave) && a.anio === anio) as Fila;
const tiendaDb = (tienda: string, anio: number) => filasDe("proyeccion_tiendas").find((t) => t.tienda_id === tienda && t.anio === anio) as Fila;
/** Σ del vigente de las filas de la tienda en el año (lo que ve la línea). */
const sumaFilas = (tienda: string, anio: number) =>
  filasDe("proyeccion_filas")
    .filter((f) => f.tienda_id === tienda)
    .reduce((s, f) => {
      const r = filasDe("proyeccion_fila_anios").find((a) => a.fila_id === f.id && a.anio === anio);
      return s + ((r?.decidido ?? r?.propuesto ?? 0) as number);
    }, 0);

async function nueva() {
  const r = await crear(enviar("POST", "/proyecciones", { nombre: "Proyección 2026–2027", parametros: { crecimiento_pct_defecto: 5 } }));
  expect(r.status).toBe(201);
  const cuerpo = await leer<ProyeccionApi>(r);
  base.tablas.marcas = [
    { id: MARCA.alfa, nombre: "ALFA" },
    { id: MARCA.delta, nombre: "DELTA" },
    { id: MARCA.beta, nombre: "BETA" },
  ];
  return cuerpo.data.id;
}
const put = (id: string, clave: string, anio: number, cuerpo: unknown) => decidirFila(enviar("PUT", "/x", cuerpo), ctx(id, { filaId: idFila(clave), anio: String(anio) }));
const putTienda = (id: string, tienda: string, anio: number, cuerpo: unknown) => decidirTienda(enviar("PUT", "/x", cuerpo), ctx(id, { tiendaId: tienda, anio: String(anio) }));
const lineaDenim = async (id: string) => (await leer<RespuestaLineasApi>(await lineas(get("/l", DENIM), ctx(id)))).data;
const tiendasDe = async (id: string) => (await leer<RespuestaTiendasApi>(await tiendas(get("/t"), ctx(id)))).data.tiendas;

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  estadoFalso.rol = "planner";
  base.venta = (args) => {
    const v = construirVenta(contexto.hechos, tiendasFixture(), { detalle: args.p_tiendas_detalle, hasta: "2026-09", desdeW12: args.p_desde_w12.slice(0, 7) });
    const nodos = new Set(args.p_gml_ids);
    return {
      filas: v.filas.filter((f) => nodos.has(f.gml_id)),
      por_tienda: v.por_tienda.filter((f) => nodos.has(f.gml_id)),
      equivalencias: v.equivalencias.filter((f) => nodos.has(f.gml_id)),
      detalle_w12: v.detalle_w12.filter((f) => nodos.has(f.gml_id)),
      disponibilidad: v.disponibilidad.filter((f) => nodos.has(f.gml_id)),
      cargas: v.cargas,
    };
  };
});
afterEach(() => vi.restoreAllMocks());

describe("GET /lineas (07b): filas de apertura, tiendas ampliadas y marcas", () => {
  it("filas_tienda: solo tiendas del bloque `nuevas`, por año y código; las filas base no se mezclan", async () => {
    const id = await nueva();
    const l = await lineaDenim(id);
    expect(l.filas.every((f) => f.tienda_id === null)).toBe(true);
    expect(l.filas_tienda.length).toBeGreaterThan(0);
    expect(l.filas_tienda.every((f) => f.tienda_id !== null && f.anios.length > 0 && f.anios.every((a) => a.bloque === "nuevas"))).toBe(true);
    // T7 y T5 son cierres: ninguna fila suya; T2 solo en 2026 (en 2027 es de las mismas).
    expect(new Set(l.filas_tienda.map((f) => f.tienda_codigo))).toEqual(new Set(["T2", "T3", "T4", "T9"]));
    expect(l.filas_tienda.find((f) => f.tienda_codigo === "T2")?.anios.map((a) => a.anio)).toEqual([2026]);
    expect(l.filas_tienda.find((f) => f.tienda_codigo === "T3")?.anios.map((a) => a.anio)).toEqual([2026, 2027]);
    const orden = l.filas_tienda.map((f) => [Math.min(...f.anios.map((a) => a.anio)), f.tienda_codigo] as const);
    expect(orden).toEqual([...orden].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1], "es", { numeric: true })));
    const t4 = l.filas_tienda.filter((f) => f.tienda_codigo === "T4");
    expect(t4.map((f) => f.agrupacion_marca_id).sort()).toEqual([AM.pre, AM.rec]);
    expect(t4.every((f) => f.composicion_s !== null && f.composicion_s > 0)).toBe(true);
    // Cada fila lleva sus cifras (la pantalla edita con el mismo campo + ✓).
    expect(t4.find((f) => f.agrupacion_marca_id === AM.rec)?.anios[0]).toMatchObject({ anio: 2027, bloque: "nuevas", subbloque: "aperturas", vigente: 1481 });
  });

  it("tiendas_linea: fecha de apertura, composición, referente y el total de TODA la tienda (no solo de esta línea)", async () => {
    const id = await nueva();
    const l = await lineaDenim(id);
    const t4 = l.tiendas_linea.find((t) => t.tienda === "T4" && t.anio === 2027);
    expect(t4).toMatchObject({ tienda_id: "T4", bloque: "nuevas", fecha_apertura: "2027-03-15", origen_composicion: "referente", referente: "T1", total_tienda: { propuesto: 6909, decidido: null } });
    expect(t4?.vigente).toBeLessThan(6909); // la línea tiene solo una parte
    expect(l.tiendas_linea.find((t) => t.tienda === "T9" && t.anio === 2026)).toMatchObject({ origen_composicion: "red", referente: null });
    expect(l.tiendas_linea.find((t) => t.tienda === "T7")).toMatchObject({ bloque: "cierres", fecha_apertura: null });
    // Con el total decidido, `total_tienda.decidido` lo dice.
    await putTienda(id, "T4", 2027, { decidido: 7000, origen: "manual" });
    const despues = await lineaDenim(id);
    expect(despues.tiendas_linea.find((t) => t.tienda === "T4" && t.anio === 2027)).toMatchObject({ decidida: true, total_tienda: { decidido: 7000 } });
  });

  it("marcas: top 3 con nombre, `otras` y Σ = 1; el periodo trae la cantidad de tiendas de M(Y)", async () => {
    const id = await nueva();
    const l = await lineaDenim(id);
    expect(l.marcas).toHaveLength(l.filas.length);
    const rec = l.marcas.find((m) => m.agrupacion_marca_id === AM.rec);
    expect(rec?.fila_id).toBe(idFila(`|${N.denim}||${AM.rec}`));
    expect(rec?.top.map((m) => m.marca)).toEqual(["ALFA", "DELTA"]);
    expect(rec?.top[0].participacion).toBeGreaterThan(rec?.top[1].participacion ?? 1);
    expect(rec?.otras).toBeNull();
    expect((rec?.top ?? []).reduce((s, m) => s + m.participacion, 0)).toBeCloseTo(1, 9);
    expect(rec?.periodo).toEqual({ desde: "2025-10", hasta: "2026-09", tiendas: 3 });
    expect(l.marcas.find((m) => m.agrupacion_marca_id === AM.pre)?.top.map((m) => m.marca)).toEqual(["BETA"]);
  });

  it("marcas: con más de 3 marcas queda el top 3 y `otras` con su % real; las marcas sin nombre en la base se rotulan", async () => {
    const id = await nueva();
    const fila = filasDe("proyeccion_filas").find((f) => f.clave === `|${N.denim}||${AM.rec}`) as Fila;
    const marcasIds = ["m1", "m2", "m3", "m4", "m5"];
    fila.participaciones = {
      periodo_referencia: { desde: "2025-10", hasta: "2026-09", meses: 12, tiendas: "mismas", anio: 2026, normalizado_nino: false },
      por_clave_flujo: [],
      por_marca: marcasIds.map((m, i) => ({ marca_id: m, participacion: [0.4, 0.25, 0.2, 0.1, 0.05][i] })),
      por_talla: [],
    };
    base.tablas.marcas = marcasIds.slice(0, 3).map((m, i) => ({ id: m, nombre: ["ZETA", "ALFA", "OMEGA"][i] }));
    const rec = (await lineaDenim(id)).marcas.find((m) => m.agrupacion_marca_id === AM.rec);
    expect(rec?.top.map((m) => m.marca)).toEqual(["ZETA", "ALFA", "OMEGA"]);
    expect(rec?.otras?.marcas).toBe(2);
    expect(rec?.otras?.participacion).toBeCloseTo(0.15, 9);
    // Una fila sin `por_marca` (calculada antes de la 0.10.1): top vacío, sin romper.
    (fila.participaciones as { por_marca: unknown }).por_marca = null;
    const sin = (await lineaDenim(id)).marcas.find((m) => m.agrupacion_marca_id === AM.rec);
    expect(sin?.top).toEqual([]);
    expect(sin?.otras).toBeNull();
  });

  it("el total de la línea (base + filas de tienda) cuadra con la columna de la Matriz en los dos años", async () => {
    const id = await nueva();
    const verificar = async () => {
      const l = await lineaDenim(id);
      const m = (await leer<RespuestaMatrizApi>(await matriz(get("/m", `${DENIM}&por=arbol`), ctx(id)))).data;
      const nodo = m.nodos.find((n) => n.nivel === "linea" && n.ids.linea_id === LIN.denim);
      expect(nodo).toBeDefined();
      const enCurso = (nodo?.en_curso.mismas ?? 0) + (nodo?.en_curso.nuevas_anterior ?? 0) + (nodo?.en_curso.aperturas ?? 0);
      const siguiente = (nodo?.siguiente.mismas ?? 0) + (nodo?.siguiente.nuevas_anterior ?? 0) + (nodo?.siguiente.aperturas ?? 0);
      expect(totalLinea(2026, l.filas, l.filas_tienda)).toBe(enCurso);
      expect(totalLinea(2027, l.filas, l.filas_tienda)).toBe(siguiente);
      // Y con la suma de la barra: Σ base (totales_por_anio) + Σ tiendas_linea `nuevas`.
      for (const anio of [2026, 2027]) {
        const nuevas = l.tiendas_linea.filter((t) => t.anio === anio && t.bloque === "nuevas").reduce((s, t) => s + (t.vigente ?? 0), 0);
        expect(totalLinea(anio, l.filas, l.filas_tienda)).toBe((l.totales_por_anio.find((t) => t.anio === anio)?.vigente ?? 0) + nuevas);
      }
    };
    await verificar();
    await put(id, claveDe("T4", AM.rec), 2027, { decidido: 2000, origen: "manual" });
    await put(id, claveDe("T3", AM.rec), 2026, { decidido: 300, origen: "manual" });
    await verificar();
  });

  it("el comprador no ve nada de esto: 403 sin datos", async () => {
    const id = await nueva();
    estadoFalso.rol = "comprador";
    const r = await lineas(get("/l", DENIM), ctx(id));
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).not.toContain("filas_tienda");
    expect((await put(id, claveDe("T4", AM.rec), 2027, { decidido: 5, origen: "manual" })).status).toBe(403);
    expect(registro(claveDe("T4", AM.rec), 2027).decidido).toBeNull();
  });
});

describe("PUT de una fila de tienda (07b): aceptar la propuesta la fija (D1)", () => {
  it("origen `propuesta` queda `manual` con decidido = propuesto, sobrevive a Recalcular y no mueve la tienda sin total", async () => {
    const id = await nueva();
    const clave = claveDe("T4", AM.rec);
    const r = await put(id, clave, 2027, { origen: "propuesta" });
    expect(r.status).toBe(200);
    const a = (await leer<RespuestaDecidirFilaApi>(r)).data;
    expect(a).toMatchObject({ anio: 2027, decidido: 1481, propuesto: 1481, origen: "manual", vigente: 1481, decidido_por_nombre: "Javier" });
    expect(registro(clave, 2027)).toMatchObject({ decidido: 1481, origen: "manual" });
    // `suma_filas` es de TODA la tienda (todas sus líneas), no solo de esta.
    expect(a.tienda).toEqual({ anio: 2027, decidido: null, suma_filas: 6909 });
    expect(tiendaDb("T4", 2027).decidido).toBeNull();

    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    expect(registro(clave, 2027)).toMatchObject({ decidido: 1481, origen: "manual" });
    // La tarjeta de la tienda cuenta la fila fijada.
    expect((await tiendasDe(id)).find((t) => t.codigo === "T4")).toMatchObject({ suma_filas: 6909, filas_fijadas: 1, decidido: null });
  });

  it("en una fila base `propuesta` sigue siendo `propuesta` y la respuesta no trae `tienda`", async () => {
    const id = await nueva();
    const r = await leer<RespuestaDecidirFilaApi>(await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: idFila(`|${N.denim}||${AM.rec}`), anio: "2026" })));
    expect(r.data).toMatchObject({ origen: "propuesta" });
    expect(r.data.tienda).toBeUndefined();
  });
});

describe("PUT de una fila de tienda (07b): sin total decidido solo se fija la fila (D2)", () => {
  it("la tienda sigue sin decidir, su propuesta no cambia y el año siguiente `maduro_propio` de la fila se rehace", async () => {
    const id = await nueva();
    const clave = claveDe("T3", AM.rec);
    expect(registro(clave, 2027)).toMatchObject({ metodo: "maduro_propio", propuesto: 504 });
    const propuestoTienda = tiendaDb("T3", 2026).propuesto;
    const r = await put(id, clave, 2026, { decidido: 300, origen: "manual" });
    expect(r.status).toBe(200);
    expect((await leer<RespuestaDecidirFilaApi>(r)).data).toMatchObject({ decidido: 300, vigente: 300, tienda: { anio: 2026, decidido: null, suma_filas: 300 } });
    expect(tiendaDb("T3", 2026)).toMatchObject({ decidido: null, origen: null, propuesto: propuestoTienda });
    // 300 de 2026 → el año maduro implícito crece y con él la propuesta de 2027 (antes quedaba en 504).
    expect(registro(clave, 2027).propuesto).toBe(630);
    expect(registro(clave, 2027).decidido).toBeNull();
    expect((await tiendasDe(id)).find((t) => t.codigo === "T3" && t.anio === 2026)).toMatchObject({ suma_filas: 300, filas_fijadas: 1, decidido: null });
  });
});

describe("PUT de una fila de tienda (07b): con total decidido, el total se mueve y las demás filas no", () => {
  const T3_REC = claveDe("T3", AM.rec);
  const T3_PRE = claveDe("T3", AM.pre);

  async function conTotalDecidido() {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2026, { decidido: 300, origen: "manual", nota: "Tomo la del comité" })).status).toBe(200);
    expect(sumaFilas("T3", 2026)).toBe(300);
    expect(registro(T3_REC, 2026)).toMatchObject({ decidido: 300, origen: "escalada" });
    return id;
  }

  it("D' = D + Δ, guardado como decisión del planner con quién, cuándo y de dónde; las otras filas quedan igual", async () => {
    const id = await conTotalDecidido();
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(r.status).toBe(200);
    const a = (await leer<RespuestaDecidirFilaApi>(r)).data;
    expect(a).toMatchObject({ decidido: 50, origen: "manual", tienda: { anio: 2026, decidido: 350, suma_filas: 350 } });
    expect(tiendaDb("T3", 2026)).toMatchObject({
      decidido: 350,
      origen: "manual",
      decidido_por_nombre: "Javier",
      decidido_por_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(tiendaDb("T3", 2026).decidido_at).toBeTruthy();
    expect(tiendaDb("T3", 2026).nota).toBe("Tomo la del comité · ajustado desde la línea HOMBRE · URBANO · DENIM");
    expect(registro(T3_REC, 2026)).toMatchObject({ decidido: 300, origen: "escalada" });
    expect(sumaFilas("T3", 2026)).toBe(350);
    expect((await tiendasDe(id)).find((t) => t.codigo === "T3" && t.anio === 2026)).toMatchObject({ decidido: 350, vigente: 350, suma_filas: 350, filas_fijadas: 1 });
    expect((await lineaDenim(id)).tiendas_linea.find((t) => t.tienda === "T3" && t.anio === 2026)).toMatchObject({ vigente: 350, decidida: true, total_tienda: { decidido: 350 } });
  });

  it("bajar una fila baja el total en lo mismo; nunca queda Σ filas distinta de D'", async () => {
    const id = await conTotalDecidido();
    await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    const r = await put(id, T3_REC, 2026, { decidido: 200, origen: "manual" });
    expect((await leer<RespuestaDecidirFilaApi>(r)).data.tienda).toEqual({ anio: 2026, decidido: 250, suma_filas: 250 });
    expect(tiendaDb("T3", 2026).decidido).toBe(250);
    expect(sumaFilas("T3", 2026)).toBe(250);
    expect(registro(T3_PRE, 2026)).toMatchObject({ decidido: 50, origen: "manual" });
  });

  it("las fijadas nunca pasan el total de la tienda (D3): si la tienda arrastraba un total menor, el total sube a lo fijado", async () => {
    const id = await conTotalDecidido();
    await put(id, T3_REC, 2026, { decidido: 280, origen: "manual" });
    // Estado heredado: el total decidido quedó por debajo de lo fijado.
    tiendaDb("T3", 2026).decidido = 100;
    const r = await put(id, T3_PRE, 2026, { decidido: 30, origen: "manual" });
    expect(r.status).toBe(200);
    const t = (await leer<RespuestaDecidirFilaApi>(r)).data.tienda;
    expect(t).toEqual({ anio: 2026, decidido: 310, suma_filas: 310 });
    expect(tiendaDb("T3", 2026).decidido).toBe(310);
    expect(sumaFilas("T3", 2026)).toBe(310);
    expect(registro(T3_REC, 2026).avisos).not.toContain("fijadas_exceden");
  });

  it("el total movido que queda bajo lo vendido por la tienda es 409 menor_que_vendido y no se escribe nada", async () => {
    const id = await conTotalDecidido();
    tiendaDb("T3", 2026).vendido = 1000; // estado heredado: la tienda vendió más de lo que dice su total
    const antes = registro(T3_PRE, 2026).decidido;
    const r = await put(id, T3_PRE, 2026, { decidido: 10, origen: "manual" });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("menor_que_vendido");
    expect(registro(T3_PRE, 2026).decidido).toBe(antes);
    expect(tiendaDb("T3", 2026).decidido).toBe(300);
  });

  it("una fila menor que lo que ya vendió sigue siendo 409 menor_que_vendido (año en curso)", async () => {
    const id = await conTotalDecidido();
    const r = await put(id, T3_REC, 2026, { decidido: 50, origen: "manual" }); // la fila vendió 120
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("menor_que_vendido");
    expect(tiendaDb("T3", 2026).decidido).toBe(300);
  });

  it("volver una fila a la propuesta no mueve el total: la tienda la vuelve a escalar con D", async () => {
    const id = await conTotalDecidido();
    await put(id, T3_REC, 2026, { decidido: 250, origen: "manual" });
    expect(tiendaDb("T3", 2026).decidido).toBe(250);
    const r = await put(id, T3_REC, 2026, { decidido: null });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(250);
    expect(registro(T3_REC, 2026)).toMatchObject({ decidido: 250, origen: "escalada" });
    expect(sumaFilas("T3", 2026)).toBe(250);
  });

  it("también en el año siguiente (2027): se mueve el total de 2027 de la tienda", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T4", 2027, { decidido: 7000, origen: "manual" })).status).toBe(200);
    const r = await put(id, claveDe("T4", AM.rec), 2027, { decidido: 2000, origen: "manual" });
    expect(r.status).toBe(200);
    const t = (await leer<RespuestaDecidirFilaApi>(r)).data.tienda;
    expect(t?.decidido).toBe(tiendaDb("T4", 2027).decidido);
    expect(t?.suma_filas).toBe(sumaFilas("T4", 2027));
    expect(t?.decidido).toBe(t?.suma_filas);
    expect(tiendaDb("T4", 2027).nota).toContain("ajustado desde la línea");
  });
});

describe("PUT de una fila de tienda (07b): validación y estados de la proyección", () => {
  it("el cuerpo se valida con zod: cifra no entera, negativa o texto es 400 y no se escribe", async () => {
    const id = await nueva();
    const clave = claveDe("T4", AM.rec);
    for (const decidido of [1.5, -3, "mil", 1e12]) {
      expect((await put(id, clave, 2027, { decidido, origen: "manual" })).status).toBe(400);
    }
    expect((await put(id, clave, 2027, { origen: "manual" })).status).toBe(400);
    expect(registro(clave, 2027).decidido).toBeNull();
  });

  it("proyección cerrada, archivada o calculándose: 409 con su código y nada cambia", async () => {
    const id = await nueva();
    const clave = claveDe("T4", AM.rec);
    const p = filasDe("proyecciones")[0];
    p.estado = "cerrada";
    let r = await put(id, clave, 2027, { decidido: 100, origen: "manual" });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("cerrada");
    p.estado = "archivada";
    r = await put(id, clave, 2027, { origen: "propuesta" });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("archivada");
    p.estado = "en_trabajo";
    p.calculando_desde = new Date().toISOString();
    r = await put(id, clave, 2027, { decidido: 100, origen: "manual" });
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("calculo_en_curso");
    expect(registro(clave, 2027).decidido).toBeNull();
    expect(tiendaDb("T4", 2027).decidido).toBeNull();
  });

  it("fila inactiva y fila sin propuesta siguen siendo 409", async () => {
    const id = await nueva();
    const clave = claveDe("T4", AM.rec);
    (filasDe("proyeccion_filas").find((f) => f.clave === clave) as Fila).activo = false;
    const inactiva = await put(id, clave, 2027, { decidido: 100, origen: "manual" });
    expect(inactiva.status).toBe(409);
    expect((await leer(inactiva)).codigo).toBe("fila_inactiva");
    (filasDe("proyeccion_filas").find((f) => f.clave === clave) as Fila).activo = true;
    registro(clave, 2027).propuesto = null;
    const sin = await put(id, clave, 2027, { origen: "propuesta" });
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("sin_propuesta");
  });
});

describe("PUT de una fila de tienda (07b): Σ filas = total decidido en los DOS años", () => {
  const T3_REC = claveDe("T3", AM.rec);
  const T3_PRE = claveDe("T3", AM.pre);

  it("tienda sin total en 2026 y con total en 2027: editar una fila de 2026 rehace 2027 pero Σ filas 2027 sigue siendo D(2027)", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2027, { decidido: 900, origen: "manual" })).status).toBe(200);
    expect(sumaFilas("T3", 2027)).toBe(900);
    const r = await put(id, T3_REC, 2026, { decidido: 300, origen: "manual" });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBeNull();
    expect(tiendaDb("T3", 2027).decidido).toBe(900);
    expect(sumaFilas("T3", 2027)).toBe(900);
    // Las filas de 2027 siguen siendo `escalada` (no se fijaron solas) y la de 2026 quedó fijada.
    expect(registro(T3_REC, 2027).origen).toBe("escalada");
    expect(registro(T3_REC, 2026)).toMatchObject({ decidido: 300, origen: "manual" });
    // La tarjeta y la línea ven lo mismo que la base.
    expect((await tiendasDe(id)).find((t) => t.codigo === "T3" && t.anio === 2027)).toMatchObject({ decidido: 900, suma_filas: 900 });
  });

  it("con total en 2026 y en 2027: el total de 2026 se mueve (D + Δ) y Σ filas = D en los dos años", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2026, { decidido: 300, origen: "manual" })).status).toBe(200);
    expect((await putTienda(id, "T3", 2027, { decidido: 900, origen: "manual" })).status).toBe(200);
    expect(sumaFilas("T3", 2026)).toBe(300);
    expect(sumaFilas("T3", 2027)).toBe(900);
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(350);
    expect(sumaFilas("T3", 2026)).toBe(350);
    expect(tiendaDb("T3", 2027).decidido).toBe(900);
    expect(sumaFilas("T3", 2027)).toBe(900);
  });

  it("las filas fijadas de 2027 se conservan al rehacer 2027 y el resto absorbe el total", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2027, { decidido: 900, origen: "manual" })).status).toBe(200);
    expect((await put(id, T3_PRE, 2027, { decidido: 100, origen: "manual" })).status).toBe(200);
    // Fijar una fila mueve el total (D + Δ): el total de 2027 es ahora el que quedó guardado y Σ filas lo iguala.
    const D = tiendaDb("T3", 2027).decidido as number;
    expect(sumaFilas("T3", 2027)).toBe(D);
    expect((await put(id, T3_REC, 2026, { decidido: 300, origen: "manual" })).status).toBe(200);
    expect(registro(T3_PRE, 2027)).toMatchObject({ decidido: 100, origen: "manual" });
    expect(tiendaDb("T3", 2027).decidido).toBe(D);
    expect(sumaFilas("T3", 2027)).toBe(D);
  });

  it("cambiar el total de 2026 desde la tarjeta también deja Σ filas 2027 = D(2027)", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2027, { decidido: 900, origen: "manual" })).status).toBe(200);
    expect((await putTienda(id, "T3", 2026, { decidido: 400, origen: "manual" })).status).toBe(200);
    expect(sumaFilas("T3", 2026)).toBe(400);
    expect(sumaFilas("T3", 2027)).toBe(900);
  });
});

describe("PUT de una fila de tienda (07b): orden de comprobaciones y bloqueo optimista", () => {
  const T3_REC = claveDe("T3", AM.rec);
  const T3_PRE = claveDe("T3", AM.pre);
  const ESCRITURAS = new Set(["insert", "update", "upsert", "delete"]);

  async function conTotalDecidido() {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2026, { decidido: 300, origen: "manual", nota: "Tomo la del comité" })).status).toBe(200);
    return id;
  }

  it("la relectura del estado de la proyección es lo último que se lee antes de la primera escritura (fila de tienda y fila base)", async () => {
    const id = await conTotalDecidido();
    const casos: Array<[string, string, number, number]> = [
      ["fila de tienda con total", T3_PRE, 2026, 50],
      ["fila de tienda sin total", T3_REC, 2027, 400],
      ["fila base", `|${N.denim}||${AM.rec}`, 2026, 5000],
    ];
    for (const [nombre, clave, anio, cifra] of casos) {
      const eventos: string[] = [];
      base.alOperar = (tabla, operacion) => eventos.push(`${tabla}:${operacion}`);
      const r = await put(id, clave, anio, { decidido: cifra, origen: "manual" });
      base.alOperar = null;
      expect(r.status, nombre).toBe(200);
      const primera = eventos.findIndex((e) => ESCRITURAS.has(e.split(":")[1]) && e !== "proyecciones:update");
      expect(primera, nombre).toBeGreaterThan(0);
      expect(eventos[primera - 1], nombre).toBe("proyecciones:select");
    }
  });

  it("propagarTienda vuelve a comprobar antes de escribir: si la proyección se cierra en esa ventana, 409 y no se escribe nada de sus filas", async () => {
    const id = await nueva();
    const p = filasDe("proyecciones")[0];
    // La primera lectura de `proyecciones` es la del handler; la tercera (tras la comprobación previa a la fila) ve el cierre.
    let lecturas = 0;
    base.alOperar = (tabla, operacion) => {
      if (tabla === "proyecciones" && operacion === "select") {
        lecturas += 1;
        if (lecturas === 3) p.estado = "cerrada";
      }
    };
    const antes = registro(T3_REC, 2027).propuesto;
    const r = await put(id, T3_REC, 2026, { decidido: 300, origen: "manual" });
    base.alOperar = null;
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("cerrada");
    expect(registro(T3_REC, 2027).propuesto).toBe(antes);
  });

  it("dos PUT simultáneos sobre la misma tienda: el segundo recibe 409 `conflicto` y su fila no se escribe (nada de D+Δ acumulado)", async () => {
    const id = await conTotalDecidido();
    const antesPre = registro(T3_PRE, 2026).decidido;
    // Entre la lectura de la tienda y el UPDATE condicional, «otro PUT» mueve el total de 300 a 340.
    let interferido = false;
    base.falloDeEscritura = (tabla, modo) => {
      if (!interferido && tabla === "proyeccion_tiendas" && modo === "update") {
        interferido = true;
        tiendaDb("T3", 2026).decidido = 340;
      }
      return null;
    };
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    base.falloDeEscritura = null;
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("conflicto");
    expect(c.error).toBe("La tienda cambió mientras editabas; recarga y vuelve a intentar.");
    expect(tiendaDb("T3", 2026).decidido).toBe(340);
    expect(registro(T3_PRE, 2026).decidido).toBe(antesPre);
    // Reintentando con lo nuevo, funciona: D' = 340 + Δ.
    const otra = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(otra.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(340 + 50 - (antesPre as number));
  });

  it("si falla el guardado de la fila después de mover el total, el total vuelve a como estaba", async () => {
    const id = await conTotalDecidido();
    const antes = { ...tiendaDb("T3", 2026) };
    base.falloDeEscritura = (tabla, modo) => (tabla === "proyeccion_fila_anios" && modo === "upsert" ? { code: "57014", message: "statement timeout", details: null, hint: null } : null);
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    base.falloDeEscritura = null;
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(tiendaDb("T3", 2026)).toMatchObject({ decidido: antes.decidido, origen: antes.origen, nota: antes.nota, decidido_por_nombre: antes.decidido_por_nombre });
  });

  it("si falla la base a mitad de propagarTienda, el mensaje invita a recargar y no filtra detalles", async () => {
    const id = await conTotalDecidido();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let n = 0;
    // La primera escritura de `proyeccion_tiendas` es el bloqueo del total (pasa); la siguiente es la de propagarTienda (falla).
    base.falloDeEscritura = (tabla, modo) => {
      if (tabla === "proyeccion_tiendas" && modo === "update" && ++n === 2) return { code: "XX000", message: "relation secreta_interna broke", details: null, hint: null };
      return null;
    };
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    base.falloDeEscritura = null;
    expect(r.status).toBe(500);
    const c = await leer(r);
    expect(c.error).toMatch(/Recarga la proyección/);
    expect(JSON.stringify(c)).not.toContain("secreta_interna");
    expect(error).toHaveBeenCalled();
  });
});

describe("PUT de una fila de tienda (07b): las filas y años inactivos no cuentan como fijados", () => {
  const T3_REC = claveDe("T3", AM.rec);
  const T3_PRE = claveDe("T3", AM.pre);

  async function preparar() {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2026, { decidido: 300, origen: "manual" })).status).toBe(200);
    const y = registro(T3_PRE, 2026).decidido as number;
    // La fila REC queda con una cifra fijada vieja y enorme que, si contara, empujaría el total muy por encima de D + Δ.
    const rec = registro(T3_REC, 2026);
    rec.decidido = 5000;
    rec.origen = "manual";
    return { id, y, rec };
  }

  it("una fila inactiva de la tienda con cifra `manual` no sube el total: D' = D + Δ", async () => {
    const { id, y } = await preparar();
    (filasDe("proyeccion_filas").find((f) => f.clave === T3_REC) as Fila).activo = false;
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(300 + 50 - y);
  });

  it("un año inactivo de una fila activa tampoco cuenta", async () => {
    const { id, y, rec } = await preparar();
    rec.activo = false;
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(300 + 50 - y);
  });

  it("control: la misma fila ACTIVA sí cuenta (el total sube a lo fijado)", async () => {
    const { id } = await preparar();
    const r = await put(id, T3_PRE, 2026, { decidido: 50, origen: "manual" });
    expect(r.status).toBe(200);
    expect(tiendaDb("T3", 2026).decidido).toBe(5050);
  });
});
