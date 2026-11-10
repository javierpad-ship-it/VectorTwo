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

import { GET as aprobaciones, POST as aprobar } from "@/app/api/direccion/aprobaciones/route";
import { GET as estado } from "@/app/api/direccion/estado/route";
import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { aAprobacionApi, diferenciaConAprobada, estadoBreve, estadoDeProyeccion, invalidadaPor, ordenarAprobaciones } from "@/lib/direccion/aprobacion";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { VERSION_HUELLA, type AprobacionApi, type AprobacionesApi, type EstadoDireccionApi, type FilaAprobacionSql, type ResumenAprobacionApi, type TableroApi } from "@/lib/direccion/tipos-api";
import { base, clienteFalso, estadoDireccion, estadoRol, huellaFalsa, sembrarAprobacion, type Fila } from "./direccion.fake-db";
import { AM_A, AM_B, G_HOMBRE, G_MUJER, L1_HU, L2_HU, M_URBANO, P_EN_TRABAJO, P_MOSTRADA, P_SEGUIMIENTO, PERFIL_ADMIN, T03, Y, decidirFila, sembrarProyeccion } from "./direccion.fixture";
import { lectorDeTablero, montarCaso } from "./direccion.montaje";
import { enviar, leer, pedir } from "./direccion.soporte";

/**
 * Ficha 14 · aprobación de dirección: R12 a R18 y R21, la secuencia de §6.1 y los criterios explícitos de R13 y R15, sobre la base falsa. Lo que
 * garantiza SQL de verdad (transacción, bloqueo, triggers, privilegios) lo prueba el humo de la migración. Sintético.
 */

const ver = lectorDeTablero(tablero);
const INEXISTENTE = "00000000-0000-4000-8000-999999999999";
const COPIA = "a0000007-0000-4000-8000-000000000004";

beforeEach(() => {
  montarCaso(vaciarCachesDireccion);
  // Una proyección en trabajo con las mismas cifras que la mostrada (un seguimiento de noviembre).
  sembrarProyeccion({ id: P_EN_TRABAJO, nombre: "Proyección 2026–2027 seguimiento nov", estado: "en_trabajo", creada: "2026-11-08T15:00:00.000Z" });
});

const filasDe = (id: string) => (base.tablas.aprobaciones_direccion ?? []).filter((a) => a.proyeccion_id === id);
const cuerpo = (id: string, huella: string, extra: Record<string, unknown> = {}) => ({ proyeccion_id: id, huella_vista: huella, resultado: "aprobada", confirmo_revision: true, ...extra });
const decidir = async (id: string, huella: string, extra: Record<string, unknown> = {}) => {
  const r = await aprobar(enviar("/aprobaciones", cuerpo(id, huella, extra)));
  return { r, c: await leer<AprobacionApi>(r) };
};
const historial = async (id: string) => (await leer<AprobacionesApi>(await aprobaciones(pedir("/aprobaciones", { proyeccion_id: id })))).data;
const estadoDe = async (q: Record<string, string>) => (await leer<EstadoDireccionApi>(await estado(pedir("/estado", q)))).data;
const proyeccion = (id: string) => (base.tablas.proyecciones ?? []).find((p) => p.id === id) as Fila;
const OBSERVACIONES = { resultado: "con_observaciones", motivo: "crecimiento_alto", comentario: "El crecimiento de MUJER · URBANO parece alto." };

