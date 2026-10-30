import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { huellaTemporada } from "@/lib/curvas/huellas";
import { estadoFalso } from "./curvas.fake-db";
import { estado as base, reiniciar, sembrar, type Fila } from "./proyeccion.fake-db";
import { aprobarCrecimientosFalsos, contexto, efectoNinoFalso, periodoFalso, reiniciarContexto } from "./proyeccion.contexto-falso";

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
import { GET as leerFactores, PUT as guardarFactores } from "@/app/api/proyeccion/factores/route";
import { POST as sincronizar } from "@/app/api/proyeccion/factores/sincronizar/route";
import { GET as cerrada } from "@/app/api/proyeccion/cerrada/route";
import { calcularProyeccion } from "@/lib/proyeccion/calculo";
import { avanceAcumulado } from "@/lib/proyeccion/cierre";
import { estadosFactoresDeY, equivalenciasConTemporadaCambiada, motivosDesactualizada, temporadasDeEquivalencias, type EstadoActual, type ProyeccionParaEstado } from "@/lib/proyeccion/desactualizado";
import { ninoPorGM } from "@/lib/proyeccion/calculo";
import { correccionMaterial } from "@/lib/proyeccion/factor-nino";
import { aFactorApi, aplicadoAtDe, diagnosticoDe } from "@/lib/proyeccion/servicio-base";
import { normalizar } from "@/lib/proyeccion/nino";
import { proponerSiguiente } from "@/lib/proyeccion/siguiente";
import { maduroDeVigente, proponerFilaTienda, rampaMensual, sumaCurva } from "@/lib/proyeccion/tiendas-nuevas";
import { VERSION_METODO, type FactorApi, type FilaModelo, type ProyeccionApi, type RespuestaProyeccionApi, type SobreBase } from "@/lib/proyeccion/tipos";
import { matrizDeCeldas, claveGM } from "@/lib/proyeccion/crecimientos";
import { AG, AM, CURVA_INVIERNO, CURVA_PLANA, CURVA_VERANO, EQ, GEN, MUN, N, Y, clave, construirVenta, entrada, hechosBase, tiendas as tiendasFixture } from "./proyeccion.fixture";

/**
 * 06e, método 5 (sintético; nada real): la base corregida del Niño `B'` y el % «sobre 2026 corregido» (R1 a R3, R6, R7), qué GM tienen Niño material (R15), el factor
 * de `Y` al día y confirmado para cerrar (R16, R24), 2027 sin Niño (R25 de cierre), el cambio de método (R18), decidir sin releer factores (R19) y el cambio de
 * temporada de una equivalencia (R29).
 */

// ─── Utilidades de las rutas ───

const URL_BASE = "http://localhost/api/proyeccion";
const get = (ruta: string, consulta = "") => new NextRequest(`${URL_BASE}${ruta}${consulta}`);
const enviar = (metodo: string, ruta: string, cuerpo: unknown = {}) =>
  new NextRequest(`${URL_BASE}${ruta}`, { method: metodo, body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } });
const leer = async <T = unknown>(r: Response) => (await r.json()) as { data: T; error?: string; codigo?: string; detalle?: Record<string, unknown> } & Record<string, unknown>;
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const filasDe = (tabla: string): Fila[] => base.tablas[tabla] ?? [];
const proyecciones = () => filasDe("proyecciones");
const idFila = (c: string) => filasDe("proyeccion_filas").find((f) => f.clave === c)?.id as string;
const registro = (c: string, anio: number) => filasDe("proyeccion_fila_anios").find((a) => a.fila_id === idFila(c) && a.anio === anio) as Fila;
const DENIM_REC = `|${N.denim}||${AM.rec}`;
const ABRIGO_REC = `|${N.abrigo}|${EQ.parka}|${AM.rec}`;
const SANDALIA_VAL = `|${N.sandalia}||${AM.val}`;

