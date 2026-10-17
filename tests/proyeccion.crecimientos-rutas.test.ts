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
    cargarCatalogo: async () => ({ data: { catalogo: falso.catalogoFalso(), equivalencias: [], nodosDb: [], generos: [] }, respuesta: null }),
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
import { GET as leerUna, PATCH as editar } from "@/app/api/proyeccion/proyecciones/[id]/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { GET as crecimientos, PUT as guardar } from "@/app/api/proyeccion/proyecciones/[id]/crecimientos/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { GET as tiendas } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/route";
import { POST as archivar } from "@/app/api/proyeccion/proyecciones/[id]/archivar/route";
import { construirVenta, GEN, LIN, MUN, AM, EQ, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type {
  ConflictoFilasManualesApi,
  ProyeccionApi,
  RespuestaCrecimientosApi,
  RespuestaGuardarCrecimientosApi,
  RespuestaLineasApi,
  RespuestaMatrizApi,
  RespuestaTiendasApi,
} from "@/lib/proyeccion/tipos-api";

/**
 * 07c, rutas (sintético): `GET`/`PUT …/crecimientos`, resolución de choques, candado, recálculo encadenado, huella, concurrencia con la
 * base falsa, `PATCH` de parámetros, copia y cierre.
 */

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const proyecciones = () => filasDe("proyecciones");
const celdasDb = () => filasDe("proyeccion_crecimientos");
const idFila = (clave: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave)?.id as string;
const DENIM_REC = `|${N.denim}||${AM.rec}`;
const ABRIGO_REC = `|${N.abrigo}|${EQ.parka}|${AM.rec}`;
const SANDALIA_VAL = `|${N.sandalia}||${AM.val}`;
const registro = (clave: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(clave) && a.anio === anio) as Fila;
const suma = (x: unknown) => (x as number[]).reduce((a, b) => a + b, 0);

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { r, cuerpo, id: cuerpo.data?.id as string };
}
const leerCrec = async (id: string) => (await leer<RespuestaCrecimientosApi>(await crecimientos(get("/c"), ctx(id)))).data;
/** Cuerpo del `PUT` con todas las celdas obligatorias al `pct` dado (o al de `porCelda`) y lo demás tomado del `GET`. */
const cuerpoDe = (g: RespuestaCrecimientosApi, pct: number, extra: Record<string, unknown> = {}, porCelda: Record<string, number> = {}) => ({
  huella: g.huella,
  resto: { pct: g.resto.pct, nota: null as string | null },
  objetivo_pct: null as number | null,
  celdas: g.celdas.filter((c) => !c.sin_filas).map((c) => ({ genero_id: c.genero_id, mundo_id: c.mundo_id, pct: porCelda[`${c.genero_id}|${c.mundo_id}`] ?? pct, nota: null as string | null })),
  ...extra,
});
const poner = (id: string, cuerpo: unknown) => guardar(enviar("PUT", "/c", cuerpo), ctx(id));
const gm = (g: string, m: string) => `${g}|${m}`;

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  estadoFalso.rol = "planner";
  base.tablas.generos = [
    { id: GEN.hombre, nombre: "HOMBRE", orden: 1, activo: true },
    { id: GEN.mujer, nombre: "MUJER", orden: 2, activo: true },
  ];
  base.tablas.mundos = [
    { id: MUN.urbano, nombre: "URBANO", orden: 1, activo: true },
    { id: MUN.casual, nombre: "CASUAL", orden: 2, activo: true },
  ];
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

