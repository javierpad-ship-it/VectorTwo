import { describe, expect, it } from "vitest";
import {
  aCurvaAprobada,
  aCurvaVigente,
  armarComparador,
  curvaDeFila,
  esModeloCurva,
  extrasDeCurva,
  filaCurva,
  huellasDeCurva,
  motivoRechazoAprobar,
  notaRequeridaPor,
  parametrosDeJson,
  parametrosIniciales,
  resumenParametros,
  versionesDeAgrupacion,
  type EntradaRechazoAprobar,
} from "@/lib/curvas/reglas";
import { huellaCargas } from "@/lib/curvas/huellas";
import { VERSION_MODELO } from "@/lib/curvas/modelo";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";
import type { Tables } from "@/lib/supabase/database.types";
import { ABRIGO_ID, PEQUENA_ID, agrupacionDe, corridaFixture, parametros } from "./curvas.fixture";

const salida = corridaFixture("base");
const escasa = corridaFixture("escasa");
const sinBloqueo = { bloquea: [], avisa: [] };
const TEMP = (s: ReturnType<typeof corridaFixture>, t = "invierno") => s.resultado.temporadas.find((x) => x.temporada === t) ?? null;

function entrada(extra: Partial<EntradaRechazoAprobar> = {}): EntradaRechazoAprobar {
  return {
    agrupacion: { id: ABRIGO_ID, activo: true },
    prerrequisitos: sinBloqueo,
    resultado: agrupacionDe(salida, ABRIGO_ID),
    temporada: TEMP(salida),
    modelo: "A",
    huella_enviada: "h1",
    huella_actual: "h1",
    vigente: null,
    version_vigente: null,
    parametros: parametros(),
    nota: undefined,
    ...extra,
  };
}

