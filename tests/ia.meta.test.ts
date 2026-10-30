import { describe, expect, it } from "vitest";
import {
  asignarMeta,
  avisoBrechaExtrema,
  banderasEsfuerzo,
  contarForzadas,
  escalarASubMetas,
  esfuerzoGM,
  estadoFilaMeta,
  indicadoresFila,
  nivelBrecha,
  ordenarPorContraMetodo,
  planMeta,
  subMetasPorLinea,
  type FilaMeta,
  type PesoFilaMeta,
} from "@/lib/ia/meta";
import { crearAleatorio } from "@/lib/ia/evaluacion";
import { filasMetaA, fm, OPCIONES_META } from "./ia.fixture";

const peso = (fila_id: string, clave: string, p_gm: number, modelo: number | null, extra: Partial<PesoFilaMeta> = {}): PesoFilaMeta => ({
  fila_id,
  clave,
  p_gm,
  meta_y1_modelo: modelo,
  natural_y1: null,
  base_s: null,
  ...extra,
});

const planA = (filas: FilaMeta[] = filasMetaA(), extra: Partial<Parameters<typeof planMeta>[0]> = {}) =>
  planMeta({ filas, g: 8, sobre_base: "corregida", fuente: "gm", crecimiento_id: "c1", version: 2, opciones: OPCIONES_META, ...extra });

describe("R3 · clasificación de las filas de 2027", () => {
  const o = OPCIONES_META;
  it("sigue el orden: decidida, % propio, cola larga, libre", () => {
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 5000, decidido: 5200, crecimiento_pct: 3 }), o)).toBe("fija_decidida");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 5000, crecimiento_pct: 3 }), o)).toBe("fija_pct");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 86 }), o)).toBe("fija_cola_larga");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 100 }), o)).toBe("libre");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 99 }), o)).toBe("fija_cola_larga");
  });
  it("una cola larga decidida es fija_decidida, no cola larga", () => {
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 50, decidido: 60 }), o)).toBe("fija_decidida");
  });
  it("revision_cola_larga e incluir_cola_larga la vuelven libre", () => {
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 50, revision_cola_larga: true }), o)).toBe("libre");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: 50 }), { ...o, incluir_cola_larga: true })).toBe("libre");
  });
  it("sin propuesto es sin_base (también si tiene un decidido: no está en la meta)", () => {
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: null }), o)).toBe("sin_base");
    expect(estadoFilaMeta(fm({ fila_id: "a", clave: "a", propuesto: null, decidido: 10 }), o)).toBe("sin_base");
  });
});