describe("permisos y GET", () => {
  it("sin sesión 401 y comprador 403 en GET y PUT; un id inexistente o mal formado es 404", async () => {
    for (const rol of ["sin_sesion", "comprador"] as const) {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await crecimientos(get("/c"), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await poner(INEXISTENTE, {})).status).toBe(esperado);
    }
    estadoFalso.rol = "planner";
    expect((await crecimientos(get("/c"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await crecimientos(get("/c"), ctx("no-es-uuid"))).status).toBe(404);
    expect((await poner(INEXISTENTE, { huella: "x", resto: { pct: 5 }, objetivo_pct: null, celdas: [] })).status).toBe(404);
  });

  it("la matriz: HOMBRE y MUJER por mundo, con los agregados, el Resto, el puente y una huella; sin caché", async () => {
    const { id } = await nueva();
    const r = await crecimientos(get("/c"), ctx(id));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const g = (await leer<RespuestaCrecimientosApi>(r)).data;
    expect(g).toMatchObject({ editable: true, anio_en_curso: 2026, anio_siguiente: 2027, al_dia: true, metodo_viejo: false, objetivo_pct: null, generos_faltantes: [] });
    expect(g.generos.map((x) => x.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(g.mundos.map((x) => x.nombre)).toEqual(["URBANO", "CASUAL"]);
    expect(g.huella).toMatch(/^[0-9a-f]{32}$/);
    // 4 celdas (2 géneros × 2 mundos); MUJER · URBANO no tiene filas.
    expect(g.celdas).toHaveLength(4);
    const celda = (gen: string, mun: string) => g.celdas.find((c) => c.genero_id === gen && c.mundo_id === mun)!;
    expect(celda(GEN.hombre, MUN.urbano)).toMatchObject({ pct: null, sin_filas: false });
    expect(celda(GEN.mujer, MUN.urbano)).toMatchObject({ pct: null, sin_filas: true });
    expect(celda(GEN.hombre, MUN.urbano).agregado).toMatchObject({ base_libre: 1860 + 60, pct_propio: { filas: 0 }, decididas: { filas: 0 } });
    expect(g.celdas.reduce((s, c) => s + c.agregado.base, 0) + g.resto.agregado.base).toBeGreaterThan(0);
    expect(g.resto).toMatchObject({ pct: 5, nota: null, actualizado_por: null });
    expect(g.puente.total_en_curso).toBeGreaterThan(0);
    expect(g.puente.cierres_sin_decidir).toBe(1); // T5 cierra en 2027 y no tiene total decidido
  });

  it("el Resto agrupa los géneros que no son de la matriz, con su desglose por género", async () => {
    const { id } = await nueva();
    const g0 = await leerCrec(id);
    // Quitamos MUJER del catálogo de géneros activos: sus filas pasan al Resto y la pantalla lo avisa.
    base.tablas.generos = [{ id: GEN.hombre, nombre: "HOMBRE", orden: 1, activo: true }, { id: GEN.mujer, nombre: "MUJER", orden: 2, activo: false }];
    const g = await leerCrec(id);
    expect(g.generos.map((x) => x.nombre)).toEqual(["HOMBRE"]);
    expect(g.generos_faltantes).toEqual(["MUJER"]);
    expect(g.resto.agregado.base).toBeGreaterThan(0);
    expect(g.resto.por_genero.map((x) => x.genero)).toContain("MUJER");
    expect(g.resto.por_genero.reduce((s, x) => s + x.base, 0)).toBe(g.resto.agregado.base);
    expect(g0.resto.agregado.base).toBe(0);
  });
});

describe("regla 7: PUT, validación (no escribe nada)", () => {
  const sinRastro = (id: string) => {
    expect(celdasDb()).toHaveLength(0);
    expect(proyecciones().find((p) => p.id === id)?.calculando_desde).toBeNull();
    expect((proyecciones().find((p) => p.id === id)?.parametros as Record<string, unknown>).crecimiento_resto_meta).toBeUndefined();
  };

  it("matriz incompleta → 400 celdas_incompletas con la lista; una celda «sin filas» no es obligatoria", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const c = cuerpoDe(g, 10);
    const r = await poner(id, { ...c, celdas: c.celdas.slice(1) });
    expect(r.status).toBe(400);
    const cuerpo = await leer(r);
    expect(cuerpo.codigo).toBe("celdas_incompletas");
    expect((cuerpo.faltan as { genero: string; mundo: string }[]).length).toBe(1);
    expect(cuerpo.error).toContain("Faltan 1 celda");
    sinRastro(id);
    // Sin MUJER · URBANO (sin filas) sí se guarda.
    expect(c.celdas.some((x) => x.genero_id === GEN.mujer && x.mundo_id === MUN.urbano)).toBe(false);
    expect((await poner(id, c)).status).toBe(200);
  });

  it("celda repetida → 400; género que no es HOMBRE ni MUJER → 400 genero_no_permitido; mundo inactivo → 400 mundo_inactivo", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const c = cuerpoDe(g, 10);
    const repetida = await poner(id, { ...c, celdas: [...c.celdas, c.celdas[0]] });
    expect(repetida.status).toBe(400);
    expect((await leer(repetida)).codigo).toBe("celda_repetida");
    const otroGenero = await poner(id, { ...c, celdas: [...c.celdas, { genero_id: "00000000-0000-4000-8000-00000000f001", mundo_id: MUN.urbano, pct: 3 }] });
    expect(otroGenero.status).toBe(400);
    expect((await leer(otroGenero)).codigo).toBe("genero_no_permitido");
    base.tablas.mundos = [{ id: MUN.urbano, nombre: "URBANO", orden: 1, activo: true }, { id: MUN.casual, nombre: "CASUAL", orden: 2, activo: false }];
    const inactivo = await poner(id, { ...c, celdas: [{ genero_id: GEN.hombre, mundo_id: MUN.casual, pct: 3 }, ...c.celdas.filter((x) => x.mundo_id !== MUN.casual)] });
    expect(inactivo.status).toBe(400);
    expect((await leer(inactivo)).codigo).toBe("mundo_inactivo");
    sinRastro(id);
  });

  it("zod: % fuera de −95 a 500, huella ausente o cuerpo roto → 400 con mensaje en castellano", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const c = cuerpoDe(g, 10);
    for (const malo of [
      { ...c, celdas: [{ ...c.celdas[0], pct: 501 }, ...c.celdas.slice(1)] },
      { ...c, celdas: [{ ...c.celdas[0], pct: -96 }, ...c.celdas.slice(1)] },
      { ...c, resto: { pct: 900, nota: null } },
      { ...c, objetivo_pct: -200 },
      { ...c, huella: undefined },
    ]) {
      const r = await poner(id, malo);
      expect(r.status).toBe(400);
      expect(typeof (await leer(r)).error).toBe("string");
    }
    sinRastro(id);
  });

  it("resolucion sin huella_choque, o incluir_decididas sin pisar → 400 resolucion_invalida", async () => {
    const { id } = await nueva();
    const c = cuerpoDe(await leerCrec(id), 10);
    const a = await poner(id, { ...c, resolucion: "pisar" });
    expect(a.status).toBe(400);
    expect((await leer(a)).codigo).toBe("resolucion_invalida");
    const b = await poner(id, { ...c, resolucion: "conservar", huella_choque: "abc", incluir_decididas: true });
    expect(b.status).toBe(400);
    expect((await leer(b)).codigo).toBe("resolucion_invalida");
    const sin = await poner(id, { ...c, incluir_decididas: true });
    expect(sin.status).toBe(400);
    sinRastro(id);
  });

  it("cerrada, archivada o calculando → 409; una huella distinta → 409 conflicto; en ningún caso se escribe", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const c = cuerpoDe(g, 10);
    expect((await leer(await poner(id, { ...c, huella: "otra" }))).codigo).toBe("conflicto");
    const fila = proyecciones().find((p) => p.id === id) as Fila;
    fila.calculando_desde = new Date(Date.now() - 60_000).toISOString();
    const calc = await poner(id, c);
    expect(calc.status).toBe(409);
    expect((await leer(calc)).codigo).toBe("calculo_en_curso");
    fila.calculando_desde = null;
    fila.estado = "archivada";
    expect((await leer(await poner(id, c))).codigo).toBe("archivada");
    fila.estado = "cerrada";
    const cerr = await poner(id, c);
    expect(cerr.status).toBe(409);
    expect((await leer(cerr)).codigo).toBe("cerrada");
    fila.estado = "en_trabajo";
    expect(celdasDb()).toHaveLength(0);
    // En una cerrada el GET sigue funcionando, solo lectura.
    fila.estado = "cerrada";
    expect((await leerCrec(id)).editable).toBe(false);
  });
});

