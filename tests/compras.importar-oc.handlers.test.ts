import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { escenario, tablaDe } from "./compras.fake-db";
import { entrarComo, iniciarAgrupadores, reemplazos } from "./agrupadores.fake-db";

// Los módulos de la base y de las fuentes se cargan dentro de la fábrica para que sean los mismos que importa este archivo.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./compras.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteAgrupadores } = await import("./agrupadores.fake-db");
  return { supabaseAdmin: () => clienteAgrupadores() };
});
vi.mock("@/lib/proyeccion/servicio", async (original) => {
  const real = await original<typeof import("@/lib/proyeccion/servicio")>();
  const falso = await import("./compras.fake-db");
  return { ...real, leerCerradaParaFlujo: async (anio: number) => ({ data: falso.cerradaFalsa(anio), respuesta: null }) };
});
vi.mock("@/lib/marcas-barrer/servicio", async (original) => {
  const real = await original<typeof import("@/lib/marcas-barrer/servicio")>();
  const falso = await import("./compras.fake-db");
  const mio = await import("./agrupadores.fake-db");
  return {
    ...real,
    leerRepartosVigentes: async () => ({ data: falso.repartosVigentesFalsos(), respuesta: null }),
    leerRepartosPorId: async (_d: unknown, ids: string[]) => ({ data: ids.length === 0 ? [] : [mio.repartoV2(mio.estadoRepartos.sinInvierno)], respuesta: null }),
  };
});
vi.mock("@/lib/intercompany/servicio", async (original) => {
  const real = await original<typeof import("@/lib/intercompany/servicio")>();
  return { ...real, leerVigentes: async () => ({ data: { reglas: [], marcas: [] }, respuesta: null }) };
});
vi.mock("@/lib/marcas/gml/estado", async () => {
  const falso = await import("./compras.fake-db");
  return { cargarEstadoGml: async () => ({ error: null, ...falso.estadoGmlFalso() }) };
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
    leerPerfiles: async () => ({ data: [], error: null }),
  };
});
vi.mock("@/lib/tiendas/consultas", async () => {
  const falso = await import("./compras.fake-db");
  return { leerTiendas: async () => ({ data: falso.tiendasFalsas(), error: null }) };
});
vi.mock("@/lib/proyeccion/contexto", async () => ({
  cargarContextoCalculo: async () => ({ data: { nodos: [], vigentes: [], agrupaciones: [], periodosClase: [], factores: [], hastaDefecto: "2026-09" }, respuesta: null }),
}));

import { POST as importarAgrupadores } from "@/app/api/compras/agrupadores/importar/route";
import { POST as importarCompras } from "@/app/api/compras/importar/route";
import { GET as unaCompra } from "@/app/api/compras/[id]/route";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { agruparItemsCotv, referenciaCotv, type FilaPlanillaC2, type ItemCotv } from "../scripts/cotv/planilla-c2";
import type { CompraApi, ReporteImportacionComprasApi } from "@/lib/compras/tipos-api";
import type { ReporteImportacionAgrupadoresApi } from "@/lib/compras/agrupadores/tipos-api";
import { filasImportacionEjemplo } from "./compras.fixture";
import { EMBARQUE_AGR, VIAJE_AGR } from "./agrupadores.fixture";

/**
 * 08b-1b T3a-3: el importador de compras con la columna `OC` (F14, F16, F17, F31, F32), el importador de agrupadores con las columnas
 * nuevas (F18) y el ensayo de la planilla C2 de COTV (F42) de punta a punta con el servicio REAL y la base en memoria. Todo inventado.
 * «Hoy» es 2026-10-15 (Lima).
 */

const URL_BASE = "http://localhost/api";
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const compraPorNumero = (n: string) => tablaDe("compras").find((c) => c.numero === n)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  iniciarAgrupadores();
  entrarComo("pl");
  reiniciarCaches();
  reiniciarCacheCatalogo();
  escenario.contadorNumero = 201;
});
afterEach(() => {
  vi.useRealTimers();
});

const llamadas = (n: string) => escenario.llamadas.filter((l) => l.nombre === n);

type Fila = Record<string, string>;
/** Una línea de COTV: viaje 261001, llegada dic-26 y sin embarque ni paquete. */
const filaCotv = (proveedor: string, referencia: string, ordinal: string, unidades: string, fecha: string, extra: Fila = {}): Fila => ({
  ...(filasImportacionEjemplo()[0] as unknown as Fila),
  proveedor,
  referencia,
  linea_ordinal: ordinal,
  unidades,
  fecha_compra: fecha,
  llegada: "2026-12",
  entregas: "",
  recibidas: "",
  viaje: "261001",
  ...extra,
});

