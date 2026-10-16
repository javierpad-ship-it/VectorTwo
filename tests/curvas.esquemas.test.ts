import { describe, expect, it } from "vitest";
import {
  aprobarCurvaSchema,
  calcularAgrupacionSchema,
  crearPeriodoAtipicoSchema,
  editarPeriodoAtipicoSchema,
  leerConsultaAnios,
  leerConsultaRed,
  parametrosDeCuerpo,
} from "@/lib/curvas/esquemas";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const params = (obj: Record<string, string>) => new URLSearchParams(obj);

describe("regla 44 · calcularAgrupacionSchema", () => {
  it("con {} aplica todos los valores por defecto de la ficha, y los de la 06b", () => {
    const r = calcularAgrupacionSchema.parse({});
    expect(r).toMatchObject({
      tratamiento_atipicos: "auto",
      umbral_forma: 3,
      max_meses_hueco: 4,
      min_unidades_ano: 120,
      umbral_cambio_volumen: 3,
      margen_ruido: 0.25,
      peso_minimo_diagnostico: 0.05,
      meses_tienda_nueva: 0,
      umbral_tienda_dominante: 0.35,
      umbral_liquidacion: 0.15,
      solo_tiendas_completas: true,
      exigir_venta_todo_el_ano: true,
      anios_excluidos: [],
      tiendas_excluidas: [],
      sin_periodos_confirmado: false,
      partir_de_vigente: false,
    });
    expect(r.hasta_periodo).toBeUndefined();
    expect(parametrosDeCuerpo(r)).toEqual(PARAMETROS_POR_DEFECTO);
  });
  it("rechaza lo que está fuera de rango, con mensaje de pantalla", () => {
    const malos: Record<string, unknown>[] = [
      { meses_tienda_nueva: 37 },
      { meses_tienda_nueva: -1 },
      { meses_tienda_nueva: 1.5 },
      { umbral_tienda_dominante: 0.05 },
      { umbral_tienda_dominante: 0.95 },
      { tratamiento_atipicos: "mezclar" },
      { umbral_forma: 0.1 },
      { umbral_forma: 51 },
      { max_meses_hueco: 0 },
      { max_meses_hueco: 7 },
      { min_unidades_ano: -1 },
      { umbral_cambio_volumen: 1 },
      { umbral_cambio_volumen: 11 },
      { margen_ruido: 1.1 },
      { margen_ruido: -0.1 },
      { peso_minimo_diagnostico: 0.6 },
      { umbral_liquidacion: 0.01 },
      { umbral_liquidacion: 0.6 },
      { hasta_periodo: "2026-13" },
      { solo_tiendas_completas: "si" },
      { anios_excluidos: [1999] },
      { anios_excluidos: [2101] },
      { anios_excluidos: [2023.5] },
      { anios_excluidos: Array.from({ length: 21 }, (_, i) => 2000 + i) },
      { tiendas_excluidas: ["no-es-uuid"] },
      { tiendas_excluidas: Array.from({ length: 101 }, () => UUID) },
      { sin_periodos_confirmado: "si" },
      { partir_de_vigente: 1 },
    ];
    for (const m of malos) {
      const r = calcularAgrupacionSchema.safeParse(m);
      expect(r.success, JSON.stringify(m)).toBe(false);
      if (!r.success) expect(r.error.issues[0].message.length).toBeGreaterThan(5);
    }
  });
  it("rechaza claves que no existen: marcar_referencia (de la 0.9.6), medida, referencia_volumen, umbral_sustitucion", () => {
    for (const clave of ["marcar_referencia", "medida", "referencia_volumen", "umbral_sustitucion"]) {
      expect(calcularAgrupacionSchema.safeParse({ [clave]: true }).success, clave).toBe(false);
    }
  });
  it("acepta anios_excluidos (2000–2100, ≤ 20) y tiendas_excluidas (uuid, ≤ 100); los guarda sin repetidos y ordenados", () => {
    const r = calcularAgrupacionSchema.parse({ anios_excluidos: [2024, 2023, 2024], tiendas_excluidas: [UUID, UUID], sin_periodos_confirmado: true });
    const g = parametrosDeCuerpo(r);
    expect(g.anios_excluidos).toEqual([2023, 2024]);
    expect(g.tiendas_excluidas).toEqual([UUID]);
    expect(g.sin_periodos_confirmado).toBe(true);
  });
  it("hasta_periodo y partir_de_vigente no forman parte de los parámetros guardados", () => {
    const g = parametrosDeCuerpo(calcularAgrupacionSchema.parse({ hasta_periodo: "2026-08", partir_de_vigente: true }));
    expect(Object.keys(g)).not.toContain("hasta_periodo");
    expect(Object.keys(g)).not.toContain("partir_de_vigente");
  });
});

