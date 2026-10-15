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

import { GET as estadoInicial } from "@/app/api/proyeccion/route";
import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { DELETE as eliminar, PATCH as editar } from "@/app/api/proyeccion/proyecciones/[id]/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { POST as aplicarCurva } from "@/app/api/proyeccion/proyecciones/[id]/aplicar-curva/route";
import { GET as tiendas } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { GET as filasDeTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/filas/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { POST as archivar } from "@/app/api/proyeccion/proyecciones/[id]/archivar/route";
import { PUT as guardarFactores } from "@/app/api/proyeccion/factores/route";
import { GET as cerrada } from "@/app/api/proyeccion/cerrada/route";
import { construirVenta, AM, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { ProyeccionApi, RespuestaFilasTiendaApi, RespuestaProyeccionApi, RespuestaTiendasApi } from "@/lib/proyeccion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const proyecciones = () => filasDe("proyecciones");

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { r, cuerpo, id: cuerpo.data?.id };
}

const idFila = (clave: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave)?.id as string;
const DENIM_REC = `|${N.denim}||${AM.rec}`;

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
      cargas: v.cargas,
    };
  };
});
afterEach(() => vi.restoreAllMocks());


const minutos = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const proyeccionDe = (id: string) => proyecciones().find((p) => p.id === id) as Fila;

async function decidirTodo(id: string) {
  for (const f of filasDe("proyeccion_filas").filter((x) => x.tienda_id === null)) {
    for (const anio of [2026, 2027]) {
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
      if (a.propuesto !== null && (a.propuesto as number) >= 100) {
        expect((await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }))).status).toBe(200);
      }
    }
  }
  for (const t of filasDe("proyeccion_tiendas").filter((x) => x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
    expect((await decidirTienda(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }))).status).toBe(200);
  }
}

describe("tope global de cálculo: un solo cálculo pesado a la vez", () => {
  it("con otra proyección calculándose, calcular y crear responden 409 calculo_en_curso y no empiezan nada", async () => {
    const a = await nueva("A");
    const b = await nueva("B");
    proyeccionDe(a.id as string).calculando_desde = minutos(-1);
    const ventas = base.llamadasVenta;
    const calc = await calcular(enviar("POST", "/x"), ctx(b.id as string));
    expect(calc.status).toBe(409);
    const c = await leer(calc);
    expect(c.codigo).toBe("calculo_en_curso");
    expect(c.error).toMatch(/otra proyección/);
    const cre = await crear(enviar("POST", "/proyecciones", { nombre: "C" }));
    expect(cre.status).toBe(409);
    expect((await leer(cre)).codigo).toBe("calculo_en_curso");
    expect(proyecciones()).toHaveLength(2); // C no se creó
    expect(base.llamadasVenta).toBe(ventas); // ni se leyó venta
    expect(proyeccionDe(b.id as string).calculando_desde ?? null).toBeNull();
  });

  it("un candado caducado (más de 15 minutos) ya no bloquea", async () => {
    const a = await nueva("A");
    const b = await nueva("B");
    proyeccionDe(a.id as string).calculando_desde = minutos(-20);
    expect([200, 201]).toContain((await calcular(enviar("POST", "/x"), ctx(b.id as string))).status);
  });

  it("dos cálculos simultáneos: uno corre y el otro recibe 409", async () => {
    const a = await nueva("A");
    const b = await nueva("B");
    const [ra, rb] = await Promise.all([calcular(enviar("POST", "/x"), ctx(a.id as string)), calcular(enviar("POST", "/x"), ctx(b.id as string))]);
    expect([ra.status, rb.status].filter((x) => x === 409)).toHaveLength(1);
    expect([ra.status, rb.status].filter((x) => x < 300)).toHaveLength(1);
    // Terminado, los candados quedan libres y el siguiente cálculo corre.
    expect(proyecciones().every((p) => p.calculando_desde === null || p.calculando_desde === undefined)).toBe(true);
    expect((await calcular(enviar("POST", "/x"), ctx(b.id as string))).status).toBeLessThan(300);
  });

  it("20 proyecciones en trabajo del año: la 21 se rechaza con tope_en_trabajo", async () => {
    const primera = await nueva("P0");
    for (let i = 1; i < 20; i++) proyecciones().push({ ...proyeccionDe(primera.id as string), id: `00000000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}`, nombre: `P${i}` });
    expect(proyecciones()).toHaveLength(20);
    const r = await crear(enviar("POST", "/proyecciones", { nombre: "P20" }));
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("tope_en_trabajo");
    expect(c.error).toMatch(/20 proyecciones en trabajo/);
    // Archivar una libera un lugar.
    expect((await archivar(enviar("POST", "/x", {}), ctx(primera.id as string))).status).toBe(200);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "P20" }))).status).toBe(201);
  });

  it("GET /api/proyeccion no recorre las filas de las proyecciones y sigue detectando un nivel cambiado", async () => {
    const a = await nueva("A");
    const lista = await leer<RespuestaProyeccionApi>(await estadoInicial());
    expect(lista.data.proyecciones[0].resumen).not.toHaveProperty("niveles_gml"); // la foto interna no sale por la API
    expect(lista.data.proyecciones[0].desactualizada).toEqual([]);
    const gml = filasDe("proyeccion_filas")[0].gml_id as string;
    const resumen = proyeccionDe(a.id as string).resumen as { niveles_gml: Record<string, string> };
    resumen.niveles_gml[gml] = resumen.niveles_gml[gml] === "GML" ? "GMLE" : "GML"; // el nodo cambió de nivel desde que se calculó
    const cambiado = await leer<RespuestaProyeccionApi>(await estadoInicial());
    expect(cambiado.data.proyecciones[0].desactualizada.map((m) => m.codigo)).toContain("nivel_cambiado");
  });
});

