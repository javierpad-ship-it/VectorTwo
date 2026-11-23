import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, reiniciarContexto } from "./proyeccion.contexto-falso";

/**
 * Invariante del reparto mensual (ficha 07, §6.5): para todo registro activo con `meses`, `Σ meses = coalesce(decidido, propuesto)`.
 *
 * El fallo de la cerrada de 2026 (nov. 2026): las filas de tienda `escalada` (el reparto del total decidido de la tienda, regla 23) se rehacen en cada
 * `calcular` con las propuestas nuevas, pero `guardarCalculo` escribía solo `meses` (sin `decidido`): quedaba el total escalado viejo con el reparto del
 * nuevo. Neto 0 por tienda (las dos escaladas suman `D`), con unidades corridas de una fila a otra. La copia (`copiar_de`) escribe la decisión con los
 * meses y por eso salía bien. Datos sintéticos; sin red.
 */

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

import { POST as crear } from "@/app/api/proyeccion/proyecciones/route";
import { POST as calcular } from "@/app/api/proyeccion/proyecciones/[id]/calcular/route";
import { POST as cerrar } from "@/app/api/proyeccion/proyecciones/[id]/cerrar/route";
import { PUT as decidirFila } from "@/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route";
import { PUT as decidirTienda } from "@/app/api/proyeccion/proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route";
import { POST as sincronizar } from "@/app/api/proyeccion/factores/sincronizar/route";
import { contarMesesDescuadrados, mensajeMesesDescuadrados, mesesDescuadrados, motivoRechazoCerrar } from "@/lib/proyeccion/reglas";
import { escalarTienda } from "@/lib/proyeccion/tiendas-nuevas";
import { construirVenta, AM, N, tiendas as tiendasFixture } from "./proyeccion.fixture";
import type { ProyeccionApi } from "@/lib/proyeccion/tipos-api";

