import { describe, expect, it } from "vitest";
import { filtroLoteSchema, loteSchema, MAX_FILAS_LOTE, revertirConfirmacionSchema, revertirSchema } from "@/lib/aprobacion/esquemas";
import { MAX_TOTAL } from "@/lib/proyeccion/tipos-api";
import { uuid } from "./aprobacion.fixture";

/** R15 · los cuerpos de 07g: 301 ítems, fila repetida, ia sin propuesta, metodo con ella, reaprobar sin decidido_esperado y aplicar sin huella → 400. */

const HUELLA = "a".repeat(64);
const item = (n: number, extra: Record<string, unknown> = {}) => ({ fila_id: uuid(`f${n}`), fuente: "metodo", valor_esperado: 100 + n, ...extra });
const itemIa = (n: number, extra: Record<string, unknown> = {}) => ({ fila_id: uuid(`f${n}`), fuente: "ia", valor_esperado: 100 + n, propuesta_fila_id: uuid(`e${n}`), ...extra });
const lote = (extra: Record<string, unknown> = {}) => ({
  lote_id: uuid("1"),
  confirmacion_id: uuid("2"),
  anio: 2027,
  huella_simulacion: HUELLA,
  filas: [item(1)],
  ...extra,
});
const error = (cuerpo: unknown, schema: { safeParse: (x: unknown) => { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } } } = loteSchema) => {
  const r = schema.safeParse(cuerpo);
  return r.success ? null : (r.error?.issues ?? []).map((i) => ({ message: i.message, path: i.path.join(".") }));
};