async function nueva(nombre = "Proyección 2026–2027") {
  const r = await crear(enviar("POST", "/proyecciones", { nombre, parametros: { crecimiento_pct_defecto: 5 } }));
  const cuerpo = await leer<ProyeccionApi>(r);
  expect(r.status, JSON.stringify(cuerpo)).toBe(201);
  return cuerpo.data.id;
}
const leerProy = async (id: string) => (await leer<ProyeccionApi>(await leerUna(get("/p"), ctx(id)))).data;
const recalcular = async (id: string) => expect((await calcular(enviar("POST", "/x"), ctx(id))).status).toBe(201);
const cerrarConQuery = (id: string, query = "") => cerrar(new NextRequest(`${URL_BASE}/x${query}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), ctx(id));

/** Decide lo grande (como pide cerrar) para que lo único que falte, si falta algo, sea lo del Niño o los crecimientos. */
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

const COMPOSICION_HOY = huellaTemporada([]);
/** Un factor de 2026 al día y confirmado (lo que Javier deja tras sincronizar y escribir el valor). */
const FACTOR_AL_DIA = {
  calculado_at: "2026-10-14T10:00:00.000Z",
  formula: "relativo_periodo",
  huella_cargas: "huella-de-prueba",
  huella_composicion: COMPOSICION_HOY,
  parcial: true,
  meses_comparados: 9,
  aplicado_huella: "huella-de-prueba",
};

beforeEach(() => {
  reiniciar();
  reiniciarContexto();
  estadoFalso.rol = "planner";
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

// ─── R1 a R3: la fórmula del año siguiente ───

/** Generador determinista (mulberry32): la propiedad no depende del azar entre corridas. */
function azar(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("R1: sin Niño en Y el método 5 da la misma cifra que el 4, fila por fila", () => {
  it("propiedad: con φ_Y ≡ 1, para cualquier g, curva y aportes, P, meses y B son iguales y B' = B", () => {
    const rnd = azar(2027);
    const curvas = [CURVA_PLANA, CURVA_INVIERNO, CURVA_VERANO];
    for (let i = 0; i < 200; i++) {
      const meses = Array.from({ length: 12 }, () => Math.round(rnd() * 400));
      const aportes = Array.from({ length: Math.floor(rnd() * 3) }, () => {
        const m = Array.from({ length: 12 }, () => Math.round(rnd() * 30));
        return { signo: rnd() < 0.5 ? (1 as const) : (-1 as const), total: m.reduce((a, b) => a + b, 0), meses: m };
      });
      const objetivo = Array.from({ length: 12 }, () => (rnd() < 0.3 ? 0.5 + rnd() : 1));
      const e = {
        baseVigente: meses.reduce((a, b) => a + b, 0),
        mesesBase: meses,
        aportesTiendas: aportes,
        factoresMesEnCurso: Array(12).fill(1),
        crecimiento: Math.round((rnd() * 80 - 20) * 100) / 100,
        curva: curvas[i % 3],
        factoresMesObjetivo: objetivo,
      };
      const nuevo = proponerSiguiente({ ...e, sobreBase: "corregida" });
      const viejo = proponerSiguiente({ ...e, sobreBase: "bruta" });
      expect(nuevo.propuesto, `caso ${i}`).toBe(viejo.propuesto);
      expect(nuevo.meses, `caso ${i}`).toEqual(viejo.meses);
      expect(nuevo.base, `caso ${i}`).toBe(viejo.base);
      expect(nuevo.base_corregida, `caso ${i}`).toBe(nuevo.base);
    }
  });

  it("en el cálculo completo: sin factores (φ ≡ 1) toda fila base de Y+1 da lo mismo con el % corregido que con el bruto", () => {
    const celdas: [string, string, number][] = [[GEN.hombre, MUN.urbano, 12], [GEN.hombre, MUN.casual, -10], [GEN.mujer, MUN.casual, 33]];
    const matriz = (sobre: SobreBase) => ({
      ...matrizDeCeldas(celdas.map(([genero_id, mundo_id, pct]) => ({ genero_id, mundo_id, pct })), [GEN.hombre, GEN.mujer]),
      sobre: new Map(celdas.map(([g, m]) => [claveGM(g, m), sobre] as const)),
      resto: { id: null, version: null, sobre_base: sobre },
    });
    const a = calcularProyeccion(entrada({ factores: [], crecimientos: matriz("corregida") }));
    const b = calcularProyeccion(entrada({ factores: [], crecimientos: matriz("bruta") }));
    const cifras = (s: typeof a) => s.filas.flatMap((f) => f.registros.map((r) => [f.clave, r.anio, r.propuesto, r.meses, r.base_siguiente]));
    expect(cifras(a)).toEqual(cifras(b));
    // Sin Niño material no hay GM «con Niño» y B' = B en toda fila base.
    expect(a.resumen.gm_con_nino).toEqual([]);
    for (const f of a.filas.filter((x) => x.tienda_id === null)) {
      const r = f.registros.find((x) => x.anio === Y + 1);
      if (r?.base_siguiente != null) expect(r.base_normalizada).toBe(r.base_siguiente);
    }
  });
});

describe("R2 y los ejemplos B y C de la ficha", () => {
  it("B: ABRIGO × RECONOCIDO (invierno, φ = 0,80 constante) 15 000 + T10 300 → B' = 19 125 → 20 655 (+35,0 % sobre real); POLO (todo el año) 40 000 + 800 → 44 064; el GM da 64 719", () => {
    const curva = CURVA_PLANA;
    const abrigo = proponerSiguiente({ baseVigente: 15000, mesesBase: Array(12).fill(1250), aportesTiendas: [{ signo: 1, total: 300, meses: Array(12).fill(25) }], factoresMesEnCurso: Array(12).fill(0.8), crecimiento: 8, curva, factoresMesObjetivo: Array(12).fill(1) });
    expect(abrigo.base).toBe(15300);
    expect(abrigo.base_corregida).toBeCloseTo(19125, 8);
    expect(abrigo.propuesto).toBe(20655);
    expect((20655 / 15300 - 1) * 100).toBeCloseTo(35.0, 1);
    const polo = proponerSiguiente({ baseVigente: 40000, mesesBase: Array(12).fill(3333.33), aportesTiendas: [{ signo: 1, total: 800, meses: Array(12).fill(66.67) }], factoresMesEnCurso: Array(12).fill(1), crecimiento: 8, curva, factoresMesObjetivo: Array(12).fill(1) });
    expect(polo.base).toBe(40800);
    expect(polo.propuesto).toBe(44064);
    expect((abrigo.propuesto as number) + (polo.propuesto as number)).toBe(64719);
    // Con el método 4 (bruta) el mismo 8 % daba 16 524 + 44 064 = 60 588.
    const viejo = proponerSiguiente({ baseVigente: 15000, mesesBase: Array(12).fill(1250), aportesTiendas: [{ signo: 1, total: 300, meses: Array(12).fill(25) }], factoresMesEnCurso: Array(12).fill(0.8), crecimiento: 8, curva, factoresMesObjetivo: Array(12).fill(1), sobreBase: "bruta" });
    expect((viejo.propuesto as number) + (polo.propuesto as number)).toBe(60588);
  });

  it("C: verano con φ solo de setiembre a diciembre (1,50): B = 12 000, B' = 10 000 → 10 800 al 8 %, que es −10,0 % sobre 2026 real", () => {
    const phi = [...Array(8).fill(1), 1.5, 1.5, 1.5, 1.5];
    // ene–ago 6 000 (750 al mes), setiembre real 1 500, oct–dic 4 500 (1 500 al mes, ya × 1,50).
    const meses = [...Array(8).fill(750), 1500, 1500, 1500, 1500];
    const r = proponerSiguiente({ baseVigente: 12000, mesesBase: meses, aportesTiendas: [], factoresMesEnCurso: phi, crecimiento: 8, curva: CURVA_VERANO, factoresMesObjetivo: Array(12).fill(1) });
    expect(r.base).toBe(12000);
    expect(r.base_corregida).toBeCloseTo(6000 + 1000 + 3000, 8);
    expect(r.propuesto).toBe(10800);
    expect((10800 / 12000 - 1) * 100).toBeCloseTo(-10.0, 8);
  });

  it("φ_{Y+1} cambia el reparto y no P", () => {
    const e = { baseVigente: 15000, mesesBase: Array(12).fill(1250), aportesTiendas: [], factoresMesEnCurso: Array(12).fill(0.8), crecimiento: 8, curva: CURVA_VERANO };
    const sin = proponerSiguiente({ ...e, factoresMesObjetivo: Array(12).fill(1) });
    const con = proponerSiguiente({ ...e, factoresMesObjetivo: [...Array(8).fill(1), 0.5, 0.5, 0.5, 0.5] });
    expect(con.propuesto).toBe(sin.propuesto);
    expect(con.meses).not.toEqual(sin.meses);
  });
});

describe("R6: tienda maduro_propio de Y+1", () => {
  it("A' = vigente ÷ Σ c r φ_Y: con φ_Y = 1 coincide con A^b; con Niño de 0,70, A' > A^b; P = round(A' × (1 + g) × Σ_{Y+1} c r)", () => {
    const rY = rampaMensual("2026-05-01", [1, 1, 1], 2026);
    const rSig = rampaMensual("2026-05-01", [1, 1, 1], 2027);
    const phi = Array.from({ length: 12 }, (_, i) => (i >= 4 ? 0.7 : 1));
    const unos = Array(12).fill(1);
    const vigente = 1000;
    expect(maduroDeVigente({ vigente, curva: CURVA_INVIERNO, rampa: rY, phi: unos })).toBeCloseTo(maduroDeVigente({ vigente, curva: CURVA_INVIERNO, rampa: rY, phi: unos, sobreBase: "bruta" }) as number, 10);
    const corregida = maduroDeVigente({ vigente, curva: CURVA_INVIERNO, rampa: rY, phi }) as number;
    const bruta = maduroDeVigente({ vigente, curva: CURVA_INVIERNO, rampa: rY, phi, sobreBase: "bruta" }) as number;
    expect(corregida).toBeCloseTo(vigente / sumaCurva(CURVA_INVIERNO, rY, phi, 0, 12), 10);
    expect(corregida).toBeGreaterThan(bruta);
    const propia = (maduroPrevio: number) =>
      proponerFilaTienda({ esAnioEnCurso: false, k: 0, subbloque: "nuevas_anterior", nCompletos: 0, real: Array(12).fill(0), curva: CURVA_INVIERNO, rampa: rSig, phi: unos, maduras: null, maduroPrevio, crecimiento: 10 });
    const p = propia(corregida);
    expect(p.metodo).toBe("maduro_propio");
    expect(p.propuesto).toBe(Math.round(corregida * 1.1 * sumaCurva(CURVA_INVIERNO, rSig, null, 0, 12)));
    expect(propia(corregida).propuesto as number).toBeGreaterThan(propia(bruta).propuesto as number);
  });
});

// ─── R7: la base corregida es el total normalizado del cierre ───

describe("R7: en una fila base sin aportes, con método avance y sin decidir en Y, |B' − T'| ≤ 1 u", () => {
  // Solo vende T1 (y el CD, que no cuenta): las tiendas nuevas no aportan nada a la base y no sale ninguna con venta.
  const s = calcularProyeccion(entrada({ hechos: hechosBase().filter((h) => h.tienda === "T1" || h.tienda === "CD") }));
  const filaBase = (c: string) => s.filas.find((f) => f.clave === c) as FilaModelo;

  it("ABRIGO (invierno, φ constante 0,66) y SANDALIA (verano, φ solo de set a dic): B' = T' del cierre", () => {
    for (const c of [clave("abrigo", AM.rec, EQ.parka), clave("sandalia", AM.val)]) {
      const f = filaBase(c);
      const regY = f.registros.find((r) => r.anio === Y)!;
      const regSig = f.registros.find((r) => r.anio === Y + 1)!;
      // Sin aportes ni salientes: B es la vigente de Y de la fila.
      expect(f.historico?.salientes).toEqual([]);
      expect(regSig.base_siguiente).toBe(regY.vigente);
      expect(regY.metodo).toBe("avance");
      expect(regY.decidido).toBeNull();
      const phi = f.factores_mes?.[Y] as number[];
      const real = (regY.meses as number[]).map((m, i) => (i < 9 ? m : 0));
      const tNormalizado = normalizar(real, phi).reduce((a, b) => a + b, 0) / avanceAcumulado(f.curva as number[], 9);
      expect(Math.abs(Number(regSig.base_normalizada) - tNormalizado), c).toBeLessThanOrEqual(1);
      // Y el cierre real de Y no cambió (el factor no mueve el paso 1).
      expect(regSig.base_siguiente).toBe(regY.propuesto);
    }
  });
});

// ─── R15: GM con Niño material ───

describe("R15: gm_con_nino lista exactamente los GM (y el Resto) con correccionMaterial(Σ B, Σ B')", () => {
  const fila = (gml: string, b: number, bc: number | null) => ({ gml_id: gml, base_siguiente: b, base_normalizada: bc, vendido: 10 });
  const claveDe = (gml: string) => (gml === "x" ? "g|m" : gml === "y" ? "g|n" : gml === "z" ? "resto" : null);

  it("un GM al +0,49 % no entra y uno al +0,50 % sí; el Resto con la misma regla; una fila desconocida no cuenta", () => {
    const r = ninoPorGM([fila("x", 100000, 100490), fila("y", 100000, 100500), fila("z", 100000, 100500), fila("w", 5, 500)], claveDe);
    expect(r.gm_con_nino).toEqual(["g|n", "resto"]);
    expect(r.gm_correccion_nino_pct["g|n"]).toBeCloseTo(0.5, 8);
    expect(correccionMaterial(100000, 100490)).toBe(false);
    expect(correccionMaterial(100000, 100500)).toBe(true);
    // Una corrección a la baja (verano) también es material.
    expect(ninoPorGM([fila("x", 12000, 10000)], claveDe).gm_con_nino).toEqual(["g|m"]);
  });

  it("una fila con B y sin B' cuenta con B' = B; una fila sin B queda en gm_fuera_base con su venta de Y y fuera de la suma", () => {
    const r = ninoPorGM([fila("x", 1000, null), { gml_id: "x", base_siguiente: null, base_normalizada: null, vendido: 355 }, { gml_id: "z", base_siguiente: null, base_normalizada: null, vendido: 20 }], claveDe);
    expect(r.gm_con_nino).toEqual([]);
    expect(r.gm_fuera_base).toEqual({ "g|m": { filas: 1, unidades: 355 }, resto: { filas: 1, unidades: 20 } });
  });

  it("en el cálculo del fixture: HOMBRE · CASUAL (ABRIGO, invierno) y MUJER · CASUAL (verano) tienen Niño; HOMBRE · URBANO (todo el año) no", () => {
    const s = calcularProyeccion(entrada({ crecimientos: { celdas: new Map(), generos: new Set([GEN.hombre, GEN.mujer]) } }));
    expect(s.resumen.gm_con_nino).toEqual([claveGM(GEN.hombre, MUN.casual), claveGM(GEN.mujer, MUN.casual)].sort());
    expect(s.resumen.gm_correccion_nino_pct?.[claveGM(GEN.hombre, MUN.casual)]).toBeGreaterThan(50);
    // MUJER · CASUAL mezcla SANDALIA (verano: B' < B), MIXTA (invierno y verano) y más: el neto es material.
    expect(Math.abs(s.resumen.gm_correccion_nino_pct?.[claveGM(GEN.mujer, MUN.casual)] as number)).toBeGreaterThan(0.5);
    expect(s.resumen.temporadas_filas).toEqual(["invierno", "verano"]);
    // Una fila sin curva (sin B) queda fuera de la base de su GM.
    const sinCurva = calcularProyeccion(entrada({ vigentes: entrada().vigentes.filter((v) => v.agrupacion_id !== AG.denim), crecimientos: { celdas: new Map(), generos: new Set([GEN.hombre, GEN.mujer]) } }));
    expect(sinCurva.resumen.gm_fuera_base?.[claveGM(GEN.hombre, MUN.urbano)]?.filas).toBeGreaterThan(0);
    expect(sinCurva.resumen.gm_fuera_base?.[claveGM(GEN.hombre, MUN.urbano)]?.unidades).toBeGreaterThan(0);
  });
});

// ─── R29 puro: temporada_cambiada ───

describe("R29: temporada_cambiada", () => {
  const nodo = (agrupacion: string | null) => ({ equivalencias: [{ id: "e1", agrupacion_estacionalidad_id: agrupacion }] });
  const agrs = [
    { id: "inv", temporada: "invierno" },
    { id: "todo", temporada: "todo_el_ano" },
    { id: "todo2", temporada: "todo_el_ano" },
    { id: "ver", temporada: "verano" },
  ];

  it("la foto solo guarda las equivalencias de invierno y verano", () => {
    expect(temporadasDeEquivalencias([{ equivalencias: [{ id: "a", agrupacion_estacionalidad_id: "inv" }, { id: "b", agrupacion_estacionalidad_id: "todo" }, { id: "c", agrupacion_estacionalidad_id: null }, { id: "d", agrupacion_estacionalidad_id: "ver" }] }], agrs)).toEqual({ a: "invierno", d: "verano" });
  });

  it("de una agrupación de invierno a una de todo el año cambia (y al revés); entre dos de todo el año, no; si esa temporada no tiene Niño en Y, tampoco", () => {
    const foto = temporadasDeEquivalencias([nodo("inv")], agrs);
    expect(equivalenciasConTemporadaCambiada(foto, temporadasDeEquivalencias([nodo("todo")], agrs), ["invierno", "verano"])).toEqual(["e1"]);
    expect(equivalenciasConTemporadaCambiada(temporadasDeEquivalencias([nodo("todo")], agrs), temporadasDeEquivalencias([nodo("inv")], agrs), ["invierno"])).toEqual(["e1"]);
    expect(equivalenciasConTemporadaCambiada(temporadasDeEquivalencias([nodo("todo")], agrs), temporadasDeEquivalencias([nodo("todo2")], agrs), ["invierno", "verano"])).toEqual([]);
    expect(equivalenciasConTemporadaCambiada(foto, temporadasDeEquivalencias([nodo("todo")], agrs), ["verano"])).toEqual([]);
    // Sin foto (cálculo de antes) o sin lo de hoy, no se marca nada.
    expect(equivalenciasConTemporadaCambiada(undefined, foto, ["invierno"])).toEqual([]);
    expect(equivalenciasConTemporadaCambiada(foto, undefined, ["invierno"])).toEqual([]);
  });

  it("motivosDesactualizada lo devuelve como temporada_cambiada con las equivalencias", () => {
    const p: ProyeccionParaEstado = {
      calculado_at: "2026-10-10T00:00:00.000Z",
      hasta_periodo: "2026-09",
      resumen: { curvas_usadas: [], temporada_equivalencias: { e1: "invierno" } },
      parametros: { factores_usados: [], bloques: {} },
    };
    const actual: EstadoActual = {
      cargas_publicadas: [],
      ultimo_mes_cerrado: "2026-09",
      curvas_vigentes: [],
      niveles_cambiados: 0,
      tiendas: [],
      factores: [],
      periodos_updated_at: null,
      temporada_equivalencias: {},
      temporadas_con_nino: ["invierno"],
    };
    expect(motivosDesactualizada(p, actual).map((m) => m.codigo)).toEqual(["temporada_cambiada"]);
    expect(motivosDesactualizada(p, { ...actual, temporada_equivalencias: { e1: "invierno" } })).toEqual([]);
  });
});

// ─── Estado de los factores de Y ───

describe("estadosFactoresDeY: ámbito, meses del periodo publicados y estados", () => {
  const periodos = [
    { id: "p1", desde: "2026-01", hasta: "2026-12", motivo: "Niño", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true },
    { id: "p2", desde: "2026-09", hasta: "2026-12", motivo: "Niño", alcance: "invierno" as const, temporadas: ["verano" as const], activo: true },
  ];
  const publicados = Array.from({ length: 9 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const hoy = { huella_cargas: "h9", huella_composicion: { invierno: "ci", verano: "cv" }, periodos, publicados };
  const f = (temporada: string, extra: Record<string, unknown> = {}) => ({
    anio: 2026,
    temporada,
    ratio_calculado: 0.7,
    ratio_aplicado: null,
    calculado_at: "2026-10-01T00:00:00Z",
    formula: "relativo_periodo",
    huella_cargas: "h9",
    huella_composicion: temporada === "invierno" ? "ci" : "cv",
    parcial: true,
    meses_comparados: temporada === "invierno" ? 9 : 1,
    aplicado_huella: null,
    ...extra,
  });

  it("una temporada sin fila es faltante; parcial sin confirmar es sin_confirmar; confirmada, ok; con un mes nuevo publicado, desfasado por meses", () => {
    const sinFila = estadosFactoresDeY({ anioEnCurso: 2026, factores: [f("invierno")], hoy });
    expect(sinFila.map((e) => [e.temporada, e.estado])).toEqual([["invierno", "sin_confirmar"], ["verano", "faltante"]]);
    const ok = estadosFactoresDeY({ anioEnCurso: 2026, factores: [f("invierno", { ratio_aplicado: 0.7, aplicado_huella: "h9" }), f("verano", { ratio_aplicado: 1.5, aplicado_huella: "h9" })], hoy });
    expect(ok.map((e) => e.estado)).toEqual(["ok", "ok"]);
    const mesNuevo = estadosFactoresDeY({ anioEnCurso: 2026, factores: [f("invierno", { ratio_aplicado: 0.7, aplicado_huella: "h9" })], hoy: { ...hoy, huella_cargas: "h10", publicados: [...publicados, "2026-10"] } });
    expect(mesNuevo[0]).toMatchObject({ estado: "desfasado", motivos_desfase: ["cargas", "meses"] });
  });

  it("solo cuentan las temporadas con meses atípicos en Y y con alguna agrupación activa", () => {
    expect(estadosFactoresDeY({ anioEnCurso: 2026, factores: [], hoy, temporadasActivas: new Set(["invierno"]) }).map((e) => e.temporada)).toEqual(["invierno"]);
    expect(estadosFactoresDeY({ anioEnCurso: 2025, factores: [], hoy })).toEqual([]);
  });
});

// ─── R16, R24, R25: el cierre y los factores, por las rutas ───

describe("R25 de cierre: 2027 no es Niño", () => {
  const periodo2027 = { id: "p-2027", desde: "2027-03", hasta: "2027-06", motivo: "Niño 2027", alcance: "invierno" as const, temporadas: ["invierno" as const], activo: true };

  it("con meses atípicos en 2027 calcular funciona, pero cerrar responde 409 anio_siguiente_atipico, también con forzar; quitar la marca lo resuelve", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    contexto.periodosExtra = [periodo2027];
    const id = await nueva();
    await decidirTodo(id);
    const p = await leerProy(id);
    expect(p.cierre_bloqueado_por?.map((b) => b.codigo)).toEqual(["anio_siguiente_atipico"]);
    expect(p.cierre_bloqueado_por?.[0].mensaje).toContain("2027 está marcado como año del Niño");
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      const c = await leer(r);
      expect(c.codigo).toBe("anio_siguiente_atipico");
      expect(c.error).toContain("no puedes cerrar");
      expect(c.detalle).toEqual({ meses: ["2027-03", "2027-04", "2027-05", "2027-06"] });
    }
    expect(proyecciones()[0].estado).toBe("en_trabajo");
    // «Antes de proyectar» lo avisa con el texto nuevo (no bloquea).
    const e = (await leer<RespuestaProyeccionApi>(await estadoInicial())).data;
    expect(e.prerrequisitos.bloquea).toEqual([]);
    expect(e.prerrequisitos.avisa.find((m) => m.codigo === "anio_siguiente_atipico")?.mensaje).toBe(
      "2027 está marcado como año del Niño: puedes calcular, pero no aprobar crecimientos de 2027 ni cerrar hasta quitar la marca o decidir cómo modelarlo."
    );
    contexto.periodosExtra = [];
    expect((await leerProy(id)).cierre_bloqueado_por).toBeNull();
    expect((await cerrarConQuery(id)).status).toBe(200);
  });
});

describe("R16: factor de Y faltante, desfasado o sin confirmar bloquea el cierre, también con forzar", () => {
  it("factor_faltante: sin el factor de verano 2026 la base de 2027 no se corrige; escribirlo y recalcular lo resuelve", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const conTodos = contexto.factores;
    contexto.factores = conTodos.filter((f) => !(f.anio === 2026 && f.temporada === "verano"));
    const id = await nueva();
    await decidirTodo(id);
    expect((await leerProy(id)).cierre_bloqueado_por?.map((b) => b.codigo)).toEqual(["factor_faltante"]);
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      const c = await leer(r);
      expect(c.codigo).toBe("factor_faltante");
      expect(c.error).toBe("Falta el factor del Niño de verano 2026: sin él la base de 2027 no se corrige. Escríbelo en Factores del Niño (1,00 si no hubo efecto) y recalcula.");
      expect(c.detalle).toEqual({ faltan: [{ anio: 2026, temporada: "verano" }] });
    }
    contexto.factores = conTodos;
    // El factor nuevo cambia lo que se aplicó: queda desactualizada por factores_cambiados (de Y: no se fuerza) hasta recalcular.
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["factores_cambiados"]);
    expect((await leer(await cerrarConQuery(id, "?forzar=1"))).codigo).toBe("factores_cambiados");
    await recalcular(id);
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("factor_desfasado: calculado con otras cargas (o con la fórmula anterior); se arregla sincronizando; GET factores dice el estado y los motivos", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, huella_cargas: "cargas-de-setiembre", ratio_aplicado: 0.66 };
    const id = await nueva();
    await decidirTodo(id);
    const f = (await leer<FactorApi[]>(await leerFactores())).data.find((x) => x.anio === 2026 && x.temporada === "invierno");
    expect(f).toMatchObject({ estado: "desfasado", motivos_desfase: ["cargas"] });
    for (const query of ["", "?forzar=1"]) {
      const c = await leer(await cerrarConQuery(id, query));
      expect(c.codigo).toBe("factor_desfasado");
      expect(c.error).toContain("El factor de invierno 2026");
      expect(c.error).toContain("Sincronizar");
    }
    const e = (await leer<RespuestaProyeccionApi>(await estadoInicial())).data;
    expect(e.prerrequisitos.avisa.map((m) => m.codigo)).toContain("factor_desfasado");
    // La fórmula anterior (formula null) también es desfase.
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, formula: null, ratio_aplicado: 0.66 };
    expect((await leer<FactorApi[]>(await leerFactores())).data.find((x) => x.anio === 2026 && x.temporada === "invierno")?.motivos_desfase).toEqual(["formula"]);
    // Al día y confirmado: cierra.
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, ratio_aplicado: 0.66 };
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("factor_sin_confirmar: parcial, al día, pero sin ratio_aplicado escrito sobre el cálculo de hoy; el mismo valor lo confirma", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, aplicado_huella: null };
    const id = await nueva();
    await decidirTodo(id);
    expect((await leer<FactorApi[]>(await leerFactores())).data.find((x) => x.anio === 2026 && x.temporada === "invierno")).toMatchObject({ estado: "sin_confirmar", motivos_desfase: [] });
    for (const query of ["", "?forzar=1"]) {
      const c = await leer(await cerrarConQuery(id, query));
      expect(c.codigo).toBe("factor_sin_confirmar");
      expect(c.error).toBe("El factor de invierno 2026 (0.66) es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Factores del Niño (el mismo valor lo confirma).");
    }
    // Un aplicado confirmado contra OTRA huella de cargas tampoco vale.
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, ratio_aplicado: 0.66, aplicado_huella: "otra" };
    expect((await leer(await cerrarConQuery(id))).codigo).toBe("factor_sin_confirmar");
    contexto.factoresExtra["2026#invierno"] = { ...FACTOR_AL_DIA, ratio_aplicado: 0.66 };
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("factores_cambiados de Y no se fuerza; el de otro año (2023) sí", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    await decidirTodo(id);
    // Cambia el factor de 2023: forzable.
    contexto.factores = contexto.factores.map((f) => (f.anio === 2023 && f.temporada === "invierno" ? { ...f, ratio_aplicado: 0.5 } : f));
    const p = await leerProy(id);
    expect(p.desactualizada.map((m) => m.codigo)).toEqual(["factores_cambiados"]);
    expect(p.cierre_bloqueado_por).toBeNull();
    expect((await leer(await cerrarConQuery(id))).codigo).toBe("desactualizada");
    // Cambia además el de 2026: ya no se fuerza.
    contexto.factores = contexto.factores.map((f) => (f.anio === 2026 && f.temporada === "invierno" ? { ...f, ratio_aplicado: 0.7 } : f));
    expect((await leerProy(id)).cierre_bloqueado_por?.map((b) => b.codigo)).toEqual(["factores_cambiados"]);
    const forzada = await cerrarConQuery(id, "?forzar=1");
    expect(forzada.status).toBe(409);
    const c = await leer(forzada);
    expect(c.codigo).toBe("factores_cambiados");
    expect(c.error).toContain("invierno 2026");
    expect(c.error).toContain("no se puede forzar");
    await recalcular(id);
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("reaprobar: una vigente bruta de un GM con Niño material no cierra ni forzando; una bruta de un GM sin Niño sí (R17); reaprobar y recalcular lo resuelve", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5, sobre: { "HOMBRE · CASUAL": "bruta", "HOMBRE · URBANO": "bruta" } });
    const id = await nueva();
    await decidirTodo(id);
    const p = await leerProy(id);
    const rea = p.crecimientos_sin_aprobar?.reaprobar ?? [];
    expect(rea).toHaveLength(1);
    expect(rea[0]).toMatchObject({ clave: `${GEN.hombre}.${MUN.casual}`, nombre: "HOMBRE · CASUAL", version: 1 });
    expect(rea[0].correccion_pct).toBeGreaterThan(50);
    expect(p.resumen?.gm_con_nino).toContain(`${GEN.hombre}|${MUN.casual}`);
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      const c = await leer(r);
      expect(c.codigo).toBe("crecimientos_sin_aprobar");
      expect(c.error).toContain("HOMBRE · CASUAL v1 se aprobó sobre 2026 real antes de 0.14.0");
      expect((c.detalle as { reaprobar: { nombre: string }[] }).reaprobar.map((x) => x.nombre)).toEqual(["HOMBRE · CASUAL"]);
    }
    // Reaprobar = una versión nueva corregida del mismo GM; la proyección pide recalcular y cierra.
    const v1 = filasDe("crecimientos_genero_mundo").find((g) => g.genero_id === GEN.hombre && g.mundo_id === MUN.casual) as Fila;
    v1.estado = "reemplazada";
    sembrar("crecimientos_genero_mundo", [{ ...v1, id: undefined, version: 2, estado: "vigente", sobre_base: "corregida", pct: 5 }]);
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["crecimientos_cambiados"]);
    await recalcular(id);
    const despues = await leerProy(id);
    expect(despues.crecimientos_sin_aprobar).toBeNull();
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
  });

  it("el orden: anio_siguiente_atipico, factor_faltante y luego los de crecimientos (cada uno tapa al siguiente)", async () => {
    contexto.periodosExtra = [{ id: "p-2027", desde: "2027-03", hasta: "2027-06", motivo: "Niño 2027", alcance: "invierno", temporadas: ["invierno"], activo: true }];
    contexto.factores = contexto.factores.filter((f) => !(f.anio === 2026 && f.temporada === "verano"));
    const id = await nueva();
    await decidirTodo(id);
    // Sin ningún crecimiento aprobado: crecimientos_sin_aprobar vendría después de los dos del Niño.
    expect((await leerProy(id)).cierre_bloqueado_por?.map((b) => b.codigo)).toEqual(["anio_siguiente_atipico", "factor_faltante"]);
    expect((await leer(await cerrarConQuery(id))).codigo).toBe("anio_siguiente_atipico");
    contexto.periodosExtra = [];
    expect((await leer(await cerrarConQuery(id))).codigo).toBe("factor_faltante");
  });
});

describe("R24 de servicio: sincronizar, confirmar y el ejemplo H", () => {
  const filaFactor = (anio: number, temporada: string) => filasDe("factores_volumen_atipico").find((f) => f.anio === anio && f.temporada === temporada) as Fila;
  const estadoDe = async (anio: number, temporada: string) => (await leer<FactorApi[]>(await leerFactores())).data.find((f) => f.anio === anio && f.temporada === temporada);

  it("sincronizar escribe la fórmula relativa con sus dos números, el diagnóstico y las huellas; sin tocar lo escrito por Javier", async () => {
    contexto.factoresDesdeBase = true;
    // Javier ya había escrito el invierno antes de sincronizar (con su nota).
    sembrar("factores_volumen_atipico", [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.7, aplicado_huella: "vieja", nota: "mío", ratio_calculado: 0.5, formula: null, parcial: true }]);
    expect((await sincronizar()).status).toBe(200);
    const inv = filaFactor(2026, "invierno");
    expect(inv).toMatchObject({
      ratio_calculado: 0.6612,
      formula: "relativo_periodo",
      ratio_volumen: 0.6612,
      ratio_control: 1,
      meses_comparados: 9,
      huella_cargas: "huella-de-prueba",
      huella_composicion: COMPOSICION_HOY,
      parcial: true,
      tiendas_comunes: 8,
      ratio_aplicado: 0.7,
      aplicado_huella: "vieja",
      nota: "mío",
    });
    expect((inv.diagnostico as { meses: unknown[]; meses_periodo: number; meses_periodo_con_dato: number }).meses).toHaveLength(12);
    expect(inv.diagnostico).toMatchObject({ meses_periodo: 12, meses_periodo_con_dato: 9, anio_ref: 2025 });
    expect(inv.calculado_at).not.toBeNull();
    // El verano de 2026 solo tiene un mes del periodo (setiembre): no hay calculado, lo escribe Javier, y el diagnóstico muestra el mes.
    const ver = filaFactor(2026, "verano");
    expect(ver).toMatchObject({ ratio_calculado: null, formula: "relativo_periodo", meses_comparados: 1, parcial: true });
    expect(ver.diagnostico).toMatchObject({ meses_periodo: 4, meses_periodo_con_dato: 1, ratio_fuera: 1.2, anio_ref: 2025 });
    // Los años anteriores también se calculan con la fórmula relativa y no son parciales.
    expect(filaFactor(2023, "invierno")).toMatchObject({ ratio_calculado: 0.6321, formula: "relativo_periodo", parcial: false, meses_comparados: 12 });
  });

  it("un factor que no cabe en numeric(6,4) o no es positivo se guarda sin el dato a mostrar (null) y no tumba la sincronización", async () => {
    contexto.efectoNino = {
      ...efectoNinoFalso(),
      salida: {
        ...efectoNinoFalso().salida,
        efecto_atipico: {
          por_temporada: [
            { ...efectoNinoFalso().salida.efecto_atipico.por_temporada[2], ratio_volumen: 0, periodo: periodoFalso({ rho: 0, kappa: 1, mesesPeriodo: [1, 2, 3], publicados: [1, 2, 3] }) },
            { ...efectoNinoFalso().salida.efecto_atipico.por_temporada[3], periodo: periodoFalso({ rho: 250, kappa: 1, mesesPeriodo: [1, 2, 3], publicados: [1, 2, 3] }) },
          ],
        },
      },
    };
    expect((await sincronizar()).status).toBe(200);
    expect(filaFactor(2026, "invierno")).toMatchObject({ ratio_calculado: null, ratio_volumen: null, ratio_control: 1 });
    expect(filaFactor(2026, "verano")).toMatchObject({ ratio_calculado: null, ratio_volumen: null });
  });

  it("sincronizar y evaluar sin cambios en medio da sin_confirmar (parcial), nunca desfasado; guardar un aplicado escribe aplicado_huella y confirma; limpiarlo la borra", async () => {
    contexto.factoresDesdeBase = true;
    expect((await sincronizar()).status).toBe(200);
    expect(await estadoDe(2026, "invierno")).toMatchObject({ estado: "sin_confirmar", motivos_desfase: [], formula: "relativo_periodo", ratio_volumen: 0.6612, ratio_control: 1, meses_periodo: 12, meses_periodo_con_dato: 9 });
    // La API entrega el año de referencia dentro del diagnóstico («frente a 2025») y, sin nada escrito, aplicado_at es null.
    expect((await estadoDe(2026, "invierno"))?.diagnostico?.anio_ref).toBe(2025);
    expect((await estadoDe(2026, "invierno"))?.aplicado_at).toBeNull();
    expect(await estadoDe(2026, "verano")).toMatchObject({ estado: "faltante", ratio_calculado: null, meses_periodo: 4, meses_periodo_con_dato: 1 });
    // Los factores de otros años no traen estado.
    expect((await estadoDe(2023, "invierno"))?.estado).toBeUndefined();
    // Escribir el mismo valor que el calculado confirma el factor: aplicado_huella = huella_cargas de la fila en ese momento.
    const r = await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.6612 }] }));
    expect(r.status).toBe(200);
    expect(filaFactor(2026, "invierno")).toMatchObject({ ratio_aplicado: 0.6612, aplicado_huella: "huella-de-prueba" });
    expect(await estadoDe(2026, "invierno")).toMatchObject({ estado: "ok", origen: "manual" });
    // El verano lo escribe Javier con el diagnóstico delante.
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "verano", ratio_aplicado: 1.5, nota: "con el diagnóstico" }] }));
    expect(await estadoDe(2026, "verano")).toMatchObject({ estado: "ok", ratio_efectivo: 1.5, origen: "manual" });
    // Sincronizar de nuevo no toca ratio_aplicado, aplicado_huella ni nota.
    await sincronizar();
    expect(filaFactor(2026, "verano")).toMatchObject({ ratio_aplicado: 1.5, aplicado_huella: "huella-de-prueba", nota: "con el diagnóstico" });
    expect((await estadoDe(2026, "invierno"))?.estado).toBe("ok");
    // Limpiar el aplicado borra la confirmación.
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: null }] }));
    expect(filaFactor(2026, "invierno")).toMatchObject({ ratio_aplicado: null, aplicado_huella: null });
    expect((await estadoDe(2026, "invierno"))?.estado).toBe("sin_confirmar");
  });

  it("aplicado_at: updated_at de la fila solo con ratio_aplicado y cuando la última escritura no fue un Sincronizar; anio_ref viaja en el diagnóstico", () => {
    const calc = "2026-10-20T10:00:00.000Z";
    // Sin valor escrito: null, aunque la fila se haya movido.
    expect(aplicadoAtDe({ ratio_aplicado: null, updated_at: "2026-10-25T10:00:00Z", calculado_at: calc })).toBeNull();
    // Escrito después de sincronizar: la fecha de la fila.
    expect(aplicadoAtDe({ ratio_aplicado: 0.7, updated_at: "2026-10-29T15:00:00Z", calculado_at: calc })).toBe("2026-10-29T15:00:00Z");
    // La última escritura fue el sincronizar (updated_at pegado a calculado_at): la fecha del valor escrito no se conoce.
    expect(aplicadoAtDe({ ratio_aplicado: 0.7, updated_at: "2026-10-20T10:00:02Z", calculado_at: calc })).toBeNull();
    // Nunca sincronizada: solo hubo escrituras de Javier.
    expect(aplicadoAtDe({ ratio_aplicado: 1.5, updated_at: "2026-10-22T09:00:00Z", calculado_at: null })).toBe("2026-10-22T09:00:00Z");
    expect(aplicadoAtDe({ ratio_aplicado: 1.5, calculado_at: null })).toBeNull();
    const fila = { anio: 2026, temporada: "invierno", ratio_calculado: 0.66, ratio_aplicado: 0.7, parcial: true, tiendas_comunes: 8, meses_comparados: 9, calculado_at: calc, nota: null };
    expect(aFactorApi({ ...fila, updated_at: "2026-10-29T15:00:00Z" }, 2027).aplicado_at).toBe("2026-10-29T15:00:00Z");
    expect(aFactorApi({ ...fila, ratio_aplicado: null, updated_at: "2026-10-29T15:00:00Z" }, 2027).aplicado_at).toBeNull();
    // anio_ref: solo si el jsonb lo trae.
    const meses = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, en_periodo: false, u: 0, u_ref: 0, ratio: null, control: null, relativo: null }));
    const base = { meses, ratio_fuera: null, meses_periodo: 12, meses_periodo_con_dato: 9 };
    expect(diagnosticoDe(base)?.anio_ref).toBeUndefined();
    expect(diagnosticoDe({ ...base, anio_ref: 2025 })?.anio_ref).toBe(2025);
  });

  it("ejemplo H: confirmado → se publica octubre (desfasado) → sincronizar (sin_confirmar) → escribir el valor (ok)", async () => {
    contexto.factoresDesdeBase = true;
    await sincronizar();
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.66 }] }));
    expect((await estadoDe(2026, "invierno"))?.estado).toBe("ok");
    // Noviembre: se publica octubre. Hoy hay otras cargas y un mes más del periodo.
    contexto.huellaCargas = "huella-octubre";
    contexto.mesesPublicados = [...contexto.mesesPublicados, "2026-10"];
    expect(await estadoDe(2026, "invierno")).toMatchObject({ estado: "desfasado", motivos_desfase: ["cargas", "meses"] });
    // «Sincronizar» recalcula con los datos de octubre (0,71): la fila pasa a sin_confirmar («tu valor 0,66 · calculado hoy 0,71»).
    const efecto = efectoNinoFalso();
    const meses10 = Array.from({ length: 10 }, (_, i) => i + 1);
    contexto.efectoNino = {
      ...efecto,
      huella_cargas: "huella-octubre",
      salida: {
        ...efecto.salida,
        efecto_atipico: {
          por_temporada: efecto.salida.efecto_atipico.por_temporada.map((x) => (x.anio === 2026 && x.temporada === "invierno" ? { ...x, periodo: periodoFalso({ rho: 0.71, kappa: 1, mesesPeriodo: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], publicados: meses10 }) } : x)),
        },
      },
    };
    await sincronizar();
    expect(filaFactor(2026, "invierno")).toMatchObject({ ratio_calculado: 0.71, ratio_aplicado: 0.66, aplicado_huella: "huella-de-prueba", huella_cargas: "huella-octubre", meses_comparados: 10 });
    expect(await estadoDe(2026, "invierno")).toMatchObject({ estado: "sin_confirmar", ratio_calculado: 0.71, ratio_aplicado: 0.66 });
    // Javier escribe 0,71 (o deja el suyo reescribiéndolo): ok.
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.71 }] }));
    expect(filaFactor(2026, "invierno").aplicado_huella).toBe("huella-octubre");
    expect((await estadoDe(2026, "invierno"))?.estado).toBe("ok");
  });

  it("la composición también cuenta: remapear una equivalencia después de sincronizar deja el factor desfasado por composicion", async () => {
    contexto.factoresDesdeBase = true;
    await sincronizar();
    await guardarFactores(enviar("PUT", "/factores", { factores: [{ anio: 2026, temporada: "invierno", ratio_aplicado: 0.66 }] }));
    contexto.huellasComposicion = { ...contexto.huellasComposicion, invierno: "otra-composicion" };
    expect(await estadoDe(2026, "invierno")).toMatchObject({ estado: "desfasado", motivos_desfase: ["composicion"] });
  });
});

// ─── R18, R19, R29 ───

describe("R18: el cambio de método", () => {
  it("una proyección en trabajo de un método anterior queda desactualizada por version_metodo y no se cierra ni forzando; recalcular conserva decidido y crecimiento_pct", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    await decidirTodo(id);
    // Una decisión escrita a mano en 2027 y un % propio en otra fila.
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 2500, origen: "manual", nota: "mío" }), ctx(id, { filaId: idFila(DENIM_REC), anio: "2027" }))).status).toBe(200);
    expect((await decidirFila(enviar("PUT", "/x", { crecimiento_pct: 7, origen: "manual" }), ctx(id, { filaId: idFila(ABRIGO_REC), anio: "2027" }))).status).toBe(200);
    const p = proyecciones().find((x) => x.id === id) as Fila;
    p.resumen = { ...(p.resumen as Record<string, unknown>), version_metodo: VERSION_METODO - 1 };
    expect((await leerProy(id)).desactualizada.map((m) => m.codigo)).toEqual(["version_metodo"]);
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      expect((await leer(r)).codigo).toBe("version_metodo");
    }
    await recalcular(id);
    expect((await leerProy(id)).resumen?.version_metodo).toBe(VERSION_METODO);
    expect((await leerProy(id)).desactualizada).toEqual([]);
    expect(registro(DENIM_REC, 2027)).toMatchObject({ decidido: 2500, nota: "mío" });
    expect(registro(ABRIGO_REC, 2027).crecimiento_pct).toBe(7);
  });

  it("una cerrada de un método anterior no cambia: recalcular responde 409 y /cerrada la sigue entregando con su version_metodo", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    await decidirTodo(id);
    expect((await cerrarConQuery(id)).status).toBe(200);
    const p = proyecciones().find((x) => x.id === id) as Fila;
    p.resumen = { ...(p.resumen as Record<string, unknown>), version_metodo: VERSION_METODO - 1 };
    const r = await calcular(enviar("POST", "/x"), ctx(id));
    expect(r.status).toBe(409);
    expect((await leer(r)).codigo).toBe("cerrada");
    const c = await cerrada(get("/cerrada", "?anio=2026"));
    expect(c.status).toBe(200);
    expect((await leer<{ proyeccion: { resumen: { version_metodo: number } } }>(c)).data.proyeccion.resumen.version_metodo).toBe(VERSION_METODO - 1);
  });
});

describe("R19: decidir sin releer factores, con B' y el sobre_base de la foto", () => {
  it("decidir una fila de 2026 recalcula su 2027 con B' = B ÷ φ (el φ del cálculo, aunque el factor de hoy sea otro) y el % corregido de la foto", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · CASUAL": 20 }, resto: 5 });
    const id = await nueva();
    const ruta = { filaId: idFila(ABRIGO_REC), anio: "2026" };
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1200, origen: "manual" }), ctx(id, ruta))).status).toBe(200);
    // B = 1 200 (sin aportes), B' = 1 200 ÷ 0,66 = 1 818,18 y P = round(B' × 1,20) = 2 182.
    expect(registro(ABRIGO_REC, 2027)).toMatchObject({ base_siguiente: 1200, propuesto: 2182 });
    expect(Number(registro(ABRIGO_REC, 2027).base_normalizada)).toBeCloseTo(1818.18, 2);
    // El factor de hoy cambia (0,50) pero no se relee: la decisión usa el φ con que se calculó.
    contexto.factores = contexto.factores.map((f) => (f.anio === 2026 && f.temporada === "invierno" ? { ...f, ratio_aplicado: 0.5 } : f));
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1300, origen: "manual" }), ctx(id, ruta))).status).toBe(200);
    expect(registro(ABRIGO_REC, 2027)).toMatchObject({ base_siguiente: 1300, propuesto: Math.round((1300 / 0.66) * 1.2) });
    // La explicación cuenta la corrección y el % sobre real.
    expect(String(registro(ABRIGO_REC, 2027).explicacion)).toContain("corregida del Niño de invierno (÷ 0.66, relativo)");
    expect(String(registro(ABRIGO_REC, 2027).explicacion)).toContain("20.0 % de HOMBRE · CASUAL v1, sobre 2026 corregido");
  });

  it("decidir una fila base de 2026 rehace gm_con_nino, gm_correccion_nino_pct y gm_fuera_base con las filas de ahora (refrescarResumen); decidir una tienda no los toca", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    const claves = [`${GEN.hombre}|${MUN.casual}`, `${GEN.mujer}|${MUN.casual}`].sort();
    const resumenDe = () => proyecciones().find((x) => x.id === id)?.resumen as unknown as { gm_con_nino: string[]; gm_correccion_nino_pct: Record<string, number>; gm_fuera_base: Record<string, unknown> };
    // La foto del cálculo queda vieja a propósito (como si el Niño de esos GM se hubiera movido con decisiones anteriores).
    const p = proyecciones().find((x) => x.id === id) as Fila;
    p.resumen = { ...(p.resumen as Record<string, unknown>), gm_con_nino: [], gm_correccion_nino_pct: {}, gm_fuera_base: { viejo: { filas: 1, unidades: 1 } } };
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1200, origen: "manual" }), ctx(id, { filaId: idFila(ABRIGO_REC), anio: "2026" }))).status).toBe(200);
    expect(resumenDe().gm_con_nino).toEqual(claves);
    expect(resumenDe().gm_correccion_nino_pct[`${GEN.hombre}|${MUN.casual}`]).toBeGreaterThan(50);
    expect(resumenDe().gm_fuera_base).toEqual({});
    // Y lo que lee la API sale de ahí: la lista de «reaprobar» no queda con la foto del cálculo.
    expect((await leerProy(id)).resumen?.gm_con_nino).toEqual(claves);
  });

  it("con una versión bruta en la foto, decidir rehace 2027 como el método 4: P = round(B × (1 + g)); B' se sigue guardando", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · CASUAL": 20 }, resto: 5, sobre: { "HOMBRE · CASUAL": "bruta" } });
    const id = await nueva();
    expect((await decidirFila(enviar("PUT", "/x", { decidido: 1200, origen: "manual" }), ctx(id, { filaId: idFila(ABRIGO_REC), anio: "2026" }))).status).toBe(200);
    expect(registro(ABRIGO_REC, 2027)).toMatchObject({ base_siguiente: 1200, propuesto: 1440 });
    expect(Number(registro(ABRIGO_REC, 2027).base_normalizada)).toBeCloseTo(1818.18, 2);
    expect(String(registro(ABRIGO_REC, 2027).explicacion)).toContain("sobre 2026 real, aprobado antes de 0.14.0");
    // La foto dice cómo se aplicó cada GM.
    expect(filasDe("proyeccion_crecimientos").find((c) => c.genero_id === GEN.hombre && c.mundo_id === MUN.casual)).toMatchObject({ sobre_base: "bruta" });
  });

  it("un PATCH de un umbral conserva crecimiento_resto_usado con su sobre_base", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 10, sobre: { resto: "bruta" } });
    const id = await nueva();
    const usado = (proyecciones().find((x) => x.id === id)?.parametros as Record<string, unknown>).crecimiento_resto_usado;
    expect(usado).toMatchObject({ pct: 10, version: 1, sobre_base: "bruta" });
    expect((await editar(enviar("PATCH", "/x", { parametros: { umbral_avance: 0.4 } }), ctx(id))).status).toBe(200);
    expect((proyecciones().find((x) => x.id === id)?.parametros as Record<string, unknown>).crecimiento_resto_usado).toEqual(usado);
  });
});

describe("R29: cambiar la agrupación de una equivalencia con Niño después de calcular", () => {
  it("de invierno a todo el año marca la proyección (temporada_cambiada) y bloquea el cierre, también con forzar; recalcular lo resuelve", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    await decidirTodo(id);
    expect((await leerProy(id)).desactualizada).toEqual([]);
    // La equivalencia PARKA (invierno) pasa a la agrupación DENIM (todo el año).
    contexto.eqAgrupacion = { [EQ.parka]: AG.denim };
    const p = await leerProy(id);
    expect(p.desactualizada.map((m) => m.codigo)).toEqual(["temporada_cambiada"]);
    expect(p.desactualizada[0].detalle).toEqual([EQ.parka]);
    expect(p.cierre_bloqueado_por?.map((b) => b.codigo)).toEqual(["temporada_cambiada"]);
    for (const query of ["", "?forzar=1"]) {
      const r = await cerrarConQuery(id, query);
      expect(r.status).toBe(409);
      expect((await leer(r)).codigo).toBe("temporada_cambiada");
    }
    await recalcular(id);
    expect((await leerProy(id)).desactualizada).toEqual([]);
    expect((await leerProy(id)).cierre_bloqueado_por).toBeNull();
  });
});

describe("el resumen y las lecturas del método 5", () => {
  it("el cálculo guarda gm_con_nino con la corrección de cada GM, gm_fuera_base y la versión del método; la API no entrega la foto de equivalencias", async () => {
    aprobarCrecimientosFalsos(2027, { pct: 5, resto: 5 });
    const id = await nueva();
    const p = await leerProy(id);
    expect(p.resumen?.version_metodo).toBe(VERSION_METODO);
    expect(p.resumen?.gm_con_nino).toEqual([`${GEN.hombre}|${MUN.casual}`, `${GEN.mujer}|${MUN.casual}`].sort());
    expect(p.resumen?.gm_correccion_nino_pct?.[`${GEN.hombre}|${MUN.casual}`]).toBeGreaterThan(50);
    expect(p.resumen?.gm_fuera_base).toEqual({});
    expect(p.resumen).not.toHaveProperty("temporada_equivalencias");
    // Se guardó en la base (con la foto interna).
    expect((proyecciones().find((x) => x.id === id)?.resumen as Record<string, unknown>).temporada_equivalencias).toMatchObject({ [EQ.parka]: "invierno", [EQ.sandalia]: "verano" });
    // La proyección calculada no tiene nada que impida cerrar por el Niño.
    expect(p.cierre_bloqueado_por).toBeNull();
    // factores_usados lleva la fórmula y la huella de cargas.
    expect(p.parametros.factores_usados.find((f) => f.anio === 2026 && f.temporada === "invierno")).toMatchObject({ ratio: 0.66, origen: "calculado", formula: null, huella_cargas: null });
  });

  it("la Matriz y la fila de 2027 traen la base corregida: Σ vigente ÷ Σ B' − 1 «sobre corregido» y la «sobre real»", async () => {
    aprobarCrecimientosFalsos(2027, { pct: { "HOMBRE · CASUAL": 20 }, resto: 5 });
    const id = await nueva();
    const { GET: matriz } = await import("@/app/api/proyeccion/proyecciones/[id]/matriz/route");
    const m = (await leer<{ nodos: { nivel: string; nombre: string; siguiente: { base_siguiente: number; base_corregida?: number; crec_corregida_pct?: number | null; crec_mismas_pct: number | null } }[] }>(await matriz(get("/m"), ctx(id)))).data;
    const abrigo = m.nodos.find((n) => n.nivel === "linea" && n.nombre === "ABRIGO")!;
    expect(abrigo.siguiente.base_corregida).toBeGreaterThan(abrigo.siguiente.base_siguiente);
    expect(abrigo.siguiente.crec_corregida_pct).toBeCloseTo(20, 0);
    expect(abrigo.siguiente.crec_mismas_pct as number).toBeGreaterThan(50);
    // Una línea sin Niño (DENIM): las dos coinciden.
    const denim = m.nodos.find((n) => n.nivel === "linea" && n.nombre === "DENIM")!;
    expect(denim.siguiente.base_corregida).toBe(denim.siguiente.base_siguiente);
    expect(denim.siguiente.crec_corregida_pct).toBe(denim.siguiente.crec_mismas_pct);
  });
});

void SANDALIA_VAL;
