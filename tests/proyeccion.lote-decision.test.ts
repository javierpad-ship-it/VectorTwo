import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

/**
 * 07g (R2, R12): `filaBloqueaCierre` es la única definición de «bloquea el cierre» y `motivoRechazoCerrar` da lo mismo que antes; toda decisión individual limpia
 * `decision_lote_id` del registro decidido, el `Y+1` recalculado y `calcular` lo conservan y `copiar_de` no lo copia; la lectura trae `decision_lote`. Datos sintéticos; sin red.
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
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { GET as detalleFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/route";
import { PUT as decidirFilaRuta } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";
import { filaBloqueaCierre, motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import { payloadAnioDecision } from "@/lib/proyeccion/persistencia";
import type { RegistroModelo } from "@/lib/proyeccion/tipos";
import { construirVenta, GEN, LIN, MUN, N, AM, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { AnioFilaApi, FilaDetalleApi, ProyeccionApi, RespuestaLineasApi } from "@/lib/proyeccion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const idFila = (clave: string, proyeccionId?: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave && (proyeccionId === undefined || f.proyeccion_id === proyeccionId))?.id as string;
const reg = (filaId: string, anio: number) => filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaId && x.anio === anio) as Fila;
const DENIM_REC = `|${N.denim}||${AM.rec}`;

const LOTE = "00000000-0000-4000-8000-0000000000c1";
const PGM = "00000000-0000-4000-8000-0000000000a1";
const PF = "00000000-0000-4000-8000-0000000000b1";
const CREADO = "2026-11-03T10:00:00.000Z";

/** Deja un registro como lo dejaría un lote de aprobación (la base falsa no corre la función SQL): decidido, origen y `decision_lote_id`; con traza de IA si se pide. */
function comoDeLote(filaId: string, anio: number, decidido: number, conIa = false) {
  const r = reg(filaId, anio);
  Object.assign(r, { decidido, origen: conIa ? "manual" : "propuesta", propuesta_al_decidir: r.propuesto, decision_lote_id: LOTE, decision_ia_fila_id: conIa ? PF : null });
}

function sembrarLote(filaId: string, anio: number, fuente: "ia" | "metodo") {
  base.tablas.proyeccion_lotes = [{ id: LOTE, tipo: "aprobar", created_at: CREADO, usuario_nombre: "Ana Planner" }];
  base.tablas.proyeccion_lote_filas = [{ id: "lf-1", lote_id: LOTE, fila_id: filaId, anio, fuente, resultado: "aplicada" }];
  base.tablas.ia_propuestas_gm = [{ id: PGM, proveedor: "proveedor-falso", modelo: "modelo-falso-1", version_prompt: "v1", created_at: CREADO }];
  base.tablas.ia_propuestas_filas = [{ id: PF, propuesta_gm_id: PGM, fila_id: null, fila_clave: "x" }];
}

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { id: cuerpo.data?.id as string };
}

