import { describe, expect, it } from "vitest";
import {
  aammDe,
  correlativoDe,
  esCodigoAamm,
  esCodigoValido,
  mesDeReferenciaCodigo,
  normalizarCodigo,
  proponerCodigo,
  resolverCodigo,
  siguienteCodigo,
} from "@/lib/compras/agrupadores/codigos";
import { codigoSchema } from "@/lib/compras/agrupadores/esquemas";

/** R14 · caso 6: códigos `aamm##` por tipo (decisión 93). */

describe("aammDe: el mes de la fecha de referencia", () => {
  it("de una fecha o de un mes", () => {
    expect(aammDe("2026-11-20")).toBe("2611");
    expect(aammDe("2026-11")).toBe("2611");
    expect(aammDe("2027-03-15")).toBe("2703");
    expect(aammDe("2026-12-31")).toBe("2612");
  });
  it("un texto que no es fecha da null", () => {
    expect(aammDe("")).toBeNull();
    expect(aammDe("2026-13-01")).toBeNull();
    expect(aammDe("26-11-01")).toBeNull();
  });
  it("el mes de referencia depende del tipo (viaje: inicio; embarque: llegada; paquete: la de su embarque)", () => {
    expect(mesDeReferenciaCodigo("viaje", { fecha_inicio: "2026-10-05" })).toBe("2026-10");
    expect(mesDeReferenciaCodigo("embarque", { fecha_llegada_estimada: "2026-11-20" })).toBe("2026-11");
    expect(mesDeReferenciaCodigo("paquete", { periodo_llegada_embarque: "2026-12" })).toBe("2026-12");
    expect(mesDeReferenciaCodigo("paquete", { fecha_inicio: "2026-10-05" })).toBeNull();
  });
});

describe("normalización y formato", () => {
  it("se pasa a mayúsculas y se recortan espacios", () => {
    expect(normalizarCodigo("  ab-01 ")).toBe("AB-01");
  });
  it("un código a mano admite letras, números y guiones, hasta 30; el formato aamm## es opcional", () => {
    expect(esCodigoValido("261101")).toBe(true);
    expect(esCodigoValido("abc-1")).toBe(true);
    expect(esCodigoValido("A".repeat(30))).toBe(true);
    expect(esCodigoValido("A".repeat(31))).toBe(false);
    expect(esCodigoValido("a b")).toBe(false);
    expect(esCodigoValido("")).toBe(false);
    expect(esCodigoAamm("261101")).toBe(true);
    expect(esCodigoAamm("261301")).toBe(false); // mes 13
    expect(esCodigoAamm("ABC-1")).toBe(false);
  });
  it("correlativoDe solo reconoce <aamm>## y lo escrito a mano con otro formato no ocupa ninguno", () => {
    expect(correlativoDe("261102", "2611")).toBe(2);
    expect(correlativoDe("261100", "2611")).toBe(0);
    expect(correlativoDe("261202", "2611")).toBeNull();
    expect(correlativoDe("2611A2", "2611")).toBeNull();
    expect(correlativoDe("26110", "2611")).toBeNull();
    expect(correlativoDe("2611022", "2611")).toBeNull();
  });
  it("el esquema pasa el código a mayúsculas y un código vacío equivale a «no mandó código»", () => {
    expect(codigoSchema.parse(" ab-1 ")).toBe("AB-1");
    expect(codigoSchema.parse("")).toBeUndefined();
    expect(codigoSchema.parse("   ")).toBeUndefined();
    expect(codigoSchema.parse(undefined)).toBeUndefined();
    expect(codigoSchema.safeParse("a b").success).toBe(false);
  });
});

describe("siguienteCodigo: el máximo más uno, sin rellenar huecos", () => {
  it("el primero del mes es 01", () => {
    expect(siguienteCodigo("2611", [])).toEqual({ ok: true, codigo: "261101", correlativo: 1 });
    expect(siguienteCodigo("2611", ["261001", "261201"])).toEqual({ ok: true, codigo: "261101", correlativo: 1 });
  });
  it("toma el máximo (también de los escritos a mano) y no rellena huecos", () => {
    expect(siguienteCodigo("2611", ["261101", "261102"])).toMatchObject({ codigo: "261103" });
    expect(siguienteCodigo("2611", ["261101", "261105"])).toMatchObject({ codigo: "261106" });
    expect(siguienteCodigo("2611", ["261110", "261101"])).toMatchObject({ codigo: "261111" });
    // un código con otro formato no cuenta
    expect(siguienteCodigo("2611", ["NOV-A", "261101"])).toMatchObject({ codigo: "261102" });
  });
  it("con 99 ya usado: correlativo_agotado, aunque queden huecos", () => {
    expect(siguienteCodigo("2611", ["261199"])).toEqual({ ok: false, motivo: "correlativo_agotado" });
    expect(siguienteCodigo("2611", ["261101", "261199"])).toEqual({ ok: false, motivo: "correlativo_agotado" });
    expect(siguienteCodigo("2611", ["261198"])).toMatchObject({ codigo: "261199" });
  });
  it("es insensible a mayúsculas en lo existente", () => {
    expect(siguienteCodigo("2611", ["261101"].map((c) => c.toLowerCase()))).toMatchObject({ codigo: "261102" });
  });
});