describe("la secuencia de §6.1", () => {
  it("aprobar en trabajo → cambia una fila → invalidada → con observaciones → cerrar sin cambios → sigue vigente; huella vieja `409`; copia sin aprobación propia", async () => {
    // (1) El admin aprueba la proyección en trabajo con la huella h1.
    const h1 = (await ver({ proyeccion_id: P_EN_TRABAJO })).huella;
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    const uno = await decidir(P_EN_TRABAJO, h1);
    expect(uno.r.status).toBe(201);
    expect(uno.c.data).toMatchObject({ proyeccion_id: P_EN_TRABAJO, estado_proyeccion: "en_trabajo", resultado: "aprobada", motivo: null, comentario: null, usuario_nombre: "Admin A.", rol: "admin", huella: h1, invalidada: false, invalidada_por: null });
    expect((await historial(P_EN_TRABAJO)).estado).toBe("aprobada");

    // (2) El planner cambia una fila de 4 300 a 4 400: otra huella, la aprobación queda invalidada.
    decidirFila(P_EN_TRABAJO, L2_HU, AM_B, Y + 1, 4400);
    const dos = await historial(P_EN_TRABAJO);
    const h2 = dos.huella_actual;
    expect(h2).not.toBe(h1);
    expect(dos.estado).toBe("invalidada");
    expect(dos.vigente).toBeNull();
    expect(dos.historial[0]).toMatchObject({ invalidada: true, invalidada_por: "cifras" });

    // (5, antes de reaprobar) Un POST con la huella vieja: `409 huella_distinta`, con la huella de ahora, y ninguna fila nueva.
    const viejo = await decidir(P_EN_TRABAJO, h1);
    expect(viejo.r.status).toBe(409);
    expect(viejo.c).toMatchObject({ codigo: "huella_distinta", huella_actual: h2, error: "La proyección cambió mientras la mirabas: vuelve a cargar el tablero." });
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(1);

    // (3) El admin aprueba con observaciones: cuenta como aprobación vigente.
    const tres = await decidir(P_EN_TRABAJO, h2, OBSERVACIONES);
    expect(tres.r.status).toBe(201);
    expect(tres.c.data).toMatchObject({ resultado: "con_observaciones", motivo: "crecimiento_alto", comentario: OBSERVACIONES.comentario, huella: h2 });
    const conObs = await historial(P_EN_TRABAJO);
    expect(conObs.estado).toBe("con_observaciones");
    expect(conObs.vigente?.id).toBe(tres.c.data.id);
    expect(conObs.historial.map((a) => [a.resultado, a.invalidada])).toEqual([
      ["con_observaciones", false],
      ["aprobada", true],
    ]);

    // (4) El planner la cierra sin tocar cifras: la huella no cambia y la aprobación sigue vigente.
    proyeccion(P_MOSTRADA).estado = "archivada";
    Object.assign(proyeccion(P_EN_TRABAJO), { estado: "cerrada", cerrada_at: "2026-11-09T15:00:00.000Z", cerrada_por_nombre: "Planner P.", nombre: "Proyección 2026–2027 final" });
    const cerrada = await historial(P_EN_TRABAJO);
    expect(cerrada.huella_actual).toBe(h2);
    expect(cerrada.estado).toBe("con_observaciones");
    expect(cerrada.historial[0].estado_proyeccion).toBe("en_trabajo");

    // (6) Un update o un delete directo sobre la tabla fallan (registro inmutable).
    const db = clienteFalso();
    const up = await db.from("aprobaciones_direccion").update({ resultado: "aprobada" }).eq("id", tres.c.data.id);
    expect(up.error?.message).toContain("inmutable");
    const del = await db.from("aprobaciones_direccion").delete().eq("id", tres.c.data.id);
    expect(del.error?.message).toContain("inmutable");
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(2);

    // (7) Una copia sin cambios: misma huella, sin aprobación propia, e «idéntica a lo aprobado».
    sembrarProyeccion({ id: COPIA, nombre: "Proyección 2026–2027 seguimiento dic", estado: "en_trabajo", creada: "2026-11-09T16:00:00.000Z" });
    decidirFila(COPIA, L2_HU, AM_B, Y + 1, 4400);
    const copia = await historial(COPIA);
    expect(copia.huella_actual).toBe(h2);
    expect(copia.estado).toBe("sin_aprobacion");
    expect(copia.historial).toEqual([]);
    const tableroCopia = await ver({ proyeccion_id: COPIA });
    expect(tableroCopia.decidir.estado).toBe("sin_aprobacion");
    expect(tableroCopia.decidir.diferencia).toMatchObject({ identica: true, misma_proyeccion: false, proyeccion_id: P_EN_TRABAJO, resultado: "con_observaciones" });
    expect(tableroCopia.decidir.lineas[3]).toBe("Idéntica a lo aprobado el 08 nov (Proyección 2026–2027 final).");
    expect(tableroCopia.alertas.some((a) => a.codigo === "distinta_de_aprobada")).toBe(false);
  });

  it("(8) si una cifra cambia entre la lectura del servidor y la función de registro, la función responde `huella_distinta` y no se inserta nada", async () => {
    const h1 = huellaFalsa(P_EN_TRABAJO);
    estadoDireccion.antesDeRegistrar = () => decidirFila(P_EN_TRABAJO, L2_HU, AM_B, Y + 1, 4500);
    const { r, c } = await decidir(P_EN_TRABAJO, h1);
    expect(r.status).toBe(409);
    expect(c.codigo).toBe("huella_distinta");
    expect(c.huella_actual).toBe(huellaFalsa(P_EN_TRABAJO));
    expect(c.huella_actual).not.toBe(h1);
    // La función sí se llamó (el servidor vio h1), pero no insertó.
    expect(estadoDireccion.llamadas.registrar).toHaveLength(1);
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(0);
  });

  it("(9) el comprador y el planner no aprueban: `403`; sin sesión, `401`", async () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    for (const [rol, esperado] of [["comprador", 403], ["planner", 403], ["sin_sesion", 401]] as const) {
      estadoRol.rol = rol;
      expect((await decidir(P_EN_TRABAJO, h)).r.status, rol).toBe(esperado);
    }
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(0);
  });
});

