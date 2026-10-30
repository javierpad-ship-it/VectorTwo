import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, sembrar, type Fila } from "./proyeccion.fake-db";
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

import { GET as estadoInicial } from "@/app/api/proyeccion/route";
import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { GET as leerUna, PATCH as editar } from "@/app/api/proyeccion/proyecciones/[id]/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { GET as lineas } from "@/app/api/proyeccion/proyecciones/[id]/lineas/route";
import { construirVenta, GEN, LIN, MUN, AM, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { ProyeccionApi, RespuestaLineasApi, RespuestaProyeccionApi } from "@/lib/proyeccion/tipos-api";

/**
 * 06d, reglas 9, 10, 14 y 15 (sintético): el cálculo lee el global y escribe la foto; B2, las explicaciones y las lecturas leen la foto; cerrar exige los
 * crecimientos aprobados (no se puede forzar) y se revierte si una aprobación entra a mitad; el `PATCH` del objetivo no pide recalcular.
 */

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;

const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const proyecciones = () => filasDe("proyecciones");
const foto = (id: string) => filasDe("proyeccion_crecimientos").filter((c) => c.proyeccion_id === id);
const globales = () => filasDe("crecimientos_genero_mundo");
const idFila = (clave: string) => filasDe("proyeccion_filas").find((f) => f.clave === clave)?.id as string;
const DENIM_REC = `|${N.denim}||${AM.rec}`;
const SANDALIA_VAL = `|${N.sandalia}||${AM.val}`;
const registro = (clave: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(clave) && a.anio === anio) as Fila;
const parametrosDe = (id: string) => proyecciones().find((p) => p.id === id)?.parametros as Record<string, unknown>;

async function nueva(nombre = "Proyección 2026–2027", extra: Record<string, unknown> = {}) {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }));
  const cuerpo = await leer<ProyeccionApi>(r);
  return { r, cuerpo, id: cuerpo.data?.id as string };
}
const leerProy = async (id: string) => (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
const recalcular = async (id: string) => expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
const cerrarConQuery = (id: string, query = "") => cerrar(new NextRequest(`${URL_BASE}/x${query}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id));

/** Decide lo grande (como pide cerrar) para que lo único que falte, si falta algo, sean los crecimientos. */
async function decidirTodo(id: string) {
  for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === null)) {
    for (const anio of [2026, 2027]) {
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
      if (a.propuesto !== null && (a.propuesto as number) >= 100) {
        expect((await decidirFila(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { filaId: f.id as string, anio: String(anio) }))).status).toBe(200);
      }
    }
  }
  for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
    expect((await decidirTienda(enviar("PUT", "/x", { origen: "propuesta" }), ctx(id, { tiendaId: t.tienda_id as string, anio: String(t.anio) }))).status).toBe(200);
  }
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  estadoFalso.rol = "planner";
  // `cargarMatriz` resuelve HOMBRE y MUJER en el catálogo de géneros (la foto solo se lee para esos).
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

describe("regla 9: cálculo y foto", () => {
  it("el cálculo lee los vigentes, pasa el Resto efectivo, escribe la foto y crecimiento_resto_usado y deja crecimiento_pct_defecto intacto", async () => {
    const filas = aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · URBANO": 15 }, resto: 10, sin: ["HOMBRE · CASUAL", "MUJER · CASUAL"] });
    const restoId = filas.find((f) => f.alcance === "resto")?.id;
    const urbanoId = filas.find((f) => f.pct === 15)?.id;
    const { id } = await nueva();
    // El provisional nunca se sobrescribe; el Resto aplicado va en su clave.
    expect(parametrosDe(id)).toMatchObject({
      crecimiento_pct_defecto: 5,
      // 06e: el Resto aplicado también dice sobre qué base se escribió su %.
      crecimiento_resto_usado: { pct: 10, crecimiento_id: restoId, version: 1, por_nombre: "Javier de prueba", at: "2026-10-10T12:00:00.000Z", sobre_base: "corregida" },
    });
    // La foto: solo el GM aprobado (con su versión, quién y sobre_base explícito); los otros siguen al Resto y no tienen celda.
    expect(foto(id)).toHaveLength(1);
    expect(foto(id)[0]).toMatchObject({ genero_id: GEN.hombre, mundo_id: MUN.urbano, pct: 15, sobre_base: "corregida", crecimiento_id: urbanoId, version: 1, usuario_nombre: "Javier de prueba", nota: null });
    // Las cifras (método 5: el % es sobre B'): DENIM (HOMBRE · URBANO, sin Niño: B' = B) al 15 % y SANDALIA (MUJER · CASUAL) al 10 % del Resto aprobado sobre su B' (verano 2026 con Niño).
    expect(registro(DENIM_REC, 2027)).toMatchObject({ propuesto: Math.round(1860 * 1.15) });
    const sandalia = registro(SANDALIA_VAL, 2027);
    expect(sandalia.propuesto).toBe(Math.round(Number(sandalia.base_normalizada) * 1.1));
    expect(Number(sandalia.base_normalizada)).toBeLessThan(Number(sandalia.base_siguiente));
    expect(registro(DENIM_REC, 2027).explicacion).toContain("15.0 % de HOMBRE · URBANO v1, sobre 2026 corregido");
    expect(sandalia.explicacion).toContain("10.0 % del Resto v1, sobre 2026 corregido");
    // Sin `crecimientos_cambiados`: la huella del cálculo es la de los vigentes de hoy (con ids).
    expect((await leerProy(id)).desactualizada).toEqual([]);
    expect((await leerProy(id)).resumen).not.toHaveProperty("huella_crecimientos");
  });

  it("sin Resto aprobado el Resto usado es el provisional (crecimiento_id null) y las lecturas lo marcan provisional", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: null });
    const { id } = await nueva();
    expect(parametrosDe(id)).toMatchObject({ crecimiento_pct_defecto: 5, crecimiento_resto_usado: { pct: 5, crecimiento_id: null, version: null, por_nombre: null, at: null } });
    expect(foto(id)).toHaveLength(3);
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.hombre}&mundo_id=${MUN.casual}&linea_id=${LIN.abrigo}`), ctx(id)))).data;
    expect(l.filas[0].anios.find((a) => a.anio === 2027)?.crecimiento_efectivo).toMatchObject({ pct: 12, origen: "celda", version: 1, provisional: false });
  });

  it("recalcular reescribe la foto: una versión nueva reemplaza a la anterior, y un GM que ya no tiene vigente pierde su celda", async () => {
    const filas = aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    expect(foto(id).map((c) => c.version)).toEqual([1, 1, 1]);
    // v2 de HOMBRE · URBANO (la v1 queda reemplazada) y MUJER · CASUAL se retira.
    const v1 = globales().find((g) => g.id === filas.find((x) => x.genero_id === GEN.hombre && x.mundo_id === MUN.urbano)?.id) as Fila;
    v1.estado = "reemplazada";
    globales().push({ ...v1, id: "00000000-0000-4000-8000-0000000000bb", version: 2, estado: "vigente", pct: 20 });
    (globales().find((g) => g.genero_id === GEN.mujer) as Fila).estado = "retirada";
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    await recalcular(id);
    expect((await leerProy(id)).desactualizada).toEqual([]);
    const celdas = foto(id);
    expect(celdas).toHaveLength(2);
    expect(celdas.find((c) => c.genero_id === GEN.hombre && c.mundo_id === MUN.urbano)).toMatchObject({ pct: 20, version: 2, crecimiento_id: "00000000-0000-4000-8000-0000000000bb" });
    expect(celdas.some((c) => c.genero_id === GEN.mujer)).toBe(false);
    expect(registro(DENIM_REC, 2027).propuesto).toBe(Math.round(1860 * 1.2));
  });

  it("aprobar otra versión con el MISMO valor también marca la proyección en trabajo (la foto debe decir quién decidió); recalcular lo limpia", async () => {
    const filas = aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    const resto = globales().find((g) => g.id === filas.find((x) => x.alcance === "resto")?.id) as Fila;
    resto.estado = "reemplazada";
    globales().push({ ...resto, id: "00000000-0000-4000-8000-0000000000cc", version: 2, estado: "vigente" });
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    await recalcular(id);
    expect(parametrosDe(id)).toMatchObject({ crecimiento_resto_usado: { pct: 5, version: 2, crecimiento_id: "00000000-0000-4000-8000-0000000000cc" } });
    expect((await leerProy(id)).desactualizada).toEqual([]);
  });

  it("regla 11: recalcular limpia crecimientos_cambiados y conserva las decisiones y el % propio", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 2300, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2027" }))).status).toBe(200);
    expect((await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 7, origen: "manual" }), ctx(id, { filaId: idFila(SANDALIA_VAL), anio: "2027" }))).status).toBe(200);
    for (const g of globales()) g.pct = 40;
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    await recalcular(id);
    expect((await leerProy(id)).desactualizada).toEqual([]);
    expect(registro(DENIM_REC, 2027)).toMatchObject({ decidido: 2300, origen: "manual" });
    expect(registro(SANDALIA_VAL, 2027).crecimiento_pct).toBe(7);
  });

  it("una cerrada no cambia aunque se apruebe otra versión: sigue sin desactualizada, con su foto y sus cifras", async () => {
    const filas = aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
    const antes = JSON.stringify([foto(id), parametrosDe(id), filasDe("proyeccion_fila_anios").map((a) => [a.id, a.propuesto, a.decidido])]);
    const v1 = globales().find((g) => g.id === filas[0].id) as Fila;
    v1.estado = "reemplazada";
    globales().push({ ...v1, id: "00000000-0000-4000-8000-0000000000dd", version: 2, estado: "vigente", pct: 50 });
    const p = await leerProy(id);
    expect(p.estado).toBe("cerrada");
    expect(p.desactualizada).toEqual([]);
    expect(p).not.toHaveProperty("crecimientos_sin_aprobar");
    expect(JSON.stringify([foto(id), parametrosDe(id), filasDe("proyeccion_fila_anios").map((a) => [a.id, a.propuesto, a.decidido])])).toBe(antes);
    // Recalcular una cerrada es 409: nunca se vuelve a calcular.
    expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(409);
  });
});

