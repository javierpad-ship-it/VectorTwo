import { describe, expect, it } from "vitest";
import {
  aCurvaAprobada,
  aCurvaVigente,
  armarComparador,
  corridaDeReferencia,
  curvaDeFila,
  esModeloCurva,
  filaCurva,
  huellasDeCurva,
  motivoRechazoElegir,
  planificarReferencia,
} from "@/lib/curvas/reglas";
import { huellaCargas } from "@/lib/curvas/huellas";
import type { Tables } from "@/lib/supabase/database.types";
import { ABRIGO_ID, PEQUENA_ID, agrupacionDe, corridaFixture } from "./curvas.fixture";

const salida = corridaFixture("base");
const escasa = corridaFixture("escasa");
const corrida = (s: ReturnType<typeof corridaFixture>, id = "corrida-1") => ({ id, resultado: s.resultado });
const agr = (activo = true, id = ABRIGO_ID) => ({ id, activo });

describe("regla 26 · motivoRechazoElegir", () => {
  it("agrupación o corrida inexistente → 404", () => {
    expect(motivoRechazoElegir(null, corrida(salida), "A")).toMatchObject({ status: 404 });
    expect(motivoRechazoElegir(agr(), null, "A")).toMatchObject({ status: 404 });
  });
  it("agrupación inactiva → 409", () => {
    expect(motivoRechazoElegir(agr(false), corrida(salida), "A")).toMatchObject({ status: 409, codigo: "agrupacion_inactiva" });
  });
  it("candidata no disponible → 409 candidata_no_disponible (E sin curva, agrupación fuera de la corrida)", () => {
    const sinE = corrida(corridaFixture("base"));
    // En ABRIGO la candidata E existe (igual a A); se simula una agrupación que la corrida no conoce.
    expect(motivoRechazoElegir(agr(true, "otra"), sinE, "A")).toMatchObject({ status: 409, codigo: "candidata_no_disponible" });
    expect(motivoRechazoElegir(agr(true, PEQUENA_ID), corrida(escasa), "B")).toMatchObject({ status: 409, codigo: "candidata_no_disponible" });
  });
  it("T solo si la temporada tiene curva en esa corrida", () => {
    expect(motivoRechazoElegir(agr(), corrida(salida), "T")).toBeNull();
    const sinT = { id: "c", resultado: { ...salida.resultado, temporadas: salida.resultado.temporadas.map((t) => ({ ...t, curva_T: null })) } };
    expect(motivoRechazoElegir(agr(), sinT, "T")).toMatchObject({ codigo: "candidata_no_disponible" });
    expect(motivoRechazoElegir(agr(true, PEQUENA_ID), corrida(escasa), "T")).toBeNull();
  });
  it("misma corrida y modelo que la vigente → 409 sin_cambio; otro modelo o corrida pasa", () => {
    const vigente = { corrida_id: "corrida-1", modelo: "A" };
    expect(motivoRechazoElegir(agr(), corrida(salida, "corrida-1"), "A", vigente)).toMatchObject({ status: 409, codigo: "sin_cambio" });
    expect(motivoRechazoElegir(agr(), corrida(salida, "corrida-1"), "B", vigente)).toBeNull();
    expect(motivoRechazoElegir(agr(), corrida(salida, "corrida-2"), "A", vigente)).toBeNull();
  });
  it("esModeloCurva rechaza F, G, H", () => {
    for (const m of ["A", "B", "C", "D", "E", "T"]) expect(esModeloCurva(m)).toBe(true);
    for (const m of ["F", "G", "H", "", 3]) expect(esModeloCurva(m)).toBe(false);
  });
});

describe("regla 27 · filaCurva", () => {
  const a = agrupacionDe(salida, ABRIGO_ID);
  const base = {
    agrupacion: a,
    temporada: salida.resultado.temporadas.find((t) => t.temporada === "invierno") ?? null,
    corrida_id: "corrida-1",
    resumen: { red_huella: "red-md5" },
    cargas_huella: huellaCargas({ "2026-01": "c1" }),
    version_anterior: 0,
    perfil: { id: "p1", nombre: "Javier" },
  };
  it("copia la curva elegida, recomendada, origen propia, medida unidades, eat y error_max, versión 1", () => {
    const f = filaCurva({ ...base, modelo: "B" })!;
    const b = a.candidatas.find((c) => c.modelo === "B")!;
    expect(f).toMatchObject({ modelo: "B", origen: "propia", recomendada: false, medida: "unidades", version: 1, estado: "vigente", corrida_id: "corrida-1" });
    expect(f.eat).toBeCloseTo(b.eat!, 2);
    expect(f.error_max).toBeCloseTo(b.error_max!, 2);
    const p = [f.p01, f.p02, f.p03, f.p04, f.p05, f.p06, f.p07, f.p08, f.p09, f.p10, f.p11, f.p12];
    expect(p.reduce((s, v) => s + Math.round(v * 1e6), 0)).toBe(1_000_000);
    expect(filaCurva({ ...base, modelo: "A" })?.recomendada).toBe(true);
  });
  it("versión = anterior + 1 y la nota se recorta (vacía → null)", () => {
    expect(filaCurva({ ...base, modelo: "A", version_anterior: 2, nota: "  prefiero A  " })).toMatchObject({ version: 3, nota: "prefiero A" });
    expect(filaCurva({ ...base, modelo: "A", nota: "   " })?.nota).toBeNull();
  });
  it("T copia la curva de la temporada: origen prestada, eat y error_max nulos", () => {
    const f = filaCurva({ ...base, modelo: "T" })!;
    expect(f).toMatchObject({ modelo: "T", origen: "prestada", eat: null, error_max: null, recomendada: false });
    expect(f.p01).toBeCloseTo(base.temporada!.curva_T![0], 6);
  });
  it("anios_utilizados lleva los años, la composición y las tres huellas", () => {
    const f = filaCurva({ ...base, modelo: "A" })!;
    const au = f.anios_utilizados as Record<string, unknown>;
    expect((au.anios as unknown[]).length).toBe(a.anios.length);
    expect(au.red_huella).toBe("red-md5");
    expect(au.cargas_huella).toBe(base.cargas_huella);
    expect(au.composicion).toEqual({ equivalencias: 10, huella: "huella-abrigo" });
    expect(huellasDeCurva(f.anios_utilizados)).toEqual({ composicion: "huella-abrigo", red_huella: "red-md5", cargas_huella: base.cargas_huella });
  });
  it("sin curva (candidata nula o T sin temporada) devuelve null", () => {
    expect(filaCurva({ ...base, agrupacion: agrupacionDe(escasa, PEQUENA_ID), modelo: "B" })).toBeNull();
    expect(filaCurva({ ...base, modelo: "T", temporada: null })).toBeNull();
  });
  it("huellasDeCurva tolera datos viejos o vacíos", () => {
    expect(huellasDeCurva(null)).toEqual({ composicion: "", red_huella: "", cargas_huella: "" });
    expect(huellasDeCurva({ composicion: "abc" })).toMatchObject({ composicion: "abc" });
  });
});

