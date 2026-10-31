import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

/**
 * 07e (R21 de edición, R24, R31): `decidirFila` con `opciones.decision_ia_fila_id`, la traza que sobrevive a `calcular` y viaja con `copiar_de`, su lectura
 * (`AnioFilaApi.decision_ia`) y que ni el cálculo, ni el cierre, ni la Matriz, ni la mensual, ni la cerrada tocan las tablas `ia_*`. Datos sintéticos; sin red.
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
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { GET as mensual } from "@/app/api/proyeccion/proyecciones/[id]/mensual/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { GET as cerrada } from "@/app/api/proyeccion/cerrada/route";
import { decidirFila } from "@/lib/proyeccion/servicio-edicion";
import { construirVenta, GEN, LIN, MUN, N, AM, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { AnioFilaApi, FilaDetalleApi, ProyeccionApi, RespuestaLineasApi, RespuestaMatrizApi } from "@/lib/proyeccion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;

const ACTOR = { id: "99999999-9999-4999-8999-999999999999", nombre: "Javier" };
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const idFila = (clave: string, proyeccionId?: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave && (proyeccionId === undefined || f.proyeccion_id === proyeccionId))?.id as string;
const DENIM_REC = `|${N.denim}||${AM.rec}`;
/** La primera fila base con propuesta de 2027 de una línea (el ABRIGO es GMLE: sus claves llevan equivalencia). */
const primeraDe = (gml: string, proyeccionId?: string) =>
  filasDe("proyeccion_filas")
    .filter((f) => f.tienda_id === null && f.gml_id === gml && (proyeccionId === undefined || f.proyeccion_id === proyeccionId) && reg(f.id as string, 2027)?.propuesto !== null)
    .sort((x, y) => String(x.clave).localeCompare(String(y.clave)))[0].id as string;
const reg = (filaId: string, anio: number) => filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaId && x.anio === anio) as Fila;

/** Proveedor, modelo y prompt de mentira: nada de ids reales de proveedores. */
const PGM = "00000000-0000-4000-8000-0000000000a1";
const PF = "00000000-0000-4000-8000-0000000000b1";
const PF2 = "00000000-0000-4000-8000-0000000000b2";
const GENERADA = "2026-10-30T15:00:00.000Z";
function sembrarPropuestaIa() {
  base.tablas.ia_propuestas_gm = [{ id: PGM, proveedor: "proveedor-falso", modelo: "modelo-falso-1", version_prompt: "v1", created_at: GENERADA }];
  base.tablas.ia_propuestas_filas = [
    { id: PF, propuesta_gm_id: PGM, fila_id: null, fila_clave: "x" },
    { id: PF2, propuesta_gm_id: PGM, fila_id: null, fila_clave: "y" },
  ];
}
const DECISION_IA = { propuesta_fila_id: PF, proveedor: "proveedor-falso", modelo: "modelo-falso-1", version_prompt: "v1", generada_at: GENERADA };

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { id: cuerpo.data?.id as string };
}

/** Las tablas que tocó una operación (para probar que algo NO lee `ia_*`). */
function observar(): { tablas: Set<string>; parar: () => void } {
  const tablas = new Set<string>();
  base.alOperar = (t) => void tablas.add(t);
  return { tablas, parar: () => (base.alOperar = null) };
}
const tocaIa = (tablas: ReadonlySet<string>) => [...tablas].filter((t) => t.startsWith("ia_"));

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
  sembrarPropuestaIa();
});
afterEach(() => vi.restoreAllMocks());