describe("regla 41 · motivoRechazoAprobar (en este orden)", () => {
  it("sin nada raro → null", () => {
    expect(motivoRechazoAprobar(entrada())).toBeNull();
  });
  it("agrupación inexistente → 404; inactiva → 409 agrupacion_inactiva", () => {
    expect(motivoRechazoAprobar(entrada({ agrupacion: null }))).toMatchObject({ status: 404 });
    expect(motivoRechazoAprobar(entrada({ agrupacion: { id: ABRIGO_ID, activo: false } }))).toMatchObject({ status: 409, codigo: "agrupacion_inactiva" });
  });
  it("algún prerrequisito que bloquea → 409 prerrequisitos (con el detalle)", () => {
    const p = { bloquea: [{ codigo: "periodos_temporada_faltantes" as const, nivel: "bloquea" as const, detalle: "No hay periodos.", enlace: null }], avisa: [] };
    const r = motivoRechazoAprobar(entrada({ prerrequisitos: p }));
    expect(r).toMatchObject({ status: 409, codigo: "prerrequisitos" });
    expect(r?.mensaje).toContain("No hay periodos.");
  });
  it("origen null (ni propias ni T) → 409 sin_curva_posible", () => {
    const sinCurva = { ...agrupacionDe(salida, ABRIGO_ID), origen: null, recomendada: null };
    expect(motivoRechazoAprobar(entrada({ resultado: sinCurva }))).toMatchObject({ status: 409, codigo: "sin_curva_posible" });
    expect(motivoRechazoAprobar(entrada({ resultado: null }))).toMatchObject({ codigo: "sin_curva_posible" });
  });
  it("candidata sin curva, o T sin curva_T → 409 candidata_no_disponible", () => {
    const e = corridaFixture("escasa");
    const pq = agrupacionDe(e, PEQUENA_ID);
    expect(pq.origen).toBe("prestada");
    expect(motivoRechazoAprobar(entrada({ agrupacion: { id: PEQUENA_ID, activo: true }, resultado: pq, temporada: TEMP(e, "todo_el_ano"), modelo: "B" }))).toMatchObject({ codigo: "candidata_no_disponible" });
    expect(motivoRechazoAprobar(entrada({ agrupacion: { id: PEQUENA_ID, activo: true }, resultado: pq, temporada: TEMP(e, "todo_el_ano"), modelo: "T", nota: undefined }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ modelo: "T", temporada: { curva_T: null } }))).toMatchObject({ codigo: "candidata_no_disponible" });
  });
  it("huella enviada ≠ recalculada → 409 datos_cambiados", () => {
    expect(motivoRechazoAprobar(entrada({ huella_enviada: "otra" }))).toMatchObject({ status: 409, codigo: "datos_cambiados" });
  });
  it("regla 54 · version_vigente distinta de la vigente de hoy → 409 vigente_cambiada (incluido null con vigente y número sin vigente)", () => {
    const v = (version: number) => ({ version, modelo: "B", huella_calculo: "x" });
    expect(motivoRechazoAprobar(entrada({ vigente: v(2), version_vigente: 1 }))).toMatchObject({ codigo: "vigente_cambiada" });
    expect(motivoRechazoAprobar(entrada({ vigente: v(2), version_vigente: null }))).toMatchObject({ codigo: "vigente_cambiada" });
    expect(motivoRechazoAprobar(entrada({ vigente: null, version_vigente: 1 }))).toMatchObject({ codigo: "vigente_cambiada" });
    expect(motivoRechazoAprobar(entrada({ vigente: v(2), version_vigente: 2 }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ vigente: null, version_vigente: null }))).toBeNull();
  });
  it("misma candidata y misma huella que la vigente → 409 sin_cambio; otra candidata o huella distinta pasa", () => {
    const v = { version: 1, modelo: "A", huella_calculo: "h1" };
    expect(motivoRechazoAprobar(entrada({ vigente: v, version_vigente: 1 }))).toMatchObject({ codigo: "sin_cambio" });
    expect(motivoRechazoAprobar(entrada({ vigente: v, version_vigente: 1, modelo: "B", nota: "porque sí" }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ vigente: { ...v, huella_calculo: "h0" }, version_vigente: 1 }))).toBeNull();
    expect(motivoRechazoAprobar(entrada({ vigente: { ...v, huella_calculo: null }, version_vigente: 1 }))).toBeNull();
  });
  it("regla 57 · nota obligatoria en tres casos: otra candidata, años o tiendas excluidos, tratamiento distinto de auto", () => {
    expect(motivoRechazoAprobar(entrada({ modelo: "B" }))).toMatchObject({ status: 409, codigo: "nota_requerida" });
    expect(motivoRechazoAprobar(entrada({ parametros: parametros({ anios_excluidos: [2023] }) }))).toMatchObject({ codigo: "nota_requerida" });
    expect(motivoRechazoAprobar(entrada({ parametros: parametros({ tiendas_excluidas: ["t3"] }) }))).toMatchObject({ codigo: "nota_requerida" });
    expect(motivoRechazoAprobar(entrada({ parametros: parametros({ tratamiento_atipicos: "descartar" }) }))).toMatchObject({ codigo: "nota_requerida" });
    expect(motivoRechazoAprobar(entrada({ parametros: parametros({ tratamiento_atipicos: "descartar" }), nota: "   " }))).toMatchObject({ codigo: "nota_requerida" });
    for (const extra of [{ modelo: "B" as const }, { parametros: parametros({ anios_excluidos: [2023] }) }, { parametros: parametros({ tiendas_excluidas: ["t3"] }) }, { parametros: parametros({ tratamiento_atipicos: "imputar" }) }]) {
      expect(motivoRechazoAprobar(entrada({ ...extra, nota: "explicación" }))).toBeNull();
    }
  });
  it("el mensaje de nota_requerida dice cuál de los casos es", () => {
    expect(notaRequeridaPor("B", "A", PARAMETROS_POR_DEFECTO)).toContain("elegiste B");
    expect(notaRequeridaPor("A", "A", { ...PARAMETROS_POR_DEFECTO, anios_excluidos: [2023] })).toContain("2023");
    expect(notaRequeridaPor("A", "A", { ...PARAMETROS_POR_DEFECTO, tiendas_excluidas: ["x", "y"] })).toContain("2 tiendas");
    expect(notaRequeridaPor("A", "A", { ...PARAMETROS_POR_DEFECTO, tratamiento_atipicos: "incluir" })).toContain("incluir");
    expect(notaRequeridaPor("A", "A", PARAMETROS_POR_DEFECTO)).toBeNull();
  });
  it("esModeloCurva acepta A a F y T; rechaza G, H, vacío, 3, «a», «AB» y la U (que no es una candidata)", () => {
    for (const m of ["A", "B", "C", "D", "E", "F", "T"]) expect(esModeloCurva(m)).toBe(true);
    for (const m of ["G", "H", "", 3, "a", "AB", "U"]) expect(esModeloCurva(m)).toBe(false);
  });
});

describe("regla 53 · parámetros iniciales", () => {
  it("copia los parámetros de la foto y NUNCA su hasta_periodo: arranca en el defecto de hoy", () => {
    const foto = { parametros: { ...parametros({ anios_excluidos: [2023], umbral_forma: 5 }), hasta_periodo: "2026-07" } as never };
    const r = parametrosIniciales(foto, ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "2026-10-15");
    expect(r.parametros).toMatchObject({ anios_excluidos: [2023], umbral_forma: 5 });
    expect(r.parametros).not.toHaveProperty("hasta_periodo");
    expect(r.hasta_periodo).toBe("2026-09");
  });
  it("sin aprobación, los valores por defecto; sin meses cerrados, hasta null", () => {
    const r = parametrosIniciales(null, [], "2026-10-15");
    expect(r.parametros).toEqual(PARAMETROS_POR_DEFECTO);
    expect(r.hasta_periodo).toBeNull();
  });
  it("parametrosDeJson completa lo que falta (fotos de la 0.9.6) y descarta lo mal tipado", () => {
    const p = parametrosDeJson({ umbral_forma: 7, anios_excluidos: "no", tiendas_excluidas: ["a", 3], meses_tienda_nueva: "x" });
    expect(p.umbral_forma).toBe(7);
    expect(p.anios_excluidos).toEqual([]);
    expect(p.tiendas_excluidas).toEqual(["a"]);
    expect(p.meses_tienda_nueva).toBe(0);
    expect(p.sin_periodos_confirmado).toBe(false);
  });
});