describe("regla 44 · aprobarCurvaSchema", () => {
  const completo = { ...PARAMETROS_POR_DEFECTO, hasta_periodo: "2026-09" };
  const base = { modelo: "A", parametros: completo, huella_calculo: "a".repeat(32), version_vigente: null };
  it("acepta A a F y T; rechaza G, H, 3, «a», vacío, «AB»", () => {
    for (const m of ["A", "B", "C", "D", "E", "F", "T"]) expect(aprobarCurvaSchema.safeParse({ ...base, modelo: m }).success, m).toBe(true);
    for (const m of ["G", "H", "a", "", "AB", 3]) expect(aprobarCurvaSchema.safeParse({ ...base, modelo: m }).success, String(m)).toBe(false);
  });
  it("exige huella_calculo de 32 hex, hasta_periodo explícito y parámetros completos", () => {
    expect(aprobarCurvaSchema.safeParse({ ...base, huella_calculo: "xyz" }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, huella_calculo: "A".repeat(32) }).success).toBe(false);
    const { huella_calculo: _h, ...sinHuella } = base;
    void _h;
    expect(aprobarCurvaSchema.safeParse(sinHuella).success).toBe(false);
    const { hasta_periodo: _p, ...sinHasta } = completo;
    void _p;
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: sinHasta }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...completo, hasta_periodo: "2026-13" } }).success).toBe(false);
    // Los defectos de los parámetros se aplican (el planner puede mandar solo lo que cambió y el hasta).
    expect(aprobarCurvaSchema.parse({ ...base, parametros: { hasta_periodo: "2026-09" } }).parametros.umbral_forma).toBe(3);
  });
  it("es estricto: una clave desconocida en la raíz o en parametros es 400", () => {
    expect(aprobarCurvaSchema.safeParse({ ...base, marcar_referencia: true }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...completo, partir_de_vigente: true } }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...completo, medida: "venta_soles" } }).success).toBe(false);
  });
  it("min_unidades_ano tiene tope (10 000 000) y la nota rechaza caracteres de control y de dirección de texto", () => {
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...completo, min_unidades_ano: 10_000_000 } }).success).toBe(true);
    expect(aprobarCurvaSchema.safeParse({ ...base, parametros: { ...completo, min_unidades_ano: 10_000_001 } }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, nota: "dos años\nmalos" }).success).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, nota: "a\u0000b" }).success).toBe(false);
    for (const c of ["\u202E", "\u2066", "\u2069", "\u202A"]) expect(aprobarCurvaSchema.safeParse({ ...base, nota: `texto${c}raro` }).success, c).toBe(false);
    expect(aprobarCurvaSchema.safeParse({ ...base, nota: "Niño 2023: año atípico, ¿sí?" }).success).toBe(true);
  });
  it("los mensajes de rango usan el punto decimal de la pantalla", () => {
    const r = calcularAgrupacionSchema.safeParse({ umbral_tienda_dominante: 0.95 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("El umbral de tienda dominante va de 0.1 a 0.9.");
  });
  it("version_vigente: null o entero ≥ 1; la nota se recorta y no pasa de 300", () => {
    expect(aprobarCurvaSchema.safeParse({ ...base, version_vigente: 2 }).success).toBe(true);
    for (const v of [0, -1, 1.5, "1"]) expect(aprobarCurvaSchema.safeParse({ ...base, version_vigente: v }).success, String(v)).toBe(false);
    const { version_vigente: _v, ...sinVersion } = base;
    void _v;
    expect(aprobarCurvaSchema.safeParse(sinVersion).success).toBe(false);
    expect(aprobarCurvaSchema.parse({ ...base, nota: "  me gusta  " }).nota).toBe("me gusta");
    expect(aprobarCurvaSchema.safeParse({ ...base, nota: "x".repeat(301) }).success).toBe(false);
  });
});