describe("regla 10: B2 lee la foto (B1)", () => {
  it("un PATCH de un umbral conserva crecimiento_resto_usado y decidir una fila de 2026 recalcula su 2027 con el 10 % de la foto, no con el provisional", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · URBANO": 15 }, resto: 10, sin: ["HOMBRE · CASUAL", "MUJER · CASUAL"] });
    const { id } = await nueva();
    const usado = parametrosDe(id).crecimiento_resto_usado;
    expect(usado).toMatchObject({ pct: 10, version: 1 });
    const r = await editar(enviar("PATCH", "/x", { parametros: { umbral_avance: 0.4, umbral_cola_larga: 150 } }), ctx(id));
    expect(r.status).toBe(200);
    // B1: `parametrosDe` deja pasar la clave; sin eso el PATCH la habría borrado y B2 habría vuelto al 5 % provisional.
    expect(parametrosDe(id).crecimiento_resto_usado).toEqual(usado);
    expect((await leer<ProyeccionApi>(r)).data.parametros.crecimiento_resto_usado).toEqual(usado);
    expect(parametrosDe(id).crecimiento_pct_defecto).toBe(5);
    // Decidir 2026 en una fila que sigue al Resto: su 2027 = round(B × 1,10).
    const ruta = { filaId: idFila(SANDALIA_VAL), anio: "2026" };
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 900, origen: "manual" }), ctx(id, ruta))).status).toBe(200);
    const sandalia = registro(SANDALIA_VAL, 2027);
    expect(sandalia.propuesto).toBe(Math.round(Number(sandalia.base_normalizada) * 1.1));
    expect(sandalia.explicacion).toContain("del Resto v1, sobre 2026 corregido");
    // Y la de HOMBRE · URBANO sigue al 15 % de su GM.
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1900, origen: "manual" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2026" }))).status).toBe(200);
    expect(registro(DENIM_REC, 2027)).toMatchObject({ base_siguiente: 1960, propuesto: Math.round(1960 * 1.15) });
  });

  it("la explicación de una tienda y crecimiento_efectivo en las lecturas usan el Resto de la foto", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 15, resto: 10, sin: ["MUJER · CASUAL"] });
    const { id } = await nueva();
    // Alguien aprueba otro Resto después de calcular: las lecturas siguen con lo aplicado (10 %).
    (globales().find((g) => g.alcance === "resto") as Fila).pct = 33;
    const l = (await leer<RespuestaLineasApi>(await lineas(get("/l", `?genero_id=${GEN.mujer}&mundo_id=${MUN.casual}&linea_id=${LIN.sandalia}`), ctx(id)))).data;
    expect(l.filas[0].anios.find((a) => a.anio === 2027)?.crecimiento_efectivo).toEqual({ pct: 10, origen: "resto", celda: "MUJER · CASUAL", version: 1, sobre_base: "corregida", provisional: false });
    const t = await decidirTienda(enviar("PUT", "/x", { rampa: [1, 1, 1] }), ctx(id, { tiendaId: "T4", anio: "2027" }));
    expect(t.status).toBe(200);
    const explicacion = (await leer<{ explicacion: string }>(t)).data.explicacion;
    expect(explicacion).not.toContain("33");
  });
});