describe("R13 · el estado es el de la aprobación más reciente frente a la huella actual", () => {
  it("una anterior con la huella actual no revive; la de otra proyección nunca da estado; con observaciones es vigente", async () => {
    expect((await historial(P_EN_TRABAJO)).estado).toBe("sin_aprobacion");
    const h1 = huellaFalsa(P_EN_TRABAJO);
    await decidir(P_EN_TRABAJO, h1);
    expect((await historial(P_EN_TRABAJO)).estado).toBe("aprobada");
    decidirFila(P_EN_TRABAJO, L2_HU, AM_B, Y + 1, 4400);
    const h2 = huellaFalsa(P_EN_TRABAJO);
    expect((await historial(P_EN_TRABAJO)).estado).toBe("invalidada");
    await decidir(P_EN_TRABAJO, h2, OBSERVACIONES);
    const vigente = await historial(P_EN_TRABAJO);
    expect(vigente.estado).toBe("con_observaciones");
    expect(vigente.vigente).not.toBeNull();
    // Los avisos de Proyección y de Flujo se apagan con una vigente.
    expect((await estadoDe({ proyeccion_id: P_EN_TRABAJO })).vigente).toMatchObject({ resultado: "con_observaciones", usuario_nombre: "Admin A." });

    // La fila vuelve a su valor: la huella es h1 otra vez, pero la más reciente es de h2 → invalidada (la de h1 no revive).
    const registro = (base.tablas.proyeccion_fila_anios ?? []).find((a) => a.decidido === 4400 && (base.tablas.proyeccion_filas ?? []).some((f) => f.id === a.fila_id && f.proyeccion_id === P_EN_TRABAJO));
    Object.assign(registro as Fila, { decidido: 4300, origen: "propuesta" });
    const devuelta = await historial(P_EN_TRABAJO);
    expect(devuelta.huella_actual).toBe(h1);
    expect(devuelta.estado).toBe("invalidada");
    expect(devuelta.vigente).toBeNull();
    expect(devuelta.historial.map((a) => a.invalidada)).toEqual([true, false]);
    const e = await estadoDe({ proyeccion_id: P_EN_TRABAJO });
    expect(e.estado).toBe("invalidada");
    expect(e.vigente).toBeNull();
    expect(e.ultima).toMatchObject({ resultado: "con_observaciones", motivo: "crecimiento_alto" });

    // La mostrada tiene la misma huella h1 que una aprobada de OTRA proyección: su estado sigue «sin aprobación».
    expect(huellaFalsa(P_MOSTRADA)).toBe(h1);
    expect((await historial(P_MOSTRADA)).estado).toBe("sin_aprobacion");
  });

  it("una rechazada da estado `rechazada` y no es vigente; con `resumen.huella_version` distinta, la invalida el cambio de fórmula", async () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    const rechazo = await decidir(P_EN_TRABAJO, h, { resultado: "rechazada", motivo: "contra_tendencia", comentario: "HOMBRE · URBANO crece contra su tendencia." });
    expect(rechazo.r.status).toBe(201);
    const r = await historial(P_EN_TRABAJO);
    expect(r.estado).toBe("rechazada");
    expect(r.vigente).toBeNull();
    const t = await ver({ proyeccion_id: P_EN_TRABAJO });
    expect(t.decidir.estado).toBe("rechazada");
    expect(t.decidir.vigente).toBeNull();
    expect(t.decidir.ultima).toMatchObject({ resultado: "rechazada", motivo: "contra_tendencia" });
    expect(t.decidir.lineas[4]).toBe("En trabajo: las cifras pueden cambiar; rechazada por dirección (Admin A., 08 nov 2026); sin aprobación vigente.");

    // Una aprobación registrada con otra versión de la fórmula de la huella.
    const fila = filasDe(P_EN_TRABAJO)[0] as unknown as FilaAprobacionSql;
    const vieja = { ...fila, resumen: { ...fila.resumen, huella_version: 0 } };
    expect(VERSION_HUELLA).toBe(1);
    expect(invalidadaPor(vieja, h)).toBe("version_huella");
    expect(aAprobacionApi(vieja, h)).toMatchObject({ invalidada: true, invalidada_por: "version_huella" });
    expect(estadoDeProyeccion([vieja], h).estado).toBe("invalidada");
    expect(invalidadaPor(fila, h)).toBeNull();
    expect(invalidadaPor(fila, "otra")).toBe("cifras");
  });

  it("puro: el orden es por fecha (y por id en empate); `estadoBreve` usa solo huella y resultado", () => {
    const f = (id: string, created_at: string) => ({ id, created_at });
    expect(ordenarAprobaciones([f("a", "2026-11-01T10:00:00Z"), f("c", "2026-11-03T10:00:00Z"), f("b", "2026-11-03T10:00:00Z")]).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(estadoBreve(null, "h")).toBe("sin_aprobacion");
    expect(estadoBreve({ huella: "h", resultado: "con_observaciones" }, "h")).toBe("con_observaciones");
    expect(estadoBreve({ huella: "x", resultado: "aprobada" }, "h")).toBe("invalidada");
    expect(estadoDeProyeccion([], "h")).toEqual({ estado: "sin_aprobacion", vigente: null, ultima: null, historial: [] });
  });
});

