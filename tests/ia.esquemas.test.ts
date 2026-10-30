import { describe, expect, it } from "vitest";
import {
  aceptarIaSchema,
  BANDERAS_IA,
  CARACTERES_PROHIBIDOS_IA,
  configuracionSchema,
  ESQUEMAS_SALIDA,
  evaluacionSchema,
  iniciarCorridaSchema,
  jsonSchemaSalida,
  pasoEvaluacionSchema,
  salidaLineasIa,
  salidaNaturalIa,
  salidaRepartoIa,
  terminarCorridaSchema,
  usoQuerySchema,
} from "@/lib/ia/esquemas";
import { MAX_TOTAL } from "@/lib/proyeccion/tipos-api";

/** Esquemas zod de la IA (ficha 07e, §3.1, §3.2 y §3.6). */

const nat = (extra: Record<string, unknown> = {}) => ({ f: "f001", natural_y1: 10, razon_natural: "ok", banderas: [], confianza: "alta", ...extra });
const rep = (extra: Record<string, unknown> = {}) => ({ f: "f001", meta_y1: 10, razon: "ok", banderas: [], ...extra });

describe("salida del proveedor", () => {
  it("natural: acepta lo válido y rechaza lo demás (estricto)", () => {
    expect(salidaNaturalIa.safeParse({ version_salida: 2, filas: [nat()] }).success).toBe(true);
    const mal: Record<string, unknown>[] = [
      { version_salida: 1, filas: [nat()] },
      { version_salida: 2, filas: [nat()], extra: 1 },
      { version_salida: 2, filas: [nat({ extra: 1 })] },
      { version_salida: 2, filas: [nat({ f: "x1" })] },
      { version_salida: 2, filas: [nat({ f: "f01" })] },
      { version_salida: 2, filas: [nat({ f: "f12345" })] },
      { version_salida: 2, filas: [nat({ natural_y1: -1 })] },
      { version_salida: 2, filas: [nat({ natural_y1: 1.5 })] },
      { version_salida: 2, filas: [nat({ natural_y1: MAX_TOTAL + 1 })] },
      { version_salida: 2, filas: [nat({ razon_natural: "" })] },
      { version_salida: 2, filas: [nat({ razon_natural: "x".repeat(261) })] },
      { version_salida: 2, filas: [nat({ banderas: Array.from({ length: 7 }, () => "a") })] },
      { version_salida: 2, filas: [nat({ banderas: ["a".repeat(41)] })] },
      { version_salida: 2, filas: [nat({ confianza: "total" })] },
      { version_salida: 2, filas: Array.from({ length: 151 }, () => nat()) },
      { version_salida: 2 },
    ];
    for (const m of mal) expect(salidaNaturalIa.safeParse(m).success).toBe(false);
    expect(salidaNaturalIa.safeParse({ version_salida: 2, filas: [nat({ f: "f0001", natural_y1: MAX_TOTAL })] }).success).toBe(true);
    expect(salidaNaturalIa.safeParse({ version_salida: 2, filas: Array.from({ length: 150 }, () => nat()) }).success).toBe(true);
  });

  it("reparto: razón de hasta 400, razon_gm de hasta 800", () => {
    const ok = { version_salida: 2, razon_gm: "g".repeat(800), banderas_gm: [], filas: [rep({ razon: "r".repeat(400) })] };
    expect(salidaRepartoIa.safeParse(ok).success).toBe(true);
    expect(salidaRepartoIa.safeParse({ ...ok, razon_gm: "g".repeat(801) }).success).toBe(false);
    expect(salidaRepartoIa.safeParse({ ...ok, filas: [rep({ razon: "r".repeat(401) })] }).success).toBe(false);
    expect(salidaRepartoIa.safeParse({ ...ok, filas: [rep({ meta_y1: 0.5 })] }).success).toBe(false);
    expect(salidaRepartoIa.safeParse({ version_salida: 2, banderas_gm: [], filas: [] }).success).toBe(false);
  });

  it("líneas: l de dos o tres dígitos", () => {
    const l = (id: string) => ({ version_salida: 2, razon_gm: "x", banderas_gm: [], lineas: [{ l: id, meta_y1: 1, razon: "x" }] });
    expect(salidaLineasIa.safeParse(l("l01")).success).toBe(true);
    expect(salidaLineasIa.safeParse(l("l123")).success).toBe(true);
    expect(salidaLineasIa.safeParse(l("l1")).success).toBe(false);
    expect(salidaLineasIa.safeParse(l("f001")).success).toBe(false);
  });

  it("el catálogo de banderas son las diez de la ficha", () => {
    expect([...BANDERAS_IA]).toEqual(["dato_insuficiente", "linea_nueva", "en_salida", "quiebres", "nino", "volatil", "tiendas_entrantes", "meta_exigente", "meta_holgada", "estacionalidad_atipica"]);
  });

  it("JSON Schema para el proveedor: sin restricciones que la salida estructurada no admite y sin propiedades adicionales", () => {
    const buscar = (valor: unknown, fn: (clave: string, v: unknown) => void, esMapaDePropiedades = false): void => {
      if (Array.isArray(valor)) valor.forEach((v) => buscar(v, fn));
      else if (valor !== null && typeof valor === "object") {
        for (const [k, v] of Object.entries(valor)) {
          if (!esMapaDePropiedades) fn(k, v);
          buscar(v, fn, k === "properties");
        }
      }
    };
    for (const tipo of ["natural", "reparto", "lineas"] as const) {
      const esquema = jsonSchemaSalida(tipo);
      const encontradas: string[] = [];
      buscar(esquema, (k) => {
        if (["$schema", "pattern", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "format"].includes(k)) encontradas.push(k);
      });
      expect(encontradas).toEqual([]);
      expect(esquema.type).toBe("object");
      expect(esquema.additionalProperties).toBe(false);
      expect(esquema.required).toEqual(expect.arrayContaining(["version_salida"]));
      // El esquema original sigue exigiendo todo: la respuesta se valida con zod siempre.
      expect(ESQUEMAS_SALIDA[tipo]).toBeDefined();
    }
    const natural = jsonSchemaSalida("natural") as { properties: { filas: { items: { properties: Record<string, unknown>; additionalProperties: boolean } } } };
    expect(Object.keys(natural.properties.filas.items.properties).sort()).toEqual(["banderas", "confianza", "f", "natural_y1", "razon_natural"]);
    expect(natural.properties.filas.items.additionalProperties).toBe(false);
  });
});

