import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/guard", async () => (await import("./direccion.fake-db")).guardFalso());
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso } = await import("./direccion.fake-db");
  return { supabaseAdmin: () => clienteFalso() };
});
vi.mock("@/lib/direccion/contexto", async (original) => {
  const real = await original<typeof import("@/lib/direccion/contexto")>();
  const fx = await import("./direccion.fixture");
  return { ...real, leerMaestros: async () => ({ data: fx.maestrosCaso(), respuesta: null }), leerNinoDeHoy: async () => ({ data: fx.ninoCaso.valor, respuesta: null }) };
});
vi.mock("@/lib/tiendas/estado", async (original) => {
  const soporte = await import("./direccion.soporte");
  return { ...(await original<typeof import("@/lib/tiendas/estado")>()), hoyLima: () => soporte.relojDePrueba.hoy };
});

import { NextRequest } from "next/server";
import { GET as aprobaciones, POST as aprobar } from "@/app/api/direccion/aprobaciones/route";
import { GET as bloqueos } from "@/app/api/direccion/bloqueos/route";
import { GET as estado } from "@/app/api/direccion/estado/route";
import { GET as opciones } from "@/app/api/direccion/opciones/route";
import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { DELETE as eliminar } from "@/app/api/proyeccion/proyecciones/[id]/route";
import { claveCanonica, CacheDireccion } from "@/lib/direccion/cache";
import { MENSAJE_TIENE_APROBACIONES, esFkDeAprobaciones } from "@/lib/direccion/consultas";
import { MENSAJE_COMPARAR_IGUAL, aprobarDireccionSchema, estadoQuerySchema, filtrosVistosSchema, proyeccionQuerySchema, tableroQuerySchema } from "@/lib/direccion/esquemas";
import { leerConsultaDireccion } from "@/lib/direccion/rutas";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import type { AprobacionesApi } from "@/lib/direccion/tipos-api";
import { base, estadoDireccion, estadoRol, huellaFalsa, sembrar, sembrarAprobacion } from "./direccion.fake-db";
import { P_EN_TRABAJO, P_MOSTRADA, P_SEGUIMIENTO, Y, bloquesCaso } from "./direccion.fixture";
import { montarCaso } from "./direccion.montaje";
import { enviar, leer, pedir } from "./direccion.soporte";

/**
 * Ficha 14 · rutas de `/api/direccion/*`: R19 (roles), R20 (no se elimina una proyección con aprobaciones), los errores de §3.1 y las validaciones de
 * §3.2. Los guards reales (sesión y perfil) se prueban además en `tests/api.guards.roles.test.ts`. Sintético.
 */

beforeEach(() => montarCaso(vaciarCachesDireccion));

const INEXISTENTE = "00000000-0000-4000-8000-999999999999";
const CUERPO = { proyeccion_id: P_MOSTRADA, huella_vista: "0".repeat(32), resultado: "aprobada", confirmo_revision: true };
const LECTURAS: [string, () => Promise<Response>][] = [
  ["opciones", () => opciones()],
  ["tablero", () => tablero(pedir("/tablero"))],
  ["bloqueos", () => bloqueos(pedir("/bloqueos", { proyeccion_id: P_MOSTRADA }))],
  ["aprobaciones", () => aprobaciones(pedir("/aprobaciones", { proyeccion_id: P_MOSTRADA }))],
  ["estado", () => estado(pedir("/estado", { para: "compras" }))],
];