describe("R21 (edición): decidirFila y decision_ia_fila_id", () => {
  it("con la opción escribe la columna y la respuesta trae decision_ia (proveedor, modelo, prompt y fecha de la propuesta)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    const r = await decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual", nota: "IA" }, ACTOR, { decision_ia_fila_id: PF });
    expect(r.respuesta).toBeNull();
    expect(r.data).toMatchObject({ anio: 2027, decidido: 2100, origen: "manual", vigente: 2100, decision_ia: DECISION_IA });
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF });
    expect(reg(filaId, 2026).decision_ia_fila_id ?? null).toBeNull();
  });

  it("sin la opción, una cifra manual la pone en null; también «Aceptar» del método y «Volver a la propuesta» (en el mismo UPDATE que limpia decidido y origen)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    const conIa = () => decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });

    await conIa();
    const manual = await decidirFila(id, filaId, 2027, { decidido: 2200, origen: "manual" }, ACTOR);
    expect(manual.data).toMatchObject({ decidido: 2200, decision_ia: null });
    expect(reg(filaId, 2027).decision_ia_fila_id).toBeNull();

    await conIa();
    const propuesta = await decidirFila(id, filaId, 2027, { origen: "propuesta" }, ACTOR);
    expect(propuesta.respuesta).toBeNull();
    expect(propuesta.data).toMatchObject({ origen: "propuesta", decision_ia: null });
    expect(reg(filaId, 2027)).toMatchObject({ origen: "propuesta", decision_ia_fila_id: null });

    await conIa();
    const vuelve = await decidirFila(id, filaId, 2027, { decidido: null, origen: "manual" }, ACTOR);
    expect(vuelve.respuesta).toBeNull();
    expect(vuelve.data).toMatchObject({ decidido: null, origen: null, decision_ia: null });
    expect(reg(filaId, 2027)).toMatchObject({ decidido: null, origen: null, decision_ia_fila_id: null });
  });

  it("el PUT de decisión (sin opciones) la limpia igual: la ruta no pasa parámetros nuevos", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    await decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const r = await decidirFilaRuta(enviar("PUT", "/x", { decidido: 2300, origen: "manual" }), ctx(id, { filaId, anio: "2027" }));
    expect(r.status).toBe(200);
    expect((await leer<AnioFilaApi>(r)).data).toMatchObject({ decidido: 2300, decision_ia: null });
    expect(reg(filaId, 2027).decision_ia_fila_id).toBeNull();
  });

  it("una decisión que no es manual no lleva traza aunque se pida (la base la rechazaría): origen propuesta o volver con la opción dejan null", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    const a = await decidirFila(id, filaId, 2027, { origen: "propuesta" }, ACTOR, { decision_ia_fila_id: PF });
    expect(a.respuesta).toBeNull();
    expect(reg(filaId, 2027).decision_ia_fila_id).toBeNull();
    const b = await decidirFila(id, filaId, 2027, { decidido: null, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    expect(b.respuesta).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ decidido: null, origen: null, decision_ia_fila_id: null });
  });

  it("solo el registro decidido cambia de traza: decidir 2026 (B2 reescribe 2027) conserva la decisión y la traza de 2027; solo el crecimiento propio también", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    await decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const d26 = await decidirFila(id, filaId, 2026, { decidido: 1900, origen: "manual" }, ACTOR);
    expect(d26.respuesta).toBeNull();
    expect(reg(filaId, 2026).decision_ia_fila_id ?? null).toBeNull();
    expect(reg(filaId, 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF });
    // «Solo crecimiento»: la decisión no cambia, la traza sigue.
    const pct = await decidirFila(id, filaId, 2027, { crecimiento_pct: 10, origen: "manual" }, ACTOR);
    expect(pct.respuesta).toBeNull();
    expect(pct.data).toMatchObject({ crecimiento_pct: 10, decidido: 2100, decision_ia: DECISION_IA });
    expect(reg(filaId, 2027).decision_ia_fila_id).toBe(PF);
  });

  it("una fila decidida con IA no arrastra a las demás: otra fila sin traza sigue sin ella", async () => {
    const id = (await nueva()).id;
    const a = idFila(DENIM_REC);
    const b = primeraDe(N.abrigo);
    await decidirFila(id, a, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    await decidirFila(id, b, 2027, { decidido: 900, origen: "manual" }, ACTOR);
    expect(reg(a, 2027).decision_ia_fila_id).toBe(PF);
    expect(reg(b, 2027).decision_ia_fila_id ?? null).toBeNull();
  });

  it("calcular conserva la traza (y la decisión que la sostiene)", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    await decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const r = await calcular(enviar("POST", "/x", {}), ctx(id));
    expect(r.status).toBeLessThan(300);
    expect(reg(idFila(DENIM_REC), 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF });
  });

  it("copiar_de copia la traza con la decisión (apunta a la propuesta original); la fila sin traza no la gana", async () => {
    const a = (await nueva("Primera")).id;
    await decidirFila(a, idFila(DENIM_REC, a), 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const claveAbrigo = filasDe("proyeccion_filas").find((f) => f.id === primeraDe(N.abrigo, a))?.clave as string;
    await decidirFila(a, idFila(claveAbrigo, a), 2027, { decidido: 900, origen: "manual" }, ACTOR);
    const b = (await nueva("Segunda", { copiar_de: a })).id;
    expect(b).not.toBe(a);
    expect(reg(idFila(DENIM_REC, b), 2027)).toMatchObject({ decidido: 2100, origen: "manual", decision_ia_fila_id: PF });
    expect(reg(idFila(claveAbrigo, b), 2027)).toMatchObject({ decidido: 900, origen: "manual" });
    expect(reg(idFila(claveAbrigo, b), 2027).decision_ia_fila_id ?? null).toBeNull();
    // La original sigue igual.
    expect(reg(idFila(DENIM_REC, a), 2027).decision_ia_fila_id).toBe(PF);
  });
});

