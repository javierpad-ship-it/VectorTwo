import { describe, expect, it } from "vitest";
import {
  calcularSchema,
  crearPeriodoAtipicoSchema,
  editarPeriodoAtipicoSchema,
  elegirCurvaSchema,
  leerConsultaRed,
  leerCorridaId,
  marcarReferenciaSchema,
  parametrosDeCuerpo,
} from "@/lib/curvas/esquemas";
import { PARAMETROS_POR_DEFECTO } from "@/lib/curvas/tipos-api";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const params = (obj: Record<string, string>) => new URLSearchParams(obj);

describe("regla 29 · calcularSchema", () => {
  it("con {} aplica todos los valores por defecto de la ficha", () => {
    const r = calcularSchema.parse({});
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
      marcar_referencia: false,
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
      { marcar_referencia: 1 },
    ];
    for (const m of malos) {
      const r = calcularSchema.safeParse(m);
      expect(r.success, JSON.stringify(m)).toBe(false);
      if (!r.success) expect(r.error.issues[0].message.length).toBeGreaterThan(5);
    }
  });
  it("NO acepta medida, referencia_volumen ni umbral_sustitucion: se ignoran y nunca llegan a los parámetros guardados", () => {
    const r = calcularSchema.parse({ medida: "venta_soles", referencia_volumen: "promedio", umbral_sustitucion: 0.5, umbral_forma: 5 });
    const guardados = parametrosDeCuerpo(r);
    const texto = JSON.stringify({ r, guardados });
    expect(texto).not.toMatch(/medida|referencia_volumen|umbral_sustitucion/);
    expect(guardados.umbral_forma).toBe(5);
  });
  it("hasta_periodo y marcar_referencia no forman parte de los parámetros guardados", () => {
    const g = parametrosDeCuerpo(calcularSchema.parse({ hasta_periodo: "2026-08", marcar_referencia: true }));
    expect(Object.keys(g)).not.toContain("hasta_periodo");
    expect(Object.keys(g)).not.toContain("marcar_referencia");
  });
});

describe("regla 29 · elegirCurvaSchema y marcarReferenciaSchema", () => {
  it("acepta A a E y T; rechaza F, G, H y cualquier otro", () => {
    for (const m of ["A", "B", "C", "D", "E", "T"]) expect(elegirCurvaSchema.safeParse({ corrida_id: UUID, modelo: m }).success).toBe(true);
    for (const m of ["F", "G", "H", "a", "", "AB"]) expect(elegirCurvaSchema.safeParse({ corrida_id: UUID, modelo: m }).success, m).toBe(false);
  });
  it("exige corrida_id UUID y limita la nota a 300 caracteres (recortada)", () => {
    expect(elegirCurvaSchema.safeParse({ corrida_id: "no", modelo: "A" }).success).toBe(false);
    expect(elegirCurvaSchema.safeParse({ modelo: "A" }).success).toBe(false);
    expect(elegirCurvaSchema.safeParse({ corrida_id: UUID, modelo: "A", nota: "x".repeat(301) }).success).toBe(false);
    expect(elegirCurvaSchema.parse({ corrida_id: UUID, modelo: "B", nota: "  me gusta  " }).nota).toBe("me gusta");
  });
  it("marcarReferenciaSchema solo acepta { referencia: true }", () => {
    expect(marcarReferenciaSchema.safeParse({ referencia: true }).success).toBe(true);
    expect(marcarReferenciaSchema.safeParse({ referencia: false }).success).toBe(false);
    expect(marcarReferenciaSchema.safeParse({}).success).toBe(false);
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
  it("leerCorridaId: vacío → la de referencia; no UUID → 404", () => {
    expect(leerCorridaId(params({}))).toEqual({ corridaId: null, rechazo: null });
    expect(leerCorridaId(params({ corrida_id: UUID }))).toEqual({ corridaId: UUID, rechazo: null });
    expect(leerCorridaId(params({ corrida_id: "x" })).rechazo?.status).toBe(404);
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