const URL_BASE = "http://localhost/api/proyeccion";
const enviar = (metodo: string, cuerpo: unknown = {}, consulta = "") =>
  new NextRequest(`${URL_BASE}/x${consulta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];

type Descuadre = { clave: string; tienda: string | null; anio: number; origen: unknown; suma: number; vigente: number | null };

/** Los registros activos de una proyección cuyos meses no suman su total, con `mesesDescuadrados` (la misma definición que usa el cierre). */
function descuadres(proyeccionId: string): Descuadre[] {
  const filas = new Map(filasDe("proyeccion_filas").filter((f) => f.proyeccion_id === proyeccionId && f.activo).map((f) => [f.id, f]));
  const salida: Descuadre[] = [];
  for (const a of filasDe("proyeccion_fila_anios")) {
    const f = filas.get(a.fila_id);
    if (!f || !a.activo) continue;
    const r = { anio: a.anio as number, meses: a.meses as number[] | null, decidido: a.decidido as number | null, propuesto: a.propuesto as number | null };
    if (!mesesDescuadrados(r)) continue;
    salida.push({ clave: f.clave as string, tienda: f.tienda_id as string | null, anio: r.anio, origen: a.origen, suma: (r.meses ?? []).reduce((x, y) => x + y, 0), vigente: r.decidido ?? r.propuesto });
  }
  return salida;
}

const tiendaDb = (id: string, tienda: string, anio: number) => filasDe("proyeccion_tiendas").find((t) => t.proyeccion_id === id && t.tienda_id === tienda && t.anio === anio) as Fila;
const sumaFilasTienda = (id: string, tienda: string, anio: number) =>
  filasDe("proyeccion_filas")
    .filter((f) => f.proyeccion_id === id && f.tienda_id === tienda && f.activo)
    .reduce((s, f) => {
      const r = filasDe("proyeccion_fila_anios").find((a) => a.fila_id === f.id && a.anio === anio && a.activo);
      return s + Number(r?.decidido ?? r?.propuesto ?? 0);
    }, 0);

async function nueva(extra: Record<string, unknown> = {}, nombre = "Proyección 2026–2027"): Promise<string> {
  const r = await crear(new NextRequest(`${URL_BASE}/proyecciones`, { method: "POST", body: JSON.stringify({ nombre, parametros: { crecimiento_pct_defecto: 5 }, ...extra }), headers: { "content-type": "application/json" } }));
  const c = await leer<ProyeccionApi>(r);
  expect(r.status, JSON.stringify(c).slice(0, 300)).toBe(201);
  return c.data.id;
}
const putFila = (id: string, filaId: string, anio: number, cuerpo: unknown) => decidirFila(enviar("PUT", cuerpo), ctx(id, { filaId, anio: String(anio) }));
const putTienda = (id: string, tienda: string, anio: number, cuerpo: unknown) => decidirTienda(enviar("PUT", cuerpo), ctx(id, { tiendaId: tienda, anio: String(anio) }));
const recalcular = async (id: string) => {
  const r = await calcular(enviar("POST"), ctx(id));
  expect(r.status, JSON.stringify(await r.clone().json()).slice(0, 300)).toBe(201);
};

/** Cambia los datos de modo que las propuestas de las tiendas nuevas se muevan (lo que pasó entre el 16/10 y el método 5 del 30/10). */
function moverDatos(factor: number) {
  contexto.tiendasExtra = { ...contexto.tiendasExtra, T4: { venta_esperada: Math.round(85000 * factor) } };
  // La venta de setiembre de las tiendas nuevas de 2026 (solo su fila con venta cambia de propuesta: el reparto entre sus filas se mueve).
  const original: Record<string, number> = { T2: 25, T3: 40, T9: 55 };
  contexto.hechos = contexto.hechos.map((h) =>
    h.periodo === "2026-09" && h.tienda in original && h.nodo === "denim" ? { ...h, unidades: Math.round(original[h.tienda] * factor), soles: Math.round(original[h.tienda] * factor) * 100 } : h
  );
}

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
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

describe("el fallo de la cerrada: recalcular con totales de tienda decididos", () => {
  it("las filas `escalada` se rehacen con su cifra Y sus meses: Σ meses = decidido y Σ filas = D de la tienda en los dos años", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T3", 2026, { decidido: 300, origen: "manual" })).status).toBe(200);
    expect((await putTienda(id, "T4", 2027, { decidido: 7000, origen: "manual" })).status).toBe(200);
    expect(descuadres(id)).toEqual([]);
    const escaladasAntes = new Map(
      filasDe("proyeccion_filas")
        .filter((f) => f.proyeccion_id === id && (f.tienda_id === "T3" || f.tienda_id === "T4"))
        .flatMap((f) => filasDe("proyeccion_fila_anios").filter((a) => a.fila_id === f.id && a.origen === "escalada").map((a) => [`${f.clave}#${a.anio}`, a.decidido]))
    );
    expect(escaladasAntes.size).toBeGreaterThan(2);

    moverDatos(1.6);
    await recalcular(id);

    // Antes del arreglo: los registros escalados de T3 (2026) y T4 (2027) quedaban con el `decidido` viejo y los meses del nuevo.
    expect(descuadres(id)).toEqual([]);
    // Las cifras escaladas SÍ cambiaron (si no, la prueba no probaría nada) y siguen sumando el total de la tienda.
    const despues = filasDe("proyeccion_filas")
      .filter((f) => f.proyeccion_id === id && (f.tienda_id === "T3" || f.tienda_id === "T4"))
      .flatMap((f) => filasDe("proyeccion_fila_anios").filter((a) => a.fila_id === f.id && a.origen === "escalada").map((a) => [`${f.clave}#${a.anio}`, a.decidido] as const));
    expect(despues.some(([k, v]) => escaladasAntes.get(k) !== v)).toBe(true);
    expect(sumaFilasTienda(id, "T3", 2026)).toBe(300);
    expect(sumaFilasTienda(id, "T4", 2027)).toBe(7000);
    // La firma de la escalada es la del total de la tienda (no se pierde al recalcular).
    for (const [clave] of despues) {
      const [c, anio] = clave.split("#");
      const f = filasDe("proyeccion_filas").find((x) => x.proyeccion_id === id && x.clave === c) as Fila;
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === Number(anio)) as Fila;
      expect(a.decidido_por_nombre, clave).toBe("Javier");
      expect(a.decidido_at, clave).toBeTruthy();
    }
  });

  it("la copia (`copiar_de`) cuadra aunque la de origen no: escribe la decisión junto con los meses", async () => {
    const id = await nueva();
    expect((await putTienda(id, "T4", 2027, { decidido: 7000, origen: "manual" })).status).toBe(200);
    // Estado heredado de la cerrada: un registro escalado con el `decidido` viejo y los meses de otro total.
    const fila = filasDe("proyeccion_filas").find((f) => f.proyeccion_id === id && f.clave === `T4|${N.denim}||${AM.rec}`) as Fila;
    const reg = filasDe("proyeccion_fila_anios").find((a) => a.fila_id === fila.id && a.anio === 2027) as Fila;
    reg.decidido = (reg.decidido as number) + 37;
    expect(descuadres(id)).toHaveLength(1);
    const copia = await nueva({ copiar_de: id }, "Seguimiento");
    expect(descuadres(copia)).toEqual([]);
    expect(sumaFilasTienda(copia, "T4", 2027)).toBe(7000);
  });

  it("una fila escalada nunca queda bajo lo vendido en el año en curso (su reparto conserva el real)", async () => {
    const id = await nueva();
    const vendidoT3 = tiendaDb(id, "T3", 2026).vendido as number;
    // El total mínimo posible (lo vendido por la tienda): cada fila escalada queda exactamente en su real y sus meses lo suman.
    expect((await putTienda(id, "T3", 2026, { decidido: vendidoT3, origen: "manual" })).status).toBe(200);
    expect(descuadres(id)).toEqual([]);
    for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === "T3")) {
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === 2026) as Fila;
      expect(a.decidido as number, f.clave as string).toBeGreaterThanOrEqual(a.vendido as number);
    }
  });
});