describe("regla 8: PUT, guardar y recalcular", () => {
  it("un PUT correcto guarda celdas, Resto y objetivo, recalcula en el servidor y deja la proyección al día y sin candado", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const r = await poner(id, cuerpoDe(g, 12, { resto: { pct: 6, nota: "Resto de prueba" }, objetivo_pct: 11 }, { [gm(GEN.hombre, MUN.casual)]: -10 }));
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.recalculo).toEqual({ ok: true });
    expect(d).toMatchObject({ pisadas: [], conservadas: 0, revertidas: [], al_dia: true, objetivo_pct: 11 });
    expect(d.resto).toMatchObject({ pct: 6, nota: "Resto de prueba", actualizado_por: "Javier" });
    expect(d.celdas.find((c) => c.genero_id === GEN.hombre && c.mundo_id === MUN.casual)).toMatchObject({ pct: -10, actualizado_por: "Javier" });
    expect(celdasDb()).toHaveLength(3);
    expect(proyecciones()[0].calculando_desde).toBeNull();
    // El recálculo rehizo las filas con la matriz: DENIM (HOMBRE · URBANO) al 12 % bruto sobre B = 1 860.
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 1860, propuesto: Math.round(1860 * 1.12) });
    expect(suma(registro(DENIM_REC, 2027).meses)).toBe(Math.round(1860 * 1.12));
    expect(registro(ABRIGO_REC, 2027).propuesto).toBe(Math.round((registro(ABRIGO_REC, 2027).base_siguiente as number) * 0.9));
    // El Resto es `crecimiento_pct_defecto`; sin `crecimientos_cambiados`.
    const p = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
    expect(p.parametros).toMatchObject({ crecimiento_pct_defecto: 6, crecimiento_objetivo_pct: 11 });
    expect(p.desactualizada).toEqual([]);
    expect(p.resumen).not.toHaveProperty("huella_crecimientos");
    expect(p.resumen).not.toHaveProperty("gm_gml");
    expect(p.resumen?.version_metodo).toBe(4);
  });

  it("es idempotente: repetirlo con la huella nueva deja lo mismo y no reescribe las celdas que no cambian (conservan su quién y cuándo)", async () => {
    const { id } = await nueva();
    const r1 = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(await leerCrec(id), 12)))).data;
    const antes = celdasDb().map((c) => ({ ...c }));
    const estadoAntes = JSON.stringify(filasDe("proyeccion_fila_anios").map((a) => [a.id, a.propuesto, a.base_siguiente, a.meses]));
    const r2 = await poner(id, cuerpoDe(r1, 12));
    expect(r2.status).toBe(200);
    expect(celdasDb()).toEqual(antes);
    expect(JSON.stringify(filasDe("proyeccion_fila_anios").map((a) => [a.id, a.propuesto, a.base_siguiente, a.meses]))).toBe(estadoAntes);
    // Cambiar solo una celda reescribe solo esa.
    const r3 = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(r1, 12, {}, { [gm(GEN.mujer, MUN.casual)]: 20 })))).data;
    expect(r3.celdas.find((c) => c.genero_id === GEN.mujer && c.mundo_id === MUN.casual)?.pct).toBe(20);
    const urbano = celdasDb().find((c) => c.genero_id === GEN.hombre && c.mundo_id === MUN.urbano);
    expect(urbano?.updated_at).toBe(antes.find((c) => c.genero_id === GEN.hombre && c.mundo_id === MUN.urbano)?.updated_at);
  });

  it("una celda que ya no viene se borra (reemplazo completo)", async () => {
    const { id } = await nueva();
    const r1 = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(await leerCrec(id), 12)))).data;
    // Una celda «sin filas» guardada antes: se conserva si vuelve y se borra si no vuelve.
    const c = cuerpoDe(r1, 12);
    const sin = { genero_id: GEN.mujer, mundo_id: MUN.urbano, pct: 3, nota: null };
    const r2 = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, { ...c, huella: r1.huella, celdas: [...c.celdas, sin] }))).data;
    expect(celdasDb()).toHaveLength(4);
    expect(r2.celdas.find((x) => x.genero_id === GEN.mujer && x.mundo_id === MUN.urbano)).toMatchObject({ pct: 3, sin_filas: true });
    await poner(id, { ...c, huella: r2.huella });
    expect(celdasDb()).toHaveLength(3);
  });

  it("mientras el PUT tiene el candado, decidirFila, decidirTienda y el PATCH responden 409 calculo_en_curso", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    const durante: Promise<Response>[] = [];
    const candadoVisto: unknown[] = [];
    const original = base.venta;
    let primera = true;
    base.venta = (args, llamada) => {
      if (primera) {
        primera = false;
        candadoVisto.push(proyecciones()[0].calculando_desde);
        durante.push(decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2026" })));
        durante.push(decidirTienda(enviar("PUT", "/x", { decidido: 400, origen: "manual" }), ctx(id, { tiendaId: "T2", anio: "2026" })));
        durante.push(editar(enviar("PATCH", "/x", { nota: "hola" }), ctx(id)));
      }
      return original(args, llamada);
    };
    const r = await poner(id, cuerpoDe(g, 12));
    expect(r.status).toBe(200);
    expect(candadoVisto[0]).not.toBeNull();
    expect(durante).toHaveLength(3);
    for (const p of durante) {
      const x = await p;
      expect(x.status).toBe(409);
      expect((await leer(x)).codigo).toBe("calculo_en_curso");
    }
    expect(registro(DENIM_REC, 2026).decidido).toBeNull();
    expect(proyecciones()[0].nota).toBeNull();
  });

  it("si el recálculo encadenado falla: 200 con recalculo.ok = false, la matriz queda guardada, al_dia = false y el candado libre", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    base.errorVenta = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await poner(id, cuerpoDe(g, 12, { resto: { pct: 6, nota: null } }));
    base.errorVenta = null;
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.recalculo.ok).toBe(false);
    if (!d.recalculo.ok) expect(d.recalculo.mensaje).toBe("Error inesperado en la base de datos.");
    expect(d.al_dia).toBe(false);
    expect(celdasDb()).toHaveLength(3);
    expect(proyecciones()[0].calculando_desde).toBeNull();
    // La proyección queda con `crecimientos_cambiados`, que no se puede forzar al cerrar.
    const p = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
    expect(p.desactualizada.map((m) => m.codigo)).toContain("crecimientos_cambiados");
    const forzada = await cerrar(new NextRequest(`${URL_BASE}/x?forzar=1`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id));
    expect(forzada.status).toBe(409);
    expect((await leer(forzada)).codigo).toBe("crecimientos_cambiados");
    // Recalcular lo limpia.
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    expect(registro(DENIM_REC, 2027).propuesto).toBe(Math.round(1860 * 1.12));
  });

  it("un nodo con filas base que cambia de mundo produce crecimientos_cambiados (y no se puede forzar al cerrar); recalcular lo limpia", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 12));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    // El nodo DENIM pasa de URBANO a CASUAL en el árbol (el contexto vigente lo dice; el cálculo guardó URBANO).
    contexto.nodoMundo = { [N.denim]: MUN.casual };
    const p = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
    expect(p.desactualizada.map((m) => m.codigo)).toContain("crecimientos_cambiados");
    const forzada = await cerrar(new NextRequest(`${URL_BASE}/x?forzar=1`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id));
    expect((await leer(forzada)).codigo).toBe("crecimientos_cambiados");
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    // Con el mundo nuevo sin celda (HOMBRE · CASUAL ya tiene la de ABRIGO, que se aplica a DENIM).
    expect(registro(DENIM_REC, 2027).propuesto).toBe(Math.round(1860 * 1.12));
  });

  it("antes de 0.10.8 (método 3): metodo_viejo, al_dia = false y el PUT lo pone al día", async () => {
    const { id } = await nueva();
    const p = proyecciones()[0];
    p.resumen = { ...(p.resumen as Record<string, unknown>), version_metodo: 3, huella_crecimientos: undefined, gm_gml: undefined };
    const g = await leerCrec(id);
    expect(g).toMatchObject({ metodo_viejo: true, al_dia: false });
    const d = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(g, 10)))).data;
    expect(d).toMatchObject({ metodo_viejo: false, al_dia: true, recalculo: { ok: true } });
  });

  it("regla 13 (B2 en el acto): tras guardar la matriz, decidir 2026 usa el % de la celda y reescribe base_siguiente", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 12));
    const r = await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect(r.status).toBe(200);
    // B = 1 900 + 300 − 240 = 1 960; al 12 % bruto de la celda.
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 1960, propuesto: Math.round(1960 * 1.12) });
    // Decidir una tienda que pasa a mismas tiendas también rehace B con la celda.
    await decidirTienda(enviar("PUT", "/x", { decidido: 400, origen: "manual" }), ctx(id, { tiendaId: "T2", anio: "2026" }));
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 2060, propuesto: Math.round(2060 * 1.12) });
  });
});

