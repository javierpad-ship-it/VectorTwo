import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { bd, clienteBd, reiniciarBd } from "./intercompany.fake-db";
import {
  EQ,
  MARCA,
  NODO,
  REGLA,
  equivalenciasDb,
  generosDb,
  lineasDb,
  marcasDb,
  mundosDb,
  nodosDb,
  reglaDb,
  reglasDb,
} from "./intercompany.fixture";
import type { ParticipacionFilaCerrada } from "@/lib/intercompany/tipos-api";

// Escenario de la cerrada de M7: lo decide cada test; `llamadas` anota los años pedidos.
const cerrada = vi.hoisted(() => ({
  modo: "0.10.1" as "0.10.1" | "0.10.0" | "sin" | "error",
  llamadas: [] as number[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./curvas.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteBd: c } = await import("./intercompany.fake-db");
  return { supabaseAdmin: () => c() };
});
vi.mock("@/lib/proyeccion/servicio", async () => {
  const { NextResponse: R } = await import("next/server");
  const f = await import("./intercompany.fixture");
  return {
    leerParticipacionesDeCerrada: async (anio: number) => {
      cerrada.llamadas.push(anio);
      if (cerrada.modo === "sin") return { data: null, respuesta: R.json({ error: "No hay una proyección cerrada que cubra el año.", codigo: "sin_cerrada" }, { status: 404 }) };
      if (cerrada.modo === "error") return { data: null, respuesta: R.json({ error: "Error inesperado en la base de datos." }, { status: 500 }) };
      const filas: ParticipacionFilaCerrada[] = cerrada.modo === "0.10.1" ? f.filasCerrada0101() : f.filasCerrada0100();
      return { data: f.respuestaCerrada(filas, anio), respuesta: null };
    },
  };
});

import { GET as listaReglas, POST as crear } from "@/app/api/intercompany/reglas/route";
import { PATCH as editar, DELETE as eliminar } from "@/app/api/intercompany/reglas/[id]/route";
import { GET as vigentes } from "@/app/api/intercompany/vigentes/route";
import { GET as aplicabilidad } from "@/app/api/intercompany/aplicabilidad/route";
import { leerReglasIntercompany } from "@/lib/intercompany/consultas";
import { reglaIntercompany } from "@/lib/intercompany/reglas";
import { subflujoIntercompany } from "@/lib/intercompany/subflujo";
import type { AplicabilidadApi, EliminarReglaApi, ReglaIntercompanyApi, VigentesIntercompanyApi } from "@/lib/intercompany/tipos-api";

/**
 * Handlers de M13 con el servicio REAL y una base en memoria: permisos (401 y 403), validaciones (400), 404 y 409, el flujo de
 * crear, editar y eliminar (idempotencia), `aplicable` contra la cerrada de M7, el contrato de M8 (`vigentes`) y la paginación
 * (ficha 13, reglas 1 a 4, 9 y casos 1 a 6).
 */

const URL_BASE = "http://localhost/api/intercompany";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: "POST" | "PATCH", ruta: string, cuerpo: unknown) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
type Cuerpo<T> = { data: T; error?: string; codigo?: string };
const leer = async <T = unknown>(r: Response) => (await r.json()) as Cuerpo<T>;
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";

const crearRegla = (extra: Record<string, unknown> = {}) =>
  crear(enviar("POST", "/reglas", { marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa, vigente_desde: "2027-01", pct_directo: 80, ...extra }));
const reglasEnBd = () => bd.tablas.intercompany_reglas;
const ids = (l: ReglaIntercompanyApi[]) => l.map((r) => r.id);

function sembrar(reglas = reglasDb()) {
  reiniciarBd({
    generos: generosDb(),
    mundos: mundosDb(),
    lineas: lineasDb(),
    genero_mundo_linea: nodosDb(),
    equivalencias: equivalenciasDb(),
    marcas: marcasDb(),
    intercompany_reglas: reglas,
  });
}

beforeEach(() => {
  // Solo se simula la fecha: `new Date()` da el 18 de octubre de 2026 (Lima), y las promesas siguen siendo reales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T17:00:00Z"));
  sembrar();
  cerrada.modo = "0.10.1";
  cerrada.llamadas = [];
  estadoFalso.rol = "planner";
});
afterEach(() => vi.useRealTimers());

describe("permisos: sin sesión 401 y comprador 403 en las cinco rutas, sin tocar datos ni la cerrada", () => {
  for (const rol of ["sin_sesion", "comprador"] as const) {
    it(rol, async () => {
      estadoFalso.rol = rol;
      const esperado = rol === "sin_sesion" ? 401 : 403;
      expect((await listaReglas(get("/reglas"))).status).toBe(esperado);
      expect((await crear(enviar("POST", "/reglas", {}))).status).toBe(esperado);
      expect((await editar(enviar("PATCH", `/reglas/${REGLA.jhCamisa}`, { pct_directo: 10 }), ctx(REGLA.jhCamisa))).status).toBe(esperado);
      expect((await eliminar(get(`/reglas/${REGLA.jhCamisa}`), ctx(REGLA.jhCamisa))).status).toBe(esperado);
      expect((await vigentes(get("/vigentes"))).status).toBe(esperado);
      expect((await aplicabilidad(get("/aplicabilidad", `?marca_id=${MARCA.jh}&genero_mundo_linea_id=${NODO.camisa}`))).status).toBe(esperado);
      expect(bd.tablasTocadas).toEqual([]);
      expect(cerrada.llamadas).toEqual([]);
      expect(reglasEnBd()).toHaveLength(6);
    });
  }
});