describe("regla 28 · referencia", () => {
  const corridas = [
    { id: "a", created_at: "2026-10-01T00:00:00Z", referencia: false },
    { id: "b", created_at: "2026-10-03T00:00:00Z", referencia: false },
    { id: "c", created_at: "2026-10-02T00:00:00Z", referencia: true },
  ];
  it("la de referencia es la marcada; sin ninguna, la última por created_at", () => {
    expect(corridaDeReferencia(corridas)?.id).toBe("c");
    expect(corridaDeReferencia(corridas.map((c) => ({ ...c, referencia: false })))?.id).toBe("b");
    expect(corridaDeReferencia([])).toBeNull();
  });
  it("marcar una quita la anterior (a lo sumo una); un id inexistente se detecta", () => {
    expect(planificarReferencia(corridas, "a")).toEqual({ existe: true, quitar: ["c"], marcar: "a" });
    expect(planificarReferencia(corridas, "c")).toEqual({ existe: true, quitar: [], marcar: "c" });
    expect(planificarReferencia(corridas, "zz").existe).toBe(false);
  });
});

describe("mapeo de filas a la API", () => {
  const fila = {
    id: "c1",
    agrupacion_estacionalidad_id: "g1",
    version: 2,
    estado: "vigente",
    corrida_id: "k1",
    modelo: "A",
    origen: "propia",
    recomendada: true,
    eat: "12.34" as unknown as number,
    error_max: 5,
    anios_utilizados: { composicion: { equivalencias: 3, huella: "h" }, red_huella: "r", cargas_huella: "k" },
    p01: 0.1, p02: 0.1, p03: 0.1, p04: 0.1, p05: 0.1, p06: 0.1, p07: 0.1, p08: 0.1, p09: 0.1, p10: 0.1, p11: 0, p12: 0,
    medida: "unidades",
    perfil_id: null,
    usuario_nombre: "Javier",
    aprobada_at: "2026-10-14T10:00:00Z",
    nota: null,
    activo: true,
    created_at: "x",
    updated_at: "x",
  } as Tables<"curvas_estacionalidad">;
  it("curvaDeFila lee p01…p12 y las numeric llegan como número", () => {
    expect(curvaDeFila(fila)).toHaveLength(12);
    expect(aCurvaAprobada(fila).eat).toBe(12.34);
  });
  it("aCurvaVigente trae la curva acumulada que termina en 1, la versión y las huellas", () => {
    const v = aCurvaVigente(fila, { codigo: "ABR", nombre: "ABRIGO" });
    expect(v).toMatchObject({ curva_id: "c1", version: 2, huellas: { composicion: "h", red_huella: "r", cargas_huella: "k" } });
    expect(v.acumulada).toHaveLength(12);
    expect(v.acumulada[11]).toBe(1);
    for (let i = 1; i < 12; i++) expect(v.acumulada[i]).toBeGreaterThanOrEqual(v.acumulada[i - 1]);
  });
});

describe("comparador vigente / propuesta", () => {
  it("diferencia mes a mes en puntos, EAT entre ambas y el mes que más cambia", () => {
    const vigente = Array(12).fill(1 / 12);
    const propuesta = vigente.map((v, m) => (m === 0 ? v + 0.018 : m === 1 ? v - 0.018 : v));
    const c = armarComparador("B", { curva: propuesta, eat: 10 }, { modelo: "A", curva: vigente, eat: 10 });
    expect(c.diferencia_por_mes[0]).toBeCloseTo(1.8, 6);
    expect(c.diferencia_por_mes[1]).toBeCloseTo(-1.8, 6);
    expect(c.mes_mayor_cambio).toBe(1);
    expect(c.eat_vs_vigente).toBeCloseTo(3.6, 6);
    expect(c.difiere).toBe(true);
    const igual = armarComparador("A", { curva: vigente, eat: 10 }, { modelo: "A", curva: vigente, eat: 10 });
    expect(igual.eat_vs_vigente).toBe(0);
    expect(igual.difiere).toBe(false);
  });
});