describe("lectura: AnioFilaApi.decision_ia", () => {
  const consulta = `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`;

  it("GET /lineas y GET /filas/[filaId]: el registro decidido con IA trae decision_ia; los demás, null", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    await decidirFila(id, filaId, 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });

    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", consulta), ctx(id)))).data;
    const fila = l.filas.find((f) => f.id === filaId)!;
    expect(fila.anios.find((a) => a.anio === 2027)?.decision_ia).toEqual(DECISION_IA);
    expect(fila.anios.find((a) => a.anio === 2026)?.decision_ia).toBeNull();
    for (const otra of l.filas.filter((f) => f.id !== filaId)) for (const a of otra.anios) expect(a.decision_ia).toBeNull();

    const d = (await leer<FilaDetalleApi>(await detalleFila(get("/f"), ctx(id, { filaId })))).data;
    expect(d.anios.find((a) => a.anio === 2027)?.decision_ia).toEqual(DECISION_IA);
    expect(d.anios.find((a) => a.anio === 2026)?.decision_ia).toBeNull();
  });

  it("sin ninguna traza la lectura no toca las tablas ia_* (la IA apagada no cuesta una consulta)", async () => {
    const id = (await nueva()).id;
    const o = observar();
    await lineas(get("/l", consulta), ctx(id));
    await detalleFila(get("/f"), ctx(id, { filaId: idFila(DENIM_REC) }));
    o.parar();
    expect(tocaIa(o.tablas)).toEqual([]);
  });

  it("con traza, la lectura solo pide esa propuesta a ia_propuestas_filas (para mostrar)", async () => {
    const id = (await nueva()).id;
    await decidirFila(id, idFila(DENIM_REC), 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const o = observar();
    await lineas(get("/l", consulta), ctx(id));
    o.parar();
    expect(tocaIa(o.tablas)).toEqual(["ia_propuestas_filas"]);
  });
});

describe("R24: M7 no depende de la IA en tiempo de ejecución", () => {
  async function decidirTodo(id: string) {
    for (const f of filasDe("proyeccion_filas").filter((x) => x.tienda_id === null && x.proyeccion_id === id)) {
      for (const anio of [2026, 2027]) {
        const a = reg(f.id as string, anio);
        if (a.propuesto !== null && (a.propuesto as number) >= 100 && a.decidido === null) {
          expect((await decidirFilaRuta(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }))).status).toBe(200);
        }
      }
    }
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
      expect((await decidirTienda(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }))).status).toBe(200);
    }
  }

  it("calcular, cerrar, matriz, mensual y cerrada no leen ni escriben tablas ia_* aunque haya trazas; la cerrada es igual con y sin esas tablas llenas", async () => {
    const id = (await nueva()).id;
    await decidirTodo(id);
    // Una fila decidida con IA (la cifra manual, con su traza) antes de cerrar.
    await decidirFila(id, idFila(DENIM_REC), 2027, { decidido: 2100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });

    const o = observar();
    expect((await calcular(enviar("POST", "/x", {}), ctx(id))).status).toBeLessThan(300);
    expect((await matriz(get("/m"), ctx(id))).status).toBe(200);
    expect((await mensual(get("/m"), ctx(id))).status).toBe(200);
    const c = await cerrar(enviar("POST", "/x", {}), ctx(id));
    expect(c.status).toBe(200);
    const conTablas = await (await cerrada(get("/cerrada", "?anio=2026"))).json();
    expect(tocaIa(o.tablas)).toEqual([]);
    o.parar();

    // Sin las tablas ia_* (vaciadas): la misma respuesta, byte a byte.
    base.tablas.ia_propuestas_gm = [];
    base.tablas.ia_propuestas_filas = [];
    const sinTablas = await (await cerrada(get("/cerrada", "?anio=2026"))).json();
    expect(sinTablas).toEqual(conTablas);
    expect(JSON.stringify(conTablas)).not.toContain("decision_ia");
  });
});