describe("R14 y R15 · una sola huella para la foto y el registro; siempre la proyección entera", () => {
  it("el `resumen` sale de `tablero_proyeccion(id, {})` (sin filtros ni caché); con otra huella, `409` SIN llamar a la función", async () => {
    await ver({ proyeccion_id: P_EN_TRABAJO, generos: G_HOMBRE, mundo_id: M_URBANO });
    estadoDireccion.llamadas.tablero_proyeccion = [];
    const r = await decidir(P_EN_TRABAJO, "0".repeat(32));
    expect(r.r.status).toBe(409);
    expect(r.c.codigo).toBe("huella_distinta");
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
    expect(estadoDireccion.llamadas.tablero_proyeccion).toEqual([{ id: P_EN_TRABAJO, p: {} }]);

    const bien = await decidir(P_EN_TRABAJO, huellaFalsa(P_EN_TRABAJO));
    expect(bien.r.status).toBe(201);
    const enviado = estadoDireccion.llamadas.registrar[0] as { resumen: ResumenAprobacionApi; huella_vista: string; perfil_id: string; usuario_nombre: string; rol: string };
    // La foto y la huella son del mismo estado; quién aprueba sale de la sesión.
    expect(enviado.resumen.huella).toBe(enviado.huella_vista);
    expect(enviado).toMatchObject({ perfil_id: PERFIL_ADMIN, usuario_nombre: "Admin A.", rol: "admin" });
    expect(bien.c.data.resumen.huella).toBe(bien.c.data.huella);
  });

  it("dos aprobaciones con filtros vistos distintos guardan la misma huella y el mismo `resumen` salvo `filtros_vistos`", async () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    const a = await decidir(P_EN_TRABAJO, h, { filtros_vistos: {} });
    const b = await decidir(P_EN_TRABAJO, h, { filtros_vistos: { generos: [G_HOMBRE], tiendas: [T03], bloque: "mismas" } });
    expect([a.r.status, b.r.status]).toEqual([201, 201]);
    expect(a.c.data.huella).toBe(b.c.data.huella);
    const { filtros_vistos: fa, ...ra } = a.c.data.resumen;
    const { filtros_vistos: fb, ...rb } = b.c.data.resumen;
    expect(ra).toEqual(rb);
    expect(fa).toEqual({});
    expect(fb).toEqual({ generos: [G_HOMBRE], tiendas: [T03], bloque: "mismas" });
    // Dos POST con la misma huella son dos filas (es historial; a propósito no hay único).
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(2);

    // La foto es la de la proyección entera: puente total 84 714, totales por año y bloque, por GM y conteo de alertas.
    const r = a.c.data.resumen;
    expect(r).toMatchObject({ huella: h, huella_version: 1, hasta_periodo: "2026-09", version_metodo: 5 });
    expect(r.totales).toEqual([
      { anio: 2026, total: 78501, por_bloque: { mismas: 74401, nuevas_anterior: 4100, aperturas: 0, cierres: 0 } },
      { anio: 2027, total: 84714, por_bloque: { mismas: 82306, nuevas_anterior: 0, aperturas: 1408, cierres: 1000 } },
    ]);
    expect(r.puente.lineas.find((l) => l.clave === "total_siguiente")?.u).toBe(84714);
    expect(r.puente.lineas.find((l) => l.clave === "manual")?.u).toBe(1343);
    expect(r.puente.lineas.every((l) => !("ayuda" in l))).toBe(true);
    expect(r.por_gm.map((g) => [g.nombre, g.en_curso, g.siguiente, g.declarado_pct])).toEqual([
      ["HOMBRE · URBANO", 50001, 52708, 5],
      ["MUJER · URBANO", 28500, 32006, 8],
    ]);
    expect(r.por_gm[1].implicito_pct).toBeCloseTo(12.3, 1);
    const importantes = r.alertas.filter((x) => x.nivel === "importante").reduce((s, x) => s + x.cantidad, 0);
    expect(importantes).toBe(5);
    expect(Buffer.byteLength(JSON.stringify(r), "utf8")).toBeLessThan(65536);
    // Coincide con el tablero sin filtros.
    const t = await ver({ proyeccion_id: P_EN_TRABAJO });
    expect(r.puente.lineas.map((l) => l.u)).toEqual(t.puente.por_gm[2].lineas.map((l) => l.u));
  });

  it("puro: `armarResumen` no depende de nada más que del documento sin filtros; `diferenciaConAprobada` alinea por año y cuenta 0 lo ausente", () => {
    const fila = { id: "x", proyeccion_id: "otra", anio_en_curso: 2026, resultado: "aprobada", huella: "h0", usuario_nombre: "Admin A.", created_at: "2026-11-03T15:00:00.000Z" } as FilaAprobacionSql;
    const resumen = { totales: [{ anio: 2026, total: 100 }, { anio: 2027, total: 120 }], por_gm: [{ gm_clave: "a", nombre: "A", en_curso: 60, siguiente: 70 }, { gm_clave: "b", nombre: "B", en_curso: 40, siguiente: 50 }] } as unknown as ResumenAprobacionApi;
    const d = diferenciaConAprobada({ ...fila, resumen }, "Otra", { proyeccion_id: "esta", huella: "h1", anio_en_curso: 2026, en_curso: 105, siguiente: 150, por_gm: [{ gm_clave: "a", nombre: "A", siguiente: 75 }, { gm_clave: "c", nombre: "C", siguiente: 75 }] });
    expect(d).toMatchObject({ misma_proyeccion: false, identica: false, en_curso: { aprobado: 100, actual: 105, u: 5 }, siguiente: { aprobado: 120, actual: 150, u: 30, pct: 25 } });
    // Ordenado por |u|; B solo estaba en lo aprobado y C solo en lo actual.
    expect(d?.por_gm.map((g) => [g.gm_clave, g.aprobado, g.actual, g.u])).toEqual([
      ["c", 0, 75, 75],
      ["b", 50, 0, -50],
      ["a", 70, 75, 5],
    ]);
    // Aprobada de otro año en curso: su «siguiente» es el «en curso» de la mostrada.
    const otroAnio = diferenciaConAprobada({ ...fila, anio_en_curso: 2025, resumen: { ...resumen, totales: [{ anio: 2025, total: 90 }, { anio: 2026, total: 100 }] } as ResumenAprobacionApi }, "Otra", { proyeccion_id: "esta", huella: "h1", anio_en_curso: 2026, en_curso: 105, siguiente: 150, por_gm: [] });
    expect(otroAnio?.en_curso).toMatchObject({ aprobado: 100, actual: 105 });
    expect(otroAnio?.siguiente).toMatchObject({ aprobado: 0, actual: 150, pct: null });
    expect(diferenciaConAprobada({ ...fila, resultado: "rechazada", resumen }, "Otra", { proyeccion_id: "esta", huella: "h1", anio_en_curso: 2026, en_curso: 0, siguiente: 0, por_gm: [] })).toBeNull();
  });
});