describe("R4 · ejemplo A: meta, fijas y asignación", () => {
  it("26 006 / 3 386 / 22 620", () => {
    const p = planA();
    expect(p.meta).toMatchObject({ pct: 8, sobre_base: "corregida", meta_gm: 26006, fijas: 3386, meta_libre: 22620, filas_libres: 3, filas_fijas: 2, fijas_detalle: { decididas: 3300, pct_propio: 0, cola_larga: 86 } });
    expect(p.libres.map((f) => f.fila_id)).toEqual(["f1", "f2", "f3"]);
    expect(p.estados.get("f4")).toBe("fija_decidida");
    expect(p.estados.get("f5")).toBe("fija_cola_larga");
    expect(p.avisos).toEqual([]);
  });

  it("asignarMeta(22 620, [11 000, 6 700, 5 000]) = 10 961 · 6 677 · 4 982 y cuadra con Meta_GM", () => {
    const p = planA();
    const a = asignarMeta(p.meta?.meta_libre ?? null, [peso("f1", "k1", 10800, 11000), peso("f2", "k2", 6480, 6700), peso("f3", "k3", 5400, 5000)]);
    expect([...(a.a ?? [])]).toEqual([["f1", 10961], ["f2", 6677], ["f3", 4982]]);
    const suma = [...(a.a?.values() ?? [])].reduce((x, y) => x + y, 0);
    expect(suma).toBe(22620);
    expect((p.meta?.fijas ?? 0) + suma).toBe(p.meta?.meta_gm);
  });

  it("brechas, frente al método, % sobre 2026 y esfuerzo del GM", () => {
    const naturales = { f1: 10300, f2: 6600, f3: 5100 };
    const a = { f1: 10961, f2: 6677, f3: 4982 };
    const metodo = { f1: 10800, f2: 6480, f3: 5400 };
    const filas = filasMetaA();
    const ind = (id: "f1" | "f2" | "f3") => {
      const f = filas.find((x) => x.fila_id === id) as FilaMeta;
      return indicadoresFila({ a: a[id], natural_y1: naturales[id], p_metodo: metodo[id], base: f.base, base_corregida: f.base_corregida });
    };
    expect(ind("f1").brecha_u).toBe(661);
    expect(ind("f1").brecha_pct).toBeCloseTo(6.4, 1);
    expect(ind("f2").brecha_u).toBe(77);
    expect(ind("f2").brecha_pct).toBeCloseTo(1.2, 1);
    expect(ind("f3").brecha_u).toBe(-118);
    expect(ind("f3").brecha_pct).toBeCloseTo(-2.3, 1);
    expect(ind("f1").brecha_u! + ind("f2").brecha_u! + ind("f3").brecha_u!).toBe(620);
    expect([ind("f1").contra_metodo_u, ind("f2").contra_metodo_u, ind("f3").contra_metodo_u]).toEqual([161, 197, -418]);
    expect(ind("f3").pct_sobre_corregida).toBeCloseTo(-0.36, 2);
    expect(ind("f3").pct_sobre_real).toBeCloseTo(24.55, 2);
    expect(esfuerzoGM(22620, [10300, 6600, 5100])).toBeCloseTo(2.82, 2);
    expect(banderasEsfuerzo(2.82)).toEqual([]);
    const orden = ordenarPorContraMetodo([
      { clave: "k1", contra_metodo_u: 161 },
      { clave: "k2", contra_metodo_u: 197 },
      { clave: "k3", contra_metodo_u: -418 },
    ]);
    expect(orden.map((f) => f.clave)).toEqual(["k3", "k2", "k1"]);
  });

  it("banderas del GM: meta_exigente desde +10 % y meta_holgada desde −5 %", () => {
    expect(banderasEsfuerzo(10)).toEqual(["meta_exigente"]);
    expect(banderasEsfuerzo(9.99)).toEqual([]);
    expect(banderasEsfuerzo(-5)).toEqual(["meta_holgada"]);
    expect(banderasEsfuerzo(-4.99)).toEqual([]);
    expect(banderasEsfuerzo(null)).toEqual([]);
    expect(esfuerzoGM(100, [null, null])).toBeNull();
  });

  it("niveles de brecha y filas forzadas o que ceden", () => {
    expect(nivelBrecha(25)).toBe("muy_forzada");
    expect(nivelBrecha(10)).toBe("forzada");
    expect(nivelBrecha(9.9)).toBe("normal");
    expect(nivelBrecha(-10)).toBe("cede");
    expect(nivelBrecha(null)).toBe("normal");
    expect(contarForzadas([30, 12, 0, -11, null, -9])).toEqual({ forzadas: 2, ceden: 1 });
  });

  it("brecha extrema fuera de [0,5, 2] y con natural 0", () => {
    expect(avisoBrechaExtrema(1000, 2100)).toBe("brecha_extrema");
    expect(avisoBrechaExtrema(1000, 499)).toBe("brecha_extrema");
    expect(avisoBrechaExtrema(1000, 500)).toBeNull();
    expect(avisoBrechaExtrema(1000, 0)).toBe("brecha_extrema");
    expect(avisoBrechaExtrema(0, 0)).toBeNull();
    expect(avisoBrechaExtrema(1000, null)).toBeNull();
  });
});

