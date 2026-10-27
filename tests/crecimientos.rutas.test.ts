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
import { AHORA, G_H, HD, HR, HU, M_D, M_R, M_U, MU, NU, P1, P2, P3, TOTAL_HU, cuerpoAprobar, seriesFixture, sembrar, ventaGMJson } from "./crecimientos.fixture";

const URL = "http://localhost/api/curvas/genero-mundo";
const get = (consulta = "") => new NextRequest(`${URL}${consulta}`);
const post = (cuerpo: unknown, clave = HU) => new NextRequest(`${URL}/${clave}`, { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const ctx = (clave: string) => ({ params: Promise.resolve({ clave }) }) as never;
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string };
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const versiones = () => estadoFalso.tablas.crecimientos_genero_mundo as Fila[];

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
  it("lista los GM con venta, el Resto, el año permitido y la proyección de referencia", async () => {
    const r = await lista(get());
    expect(r.status).toBe(200);
    const { data } = await leer<ListaGeneroMundoApi>(r);
    expect(data.anio_aplicacion).toBe(2027);
    expect(data.anios_permitidos).toEqual([2027]);
    expect(data.ultimo_mes_cerrado).toBe("2026-09");
    expect(data.proyeccion_referencia?.id).toBe(P1);
    expect(data.proyecciones_disponibles.map((p) => p.id)).toEqual([P1]);
    expect(data.filas.map((f) => f.clave).sort()).toEqual([HU, HR, MU, NU, `${G_H}.${M_D}`, `${"33333333-3333-4333-8333-333333333333"}.${M_R}`].sort());
    expect(data.resto.clave).toBe("resto");
    expect(data.huella_datos).toMatch(/^[0-9a-f]{32}$/);
    const hu = data.filas.find((f) => f.clave === HU);
    expect(hu).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", detallable: true, mundo_activo: true, estado: "sin_aprobar", sigue: "resto", vigente: null });
    expect(hu?.base_siguiente).toBe(58900);
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

  it("el total pondera por B y un GM sin aprobar sigue al Resto provisional", async () => {
    const { data } = await leer<ListaGeneroMundoApi>(await lista(get()));
    // HU 58 900, HR 20 000, MU 30 000 y Resto 6 000 al provisional de 5 %: sin ningún aprobado todo crece 5 %.
    expect(data.total.base).toBe(58900 + 20000 + 30000 + 6000);
    expect(data.total.pct_ponderado).toBe(5);
    expect(data.total.sin_aprobar).toBe(3);
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
  });

  it("400 referencia_otro_anio si la proyección pedida no es del año anterior; una de método 3 deja las referencias en null", async () => {
    const otra = await lista(get(`?proyeccion=${P2}`));
    expect(otra.status).toBe(400);
    expect((await leer(otra)).codigo).toBe("referencia_otro_anio");
    expect((await lista(get("?proyeccion=no-es-un-id"))).status).toBe(400);

    const { data } = await leer<ListaGeneroMundoApi>(await lista(get(`?proyeccion=${P3}`)));
    expect(data.proyeccion_referencia?.id).toBe(P3);
    const hu = data.filas.find((f) => f.clave === HU);
    expect(hu?.aplicado_hoy).toMatchObject({ pct_bruto: null, motivo_nulo: "metodo_anterior" });
    expect(hu?.base_siguiente).toBeNull();
    expect(hu?.acumulado.pct_bruto).toBeCloseTo(3, 1);
    expect(hu?.acumulado.equivalente.sin_nino_mas_rebote).toBeNull();
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

  it("la curva de HOMBRE · URBANO: cuatro años, setiembre real y el resto proyectado, mismas tiendas y bandas del Niño", async () => {
    const { data } = await verDetalle();
    expect(data.tiendas.n).toBe(3);
    expect(data.tiendas.ids).toEqual(["t1", "t2", "t3"]);
    expect(data.tiendas.fuera.map((f) => f.tienda_id)).toEqual(["t5", "t6"]);
    expect(data.series.map((s) => s.anio)).toEqual([2023, 2024, 2025, 2026]);

    const y2025 = data.series[2]!;
    expect(y2025.total).toBe(suma(TOTAL_HU[2025]!));
    expect(y2025.incompleto).toBe(false);
    expect(suma(y2025.forma as number[])).toBeCloseTo(100, 1);

    const y2026 = data.series[3]!;
    expect(y2026.origen.slice(0, 9)).toEqual(Array(9).fill("real"));
    expect(y2026.origen.slice(9)).toEqual(["proyectado", "proyectado", "proyectado"]);
    expect(y2026.incompleto).toBe(true);
    expect(y2026.meses[5]).toBe(4000);
    expect(y2026.meses_sin_nino[5]).toBeCloseTo(5000, 1);
    expect(y2026.meses[10]).toBeGreaterThan(0);

    // 2023 y 2026 fueron Niño en invierno; el de 2026 es parcial.
    expect(data.bandas_nino).toEqual([
      { anio: 2023, temporada: "invierno", meses: [6, 7, 8], factor: 0.9, parcial: false },
      { anio: 2026, temporada: "invierno", meses: [6, 7, 8], factor: 0.8, parcial: true },
    ]);
    expect(data.factores_parciales).toBe(true);
    expect(data.avisos.map((a) => a.codigo)).toEqual(expect.arrayContaining(["factor_parcial", "anio_nino"]));
    // La forma típica sale de 2024 y 2025 (2023 fue Niño): doce valores que suman 100.
    expect(data.forma_tipica).toHaveLength(12);
    expect(suma(data.forma_tipica as number[])).toBeCloseTo(100, 1);
  });

  it("las referencias de HOMBRE · URBANO dan las cifras de la ficha (regla 12 contra la base falsa)", async () => {
    const { data } = await verDetalle();
    const por = (tipo: string, anio?: number) => data.referencias.find((r) => r.tipo === tipo && (anio === undefined || r.anio === anio))!;
    const acumulado = por("acumulado");
    expect(acumulado).toMatchObject({ tiendas: 3, anterior: 40000, actual: 41200, fragil: false, extremo: false, variante_defecto: "sin_nino_mas_rebote" });
    expect(acumulado.pct_bruto).toBeCloseTo(3.0, 1);
    expect(acumulado.pct_sin_nino).toBeCloseTo(10.5, 1);
    expect(acumulado.equivalente.sin_nino_mas_rebote).toBeCloseTo(18.4, 1);
    expect(acumulado.cobertura_pct).toBeCloseTo(74, 0);
    expect(acumulado.tienda_mayor?.codigo).toBe("T01");
    expect(data.rebote_nino_pct).toBeCloseTo(7.1, 1);

    const cierre = por("cierre_proyectado");
    expect(cierre).toMatchObject({ anterior: 54000, actual: 55620 });
    expect(cierre.pct_bruto).toBeCloseTo(3.0, 1);
    expect(cierre.pct_sin_nino).toBeCloseTo(10.4, 1);
    expect(cierre.equivalente.sin_nino_mas_rebote).toBeCloseTo(18.3, 1);

    // 2025 frente a 2024: T06 vendió los dos años enteros (cierra en 2026), así que entra en C(2025) con 200 u. al mes.
    expect(por("anio_completo", 2025)).toMatchObject({ tiendas: 4, anterior: 51429 + 2400, actual: 54000 + 2400 });
    expect(por("anio_completo", 2025).pct_bruto).toBeCloseTo(((54000 + 2400) / (51429 + 2400) - 1) * 100, 1);
    expect(por("anio_completo", 2024).motivo_nulo).toBeNull();
    expect(data.referencias.filter((r) => r.tipo === "anio_completo")).toHaveLength(2);

    // La foto aplica 12 % a HOMBRE · URBANO: el equivalente sin Niño de «aplicado hoy» es el mismo 12 % bruto.
    expect(por("aplicado_hoy")).toMatchObject({ pct_bruto: 12, anterior: 58900 });
    expect(por("aplicado_hoy").equivalente.sin_nino_mas_rebote).toBeCloseTo(12, 1);
  });

  it("HOMBRE · RI se marca «extremo» con más de 50 % y su tienda mayor trae el aporte", async () => {
    const { data } = await verDetalle(HR);
    const a = data.referencias.find((r) => r.tipo === "acumulado")!;
    expect(a.extremo).toBe(true);
    expect(a.fragil).toBe(false);
    expect(a.tienda_mayor).toMatchObject({ codigo: "T01" });
    expect(a.variante_defecto).toBe("bruto");
  });

  it("el detalle del Resto suma los géneros no detallados", async () => {
    const { data } = await verDetalle("resto");
    expect(data).toMatchObject({ clave: "resto", genero: null, mundo: null, detallable: true, sigue: "propio", estado: "sin_aprobar" });
    expect(data.acumulado.anterior).toBe(suma(Array(9).fill(500 + 300)));
  });
});

describe("POST /api/curvas/genero-mundo/[clave]", () => {
  it("aprueba la v1 con la base precargada sin nota, con su foto, quién y cuándo", async () => {
    const r = await aprobarHU();
    expect(r.status).toBe(201);
    expect(r.data.vigente).toMatchObject({ version: 1, estado: "vigente", pct: 18.4, nota: null, por_nombre: "Javier", base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote" } });
    expect(r.data.vigente.base.valor).toBeCloseTo(18.38, 1);
    expect(r.data.vigente.proyeccion_referencia?.id).toBe(P1);
    expect(r.data.proyecciones_desactualizadas.map((p) => p.id).sort()).toEqual([P1, P3].sort());
    const fila = versiones()[0]!;
    expect(fila).toMatchObject({ anio_aplicacion: 2027, alcance: "gm", genero_id: G_H, mundo_id: M_U, version: 1, estado: "vigente", base_tipo: "acumulado", perfil_id: "99999999-9999-4999-8999-999999999999" });
    const foto = fila.referencia as { gml_ids: string[]; referencias: unknown[]; huella_datos: string; proyeccion: { id: string }; base: { variante: string } };
    expect(foto.gml_ids).toEqual(["n1", "n2"]);
    expect(foto.referencias.length).toBeGreaterThan(3);
    expect(foto.proyeccion.id).toBe(P1);
    expect(foto.base.variante).toBe("sin_nino_mas_rebote");

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

  it("regla 2 · R-N: 15 % frente a una base de 18,4 % exige nota; con nota se crea la versión", async () => {
    const sin = await aprobarHU({ pct: 15 });
    expect(sin.status).toBe(409);
    expect(sin.codigo).toBe("nota_requerida");
    expect(sin.error).toMatch(/nota/);
    expect(versiones()).toHaveLength(0);
    const con = await aprobarHU({ pct: 15, nota: "Prudente: el rebote del invierno no será completo" });
    expect(con.status).toBe(201);
    expect(con.data.vigente.nota).toMatch(/Prudente/);
  });

  it("regla 2 · sin base (ninguna) la nota es siempre obligatoria", async () => {
    const base = { tipo: "ninguna", anio: null, variante: "bruto" };
    expect((await aprobarHU({ base, pct: 10 })).codigo).toBe("nota_requerida");
    const r = await aprobarHU({ base, pct: 10, nota: "Criterio comercial" });
    expect(r.status).toBe(201);
    expect(r.data.vigente.base.valor).toBeNull();
  });

  it("regla 3 · sin_cambio: el mismo % con la misma base y nota no crea otra versión", async () => {
    await aprobarHU();
    const r = await aprobarHU({ version_vigente: 1 });
    expect(r.status).toBe(409);
    expect(r.codigo).toBe("sin_cambio");
    expect(r.error).toMatch(/v1/);
    expect(versiones()).toHaveLength(1);
  });

  it("regla 3 · una vigente obsoleta se puede refrescar con el mismo %", async () => {
    await aprobarHU();
    // Cambia la venta de 2026: la base acumulada se mueve más de 1 pp y la v1 queda obsoleta.
    const series = seriesFixture().map((s) => (s.g === G_H && s.m === M_U && s.t === "t1" ? { ...s, u: { ...s.u, "2026-01": (s.u["2026-01"] as number) + 1500 } } : s));
    estadoFalso.ventaGM = { respuesta: ventaGMJson(series), error: null };
    vaciarCacheGM();
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "base_movida" });
    const nuevo = (await verDetalle()).data;
    const valor = nuevo.referencias.find((r) => r.tipo === "acumulado")!.equivalente.sin_nino_mas_rebote as number;
    // El % de la v1 (18,4) se aprueba otra vez: la base ya no vale lo mismo, así que hay v2 (con nota por la distancia).
    const r = await aprobar(post(cuerpoAprobar(nuevo.huella_datos, { version_vigente: 1, nota: `Se mantiene frente a ${valor}` })), ctx(HU));
    expect(r.status).toBe(201);
    expect((await leer<RespuestaAprobarCrecimientoApi>(r)).data.vigente.version).toBe(2);
  });

  it("regla 4 · un género distinto de HOMBRE y MUJER da 400 genero_no_detallado", async () => {
    const r = await aprobarHU({ base: { tipo: "ninguna", anio: null, variante: "bruto" }, nota: "x" }, NU);
    expect(r.status).toBe(400);
    expect(r.codigo).toBe("genero_no_detallado");
    expect(versiones()).toHaveLength(0);
  });

  it("regla 4 · un mundo inactivo da 400 mundo_inactivo, salvo que el GM tenga filas base en una proyección en trabajo (I3)", async () => {
    const extra = { base: { tipo: "ninguna", anio: null, variante: "bruto" }, nota: "x", pct: 5 };
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
    expect(ap.pct_bruto).toBe(5);
    const r = await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "bruto" }, pct: 5 }, "resto");
    expect(r.status).toBe(201);
    expect(versiones()[0]).toMatchObject({ alcance: "resto", genero_id: null, mundo_id: null, base_tipo: "aplicado_hoy" });
    // Con el Resto aprobado, el provisional deja de ser el que sigue cada GM sin aprobar.
    const lista = (await leer<ListaGeneroMundoApi>(await lista_())).data;
    expect(lista.resto).toMatchObject({ estado: "aprobado", sigue: "propio" });
  });

  it("regla 5 · obsoleto por base movida (≥ 1 pp); «aplicado hoy» no se marca por moverse", async () => {
    await aprobarHU();
    await aprobarHU({ base: { tipo: "aplicado_hoy", anio: null, variante: "bruto" }, pct: 5 }, "resto");
    // Octubre publicado lleva el acumulado de HOMBRE · URBANO a otro valor: la v1 queda obsoleta, la del Resto no.
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
    await aprobarHU();
    // La proyección de referencia pasa a método 3: la variante sin Niño + rebote ya no tiene rebote.
    const p1 = (estadoFalso.tablas.proyecciones as Fila[]).find((p) => p.id === P1) as { resumen: { version_metodo: number } };
    p1.resumen.version_metodo = 3;
    const lista = (await leer<ListaGeneroMundoApi>(await lista_(`?proyeccion=${P1}`))).data;
    expect(lista.filas.find((f) => f.clave === HU)).toMatchObject({ estado: "obsoleto", motivo_obsoleto: "base_no_calculable" });
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

  it("aprueba con la base de un año completo (2025) y su valor equivalente", async () => {
    const d = (await verDetalle()).data;
    const ref = d.referencias.find((r) => r.tipo === "anio_completo" && r.anio === 2025)!;
    const r = await aprobarHU({ base: { tipo: "anio_completo", anio: 2025, variante: "bruto" }, pct: ref.equivalente.bruto });
    expect(r.status).toBe(201);
    expect(r.data.vigente.base).toMatchObject({ tipo: "anio_completo", anio: 2025, variante: "bruto" });
  });

  it("404 si no hay venta, filas base ni versión del GM que se aprueba", async () => {
    const clave = `22222222-2222-4222-8222-222222222222.${M_R}`;
    const r = await aprobar(post(cuerpoAprobar("x", { base: { tipo: "ninguna", anio: null, variante: "bruto" }, nota: "x" }), clave), ctx(clave));
    expect(r.status).toBe(404);
  });

  it("se puede aprobar sin proyección de referencia: lo que depende de ella queda en null y la variante sin rebote exige nota", async () => {
    estadoFalso.tablas.proyecciones = (estadoFalso.tablas.proyecciones as Fila[]).filter((p) => p.id === P2);
    const d = (await verDetalle()).data;
    expect(d.referencias.find((r) => r.tipo === "cierre_proyectado")?.motivo_nulo).toBe("sin_referencia");
    expect(d.referencias.find((r) => r.tipo === "aplicado_hoy")?.motivo_nulo).toBe("sin_referencia");
    expect(d.rebote_nino_pct).toBeNull();
    expect(d.avisos.map((a) => a.codigo)).toContain("sin_proyeccion_referencia");
    const sinRef = { proyeccion_referencia_id: null };

    const rebote = await aprobarHU({ ...sinRef, pct: 18.4 });
    expect(rebote.status).toBe(409);
    expect(rebote.codigo).toBe("nota_requerida");

    const bruto = await aprobarHU({ ...sinRef, pct: 3, base: { tipo: "acumulado", anio: null, variante: "bruto" } });
    expect(bruto.status).toBe(201);
    expect(bruto.data.vigente.proyeccion_referencia).toBeNull();
    expect(bruto.data.proyecciones_desactualizadas).toEqual([]);
  });
});

function lista_(consulta = "") {
  return lista(get(consulta));
}