const NORTE = "COTV-261001-norte";
const SUR = "COTV-261001-sur";
/** F14: dos filas de Proveedor Norte con la misma referencia (300 y 200 u, 06-jul) y una de Feria Sur (500 u, 10-jul). */
const archivoF14 = (oc: { norte?: string; sur?: string } = {}): Fila[] => [
  filaCotv("Proveedor Norte", NORTE, "1", "300", "2026-07-06", { oc: oc.norte ?? "" }),
  filaCotv("Proveedor Norte", NORTE, "2", "200", "2026-07-06", { oc: oc.norte ?? "" }),
  filaCotv("Feria Sur", SUR, "1", "500", "2026-07-10", { oc: oc.sur ?? "" }),
];

const importar = async (modo: "previsualizar" | "aplicar", filas: Fila[], extra: Record<string, unknown> = {}) => {
  const r = await importarCompras(enviar("POST", "/compras/importar", { modo, carga_inicial: true, filas, archivo_nombre: "planilla.xlsx", ...extra }));
  return { r, rep: (await leer<ReporteImportacionComprasApi>(r)).data };
};
const aplicarF14 = async () => {
  const { r, rep } = await importar("aplicar", archivoF14());
  expect(r.status, JSON.stringify(rep)).toBe(200);
  return rep;
};
const idsDeEntregasDic = (compra: string) => {
  const lineas = tablaDe("compra_lineas").filter((l) => l.compra_id === compraPorNumero(compra).id).map((l) => l.id);
  return tablaDe("compra_linea_entregas").filter((e) => lineas.includes(e.linea_id) && String(e.periodo).startsWith("2026-12"));
};

describe("F14 y F16: la carga COTV de un viaje, sin embarque y con LLEGADA dic-26", () => {
  it("F14: dos compras (C-000201 de Proveedor Norte con 2 líneas y 500 u; C-000202 de Feria Sur con 500 u), entregas dic-26 y sin embarque", async () => {
    const { rep } = await importar("previsualizar", archivoF14());
    expect(rep.totales).toMatchObject({ nuevas: 3, omitidas: 0 });
    expect(rep.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas_nuevas, c.fecha_compra])).toEqual([
      ["Proveedor Norte", NORTE, 2, "2026-07-06"],
      ["Feria Sur", SUR, 1, "2026-07-10"],
    ]);
    expect(rep.oc ?? []).toEqual([]);

    const ap = await aplicarF14();
    expect(ap.aplicadas.map((a) => [a.numero, a.lineas])).toEqual([["C-000201", 2], ["C-000202", 1]]);
    expect(idsDeEntregasDic("C-000201").reduce((s, e) => s + Number(e.unidades), 0)).toBe(500);
    expect(idsDeEntregasDic("C-000202").reduce((s, e) => s + Number(e.unidades), 0)).toBe(500);
    expect(tablaDe("compra_entrega_asignaciones")).toEqual([]);
    expect(compraPorNumero("C-000201").viaje_id).toBe(VIAJE_AGR.v261001);
    expect(llamadas("importar_compra")).toHaveLength(2);
    expect(llamadas("editar_oc_compra")).toEqual([]);
  });

  it("F14: la línea de tiempo de C-000201 es un solo tramo «Sin embarque» de 500 u en dic-26", async () => {
    await aplicarF14();
    const id = compraPorNumero("C-000201").id as string;
    const r = await unaCompra(new NextRequest(`${URL_BASE}/compras/${id}`), { params: Promise.resolve({ id }) } as never);
    const c = (await leer<CompraApi>(r)).data;
    expect(c.linea_de_tiempo.map((t) => [t.embarque?.codigo ?? null, t.unidades, t.mes])).toEqual([[null, 500, "2026-12"]]);
    expect(c.linea_de_tiempo[0].hitos.find((h) => h.hito === "orden_compra")).toMatchObject({ estado: "real", fecha: "2026-07-06" });
    expect(c.linea_de_tiempo[0].hitos.filter((h) => h.hito !== "orden_compra").map((h) => [h.hito, h.estado])).toEqual([
      ["zarpe", "pendiente"],
      ["arribo", "pendiente"],
      ["ingreso_cd", "pendiente"],
      ["inicio_operativo", "pendiente"],
      ["ingreso_stock", "pendiente"],
    ]);
  });

  it("F14: la segunda fila de Norte con FECHA_COMPRA 07-jul sale `cabecera_inconsistente` y no entra", async () => {
    const filas = archivoF14();
    filas[1] = { ...filas[1], fecha_compra: "2026-07-07" };
    const { rep } = await importar("previsualizar", filas);
    expect(rep.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[2, "cabecera_inconsistente"]]);
    expect(rep.compras_a_crear.map((c) => c.lineas_nuevas)).toEqual([1, 1]);
  });

  it("F16: reimportar el archivo de F14 da 3 `igual` y no se mueve nada", async () => {
    await aplicarF14();
    const antes = llamadas("importar_compra").length;
    const { rep } = await importar("aplicar", archivoF14());
    expect(rep.totales).toMatchObject({ nuevas: 0, iguales: 3, cambiadas: 0, omitidas: 0 });
    expect(rep.aplicadas).toEqual([]);
    expect(llamadas("importar_compra")).toHaveLength(antes);
    expect(llamadas("asignar_viaje_compras")).toHaveLength(2);
    expect(tablaDe("compras").filter((c) => String(c.numero) >= "C-000201")).toHaveLength(2);
  });
});