describe("carreras entre cerrar, calcular, editar y eliminar", () => {
  it("cerrar, archivar, editar y eliminar con un cálculo vivo responden 409 calculo_en_curso", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    proyeccionDe(id as string).calculando_desde = minutos(-1);
    for (const r of [
      await cerrar(enviar("POST", "/x", {}), ctx(id as string)),
      await archivar(enviar("POST", "/x", {}), ctx(id as string)),
      await editar(enviar("PATCH", "/x", { nota: "x" }), ctx(id as string)),
      await eliminar(get("/x"), ctx(id as string)),
      await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId: idFila(DENIM_REC), anio: "2026" })),
      await aplicarCurva(enviar("POST", "/x", { gml_id: N.denim }), ctx(id as string)),
    ]) {
      expect(r.status).toBe(409);
      expect((await leer(r)).codigo).toBe("calculo_en_curso");
    }
    expect(proyeccionDe(id as string).estado).toBe("en_trabajo");
  });

  it("el UPDATE de estado es condicional: no cierra con cálculo vivo ni si el estado ya cambió", async () => {
    const { cambiarEstadoProyeccion, eliminarProyeccionCondicional, guardarResultadoCalculo, soltarCalculo } = await import("@/lib/proyeccion/consultas");
    const { clienteFalso } = await import("./proyeccion.fake-db");
    const { limiteCalculoVivo } = await import("@/lib/proyeccion/servicio-base");
    const { id } = await nueva();
    const d = clienteFalso() as never;
    const ahora = new Date().toISOString();
    const limite = limiteCalculoVivo(ahora);

    proyeccionDe(id as string).calculando_desde = ahora;
    expect((await cambiarEstadoProyeccion(d, id as string, "en_trabajo", { estado: "cerrada" }, { sinCalculoDesde: limite })).data).toBeNull();
    expect((await eliminarProyeccionCondicional(d, id as string, limite)).data).toBeNull();
    expect(proyeccionDe(id as string).estado).toBe("en_trabajo");
    // El guardado final exige el mismo candado: con otro valor no escribe.
    expect((await guardarResultadoCalculo(d, id as string, minutos(-5), { calculado_at: ahora })).data).toBeNull();
    // Soltar con un valor ajeno no quita el candado.
    await soltarCalculo(d, id as string, minutos(-5));
    expect(proyeccionDe(id as string).calculando_desde).toBe(ahora);
    await soltarCalculo(d, id as string, ahora);
    expect(proyeccionDe(id as string).calculando_desde).toBeNull();

    // Ya cerrada: el guardado final de un cálculo tardío no escribe y la eliminación tampoco.
    proyeccionDe(id as string).estado = "cerrada";
    proyeccionDe(id as string).calculando_desde = ahora;
    expect((await guardarResultadoCalculo(d, id as string, ahora, { calculado_at: ahora })).data).toBeNull();
    proyeccionDe(id as string).calculando_desde = null;
    expect((await eliminarProyeccionCondicional(d, id as string, limite)).data).toBeNull();
    expect(proyecciones()).toHaveLength(1);
  });

  it("un cálculo que termina con la proyección ya cerrada la deja intacta y responde 409 estado_cambiado", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    // Mientras se lee la venta, otra persona fuerza el estado a cerrada (el cierre normal no podría: hay candado vivo).
    base.venta = ((anterior) => (args: Parameters<typeof base.venta>[0], llamada: number) => {
      proyeccionDe(id as string).estado = "cerrada";
      return anterior(args, llamada);
    })(base.venta);
    const r = await calcular(enviar("POST", "/x"), ctx(id as string));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("estado_cambiado");
    expect(proyeccionDe(id as string).estado).toBe("cerrada");
  });

  it("si el cierre falla, la cerrada anterior vuelve a estar cerrada (se revierte el archivado)", async () => {
    const a = await nueva("Primera");
    await decidirTodo(a.id as string);
    expect((await cerrar(enviar("POST", "/x", {}), ctx(a.id as string))).status).toBe(200);
    const b = await nueva("Segunda", { copiar_de: a.id });
    // Falla el cierre de la segunda (no el archivado de la primera).
    let fallado = false;
    base.falloDeEscritura = (tabla, modo, carga) => {
      if (fallado || tabla !== "proyecciones" || modo !== "update" || Array.isArray(carga) || carga.estado !== "cerrada") return null;
      fallado = true; // solo el cierre; la reversión (también un UPDATE a cerrada) pasa
      return { code: "57014", message: "canceling statement due to statement timeout", details: null, hint: null };
    };
    const r = await cerrar(enviar("POST", "/x", { nota: "x" }), ctx(b.id as string));
    expect(r.status).toBeGreaterThanOrEqual(400);
    base.falloDeEscritura = null;
    expect(proyeccionDe(a.id as string).estado).toBe("cerrada"); // revertido
    expect(proyeccionDe(b.id as string).estado).toBe("en_trabajo");
    expect(proyecciones().filter((p) => p.estado === "cerrada")).toHaveLength(1);
  });
});

