import { NextRequest } from "next/server";
import { expect } from "vitest";
import type { AprobarCurvaRespuesta, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { estadoFalso, type Fila } from "./curvas.fake-db";
import { ABRIGO_ID, CONSTANTE_ID, PERIODOS_NINO, PUBLICADOS, VERANO_ID, filasFixture, fixtureVentaEstacionalidad, tiendasFixture } from "./curvas.fixture";

/**
 * Soporte común de las pruebas de ruta de la 06c (composición y curva del usuario): el mismo sembrado de la
 * base falsa que `curvas.rutas.test.ts` (que conserva el suyo) más un GML por equivalencia para la
 * composición. Los `vi.mock` van en cada archivo de prueba, no aquí.
 */

export const A = {
  [ABRIGO_ID]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  [VERANO_ID]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  [CONSTANTE_ID]: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;
export const INACTIVA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const VACIA = "ffffffff-ffff-4fff-8fff-ffffffffffff";
/** Una agrupación con venta pero sin años de ajuste y sin `T`: el sistema no tiene ninguna candidata (origen null). */
export const SIN_CURVA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

export const URL = "http://localhost/api/curvas";
export const get = (ruta = "", consulta = "") => new NextRequest(`${URL}${ruta}${consulta}`);
export const json = (cuerpo: unknown, metodo = "POST", ruta = "") =>
  new NextRequest(`${URL}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
export const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
export const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
export const dia1 = (m: string) => `${m}-01`;

/** `venta_estacionalidad_agrupacion` como la devuelve la base: fechas `aaaa-mm-01` y cargas por periodo. */
export function ventaJson(fixtureId: string | null, opciones: Parameters<typeof fixtureVentaEstacionalidad>[2] = {}) {
  const v = fixtureVentaEstacionalidad(fixtureId, "base", opciones);
  return {
    agrupacion: v.agrupacion === null ? null : v.agrupacion.map((f) => ({ ...f, periodo: dia1(f.periodo) })),
    temporadas: v.temporadas.map((f) => ({ ...f, periodo: dia1(f.periodo) })),
    meses_publicados: v.meses_publicados.map(dia1),
    cargas: Object.fromEntries(Object.entries(v.cargas).map(([m, id]) => [dia1(m), id])),
  };
}

/** Ids de los GML de la composición: `n1` (e-0-1 y e-0-2) y `n2` (e-0-3) en ABRIGO. */
export const GML_N1 = "n1";
export const GML_N2 = "n2";

export function sembrar() {
  estadoFalso.rol = "planner";
  estadoFalso.siguienteId = 100;
  estadoFalso.llamadasVenta = [];
  estadoFalso.llamadasVentaTienda = 0;
  estadoFalso.llamadasComposicion = [];
  estadoFalso.composicion = { respuesta: () => null, error: null };
  estadoFalso.columnasLeidas = {};
  estadoFalso.tablasLeidas = new Set();
  estadoFalso.fallarInsert = {};
  estadoFalso.venta = {
    porId: {
      [A[ABRIGO_ID]]: ventaJson(ABRIGO_ID),
      [A[VERANO_ID]]: ventaJson(VERANO_ID),
      [A[CONSTANTE_ID]]: ventaJson(CONSTANTE_ID),
      [INACTIVA]: ventaJson("inactiva"),
      [VACIA]: ventaJson("vacia"),
      [SIN_CURVA]: sinCurvaJson(),
      null: ventaJson(null),
    },
    error: null,
  };
  estadoFalso.ventaTienda = ventaPorTienda(filasFixture("base")).map((v) => ({ ...v, periodo: dia1(v.periodo) }));
  const agr = (id: string, nombre: string, temporada: string, activo = true, orden = 0): Fila => ({ id, nombre, codigo: nombre.slice(0, 3), activo, orden, temporada, descripcion: null });
  estadoFalso.tablas = {
    agrupaciones_estacionalidad: [
      agr(A[ABRIGO_ID], "ABRIGO", "invierno"),
      agr(A[VERANO_ID], "VERANO", "verano"),
      agr(A[CONSTANTE_ID], "CONSTANTE", "todo_el_ano"),
      agr(INACTIVA, "INACTIVA", "verano", false),
      agr(VACIA, "VACIA", "todo_el_ano", true, 5),
      agr(SIN_CURVA, "SIN CURVA", "verano", true, 6),
    ],
    agrupacion_estacionalidad_genero: [{ id: "g1", agrupacion_estacionalidad_id: A[ABRIGO_ID], genero_id: "h" }],
    generos: [{ id: "h", nombre: "HOMBRE", orden: 1, activo: true }],
    mundos: [{ id: "m1", nombre: "URBANO", orden: 1, activo: true }],
    lineas: [
      { id: "l1", nombre: "CASACA", temporada: "Todo el año", activo: true },
      { id: "l2", nombre: "CHOMPA", temporada: "Todo el año", activo: true },
    ],
    genero_mundo_linea: [
      { id: GML_N1, genero_id: "h", mundo_id: "m1", linea_id: "l1", nivel_planificacion: "GML", activo: true },
      { id: GML_N2, genero_id: "h", mundo_id: "m1", linea_id: "l2", nivel_planificacion: "GML", activo: true },
    ],
    equivalencias: [A[ABRIGO_ID], A[VERANO_ID], A[CONSTANTE_ID], VACIA, SIN_CURVA].flatMap((a, i) =>
      (a === VACIA || a === SIN_CURVA ? [1] : [1, 2, 3]).map((k) => ({
        id: `e-${i}-${k}`,
        agrupacion_estacionalidad_id: a,
        activo: true,
        genero_mundo_linea_id: k === 3 ? GML_N2 : GML_N1,
        nombre: `Equivalencia ${i}-${k}`,
        codigo: `E${i}${k}`,
        es_generica: k === 3,
      }))
    ),
    tiendas: tiendasFixture("base").map((t) => ({ ...t, razon_social: null, zona: null, venta_esperada_promedio: null })),
    cargas_venta_stock: PUBLICADOS.map((m) => ({ id: `carga-${m}`, periodo: dia1(m), estado: "publicada" })),
    periodos_atipicos: PERIODOS_NINO.map((p, i) => ({
      id: `00000000-0000-4000-8000-0000000000${10 + i}`,
      desde: dia1(p.desde),
      hasta: dia1(p.hasta),
      motivo: p.motivo,
      descripcion: null,
      alcance: "invierno",
      temporadas: p.temporadas,
      activo: true,
      created_at: "x",
      updated_at: "x",
    })),
    corridas_estacionalidad: [],
    curvas_estacionalidad: [],
  };
}

/**
 * Una agrupación de verano con venta de 5 unidades al mes (60 al año: escasa) y ninguna fila en la temporada
 * `verano`: sin años de ajuste ni `T`, así que el sistema no tiene ninguna candidata (`origen = null`).
 */
function sinCurvaJson() {
  const base = ventaJson(null);
  const filas = PUBLICADOS.map((m) => ({ tienda_id: "t1", periodo: dia1(m), unidades: 5, venta_soles: 500, costo_vendido: 250 }));
  return {
    ...base,
    agrupacion: filas,
    temporadas: base.temporadas.filter((f) => f.temporada !== "verano"),
  };
}

/** Pide `calcular` y devuelve el trabajo (lo que ve el planner al abrir la agrupación). */
export async function abrirCon(calcular: (r: NextRequest, c: never) => Promise<Response>, id: string, cuerpo: Record<string, unknown> = {}, consulta = "") {
  const r = await calcular(json(cuerpo, "POST", consulta), ctx(id));
  expect(r.status).toBe(200);
  return (await leer<TrabajoAgrupacionApi>(r)).data;
}

/** El cuerpo de `PUT` que armaría la pantalla a partir de lo que devolvió `calcular`. */
export function cuerpoAprobar(t: TrabajoAgrupacionApi, modelo: string, extra: Record<string, unknown> = {}) {
  return {
    modelo,
    parametros: { ...t.parametros, hasta_periodo: t.datos.hasta_periodo },
    huella_calculo: t.huella_calculo,
    version_vigente: t.vigente?.version ?? null,
    ...extra,
  };
}

export type RespuestaAprobar = AprobarCurvaRespuesta;
