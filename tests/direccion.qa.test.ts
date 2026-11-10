import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { base, estadoDireccion, estadoRol, fotoDeLaBase, reiniciar, type Fila } from "./direccion.fake-db";
import { aprobarCrecimientosFalsos, catalogoFalso, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

// El montaje de las pruebas de rutas de M7 (`tests/direccion.cierre.test.ts`): proyecciones creadas, calculadas, decididas y cerradas por las rutas
// de M7 sobre su base falsa, con el cliente falso de dirección (que añade las cuatro funciones de la 0041) y sus guards por rol.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./direccion.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./direccion.fake-db");
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

import { POST as aprobar } from "@/app/api/direccion/aprobaciones/route";
import { GET as estadoRuta } from "@/app/api/direccion/estado/route";
import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { GET as cerrada } from "@/app/api/proyeccion/cerrada/route";
import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { GET as mensual } from "@/app/api/proyeccion/proyecciones/[id]/mensual/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { MENOS, conSigno, frase, miles, parte, pct, pp } from "@/lib/direccion/textos";
import type { TableroApi } from "@/lib/direccion/tipos-api";
import { leerCerradaParaFlujo } from "@/lib/proyeccion/servicio";
import type { ProyeccionApi, RespuestaMensualApi } from "@/lib/proyeccion/tipos-api";
import { construirVenta, tiendas as tiendasFixture } from "./proyeccion.fixture";

/**
 * Ficha 14 · §6.4, `tests/direccion.qa.test.ts` (lo escribe `backend`: `qa` no escribe código). Cubre lo que las demás pruebas no cubren con el
 * montaje de M7: R1 a través de `GET …/mensual` de M7 sobre una proyección calculada por M7, R25 (abrir el tablero y aprobar no cambian ni un byte de
 * `GET /api/proyeccion/cerrada`, de lo que el flujo lee de la cerrada, de la vista mensual ni de la matriz) y que los textos que arma el servidor no
 * llevan «..» ni el guion como signo menos. Sintético; ningún dato real.
 *
 * No viable aquí: `GET /api/flujo` entero (pide `flujo_huella_base` y las demás lecturas de M8, que la base falsa de dirección no tiene). En su lugar se
 * compara `leerCerradaParaFlujo`, que es exactamente lo que el flujo lee de la proyección; el resto del flujo no lee nada de M14 (R24, prueba estática).
 */

const URL_M7 = "http://localhost/api/proyeccion";
const enviar = (cuerpo: unknown = {}) => new NextRequest(`${URL_M7}/x`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const poner = (cuerpo: unknown) => new NextRequest(`${URL_M7}/x`, { method: "PUT", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
/** La base falsa entera, sin las tablas vacías (leer una tabla que no existe la crea vacía en la base falsa: no es una escritura). */
const fotoTablas = (): Record<string, Fila[]> => Object.fromEntries(Object.entries(JSON.parse(fotoDeLaBase()) as Record<string, Fila[]>).filter(([, filas]) => filas.length > 0));
const verTablero = async (consulta: Record<string, string>): Promise<TableroApi> => {
  const r = await tablero(new NextRequest(`http://localhost/api/direccion/tablero?${new URLSearchParams(consulta).toString()}`));
  const c = await leer<TableroApi>(r);
  expect(r.status, JSON.stringify(c).slice(0, 300)).toBe(200);
  return c.data;
};

async function nueva(): Promise<string> {
  const r = await crear(new NextRequest(`${URL_M7}/proyecciones`, { method: "POST", body: JSON.stringify({ nombre: "Proyección 2026–2027", parametros: { crecimiento_pct_defecto: 5 } }), headers: { "content-type": "application/json" } }));
  const c = await leer<ProyeccionApi>(r);
  expect(r.status, JSON.stringify(c).slice(0, 300)).toBe(201);
  return c.data.id;
}

async function decidirYCerrar(id: string) {
  for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === null)) {
    for (const anio of [2026, 2027]) {
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
      if (a.propuesto !== null && (a.propuesto as number) >= 100) expect((await decidirFila(poner({ origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }))).status).toBe(200);
    }
  }
  for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
    expect((await decidirTienda(poner({ origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }))).status).toBe(200);
  }
  const r = await cerrar(enviar(), ctx(id));
  expect(r.status, JSON.stringify(await leer(r.clone())).slice(0, 300)).toBe(200);
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  vaciarCachesDireccion();
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
  estadoRol.rol = "planner";
  // `tablero_proyeccion` (falsa) agrupa por género y mundo con la tabla `genero_mundo_linea`: la del catálogo de M7.
  for (const [gml, n] of catalogoFalso().nodos) estadoDireccion.nodos.set(gml, { genero_id: n.genero_id, mundo_id: n.mundo_id });
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

describe("R1 · lo proyectado del tablero es lo que muestra la vista mensual de M7", () => {
  it("sin filtros y bloque «Todas», cada mes y el total de 2026 cierre y de 2027 son los de `GET …/mensual` (calculada y después cerrada)", async () => {
    const id = await nueva();
    for (const paso of ["calculada", "cerrada"] as const) {
      if (paso === "cerrada") await decidirYCerrar(id);
      vaciarCachesDireccion();
      const r = await mensual(new NextRequest(`${URL_M7}/proyecciones/${id}/mensual`), ctx(id));
      const m = (await leer<RespuestaMensualApi>(r)).data;
      expect(r.status).toBe(200);
      const t = await verTablero({ proyeccion_id: id });
      for (const [anio, clave] of [
        [2026, "cierre_2026"],
        [2027, "proyectado_2027"],
      ] as const) {
        const deM7 = m.totales.find((x) => x.anio === anio);
        const fila = t.tabla_mensual.filas.find((f) => f.clave === clave);
        expect(deM7, `${paso} ${anio}`).toBeDefined();
        expect(fila?.meses, `${paso} ${anio}`).toEqual(deM7?.meses);
        expect(fila?.total, `${paso} ${anio}`).toBe(deM7?.total);
      }
      expect(t.kpis.cierre).toBe(m.totales.find((x) => x.anio === 2026)?.total);
      expect(t.kpis.siguiente).toBe(m.totales.find((x) => x.anio === 2027)?.total);
      expect(t.kpis.siguiente).toBeGreaterThan(0);
    }
  });
});

describe("R25 · abrir el tablero y aprobar no cambian la cerrada ni lo que lee el flujo", () => {
  it("`GET /api/proyeccion/cerrada`, la cerrada del flujo, la vista mensual y la matriz son iguales byte a byte antes y después", async () => {
    const id = await nueva();
    await decidirYCerrar(id);
    const foto = async () => ({
      cerrada2026: await (await cerrada(new NextRequest(`${URL_M7}/cerrada?anio=2026`))).text(),
      cerrada2027: await (await cerrada(new NextRequest(`${URL_M7}/cerrada?anio=2027`))).text(),
      flujo2026: JSON.stringify((await leerCerradaParaFlujo(2026)).data),
      flujo2027: JSON.stringify((await leerCerradaParaFlujo(2027)).data),
      mensual: await (await mensual(new NextRequest(`${URL_M7}/proyecciones/${id}/mensual`), ctx(id))).text(),
      matriz: await (await matriz(new NextRequest(`${URL_M7}/proyecciones/${id}/matriz`), ctx(id))).text(),
    });
    const antes = await foto();
    expect(JSON.parse(antes.cerrada2026).data.proyeccion.id).toBe(id);
    expect(antes.flujo2026).not.toBe("null");
    const tablasAntes = fotoTablas();

    // Abrir el tablero con varios filtros (como admin y como planner) y pedir el estado.
    for (const rol of ["planner", "admin"] as const) {
      estadoRol.rol = rol;
      // (Sin filtros de producto: los maestros de esta base falsa no traen el árbol de géneros; esos filtros se prueban en `direccion.tablero.test.ts`.)
      for (const consulta of [{}, { desglose: "genero" }, { desglose: "linea" }, { bloque: "mismas" }, { bloque: "cierres" }, { desglose: "marca" }, { desglose: "tienda" }, { desglose: "temporada", bloque: "nuevas" }] as Record<string, string>[]) {
        await verTablero({ proyeccion_id: id, ...consulta });
      }
      expect((await estadoRuta(new NextRequest(`http://localhost/api/direccion/estado?proyeccion_id=${id}`))).status).toBe(200);
    }
    expect(fotoTablas()).toEqual(tablasAntes);
    expect(await foto()).toEqual(antes);

    // Aprobar: solo añade una fila a `aprobaciones_direccion`.
    estadoRol.rol = "admin";
    const t = await verTablero({ proyeccion_id: id });
    const r = await aprobar(
      new NextRequest("http://localhost/api/direccion/aprobaciones", {
        method: "POST",
        body: JSON.stringify({ proyeccion_id: id, huella_vista: t.huella, resultado: "aprobada", confirmo_revision: true }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(r.status, JSON.stringify(await leer(r.clone())).slice(0, 300)).toBe(201);
    const tablasDespues = fotoTablas();
    const tablasPrevias = { ...tablasAntes };
    expect(tablasDespues.aprobaciones_direccion?.length ?? 0).toBe((tablasPrevias.aprobaciones_direccion?.length ?? 0) + 1);
    delete tablasDespues.aprobaciones_direccion;
    delete tablasPrevias.aprobaciones_direccion;
    expect(tablasDespues).toEqual(tablasPrevias);
    expect(await foto()).toEqual(antes);
  });
});

describe("textos del servidor: un solo punto y el signo menos tipográfico", () => {
  it("`miles`, `conSigno`, `pct`, `pp` y `parte` usan «−» (U+2212), nunca el guion", () => {
    expect(MENOS).toBe("−");
    expect(miles(-2961)).toBe("−2,961");
    expect(miles(1214)).toBe("1,214");
    expect(conSigno(-1)).toBe("−1");
    expect(pct(-3.94)).toBe("−3.9 %");
    expect(pp(-4.3)).toBe("−4.3 pp");
    expect(parte(-0.05)).toBe("−5.0 %");
    for (const t of [miles(-5), conSigno(-5), pct(-5), pp(-5), parte(-0.5)]) expect(t).not.toContain("-");
  });

  it("`frase` quita el punto doble tras un nombre acabado en punto y respeta los puntos suspensivos", () => {
    expect(frase("Cerrada por Admin A..")).toBe("Cerrada por Admin A.");
    expect(frase("decididos el 06 nov por Admin A.. Y más.")).toBe("decididos el 06 nov por Admin A. Y más.");
    expect(frase("Espera...")).toBe("Espera...");
    expect(frase("Sin cambios.")).toBe("Sin cambios.");
  });

  it("ningún texto del tablero lleva «..» ni un número con guion como signo menos (decisiones de «Admin A.» y «Planner P.»)", async () => {
    const id = await nueva();
    // Los nombres de quien decidió terminan en punto, como en el caso de la ficha.
    for (const a of filasDe("proyeccion_fila_anios")) if (a.decidido_por_nombre !== undefined) a.decidido_por_nombre = "Admin A.";
    await decidirYCerrar(id);
    for (const a of filasDe("proyeccion_fila_anios")) if (a.decidido_por_nombre) a.decidido_por_nombre = "Admin A.";
    for (const p of filasDe("proyecciones")) p.cerrada_por_nombre = "Planner P.";
    vaciarCachesDireccion();
    const textos: string[] = [];
    const recorrer = (v: unknown) => {
      if (typeof v === "string") textos.push(v);
      else if (Array.isArray(v)) v.forEach(recorrer);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(recorrer);
    };
    for (const consulta of [{}, { desglose: "genero" }, { bloque: "mismas" }, { bloque: "cierres" }, { desglose: "marca" }] as Record<string, string>[]) recorrer(await verTablero({ proyeccion_id: id, ...consulta }));
    expect(textos.some((t) => t.includes("Admin A.") || t.includes("Planner P."))).toBe(true);
    for (const t of textos) {
      expect(t, t).not.toMatch(/(?<!\.)\.\.(?!\.)/);
      expect(t, t).not.toMatch(/(^|[\s(:;,])-\d/);
    }
  });
});