describe("R31: meta_siguiente en la Matriz (desde la foto de crecimientos, sin ia_*)", () => {
  // Solo HOMBRE es columna de la matriz de crecimientos; MUJER sigue el Resto (como en producción, donde HOMBRE y MUJER lo son: aquí se deja uno de cada para ver las dos fuentes).
  beforeEach(() => {
    base.tablas.generos = [{ id: GEN.hombre, nombre: "HOMBRE", orden: 1, activo: true }];
  });
  const nodoMundo = (r: RespuestaMatrizApi, mundo: string, genero: string) => r.nodos.find((n) => n.nivel === "mundo" && n.nombre === mundo && n.ids.genero_id === genero)!;

  it("el nodo de cada GM trae meta_gm = Σ propuesto de 2027 de sus filas (con el 5 % de la foto) y desvio_u = Σ vigente − meta; los demás nodos no la traen", async () => {
    const id = (await nueva()).id;
    const o = observar();
    const r = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data;
    o.parar();
    expect(tocaIa(o.tablas)).toEqual([]);
    const mundos = r.nodos.filter((n) => n.nivel === "mundo");
    expect(mundos.length).toBeGreaterThan(0);
    for (const n of mundos) expect(n.meta_siguiente).not.toBeUndefined();
    for (const n of r.nodos.filter((x) => x.nivel !== "mundo")) expect(n.meta_siguiente).toBeUndefined();

    const urbanoHombre = nodoMundo(r, "URBANO", GEN.hombre).meta_siguiente!;
    // HOMBRE · URBANO = la línea DENIM (todas sus agrupaciones de marca).
    const filas = filasDe("proyeccion_filas").filter((f) => f.tienda_id === null && f.gml_id === N.denim);
    const suma = (col: "propuesto" | "vigente") =>
      filas.reduce((s, f) => {
        const a = reg(f.id as string, 2027);
        return s + (a.propuesto === null ? 0 : ((col === "vigente" ? ((a.decidido ?? a.propuesto) as number) : a.propuesto) as number));
      }, 0);
    expect(urbanoHombre.meta_gm).toBe(suma("propuesto"));
    expect(urbanoHombre.desvio_u).toBe(suma("vigente") - suma("propuesto"));
    expect(urbanoHombre.fuente).toBe("gm");
    // MUJER no es columna de la matriz: su GM sigue el Resto aprobado.
    const casualMujer = nodoMundo(r, "CASUAL", GEN.mujer).meta_siguiente!;
    expect(casualMujer.fuente).toBe("resto");
    expect(casualMujer.meta_gm).toBeGreaterThan(0);
  });

  it("sin Resto aprobado la fuente es resto_provisional (el aviso meta_provisional de la IA)", async () => {
    base.tablas.crecimientos_genero_mundo = [];
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: null });
    const id = (await nueva()).id;
    const r = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data;
    expect(nodoMundo(r, "CASUAL", GEN.mujer).meta_siguiente?.fuente).toBe("resto_provisional");
    expect(nodoMundo(r, "URBANO", GEN.hombre).meta_siguiente?.fuente).toBe("gm");
  });

  it("decidir una cifra distinta mueve el desvío; aceptar la propuesta del método (la vigente = la meta) lo deja en 0", async () => {
    const id = (await nueva()).id;
    const filaId = idFila(DENIM_REC);
    const antes = nodoMundo((await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data, "URBANO", GEN.hombre).meta_siguiente!;
    expect(antes.desvio_u).toBe(0);
    const propuesto = reg(filaId, 2027).propuesto as number;
    await decidirFila(id, filaId, 2027, { decidido: propuesto + 100, origen: "manual" }, ACTOR, { decision_ia_fila_id: PF });
    const tras = nodoMundo((await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data, "URBANO", GEN.hombre).meta_siguiente!;
    expect(tras.meta_gm).toBe(antes.meta_gm);
    expect(tras.desvio_u).toBe(100);
    expect(tras.desvio_pct).toBeCloseTo((100 / antes.meta_gm) * 100, 10);
    // «Volver a la propuesta»: el desvío vuelve a 0.
    await decidirFila(id, filaId, 2027, { decidido: null, origen: "manual" }, ACTOR);
    const fin = nodoMundo((await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data, "URBANO", GEN.hombre).meta_siguiente!;
    expect(fin.desvio_u).toBe(0);
  });

  it("un filtro (aquí una línea) no recorta la meta: el GM sigue contando todas sus filas", async () => {
    const id = (await nueva()).id;
    const completa = nodoMundo((await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data, "URBANO", GEN.hombre).meta_siguiente!;
    const filtrada = (await leer<RespuestaMatrizApi>(await matriz(get("/m", `?linea_id=${LIN.denim}`), ctx(id)))).data;
    expect(nodoMundo(filtrada, "URBANO", GEN.hombre).meta_siguiente).toEqual(completa);
  });
});
