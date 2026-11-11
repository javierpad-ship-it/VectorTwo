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
  return {
    ...real,
    leerMaestros: async () => ({ data: fx.maestrosCaso(), respuesta: null }),
    leerNinoDeHoy: async () => ({ data: fx.ninoCaso.valor, respuesta: null }),
  };
});
vi.mock("@/lib/tiendas/estado", async (original) => {
  const soporte = await import("./direccion.soporte");
  return {
    ...(await original<typeof import("@/lib/tiendas/estado")>()),
    hoyLima: () => soporte.relojDePrueba.hoy,
  };
});

import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { repartirVendidoGuardado } from "@/lib/direccion/atribucion";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { motivoSinComparada } from "@/lib/direccion/tablero";
import { variacionPct } from "@/lib/direccion/textos";
import { DESGLOSES_TABLERO, type TableroApi } from "@/lib/direccion/tipos-api";
import { base, type Fila } from "./direccion.fake-db";
import { AM_A, AM_B, G_HOMBRE, K, L1_HU, MARCA_W, MARCA_X, MARCA_Z, M_URBANO, P_MOSTRADA, P_SEGUIMIENTO, T01, T03, Y } from "./direccion.fixture";
import { montarCaso } from "./direccion.montaje";
import { leer, pedir } from "./direccion.soporte";

/**
 * Ficha 14 · prueba COMBINATORIA de los invariantes del tablero sobre el caso de §6.1 (B1 de la segunda ronda de qa: con una unidad de marca y además
 * tiendas o bloque, el cierre del año en curso no cuadraba; se escapó dos rondas porque marca + tiendas no se probaba junto).
 *
 * Recorre {sin marca, cada unidad} × {sin tiendas, una tienda, dos tiendas, cada bloque} × {sin AM, cada AM compatible} × {sin género, HU, HU+URBANO}
 * × {sin temporada, invierno}, saltando las combinaciones que el servidor rechaza (`marca_fuera_de_agrupacion`) y las vacías (sin proyección en el
 * recorte), en dos escenas: el caso tal cual (la participación guardada coincide con la venta real de cada marca) y el caso con la participación de
 * L1 · AM-A desviada de la venta real (X 20 % / W 80 % frente a 63 % / 37 % vendido), que es lo que hacía saltar B1. Sintético; ningún dato real.
 */

const S = Y + 1;
/**
 * Tolerancia de «total del año = Σ de sus meses» en la fila del cierre: 0 sin marca (el caso no tiene registros sin `meses`); con marca, la del contrato
 * (`tests/direccion.tablero.test.ts`, «con marca (redondeo por mes)…»): lo proyectado por marca se redondea por mes y el total una vez, ≤ 12 u por año.
 * `kpis.cierre = real_ac + proyectado_resto` es EXACTO siempre.
 */
const TOL_MESES_MARCA = 12;

type Consulta = Record<string, string>;

const MARCAS: { nombre: string; q: Consulta; am: string | null }[] = [
  { nombre: "sin marca", q: {}, am: null },
  { nombre: "X", q: { marca: MARCA_X }, am: AM_A },
  { nombre: "W", q: { marca: MARCA_W }, am: AM_A },
  { nombre: "Z", q: { marca: MARCA_Z }, am: AM_B },
];
const TIENDAS: { nombre: string; q: Consulta }[] = [
  { nombre: "sin tiendas", q: {} },
  { nombre: "T01", q: { tiendas: T01 } },
  { nombre: "T03", q: { tiendas: T03 } },
  { nombre: "T01+T03", q: { tiendas: `${T01},${T03}` } },
  { nombre: "bloque mismas", q: { bloque: "mismas" } },
  { nombre: "bloque nuevas", q: { bloque: "nuevas" } },
  { nombre: "bloque cierres", q: { bloque: "cierres" } },
  { nombre: "mismas+T03", q: { bloque: "mismas", tiendas: T03 } },
];
const AMS: { nombre: string; q: Consulta; id: string | null }[] = [
  { nombre: "sin AM", q: {}, id: null },
  { nombre: "AM-A", q: { am: AM_A }, id: AM_A },
  { nombre: "AM-B", q: { am: AM_B }, id: AM_B },
];
const GENEROS: { nombre: string; q: Consulta }[] = [
  { nombre: "sin género", q: {} },
  { nombre: "HU", q: { generos: G_HOMBRE } },
  { nombre: "HU+URBANO", q: { generos: G_HOMBRE, mundo_id: M_URBANO } },
];
const TEMPORADAS: { nombre: string; q: Consulta }[] = [
  { nombre: "sin temporada", q: {} },
  { nombre: "invierno", q: { temporadas: "invierno" } },
];