describe("cerrar no deja pasar meses que no suman su total (`meses_descuadrados`)", () => {
  async function lista(id: string) {
    for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === null)) {
      for (const anio of [2026, 2027]) {
        const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
        if (a.propuesto !== null && (a.propuesto as number) >= 100) expect((await putFila(id, f.id as string, anio, { origen: "propuesta" })).status).toBe(200);
      }
    }
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.bloque === "nuevas" && x.venta_esperada_usada !== null)) {
      expect((await putTienda(id, t.tienda_id as string, t.anio as number, { origen: "propuesta" })).status).toBe(200);
    }
  }

  it("409 con cuántas filas y de qué año; no se salta con «Cerrar de todos modos»; recalcular lo arregla y cierra", async () => {
    const id = await nueva();
    await lista(id);
    // Estado heredado (lo que dejó el fallo): un registro de tienda de 2027 y otro de 2026 con meses de otro total.
    const deTienda = filasDe("proyeccion_filas").filter((f) => f.proyeccion_id === id && f.tienda_id !== null);
    const corromper = (tienda: string, anio: number) => {
      const f = deTienda.find((x) => x.tienda_id === tienda && filasDe("proyeccion_fila_anios").some((a) => a.fila_id === x.id && a.anio === anio && Array.isArray(a.meses))) as Fila;
      const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio) as Fila;
      const meses = [...(a.meses as number[])];
      meses[11] += 5;
      a.meses = meses;
    };
    corromper("T4", 2027);
    corromper("T3", 2026);
    const esperado = contarMesesDescuadrados(
      filasDe("proyeccion_filas")
        .filter((f) => f.proyeccion_id === id && f.activo)
        .flatMap((f) => filasDe("proyeccion_fila_anios").filter((a) => a.fila_id === f.id && a.activo))
        .map((a) => ({ anio: a.anio as number, meses: a.meses as number[] | null, decidido: a.decidido as number | null, propuesto: a.propuesto as number | null, vendido: a.vendido as number })),
      2026
    );
    expect(esperado.map((x) => x.anio)).toEqual([2026, 2027]);

    const r = await cerrar(enviar("POST"), ctx(id));
    const c = await leer(r);
    expect(r.status).toBe(409);
    expect(c.codigo).toBe("meses_descuadrados");
    expect(c.error).toBe(mensajeMesesDescuadrados(esperado));
    expect(c.error).toMatch(/^Hay 1 fila de 2026 y 1 de 2027 cuyos meses no suman su total/);
    expect(c.detalle).toEqual({ meses_descuadrados: esperado });
    const forzada = await cerrar(enviar("POST", {}, "?forzar=1"), ctx(id));
    expect(forzada.status).toBe(409);
    expect((await leer(forzada)).codigo).toBe("meses_descuadrados");
    expect((filasDe("proyecciones").find((p) => p.id === id) as Fila).estado).toBe("en_trabajo");

    await recalcular(id);
    expect(descuadres(id)).toEqual([]);
    expect((await cerrar(enviar("POST"), ctx(id))).status).toBe(200);
  });

  it("el mensaje dice el año aunque haya uno solo, y avisa las que tienen un total menor que lo vendido", () => {
    expect(mensajeMesesDescuadrados([{ anio: 2027, filas: 1023, bajo_vendido: 0, diferencia_u: 10774 }])).toBe(
      `Hay ${(1023).toLocaleString("es-PE")} filas de 2027 cuyos meses no suman su total: recalcula la proyección para rehacer el reparto antes de cerrar (no se puede forzar).`
    );
    expect(mensajeMesesDescuadrados([{ anio: 2026, filas: 3, bajo_vendido: 1, diferencia_u: 9 }])).toContain("Una de ellas tiene un total menor que lo ya vendido: corrígelo en Por línea.");
    const base = { estado: "en_trabajo" as const, calculandoDesde: null, ahora: "2026-11-21T10:00:00.000Z", anioEnCurso: 2026, filasBase: [], tiendas: [], desactualizada: false, forzar: true };
    expect(motivoRechazoCerrar({ ...base, mesesDescuadrados: [] })).toMatchObject({ ok: true });
    expect(motivoRechazoCerrar({ ...base, mesesDescuadrados: [{ anio: 2026, filas: 810, bajo_vendido: 0, diferencia_u: 29310 }] })).toMatchObject({ ok: false, rechazo: { status: 409, codigo: "meses_descuadrados" } });
  });
});