describe("crearPeriodoAtipicoSchema con temporadas", () => {
  const base = { desde: "2023-09", hasta: "2023-12", motivo: "Niño costero 2023 · verano" };
  it("por defecto temporadas = [invierno] y el espejo alcance = invierno", () => {
    expect(crearPeriodoAtipicoSchema.parse(base)).toMatchObject({ temporadas: ["invierno"], alcance: "invierno" });
  });
  it("con temporadas manda ese conjunto y escribe el espejo (las tres → todas)", () => {
    expect(crearPeriodoAtipicoSchema.parse({ ...base, temporadas: ["verano"] })).toMatchObject({ temporadas: ["verano"], alcance: "invierno" });
    expect(crearPeriodoAtipicoSchema.parse({ ...base, temporadas: ["todo_el_ano", "verano", "invierno"] })).toMatchObject({
      temporadas: ["invierno", "verano", "todo_el_ano"],
      alcance: "todas",
    });
  });
  it("solo con alcance (cliente del paso 1) se traduce: todas → las tres; invierno → [invierno]", () => {
    expect(crearPeriodoAtipicoSchema.parse({ ...base, alcance: "todas" })).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" });
    expect(crearPeriodoAtipicoSchema.parse({ ...base, alcance: "invierno" })).toMatchObject({ temporadas: ["invierno"] });
  });
  it("los dos y contradictorios → 400; los dos coherentes valen", () => {
    const r = crearPeriodoAtipicoSchema.safeParse({ ...base, temporadas: ["invierno"], alcance: "todas" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/contradicen/);
    expect(crearPeriodoAtipicoSchema.safeParse({ ...base, temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" }).success).toBe(true);
  });
  it("rechaza temporadas vacías, repetidas, desconocidas o más de tres", () => {
    for (const t of [[], ["invierno", "invierno"], ["otoño"], ["invierno", "verano", "todo_el_ano", "invierno"]]) {
      expect(crearPeriodoAtipicoSchema.safeParse({ ...base, temporadas: t }).success, JSON.stringify(t)).toBe(false);
    }
  });
});

describe("editarPeriodoAtipicoSchema con temporadas", () => {
  it("con temporadas o alcance devuelve siempre los dos (conjunto y espejo); sin ellos, ninguno", () => {
    expect(editarPeriodoAtipicoSchema.parse({ temporadas: ["verano", "invierno"] })).toMatchObject({ temporadas: ["invierno", "verano"], alcance: "invierno" });
    expect(editarPeriodoAtipicoSchema.parse({ alcance: "todas" })).toMatchObject({ temporadas: ["invierno", "verano", "todo_el_ano"], alcance: "todas" });
    const sin = editarPeriodoAtipicoSchema.parse({ activo: false });
    expect(sin.temporadas).toBeUndefined();
    expect(sin.alcance).toBeUndefined();
  });
  it("contradicción → 400; cuerpo vacío → 400", () => {
    expect(editarPeriodoAtipicoSchema.safeParse({ temporadas: ["verano"], alcance: "todas" }).success).toBe(false);
    expect(editarPeriodoAtipicoSchema.safeParse({}).success).toBe(false);
  });
});

describe("lectura de query strings", () => {
  it("leerConsultaAnios: con_volumen es 1/true/0/false; otro valor es 400; por defecto no", () => {
    expect(leerConsultaAnios(params({})).consulta?.con_volumen).toBe(false);
    expect(leerConsultaAnios(params({ con_volumen: "1" })).consulta?.con_volumen).toBe(true);
    expect(leerConsultaAnios(params({ con_volumen: "true", agrupacion_id: UUID })).consulta).toMatchObject({ con_volumen: true, agrupacion_id: UUID });
    expect(leerConsultaAnios(params({ con_volumen: "0" })).consulta?.con_volumen).toBe(false);
    expect(leerConsultaAnios(params({ con_volumen: "quizá" })).rechazo?.status).toBe(400);
  });
  it("leerConsultaRed: lo que falta toma el valor por defecto; lo inválido es 400", () => {
    const vacio = leerConsultaRed(params({}));
    expect(vacio.consulta).toMatchObject({ hasta_periodo: null, parametros: { meses_tienda_nueva: 0, solo_tiendas_completas: true, umbral_forma: 3 } });
    const r = leerConsultaRed(params({ meses_tienda_nueva: "12", solo_tiendas_completas: "false", hasta_periodo: "2026-09", umbral_tienda_dominante: "0.5" }));
    expect(r.consulta).toMatchObject({ hasta_periodo: "2026-09", parametros: { meses_tienda_nueva: 12, solo_tiendas_completas: false, umbral_tienda_dominante: 0.5 } });
    const malos: Record<string, string>[] = [{ meses_tienda_nueva: "99" }, { meses_tienda_nueva: "x" }, { solo_tiendas_completas: "quizá" }, { hasta_periodo: "2026-13" }, { umbral_forma: "0" }];
    for (const mal of malos) expect(leerConsultaRed(params(mal)).rechazo?.status, JSON.stringify(mal)).toBe(400);
  });
});