describe("R16 · concurrencia", () => {
  it("si entre el GET y el POST cambia una cifra: `409 huella_distinta` y ninguna fila nueva", async () => {
    const t = await ver({ proyeccion_id: P_EN_TRABAJO });
    decidirFila(P_EN_TRABAJO, L1_HU, AM_A, Y + 1, 25100);
    const { r, c } = await decidir(P_EN_TRABAJO, t.huella);
    expect(r.status).toBe(409);
    expect(c.codigo).toBe("huella_distinta");
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(0);
  });

  it("una decisión que entra justo después de registrar deja la aprobación invalidada desde que nace (fallo seguro)", async () => {
    const { r } = await decidir(P_EN_TRABAJO, huellaFalsa(P_EN_TRABAJO));
    expect(r.status).toBe(201);
    decidirFila(P_EN_TRABAJO, L1_HU, AM_A, Y + 1, 25100);
    const h = await historial(P_EN_TRABAJO);
    expect(h.estado).toBe("invalidada");
    expect((await ver({ proyeccion_id: P_EN_TRABAJO })).decidir.estado).toBe("invalidada");
  });

  it("una proyección eliminada de forma lógica (`activo = false`) responde `404`", async () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    proyeccion(P_EN_TRABAJO).activo = false;
    const { r, c } = await decidir(P_EN_TRABAJO, h);
    expect(r.status).toBe(404);
    expect(c.codigo).toBe("proyeccion_no_encontrada");
    expect((await decidir(INEXISTENTE, h)).r.status).toBe(404);
  });
});