describe("caracteres prohibidos", () => {
  it("cubren control, ancho cero, LRM, RLM y separadores de línea", () => {
    for (const c of ["\u0007", "\n", "​", "‎", "‏", " ", " ", "‮"]) expect(new RegExp(CARACTERES_PROHIBIDOS_IA.source, "u").test(`a${c}b`)).toBe(true);
    expect(new RegExp(CARACTERES_PROHIBIDOS_IA.source, "u").test("ñandú 100 %")).toBe(false);
  });
});

describe("cuerpos de las rutas", () => {
  it("iniciarCorridaSchema", () => {
    expect(iniciarCorridaSchema.parse({ gms: "pendientes", costo_confirmado_usd: 3.6 })).toEqual({ gms: "pendientes", regenerar: false, costo_confirmado_usd: 3.6 });
    expect(iniciarCorridaSchema.parse({ gms: ["a.b"], regenerar: true, costo_confirmado_usd: 0 }).regenerar).toBe(true);
    expect(iniciarCorridaSchema.safeParse({ gms: "algunos", costo_confirmado_usd: 1 }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: [], costo_confirmado_usd: 1 }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: Array.from({ length: 61 }, (_, i) => `g${i}`), costo_confirmado_usd: 1 }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: ["x".repeat(81)], costo_confirmado_usd: 1 }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: "todos", costo_confirmado_usd: -1 }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: "todos" }).success).toBe(false);
    expect(iniciarCorridaSchema.safeParse({ gms: "todos", costo_confirmado_usd: 1, otro: 1 }).success).toBe(false);
  });

  it("terminarCorridaSchema", () => {
    expect(terminarCorridaSchema.parse({})).toEqual({ cancelar: false });
    expect(terminarCorridaSchema.parse({ cancelar: true })).toEqual({ cancelar: true });
    expect(terminarCorridaSchema.safeParse({ cancelar: "si" }).success).toBe(false);
  });

  it("aceptarIaSchema", () => {
    const ok = { anio: 2027, propuesta_fila_id: "11111111-2222-4333-8444-555555555555", valor_esperado: 10961 };
    expect(aceptarIaSchema.safeParse(ok).success).toBe(true);
    expect(aceptarIaSchema.safeParse({ ...ok, nota: "revisada" }).success).toBe(true);
    expect(aceptarIaSchema.safeParse({ ...ok, valor_esperado: -1 }).success).toBe(false);
    expect(aceptarIaSchema.safeParse({ ...ok, valor_esperado: 1.5 }).success).toBe(false);
    expect(aceptarIaSchema.safeParse({ ...ok, propuesta_fila_id: "no-es-uuid" }).success).toBe(false);
    expect(aceptarIaSchema.safeParse({ ...ok, nota: "x".repeat(301) }).success).toBe(false);
    expect(aceptarIaSchema.safeParse({ ...ok, nota: "línea\nnueva" }).success).toBe(false);
    expect(aceptarIaSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  const config = {
    modelo: "modelo-x",
    version_prompt: "v1",
    capacidades: [] as string[],
    evaluacion_id: null,
    tope_usd_corrida: 10,
    tope_usd_mes: 60,
    tope_usd_dia_usuario: 15,
    max_filas_llamada: 60,
    incluir_cola_larga: false,
    presupuesto_razonamiento: 0,
    precios: { entrada: 3, salida: 15, cache_escritura: 3.75, cache_lectura: 0.3 },
    terminos_extra: ["Sigla Interna"],
    version_vigente: null,
  };

  it("configuracionSchema", () => {
    expect(configuracionSchema.parse(config).nota).toBeNull();
    expect(configuracionSchema.parse({ ...config, capacidades: ["distribucion_y1"] }).capacidades).toEqual(["distribucion_y1"]);
    expect(configuracionSchema.parse({ ...config, nota: "  hola " }).nota).toBe("hola");
    expect(configuracionSchema.parse({ ...config, nota: "" }).nota).toBeNull();
    const malos: Record<string, unknown>[] = [
      { ...config, version_prompt: "v9" },
      { ...config, capacidades: ["distribucion_y1", "distribucion_y1"] },
      { ...config, capacidades: ["cierre_y"] },
      { ...config, modelo: "" },
      { ...config, modelo: "m".repeat(101) },
      { ...config, tope_usd_corrida: 0 },
      { ...config, tope_usd_corrida: 501 },
      { ...config, tope_usd_mes: 5001 },
      { ...config, tope_usd_dia_usuario: 501 },
      { ...config, max_filas_llamada: 9 },
      { ...config, max_filas_llamada: 151 },
      { ...config, presupuesto_razonamiento: 32001 },
      { ...config, precios: { ...config.precios, entrada: 0 } },
      { ...config, precios: { ...config.precios, salida: 1001 } },
      { ...config, precios: { entrada: 1, salida: 1, cache_escritura: 1 } },
      { ...config, terminos_extra: ["a"] },
      { ...config, terminos_extra: ["a".repeat(61)] },
      { ...config, terminos_extra: Array.from({ length: 51 }, (_, i) => `término ${i}`) },
      { ...config, terminos_extra: ["con​oculto"] },
      { ...config, evaluacion_id: "x" },
      { ...config, version_vigente: 0 },
      { ...config, extra: 1 },
    ];
    for (const m of malos) expect(configuracionSchema.safeParse(m).success).toBe(false);
  });

  it("evaluacionSchema y pasoEvaluacionSchema", () => {
    const ok = { modelo: "m", version_prompt: "v1", precios: config.precios, tope_usd: 50, costo_confirmado_usd: 8 };
    expect(evaluacionSchema.safeParse(ok).success).toBe(true);
    expect(evaluacionSchema.safeParse({ ...ok, pliegues: ["D25", "E25", "D24"] }).success).toBe(true);
    expect(evaluacionSchema.safeParse({ ...ok, pliegues: [] }).success).toBe(false);
    expect(evaluacionSchema.safeParse({ ...ok, pliegues: ["D25", "D25"] }).success).toBe(false);
    expect(evaluacionSchema.safeParse({ ...ok, pliegues: ["X1"] }).success).toBe(false);
    expect(evaluacionSchema.safeParse({ ...ok, tope_usd: 501 }).success).toBe(false);
    expect(pasoEvaluacionSchema.safeParse({ pliegue: "D24" }).success).toBe(true);
    expect(pasoEvaluacionSchema.safeParse({ pliegue: "Z" }).success).toBe(false);
  });

  it("usoQuerySchema", () => {
    expect(usoQuerySchema.safeParse({}).success).toBe(true);
    expect(usoQuerySchema.safeParse({ mes: "2026-10" }).success).toBe(true);
    expect(usoQuerySchema.safeParse({ mes: "2026-13" }).success).toBe(false);
    expect(usoQuerySchema.safeParse({ mes: "octubre" }).success).toBe(false);
  });
});