describe("F17: EMBARQUE y LLEGADA se comparan con el mes de destino del embarque", () => {
  const nuevaYork = () => {
    const base = tablaDe("compra_embarques").find((e) => e.id === EMBARQUE_AGR.e270301)!;
    tablaDe("compra_embarques").push({ ...base, id: "99999999-0000-4000-8000-000000000001", codigo: "270101", nombre: "Nueva York", viaje_id: null, fecha_llegada_estimada: "2027-01-15", periodo_llegada: "2027-01-01" });
  };

  it("`LLEGADA = 2026-12` con el embarque de enero: `llegada_distinta_del_embarque`; con `2027-01`, entra y queda asignada", async () => {
    nuevaYork();
    const mal = await importar("previsualizar", [filaCotv("Proveedor Norte", NORTE, "1", "300", "2026-07-06", { embarque: "270101", viaje: "" })]);
    expect(mal.rep.omitidas.map((o) => o.motivo)).toEqual(["llegada_distinta_del_embarque"]);
    const bien = await importar("aplicar", [filaCotv("Proveedor Norte", NORTE, "1", "300", "2026-07-06", { embarque: "270101", viaje: "", llegada: "2027-01" })]);
    expect(bien.rep.omitidas).toEqual([]);
    expect(bien.rep.aplicadas).toHaveLength(1);
    expect(bien.rep.agrupadores?.[0]).toMatchObject({ resultado: "asignado" });
    expect(tablaDe("compra_entrega_asignaciones").map((a) => [a.embarque_id, a.unidades])).toEqual([["99999999-0000-4000-8000-000000000001", 300]]);
  });
});