function observar(): { tablas: Set<string>; parar: () => void } {
  const tablas = new Set<string>();
  base.alOperar = (t) => void tablas.add(t);
  return { tablas, parar: () => (base.alOperar = null) };
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

// ─── R2 ───

describe("R2: filaBloqueaCierre y motivoRechazoCerrar", () => {
  const UMBRAL = 100;
  it("tabla de casos: decidida no bloquea; sin propuesta no bloquea; revision_cola_larga manda sobre el umbral; el umbral es inclusivo", () => {
    expect(filaBloqueaCierre({ propuesto: 100, decidido: null }, UMBRAL)).toBe("umbral");
    expect(filaBloqueaCierre({ propuesto: 99, decidido: null }, UMBRAL)).toBeNull();
    expect(filaBloqueaCierre({ propuesto: 5000, decidido: 0 }, UMBRAL)).toBeNull();
    expect(filaBloqueaCierre({ propuesto: null, decidido: null, avisos: ["revision_cola_larga"] }, UMBRAL)).toBeNull();
    expect(filaBloqueaCierre({ propuesto: 20, decidido: null, avisos: ["revision_cola_larga"] }, UMBRAL)).toBe("revision_cola_larga");
    expect(filaBloqueaCierre({ propuesto: 5000, decidido: null, avisos: ["revision_cola_larga"] }, UMBRAL)).toBe("revision_cola_larga");
    expect(filaBloqueaCierre({ propuesto: 20, decidido: 25, avisos: ["revision_cola_larga"] }, UMBRAL)).toBeNull();
    expect(filaBloqueaCierre({ propuesto: 5000, decidido: null, avisos: ["cola_larga"] }, UMBRAL)).toBe("umbral");
    expect(filaBloqueaCierre({ propuesto: 0, decidido: null }, 0)).toBe("umbral");
  });

  /** Todas las combinaciones de propuesta, decisión y aviso: 45 filas base de un solo año (el otro año, vacío). */
  const combos = () => {
    const filas: { clave: string; anios: Record<number, { clave: string; propuesto: number | null; decidido: number | null; avisos: string[] }> }[] = [];
    let i = 0;
    for (const propuesto of [null, 0, 99, 100, 5000]) {
      for (const decidido of [null, 0, 120]) {
        for (const avisos of [[], ["revision_cola_larga"], ["cola_larga"]]) {
          const clave = `k${String(i++).padStart(2, "0")}`;
          filas.push({ clave, anios: { 2027: { clave, propuesto, decidido, avisos } } });
        }
      }
    }
    return filas;
  };
  const cerrar = (filasBase: ReturnType<typeof combos>) =>
    motivoRechazoCerrar({ estado: "en_trabajo", calculandoDesde: null, ahora: CREADO, anioEnCurso: 2026, filasBase, tiendas: [], desactualizada: false, forzar: false, umbralColaLarga: UMBRAL });

  it("sobre toda la rejilla de combinaciones, las filas sin decidir del cierre son exactamente las que filaBloqueaCierre marca (con el mismo motivo)", () => {
    const filas = combos();
    const esperadas = filas.flatMap((f) => {
      const r = f.anios[2027];
      const motivo = filaBloqueaCierre(r, UMBRAL);
      return motivo ? [`${f.clave}:${motivo}`] : [];
    });
    expect(esperadas.length).toBeGreaterThan(5);
    const res = cerrar(filas);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.rechazo.codigo).toBe("filas_sin_decidir");
    expect(res.total_filas_sin_decidir).toBe(esperadas.length);
    const reales = (res.filas_sin_decidir ?? []).map((f) => `${f.clave}:${f.motivo}`);
    expect(new Set(reales)).toEqual(new Set(esperadas));
    expect(res.total_filas_para_revision).toBe(esperadas.filter((e) => e.endsWith(":revision_cola_larga")).length);
  });

  it("aprobar (decidir) todas las que bloquean deja sin filas_sin_decidir; el resto no cambia", () => {
    const filas = combos();
    for (const f of filas) {
      const r = f.anios[2027];
      if (filaBloqueaCierre(r, UMBRAL) !== null) r.decidido = r.propuesto;
    }
    expect(cerrar(filas)).toMatchObject({ ok: true });
  });

  it("la cola larga que no bloquea se cuenta igual que antes (cola_larga) y no cuenta las decididas", () => {
    const filas = combos();
    const res = cerrar(filas.filter((f) => filaBloqueaCierre(f.anios[2027], UMBRAL) === null));
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    const sinDecidir = filas.filter((f) => f.anios[2027].decidido === null && filaBloqueaCierre(f.anios[2027], UMBRAL) === null);
    expect(res.cola_larga).toBe(sinDecidir.length);
  });
});

// ─── payloadAnioDecision: decisionLoteId ───

