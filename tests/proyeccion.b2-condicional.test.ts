import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

/**
 * 07g §3.6 (R26): la B2 de `decidirFila` y de `propagarTienda` escribe el `Y+1` que solo se recalcula con un `update` condicional por `updated_at` y sin columnas
 * de decisión. Si otro proceso lo cambió entre la lectura y la escritura, `409 conflicto` y nada escrito; una decisión de lote en ese `Y+1` sobrevive. Datos sintéticos.
 */

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
import { PUT as decidirFilaRuta } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTiendaRuta } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { construirVenta, AM, MARCA, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { ProyeccionApi } from "@/lib/proyeccion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion";
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;

const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const claveDe = (tienda: string, am: string) => `${tienda}|${N.denim}||${am}`;
const BASE_REC = `|${N.denim}||${AM.rec}`;
const idFila = (clave: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave)?.id as string;
const registro = (clave: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(clave) && a.anio === anio) as Fila;

const COLUMNAS_DE_DECISION = ["decidido", "origen", "nota", "propuesta_al_decidir", "decidido_at", "decidido_por_id", "decidido_por_nombre", "decision_ia_fila_id", "decision_lote_id", "crecimiento_pct"];
const LOTE = "00000000-0000-4000-8000-0000000000c1";
const PF = "00000000-0000-4000-8000-0000000000b1";

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
const put = (id: string, clave: string, anio: number, cuerpo: unknown) => decidirFilaRuta(enviar("PUT", "/x", cuerpo), ctx(id, { filaId: idFila(clave), anio: String(anio) }));
const putTienda = (id: string, tienda: string, anio: number, cuerpo: unknown) => decidirTiendaRuta(enviar("PUT", "/x", cuerpo), ctx(id, { tiendaId: tienda, anio: String(anio) }));

type Escritura = { tabla: string; modo: string; carga: Fila | Fila[] };
/** Registra cada escritura (sin impedirla); `antes` corre justo antes de aplicarla (para simular a «otro proceso»). */
function espiar(antes?: (e: Escritura) => void): { escrituras: Escritura[]; parar: () => void } {
  const escrituras: Escritura[] = [];
  base.falloDeEscritura = (tabla, modo, carga) => {
    const e = { tabla, modo, carga };
    escrituras.push(e);
    antes?.(e);
    return null;
  };
  return { escrituras, parar: () => (base.falloDeEscritura = null) };
}
const deRegistros = (es: Escritura[], modo: string) => es.filter((e) => e.tabla === "proyeccion_fila_anios" && e.modo === modo);
const lista = (c: Fila | Fila[]): Fila[] => (Array.isArray(c) ? c : [c]);

/** Deja un registro como lo dejaría un lote de aprobación. */
function comoDeLote(clave: string, anio: number, decidido: number, conIa = false) {
  const r = registro(clave, anio);
  base.tablas.ia_propuestas_gm = [{ id: "pgm", proveedor: "p", modelo: "m", version_prompt: "v1", created_at: "2026-11-03T10:00:00.000Z" }];
  base.tablas.ia_propuestas_filas = [{ id: PF, propuesta_gm_id: "pgm", fila_id: null, fila_clave: "x" }];
  Object.assign(r, { decidido, origen: conIa ? "manual" : "propuesta", propuesta_al_decidir: r.propuesto, decision_lote_id: LOTE, decision_ia_fila_id: conIa ? PF : null });
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
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

describe("R26 · decidirFila (año en curso): la B2 del Y+1 es un update condicional sin columnas de decisión", () => {
  it("el Y+1 recalculado se escribe con UPDATE por id y updated_at; solo el registro decidido va con upsert y lleva la decisión", async () => {
    const id = await nueva();
    const sig = registro(BASE_REC, 2027);
    const leidoUpdatedAt = sig.updated_at;
    const propuestoAntes = sig.propuesto;
    const e = espiar();
    const r = await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" });
    e.parar();
    expect(r.status).toBe(200);

    const updates = deRegistros(e.escrituras, "update");
    expect(updates).toHaveLength(1);
    const cambio = updates[0].carga as Fila;
    for (const col of COLUMNAS_DE_DECISION) expect(Object.keys(cambio), col).not.toContain(col);
    for (const col of ["fila_id", "anio", "activo"]) expect(Object.keys(cambio), col).not.toContain(col);
    expect(Object.keys(cambio)).toEqual(expect.arrayContaining(["propuesto", "meses", "avisos"]));

    const upserts = deRegistros(e.escrituras, "upsert").flatMap((u) => lista(u.carga));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ anio: 2026, decidido: 5000, origen: "manual", decision_lote_id: null });

    // La B2 se hizo de verdad: el Y+1 salió del registro leído (su updated_at cambió) con la propuesta nueva.
    expect(registro(BASE_REC, 2027).updated_at).not.toBe(leidoUpdatedAt);
    expect(registro(BASE_REC, 2027).propuesto).not.toBe(propuestoAntes);
    expect(registro(BASE_REC, 2026)).toMatchObject({ decidido: 5000, origen: "manual" });
  });

  it("el UPDATE condicional va primero: la decisión no se escribe antes de comprobar el Y+1", async () => {
    const id = await nueva();
    const e = espiar();
    await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" });
    e.parar();
    const orden = e.escrituras.filter((x) => x.tabla === "proyeccion_fila_anios").map((x) => x.modo);
    expect(orden.indexOf("update")).toBeLessThan(orden.indexOf("upsert"));
  });

  it("si otro proceso cambió el Y+1 entre la lectura y la escritura: 409 conflicto y NADA escrito (ni la decisión ni la base recalculada); lo del otro queda", async () => {
    const id = await nueva();
    const sig = registro(BASE_REC, 2027);
    const propuestoAntes = sig.propuesto;
    const e = espiar(({ tabla, modo }) => {
      if (tabla === "proyeccion_fila_anios" && modo === "update") {
        // «Otro proceso» (un lote, otra decisión) decide el Y+1 justo antes.
        Object.assign(sig, { decidido: 777, origen: "propuesta", decision_lote_id: LOTE, updated_at: "2099-01-01T00:00:00.000000+00:00" });
      }
    });
    const r = await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" });
    e.parar();
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("conflicto");
    expect(c.error).toBe("La proyección cambió mientras guardabas; recarga y vuelve a intentar.");
    expect(deRegistros(e.escrituras, "upsert")).toHaveLength(0);
    expect(registro(BASE_REC, 2026).decidido ?? null).toBeNull();
    expect(registro(BASE_REC, 2027)).toMatchObject({ propuesto: propuestoAntes, decidido: 777, origen: "propuesta", decision_lote_id: LOTE });
  });

  it("tras recargar (sin interferencia) el mismo PUT funciona", async () => {
    const id = await nueva();
    const sig = registro(BASE_REC, 2027);
    let tocado = false;
    const e = espiar(({ tabla, modo }) => {
      if (!tocado && tabla === "proyeccion_fila_anios" && modo === "update") {
        tocado = true;
        sig.updated_at = "2099-01-01T00:00:00.000000+00:00";
      }
    });
    expect((await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" })).status).toBe(409);
    e.parar();
    expect((await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" })).status).toBe(200);
    expect(registro(BASE_REC, 2026)).toMatchObject({ decidido: 5000 });
  });

  it("una decisión de lote en el Y+1 sobrevive a decidir el Y: decidido, origen, traza y decision_lote_id intactos", async () => {
    const id = await nueva();
    comoDeLote(BASE_REC, 2027, 2100, true);
    const e = espiar();
    const r = await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" });
    e.parar();
    expect(r.status).toBe(200);
    expect(registro(BASE_REC, 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF, decision_lote_id: LOTE });
    for (const u of deRegistros(e.escrituras, "update")) for (const col of COLUMNAS_DE_DECISION) expect(Object.keys(u.carga as Fila), col).not.toContain(col);
  });

  it("decidir el año siguiente escribe SOLO ese registro (el Y no se reescribe) y limpia decision_lote_id", async () => {
    const id = await nueva();
    comoDeLote(BASE_REC, 2027, 2100);
    const y = registro(BASE_REC, 2026);
    const yUpdated = y.updated_at;
    const e = espiar();
    const r = await put(id, BASE_REC, 2027, { decidido: 2300, origen: "manual" });
    e.parar();
    expect(r.status).toBe(200);
    expect(deRegistros(e.escrituras, "update")).toHaveLength(0);
    const upserts = deRegistros(e.escrituras, "upsert").flatMap((u) => lista(u.carga));
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ anio: 2027, decidido: 2300, decision_lote_id: null });
    expect(registro(BASE_REC, 2026).updated_at).toBe(yUpdated);
    expect(registro(BASE_REC, 2027)).toMatchObject({ decidido: 2300, decision_lote_id: null });
  });
});

describe("R26 · propagarTienda: la base de Y+1 que B2 recalcula tras decidir el total de una tienda nueva (T2)", () => {
  const decidirT2 = (id: string) => putTienda(id, "T2", 2026, { decidido: 400, origen: "manual", nota: "Tomo la de la tienda" });

  it("se escribe con UPDATE condicional y sin columnas de decisión (la base de Y+1 deja de salir por upsert)", async () => {
    const id = await nueva();
    const propuestoAntes = registro(BASE_REC, 2027).propuesto;
    const e = espiar();
    const r = await decidirT2(id);
    e.parar();
    expect(r.status).toBe(200);
    const idBase = idFila(BASE_REC);
    const updates = deRegistros(e.escrituras, "update");
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) for (const col of [...COLUMNAS_DE_DECISION, "activo", "fila_id", "anio"]) expect(Object.keys(u.carga as Fila), col).not.toContain(col);
    // Ningún upsert de registros toca las filas base de Y+1 (esas ya no van por la ruta de las decisiones).
    const upsertsBase = deRegistros(e.escrituras, "upsert").flatMap((u) => lista(u.carga)).filter((p) => p.fila_id === idBase);
    expect(upsertsBase).toEqual([]);
    // La B2 se hizo de verdad.
    expect(registro(BASE_REC, 2027).propuesto).not.toBe(propuestoAntes);
  });

  it("una decisión de lote en la base de Y+1 sobrevive (decidido, origen, traza y decision_lote_id)", async () => {
    const id = await nueva();
    comoDeLote(BASE_REC, 2027, 2100, true);
    const r = await decidirT2(id);
    expect(r.status).toBe(200);
    expect(registro(BASE_REC, 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF, decision_lote_id: LOTE });
  });

  it("si otro proceso cambió la base de Y+1 después de leerla: 409 conflicto y la base de Y+1 queda como la dejó el otro", async () => {
    const id = await nueva();
    const sig = registro(BASE_REC, 2027);
    const e = espiar(({ tabla, modo }) => {
      if (tabla === "proyeccion_fila_anios" && modo === "update") {
        Object.assign(sig, { decidido: 777, origen: "propuesta", decision_lote_id: LOTE, updated_at: "2099-01-01T00:00:00.000000+00:00" });
      }
    });
    const r = await decidirT2(id);
    e.parar();
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("conflicto");
    expect(registro(BASE_REC, 2027)).toMatchObject({ decidido: 777, origen: "propuesta", decision_lote_id: LOTE });
  });

  it("la decisión de una fila de tienda (PUT de la fila) que mueve la base de Y+1 sigue el mismo camino", async () => {
    const id = await nueva();
    comoDeLote(BASE_REC, 2027, 2100);
    const e = espiar();
    const r = await put(id, claveDe("T2", AM.rec), 2026, { decidido: 300, origen: "manual" });
    e.parar();
    expect(r.status).toBe(200);
    expect(registro(BASE_REC, 2027)).toMatchObject({ decidido: 2100, decision_lote_id: LOTE });
    for (const u of deRegistros(e.escrituras, "update")) for (const col of COLUMNAS_DE_DECISION) expect(Object.keys(u.carga as Fila), col).not.toContain(col);
  });

  it("las escrituras de registros van en orden de (fila_id, anio) dentro de cada lote de upsert", async () => {
    const id = await nueva();
    const e = espiar();
    await decidirT2(id);
    e.parar();
    const upserts = deRegistros(e.escrituras, "upsert");
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      const claves = lista(u.carga).map((c) => `${String(c.fila_id)}#${String(c.anio).padStart(4, "0")}`);
      expect(claves).toEqual([...claves].sort());
    }
  });
});

describe("R26 · el Y+1 que todavía no existe se inserta (nadie pudo decidirlo)", () => {
  it("sin registro previo de Y+1 la B2 lo crea con las columnas de cálculo y sin decisión", async () => {
    const id = await nueva();
    const idBase = idFila(BASE_REC);
    base.tablas.proyeccion_fila_anios = filasDe("proyeccion_fila_anios").filter((a) => !(a.fila_id === idBase && a.anio === 2027));
    const e = espiar();
    const r = await put(id, BASE_REC, 2026, { decidido: 5000, origen: "manual" });
    e.parar();
    expect(r.status).toBe(200);
    const creado = registro(BASE_REC, 2027);
    expect(creado).toBeDefined();
    expect(creado.decidido ?? null).toBeNull();
    expect(creado.decision_lote_id ?? null).toBeNull();
  });
});
