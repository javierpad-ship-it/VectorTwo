import { describe, expect, it } from "vitest";
import {
  aplicarEnMemoria,
  armarResultadoLote,
  calcularEfectoGM,
  cambiosDePlan,
  crecimientosAReaprobar,
  filaParaMeta,
  filaParaNino,
  indicadoresGM,
  mayoresBrechas,
  mayoresUnidades,
  registrosAEscribir,
  totalesDeLote,
  type FilaEfecto,
  type GMEfectoEntrada,
} from "@/lib/aprobacion/efecto";
import { planificarLote, planificarReversion, type FilaPlanificada } from "@/lib/aprobacion/plan";
import { ninoPorGM } from "@/lib/proyeccion/calculo";
import { registroDe } from "@/lib/proyeccion/decision";
import { metaDeGM } from "@/lib/proyeccion/meta-gm";
import type { VigenteCrecimiento } from "@/lib/crecimientos/vigentes";
import {
  CLAVE,
  CTX_MODELO,
  escenarioA2027,
  F,
  filaConCurvaCambio,
  filasModeloA,
  GM_A,
  idDe,
  itemIa,
  itemMetodo,
  itemsIaA,
  LOTE,
  con,
  Y,
  Y1,
} from "./aprobacion.fixture";

/** Efecto de un lote (07g): R3, R6, R27, los ejemplos A1, A2, K y N, las 10 mayores y el resultado único de simular y aplicar. */

const IDS5 = ["f1", "f2", "f3", "f4", "f5"] as const;
/** `B'` de las cinco filas del ejemplo A (la base sobre la que se escribe el 8 %). */
const BASE_S = { f1: 10000, f2: 6000, f3: 5000, f4: 3000, f5: 80 };
/** Vigente de 2027 de hoy: método en las libres, 3 300 la decidida y 86 la cola larga. */
const VIGENTE_HOY = { f1: 10800, f2: 6480, f3: 5400, f4: 3300, f5: 86 };
const META = 26006;

const filasA = (libres: readonly string[] = ["f1", "f2", "f3"]): FilaEfecto[] =>
  IDS5.map((id) => ({ fila_id: F[id], vigente_antes: VIGENTE_HOY[id], base_s: BASE_S[id], libre_antes: libres.includes(id) }));
const gmA = (extra: Partial<GMEfectoEntrada> = {}): GMEfectoEntrada => ({ gm_clave: GM_A, meta_antes: META, meta_despues: META, filas: filasA(), ...extra });

describe("indicadoresGM", () => {
  it("el ejemplo A de hoy: total 26 066, desvío +60 y crecimiento +8,2 %", () => {
    const r = indicadoresGM({ filas: IDS5.map((id) => ({ vigente: VIGENTE_HOY[id], base_s: BASE_S[id] })), meta: META });
    expect(r).toMatchObject({ total: 26066, base_total: 24080, desvio_u: 60 });
    expect(r.crecimiento_pct).toBeCloseTo(8.248, 2);
    expect(r.desvio_pct).toBeCloseTo(0.2307, 3);
  });

  it("una fila sin base está fuera de todo; sin meta no hay desvío; base 0 no da crecimiento", () => {
    const r = indicadoresGM({ filas: [{ vigente: 100, base_s: 100 }, { vigente: 999, base_s: null }], meta: null });
    expect(r).toEqual({ total: 100, base_total: 100, crecimiento_pct: 0, desvio_u: null, desvio_pct: null });
    expect(indicadoresGM({ filas: [{ vigente: 5, base_s: 0 }], meta: 10 })).toMatchObject({ base_total: null, crecimiento_pct: null, desvio_u: -5 });
    expect(indicadoresGM({ filas: [], meta: 0 })).toMatchObject({ total: 0, desvio_pct: null });
  });
});

