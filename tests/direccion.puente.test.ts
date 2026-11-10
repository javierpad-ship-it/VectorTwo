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

import { GET as tablero } from "@/app/api/direccion/tablero/route";
import { ROTULO_MANUAL, armarPuente, ayudaPuente, cifrasVacias, lineaPuente, puentesPorGm, sumarCifras, totalSiguiente, type CifrasPuente } from "@/lib/direccion/puente";
import { vaciarCachesDireccion } from "@/lib/direccion/servicio";
import { GM_CLAVE_RESTO, GM_CLAVE_TOTAL, type ClavePuente, type PorGmSql, type PuenteApi } from "@/lib/direccion/tipos-api";
import { base } from "./direccion.fake-db";
import { AM_A, AM_B, G_HOMBRE, G_MUJER, G_NINO, L1_HU, M_URBANO, P_MOSTRADA, Y } from "./direccion.fixture";
import { lectorDeTablero, montarCaso } from "./direccion.montaje";

/** Ficha 14 · R4: el puente de 2026 a 2027 (§4.4 y §6.1). Sintético. */

const ver = lectorDeTablero(tablero);
beforeEach(() => montarCaso(vaciarCachesDireccion));

const u = (p: PuenteApi, clave: ClavePuente) => lineaPuente(p, clave);
const PASOS: ClavePuente[] = ["fuera_base", "ajuste_base", "nino", "crecimiento", "manual", "otras", "sin_base", "nuevas_anterior", "aperturas", "cierres"];
const SUBTOTALES: ClavePuente[] = ["cierre_en_curso", "base", "mismas_siguiente", "total_siguiente"];

/** Los pasos suman exactamente del cierre al total y cada subtotal repite el acumulado. */
function comprobarCuadre(p: PuenteApi) {
  expect(p.lineas.map((l) => l.clave)).toEqual(["cierre_en_curso", "fuera_base", "ajuste_base", "base", "nino", "crecimiento", "manual", "otras", "sin_base", "mismas_siguiente", "nuevas_anterior", "aperturas", "cierres", "total_siguiente"]);
  let acumulado = u(p, "cierre_en_curso");
  for (const l of p.lineas) {
    if (l.subtotal) {
      expect(l.u, l.clave).toBe(acumulado);
      expect(l.acumulado, l.clave).toBe(acumulado);
      expect(SUBTOTALES).toContain(l.clave);
    } else {
      acumulado += l.u;
      expect(l.acumulado, l.clave).toBe(acumulado);
      expect(PASOS).toContain(l.clave);
    }
    expect(Number.isInteger(l.u), l.clave).toBe(true);
  }
  expect(u(p, "cierre_en_curso") + PASOS.reduce((a, c) => a + u(p, c), 0)).toBe(u(p, "total_siguiente"));
}

const cifras = (extra: Partial<CifrasPuente>): CifrasPuente => ({ ...cifrasVacias(), ...extra });