describe("invariante: Σ meses = coalesce(decidido, propuesto) tras cualquier cadena de operaciones", () => {
  /** PRNG determinista (mulberry32): cada semilla es una cadena reproducible. */
  function azar(semilla: number) {
    let s = semilla >>> 0;
    const sig = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { sig, entero: (a: number, b: number) => a + Math.floor(sig() * (b - a + 1)), uno: <T,>(xs: readonly T[]): T => xs[Math.floor(sig() * xs.length)] };
  }

  type Op = { nombre: string; correr: () => Promise<void> };

  function operaciones(id: string, rnd: ReturnType<typeof azar>, log: string[]): Op[] {
    const regDe = (filaId: unknown, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === filaId && a.anio === anio && a.activo);
    const filasBase = () => filasDe("proyeccion_filas").filter((f) => f.proyeccion_id === id && f.tienda_id === null && f.activo);
    const filasTienda = () => filasDe("proyeccion_filas").filter((f) => f.proyeccion_id === id && f.tienda_id !== null && f.activo);
    const tiendas = () => filasDe("proyeccion_tiendas").filter((t) => t.proyeccion_id === id && t.activo);
    const cifra = (r: Fila, anio: number) => {
      const piso = anio === 2026 ? Number(r.vendido ?? 0) : 0;
      return piso + rnd.entero(0, Math.max(10, 2 * Number(r.propuesto ?? 100)));
    };
    const aceptar = async (status: number, que: string) => {
      log.push(`${que} → ${status}`);
      // 409 legítimos (p. ej. menor_que_vendido) no escriben; cualquier otra cosa es un fallo de la prueba.
      expect([200, 409], que).toContain(status);
    };
    return [
      {
        nombre: "decidir fila base (cifra o propuesta)",
        correr: async () => {
          const f = rnd.uno(filasBase());
          const anio = rnd.uno([2026, 2027]);
          const r = regDe(f.id, anio);
          if (!r) return;
          const cuerpo = r.propuesto !== null && rnd.sig() < 0.4 ? { origen: "propuesta" } : { decidido: cifra(r, anio), origen: "manual" };
          await aceptar((await putFila(id, f.id as string, anio, cuerpo)).status, `fila base ${f.clave} ${anio} ${JSON.stringify(cuerpo)}`);
        },
      },
      {
        nombre: "volver una fila base a la propuesta",
        correr: async () => {
          const f = rnd.uno(filasBase());
          const anio = rnd.uno([2026, 2027]);
          if (!regDe(f.id, anio)) return;
          await aceptar((await putFila(id, f.id as string, anio, { decidido: null })).status, `volver base ${f.clave} ${anio}`);
        },
      },
      {
        nombre: "decidir el total de una tienda (cifra, propuesta o volver)",
        correr: async () => {
          // Sobre todo tiendas nuevas (varias filas que escalar); a veces un cierre.
          const nuevas = tiendas().filter((x) => x.bloque === "nuevas");
          const t = rnd.uno(nuevas.length > 0 && rnd.sig() < 0.85 ? nuevas : tiendas());
          const anio = t.anio as number;
          const p = rnd.sig();
          const cuerpo =
            p < 0.1 ? { decidido: null } : p < 0.35 && t.propuesto !== null ? { origen: "propuesta" } : { decidido: (anio === 2026 ? Number(t.vendido) : 0) + rnd.entero(0, Math.max(50, 2 * Number(t.propuesto ?? 200))), origen: "manual" };
          await aceptar((await putTienda(id, t.tienda_id as string, anio, cuerpo)).status, `tienda ${t.tienda_id} ${anio} ${JSON.stringify(cuerpo)}`);
        },
      },
      {
        nombre: "cambiar la rampa de una tienda nueva",
        correr: async () => {
          const nuevas = tiendas().filter((t) => t.bloque === "nuevas");
          if (nuevas.length === 0) return;
          const t = rnd.uno(nuevas);
          const rampa = rnd.uno([[0.7, 0.85, 1], [1, 1, 1], [2, 1.2, 1], [0.5, 0.8]]);
          await aceptar((await putTienda(id, t.tienda_id as string, t.anio as number, { rampa })).status, `rampa ${t.tienda_id} ${t.anio} ${rampa.join("/")}`);
        },
      },
      {
        nombre: "fijar (o soltar) una fila de tienda",
        correr: async () => {
          const conReg = filasTienda().flatMap((f) => [2026, 2027].filter((a) => regDe(f.id, a)).map((a) => [f, a] as const));
          if (conReg.length === 0) return;
          const [f, anio] = rnd.uno(conReg);
          const r = regDe(f.id, anio) as Fila;
          const cuerpo = rnd.sig() < 0.25 ? { decidido: null } : rnd.sig() < 0.3 ? { origen: "propuesta" } : { decidido: cifra(r, anio), origen: "manual" };
          await aceptar((await putFila(id, f.id as string, anio, cuerpo)).status, `fila tienda ${f.clave} ${anio} ${JSON.stringify(cuerpo)}`);
        },
      },
      {
        // Un lote de aprobación escribe, por fila, lo mismo que «Aceptar» (`aplicarDecision` + `payloadAnioDecision`, ver `aprobacion/servicio.ts` → `evaluar`); la
        // función SQL solo aplica ese `set`. Aquí se aprueban (o se deshacen) varias filas base de un año de una vez por la misma vía.
        nombre: "lote: aprobar o deshacer varias filas base",
        correr: async () => {
          const anio = rnd.uno([2026, 2027]);
          const deshacer = rnd.sig() < 0.4;
          const elegidas = filasBase().filter(() => rnd.sig() < 0.5);
          for (const f of elegidas) {
            const r = regDe(f.id, anio);
            if (!r || (deshacer ? r.decidido === null : r.propuesto === null)) continue;
            await aceptar((await putFila(id, f.id as string, anio, deshacer ? { decidido: null } : { origen: "propuesta" })).status, `lote ${deshacer ? "deshacer" : "aprobar"} ${f.clave} ${anio}`);
          }
        },
      },
      {
        nombre: "recalcular (con datos nuevos o sin cambios)",
        correr: async () => {
          if (rnd.sig() < 0.8) moverDatos(rnd.uno([0.6, 0.9, 1.3, 1.8]));
          await recalcular(id);
          log.push("recalcular");
        },
      },
      {
        nombre: "sincronizar los factores del Niño y recalcular",
        correr: async () => {
          const r = await sincronizar();
          log.push(`sincronizar → ${r.status}`);
          expect(r.status).toBeLessThan(500);
          // Lo que pasó el 07/11: los factores se confirman y se recalcula con lo publicado desde el cálculo anterior.
          if (rnd.sig() < 0.5) moverDatos(rnd.uno([0.8, 1.2]));
          await recalcular(id);
        },
      },
    ];
  }

  async function cadena(semilla: number, pasos: number) {
    const rnd = azar(semilla);
    const id = await nueva();
    const log: string[] = [];
    const ops = operaciones(id, rnd, log);
    // Como la cerrada: los totales de las tiendas nuevas se deciden el primer día (unos con la propuesta, otros con una cifra) y después pasa de todo.
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.activo && x.bloque === "nuevas" && x.propuesto !== null)) {
      const cuerpo = rnd.sig() < 0.5 ? { origen: "propuesta" } : { decidido: Number(t.vendido) + rnd.entero(0, 2 * Number(t.propuesto)), origen: "manual" };
      const r = await putTienda(id, t.tienda_id as string, t.anio as number, cuerpo);
      log.push(`inicio: tienda ${t.tienda_id} ${t.anio} ${JSON.stringify(cuerpo)} → ${r.status}`);
      expect(r.status).toBe(200);
    }
    expect(descuadres(id)).toEqual([]);
    for (let i = 0; i < pasos; i++) {
      const op = rnd.uno(ops);
      await op.correr();
      const d = descuadres(id);
      expect(d, `semilla ${semilla}, paso ${i} (${op.nombre}):\n${log.slice(-6).join("\n")}`).toEqual([]);
    }
    return { id, log };
  }

  for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`cadena de operaciones aleatoria (semilla ${semilla}): ningún registro descuadra`, async () => {
      await cadena(semilla, 24);
    }, 60_000);
  }

  it("al final de una cadena: decidir lo pendiente, cerrar y copiar la cerrada; la cerrada y la copia cuadran", async () => {
    const { id } = await cadena(42, 12);
    await recalcular(id);
    for (const f of filasDe("proyeccion_filas").filter((x) => x.proyeccion_id === id && x.tienda_id === null && x.activo)) {
      for (const anio of [2026, 2027]) {
        const a = filasDe("proyeccion_fila_anios").find((x) => x.fila_id === f.id && x.anio === anio && x.activo);
        if (a && a.decidido === null && a.propuesto !== null && (a.propuesto as number) >= 100) expect((await putFila(id, f.id as string, anio, { origen: "propuesta" })).status).toBe(200);
      }
    }
    for (const t of filasDe("proyeccion_tiendas").filter((x) => x.proyeccion_id === id && x.activo && x.bloque === "nuevas" && x.venta_esperada_usada !== null && x.decidido === null)) {
      expect((await putTienda(id, t.tienda_id as string, t.anio as number, { origen: "propuesta" })).status).toBe(200);
    }
    expect(descuadres(id)).toEqual([]);
    const r = await cerrar(enviar("POST", {}, "?forzar=1"), ctx(id));
    expect(r.status, JSON.stringify(await r.clone().json()).slice(0, 400)).toBe(200);
    expect(descuadres(id)).toEqual([]);
    const copia = await nueva({ copiar_de: id }, "Seguimiento");
    expect(descuadres(copia)).toEqual([]);
  }, 60_000);
});