describe("regla 5 y 6: choques con filas fijadas a mano", () => {
  async function conFijadas(id: string) {
    // DENIM (HOMBRE · URBANO) con 7 % propio y ABRIGO (HOMBRE · CASUAL) con total de 2027 decidido.
    expect((await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 7, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2027" }))).status).toBe(200);
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1500, origen: "manual" }), ctx(id, { filaId: idFila(ABRIGO_REC), anio: "2027" }))).status).toBe(200);
  }
  const intento = async (id: string, extra: Record<string, unknown> = {}) => {
    const g = await leerCrec(id);
    return { g, r: await poner(id, cuerpoDe(g, 20, extra)) };
  };
  const nadaEscrito = (id: string) => {
    expect(celdasDb()).toHaveLength(0);
    expect(registro(DENIM_REC, 2027).crecimiento_pct).toBe(7);
    expect(registro(ABRIGO_REC, 2027).decidido).toBe(1500);
    expect((proyecciones().find((p) => p.id === id)?.parametros as Record<string, unknown>).crecimiento_pct_defecto).toBe(5);
    expect(proyecciones().find((p) => p.id === id)?.calculando_desde).toBeNull();
  };

  it("con choque y sin resolución: 409 filas_manuales con la lista, los nombres y la huella_choque, sin escribir nada", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const { r } = await intento(id);
    expect(r.status).toBe(409);
    const c = (await leer(r)) as unknown as ConflictoFilasManualesApi;
    expect(c.codigo).toBe("filas_manuales");
    expect(c.huella_choque).toMatch(/^[0-9a-f]{32}$/);
    expect(c.pct_propio.total).toBe(1);
    expect(c.pct_propio.filas[0]).toMatchObject({ fila_id: idFila(DENIM_REC), genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", pct_fila: 7, pct_nuevo: 20 });
    expect(c.decididas.total).toBe(1);
    const b = registro(ABRIGO_REC, 2027).base_siguiente as number;
    expect(c.decididas.filas[0]).toMatchObject({ fila_id: idFila(ABRIGO_REC), genero: "HOMBRE", mundo: "CASUAL", linea: "ABRIGO", equivalencia: "PARKA", decidido: 1500, propuesta_nueva_estimada: Math.round(b * 1.2) });
    nadaEscrito(id);
  });

  it("Conservar: no toca ninguna fila (el % propio y el total decidido siguen) y guarda la matriz", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const { r: bloqueo } = await intento(id);
    const huella_choque = ((await leer(bloqueo)) as unknown as ConflictoFilasManualesApi).huella_choque;
    const { r } = await intento(id, { resolucion: "conservar", huella_choque });
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d).toMatchObject({ pisadas: [], conservadas: 2, revertidas: [], recalculo: { ok: true } });
    expect(registro(DENIM_REC, 2027)).toMatchObject({ crecimiento_pct: 7, propuesto: Math.round(1860 * 1.07) });
    expect(registro(ABRIGO_REC, 2027).decidido).toBe(1500);
    expect(celdasDb()).toHaveLength(3);
  });

  it("Pisar sin la casilla: la fila con % propio sigue la celda y la decidida conserva su total (que queda con propuesta_cambio)", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const huella_choque = ((await leer((await intento(id)).r)) as unknown as ConflictoFilasManualesApi).huella_choque;
    const { r } = await intento(id, { resolucion: "pisar", huella_choque });
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.pisadas).toEqual([{ fila_id: idFila(DENIM_REC), pct_anterior: 7, decidido_anterior: null }]);
    expect(d.conservadas).toBe(1);
    expect(d.revertidas).toEqual([]);
    // La pisada rehace su registro con la matriz nueva: propuesta = round(B × 1,20) y Σ meses = vigente.
    expect(registro(DENIM_REC, 2027)).toMatchObject({ crecimiento_pct: null, propuesto: Math.round(1860 * 1.2) });
    expect(suma(registro(DENIM_REC, 2027).meses)).toBe(Math.round(1860 * 1.2));
    expect(registro(DENIM_REC, 2027).explicacion).toContain("crecimiento bruto de HOMBRE · URBANO");
    // Sin incluir_decididas un total decidido nunca cambia.
    expect(registro(ABRIGO_REC, 2027)).toMatchObject({ decidido: 1500, origen: "manual" });
    expect(suma(registro(ABRIGO_REC, 2027).meses)).toBe(1500);
    expect(registro(ABRIGO_REC, 2027).avisos).toContain("propuesta_cambio");
  });

  it("Pisar con la casilla: la decidida vuelve a la propuesta nueva (decidido null, vigente = propuesto, Σ meses = vigente) y pisadas trae lo anterior", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const huella_choque = ((await leer((await intento(id)).r)) as unknown as ConflictoFilasManualesApi).huella_choque;
    const { r } = await intento(id, { resolucion: "pisar", incluir_decididas: true, huella_choque });
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.pisadas.sort((a, b) => a.fila_id.localeCompare(b.fila_id))).toEqual(
      [
        { fila_id: idFila(DENIM_REC), pct_anterior: 7, decidido_anterior: null },
        { fila_id: idFila(ABRIGO_REC), pct_anterior: null, decidido_anterior: 1500 },
      ].sort((a, b) => a.fila_id.localeCompare(b.fila_id))
    );
    expect(d.conservadas).toBe(0);
    const ab = registro(ABRIGO_REC, 2027);
    const esperado = Math.round((ab.base_siguiente as number) * 1.2);
    expect(ab).toMatchObject({ decidido: null, origen: null, propuesto: esperado, propuesta_al_decidir: null, nota: null });
    expect(suma(ab.meses)).toBe(esperado);
    expect(ab.explicacion).toContain("crecimiento bruto de HOMBRE · CASUAL");
  });

  it("una huella_choque distinta de la recalculada → 409 filas_manuales con la lista nueva, sin escribir nada", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const { g, r } = await intento(id);
    const vieja = ((await leer(r)) as unknown as ConflictoFilasManualesApi).huella_choque;
    // Mientras Javier decidía, otra fila (un total en SANDALIA) pasó a chocar.
    await decidirFila(enviar("PUT", "/x", { decidido: 900, origen: "manual" }), ctx(id, { filaId: idFila(SANDALIA_VAL), anio: "2027" }));
    const r2 = await poner(id, cuerpoDe(g, 20, { resolucion: "pisar", incluir_decididas: true, huella_choque: vieja }));
    expect(r2.status).toBe(409);
    const c = (await leer(r2)) as unknown as ConflictoFilasManualesApi;
    expect(c.codigo).toBe("filas_manuales");
    expect(c.error).toBe("Las filas en choque cambiaron mientras decidías: revisa la lista nueva.");
    expect(c.huella_choque).not.toBe(vieja);
    expect(c.decididas.total).toBe(2);
    expect(registro(ABRIGO_REC, 2027).decidido).toBe(1500);
    expect(registro(SANDALIA_VAL, 2027).decidido).toBe(900);
    expect(celdasDb()).toHaveLength(0);
  });

  it("si al llegar con resolución ya no hay choques, se ignora la resolución y se guarda (sin pisar nada)", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    // Cambiar solo una celda que no toca las filas fijadas: sin choque.
    const g = await leerCrec(id);
    const r = await poner(id, cuerpoDe(g, 5, { resolucion: "pisar", incluir_decididas: true, huella_choque: "cualquiera" }, { [gm(GEN.mujer, MUN.casual)]: 9 }));
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d).toMatchObject({ pisadas: [], conservadas: 0 });
    expect(registro(DENIM_REC, 2027).crecimiento_pct).toBe(7);
    expect(registro(ABRIGO_REC, 2027).decidido).toBe(1500);
  });

  it("cambiar solo el Resto no choca con filas de HOMBRE y MUJER (solo afecta a los GM sin celda)", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const r1 = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(await leerCrec(id), 20, { resolucion: "conservar", huella_choque: ((await leer((await intento(id)).r)) as unknown as ConflictoFilasManualesApi).huella_choque })))).data;
    const r2 = await poner(id, cuerpoDe(r1, 20, { resto: { pct: 9, nota: null } }, {}));
    expect(r2.status).toBe(200);
  });

  it("una decisión que revierte la fila pisada durante el recálculo aparece en revertidas", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const huella_choque = ((await leer((await intento(id)).r)) as unknown as ConflictoFilasManualesApi).huella_choque;
    const original = base.venta;
    let primera = true;
    base.venta = (args, llamada) => {
      // «Alguien» vuelve a escribir un % en la fila pisada mientras se recalcula (la ventana residual del candado).
      if (primera) {
        primera = false;
        registro(DENIM_REC, 2027).crecimiento_pct = 9;
      }
      return original(args, llamada);
    };
    const { r } = await intento(id, { resolucion: "pisar", huella_choque });
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.revertidas).toEqual([idFila(DENIM_REC)]);
  });

  it("un fallo de base escribiendo las filas pisadas libera el candado y responde 500 guardado_parcial; reintentar lo deja consistente", async () => {
    const { id } = await nueva();
    await conFijadas(id);
    const huella_choque = ((await leer((await intento(id)).r)) as unknown as ConflictoFilasManualesApi).huella_choque;
    base.falloDeEscritura = (tabla, modo) => (tabla === "proyeccion_crecimientos" && modo === "upsert" ? { code: "XX000", message: "boom", details: null, hint: null } : null);
    const { r } = await intento(id, { resolucion: "pisar", huella_choque });
    base.falloDeEscritura = null;
    expect(r.status).toBe(500);
    const c = await leer(r);
    expect(c.codigo).toBe("guardado_parcial");
    expect(c.error).not.toContain("boom");
    // El texto no promete un reintento ciego: manda a recargar (la huella puede haber cambiado).
    expect(c.error).toContain("Recarga la pantalla");
    expect(c.error).not.toContain("es seguro");
    expect(proyecciones()[0].calculando_desde).toBeNull();
    // Las filas ya pisadas no vuelven a chocar: el reintento (con la huella nueva) solo ve el resto y termina.
    expect(registro(DENIM_REC, 2027).crecimiento_pct).toBeNull();
    const g = await leerCrec(id);
    const r2 = await poner(id, cuerpoDe(g, 20));
    expect(r2.status).toBe(409);
    const c2 = (await leer(r2)) as unknown as ConflictoFilasManualesApi;
    expect([c2.pct_propio.total, c2.decididas.total]).toEqual([0, 1]);
    const final = await poner(id, cuerpoDe(g, 20, { resolucion: "conservar", huella_choque: c2.huella_choque }));
    expect(final.status).toBe(200);
    expect(celdasDb()).toHaveLength(3);
    expect(registro(DENIM_REC, 2027)).toMatchObject({ crecimiento_pct: null, propuesto: Math.round(1860 * 1.2) });
  });
});

