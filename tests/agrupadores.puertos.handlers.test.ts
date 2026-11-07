import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { tablaDe } from "./compras.fake-db";
import { entrarComo, escriturasAgr, iniciarAgrupadores } from "./agrupadores.fake-db";

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

import { GET as listaEmbarques } from "@/app/api/compras/embarques/route";
import { GET as unEmbarque } from "@/app/api/compras/embarques/[id]/route";
import { POST as importarAgrupadores } from "@/app/api/compras/agrupadores/importar/route";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { puertoDistintoDelHabitual, puertosHabituales } from "@/lib/compras/agrupadores/puertos";
import type { EmbarqueApi, EmbarqueDetalleApi, ReporteImportacionAgrupadoresApi } from "@/lib/compras/agrupadores/tipos-api";
import { COMPRA_AGR, EMBARQUE_AGR, PROVEEDOR_AGR } from "./agrupadores.fixture";

/**
 * R29 (08c, E1) · Ganchos de 08b-1: `EmbarqueApi.puertos_habituales` y el aviso `puerto_distinto_del_habitual` del importador de agrupadores.
 * Servicio y handlers REALES con la base en memoria de agrupadores. Todo inventado: «Feria Sur» (Ningbo) y «Proveedor Norte» (Shenzhen).
 */

const URL_BASE = "http://localhost/api";
const get = (ruta: string) => new NextRequest(`${URL_BASE}${ruta}`);
const enviar = (cuerpo: unknown) => new NextRequest(`${URL_BASE}/compras/agrupadores/importar`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

const E = EMBARQUE_AGR;
const ponerPuerto = (proveedorId: string, puerto: string | null) => {
  const p = tablaDe("proveedores").find((x) => x.id === proveedorId);
  if (p) p.puerto_embarque = puerto;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  iniciarAgrupadores({ caso1: true });
  entrarComo("c1");
  reiniciarCaches();
  reiniciarCacheCatalogo();
});
afterEach(() => {
  vi.useRealTimers();
});

const embarqueDelListado = async (id: string) => (await leer<{ embarques: EmbarqueApi[] }>(await listaEmbarques(get("/compras/embarques")))).data.embarques.find((e) => e.id === id);

describe("R29 · EmbarqueApi.puertos_habituales", () => {
  it("trae el puerto del proveedor de las compras del embarque, en la lista y en el detalle", async () => {
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    expect((await embarqueDelListado(E.e261101))?.puertos_habituales).toEqual(["Ningbo"]);
    const detalle = (await leer<{ embarque: EmbarqueDetalleApi }>(await unEmbarque(get("/x"), ctx(E.e261101)))).data.embarque;
    expect(detalle.puertos_habituales).toEqual(["Ningbo"]);
    // El puerto real del envío (decisión 96) sigue siendo suyo y no se mezcla con la sugerencia.
    expect(detalle.puerto_embarque).toBe("Puerto Sur");
  });

  it("sin repetir y en orden alfabético cuando el embarque tiene compras de varios proveedores", async () => {
    // La entrega de Dic (C-000101, Feria Sur) y una asignación de otra compra de Proveedor Norte en el mismo embarque 261201.
    const lineaNorte = tablaDe("compra_lineas").find((l) => l.compra_id !== COMPRA_AGR.c101 && l.tipo === "especifica") ?? tablaDe("compra_lineas").find((l) => l.compra_id !== COMPRA_AGR.c101);
    const entregaNorte = tablaDe("compra_linea_entregas").find((e) => e.linea_id === lineaNorte?.id);
    expect(entregaNorte, "el escenario trae una entrega de otra compra").toBeDefined();
    tablaDe("compra_entrega_asignaciones").push({ id: "b9000000-0000-4000-8000-000000000a01", entrega_id: entregaNorte?.id, embarque_id: E.e261201, paquete_id: null, unidades: 10, activo: true, created_at: "2026-10-03T10:00:00.000Z", updated_at: "2026-10-03T10:00:00.000Z" });
    const proveedorDeLaOtra = tablaDe("compras").find((c) => c.id === lineaNorte?.compra_id)?.proveedor_id as string;
    ponerPuerto(PROVEEDOR_AGR.feria, "Shenzhen");
    ponerPuerto(proveedorDeLaOtra, "ningbo ");
    expect((await embarqueDelListado(E.e261201))?.puertos_habituales).toEqual(["ningbo", "Shenzhen"]);
    ponerPuerto(proveedorDeLaOtra, "SHENZHEN");
    expect((await embarqueDelListado(E.e261201))?.puertos_habituales).toEqual(["Shenzhen"]);
  });

  it("vacía si ningún proveedor del embarque tiene puerto, o si el embarque no tiene compras", async () => {
    expect((await embarqueDelListado(E.e261101))?.puertos_habituales).toEqual([]);
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    expect((await embarqueDelListado(E.l261102))?.puertos_habituales).toEqual([]);
  });
});

