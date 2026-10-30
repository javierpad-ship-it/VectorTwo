import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

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
import { GET as crecimientos, PUT as putCrecimientos } from "@/app/api/proyeccion/proyecciones/[id]/crecimientos/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { GET as matriz } from "@/app/api/proyeccion/proyecciones/[id]/matriz/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { GET as tiendas } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/route";
import { POST as archivar } from "@/app/api/proyeccion/proyecciones/[id]/archivar/route";
import { construirVenta, GEN, LIN, MUN, AM, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import { VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import type { ProyeccionApi, ResumenCrecimientosProyeccionApi, RespuestaLineasApi, RespuestaMatrizApi, RespuestaTiendasApi } from "@/lib/proyeccion/tipos-api";

/**
 * 07c y 06d, rutas (sintético): desde `0.12.1` el crecimiento es global y se aprueba en Curvas de estacionalidad. `GET …/crecimientos` es un resumen de
 * solo lectura y `PUT` responde `410`; se prueban además el nodo que cambia de mundo, el método 3, B2 con la foto, las lecturas con la versión
 * aprobada, el `PATCH` de parámetros, archivar y la escala de las aperturas (07d).
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
const registro = (clave: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(clave) && a.anio === anio) as Fila;

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { r, cuerpo, id: cuerpo.data?.id as string };
}
/** El `PUT` retirado no recibe nada (no lee ni la petición): se llama como las demás rutas para probar justo eso. */
const guardar: (r: NextRequest, c: unknown) => Promise<Response> = putCrecimientos;
const resumen = async (id: string) => (await leer<ResumenCrecimientosProyeccionApi>(await crecimientos(get("/c"), ctx(id)))).data;
/** Una petición `PUT` con el cuerpo que se quiera (el servidor no debe leerlo). */
const poner = (id: string, cuerpo: unknown) => guardar(enviar("PUT", "/c", cuerpo), ctx(id));
const claveGm = (g: string, m: string) => `${g}.${m}`;

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  estadoFalso.rol = "planner";
  // Sin aprobaciones el cálculo usa el Resto provisional de la proyección; cada caso siembra lo que necesite con `aprobarCrecimientosFalsos(2027, …)`.
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
  it("sin sesión 401 y comprador 403 en GET y PUT; un id inexistente o mal formado es 404 en el GET", async () => {
    for (const rol of ["sin_sesion", "comprador"] as const) {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await crecimientos(get("/c"), ctx(INEXISTENTE))).status).toBe(esperado);
      expect((await poner(INEXISTENTE, {})).status).toBe(esperado);
    }
    estadoFalso.rol = "planner";
    expect((await crecimientos(get("/c"), ctx(INEXISTENTE))).status).toBe(404);
    expect((await crecimientos(get("/c"), ctx("no-es-uuid"))).status).toBe(404);
  });

  it("regla 13: PUT responde 410 crecimientos_globales al planner, sin leer el cuerpo (uno roto también) y sin escribir nada", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    const antes = JSON.stringify([filasDe("proyecciones"), filasDe("proyeccion_crecimientos"), filasDe("proyeccion_fila_anios")]);
    for (const cuerpo of [{}, { huella: "x", resto: { pct: 5 }, celdas: [] }, "esto no es json {"]) {
      const peticion = new NextRequest(`${URL_BASE}/c`, { method: "PUT", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
      const r = await guardar(peticion, ctx(id));
      expect(r.status).toBe(410);
      expect(peticion.bodyUsed).toBe(false);
      const c = await leer(r);
      expect(c.codigo).toBe("crecimientos_globales");
      expect(c.error).toBe("Los crecimientos se aprueban en Curvas de estacionalidad → Crecimiento por género × mundo.");
    }
    // Ni siquiera con un id que no existe: el 410 no consulta nada.
    expect((await poner(INEXISTENTE, {})).status).toBe(410);
    expect(JSON.stringify([filasDe("proyecciones"), filasDe("proyeccion_crecimientos"), filasDe("proyeccion_fila_anios")])).toBe(antes);
  });

  it("el resumen: HOMBRE y MUJER por mundo con lo aplicado (de la foto), lo vigente hoy, los agregados, el Resto, el Total, el puente y lo que falta aprobar; sin caché", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · URBANO": 15 }, resto: 10, sin: ["HOMBRE · CASUAL", "MUJER · CASUAL"] });
    const { id } = await nueva();
    const r = await crecimientos(get("/c"), ctx(id));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const g = (await leer<ResumenCrecimientosProyeccionApi>(r)).data;
    expect(g).toMatchObject({ anio_siguiente: 2027, version_metodo: VERSION_METODO, objetivo_pct: null, cambiados: [] });
    // Los 3 GM con filas base: HOMBRE · URBANO aprobado (v1, 15 %); los otros dos siguieron al Resto aprobado (10 %, v1).
    expect(g.filas.map((f) => `${f.genero} · ${f.mundo}`)).toEqual(["HOMBRE · URBANO", "HOMBRE · CASUAL", "MUJER · CASUAL"]);
    const urbano = g.filas[0];
    expect(urbano.clave).toBe(claveGm(GEN.hombre, MUN.urbano));
    expect(urbano.aplicado).toMatchObject({ pct: 15, version: 1, provisional: false, sobre_base: "corregida", por_nombre: "Javier de prueba", at: "2026-10-10T12:00:00.000Z" });
    expect(urbano.vigente_hoy).toMatchObject({ pct: 15, version: 1, por_nombre: "Javier de prueba" });
    expect(urbano.agregado).toMatchObject({ base_libre: 1860 + 60 });
    expect(urbano.resultante_pct).toBeCloseTo(15, 0);
    expect(urbano.enlace).toBe(`/planificacion/curvas-estacionalidad?gm=${urbano.clave}&anio=2027&proyeccion=${id}`);
    expect(g.filas[1].aplicado).toMatchObject({ pct: 10, version: 1, provisional: false });
    expect(g.filas[1].vigente_hoy).toBeNull();
    expect(g.resto).toMatchObject({ clave: "resto", genero: null, mundo: null, aplicado: { pct: 10, version: 1, provisional: false }, vigente_hoy: { pct: 10, version: 1 } });
    expect(g.resto.enlace).toContain("gm=resto");
    // Ninguna celda queda vacía: el Total se calcula.
    expect(g.total?.base_total).toBeGreaterThan(0);
    expect(g.total?.resultante_pct).not.toBeNull();
    expect(g.puente.total_en_curso).toBeGreaterThan(0);
    expect(g.puente.cierres_sin_decidir).toBe(1); // T5 cierra en 2027 y no tiene total decidido
    // Faltan por aprobar los dos GM (I4: los del `gm_gml` con filas base); el Resto no se exige: no hay filas de otros géneros.
    expect(g.sin_aprobar).toEqual({
      faltan: [
        { clave: claveGm(GEN.hombre, MUN.casual), nombre: "HOMBRE · CASUAL" },
        { clave: claveGm(GEN.mujer, MUN.casual), nombre: "MUJER · CASUAL" },
      ],
      resto_provisional: false,
      reaprobar: [],
    });
  });

  it("sin aprobaciones todo es el Resto provisional y no falta nada que cambiar; con un género fuera de HOMBRE y MUJER se exige el Resto", async () => {
    const { id } = await nueva();
    const g0 = await resumen(id);
    expect(g0.filas.every((f) => f.aplicado.provisional && f.aplicado.version === null && f.aplicado.pct === 5)).toBe(true);
    expect(g0.resto.aplicado).toMatchObject({ pct: 5, version: null, provisional: true });
    expect(g0.sin_aprobar?.faltan).toHaveLength(3);
    expect(g0.sin_aprobar?.resto_provisional).toBe(false);
    // Quitamos MUJER del catálogo de géneros activos: sus filas pasan al Resto, que ahora se exige (y es provisional).
    base.tablas.generos = [{ id: GEN.hombre, nombre: "HOMBRE", orden: 1, activo: true }, { id: GEN.mujer, nombre: "MUJER", orden: 2, activo: false }];
    const g = await resumen(id);
    expect(g.filas.map((f) => f.genero)).toEqual(["HOMBRE", "HOMBRE"]);
    expect(g.resto.agregado.base).toBeGreaterThan(0);
    expect(g.resto.por_genero.map((x) => x.genero)).toContain("MUJER");
    expect(g.resto.por_genero.reduce((s, x) => s + x.base, 0)).toBe(g.resto.agregado.base);
    expect(g.sin_aprobar?.resto_provisional).toBe(true);
    expect(g0.resto.agregado.base).toBe(0);
  });

  it("una versión nueva aprobada después de calcular aparece en `cambiados` (aplicado v1 → vigente v2) y cerrada no se marca", async () => {
    const [urbano] = aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · URBANO": 12 }, resto: 5 });
    const { id } = await nueva();
    expect((await resumen(id)).cambiados).toEqual([]);
    // Alguien aprueba la v2 de HOMBRE · URBANO (15 %): la v1 pasa a `reemplazada`.
    urbano.estado = "reemplazada";
    const [v2] = [{ ...urbano, id: "00000000-0000-4000-8000-0000000000aa", version: 2, estado: "vigente", pct: 15 }];
    base.tablas.crecimientos_genero_mundo.push(v2);
    const g = await resumen(id);
    expect(g.cambiados).toEqual([{ clave: claveGm(GEN.hombre, MUN.urbano), nombre: "HOMBRE · URBANO", aplicado: { pct: 12, version: 1 }, vigente: { pct: 15, version: 2 } }]);
    expect(g.filas[0].aplicado).toMatchObject({ pct: 12, version: 1 });
    expect(g.filas[0].vigente_hoy).toMatchObject({ pct: 15, version: 2 });
    proyecciones()[0].estado = "cerrada";
    expect((await resumen(id)).cambiados).toEqual([]);
  });

  it("06e: el resumen dice sobre qué base se aplicó cada GM (la foto), lista lo que hay que reaprobar y el Total es «sobre 2026 corregido» con cada GM sobre su base", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · URBANO": 15, "HOMBRE · CASUAL": 20, "MUJER · CASUAL": 10 }, resto: 10, sobre: { "HOMBRE · CASUAL": "bruta", "HOMBRE · URBANO": "bruta" } });
    const { id } = await nueva();
    const g = await resumen(id);
    const por = Object.fromEntries(g.filas.map((f) => [`${f.genero} · ${f.mundo}`, f]));
    // La foto: `bruta` en los dos aprobados antes de 0.14.0, `corregida` en el de 0.14.0 y en el Resto.
    expect(por["HOMBRE · URBANO"].aplicado.sobre_base).toBe("bruta");
    expect(por["HOMBRE · CASUAL"].aplicado.sobre_base).toBe("bruta");
    expect(por["MUJER · CASUAL"].aplicado.sobre_base).toBe("corregida");
    expect(g.resto.aplicado.sobre_base).toBe("corregida");
    // Solo HOMBRE · CASUAL (ABRIGO, invierno con Niño) hay que reaprobarlo: HOMBRE · URBANO bruta sin Niño material cierra (R17).
    expect(g.sin_aprobar?.reaprobar).toEqual([expect.objectContaining({ clave: claveGm(GEN.hombre, MUN.casual), nombre: "HOMBRE · CASUAL", version: 1 })]);
    expect(g.sin_aprobar?.faltan).toEqual([]);
    // El agregado trae B' (base corregida) y el Total pondera cada GM sobre su base: el bruto sobre B, los corregidos sobre B'.
    expect(por["HOMBRE · CASUAL"].agregado.base_normalizada).toBeGreaterThan(por["HOMBRE · CASUAL"].agregado.base);
    const filaTotal = g.total?.filas.find((f) => f.genero === "HOMBRE" && f.mundo === "CASUAL");
    expect(filaTotal?.base).toBe(por["HOMBRE · CASUAL"].agregado.base);
    expect(filaTotal?.siguiente).toBeCloseTo(por["HOMBRE · CASUAL"].agregado.base * 1.2, 0);
    const mujer = g.total?.filas.find((f) => f.genero === "MUJER" && f.mundo === "CASUAL");
    expect(mujer?.base).toBe(por["MUJER · CASUAL"].agregado.base_normalizada);
    expect(mujer?.pct_resultante_real).not.toBeUndefined();
  });

  it("una proyección de método anterior (3): version_metodo = 3, sin Total y sin cambiados; recalcular la pone al día", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    const p = proyecciones()[0];
    p.resumen = { ...(p.resumen as Record<string, unknown>), version_metodo: 3, huella_crecimientos: undefined, gm_gml: undefined };
    const g = await resumen(id);
    expect(g).toMatchObject({ version_metodo: 3, total: null, cambiados: [], sin_aprobar: null });
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    expect(await resumen(id)).toMatchObject({ version_metodo: VERSION_METODO });
  });
});

