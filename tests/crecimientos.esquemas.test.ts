import { describe, expect, it } from "vitest";
import { aprobarCrecimientoSchema, leerClaveGeneroMundo, leerConsultaGeneroMundo } from "@/lib/crecimientos/esquemas";

/** 06d §3 (sintético): el cuerpo del `POST`, la clave de ruta y la consulta del `GET`. */

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const OTRO = "223e4567-e89b-42d3-a456-426614174001";

const cuerpo = (extra: Record<string, unknown> = {}) => ({
  anio: 2027,
  pct: 15,
  nota: "prudente: el rebote del invierno no será completo",
  base: { tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote" },
  proyeccion_referencia_id: UUID,
  huella_datos: "abc123",
  version_vigente: null,
  ...extra,
});

describe("aprobarCrecimientoSchema", () => {
  it("acepta un cuerpo completo", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo()).success).toBe(true);
  });

  it("nota vacía o solo espacios llega como null; null se conserva", () => {
    expect(aprobarCrecimientoSchema.parse(cuerpo({ nota: "   " })).nota).toBeNull();
    expect(aprobarCrecimientoSchema.parse(cuerpo({ nota: null })).nota).toBeNull();
    expect(aprobarCrecimientoSchema.parse(cuerpo({ nota: "  hola  " })).nota).toBe("hola");
  });

  it("la nota no pasa de 300 caracteres ni lleva saltos de línea, control o dirección de texto", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ nota: "x".repeat(300) })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ nota: "x".repeat(301) })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ nota: "a\nb" })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ nota: "a‮b" })).success).toBe(false);
  });

  it("el % va de −95 a 500", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ pct: -95 })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ pct: 500 })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ pct: -96 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ pct: 501 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ pct: "15" })).success).toBe(false);
  });

  it("el año va de 2024 a 2100 y es entero", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ anio: 2023 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ anio: 2101 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ anio: 2027.5 })).success).toBe(false);
  });

  it("regla 16: huella_datos de más de 128 caracteres o vacía es 400", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ huella_datos: "a".repeat(128) })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ huella_datos: "a".repeat(129) })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ huella_datos: "" })).success).toBe(false);
  });

  it("regla 16: anio_completo exige base.anio; las demás bases no lo llevan", () => {
    const completo = { tipo: "anio_completo", anio: 2025, variante: "bruto" };
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: completo })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { ...completo, anio: null } })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { tipo: "acumulado", anio: 2025, variante: "bruto" } })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { ...completo, anio: 2022 } })).success).toBe(false);
  });

  it("base ninguna es válida; un tipo o variante desconocidos, no", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { tipo: "ninguna", anio: null, variante: "bruto" } })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { tipo: "otra", anio: null, variante: "bruto" } })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { tipo: "acumulado", anio: null, variante: "neto" } })).success).toBe(false);
  });

  it("es estricto: una clave desconocida en la raíz o en base es 400", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ extra: 1 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ base: { tipo: "acumulado", anio: null, variante: "bruto", extra: 1 } })).success).toBe(false);
  });

  it("proyeccion_referencia_id es uuid o null; version_vigente entero ≥ 1 o null", () => {
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ proyeccion_referencia_id: null })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ proyeccion_referencia_id: "no-es-uuid" })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ version_vigente: 2 })).success).toBe(true);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ version_vigente: 0 })).success).toBe(false);
    expect(aprobarCrecimientoSchema.safeParse(cuerpo({ version_vigente: 1.5 })).success).toBe(false);
  });

  it("todos los campos son obligatorios", () => {
    for (const campo of ["anio", "pct", "nota", "base", "proyeccion_referencia_id", "huella_datos", "version_vigente"]) {
      const sin: Record<string, unknown> = cuerpo();
      delete sin[campo];
      expect(aprobarCrecimientoSchema.safeParse(sin).success, campo).toBe(false);
    }
  });
});

describe("leerClaveGeneroMundo", () => {
  it("resto, GM y claves inválidas", () => {
    expect(leerClaveGeneroMundo("resto")).toEqual({ alcance: "resto" });
    expect(leerClaveGeneroMundo(`${UUID}.${OTRO}`)).toEqual({ alcance: "gm", genero_id: UUID, mundo_id: OTRO });
    expect(leerClaveGeneroMundo(UUID)).toBeNull();
    expect(leerClaveGeneroMundo(`${UUID}.${OTRO}.${UUID}`)).toBeNull();
    expect(leerClaveGeneroMundo(`${UUID}|${OTRO}`)).toBeNull();
    expect(leerClaveGeneroMundo("RESTO")).toBeNull();
    expect(leerClaveGeneroMundo("")).toBeNull();
  });
});

describe("leerConsultaGeneroMundo", () => {
  const p = (obj: Record<string, string>) => new URLSearchParams(obj);

  it("sin parámetros: todo null", () => {
    expect(leerConsultaGeneroMundo(p({}))).toEqual({ consulta: { anio: null, proyeccion: null }, rechazo: null });
  });

  it("año y proyección válidos", () => {
    expect(leerConsultaGeneroMundo(p({ anio: "2027", proyeccion: UUID })).consulta).toEqual({ anio: 2027, proyeccion: UUID });
  });

  it("400 con año mal formado, fuera de rango o proyección que no es id", () => {
    const consultas: Record<string, string>[] = [{ anio: "27" }, { anio: "20x7" }, { anio: "2023" }, { anio: "2101" }, { proyeccion: "xx" }];
    for (const q of consultas) {
      const r = leerConsultaGeneroMundo(p(q));
      expect(r.rechazo?.status).toBe(400);
      expect(r.rechazo?.mensaje.length).toBeGreaterThan(0);
    }
  });
});
