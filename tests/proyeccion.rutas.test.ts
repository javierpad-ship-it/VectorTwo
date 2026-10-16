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
import { DELETE as eliminar, GET as leerUna, PATCH as editar } from "@/app/api/proyeccion/proyecciones/[id]/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { GET as detalleFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { POST as aplicarCurva } from "@/app/api/proyeccion/proyecciones/[id]/aplicar-curva/route";
import { GET as tiendas } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { GET as filasDeTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/filas/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { GET as mensual } from "@/app/api/proyeccion/proyecciones/[id]/mensual/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { POST as archivar } from "@/app/api/proyeccion/proyecciones/[id]/archivar/route";
import { GET as leerFactores, PUT as guardarFactores } from "@/app/api/proyeccion/factores/route";
import { POST as sincronizar } from "@/app/api/proyeccion/factores/sincronizar/route";
import { GET as cerrada } from "@/app/api/proyeccion/cerrada/route";
import { construirVenta, lineaDenimValor, AG, AM, EQ, GEN, LIN, MUN, N, tiendas as tiendasFixture, vigentes } from "./proyeccion.fixture";
import type { AnioFilaApi, FilaApi, FilaDetalleApi, FactorApi, ProyeccionApi, RespuestaCerradaApi, RespuestaFilasTiendaApi, RespuestaLineasApi, RespuestaMatrizApi, RespuestaMensualApi, RespuestaProyeccionApi, RespuestaTiendasApi, TiendaProyeccionApi } from "@/lib/proyeccion/tipos-api";

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
      disponibilidad: v.disponibilidad.filter((f) => nodos.has(f.gml_id)),
      cargas: v.cargas,
    };
  };
});
afterEach(() => vi.restoreAllMocks());

describe("permisos y forma de las respuestas", () => {
  it("sin sesión 401 y comprador 403 en todas las rutas; con planner, sin caché", async () => {
    for (const rol of ["sin_sesion", "comprador"] as const) {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await estadoInicial()).status).toBe(esperado);
      expect((await crear(enviar("POST", "/proyecciones", { nombre: "x" }))).status).toBe(esperado);
      expect((await leerFactores()).status).toBe(esperado);
      expect((await sincronizar()).status).toBe(esperado);
      expect((await cerrada(get("/cerrada", "?anio=2026"))).status).toBe(esperado);
      expect((await leerUna(get("/proyecciones/x"), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await decidirTienda(enviar("PUT", "/x", {}), ctx(INEXISTENTE, { tiendaId: INEXISTENTE, anio: "2026" }))).status).toBe(esperado);
      // Cerrar, calcular, leer la matriz, editar y eliminar (las rutas más delicadas) tampoco pasan sin sesión ni con el rol de lectura.
      expect((await cerrar(enviar("POST", "/x", {}), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await calcular(enviar("POST", "/x", {}), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await matriz(get("/m"), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 0.5 } }), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await eliminar(get("/x"), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await archivar(enviar("POST", "/x", {}), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await mensual(get("/m"), ctx(INEXISTENTE))).status).toBe(esperado);
    }
    expect(base.llamadasVenta).toBe(0);
    expect(proyecciones()).toHaveLength(0);
    estadoFalso.rol = "planner";
    const r = await estadoInicial();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
  });

  it("una proyección inexistente o con id mal formado responde 404", async () => {
    expect((await leerUna(get("/proyecciones/x"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await leerUna(get("/proyecciones/x"), ctx("no-es-uuid"))).status).toBe(404);
    expect((await matriz(get("/m"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1, origen: "manual" }), ctx(INEXISTENTE, { filaId: INEXISTENTE, anio: "2026" }))).status).toBe(404);
  });
});

describe("GET /api/proyeccion (estado inicial)", () => {
  it("datos de M5, prerrequisitos sin bloqueo, bloques de hoy con las claves y los factores del Niño", async () => {
    const r = await leer<RespuestaProyeccionApi>(await estadoInicial());
    const d = r.data;
    expect(d.datos).toMatchObject({ desde: "2023-01", hasta: "2026-09", ultimo_mes_cerrado: "2026-09", meses_faltantes: [], curvas_vigentes: 3 });
    expect(d.prerrequisitos.bloquea).toEqual([]);
    expect(d.prerrequisitos.avisa.map((m) => m.codigo)).toContain("tienda_sin_venta_esperada");
    expect(d.bloques_hoy[2026].mismas.map((t) => t.codigo).sort()).toEqual(["T1", "T5", "T6"]);
    expect(d.bloques_hoy[2027].nuevas.find((t) => t.codigo === "T4")?.subbloque).toBe("aperturas");
    expect(d.bloques_hoy[2026].mismas.find((t) => t.codigo === "T1")?.clave).toBe("11111");
    expect(d.proyecciones).toEqual([]);
    expect(d.factores.map((f) => `${f.temporada}-${f.anio}`)).toEqual(["invierno-2023", "verano-2023", "invierno-2026", "verano-2026"]);
  });

  it("sin el mes 2026-05 publicado: bloquea con meses_faltantes; sin 2023-04 solo avisa", async () => {
    contexto.mesesPublicados = contexto.mesesPublicados.filter((m) => m !== "2026-05");
    const a = await leer<RespuestaProyeccionApi>(await estadoInicial());
    expect(a.data.prerrequisitos.bloquea.map((m) => m.codigo)).toEqual(["meses_faltantes"]);
    reiniciarContexto();
    contexto.mesesPublicados = contexto.mesesPublicados.filter((m) => m !== "2023-04");
    const b = await leer<RespuestaProyeccionApi>(await estadoInicial());
    expect(b.data.prerrequisitos.bloquea).toEqual([]);
    expect(b.data.prerrequisitos.avisa.map((m) => m.codigo)).toContain("meses_faltantes_anteriores");
  });
});

describe("crear y calcular", () => {
  it("201 con la proyección calculada: bloques, resumen, filas guardadas y sin candado", async () => {
    const { r, cuerpo } = await nueva();
    expect(r.status).toBe(201);
    const p = cuerpo.data;
    expect(p).toMatchObject({ anio_en_curso: 2026, anio_siguiente: 2027, estado: "en_trabajo", hasta_periodo: "2026-09", calculando: false });
    expect(p.parametros.crecimiento_pct_defecto).toBe(5);
    expect(p.bloques[2026].nuevas.map((t) => t.codigo).sort()).toEqual(["T2", "T3", "T9"]);
    expect(p.resumen?.version_metodo).toBe(3);
    expect(p.resumen?.duracion_ms).not.toBeNull();
    expect(p.desactualizada).toEqual([]);
    expect(proyecciones()[0].calculando_desde).toBeNull();
    // Filas base y de tienda con sus años; el DENIM × RECONOCIDO de 2026 vale 1 800 y el de 2027, 1 953.
    const anios = filasDe("proyeccion_fila_anios").filter((a) => a.fila_id === idFila(DENIM_REC));
    expect(anios.map((a) => [a.anio, a.propuesto])).toEqual([[2026, 1800], [2027, 1953]]);
    expect(filasDe("proyeccion_tiendas").map((t) => `${t.tienda_id}#${t.anio}`).sort()).toEqual(["T2#2026", "T3#2026", "T3#2027", "T4#2027", "T5#2027", "T7#2026", "T9#2026", "T9#2027"]);
    expect(filasDe("proyeccion_filas").every((f) => f.activo)).toBe(true);
  });

  it("409 nombre_repetido, 400 con el cuerpo inválido y 409 sin_datos sin meses publicados", async () => {
    await nueva("Mi plan");
    const dup = await crear(enviar("POST", "/proyecciones", { nombre: "mi PLAN" }));
    expect(dup.status).toBe(409);
    expect((await leer(dup)).codigo).toBe("nombre_repetido");
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "" }))).status).toBe(400);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "x", parametros: { rampa_maduracion: [9] } }))).status).toBe(400);
    contexto.mesesPublicados = [];
    const sin = await crear(enviar("POST", "/proyecciones", { nombre: "otro" }));
    expect(sin.status).toBe(409);
    expect((await leer(sin)).codigo).toBe("sin_datos");
  });

  it("409 prerrequisitos con la lista de meses faltantes (caso 21); no deja ninguna proyección a medias", async () => {
    contexto.mesesPublicados = contexto.mesesPublicados.filter((m) => m !== "2026-05");
    const r = await crear(enviar("POST", "/proyecciones", { nombre: "x" }));
    const c = await leer(r);
    expect(r.status).toBe(409);
    expect(c.codigo).toBe("prerrequisitos");
    expect(c.meses_faltantes).toEqual(["2026-05"]);
    expect(proyecciones()).toHaveLength(0);
  });

  it("409 datos_cambiaron si las tandas leen cargas distintas (caso 19) y no escribe ninguna fila", async () => {
    contexto.nodosExtra = 130; // tres tandas de 60 nodos
    const original = base.venta;
    base.venta = (args, llamada) => {
      const v = original(args, llamada) as { cargas: Record<string, string> };
      return llamada === 2 ? { ...v, cargas: { ...v.cargas, "2026-09": "otra-carga" } } : v;
    };
    const r = await crear(enviar("POST", "/proyecciones", { nombre: "x" }));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiaron");
    expect(base.llamadasVenta).toBe(3);
    expect(filasDe("proyeccion_filas")).toHaveLength(0);
    expect(proyecciones()).toHaveLength(0);
  });

  it("un error de la base al leer la venta se traduce y libera el candado", async () => {
    const { id } = await nueva();
    base.errorVenta = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await calcular(enviar("POST", `/proyecciones/${id}/calcular`), ctx(id as string));
    expect(r.status).toBe(500);
    expect((await leer(r)).error).toBe("Error inesperado en la base de datos.");
    expect(proyecciones()[0].calculando_desde).toBeNull();
  });

  it("calculando_desde reciente: PUT, calcular y PATCH responden 409 calculo_en_curso; de hace 20 minutos, calcular procede (caso 19)", async () => {
    const { id } = await nueva();
    const fila = proyecciones()[0];
    fila.calculando_desde = new Date(Date.now() - 2 * 60_000).toISOString();
    const r1 = await calcular(enviar("POST", "/x"), ctx(id as string));
    expect(r1.status).toBe(409);
    expect((await leer(r1)).codigo).toBe("calculo_en_curso");
    const r2 = await decidirFila(enviar("PUT", "/x", { decidido: 5000, origen: "manual" }), ctx(id as string, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect(r2.status).toBe(409);
    expect((await leer(r2)).codigo).toBe("calculo_en_curso");
    expect((await editar(enviar("PATCH", "/x", { nota: "hola" }), ctx(id as string))).status).toBe(409);
    expect((await leerUna(get("/x"), ctx(id as string))).status).toBe(200);
    expect((await leer<ProyeccionApi>(await leerUna(get("/x"), ctx(id as string)))).data.calculando).toBe(true);
    fila.calculando_desde = new Date(Date.now() - 20 * 60_000).toISOString();
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    expect(fila.calculando_desde).toBeNull();
  });
});