describe("armarPuente (puro)", () => {
  it("HOMBRE · URBANO del caso: 50 001 − 0 − 2 961 = 47 040 + 753 + 2 390 + 117 + 0 + 0 = 50 300 + 0 + 1 408 + 1 000 = 52 708", () => {
    const p = armarPuente(cifras({ cierre: 50001, fuera_base: 0, B: 47040, B_corr: 47793, propuesto_con_B: 50183, vigente_con_B: 50300, delta_manual: 117, delta_otras: 0, aperturas: 1408, cierres: 1000 }), Y);
    comprobarCuadre(p);
    expect(PASOS.map((c) => u(p, c))).toEqual([0, -2961, 753, 2390, 117, 0, 0, 0, 1408, 1000]);
    expect(SUBTOTALES.map((c) => u(p, c))).toEqual([50001, 47040, 50300, 52708]);
    expect(p.pct.nino).toBeCloseTo((47793 / 47040 - 1) * 100, 9);
    expect(p.pct.crecimiento).toBeCloseTo(5.0, 1);
    expect(p.pct.total_vs_cierre).toBeCloseTo((52708 / 50001 - 1) * 100, 9);
    expect(p.pct.base_sobre_real).toBeCloseTo((47040 / 50001 - 1) * 100, 9);
    expect(p.lineas[0].etiqueta).toBe("2026 cierre, todas las tiendas");
    expect(p.lineas[3].etiqueta).toBe("Base 2027 (B): 2026 de las mismas tiendas de 2027");
    expect(p.lineas[13].etiqueta).toBe("2027");
  });

  it("la base corregida trae decimales: se redondea una vez y los pasos siguen sumando exacto en enteros", () => {
    const p = armarPuente(cifras({ cierre: 1000, B: 900, B_corr: 913.49, propuesto_con_B: 960, vigente_con_B: 975, delta_manual: 10, delta_otras: 5 }), Y);
    comprobarCuadre(p);
    expect(u(p, "nino")).toBe(13);
    expect(u(p, "crecimiento")).toBe(960 - 913);
    expect(u(p, "total_siguiente")).toBe(975);
  });

  it("sin base (método anterior): la base es 0, la línea del Niño es 0 con % nulo y todo va en «sin base»", () => {
    const p = armarPuente(cifras({ cierre: 800, B: null, B_corr: null, vigente_sin_B: 850, aperturas: 20 }), Y);
    comprobarCuadre(p);
    expect(u(p, "base")).toBe(0);
    expect(u(p, "ajuste_base")).toBe(-800);
    expect(u(p, "nino")).toBe(0);
    expect(u(p, "sin_base")).toBe(850);
    expect(u(p, "total_siguiente")).toBe(870);
    expect(p.pct).toMatchObject({ base_sobre_real: null, nino: null, crecimiento: null, manual: null, otras: null });
    expect(p.pct.total_vs_cierre).toBeCloseTo(8.75, 9);
  });

  it("tiendas de 2026 que no entran a la base se restan en su propia línea; las abiertas en 2026 vuelven en 2027", () => {
    const p = armarPuente(cifras({ cierre: 1000, fuera_base: 120, B: 880, B_corr: 880, propuesto_con_B: 900, vigente_con_B: 900, nuevas_anterior: 150 }), Y);
    comprobarCuadre(p);
    expect(u(p, "fuera_base")).toBe(-120);
    expect(u(p, "ajuste_base")).toBe(0);
    expect(u(p, "nuevas_anterior")).toBe(150);
    expect(totalSiguiente(cifras({ vigente_con_B: 900, nuevas_anterior: 150 }))).toBe(1050);
  });

  it("cada línea lleva su ayuda; «Fijado a mano» es solo lo que fijó una persona (lo de la IA va en «Otras diferencias»)", () => {
    const p = armarPuente(cifras({ cierre: 10, B: 10, B_corr: 10, propuesto_con_B: 10, vigente_con_B: 10 }), Y);
    const ayudas = ayudaPuente(Y);
    for (const l of p.lineas) expect(l.ayuda).toBe(ayudas[l.clave]);
    const manual = p.lineas.find((l) => l.clave === "manual");
    expect(manual?.etiqueta).toBe(`+ ${ROTULO_MANUAL}`);
    expect(ROTULO_MANUAL).toBe("Fijado a mano");
    expect(manual?.ayuda).toContain("a mano");
    expect(p.lineas.find((l) => l.clave === "otras")?.ayuda).toContain("por IA");
  });
});

