import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { IDS, clienteFalso, escenario, reiniciarEscenario, tablaDe, type Fila } from "./compras.fake-db";

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

import { GET as listaCompras } from "@/app/api/compras/route";
import { GET as unaCompra } from "@/app/api/compras/[id]/route";
import { reiniciarCaches } from "@/lib/flujo/cache";
import { hojasCompras } from "@/lib/flujo/excel";
import { reiniciarCacheCatalogo } from "@/lib/compras/servicio";
import { indexarLineaTiempo, tiempoDeCompra } from "@/lib/compras/linea-tiempo";
import { ENCABEZADOS_LINEA_DE_TIEMPO } from "@/lib/compras/agrupadores/excel";
import type { CompraApi } from "@/lib/compras/tipos-api";
import { COMPRA } from "./compras.fixture";

/**
 * Línea de tiempo, próximo hito y lista de Compras con agrupadores (08b-1b §3.4; F15, F25, F26, F33 y F41) con el servicio REAL y la
 * base en memoria. «Hoy» es 2026-10-15 (Lima). Todo inventado: embarques, paquetes y asignaciones sembrados en las tablas falsas.
 */

const URL_BASE = "http://localhost/api";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const lista = async (consulta = "") => (await leer<CompraApi[]>(await listaCompras(get("/compras", consulta)))).data;
const detalle = async (id: string) => (await leer<CompraApi>(await unaCompra(get(`/compras/${id}`), { params: Promise.resolve({ id }) }))).data;
const uuid = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C12 = COMPRA.c12; // Proveedor Norte · 500 u en nov-2026
const C09 = COMPRA.c09; // Feria Sur · 500 u
const entregaC12 = IDS.entregaC12;
const entregaC09 = IDS.entregaC09;

const embarque = (id: string, codigo: string, p: Fila = {}): Fila => ({
  id,
  codigo,
  nombre: `Embarque ${codigo}`,
  tipo: "importacion",
  viaje_id: null,
  responsable_id: null,
  referencia_logistica: null,
  puerto_embarque: null,
  fecha_salida_estimada: null,
  fecha_puerto_estimada: null,
  fecha_llegada_estimada: "2026-11-15",
  fecha_inicio_operativo_estimada: null,
  hora_inicio_operativo: null,
  fecha_ingreso_estimada: null,
  fecha_llegada_real: null,
  periodo_llegada: "2026-11-01",
  hito_confirmado: null,
  origen: null,
  estado: "planificado",
  nota: null,
  revision: 0,
  created_at: "2026-10-01T10:00:00.000Z",
  updated_at: "2026-10-01T10:00:00.000Z",
  ...p,
});
const asignacion = (id: string, entrega_id: string, embarque_id: string, unidades: number, paquete_id: string | null = null): Fila => ({ id, entrega_id, embarque_id, paquete_id, unidades });

const E1 = uuid("b", 1); // 261101: Zarpe confirmado el 05-oct, Arribo 10-oct (vencido), Ingreso CD 15-nov
const E2 = uuid("b", 2); // California: Ingreso CD 15-dic
const E3 = uuid("b", 3); // Nueva York: Ingreso CD 15-ene-27

function sembrarF25() {
  tablaDe("compra_embarques").push(
    embarque(E1, "261101", { fecha_salida_estimada: "2026-10-05", fecha_puerto_estimada: "2026-10-10", fecha_llegada_estimada: "2026-11-15", hito_confirmado: "zarpe", origen: "Shenzhen" }),
  );
  tablaDe("compra_entrega_asignaciones").push(asignacion(uuid("d", 1), entregaC12, E1, 300));
}

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