describe("regla 14: cierre", () => {
  const todosAprobados = () => aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });

  it("sin aprobaciones: 409 crecimientos_sin_aprobar con los GM que faltan y el detalle; también con ?forzar=1", async () => {
    const { id } = await nueva();
    await decidirTodo(id);
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      const c = await leer(r);
      expect(c.codigo).toBe("crecimientos_sin_aprobar");
      expect(c.error).toBe(
        "Faltan 3 crecimientos aprobados para 2027 (HOMBRE · URBANO, HOMBRE · CASUAL, MUJER · CASUAL): apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo."
      );
      expect((c.detalle as { faltan: { clave: string; nombre: string }[]; resto_provisional: boolean }).faltan.map((f) => f.nombre).sort()).toEqual(["HOMBRE · CASUAL", "HOMBRE · URBANO", "MUJER · CASUAL"]);
      expect((c.detalle as { resto_provisional: boolean }).resto_provisional).toBe(false);
      expect((c.detalle as { faltan: { clave: string }[] }).faltan[0].clave).toMatch(/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/);
    }
    expect(proyecciones()[0].estado).toBe("en_trabajo");
  });

  it("la proyección en trabajo lo dice en crecimientos_sin_aprobar (cabecera) y el estado inicial avisa en prerrequisitos; con todo aprobado y recalculado, null y cierra", async () => {
    const { id } = await nueva();
    const p = await leerProy(id);
    expect(p.crecimientos_sin_aprobar).toMatchObject({ resto_provisional: false });
    expect(p.crecimientos_sin_aprobar?.faltan).toHaveLength(3);
    const e = (await leer<RespuestaProyeccionApi>(await estadoInicial())).data;
    expect(e.proyecciones[0].crecimientos_sin_aprobar?.faltan).toHaveLength(3);
    expect(e.prerrequisitos.avisa.find((m) => m.codigo === "crecimientos_sin_aprobar_anio")?.mensaje).toBe(
      "Para cerrar necesitarás aprobados los crecimientos de HOMBRE y MUJER por mundo y el Resto de 2027 (hoy: 0 GM aprobados; el Resto es provisional)."
    );
    expect(e.prerrequisitos.bloquea).toEqual([]);
    todosAprobados();
    // Recién aprobados, la proyección queda desactualizada por crecimientos (no se cierra, ni forzando) hasta recalcular.
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    await recalcular(id);
    const lista = await leerProy(id);
    expect(lista.desactualizada).toEqual([]);
    expect(lista.crecimientos_sin_aprobar).toBeNull();
    const e2 = (await leer<RespuestaProyeccionApi>(await estadoInicial())).data;
    expect(e2.proyecciones[0].crecimientos_sin_aprobar).toBeNull();
    expect(e2.prerrequisitos.avisa.map((m) => m.codigo)).not.toContain("crecimientos_sin_aprobar_anio");
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("crecimientos_cambiados tampoco se puede forzar; config_cambiada sí", async () => {
    todosAprobados();
    const { id } = await nueva();
    await decidirTodo(id);
    for (const g of globales()) g.pct = 6;
    const forzada = await cerrarConQuery(id, "?forzar=1");
    expect(forzada.status).toBe(409);
    expect((await leer(forzada)).codigo).toBe("crecimientos_cambiados");
    await recalcular(id);
    contexto.huellaFlujo = "otra-huella";
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["config_cambiada"]);
    const sin = await cerrarConQuery(id);
    expect((await leer(sin)).codigo).toBe("desactualizada");
    expect((await cerrarConQuery(id, "?forzar=1")).status).toBe(200);
  });

  it("un género fuera de HOMBRE y MUJER exige el Resto aprobado (el provisional no basta); un GM con venta pero sin filas base no se exige", async () => {
    // Con MUJER fuera de la lista de géneros detallados, sus filas base siguen el Resto: el Resto es obligatorio y los GM de MUJER ya no.
    contexto.generosMatriz = [GEN.hombre];
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: null });
    const { id } = await nueva();
    await decidirTodo(id);
    const r = await cerrarConQuery(id);
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("crecimientos_sin_aprobar");
    expect(c.detalle).toEqual({ faltan: [], resto_provisional: true, reaprobar: [] });
    expect(c.error).toContain("El Resto de 2027 es provisional");
    // Se aprueba el Resto y se recalcula: cierra. (El GM aprobado de MUJER · CASUAL no se aplica: ese género no es detallado.)
    sembrar("crecimientos_genero_mundo", [
      { anio_aplicacion: 2027, alcance: "resto", genero_id: null, mundo_id: null, version: 1, estado: "vigente", pct: 5, sobre_base: "corregida", base_tipo: "ninguna", referencia: {}, usuario_nombre: "Javier de prueba" },
    ]);
    await recalcular(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("M5: una aprobación que entra entre la comprobación y el UPDATE de cerrar revierte el cierre (y el archivado) y responde 409", async () => {
    const filas = todosAprobados();
    const a = await nueva("Primera");
    await decidirTodo(a.id);
    expect((await cerrarConQuery(a.id)).status).toBe(200);
    const b = await nueva("Segunda", { copiar_de: a.id });
    await decidirTodo(b.id);
    // Justo cuando el cierre de la segunda escribe `estado = cerrada`, «alguien» aprueba la v2 de HOMBRE · URBANO.
    let entro = false;
    base.alOperar = (tabla, operacion) => {
      if (tabla === "proyecciones" && operacion === "update" && !entro && proyecciones().some((p) => p.id === b.id && p.estado === "en_trabajo")) {
        // El primer UPDATE de proyecciones tras la comprobación es el archivado de la primera; el segundo, el cierre de la segunda.
        if (proyecciones().find((p) => p.id === a.id)?.estado === "archivada") {
          entro = true;
          const v1 = globales().find((g) => g.id === filas[0].id) as Fila;
          v1.estado = "reemplazada";
          globales().push({ ...v1, id: "00000000-0000-4000-8000-0000000000ee", version: 2, estado: "vigente" });
        }
      }
    };
    const r = await cerrarConQuery(b.id);
    base.alOperar = null;
    expect(entro).toBe(true);
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("crecimientos_cambiados");
    expect(c.error).toContain("el cierre se deshizo");
    expect(proyecciones().find((p) => p.id === b.id)?.estado).toBe("en_trabajo");
    expect(proyecciones().find((p) => p.id === a.id)?.estado).toBe("cerrada");
    // Recalcular y cerrar de nuevo funciona.
    await recalcular(b.id);
    expect((await cerrarConQuery(b.id)).status).toBe(200);
    expect(proyecciones().find((p) => p.id === a.id)?.estado).toBe("archivada");
  });
});