const fila = (t: TableroApi, clave: string) => t.tabla_mensual.filas.find((x) => x.clave === clave) ?? null;
const serie = (t: TableroApi, clave: string) => t.series.find((x) => x.clave === clave) ?? null;
const sumaNula = (v: readonly (number | null)[]) => v.reduce<number>((a, x) => a + (x ?? 0), 0);
const anioDe = (f: TableroApi["desglose"]["total"], anio: number) => f.anios.find((a) => a.anio === anio)?.total ?? null;
const igualPct = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/** Los incumplimientos de un tablero (vacío = todo bien). */
function incumplimientos(t: TableroApi, conMarca: boolean): string[] {
  const mal: string[] = [];
  const k = t.proyeccion.k;
  const tol = conMarca ? TOL_MESES_MARCA : 0;
  const { cierre, real_ac, proyectado_resto, siguiente } = t.kpis;
  if (cierre !== real_ac + proyectado_resto) mal.push(`kpis: cierre ${cierre} ≠ real_ac ${real_ac} + proyectado_resto ${proyectado_resto}`);
  // §3.4 D: si alguna tienda de la llamada tiene `A_t − real_t < 0`, de `k+1` a diciembre no se reparte por mes (los meses van en `null`, con la alerta
  // `atribucion_sin_mensual`); el total anual sí. Es la regla de la ficha, no un fallo: se comprueba que sea coherente y se cuenta aparte.
  const sinMensual = t.atribucion?.mensual === false;

  const fc = fila(t, `cierre_${Y}`);
  const fp = fila(t, `proyectado_${Y}`);
  const fs = fila(t, `proyectado_${S}`);
  if (!fc || !fp || !fs) return [...mal, "faltan filas cierre/proyectado"];
  if (fc.total !== cierre) mal.push(`cierre_${Y}.total ${fc.total} ≠ kpis.cierre ${cierre}`);
  if (fc.meses.slice(0, k).some((x) => x === null)) mal.push(`cierre_${Y} con ene–k en null: ${JSON.stringify(fc.meses)}`);
  if (sumaNula(fc.meses.slice(0, k)) !== real_ac) mal.push(`real_ac ${real_ac} ≠ Σ ene–k de cierre_${Y} ${sumaNula(fc.meses.slice(0, k))}`);
  for (let m = 1; m <= 12; m++) {
    if (m <= k && fp.meses[m - 1] !== null) mal.push(`proyectado_${Y} mes ${m} debería ser null`);
    if (m > k && fp.meses[m - 1] !== fc.meses[m - 1]) mal.push(`mes ${m}: cierre_${Y} ${fc.meses[m - 1]} ≠ proyectado_${Y} ${fp.meses[m - 1]}`);
  }
  if (sinMensual) {
    if (fc.meses.slice(k).some((x) => x !== null)) mal.push(`sin reparto mensual pero cierre_${Y} trae meses de k+1 a diciembre`);
    if (fp.total !== proyectado_resto) mal.push(`sin reparto mensual: proyectado_${Y}.total ${fp.total} ≠ kpis.proyectado_resto ${proyectado_resto}`);
    if (!t.alertas.some((a) => a.codigo === "atribucion_sin_mensual")) mal.push("sin reparto mensual y sin la alerta atribucion_sin_mensual");
  } else {
    if (fc.meses.some((x) => x === null)) mal.push(`cierre_${Y} con meses en null: ${JSON.stringify(fc.meses)}`);
    if (Math.abs(sumaNula(fc.meses) - (fc.total ?? 0)) > tol) mal.push(`cierre_${Y}: Σ meses ${sumaNula(fc.meses)} ≠ total ${fc.total}`);
    if (fp.total !== sumaNula(fp.meses)) mal.push(`proyectado_${Y}.total ${fp.total} ≠ Σ meses ${sumaNula(fp.meses)}`);
    if (Math.abs((fp.total ?? 0) - proyectado_resto) > tol) mal.push(`proyectado_${Y}.total ${fp.total} ≠ kpis.proyectado_resto ${proyectado_resto}`);
    if (proyectado_resto !== 0 && fp.meses.every((x) => x === null)) mal.push(`proyectado_${Y} todo en null con resto ${proyectado_resto}`);
  }
  if (siguiente !== 0 && fs.meses.every((x) => x === null)) mal.push(`proyectado_${S} todo en null con ${siguiente}`);
  if (fs.total !== siguiente) mal.push(`proyectado_${S}.total ${fs.total} ≠ kpis.siguiente ${siguiente}`);
  const sp = serie(t, `proyectado_${Y}`);
  if (!sp || JSON.stringify(sp.meses) !== JSON.stringify(fp.meses) || sp.total !== fp.total) mal.push(`serie proyectado_${Y} distinta de la fila`);
  const ss = serie(t, `proyectado_${S}`);
  if (!ss || JSON.stringify(ss.meses) !== JSON.stringify(fs.meses) || ss.total !== fs.total) mal.push(`serie proyectado_${S} distinta de la fila`);

  // Variaciones mensuales: de las filas de las que salen.
  const ra = fila(t, `real_${Y - 1}`);
  const vars: [string, readonly (number | null)[], readonly (number | null)[], number | null, number | null][] = [
    ["var_sig_vs_cierre", fs.meses, fc.meses, fs.total, fc.total],
    ["var_sig_vs_anterior", fs.meses, ra?.meses ?? [], fs.total, ra?.total ?? null],
    ["var_cierre_vs_anterior", fc.meses, ra?.meses ?? [], fc.total, ra?.total ?? null],
  ];
  for (const [clave, a, b, ta, tb] of vars) {
    const v = fila(t, clave);
    if (!v) {
      mal.push(`falta ${clave}`);
      continue;
    }
    for (let m = 1; m <= 12; m++)
      if (!igualPct(v.meses[m - 1], variacionPct(a[m - 1] ?? null, b[m - 1] ?? null))) mal.push(`${clave} mes ${m}: ${v.meses[m - 1]} no sale de sus filas`);
    if (!igualPct(v.total, variacionPct(ta, tb ?? 0))) mal.push(`${clave} total ${v.total} no sale de sus filas`);
  }

  // R5: el total del desglose es el de las tarjetas.
  if (anioDe(t.desglose.total, Y) !== cierre) mal.push(`desglose.total ${Y} ${anioDe(t.desglose.total, Y)} ≠ cierre ${cierre}`);
  if (anioDe(t.desglose.total, S) !== siguiente) mal.push(`desglose.total ${S} ${anioDe(t.desglose.total, S)} ≠ siguiente ${siguiente}`);

  // Puente del recorte (cuando se manda): cierra en las tarjetas.
  const pr = t.puente.recorte;
  if (pr) {
    const ultima = pr.lineas.find((l) => l.clave === "total_siguiente");
    const primera = pr.lineas.find((l) => l.clave === "cierre_en_curso");
    if (ultima?.acumulado !== siguiente) mal.push(`puente: total_siguiente ${ultima?.acumulado} ≠ siguiente ${siguiente}`);
    if (primera?.u !== cierre) mal.push(`puente: cierre_en_curso ${primera?.u} ≠ cierre ${cierre}`);
  }

  // Exactitud.
  const esperado = conMarca ? "estimado" : "exacto";
  if ((t.kpis.real_ac_exactitud ?? "exacto") !== esperado) mal.push(`real_ac_exactitud ${t.kpis.real_ac_exactitud} (esperado ${esperado})`);
  if (conMarca && (fc.exactitud !== "estimado" || fp.exactitud !== "estimado" || fs.exactitud !== "estimado" || t.kpis.exactitud !== "estimado"))
    mal.push("con marca, cierre/proyectado/kpis deberían ir «estimado»");
  for (const f of t.tabla_mensual.filas) if (f.clave.startsWith("real_") && f.exactitud !== "exacto") mal.push(`${f.clave} debería ir «exacto»`);
  return mal;
}