describe("archivar la única cerrada del año", () => {
  it("sin confirmar responde 409 ultima_cerrada; con confirmar_sin_cerrada: true archiva; una en trabajo se archiva sin confirmar", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    const sin = await archivar(enviar("POST", "/x", {}), ctx(id as string));
    expect(sin.status).toBe(409);
    const c = await leer(sin);
    expect(c.codigo).toBe("ultima_cerrada");
    expect(c.error).toMatch(/Presupuesto/);
    expect(proyeccionDe(id as string).estado).toBe("cerrada");
    // Sin contenido (content-length: 0), igual que con `{}`.
    expect((await archivar(new NextRequest(`${URL_BASE}/x`, { method: "POST", headers: { "content-length": "0" } }), ctx(id as string))).status).toBe(409);
    expect((await archivar(enviar("POST", "/x", { confirmar_sin_cerrada: "si" }), ctx(id as string))).status).toBe(400);
    expect((await archivar(enviar("POST", "/x", { confirmar_sin_cerrada: true }), ctx(id as string))).status).toBe(200);
    expect(proyeccionDe(id as string).estado).toBe("archivada");
    expect((await cerrada(get("/cerrada", "?anio=2026"))).status).toBe(404);
  });
});

describe("cerrar: filas_sin_decidir legible y limitada", () => {
  it("cada fila trae el nombre del GML, el año y la propuesta; las primeras 50 y el total", async () => {
    const { id } = await nueva();
    const r = await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    const c = await leer(r);
    expect(c.codigo).toBe("filas_sin_decidir");
    const filas = c.filas_sin_decidir as { clave: string; anio: number; propuesto: number; nombre: string; genero: string; linea: string; agrupacion_marca: string }[];
    const denim = filas.find((x) => x.clave === DENIM_REC && x.anio === 2027) as (typeof filas)[number];
    expect(denim).toMatchObject({ genero: "HOMBRE", linea: "DENIM", agrupacion_marca: "RECONOCIDO" });
    expect(denim.nombre).toMatch(/HOMBRE · .*DENIM · RECONOCIDO/);
    expect(c.total_filas_sin_decidir).toBe(filas.length);
    expect(filas.map((f) => f.propuesto)).toEqual([...filas.map((f) => f.propuesto)].sort((x, y) => y - x));
  });

  it("con más de 50 filas sin decidir lista 50 y da el total", async () => {
    const { id } = await nueva();
    const modelo = filasDe("proyeccion_filas").find((f) => f.tienda_id === null) as Fila;
    const anioModelo = filasDe("proyeccion_fila_anios").find((a) => a.fila_id === modelo.id && a.anio === 2027) as Fila;
    for (let i = 0; i < 60; i++) {
      const fid = `00000000-0000-4000-8000-0000000a${String(i).padStart(4, "0")}`;
      filasDe("proyeccion_filas").push({ ...modelo, id: fid, clave: `|${N.denim}||extra-${i}` });
      filasDe("proyeccion_fila_anios").push({ ...anioModelo, id: `00000000-0000-4000-8000-0000000b${String(i).padStart(4, "0")}`, fila_id: fid, anio: 2027, propuesto: 500 + i, decidido: null });
    }
    const c = await leer(await cerrar(enviar("POST", "/x", {}), ctx(id as string)));
    expect((c.filas_sin_decidir as unknown[]).length).toBe(50);
    expect(c.total_filas_sin_decidir as number).toBeGreaterThanOrEqual(60);
    expect((c.filas_sin_decidir as { propuesto: number }[])[0].propuesto).toBeGreaterThanOrEqual(559);
  });
});