describe("R19 · roles", () => {
  it("las cinco lecturas: `401` sin sesión, `403` el comprador y `200` admin y planner, sin caché del navegador", async () => {
    for (const [nombre, llamar] of LECTURAS) {
      estadoRol.rol = "sin_sesion";
      expect((await llamar()).status, nombre).toBe(401);
      estadoRol.rol = "comprador";
      expect((await llamar()).status, nombre).toBe(403);
    }
    // El comprador no llega a leer nada.
    expect(estadoDireccion.llamadas.tablero_proyeccion).toHaveLength(0);
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(0);
    expect(estadoDireccion.llamadas.huella).toBe(0);
    for (const rol of ["admin", "planner"] as const) {
      estadoRol.rol = rol;
      for (const [nombre, llamar] of LECTURAS) {
        const r = await llamar();
        expect(r.status, `${rol} ${nombre}`).toBe(200);
        expect(r.headers.get("Cache-Control")).toBe("no-store");
        expect((await leer(r)).data).toBeDefined();
      }
    }
  });

  it("aprobar: `401` sin sesión, `403` planner y comprador, `201` el admin; quién aprueba sale de la sesión", async () => {
    const cuerpo = { ...CUERPO, huella_vista: huellaFalsa(P_MOSTRADA) };
    estadoRol.rol = "sin_sesion";
    expect((await aprobar(enviar("/aprobaciones", cuerpo))).status).toBe(401);
    for (const rol of ["planner", "comprador"] as const) {
      estadoRol.rol = rol;
      const r = await aprobar(enviar("/aprobaciones", cuerpo));
      expect(r.status, rol).toBe(403);
    }
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
    estadoRol.rol = "admin";
    const r = await aprobar(enviar("/aprobaciones", cuerpo));
    expect(r.status).toBe(201);
    expect((await leer<{ usuario_nombre: string }>(r)).data.usuario_nombre).toBe("Admin A.");
    // Un admin sin nombre en su perfil queda registrado con su correo.
    estadoRol.perfil = { ...estadoRol.perfil, nombre: null };
    const sinNombre = await aprobar(enviar("/aprobaciones", cuerpo));
    expect((await leer<{ usuario_nombre: string }>(sinNombre)).data.usuario_nombre).toBe("admin@example.com");
  });
});

describe("errores de §3.1", () => {
  it("POST: cuerpo que no es JSON `415`/`400`; validación `400` con el mensaje en castellano; `404` si la proyección no existe", async () => {
    const sinTipo = await aprobar(new NextRequest("http://localhost/api/direccion/aprobaciones", { method: "POST", body: JSON.stringify(CUERPO) }));
    expect(sinTipo.status).toBe(415);
    const roto = await aprobar(new NextRequest("http://localhost/api/direccion/aprobaciones", { method: "POST", body: "{", headers: { "content-type": "application/json" } }));
    expect(roto.status).toBe(400);
    const sinConfirmar = await aprobar(enviar("/aprobaciones", { ...CUERPO, confirmo_revision: false }));
    expect(sinConfirmar.status).toBe(400);
    expect((await leer(sinConfirmar)).error).toBe("confirmo_revision: Confirma que revisaste las alertas y las cifras de toda la proyección.");
    const noExiste = await aprobar(enviar("/aprobaciones", { ...CUERPO, proyeccion_id: INEXISTENTE }));
    expect(noExiste.status).toBe(404);
    expect((await leer(noExiste)).codigo).toBe("proyeccion_no_encontrada");
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
  });

  it("GET /aprobaciones: historial de la más reciente a la más antigua con `invalidada`; `400` sin id o mal formado; `404`", async () => {
    const r = await leer<AprobacionesApi>(await aprobaciones(pedir("/aprobaciones", { proyeccion_id: P_SEGUIMIENTO })));
    expect(r.data.huella_actual).toBe(huellaFalsa(P_SEGUIMIENTO));
    expect(r.data.estado).toBe("aprobada");
    expect(r.data.vigente?.usuario_nombre).toBe("Admin A.");
    expect(r.data.historial.map((a) => [a.resultado, a.invalidada, a.invalidada_por])).toEqual([["aprobada", false, null]]);
    sembrarAprobacion({ id: "ad000000-0000-4000-8000-000000000901", proyeccion_id: P_SEGUIMIENTO, anio_en_curso: Y, estado_proyeccion: "en_trabajo", huella: "f".repeat(32), resultado: "rechazada", motivo: "otro", comentario: "Faltaba decidir filas.", usuario_nombre: "Admin A.", created_at: "2026-10-20T15:00:00.000Z", resumen: { huella: "f".repeat(32), huella_version: 1 } });
    const dos = await leer<AprobacionesApi>(await aprobaciones(pedir("/aprobaciones", { proyeccion_id: P_SEGUIMIENTO })));
    expect(dos.data.historial.map((a) => [a.created_at.slice(0, 10), a.resultado, a.invalidada])).toEqual([
      ["2026-11-03", "aprobada", false],
      ["2026-10-20", "rechazada", true],
    ]);
    expect((await aprobaciones(pedir("/aprobaciones"))).status).toBe(400);
    expect((await aprobaciones(pedir("/aprobaciones", { proyeccion_id: "no-es-uuid" }))).status).toBe(400);
    expect((await aprobaciones(pedir("/aprobaciones", { proyeccion_id: P_MOSTRADA, otro: "1" }))).status).toBe(400);
    expect((await aprobaciones(pedir("/aprobaciones", { proyeccion_id: INEXISTENTE }))).status).toBe(404);
  });

  it("GET /bloqueos: en cerrada o archivada `{ aplica: false }`; `400` con el id mal formado; `404`", async () => {
    for (const id of [P_MOSTRADA, P_SEGUIMIENTO]) expect((await leer(await bloqueos(pedir("/bloqueos", { proyeccion_id: id })))).data).toEqual({ aplica: false });
    const mal = await bloqueos(pedir("/bloqueos", { proyeccion_id: "no-es-uuid" }));
    expect(mal.status).toBe(400);
    expect((await leer(mal)).error).toBe("El identificador de la proyección no es válido.");
    expect((await leer(await bloqueos(pedir("/bloqueos")))).error).toBe("Falta el identificador de la proyección.");
    expect((await bloqueos(pedir("/bloqueos", { proyeccion_id: INEXISTENTE }))).status).toBe(404);
  });

  it("un fallo de la base responde `500` sin detalles; una lectura que tarda demasiado, `503 lectura_lenta` con un mensaje claro", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    estadoDireccion.falloRpc = { nombre: "tablero_proyeccion", code: "XX000", message: 'relation "public.proyeccion_filas" exploded at secret_host' };
    const r = await tablero(pedir("/tablero"));
    expect(r.status).toBe(500);
    const texto = JSON.stringify(await leer(r));
    expect(texto).not.toContain("secret_host");
    expect(texto).not.toContain("proyeccion_filas");
    vaciarCachesDireccion();
    estadoDireccion.falloRpc = { nombre: "tablero_venta", code: "57014", message: "canceling statement due to statement timeout" };
    const lenta = await tablero(pedir("/tablero"));
    expect(lenta.status).toBe(503);
    const cuerpo = await leer(lenta);
    expect(cuerpo.codigo).toBe("lectura_lenta");
    expect(cuerpo.error).toContain("El tablero tardó demasiado");
    // Un fallo no se guarda en la caché: la siguiente lectura funciona.
    expect((await tablero(pedir("/tablero"))).status).toBe(200);
    vi.restoreAllMocks();
  });
});