describe("R17, R18 y R21", () => {
  it("R18 · con observaciones y rechazada exigen motivo del catálogo y comentario de 10 caracteres o más; aprobada los admite opcionales", async () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    const malos: Record<string, unknown>[] = [
      { resultado: "con_observaciones" },
      { resultado: "con_observaciones", motivo: "crecimiento_alto" },
      { resultado: "rechazada", motivo: "crecimiento_alto", comentario: "corto" },
      { resultado: "rechazada", motivo: "no_existe", comentario: "un comentario largo" },
      { resultado: "rechazada", comentario: "un comentario largo" },
      { resultado: "otra" },
      { confirmo_revision: false },
      { huella_vista: "no-es-huella" },
      { comentario: "x".repeat(1001) },
    ];
    for (const extra of malos) {
      const { r, c } = await decidir(P_EN_TRABAJO, h, extra);
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(typeof c.error).toBe("string");
    }
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
    const conComentario = await decidir(P_EN_TRABAJO, h, { comentario: "  Revisado con comercial.  " });
    expect(conComentario.r.status).toBe(201);
    expect(conComentario.c.data.comentario).toBe("Revisado con comercial.");
    // Lo que el cuerpo diga de quién aprueba no cuenta: sale de la sesión.
    const suplantado = await decidir(P_EN_TRABAJO, h, { usuario_nombre: "Otro", rol: "planner", perfil_id: INEXISTENTE });
    expect(suplantado.r.status).toBe(201);
    expect(suplantado.c.data).toMatchObject({ usuario_nombre: "Admin A.", rol: "admin" });
    expect(filasDe(P_EN_TRABAJO).every((f) => f.perfil_id === PERFIL_ADMIN)).toBe(true);
  });

  it("R18 · la base es la segunda barrera: un rol que no es admin lo rechaza el `check` (y la ruta responde `500` sin detalles)", async () => {
    const db = clienteFalso();
    const h = huellaFalsa(P_EN_TRABAJO);
    const r = await db.rpc("registrar_aprobacion_direccion", { p: { proyeccion_id: P_EN_TRABAJO, huella_vista: h, resultado: "aprobada", motivo: null, comentario: null, resumen: { huella: h }, perfil_id: PERFIL_ADMIN, usuario_nombre: "Planner P.", rol: "planner" } });
    expect(r.error?.message).toContain("aprobaciones_direccion_rol_check");
    const sinMotivo = await db.rpc("registrar_aprobacion_direccion", { p: { proyeccion_id: P_EN_TRABAJO, huella_vista: h, resultado: "rechazada", motivo: null, comentario: null, resumen: { huella: h }, perfil_id: PERFIL_ADMIN, usuario_nombre: "Admin A.", rol: "admin" } });
    expect(sinMotivo.error?.code).toBe("23514");
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(0);
    estadoDireccion.falloRpc = { nombre: "registrar_aprobacion_direccion", code: "23514", message: 'new row violates check constraint "aprobaciones_direccion_rol_check"' };
    const ruta = await decidir(P_EN_TRABAJO, h);
    expect(ruta.r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(ruta.c)).not.toContain("aprobaciones_direccion");
  });

  it("R17 · nadie escribe la tabla directamente: insert, update y delete fallan", async () => {
    sembrarAprobacion({ id: "ad000000-0000-4000-8000-000000000777", proyeccion_id: P_EN_TRABAJO, anio_en_curso: Y, estado_proyeccion: "en_trabajo", huella: huellaFalsa(P_EN_TRABAJO), resultado: "aprobada", usuario_nombre: "Admin A.", created_at: "2026-11-08T15:00:00.000Z", resumen: { huella: huellaFalsa(P_EN_TRABAJO), huella_version: 1 } });
    const db = clienteFalso();
    expect((await db.from("aprobaciones_direccion").insert({ proyeccion_id: P_EN_TRABAJO })).error).not.toBeNull();
    expect((await db.from("aprobaciones_direccion").update({ comentario: "x" }).eq("proyeccion_id", P_EN_TRABAJO)).error).not.toBeNull();
    expect((await db.from("aprobaciones_direccion").delete().eq("proyeccion_id", P_EN_TRABAJO)).error).not.toBeNull();
    expect(filasDe(P_EN_TRABAJO)).toHaveLength(1);
  });

  it("R21 · una archivada se ve y no se aprueba: `409 archivada`; sin calcular y calculándose, `409`", async () => {
    const archivada = await decidir(P_SEGUIMIENTO, huellaFalsa(P_SEGUIMIENTO));
    expect(archivada.r.status).toBe(409);
    expect(archivada.c).toMatchObject({ codigo: "archivada", error: "La proyección está archivada: no se puede aprobar." });
    expect((await historial(P_SEGUIMIENTO)).estado).toBe("aprobada");

    const h = huellaFalsa(P_EN_TRABAJO);
    proyeccion(P_EN_TRABAJO).calculando_desde = new Date().toISOString();
    expect((await decidir(P_EN_TRABAJO, h)).c.codigo).toBe("calculo_en_curso");
    proyeccion(P_EN_TRABAJO).calculando_desde = null;
    proyeccion(P_EN_TRABAJO).resumen = null;
    const sin = await decidir(P_EN_TRABAJO, h);
    expect(sin.r.status).toBe(409);
    expect(sin.c.codigo).toBe("sin_calcular");
    expect(estadoDireccion.llamadas.registrar).toHaveLength(0);
  });

  it("aprobar solo añade una fila a `aprobaciones_direccion`: ninguna otra tabla cambia (R24, R25)", async () => {
    const sinAprobaciones = () => JSON.stringify(Object.fromEntries(Object.entries(base.tablas).filter(([t]) => t !== "aprobaciones_direccion")));
    const antes = sinAprobaciones();
    const n = (base.tablas.aprobaciones_direccion ?? []).length;
    expect((await decidir(P_EN_TRABAJO, huellaFalsa(P_EN_TRABAJO))).r.status).toBe(201);
    expect(sinAprobaciones()).toBe(antes);
    expect((base.tablas.aprobaciones_direccion ?? []).length).toBe(n + 1);
  });
});