describe("F25: línea de tiempo y próximo hito de una compra con un embarque y algo sin embarque", () => {
  it("el detalle: un tramo por embarque (300) y «Sin embarque» (200) siempre Pendiente; Σ unidades = Σ de las entregas", async () => {
    sembrarF25();
    const c = await detalle(C12);
    expect(c.linea_de_tiempo.map((t) => [t.embarque?.codigo ?? null, t.unidades, t.mes])).toEqual([
      ["261101", 300, "2026-11"],
      [null, 200, "2026-11"],
    ]);
    expect(c.linea_de_tiempo.reduce((s, t) => s + t.unidades, 0)).toBe(c.totales.unidades);
    const e = c.linea_de_tiempo[0];
    expect(e.hitos.map((h) => [h.hito, h.estado, h.fecha])).toEqual([
      ["orden_compra", "real", "2026-10-14"],
      ["zarpe", "real", "2026-10-05"],
      ["arribo", "vencido", "2026-10-10"],
      ["ingreso_cd", "previsto", "2026-11-15"],
      ["inicio_operativo", "pendiente", null],
      ["ingreso_stock", "previsto", "2026-11-15"],
    ]);
    const sin = c.linea_de_tiempo[1];
    expect(sin.embarque).toBeNull();
    expect(sin.hitos[0]).toMatchObject({ hito: "orden_compra", estado: "real" });
    expect(sin.hitos.slice(1).every((h) => h.estado === "pendiente" && h.fecha === null)).toBe(true);
  });

  it("el próximo hito es el vencido más antiguo: Arribo del 10-oct, con el código del embarque y «+1 tramo» (lo sin embarque)", async () => {
    sembrarF25();
    const c = (await lista()).find((x) => x.id === C12);
    expect(c?.proximo_hito).toEqual({ hito: "arribo", fecha: "2026-10-10", hora: null, estado: "vencido", embarque_codigo: "261101", tramos_mas: 1 });
    // El detalle y la lista dicen lo mismo.
    expect((await detalle(C12)).proximo_hito).toEqual(c?.proximo_hito);
  });

  it("el detalle trae la fecha original y las reprogramaciones del resumen de hitos (solo de los embarques de la compra); la lista, en 0", async () => {
    sembrarF25();
    tablaDe("compra_embarques").push(embarque(E2, "California", { fecha_llegada_estimada: "2026-12-15", periodo_llegada: "2026-12-01" }));
    escenario.resumenHitos = [
      { embarque_id: E1, paquete_id: null, hito: "arribo", fecha_original: "2026-10-01", reprogramaciones: 2, ultima_causa: "naviera" },
      { embarque_id: E2, paquete_id: null, hito: "arribo", fecha_original: "2026-12-01", reprogramaciones: 9, ultima_causa: "otro" },
    ];
    const c = await detalle(C12);
    expect(c.linea_de_tiempo[0].hitos.find((h) => h.hito === "arribo")).toMatchObject({ fecha_original: "2026-10-01", reprogramaciones: 2, retraso_dias: 9 });
    const llamada = escenario.llamadas.filter((l) => l.nombre === "agrupador_hitos_resumen");
    expect(llamada).toHaveLength(1);
    expect(llamada[0].args.p_embarques).toEqual([E1]);
    const enLista = (await lista()).find((x) => x.id === C12);
    expect(enLista?.linea_de_tiempo[0].hitos.every((h) => h.reprogramaciones === 0)).toBe(true);
    expect(escenario.llamadas.filter((l) => l.nombre === "agrupador_hitos_resumen")).toHaveLength(1); // la lista no lo pide
  });

  it("sin ningún embarque: un solo tramo «Sin embarque» por mes y su próximo hito es el ingreso al stock pendiente", async () => {
    const c = await detalle(C12);
    expect(c.linea_de_tiempo).toHaveLength(1);
    expect(c.linea_de_tiempo[0]).toMatchObject({ embarque: null, paquete: null, unidades: 500, mes: "2026-11" });
    expect(c.proximo_hito).toMatchObject({ hito: "ingreso_stock", fecha: null, estado: "pendiente", embarque_codigo: null, tramos_mas: 0 });
  });

  it("una compra cancelada conserva su línea de tiempo pero no tiene próximo hito", async () => {
    sembrarF25();
    tablaDe("compras").find((c) => c.id === C12)!.estado = "cancelada";
    const c = await detalle(C12);
    expect(c.linea_de_tiempo).toHaveLength(2);
    expect(c.proximo_hito).toBeNull();
  });
});