/**
 * Recorre el producto de filtros. `desgloses = "todos"`: cada combinación con los 7 desgloses (y la comparada por defecto); `"rotar"`: un desglose por
 * combinación, rotando (y sin comparar).
 */
async function recorrer(desgloses: "todos" | "rotar"): Promise<{
  pedidas: number;
  vistas: number;
  sinMensual: number;
  saltadas: { invalidas: number; vacias: number };
  fallos: string[];
}> {
  const fallos: string[] = [];
  let pedidas = 0;
  let vistas = 0;
  let sinMensual = 0;
  const saltadas = { invalidas: 0, vacias: 0 };
  let n = 0;
  for (const marca of MARCAS)
    for (const am of AMS)
      for (const tiendas of TIENDAS)
        for (const genero of GENEROS)
          for (const temporada of TEMPORADAS)
            for (const desglose of desgloses === "todos" ? DESGLOSES_TABLERO : [DESGLOSES_TABLERO[n++ % DESGLOSES_TABLERO.length]]) {
              // `marca_fuera_de_agrupacion`: la unidad de marca no es de la AM elegida. El servidor la rechaza; aquí se comprueba y se salta.
              const invalida = marca.am !== null && am.id !== null && marca.am !== am.id;
              const q: Consulta = {
                ...marca.q,
                ...am.q,
                ...tiendas.q,
                ...genero.q,
                ...temporada.q,
                desglose,
                ...(desgloses === "rotar" ? { comparar_id: "ninguna" } : {}),
              };
              const r = await tablero(pedir("/tablero", q));
              pedidas++;
              const cuerpo = await leer<TableroApi>(r);
              const nombre = [marca.nombre, am.nombre, tiendas.nombre, genero.nombre, temporada.nombre, `desglose ${desglose}`].join(" · ");
              if (invalida) {
                if (r.status !== 400 || cuerpo.codigo !== "marca_fuera_de_agrupacion")
                  fallos.push(`${nombre}: esperaba 400 marca_fuera_de_agrupacion y llegó ${r.status}`);
                saltadas.invalidas++;
                continue;
              }
              if (r.status !== 200) {
                fallos.push(`${nombre}: ${r.status} ${JSON.stringify(cuerpo).slice(0, 200)}`);
                continue;
              }
              const t = cuerpo.data;
              if (t.kpis.cierre === 0 && t.kpis.siguiente === 0) {
                saltadas.vacias++;
                continue;
              }
              vistas++;
              if (t.atribucion?.mensual === false) sinMensual++;
              for (const m of incumplimientos(t, marca.am !== null)) fallos.push(`${nombre}: ${m}`);
            }
  return { pedidas, vistas, sinMensual, saltadas, fallos };
}