describe("guardado_parcial tras escribir celdas y celdas descartadas", () => {
  it("un fallo al guardar el Resto (con las celdas ya escritas) responde 500 que manda a recargar; reintentar con la pantalla vieja da 409 conflicto y con la recargada termina", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    base.falloDeEscritura = (tabla, modo, carga) =>
      tabla === "proyecciones" && modo === "update" && !Array.isArray(carga) && "parametros" in carga ? { code: "XX000", message: "boom", details: null, hint: null } : null;
    const r = await poner(id, cuerpoDe(g, 12));
    base.falloDeEscritura = null;
    expect(r.status).toBe(500);
    const c = await leer(r);
    expect(c.codigo).toBe("guardado_parcial");
    expect(c.error).toContain("Recarga la pantalla");
    expect(proyecciones()[0].calculando_desde).toBeNull();
    // Las celdas ya quedaron escritas: la huella de la pantalla vieja ya no vale.
    expect(celdasDb().length).toBeGreaterThan(0);
    const viejo = await poner(id, cuerpoDe(g, 12));
    expect(viejo.status).toBe(409);
    expect((await leer(viejo)).codigo).toBe("conflicto");
    const recargada = await leerCrec(id);
    expect((await poner(id, cuerpoDe(recargada, 12))).status).toBe(200);
  });

  it("un guardado que borra una celda de un mundo desactivado la devuelve en celdas_descartadas; sin pérdidas llega vacío", async () => {
    const { id } = await nueva();
    const primero = (await leer<RespuestaGuardarCrecimientosApi>(await poner(id, cuerpoDe(await leerCrec(id), 12)))).data;
    expect(primero.celdas_descartadas).toEqual([]);
    const casual = celdasDb().filter((c) => c.mundo_id === MUN.casual);
    expect(casual.length).toBeGreaterThan(0);
    // CASUAL se desactiva: la pantalla ya no lo muestra y su celda guardada no puede viajar en el PUT.
    (base.tablas.mundos.find((m) => m.id === MUN.casual) as Fila).activo = false;
    const g = await leerCrec(id);
    expect(g.mundos.map((m) => m.id)).not.toContain(MUN.casual);
    const r = await poner(id, cuerpoDe(g, 12, { resto: { pct: 5, nota: null } }));
    expect(r.status).toBe(200);
    const d = (await leer<RespuestaGuardarCrecimientosApi>(r)).data;
    expect(d.celdas_descartadas).toEqual([
      { genero: "HOMBRE", mundo: "CASUAL", pct: 12 },
      { genero: "MUJER", mundo: "CASUAL", pct: 12 },
    ]);
    expect(casual).toHaveLength(2);
    expect(celdasDb().filter((c) => c.mundo_id === MUN.casual)).toHaveLength(0);
  });
});