describe("reglas 27 y 42 · filaCurva", () => {
  const a = agrupacionDe(salida, ABRIGO_ID);
  const base = {
    agrupacion: a,
    temporada: salida.resultado.temporadas.find((t) => t.temporada === "invierno") ?? null,
    corrida_id: "corrida-1",
    red_huella: "red-md5",
    cargas_huella: huellaCargas({ "2026-01": "c1" }),
    foto: {
      huella_calculo: "h-calculo",
      huella_temporada: "h-temporada",
      version_modelo: VERSION_MODELO,
      hasta_periodo: "2026-09",
      hasta_fue_por_defecto: true,
      parametros: parametros({ anios_excluidos: [2023] }),
    },
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
  it("T copia la curva de la temporada: origen prestada y, desde la 06c, el EAT de su backtesting", () => {
    const f = filaCurva({ ...base, modelo: "T" })!;
    const t = base.agrupacion.candidatas.find((c) => c.modelo === "T")!;
    expect(f).toMatchObject({ modelo: "T", origen: "prestada", origen_curva: "sistema", curva_manual: null, recomendada: false });
    expect(f.eat).toBeCloseTo(t.eat as number, 2);
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
  it("regla 42 · anios_utilizados lleva además huella_calculo, huella_temporada, version_modelo, hasta, recomendada_entonces, anios_ajuste, exclusiones y parámetros", () => {
    const f = filaCurva({ ...base, modelo: "B" })!;
    const x = extrasDeCurva(f.anios_utilizados);
    expect(x).toMatchObject({ huella_calculo: "h-calculo", hasta_periodo: "2026-09", hasta_fue_por_defecto: true, version_modelo: VERSION_MODELO, recomendada_entonces: "A" });
    expect(x.anios_ajuste).toEqual(a.anios.filter((y) => y.en_ajuste).map((y) => y.anio));
    expect(x.parametros!.anios_excluidos).toEqual([2023]);
    const au = f.anios_utilizados as Record<string, unknown>;
    expect(au.huella_temporada).toBe("h-temporada");
    expect(au.sin_periodos_confirmado).toBe(false);
    expect(au.anios_excluidos).toEqual([2023]);
    expect(au.tiendas_excluidas).toEqual([]);
    expect(f.corrida_id).toBe("corrida-1");
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

describe("mapeo de filas a la API", () => {
  const fila = {
    id: "c1",
    agrupacion_estacionalidad_id: "g1",
    version: 2,
    estado: "vigente",
    corrida_id: "k1",
    modelo: "A",
    origen: "propia",
    origen_curva: "sistema",
    curva_manual: null,
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

describe("regla 43 · versionesDeAgrupacion", () => {
  const f = (version: number, estado: string, parametrosGuardados: unknown = null) =>
    ({
      id: `c${version}`,
      agrupacion_estacionalidad_id: "g1",
      version,
      estado,
      corrida_id: `foto-${version}`,
      modelo: "A",
      origen: "propia",
      recomendada: true,
      eat: 10,
      error_max: 3,
      anios_utilizados: parametrosGuardados ? { parametros: parametrosGuardados, recomendada_entonces: "A" } : {},
      p01: 0.1, p02: 0.1, p03: 0.1, p04: 0.1, p05: 0.1, p06: 0.1, p07: 0.1, p08: 0.1, p09: 0.1, p10: 0.1, p11: 0, p12: 0,
      medida: "unidades", perfil_id: null, usuario_nombre: "Javier", aprobada_at: "2026-10-14T10:00:00Z", nota: null, activo: true, created_at: "x", updated_at: "x",
    }) as Tables<"curvas_estacionalidad">;
  it("ordena por version descendente, a lo sumo una vigente, foto_id = corrida_id", () => {
    const v = versionesDeAgrupacion([f(1, "reemplazada"), f(3, "vigente"), f(2, "reemplazada")]);
    expect(v.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(v.filter((x) => x.estado === "vigente")).toHaveLength(1);
    expect(v.map((x) => x.foto_id)).toEqual(["foto-3", "foto-2", "foto-1"]);
  });
  it("parametros_resumen lista solo los parámetros distintos del valor por defecto", () => {
    const [v] = versionesDeAgrupacion([f(1, "vigente", { ...PARAMETROS_POR_DEFECTO, anios_excluidos: [2023], umbral_forma: 5, tratamiento_atipicos: "descartar" })]);
    expect(v.parametros_resumen).toEqual(["años excluidos: 2023", "tratamiento del Niño: descartar", "piso de forma: 5"]);
    const [w] = versionesDeAgrupacion([f(1, "vigente", PARAMETROS_POR_DEFECTO)]);
    expect(w.parametros_resumen).toEqual([]);
    expect(resumenParametros(PARAMETROS_POR_DEFECTO)).toEqual([]);
  });
});