beforeEach(() => montarCaso(vaciarCachesDireccion));

/** L1 · AM-A de la mostrada con `por_marca` X 20 % / W 80 % (la venta real es 63 % / 37 %). */
function desviarParticipacion(): void {
  const filas = (base.tablas.proyeccion_filas ?? []).filter(
    (f: Fila) => f.proyeccion_id === P_MOSTRADA && f.tienda_id === null && f.gml_id === L1_HU && f.agrupacion_marca_id === AM_A
  );
  expect(filas).toHaveLength(1);
  for (const f of filas)
    f.participaciones = {
      periodo_referencia: null,
      por_clave_flujo: [],
      por_marca: [
        { marca_id: MARCA_X, participacion: 0.2 },
        { marca_id: MARCA_W, participacion: 0.8 },
      ],
      por_talla: [],
    };
  vaciarCachesDireccion();
}

describe("Invariantes del tablero en todas las combinaciones de filtros (B1 de la segunda ronda de qa)", () => {
  it("caso §6.1 tal cual, con los 7 desgloses y la comparada por defecto", async () => {
    const r = await recorrer("todos");
    expect(r.fallos.slice(0, 40)).toEqual([]);
    // 4 marcas × 3 AM × 8 conjuntos de tiendas × 3 géneros × 2 temporadas × 7 desgloses = 4 032 pedidas; 1 008 rechazadas (X o W con AM-B, Z con AM-A).
    expect(r.pedidas).toBe(4032);
    expect(r.saltadas.invalidas).toBe(1008);
    expect(r.vistas).toBeGreaterThan(2000);
  }, 300_000);

  it("con la participación de L1 · AM-A desviada de la venta real (lo que hacía saltar B1)", async () => {
    desviarParticipacion();
    const r = await recorrer("rotar");
    expect(r.fallos.slice(0, 40)).toEqual([]);
    expect(r.pedidas).toBe(576);
    expect(r.vistas).toBeGreaterThan(300);
  }, 120_000);

  it("con marca y tiendas, ene–k del cierre es lo vendido guardado × participación atribuido (no la venta real de la marca en la tienda)", async () => {
    desviarParticipacion();
    for (const tiendas of [T01, `${T01},${T03}`]) {
      const t = (
        await leer<TableroApi>(
          await tablero(
            pedir("/tablero", {
              am: AM_A,
              marca: MARCA_X,
              tiendas,
              comparar_id: "ninguna",
            })
          )
        )
      ).data;
      const real = fila(t, `real_${Y}`);
      const cierre = fila(t, `cierre_${Y}`);
      expect(real?.exactitud).toBe("exacto");
      expect(cierre?.exactitud).toBe("estimado");
      expect(t.kpis.real_ac_exactitud).toBe("estimado");
      expect(t.atribucion?.mensual).toBe(true);
      // La venta real de la marca en la tienda va solo en `real_*`: el cierre lleva lo guardado × participación (aquí, bastante menos).
      expect(t.kpis.real_ac).toBe(sumaNula(cierre?.meses.slice(0, K) ?? []));
      expect(t.kpis.real_ac).toBeLessThan(0.8 * sumaNula(real?.meses.slice(0, K) ?? []));
      expect(t.kpis.cierre).toBe(t.kpis.real_ac + t.kpis.proyectado_resto);
      expect(t.kpis.proyectado_resto).toBeGreaterThan(0);
      expect(cierre?.meses.every((x) => x !== null)).toBe(true);
    }
  });
});