describe("regla 14: copia y parámetros", () => {
  it("copiar_de copia las celdas (con su nota y su quién) y el objetivo; el Resto es el crecimiento_pct_defecto del cuerpo", async () => {
    const a = await nueva("Origen");
    await poner(a.id, cuerpoDe(await leerCrec(a.id), 12, { resto: { pct: 6, nota: "n" }, objetivo_pct: 11 }, {}));
    // Una nota en una celda.
    const g = await leerCrec(a.id);
    const conNota = cuerpoDe(g, 12, {});
    conNota.celdas[0] = { ...conNota.celdas[0], nota: "por Fiestas" };
    conNota.resto = { pct: 6, nota: "n" };
    await poner(a.id, { ...conNota, objetivo_pct: 11 });
    const b = await nueva("Copia", { copiar_de: a.id, parametros: { crecimiento_pct_defecto: 4 } });
    expect(b.r.status).toBe(201);
    const delB = celdasDb().filter((c) => c.proyeccion_id === b.id);
    const delA = celdasDb().filter((c) => c.proyeccion_id === a.id);
    expect(delB).toHaveLength(delA.length);
    expect(delB.find((c) => c.nota === "por Fiestas")).toMatchObject({ usuario_nombre: "Javier" });
    expect(b.cuerpo.data.parametros).toMatchObject({ crecimiento_pct_defecto: 4, crecimiento_objetivo_pct: 11 });
    // El cálculo de la copia ya aplicó las celdas copiadas (12 % sobre DENIM).
    const denimB = filasDe("proyeccion_filas").find((f) => f.proyeccion_id === b.id && f.clave === DENIM_REC) as Fila;
    const reg = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === denimB.id && x.anio === 2027) as Fila;
    expect(reg.propuesto).toBe(Math.round((reg.base_siguiente as number) * 1.12));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(b.id)))).data.desactualizada).toEqual([]);
  });

  it("un PATCH con un crecimiento_pct_defecto distinto del vigente → 400 usar_crecimientos; con el mismo, pasa", async () => {
    const { id } = await nueva();
    const r = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_pct_defecto: 8 } }), ctx(id));
    expect(r.status).toBe(400);
    const c = await leer(r);
    expect(c.codigo).toBe("usar_crecimientos");
    expect(c.error).toContain("Crecimientos");
    expect((proyecciones()[0].parametros as Record<string, unknown>).crecimiento_pct_defecto).toBe(5);
    expect((await editar(enviar("PATCH", "/x", { parametros: { crecimiento_pct_defecto: 5, umbral_avance: 0.4 } }), ctx(id))).status).toBe(200);
  });

  it("un PATCH cuyo updated_at cambió entre la lectura y la escritura → 409 estado_cambiado sin escribir; el PATCH no borra lo del PUT", async () => {
    const { id } = await nueva();
    // «Otro» escribe la proyección justo entre la lectura del PATCH y su UPDATE (el trigger mueve `updated_at`).
    let toques = 0;
    base.alOperar = (tabla, operacion) => {
      if (tabla === "proyecciones" && operacion === "update" && toques++ === 0) (proyecciones()[0] as Fila).updated_at = "2099-01-01T00:00:00.000Z";
    };
    const r = await editar(enviar("PATCH", "/x", { nota: "hola", parametros: { umbral_avance: 0.4 } }), ctx(id));
    base.alOperar = null;
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("estado_cambiado");
    expect(proyecciones()[0].nota).toBeNull();
    expect((proyecciones()[0].parametros as Record<string, unknown>).umbral_avance).not.toBe(0.4);
  });

  it("un PUT cuya proyección cambió entre la lectura y el candado → 409 conflicto sin escribir nada", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    let toques = 0;
    base.alOperar = (tabla, operacion) => {
      if (tabla === "proyecciones" && operacion === "update" && toques++ === 0) (proyecciones()[0] as Fila).updated_at = "2099-01-01T00:00:00.000Z";
    };
    const r = await poner(id, cuerpoDe(g, 12));
    base.alOperar = null;
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("conflicto");
    expect(celdasDb()).toHaveLength(0);
    expect(proyecciones()[0].calculando_desde).toBeNull();
  });

  it("dos PUT seguidos con la misma huella: el segundo recibe 409 conflicto (el primero cambió la matriz)", async () => {
    const { id } = await nueva();
    const g = await leerCrec(id);
    expect((await poner(id, cuerpoDe(g, 12))).status).toBe(200);
    const segundo = await poner(id, cuerpoDe(g, 15));
    expect(segundo.status).toBe(409);
    expect((await leer(segundo)).codigo).toBe("conflicto");
  });
});

