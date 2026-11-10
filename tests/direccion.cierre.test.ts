import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { base, estadoDireccion, reiniciar, type Fila } from "./direccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

// El mismo montaje que las pruebas de rutas de M7 (`tests/proyeccion.rutas.test.ts`), con el cliente falso de dirección (añade la huella).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
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

import { GET as bloqueos } from "@/app/api/direccion/bloqueos/route";
import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { armarBloqueos, causasDeCierre, contarFilasQueBloquean, vaciarCacheBloqueos } from "@/lib/direccion/cierre";
import type { BloqueosCierreApi } from "@/lib/direccion/tipos-api";
import { filaBloqueaCierre, motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import type { Motivo, ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AM, N, construirVenta, lineaDenimValor, tiendas as tiendasFixture } from "./proyeccion.fixture";

/**
 * Ficha 14 · R23: lo que bloquearía el cierre sale de las reglas de M7, sin copia. Para cada proyección en trabajo de la base falsa de M7 se compara
 * `GET /api/direccion/bloqueos` con lo que responde de verdad `POST …/cerrar`: mismo código y mismo mensaje; si no hay bloqueos, cierra; si todos son
 * forzables, cierra con `forzar`. Sintético.
 */

const URL_M7 = "http://localhost/api/proyeccion";
const enviar = (cuerpo: unknown = {}, consulta = "") => new NextRequest(`${URL_M7}/x${consulta}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const poner = (cuerpo: unknown) => new NextRequest(`${URL_M7}/x`, { method: "PUT", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
type Aplica = Extract<BloqueosCierreApi, { aplica: true }>;

async function nueva(nombre = "Proyección 2026–2027"): Promise<string> {
  const r = await crear(new NextRequest(`${URL_M7}/proyecciones`, { method: "POST", body: JSON.stringify({ nombre, parametros: { crecimiento_pct_defecto: 5 } }), headers: { "content-type": "application/json" } }));
  const c = await leer<ProyeccionApi>(r);
  expect(r.status, JSON.stringify(c).slice(0, 300)).toBe(201);
  return c.data.id;
}

async function decidirFilas(id: string, salvo?: string) {
  for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === null && x.id !== salvo)) {
    for (const anio of [2026, 2027]) {
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
      if (a.propuesto !== null && (a.propuesto as number) >= 100) expect((await decidirFila(poner({ origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }))).status).toBe(200);
    }
  }
}
async function decidirTiendas(id: string) {
  for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
    expect((await decidirTienda(poner({ origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }))).status).toBe(200);
  }
}

async function verBloqueos(id: string): Promise<Aplica> {
  vaciarCacheBloqueos();
  const r = await bloqueos(new NextRequest(`http://localhost/api/direccion/bloqueos?proyeccion_id=${id}`));
  const c = await leer<BloqueosCierreApi>(r);
  expect(r.status, JSON.stringify(c).slice(0, 300)).toBe(200);
  if (!c.data.aplica) throw new Error("se esperaba una proyección en trabajo");
  return c.data;
}

/**
 * La comparación de R23. Devuelve los bloqueos. OJO: si no hay bloqueos duros, `cerrar` cierra de verdad la proyección (es lo que se comprueba).
 */
async function compararConCerrar(id: string): Promise<Aplica> {
  const b = await verBloqueos(id);
  const sinForzar = await cerrar(enviar(), ctx(id));
  const c = await leer(sinForzar);
  if (b.bloqueos.length === 0) {
    expect(b.puede_cerrar).toBe(true);
    expect(sinForzar.status, JSON.stringify(c).slice(0, 300)).toBe(200);
    return b;
  }
  // Si cerrar respondería `409 X`, el primero de la lista es ese `X`, con el mismo código y el mismo mensaje.
  expect(b.puede_cerrar).toBe(false);
  expect(sinForzar.status).toBe(409);
  expect(b.bloqueos[0].codigo).toBe(c.codigo);
  expect(b.bloqueos[0].mensaje).toBe(c.error);
  if (b.bloqueos.every((x) => x.forzable)) {
    // Solo forzables: sin `forzar` es `409 desactualizada`; con `forzar`, cierra.
    expect(b.puede_forzar).toBe(true);
    expect(c.codigo).toBe("desactualizada");
    expect((await cerrar(enviar({}, "?forzar=1"), ctx(id))).status).toBe(200);
  } else {
    expect(b.puede_forzar).toBe(false);
    // Con `forzar` sigue respondiendo el primer bloqueo NO forzable de la lista.
    const forzada = await cerrar(enviar({}, "?forzar=1"), ctx(id));
    const cf = await leer(forzada);
    const duro = b.bloqueos.find((x) => !x.forzable);
    expect(forzada.status).toBe(409);
    expect(cf.codigo).toBe(duro?.codigo);
    expect(cf.error).toBe(duro?.mensaje);
  }
  return b;
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  vaciarCacheBloqueos();
  aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
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

describe("R23 · `GET /api/direccion/bloqueos` dice lo mismo que respondería «Cerrar»", () => {
  it("recién calculada: filas sin decidir (con el conteo por año, por motivo y en unidades) y, detrás, tiendas sin decidir", async () => {
    const id = await nueva();
    const b = await compararConCerrar(id);
    expect(b.bloqueos.map((x) => x.codigo)).toEqual(["filas_sin_decidir", "tiendas_sin_decidir"]);
    expect(b.bloqueos.every((x) => !x.forzable)).toBe(true);
    // El conteo sale de `filaBloqueaCierre`, registro a registro, sobre las mismas filas base.
    const umbral = 100;
    for (const conteo of b.filas) {
      const registros = filasDe("proyeccion_filas")
        .filter((f) => f.proyeccion_id === id && f.tienda_id === null && f.activo)
        .map((f) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === f.id && a.anio === conteo.anio && a.activo))
        .filter((a): a is Fila => a !== undefined)
        .filter((a) => filaBloqueaCierre({ propuesto: a.propuesto as number | null, decidido: a.decidido as number | null, avisos: (a.avisos as string[]) ?? [] }, umbral) !== null);
      expect(conteo.n, String(conteo.anio)).toBe(registros.length);
      expect(conteo.u).toBe(registros.reduce((s, a) => s + Number(a.propuesto), 0));
      expect(conteo.por_motivo.umbral + conteo.por_motivo.revision_cola_larga).toBe(conteo.n);
    }
    expect(b.filas.map((x) => x.anio)).toEqual([2026, 2027]);
    expect(b.filas[0].n).toBeGreaterThan(0);
    // El total de la causa es la suma de los dos años.
    expect((b.bloqueos[0].detalle as { total_filas_sin_decidir: number }).total_filas_sin_decidir).toBe(b.filas[0].n + b.filas[1].n);
  });

  it("solo faltan las tiendas nuevas; con todo decidido no hay bloqueos y cierra", async () => {
    const id = await nueva();
    await decidirFilas(id);
    const b = await compararConCerrar(id);
    expect(b.bloqueos.map((x) => x.codigo)).toEqual(["tiendas_sin_decidir"]);
    expect(b.filas.every((x) => x.n === 0)).toBe(true);
    await decidirTiendas(id);
    const listo = await compararConCerrar(id);
    expect(listo).toMatchObject({ puede_cerrar: true, puede_forzar: true, bloqueos: [] });
    // Ya cerrada: no aplica.
    const r = await bloqueos(new NextRequest(`http://localhost/api/direccion/bloqueos?proyeccion_id=${id}`));
    expect((await leer<BloqueosCierreApi>(r)).data).toEqual({ aplica: false });
  });

  it("crecimientos cambiados después de calcular: sale con SU código (no como «desactualizada») y no es forzable", async () => {
    const id = await nueva();
    await decidirFilas(id);
    await decidirTiendas(id);
    for (const g of filasDe("crecimientos_genero_mundo")) g.pct = 6;
    const b = await compararConCerrar(id);
    expect(b.bloqueos[0]).toMatchObject({ codigo: "crecimientos_cambiados", forzable: false });
    expect(b.bloqueos[0].mensaje).toContain("recalcula antes de cerrar");
    // Detrás va «desactualizada» (forzable), con sus motivos como objetos `{ codigo, mensaje }`.
    const des = b.bloqueos.find((x) => x.codigo === "desactualizada");
    expect(des?.forzable).toBe(true);
    const motivos = (des?.detalle as { motivos: { codigo: string; mensaje: string }[] }).motivos;
    expect(motivos.map((m) => m.codigo)).toContain("crecimientos_cambiados");
    expect(motivos.every((m) => typeof m.mensaje === "string" && m.mensaje.length > 0)).toBe(true);
    expect(b.puede_forzar).toBe(false);
  });

  it("solo desactualizada (cambió la configuración de marcas): un único bloqueo forzable; sin forzar `409 desactualizada`, con forzar cierra", async () => {
    const id = await nueva();
    await decidirFilas(id);
    await decidirTiendas(id);
    contexto.huellaFlujo = "otra-huella";
    const b = await compararConCerrar(id);
    expect(b.bloqueos).toHaveLength(1);
    expect(b.bloqueos[0]).toMatchObject({ codigo: "desactualizada", forzable: true });
    expect(b.bloqueos[0].mensaje).toBe("La proyección está desactualizada: recalcula, o ciérrala igual con «Cerrar de todos modos».");
    expect((b.bloqueos[0].detalle as { motivos: { codigo: string }[] }).motivos.map((m) => m.codigo)).toEqual(["config_cambiada"]);
    expect(b).toMatchObject({ puede_cerrar: false, puede_forzar: true });
  });

  it("sin los crecimientos aprobados: `crecimientos_sin_aprobar` con el mensaje del cierre y su detalle", async () => {
    base.tablas.crecimientos_genero_mundo = [];
    const id = await nueva();
    await decidirFilas(id);
    await decidirTiendas(id);
    const b = await compararConCerrar(id);
    expect(b.bloqueos[0].codigo).toBe("crecimientos_sin_aprobar");
    expect((b.bloqueos[0].detalle as { crecimientos_sin_aprobar: { faltan: unknown[] } }).crecimientos_sin_aprobar.faltan.length).toBeGreaterThan(0);
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    expect((await calcular(enviar(), ctx(id))).status).toBe(201);
    expect((await compararConCerrar(id)).bloqueos).toEqual([]);
  });

  it("calculada con un método anterior: `version_metodo` primero, con el mensaje del cierre («recalcúlala antes de cerrar»)", async () => {
    const id = await nueva();
    const p = filasDe("proyecciones").find((x) => x.id === id) as Fila;
    p.resumen = { ...(p.resumen as Fila), version_metodo: 4 };
    const b = await compararConCerrar(id);
    expect(b.bloqueos[0]).toMatchObject({ codigo: "version_metodo", forzable: false });
    expect(b.bloqueos[0].mensaje).toBe("La proyección se calculó con una versión anterior del método: recalcúlala antes de cerrar (esto no se puede forzar).");
    // Las demás causas siguen en la lista, cada una una sola vez.
    const codigos = b.bloqueos.map((x) => x.codigo);
    expect(codigos).toContain("filas_sin_decidir");
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("cola larga con quiebres para revisión: la cuenta `filaBloqueaCierre` aunque la propuesta esté bajo el umbral", async () => {
    contexto.hechos = [...contexto.hechos, ...lineaDenimValor(8)];
    const id = await nueva();
    const filaValor = filasDe("proyeccion_filas").find((f) => f.clave === `|${N.denim}||${AM.val}`) as Fila;
    await decidirFilas(id, filaValor.id as string);
    await decidirTiendas(id);
    const b = await compararConCerrar(id);
    expect(b.bloqueos[0].codigo).toBe("filas_sin_decidir");
    expect(b.bloqueos[0].mensaje).toContain("cola larga con quiebres de stock");
    const revision = b.filas.reduce((s, x) => s + x.por_motivo.revision_cola_larga, 0);
    expect(revision).toBe(2);
    expect((b.bloqueos[0].detalle as { total_filas_para_revision: number }).total_filas_para_revision).toBe(2);
  });

  it("`404` si no existe, `400` si el id falta o está mal formado, `409 calculo_en_curso` mientras se calcula, y `401`/`403` por rol", async () => {
    const id = await nueva();
    const pedir = (q: string) => bloqueos(new NextRequest(`http://localhost/api/direccion/bloqueos${q}`));
    expect((await pedir("?proyeccion_id=00000000-0000-4000-8000-999999999999")).status).toBe(404);
    expect((await pedir("?proyeccion_id=no-es-uuid")).status).toBe(400);
    expect((await pedir("")).status).toBe(400);
    (filasDe("proyecciones").find((x) => x.id === id) as Fila).calculando_desde = new Date().toISOString();
    const calculando = await pedir(`?proyeccion_id=${id}`);
    expect(calculando.status).toBe(409);
    expect((await leer(calculando)).codigo).toBe("calculo_en_curso");
    estadoFalso.rol = "comprador";
    expect((await pedir(`?proyeccion_id=${id}`)).status).toBe(403);
    estadoFalso.rol = "sin_sesion";
    expect((await pedir(`?proyeccion_id=${id}`)).status).toBe(401);
  });

  it("es solo lectura y se guarda 60 s por huella y cálculo: la segunda vez no vuelve a leer las filas", async () => {
    const id = await nueva();
    const antes = JSON.stringify(base.tablas);
    vaciarCacheBloqueos();
    const pedir = () => bloqueos(new NextRequest(`http://localhost/api/direccion/bloqueos?proyeccion_id=${id}`));
    const lecturas: string[] = [];
    base.alOperar = (tabla, operacion) => {
      if (operacion === "select") lecturas.push(tabla);
    };
    const uno = await leer(await pedir());
    const filasLeidas = lecturas.filter((t) => t === "proyeccion_filas").length;
    expect(filasLeidas).toBeGreaterThan(0);
    const dos = await leer(await pedir());
    expect(dos).toEqual(uno);
    expect(lecturas.filter((t) => t === "proyeccion_filas").length).toBe(filasLeidas);
    base.alOperar = null;
    expect(JSON.stringify(base.tablas)).toBe(antes);
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
  });
});

describe("el bucle de causas (puro)", () => {
  type Args = Parameters<typeof motivoRechazoCerrar>[0];
  const args = (extra: Partial<Args> = {}): Args => ({
    estado: "en_trabajo",
    calculandoDesde: null,
    ahora: "2026-11-10T15:00:00.000Z",
    anioEnCurso: 2026,
    filasBase: [],
    tiendas: [],
    desactualizada: false,
    forzar: false,
    umbralColaLarga: 100,
    ...extra,
  });
  const motivos = [{ codigo: "cargas_nuevas", mensaje: "Hay un mes nuevo publicado." }] as unknown as Motivo[];

  it("anota todas las causas a la vez, en el orden del cierre, y cada una con el código y el mensaje de `motivoRechazoCerrar`", () => {
    const todo = args({
      metodoViejo: true,
      crecimientosCambiados: true,
      crecimientosSinAprobar: { anio: 2027, faltan: [{ clave: "g.m", nombre: "HOMBRE · URBANO" }], resto_provisional: true },
      filasBase: [{ clave: "|a||b", anios: { 2026: { clave: "|a||b", propuesto: 500, decidido: null }, 2027: { clave: "|a||b", propuesto: 40, decidido: null, avisos: ["revision_cola_larga"] } } }],
      tiendas: [{ tienda_id: "t", anio: 2027, venta_esperada: 1000, decidido: null }],
      desactualizada: true,
    });
    const causas = causasDeCierre(todo, motivos);
    expect(causas.map((c) => c.codigo)).toEqual(["version_metodo", "crecimientos_cambiados", "crecimientos_sin_aprobar", "filas_sin_decidir", "tiendas_sin_decidir", "desactualizada"]);
    expect(causas.map((c) => c.forzable)).toEqual([false, false, false, false, false, true]);
    // El primero es exactamente lo que respondería el cierre.
    const primero = motivoRechazoCerrar(todo);
    expect(primero.ok).toBe(false);
    if (!primero.ok) expect(causas[0]).toMatchObject({ codigo: primero.rechazo.codigo, mensaje: primero.rechazo.mensaje });
    expect(causas[5].detalle).toEqual({ motivos: [{ codigo: "cargas_nuevas", mensaje: "Hay un mes nuevo publicado." }] });
    const b = armarBloqueos(todo, motivos);
    expect(b).toMatchObject({ aplica: true, puede_cerrar: false, puede_forzar: false });
    if (b.aplica) expect(b.filas).toEqual([
      { anio: 2026, n: 1, u: 500, por_motivo: { umbral: 1, revision_cola_larga: 0 } },
      { anio: 2027, n: 1, u: 40, por_motivo: { umbral: 0, revision_cola_larga: 1 } },
    ]);
  });

  it("sin causas: se puede cerrar; solo desactualizada: se puede forzar; nunca usa `forzar` para ocultar una causa", () => {
    expect(armarBloqueos(args(), [])).toMatchObject({ puede_cerrar: true, puede_forzar: true, bloqueos: [] });
    const des = armarBloqueos(args({ desactualizada: true, forzar: true }), motivos);
    expect(des).toMatchObject({ puede_cerrar: false, puede_forzar: true });
    if (des.aplica) expect(des.bloqueos.map((b) => [b.codigo, b.forzable])).toEqual([["desactualizada", true]]);
  });

  it("los bloqueos del Niño se anotan todos de una vez y ninguno es forzable; cerrada, archivada o calculándose cortan", () => {
    const nino = causasDeCierre(
      args({ bloqueosNino: { anioSiguienteAtipico: { meses: ["2027-02"] }, factorFaltante: [{ anio: 2026, temporada: "invierno" }], factorDesfasado: [], factorSinConfirmar: [], factoresCambiadosY: [], temporadaCambiada: false } }),
      []
    );
    expect(nino.map((c) => c.codigo)).toEqual(["anio_siguiente_atipico", "factor_faltante"]);
    expect(nino.every((c) => !c.forzable && c.detalle !== undefined)).toBe(true);
    expect(causasDeCierre(args({ estado: "cerrada", desactualizada: true }), []).map((c) => c.codigo)).toEqual(["ya_cerrada"]);
    expect(causasDeCierre(args({ estado: "archivada" }), []).map((c) => c.codigo)).toEqual(["archivada"]);
    expect(causasDeCierre(args({ calculandoDesde: "2026-11-10T14:55:00.000Z", metodoViejo: true }), []).map((c) => c.codigo)).toEqual(["calculo_en_curso"]);
  });

  it("el conteo usa el umbral que se le pasa y no cuenta decididas ni filas sin propuesta", () => {
    const filas: Args["filasBase"] = [
      { clave: "a", anios: { 2026: { clave: "a", propuesto: 100, decidido: null }, 2027: { clave: "a", propuesto: 99, decidido: null } } },
      { clave: "b", anios: { 2026: { clave: "b", propuesto: 900, decidido: 900 }, 2027: { clave: "b", propuesto: null, decidido: null } } },
    ];
    expect(contarFilasQueBloquean(filas, 2026, 100).map((x) => [x.anio, x.n, x.u])).toEqual([
      [2026, 1, 100],
      [2027, 0, 0],
    ]);
    expect(contarFilasQueBloquean(filas, 2026, 50).map((x) => x.n)).toEqual([1, 1]);
  });
});