describe("regla 9 y 12: la foto y los cambios del global", () => {
  it("un nodo con filas base que cambia de mundo produce crecimientos_cambiados (y no se puede forzar al cerrar); recalcular lo limpia", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    // El nodo DENIM pasa de URBANO a CASUAL en el árbol (el contexto vigente lo dice; el cálculo guardó URBANO).
    contexto.nodoMundo = { [N.denim]: MUN.casual };
    const p = (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
    expect(p.desactualizada.map((m) => m.codigo)).toContain("crecimientos_cambiados");
    const forzada = await cerrar(new NextRequest(`${URL_BASE}/x?forzar=1`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id));
    expect((await leer(forzada)).codigo).toBe("crecimientos_cambiados");
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    // Con el mundo nuevo, DENIM sigue al GM HOMBRE · CASUAL (12 % en el global).
    expect(registro(DENIM_REC, 2027).propuesto).toBe(Math.round(1860 * 1.12));
  });

  it("antes de 0.12.1 (sin crecimiento_resto_usado ni ids): el Resto de la foto es crecimiento_pct_defecto y la huella es la de 0.10.8, así que no se marca", async () => {
    const { id } = await nueva();
    const p = proyecciones()[0];
    const parametros = { ...(p.parametros as Record<string, unknown>) };
    delete parametros.crecimiento_resto_usado;
    p.parametros = parametros;
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada).toEqual([]);
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.casual}&linea_id=${LIN.abrigo}`), ctx(id)))).data;
    expect(l.filas[0].anios.find((a) => a.anio === 2027)?.crecimiento_efectivo).toMatchObject({ pct: 5, origen: "resto", provisional: true, version: null });
  });

  it("regla 10 (B2 en el acto): decidir 2026 usa el % de la FOTO (12 %), aunque el global ya tenga otro; recalcular lo cambia", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    // Alguien aprueba un % distinto después de calcular: la proyección queda desactualizada, pero B2 sigue con lo aplicado.
    for (const f of filasDe("crecimientos_genero_mundo").filter((x) => x.alcance === "gm")) f.pct = 30;
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data.desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    const r = await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2026" }));
    expect(r.status).toBe(200);
    // B = 1 900 + 300 − 240 = 1 960; al 12 % bruto de la foto.
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 1960, propuesto: Math.round(1960 * 1.12) });
    // Decidir una tienda que pasa a mismas tiendas también rehace B con la foto.
    await decidirTienda(enviar("PUT", "/x", { decidido: 400, origen: "manual" }), ctx(id, { tiendaId: "T2", anio: "2026" }));
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 2060, propuesto: Math.round(2060 * 1.12) });
    // Al recalcular se lee el global nuevo.
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
    const recalculada = registro(DENIM_REC, 2027);
    expect(recalculada.propuesto).toBe(Math.round((recalculada.base_siguiente as number) * 1.3));
  });
});

describe("regla 14: copia y parámetros", () => {
  it("copiar_de ya no copia celdas: el primer cálculo escribe la foto desde el global; el objetivo sí se copia", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 6 });
    const a = await nueva("Origen");
    expect((await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 11 } }), ctx(a.id))).status).toBe(200);
    const b = await nueva("Copia", { copiar_de: a.id, parametros: { crecimiento_pct_defecto: 4 } });
    expect(b.r.status).toBe(201);
    expect(b.cuerpo.data.parametros).toMatchObject({ crecimiento_pct_defecto: 4, crecimiento_objetivo_pct: 11, crecimiento_resto_usado: { pct: 6, version: 1 } });
    // La foto de la copia sale del global (no de las celdas del origen) y el cálculo ya aplicó el 12 % sobre DENIM.
    const delB = celdasDb().filter((c) => c.proyeccion_id === b.id);
    expect(delB).toHaveLength(3);
    expect(delB.every((c) => c.crecimiento_id !== null && c.version === 1 && c.nota === null)).toBe(true);
    const denimB = filasDe("proyeccion_filas").find((f) => f.proyeccion_id === b.id && f.clave === DENIM_REC) as Fila;
    const reg = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === denimB.id && x.anio === 2027) as Fila;
    expect(reg.propuesto).toBe(Math.round((reg.base_siguiente as number) * 1.12));
    expect((await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(b.id)))).data.desactualizada).toEqual([]);
  });

  it("un PATCH con un crecimiento_pct_defecto distinto del vigente → 400 usar_crecimientos con el texto nuevo; con el mismo, pasa", async () => {
    const { id } = await nueva();
    const r = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_pct_defecto: 8 } }), ctx(id));
    expect(r.status).toBe(400);
    const c = await leer(r);
    expect(c.codigo).toBe("usar_crecimientos");
    expect(c.error).toBe("El Resto provisional solo se fija al crear la proyección; el Resto aprobado se aprueba en Curvas de estacionalidad → Crecimiento por género × mundo.");
    expect((proyecciones()[0].parametros as Record<string, unknown>).crecimiento_pct_defecto).toBe(5);
    expect((await editar(enviar("PATCH", "/x", { parametros: { crecimiento_pct_defecto: 5, umbral_avance: 0.4 } }), ctx(id))).status).toBe(200);
  });

  it("un PATCH cuyo updated_at cambió entre la lectura y la escritura → 409 estado_cambiado sin escribir", async () => {
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
});

describe("07c, lecturas: matriz y líneas (con la versión aprobada)", () => {
  it("la Matriz trae base_siguiente y «Crec. mismas tiendas»: con los GM al 20 % sin filas fijadas, +20,0 % en su línea", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 20, resto: 5 });
    const { id } = await nueva();
    const m = (await leer<RespuestaMatrizApi>(await matriz(get("/m"), ctx(id)))).data;
    const denim = m.nodos.find((n) => n.nivel === "linea" && n.nombre === "DENIM")!;
    expect(denim.siguiente.base_siguiente).toBe(1860 + 60);
    expect(denim.siguiente.crec_mismas_pct).toBeCloseTo(20, 0);
    expect(m.nodos[0].siguiente.base_siguiente).toBeGreaterThan(0);
    expect(m.nodos[0].siguiente.crec_mismas_pct).not.toBeNull();
  });

  it("la fila de 2027 trae crecimiento_efectivo con su origen, celda, versión, sobre_base y si es el Resto provisional, base_siguiente, base_normalizada (B') y los % sobre corregido y sobre real", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 20, resto: null, sin: ["MUJER · CASUAL"] });
    const { id } = await nueva();
    await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 7, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2027" }));
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.casual}&linea_id=${LIN.abrigo}`), ctx(id)))).data;
    const abrigo = l.filas[0].anios.find((a) => a.anio === 2027)!;
    expect(abrigo.crecimiento_efectivo).toEqual({ pct: 20, origen: "celda", celda: "HOMBRE · CASUAL", version: 1, sobre_base: "corregida", provisional: false });
    expect(abrigo.base_siguiente).toBeGreaterThan(0);
    // Método 5: el 20 % es sobre 2026 corregido (B' = B ÷ φ con el invierno 2026 a 0,66) y equivale a más sobre 2026 real.
    expect(abrigo.pct_sobre_normalizada).toBeCloseTo(20, 0);
    expect(abrigo.base_normalizada as number).toBeGreaterThan(abrigo.base_siguiente as number);
    expect(abrigo.pct_bruto as number).toBeGreaterThan(abrigo.pct_sobre_normalizada as number);
    expect(l.totales_por_anio.find((t) => t.anio === 2027)?.base_siguiente).toBe(abrigo.base_siguiente);
    // La de DENIM tiene % propio: sin versión.
    const l2 = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.urbano}&linea_id=${LIN.denim}`), ctx(id)))).data;
    const rec = l2.filas.find((f) => f.agrupacion_marca === "RECONOCIDO")!.anios.find((a) => a.anio === 2027)!;
    expect(rec.crecimiento_efectivo).toEqual({ pct: 7, origen: "fila", celda: "HOMBRE · URBANO", version: null, sobre_base: "corregida", provisional: false });
    // Una de MUJER · CASUAL no tiene GM aprobado ni Resto aprobado: el Resto provisional de la proyección (5 %).
    const l3 = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.mujer}&mundo_id=${MUN.casual}&linea_id=${LIN.sandalia}`), ctx(id)))).data;
    expect(l3.filas[0].anios.find((a) => a.anio === 2027)?.crecimiento_efectivo).toEqual({ pct: 5, origen: "resto", celda: "MUJER · CASUAL", version: null, sobre_base: "corregida", provisional: true });
    // Las filas de 2026 y las aperturas no llevan crecimiento efectivo.
    expect(l2.filas[0].anios.find((a) => a.anio === 2026)?.crecimiento_efectivo).toBeUndefined();
  });

  it("con el Resto aprobado, el origen de un GM sin aprobar es «Resto v1», no provisional", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 20, resto: 9, sin: ["MUJER · CASUAL"] });
    const { id } = await nueva();
    const l3 = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.mujer}&mundo_id=${MUN.casual}&linea_id=${LIN.sandalia}`), ctx(id)))).data;
    expect(l3.filas[0].anios.find((a) => a.anio === 2027)?.crecimiento_efectivo).toEqual({ pct: 9, origen: "resto", celda: "MUJER · CASUAL", version: 1, sobre_base: "corregida", provisional: false });
  });

  it("una línea con una fila sin base y con total decidido: el pie de «Línea (mismas)» y la Matriz dan el mismo «Crec. mismas tiendas» (la fila sin B no cuenta en ninguno de los dos lados)", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 20, resto: 5 });
    const { id } = await nueva();
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

  it("archivar una proyección la deja con el resumen de solo lectura (con lo que aplicó)", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    expect((await archivar(enviar("POST", "/x", {}), ctx(id))).status).toBe(200);
    const g = await resumen(id);
    expect(g.filas.map((f) => f.aplicado.pct)).toEqual([12, 12, 12]);
    expect(g.cambiados).toEqual([]);
    expect(g.sin_aprobar).toBeNull();
    expect((await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 8 } }), ctx(id))).status).toBe(409);
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