describe("puentesPorGm (puro)", () => {
  const gm = (g: string, m: string, y: Partial<PorGmSql["Y"]>, y1: Partial<PorGmSql["Y1"]>): PorGmSql => ({
    g,
    m,
    Y: { cierre: 0, base: 0, fuera_base_exacto: 0, base_meses: new Array(12).fill(0), base_meses_sin_nino: new Array(12).fill(0), ...y },
    Y1: { B: null, B_corr: null, propuesto_con_B: 0, vigente_con_B: 0, vigente_sin_B: 0, delta_manual: 0, delta_otras: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0, ...y1 },
  });
  const nombre = (g: string, m: string) => `${g === G_HOMBRE ? "HOMBRE" : g === G_MUJER ? "MUJER" : "NIÑO"} · ${m === M_URBANO ? "URBANO" : "OTRO"}`;

  it("una fila por GM de la matriz, la del Resto (los demás géneros juntos) y el Total al final, que es la suma línea a línea", () => {
    const porGm = [
      gm(G_HOMBRE, M_URBANO, { cierre: 1000 }, { B: 900, B_corr: 913.49, propuesto_con_B: 960, vigente_con_B: 975, delta_manual: 15, total: 975 }),
      gm(G_MUJER, M_URBANO, { cierre: 500 }, { B: 480, B_corr: 480.49, propuesto_con_B: 500, vigente_con_B: 500, total: 500 }),
      gm(G_NINO, M_URBANO, { cierre: 200 }, { B: 200, B_corr: 200, propuesto_con_B: 210, vigente_con_B: 210, total: 210 }),
      gm(G_NINO, "otro-mundo", { cierre: 50 }, { vigente_sin_B: 60, total: 60 }),
    ];
    const puentes = puentesPorGm(porGm, new Set([G_HOMBRE, G_MUJER]), nombre, Y);
    expect(puentes.map((p) => p.gm_clave)).toEqual([`${G_HOMBRE}|${M_URBANO}`, `${G_MUJER}|${M_URBANO}`, GM_CLAVE_RESTO, GM_CLAVE_TOTAL]);
    expect(puentes.map((p) => p.nombre)).toEqual(["HOMBRE · URBANO", "MUJER · URBANO", "Resto", "Total"]);
    for (const p of puentes) comprobarCuadre(p);
    const total = puentes[3];
    for (const clave of [...PASOS, ...SUBTOTALES]) expect(u(total, clave), clave).toBe(u(puentes[0], clave) + u(puentes[1], clave) + u(puentes[2], clave));
    expect(u(total, "total_siguiente")).toBe(975 + 500 + 210 + 60);
    // El Resto junta sus dos GM: uno con base y otro sin base.
    expect(u(puentes[2], "sin_base")).toBe(60);
    expect(u(puentes[2], "base")).toBe(200);
  });

  it("sin géneros fuera de la matriz no hay fila del Resto; `sumarCifras` trata la base nula como «sin base»", () => {
    const puentes = puentesPorGm([gm(G_HOMBRE, M_URBANO, { cierre: 10 }, { B: 10, B_corr: 10, propuesto_con_B: 10, vigente_con_B: 10, total: 10 })], new Set([G_HOMBRE, G_MUJER]), nombre, Y);
    expect(puentes.map((p) => p.gm_clave)).toEqual([`${G_HOMBRE}|${M_URBANO}`, GM_CLAVE_TOTAL]);
    expect(sumarCifras([cifras({ B: null }), cifras({ B: null })]).B).toBeNull();
    expect(sumarCifras([cifras({ B: 5, B_corr: 5.5 }), cifras({ B: null })])).toMatchObject({ B: 5, B_corr: 5.5 });
  });
});