describe("R12: payloadAnioDecision(…, decisionLoteId)", () => {
  const registro = (o: Partial<RegistroModelo> = {}): RegistroModelo =>
    ({
      anio: 2027, bloque: "mismas", subbloque: null, vendido: 0, propuesto: 500, metodo: "avance", referencia_alternativa: null, referencia_tres_meses: null, explicacion: "",
      crecimiento_pct: null, decidido: 500, origen: "propuesta", propuesta_al_decidir: 500, vigente: 500, nota: null, decidido_por_nombre: "x", decidido_at: CREADO,
      meses: null, meses_propuestos: null, origen_meses: null, avance: null, avisos: [], curva_origen_usada: [], curva_origen_propuesta: null, ...o,
    }) as RegistroModelo;

  it("sin el parámetro no escribe la columna (conserva); null la limpia; un id la escribe", () => {
    expect("decision_lote_id" in payloadAnioDecision("f", registro(), "p")).toBe(false);
    expect("decision_lote_id" in payloadAnioDecision("f", registro(), "p", undefined, undefined)).toBe(false);
    expect(payloadAnioDecision("f", registro(), "p", undefined, null).decision_lote_id).toBeNull();
    expect(payloadAnioDecision("f", registro(), "p", undefined, LOTE).decision_lote_id).toBe(LOTE);
  });

  it("sin cifra decidida siempre va null (la base exige decidido con decision_lote_id)", () => {
    expect(payloadAnioDecision("f", registro({ decidido: null, origen: null }), undefined, undefined, LOTE).decision_lote_id).toBeNull();
  });

  it("el parámetro de la traza de IA y el del lote son independientes", () => {
    const p = payloadAnioDecision("f", registro({ origen: "manual" }), "p", "traza", LOTE);
    expect(p).toMatchObject({ decision_ia_fila_id: "traza", decision_lote_id: LOTE });
    expect(payloadAnioDecision("f", registro({ origen: "manual" }), "p", null, undefined)).toMatchObject({ decision_ia_fila_id: null });
  });
});

// ─── R12 con la base falsa ───

describe("R12: toda decisión individual limpia decision_lote_id", () => {
  it("una cifra a mano sobre un registro aprobado en bloque lo saca del lote (columna y respuesta)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    comoDeLote(filaId, 2027, 2100);
    const r = await decidirFila(id, filaId, 2027, { decidido: 2200, origen: "manual" }, ACTOR);
    expect(r.respuesta).toBeNull();
    expect(r.data).toMatchObject({ decidido: 2200, origen: "manual", decision_lote: null });
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2200, origen: "manual", decision_lote_id: null });
  });

  it("«Aceptar» la propuesta del método, «Aceptar IA» y «Volver a la propuesta» también", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    sembrarLote(filaId, 2027, "metodo");

    comoDeLote(filaId, 2027, 2100);
    expect((await decidirFila(id, filaId, 2027, { origen: "propuesta" }, ACTOR)).respuesta).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ origen: "propuesta", decision_lote_id: null });

    comoDeLote(filaId, 2027, 2100, true);
    expect((await decidirFila(id, filaId, 2027, { decidido: 2150, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF })).respuesta).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2150, decision_ia_fila_id: PF, decision_lote_id: null });

    comoDeLote(filaId, 2027, 2100);
    const vuelve = await decidirFila(id, filaId, 2027, { decidido: null, origen: "manual" }, ACTOR);
    expect(vuelve.respuesta).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ decidido: null, origen: null, decision_lote_id: null });
  });

  it("el PUT de decisión lo limpia igual", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    comoDeLote(filaId, 2027, 2100);
    const r = await decidirFilaRuta(enviar("PUT", "/x", { decidido: 2300, origen: "manual" }), ctx(id, { filaId, anio: "2027" }));
    expect(r.status).toBe(200);
    expect(reg(filaId, 2027).decision_lote_id).toBeNull();
  });

  it("solo el crecimiento propio no toca la decisión: conserva el lote y la respuesta lo trae", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    sembrarLote(filaId, 2027, "metodo");
    comoDeLote(filaId, 2027, 2100);
    const r = await decidirFila(id, filaId, 2027, { crecimiento_pct: 10, origen: "manual" }, ACTOR);
    expect(r.respuesta).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2100, decision_lote_id: LOTE });
    expect(r.data?.decision_lote).toEqual({ lote_id: LOTE, tipo: "aprobar", created_at: CREADO, usuario_nombre: "Ana Planner", fuente: "metodo" });
  });

  it("el Y+1 que B2 recalcula al decidir Y conserva su decisión de lote (decidido, origen, traza y decision_lote_id)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    sembrarLote(filaId, 2027, "ia");
    comoDeLote(filaId, 2027, 2100, true);
    const d26 = await decidirFila(id, filaId, 2026, { decidido: 1900, origen: "manual" }, ACTOR);
    expect(d26.respuesta).toBeNull();
    expect(reg(filaId, 2026)).toMatchObject({ decidido: 1900, decision_lote_id: null });
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF, decision_lote_id: LOTE });
  });

  it("calcular conserva decision_lote_id (y la decisión que lo sostiene)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    comoDeLote(filaId, 2027, 2100);
    const r = await calcular(enviar("POST", "/x", {}), ctx(id));
    expect(r.status).toBeLessThan(300);
    expect(reg(idFila(DENIM_REC), 2027)).toMatchObject({ decidido: 2100, origen: "propuesta", decision_lote_id: LOTE });
  });

  it("copiar_de copia la decisión pero NO el lote: la proyección nueva no queda «aprobada en bloque»", async () => {
    const a = (await nueva("Primera")).id;
    const filaA = idFila(DENIM_REC, a);
    comoDeLote(filaA, 2027, 2100);
    const b = (await nueva("Segunda", { copiar_de: a })).id;
    expect(b).not.toBe(a);
    const filaB = idFila(DENIM_REC, b);
    expect(reg(filaB, 2027)).toMatchObject({ decidido: 2100 });
    expect(reg(filaB, 2027).decision_lote_id ?? null).toBeNull();
    // La original sigue igual.
    expect(reg(filaA, 2027).decision_lote_id).toBe(LOTE);
  });
});