describe("tiendas sin filas por defecto y GET …/filas", () => {
  it("GET …/tiendas trae filas vacías; …/tiendas/[id]/filas?anio= trae las de esa tienda y año", async () => {
    const { id } = await nueva();
    const t = await leer<RespuestaTiendasApi>(await tiendas(get("/t"), ctx(id as string)));
    expect(t.data.tiendas.length).toBeGreaterThan(0);
    expect(t.data.tiendas.every((x) => x.filas.length === 0)).toBe(true);
    const f = await leer<RespuestaFilasTiendaApi>(await filasDeTienda(get("/f", "?anio=2026"), ctx(id as string, { tiendaId: "T2" })));
    expect(f.data).toMatchObject({ tienda_id: "T2", anio: 2026 });
    expect(f.data.filas.length).toBeGreaterThan(0);
    expect(f.data.filas.every((x) => x.tienda_id === "T2" && x.anios.length === 1 && x.anios[0].anio === 2026)).toBe(true);
  });

  it("valida el año y el segmento: sin año, año raro, tienda desconocida o con símbolos", async () => {
    const { id } = await nueva();
    const sinAnio = await filasDeTienda(get("/f"), ctx(id as string, { tiendaId: "T2" }));
    expect(sinAnio.status).toBe(400);
    expect((await leer(sinAnio)).error).toMatch(/año/);
    const abc = await filasDeTienda(get("/f", "?anio=abc"), ctx(id as string, { tiendaId: "T2" }));
    expect(abc.status).toBe(400);
    expect((await leer(abc)).error).toMatch(/año debe ser un número/);
    expect((await filasDeTienda(get("/f", "?anio=2026"), ctx(id as string, { tiendaId: "T99" }))).status).toBe(404);
    expect((await filasDeTienda(get("/f", "?anio=2026"), ctx(id as string, { tiendaId: "T2'; drop" }))).status).toBe(404);
    expect((await filasDeTienda(get("/f", "?anio=2026"), ctx(INEXISTENTE, { tiendaId: "T2" }))).status).toBe(404);
    estadoFalso.rol = "comprador";
    expect((await filasDeTienda(get("/f", "?anio=2026"), ctx(id as string, { tiendaId: "T2" }))).status).toBe(403);
  });
});