describe("F31: la columna OC del importador de compras (cuarta llamada, `editar_oc_compra`)", () => {
  const OC = "4500012345";

  it("reimportar F14 con OC en las dos filas de C-000201 y vacía en C-000202: 3 `igual`, la OC se registra y la vacía no borra; otra vez, nada cambia", async () => {
    await aplicarF14();
    const { rep } = await importar("aplicar", archivoF14({ norte: OC }));
    expect(rep.totales).toMatchObject({ nuevas: 0, iguales: 3 });
    expect(rep.oc).toHaveLength(1);
    expect(rep.oc?.[0]).toMatchObject({ proveedor: "Proveedor Norte", accion: "registrada", numero_oc: OC, antes: null, compra: { numero: "C-000201" } });
    expect(compraPorNumero("C-000201").numero_oc).toBe(OC);
    expect(compraPorNumero("C-000202").numero_oc ?? null).toBeNull();
    expect(llamadas("editar_oc_compra")).toHaveLength(1);
    expect(llamadas("editar_oc_compra")[0].args).toMatchObject({ p_antes: null, p_numero_oc: OC, p_motivo: "Importado de planilla.xlsx" });
    const evento = tablaDe("compra_eventos").find((e) => e.accion === "editar_oc");
    expect(evento).toMatchObject({ motivo: "Importado de planilla.xlsx", despues: { numero_oc: OC } });
    expect(compraPorNumero("C-000201").revision).toBe(1);

    const otra = await importar("aplicar", archivoF14({ norte: OC }));
    expect(otra.rep.oc?.map((o) => o.accion)).toEqual(["sin_cambio"]);
    expect(llamadas("editar_oc_compra")).toHaveLength(1);

    const vacia = await importar("aplicar", archivoF14());
    expect(vacia.rep.oc ?? []).toEqual([]);
    expect(compraPorNumero("C-000201").numero_oc).toBe(OC);
  });

  it("previsualizar no escribe nada; la OC viaja fuera de la huella: con la OC puesta, las líneas siguen `igual`", async () => {
    await aplicarF14();
    const { rep } = await importar("previsualizar", archivoF14({ norte: OC }));
    expect(rep.oc?.[0]).toMatchObject({ accion: "registrada", antes: null });
    expect(rep.totales).toMatchObject({ nuevas: 0, iguales: 3, cambiadas: 0 });
    expect(llamadas("editar_oc_compra")).toEqual([]);
    expect(compraPorNumero("C-000201").numero_oc ?? null).toBeNull();
  });

  it("dos filas de una compra con OC distintas: `oc_distinta_en_compra` y no se aplica ninguna", async () => {
    await aplicarF14();
    const filas = archivoF14({ norte: OC });
    filas[1] = { ...filas[1], oc: "4500099999" };
    const { rep } = await importar("aplicar", filas);
    expect(rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_distinta_en_compra" });
    expect(llamadas("editar_oc_compra")).toEqual([]);
  });

  it("una OC con caracteres que no admite: `oc_invalida` y no se aplica", async () => {
    await aplicarF14();
    const { rep } = await importar("aplicar", archivoF14({ norte: "45#001" }));
    expect(rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_invalida" });
    expect(llamadas("editar_oc_compra")).toEqual([]);
  });

  it("dos compras de Proveedor Norte con la misma OC en el archivo: la segunda sale `oc_repetida` y su OC no se aplica, pero sus líneas entran", async () => {
    await aplicarF14();
    const filas = [...archivoF14({ norte: OC }), filaCotv("Proveedor Norte", `${NORTE}-2`, "1", "100", "2026-07-20", { oc: OC })];
    const { rep } = await importar("aplicar", filas);
    expect(rep.aplicadas).toHaveLength(1);
    expect(rep.oc?.map((o) => [o.referencia, o.accion, o.motivo ?? null])).toEqual([[NORTE, "registrada", null], [`${NORTE}-2`, "omitida", "oc_repetida"]]);
    expect(compraPorNumero("C-000203").numero_oc ?? null).toBeNull();
    expect(compraPorNumero("C-000201").numero_oc).toBe(OC);
    expect(llamadas("editar_oc_compra")).toHaveLength(1);
  });

  it("la OC ya está en otra compra viva del mismo proveedor en la base: `oc_repetida` (con el número de esa compra); en otro proveedor solo el aviso `oc_de_otro_proveedor`", async () => {
    await aplicarF14();
    await importar("aplicar", archivoF14({ norte: OC }));
    const nueva = await importar("aplicar", [filaCotv("Proveedor Norte", `${NORTE}-3`, "1", "100", "2026-07-21", { oc: OC.toLowerCase() })]);
    expect(nueva.rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_repetida" });
    expect(nueva.rep.oc?.[0].detalle).toContain("C-000201");
    expect(nueva.rep.aplicadas).toHaveLength(1);

    const otro = await importar("aplicar", [filaCotv("Feria Sur", `${SUR}-2`, "1", "100", "2026-07-22", { oc: OC })]);
    expect(otro.rep.oc?.[0]).toMatchObject({ accion: "registrada", numero_oc: OC });
    expect(otro.rep.oc?.[0].avisos.map((a) => a.aviso)).toEqual(["oc_de_otro_proveedor"]);
    expect(tablaDe("compras").filter((c) => c.numero_oc === OC)).toHaveLength(2);
  });

  it("si `editar_oc_compra` rechaza al aplicar (otra persona la puso entre medio): el reporte lo muestra y las líneas quedaron importadas", async () => {
    reemplazos.editar_oc_compra = () => ({ data: { ok: false, motivo: "oc_repetida", compra: "C-000999" }, error: null });
    const { r, rep } = await importar("aplicar", archivoF14({ norte: OC }));
    expect(r.status).toBe(200);
    expect(rep.aplicadas).toHaveLength(2);
    expect(rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_repetida", compra: { numero: "C-000201" } });
    expect(rep.oc?.[0].detalle).toContain("C-000999");
  });

  it("si la compra cambió de OC entre medio (`oc_cambio`) o la base falla, la OC queda sin aplicar con su motivo y el archivo sigue", async () => {
    await aplicarF14();
    reemplazos.editar_oc_compra = () => ({ data: { ok: false, motivo: "oc_cambio" }, error: null });
    const a = await importar("aplicar", archivoF14({ norte: OC }));
    expect(a.rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_cambio" });
    reemplazos.editar_oc_compra = () => ({ data: null, error: { code: "08006", message: "se cayó la conexión", details: null, hint: null } as never });
    const b = await importar("aplicar", archivoF14({ norte: OC }));
    expect(b.r.status).toBe(200);
    expect(b.rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_no_aplicada" });
  });

  it("si la compra nueva no se pudo aplicar, su OC tampoco: `oc_no_aplicada` y no hay llamada a `editar_oc_compra`", async () => {
    escenario.fallarImportacion = 1;
    const { rep } = await importar("aplicar", archivoF14({ norte: OC }));
    expect(rep.no_aplicadas.length).toBeGreaterThan(0);
    expect(rep.oc?.[0]).toMatchObject({ accion: "omitida", motivo: "oc_no_aplicada" });
    expect(llamadas("editar_oc_compra")).toEqual([]);
  });

  it("sin la columna OC el reporte no trae entradas de OC y no se llama a la función (M8 intacto)", async () => {
    const { rep } = await importar("aplicar", archivoF14());
    expect(rep.oc ?? []).toEqual([]);
    expect(llamadas("editar_oc_compra")).toEqual([]);
  });
});

describe("F32: el comprador y la OC por archivo (decisión 109)", () => {
  it("una compra confirmada ajena: sus líneas nuevas se omiten (`compra_no_borrador`) y la OC `oc_no_editable`; en una compra nueva suya, la OC se registra", async () => {
    await aplicarF14(); // C-000201 y C-000202 confirmadas, de la carga inicial (de otra persona)
    entrarComo("c1");
    const igualesAjenas = archivoF14({ norte: "4500012345" }).slice(0, 2).map((f) => ({ ...f, viaje: "" }));
    const nuevaAjena = filaCotv("Proveedor Norte", NORTE, "3", "100", "2026-07-06", { oc: "4500012345", viaje: "" });
    const prop = filaCotv("Taller Lima Centro", "TL-1", "1", "100", "2026-10-14", { oc: "TL-0001", viaje: "" });
    const { r, rep } = await importar("aplicar", [...igualesAjenas, nuevaAjena, prop], { carga_inicial: false });
    expect(r.status, JSON.stringify(rep)).toBe(200);
    expect(rep.omitidas.map((o) => [o.fila, o.motivo])).toEqual([[3, "compra_no_borrador"]]);
    expect(rep.oc?.map((o) => [o.referencia, o.accion, o.motivo ?? null])).toEqual([[NORTE, "omitida", "oc_no_editable"], ["TL-1", "registrada", null]]);
    expect(compraPorNumero("C-000201").numero_oc ?? null).toBeNull();
    expect(compraPorNumero("C-000203").numero_oc).toBe("TL-0001");
    expect(llamadas("editar_oc_compra")).toHaveLength(1);
  });

  it("su propio borrador: la OC se acepta aunque la compra ya exista", async () => {
    entrarComo("c1");
    await importar("aplicar", [filaCotv("Taller Lima Centro", "TL-1", "1", "100", "2026-10-14", { viaje: "" })], { carga_inicial: false });
    const { rep } = await importar("aplicar", [filaCotv("Taller Lima Centro", "TL-1", "1", "100", "2026-10-14", { oc: "TL-0001", viaje: "" })], { carga_inicial: false });
    expect(rep.oc?.[0]).toMatchObject({ accion: "registrada", numero_oc: "TL-0001" });
    expect(compraPorNumero("C-000201").numero_oc).toBe("TL-0001");
  });
});

// ─── F18: importador de agrupadores con las columnas nuevas ───

describe("F18: importador de agrupadores con las columnas de 08b-1b y el archivo viejo", () => {
  const fe = (n: number, p: Record<string, string>) => ({ fila: n, tipo: "EMBARQUE", codigo: "", nombre: "", viaje: "", embarque: "", tipo_embarque: "", destino: "", fecha_inicio: "", fecha_fin: "", fecha_zarpe: "", fecha_arribo: "", fecha_ingreso_cd: "", inicio_operativo: "", fecha_ingreso_stock: "", origen: "", fecha_salida: "", fecha_llegada: "", puerto: "", referencia_logistica: "", responsable: "", nota: "", ...p });
  const agr = async (modo: "previsualizar" | "aplicar", filas: ReturnType<typeof fe>[]) => {
    const r = await importarAgrupadores(enviar("POST", "/compras/agrupadores/importar", { modo, archivo_nombre: "agrupadores.xlsx", filas }));
    return { r, rep: (await leer<ReporteImportacionAgrupadoresApi>(r)).data };
  };
  const embarque = (codigo: string) => tablaDe("compra_embarques").find((e) => e.codigo === codigo)!;

  it("un archivo viejo (FECHA_SALIDA, FECHA_LLEGADA): se leen como Zarpe e Ingreso CD, el ingreso al stock queda nulo y reimportar da `igual`", async () => {
    const viejo = [fe(1, { codigo: "270401", nombre: "Archivo viejo", fecha_salida: "2027-03-01", fecha_llegada: "2027-04-10" })];
    const ap = await agr("aplicar", viejo);
    expect(ap.r.status, JSON.stringify(ap.rep)).toBe(200);
    expect(embarque("270401")).toMatchObject({ fecha_salida_estimada: "2027-03-01", fecha_llegada_estimada: "2027-04-10", fecha_ingreso_estimada: null, periodo_llegada: "2027-04-01" });
    const otra = await agr("aplicar", viejo);
    expect(otra.rep.resumen).toMatchObject({ nuevas: 0, iguales: 1 });
    expect(llamadas("importar_agrupadores")).toHaveLength(1);
  });

  it("las columnas nuevas llegan a `importar_agrupadores` y a la base: zarpe, arribo, ingreso CD, inicio operativo con hora, ingreso al stock y origen", async () => {
    const nuevo = [fe(1, { codigo: "270402", nombre: "Completo", fecha_zarpe: "2027-03-01", fecha_arribo: "2027-04-02", fecha_ingreso_cd: "2027-04-10", inicio_operativo: "2027-04-12 09:22", fecha_ingreso_stock: "2027-05-03", origen: "Shenzhen" })];
    const ap = await agr("aplicar", nuevo);
    expect(ap.r.status, JSON.stringify(ap.rep)).toBe(200);
    const lote = llamadas("importar_agrupadores")[0].args.p_lote as { embarques: Record<string, unknown>[] };
    expect(lote.embarques[0]).toMatchObject({ fecha_salida_estimada: "2027-03-01", fecha_puerto_estimada: "2027-04-02", fecha_llegada_estimada: "2027-04-10", fecha_inicio_operativo_estimada: "2027-04-12", hora_inicio_operativo: "09:22", fecha_ingreso_estimada: "2027-05-03", origen: "Shenzhen" });
    expect(embarque("270402")).toMatchObject({ fecha_puerto_estimada: "2027-04-02", hora_inicio_operativo: "09:22", fecha_ingreso_estimada: "2027-05-03", origen: "Shenzhen", periodo_llegada: "2027-05-01" });
    expect((await agr("aplicar", nuevo)).rep.resumen).toMatchObject({ nuevas: 0, iguales: 1 });
  });

  it("INICIO_OPERATIVO con fecha y hora, solo con fecha, con hora imposible (`hora_invalida`); FECHA_LLEGADA y FECHA_INGRESO_CD distintas: `fechas_en_conflicto`", async () => {
    const base = { fecha_ingreso_cd: "2026-11-30" };
    const { rep } = await agr("previsualizar", [
      fe(1, { ...base, codigo: "270411", nombre: "Con hora", inicio_operativo: "2026-11-05 09:22" }),
      fe(2, { ...base, codigo: "270412", nombre: "Solo fecha", inicio_operativo: "2026-11-05" }),
      fe(3, { ...base, codigo: "270413", nombre: "Hora mala", inicio_operativo: "2026-11-05 25:10" }),
      fe(4, { codigo: "270414", nombre: "Conflicto", fecha_llegada: "2026-11-28", fecha_ingreso_cd: "2026-11-30" }),
    ]);
    expect(rep.filas.map((f) => [f.fila, f.clasificacion, f.motivo ?? null])).toEqual([
      [1, "nueva", null],
      [2, "nueva", null],
      [3, "omitida", "hora_invalida"],
      [4, "omitida", "fechas_en_conflicto"],
    ]);
    expect(llamadas("importar_agrupadores")).toEqual([]);
    await agr("aplicar", [fe(1, { ...base, codigo: "270411", nombre: "Con hora", inicio_operativo: "2026-11-05 09:22" }), fe(2, { ...base, codigo: "270412", nombre: "Solo fecha", inicio_operativo: "2026-11-05" })]);
    expect(embarque("270411")).toMatchObject({ fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22" });
    expect(embarque("270412")).toMatchObject({ fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: null });
  });
});

// ─── F42: ensayo de la planilla C2 con el importador real ───

describe("F42: ensayo de la planilla C2 (datos inventados) de punta a punta con el importador real", () => {
  const ID_NORTE = "aaaaaaaa-1111-4111-8111-111111111111";
  const ID_SUR = "bbbbbbbb-2222-4222-8222-222222222222";
  const ID_TALLER = "cccccccc-3333-4333-8333-333333333333";
  const V1 = "261001";
  const V2 = "261002";
  const item = (p: Partial<ItemCotv> & Pick<ItemCotv, "item_id" | "created_at">): ItemCotv => ({
    supplier_id: ID_NORTE,
    proveedor: "Proveedor Norte",
    codigo_viaje: V1,
    comprador: "C1",
    nota: null,
    genero: "H",
    mundo: "URBANO",
    linea: "DENIM",
    marca: "ALFA",
    unidades: 100,
    costo_fob: 38,
    ...p,
  });
  /** Viaje 1: Norte en dos días (06-jul y 20-jul) y Feria Sur; viaje 2: Taller y Norte otra vez (otra compra: otro viaje). */
  const items = (): ItemCotv[] => [
    item({ item_id: "n1", created_at: "2026-07-07T04:30:00Z", unidades: 300 }), // 06-jul 23:30 Lima
    item({ item_id: "n2", created_at: "2026-07-07T04:40:00Z", unidades: 120 }),
    item({ item_id: "n3", created_at: "2026-07-20T15:00:00Z", unidades: 80 }), // 20-jul
    item({ item_id: "s1", created_at: "2026-07-10T15:00:00Z", supplier_id: ID_SUR, proveedor: "Feria Sur", unidades: 500 }),
    item({ item_id: "t1", created_at: "2026-07-12T15:00:00Z", supplier_id: ID_TALLER, proveedor: "Taller Lima Centro", codigo_viaje: V2, unidades: 60 }),
    item({ item_id: "n4", created_at: "2026-07-13T15:00:00Z", codigo_viaje: V2, unidades: 40 }),
  ];
  const aFilaImportador = (f: FilaPlanillaC2): Fila => ({
    proveedor: f.PROVEEDOR,
    fecha_compra: f.FECHA_COMPRA,
    referencia: f.REFERENCIA,
    linea_ordinal: f.LINEA_ORDINAL,
    tipo: f.TIPO,
    genero: f.GENERO,
    mundo: f.MUNDO,
    linea: f.LINEA,
    equivalencia: f.EQUIVALENCIA,
    marca: f.MARCA,
    agrupacion_marca: f.AGRUPACION_MARCA,
    tallas: f.TALLAS,
    unidades: f.UNIDADES,
    costo_unitario: f.COSTO_UNITARIO,
    moneda: f.MONEDA,
    llegada: f.LLEGADA,
    entregas: f.ENTREGAS,
    recibidas: f.RECIBIDAS,
    destino: f.DESTINO,
    alcance: f.ALCANCE,
    nota: f.NOTA,
    viaje: f.VIAJE,
    embarque: f.EMBARQUE,
    paquete: f.PAQUETE,
    oc: f.OC,
    // Las informativas viajan en el archivo y el esquema las descarta:
    DIA_REGISTRO: f.DIA_REGISTRO,
    ITEM_COTV: f.ITEM_COTV,
  });
  const planilla = () => agruparItemsCotv(items()).filas.map(aFilaImportador);
  const segundoViaje = () => {
    const base = tablaDe("compra_viajes")[0];
    tablaDe("compra_viajes").push({ ...base, id: "99999999-0000-4000-8000-000000000002", codigo: V2, nombre: "Taller Lima · jul-2026" });
  };

  it("la planilla es aceptada tal cual: 4 compras (proveedor + viaje), una sola FECHA_COMPRA por grupo, LLEGADA 2026-12, sin embarque y 0 omitidas", async () => {
    segundoViaje();
    const filas = planilla();
    const { r, rep } = await importar("previsualizar", filas);
    expect(r.status, JSON.stringify(rep)).toBe(200);
    expect(rep.omitidas).toEqual([]);
    expect(rep.totales).toMatchObject({ recibidas: 6, nuevas: 6, omitidas: 0 });
    expect(rep.compras_a_crear.map((c) => [c.proveedor, c.referencia, c.lineas_nuevas, c.fecha_compra])).toEqual([
      ["Feria Sur", referenciaCotv(V1, ID_SUR), 1, "2026-07-10"],
      ["Proveedor Norte", referenciaCotv(V1, ID_NORTE), 3, "2026-07-06"],
      ["Proveedor Norte", referenciaCotv(V2, ID_NORTE), 1, "2026-07-13"],
      ["Taller Lima Centro", referenciaCotv(V2, ID_TALLER), 1, "2026-07-12"],
    ].sort((a, b) => (filas.findIndex((f) => f.referencia === a[1]) - filas.findIndex((f) => f.referencia === b[1]))));
    expect(rep.lineas.every((l) => l.entregas.length === 1 && l.entregas[0].periodo === "2026-12")).toBe(true);
    // El viaje se asigna una vez por compra (la primera fila); nunca hay embarque ni paquete.
    expect(rep.agrupadores?.every((a) => a.viaje !== null && a.embarque === null && a.paquete === null)).toBe(true);
    expect(rep.agrupadores?.filter((a) => a.resultado === "asignado")).toHaveLength(4);
  });

  it("aplicar: las compras quedan en su viaje, sin embarque, con las entregas de dic-26; reimportar da «igual» y no vuelve a llamar a importar_compra", async () => {
    segundoViaje();
    const ap = await importar("aplicar", planilla());
    expect(ap.rep.aplicadas).toHaveLength(4);
    expect(ap.rep.no_aplicadas).toEqual([]);
    const norte1 = tablaDe("compras").find((c) => c.referencia === referenciaCotv(V1, ID_NORTE))!;
    const norte2 = tablaDe("compras").find((c) => c.referencia === referenciaCotv(V2, ID_NORTE))!;
    expect(norte1.viaje_id).toBe(VIAJE_AGR.v261001);
    expect(norte2.viaje_id).not.toBe(norte1.viaje_id);
    expect(norte1.fecha_compra).toBe("2026-07-06");
    expect(tablaDe("compra_entrega_asignaciones")).toEqual([]);
    const entregas = tablaDe("compra_linea_entregas").filter((e) => String(e.periodo).startsWith("2026-12"));
    const compras = new Set(tablaDe("compras").filter((c) => String(c.referencia).startsWith("COTV-")).map((c) => c.id));
    const lineas = new Set(tablaDe("compra_lineas").filter((l) => compras.has(l.compra_id)).map((l) => l.id));
    expect(entregas.filter((e) => lineas.has(e.linea_id)).reduce((s, e) => s + Number(e.unidades), 0)).toBe(300 + 120 + 80 + 500 + 60 + 40);

    const antes = llamadas("importar_compra").length;
    const otra = await importar("aplicar", planilla());
    expect(otra.rep.totales).toMatchObject({ nuevas: 0, iguales: 6, cambiadas: 0, omitidas: 0 });
    expect(llamadas("importar_compra")).toHaveLength(antes);
    expect(tablaDe("compras").filter((c) => String(c.referencia).startsWith("COTV-"))).toHaveLength(4);
  });

  it("dos grupos con distinta REFERENCIA no se mezclan: partir el grupo de Norte (20-jul con `-2` y su fecha) da una compra más y reimportar es idempotente", async () => {
    segundoViaje();
    const partida = planilla().map((f) => (f.DIA_REGISTRO === "2026-07-20" ? { ...f, referencia: `${f.referencia}-2`, fecha_compra: "2026-07-20" } : f));
    const { rep } = await importar("previsualizar", partida);
    expect(rep.omitidas).toEqual([]);
    expect(rep.compras_a_crear).toHaveLength(5);
    const norte = rep.compras_a_crear.filter((c) => c.referencia.startsWith(referenciaCotv(V1, ID_NORTE)));
    expect(norte.map((c) => [c.referencia.endsWith("-2"), c.fecha_compra, c.lineas_nuevas]).sort()).toEqual([[false, "2026-07-06", 2], [true, "2026-07-20", 1]]);
    await importar("aplicar", partida);
    const otra = await importar("aplicar", partida);
    expect(otra.rep.totales).toMatchObject({ nuevas: 0, iguales: 6 });
    expect(tablaDe("compras").filter((c) => String(c.referencia).startsWith("COTV-"))).toHaveLength(5);
  });
});
