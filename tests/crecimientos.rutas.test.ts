import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DetalleGeneroMundoApi, ListaGeneroMundoApi, RespuestaAprobarCrecimientoApi } from "@/lib/crecimientos/tipos-api";
import { estadoFalso, type Fila } from "./crecimientos.fake-db";

// El módulo de la base falsa se carga dentro de la fábrica para que sea el mismo que importa este archivo.
vi.mock("@/lib/auth/guard", async () => (await import("./crecimientos.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./crecimientos.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});

import { GET as lista } from "@/app/api/curvas/genero-mundo/route";
import { GET as detalle, POST as aprobar } from "@/app/api/curvas/genero-mundo/[clave]/route";
import { vaciarCacheGM } from "@/lib/crecimientos/cache";
import { A_INV, A_VER, AHORA, G_H, G_M, G_N, HD, HR, HU, M_D, M_R, M_U, MU, NU, P1, P2, P3, PCT_CIERRE_CURVA_HU, TOTAL_HU, cuerpoAprobar, factorInvierno2026, seriesFixture, sembrar, ventaGMJson } from "./crecimientos.fixture";

const URL = "http://localhost/api/curvas/genero-mundo";
const get = (consulta = "") => new NextRequest(`${URL}${consulta}`);
const post = (cuerpo: unknown, clave = HU) => new NextRequest(`${URL}/${clave}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (clave: string) => ({ params: Promise.resolve({ clave }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const versiones = () => estadoFalso.tablas.crecimientos_genero_mundo as Fila[];
const periodosAtipicos = () => estadoFalso.tablas.periodos_atipicos as Fila[];
const factores = () => estadoFalso.tablas.factores_volumen_atipico as Fila[];

/** Cifras de HOMBRE · URBANO con las curvas planas del fixture (C_9 = 0,75, φ = 0,80 de junio a agosto): ver `crecimientos.fixture.ts`. */
const T_C = 44200 / 0.75; // T' sobre C(2026): el cierre corregido
const K_C = 41200 + (3 * T_C) / 12; // cierre real sobre C(2026)
// T05 vende 300 al mes desde junio de 2025: 2 700 reales en ene–set de 2026 y 2 925 corregidos (junio a agosto ÷ 0,80).
const T_M = (44200 + 2925) / 0.75; // T' sobre M(2027) (con T05): la base corregida por curva
const K_M = 41200 + 2700 + (3 * T_M) / 12;

/** Una versión `bruta` de antes de 0.14.0, como la dejaba la 06d (sin_nino_mas_rebote o bruto, sin la columna sobre_base en el insert). */
function sembrarBruta(clave: { genero_id: string | null; mundo_id: string | null; alcance?: string }, pct: number, base: { tipo: string; variante: string } = { tipo: "acumulado", variante: "bruto" }) {
  versiones().push({
    id: `vb-${clave.genero_id ?? "resto"}-${clave.mundo_id ?? ""}`,
    anio_aplicacion: 2027,
    alcance: clave.alcance ?? "gm",
    genero_id: clave.genero_id,
    mundo_id: clave.mundo_id,
    version: 1,
    estado: "vigente",
    pct,
    sobre_base: "bruta",
    nota: null,
    base_tipo: base.tipo,
    base_valor: null,
    referencia: { base: { tipo: base.tipo, anio: null, variante: base.variante }, gml_ids: [] },
    proyeccion_referencia_id: null,
    perfil_id: "99999999-9999-4999-8999-999999999999",
    usuario_nombre: "Javier",
    aprobada_at: "2026-10-20T11:00:00Z",
    created_at: "2026-10-20T11:00:00Z",
    updated_at: "2026-10-20T11:00:00Z",
  });
}

async function verDetalle(clave = HU, consulta = "") {
  const r = await detalle(get(consulta), ctx(clave));
  return { status: r.status, ...(await leer<DetalleGeneroMundoApi>(r)) };
}
async function huella(clave = HU, consulta = "") {
  return (await verDetalle(clave, consulta)).data.huella_datos;
}
async function aprobarHU(extra: Record<string, unknown> = {}, clave = HU) {
  const r = await aprobar(post(cuerpoAprobar(await huella(clave), extra), clave), ctx(clave));
  return { status: r.status, ...(await leer<RespuestaAprobarCrecimientoApi>(r)) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  sembrar();
  vaciarCacheGM();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("regla 18 · permisos de las tres rutas nuevas", () => {
  it("el comprador recibe 403 en la lista, el detalle y el POST; sin sesión, 401", async () => {
    estadoFalso.rol = "comprador";
    expect((await lista(get())).status).toBe(403);
    expect((await detalle(get(), ctx(HU))).status).toBe(403);
    expect((await aprobar(post(cuerpoAprobar("x")), ctx(HU))).status).toBe(403);
    estadoFalso.rol = "sin_sesion";
    expect((await lista(get())).status).toBe(401);
    expect((await detalle(get(), ctx(HU))).status).toBe(401);
    expect((await aprobar(post(cuerpoAprobar("x")), ctx(HU))).status).toBe(401);
    expect(estadoFalso.llamadasVentaGM).toHaveLength(0);
  });
});

describe("GET /api/curvas/genero-mundo", () => {
  it("lista los GM con venta, el Resto, el año permitido y la proyección de referencia (método 5)", async () => {
    const r = await lista(get());
    expect(r.status).toBe(200);
    const { data } = await leer<ListaGeneroMundoApi>(r);
    expect(data.anio_aplicacion).toBe(2027);
    expect(data.anios_permitidos).toEqual([2027]);
    expect(data.ultimo_mes_cerrado).toBe("2026-09");
    expect(data.proyeccion_referencia?.id).toBe(P1);
    expect(data.proyeccion_referencia?.version_metodo).toBe(5);
    // La de método 4 (P3) ya no se ofrece como referencia: solo las de método ≥ 5.
    expect(data.proyecciones_disponibles.map((p) => p.id)).toEqual([P1]);
    expect(data.filas.map((f) => f.clave).sort()).toEqual([HU, HR, MU, NU, `${G_H}.${M_D}`, `${"33333333-3333-4333-8333-333333333333"}.${M_R}`].sort());
    expect(data.resto.clave).toBe("resto");
    expect(data.huella_datos).toMatch(/^[0-9a-f]{32}$/);
    expect(data.anio_siguiente_atipico).toBeNull();
    const hu = data.filas.find((f) => f.clave === HU);
    expect(hu).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", detallable: true, mundo_activo: true, estado: "sin_aprobar", sigue: "resto", vigente: null });
    expect(hu?.base_siguiente).toBe(58900);
  });

  it("R8 · cada GM trae su cierre por curva (mismas tiendas) y la base por curva sobre las tiendas de 2027", async () => {
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    const c = data.filas.find((f) => f.clave === HU)!.cierre!;
    expect(c).toMatchObject({ k: 9, tiendas: 3, motivo_nulo: null, avance_bajo: false, hay_nino: true, factor_parcial: true, sin_factor: false });
    expect(c.vendido).toBeCloseTo(41200, 1);
    expect(c.vendido_corregido).toBeCloseTo(44200, 1);
    expect(c.cierre).toBeCloseTo(K_C, 1);
    expect(c.cierre_corregido).toBeCloseTo(T_C, 1);
    expect(c.anterior).toBeCloseTo(54000, 1);
    expect(c.pct).toBeCloseTo((K_C / 54000 - 1) * 100, 1);
    expect(c.pct_corregido).toBeCloseTo((T_C / 54000 - 1) * 100, 1);
    // M(2027) = T01, T02, T03 y T05 (abrió en junio de 2025, fuera de C(2026)); T06 cierra en 2026 y no está.
    expect(c.base_curva).toMatchObject({ tiendas: 4, tiendas_fuera_cy: ["T05"] });
    expect(c.base_curva?.real).toBeCloseTo(K_M, 1);
    expect(c.base_curva?.corregida).toBeCloseTo(T_M, 1);
    expect(c.correccion_curva_pct).toBeCloseTo((T_M / K_M - 1) * 100, 1);
  });

  it("la proyección de referencia trae base y base corregida, la corrección del Niño, hay_nino por gm_con_nino y lo que quedó fuera de la base de M7", async () => {
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    const hu = data.filas.find((f) => f.clave === HU)!;
    expect(hu).toMatchObject({ base_siguiente: 58900, base_corregida: 63100, hay_nino: true, fuera_base: null });
    expect(hu.correccion_nino_pct).toBeCloseTo(7.13, 2);
    // HOMBRE · RI no está en gm_con_nino: sin Niño material (aunque su cierre por curva diga otra cosa, manda la proyección).
    const hr = data.filas.find((f) => f.clave === HR)!;
    expect(hr).toMatchObject({ base_corregida: 20000, hay_nino: false, fuera_base: { filas: 2, unidades: 400 } });
    expect(hr.correccion_nino_pct).toBe(0);
  });

  it("solo HOMBRE y MUJER son detallables; los demás géneros siguen al Resto y suman en sus cifras", async () => {
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    expect(data.filas.filter((f) => f.detallable).map((f) => f.genero)).not.toContain("NIÑO");
    const nino = data.filas.find((f) => f.clave === NU);
    expect(nino).toMatchObject({ detallable: false, sigue: "resto" });
    // El Resto agrega N·U y N·R: su base es la de N·U (la única con filas base) y sus unidades de 2025 las dos series juntas.
    expect(data.resto.base_siguiente).toBe(6000);
    expect(data.resto.unidades_anterior).toBe((500 + 300) * 12);
  });

  it("el total pondera por Σ B' y un GM sin aprobar sigue al Resto provisional (corregida); pct_real es su equivalente sobre real", async () => {
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    // HU 63 100, HR 20 000, MU 30 000 y Resto 6 000 de base corregida: sin ningún aprobado todo crece 5 % sobre corregido.
    expect(data.total.base).toBe(63100 + 20000 + 30000 + 6000);
    expect(data.total.pct_ponderado).toBe(5);
    expect(data.total.sin_aprobar).toBe(3);
    const real = (data.total as unknown as { pct_real: number | null }).pct_real;
    expect(real).toBeCloseTo(((1.05 * (63100 + 20000 + 30000 + 6000)) / (58900 + 20000 + 30000 + 6000) - 1) * 100, 1);
  });

  it("una versión bruta entra al total con su equivalente sobre corregido", async () => {
    sembrarBruta({ genero_id: G_H, mundo_id: M_U }, 12);
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    // El 12 % bruto de HU equivale a 4,55 % sobre corregido: pondera 63 100 × 4,55 + (20 000 + 30 000 + 6 000) × 5 sobre 119 100.
    expect(data.total.pct_ponderado).toBeCloseTo((63100 * 4.5 + 56000 * 5) / 119100, 0);
    expect(data.filas.find((f) => f.clave === HU)?.vigente).toMatchObject({ sobre_base: "bruta", equivalente_real: 12 });
  });

  it("409 sin_datos si no hay ningún mes publicado y cerrado", async () => {
    estadoFalso.tablas.cargas_venta_stock = [];
    const r = await lista(get());
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("sin_datos");
  });

  it("400 anio_no_permitido con un año que no es el siguiente al último mes cerrado ni el de una proyección en trabajo", async () => {
    for (const anio of [2026, 2028, 2030]) {
      const r = await lista(get(`?anio=${anio}`));
      expect(r.status, String(anio)).toBe(400);
      expect((await leer(r)).codigo).toBe("anio_no_permitido");
    }
    expect((await lista(get("?anio=abc"))).status).toBe(400);
  });

  it("una proyección en trabajo de otro año añade su año siguiente a los permitidos (M3)", async () => {
    estadoFalso.tablas.proyecciones?.push({ ...(estadoFalso.tablas.proyecciones?.[0] as Fila), id: "d4444444-4444-4444-8444-444444444444", anio_en_curso: 2027, nombre: "Proyección 2027" });
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get("?anio=2028")));
    expect(data.anios_permitidos).toEqual([2027, 2028]);
    expect(data.anio_aplicacion).toBe(2028);
    // Sin venta de 2027 las cifras de `Y` son nulas, pero la lista responde.
    expect(data.filas[0]?.acumulado.motivo_nulo).toBe("sin_venta");
    expect(data.filas[0]?.cierre?.motivo_nulo).toBe("sin_venta");
  });

  it("400 referencia_otro_anio si la proyección pedida no es del año anterior; una de método 4 deja lo que depende de ella en null y el cierre por curva sigue", async () => {
    const otra = await lista(get(`?proyeccion=${P2}`));
    expect(otra.status).toBe(400);
    expect((await leer(otra)).codigo).toBe("referencia_otro_anio");
    expect((await lista(get("?proyeccion=no-es-un-id"))).status).toBe(400);

    const { data } = await leer<ListaGeneroMundoApi>(await lista(get(`?proyeccion=${P3}`)));
    expect(data.proyeccion_referencia?.id).toBe(P3);
    const hu = data.filas.find((f) => f.clave === HU);
    expect(hu?.aplicado_hoy).toMatchObject({ pct_bruto: null, motivo_nulo: "metodo_anterior" });
    expect(hu?.base_siguiente).toBeNull();
    expect(hu?.base_corregida).toBeNull();
    expect(hu?.acumulado.pct_bruto).toBeCloseTo(3, 1);
    // Sin referencia ≥ 5, hay_nino sale de la base por curva (D8) y el cierre por curva sigue.
    expect(hu?.hay_nino).toBe(true);
    expect(hu?.cierre?.cierre).toBeCloseTo(K_C, 1);
    expect(data.total.pct_ponderado).toBeNull();
  });

  it("regla 17 · la venta sale de la caché mientras las cargas y las marcas del árbol no cambian", async () => {
    await lista(get());
    await lista(get("?anio=2027"));
    await verDetalle();
    expect(estadoFalso.llamadasVentaGM).toHaveLength(1);
    // Mover un nodo de mundo cambia `updated_at` de genero_mundo_linea: la clave cambia aunque las cargas sean las mismas.
    (estadoFalso.tablas.genero_mundo_linea as Fila[])[0]!.updated_at = "2026-10-27T12:00:00Z";
    await lista(get());
    expect(estadoFalso.llamadasVentaGM).toHaveLength(2);
    // Lo mismo con la agrupación de una equivalencia.
    (estadoFalso.tablas.equivalencias as Fila[])[0]!.updated_at = "2026-10-27T13:00:00Z";
    await lista(get());
    expect(estadoFalso.llamadasVentaGM).toHaveLength(3);
  });

  it("un error de la función de venta responde con el mensaje traducido y una respuesta con otra forma, 500", async () => {
    estadoFalso.ventaGM = { respuesta: { series: "mal", cargas: {} }, error: null };
    expect((await lista(get())).status).toBe(500);
    vaciarCacheGM();
    estadoFalso.ventaGM = { respuesta: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    expect((await lista(get())).status).toBeGreaterThanOrEqual(400);
  });

  it("D7 · con meses atípicos marcados en 2027 la lista lo avisa (y sigue calculando)", async () => {
    periodosAtipicos().push({ id: "00000000-0000-4000-8000-0000000000a9", desde: "2027-03-01", hasta: "2027-04-01", motivo: "Prueba", descripcion: null, alcance: "invierno", temporadas: ["invierno"], activo: true, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z" });
    const r = await lista(get());
    expect(r.status).toBe(200);
    const { data } = await leer<ListaGeneroMundoApi>(r);
    expect(data.anio_siguiente_atipico).toEqual({ meses: ["2027-03", "2027-04"] });
    expect(data.filas.find((f) => f.clave === HU)?.cierre?.cierre).toBeCloseTo(K_C, 1);
  });
});

describe("GET /api/curvas/genero-mundo/[clave]", () => {
  it("400 clave_invalida, 404 sin datos y 200 para el Resto", async () => {
    const mala = await detalle(get(), ctx("no-es-clave"));
    expect(mala.status).toBe(400);
    expect((await leer(mala)).codigo).toBe("clave_invalida");
    expect((await detalle(get(), ctx("resto"))).status).toBe(200);
    // MUJER · RI no tiene venta, ni filas base ni versión.
    expect((await detalle(get(), ctx(`22222222-2222-4222-8222-222222222222.${M_R}`))).status).toBe(404);
  });

  it("la curva de HOMBRE · URBANO: cuatro años, 2026 cerrado por curva, mismas tiendas, serie corregida y bandas del Niño", async () => {
    const { data } = await verDetalle();
    expect(data.tiendas.n).toBe(3);
    expect(data.tiendas.ids).toEqual(["t1", "t2", "t3"]);
    expect(data.tiendas.fuera.map((f) => f.tienda_id)).toEqual(["t5", "t6"]);
    expect(data.series.map((s) => s.anio)).toEqual([2023, 2024, 2025, 2026]);

    const y2025 = data.series[2]!;
    expect(y2025.total).toBe(suma(TOTAL_HU[2025]!));
    expect(y2025.incompleto).toBe(false);
    expect(suma(y2025.forma as number[])).toBeCloseTo(100, 1);

    // 2026: hasta setiembre real y de octubre a diciembre el cierre por curva (T' ÷ 12 por mes, sin Niño en esos meses).
    const y2026 = data.series[3]!;
    expect(y2026.origen.slice(0, 9)).toEqual(Array(9).fill("real"));
    expect(y2026.origen.slice(9)).toEqual(["proyectado", "proyectado", "proyectado"]);
    expect(y2026.incompleto).toBe(true);
    expect(y2026.meses[5]).toBe(4000);
    expect(y2026.meses_sin_nino[5]).toBeCloseTo(5000, 1);
    expect(y2026.meses[9]).toBeCloseTo(T_C / 12, 1);
    expect(y2026.total).toBeCloseTo(K_C, 0);
    expect(y2026.total_sin_nino).toBeCloseTo(T_C, 0);
    // La serie corregida (hay Niño material): lo vendido ÷ φ hasta setiembre y el cierre corregido después.
    expect(data.serie_corregida?.total).toBeCloseTo(T_C, 0);
    expect(data.serie_corregida?.meses[5]).toBeCloseTo(5000, 1);
    expect(data.serie_corregida?.origen.slice(9)).toEqual(["proyectado", "proyectado", "proyectado"]);

    // 2023 y 2026 fueron Niño en invierno; el de 2026 es parcial.
    expect(data.bandas_nino).toEqual([
      { anio: 2023, temporada: "invierno", meses: [6, 7, 8], factor: 0.9, parcial: false },
      { anio: 2026, temporada: "invierno", meses: [6, 7, 8], factor: 0.8, parcial: true },
    ]);
    expect(data.factores_parciales).toBe(true);
    expect(data.avisos.map((a) => a.codigo)).toEqual(expect.arrayContaining(["factor_parcial", "anio_nino"]));
    expect(data.avisos.find((a) => a.codigo === "anio_nino")?.mensaje).toMatch(/2026 fue Niño para este grupo: el % de 2027 se escribe sobre 2026 corregido/);
    // La forma típica sale de 2024 y 2025 (2023 fue Niño): doce valores que suman 100.
    expect(data.forma_tipica).toHaveLength(12);
    expect(suma(data.forma_tipica as number[])).toBeCloseTo(100, 1);
  });

  it("R8 · cómo se cierra 2026: una fila por agrupación con curva, avance, factor y los dos cierres; la base por curva sobre las tiendas de 2027", async () => {
    const { data } = await verDetalle();
    expect(data.cierre_por_agrupacion).toHaveLength(1);
    const a = data.cierre_por_agrupacion![0]!;
    expect(a).toMatchObject({ agrupacion_id: A_INV, nombre: "ABRIGOS", temporada: "invierno", curva: { id: "cv1", version: 3 }, avance: 0.75, avance_bajo: false });
    expect(a.vendido).toBeCloseTo(41200, 1);
    expect(a.vendido_corregido).toBeCloseTo(44200, 1);
    expect(a.factor_meses).toEqual([1, 1, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1, 1]);
    expect(a.cierre).toBeCloseTo(K_C, 1);
    expect(a.cierre_corregido).toBeCloseTo(T_C, 1);
    expect(a.base_curva).toBeCloseTo(K_M, 1);
    expect(a.base_curva_corregida).toBeCloseTo(T_M, 1);
    expect(data.serie_base_curva?.real.reduce((x, y) => x + y, 0)).toBeCloseTo(K_M, 0);
    expect(data.serie_base_curva?.corregida.reduce((x, y) => x + y, 0)).toBeCloseTo(T_M, 0);
    expect(data.serie_base_curva?.real).toHaveLength(12);
  });

  it("los factores de 2026 que tocan al GM llevan su estado, sus dos números y su origen (invierno confirmado: ok)", async () => {
    const { data } = await verDetalle();
    expect(data.factores_y).toHaveLength(1);
    expect(data.factores_y![0]).toMatchObject({ anio: 2026, temporada: "invierno", efectivo: 0.8, origen: "aplicado", ratio_volumen: 0.76, ratio_control: 0.95, parcial: true, estado: "ok", meses_periodo: 3 });
    expect(data.diagnostico_verano_gm).toBeNull();
    expect(data.reaprobar).toBeNull();
    expect(data.cierre_proyeccion).toMatchObject({ base: 58900, base_corregida: 63100 });
    expect(data.cierre_proyeccion?.nombre).toMatch(/^Proyección 2026/);
  });

  it("B2 · el estado del factor: sin confirmar, desfasado por cargas nuevas o por la fórmula anterior, y faltante", async () => {
    const estado = async () => (await verDetalle()).data.factores_y![0]!.estado;
    factores()[0] = factorInvierno2026({ ratio_aplicado: null, aplicado_huella: null });
    expect(await estado()).toBe("sin_confirmar");
    factores()[0] = factorInvierno2026({ aplicado_huella: "de_otro_mes" });
    expect(await estado()).toBe("sin_confirmar");
    factores()[0] = factorInvierno2026({ huella_cargas: "cargas_de_agosto" });
    expect(await estado()).toBe("desfasado");
    factores()[0] = factorInvierno2026({ formula: null });
    expect(await estado()).toBe("desfasado");
    factores()[0] = factorInvierno2026({ huella_composicion: "otra" });
    expect(await estado()).toBe("desfasado");
    factores()[0] = factorInvierno2026({ ratio_calculado: null, ratio_aplicado: null, aplicado_huella: null });
    expect(await estado()).toBe("faltante");
    const { data } = await verDetalle();
    expect(data.avisos.map((a) => a.codigo)).toContain("sin_factor");
    expect(data.cierre?.sin_factor).toBe(true);
  });

  it("las referencias de HOMBRE · URBANO: cierre por curva primero, equivalentes corregido y real, y ya no hay «cierre proyectado»", async () => {
    const { data } = await verDetalle();
    expect(data.referencias.map((r) => r.tipo)).toEqual(["cierre_curva", "acumulado", "anio_completo", "anio_completo", "aplicado_hoy"]);
    const por = (tipo: string, anio?: number) => data.referencias.find((r) => r.tipo === tipo && (anio === undefined || r.anio === anio))!;

    const cierre = por("cierre_curva");
    expect(cierre).toMatchObject({ tiendas: 3, anterior: 54000, motivo_nulo: null, variante_defecto: "corregido" });
    expect(cierre.actual).toBeCloseTo(K_C, 1);
    expect(cierre.equivalente.corregido).toBeCloseTo((T_C / 54000 - 1) * 100, 1);
    expect(cierre.equivalente.bruto).toBeCloseTo((K_C / 54000 - 1) * 100, 1);
    expect(cierre.equivalente.sin_nino_mas_rebote).toBeNull();

    const acumulado = por("acumulado");
    expect(acumulado).toMatchObject({ tiendas: 3, anterior: 40000, actual: 41200, fragil: false, extremo: false, variante_defecto: "corregido" });
    expect(acumulado.pct_bruto).toBeCloseTo(3.0, 1);
    expect(acumulado.pct_sin_nino).toBeCloseTo(10.5, 1);
    expect(acumulado.equivalente.corregido).toBeCloseTo(10.5, 1);
    expect(acumulado.equivalente.bruto).toBeCloseTo(3.0, 1);
    expect(acumulado.cobertura_pct).toBeCloseTo(74, 0);
    expect(acumulado.tienda_mayor?.codigo).toBe("T01");
    expect(data.rebote_nino_pct).toBeCloseTo(7.1, 1);

    // 2025 frente a 2024: T06 vendió los dos años enteros (cierra en 2026), así que entra en C(2025) con 200 u. al mes.
    expect(por("anio_completo", 2025)).toMatchObject({ tiendas: 4, anterior: 51429 + 2400, actual: 54000 + 2400 });
    expect(por("anio_completo", 2025).pct_bruto).toBeCloseTo(((54000 + 2400) / (51429 + 2400) - 1) * 100, 1);
    expect(por("anio_completo", 2024).motivo_nulo).toBeNull();
    expect(data.referencias.filter((r) => r.tipo === "anio_completo")).toHaveLength(2);

    // La foto aplica 12 % bruto a HOMBRE · URBANO (una versión de antes de 0.14.0): equivale a 4,55 % sobre corregido.
    const aplicado = por("aplicado_hoy");
    expect(aplicado).toMatchObject({ pct_bruto: 12, anterior: 58900, motivo_nulo: null });
    expect(aplicado.equivalente.bruto).toBe(12);
    expect(aplicado.equivalente.corregido).toBe(4.55);
  });

  it("HOMBRE · RI se marca «extremo» con más de 50 % y su tienda mayor trae el aporte", async () => {
    const { data } = await verDetalle(HR);
    const a = data.referencias.find((r) => r.tipo === "acumulado")!;
    expect(a.extremo).toBe(true);
    expect(a.fragil).toBe(false);
    expect(a.tienda_mayor).toMatchObject({ codigo: "T01" });
    expect(a.variante_defecto).toBe("corregido");
    // Sin Niño (todo el año): lo corregido y lo real coinciden.
    expect(a.equivalente.corregido).toBe(a.equivalente.bruto);
    expect(data.hay_nino).toBe(false);
    expect(data.serie_corregida).toBeNull();
  });

  it("MUJER · URBANO (verano, sin periodo de verano): sin Niño, sin factores de 2026 y con el cierre por curva", async () => {
    const { data } = await verDetalle(MU);
    expect(data.hay_nino).toBe(false);
    expect(data.factores_y).toEqual([]);
    expect(data.diagnostico_verano_gm).toBeNull();
    expect(data.cierre_por_agrupacion?.map((a) => [a.agrupacion_id, a.temporada])).toEqual([[A_VER, "verano"]]);
    expect(data.cierre?.cierre).toBeCloseTo(data.cierre?.cierre_corregido as number, 6);
  });

  it("G · verano con Niño de setiembre a diciembre y sin factor: el diagnóstico del GM, factor faltante y sin_factor", async () => {
    periodosAtipicos().push({ id: "00000000-0000-4000-8000-0000000000b1", desde: "2026-09-01", hasta: "2026-12-01", motivo: "Niño costero", descripcion: null, alcance: "invierno", temporadas: ["verano"], activo: true, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z" });
    const { data } = await verDetalle(MU);
    expect(data.factores_y).toHaveLength(1);
    expect(data.factores_y![0]).toMatchObject({ temporada: "verano", estado: "faltante", efectivo: null, meses_periodo: 4 });
    expect(data.cierre?.sin_factor).toBe(true);
    expect(data.avisos.map((a) => a.codigo)).toContain("sin_factor");
    const d = data.diagnostico_verano_gm!;
    expect(d).not.toBeNull();
    expect(d.meses).toHaveLength(12);
    expect(d.meses[8]).toMatchObject({ m: 9, en_periodo: true });
    expect(d.meses[0]).toMatchObject({ m: 1, en_periodo: false });
    expect(d.meses_periodo_con_dato).toBe(1);
    // Setiembre 2026 contra 2025 de las mismas tiendas (T01, T02 y T03; T07 cierra en diciembre): 2 300 ÷ 2 200 de la serie de verano.
    expect(d.meses[8]!.ratio).toBeGreaterThan(0);
    expect(d.exceso_red).not.toBeNull();
    expect(d.exceso_propio).not.toBeNull();
  });

  it("el detalle del Resto suma los géneros no detallados", async () => {
    const { data } = await verDetalle("resto");
    expect(data).toMatchObject({ clave: "resto", genero: null, mundo: null, detallable: true, sigue: "propio", estado: "sin_aprobar" });
    expect(data.acumulado.anterior).toBe(suma(Array(9).fill(500 + 300)));
  });

  it("HOMBRE · DEPORTIVO tiene una agrupación sin curva vigente: el cierre por curva es null con sin_curva y el aviso lo dice", async () => {
    const { data } = await verDetalle(HD);
    expect(data.cierre).toMatchObject({ cierre: null, cierre_corregido: null, motivo_nulo: "sin_curva" });
    expect(data.avisos.map((a) => a.codigo)).toContain("sin_curva");
    expect(data.referencias.find((r) => r.tipo === "cierre_curva")?.motivo_nulo).toBe("sin_curva");
    // Las demás referencias siguen y, sin cierre, la serie de 2026 no se completa.
    expect(data.referencias.find((r) => r.tipo === "acumulado")?.motivo_nulo).toBeNull();
    expect(data.series.find((s) => s.anio === 2026)?.origen.slice(9)).toEqual([null, null, null]);
  });

  it("un mes publicado de 2026 que falta da meses_faltantes", async () => {
    estadoFalso.tablas.cargas_venta_stock = (estadoFalso.tablas.cargas_venta_stock as Fila[]).filter((c) => c.periodo !== "2026-05-01");
    const { data } = await verDetalle();
    expect(data.cierre?.motivo_nulo).toBe("meses_faltantes");
    expect(data.avisos.map((a) => a.codigo)).toContain("meses_faltantes");
  });
});

describe("POST /api/curvas/genero-mundo/[clave]", () => {
  it("R11 · aprueba la v1 con la base por defecto (cierre por curva · corregido) sin nota, con sobre_base corregida y la foto del método 5", async () => {
    const r = await aprobarHU();
    expect(r.status).toBe(201);
    expect(r.data.vigente).toMatchObject({ version: 1, estado: "vigente", pct: PCT_CIERRE_CURVA_HU, nota: null, por_nombre: "Javier", sobre_base: "corregida", base: { tipo: "cierre_curva", anio: null, variante: "corregido" } });
    expect(r.data.vigente.base.valor).toBeCloseTo((T_C / 54000 - 1) * 100, 1);
    expect(r.data.vigente.proyeccion_referencia?.id).toBe(P1);
    // El % sobre 2026 real con la base de la referencia: (1 + g) × 63 100 ÷ 58 900 − 1.
    expect(r.data.vigente.equivalente_real).toBeCloseTo(((1 + PCT_CIERRE_CURVA_HU / 100) * 63100 / 58900 - 1) * 100, 1);
    expect(r.data.proyecciones_desactualizadas.map((p) => p.id).sort()).toEqual([P1, P3].sort());
    const fila = versiones()[0]!;
    expect(fila).toMatchObject({ anio_aplicacion: 2027, alcance: "gm", genero_id: G_H, mundo_id: M_U, version: 1, estado: "vigente", base_tipo: "cierre_curva", sobre_base: "corregida", perfil_id: "99999999-9999-4999-8999-999999999999" });
    const foto = fila.referencia as Record<string, unknown> & { gml_ids: string[]; referencias: unknown[]; proyeccion: { id: string }; base: { variante: string }; cierre: { cierre: number; hay_nino: boolean }; factores: { anio: number; temporada: string; efectivo: number; origen: string; formula: string; parcial: boolean; huella_cargas: string }[] };
    expect(foto.gml_ids).toEqual(["n1", "n2"]);
    expect(foto.referencias.length).toBeGreaterThan(3);
    expect(foto.proyeccion.id).toBe(P1);
    expect(foto.base.variante).toBe("corregido");
    expect(foto).toMatchObject({ metodo: 5, sobre_base: "corregida", base_siguiente: 58900, base_corregida: 63100 });
    expect(foto.cierre.cierre).toBeCloseTo(K_C, 1);
    expect(foto.cierre.hay_nino).toBe(true);
    expect(foto.factores).toHaveLength(1);
    expect(foto.factores[0]).toMatchObject({ anio: 2026, temporada: "invierno", efectivo: 0.8, origen: "aplicado", formula: "relativo_periodo", parcial: true });
    expect(foto.factores[0]!.huella_cargas).toMatch(/^[0-9a-f]{32}$/);
    expect((foto.cierre_por_agrupacion as unknown[]).length).toBe(1);
    expect((foto.serie_corregida as { total: number }).total).toBeCloseTo(T_C, 0);
    expect((foto.tiendas_m as string[]).sort()).toEqual(["t1", "t2", "t3", "t5"]);
    expect(foto.tiendas_cy).toEqual(["t1", "t2", "t3"]);
    expect(foto.correccion_nino_pct).toBeCloseTo(7.13, 2);

    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "aprobado", sigue: "propio" });
    expect(lista.total.sin_aprobar).toBe(2);
  });

  it("regla 8 · aprobar escribe solo en crecimientos_genero_mundo: ninguna proyección, fila ni foto", async () => {
    await aprobarHU();
    await aprobarHU({ pct: 21, nota: "Más alto que la base", version_vigente: 1 });
    expect(estadoFalso.escrituras.length).toBeGreaterThan(0);
    expect(estadoFalso.escrituras.every((e) => e.tabla === "crecimientos_genero_mundo")).toBe(true);
    expect(estadoFalso.escrituras.filter((e) => e.modo === "delete")).toHaveLength(0);
  });

  it("R11 · una base retirada responde 400 base_retirada y no escribe nada", async () => {
    for (const base of [
      { tipo: "cierre_proyectado", anio: null, variante: "bruto" },
      { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote" },
      { tipo: "cierre_proyectado", anio: null, variante: "sin_nino_mas_rebote" },
    ]) {
      const r = await aprobarHU({ base, pct: 10, nota: "x" });
      expect(r.status, JSON.stringify(base)).toBe(400);
      expect(r.codigo).toBe("base_retirada");
      expect(r.error).toBe("Esa base ya no se usa desde 0.14.0: elige “Cierre por curva” o “Aplicado hoy”.");
    }
    expect(estadoFalso.escrituras).toHaveLength(0);
    expect(versiones()).toHaveLength(0);
  });

  it("R25 · con meses atípicos en 2027 el POST responde 409 anio_siguiente_atipico sin escribir; la lista y el detalle siguen calculando", async () => {
    const h = await huella();
    periodosAtipicos().push({ id: "00000000-0000-4000-8000-0000000000a9", desde: "2027-03-01", hasta: "2027-04-01", motivo: "Prueba", descripcion: null, alcance: "invierno", temporadas: ["invierno"], activo: true, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z" });
    const r = await aprobar(post(cuerpoAprobar(h)), ctx(HU));
    expect(r.status).toBe(409);
    const cuerpo = await leer(r);
    expect(cuerpo.codigo).toBe("anio_siguiente_atipico");
    expect(cuerpo.error).toMatch(/^2027 está marcado como año del Niño en Curvas → Periodos atípicos/);
    expect(estadoFalso.escrituras).toHaveLength(0);
    // El rechazo va antes que la huella: con una huella vieja también es anio_siguiente_atipico.
    expect((await leer(await aprobar(post(cuerpoAprobar("vieja")), ctx(HU)))).codigo).toBe("anio_siguiente_atipico");
    // Un GM sin temporadas con venta marcadas sí se aprueba: MUJER · URBANO es de verano y el periodo es de invierno.
    const d = await verDetalle(MU);
    expect(d.status).toBe(200);
    expect(d.data.avisos.map((a) => a.codigo)).not.toContain("anio_siguiente_atipico");
    expect((await verDetalle(HU)).data.avisos.find((a) => a.codigo === "anio_siguiente_atipico")?.mensaje).toMatch(/2027 está marcado/);
    const ok = await aprobar(post(cuerpoAprobar(d.data.huella_datos, { base: { tipo: "ninguna", anio: null, variante: "corregido" }, pct: 5, nota: "x" }), MU), ctx(MU));
    expect(ok.status).toBe(201);
  });

  it("regla 1 · una sola vigente: la v2 reemplaza a la v1, que nunca se borra", async () => {
    expect((await aprobarHU()).status).toBe(201);
    const v2 = await aprobarHU({ pct: 21, nota: "El rebote del invierno será mayor", version_vigente: 1 });
    expect(v2.status).toBe(201);
    expect(v2.data.vigente.version).toBe(2);
    expect(versiones().map((v) => [v.version, v.estado])).toEqual([
      [1, "reemplazada"],
      [2, "vigente"],
    ]);
    const { data } = await verDetalle();
    expect(data.versiones.map((v) => v.version)).toEqual([2, 1]);
    expect(data.vigente?.version).toBe(2);
    expect(data.versiones.every((v) => v.sobre_base === "corregida")).toBe(true);
  });

  it("regla 1 · con version_vigente distinta responde 409 vigente_cambiada sin escribir", async () => {
    await aprobarHU();
    const antes = estadoFalso.escrituras.length;
    for (const version_vigente of [null, 2]) {
      const r = await aprobarHU({ pct: 21, nota: "otra", version_vigente });
      expect(r.status).toBe(409);
      expect(r.codigo).toBe("vigente_cambiada");
    }
    expect(estadoFalso.escrituras).toHaveLength(antes);
    expect(versiones()).toHaveLength(1);
  });

  it("regla 1 · si otra persona reemplaza la vigente entre la lectura y la escritura, 409 vigente_cambiada y no se inserta", async () => {
    await aprobarHU();
    const h = await huella();
    estadoFalso.alEscribir = (tabla, modo) => {
      if (tabla === "crecimientos_genero_mundo" && modo === "update") (versiones()[0] as Fila).estado = "reemplazada";
    };
    const r = await aprobar(post(cuerpoAprobar(h, { pct: 21, nota: "x", version_vigente: 1 })), ctx(HU));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("vigente_cambiada");
    expect(versiones()).toHaveLength(1);
  });

  it("si el alta falla tras reemplazar, la anterior vuelve a ser vigente", async () => {
    await aprobarHU();
    estadoFalso.fallarInsert.crecimientos_genero_mundo = { code: "23503", message: "violates foreign key constraint" };
    const r = await aprobarHU({ pct: 21, nota: "x", version_vigente: 1 });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(versiones()).toHaveLength(1);
    expect(versiones()[0]?.estado).toBe("vigente");
    // Un choque de único se traduce a vigente_cambiada.
    estadoFalso.fallarInsert.crecimientos_genero_mundo = { code: "23505", message: 'duplicate key value violates unique constraint "crecimientos_genero_mundo_vigente_uniq"' };
    const u = await aprobarHU({ pct: 21, nota: "x", version_vigente: 1 });
    expect(u.status).toBe(409);
    expect(u.codigo).toBe("vigente_cambiada");
    expect(versiones()[0]?.estado).toBe("vigente");
  });

  it("regla 2 y ejemplo F · R-N: 8,00 frente a la base de 9,14 exige nota; con nota se crea la versión", async () => {
    const sin = await aprobarHU({ pct: 8 });
    expect(sin.status).toBe(409);
    expect(sin.codigo).toBe("nota_requerida");
    expect(sin.error).toMatch(/nota/);
    expect(versiones()).toHaveLength(0);
    const con = await aprobarHU({ pct: 8, nota: "Prudente: el rebote del invierno no será completo" });
    expect(con.status).toBe(201);
    expect(con.data.vigente.nota).toMatch(/Prudente/);
  });

  it("R12 · la variante bruto (real) sobre el acumulado de un GM con Niño exige nota aunque el % coincida con la base; sin Niño no", async () => {
    const real = { base: { tipo: "acumulado", anio: null, variante: "bruto" }, pct: 3 };
    const sin = await aprobarHU(real);
    expect(sin.status).toBe(409);
    expect(sin.codigo).toBe("nota_requerida");
    expect(sin.error).toMatch(/base real/);
    expect((await aprobarHU({ ...real, nota: "Lo que vendimos" })).status).toBe(201);
    // HOMBRE · RI no tiene Niño material: la misma variante bruto con el % de la base no pide nota.
    const dRI = (await verDetalle(HR)).data;
    const acum = dRI.referencias.find((r) => r.tipo === "acumulado")!;
    const ok = await aprobarHU({ base: { tipo: "acumulado", anio: null, variante: "bruto" }, pct: acum.equivalente.bruto }, HR);
    expect(ok.status).toBe(201);
  });

  it("regla 2 · sin base (ninguna) la nota es siempre obligatoria", async () => {
    const base = { tipo: "ninguna", anio: null, variante: "corregido" };
    expect((await aprobarHU({ base, pct: 10 })).codigo).toBe("nota_requerida");
    const r = await aprobarHU({ base, pct: 10, nota: "Criterio comercial" });
    expect(r.status).toBe(201);
    expect(r.data.vigente.base.valor).toBeNull();
  });

  it("regla 3 y R13 · sin_cambio: el mismo % con la misma base, nota y sobre_base no crea otra versión", async () => {
    await aprobarHU();
    const r = await aprobarHU({ version_vigente: 1 });
    expect(r.status).toBe(409);
    expect(r.codigo).toBe("sin_cambio");
    expect(r.error).toMatch(/v1/);
    expect(versiones()).toHaveLength(1);
  });

  it("R13 · una vigente bruta con el mismo % y la misma base no es sin_cambio: se reaprueba como corregida", async () => {
    sembrarBruta({ genero_id: G_H, mundo_id: M_U }, PCT_CIERRE_CURVA_HU, { tipo: "cierre_curva", variante: "corregido" });
    (versiones()[0] as Fila).base_valor = (T_C / 54000 - 1) * 100;
    const r = await aprobarHU({ version_vigente: 1 });
    expect(r.status).toBe(201);
    expect(r.data.vigente).toMatchObject({ version: 2, sobre_base: "corregida" });
    expect(versiones().map((v) => [v.version, v.estado, v.sobre_base])).toEqual([
      [1, "reemplazada", "bruta"],
      [2, "vigente", "corregida"],
    ]);
  });

  it("regla 3 · una vigente obsoleta se puede refrescar con el mismo %", async () => {
    await aprobarHU();
    // Cambia la venta de 2026: el cierre por curva se mueve más de 1 pp y la v1 queda obsoleta.
    const series = seriesFixture().map((s) => (s.g === G_H && s.m === M_U && s.t === "t1" ? { ...s, u: { ...s.u, "2026-01": (s.u["2026-01"] as number) + 1500 } } : s));
    estadoFalso.ventaGM = { respuesta: ventaGMJson(series), error: null };
    vaciarCacheGM();
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "base_movida" });
    const nuevo = (await verDetalle()).data;
    const valor = nuevo.referencias.find((r) => r.tipo === "cierre_curva")!.equivalente.corregido as number;
    // El % de la v1 se aprueba otra vez: la base ya no vale lo mismo, así que hay v2 (con nota por la distancia).
    const r = await aprobar(post(cuerpoAprobar(nuevo.huella_datos, { version_vigente: 1, nota: `Se mantiene frente a ${valor}` })), ctx(HU));
    expect(r.status).toBe(201);
    expect((await leer<RespuestaAprobarCrecimientoApi>(r)).data.vigente.version).toBe(2);
  });

  it("regla 4 · un género distinto de HOMBRE y MUJER da 400 genero_no_detallado", async () => {
    const r = await aprobarHU({ base: { tipo: "ninguna", anio: null, variante: "corregido" }, nota: "x" }, NU);
    expect(r.status).toBe(400);
    expect(r.codigo).toBe("genero_no_detallado");
    expect(versiones()).toHaveLength(0);
  });

  it("regla 4 · un mundo inactivo da 400 mundo_inactivo, salvo que el GM tenga filas base en una proyección en trabajo (I3)", async () => {
    const extra = { base: { tipo: "ninguna", anio: null, variante: "corregido" }, nota: "x", pct: 5 };
    const r = await aprobarHU(extra, HD);
    expect(r.status).toBe(400);
    expect(r.codigo).toBe("mundo_inactivo");
    // Una proyección en trabajo de 2026 con filas base de HOMBRE · DEPORTIVO: esa proyección no podría cerrarse sin él.
    const p1 = (estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1) as { resumen: { gm_gml: Record<string, string> } };
    p1.resumen.gm_gml.n7 = `${G_H}|${M_D}`;
    const ok = await aprobarHU(extra, HD);
    expect(ok.status).toBe(201);
    expect(versiones()[0]).toMatchObject({ genero_id: G_H, mundo_id: M_D, version: 1 });
  });

  it("el Resto se aprueba con «Aplicado hoy» en un clic: el % de la foto y sin nota", async () => {
    const d = (await verDetalle("resto")).data;
    const ap = d.referencias.find((r) => r.tipo === "aplicado_hoy")!;
    // El Resto provisional (5 %) es sobre corregido: el equivalente corregido es el mismo 5.
    expect(ap.equivalente.corregido).toBe(5);
    const r = await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "corregido" }, pct: 5 }, "resto");
    expect(r.status).toBe(201);
    expect(versiones()[0]).toMatchObject({ alcance: "resto", genero_id: null, mundo_id: null, base_tipo: "aplicado_hoy", sobre_base: "corregida" });
    // Con el Resto aprobado, el provisional deja de ser el que sigue cada GM sin aprobar.
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.resto).toMatchObject({ estado: "aprobado", sigue: "propio" });
  });

  it("regla 5 · obsoleto por base movida (≥ 1 pp); «aplicado hoy» no se marca por moverse", async () => {
    await aprobarHU();
    await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "corregido" }, pct: 5 }, "resto");
    // Octubre publicado lleva el cierre de HOMBRE · URBANO a otro valor: la v1 queda obsoleta, la del Resto no.
    const series = seriesFixture().map((s) => (s.g === G_H && s.m === M_U && s.t === "t1" ? { ...s, u: { ...s.u, "2026-02": (s.u["2026-02"] as number) + 2000 } } : s));
    estadoFalso.ventaGM = { respuesta: ventaGMJson(series), error: null };
    vaciarCacheGM();
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "base_movida" });
    expect(lista.resto.estado).toBe("aprobado");
    // La vigente sigue siendo la misma: obsoleto es solo informativo.
    expect(versiones().filter((v) => v.estado === "vigente")).toHaveLength(2);
  });

  it("regla 5 · obsoleto por composición solo cuando un nodo de la foto sale del GM; los que entran no cuentan", async () => {
    await aprobarHU();
    const nodos = estadoFalso.tablas.genero_mundo_linea as Fila[];
    nodos.push({ id: "n8", genero_id: G_H, mundo_id: M_U, linea_id: "l9", nivel_planificacion: "GML", activo: true, updated_at: "2026-10-01T10:00:00Z" });
    vaciarCacheGM();
    expect((await leer<ListaGeneroMundoApi>(await lista_())).data.filas.find((f) => f.clave === HU)?.estado).toBe("aprobado");
    // n1 cambia de mundo: el GM de origen queda obsoleto por composición.
    nodos[0]!.mundo_id = M_R;
    expect((await leer<ListaGeneroMundoApi>(await lista_())).data.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "composicion" });
  });

  it("regla 5 · obsoleto por base no calculable si la base elegida ya no se puede calcular", async () => {
    // Se aprueba con «Aplicado hoy»; después la proyección de referencia pasa a método 4 y esa base deja de existir.
    await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "corregido" }, pct: 4.55 });
    const p1 = (estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1) as { resumen: { version_metodo: number } };
    p1.resumen.version_metodo = 4;
    const lista = (await leer<ListaGeneroMundoApi>(await lista_(`?proyeccion=${P1}`))).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "base_no_calculable" });
  });

  it("R14 · factor_cambiado: un factor de 2026 distinto al de la foto que mueve K'_M ≥ 0,5 % la marca; uno que casi no lo mueve, no", async () => {
    await aprobarHU();
    const estado = async () => (await leer<ListaGeneroMundoApi>(await lista_())).data.filas.find((f) => f.clave === HU);
    expect(await estado()).toMatchObject({ estado: "aprobado", motivo_obsoleto: null });
    // Un cambio mínimo (0,8 → 0,7999): K'_M se mueve menos de 0,5 %.
    factores()[0] = factorInvierno2026({ ratio_aplicado: 0.7999 });
    expect(await estado()).toMatchObject({ estado: "aprobado", motivo_obsoleto: null });
    // Un cambio grande (0,8 → 0,6): K'_M se mueve más de 10 %.
    factores()[0] = factorInvierno2026({ ratio_aplicado: 0.6 });
    expect(await estado()).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "factor_cambiado" });
  });

  it("R14 y I3 · una versión bruta de un GM con Niño material: obsoleta por metodo_anterior, con el impacto de reaprobar; sin Niño, no", async () => {
    sembrarBruta({ genero_id: G_H, mundo_id: M_U }, 12);
    sembrarBruta({ genero_id: G_H, mundo_id: M_R }, 10);
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "metodo_anterior", hay_nino: true });
    // HOMBRE · RI no tiene Niño material (no está en gm_con_nino): la bruta vale y no pide reaprobar.
    expect(lista.filas.find((f) => f.clave === HR)).toMatchObject({ estado: "aprobado", motivo_obsoleto: null, hay_nino: false });
    const d = (await verDetalle()).data;
    expect(d.reaprobar).toMatchObject({ pct_equivalente: 4.55, filas_suben: 1, filas_bajan: 0, decididas_con_propuesta_cambio: 0 });
    expect(d.reaprobar?.total_antes).toBe(Math.round(58900 * 1.12));
    expect(Math.abs((d.reaprobar?.total_despues as number) - (d.reaprobar?.total_antes as number))).toBeLessThanOrEqual(5);
    expect((await verDetalle(HR)).data.reaprobar).toBeNull();
    // «Reaprobar» precarga «Aplicado hoy · corregido» con el equivalente: el POST lo acepta sin nota y la v2 es corregida.
    const r = await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "corregido" }, pct: d.reaprobar?.pct_equivalente, version_vigente: 1 });
    expect(r.status).toBe(201);
    expect(r.data.vigente).toMatchObject({ version: 2, sobre_base: "corregida" });
    expect((await verDetalle()).data.reaprobar).toBeNull();
  });

  it("R28 · una fila decidida del GM no se mueve y cuenta como «propuesta cambió»", async () => {
    sembrarBruta({ genero_id: G_H, mundo_id: M_U }, 12);
    // Una segunda fila base del GM con su 2027 decidido: no sigue al GM y su propuesta cambiaría con el equivalente.
    (estadoFalso.tablas.proyeccion_filas as Fila[]).push({ id: "f9", proyeccion_id: P1, clave: "|n2|e|m", tienda_id: null, gml_id: "n2", equivalencia_id: null, agrupacion_marca_id: "am", nivel_proyectado: "GML", agrupacion_estacionalidad_id: null, temporada: "invierno", avisos: [], activo: true });
    (estadoFalso.tablas.proyeccion_fila_anios as Fila[]).push({ id: "f9-s", fila_id: "f9", bloque: "mismas", subbloque: null, decidido: 3000, activo: true, vendido: 0, metodo: "curva", origen: null, propuesta_al_decidir: null, avisos: [], origen_meses: null, anio: 2027, propuesto: 2800, meses: null, base_siguiente: 2500, base_normalizada: 3100, crecimiento_pct: null });
    (estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1)!.resumen = { ...((estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1)!.resumen as object), gm_gml: { n1: `${G_H}|${M_U}`, n2: `${G_H}|${M_U}`, n3: `${G_H}|${M_R}`, n4: `${G_M}|${M_U}`, n5: `${G_N}|${M_U}` } };
    const d = (await verDetalle()).data;
    expect(d.reaprobar?.decididas_con_propuesta_cambio).toBe(1);
  });

  it("R21 · cambiar la curva vigente de una agrupación o una tienda de M(Y+1) cambia huella_datos y el POST responde 409 datos_cambiados", async () => {
    const h = await huella();
    (estadoFalso.tablas.curvas_estacionalidad as Fila[])[0]!.version = 99;
    expect(await huella()).not.toBe(h);
    const r = await aprobar(post(cuerpoAprobar(h)), ctx(HU));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiados");
    expect(versiones()).toHaveLength(0);

    // Una tienda que entra a M(2027): abrió el 2025-12-01 (en 2026 todavía no estaba abierta todo el año).
    const h2 = await huella();
    (estadoFalso.tablas.tiendas as Fila[]).push({ id: "t10", codigo: "T10", nombre: "Tienda T10", tipo: "Tienda", activo: true, fecha_apertura: "2025-12-01", fecha_cierre: null, razon_social: null, zona: null, venta_esperada_promedio: null });
    expect(await huella()).not.toBe(h2);
  });

  it("R21 · un factor de 2026 con cualquiera de sus columnas nuevas cambiadas cambia la huella", async () => {
    const h = await huella();
    factores()[0] = factorInvierno2026({ aplicado_huella: "otra" });
    expect(await huella()).not.toBe(h);
  });

  it("409 datos_cambiados si la huella ya no es la de los datos (una carga nueva, la proyección recalculada…)", async () => {
    const h = await huella();
    (estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1)!.calculado_at = "2026-10-26T09:00:00Z";
    const r = await aprobar(post(cuerpoAprobar(h)), ctx(HU));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("datos_cambiados");
    expect(versiones()).toHaveLength(0);
  });

  it("regla 16 · validaciones del POST: año, referencia, huella larga, anio_completo", async () => {
    const h = await huella();
    const cuerpo = (extra: Record<string, unknown>) => post(cuerpoAprobar(h, extra));

    const anio = await aprobar(cuerpo({ anio: 2028 }), ctx(HU));
    expect(anio.status).toBe(400);
    expect((await leer(anio)).codigo).toBe("anio_no_permitido");

    const otro = await aprobar(cuerpo({ proyeccion_referencia_id: P2 }), ctx(HU));
    expect(otro.status).toBe(400);
    expect((await leer(otro)).codigo).toBe("referencia_otro_anio");
    const inexistente = await aprobar(cuerpo({ proyeccion_referencia_id: "d9999999-9999-4999-8999-999999999999" }), ctx(HU));
    expect(inexistente.status).toBe(400);

    const larga = await aprobar(cuerpo({ huella_datos: "x".repeat(129) }), ctx(HU));
    expect(larga.status).toBe(400);

    const sinAnio = await aprobar(cuerpo({ base: { tipo: "anio_completo", anio: null, variante: "bruto" } }), ctx(HU));
    expect(sinAnio.status).toBe(400);
    const fueraDeRango = await aprobar(cuerpo({ base: { tipo: "anio_completo", anio: 2023, variante: "bruto" } }), ctx(HU));
    expect(fueraDeRango.status).toBe(400);

    const clave = await aprobar(post(cuerpoAprobar(h), "mala"), ctx("mala"));
    expect(clave.status).toBe(400);
    expect((await leer(clave)).codigo).toBe("clave_invalida");

    const extra = await aprobar(cuerpo({ otra: 1 }), ctx(HU));
    expect(extra.status).toBe(400);
    expect(versiones()).toHaveLength(0);
  });

  it("aprueba con la base de un año completo (2025) y su valor equivalente corregido", async () => {
    const d = (await verDetalle()).data;
    const ref = d.referencias.find((r) => r.tipo === "anio_completo" && r.anio === 2025)!;
    const r = await aprobarHU({ base: { tipo: "anio_completo", anio: 2025, variante: "corregido" }, pct: ref.equivalente.corregido });
    expect(r.status).toBe(201);
    expect(r.data.vigente.base).toMatchObject({ tipo: "anio_completo", anio: 2025, variante: "corregido" });
  });

  it("404 si no hay venta, filas base ni versión del GM que se aprueba", async () => {
    const clave = `22222222-2222-4222-8222-222222222222.${M_R}`;
    const r = await aprobar(post(cuerpoAprobar("x", { base: { tipo: "ninguna", anio: null, variante: "corregido" }, nota: "x" }), clave), ctx(clave));
    expect(r.status).toBe(404);
  });

  it("se puede aprobar sin proyección de referencia: lo que depende de ella queda en null y el equivalente real se estima con la base por curva", async () => {
    estadoFalso.tablas.proyecciones = (estadoFalso.tablas.proyecciones as Fila[]).filter((p) => p.id === P2);
    const d = (await verDetalle()).data;
    expect(d.referencias.find((r) => r.tipo === "aplicado_hoy")?.motivo_nulo).toBe("sin_referencia");
    expect(d.referencias.find((r) => r.tipo === "cierre_curva")?.motivo_nulo).toBeNull();
    expect(d.rebote_nino_pct).toBeNull();
    expect(d.cierre_proyeccion).toBeNull();
    expect(d.hay_nino).toBe(true);
    expect(d.avisos.map((a) => a.codigo)).toContain("sin_proyeccion_referencia");
    const sinRef = { proyeccion_referencia_id: null };

    // La base por defecto (cierre por curva · corregido) se puede aprobar sin referencia, sin nota.
    const r = await aprobarHU({ ...sinRef });
    expect(r.status).toBe(201);
    expect(r.data.vigente.proyeccion_referencia).toBeNull();
    expect(r.data.proyecciones_desactualizadas).toEqual([]);
    expect(r.data.vigente.equivalente_real).toBeCloseTo(((1 + PCT_CIERRE_CURVA_HU / 100) * T_M / K_M - 1) * 100, 1);
    expect((versiones()[0]!.referencia as { base_siguiente: number | null }).base_siguiente).toBeNull();
  });

  it("la variante real con el acumulado en un GM con Niño exige nota también sin proyección de referencia", async () => {
    estadoFalso.tablas.proyecciones = (estadoFalso.tablas.proyecciones as Fila[]).filter((p) => p.id === P2);
    const r = await aprobarHU({ proyeccion_referencia_id: null, pct: 3, base: { tipo: "acumulado", anio: null, variante: "bruto" } });
    expect(r.status).toBe(409);
    expect(r.codigo).toBe("nota_requerida");
  });
});

function lista_(consulta = "") {
  return lista(get(consulta));
}