// ─── Lectura: AnioFilaApi.decision_lote ───

describe("lectura: AnioFilaApi.decision_lote", () => {
  const consulta = `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`;

  it("GET /lineas y GET /filas/[filaId]: el registro aprobado en bloque trae decision_lote (quién, cuándo, tipo y fuente); los demás, null", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    sembrarLote(filaId, 2027, "ia");
    comoDeLote(filaId, 2027, 2100, true);
    const esperado = { lote_id: LOTE, tipo: "aprobar", created_at: CREADO, usuario_nombre: "Ana Planner", fuente: "ia" };

    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", consulta), ctx(id)))).data;
    const fila = l.filas.find((f) => f.id === filaId)!;
    expect(fila.anios.find((a: AnioFilaApi) => a.anio === 2027)?.decision_lote).toEqual(esperado);
    expect(fila.anios.find((a: AnioFilaApi) => a.anio === 2026)?.decision_lote).toBeNull();
    for (const otra of l.filas.filter((f) => f.id !== filaId)) for (const a of otra.anios) expect(a.decision_lote).toBeNull();

    const d = (await leer<FilaDetalleApi>(await detalleFila(get("/f"), ctx(id, { filaId })))).data;
    expect(d.anios.find((a) => a.anio === 2027)?.decision_lote).toEqual(esperado);
    expect(d.anios.find((a) => a.anio === 2026)?.decision_lote).toBeNull();
  });

  it("sin ninguna aprobación en bloque la lectura no toca las tablas de lotes", async () => {
    const id = (await nueva()).id;
    const o = observar();
    await lineas(get("/l", consulta), ctx(id));
    await detalleFila(get("/f"), ctx(id, { filaId: idFila(DENIM_REC) }));
    o.parar();
    expect([...o.tablas].filter((t) => t.startsWith("proyeccion_lote"))).toEqual([]);
  });

  it("con lote, la lectura pide solo las tablas de lotes (cabecera y líneas) por los ids que las filas ya traen", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    sembrarLote(filaId, 2027, "metodo");
    comoDeLote(filaId, 2027, 2100);
    const o = observar();
    await lineas(get("/l", consulta), ctx(id));
    o.parar();
    expect([...o.tablas].filter((t) => t.startsWith("proyeccion_lote")).sort()).toEqual(["proyeccion_lote_filas", "proyeccion_lotes"]);
  });

  it("un lote que no se encuentra deja el registro sin decision_lote (null), no rompe la lectura", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    comoDeLote(filaId, 2027, 2100);
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", consulta), ctx(id)))).data;
    expect(l.filas.find((f) => f.id === filaId)?.anios.find((a) => a.anio === 2027)?.decision_lote).toBeNull();
  });
});