describe("R4 · el puente del caso de §6.1 (sobre la base falsa)", () => {
  it("total: 78 501 − 0 − 2 961 = 75 540 + 753 + 4 670 + 1 343 + 0 + 0 = 82 306 + 0 + 1 408 + 1 000 = 84 714; por GM suma el total", async () => {
    const t = await ver();
    const [hu, mu, total] = t.puente.por_gm;
    expect(t.puente.por_gm.map((p) => p.nombre)).toEqual(["HOMBRE · URBANO", "MUJER · URBANO", "Total"]);
    for (const p of t.puente.por_gm) comprobarCuadre(p);
    expect(SUBTOTALES.map((c) => u(total, c))).toEqual([78501, 75540, 82306, 84714]);
    expect(PASOS.map((c) => u(total, c))).toEqual([0, -2961, 753, 4670, 1343, 0, 0, 0, 1408, 1000]);
    expect(PASOS.map((c) => u(hu, c))).toEqual([0, -2961, 753, 2390, 117, 0, 0, 0, 1408, 1000]);
    expect(PASOS.map((c) => u(mu, c))).toEqual([0, 0, 0, 2280, 1226, 0, 0, 0, 0, 0]);
    for (const clave of [...PASOS, ...SUBTOTALES]) expect(u(hu, clave) + u(mu, clave), clave).toBe(u(total, clave));
    // Parte del cierre del año en curso y llega al total del año siguiente de las tarjetas.
    expect(u(total, "cierre_en_curso")).toBe(t.kpis.cierre);
    expect(u(total, "total_siguiente")).toBe(t.kpis.siguiente);
    // Sin filtros, el puente del recorte es el del total.
    expect(t.puente.recorte).toEqual({ lineas: total.lineas, pct: total.pct });
    expect(t.decidir.lineas[1]).toBe("El aumento de 6,213 u sale de: crecimiento declarado +4,670, fijado a mano +1,343, aperturas +1,408, venta de 2027 de tiendas que cierran +1,000, corrección del Niño +753, menos 2,961 de tiendas que salen de la base.");
  });

  it("el puente del recorte se arma con las cifras del recorte y no existe con tiendas o bloque", async () => {
    const a = await ver({ generos: G_HOMBRE, mundo_id: M_URBANO, am: AM_A });
    const p = a.puente.recorte as PuenteApi;
    comprobarCuadre(p);
    // AM-A de HOMBRE · URBANO: L1 (25 000) y L2 (9 000) más la apertura T12 (1 408); el cierre de T04 es de AM-B.
    expect(u(p, "mismas_siguiente")).toBe(34000);
    expect(u(p, "aperturas")).toBe(1408);
    expect(u(p, "cierres")).toBe(0);
    expect(u(p, "total_siguiente")).toBe(a.kpis.siguiente);
    expect(u(p, "cierre_en_curso")).toBe(a.kpis.cierre);
    expect(u(p, "manual")).toBe(117);
    const b = await ver({ generos: G_HOMBRE, mundo_id: M_URBANO, am: AM_B });
    expect(u(b.puente.recorte as PuenteApi, "cierres")).toBe(1000);
    expect((await ver({ generos: G_HOMBRE, mundo_id: M_URBANO, bloque: "mismas" })).puente.recorte).toBeNull();
    // El puente por GM no depende del recorte.
    expect(a.puente.por_gm).toEqual((await ver()).puente.por_gm);
  });

  it("variante (I-C): si la propuesta de una fila aceptada tal cual cambia al recalcular (12 000 → 12 300), la diferencia va a «Otras diferencias», no a «Fijado a mano»", async () => {
    const fila = (base.tablas.proyeccion_filas ?? []).find((f) => f.proyeccion_id === P_MOSTRADA && f.clave === `|${L1_HU}||${AM_B}`);
    const registro = (base.tablas.proyeccion_fila_anios ?? []).find((a) => a.fila_id === fila?.id && a.anio === Y + 1);
    if (!registro) throw new Error("falta el registro");
    registro.propuesto = 12300;
    const t = await ver();
    const total = t.puente.por_gm[2];
    comprobarCuadre(total);
    expect(u(total, "crecimiento")).toBe(4970);
    expect(u(total, "otras")).toBe(-300);
    expect(u(total, "manual")).toBe(1343);
    expect(u(total, "total_siguiente")).toBe(84714);
    expect(u(total, "manual") + u(total, "otras")).toBe(82306 - (4970 + 753 + 75540));
    const cambio = t.alertas.find((a) => a.codigo === "propuesta_cambio");
    expect(cambio?.cifras.n).toBe(1);
    expect(cambio?.nivel).toBe("info");
    expect(t.decidir.lineas[1]).toContain("menos 300 de otras diferencias con la propuesta");
  });
});