describe("Ejemplo A1 · las tres libres con IA (R3)", () => {
  it("desvío 0 y crecimiento implícito del GM +8,0 % (26 006 ÷ 24 080 − 1); libres 3 → 0", () => {
    const e = escenarioA2027();
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: itemsIaA(), filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    const [efecto] = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    expect(efecto).toMatchObject({ gm_clave: GM_A, total_antes: 26066, total_despues: 26006, meta_antes: META, meta_despues: META, desvio_antes_u: 60, desvio_despues_u: 0, libres_antes: 3, libres_despues: 0 });
    expect(efecto.crecimiento_implicito_despues_pct).toBeCloseTo(8, 2);
    expect(efecto.crecimiento_implicito_antes_pct).toBeCloseTo(8.248, 2);
    // Σ fijas + Σ A = Meta_GM
    expect(p.filas.reduce((s, f) => s + (f.valor ?? 0), 0) + 3300 + 86).toBe(META);
  });

  it("A2 · solo f1 y f2: desvío +418 y queda una libre", () => {
    const e = escenarioA2027();
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: [itemIa("f1", 10961), itemIa("f2", 6677)], filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    const [efecto] = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    expect(efecto).toMatchObject({ total_despues: 26424, desvio_despues_u: 418, libres_antes: 3, libres_despues: 1 });
  });

  it("las filas rechazadas no cambian nada", () => {
    const e = escenarioA2027({ conf: { f2: "baja" } });
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: itemsIaA(), filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    expect(cambiosDePlan(p.filas).size).toBe(0);
    const [efecto] = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    expect(efecto).toMatchObject({ total_antes: 26066, total_despues: 26066, libres_despues: 3 });
  });
});

describe("Ejemplo N · el método en un GM sin IA", () => {
  it("2027 con el método: el desvío sigue en +60 y se informa", () => {
    const e = escenarioA2027({ modo: "sin_ia" });
    const items = [itemMetodo(F.f1, 10800), itemMetodo(F.f2, 6480), itemMetodo(F.f3, 5400)];
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items, filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    const [efecto] = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    expect(efecto).toMatchObject({ total_antes: 26066, total_despues: 26066, desvio_antes_u: 60, desvio_despues_u: 60, libres_despues: 0 });
  });
});

describe("Revertir: el efecto vuelve a la propuesta", () => {
  it("la reversión deja libre la fila y su vigente es la propuesta", () => {
    const e = escenarioA2027();
    con(e, "f1", { registro: { decidido: 10961, decision_lote_id: LOTE(1) } });
    const p = planificarReversion({ loteId: LOTE(1), anio: Y1, filasLote: [{ fila_id: F.f1, fila_clave: CLAVE.f1, gm_clave: GM_A, anio: Y1 }], filas: e.filas });
    const cambios = cambiosDePlan(p.filas, new Map([[F.f1, 10800]]));
    expect(cambios.get(F.f1)).toEqual({ vigente_despues: 10800, libre_despues: true });
    const filas = filasA(["f2", "f3"]).map((f) => (f.fila_id === F.f1 ? { ...f, vigente_antes: 10961 } : f));
    const [efecto] = calcularEfectoGM({ anioSiguiente: true, gms: [gmA({ filas })], cambios });
    expect(efecto).toMatchObject({ total_antes: 26227, total_despues: 26066, libres_antes: 2, libres_despues: 3 });
  });
});

describe("2026 · el efecto de un lote de Y no compara con la meta de 2027", () => {
  it("desvío nulo, meta informada y crecimiento sobre lo vendido en 2025 de las mismas tiendas", () => {
    const filas: FilaEfecto[] = [
      { fila_id: "a", vigente_antes: 10000, base_s: 9000, libre_antes: true },
      { fila_id: "b", vigente_antes: 6000, base_s: 6000, libre_antes: true },
    ];
    const [efecto] = calcularEfectoGM({ anioSiguiente: false, gms: [{ gm_clave: "g", meta_antes: 100, meta_despues: 120, filas }], cambios: new Map([["a", { vigente_despues: 10500, libre_despues: false }]]) });
    expect(efecto).toMatchObject({ total_antes: 16000, total_despues: 16500, meta_antes: 100, meta_despues: 120, desvio_antes_u: null, desvio_despues_u: null, libres_antes: 2, libres_despues: 1 });
    expect(efecto.crecimiento_implicito_antes_pct).toBeCloseTo(6.667, 2);
    expect(efecto.crecimiento_implicito_despues_pct).toBeCloseTo(10, 2);
  });

  it("el resultado sale ordenado por gm_clave", () => {
    const r = calcularEfectoGM({ anioSiguiente: true, gms: [{ ...gmA(), gm_clave: "z" }, { ...gmA(), gm_clave: "b" }], cambios: new Map() });
    expect(r.map((x) => x.gm_clave)).toEqual(["b", "z"]);
  });
});