describe("R20 · una proyección con aprobaciones no se elimina", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
  const sembrarVacia = (id: string, nombre: string) =>
    sembrar("proyecciones", [{ id, anio_en_curso: Y, nombre, estado: "en_trabajo", hasta_periodo: "2026-09-01", parametros: { bloques: bloquesCaso() }, resumen: { version_metodo: 5 }, usuario_nombre: "Planner P." }]);
  const borrar = (id: string) => eliminar(new NextRequest(`http://localhost/api/proyeccion/proyecciones/${id}`, { method: "DELETE" }), ctx(id));

  it("`DELETE /api/proyeccion/proyecciones/[id]` responde `409 tiene_aprobaciones` y no borra nada; sin aprobaciones, la elimina", async () => {
    estadoRol.rol = "planner";
    sembrarVacia(P_EN_TRABAJO, "En trabajo sin decisiones");
    sembrarAprobacion({ id: "ad000000-0000-4000-8000-000000000902", proyeccion_id: P_EN_TRABAJO, anio_en_curso: Y, estado_proyeccion: "en_trabajo", huella: huellaFalsa(P_EN_TRABAJO), resultado: "rechazada", motivo: "otro", comentario: "No está lista todavía.", usuario_nombre: "Admin A.", created_at: "2026-11-08T15:00:00.000Z", resumen: { huella: huellaFalsa(P_EN_TRABAJO), huella_version: 1 } });
    const r = await borrar(P_EN_TRABAJO);
    expect(r.status).toBe(409);
    expect(await leer(r)).toMatchObject({ codigo: "tiene_aprobaciones", error: "Esta proyección tiene aprobaciones de dirección: archívala en lugar de eliminarla." });
    expect((base.tablas.proyecciones ?? []).some((p) => p.id === P_EN_TRABAJO)).toBe(true);
    expect((base.tablas.aprobaciones_direccion ?? []).some((a) => a.proyeccion_id === P_EN_TRABAJO)).toBe(true);

    const otra = "a0000007-0000-4000-8000-000000000005";
    sembrarVacia(otra, "Otra sin aprobaciones");
    expect((await borrar(otra)).status).toBe(200);
    expect((base.tablas.proyecciones ?? []).some((p) => p.id === otra)).toBe(false);
  });

  it("puro: reconoce la FK de aprobaciones con `23503` y con `23001` (PostgreSQL 18), y nada más", () => {
    const mensaje = 'update or delete on table "proyecciones" violates foreign key constraint "aprobaciones_direccion_proyeccion_id_fkey" on table "aprobaciones_direccion"';
    expect(esFkDeAprobaciones({ code: "23503", message: mensaje })).toBe(true);
    expect(esFkDeAprobaciones({ code: "23001", message: "", details: 'Key (id)=(x) is still referenced from table "aprobaciones_direccion".' })).toBe(true);
    expect(esFkDeAprobaciones({ code: "23503", message: 'violates foreign key constraint "proyeccion_lotes_proyeccion_id_fkey"' })).toBe(false);
    expect(esFkDeAprobaciones({ code: "23505", message: mensaje })).toBe(false);
    expect(esFkDeAprobaciones(null)).toBe(false);
    expect(MENSAJE_TIENE_APROBACIONES).toContain("archívala");
  });
});