describe("Parte 1: líneas y detalle", () => {
  it("sin filtro solo el índice; con la línea trae filas, histórico por año con su red, tiendas y la prueba dentro de muestra", async () => {
    const { id } = await nueva();
    const sin = await leer<RespuestaLineasApi>(await lineas(get("/l"), ctx(id as string)));
    expect(sin.data.filas).toEqual([]);
    expect(sin.data.indice_lineas).toHaveLength(4);
    expect(sin.data.indice_lineas.every((l) => l.estado === "sin_proyectar")).toBe(true);

    const r = await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`), ctx(id as string)));
    const d = r.data;
    expect(d.filas.map((f) => f.agrupacion_marca).sort()).toEqual(["PREMIUM", "RECONOCIDO"]);
    const rec = d.filas.find((f) => f.agrupacion_marca === "RECONOCIDO") as FilaApi;
    expect(rec.anios.map((a) => [a.anio, a.vigente])).toEqual([[2026, 1800], [2027, 1953]]);
    expect(rec.anios[0].avance).toBeCloseTo(0.75, 10);
    expect(rec.anios[0].explicacion).toContain("DENIM HO v1");
    expect(d.historico_linea.map((h) => [h.anio, h.tiendas])).toEqual([[2023, 4], [2024, 4], [2025, 4], [2026, 3]]);
    expect(d.historico_linea[3].clase).toBe("en_curso");
    expect(d.tiendas_linea.map((t) => `${t.tienda}#${t.anio}`)).toEqual(["T2#2026", "T3#2026", "T7#2026", "T9#2026", "T3#2027", "T4#2027", "T5#2027", "T9#2027"]);
    expect(d.prueba_anterior?.desvio_pct).not.toBeNull();
    expect(d.totales_por_anio[0].filas).toBe(2);
    // T2 sin decidir y pasa a mismas tiendas en 2027: la base de 2027 depende de ella.
    expect(d.avisos_linea).toEqual(["tienda_nueva_sin_decidir"]);
  });

  it("detalle de la fila: histórico por mes, curva y su origen, factores y participaciones; 404 si no es de esa proyección", async () => {
    const { id } = await nueva();
    const r = await leer<FilaDetalleApi>(await detalleFila(get("/f"), ctx(id as string, { filaId: idFila(DENIM_REC) })));
    expect(r.data.curva).toHaveLength(12);
    expect(r.data.curva_origen[0]).toMatchObject({ agrupacion_id: AG.denim, version: 1 });
    expect(r.data.historico?.anios).toHaveLength(4);
    expect(r.data.historico?.anios[3].meses.slice(0, 9).every((m) => m.unidades > 0)).toBe(true);
    expect(r.data.participaciones?.por_talla.reduce((a, b) => a + b.participacion, 0)).toBeCloseTo(1, 9);
    expect(r.data.historico_anual[3]).toMatchObject({ anio: 2026, clase: "en_curso", tiendas: 3 });
    expect((await detalleFila(get("/f"), ctx(id as string, { filaId: INEXISTENTE }))).status).toBe(404);
  });
});

