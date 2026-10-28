import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, PERFILES, escenario, eventosDe, llamadasA, publicarMes, reiniciarEscenario, tablaDe } from "./compras.fake-db";

// Los módulos de la base y de las fuentes se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./compras.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso: cliente } = await import("./compras.fake-db");
  return { supabaseAdmin: () => cliente() };
});
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerCerradaParaFlujo: async (anio: number) => ({ data: falso.cerradaFalsa(anio), respuesta: null }) };
});
vi.mock("@/lib/marcas-barrer/servicio", async (original) => {
  const real = await original<typeof import("@/lib/marcas-barrer/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerRepartosVigentes: async () => ({ data: falso.repartosVigentesFalsos(), respuesta: null }) };
});
vi.mock("@/lib/intercompany/servicio", async (original) => {
  const real = await original<typeof import("@/lib/intercompany/servicio")>();
  const falso = await import("./compras.fake-db");
  return {
    ...real,
    leerVigentes: async () => {
      falso.escenario.lecturas.reglas += 1;
      return { data: { reglas: [], marcas: [] }, respuesta: null };
    },
  };
});
vi.mock("@/lib/marcas/gml/estado", async () => {
  const falso = await import("./compras.fake-db");
  return {
    cargarEstadoGml: async () => {
      falso.escenario.lecturas.configuracion += 1;
      return { error: null, ...falso.estadoGmlFalso() };
    },
  };
});
vi.mock("@/lib/arbol/consultas", async (original) => {
  const real = await original<typeof import("@/lib/arbol/consultas")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerEquivalencias: async () => ({ data: falso.equivalenciasDelEscenario(), error: null }) };
});
vi.mock("@/lib/responsables/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return {
    leerAsignaciones: async () => ({ data: falso.escenario.asignaciones.map((a, i) => ({ id: `asig-${i}`, ...a })), error: null }),
    leerPerfiles: async () => ({ data: Object.values(falso.PERFILES).map((p) => ({ id: p.id, nombre: p.nombre, email: p.email, rol: p.rol, activo: true })), error: null }),
  };
});
vi.mock("@/lib/tiendas/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return { leerTiendas: async () => ({ data: falso.tiendasFalsas(), error: null }) };
});
vi.mock("@/lib/proyeccion/contexto", async () => ({
  cargarContextoCalculo: async () => ({ data: { nodos: [], vigentes: [], agrupaciones: [], periodosClase: [], factores: [], hastaDefecto: "2026-09" }, respuesta: null }),
}));

import { GET as flujo } from "@/app/api/flujo/route";
import { GET as filaDetalle } from "@/app/api/flujo/fila/route";
import { GET as huecos } from "@/app/api/flujo/huecos/route";
import { GET as conciliacion } from "@/app/api/flujo/conciliacion/route";
import { POST as aceptar } from "@/app/api/flujo/conciliacion/aceptar/route";
import { GET as leerParametros, PUT as guardarParametros } from "@/app/api/flujo/parametros/route";
import { GET as listaCompras } from "@/app/api/compras/route";
import { GET as unaCompra } from "@/app/api/compras/[id]/route";
import { GET as historial } from "@/app/api/compras/[id]/historial/route";
import { POST as recibir } from "@/app/api/compras/[id]/recibir/route";
import { POST as cancelar } from "@/app/api/compras/[id]/cancelar/route";
import { DELETE as quitarRecepcion } from "@/app/api/compras/[id]/recepciones/[recepcionId]/route";
import { GET as proveedores } from "@/app/api/compras/proveedores/route";
import { POST as importar } from "@/app/api/compras/importar/route";
import { contadores, reiniciarCaches } from "@/lib/flujo/cache";
import { reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { cargarContextoBarrer } from "@/lib/marcas-barrer/servicio";
import { aTotalesApi, armarConciliacionApi, calcularFlujo, type NombresFlujo } from "@/lib/flujo/modelo";
import { obtenerFlujo, totalesDeFilas } from "@/lib/flujo/servicio";
import { TAMANO_FLUJO_TIPICO, TAMANO_HUECOS_MAXIMO } from "@/lib/flujo/tipos";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ConciliacionApi, FilaFlujoDetalleApi, FlujoApi, HuecosApi, ParametrosFlujoApi, RespuestaAceptarApi } from "@/lib/flujo/tipos-api";
import type { CompraApi, EventoCompraApi, ProveedorApi, ReporteImportacionComprasApi } from "@/lib/compras/tipos-api";
import { AGR_M8, COMPRA, EQ, GEN, LIN, LINEA, MARCA_M8, MUN, NODO_M8, PROVEEDOR, filasImportacionEjemplo } from "./compras.fixture";
import { REGLA_JH, cerradaDeFila, entrada, mapaDeStock, participaciones, stockMes } from "./flujo.soporte";
import { resolverTarjeta } from "./flujo.fixture";

/**
 * Handlers de M8 con el servicio REAL y una base en memoria (`tests/compras.fake-db.ts`; la `0025` está aplicada en Vector2 solo a medias,
 * así que nada de aquí depende de ella): permisos (401 y 403), forma de las respuestas, la pertenencia de ids (regla 30), «Aceptar
 * sugerencia» (regla 23), la caché por huella (regla 24), la concurrencia (regla 25), cancelar cerrando el saldo (regla 31), la
 * auditoría (17b) y el importador por clave natural (reglas 18 y 28). La base falsa aplica las funciones de escritura con los espejos
 * puros de `src/lib/compras`; el humo de SQL (regla 20) lo prueba la base.
 */

const URL_BASE = "http://localhost/api";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const borrar = (ruta: string) => new NextRequest(`${URL_BASE}${ruta}`, { method: "DELETE" });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const comoComprador = (quien: "comprador1" | "comprador2" = "comprador1") => {
  escenario.usuario = { rol: "comprador", perfil: PERFILES[quien] };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  reiniciarEscenario();
  reiniciarCaches();
  reiniciarCacheCatalogo();
});
afterEach(() => {
  vi.useRealTimers();
});


// ─── Atajos ───

const ESCRITURAS = ["registrar_recepciones", "quitar_recepcion", "cancelar_compra", "importar_compra"];
const escrituras = () => escenario.llamadas.filter((l) => ESCRITURAS.includes(l.nombre));
const idCompra = (numero: string) => (tablaDe("compras").find((c) => c.numero === numero)?.id as string) ?? INEXISTENTE;
const compraDe = (id: string) => tablaDe("compras").find((c) => c.id === id);
const revisionDe = (id: string) => Number(compraDe(id)?.revision);
const C12 = COMPRA.c12;
const C09 = COMPRA.c09;
const C08 = IDS.compraC08;
const hoyRecepcion = { fecha_recepcion: "2026-10-15" };
const NODO_URBANO_MUNDO = MUN.urbano;

function unico<T>(xs: readonly T[], descripcion: string): T {
  if (xs.length !== 1) throw new Error(`se esperaba una ${descripcion} y hay ${xs.length}`);
  return xs[0];
}
type FilaLista = FlujoApi["filas"][number];
const filaDe = (f: FlujoApi, gml: string, agrupacion: string): FilaLista => unico(f.filas.filter((x) => x.gml_id === gml && x.agrupacion_marca_id === agrupacion), "fila");
const denim = (f: FlujoApi) => filaDe(f, NODO_M8.urbano, AGR_M8.reconocido);
const polo = (f: FlujoApi) => filaDe(f, NODO_M8.polo, AGR_M8.premium);
const leerFlujoHttp = async (consulta = "") => {
  const r = await flujo(get("/flujo", consulta));
  return { r, cuerpo: await leer<FlujoApi>(r) };
};

const recibirC12 = async (recepciones: unknown[], revision = revisionDe(C12), id = C12) => {
  const r = await recibir(enviar("POST", `/compras/${id}/recibir`, { revision, recepciones }), ctx(id));
  return { r, cuerpo: await leer<CompraApi>(r) };
};
const ingresoC12 = (unidades: number, periodo = "2026-10") => ({ linea_id: LINEA.c12, recibida_periodo: periodo, unidades, ...hoyRecepcion });

// ─── Permisos y forma de las respuestas (regla 17 de M8) ───

describe("permisos: sesión (401), comprador solo lee (403 en toda escritura)", () => {
  const lecturas = () => [
    () => flujo(get("/flujo")),
    () => huecos(get("/flujo/huecos")),
    () => filaDetalle(get("/flujo/fila", `?gml_id=${NODO_M8.urbano}&agrupacion_marca_id=${AGR_M8.reconocido}`)),
    () => conciliacion(get("/flujo/conciliacion")),
    () => leerParametros(),
    () => listaCompras(get("/compras")),
    () => unaCompra(get(`/compras/${C12}`), ctx(C12)),
    () => historial(get(`/compras/${C12}/historial`), ctx(C12)),
    () => proveedores(),
  ];
  const escriben = () => [
    () => guardarParametros(enviar("PUT", "/flujo/parametros", {})),
    () => aceptar(enviar("POST", "/flujo/conciliacion/aceptar", {})),
    () => recibir(enviar("POST", `/compras/${C12}/recibir`, {}), ctx(C12)),
    () => quitarRecepcion(borrar(`/compras/${C12}/recepciones/${IDS.recepcionC08}?revision=1`), ctx(C12, { recepcionId: IDS.recepcionC08 })),
    () => cancelar(enviar("POST", `/compras/${C12}/cancelar`, {}), ctx(C12)),
    () => importar(enviar("POST", "/compras/importar", {})),
  ];

  it("sin sesión: 401 en las quince rutas y no llega a la base", async () => {
    escenario.usuario = { rol: "sin_sesion", perfil: PERFILES.planner };
    for (const f of [...lecturas(), ...escriben()]) expect((await f()).status).toBe(401);
    expect(escenario.llamadas).toEqual([]);
  });

  it("el comprador lee todo (200) y toda escritura responde 403 sin llamar a ninguna función de la base", async () => {
    comoComprador();
    for (const f of lecturas()) expect((await f()).status).toBe(200);
    const antes = escenario.llamadas.length;
    for (const f of escriben()) expect((await f()).status).toBe(403);
    expect(escrituras()).toEqual([]);
    expect(escenario.llamadas.length).toBe(antes);
    expect(tablaDe("flujo_parametros")).toEqual([]);
  });

  it("las respuestas no se guardan en caché y GET /api/flujo no trae ninguna cifra en soles", async () => {
    comoComprador();
    const r = await flujo(get("/flujo"));
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const texto = await r.text();
    expect(texto).not.toMatch(/venta_soles|costo_vendido/);
  });

  it("sin cerrada: 404 sin_cerrada; sin meses publicados: 404 sin_mes; las compras siguen funcionando sin el flujo", async () => {
    escenario.sinCerrada = true;
    const r = await flujo(get("/flujo"));
    expect(r.status).toBe(404);
    expect((await leer(r)).codigo).toBe("sin_cerrada");
    const lista = await listaCompras(get("/compras"));
    expect(lista.status).toBe(200);
    const compras = (await leer<CompraApi[]>(lista)).data;
    expect(compras).toHaveLength(4);
    // sin flujo no hay sugerencias, pero la entrega vencida se ve igual (k' sale de las cargas publicadas)
    const c09 = unico(compras.filter((c) => c.id === C09), "compra");
    expect(c09.lineas[0].entregas[0].sugerencia).toBeNull();
    expect(c09.lineas[0].entregas[0].vencida).toBe(true);

    reiniciarEscenario();
    reiniciarCaches();
    escenario.tablas.cargas_venta_stock = [];
    escenario.publicados = [];
    const sinMes = await flujo(get("/flujo"));
    expect(sinMes.status).toBe(404);
    expect((await leer(sinMes)).codigo).toBe("sin_mes");
  });
});