describe("R5 · ejemplo B: fijar una fila mueve las demás libres", () => {
  it("f1 fijada en 11 500 → 6 368 · 4 752 y el GM sigue sumando", () => {
    const filas = filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, decidido: 11500, vigente: 11500 } : f));
    const p = planA(filas);
    expect(p.meta?.meta_libre).toBe(11120);
    const a = asignarMeta(p.meta?.meta_libre ?? null, [peso("f2", "k2", 6480, 6700), peso("f3", "k3", 5400, 5000)]);
    expect([...(a.a ?? [])]).toEqual([["f2", 6368], ["f3", 4752]]);
    expect((p.meta?.fijas ?? 0) + 6368 + 4752).toBe(26006);
  });

  it("f1 fijada en 25 000: Meta_libre < 0, sin cifra y aviso fijadas_exceden_meta", () => {
    const filas = filasMetaA().map((f) => (f.fila_id === "f1" ? { ...f, decidido: 25000, vigente: 25000 } : f));
    const p = planA(filas);
    expect(p.meta?.meta_libre).toBe(-2380);
    expect(p.avisos).toContain("fijadas_exceden_meta");
    const a = asignarMeta(p.meta?.meta_libre ?? null, [peso("f2", "k2", 6480, 6700), peso("f3", "k3", 5400, 5000)]);
    expect(a.a).toBeNull();
    expect(a.avisos_gm).toEqual(["fijadas_exceden_meta"]);
  });
});

describe("R6 · Resto, provisional y sin meta", () => {
  it("ejemplo F: cada GM del Resto recibe su meta con el % del Resto", () => {
    const ninoUrbano = planMeta({
      filas: [fm({ fila_id: "a", clave: "a", propuesto: 1050, base: 1000, base_corregida: 1000, vigente: 1050 }), fm({ fila_id: "b", clave: "b", propuesto: 525, base: 500, base_corregida: 500, vigente: 525 })],
      g: 5,
      sobre_base: "corregida",
      fuente: "resto",
      crecimiento_id: "r1",
      version: 1,
      opciones: OPCIONES_META,
    });
    expect(ninoUrbano.meta?.meta_gm).toBe(1575);
    expect(ninoUrbano.meta?.fuente).toBe("resto");
    const ninaCasual = planMeta({
      filas: [fm({ fila_id: "c", clave: "c", propuesto: 841, base: 801, base_corregida: 801, vigente: 841 })],
      g: 5,
      sobre_base: "corregida",
      fuente: "resto",
      crecimiento_id: "r1",
      version: 1,
      opciones: { umbral_cola_larga: 10, incluir_cola_larga: false },
    });
    expect(ninaCasual.meta?.meta_gm).toBe(841);
  });

  it("Resto provisional → aviso meta_provisional", () => {
    const p = planA(filasMetaA(), { fuente: "resto_provisional", crecimiento_id: null, version: null });
    expect(p.avisos).toContain("meta_provisional");
    expect(p.meta?.fuente).toBe("resto_provisional");
  });

  it("sin g no hay meta ni reparto, solo natural y razones", () => {
    const p = planA(filasMetaA(), { g: null });
    expect(p.meta).toBeNull();
    expect(asignarMeta(p.meta?.meta_libre ?? null, [peso("f1", "k1", 1, null)]).a).toBeNull();
  });

  it("una fila sin base se cuenta fuera de la meta", () => {
    const p = planA([...filasMetaA(), fm({ fila_id: "f6", clave: "k6", propuesto: null, vigente: 40 })]);
    expect(p.meta?.fuera_base).toEqual({ filas: 1, unidades: 40 });
    expect(p.meta?.meta_gm).toBe(26006);
    expect(p.estados.get("f6")).toBe("sin_base");
  });
});