describe("decisiones (PUT) y B2", () => {
  it("decidir la fila base de 2026 recalcula la propuesta de 2027 en el acto; menor que lo vendido se rechaza; volver a la propuesta la limpia", async () => {
    const { id } = await nueva();
    const filaId = idFila(DENIM_REC);
    const llamadasAntes = base.llamadasVenta;
    const r = await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual", nota: "Sube por Fiestas" }), ctx(id as string, { filaId, anio: "2026" }));
    expect(r.status).toBe(200);
    const a = (await leer<AnioFilaApi>(r)).data;
    expect(a).toMatchObject({ decidido: 1900, origen: "manual", vigente: 1900, propuesto: 1800, nota: "Sube por Fiestas", decidido_por_nombre: "Javier" });
    expect(a.meses?.reduce((x, y) => x + y, 0)).toBe(1900);
    expect(base.llamadasVenta).toBe(llamadasAntes); // sin releer venta
    const reg = (anio: number) => filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaId && x.anio === anio) as Fila;
    expect(reg(2026).decidido_por_id).toBe("99999999-9999-4999-8999-999999999999");
    expect(reg(2027).propuesto).toBe(2058);

    const menor = await decidirFila(enviar("PUT", "/x", { decidido: 1000, origen: "manual" }), ctx(id as string, { filaId, anio: "2026" }));
    expect(menor.status).toBe(409);
    expect((await leer(menor)).codigo).toBe("menor_que_vendido");
    // En 2027 no hay mínimo; «aceptar la propuesta» copia lo propuesto.
    const acepta = await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId, anio: "2027" }));
    expect((await leer<AnioFilaApi>(acepta)).data).toMatchObject({ decidido: 2058, origen: "propuesta" });
    const vuelve = await decidirFila(enviar("PUT", "/x", { decidido: null }), ctx(id as string, { filaId, anio: "2026" }));
    expect((await leer<AnioFilaApi>(vuelve)).data).toMatchObject({ decidido: null, origen: null, vigente: 1800 });
    expect(reg(2027).propuesto).toBe(1953);
    expect(reg(2027).decidido).toBe(2058);
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 5, origen: "manual" }), ctx(id as string, { filaId, anio: "2030" }))).status).toBe(404);
    expect((await decidirFila(enviar("PUT", "/x", { origen: "manual" }), ctx(id as string, { filaId, anio: "2026" }))).status).toBe(400);
  });

  it("crecimiento propio de la fila: sustituye al de la proyección solo en la propuesta de 2027", async () => {
    const { id } = await nueva();
    const filaId = idFila(DENIM_REC);
    const r = await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 10 }), ctx(id as string, { filaId, anio: "2027" }));
    expect(r.status).toBe(200);
    const a = (await leer<AnioFilaApi>(r)).data;
    expect(a).toMatchObject({ crecimiento_pct: 10, propuesto: 2046, decidido: null }); // 1 860 × 1,10
    const en2026 = await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 10 }), ctx(id as string, { filaId, anio: "2026" }));
    expect(en2026.status).toBe(400);
  });

  it("decidir la tienda nueva T2 = 400 reescala sus filas y recalcula la base de 2027 (B2) sin releer venta; la línea deja de avisar", async () => {
    const { id } = await nueva();
    const antes = base.llamadasVenta;
    const r = await decidirTienda(enviar("PUT", "/x", { decidido: 400, origen: "manual", nota: "Tomo la de la tienda" }), ctx(id as string, { tiendaId: "T2", anio: "2026" }));
    expect(r.status).toBe(200);
    const c = (await leer<TiendaProyeccionApi & { filas_base_recalculadas: number }>(r)).data;
    expect(c).toMatchObject({ decidido: 400, propuesto: 300, vigente: 400, origen: "manual", pasa_a_mismas: true, nota: "Tomo la de la tienda" });
    expect(c.filas_base_recalculadas).toBeGreaterThan(0);
    expect(c.filas).toEqual([]); // las filas se piden aparte
    const filas = await leer<RespuestaFilasTiendaApi>(await filasDeTienda(get("/f", "?anio=2026"), ctx(id as string, { tiendaId: "T2" })));
    expect(filas.data.filas.reduce((s, f) => s + (f.anios[0].vigente ?? 0), 0)).toBe(400);
    expect(base.llamadasVenta).toBe(antes);
    const base2027 = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === idFila(DENIM_REC) && x.anio === 2027) as Fila;
    expect(base2027.propuesto).toBe(2058);
    const l = await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`), ctx(id as string)));
    expect(l.data.avisos_linea).toEqual([]);
    expect(l.data.tiendas_linea.find((t) => t.tienda === "T2")).toMatchObject({ vigente: 400, decidida: true });
    // Una cifra menor que lo vendido se rechaza.
    const menor = await decidirTienda(enviar("PUT", "/x", { decidido: 100, origen: "manual" }), ctx(id as string, { tiendaId: "T2", anio: "2026" }));
    expect(menor.status).toBe(409);
    // Volver a la propuesta devuelve la base de 2027 a su cifra.
    await decidirTienda(enviar("PUT", "/x", { decidido: null }), ctx(id as string, { tiendaId: "T2", anio: "2026" }));
    expect((filasDe("proyeccion_fila_anios").find((x) => x.fila_id === idFila(DENIM_REC) && x.anio === 2027) as Fila).propuesto).toBe(1953);
    expect(filasDe("proyeccion_tiendas").find((t) => t.tienda_id === "T2" && t.anio === 2026)).toMatchObject({ decidido: null, origen: null });
    expect((await decidirTienda(enviar("PUT", "/x", { decidido: 5, origen: "manual" }), ctx(id as string, { tiendaId: "T8", anio: "2026" }))).status).toBe(404);
  });

  it("cambiar la rampa de una apertura rehace su propuesta; con la venta esperada del año de apertura (0.10.1) el total en soles sigue siendo E y cambia el reparto por meses", async () => {
    const { id } = await nueva();
    const total = (await leer<RespuestaTiendasApi>(await tiendas(get("/t", "?anio=2027&bloque=nuevas"), ctx(id as string)))).data.tiendas.find((t) => t.codigo === "T4") as TiendaProyeccionApi;
    expect(total.rampa).toEqual([1, 1, 1]);
    const r = await decidirTienda(enviar("PUT", "/x", { rampa: [0.7, 0.85, 1] }), ctx(id as string, { tiendaId: "T4", anio: "2027" }));
    expect(r.status).toBe(200);
    const nuevo = (await leer<TiendaProyeccionApi>(r)).data;
    expect(nuevo.rampa).toEqual([0.7, 0.85, 1]);
    // `F` se rehace con la rampa: ninguna rampa cambia lo que la tienda vende en su año de apertura (E), solo cómo se reparte.
    expect(Math.abs((nuevo.propuesto as number) - (total.propuesto as number))).toBeLessThanOrEqual(5);
    expect(nuevo.explicacion).toContain("año de apertura");
    expect(nuevo.explicacion).toContain("de un año maduro");
    expect(nuevo.explicacion).toContain("rampa 0.70 · 0.85 · 1.00");
    // Las unidades maduras de la tarjeta se rehacen con la rampa efectiva (F cambia): coinciden con las de un cálculo completo.
    const dbT4 = () => filasDe("proyeccion_tiendas").find((t) => t.tienda_id === "T4" && t.anio === 2027) as Fila;
    const compT4 = () => filasDe("proyeccion_filas").filter((f) => f.tienda_id === "T4").map((f) => [f.clave, (f.composicion as { unidades_maduras: number }).unidades_maduras] as const).sort();
    expect(nuevo.unidades_maduras).not.toBe(total.unidades_maduras);
    expect(dbT4().unidades_maduras).toBe(nuevo.unidades_maduras);
    const md = (nuevo.unidades_maduras as number) / 1; // Σ Md_f
    expect(compT4().reduce((a, [, u]) => a + u, 0)).toBeCloseTo(md, 0);
    expect(nuevo.explicacion).toContain(`año maduro ${(nuevo.unidades_maduras as number).toLocaleString("en-US")} u`);
    const antesCalculo = { unidades: dbT4().unidades_maduras, filas: compT4() };
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    expect(dbT4().unidades_maduras).toBe(antesCalculo.unidades);
    for (const [i, [clave, u]] of compT4().entries()) {
      expect(clave).toBe(antesCalculo.filas[i][0]);
      expect(u).toBeCloseTo(antesCalculo.filas[i][1], 6);
    }
    expect(nuevo.decidido).toBeNull();
    expect((await decidirTienda(enviar("PUT", "/x", { rampa: [0] }), ctx(id as string, { tiendaId: "T4", anio: "2027" }))).status).toBe(400);
  });

  it("recalcular conserva las decisiones y las ve en propuesta_cambio si la venta cambia (caso 16)", async () => {
    const { id } = await nueva();
    const filaId = idFila(`|${N.abrigo}|${EQ.parka}|${AM.rec}`);
    await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId, anio: "2026" }));
    await decidirFila(enviar("PUT", "/x", { decidido: 1500, origen: "manual", nota: "n" }), ctx(id as string, { filaId: idFila(DENIM_REC), anio: "2026" }));
    // La venta cambia: DENIM vende más en setiembre.
    contexto.hechos = contexto.hechos.map((h) => (h.tienda === "T1" && h.nodo === "denim" && h.periodo === "2026-09" && h.marca === "m-alfa" ? { ...h, unidades: h.unidades + 120 } : h));
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    const reg = (f: string, anio: number) => filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f && x.anio === anio) as Fila;
    expect(reg(idFila(DENIM_REC), 2026)).toMatchObject({ decidido: 1500, origen: "manual", nota: "n", propuesta_al_decidir: 1800 });
    expect(reg(idFila(DENIM_REC), 2026).propuesto).not.toBe(1800);
    expect((reg(idFila(DENIM_REC), 2026).avisos as string[]).includes("propuesta_cambio")).toBe(true);
    expect(reg(filaId, 2026).decidido).toBe(1000);
  });
});

describe("la curva cambió (caso 15)", () => {
  it("recalcular con una curva v2 deja el reparto decidido y guarda el nuevo; aplicar-curva lo copia; una cerrada responde 409", async () => {
    const { id } = await nueva();
    const filaId = idFila(DENIM_REC);
    await decidirFila(enviar("PUT", "/x", { decidido: 1800, origen: "manual" }), ctx(id as string, { filaId, anio: "2026" }));
    const curvaV2 = [0.07, 0.07, 0.07, 0.08, 0.08, 0.09, 0.09, 0.09, 0.09, 0.08, 0.09, 0.1];
    contexto.vigentes = vigentes().map((v) => (v.agrupacion_id === AG.denim ? { ...v, curva_id: "c-denim-v2", version: 2, curva: curvaV2 } : v));
    const p = await leer<ProyeccionApi>(await leerUna(get("/x"), ctx(id as string)));
    expect(p.data.desactualizada.map((m) => m.codigo)).toEqual(["curvas_cambiadas"]);
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    const reg = () => filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaId && x.anio === 2026) as Fila;
    expect((reg().meses as number[]).slice(9)).toEqual([150, 150, 150]);
    expect((reg().meses_propuestos as number[]).slice(9)).toEqual([133, 150, 167]);
    expect((reg().curva_origen_usada as { version: number }[])[0].version).toBe(1);
    expect((reg().avisos as string[]).includes("curva_cambio")).toBe(true);

    const r = await aplicarCurva(enviar("POST", "/x", { gml_id: N.denim, anio: 2026 }), ctx(id as string));
    expect(r.status).toBe(200);
    expect((await leer<{ aplicadas: number }>(r)).data.aplicadas).toBeGreaterThanOrEqual(1);
    expect((reg().meses as number[]).slice(9)).toEqual([133, 150, 167]);
    expect(reg().meses_propuestos).toBeNull();
    expect((reg().curva_origen_usada as { version: number }[])[0].version).toBe(2);
    expect((reg().avisos as string[]).includes("curva_cambio")).toBe(false);
    expect((await leer(await aplicarCurva(enviar("POST", "/x", {}), ctx(id as string)))).error).toBeDefined();
    expect((await aplicarCurva(enviar("POST", "/x", {}), ctx(id as string))).status).toBe(400);
  });
});

describe("matriz y mensual (casos 13 y 14)", () => {
  it("la matriz suma sin solapes y respeta filtros; el desvío del año anterior viene en el resumen", async () => {
    const { id } = await nueva();
    const r = await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id as string)));
    const c = r.data.nodos[0];
    expect(c.en_curso.total).toBe(c.en_curso.mismas + c.en_curso.nuevas_anterior + c.en_curso.aperturas + c.en_curso.cierres);
    expect(r.data.resumen.lineas).toBe(4);
    expect(r.data.resumen.desvio_prueba_anterior_pct).not.toBeNull();
    expect(r.data.bloques[2027].mismas.map((t) => t.codigo).sort()).toEqual(["T1", "T2", "T6"]);
    const f = await leer<RespuestaMatrizApi>(await matriz(get("/m", `?genero_id=${GEN.mujer}&solo=con_tiendas_nuevas`), ctx(id as string)));
    expect(f.data.resumen.porcentaje_total).toBeLessThan(100);
    expect((await matriz(get("/m", "?solo=xx"), ctx(id as string))).status).toBe(400);
    expect((await matriz(get("/m", "?genero_id=no-es-uuid"), ctx(id as string))).status).toBe(400);
    const porAm = await leer<RespuestaMatrizApi>(await matriz(get("/m", "?por=agrupacion_marca"), ctx(id as string)));
    expect(porAm.data.nodos.some((n) => n.nivel === "agrupacion_marca")).toBe(true);
  });

  it("la mensual reparte con las curvas de M6: 150 reales ×9 y proyectados desde octubre; Σ meses = total", async () => {
    const { id } = await nueva();
    const r = await leer<RespuestaMensualApi>(await mensual(get("/m", "?bloque=mismas&por_agrupacion=1"), ctx(id as string)));
    const f = r.data.filas.find((x) => x.linea === "DENIM" && x.agrupacion_marca === "RECONOCIDO") as RespuestaMensualApi["filas"][number];
    const a = f.anios.find((x) => x.anio === 2026) as RespuestaMensualApi["filas"][number]["anios"][number];
    expect(a.meses.slice(0, 9)).toEqual(Array(9).fill(150));
    expect(a.origen_meses.slice(0, 9).every((o) => o === "real")).toBe(true);
    const todas = await leer<RespuestaMensualApi>(await mensual(get("/m"), ctx(id as string)));
    for (const fila of todas.data.filas) for (const x of fila.anios) expect(x.meses.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(x.total);
    expect((await mensual(get("/m", "?bloque=otro"), ctx(id as string))).status).toBe(400);
  });
});

describe("cierre: carrera, método viejo y auditoría (0.10.3)", () => {
  async function decidirLoGrande(id: string) {
    for (const f of filasDe("proyeccion_filas").filter((x) => x.tienda_id === null)) {
      for (const anio of [2026, 2027]) {
        const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
        if (a.propuesto !== null && (a.propuesto as number) >= 100) await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }));
      }
    }
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
      await decidirTienda(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }));
    }
  }

  it("una decisión deshecha entre la comprobación y el UPDATE de cerrar: se relee, el cierre se revierte (y el archivado) y responde 409", async () => {
    const a = await nueva("Primera");
    await decidirLoGrande(a.id as string);
    expect((await cerrar(enviar("POST", "/x", {}), ctx(a.id as string))).status).toBe(200);
    const b = await nueva("Segunda", { copiar_de: a.id });
    await decidirLoGrande(b.id as string);
    // Entre la comprobación y el UPDATE de cerrar «alguien» vuelve una fila a la propuesta (la decisión pasó su comprobación antes del cierre).
    const filaB = filasDe("proyeccion_filas").find((f) => f.proyeccion_id === b.id && f.clave === DENIM_REC) as Fila;
    base.falloDeEscritura = (tabla, modo, carga) => {
      if (tabla === "proyecciones" && modo === "update" && (carga as Fila).estado === "cerrada") {
        const reg = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaB.id && x.anio === 2027) as Fila;
        reg.decidido = null;
        reg.origen = null;
      }
      return null;
    };
    const r = await cerrar(enviar("POST", "/x", {}), ctx(b.id as string));
    base.falloDeEscritura = null;
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("filas_sin_decidir");
    expect(c.error).toContain("el cierre se deshizo");
    // La segunda sigue en trabajo (sin rastro de cierre) y la primera sigue siendo la única cerrada.
    expect(proyecciones().find((p) => p.id === b.id)).toMatchObject({ estado: "en_trabajo", cerrada_at: null, cerrada_por_nombre: null });
    expect(proyecciones().find((p) => p.id === a.id)?.estado).toBe("cerrada");
    expect(proyecciones().filter((p) => p.estado === "cerrada")).toHaveLength(1);
    // Decidida la fila, cierra y archiva a la anterior.
    await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(b.id as string, { filaId: filaB.id as string, anio: "2027" }));
    expect((await cerrar(enviar("POST", "/x", {}), ctx(b.id as string))).status).toBe(200);
    expect(proyecciones().find((p) => p.id === a.id)?.estado).toBe("archivada");
  });

  it("?forzar=1 no salta version_metodo: método viejo (o sin versión) → 409 aunque todo esté decidido; recalcular lo arregla", async () => {
    const { id } = await nueva();
    await decidirLoGrande(id as string);
    const p = proyecciones().find((x) => x.id === id) as Fila;
    const resumenBueno = p.resumen;
    const forzar = () => cerrar(new NextRequest(`${URL_BASE}/x?forzar=1`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id as string));
    p.resumen = { ...(resumenBueno as Record<string, unknown>), version_metodo: 2 };
    const vieja = await forzar();
    expect(vieja.status).toBe(409);
    expect((await leer(vieja)).codigo).toBe("version_metodo");
    const sinVersion = { ...(resumenBueno as Record<string, unknown>) };
    delete sinVersion.version_metodo;
    p.resumen = sinVersion;
    expect((await leer(await forzar())).codigo).toBe("version_metodo");
    p.resumen = null;
    expect((await leer(await forzar())).codigo).toBe("version_metodo");
    expect(p.estado).toBe("en_trabajo");
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    await decidirLoGrande(id as string);
    expect((await forzar()).status).toBe(200);
  });

  it("refrescarResumen con una foto vieja de la proyección solo pisa las claves de conteo: no deshace un resumen más nuevo", async () => {
    const { id } = await nueva();
    const vieja = structuredClone(proyecciones().find((x) => x.id === id) as Fila);
    // Otro cálculo dejó un resumen nuevo (otra huella y versión) mientras quien llama tenía la foto vieja.
    const actual = proyecciones().find((x) => x.id === id) as Fila;
    actual.resumen = { ...(actual.resumen as Record<string, unknown>), huella_cargas: "huella-nueva", duracion_ms: 4321 };
    const { refrescarResumen } = await import("@/lib/proyeccion/servicio-edicion");
    const { clienteFalso } = await import("./proyeccion.fake-db");
    await refrescarResumen(clienteFalso() as never, vieja as never);
    const r = (proyecciones().find((x) => x.id === id) as Fila).resumen as Record<string, unknown>;
    expect(r.huella_cargas).toBe("huella-nueva");
    expect(r.duracion_ms).toBe(4321);
    expect(r.version_metodo).toBe(3);
    expect((r.decididas as Record<string, number>)[2026]).toBe(0);
    // Una proyección que ya no está en trabajo no se toca.
    actual.estado = "archivada";
    const antes = JSON.stringify(actual.resumen);
    await refrescarResumen(clienteFalso() as never, vieja as never);
    expect(JSON.stringify(actual.resumen)).toBe(antes);
  });

  it("editar parámetros deja constancia de quién, cuándo y qué cambió (umbral_disponibilidad incluido); sin cambios reales no se anota", async () => {
    const { id } = await nueva();
    const p1 = await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 0.5, umbral_cola_larga: 120 } }), ctx(id as string));
    expect(p1.status).toBe(200);
    const e1 = (await leer<ProyeccionApi>(p1)).data.parametros.ediciones ?? [];
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ por: "Javier", cambios: [{ campo: "umbral_cola_larga", de: 100, a: 120 }, { campo: "umbral_disponibilidad", de: 0.75, a: 0.5 }] });
    expect(Number.isNaN(Date.parse(e1[0].en))).toBe(false);
    // Repetir los mismos valores no añade una edición; uno distinto sí, y el historial sobrevive a recalcular.
    await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 0.5 } }), ctx(id as string));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.parametros.ediciones).toHaveLength(1);
    await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 0.6 } }), ctx(id as string));
    await calcular(enviar("POST", "/x"), ctx(id as string));
    const e2 = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.parametros.ediciones ?? [];
    expect(e2.map((x) => x.cambios.map((c) => `${c.campo}:${c.de}→${c.a}`))).toEqual([["umbral_cola_larga:100→120", "umbral_disponibilidad:0.75→0.5"], ["umbral_disponibilidad:0.5→0.6"]]);
  });
});

describe("umbral de disponibilidad (0.10.1)", () => {
  it("nace en 0,75, es editable al crear y por PATCH (pide recalcular), se valida entre 0 y 1 y manda en el veredicto", async () => {
    contexto.hechos = [...contexto.hechos, ...lineaDenimValor(8)];
    const porDefecto = await nueva("Por defecto");
    expect(porDefecto.cuerpo.data.parametros).toMatchObject({ umbral_disponibilidad: 0.75, umbral_cola_larga: 100 });
    const filaValor = () => filasDe("proyeccion_filas").find((f) => f.clave === `|${N.denim}||${AM.val}`) as Fila;
    const propuesto = () => (filasDe("proyeccion_fila_anios").find((a) => a.fila_id === filaValor().id && a.anio === 2026) as Fila).propuesto;
    expect(propuesto()).toBe(144);

    // PATCH: el parámetro se guarda y marca recalculo_pendiente; al recalcular manda en el veredicto (0,667 ≥ 0,5: sin quiebre relevante).
    const p = await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 0.5 } }), ctx(porDefecto.id as string));
    expect(p.status).toBe(200);
    const editada = (await leer<ProyeccionApi>(p)).data;
    expect(editada.parametros.umbral_disponibilidad).toBe(0.5);
    expect(editada.desactualizada.map((m) => m.codigo)).toContain("recalculo_pendiente");
    expect((await calcular(enviar("POST", "/x"), ctx(porDefecto.id as string))).status).toBe(201);
    expect(propuesto()).toBe(96);

    expect((await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: 1.2 } }), ctx(porDefecto.id as string))).status).toBe(400);
    expect((await editar(enviar("PATCH", "/x", { parametros: { umbral_disponibilidad: -0.1 } }), ctx(porDefecto.id as string))).status).toBe(400);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "Otra", parametros: { umbral_disponibilidad: "alto" } }))).status).toBe(400);
    expect((await crear(enviar("POST", "/proyecciones", { nombre: "Otra", parametros: { umbral_disponibilidad: 0.4 } }))).status).toBe(201);
    expect(proyecciones().find((x) => x.nombre === "Otra")?.parametros).toMatchObject({ umbral_disponibilidad: 0.4 });
  });

  it("una proyección calculada con version_metodo 2 aparece desactualizada (version_metodo); recalcular la deja al día y conserva las decisiones", async () => {
    const { id } = await nueva();
    await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(id as string, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.desactualizada).toEqual([]);
    const p = proyecciones().find((x) => x.id === id) as Fila;
    p.resumen = { ...(p.resumen as Record<string, unknown>), version_metodo: 2 };
    const vieja = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data;
    expect(vieja.desactualizada.map((m) => m.codigo)).toEqual(["version_metodo"]);
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    const nueva_ = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data;
    expect(nueva_.desactualizada).toEqual([]);
    expect(nueva_.resumen?.version_metodo).toBe(3);
    expect(filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(DENIM_REC) && a.anio === 2026)).toMatchObject({ decidido: 1900 });
  });
});

describe("cerrar, archivar y el contrato de M8 (casos 14 y 17)", () => {
  async function decidirTodo(id: string, salvo?: string) {
    for (const f of filasDe("proyeccion_filas").filter((x) => x.tienda_id === null && x.id !== salvo)) {
      for (const anio of [2026, 2027]) {
        const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
        if (a.propuesto !== null && (a.propuesto as number) >= 100) {
          const r = await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }));
          expect(r.status).toBe(200);
        }
      }
    }
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
      const r = await decidirTienda(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }));
      expect(r.status).toBe(200);
    }
  }

  it("bloquea con filas_sin_decidir (la lista) y tiendas_sin_decidir; con todo decidido cierra y la cola larga queda con la propuesta", async () => {
    const { id } = await nueva();
    const sin = await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    const c = await leer(sin);
    expect(sin.status).toBe(409);
    expect(c.codigo).toBe("filas_sin_decidir");
    expect((c.filas_sin_decidir as { clave: string }[]).some((x) => x.clave === DENIM_REC)).toBe(true);
    expect((c.filas_sin_decidir as { clave: string }[]).some((x) => x.clave === `|${N.denim}||${AM.pre}`)).toBe(false); // propuesta 60 < 100: cola larga

    // Solo las filas (sin tiendas): bloquea por la tienda nueva con venta esperada (T4).
    for (const f of filasDe("proyeccion_filas").filter((x) => x.tienda_id === null)) {
      for (const anio of [2026, 2027]) {
        const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
        if (a.propuesto !== null && (a.propuesto as number) >= 100) await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId: f.id as string, anio: String(anio) }));
      }
    }
    const t = await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    expect(t.status).toBe(409);
    expect((await leer(t)).codigo).toBe("tiendas_sin_decidir");

    await decidirTodo(id as string);
    const ok = await cerrar(enviar("POST", "/x", { nota: "Cierre de prueba" }), ctx(id as string));
    expect(ok.status).toBe(200);
    const p = (await leer<ProyeccionApi & { archivada_id: string | null }>(ok)).data;
    expect(p).toMatchObject({ estado: "cerrada", nota: "Cierre de prueba", archivada_id: null });
    expect(proyecciones()[0].cerrada_por_nombre).toBe("Javier");
  });

  it("una cerrada de 0.10.0 (participaciones sin periodo_referencia ni por_marca) se lee con ambos en null y no se toca", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    const fila = filasDe("proyeccion_filas").find((f) => f.clave === DENIM_REC) as Fila;
    const completa = fila.participaciones as { por_clave_flujo: unknown; por_talla: unknown };
    fila.participaciones = { por_clave_flujo: completa.por_clave_flujo, por_talla: completa.por_talla };
    const c = await leer<RespuestaCerradaApi>(await cerrada(get("/cerrada", "?anio=2026")));
    const d = c.data.filas.find((f) => f.bloque === "mismas" && f.linea === "DENIM" && f.agrupacion_marca === "RECONOCIDO") as RespuestaCerradaApi["filas"][number];
    expect(d.participaciones_historicas?.periodo_referencia).toBeNull();
    expect(d.participaciones_historicas?.por_marca).toBeNull();
    expect(d.participaciones_historicas?.por_talla.length).toBeGreaterThan(0);
  });

  it("cola larga con quiebres: cerrar responde 409 filas_sin_decidir con la fila para revisión (demanda corregida y disponibilidad); decidirla deja cerrar", async () => {
    contexto.hechos = [...contexto.hechos, ...lineaDenimValor(8)];
    const { id } = await nueva();
    const filaValor = filasDe("proyeccion_filas").find((f) => f.clave === `|${N.denim}||${AM.val}`) as Fila;
    expect(filaValor).toBeDefined();
    const antes = filasDe("proyeccion_fila_anios").find((a) => a.fila_id === filaValor.id && a.anio === 2026) as Fila;
    expect(antes).toMatchObject({ propuesto: 144, referencia_alternativa: 96, metodo: "avance" });
    expect(antes.avisos).toContain("revision_cola_larga");
    expect((filaValor.historico as { cola_larga: { veredicto: string } }).cola_larga.veredicto).toBe("revision");

    // Todo lo demás decidido (lo ≥ umbral y las tiendas): solo queda la fila de revisión.
    await decidirTodo(id as string, filaValor.id as string);
    const sin = await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    const c = await leer(sin);
    expect(sin.status).toBe(409);
    expect(c.codigo).toBe("filas_sin_decidir");
    expect(c.error).toContain("cola larga con quiebres de stock");
    expect(c.total_filas_para_revision).toBe(2);
    const lista = c.filas_sin_decidir as { clave: string; anio: number; propuesto: number; motivo: string; demanda_corregida: number | null; disponibilidad: number | null; nombre: string }[];
    const y = lista.find((x) => x.clave === filaValor.clave && x.anio === 2026);
    expect(y).toMatchObject({ propuesto: 144, motivo: "revision_cola_larga", demanda_corregida: 144 });
    expect(y?.disponibilidad).toBeCloseTo(24 / 36, 3);
    expect(y?.nombre).toContain("DENIM");

    // Detalle de la fila: el registro de Y trae cola_larga y el de Y+1 no.
    const det = await leer<FilaDetalleApi>(await detalleFila(get("/f"), ctx(id as string, { filaId: filaValor.id as string })));
    expect(det.data.anios.find((a) => a.anio === 2026)?.cola_larga).toMatchObject({ veredicto: "revision", demanda_corregida: 144, tienda_meses_con_stock: 24, tienda_meses: 36 });
    expect(det.data.anios.find((a) => a.anio === 2027)?.cola_larga).toBeNull();

    // La matriz cuenta la fila y el chip «para revisión» la encuentra.
    const m = await leer<RespuestaMatrizApi>(await matriz(get("/m", "?solo=para_revision"), ctx(id as string)));
    expect(m.data.resumen.filas_para_revision).toBe(1);
    expect(m.data.nodos.filter((n) => n.nivel === "linea").map((n) => n.nombre)).toEqual(["DENIM"]);

    // El resumen refleja lo decidido: la cabecera y el modal de Cerrar leen estos conteos.
    const antesResumen = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.resumen;
    expect(antesResumen?.filas_para_revision).toBe(1);
    const decididasAntes = antesResumen?.decididas[2026] as number;
    expect(decididasAntes).toBeGreaterThan(0);

    // Aceptar la propuesta (A_f) en los dos años deja cerrar.
    for (const anio of ["2026", "2027"]) {
      expect((await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId: filaValor.id as string, anio }))).status).toBe(200);
    }
    const despuesResumen = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.resumen;
    expect(despuesResumen?.filas_para_revision).toBe(0);
    expect(despuesResumen?.decididas[2026]).toBe(decididasAntes + 1);
    // También en la lista de proyecciones del estado inicial.
    const enLista = (await leer<RespuestaProyeccionApi>(await estadoInicial())).data.proyecciones.find((x) => x.id === id);
    expect(enLista?.resumen?.filas_para_revision).toBe(0);
    // Volver a la propuesta lo deja pendiente otra vez.
    await decidirFila(enviar("PUT", "/x", { decidido: null }), ctx(id as string, { filaId: filaValor.id as string, anio: "2026" }));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id as string)))).data.resumen?.filas_para_revision).toBe(1);
    await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id as string, { filaId: filaValor.id as string, anio: "2026" }));
    expect((await cerrar(enviar("POST", "/x", {}), ctx(id as string))).status).toBe(200);
  });

  it("con quiebres pero A_f bajo el umbral la fila no bloquea: se cierra sola con la propuesta (cola_larga_con_quiebres)", async () => {
    contexto.hechos = [...contexto.hechos, ...lineaDenimValor(5)];
    const { id } = await nueva();
    await decidirTodo(id as string);
    expect((await cerrar(enviar("POST", "/x", {}), ctx(id as string))).status).toBe(200);
    const filaValor = filasDe("proyeccion_filas").find((f) => f.clave === `|${N.denim}||${AM.val}`) as Fila;
    const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === filaValor.id && x.anio === 2026) as Fila;
    expect(a).toMatchObject({ propuesto: 60, decidido: null });
    expect(a.avisos).toEqual(expect.arrayContaining(["cola_larga", "cola_larga_con_quiebres"]));
  });

  it("una cerrada es solo lectura: decidir, aplicar curva, calcular, editar y eliminar responden 409; ya cerrada no se cierra otra vez", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    expect((await cerrar(enviar("POST", "/x", {}), ctx(id as string))).status).toBe(200);
    const filaId = idFila(DENIM_REC);
    const d = await decidirFila(enviar("PUT", "/x", { decidido: 5000, origen: "manual" }), ctx(id as string, { filaId, anio: "2027" }));
    expect(d.status).toBe(409);
    expect((await leer(d)).codigo).toBe("cerrada");
    expect((await aplicarCurva(enviar("POST", "/x", { gml_id: N.denim }), ctx(id as string))).status).toBe(409);
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(409);
    expect((await editar(enviar("PATCH", "/x", { nota: "x" }), ctx(id as string))).status).toBe(409);
    expect((await eliminar(get("/x"), ctx(id as string))).status).toBe(409);
    expect((await decidirTienda(enviar("PUT", "/x", { decidido: 1, origen: "manual" }), ctx(id as string, { tiendaId: "T3", anio: "2026" }))).status).toBe(409);
    const otraVez = await cerrar(enviar("POST", "/x", {}), ctx(id as string));
    expect((await leer(otraVez)).codigo).toBe("ya_cerrada");
  });

  it("cerrar una segunda del mismo año archiva la primera; desactualizada pide ?forzar=1", async () => {
    const a = await nueva("Primera");
    await decidirTodo(a.id as string);
    await cerrar(enviar("POST", "/x", {}), ctx(a.id as string));
    const b = await nueva("Segunda", { copiar_de: a.id });
    // Lo decidido en la primera se copia a la segunda.
    expect(filasDe("proyeccion_fila_anios").filter((x) => x.decidido !== null).length).toBeGreaterThan(10);
    contexto.publicadaAt = "2099-01-01T00:00:00.000Z";
    const des = await cerrar(enviar("POST", "/x", {}), ctx(b.id as string));
    expect(des.status).toBe(409);
    expect((await leer(des)).codigo).toBe("desactualizada");
    const forzada = await cerrar(new NextRequest(`${URL_BASE}/x?forzar=1`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(b.id as string));
    expect(forzada.status).toBe(200);
    expect((await leer<ProyeccionApi & { archivada_id: string | null }>(forzada)).data.archivada_id).toBe(a.id);
    expect(proyecciones().find((p) => p.id === a.id)?.estado).toBe("archivada");
    expect(proyecciones().filter((p) => p.estado === "cerrada")).toHaveLength(1);
  });

  it("eliminar solo una en trabajo sin decisiones; archivar una en trabajo; ya archivada, 409", async () => {
    const a = await nueva("Para eliminar");
    expect((await eliminar(get("/x"), ctx(a.id as string))).status).toBe(200);
    expect(proyecciones()).toHaveLength(0);
    expect(filasDe("proyeccion_filas")).toHaveLength(0); // cascade
    const b = await nueva("Con decisiones");
    await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(b.id as string, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect((await eliminar(get("/x"), ctx(b.id as string))).status).toBe(409);
    expect((await archivar(enviar("POST", "/x", {}), ctx(b.id as string))).status).toBe(200);
    expect((await archivar(enviar("POST", "/x", {}), ctx(b.id as string))).status).toBe(409);
  });

  it("GET /cerrada: la del año, o la del año anterior con cubre = siguiente; 404 sin_cerrada; participaciones solo en las filas base", async () => {
    const { id } = await nueva();
    await decidirTodo(id as string);
    const sin = await cerrada(get("/cerrada", "?anio=2026"));
    expect(sin.status).toBe(404);
    expect((await leer(sin)).codigo).toBe("sin_cerrada");
    await cerrar(enviar("POST", "/x", {}), ctx(id as string));

    const c26 = await leer<RespuestaCerradaApi>(await cerrada(get("/cerrada", "?anio=2026")));
    expect(c26.data).toMatchObject({ anio_pedido: 2026, cubre: "en_curso" });
    expect(c26.data.proyeccion.estado).toBe("cerrada");
    const filas = c26.data.filas;
    expect(filas.every((f) => f.anio === 2026)).toBe(true);
    for (const f of filas) if (f.meses) expect(f.meses.reduce((a, b) => a + b, 0)).toBe(f.total);
    const d = filas.find((f) => f.bloque === "mismas" && f.linea === "DENIM" && f.agrupacion_marca === "RECONOCIDO") as RespuestaCerradaApi["filas"][number];
    expect(d.participaciones_historicas?.por_talla.reduce((a, b) => a + b.participacion, 0)).toBeCloseTo(1, 9);
    // 0.10.1 (decisión 24): periodo de referencia y eje por marca; cada eje suma 1.
    expect(d.participaciones_historicas?.periodo_referencia).toEqual({ desde: "2025-10", hasta: "2026-09", meses: 12, tiendas: "mismas", anio: 2026, normalizado_nino: false });
    expect(d.participaciones_historicas?.por_marca?.reduce((a, b) => a + b.participacion, 0)).toBeCloseTo(1, 9);
    expect(d.participaciones_historicas?.por_clave_flujo.reduce((a, b) => a + b.participacion, 0)).toBeCloseTo(1, 9);
    expect(d.origen_meses?.slice(0, 9).every((o) => o === "real")).toBe(true);
    expect(filas.filter((f) => f.tienda_id !== null).every((f) => f.participaciones_historicas === null)).toBe(true);
    expect(new Set(filas.map((f) => f.bloque))).toEqual(new Set(["mismas", "nuevas", "cierres"]));
    // Mismas filas que `mensual` de una proyección (total del año por bloque).
    const matrizTotal = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id as string)))).data.nodos[0].en_curso.total;
    expect(filas.reduce((a, f) => a + f.total, 0)).toBe(matrizTotal);

    const c27 = await leer<RespuestaCerradaApi>(await cerrada(get("/cerrada", "?anio=2027")));
    expect(c27.data).toMatchObject({ anio_pedido: 2027, cubre: "siguiente" });
    expect(c27.data.proyeccion.id).toBe(id);
    expect(c27.data.filas.every((f) => f.anio === 2027)).toBe(true);
    expect((await cerrada(get("/cerrada", "?anio=2028"))).status).toBe(404);
    expect((await cerrada(get("/cerrada"))).status).toBe(400);
    // Una cerrada nunca cambia: nada la recalcula.
    expect(JSON.stringify((await leer<RespuestaCerradaApi>(await cerrada(get("/cerrada", "?anio=2026")))).data.filas)).toBe(JSON.stringify(c26.data.filas));
  });
});

describe("editar parámetros y «datos hasta»", () => {
  it("PATCH marca recalculo_pendiente; recalcular lo limpia; hasta_periodo fuera del año o sin publicar se rechaza", async () => {
    const { id } = await nueva();
    const r = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_pct_defecto: 8 }, nota: "probando" }), ctx(id as string));
    expect(r.status).toBe(200);
    const p = (await leer<ProyeccionApi>(r)).data;
    expect(p.nota).toBe("probando");
    expect(p.desactualizada.map((m) => m.codigo)).toEqual(["recalculo_pendiente"]);
    expect((await calcular(enviar("POST", "/x"), ctx(id as string))).status).toBe(201);
    const q = (await leer<ProyeccionApi>(await leerUna(get("/x"), ctx(id as string)))).data;
    expect(q.desactualizada).toEqual([]);
    expect(q.parametros.crecimiento_pct_defecto).toBe(8);
    // Con 8 %: la propuesta de 2027 pasa de 1 953 a 2 009 (1 860 × 1,08).
    expect((filasDe("proyeccion_fila_anios").find((x) => x.fila_id === idFila(DENIM_REC) && x.anio === 2027) as Fila).propuesto).toBe(2009);
    expect((await editar(enviar("PATCH", "/x", { hasta_periodo: "2025-12" }), ctx(id as string))).status).toBe(400);
    expect((await editar(enviar("PATCH", "/x", { hasta_periodo: "2026-10" }), ctx(id as string))).status).toBe(400);
    expect((await editar(enviar("PATCH", "/x", {}), ctx(id as string))).status).toBe(400);
    const retrocede = await editar(enviar("PATCH", "/x", { hasta_periodo: "2026-06" }), ctx(id as string));
    expect(retrocede.status).toBe(200);
    expect((await leer<ProyeccionApi>(retrocede)).data.hasta_periodo).toBe("2026-06");
  });

  it("cambiar la rampa de la proyección la lleva a las tiendas que usaban la anterior", async () => {
    const { id } = await nueva();
    await decidirTienda(enviar("PUT", "/x", { rampa: [2, 1] }), ctx(id as string, { tiendaId: "T3", anio: "2026" }));
    await editar(enviar("PATCH", "/x", { parametros: { rampa_maduracion: [0.5, 1] } }), ctx(id as string));
    const rampas = Object.fromEntries(filasDe("proyeccion_tiendas").map((t) => [`${t.tienda_id}#${t.anio}`, t.rampa]));
    expect(rampas["T4#2027"]).toEqual([0.5, 1]); // seguía el defecto
    expect(rampas["T3#2026"]).toEqual([2, 1]); // se editó a mano
  });

  it("al recalcular conserva la rampa de la tienda editada y las demás toman la nueva", async () => {
    const { id } = await nueva();
    await decidirTienda(enviar("PUT", "/x", { rampa: [2, 1] }), ctx(id as string, { tiendaId: "T3", anio: "2026" }));
    await editar(enviar("PATCH", "/x", { parametros: { rampa_maduracion: [0.5, 1] } }), ctx(id as string));
    await calcular(enviar("POST", "/x"), ctx(id as string));
    const rampas = Object.fromEntries(filasDe("proyeccion_tiendas").map((t) => [`${t.tienda_id}#${t.anio}`, t.rampa]));
    expect(rampas["T3#2026"]).toEqual([2, 1]);
    expect(rampas["T4#2027"]).toEqual([0.5, 1]);
  });
});