describe("R12 · qué mueve la huella (sobre el modelo de la base falsa; el SQL real lo prueba el humo)", () => {
  it("la mueven las cifras; no la mueven el estado, el nombre, la nota, el Resto provisional ni una carga nueva; dos copias iguales comparten huella", () => {
    const h = huellaFalsa(P_EN_TRABAJO);
    expect(huellaFalsa(P_MOSTRADA)).toBe(h);
    const p = proyeccion(P_EN_TRABAJO);
    Object.assign(p, { nombre: "Otro nombre", nota: "una nota", estado: "archivada" });
    (p.parametros as Fila).crecimiento_pct_defecto = 35;
    base.tablas.cargas_venta_stock?.push({ id: "f0000001-0000-4000-8000-000000000999", periodo: "2026-11-01", estado: "publicada" });
    expect(huellaFalsa(P_EN_TRABAJO)).toBe(h);

    // El Resto que de verdad se aplicó sí la mueve.
    ((p.parametros as Fila).crecimiento_resto_usado as Fila).pct = 5;
    const conResto = huellaFalsa(P_EN_TRABAJO);
    expect(conResto).not.toBe(h);
    ((p.parametros as Fila).crecimiento_resto_usado as Fila).pct = 4;
    expect(huellaFalsa(P_EN_TRABAJO)).toBe(h);

    const mueve = (cambio: () => void) => {
      const antes = huellaFalsa(P_EN_TRABAJO);
      cambio();
      expect(huellaFalsa(P_EN_TRABAJO)).not.toBe(antes);
    };
    const registro = (base.tablas.proyeccion_fila_anios ?? []).find((a) => a.decidido === 12000 && a.anio === Y + 1 && (base.tablas.proyeccion_filas ?? []).some((f) => f.id === a.fila_id && f.proyeccion_id === P_EN_TRABAJO && f.gml_id === L1_HU)) as Fila;
    mueve(() => (registro.decidido = 12001));
    mueve(() => (registro.propuesto = 12300));
    mueve(() => (registro.base_siguiente = 11301));
    mueve(() => (registro.base_normalizada = 11302));
    mueve(() => (registro.meses = [...(registro.meses as number[]).slice(0, 11), 1]));
    mueve(() => (p.hasta_periodo = "2026-10-01"));
    const celda = (base.tablas.proyeccion_crecimientos ?? []).find((c) => c.proyeccion_id === P_EN_TRABAJO && c.genero_id === G_MUJER) as Fila;
    mueve(() => (celda.pct = 9));
    const tienda = (base.tablas.proyeccion_tiendas ?? []).find((t) => t.proyeccion_id === P_EN_TRABAJO) as Fila;
    mueve(() => (tienda.decidido = Number(tienda.decidido) + 1));
  });
});