describe("lectura de la query (`leerConsultaDireccion`) y caché", () => {
  const de = (q: string) => leerConsultaDireccion(new Request(`http://localhost/x${q}`), tableroQuerySchema);

  it("los valores vacíos cuentan como ausentes; un parámetro repetido se rechaza; el código del problema viaja en la respuesta", async () => {
    expect(de("?generos=&mundo_id=&bloque=").datos).toEqual({ resto: false, bloque: "todas", desglose: "mundo" });
    const repetido = de("?bloque=mismas&bloque=nuevas");
    expect(repetido.respuesta?.status).toBe(400);
    expect((await repetido.respuesta?.json()).error).toContain("repetido");
    const A = "11111111-1111-4111-8111-111111111111";
    const igual = de(`?proyeccion_id=${A}&comparar_id=${A}`);
    expect(igual.respuesta?.status).toBe(400);
    expect(await igual.respuesta?.json()).toEqual({ error: MENSAJE_COMPARAR_IGUAL, codigo: "comparar_igual" });
    const otro = de("?bloque=x");
    expect(await otro.respuesta?.json()).toEqual({ error: "El bloque debe ser todas, mismas, nuevas o cierres." });
  });

  it("clave canónica: no depende del orden; una lista vacía NO es lo mismo que una ausente", () => {
    expect(claveCanonica({ b: ["2", "1", "2"], a: "x", c: null, d: undefined })).toBe(claveCanonica({ a: "x", b: ["1", "2"] }));
    expect(claveCanonica({ gml_ids: [] })).not.toBe(claveCanonica({}));
    expect(claveCanonica({ gml_ids: [] })).toBe("gml_ids=[]");
  });

  it("caché: una sola lectura para llamadas simultáneas, no guarda errores ni lo que ya no vale, caduca y descarta la menos reciente", async () => {
    const cache = new CacheDireccion<{ n: number }>(1000, 2);
    let lecturas = 0;
    const cargar = async () => ({ data: { n: ++lecturas }, error: null });
    const [a, b] = await Promise.all([cache.obtener("k", cargar), cache.obtener("k", cargar)]);
    expect(lecturas).toBe(1);
    expect([a.cacheada, b.cacheada]).toEqual([false, false]);
    expect((await cache.obtener("k", cargar)).cacheada).toBe(true);
    // Lo guardado está congelado: nadie altera lo que ve el siguiente.
    expect(Object.isFrozen((await cache.obtener("k", cargar)).data)).toBe(true);

    const fallo = await cache.obtener("e", async () => ({ data: null, error: "x" }));
    expect(fallo.error).toBe("x");
    expect(cache.tamanio).toBe(1);
    await cache.obtener("v", cargar, { vigente: () => false });
    expect(cache.tamanio).toBe(1);

    let ahora = 0;
    await cache.obtener("t", cargar, { ahora: () => ahora });
    ahora = 999;
    expect((await cache.obtener("t", cargar, { ahora: () => ahora })).cacheada).toBe(true);
    ahora = 1001;
    expect((await cache.obtener("t", cargar, { ahora: () => ahora })).cacheada).toBe(false);

    await cache.obtener("u", cargar);
    await cache.obtener("w", cargar);
    expect(cache.tamanio).toBe(2);
    cache.vaciar();
    expect(cache.tamanio).toBe(0);
  });
});