const filaEmbarque = (puerto: string, extra: Record<string, unknown> = {}) => ({
  fila: 1,
  tipo: "EMBARQUE",
  codigo: "261101",
  nombre: "Nov-26 · Feria Sur",
  fecha_llegada: "2026-11-20",
  puerto,
  ...extra,
});
const previsualizar = async (filas: Record<string, unknown>[]) => {
  const r = await importarAgrupadores(enviar({ modo: "previsualizar", archivo_nombre: "agrupadores.csv", filas }));
  return { r, cuerpo: await leer<ReporteImportacionAgrupadoresApi>(r) };
};

describe("R29 · aviso puerto_distinto_del_habitual en el importador de agrupadores", () => {
  it("avisa cuando el puerto de la hoja no está entre los habituales de los proveedores del embarque", async () => {
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    const { r, cuerpo } = await previsualizar([filaEmbarque("Shanghái")]);
    expect(r.status).toBe(200);
    expect(cuerpo.data.filas[0].avisos).toContain("puerto_distinto_del_habitual");
  });

  it("no avisa si el puerto coincide (sin tildes, mayúsculas ni espacios de más)", async () => {
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    for (const escrito of ["Ningbo", "NINGBO", " ningbo  "]) {
      const { cuerpo } = await previsualizar([filaEmbarque(escrito)]);
      expect(cuerpo.data.filas[0].avisos, escrito).not.toContain("puerto_distinto_del_habitual");
    }
  });

  it("no avisa si la lista de habituales está vacía (el proveedor no tiene puerto)", async () => {
    const { cuerpo } = await previsualizar([filaEmbarque("Shanghái")]);
    expect(cuerpo.data.filas[0].avisos).not.toContain("puerto_distinto_del_habitual");
  });

  it("no avisa si la fila no trae puerto, ni en un embarque nuevo (aún sin compras)", async () => {
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    const sinPuerto = await previsualizar([filaEmbarque("")]);
    expect(sinPuerto.cuerpo.data.filas[0].avisos).not.toContain("puerto_distinto_del_habitual");
    const nuevo = await previsualizar([filaEmbarque("Shanghái", { codigo: "261999", nombre: "Embarque nuevo", fecha_llegada: "2026-12-30" })]);
    expect(nuevo.cuerpo.data.filas[0]).toMatchObject({ clasificacion: "nueva" });
    expect(nuevo.cuerpo.data.filas[0].avisos).not.toContain("puerto_distinto_del_habitual");
  });

  it("es informativo: no cambia la clasificación ni impide aplicar lo nuevo, y no escribe al previsualizar", async () => {
    ponerPuerto(PROVEEDOR_AGR.feria, "Ningbo");
    const { cuerpo } = await previsualizar([filaEmbarque("Shanghái"), filaEmbarque("Callao", { fila: 2, codigo: "261998", nombre: "Embarque nuevo", fecha_llegada: "2026-12-30" })]);
    expect(cuerpo.data.filas[0].clasificacion).toBe("cambiada");
    expect(cuerpo.data.filas[0].motivo).toBe("cambiada_requiere_edicion");
    expect(cuerpo.data.filas[1].clasificacion).toBe("nueva");
    expect(escriturasAgr()).toEqual([]);
  });
});

describe("R29 · funciones puras de puertos", () => {
  it("puertosHabituales: sin nulos ni vacíos, sin repetir (sin tildes ni mayúsculas) y en orden alfabético", () => {
    expect(puertosHabituales([null, undefined, "", "  ", "Shenzhen", "Ningbo", "NINGBO", " shenzhen "])).toEqual(["Ningbo", "Shenzhen"]);
    expect(puertosHabituales([])).toEqual([]);
    expect(puertosHabituales(["Ñandú", "Álamo", "Zárate"])).toEqual(["Álamo", "Ñandú", "Zárate"]);
  });

  it("puertoDistintoDelHabitual: sin puerto o sin habituales nunca avisa", () => {
    expect(puertoDistintoDelHabitual("Shanghái", ["Ningbo"])).toBe(true);
    expect(puertoDistintoDelHabitual("shanghai", ["Shanghái"])).toBe(false);
    expect(puertoDistintoDelHabitual("Shanghái", [])).toBe(false);
    expect(puertoDistintoDelHabitual(null, ["Ningbo"])).toBe(false);
    expect(puertoDistintoDelHabitual("   ", ["Ningbo"])).toBe(false);
  });
});