describe("factores del Niño", () => {
  it("GET lista los de M6; PUT edita el aplicado (queda manual) y vuelve al calculado con null; las proyecciones quedan desactualizadas", async () => {
    const { id } = await nueva();
    const g = await leer<FactorApi[]>(await leerFactores());
    expect(g.data.find((f) => f.anio === 2026 && f.temporada === "invierno")).toMatchObject({ ratio_calculado: 0.66, ratio_efectivo: 0.66, origen: "calculado" });
    // El PUT escribe en la base falsa; el contexto falso no la lee: se refleja a mano como lo haría el contexto real.
    const r = await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.7, nota: "revisado" }] }));
    expect(r.status).toBe(200);
    expect(filasDe("factores_volumen_atipico")).toHaveLength(1);
    expect(filasDe("factores_volumen_atipico")[0]).toMatchObject({ anio: 2026, temporada: "invierno", ratio_aplicado: 0.7, nota: "revisado", usuario_nombre: "Javier" });
    contexto.factores = contexto.factores.map((f) => (f.anio === 2026 && f.temporada === "invierno" ? { ...f, ratio_aplicado: 0.7 } : f));
    const p = (await leer<ProyeccionApi>(await leerUna(get("/x"), ctx(id as string)))).data;
    expect(p.desactualizada.map((m) => m.codigo)).toEqual(["factores_cambiados"]);
    const mala = await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 4 }] }));
    expect(mala.status).toBe(400);
    const vacia = await guardarFactores(enviar("PUT", "/factores", { factores: [] }));
    expect(vacia.status).toBe(400);
  });

  it("sincronizar (POST) guarda el factor calculado por M6 de cada año atípico y temporada, marca parcial el año incompleto y no pisa lo aplicado", async () => {
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.7, nota: "mío" }] }));
    const r = await sincronizar();
    expect(r.status).toBe(200);
    const filas = filasDe("factores_volumen_atipico");
    expect(filas.map((f) => `${f.temporada}-${f.anio}`).sort()).toEqual(["invierno-2023", "invierno-2026", "verano-2023", "verano-2026"]);
    const inv26 = filas.find((f) => f.anio === 2026 && f.temporada === "invierno") as Fila;
    expect(inv26).toMatchObject({ ratio_calculado: 0.6612, ratio_aplicado: 0.7, nota: "mío", huella_cargas: "huella-de-prueba", parcial: true, tiendas_comunes: 8 });
    expect(filas.find((f) => f.anio === 2023 && f.temporada === "invierno")).toMatchObject({ ratio_calculado: 0.6321, parcial: false });
    expect(filas.find((f) => f.anio === 2026 && f.temporada === "verano")).toMatchObject({ meses_comparados: 1, parcial: true });
  });

  it("sincronizar sin meses publicados y cerrados responde 409 sin_datos", async () => {
    contexto.efectoNino = { ...(contexto.efectoNino as object), salida: null };
    const r = await sincronizar();
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_datos");
  });
});

describe("upsert: un bloque no mezcla objetos con claves distintas (PostgREST toma la unión de las columnas)", () => {
  it("agruparPorColumnas separa los juegos de claves y descarta lo undefined", async () => {
    const { agruparPorColumnas } = await import("@/lib/proyeccion/consultas");
    const grupos = agruparPorColumnas([{ a: 1, b: 2 }, { a: 3 }, { b: 4, a: 5 }, { a: 6, b: undefined }]);
    expect(grupos).toHaveLength(2);
    expect(grupos[0].map((g) => (g as { a: number }).a)).toEqual([1, 5]);
    expect(grupos[1]).toHaveLength(2);
  });

  it("recalcular no pisa la rampa editada de una tienda existente (se escribe en un upsert aparte, sin esa columna)", async () => {
    const { id } = await nueva();
    await decidirTienda(enviar("PUT", "/x", { rampa: [3, 1.5, 1] }), ctx(id as string, { tiendaId: "T4", anio: "2027" }));
    await calcular(enviar("POST", "/x"), ctx(id as string));
    expect(filasDe("proyeccion_tiendas").find((t) => t.tienda_id === "T4")?.rampa).toEqual([3, 1.5, 1]);
  });
});