describe("F15: una compra repartida entre dos embarques tiene dos tramos y nada queda sin embarque", () => {
  it("C-000009 (500 u): 250 en California (dic) y 250 en Nueva York (ene), cada tramo en su mes; sin tramo «Sin embarque»", async () => {
    tablaDe("compra_embarques").push(
      embarque(E2, "California", { fecha_llegada_estimada: "2026-12-15", periodo_llegada: "2026-12-01", origen: "California" }),
      embarque(E3, "Nueva York", { fecha_llegada_estimada: "2027-01-15", periodo_llegada: "2027-01-01" }),
    );
    tablaDe("compra_entrega_asignaciones").push(asignacion(uuid("d", 2), entregaC09, E2, 250), asignacion(uuid("d", 3), entregaC09, E3, 250));
    const c = await detalle(C09);
    expect(c.linea_de_tiempo.map((t) => [t.embarque?.codigo, t.unidades, t.mes])).toEqual([
      ["California", 250, "2026-12"],
      ["Nueva York", 250, "2027-01"],
    ]);
    expect(c.linea_de_tiempo.every((t) => t.embarque !== null)).toBe(true);
    expect(c.proximo_hito?.tramos_mas).toBe(1);
  });
});

describe("filtro proximo_hito=vencido (no incluye por_confirmar)", () => {
  it("solo salen las compras con algún hito `vencido`", async () => {
    sembrarF25();
    expect((await lista("?proximo_hito=vencido")).map((c) => c.numero)).toEqual(["C-000012"]);
    expect((await lista()).length).toBeGreaterThan(1);
  });

  it("un ingreso al stock `por_confirmar` (ya pasó, con el Ingreso CD confirmado) NO cuenta como vencido y sí es el próximo hito", async () => {
    tablaDe("compra_embarques").push(
      embarque(E2, "California", { fecha_salida_estimada: "2026-09-01", fecha_puerto_estimada: "2026-09-20", fecha_llegada_estimada: "2026-10-02", fecha_inicio_operativo_estimada: "2026-10-03", hito_confirmado: "inicio_operativo", periodo_llegada: "2026-10-01" }),
    );
    tablaDe("compra_entrega_asignaciones").push(asignacion(uuid("d", 4), entregaC09, E2, 500));
    const c = (await lista()).find((x) => x.id === C09);
    expect(c?.linea_de_tiempo[0].hitos.find((h) => h.hito === "ingreso_stock")?.estado).toBe("por_confirmar");
    expect(c?.proximo_hito).toMatchObject({ hito: "ingreso_stock", estado: "por_confirmar" });
    expect((await lista("?proximo_hito=vencido")).map((x) => x.id)).not.toContain(C09);
  });

  it("un valor distinto de `vencido` es 400", async () => {
    const r = await listaCompras(get("/compras", "?proximo_hito=todos"));
    expect(r.status).toBe(400);
  });
});

describe("F26: el Excel de Compras lleva la OC y la hoja LINEA_DE_TIEMPO", () => {
  it("COMPRAS trae la columna OC y LINEA_DE_TIEMPO una fila por compra y tramo, con la OC, el viaje y el estado en texto", async () => {
    sembrarF25();
    tablaDe("compras").find((c) => c.id === C12)!.numero_oc = "4500012345";
    const compras = await lista();
    const hojas = hojasCompras(compras);
    expect(hojas.COMPRAS[0].slice(0, 2)).toEqual(["NÚMERO", "OC"]);
    expect(hojas.COMPRAS.find((f) => f[0] === "C-000012")?.[1]).toBe("4500012345");
    const l = hojas.LINEA_DE_TIEMPO;
    expect(l[0]).toEqual([...ENCABEZADOS_LINEA_DE_TIEMPO]);
    const filas = l.slice(1).filter((f) => f[1] === "C-000012");
    expect(filas).toHaveLength(2);
    const col = (n: string) => ENCABEZADOS_LINEA_DE_TIEMPO.indexOf(n as never);
    expect(filas[0][col("OC")]).toBe("4500012345");
    expect(filas[0][col("EMBARQUE")]).toBe("261101");
    expect(filas[0][col("ESTADO ARRIBO")]).toBe("Vencido");
    expect(filas[1][col("EMBARQUE")]).toBe("Sin embarque");
    expect(filas[1][col("ESTADO ZARPE")]).toBe("Pendiente");
    // una fila por compra y tramo de TODAS las compras
    expect(l.length - 1).toBe(compras.reduce((s, c) => s + c.linea_de_tiempo.length, 0));
  });
});