describe("07c, lecturas: matriz y líneas", () => {
  it("la Matriz trae base_siguiente y «Crec. mismas tiendas»: con un GM al 20 % sin filas fijadas, +20,0 % en su línea", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 20));
    const m = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data;
    const denim = m.nodos.find((n) => n.nivel === "linea" && n.nombre === "DENIM")!;
    expect(denim.siguiente.base_siguiente).toBe(1860 + 60);
    expect(denim.siguiente.crec_mismas_pct).toBeCloseTo(20, 0);
    expect(m.nodos[0].siguiente.base_siguiente).toBeGreaterThan(0);
    expect(m.nodos[0].siguiente.crec_mismas_pct).not.toBeNull();
  });

  it("la fila de 2027 trae crecimiento_efectivo (con su origen y su celda), base_siguiente, base_normalizada y los % brutos", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 20, {}, {}));
    await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 7, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2027" }));
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.casual}&linea_id=${LIN.abrigo}`), ctx(id)))).data;
    const abrigo = l.filas[0].anios.find((a) => a.anio === 2027)!;
    expect(abrigo.crecimiento_efectivo).toEqual({ pct: 20, origen: "celda", celda: "HOMBRE · CASUAL" });
    expect(abrigo.base_siguiente).toBeGreaterThan(0);
    expect(abrigo.pct_bruto).toBeCloseTo(20, 0);
    // Con Niño en 2026: sobre la base normalizada equivale a menos (B'' > B).
    expect(abrigo.base_normalizada as number).toBeGreaterThan(abrigo.base_siguiente as number);
    expect(abrigo.pct_sobre_normalizada as number).toBeLessThan(abrigo.pct_bruto as number);
    expect(l.totales_por_anio.find((t) => t.anio === 2027)?.base_siguiente).toBe(abrigo.base_siguiente);
    // La de DENIM tiene % propio.
    const l2 = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`), ctx(id)))).data;
    const rec = l2.filas.find((f) => f.agrupacion_marca === "RECONOCIDO")!.anios.find((a) => a.anio === 2027)!;
    expect(rec.crecimiento_efectivo).toEqual({ pct: 7, origen: "fila", celda: "HOMBRE · URBANO" });
    // Las filas de 2026 y las aperturas no llevan crecimiento efectivo.
    expect(l2.filas[0].anios.find((a) => a.anio === 2026)?.crecimiento_efectivo).toBeUndefined();
  });

  it("una línea con una fila sin base y con total decidido: el pie de «Línea (mismas)» y la Matriz dan el mismo «Crec. mismas tiendas» (la fila sin B no cuenta en ninguno de los dos lados)", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 20));
    // DENIM · RECONOCIDO pierde su B y tiene un total decidido a mano de 2027 (5 000 u): ese total no debe inflar el %.
    const sinB = registro(DENIM_REC, 2027);
    sinB.base_siguiente = null;
    sinB.decidido = 5000;
    const consulta = `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`;
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", consulta), ctx(id)))).data;
    const t = l.totales_por_anio.find((x) => x.anio === 2027)!;
    const m = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data;
    const denim = m.nodos.find((n) => n.nivel === "linea" && n.nombre === "DENIM")!;
    // Solo cuenta la otra fila de DENIM (con B = 60).
    expect(t.base_siguiente).toBe(60);
    expect(t.vigente).toBeGreaterThan(t.vigente_con_base);
    expect(t.vigente_con_base).toBeGreaterThan(0);
    expect(denim.siguiente.base_siguiente).toBe(t.base_siguiente);
    expect(denim.siguiente.crec_mismas_pct).not.toBeNull();
    expect((t.vigente_con_base / t.base_siguiente - 1) * 100).toBeCloseTo(denim.siguiente.crec_mismas_pct as number, 9);
  });

  it("archivar una proyección nunca la deja con la matriz abierta (solo lectura)", async () => {
    const { id } = await nueva();
    await poner(id, cuerpoDe(await leerCrec(id), 12));
    expect((await archivar(enviar("POST", "/x", {}), ctx(id))).status).toBe(200);
    const g = await leerCrec(id);
    expect(g.editable).toBe(false);
    expect(g.celdas.filter((c) => c.pct !== null)).toHaveLength(3);
    expect((await poner(id, cuerpoDe(g, 3))).status).toBe(409);
  });
});