describe("escalarTienda con piso por fila (regla 23 + lo vendido)", () => {
  it("propiedad: ninguna libre bajo su piso; Σ = D cuando los pisos caben; sin pisos, el reparto de siempre", () => {
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
    for (let caso = 0; caso < 400; caso++) {
      const n = 1 + Math.floor(r() * 5);
      const filas = Array.from({ length: n }, (_, i) => {
        const minimo = Math.floor(r() * 300);
        return { id: `f${i}`, propuesto: r() < 0.1 ? null : minimo + Math.floor(r() * 500), fijada: r() < 0.2 ? minimo + Math.floor(r() * 200) : null, peso: r(), minimo };
      });
      const fijadas = filas.reduce((a, f) => a + (f.fijada ?? 0), 0);
      const pisos = filas.reduce((a, f) => a + (f.fijada === null ? f.minimo : 0), 0);
      const D = fijadas + pisos + Math.floor(r() * 1500) - (r() < 0.15 ? Math.floor(r() * 400) : 0);
      const { asignado, avisos } = escalarTienda(filas, D);
      for (const f of filas) if (f.fijada === null) expect(asignado.get(f.id) as number).toBeGreaterThanOrEqual(f.minimo);
      const suma = [...asignado.values()].reduce((a, b) => a + b, 0);
      const hayLibres = filas.some((f) => f.fijada === null);
      if (!hayLibres) expect(suma).toBe(fijadas);
      else if (D >= fijadas + pisos) expect(suma).toBe(Math.max(0, D));
      else expect(avisos).toContain("fijadas_exceden");
      // Sin pisos: idéntico al reparto proporcional (regla 23).
      const sinPiso = escalarTienda(filas.map((f) => ({ ...f, minimo: 0 })), Math.max(D, fijadas));
      const sinPisoSinCampo = escalarTienda(filas.map(({ minimo: _m, ...f }) => (void _m, f)), Math.max(D, fijadas));
      expect([...sinPiso.asignado]).toEqual([...sinPisoSinCampo.asignado]);
    }
  });
});