describe("GET /api/intercompany/reglas (caso 1)", () => {
  it("en oct-2026 (mes en curso por defecto): seis reglas, con la 0.10.1 todas aplicables, ninguna fuera de ámbito y cuatro con rango por defecto", async () => {
    const r = await listaReglas(get("/reglas"));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const { data } = await leer<ReglaIntercompanyApi[]>(r);
    expect(data).toHaveLength(6);
    expect(data.every((x) => x.aplicable === true && x.motivo_no_aplicable === null)).toBe(true);
    expect(data.some((x) => x.fuera_de_ambito)).toBe(false);
    expect(data.filter((x) => x.es_rango_defecto)).toHaveLength(4);
    expect(data.every((x) => x.avisos.length === 0 && x.pct_directo_observado === null)).toBe(true);
    // Orden estable: marca, ruta, vigente_desde.
    expect(data.map((x) => x.marca)).toEqual(["BETA", "DONATELLI", "JOHN HOLDEN", "JOHN HOLDEN", "VAN HEUSEN", "VAN HEUSEN"]);
    expect(cerrada.llamadas).toEqual([2026]);
  });

  it("la forma de una regla: ruta, nivel, mes aaaa-mm, hasta abierto, % del CD y rango", async () => {
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas")));
    const jh = data.find((x) => x.id === REGLA.jhCamisa)!;
    expect(jh).toMatchObject({
      marca_id: MARCA.jh,
      marca: "JOHN HOLDEN",
      genero_mundo_linea_id: NODO.camisa,
      equivalencia_id: null,
      ruta: "HOMBRE · FORMAL · CAMISA",
      nivel: "GMLE",
      vigente_desde: "2026-01",
      hasta_derivado: null,
      imi_min: 4,
      imi_max: 8,
      es_rango_defecto: true,
      pct_directo: 80,
      pct_cd: 20,
      nota: "acuerdo 2026",
      usuario_nombre: "Planner Uno",
    });
    const corta = data.find((x) => x.id === REGLA.jhCorta)!;
    expect(corta).toMatchObject({ ruta: "HOMBRE · FORMAL · CAMISA › M. CORTA", equivalencia_id: EQ.corta, imi_min: 3, imi_max: 6, es_rango_defecto: false, pct_cd: 50, hasta_derivado: null });
    expect(data.find((x) => x.id === REGLA.vhCasaca)).toMatchObject({ imi_min: 3, imi_max: 6, es_rango_defecto: false });
  });

  it("?mes= cambia cuál rige: en may-2026 aún no rige la específica; en dic-2025 solo DONATELLI; en dic-2024 ninguna", async () => {
    const mayo = (await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?mes=2026-05")))).data;
    expect(ids(mayo)).not.toContain(REGLA.jhCorta);
    expect(ids(mayo)).toContain(REGLA.jhCamisa);
    const dic = (await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?mes=2025-12")))).data;
    expect(ids(dic)).toEqual([REGLA.donaTerno]);
    const antes = await listaReglas(get("/reglas", "?mes=2024-12"));
    expect((await leer<ReglaIntercompanyApi[]>(antes)).data).toEqual([]);
    expect(cerrada.llamadas).toEqual([2026, 2025]); // sin reglas no se lee la cerrada
  });

  it("con una cerrada 0.10.0 VAN HEUSEN (sin tratamiento) no es aplicable: marca_sin_clave; JH y BETA sí", async () => {
    cerrada.modo = "0.10.0";
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas")));
    const por = (id: string) => data.find((x) => x.id === id)!;
    expect(por(REGLA.vhPolo)).toMatchObject({ aplicable: false, motivo_no_aplicable: "marca_sin_clave" });
    expect(por(REGLA.vhCasaca)).toMatchObject({ aplicable: false, motivo_no_aplicable: "marca_sin_clave" });
    expect(por(REGLA.jhCamisa).aplicable).toBe(true);
    expect(por(REGLA.betaTerno).aplicable).toBe(true);
    expect(por(REGLA.donaTerno).aplicable).toBe(true);
  });

  it("sin cerrada: aplicable null con sin_cerrada; un error al leer la cerrada se propaga (no se inventa)", async () => {
    cerrada.modo = "sin";
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas")));
    expect(data.every((x) => x.aplicable === null && x.motivo_no_aplicable === "sin_cerrada")).toBe(true);
    cerrada.modo = "error";
    expect((await listaReglas(get("/reglas"))).status).toBe(500);
  });

  it("?incluir_historial=1 trae todas las reglas; la regla del GML sigue abierta aunque exista la específica (caso 6)", async () => {
    const r = await crearRegla({ vigente_desde: "2026-08", pct_directo: 60 });
    expect(r.status).toBe(201);
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?incluir_historial=1")));
    expect(data).toHaveLength(7);
    const jh = data.filter((x) => x.marca_id === MARCA.jh && x.equivalencia_id === null);
    expect(jh.map((x) => [x.vigente_desde, x.hasta_derivado])).toEqual([["2026-01", "2026-07"], ["2026-08", null]]);
    expect(data.find((x) => x.id === REGLA.jhCorta)?.hasta_derivado).toBeNull();
    // Sin historial, en oct-2026 solo la de agosto; en mar-2026 la de enero.
    const oct = (await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas")))).data.filter((x) => x.marca_id === MARCA.jh && x.equivalencia_id === null);
    expect(oct.map((x) => x.vigente_desde)).toEqual(["2026-08"]);
    const mar = (await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?mes=2026-03")))).data.filter((x) => x.marca_id === MARCA.jh);
    expect(mar.map((x) => x.vigente_desde)).toEqual(["2026-01"]);
  });

  it("una regla inactiva (solo desde el SQL Editor) se lee como inexistente", async () => {
    sembrar(reglasDb().map((r) => (r.id === REGLA.jhCamisa ? { ...r, activo: false } : r)));
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?incluir_historial=1")));
    expect(ids(data)).not.toContain(REGLA.jhCamisa);
    expect(data).toHaveLength(5);
  });

  it("?mes= mal formado o incluir_historial raro → 400 con el mensaje; GET no escribe", async () => {
    const mal = await listaReglas(get("/reglas", "?mes=2026-13"));
    expect(mal.status).toBe(400);
    expect((await leer(mal)).error).toContain("mes: El mes debe ser el primer día de un mes");
    expect((await listaReglas(get("/reglas", "?mes=2026-10-15"))).status).toBe(400);
    expect((await listaReglas(get("/reglas", "?incluir_historial=2"))).status).toBe(400);
    expect(bd.escrituras).toEqual([]);
  });
});

describe("POST /api/intercompany/reglas (caso 4 y regla 9)", () => {
  it("sin imi_min ni imi_max se guarda 4 y 8 con es_rango_defecto; 201, quién y cuándo, y la fila en la base", async () => {
    const r = await crearRegla({ marca_id: MARCA.vh, genero_mundo_linea_id: NODO.polo, vigente_desde: "2027-01", pct_directo: 70 });
    expect(r.status).toBe(201);
    const { data } = await leer<ReglaIntercompanyApi>(r);
    expect(data).toMatchObject({ marca: "VAN HEUSEN", vigente_desde: "2027-01", imi_min: 4, imi_max: 8, es_rango_defecto: true, pct_directo: 70, pct_cd: 30, hasta_derivado: null, aplicable: true, avisos: [], usuario_nombre: "Javier" });
    const fila = reglasEnBd().find((f) => f.id === data.id)!;
    expect(fila).toMatchObject({ cobertura_min_meses: 4, cobertura_max_meses: 8, vigente_desde: "2027-01-01", equivalencia_id: null, nota: null, perfil_id: "99999999-9999-4999-8999-999999999999", usuario_nombre: "Javier" });
    expect(reglasEnBd()).toHaveLength(7);
  });

  it("con rango propio, equivalencia y nota; acepta vigente_desde como aaaa-mm-01; el vacío de la nota cuenta como sin nota", async () => {
    const r = await crearRegla({ equivalencia_id: EQ.larga, vigente_desde: "2026-02-01", imi_min: 3, imi_max: 6, pct_directo: 55.5, nota: "  prueba  " });
    expect(r.status).toBe(201);
    const { data } = await leer<ReglaIntercompanyApi>(r);
    expect(data).toMatchObject({ ruta: "HOMBRE · FORMAL · CAMISA › MANGA LARGA", equivalencia_id: EQ.larga, imi_min: 3, imi_max: 6, es_rango_defecto: false, pct_directo: 55.5, pct_cd: 44.5, nota: "prueba", vigente_desde: "2026-02" });
    const vacia = await leer<ReglaIntercompanyApi>(await crearRegla({ vigente_desde: "2027-03", nota: "   " }));
    expect(vacia.data.nota).toBeNull();
  });

  it("POST JOHN·CAMISA → 409 marca_en_conjunto con 'usa JOHN HOLDEN (cabeza)'; no escribe", async () => {
    const r = await crearRegla({ marca_id: MARCA.john });
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("marca_en_conjunto");
    expect(c.error).toContain("usa JOHN HOLDEN (cabeza)");
    expect(bd.escrituras).toEqual([]);
  });

  it("VARIOS → marca_generica; marca inactiva → marca_inactiva; nodo inactivo → nodo_no_vigente", async () => {
    expect(await leer(await crearRegla({ marca_id: MARCA.varios }))).toMatchObject({ codigo: "marca_generica" });
    expect(await leer(await crearRegla({ marca_id: MARCA.inactiva }))).toMatchObject({ codigo: "marca_inactiva" });
    const nv = await crearRegla({ genero_mundo_linea_id: NODO.inactivo });
    expect(nv.status).toBe(409);
    expect(await leer(nv)).toMatchObject({ codigo: "nodo_no_vigente" });
    expect(bd.escrituras).toEqual([]);
  });

  it("equivalencia de otro nodo → equivalencia_de_otro_nodo; en un nodo GML → nodo_no_gmle", async () => {
    expect(await leer(await crearRegla({ equivalencia_id: EQ.ternoX }))).toMatchObject({ codigo: "equivalencia_de_otro_nodo" });
    expect(await leer(await crearRegla({ marca_id: MARCA.donatelli, genero_mundo_linea_id: NODO.terno, equivalencia_id: EQ.ternoX }))).toMatchObject({ codigo: "nodo_no_gmle" });
  });

  it("404 si no existe la marca, el nodo o la equivalencia", async () => {
    expect((await crearRegla({ marca_id: INEXISTENTE })).status).toBe(404);
    expect((await crearRegla({ genero_mundo_linea_id: INEXISTENTE })).status).toBe(404);
    const eq = await crearRegla({ equivalencia_id: INEXISTENTE });
    expect(eq.status).toBe(404);
    expect((await leer(eq)).error).toBe("Equivalencia no encontrada.");
    expect(bd.escrituras).toEqual([]);
  });

  it("JOHN HOLDEN UNDERWEAR·CAMISA se acepta (es otra unidad de marca) con el aviso fuera_de_marcas_sugeridas; MUJER·POLO se acepta como fuera de ámbito", async () => {
    const u = await leer<ReglaIntercompanyApi>(await crearRegla({ marca_id: MARCA.underwear }));
    expect(u.data.avisos).toEqual(["fuera_de_marcas_sugeridas"]);
    const fuera = await crearRegla({ marca_id: MARCA.jh, genero_mundo_linea_id: NODO.muPolo });
    expect(fuera.status).toBe(201);
    expect((await leer<ReglaIntercompanyApi>(fuera)).data).toMatchObject({ fuera_de_ambito: true, aplicable: false, motivo_no_aplicable: "marca_sin_clave", avisos: [] });
  });

  it("JH·CAMISA 2026-01 otra vez → 409 clave_mes_repetido; la carrera (el único de la base, 23505) da lo mismo", async () => {
    const r = await crearRegla({ vigente_desde: "2026-01" });
    expect(r.status).toBe(409);
    expect(await leer(r)).toMatchObject({ codigo: "clave_mes_repetido", error: "Ya hay una regla de esa clave desde ese mes: edítala." });
    expect(bd.escrituras).toEqual([]);
    // Dos planners a la vez: la comprobación previa no ve la regla del otro, pero el único la rechaza.
    bd.fallo = () => ({ code: "23505", message: 'duplicate key value violates unique constraint "intercompany_reglas_clave_uniq"', details: null, hint: null });
    const carrera = await crearRegla({ vigente_desde: "2028-01" });
    expect(carrera.status).toBe(409);
    expect((await leer(carrera)).codigo).toBe("clave_mes_repetido");
  });

  it("idempotencia: repetir el mismo POST no duplica (la segunda vez es 409 y la base sigue con una sola regla nueva)", async () => {
    expect((await crearRegla({ vigente_desde: "2027-05" })).status).toBe(201);
    expect((await crearRegla({ vigente_desde: "2027-05" })).status).toBe(409);
    expect(reglasEnBd()).toHaveLength(7);
  });

  it("validaciones (400): porcentaje 100,5, tope 3 con mínimo 4, mes que no es primer día, rangos, decimales, nota larga, campos que faltan", async () => {
    const casos: [Record<string, unknown>, RegExp][] = [
      [{ pct_directo: 100.5 }, /entre 0 y 100/],
      [{ pct_directo: -1 }, /entre 0 y 100/],
      [{ pct_directo: 80.123 }, /dos decimales/],
      [{ imi_min: 4, imi_max: 3 }, /no puede ser menor que el mínimo/],
      [{ imi_min: 9 }, /no puede ser menor que el mínimo/], // el tope por defecto (8) queda por debajo
      [{ vigente_desde: "2026-01-15" }, /primer día de un mes/],
      [{ vigente_desde: "enero" }, /primer día de un mes/],
      [{ imi_min: 0.2 }, /entre 0.5 y 24/],
      [{ imi_max: 25 }, /entre 0.5 y 24/],
      [{ imi_min: 4.55 }, /un solo decimal/],
      [{ nota: "x".repeat(201) }, /200 caracteres/],
      [{ marca_id: "no-es-uuid" }, /identificador válido/],
    ];
    for (const [extra, mensaje] of casos) {
      const r = await crearRegla(extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect((await leer(r)).error, JSON.stringify(extra)).toMatch(mensaje);
    }
    const sinPct = await crear(enviar("POST", "/reglas", { marca_id: MARCA.jh, genero_mundo_linea_id: NODO.camisa, vigente_desde: "2027-01" }));
    expect(sinPct.status).toBe(400);
    const noJson = await crear(new NextRequest(`${URL_BASE}/reglas`, { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
    expect(noJson.status).toBe(400);
    expect(bd.escrituras).toEqual([]);
  });

  it("un máximo igual al mínimo es válido y el tope 24 también", async () => {
    expect((await crearRegla({ vigente_desde: "2027-06", imi_min: 5, imi_max: 5 })).status).toBe(201);
    expect((await crearRegla({ vigente_desde: "2027-07", imi_min: 0.5, imi_max: 24 })).status).toBe(201);
  });

  it("un error inesperado de la base no filtra su detalle a la pantalla", async () => {
    bd.fallo = () => ({ code: "XX000", message: "relation secreta fallo interno", details: null, hint: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await crearRegla({ vigente_desde: "2029-01" });
    expect(r.status).toBe(500);
    const c = await leer(r);
    expect(c.error).toBe("Error inesperado en la base de datos.");
    expect(JSON.stringify(c)).not.toContain("secreta");
    spy.mockRestore();
  });

  it("si la cerrada falla DESPUÉS de guardar, la regla queda guardada y llega con aplicable null (no se falla una escritura hecha)", async () => {
    cerrada.modo = "error";
    const r = await crearRegla({ vigente_desde: "2027-09" });
    expect(r.status).toBe(201);
    expect((await leer<ReglaIntercompanyApi>(r)).data).toMatchObject({ aplicable: null, motivo_no_aplicable: null });
    expect(reglasEnBd()).toHaveLength(7);
  });
});

describe("M13 · correcciones de QA (0.12.0)", () => {
  it("un mes con año fuera de 2000–2100 (0000-01, 2101-01, 9999-12) da 400 y no 500, en POST, GET y aplicabilidad; los extremos valen", async () => {
    for (const mes of ["0000-01", "1999-12", "2101-01", "9999-12"]) {
      const r = await crearRegla({ vigente_desde: mes });
      expect(r.status, mes).toBe(400);
      expect((await leer(r)).error, mes).toContain("año del mes debe estar entre 2000 y 2100");
      expect((await listaReglas(get("/reglas", `?mes=${mes}`))).status, mes).toBe(400);
      expect((await aplicabilidad(get("/aplicabilidad", `?marca_id=${MARCA.jh}&genero_mundo_linea_id=${NODO.camisa}&mes=${mes}`))).status, mes).toBe(400);
    }
    expect(bd.escrituras).toEqual([]);
    expect((await crearRegla({ vigente_desde: "2000-01" })).status).toBe(201);
    expect((await crearRegla({ vigente_desde: "2100-12" })).status).toBe(201);
  });

  it("una equivalencia inactiva se rechaza al crear con 409 equivalencia_inactiva y no escribe", async () => {
    reiniciarBd({
      generos: generosDb(),
      mundos: mundosDb(),
      lineas: lineasDb(),
      genero_mundo_linea: nodosDb(),
      equivalencias: equivalenciasDb().map((e) => (e.id === EQ.corta ? { ...e, activo: false } : e)),
      marcas: marcasDb(),
      intercompany_reglas: reglasDb(),
    });
    const r = await crearRegla({ equivalencia_id: EQ.corta, vigente_desde: "2027-03" });
    expect(r.status).toBe(409);
    const c = await leer(r);
    expect(c.codigo).toBe("equivalencia_inactiva");
    expect(c.error).toContain("inactiva");
    expect(bd.escrituras).toEqual([]);
    // La activa de al lado sigue pasando.
    expect((await crearRegla({ equivalencia_id: EQ.larga, vigente_desde: "2027-03" })).status).toBe(201);
  });

  it("si la LECTURA posterior al POST falla, la regla ya está guardada: 201 con la regla y el aviso aplicabilidad_no_evaluada (no 500)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    bd.falloLectura = (tabla) => (tabla === "intercompany_reglas" && bd.escrituras.length > 0 ? { code: "XX000", message: "fallo interno de lectura", details: null, hint: null } : null);
    const r = await crearRegla({ vigente_desde: "2027-04" });
    expect(r.status).toBe(201);
    const { data } = await leer<ReglaIntercompanyApi>(r);
    expect(data).toMatchObject({ vigente_desde: "2027-04", pct_directo: 80, aplicable: null, motivo_no_aplicable: null, hasta_derivado: null });
    expect(data.avisos).toEqual(["aplicabilidad_no_evaluada"]);
    expect(JSON.stringify(data)).not.toContain("fallo interno");
    expect(reglasEnBd()).toHaveLength(7);
    spy.mockRestore();
  });

  it("si falla la cerrada tras guardar, el aviso también llega (y suma al de marca fuera de las sugeridas); sin cerrada NO lleva aviso", async () => {
    cerrada.modo = "error";
    const u = await leer<ReglaIntercompanyApi>(await crearRegla({ marca_id: MARCA.underwear, vigente_desde: "2027-05" }));
    expect(u.data.avisos).toEqual(["fuera_de_marcas_sugeridas", "aplicabilidad_no_evaluada"]);
    cerrada.modo = "sin";
    const sin = await leer<ReglaIntercompanyApi>(await crearRegla({ vigente_desde: "2027-06" }));
    expect(sin.data).toMatchObject({ aplicable: null, motivo_no_aplicable: "sin_cerrada", avisos: [] });
  });

  it("PATCH con la cerrada caída guarda y responde 200 con el aviso", async () => {
    cerrada.modo = "error";
    const r = await editar(enviar("PATCH", `/reglas/${REGLA.jhCamisa}`, { pct_directo: 55 }), ctx(REGLA.jhCamisa));
    expect(r.status).toBe(200);
    expect((await leer<ReglaIntercompanyApi>(r)).data).toMatchObject({ pct_directo: 55, aplicable: null, avisos: ["aplicabilidad_no_evaluada"] });
  });

  it("la cerrada se lee UNA vez por petición (una lectura por año pedido)", async () => {
    await listaReglas(get("/reglas", "?incluir_historial=1"));
    expect(cerrada.llamadas).toHaveLength(1);
    cerrada.llamadas = [];
    await crearRegla({ vigente_desde: "2027-07" });
    expect(cerrada.llamadas).toHaveLength(1);
  });
});

describe("PATCH /api/intercompany/reglas/[id]", () => {
  const patch = (id: string, cuerpo: unknown) => editar(enviar("PATCH", `/reglas/${id}`, cuerpo), ctx(id));

  it("a 85 % → pct_cd 15 y queda a nombre de quien editó; el rango y la fecha no cambian", async () => {
    const r = await patch(REGLA.jhCamisa, { pct_directo: 85 });
    expect(r.status).toBe(200);
    const { data } = await leer<ReglaIntercompanyApi>(r);
    expect(data).toMatchObject({ pct_directo: 85, pct_cd: 15, imi_min: 4, imi_max: 8, vigente_desde: "2026-01", usuario_nombre: "Javier", es_rango_defecto: true });
    expect(reglasEnBd().find((f) => f.id === REGLA.jhCamisa)).toMatchObject({ pct_directo: 85, perfil_id: "99999999-9999-4999-8999-999999999999" });
  });

  it("editarla a 3–6 deja de ser 'por defecto'; volver a 4–8 lo recupera", async () => {
    expect((await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { imi_min: 3, imi_max: 6 }))).data).toMatchObject({ imi_min: 3, imi_max: 6, es_rango_defecto: false });
    expect((await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { imi_min: 4, imi_max: 8 }))).data.es_rango_defecto).toBe(true);
  });

  it("el tope ≥ mínimo se evalúa con los valores RESULTANTES: max 3 sobre 4–8 y min 9 sobre 4–8 → 400 rango_invalido; min 3 con max 8 vale", async () => {
    for (const cuerpo of [{ imi_max: 3 }, { imi_min: 9 }, { imi_min: 7, imi_max: 6 }]) {
      const r = await patch(REGLA.jhCamisa, cuerpo);
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect((await leer(r)).codigo).toBe("rango_invalido");
    }
    expect((await patch(REGLA.jhCamisa, { imi_min: 3 })).status).toBe(200);
    expect(reglasEnBd().find((f) => f.id === REGLA.jhCamisa)).toMatchObject({ cobertura_min_meses: 3, cobertura_max_meses: 8 });
  });

  it("la nota se edita y se borra con null o vacío", async () => {
    expect((await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { nota: "nuevo acuerdo" }))).data.nota).toBe("nuevo acuerdo");
    expect((await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { nota: null }))).data.nota).toBeNull();
    expect((await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCorta, { nota: "" }))).data.nota).toBeNull();
  });

  it("idempotente: repetir la misma edición responde lo mismo y NO vuelve a escribir (updated_at y quién no cambian)", async () => {
    const a = await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { pct_directo: 85 }));
    const escrituras = bd.escrituras.length;
    const b = await leer<ReglaIntercompanyApi>(await patch(REGLA.jhCamisa, { pct_directo: 85 }));
    expect(b.data).toEqual(a.data);
    expect(bd.escrituras).toHaveLength(escrituras);
    // Una edición que no cambia nada (mismos valores guardados) tampoco escribe.
    const c = await patch(REGLA.donaTerno, { imi_min: 4, imi_max: 8, pct_directo: 60 });
    expect(c.status).toBe(200);
    expect(bd.escrituras).toHaveLength(escrituras);
  });

  it("404 si la regla no existe o el id no es UUID; 400 con cuerpo vacío o con la fecha (no se edita)", async () => {
    expect((await patch(INEXISTENTE, { pct_directo: 10 })).status).toBe(404);
    expect((await patch("no-es-uuid", { pct_directo: 10 })).status).toBe(404);
    const vacio = await patch(REGLA.jhCamisa, {});
    expect(vacio.status).toBe(400);
    expect((await leer(vacio)).error).toContain("Indica qué cambiar");
    expect((await patch(REGLA.jhCamisa, { vigente_desde: "2026-03" })).status).toBe(400);
    expect((await patch(REGLA.jhCamisa, { pct_directo: 101 })).status).toBe(400);
    expect(reglasEnBd().find((f) => f.id === REGLA.jhCamisa)).toMatchObject({ pct_directo: 80 });
  });

  it("una regla inactiva (solo desde el SQL Editor) responde 404", async () => {
    sembrar(reglasDb().map((r) => (r.id === REGLA.jhCamisa ? { ...r, activo: false } : r)));
    expect((await patch(REGLA.jhCamisa, { pct_directo: 10 })).status).toBe(404);
  });
});