describe("Ejemplo K y R6 · 2026 con el método no mueve la meta de 2027", () => {
  const grupos = () => new Map([...filasModeloA()].map(([id, fila]) => [id, { fila, tiendas: [] as never[] }]));
  const metaDe = (filas: Iterable<[string, Parameters<typeof filaParaMeta>[0]]>): number | null =>
    metaDeGM({ filas: [...filas].flatMap(([id, f]) => filaParaMeta(f, Y1, id) ?? []), g: 8, sobre_base: "corregida", fuente: "gm" }).meta_gm;

  it("la base A es la del ejemplo: B y B' (10 000 · 6 000 · 4 000 → 5 000 con φ = 0,80), Meta_GM 26 006", () => {
    const m = filasModeloA();
    expect([F.f1, F.f2, F.f3, F.f4, F.f5].map((id) => registroDe(m.get(id)!, Y1)?.base_siguiente)).toEqual([10000, 6000, 4000, 3000, 80]);
    expect([F.f1, F.f2, F.f3, F.f4, F.f5].map((id) => registroDe(m.get(id)!, Y1)?.base_normalizada)).toEqual([10000, 6000, 5000, 3000, 80]);
    expect(metaDe(m)).toBe(META);
  });

  it("aprobar f1 · f2 · f3 de 2026 con el método deja B, B' y la meta como estaban", () => {
    const g = grupos();
    const decisiones = [F.f1, F.f2, F.f3].map((id) => ({ fila_id: id, anio: Y, decidido: registroDe(g.get(id)!.fila, Y)?.propuesto ?? null, origen: "propuesta" as const, decidido_at: "2026-11-03T10:00:00.000Z" }));
    const despues = aplicarEnMemoria(g, decisiones, CTX_MODELO);
    for (const id of [F.f1, F.f2, F.f3]) {
      const antes = registroDe(g.get(id)!.fila, Y1);
      const r = registroDe(despues.get(id)!, Y1);
      expect([r?.propuesto, r?.base_siguiente, r?.base_normalizada]).toEqual([antes?.propuesto, antes?.base_siguiente, antes?.base_normalizada]);
      expect(registroDe(despues.get(id)!, Y)?.decidido).toBe(registroDe(g.get(id)!.fila, Y)?.propuesto);
      expect(registroDe(despues.get(id)!, Y)?.origen).toBe("propuesta");
      expect(registroDe(despues.get(id)!, Y)?.decidido_at).toBe("2026-11-03T10:00:00.000Z");
    }
    expect(metaDe(despues)).toBe(META);
    // f4 y f5 no se tocan
    expect(despues.get(F.f4)).toBe(g.get(F.f4)?.fila);
    expect(registroDe(despues.get(F.f4)!, Y1)?.decidido).toBe(3300);
  });

  it("con curva_cambio (reaprobar un registro con la curva que cambió) la meta de 2027 se mueve y el efecto lo informa", () => {
    const base = filasModeloA();
    base.set(F.f3, filaConCurvaCambio(CLAVE.f3));
    expect(registroDe(base.get(F.f3)!, Y)?.avisos).toContain("curva_cambio");
    const g = new Map([...base].map(([id, fila]) => [id, { fila, tiendas: [] as never[] }]));
    const metaAntes = metaDe(base);
    const despues = aplicarEnMemoria(g, [{ fila_id: F.f3, anio: Y, decidido: 4000, origen: "propuesta" }], CTX_MODELO);
    const metaDespues = metaDe(despues);
    expect(metaDespues).not.toBe(metaAntes);
    expect(registroDe(despues.get(F.f3)!, Y)?.avisos).not.toContain("curva_cambio");
    const filas = filasA().map((f) => f);
    const [efecto] = calcularEfectoGM({ anioSiguiente: false, gms: [{ gm_clave: GM_A, meta_antes: metaAntes, meta_despues: metaDespues, filas }], cambios: new Map() });
    expect(efecto.meta_antes).toBe(metaAntes);
    expect(efecto.meta_despues).toBe(metaDespues);
    expect(efecto.meta_despues).not.toBe(efecto.meta_antes);
  });

  it("una decisión de 2027 no toca 2026 ni recalcula nada más; una de 2026 recalcula el 2027 de la misma fila", () => {
    const g = grupos();
    const d27 = aplicarEnMemoria(g, [{ fila_id: F.f1, anio: Y1, decidido: 10961, origen: "manual" }], CTX_MODELO);
    expect(registroDe(d27.get(F.f1)!, Y1)?.decidido).toBe(10961);
    expect(registroDe(d27.get(F.f1)!, Y)).toEqual(registroDe(g.get(F.f1)!.fila, Y));
    // sin decisiones: la misma fila, sin tocar
    expect(aplicarEnMemoria(g, [], CTX_MODELO).get(F.f2)).toBe(g.get(F.f2)?.fila);
    // una decisión de 2026 a mano distinta de la propuesta SÍ mueve el 2027 de la fila
    const d26 = aplicarEnMemoria(g, [{ fila_id: F.f1, anio: Y, decidido: 11000, origen: "manual" }], CTX_MODELO);
    expect(registroDe(d26.get(F.f1)!, Y1)?.propuesto).toBe(Math.round(11000 * 1.08));
  });

  it("registrosAEscribir: lote de 2026 → el de la decisión y el 2027 recalculado; lote de 2027 → solo el suyo", () => {
    const f = filasModeloA().get(F.f1)!;
    expect(registrosAEscribir(f, Y, Y).map((r) => [r.anio, r.objetivo])).toEqual([[Y, true], [Y1, false]]);
    expect(registrosAEscribir(f, Y1, Y).map((r) => [r.anio, r.objetivo])).toEqual([[Y1, true]]);
    expect(registrosAEscribir({ ...f, tienda_id: "t1" }, Y, Y).map((r) => r.anio)).toEqual([Y]);
  });

  it("filaParaMeta y filaParaNino leen B, B' y lo vendido de la fila decidida en memoria", () => {
    const f = filasModeloA().get(F.f3)!;
    expect(filaParaMeta(f, Y1, "x")).toMatchObject({ fila_id: "x", propuesto: 5400, base: 4000, base_corregida: 5000, crecimiento_pct: null, vigente: 5400 });
    expect(filaParaNino(f, Y)).toMatchObject({ gml_id: "gml-1", base_siguiente: 4000, base_normalizada: 5000 });
    expect(filaParaNino({ ...f, activo: false }, Y)).toBeNull();
    expect(filaParaNino({ ...f, tienda_id: "t" }, Y)).toBeNull();
    expect(filaParaMeta({ ...f, tienda_id: "t" }, Y1, "x")).toBeNull();
  });
});