describe("F41: más de 1 000 asignaciones y un cliente que corta en 1 000 filas", () => {
  /** 150 compras de 8 líneas (una entrega y una asignación por línea = 1 200 asignaciones) repartidas entre 12 embarques de fechas distintas. */
  function sembrarMuchas() {
    const embarques = Array.from({ length: 12 }, (_, i) => {
      const dia = String(1 + i * 2).padStart(2, "0");
      return embarque(uuid("b", 100 + i), `26${String(i + 1).padStart(2, "0")}01`, {
        fecha_salida_estimada: `2026-09-${dia}`,
        fecha_puerto_estimada: `2026-10-${dia}`, // los primeros ya vencieron (hoy 15-oct)
        fecha_llegada_estimada: `2026-11-${dia}`,
        hito_confirmado: i % 3 === 0 ? "zarpe" : null,
      });
    });
    tablaDe("compra_embarques").push(...embarques);
    for (let c = 0; c < 150; c++) {
      const compra = uuid("5", 1000 + c);
      tablaDe("compras").push({
        ...tablaDe("compras").find((x) => x.id === C12)!,
        id: compra,
        numero: `C-${String(5000 + c).padStart(6, "0")}`,
        referencia: null,
        numero_oc: null,
      });
      for (let l = 0; l < 8; l++) {
        const n = c * 8 + l;
        const linea = uuid("6", 1000 + n);
        const entrega = uuid("7", 1000 + n);
        tablaDe("compra_lineas").push({ ...tablaDe("compra_lineas").find((x) => x.compra_id === C12)!, id: linea, compra_id: compra, unidades: 10, unidades_recibidas: 0, clave_importacion: null });
        tablaDe("compra_linea_entregas").push({ ...tablaDe("compra_linea_entregas").find((x) => x.linea_id === tablaDe("compra_lineas").find((y) => y.compra_id === C12)!.id)!, id: entrega, linea_id: linea, unidades: 10 });
        tablaDe("compra_entrega_asignaciones").push(asignacion(uuid("8", 1000 + n), entrega, uuid("b", 100 + ((c + l) % 12)), 10));
      }
    }
  }

  it("el próximo hito de las 150 compras es el mismo que con todas las filas en memoria y ninguna pierde tramos", async () => {
    sembrarMuchas();
    expect(tablaDe("compra_entrega_asignaciones")).toHaveLength(1200);
    const compras = (await lista()).filter((c) => c.numero >= "C-005000");
    expect(compras).toHaveLength(150);

    const ix = indexarLineaTiempo({ embarques: tablaDe("compra_embarques") as never, paquetes: [], asignaciones: tablaDe("compra_entrega_asignaciones") as never });
    for (const c of compras) {
      const entregas = c.lineas.flatMap((l) => l.entregas);
      const esperado = tiempoDeCompra({ fecha_compra: c.fecha_compra, entregas }, ix, "2026-10-15");
      expect(c.linea_de_tiempo, c.numero).toHaveLength(8);
      expect(c.linea_de_tiempo.reduce((s, t) => s + t.unidades, 0), c.numero).toBe(80);
      expect(c.linea_de_tiempo, c.numero).toEqual(esperado.linea_de_tiempo);
      expect(c.proximo_hito, c.numero).toEqual(esperado.proximo_hito);
    }
    // No todas iguales: la prueba distingue un próximo hito de otro (si se perdieran filas, cambiaría para varias compras).
    expect(new Set(compras.map((c) => `${c.proximo_hito?.embarque_codigo}|${c.proximo_hito?.fecha}`)).size).toBeGreaterThan(1);
    expect((await lista("?proximo_hito=vencido")).filter((c) => c.numero >= "C-005000")).toHaveLength(150);
  });

  it("el doble corta de verdad en 1 000 filas por petición (si la lectura no paginara, se perderían 200 asignaciones)", async () => {
    sembrarMuchas();
    const cliente = clienteFalso();
    const { data } = await cliente.from("compra_entrega_asignaciones").select().order("id").range(0, 1999);
    expect(data).toHaveLength(1000);
    const compras = (await lista()).filter((c) => c.numero >= "C-005000");
    expect(compras.every((c) => c.linea_de_tiempo.length === 8)).toBe(true);
  });
});