describe("DELETE /api/intercompany/reglas/[id] (casos 3 y 5)", () => {
  const borrar = (id: string) => eliminar(get(`/reglas/${id}`), ctx(id));

  it("eliminar JH·CAMISA › M. CORTA → regla_anterior_id null (la clave específica queda sin reglas; vuelve a mandar la del GML)", async () => {
    const r = await borrar(REGLA.jhCorta);
    expect(r.status).toBe(200);
    expect((await leer<EliminarReglaApi>(r)).data).toEqual({ id: REGLA.jhCorta, regla_anterior_id: null });
    expect(reglasEnBd().map((f) => f.id)).not.toContain(REGLA.jhCorta);
    expect(reglasEnBd()).toHaveLength(5);
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas")));
    expect(data.some((x) => x.id === REGLA.jhCorta)).toBe(false);
  });

  it("eliminar la de agosto deja la de enero abierta y regla_anterior_id apunta a enero", async () => {
    const nueva = (await leer<ReglaIntercompanyApi>(await crearRegla({ vigente_desde: "2026-08", pct_directo: 60 }))).data;
    expect((await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?incluir_historial=1")))).data.find((x) => x.id === REGLA.jhCamisa)?.hasta_derivado).toBe("2026-07");
    const r = await borrar(nueva.id);
    expect((await leer<EliminarReglaApi>(r)).data).toEqual({ id: nueva.id, regla_anterior_id: REGLA.jhCamisa });
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?incluir_historial=1")));
    expect(data.find((x) => x.id === REGLA.jhCamisa)?.hasta_derivado).toBeNull();
  });

  it("el anterior es el de la MISMA clave exacta: una regla de la equivalencia no es la anterior del GML", async () => {
    const nueva = (await leer<ReglaIntercompanyApi>(await crearRegla({ vigente_desde: "2026-09" }))).data;
    expect((await leer<EliminarReglaApi>(await borrar(nueva.id))).data.regla_anterior_id).toBe(REGLA.jhCamisa);
  });

  it("repetir el borrado → 404 (ya no está); id inexistente o mal formado → 404", async () => {
    expect((await borrar(REGLA.donaTerno)).status).toBe(200);
    expect((await borrar(REGLA.donaTerno)).status).toBe(404);
    expect((await borrar(INEXISTENTE)).status).toBe(404);
    expect((await borrar("no-es-uuid")).status).toBe(404);
  });

  it("un error de la base al borrar no filtra su detalle", async () => {
    bd.fallo = (_t, modo) => (modo === "delete" ? { code: "XX000", message: "detalle interno", details: null, hint: null } : null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await borrar(REGLA.donaTerno);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await leer(r))).not.toContain("interno");
    spy.mockRestore();
    expect(reglasEnBd()).toHaveLength(6);
  });
});

describe("GET /api/intercompany/vigentes: el contrato de M8", () => {
  it("todas las activas con hasta_derivado y las marcas con regla (por nombre); aplicable sin evaluar y SIN leer la cerrada", async () => {
    const r = await vigentes(get("/vigentes"));
    expect(r.status).toBe(200);
    const { data } = await leer<VigentesIntercompanyApi>(r);
    expect(data.reglas).toHaveLength(6);
    expect(data.marcas.map((m) => m.nombre)).toEqual(["BETA", "DONATELLI", "JOHN HOLDEN", "VAN HEUSEN"]);
    expect(data.reglas.every((x) => x.aplicable === null && x.motivo_no_aplicable === null && x.avisos.length === 0)).toBe(true);
    expect(cerrada.llamadas).toEqual([]);
  });

  it("?desde y ?hasta dejan las reglas que rigen en algún mes del rango (una regla cerrada por la siguiente no cuenta después de su 'hasta')", async () => {
    await crearRegla({ vigente_desde: "2026-08", pct_directo: 60 });
    const en = async (q: string) => ids((await leer<VigentesIntercompanyApi>(await vigentes(get("/vigentes", q)))).data.reglas);
    // 2025: solo DONATELLI (2025-03 en adelante).
    expect(await en("?desde=2025-01&hasta=2025-12")).toEqual([REGLA.donaTerno]);
    // Febrero a julio de 2026: la de enero de JH (cierra en 2026-07) sí; la de agosto aún no.
    const feb = await en("?desde=2026-02&hasta=2026-07");
    expect(feb).toContain(REGLA.jhCamisa);
    expect(feb).toHaveLength(6);
    // Desde septiembre: la de enero de JH ya cerró.
    const sep = await en("?desde=2026-09");
    expect(sep).not.toContain(REGLA.jhCamisa);
    expect(sep).toHaveLength(6);
    expect((await vigentes(get("/vigentes", "?desde=2026-09&hasta=2026-01"))).status).toBe(400);
  });

  it("M8 resuelve con reglaIntercompany sobre lo que devuelve (casos 2 y 3): M. CORTA en may-2026 → la del GML; en jul-2026 → la específica; el subflujo da compra 1 116 y, con 2–4, 156", async () => {
    const { data } = await leer<VigentesIntercompanyApi>(await vigentes(get("/vigentes")));
    expect(reglaIntercompany(data.reglas, MARCA.jh, NODO.camisa, EQ.corta, "2026-05")?.id).toBe(REGLA.jhCamisa);
    expect(reglaIntercompany(data.reglas, MARCA.jh, NODO.camisa, EQ.corta, "2026-07")?.id).toBe(REGLA.jhCorta);
    expect(reglaIntercompany(data.reglas, MARCA.jh, NODO.camisa, EQ.larga, "2026-07")?.id).toBe(REGLA.jhCamisa);
    const regla = reglaIntercompany(data.reglas, MARCA.jh, NODO.camisa, EQ.larga, "2026-10")!;
    const m = subflujoIntercompany({ demanda: Array(24).fill(1200), parte: 0.4, stock_inicial: 900, regla, meses: 1 })[0];
    expect(m.compra).toBe(1116);
    await editar(enviar("PATCH", `/reglas/${REGLA.jhCamisa}`, { imi_min: 2, imi_max: 4 }), ctx(REGLA.jhCamisa));
    const editada = (await leer<VigentesIntercompanyApi>(await vigentes(get("/vigentes")))).data.reglas.find((x) => x.id === REGLA.jhCamisa)!;
    expect(subflujoIntercompany({ demanda: Array(24).fill(1200), parte: 0.4, stock_inicial: 900, regla: editada, meses: 1 })[0].compra).toBe(156);
  });

  it("sin reglas devuelve listas vacías", async () => {
    sembrar([]);
    expect((await leer<VigentesIntercompanyApi>(await vigentes(get("/vigentes")))).data).toEqual({ reglas: [], marcas: [] });
  });
});

describe("GET /api/intercompany/aplicabilidad: el aviso antes de guardar", () => {
  const consultar = async (marca: string, nodo: string, extra = "") => aplicabilidad(get("/aplicabilidad", `?marca_id=${marca}&genero_mundo_linea_id=${nodo}${extra}`));

  it("VAN HEUSEN en POLO: aplicable con una 0.10.1 (por marca) y no con una 0.10.0; sin cerrada, sin_cerrada", async () => {
    const a = await leer<AplicabilidadApi>(await consultar(MARCA.vh, NODO.polo));
    expect(a.data).toEqual({ aplicable: true, motivo_no_aplicable: null, cerrada: { anio: 2026, cubre: "en_curso", con_por_marca: true } });
    cerrada.modo = "0.10.0";
    expect((await leer<AplicabilidadApi>(await consultar(MARCA.vh, NODO.polo))).data).toEqual({
      aplicable: false,
      motivo_no_aplicable: "marca_sin_clave",
      cerrada: { anio: 2026, cubre: "en_curso", con_por_marca: false },
    });
    cerrada.modo = "sin";
    expect((await leer<AplicabilidadApi>(await consultar(MARCA.vh, NODO.polo))).data).toEqual({ aplicable: null, motivo_no_aplicable: "sin_cerrada", cerrada: null });
  });

  it("?mes= fija el año de la cerrada; 404 marca o nodo; 400 con ids mal formados", async () => {
    await consultar(MARCA.jh, NODO.camisa, "&mes=2027-02");
    expect(cerrada.llamadas).toEqual([2027]);
    expect((await consultar(INEXISTENTE, NODO.camisa)).status).toBe(404);
    expect((await consultar(MARCA.jh, INEXISTENTE)).status).toBe(404);
    expect((await consultar("x", NODO.camisa)).status).toBe(400);
    expect((await aplicabilidad(get("/aplicabilidad"))).status).toBe(400);
  });
});

describe("paginación: las reglas no se cortan en 1 000 filas", () => {
  it("leerReglasIntercompany trae todas las reglas activas (2 300) en orden estable", async () => {
    const muchas = Array.from({ length: 2300 }, (_, i) =>
      reglaDb({ id: `00000000-0000-4000-8000-${String(100000 + i).padStart(12, "0")}`, marca_id: MARCA.jh, gml: NODO.camisa, eq: null, desde: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, min: 4, max: 8, pct: 10 })
    );
    sembrar(muchas);
    const r = await leerReglasIntercompany(clienteBd() as never);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2300);
    const meses = r.data.map((f) => f.vigente_desde);
    expect(meses).toEqual([...meses].sort());
  });

  it("el historial por la API también trae las 1 100 (y hasta_derivado se calcula sobre todas)", async () => {
    const muchas = Array.from({ length: 1100 }, (_, i) =>
      reglaDb({ id: `00000000-0000-4000-8000-${String(100000 + i).padStart(12, "0")}`, marca_id: MARCA.jh, gml: NODO.camisa, eq: null, desde: `${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, min: 4, max: 8, pct: 10 })
    );
    sembrar(muchas);
    const { data } = await leer<ReglaIntercompanyApi[]>(await listaReglas(get("/reglas", "?incluir_historial=1")));
    expect(data).toHaveLength(1100);
    expect(data.filter((x) => x.hasta_derivado === null)).toHaveLength(1);
    expect(data[0].hasta_derivado).toBe("2000-01");
  });
});

describe("estado de la respuesta", () => {
  it("todas las respuestas de la API van sin caché", async () => {
    for (const r of [
      await listaReglas(get("/reglas")),
      await crearRegla({ vigente_desde: "2030-01" }),
      await vigentes(get("/vigentes")),
      await listaReglas(get("/reglas", "?mes=zzz")),
    ]) {
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