describe("esquemas (§3.2)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  const H = "0123456789abcdef0123456789abcdef";
  const msg = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) => (r.success ? null : (r.error?.issues ?? []).map((i) => `${i.path.join(".")}|${i.message}`));

  describe("tableroQuerySchema", () => {
    it("vacío: valores por defecto", () => {
      expect(tableroQuerySchema.parse({})).toEqual({ resto: false, bloque: "todas", desglose: "mundo" });
    });
    it("listas separadas por comas, sin repetidos ni vacíos, uuid en minúsculas", () => {
      const r = tableroQuerySchema.parse({ generos: `${A}, ${B.toUpperCase()},,${A}`, temporadas: "invierno,sin_temporada", am: C, tiendas: `${A},${B}`, resto: "1", bloque: "mismas", desglose: "tienda", marca: C, comparar_id: "ninguna" });
      expect(r).toEqual({ generos: [A, B], temporadas: ["invierno", "sin_temporada"], am: [C], tiendas: [A, B], resto: true, bloque: "mismas", desglose: "tienda", marca: C, comparar_id: "ninguna" });
    });
    it("lista vacía = ausente", () => {
      const r = tableroQuerySchema.parse({ generos: ",", am: "" });
      expect(r.generos).toBeUndefined();
      expect(r.am).toBeUndefined();
    });
    it("topes", () => {
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`).join(",");
      expect(tableroQuerySchema.safeParse({ tiendas: ids(30) }).success).toBe(true);
      expect(msg(tableroQuerySchema.safeParse({ tiendas: ids(31) }))).toEqual(["tiendas|Se pueden elegir hasta 30 tiendas a la vez."]);
      expect(msg(tableroQuerySchema.safeParse({ am: ids(41) }))).toEqual(["am|Se pueden elegir hasta 40 agrupaciones de marca a la vez."]);
      expect(msg(tableroQuerySchema.safeParse({ generos: ids(21) }))).toEqual(["generos|Se pueden elegir hasta 20 géneros a la vez."]);
    });
    it("mal formados: cada campo con su mensaje, y un parámetro desconocido se rechaza", () => {
      const problemas = msg(tableroQuerySchema.safeParse({ generos: "x", temporadas: "otono", mundo_id: "x", bloque: "z", desglose: "z", resto: "si", comparar_id: "x" })) ?? [];
      expect(problemas).toHaveLength(7);
      expect(problemas.every((p) => /[a-záéíóúñ]/.test(p.split("|")[1]))).toBe(true);
      expect(problemas).toContain("mundo_id|El identificador del mundo no es válido.");
      expect(tableroQuerySchema.safeParse({ mundo: A }).success).toBe(false);
      expect(msg(tableroQuerySchema.safeParse({ mundo: A }))?.[0]).toContain("mundo");
    });
    it("linea_id exige un género sin resto y mundo", () => {
      expect(tableroQuerySchema.safeParse({ linea_id: A, generos: B, mundo_id: C }).success).toBe(true);
      expect(msg(tableroQuerySchema.safeParse({ linea_id: A }))).toEqual(["linea_id|Para filtrar por línea elige también un mundo.", "linea_id|Para filtrar por línea elige un solo género (sin «Resto»)."]);
      expect(tableroQuerySchema.safeParse({ linea_id: A, generos: `${B},${C}`, mundo_id: C }).success).toBe(false);
      expect(tableroQuerySchema.safeParse({ linea_id: A, generos: B, mundo_id: C, resto: "1" }).success).toBe(false);
      expect(tableroQuerySchema.safeParse({ linea_id: A, generos: B }).success).toBe(false);
    });
    it("comparar_igual con código", () => {
      const r = tableroQuerySchema.safeParse({ proyeccion_id: A, comparar_id: A.toUpperCase() });
      expect(r.success).toBe(false);
      const i = r.error?.issues[0] as unknown as { message: string; params?: { codigo?: string }; code: string };
      expect(i.message).toBe(MENSAJE_COMPARAR_IGUAL);
      expect(i.params?.codigo).toBe("comparar_igual");
      expect(tableroQuerySchema.safeParse({ proyeccion_id: A, comparar_id: B }).success).toBe(true);
      expect(tableroQuerySchema.safeParse({ comparar_id: A }).success).toBe(true);
    });
  });

  describe("queries simples", () => {
    it("proyeccion", () => {
      expect(proyeccionQuerySchema.parse({ proyeccion_id: A })).toEqual({ proyeccion_id: A });
      expect(msg(proyeccionQuerySchema.safeParse({}))).toEqual(["proyeccion_id|Falta el identificador de la proyección."]);
      expect(msg(proyeccionQuerySchema.safeParse({ proyeccion_id: "x" }))).toEqual(["proyeccion_id|El identificador de la proyección no es válido."]);
    });
    it("estado", () => {
      expect(estadoQuerySchema.parse({ proyeccion_id: A })).toEqual({ proyeccion_id: A });
      expect(estadoQuerySchema.parse({ para: "compras" })).toEqual({ para: "compras" });
      expect(msg(estadoQuerySchema.safeParse({}))).toEqual(["|Indica «proyeccion_id» o «para=compras» (uno de los dos)."]);
      expect(estadoQuerySchema.safeParse({ para: "compras", proyeccion_id: A }).success).toBe(false);
      expect(msg(estadoQuerySchema.safeParse({ para: "x" }))).toEqual(["para|«para» solo admite «compras»."]);
    });
  });

  describe("aprobarDireccionSchema", () => {
    const cuerpo = { proyeccion_id: A, huella_vista: H, confirmo_revision: true };
    it("aprobada sin motivo ni comentario", () => {
      expect(aprobarDireccionSchema.parse({ ...cuerpo, resultado: "aprobada" })).toEqual({ ...cuerpo, resultado: "aprobada", motivo: null, comentario: null });
      expect(aprobarDireccionSchema.parse({ ...cuerpo, resultado: "aprobada", motivo: null, comentario: "   " }).comentario).toBeNull();
      expect(aprobarDireccionSchema.parse({ ...cuerpo, resultado: "aprobada", comentario: "  ok \n dos " }).comentario).toBe("ok \n dos");
    });
    it("con observaciones o rechazada exigen motivo y comentario", () => {
      expect(msg(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "rechazada" }))).toEqual([
        "motivo|Para aprobar con observaciones o rechazar, elige un motivo.",
        "comentario|Para aprobar con observaciones o rechazar, escribe un comentario de al menos 10 caracteres.",
      ]);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "con_observaciones", motivo: "otro", comentario: "123456789" }).success).toBe(false);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "con_observaciones", motivo: "otro", comentario: "1234567890" }).success).toBe(true);
      // Diez unidades UTF-16 pero cinco caracteres: no alcanza (Postgres cuenta caracteres).
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "rechazada", motivo: "otro", comentario: "😀😀😀😀😀" }).success).toBe(false);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "rechazada", motivo: "x", comentario: "1234567890" }).success).toBe(false);
    });
    it("confirmo_revision, huella, tope y caracteres", () => {
      const problemas = msg(aprobarDireccionSchema.safeParse({ ...cuerpo, confirmo_revision: false, huella_vista: "X", resultado: "z" })) ?? [];
      expect(problemas.map((p) => p.split("|")[0]).sort()).toEqual(["confirmo_revision", "huella_vista", "resultado"]);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "aprobada", comentario: "a".repeat(1000) }).success).toBe(true);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "aprobada", comentario: "a".repeat(1001) }).success).toBe(false);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "aprobada", comentario: "hola‮mundo" }).success).toBe(false);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "aprobada", comentario: "hola\u0000mundo" }).success).toBe(false);
      expect(aprobarDireccionSchema.safeParse({ ...cuerpo, resultado: "aprobada", comentario: "línea uno\r\nlínea dos\tñ" }).success).toBe(true);
    });
    it("filtros_vistos: arreglos, parcial, descarta desconocidos", () => {
      const r = aprobarDireccionSchema.parse({ ...cuerpo, resultado: "aprobada", filtros_vistos: { generos: [A], tiendas: [B], bloque: "mismas", otra: 1 }, perfil_id: A, rol: "admin" });
      expect(r.filtros_vistos).toEqual({ generos: [A], tiendas: [B], bloque: "mismas" });
      expect("perfil_id" in r).toBe(false);
      expect(aprobarDireccionSchema.parse({ ...cuerpo, resultado: "aprobada", filtros_vistos: {} }).filtros_vistos).toEqual({});
      expect(filtrosVistosSchema.safeParse({ generos: `${A},${B}` }).success).toBe(false);
      expect(filtrosVistosSchema.safeParse({ mundo_id: null, resto: true, temporadas: ["verano"] }).success).toBe(true);
    });
  });
});