describe("R27 · un lote de 2026 que deja crecimientos por reaprobar (D15)", () => {
  const vigente = (sobre: "bruta" | "corregida"): VigenteCrecimiento => ({ id: "c1", anio_aplicacion: Y1, alcance: "gm", genero_id: "g", mundo_id: "m", version: 1, pct: 8, sobre_base: sobre, usuario_nombre: null, aprobada_at: "2026-10-01T00:00:00.000Z" });
  const nombres = new Map([["g|m", { gm_clave: "g|m", genero: "HOMBRE", mundo: "URBANO" }]]);
  const exigidos = { gm: ["g|m"], resto: false };
  const nino = (despues: ReturnType<typeof filasModeloA>) => ninoPorGM([...despues.values()].flatMap((f) => filaParaNino(f, Y) ?? []), () => "g|m");

  it("el GM con Niño material después del lote y con un crecimiento aprobado sobre la base real queda en la lista", () => {
    const n = nino(filasModeloA());
    expect(n.gm_con_nino).toEqual(["g|m"]);
    expect(n.gm_correccion_nino_pct["g|m"]).toBeCloseTo(4.33, 1);
    expect(crecimientosAReaprobar({ ninoDespues: n, exigidos, vigentes: [vigente("bruta")], anioSiguiente: Y1, nombres })).toEqual([{ gm_clave: "g|m", genero: "HOMBRE", mundo: "URBANO" }]);
  });

  it("un crecimiento ya aprobado sobre corregida, un GM sin Niño o sin crecimiento aprobado no crean un reaprobar", () => {
    const n = nino(filasModeloA());
    expect(crecimientosAReaprobar({ ninoDespues: n, exigidos, vigentes: [vigente("corregida")], anioSiguiente: Y1, nombres })).toEqual([]);
    expect(crecimientosAReaprobar({ ninoDespues: { gm_con_nino: [], gm_correccion_nino_pct: {} }, exigidos, vigentes: [vigente("bruta")], anioSiguiente: Y1, nombres })).toEqual([]);
    expect(crecimientosAReaprobar({ ninoDespues: n, exigidos, vigentes: [], anioSiguiente: Y1, nombres })).toEqual([]);
  });

  it("el Resto cuenta si se exige y su vigente es bruta; sin nombres se usa la clave", () => {
    const n = { gm_con_nino: ["resto"], gm_correccion_nino_pct: { resto: 2 } };
    const v: VigenteCrecimiento = { ...vigente("bruta"), alcance: "resto", genero_id: null, mundo_id: null };
    expect(crecimientosAReaprobar({ ninoDespues: n, exigidos: { gm: [], resto: true }, vigentes: [v], anioSiguiente: Y1, nombres: new Map() })).toEqual([{ gm_clave: "resto", genero: "Resto", mundo: "" }]);
  });
});