describe("GET /api/flujo", () => {
  it("el caso 1: DENIM × RECONOCIDO con IMI 4,4, saldo 83 en oct y 378 en seis meses; la cabecera avisa lo que hay por confirmar", async () => {
    const { r, cuerpo } = await leerFlujoHttp();
    expect(r.status).toBe(200);
    const { datos } = cuerpo.data;
    expect(datos.k_prima).toBe("2026-09");
    expect(datos.horizonte).toEqual({ desde: "2026-10", hasta: "2027-12" });
    expect(datos.periodos).toHaveLength(16);
    expect(datos.cerrada.version_metodo).toBe(4);
    expect(datos.avisos).toEqual(["entregas_sin_confirmar"]);
    expect(datos.por_confirmar).toEqual({ entregas: 1, unidades: 500, con_respaldo_entregas: 1, con_respaldo_unidades: 500 });

    const f = denim(cuerpo.data);
    expect(f.serie.stock.slice(0, 3)).toEqual([700, 550, 900]);
    expect(f.serie.imi[0]).toBe(4.4);
    expect(f.serie.saldo[1]).toBe(83);
    expect(f.serie.saldo[5]).toBe(134);
    expect(f.serie.ingresos.slice(0, 3)).toEqual([120, 0, 500]);
    expect(f.resumen).toMatchObject({ senal: "falta", saldo_n_meses: 378, en_camino: 500 });
    // la lista no trae lo que solo usan el detalle y las tarjetas
    expect(Object.keys(f.resumen).sort()).toEqual(["en_camino", "imi_k", "por_confirmar", "posible_doble_conteo", "saldo_n_meses", "senal", "vpm_k"]);
    expect(f.serie.saldo.findIndex((x) => x > 0)).toBe(1);
    expect(datos.periodos[1]).toBe("2026-10");
    expect(cuerpo.data).not.toHaveProperty("repartos_vigentes");
    expect(cuerpo.data).not.toHaveProperty("reglas_intercompany");
    expect(f.stock_k).toEqual({ cd: 300, tiendas: 400, total: 700 });
    expect(f.serie.senal).toHaveLength(16);
  });

  it("el catálogo trae los nombres una sola vez (con la línea) y las filas solo ids; el tamaño cabe en el presupuesto", async () => {
    const { r, cuerpo } = await leerFlujoHttp();
    const f = denim(cuerpo.data);
    expect(f).not.toHaveProperty("genero");
    expect(f).not.toHaveProperty("meses");
    expect(cuerpo.data.catalogo.nodos[NODO_M8.urbano]).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", linea_id: LIN.denim, nivel: "GML" });
    expect(cuerpo.data.catalogo.agrupaciones[AGR_M8.reconocido]).toBe("RECONOCIDO");
    expect(cuerpo.data.catalogo.responsables[`${GEN.hombre}|${NODO_URBANO_MUNDO}`]).toMatchObject({ perfil_id: PERFILES.comprador1.id, nombre: "Comprador Uno" });
    expect(JSON.stringify(cuerpo).length).toBeLessThan(TAMANO_FLUJO_TIPICO);
    expect(r.status).toBe(200);
  });

  it("los filtros viajan al servidor y los totales siguen al filtro", async () => {
    const todo = await leerFlujoHttp();
    expect(todo.cuerpo.data.filas).toHaveLength(4);
    expect(todo.cuerpo.data.totales.stock[0]).toBe(1640);

    const linea = await leerFlujoHttp(`?linea_id=${LIN.denim}&agrupacion_marca_id=${AGR_M8.reconocido}`);
    expect(linea.cuerpo.data.filas.map((x) => x.gml_id)).toEqual([NODO_M8.urbano]);
    expect(linea.cuerpo.data.totales.stock.slice(0, 3)).toEqual([700, 550, 900]);
    expect(linea.cuerpo.data.catalogo.nodos[NODO_M8.urbano]).toBeDefined();
    expect(Object.keys(linea.cuerpo.data.catalogo.nodos)).toHaveLength(1);

    const falta = await leerFlujoHttp("?solo=falta");
    expect(falta.cuerpo.data.filas.map((x) => x.gml_id)).toEqual([NODO_M8.urbano]);
    const exceso = await leerFlujoHttp("?solo=exceso");
    expect(exceso.cuerpo.data.filas.map((x) => x.gml_id)).toEqual([NODO_M8.polo]);
    const porConfirmar = await leerFlujoHttp("?solo=por_confirmar");
    expect(porConfirmar.cuerpo.data.filas.map((x) => x.gml_id)).toEqual([NODO_M8.polo]);
    const tres = await leerFlujoHttp("?meses=3");
    expect(denim(tres.cuerpo.data).resumen.saldo_n_meses).toBe(83);
    const mujer = await leerFlujoHttp(`?genero_id=${GEN.mujer}`);
    expect(mujer.cuerpo.data.filas.map((x) => x.gml_id)).toEqual([NODO_M8.sandalia]);
  });

  it("valida la consulta con zod: 400 en castellano", async () => {
    for (const q of ["?solo=cualquiera", "?meses=0", "?meses=40", "?genero_id=no-es-uuid", "?mio=quizas"]) {
      const r = await flujo(get("/flujo", q));
      expect(r.status, q).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
  });

  it("«Mis líneas» es un filtro: el comprador con HOMBRE × URBANO ve lo suyo marcado; el planner sin combinaciones, vacío", async () => {
    comoComprador("comprador1");
    const { cuerpo } = await leerFlujoHttp();
    expect(cuerpo.data.mis_combinaciones).toHaveLength(1);
    expect(denim(cuerpo.data).mia).toBe(true);
    expect(polo(cuerpo.data).mia).toBe(false);
    const mias = await leerFlujoHttp("?mio=1");
    expect(mias.cuerpo.data.filas.every((x) => x.mia)).toBe(true);
    expect(mias.cuerpo.data.filas.map((x) => x.gml_id)).toContain(NODO_M8.urbano);

    escenario.usuario = { rol: "planner", perfil: PERFILES.planner };
    const sin = await leerFlujoHttp("?mio=1");
    expect(sin.cuerpo.data.mis_combinaciones).toEqual([]);
    expect(sin.cuerpo.data.filas).toEqual([]);
    // el resultado cacheado se comparte, pero la marca `mia` es de cada quien
    expect(contadores.calculos).toBe(1);
  });

  it("los totales de todas las filas son los que calcula el cálculo completo (la misma aritmética)", async () => {
    const f = await obtenerFlujo(supabaseAdmin());
    if (f.respuesta) throw new Error("no se pudo calcular");
    const n = f.data.resultado.periodos.length - 1;
    expect(aTotalesApi(totalesDeFilas(f.data.resultado.filas, n, f.data.resultado.parametros))).toEqual(aTotalesApi(f.data.resultado.totales));
  });
});

describe("GET /api/flujo/huecos", () => {
  it("una tarjeta por fila, por saldo descendente; con meses=1 sigue trayendo la cabecera completa", async () => {
    const r = await huecos(get("/flujo/huecos", "?meses=1"));
    const { data } = await leer<HuecosApi>(r);
    expect(r.status).toBe(200);
    expect(data.meses).toBe(1);
    expect(data.datos.parametros.meses_tarjeta).toBe(6);
    expect(data.datos.periodos).toHaveLength(16);
    expect(data.datos.avisos).toContain("entregas_sin_confirmar");
    const saldos = data.tarjetas.map((t) => t.resumen.saldo_n_meses);
    expect(saldos).toEqual([...saldos].sort((a, b) => b - a));
    const tarjeta = unico(data.tarjetas.filter((t) => { const r = resolverTarjeta(data, t); return r.gml_id === NODO_M8.urbano && r.agrupacion_marca_id === AGR_M8.reconocido; }), "tarjeta");
    expect(tarjeta.resumen.saldo_n_meses).toBe(83);
    expect(tarjeta.resumen.primer_mes_falta).toBe("2026-10");
    expect(tarjeta).not.toHaveProperty("gml_id");
    expect(resolverTarjeta(data, tarjeta)).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", agrupacion_marca: "RECONOCIDO" });
    expect(tarjeta.detalle).toMatchObject({ saldo_primer_mes: 83, en_camino_primer_mes: { periodo: "2026-11", unidades: 500 } });
    expect(JSON.stringify(data).length).toBeLessThan(TAMANO_HUECOS_MAXIMO);
  });

  it("sin meses usa los de Parámetros; con meses=3 el saldo de seis meses baja", async () => {
    const seis = (await leer<HuecosApi>(await huecos(get("/flujo/huecos")))).data;
    expect(seis.meses).toBe(6);
    expect(seis.tarjetas.find((t) => resolverTarjeta(seis, t).gml_id === NODO_M8.urbano)?.resumen.saldo_n_meses).toBe(378);
    expect(unico(seis.tarjetas.filter((t) => resolverTarjeta(seis, t).gml_id === NODO_M8.polo), "tarjeta").resumen.por_confirmar).toBe(500);
  });
});

describe("GET /api/flujo/fila", () => {
  it("el detalle trae la historia de doce meses, la conciliación con revisión y las entregas pendientes", async () => {
    const r = await filaDetalle(get("/flujo/fila", `?gml_id=${NODO_M8.polo}&agrupacion_marca_id=${AGR_M8.premium}`));
    const { data } = await leer<FilaFlujoDetalleApi>(r);
    expect(r.status).toBe(200);
    expect(data.historia).toHaveLength(12);
    expect(data.historia[11]).toMatchObject({ periodo: "2026-09", venta: 820, stock_fin: 940, ingreso_inferido: 800 });
    expect(data.conciliacion).toHaveLength(12);
    const set = unico(data.conciliacion.filter((c) => c.periodo === "2026-09"), "fila de set");
    expect(set).toMatchObject({ ingreso_inferido: 800, recepciones_registradas: 300, sin_registrar: 500 });
    expect(set.sugerencias[0]).toMatchObject({ compra_numero: "C-000009", unidades: 500, tipo: "vencida", boton: true, revision: 1 });
    // la entrega vencida de C-000009 y las tres del lote de BETA (C-000020) que caen en esta fila
    expect(data.entregas.map((e) => e.numero)).toEqual(["C-000009", "C-000020", "C-000020", "C-000020"]);
    expect(data.entregas[0]).toMatchObject({ pendiente: 500, vencida: true, estado: "confirmada", periodo: "2026-09" });
    expect(data.entregas.slice(1).every((e) => !e.vencida && e.tipo === "barrer_marca")).toBe(true);
    expect(data.avisos).toEqual(expect.arrayContaining(["entregas_vencidas", "posible_doble_conteo"]));
  });

  it("una fila que no existe: 404 fila_no_encontrada; faltan datos: 400", async () => {
    const r = await filaDetalle(get("/flujo/fila", `?gml_id=${INEXISTENTE}&agrupacion_marca_id=${AGR_M8.premium}`));
    expect(r.status).toBe(404);
    expect((await leer(r)).codigo).toBe("fila_no_encontrada");
    expect((await filaDetalle(get("/flujo/fila", `?gml_id=${NODO_M8.polo}`))).status).toBe(400);
  });
});

describe("GET /api/flujo/conciliacion", () => {
  it("sin periodo, el último mes publicado: ingreso inferido, recepciones, entregas y la sugerencia con su botón", async () => {
    const r = await conciliacion(get("/flujo/conciliacion"));
    const { data } = await leer<ConciliacionApi>(r);
    expect(r.status).toBe(200);
    expect(data.periodo).toBe("2026-09");
    expect(data.mes_anterior_publicado).toBe(true);
    expect(data.filas.map((x) => x.ruta)).toEqual(["HOMBRE · CASUAL · POLO", "HOMBRE · URBANO · DENIM"]);
    const p = data.filas[0];
    expect(p).toMatchObject({ stock_inicio: 960, stock_fin: 940, venta: 820, ingreso_inferido: 800, recepciones_registradas: 300, entregas_programadas: 800, sin_registrar: 500, sin_respaldo: 0 });
    expect(p.avisos).toEqual(["ingreso_sin_registrar"]);
    expect(p.sugerencias).toHaveLength(1);
    const d = data.filas[1];
    expect(d).toMatchObject({ ingreso_inferido: 120, sin_registrar: 120, sugerencias: [] });
    expect(data.totales).toMatchObject({ venta: 2230, ingreso_inferido: 920, sin_registrar: 620 });
    expect(data.avisos).toEqual([{ aviso: "ingreso_sin_registrar", filas: 2, unidades: null }]);
  });

  it("los chips y los filtros: por confirmar, mes anterior, árbol y «mis líneas»", async () => {
    const por = (await leer<ConciliacionApi>(await conciliacion(get("/flujo/conciliacion", "?solo=por_confirmar")))).data;
    expect(por.filas.map((x) => x.gml_id)).toEqual([NODO_M8.polo]);
    const sin = (await leer<ConciliacionApi>(await conciliacion(get("/flujo/conciliacion", "?solo=sin_respaldo")))).data;
    expect(sin.filas).toEqual([]);
    const linea = (await leer<ConciliacionApi>(await conciliacion(get("/flujo/conciliacion", `?linea_id=${LIN.denim}`)))).data;
    expect(linea.filas.map((x) => x.gml_id)).toEqual([NODO_M8.urbano]);
    const ago = (await leer<ConciliacionApi>(await conciliacion(get("/flujo/conciliacion", "?periodo=2026-08")))).data;
    expect(ago.filas.every((x) => x.sugerencias.length === 0)).toBe(true);
    expect(ago.filas.find((x) => x.gml_id === NODO_M8.urbano)).toMatchObject({ stock_fin: 1990, ingreso_inferido: 0 });
    const mias = (await leer<ConciliacionApi>(await conciliacion(get("/flujo/conciliacion", "?mio=1")))).data;
    expect(mias.filas).toEqual([]);
  });

  it("un periodo que no es de los doce últimos publicados: 404 sin_mes", async () => {
    for (const periodo of ["2025-01", "2025-09", "2026-10", "2027-01"]) {
      const r = await conciliacion(get("/flujo/conciliacion", `?periodo=${periodo}`));
      expect(r.status, periodo).toBe(404);
      expect((await leer(r)).codigo).toBe("sin_mes");
    }
    expect((await conciliacion(get("/flujo/conciliacion", "?periodo=sep-2026"))).status).toBe(400);
  });

  it("nunca escribe: no llama a ninguna función de escritura", async () => {
    await conciliacion(get("/flujo/conciliacion"));
    expect(escrituras()).toEqual([]);
    expect(eventosDe(C09)).toEqual([]);
  });
});

describe("parámetros y temporadas (M12 las lee de aquí)", () => {
  const valores = (cambio: Record<string, unknown> = {}) => ({
    imi_min: 3,
    imi_max: 6,
    meses_tarjeta: 6,
    extender_horizonte: true,
    temporadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
    umbral_conciliacion_u: 10,
    umbral_conciliacion_pct: 20,
    ...cambio,
  });

  it("GET sin fila devuelve los valores por defecto (4–8, seis meses, temporadas de siempre)", async () => {
    comoComprador();
    const { data } = await leer<ParametrosFlujoApi>(await leerParametros());
    expect(data).toMatchObject({ imi_min: 4, imi_max: 8, meses_tarjeta: 6, extender_horizonte: true, umbral_conciliacion_u: 10, umbral_conciliacion_pct: 20, usuario_nombre: null, updated_at: null });
    expect(data.temporadas.verano).toEqual({ desde_mes: 10, hasta_mes: 3 });
  });

  it("PUT del planner guarda a su nombre; DENIM deja de tener falta en octubre con IMI mínimo 3 (caso 14)", async () => {
    const antes = await leerFlujoHttp();
    expect(denim(antes.cuerpo.data).serie.saldo[1]).toBe(83);
    const r = await guardarParametros(enviar("PUT", "/flujo/parametros", valores()));
    const { data } = await leer<ParametrosFlujoApi>(r);
    expect(r.status).toBe(200);
    expect(data).toMatchObject({ imi_min: 3, imi_max: 6, usuario_nombre: "Planner Uno" });
    expect(data.updated_at).not.toBeNull();
    expect(tablaDe("flujo_parametros")).toHaveLength(1);
    const despues = await leerFlujoHttp();
    expect(despues.cuerpo.data.datos.parametros.imi_min).toBe(3);
    expect(denim(despues.cuerpo.data).serie.saldo[1]).toBe(0);
    expect(despues.cuerpo.data.datos.huella).not.toBe(antes.cuerpo.data.datos.huella);
    // un segundo PUT reemplaza la misma fila
    await guardarParametros(enviar("PUT", "/flujo/parametros", valores({ imi_min: 5 })));
    expect(tablaDe("flujo_parametros")).toHaveLength(1);
  });

  it("rechaza lo inválido con 400 en castellano: máximo menor que el mínimo, temporadas que se solapan o no cubren el año", async () => {
    for (const cuerpo of [
      valores({ imi_min: 8, imi_max: 6 }),
      valores({ temporadas: { verano: { desde_mes: 10, hasta_mes: 4 }, invierno: { desde_mes: 4, hasta_mes: 9 } } }),
      valores({ temporadas: { verano: { desde_mes: 10, hasta_mes: 2 }, invierno: { desde_mes: 4, hasta_mes: 9 } } }),
      valores({ meses_tarjeta: 0 }),
      valores({ umbral_conciliacion_pct: 120 }),
    ]) {
      const r = await guardarParametros(enviar("PUT", "/flujo/parametros", cuerpo));
      expect(r.status).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
    expect(tablaDe("flujo_parametros")).toEqual([]);
  });

  it("M12 toma las fechas de temporada de Parámetros (y el defecto si no hay fila)", async () => {
    const d = supabaseAdmin();
    const antes = await cargarContextoBarrer(d);
    if (antes.respuesta) throw new Error("no se pudo armar el contexto");
    expect(antes.data.temporadas.verano).toEqual({ desde_mes: 10, hasta_mes: 3 });
    await guardarParametros(enviar("PUT", "/flujo/parametros", valores({ temporadas: { verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } } })));
    const despues = await cargarContextoBarrer(d);
    if (despues.respuesta) throw new Error("no se pudo armar el contexto");
    expect(despues.data.temporadas).toEqual({ verano: { desde_mes: 11, hasta_mes: 4 }, invierno: { desde_mes: 5, hasta_mes: 10 } });
  });
});

// ─── Compras: lectura ───

describe("GET /api/compras y detalle", () => {
  const lista = async (consulta = "") => (await leer<CompraApi[]>(await listaCompras(get("/compras", consulta)))).data;
  const numeros = (cs: CompraApi[]) => cs.map((c) => c.numero).sort();

  it("la lista trae líneas y entregas con el pendiente, lo vencido y la sugerencia de la conciliación; el historial va vacío", async () => {
    const cs = await lista();
    expect(numeros(cs)).toEqual(["C-000008", "C-000009", "C-000012", "C-000020"]);
    const c09 = unico(cs.filter((c) => c.numero === "C-000009"), "compra");
    expect(c09.lineas[0].entregas[0]).toMatchObject({ periodo: "2026-09", unidades: 500, pendiente: 500, vencida: true, sugerencia: { periodo: "2026-09", unidades: 500 } });
    expect(c09.lineas[0].avisos).toContain("entrega_vencida");
    expect(c09.avisos).toContain("entrega_vencida");
    expect(c09.historial).toEqual([]);
    expect(c09.proveedor).toMatchObject({ nombre: "Feria Sur", es_intercompany: false });
    expect(c09.creada_por.nombre).toBe("Planner Uno");
    const c12 = unico(cs.filter((c) => c.numero === "C-000012"), "compra");
    expect(c12.lineas[0]).toMatchObject({ ruta: "HOMBRE · URBANO · DENIM", marca: "ALFA", tallas: "centrales", llegada_periodo: "2026-11", unidades_recibidas: 0 });
    expect(c12).toMatchObject({ estado: "confirmada", saldo_cerrado: false, revision: 3, referencia: "PO-2211", totales: { unidades: 500, costo: 19000, recibidas: 0 }, llegadas: { desde: "2026-11", hasta: "2026-11", entregas: 1 } });
    const c08 = unico(cs.filter((c) => c.numero === "C-000008"), "compra");
    expect(c08.lineas[0].recepciones[0]).toMatchObject({ unidades: 300, recibida_periodo: "2026-09", avisos: ["recepcion_en_mes_cerrado"] });
  });

  it("un lote muestra su reparto guardado por entrega, con la temporada y si sigue siendo el vigente de M12", async () => {
    const c20 = unico((await lista()).filter((c) => c.numero === "C-000020"), "compra");
    const l = c20.lineas[0];
    expect(l).toMatchObject({ tipo: "barrer_marca", ruta: null, marca: "BETA", alcance: { generos: [], mundos: [], lineas: [] } });
    expect(l.reparto?.vigente).toBe(true);
    expect(l.reparto?.version).toBe(2);
    expect(l.reparto?.por_entrega).toHaveLength(3);
    expect(l.reparto?.por_entrega[0].temporada).toBe("verano");
    expect(l.reparto?.filas.map((f) => f.unidades)).toEqual([590, 292, 118]);
    expect(l.reparto?.filas[0]).toMatchObject({ marca: "BETA", ruta: "HOMBRE · URBANO · DENIM" });
    expect(l.entregas.every((e) => e.temporada === "verano")).toBe(true);
    expect(l.avisos).toEqual([]);

    for (const r of tablaDe("compra_linea_repartos")) r.reparto_id = "20000000-0000-4000-8000-0000000000ff";
    const cambiado = unico((await lista()).filter((c) => c.numero === "C-000020"), "compra").lineas[0];
    expect(cambiado.reparto?.vigente).toBe(false);
    expect(cambiado.avisos).toContain("reparto_cambio");
  });

  it("filtros: por confirmar, estado, proveedor, texto, marca, línea, mes de llegada y «mis líneas»", async () => {
    expect(numeros(await lista("?por_confirmar=1"))).toEqual(["C-000009"]);
    expect(numeros(await lista("?estado=recibida"))).toEqual(["C-000008"]);
    expect(numeros(await lista(`?proveedor_id=${PROVEEDOR.feria}`))).toEqual(["C-000009", "C-000020"]);
    expect(numeros(await lista("?q=feria"))).toEqual(["C-000009", "C-000020"]);
    expect(numeros(await lista("?q=PO-2211"))).toEqual(["C-000012"]);
    expect(numeros(await lista(`?marca_id=${MARCA_M8.beta}`))).toEqual(["C-000020"]);
    expect(numeros(await lista(`?linea_id=${LIN.polo}`))).toEqual(["C-000008", "C-000009", "C-000020"]);
    expect(numeros(await lista("?llegada_desde=2026-12&llegada_hasta=2027-02"))).toEqual(["C-000020"]);
    expect(numeros(await lista("?origen=carga_inicial"))).toEqual([]);
    comoComprador("comprador1");
    expect(numeros(await lista("?mio=1"))).toEqual(["C-000012", "C-000020"]);
    comoComprador("comprador2");
    expect(numeros(await lista("?mio=1"))).toEqual([]);
    expect((await listaCompras(get("/compras", "?estado=perdida"))).status).toBe(400);
  });

  it("el detalle trae el historial y lo que puede cada rol (el comprador no puede nada en M8)", async () => {
    const { data } = await leer<CompraApi>(await unaCompra(get(`/compras/${C12}`), ctx(C12)));
    expect(data).toMatchObject({ numero: "C-000012", revision: 3, historial: [], puede: { editar: false, confirmar: false, recibir: true, cancelar: true, aplicar_reparto: false } });
    comoComprador();
    const c = (await leer<CompraApi>(await unaCompra(get(`/compras/${C12}`), ctx(C12)))).data;
    expect(c.puede).toEqual({ editar: false, confirmar: false, recibir: false, cancelar: false, aplicar_reparto: false });
    expect(c.mia).toBe(true);
  });

  it("una compra que no existe o un id mal formado: 404 con mensaje en castellano", async () => {
    const r = await unaCompra(get(`/compras/${INEXISTENTE}`), ctx(INEXISTENTE));
    expect(r.status).toBe(404);
    expect((await leer(r)).codigo).toBe("compra_no_encontrada");
    const mal = await unaCompra(get("/compras/xyz"), ctx("xyz"));
    expect(mal.status).toBe(404);
    expect((await leer(mal)).error).toBe("No encontramos esa compra.");
    expect((await historial(get(`/compras/${INEXISTENTE}/historial`), ctx(INEXISTENTE))).status).toBe(404);
  });

  it("los proveedores traen sus compras no canceladas y ningún contacto (llegan con M9a)", async () => {
    const { data } = await leer<ProveedorApi[]>(await proveedores());
    expect(data.map((p) => [p.nombre, p.compras, p.contactos.length])).toEqual([
      ["Feria Sur", 2, 0],
      ["Proveedor Norte", 2, 0],
    ]);
  });
});

// ─── Compras: confirmar ingreso, quitarlo y cancelar ───

describe("POST /api/compras/[id]/recibir («Confirmar ingreso»)", () => {
  it("registra el ingreso con la función de la base: revisión, pendientes FIFO, evento a nombre de quien lo hace y el flujo lo recoge", async () => {
    const r = await recibirC12([ingresoC12(200)]);
    expect(r.r.status, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo.data).toMatchObject({ estado: "confirmada", revision: 4 });
    const l = r.cuerpo.data.lineas[0];
    expect(l.unidades_recibidas).toBe(200);
    expect(l.entregas[0]).toMatchObject({ asignadas: 200, pendiente: 300 });
    expect(l.recepciones).toEqual([expect.objectContaining({ unidades: 200, recibida_periodo: "2026-10", origen: "manual", usuario_nombre: "Planner Uno", avisos: [] })]);
    expect(r.cuerpo.data.modificada_por?.nombre).toBe("Planner Uno");

    const args = unico(llamadasA("registrar_recepciones"), "llamada").args;
    expect(args).toMatchObject({ p_revision: 3, p_actor: { perfil_id: PERFILES.planner.id, nombre: "Planner Uno" } });
    expect((args.p_recepciones as { recibida_periodo: string }[])[0].recibida_periodo).toBe("2026-10-01");

    const eventos = eventosDe(C12);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ accion: "recibir", usuario_nombre: "Planner Uno" });
    // el flujo: 200 en oct (llegaron, el stock de oct aún no se publica) y 300 pendientes en nov
    const f = denim((await leerFlujoHttp()).cuerpo.data);
    expect(f.serie.ingresos.slice(1, 3)).toEqual([200, 300]);
  });

  it("los avisos de la recepción: mes cerrado (no suma al flujo, la conciliación la contrasta), futura y la que no tiene respaldo en el inventario", async () => {
    const cerrado = await recibirC12([{ linea_id: LINEA.c09, recibida_periodo: "2026-08", unidades: 100, ...hoyRecepcion }], revisionDe(C09), C09);
    expect(cerrado.r.status).toBe(200);
    expect(cerrado.cuerpo.data.lineas[0].recepciones[0].avisos).toEqual(["recepcion_en_mes_cerrado"]);
    // la respuesta de la escritura trae la sugerencia de la conciliación (pasa por el flujo, igual que el GET de la compra)
    expect(cerrado.cuerpo.data.lineas[0].entregas[0].sugerencia).toMatchObject({ periodo: "2026-09" });
    const futura = await recibirC12([ingresoC12(50, "2026-12")]);
    expect(futura.cuerpo.data.lineas[0].recepciones[0].avisos).toEqual(["recibida_futura"]);
    // en el flujo, lo de mes cerrado no suma (los 100 de ago ya están en el stock publicado); los 50 de dic sí
    const f = polo((await leerFlujoHttp()).cuerpo.data);
    expect(f.serie.ingresos[1]).toBe(400);
  });

  it("pertenencia (regla 30): una línea de otra compra → 404 no_pertenece, sin tocar la base ni escribir evento", async () => {
    const r = await recibirC12([{ ...ingresoC12(100), linea_id: LINEA.c09 }]);
    expect(r.r.status).toBe(404);
    expect(r.cuerpo.codigo).toBe("no_pertenece");
    expect(escrituras()).toEqual([]);
    expect(eventosDe(C12)).toEqual([]);
    expect(eventosDe(C09)).toEqual([]);
    expect(compraDe(C09)?.revision).toBe(1);
  });

  it("los 409 con su código: compra_cambio, excede_pendiente, recepcion_antes_de_compra y no_editable", async () => {
    const vieja = await recibirC12([ingresoC12(100)], 1);
    expect(vieja.r.status).toBe(409);
    expect(vieja.cuerpo.codigo).toBe("compra_cambio");
    const exceso = await recibirC12([ingresoC12(600)]);
    expect(exceso.r.status).toBe(409);
    expect(exceso.cuerpo.codigo).toBe("excede_pendiente");
    expect(exceso.cuerpo.error).toContain("500");
    const antes = await recibirC12([ingresoC12(100, "2026-09")]);
    expect(antes.r.status).toBe(409);
    expect(antes.cuerpo.codigo).toBe("recepcion_antes_de_compra");
    expect(antes.cuerpo.error).toContain("oct-2026");
    expect(escrituras()).toEqual([]);

    const cancelada = await cancelar(enviar("POST", `/compras/${C12}/cancelar`, { motivo: "No se hará", revision: 3 }), ctx(C12));
    expect(cancelada.status).toBe(200);
    const sobre = await recibirC12([ingresoC12(100)], 4);
    expect(sobre.r.status).toBe(409);
    expect(sobre.cuerpo.codigo).toBe("no_editable");
  });

  it("valida el cuerpo con zod (400) y el id de la ruta", async () => {
    for (const cuerpo of [{}, { revision: 3 }, { revision: 3, recepciones: [] }, { revision: 3, recepciones: [{ ...ingresoC12(0) }] }, { revision: 3, recepciones: [{ ...ingresoC12(10), fecha_recepcion: "2026-13-01" }] }, { revision: 3, recepciones: [{ ...ingresoC12(10), recibida_periodo: "oct" }] }]) {
      const r = await recibir(enviar("POST", `/compras/${C12}/recibir`, cuerpo), ctx(C12));
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
    }
    expect((await recibirC12([ingresoC12(10)], 3, "xyz")).r.status).toBe(404);
    expect((await recibirC12([ingresoC12(10)], 3, INEXISTENTE)).r.status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it("concurrencia (regla 25): dos escrituras con la misma revisión → la primera pasa y la segunda recibe 409 compra_cambio sin escribir nada", async () => {
    const primera = await recibirC12([ingresoC12(100)], 3);
    const segunda = await recibirC12([ingresoC12(100)], 3);
    expect(primera.r.status).toBe(200);
    expect(segunda.r.status).toBe(409);
    expect(segunda.cuerpo.codigo).toBe("compra_cambio");
    expect(tablaDe("compra_linea_recepciones").filter((x) => x.linea_id === LINEA.c12)).toHaveLength(1);
    expect(eventosDe(C12)).toHaveLength(1);
    expect(revisionDe(C12)).toBe(4);
    // la segunda pestaña, con la revisión nueva, sí puede
    expect((await recibirC12([ingresoC12(100)], 4)).r.status).toBe(200);
  });
});

describe("DELETE /api/compras/[id]/recepciones/[recepcionId] (quitar un ingreso)", () => {
  const quitar = (compra: string, recepcion: string, revision?: number) =>
    quitarRecepcion(borrar(`/compras/${compra}/recepciones/${recepcion}${revision === undefined ? "" : `?revision=${revision}`}`), ctx(compra, { recepcionId: recepcion }));

  it("quita el ingreso: resta, deja el evento quitar_recepcion y el flujo vuelve a esperar las unidades", async () => {
    const r = await recibirC12([ingresoC12(200)]);
    const idRecepcion = r.cuerpo.data.lineas[0].recepciones[0].id;
    const q = await quitar(C12, idRecepcion, 4);
    const cuerpo = await leer<CompraApi>(q);
    expect(q.status).toBe(200);
    expect(cuerpo.data).toMatchObject({ revision: 5, estado: "confirmada" });
    expect(cuerpo.data.lineas[0]).toMatchObject({ unidades_recibidas: 0, recepciones: [] });
    expect(eventosDe(C12).map((e) => e.accion)).toEqual(["recibir", "quitar_recepcion"]);
    expect(denim((await leerFlujoHttp()).cuerpo.data).serie.ingresos[2]).toBe(500);
  });

  it("pertenencia (regla 30): una recepción de la compra B → 404 no_pertenece, sin tocar B ni escribir evento en A", async () => {
    const antes = tablaDe("compra_linea_recepciones").length;
    const q = await quitar(C12, IDS.recepcionC08, 3);
    expect(q.status).toBe(404);
    expect((await leer(q)).codigo).toBe("no_pertenece");
    expect(escrituras()).toEqual([]);
    expect(tablaDe("compra_linea_recepciones")).toHaveLength(antes);
    expect(eventosDe(C12)).toEqual([]);
    expect(eventosDe(C08)).toEqual([]);
    expect(revisionDe(C08)).toBe(2);
  });

  it("la revisión viaja en la query: sin ella 400; vieja 409 compra_cambio; ids mal formados 404", async () => {
    const r = await recibirC12([ingresoC12(100)]);
    const idRecepcion = r.cuerpo.data.lineas[0].recepciones[0].id;
    expect((await quitar(C12, idRecepcion)).status).toBe(400);
    const vieja = await quitar(C12, idRecepcion, 3);
    expect(vieja.status).toBe(409);
    expect((await leer(vieja)).codigo).toBe("compra_cambio");
    expect((await quitar(C12, "xyz", 4)).status).toBe(404);
    expect((await quitar("xyz", idRecepcion, 4)).status).toBe(404);
    expect(eventosDe(C12)).toHaveLength(1);
  });
});

describe("POST /api/compras/[id]/cancelar (regla 31, caso 26)", () => {
  const cancelarCon = async (id: string, cuerpo: unknown) => {
    const r = await cancelar(enviar("POST", `/compras/${id}/cancelar`, cuerpo), ctx(id));
    return { r, cuerpo: await leer<CompraApi>(r) };
  };

  it("sin recepciones queda cancelada (inmutable), deja de contar en el flujo y se sabe quién y por qué", async () => {
    const c = await cancelarCon(C12, { motivo: "  El proveedor desistió  ", revision: 3 });
    expect(c.r.status).toBe(200);
    expect(c.cuerpo.data).toMatchObject({ estado: "cancelada", saldo_cerrado: false, revision: 4, cancelada_por: { nombre: "Planner Uno", motivo: "El proveedor desistió" } });
    expect(c.cuerpo.data.puede).toEqual({ editar: false, confirmar: false, recibir: false, cancelar: false, aplicar_reparto: false });
    expect(unico(llamadasA("cancelar_compra"), "llamada").args.p_motivo).toBe("El proveedor desistió");
    expect(denim((await leerFlujoHttp()).cuerpo.data).resumen.en_camino).toBe(0);
    const otra = await cancelarCon(C12, { motivo: "otra vez", revision: 4 });
    expect(otra.r.status).toBe(409);
    expect(otra.cuerpo.codigo).toBe("no_editable");
  });

  it("con recepciones cierra el saldo: queda recibida, las recepciones siguen valiendo y el saldo deja de esperarse", async () => {
    await recibirC12([ingresoC12(200)]);
    const c = await cancelarCon(C12, { motivo: "No entregan el saldo", revision: 4 });
    expect(c.r.status).toBe(200);
    expect(c.cuerpo.data).toMatchObject({ estado: "recibida", saldo_cerrado: true, cancelada_por: { motivo: "No entregan el saldo" } });
    expect(c.cuerpo.data.lineas[0]).toMatchObject({ unidades: 500, unidades_recibidas: 200, unidades_canceladas: 300 });
    const f = denim((await leerFlujoHttp()).cuerpo.data);
    expect(f.serie.ingresos.slice(1, 3)).toEqual([200, 0]);
    expect(f.resumen.en_camino).toBe(200);
  });

  it("un ingreso tardío sobre el saldo cerrado consume lo cancelado y quitar todas las recepciones la deja cancelada", async () => {
    const primero = await recibirC12([ingresoC12(200)]);
    const cerrada = await cancelarCon(C12, { motivo: "Cierre", revision: 4 });
    expect(cerrada.cuerpo.data.puede.recibir).toBe(true);
    const tardio = await recibirC12([ingresoC12(50, "2026-11")], 5);
    expect(tardio.r.status).toBe(200);
    expect(tardio.cuerpo.data.lineas[0]).toMatchObject({ unidades_recibidas: 250, unidades_canceladas: 250 });
    expect(tardio.cuerpo.data.lineas[0].recepciones.some((x) => x.avisos.includes("recepcion_sobre_saldo_cancelado"))).toBe(true);
    // más de lo cancelado no cabe
    expect((await recibirC12([ingresoC12(300, "2026-11")], 6)).cuerpo.codigo).toBe("excede_pendiente");
    const q1 = await quitarRecepcion(borrar(`/compras/${C12}/recepciones/${tardio.cuerpo.data.lineas[0].recepciones[1].id}?revision=6`), ctx(C12, { recepcionId: tardio.cuerpo.data.lineas[0].recepciones[1].id }));
    expect(q1.status).toBe(200);
    const q2 = await quitarRecepcion(borrar(`/compras/${C12}/recepciones/${primero.cuerpo.data.lineas[0].recepciones[0].id}?revision=7`), ctx(C12, { recepcionId: primero.cuerpo.data.lineas[0].recepciones[0].id }));
    expect((await leer<CompraApi>(q2)).data.estado).toBe("cancelada");
  });

  it("si ya llegó todo: 409 recibida; el motivo es obligatorio (400) y la revisión debe ser la vigente", async () => {
    const todo = await cancelarCon(C08, { motivo: "Ya llegó", revision: 2 });
    expect(todo.r.status).toBe(409);
    expect(todo.cuerpo.codigo).toBe("recibida");
    expect(todo.cuerpo.error).toBe("Ya llegó todo: no hay saldo que cancelar.");
    for (const cuerpo of [{ revision: 3 }, { motivo: "   ", revision: 3 }, { motivo: "x".repeat(201), revision: 3 }, { motivo: "ok" }]) {
      expect((await cancelarCon(C12, cuerpo)).r.status).toBe(400);
    }
    const vieja = await cancelarCon(C12, { motivo: "ok", revision: 1 });
    expect(vieja.r.status).toBe(409);
    expect(vieja.cuerpo.codigo).toBe("compra_cambio");
    expect((await cancelarCon(INEXISTENTE, { motivo: "ok", revision: 0 })).r.status).toBe(404);
    expect(escrituras()).toEqual([]);
  });
});

describe("auditoría inmutable (regla 17b)", () => {
  it("importar, confirmar un ingreso, quitarlo, volver a confirmarlo y cancelar dejan cinco eventos en orden, cada `despues` es el `antes` del siguiente", async () => {
    const filas = filasImportacionEjemplo().filter((f) => f.proveedor === "Proveedor Norte" && f.linea_ordinal === "1");
    const imp = await importar(enviar("POST", "/compras/importar", { modo: "aplicar", carga_inicial: true, filas }));
    const reporte = (await leer<ReporteImportacionComprasApi>(imp)).data;
    expect(imp.status).toBe(200);
    const compraId = unico(reporte.aplicadas, "compra aplicada").compra_id;
    const compra = (await leer<CompraApi>(await unaCompra(get(`/compras/${compraId}`), ctx(compraId)))).data;
    const linea = compra.lineas[0];

    const rec = await recibirC12([{ linea_id: linea.id, recibida_periodo: "2026-11", unidades: 100, ...hoyRecepcion }], compra.revision, compraId);
    const idRec = rec.cuerpo.data.lineas[0].recepciones[0].id;
    await quitarRecepcion(borrar(`/compras/${compraId}/recepciones/${idRec}?revision=${rec.cuerpo.data.revision}`), ctx(compraId, { recepcionId: idRec }));
    const rec2 = await recibirC12([{ linea_id: linea.id, recibida_periodo: "2026-11", unidades: 100, ...hoyRecepcion }], revisionDe(compraId), compraId);
    await cancelar(enviar("POST", `/compras/${compraId}/cancelar`, { motivo: "Se cancela", revision: rec2.cuerpo.data.revision }), ctx(compraId));

    const h = (await leer<EventoCompraApi[]>(await historial(get(`/compras/${compraId}/historial`), ctx(compraId)))).data;
    expect(h.map((e) => e.accion)).toEqual(["importar", "recibir", "quitar_recepcion", "recibir", "cancelar"]);
    expect(h.map((e) => e.usuario_nombre)).toEqual(Array(5).fill("Planner Uno"));
    expect(h[4].motivo).toBe("Se cancela");
    for (let i = 1; i < 4; i++) expect(h[i].despues).toEqual(h[i + 1].antes);
    const detalle = (await leer<CompraApi>(await unaCompra(get(`/compras/${compraId}`), ctx(compraId)))).data;
    expect(detalle.historial).toHaveLength(5);
    expect(detalle.estado).toBe("recibida");
  });
});

// ─── «Aceptar sugerencia» (regla 23, caso 21) ───

describe("POST /api/flujo/conciliacion/aceptar", () => {
  const pedido = (cambio: Record<string, unknown> = {}) => ({ periodo: "2026-09", linea_id: LINEA.c09, entrega_id: IDS.entregaC09, unidades: 500, revision: 1, ...cambio });
  const aceptarCon = async (cuerpo: unknown) => {
    const r = await aceptar(enviar("POST", "/flujo/conciliacion/aceptar", cuerpo));
    return { r, cuerpo: await leer<RespuestaAceptarApi>(r) };
  };

  it("un clic: registra la recepción en el mes X, a su nombre y con origen sugerencia, y devuelve la fila recalculada", async () => {
    const a = await aceptarCon(pedido());
    expect(a.r.status, JSON.stringify(a.cuerpo)).toBe(200);
    const { compra, conciliacion: fila } = a.cuerpo.data;
    expect(compra).toMatchObject({ numero: "C-000009", revision: 2, estado: "recibida" });
    expect(compra.lineas[0].recepciones).toEqual([
      expect.objectContaining({ recibida_periodo: "2026-09", fecha_recepcion: "2026-09-30", origen: "sugerencia", usuario_nombre: "Planner Uno", unidades: 500, nota: "Aceptada desde la conciliación de set-2026" }),
    ]);
    expect(fila).toMatchObject({ gml_id: NODO_M8.polo, periodo: "2026-09", recepciones_registradas: 800, sin_registrar: 0, sugerencias: [], marca_id: null });
    expect(fila.avisos).not.toContain("ingreso_sin_registrar");

    const ev = unico(eventosDe(C09), "evento");
    expect(ev).toMatchObject({ accion: "recibir", motivo: "sugerencia de conciliación set-2026", usuario_nombre: "Planner Uno" });
    expect(unico(llamadasA("registrar_recepciones"), "llamada").args).toMatchObject({ p_motivo: "sugerencia de conciliación set-2026", p_revision: 1 });

    // la lectura siguiente ya no la propone y el aviso de la cabecera desaparece
    const { cuerpo } = await leerFlujoHttp();
    expect(cuerpo.data.datos.avisos).toEqual([]);
    expect(polo(cuerpo.data).resumen).toMatchObject({ por_confirmar: 0, posible_doble_conteo: 0 });
  });

  it("repetir el mismo pedido → 409 sugerencia_vencida (el botón ya se desactivó al primer clic)", async () => {
    expect((await aceptarCon(pedido())).r.status).toBe(200);
    const otra = await aceptarCon(pedido());
    expect(otra.r.status).toBe(409);
    expect(otra.cuerpo.codigo).toBe("sugerencia_vencida");
    expect(llamadasA("registrar_recepciones")).toHaveLength(1);
    expect(eventosDe(C09)).toHaveLength(1);
  });

  it("pertenencia: una entrega de otra línea o una línea que no existe → 404 no_pertenece; no toca la base", async () => {
    for (const cambio of [{ entrega_id: IDS.entregaC12 }, { linea_id: INEXISTENTE }, { linea_id: LINEA.c12 }, { entrega_id: INEXISTENTE }]) {
      const a = await aceptarCon(pedido(cambio));
      expect(a.r.status, JSON.stringify(cambio)).toBe(404);
      expect(a.cuerpo.codigo).toBe("no_pertenece");
    }
    expect(escrituras()).toEqual([]);
    expect(eventosDe(C09)).toEqual([]);
    expect(eventosDe(C12)).toEqual([]);
  });

  it("más unidades de las que le faltan a la entrega → 409 excede_pendiente; con otro mes o menos unidades de las propuestas → sugerencia_vencida", async () => {
    const mucho = await aceptarCon(pedido({ unidades: 600 }));
    expect(mucho.r.status).toBe(409);
    expect(mucho.cuerpo.codigo).toBe("excede_pendiente");
    const otroMes = await aceptarCon(pedido({ periodo: "2026-08" }));
    expect(otroMes.r.status).toBe(409);
    expect(otroMes.cuerpo.codigo).toBe("sugerencia_vencida");
    expect(escrituras()).toEqual([]);
  });

  it("aceptar solo una parte es válido y el resto se vuelve a proponer en la lectura siguiente (avance voraz)", async () => {
    const a = await aceptarCon(pedido({ unidades: 200 }));
    expect(a.r.status).toBe(200);
    expect(a.cuerpo.data.compra.lineas[0].unidades_recibidas).toBe(200);
    expect(a.cuerpo.data.conciliacion).toMatchObject({ recepciones_registradas: 500, sin_registrar: 300 });
    expect(a.cuerpo.data.conciliacion.sugerencias).toEqual([expect.objectContaining({ unidades: 300, entrega_id: IDS.entregaC09 })]);
    expect(a.cuerpo.data.conciliacion.sugerencias[0].revision).toBe(2);
  });

  it("una línea de lote → 409 tipo_no_disponible (en 0.13.0 solo líneas específicas)", async () => {
    const a = await aceptarCon(pedido({ linea_id: LINEA.c20, entrega_id: IDS.entregaC20, revision: 2 }));
    expect(a.r.status).toBe(409);
    expect(a.cuerpo.codigo).toBe("tipo_no_disponible");
    expect(escrituras()).toEqual([]);
  });

  it("revisión vieja → 409 compra_cambio sin escribir; cuerpo inválido → 400; el comprador recibe 403", async () => {
    const vieja = await aceptarCon(pedido({ revision: 0 }));
    expect(vieja.r.status).toBe(409);
    expect(vieja.cuerpo.codigo).toBe("compra_cambio");
    expect(eventosDe(C09)).toEqual([]);
    for (const cuerpo of [{}, pedido({ unidades: 0 }), pedido({ periodo: "set" }), pedido({ linea_id: "no" }), pedido({ revision: -1 })]) {
      expect((await aceptarCon(cuerpo)).r.status).toBe(400);
    }
    comoComprador();
    expect((await aceptarCon(pedido())).r.status).toBe(403);
    expect(escrituras()).toEqual([]);
  });
});

// ─── Caché por huella (regla 24) ───

describe("caché del flujo por huella (regla 24)", () => {
  it("dos GET seguidos con la misma huella → un solo cálculo y una sola lectura de cada carga y de cada fuente", async () => {
    const a = await leerFlujoHttp();
    const b = await leerFlujoHttp();
    expect(b.cuerpo.data.datos.huella).toBe(a.cuerpo.data.datos.huella);
    expect(contadores.calculos).toBe(1);
    expect(contadores).toMatchObject({ cerrada: 1, configuracion: 1, compras: 1, reglas: 1, repartos: 1, parametros: 1, stock: 13, stock_filas: 1 });
    expect(llamadasA("stock_flujo")).toHaveLength(13);
    expect(llamadasA("flujo_huella_base")).toHaveLength(2);
    // las demás rutas de lectura salen de la misma caché
    await huecos(get("/flujo/huecos"));
    await conciliacion(get("/flujo/conciliacion"));
    await filaDetalle(get("/flujo/fila", `?gml_id=${NODO_M8.polo}&agrupacion_marca_id=${AGR_M8.premium}`));
    expect(contadores.calculos).toBe(1);
  });

  it("dos peticiones simultáneas con la misma huella comparten el cálculo (single-flight)", async () => {
    const rs = await Promise.all([flujo(get("/flujo")), huecos(get("/flujo/huecos")), flujo(get("/flujo", "?solo=falta"))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(contadores.calculos).toBe(1);
    expect(contadores.stock).toBe(13);
    expect(contadores.cerrada).toBe(1);
  });

  it("publicar un mes → solo se llama stock_flujo para esa carga; no se relee la cerrada", async () => {
    vi.setSystemTime(new Date("2026-11-05T15:00:00.000Z"));
    const antes = await leerFlujoHttp();
    expect(antes.cuerpo.data.datos.k_prima).toBe("2026-09");
    const llamadas = llamadasA("stock_flujo").length;
    publicarMes("2026-10");
    const despues = await leerFlujoHttp();
    expect(despues.cuerpo.data.datos.k_prima).toBe("2026-10");
    expect(despues.cuerpo.data.datos.huella).not.toBe(antes.cuerpo.data.datos.huella);
    expect(llamadasA("stock_flujo")).toHaveLength(llamadas + 1);
    expect(contadores.cerrada).toBe(1);
    expect(contadores.compras).toBe(1);
    expect(contadores.configuracion).toBe(1);
    expect(contadores.calculos).toBe(2);
  });

  it("confirmar un ingreso cambia la huella y solo se releen las compras: ni la cerrada ni el stock", async () => {
    const antes = await leerFlujoHttp();
    const stock = llamadasA("stock_flujo").length;
    expect((await recibirC12([ingresoC12(100)])).r.status).toBe(200);
    const despues = await leerFlujoHttp();
    expect(despues.cuerpo.data.datos.huella).not.toBe(antes.cuerpo.data.datos.huella);
    expect(llamadasA("stock_flujo")).toHaveLength(stock);
    expect(contadores).toMatchObject({ cerrada: 1, configuracion: 1, repartos: 1, reglas: 1, parametros: 1, stock_filas: 1, compras: 2, calculos: 2 });
  });

  it("cambiar una marca a mixta cambia la parte `config` de la huella: se relee la configuración y la cabecera avisa config_cambiada", async () => {
    const antes = await leerFlujoHttp();
    expect(antes.cuerpo.data.datos.avisos).not.toContain("config_cambiada");
    escenario.betaMixta = true;
    escenario.config.marcas = [9, "2026-10-15T12:00:00.000Z"];
    const despues = await leerFlujoHttp();
    expect(despues.cuerpo.data.datos.huella).not.toBe(antes.cuerpo.data.datos.huella);
    expect(despues.cuerpo.data.datos.avisos).toContain("config_cambiada");
    expect(contadores.configuracion).toBe(2);
    expect(contadores.cerrada).toBe(1);
    // `stock_flujo` agrega con `marcas` (conjuntos): su caché por carga también se invalida
    expect(llamadasA("stock_flujo")).toHaveLength(26);
    expect(contadores.stock).toBe(26);
  });

  it("desactivar una tienda cambia config.tiendas: se vuelve a llamar a stock_flujo y aparece stock_en_tiendas_inactivas", async () => {
    const antes = await leerFlujoHttp();
    expect(antes.cuerpo.data.datos.avisos).not.toContain("stock_en_tiendas_inactivas");
    expect(llamadasA("stock_flujo")).toHaveLength(13);
    escenario.tiendasInactivas = true;
    escenario.config.tiendas = [3, "2026-10-20T12:00:00.000Z"];
    const despues = await leerFlujoHttp();
    expect(llamadasA("stock_flujo")).toHaveLength(26);
    expect(despues.cuerpo.data.datos.avisos).toContain("stock_en_tiendas_inactivas");
    expect(despues.cuerpo.data.datos.stock_excluido.unidades).toBeGreaterThan(0);
    // sin otro cambio, la caché vuelve a servir
    await leerFlujoHttp();
    expect(llamadasA("stock_flujo")).toHaveLength(26);
  });

  it("un cambio de mes en Lima cambia la huella; los parámetros, solo su lectura", async () => {
    const antes = await leerFlujoHttp();
    vi.setSystemTime(new Date("2026-11-01T15:00:00.000Z"));
    const mes = await leerFlujoHttp();
    expect(mes.cuerpo.data.datos.huella).not.toBe(antes.cuerpo.data.datos.huella);
    expect(contadores.calculos).toBe(2);
    expect(llamadasA("stock_flujo")).toHaveLength(13);

    await guardarParametros(enviar("PUT", "/flujo/parametros", { imi_min: 4, imi_max: 8, meses_tarjeta: 3, extender_horizonte: true, temporadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } }, umbral_conciliacion_u: 10, umbral_conciliacion_pct: 20 }));
    const params = await leerFlujoHttp();
    expect(params.cuerpo.data.datos.parametros.meses_tarjeta).toBe(3);
    expect(contadores).toMatchObject({ parametros: 2, cerrada: 1, calculos: 3 });
  });

  it("un fallo no se guarda en la caché: la siguiente petición lo vuelve a intentar", async () => {
    escenario.sinCerrada = true;
    expect((await flujo(get("/flujo"))).status).toBe(404);
    expect((await flujo(get("/flujo"))).status).toBe(404);
    escenario.sinCerrada = false;
    expect((await flujo(get("/flujo"))).status).toBe(200);
    expect(contadores.calculos).toBe(1);
  });
});

// ─── Importador de carga inicial (reglas 18 y 28) ───

describe("POST /api/compras/importar", () => {
  const sinFeria = () => {
    // «Feria Sur» es un proveedor nuevo en el caso 13
    reiniciarEscenario({ sembrar: false });
    escenario.tablas.proveedores = tablaDe("proveedores").filter((p) => p.id === PROVEEDOR.norte);
  };
  const importarCon = async (modo: "previsualizar" | "aplicar", filas = filasImportacionEjemplo(), extra: Record<string, unknown> = {}) => {
    const r = await importar(enviar("POST", "/compras/importar", { modo, carga_inicial: true, filas, ...extra }));
    return { r, cuerpo: await leer<ReporteImportacionComprasApi>(r) };
  };

  it("sin la casilla de carga inicial: 400 carga_inicial_requerida; el comprador recibe 403; un archivo vacío, 400", async () => {
    sinFeria();
    const r = await importarCon("previsualizar", filasImportacionEjemplo(), { carga_inicial: false });
    expect(r.r.status).toBe(400);
    expect(r.cuerpo.codigo).toBe("carga_inicial_requerida");
    expect((await importarCon("previsualizar", [])).r.status).toBe(400);
    comoComprador();
    expect((await importarCon("previsualizar")).r.status).toBe(403);
    expect(escrituras()).toEqual([]);
  });

  it("previsualizar (caso 13): 3 líneas nuevas en 2 compras, proveedor nuevo y 3 omitidas con su motivo; no escribe nada", async () => {
    sinFeria();
    const { r, cuerpo } = await importarCon("previsualizar");
    expect(r.status, JSON.stringify(cuerpo)).toBe(200);
    const rep = cuerpo.data;
    expect(rep).toMatchObject({ modo: "previsualizar", carga_inicial: true, k_prima: "2026-09", proveedores_a_crear: ["Feria Sur"], aplicadas: [], no_aplicadas: [] });
    expect(rep.totales).toEqual({ recibidas: 6, procesadas: 3, omitidas: 3, nuevas: 3, iguales: 0, cambiadas: 0 });
    expect(rep.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas_nuevas])).toEqual([
      ["Proveedor Norte", "PO-2211", 2],
      ["Feria Sur", "FS-001", 1],
    ]);
    expect(rep.omitidas.map((o) => o.motivo).sort()).toEqual(["entregas_invalidas", "marca_y_agrupacion", "tipo_no_disponible"]);
    expect(escrituras()).toEqual([]);
    expect(tablaDe("compras")).toEqual([]);
    expect(tablaDe("proveedores")).toHaveLength(1);
  });

  it("el aviso `exceso` lo calcula el flujo con las líneas nuevas como compras confirmadas (informativo)", async () => {
    // El lote de 1 000 u de BETA cae en POLO × PREMIUM, que ya está por encima del tope.
    const { cuerpo } = await importarCon("previsualizar");
    const aviso = cuerpo.data.avisos.find((a) => a.aviso === "exceso");
    expect(aviso?.fila).toBe(3);
    expect(aviso?.detalle).toMatch(/IMI .* exceso .* u/);
    expect(cuerpo.data.lineas.find((l) => l.fila === 3)?.avisos).toContain("exceso");
    expect(cuerpo.data.lineas.find((l) => l.fila === 1)?.avisos).not.toContain("exceso");
  });

  it("aplicar: una función por compra, todo o nada por compra; crea el proveedor, deja el evento importar y confirma la compra", async () => {
    sinFeria();
    const { r, cuerpo } = await importarCon("aplicar");
    expect(r.status, JSON.stringify(cuerpo)).toBe(200);
    expect(cuerpo.data.aplicadas.map((a) => [a.numero, a.lineas])).toEqual([["C-000100", 2], ["C-000101", 1]]);
    expect(cuerpo.data.no_aplicadas).toEqual([]);
    expect(llamadasA("importar_compra")).toHaveLength(2);
    expect(tablaDe("proveedores").map((p) => p.nombre)).toContain("Feria Sur");
    const compras = tablaDe("compras");
    expect(compras.map((c) => [c.numero, c.origen, c.estado])).toEqual([["C-000100", "carga_inicial", "confirmada"], ["C-000101", "carga_inicial", "confirmada"]]);
    expect(tablaDe("compra_eventos").map((e) => e.accion)).toEqual(["importar", "importar"]);
    // la línea de GAMMA entró con RECIBIDAS = 200: recepción `importada` y pendiente 0
    const gamma = tablaDe("compra_lineas").find((l) => l.marca_id === MARCA_M8.gamma);
    expect(gamma).toMatchObject({ unidades: 200, unidades_recibidas: 200 });
    expect(tablaDe("compra_linea_recepciones").find((x) => x.linea_id === gamma?.id)).toMatchObject({ origen: "importada", unidades: 200 });
    // el lote de BETA guardó su reparto por entrega con la temporada de cada una
    const beta = tablaDe("compra_lineas").find((l) => l.marca_id === MARCA_M8.beta);
    expect(tablaDe("compra_linea_repartos").filter((x) => x.linea_id === beta?.id).length).toBeGreaterThanOrEqual(6);
    // la carga queda a la vista de la lista
    const lista = (await leer<CompraApi[]>(await listaCompras(get("/compras")))).data;
    expect(lista.map((c) => c.numero).sort()).toEqual(["C-000100", "C-000101"]);
  });

  it("es idempotente: reimportar el mismo archivo da 0 nuevas (todas iguales) y no llama a la base; insertar una fila arriba solo agrega esa", async () => {
    sinFeria();
    await importarCon("aplicar");
    const llamadas = llamadasA("importar_compra").length;
    const otra = (await importarCon("aplicar")).cuerpo.data;
    expect(otra.totales).toMatchObject({ nuevas: 0, iguales: 3, cambiadas: 0 });
    expect(otra.aplicadas).toEqual([]);
    expect(llamadasA("importar_compra")).toHaveLength(llamadas);
    vi.setSystemTime(new Date("2026-10-16T15:00:00.000Z"));
    expect((await importarCon("previsualizar")).cuerpo.data.totales.nuevas).toBe(0);

    const filas = filasImportacionEjemplo();
    const nueva = { ...filas[0], linea_ordinal: "9", unidades: "100", entregas: "2026-11:100", llegada: "" };
    const con = (await importarCon("aplicar", [nueva, ...filas])).cuerpo.data;
    expect(con.totales).toMatchObject({ nuevas: 1, iguales: 3 });
    expect(con.compras_a_crear[0]).toMatchObject({ referencia: "PO-2211", lineas_nuevas: 1, existente: { numero: "C-000100" } });
    expect(tablaDe("compras")).toHaveLength(2);
    expect(tablaDe("compra_lineas").filter((l) => l.compra_id === compraDe(idCompra("C-000100"))?.id)).toHaveLength(3);
  });

  it("una línea con otro contenido se omite con `cambiada_requiere_edicion` y dice qué cambió (en 0.13.0 no hay edición)", async () => {
    sinFeria();
    await importarCon("aplicar");
    const filas = filasImportacionEjemplo();
    filas[0] = { ...filas[0], unidades: "600", entregas: "2026-11:300;2026-12:300" };
    const { cuerpo } = await importarCon("previsualizar", filas);
    expect(cuerpo.data.totales).toMatchObject({ nuevas: 0, iguales: 2, cambiadas: 1 });
    const o = cuerpo.data.omitidas.find((x) => x.motivo === "cambiada_requiere_edicion");
    expect(o?.detalle).toContain("unidades 500 → 600");
    expect(cuerpo.data.lineas.find((l) => l.clasificacion === "cambiada")?.cambios.join(" ")).toContain("unidades");
  });

  it("caso 28: si la función de la segunda compra falla, la primera queda completa y la segunda sin nada; reimportar completa lo que falta", async () => {
    sinFeria();
    escenario.fallarImportacion = 2;
    const { r, cuerpo } = await importarCon("aplicar");
    expect(r.status).toBe(200);
    expect(cuerpo.data.aplicadas.map((a) => a.numero)).toEqual(["C-000100"]);
    expect(cuerpo.data.no_aplicadas).toEqual([expect.objectContaining({ proveedor: "Feria Sur", referencia: "FS-001", motivo: "error" })]);
    expect(typeof cuerpo.data.no_aplicadas[0].mensaje).toBe("string");
    expect(tablaDe("compras")).toHaveLength(1);
    expect(tablaDe("compra_eventos")).toHaveLength(1);
    for (const l of tablaDe("compra_lineas")) expect(tablaDe("compra_linea_entregas").some((e) => e.linea_id === l.id)).toBe(true);

    escenario.fallarImportacion = null;
    const de_nuevo = (await importarCon("aplicar")).cuerpo.data;
    expect(de_nuevo.totales).toMatchObject({ iguales: 2, nuevas: 1 });
    expect(de_nuevo.aplicadas.map((a) => a.numero)).toEqual(["C-000101"]);
    expect(tablaDe("compras")).toHaveLength(2);
    for (const l of tablaDe("compra_lineas")) expect(tablaDe("compra_linea_entregas").some((e) => e.linea_id === l.id)).toBe(true);
  });

  it("si otra importación creó la clave entre previsualizar y aplicar, esa compra queda sin aplicar con su motivo y las demás siguen", async () => {
    sinFeria();
    escenario.claveExistente = (referencia) => referencia === "PO-2211";
    const { cuerpo } = await importarCon("aplicar");
    expect(cuerpo.data.no_aplicadas).toEqual([expect.objectContaining({ referencia: "PO-2211", motivo: "clave_existente" })]);
    expect(cuerpo.data.no_aplicadas[0].mensaje).toContain("vuelve a previsualizar");
    expect(cuerpo.data.aplicadas.map((a) => a.clave)).toEqual(["FERIA SUR|FS-001"]);
  });

  it("corregir un error: cancelar la compra (sin recepciones) libera sus claves y la fila corregida se reimporta como nueva", async () => {
    sinFeria();
    const una = filasImportacionEjemplo().filter((f) => f.proveedor === "Proveedor Norte" && f.linea_ordinal === "1");
    await importarCon("aplicar", una);
    const c = idCompra("C-000100");
    const cancelada = await cancelar(enviar("POST", `/compras/${c}/cancelar`, { motivo: "Error de carga", revision: revisionDe(c) }), ctx(c));
    expect((await leer<CompraApi>(cancelada)).data.estado).toBe("cancelada");
    const corregida = [{ ...una[0], unidades: "600", entregas: "2026-11:300;2026-12:300" }];
    const { cuerpo } = await importarCon("aplicar", corregida);
    expect(cuerpo.data.totales).toMatchObject({ nuevas: 1, iguales: 0, cambiadas: 0 });
    expect(cuerpo.data.aplicadas.map((a) => a.numero)).toEqual(["C-000101"]);
    expect(compraDe(idCompra("C-000101"))?.estado).toBe("confirmada");
  });
});