describe("R1 · asignarMeta", () => {
  it("propiedad (1 000 casos con semilla): Σ A = Meta_libre y A ≥ 0 para cualquier conjunto de pesos", () => {
    const azar = crearAleatorio(12345);
    for (let caso = 0; caso < 1000; caso++) {
      const n = 1 + Math.floor(azar() * 12);
      const filas: PesoFilaMeta[] = Array.from({ length: n }, (_, i) => {
        const tipo = azar();
        const modelo = tipo < 0.2 ? null : tipo < 0.3 ? 0 : Math.floor(azar() * 20000);
        return peso(`f${i}`, `k${String(i).padStart(2, "0")}`, Math.floor(azar() * 5000), modelo, { natural_y1: azar() < 0.5 ? null : Math.floor(azar() * 100), base_s: azar() < 0.5 ? null : Math.floor(azar() * 100) });
      });
      const meta = Math.floor(azar() * 50000);
      const a = asignarMeta(meta, filas).a;
      expect(a).not.toBeNull();
      const valores = [...(a?.values() ?? [])];
      expect(valores.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
      expect(valores.reduce((x, y) => x + y, 0)).toBe(meta);
    }
  });

  it("un peso nulo toma P^GM y nunca da A = 0 por ser nulo (I3)", () => {
    const r = asignarMeta(1000, [peso("a", "a", 600, null), peso("b", "b", 400, 400)]);
    expect(r.a?.get("a")).toBe(600);
    expect(r.a?.get("b")).toBe(400);
    expect(r.avisos_fila.get("a")).toEqual(["sin_propuesta_ia"]);
    expect(r.avisos_fila.has("b")).toBe(false);
  });

  it("empate: la unidad que sobra va al primero por clave, sin importar el orden recibido", () => {
    const filas = [peso("z", "k3", 1, 1), peso("y", "k2", 1, 1), peso("x", "k1", 1, 1)];
    const r = asignarMeta(100, filas).a;
    expect([r?.get("x"), r?.get("y"), r?.get("z")]).toEqual([34, 33, 33]);
  });

  it("cadena de respaldo: modelo → P^GM → natural → B^s → pesos iguales", () => {
    const conPesosCero = (extra: (i: number) => Partial<PesoFilaMeta>) => [0, 1, 2].map((i) => peso(`f${i}`, `k${i}`, 0, null, extra(i)));
    expect([...(asignarMeta(60, conPesosCero((i) => ({ natural_y1: [10, 20, 30][i] }))).a ?? [])].map(([, v]) => v)).toEqual([10, 20, 30]);
    expect([...(asignarMeta(60, conPesosCero((i) => ({ base_s: [30, 20, 10][i] }))).a ?? [])].map(([, v]) => v)).toEqual([30, 20, 10]);
    expect([...(asignarMeta(60, conPesosCero(() => ({}))).a ?? [])].map(([, v]) => v)).toEqual([20, 20, 20]);
  });

  it("una sola fila libre recibe toda la meta sin importar su peso", () => {
    expect(asignarMeta(777, [peso("a", "a", 5, 1)]).a?.get("a")).toBe(777);
  });

  it("sin filas libres: mapa vacío; sin meta: null", () => {
    expect(asignarMeta(100, []).a?.size).toBe(0);
    expect(asignarMeta(null, [peso("a", "a", 5, 1)]).a).toBeNull();
  });
});

describe("R28 · modo jerárquico: sub-metas por línea", () => {
  it("Σ sub-metas = Meta_libre; escaladas por línea y aplanadas al leer, Σ = Meta_libre", () => {
    const metaLibre = 12345;
    const lineas = [peso("l01", "l01", 5000, 5200), peso("l02", "l02", 4000, null), peso("l03", "l03", 3345, 3000)];
    const sub = subMetasPorLinea(metaLibre, lineas);
    expect([...(sub?.values() ?? [])].reduce((x, y) => x + y, 0)).toBe(metaLibre);
    expect(sub?.get("l02")).toBeGreaterThan(0);

    const filas = [
      { ...peso("a", "ka", 2000, 2100), l: "l01" },
      { ...peso("b", "kb", 3000, 3100), l: "l01" },
      { ...peso("c", "kc", 4000, null), l: "l02" },
      { ...peso("d", "kd", 3345, 2900), l: "l03" },
    ];
    const escalado = escalarASubMetas(sub ?? new Map(), filas);
    for (const l of ["l01", "l02", "l03"]) {
      const delaLinea = filas.filter((f) => f.l === l).map((f) => escalado.get(f.fila_id) ?? 0);
      expect(delaLinea.reduce((x, y) => x + y, 0)).toBe(sub?.get(l));
    }
    // Al leer, el peso guardado ya está escalado: `asignarMeta` sobre el GM entero da Σ = Meta_libre.
    const plano = asignarMeta(metaLibre, filas.map((f) => ({ ...f, meta_y1_modelo: escalado.get(f.fila_id) ?? null })));
    expect([...(plano.a?.values() ?? [])].reduce((x, y) => x + y, 0)).toBe(metaLibre);
    // Sin cambios en la meta ni en las fijas, el GM entero reproduce las sub-metas.
    expect([...(plano.a?.entries() ?? [])].map(([id, v]) => [id, v])).toEqual([...escalado.entries()].map(([id, v]) => [id, v]));
  });
});