describe("caso 6: resolverCodigo con 261101 y 261102 ya creados (el segundo a mano)", () => {
  const existentes = ["261101", "261102"];

  it("crear otro embarque que llega en nov-26 sin código recibe 261103", () => {
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-11-25", existentes })).toEqual({ ok: true, codigo: "261103", automatico: true });
    expect(resolverCodigo({ codigo: "", fechaReferencia: "2026-11-25", existentes })).toMatchObject({ codigo: "261103" });
    expect(resolverCodigo({ codigo: "   ", fechaReferencia: "2026-11-25", existentes })).toMatchObject({ codigo: "261103" });
    expect(resolverCodigo({ codigo: null, fechaReferencia: "2026-11-25", existentes })).toMatchObject({ codigo: "261103" });
  });

  it("escribir 261101 a mano da codigo_duplicado (sin distinguir mayúsculas)", () => {
    expect(resolverCodigo({ codigo: "261101", fechaReferencia: "2026-11-25", existentes })).toEqual({ ok: false, motivo: "codigo_duplicado" });
    expect(resolverCodigo({ codigo: "NOV-A", fechaReferencia: "2026-11-25", existentes: ["nov-a"] })).toEqual({ ok: false, motivo: "codigo_duplicado" });
  });

  it("con 261199 ya usado, correlativo_agotado: hay que escribirlo a mano", () => {
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-11-25", existentes: [...existentes, "261199"] })).toEqual({ ok: false, motivo: "correlativo_agotado" });
    expect(resolverCodigo({ codigo: "261150", fechaReferencia: "2026-11-25", existentes: [...existentes, "261199"] })).toEqual({ ok: true, codigo: "261150", automatico: false });
  });

  it("el viaje 261101 puede convivir con el embarque 261101 (cada tipo, su numeración)", () => {
    const viajes = ["261101"];
    const embarques: string[] = [];
    expect(resolverCodigo({ codigo: "261101", fechaReferencia: "2026-11-01", existentes: embarques })).toMatchObject({ ok: true, codigo: "261101" });
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-11-01", existentes: embarques })).toMatchObject({ codigo: "261101" });
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-11-01", existentes: viajes })).toMatchObject({ codigo: "261102" });
  });

  it("un código a mano con otro formato es válido y no ocupa correlativo; uno mal escrito da codigo_invalido", () => {
    expect(resolverCodigo({ codigo: "feria-1", fechaReferencia: "2026-11-01", existentes })).toEqual({ ok: true, codigo: "FERIA-1", automatico: false });
    expect(resolverCodigo({ codigo: "a b", fechaReferencia: "2026-11-01", existentes })).toEqual({ ok: false, motivo: "codigo_invalido" });
    expect(resolverCodigo({ codigo: "x".repeat(31), fechaReferencia: "2026-11-01", existentes })).toEqual({ ok: false, motivo: "codigo_invalido" });
  });

  it("un código a mano con formato aamm## ocupa su correlativo: el automático siguiente lo salta", () => {
    expect(resolverCodigo({ codigo: "261110", fechaReferencia: "2026-11-01", existentes })).toMatchObject({ ok: true, codigo: "261110" });
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-11-01", existentes: [...existentes, "261110"] })).toMatchObject({ codigo: "261111" });
  });

  it("el código no cambia si después cambian las fechas: depende solo de la fecha al crear y no se reutiliza", () => {
    // El mes de otro viaje (dic) tiene su propia numeración
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "2026-12-02", existentes })).toMatchObject({ codigo: "261201" });
    // un código de un agrupador cancelado sigue ocupado (se pasa también en `existentes`)
    expect(resolverCodigo({ codigo: "261102", fechaReferencia: "2026-11-02", existentes })).toEqual({ ok: false, motivo: "codigo_duplicado" });
  });

  it("sin fecha de referencia válida no se puede autonumerar", () => {
    expect(resolverCodigo({ codigo: undefined, fechaReferencia: "", existentes })).toEqual({ ok: false, motivo: "codigo_invalido" });
  });
});

describe("proponerCodigo: el código que sugiere la pantalla", () => {
  it("el siguiente automático del mes de la fecha, o nulo si no hay fecha o el mes se agotó", () => {
    expect(proponerCodigo("2026-11-20", ["261101"])).toBe("261102");
    expect(proponerCodigo("", ["261101"])).toBeNull();
    expect(proponerCodigo(null, [])).toBeNull();
    expect(proponerCodigo("2026-11-20", ["261199"])).toBeNull();
  });
});