describe("T3d · piezas puras", () => {
  it("repartirVendidoGuardado: cada mes de enero a k reparte la base del recorte con la venta real del mes, en enteros; de k+1 a diciembre, 0", () => {
    const venta = (id: string, m: number) => (id === "a" ? 30 * m : id === "b" ? 10 * m : 0);
    const r = repartirVendidoGuardado({
      ids: ["a", "b", "c"],
      k: 3,
      mesesBase: [10, 21, 0, 99, 99, 99, 99, 99, 99, 99, 99, 99],
      venta,
    });
    expect(r.get("a")).toEqual([8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.get("b")).toEqual([2, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.get("c")).toEqual(Array(12).fill(0));
    // Un mes sin venta en ninguna tienda no se reparte (queda en «sin atribuir» de ese mes).
    expect(
      repartirVendidoGuardado({
        ids: ["a"],
        k: 1,
        mesesBase: [5],
        venta: () => 0,
      }).get("a")?.[0]
    ).toBe(0);
  });

  it("motivoSinComparada (D6): distingue «es esta misma» de «no hay ninguna»", () => {
    const base = { hayComparada: false, mostradaId: "p1" } as const;
    expect(
      motivoSinComparada({
        ...base,
        hayComparada: true,
        pedida: "por_defecto",
        ultimaAprobadaId: "p2",
      })
    ).toBeNull();
    expect(
      motivoSinComparada({
        ...base,
        pedida: "ninguna",
        ultimaAprobadaId: "p2",
      })
    ).toBe("no_pedida");
    expect(
      motivoSinComparada({
        ...base,
        pedida: "por_defecto",
        ultimaAprobadaId: null,
      })
    ).toBe("sin_aprobada");
    expect(
      motivoSinComparada({
        ...base,
        pedida: "por_defecto",
        ultimaAprobadaId: "p1",
      })
    ).toBe("es_la_ultima_aprobada");
    expect(
      motivoSinComparada({
        ...base,
        pedida: "por_defecto",
        ultimaAprobadaId: "p2",
      })
    ).toBe("comparada_sin_cifras");
  });

  it("GET /tablero trae `sin_comparada`: null con comparada, «no_pedida» y, viendo la última aprobada, «es_la_ultima_aprobada»", async () => {
    const ver = async (q: Consulta) => (await leer<TableroApi>(await tablero(pedir("/tablero", q)))).data;
    const conComparada = await ver({});
    expect(conComparada.comparada?.id).toBe(P_SEGUIMIENTO);
    expect(conComparada.sin_comparada).toBeNull();
    expect((await ver({ comparar_id: "ninguna" })).sin_comparada).toBe("no_pedida");
    const laAprobada = await ver({ proyeccion_id: P_SEGUIMIENTO });
    expect(laAprobada.comparada).toBeNull();
    expect(laAprobada.sin_comparada).toBe("es_la_ultima_aprobada");
  });
});