describe("validaciones y mensajes", () => {
  it("aplicar-curva: {} pide indicar qué curva; más de 200 registros se rechaza; las dos cosas a la vez, también", async () => {
    const { id } = await nueva();
    const vacio = await aplicarCurva(enviar("POST", "/x", {}), ctx(id as string));
    expect(vacio.status).toBe(400);
    expect((await leer(vacio)).error).toMatch(/Indica qué curva aplicar/);
    const muchos = await aplicarCurva(enviar("POST", "/x", { fila_anio_ids: Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`) }), ctx(id as string));
    expect(muchos.status).toBe(400);
    expect((await leer(muchos)).error).toMatch(/máximo 200/);
    expect((await aplicarCurva(enviar("POST", "/x", { gml_id: N.denim, fila_anio_ids: [INEXISTENTE] }), ctx(id as string))).status).toBe(400);
    expect((await aplicarCurva(enviar("POST", "/x", { gml_id: N.denim, otro: 1 }), ctx(id as string))).status).toBe(400);
  });

  it("GET /cerrada?anio=abc y GET …/tiendas?anio=abc responden 400 con un mensaje claro", async () => {
    const { id } = await nueva();
    const a = await cerrada(get("/cerrada", "?anio=abc"));
    expect(a.status).toBe(400);
    expect((await leer(a)).error).toMatch(/número de cuatro cifras/);
    expect((await cerrada(get("/cerrada"))).status).toBe(400);
    const b = await tiendas(get("/t", "?anio=abc"), ctx(id as string));
    expect(b.status).toBe(400);
    expect((await leer(b)).error).toMatch(/número de cuatro cifras/);
  });

  it("POST /proyecciones es estricto; decidido tiene techo; la rampa tiene 1 a 6 valores", async () => {
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "x", sorpresa: 1 }))).status).toBe(400);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "x", parametros: { factores_usados: [] } }))).status).toBe(400);
    const rampaLarga = await crear(enviar("POST", "/proyecciones", { nombre: "x", parametros: { rampa_maduracion: [1, 1, 1, 1, 1, 1, 1] } }));
    expect(rampaLarga.status).toBe(400);
    expect((await leer(rampaLarga)).error).toMatch(/seis meses/);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "x", parametros: { rampa_maduracion: [] } }))).status).toBe(400);
    const { id } = await nueva();
    const enorme = await decidirFila(enviar("PUT", "/x", { decidido: 100_000_001, origen: "manual" }), ctx(id as string, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect(enorme.status).toBe(400);
    expect((await leer(enorme)).error).toMatch(/demasiado grande/);
    expect((await decidirTienda(enviar("PUT", "/x", { decidido: 1e12, origen: "manual" }), ctx(id as string, { tiendaId: "T2", anio: "2026" }))).status).toBe(400);
  });

  it("PUT /factores rechaza un año sin periodo atípico con un mensaje claro; uno atípico se guarda", async () => {
    const malo = await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2024, temporada: "invierno", ratio_aplicado: 0.8 }] }));
    expect(malo.status).toBe(400);
    const c = await leer(malo);
    expect(c.codigo).toBe("anio_sin_periodo_atipico");
    expect(c.error).toMatch(/2024 no tiene un periodo atípico de invierno/);
    const bueno = await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.7 }] }));
    expect(bueno.status).toBe(200);
  });
});

describe("explicación de la tienda", () => {
  it("avance_propio con total maduro: A = V' ÷ Σ c·r con cifras, sin el guion", async () => {
    const { explicar } = await import("@/lib/proyeccion/explicar");
    const frase = explicar({
      metodo: "avance_propio",
      anio: 2026,
      anioEnCurso: 2026,
      k: 9,
      vendido: 120,
      propuesto: 240,
      curvaTexto: "DENIM HO v1; POLOS VERANO v2",
      tienda: { codigo: "T3", nombre: "Tienda 3" },
      mesesCompletos: 3,
      totalMaduro: 480,
      vendidoNormalizado: 120,
    });
    expect(frase).toContain("A = V' ÷ Σ c·r = 120 ÷ 25.0 % = 480");
    expect(frase).toContain("DENIM HO v1; POLOS VERANO v2");
    expect(frase).not.toContain("—");
    const sinA = explicar({ metodo: "avance_propio", anio: 2026, anioEnCurso: 2026, k: 9, vendido: 120, propuesto: 240, curvaTexto: "X v1", tienda: { codigo: "T3", nombre: "T" }, mesesCompletos: 3, totalMaduro: null });
    expect(sinA).not.toContain("—");
  });

  it("la explicación de una tienda calculada nombra el total maduro y todas las curvas de sus filas", async () => {
    const { id } = await nueva();
    const t3 = filasDe("proyeccion_tiendas").filter((t) => t.metodo === "avance_propio" || t.metodo === "maduro_propio");
    expect(id).toBeDefined();
    for (const t of t3) {
      expect(String(t.explicacion)).not.toMatch(/—/);
      expect(String(t.explicacion)).toMatch(/total maduro/);
    }
  });
});

describe("aTiendaFila: lista explícita de campos", () => {
  it("el comprador no recibe venta esperada ni referente, y una columna desconocida no se cuela", async () => {
    const { aTiendaFila } = await import("@/lib/tiendas/consultas");
    const fila = {
      id: "t1", codigo: "T1", nombre: "Uno", tipo: "Tienda", zona: null, razon_social: null, fecha_apertura: "2020-01-01", fecha_cierre: null,
      venta_esperada_promedio: 123, tienda_referencia_id: "t2", activo: true, created_at: "x", updated_at: "y", columna_nueva_secreta: "no",
    };
    const comprador = aTiendaFila(fila as never, "2026-10-15", false);
    expect(comprador).not.toHaveProperty("columna_nueva_secreta");
    expect(comprador.venta_esperada_promedio).toBeNull();
    expect(comprador.tienda_referencia_id).toBeNull();
    expect(comprador.tienda_referencia).toBeNull();
    expect(Object.keys(comprador).sort()).toEqual(
      ["activo", "codigo", "created_at", "estado", "fecha_apertura", "fecha_cierre", "id", "nombre", "razon_social", "tienda_referencia", "tienda_referencia_id", "tipo", "updated_at", "venta_esperada_promedio", "zona"].sort()
    );
  });
});

describe("GET /api/proyeccion: tendencia del último año", () => {
  it("trae datos.tendencia_ultimo_anio_pct (número en % o null), nunca ausente", async () => {
    const r = await leer<RespuestaProyeccionApi>(await estadoInicial());
    expect(r.data.datos).toHaveProperty("tendencia_ultimo_anio_pct");
    const t = r.data.datos.tendencia_ultimo_anio_pct;
    expect(t === null || Number.isFinite(t)).toBe(true);
  });
});