describe("regla 15: el PATCH del objetivo", () => {
  it("no marca recalculo_pendiente ni entra en ediciones; null lo quita; fuera de −95..500 → 400", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    const r = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 11.5 } }), ctx(id));
    expect(r.status).toBe(200);
    const p = (await leer<ProyeccionApi>(r)).data;
    expect(p.parametros).toMatchObject({ crecimiento_objetivo_pct: 11.5 });
    expect(p.parametros.recalculo_pendiente).toBeUndefined();
    expect(p.parametros.ediciones).toBeUndefined();
    expect(p.desactualizada).toEqual([]);
    expect(parametrosDe(id).crecimiento_resto_usado).toMatchObject({ pct: 5, version: 1 });
    // Junto a un umbral: solo el umbral pide recalcular y queda en ediciones.
    const r2 = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 9, umbral_cola_larga: 150 } }), ctx(id));
    const p2 = (await leer<ProyeccionApi>(r2)).data;
    expect(p2.parametros).toMatchObject({ crecimiento_objetivo_pct: 9, recalculo_pendiente: true });
    expect(p2.parametros.ediciones).toHaveLength(1);
    expect(p2.parametros.ediciones?.[0].cambios.map((c) => c.campo)).toEqual(["umbral_cola_larga"]);
    // Quitar el objetivo.
    const r3 = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: null } }), ctx(id));
    expect((await leer<ProyeccionApi>(r3)).data.parametros.crecimiento_objetivo_pct).toBeNull();
    for (const malo of [501, -96, "diez"]) {
      const x = await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: malo } }), ctx(id));
      expect(x.status).toBe(400);
    }
  });

  it("mover solo el objetivo en una proyección ya desactualizada no cambia sus motivos; en una cerrada responde 409", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 12, resto: 5 });
    const { id } = await nueva();
    await editar(enviar("PATCH", "/x", { parametros: { umbral_cola_larga: 150 } }), ctx(id));
    const antes = (await leerProy(id)).desactualizada.map((m) => m.codigo);
    expect(antes).toEqual(["recalculo_pendiente"]);
    await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 8 } }), ctx(id));
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(antes);
    proyecciones()[0].estado = "cerrada";
    expect((await editar(enviar("PATCH", "/x", { parametros: { crecimiento_objetivo_pct: 3 } }), ctx(id))).status).toBe(409);
  });
});