describe("R15 · loteSchema", () => {
  it("un cuerpo válido: aprobar por defecto, sin simular, sin revisión confirmada", () => {
    const r = loteSchema.parse(lote());
    expect(r).toMatchObject({ tipo: "aprobar", simular: false, revision_confirmada: false });
    expect(r.nota).toBeUndefined();
    expect(r.filas).toHaveLength(1);
  });

  it("300 ítems pasan; 301 → 400", () => {
    expect(error(lote({ filas: Array.from({ length: MAX_FILAS_LOTE }, (_, i) => item(i + 1)) }))).toBeNull();
    const e = error(lote({ filas: Array.from({ length: MAX_FILAS_LOTE + 1 }, (_, i) => item(i + 1)) }));
    expect(e?.[0].path).toBe("filas");
    expect(e?.[0].message).toMatch(/300/);
    expect(error(lote({ filas: [] }))?.[0].path).toBe("filas");
  });

  it("fila_id repetido → 400", () => {
    const e = error(lote({ filas: [item(1), item(2), item(1)] }));
    expect(e).toContainEqual({ message: "Una fila no puede repetirse en el mismo lote.", path: "filas.2.fila_id" });
  });

  it("«ia» sin propuesta_fila_id y «metodo» con ella → 400", () => {
    expect(error(lote({ filas: [{ fila_id: uuid("f1"), fuente: "ia", valor_esperado: 5 }] }))?.[0].path).toBe("filas.0.propuesta_fila_id");
    expect(error(lote({ filas: [item(1, { propuesta_fila_id: uuid("e1") })] }))?.[0].path).toBe("filas.0.propuesta_fila_id");
    expect(error(lote({ filas: [itemIa(1), item(2)] }))).toBeNull();
  });

  it("reaprobar sin decidido_esperado → 400; con él pasa", () => {
    const e = error(lote({ tipo: "reaprobar", filas: [item(1)] }));
    expect(e?.[0].path).toBe("filas.0.decidido_esperado");
    expect(error(lote({ tipo: "reaprobar", filas: [item(1, { decidido_esperado: 90 })] }))).toBeNull();
    // al aprobar, decidido_esperado se admite y se ignora
    expect(error(lote({ filas: [item(1, { decidido_esperado: 90 })] }))).toBeNull();
  });

  it("aplicar sin huella_simulacion → 400; simular sin huella pasa", () => {
    const sin = lote();
    delete (sin as { huella_simulacion?: string }).huella_simulacion;
    expect(error(sin)?.[0].path).toBe("huella_simulacion");
    expect(error({ ...sin, simular: true })).toBeNull();
  });

  it("huella con formato inválido (mayúsculas, corta, no hexadecimal) → 400", () => {
    for (const h of ["A".repeat(64), "a".repeat(63), "g".repeat(64), ""]) expect(error(lote({ huella_simulacion: h }))).not.toBeNull();
  });

  it("estricto: una clave de más, en el cuerpo o en un ítem → 400", () => {
    expect(error(lote({ extra: 1 }))).not.toBeNull();
    expect(error(lote({ filas: [item(1, { extra: 1 })] }))).not.toBeNull();
  });

  it("identificadores, año, tipo y fuente", () => {
    expect(error(lote({ lote_id: "no-es-uuid" }))?.[0].path).toBe("lote_id");
    expect(error(lote({ confirmacion_id: 3 }))?.[0].path).toBe("confirmacion_id");
    expect(error(lote({ filas: [item(1, { fila_id: "x" })] }))?.[0].path).toBe("filas.0.fila_id");
    expect(error(lote({ anio: 2023 }))).not.toBeNull();
    expect(error(lote({ anio: 2102 }))).not.toBeNull();
    expect(error(lote({ anio: 2027.5 }))).not.toBeNull();
    expect(error(lote({ tipo: "revertir" }))).not.toBeNull();
    expect(error(lote({ filas: [item(1, { fuente: "otra" })] }))).not.toBeNull();
  });

  it("valor_esperado: entero entre 0 y MAX_TOTAL", () => {
    for (const v of [-1, 1.5, MAX_TOTAL + 1, "10", null]) expect(error(lote({ filas: [item(1, { valor_esperado: v })] }))).not.toBeNull();
    expect(error(lote({ filas: [item(1, { valor_esperado: 0 })] }))).toBeNull();
    expect(error(lote({ filas: [item(1, { valor_esperado: MAX_TOTAL })] }))).toBeNull();
    expect(error(lote({ tipo: "reaprobar", filas: [item(1, { decidido_esperado: -1 })] }))).not.toBeNull();
  });

  it("nota: se recorta, vacía = ausente, máximo 300 y sin caracteres de control", () => {
    expect(loteSchema.parse(lote({ nota: "  Cierre de septiembre  " })).nota).toBe("Cierre de septiembre");
    expect(loteSchema.parse(lote({ nota: "   " })).nota).toBeUndefined();
    expect(error(lote({ nota: "x".repeat(301) }))?.[0].path).toBe("nota");
    expect(error(lote({ nota: "x".repeat(300) }))).toBeNull();
    for (const n of ["a\nb", "a\u0000b", "a‮b", "a​b", "a b"]) expect(error(lote({ nota: n }))?.[0].path).toBe("nota");
  });

  it("filtro: contexto de pantalla, estricto y acotado", () => {
    expect(error(lote({ filtro: { generos: ["HOMBRE"], mundos: ["URBANO"], solo_sin_avisos_fuertes: true, incluir_revision: true, confianza: ["alta", "media"], estado_ia: ["al_dia", "meta_movida"], brecha_max_pct: 10, gms: ["g|m"] } }))).toBeNull();
    expect(error(lote({ filtro: { otra: 1 } }))).not.toBeNull();
    expect(error(lote({ filtro: { confianza: ["baja"] } }))).not.toBeNull();
    expect(error(lote({ filtro: { estado_ia: ["rarisimo"] } }))).not.toBeNull();
    expect(error(lote({ filtro: { brecha_max_pct: -1 } }))).not.toBeNull();
    expect(error(lote({ filtro: { generos: Array.from({ length: 201 }, (_, i) => `g${i}`) } }))).not.toBeNull();
    expect(error(lote({ filtro: { lineas: ["x".repeat(121)] } }))).not.toBeNull();
    // M2: tope de 5 listas × 50 valores × 80 caracteres; lo que manda la pantalla (un id de 36 o una clave de GM de 73) cabe de sobra.
    const id = "00000000-0000-4000-8000-000000000001";
    expect(error(lote({ filtro: { generos: Array.from({ length: 50 }, (_, i) => `g${i}`) } }))).toBeNull();
    expect(error(lote({ filtro: { generos: Array.from({ length: 51 }, (_, i) => `g${i}`) } }))).not.toBeNull();
    expect(error(lote({ filtro: { lineas: ["x".repeat(80)] } }))).toBeNull();
    expect(error(lote({ filtro: { lineas: ["x".repeat(81)] } }))).not.toBeNull();
    expect(error(lote({ filtro: { gms: [`${id}.${id}`], lineas: [id], agrupaciones: [id], mundos: [id], generos: [id] } }))).toBeNull();
    expect(error(lote({ filtro: { lineas: [""] } }))).not.toBeNull();
    expect(filtroLoteSchema.safeParse({}).success).toBe(true);
  });

  it("M4 · el filtro rechaza caracteres de control, de dirección de texto y saltos de línea, como la nota", () => {
    for (const malo of ["a\nb", "a\u0000b", "a\u202Eb", "a\u2028b", "a\u200Bb", "a\tb"]) {
      for (const clave of ["generos", "mundos", "lineas", "agrupaciones", "gms"]) {
        expect(error(lote({ filtro: { [clave]: [malo] } })), `${clave} ${JSON.stringify(malo)}`).not.toBeNull();
      }
    }
    expect(error(lote({ filtro: { generos: ["HOMBRE · URBANO"] } }))).toBeNull();
  });
});