describe("GET /api/direccion/estado (avisos de Proyección y de Flujo)", () => {
  it("`para=compras`: la cerrada que usa el flujo, quién la cerró, su estado y la diferencia con lo último aprobado", async () => {
    const e = await estadoDe({ para: "compras" });
    expect(e.proyeccion).toMatchObject({ id: P_MOSTRADA, estado: "cerrada", cerrada_por_nombre: "Planner P.", usa_compras: true });
    expect(e.estado).toBe("sin_aprobacion");
    expect(e.vigente).toBeNull();
    expect(e.ultima).toBeNull();
    expect(e.diferencia).toMatchObject({ identica: false, proyeccion_id: P_SEGUIMIENTO, proyeccion_nombre: "Proyección 2026–2027 seguimiento set", usuario_nombre: "Admin A." });
    expect(e.diferencia?.siguiente).toMatchObject({ aprobado: 83500, actual: 84714, u: 1214 });
    expect(e.diferencia?.en_curso.u).toBe(201);
    // No lee venta.
    expect(estadoDireccion.llamadas.tablero_venta).toHaveLength(0);
    expect(await estadoDe({ proyeccion_id: P_MOSTRADA })).toEqual(e);
  });

  it("sin cerrada que use el flujo: proyección nula y sin estado; sin aprobaciones anteriores, sin diferencia; errores `400` y `404`", async () => {
    proyeccion(P_MOSTRADA).estado = "archivada";
    expect(await estadoDe({ para: "compras" })).toEqual({ proyeccion: null, estado: "sin_aprobacion", vigente: null, ultima: null, diferencia: null });
    base.tablas.aprobaciones_direccion = [];
    const e = await estadoDe({ proyeccion_id: P_EN_TRABAJO });
    expect(e).toMatchObject({ estado: "sin_aprobacion", diferencia: null });
    expect((await estado(pedir("/estado", { proyeccion_id: INEXISTENTE }))).status).toBe(404);
    for (const q of [{}, { proyeccion_id: P_MOSTRADA, para: "compras" }, { para: "otro" }, { proyeccion_id: "x" }] as Record<string, string>[]) {
      expect((await estado(pedir("/estado", q))).status, JSON.stringify(q)).toBe(400);
    }
  });

  it("con la aprobación sobre la misma proyección: aprobada, vigente y diferencia idéntica; al cambiar una cifra, invalidada con la diferencia frente a la foto", async () => {
    await decidir(P_MOSTRADA, huellaFalsa(P_MOSTRADA));
    const e = await estadoDe({ para: "compras" });
    expect(e.estado).toBe("aprobada");
    expect(e.vigente).toMatchObject({ resultado: "aprobada", usuario_nombre: "Admin A." });
    expect(e.diferencia).toMatchObject({ identica: true, misma_proyeccion: true });
    decidirFila(P_MOSTRADA, L2_HU, AM_B, Y + 1, 4400);
    const despues = await estadoDe({ para: "compras" });
    expect(despues.estado).toBe("invalidada");
    expect(despues.vigente).toBeNull();
    expect(despues.diferencia).toMatchObject({ identica: false, misma_proyeccion: true });
    expect(despues.diferencia?.siguiente.u).toBe(100);
    expect(despues.diferencia?.por_gm[0]).toMatchObject({ nombre: "HOMBRE · URBANO", u: 100 });
    const t: TableroApi = await ver();
    expect(t.decidir.lineas[3]).toContain("2027 +100 u");
    expect(t.decidir.lineas[4]).toContain("quedó invalidada: la proyección cambió después");
  });
});