// ─── Orden de la conciliación ───

describe("orden de ConciliacionApi.filas", () => {
  it("la fila de una marca con regla (intercompany) va justo después de su fila general, aunque haya otras filas de la misma ruta", () => {
    const CAMISA = { gml: NODO_M8.camisa, eq: EQ.larga };
    const res = calcularFlujo(
      entrada({
        cerrada: {
          filas: [
            ...cerradaDeFila({ ...CAMISA, agr: AGR_M8.reconocido, demanda: Array.from({ length: 15 }, () => 1200), partic: participaciones({ [MARCA_M8.jh]: 0.4 }) }),
            ...cerradaDeFila({ ...CAMISA, agr: AGR_M8.premium, demanda: Array.from({ length: 15 }, () => 100) }),
          ],
          version_metodo: 4,
          huella_flujo: "h",
          periodo_referencia: { desde: "2025-10", hasta: "2026-09" },
        },
        stock: mapaDeStock(
          stockMes("2026-08", [
            { ...CAMISA, agr: AGR_M8.reconocido, cd: 2300, marcas: { [MARCA_M8.jh]: { cd: 900 }, [MARCA_M8.alfa]: { cd: 1400 } } },
            { ...CAMISA, agr: AGR_M8.premium, cd: 100, marcas: { [MARCA_M8.beta]: { cd: 100 } } },
          ]),
          stockMes("2026-09", [
            { ...CAMISA, agr: AGR_M8.reconocido, cd: 1950, venta: 1200, marcas: { [MARCA_M8.jh]: { cd: 804, venta: 480 }, [MARCA_M8.alfa]: { cd: 1146, venta: 720 } } },
            { ...CAMISA, agr: AGR_M8.premium, cd: 120, venta: 50, marcas: { [MARCA_M8.beta]: { cd: 120, venta: 50 } } },
          ])
        ),
        reglas: [REGLA_JH],
      })
    );
    const nombres: NombresFlujo = {
      nodos: { [EQ.larga]: { genero_id: GEN.hombre, mundo_id: MUN.formal, genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA LARGA", nivel: "GMLE" } },
      agrupaciones: { [AGR_M8.reconocido]: "RECONOCIDO", [AGR_M8.premium]: "PREMIUM" },
      responsables: {},
      marcas: { [MARCA_M8.jh]: "JOHN HOLDEN" },
    };
    const c = armarConciliacionApi(res, "2026-09", nombres);
    if (c === null) throw new Error("el mes está publicado");
    expect(c.filas.map((f) => `${f.agrupacion_marca}${f.marca ? ` · ${f.marca}` : ""}`)).toEqual(["PREMIUM", "RECONOCIDO", "RECONOCIDO · JOHN HOLDEN"]);
    const jh = c.filas[2];
    expect(jh).toMatchObject({ marca_id: MARCA_M8.jh, ingreso_inferido: 384, pct_directo_regla: 80 });
    expect(jh.pct_directo_observado).toEqual({ periodo: "2026-09", valor: 80 });
    // las totales cuentan solo las filas completas (no las de marca)
    expect(c.totales.ingreso_inferido).toBe(c.filas.filter((f) => f.marca_id === null).reduce((a, f) => a + (f.ingreso_inferido ?? 0), 0));
  });
});