describe("revertirSchema", () => {
  const rev = (extra: Record<string, unknown> = {}) => ({ lote_id: uuid("9"), ...extra });

  it("mínimo: solo el lote de reversión; simular = false por defecto", () => {
    expect(revertirSchema.parse(rev())).toMatchObject({ lote_id: uuid("9"), simular: false });
  });

  it("filas: 1 a 300 uuid sin repetir", () => {
    expect(error(rev({ filas: [uuid("f1"), uuid("f2")] }), revertirSchema)).toBeNull();
    expect(error(rev({ filas: [] }), revertirSchema)).not.toBeNull();
    expect(error(rev({ filas: [uuid("f1"), uuid("f1")] }), revertirSchema)?.[0].path).toBe("filas");
    expect(error(rev({ filas: Array.from({ length: 301 }, (_, i) => uuid(`f${i}`)) }), revertirSchema)).not.toBeNull();
    expect(error(rev({ filas: Array.from({ length: 300 }, (_, i) => uuid(`f${i}`)) }), revertirSchema)).toBeNull();
    expect(error(rev({ filas: ["x"] }), revertirSchema)).not.toBeNull();
  });

  it("huella y nota opcionales; estricto", () => {
    expect(error(rev({ simular: true, huella_simulacion: HUELLA, nota: " ok " }), revertirSchema)).toBeNull();
    expect(error(rev({ huella_simulacion: "abc" }), revertirSchema)).not.toBeNull();
    expect(error(rev({ extra: 1 }), revertirSchema)).not.toBeNull();
    expect(error({}, revertirSchema)?.[0].path).toBe("lote_id");
  });
});

describe("revertirConfirmacionSchema", () => {
  it("uno o más lote_ids de reversión sin repetir", () => {
    expect(revertirConfirmacionSchema.parse({ lote_ids: [uuid("a1"), uuid("a2")] })).toMatchObject({ simular: false });
    expect(error({ lote_ids: [] }, revertirConfirmacionSchema)).not.toBeNull();
    expect(error({ lote_ids: [uuid("a1"), uuid("a1")] }, revertirConfirmacionSchema)?.[0].path).toBe("lote_ids");
    expect(error({ lote_ids: ["x"] }, revertirConfirmacionSchema)).not.toBeNull();
    expect(error({ lote_ids: Array.from({ length: 101 }, (_, i) => uuid(`a${i}`)) }, revertirConfirmacionSchema)).not.toBeNull();
    expect(error({ lote_ids: [uuid("a1")], extra: true }, revertirConfirmacionSchema)).not.toBeNull();
    expect(error({}, revertirConfirmacionSchema)).not.toBeNull();
  });
});