describe("«Cerrar» dice de qué año es lo pendiente", () => {
  const comunes = { estado: "en_trabajo" as const, calculandoDesde: null, ahora: "2026-11-21T10:00:00.000Z", anioEnCurso: 2026, desactualizada: false, forzar: false, umbralColaLarga: 100 };
  it("filas sin decidir: con los dos años, cuántas de cada uno; con uno solo, ese año", () => {
    const fila = (clave: string, a2026: number | null, a2027: number | null) => ({
      clave,
      anios: { 2026: { clave, propuesto: a2026, decidido: null }, 2027: { clave, propuesto: a2027, decidido: null } },
    });
    const dos = motivoRechazoCerrar({ ...comunes, filasBase: [fila("a", 500, 600), fila("b", 50, 300), fila("c", 40, 200)], tiendas: [] });
    expect(!dos.ok && dos.rechazo.mensaje).toBe("Faltan 4 filas por decidir: 1 de 2026 y 3 de 2027 (propuesta de 100 unidades o más).");
    const uno = motivoRechazoCerrar({ ...comunes, filasBase: [fila("a", 50, 600)], tiendas: [] });
    expect(!uno.ok && uno.rechazo.mensaje).toBe("Falta 1 fila de 2027 por decidir (propuesta de 100 unidades o más).");
  });
  it("tiendas nuevas sin decidir: igual", () => {
    const t = (tienda_id: string, anio: number) => ({ tienda_id, anio, venta_esperada: 1000, decidido: null });
    const dos = motivoRechazoCerrar({ ...comunes, filasBase: [], tiendas: [t("a", 2026), t("b", 2027), t("c", 2027)] });
    expect(!dos.ok && dos.rechazo.mensaje).toBe("Faltan 3 tiendas nuevas por decidir: 1 de 2026 y 2 de 2027.");
    const uno = motivoRechazoCerrar({ ...comunes, filasBase: [], tiendas: [t("b", 2027)] });
    expect(!uno.ok && uno.rechazo.mensaje).toBe("Falta 1 tienda nueva de 2027 por decidir.");
  });
});