describe("regla 12 de 07d: GET …/tiendas trae `escala` en las aperturas con V", () => {
  it("escala = { V, 12 V, F, 12 V F, con_meses_reales } en las aperturas con venta esperada y null en las demás; el comprador recibe 403", async () => {
    // T9 ya abrió (2026-03-01, con meses cerrados) y tiene V; T4 abre en 2027 (V = 85 000); T3 abrió sin V.
    contexto.tiendasExtra = { T9: { venta_esperada: 30000 } };
    const { id } = await nueva();
    const r = (await leer<RespuestaTiendasApi>(await tiendas(get("/t"), ctx(id)))).data;
    const de = (codigo: string, anio: number) => r.tiendas.find((t) => t.codigo === codigo && t.anio === anio)!;
    const t4 = de("T4", 2027).escala!;
    expect(t4).toMatchObject({ venta_mensual: 85000, anio_maduro: 1020000, con_meses_reales: false });
    expect(t4.fraccion).toBeGreaterThan(0);
    expect(t4.fraccion).toBeLessThan(1);
    expect(t4.venta_anio_apertura).toBeCloseTo(12 * 85000 * (t4.fraccion as number), 6);
    // T9 en su año (2026): ya tiene meses reales, la cifra por venta esperada es solo referencia.
    expect(de("T9", 2026).escala).toMatchObject({ venta_mensual: 30000, anio_maduro: 360000, con_meses_reales: true });
    // En el año siguiente T9 ya no es una apertura (abrió el año anterior): sin escala.
    expect(de("T9", 2027).escala).toBeNull();
    // Sin V (T3) y los cierres (T5): null.
    expect(de("T3", 2026).escala).toBeNull();
    expect(r.tiendas.filter((t) => t.bloque === "cierres").every((t) => t.escala === null)).toBe(true);
    estadoFalso.rol = "comprador";
    expect((await tiendas(get("/t"), ctx(id))).status).toBe(403);
  });
});