describe("totales, las 10 mayores y el resultado único (R22)", () => {
  const fp = (n: number, o: Partial<FilaPlanificada> = {}): FilaPlanificada => ({
    fila_id: `f${String(n).padStart(2, "0")}`,
    anio: Y1,
    fila_clave: `k${n}`,
    gm_clave: n % 2 === 0 ? "gm-b" : "gm-a",
    fuente: "ia",
    resultado: "aplicada",
    codigo: null,
    valor: 100 + n,
    valor_esperado: 100 + n,
    valor_actual: null,
    decidido_anterior: null,
    decidido_esperado: null,
    propuesta_fila_id: null,
    propuesta_gm_id: null,
    decision: { decidido: 100 + n, origen: "manual", decision_ia_fila_id: "p" },
    registro_id: null,
    updated_at: null,
    brecha_u: n % 3 === 0 ? -n : n,
    ...o,
  });

  it("totales: aplicadas, rechazadas, unidades y por fuente", () => {
    const filas = [fp(1), fp(2, { fuente: "metodo" }), fp(3, { resultado: "rechazada", codigo: "ya_decidida", valor: null }), fp(4, { fuente: "revertir", valor: null })];
    expect(totalesDeLote(filas)).toEqual({ pedidas: 4, aplicadas: 3, rechazadas: 1, unidades: 101 + 102, por_fuente: { ia: { filas: 1, unidades: 101 }, metodo: { filas: 1, unidades: 102 } } });
  });

  it("las 10 con más unidades: solo aplicadas, desempate por gm_clave y fila_id", () => {
    const filas = Array.from({ length: 14 }, (_, i) => fp(i + 1, { valor: i < 4 ? 500 : 100 + i }));
    filas[13] = { ...filas[13], resultado: "rechazada", codigo: "ya_decidida", valor: null };
    const top = mayoresUnidades(filas);
    expect(top).toHaveLength(10);
    // 500 empatadas (n = 1..4): gm-a (1, 3) antes que gm-b (2, 4)
    expect(top.slice(0, 4).map((f) => f.fila_id)).toEqual(["f01", "f03", "f02", "f04"]);
    expect(top.every((f) => f.resultado === "aplicada")).toBe(true);
    expect(top.some((f) => f.fila_id === "f14")).toBe(false);
  });

  it("las 10 con mayor |brecha|: solo con brecha; en una reversión usa la cifra que se quita", () => {
    const filas = Array.from({ length: 12 }, (_, i) => fp(i + 1));
    const top = mayoresBrechas(filas);
    expect(top).toHaveLength(10);
    expect(top.map((f) => Math.abs(f.brecha_u ?? 0))).toEqual([...top.map((f) => Math.abs(f.brecha_u ?? 0))].sort((a, b) => b - a));
    expect(mayoresBrechas([fp(1, { brecha_u: null })])).toEqual([]);
    const rev = [fp(1, { fuente: "revertir", valor: null, decidido_anterior: 50 }), fp(2, { fuente: "revertir", valor: null, decidido_anterior: 900 })];
    expect(mayoresUnidades(rev).map((f) => f.fila_id)).toEqual(["f02", "f01"]);
  });

  it("armarResultadoLote: la misma salida para simular y para aplicar, salvo lote, simulado y repetido", () => {
    const e = escenarioA2027();
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: itemsIaA(), filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    const efecto = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    const pend = { filas_y: 0, filas_y1: 2, para_revision: 0, tiendas: 0 };
    const base = { plan: p.filas, efecto_gm: efecto, crecimientos_a_reaprobar: [], pendientes_cierre: pend, huella_simulacion: "a".repeat(64) };
    const sim = armarResultadoLote({ ...base, simulado: true });
    const apl = armarResultadoLote({ ...base, simulado: false });
    expect(sim).toMatchObject({ simulado: true, repetido: false, lote: null, revision_requerida: false });
    expect({ ...apl, simulado: true }).toEqual(sim);
    expect(sim.totales).toMatchObject({ pedidas: 3, aplicadas: 3, rechazadas: 0, unidades: 22620 });
    expect(sim.mayores_unidades.map((f) => idDe(f.fila_id))).toEqual(["f1", "f2", "f3"]);
    expect(sim.mayores_brechas.map((f) => f.brecha_u)).toEqual([661, -118, 77]);
  });

  it("revision_requerida: más de 100 filas pedidas o algún GM a más de ±1 % de su meta", () => {
    const e = escenarioA2027();
    const p = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: [itemIa("f1", 10961), itemIa("f2", 6677)], filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    // A2: desvío +418 de 26 006 = 1,6 % → exige la revisión
    const efecto = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p.filas) });
    const r = armarResultadoLote({ plan: p.filas, efecto_gm: efecto, crecimientos_a_reaprobar: [], pendientes_cierre: { filas_y: 0, filas_y1: 0, para_revision: 0, tiendas: 0 }, huella_simulacion: "b".repeat(64), simulado: true });
    expect(r.revision_requerida).toBe(true);
    // A1: desvío 0 y 3 filas → no
    const p1 = planificarLote({ tipo: "aprobar", anio: Y1, anioEnCurso: Y, items: itemsIaA(), filas: e.filas, gms: e.gms, propuestasFila: e.propuestasFila });
    const e1 = calcularEfectoGM({ anioSiguiente: true, gms: [gmA()], cambios: cambiosDePlan(p1.filas) });
    expect(armarResultadoLote({ plan: p1.filas, efecto_gm: e1, crecimientos_a_reaprobar: [], pendientes_cierre: { filas_y: 0, filas_y1: 0, para_revision: 0, tiendas: 0 }, huella_simulacion: "c".repeat(64), simulado: true }).revision_requerida).toBe(false);
  });
});
