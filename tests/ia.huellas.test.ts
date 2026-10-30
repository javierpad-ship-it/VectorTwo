import { describe, expect, it } from "vitest";
import { canonico } from "@/lib/ia/canonico";
import { huellaEntrada, huellaGM, huellaHistoria, huellaLlamada, sha256, type FilaParaHuellaHistoria } from "@/lib/ia/huellas";

/** R12 (ficha 07e, §5.3): huellas. */

describe("canonico", () => {
  it("claves ordenadas, sin espacios, números como JSON.stringify", () => {
    expect(canonico({ b: 1, a: [1.5, -0, "x"], c: { z: null, y: true } })).toBe('{"a":[1.5,0,"x"],"b":1,"c":{"y":true,"z":null}}');
  });
  it("omite las claves indefinidas y no admite números no finitos", () => {
    expect(canonico({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonico({ a: Number.NaN })).toThrow();
    expect(() => canonico(Number.POSITIVE_INFINITY)).toThrow();
  });
  it("las cadenas se escapan como JSON", () => {
    expect(canonico({ t: 'a"b\n' })).toBe('{"t":"a\\"b\\n"}');
  });
});

describe("R12 · huellas de entrada y de llamada", () => {
  const contenido = { filas: [{ f: "f001", meses: [1, 2, 3] }], gm: { id: "g1" } };

  it("mismo objeto con las claves en otro orden → misma huella (sha-256 de 64 hex)", () => {
    const otro = { gm: { id: "g1" }, filas: [{ meses: [1, 2, 3], f: "f001" }] };
    expect(huellaEntrada(contenido)).toBe(huellaEntrada(otro));
    expect(huellaEntrada(contenido)).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaEntrada(contenido)).toBe(sha256(canonico(contenido)));
  });

  it("cambiar una unidad la cambia", () => {
    expect(huellaEntrada({ filas: [{ f: "f001", meses: [1, 2, 4] }], gm: { id: "g1" } })).not.toBe(huellaEntrada(contenido));
  });

  it("la de llamada cambia con el modelo, el prompt, el bloque o el sufijo", () => {
    const base = { version_prompt: "v1", modelo: "m1", bloque: contenido, sufijo: { tarea: "natural" } };
    const h = huellaLlamada(base);
    expect(huellaLlamada({ ...base })).toBe(h);
    expect(huellaLlamada({ ...base, version_prompt: "v2" })).not.toBe(h);
    expect(huellaLlamada({ ...base, modelo: "m2" })).not.toBe(h);
    expect(huellaLlamada({ ...base, bloque: { ...contenido, gm: { id: "g2" } } })).not.toBe(h);
    expect(huellaLlamada({ ...base, sufijo: { tarea: "reparto" } })).not.toBe(h);
  });

  it("la de GM cambia con el prompt, el modelo, los bloques y la meta; ignora lo que no es de la meta", () => {
    const meta = { pct: 8, sobre: "corregida" as const, total: 26006, fijas: 3386, libre: 22620, provisional: false };
    const base = { version_prompt: "v1", modelo: "m1", bloques: ["a".repeat(64)], meta };
    const h = huellaGM(base);
    expect(huellaGM({ ...base })).toBe(h);
    expect(huellaGM({ ...base, version_prompt: "v2" })).not.toBe(h);
    expect(huellaGM({ ...base, modelo: "m2" })).not.toBe(h);
    expect(huellaGM({ ...base, bloques: ["b".repeat(64)] })).not.toBe(h);
    expect(huellaGM({ ...base, meta: { ...meta, libre: 22621 } })).not.toBe(h);
    expect(huellaGM({ ...base, meta: { ...meta, provisional: true } })).not.toBe(h);
    expect(huellaGM({ ...base, meta: { ...meta, extra: 1 } as typeof meta })).toBe(h);
    expect(huellaGM({ ...base, meta: null })).not.toBe(h);
  });
});

describe("R12 · huella de la historia del GM (B1)", () => {
  const fila = (clave: string, extra: Partial<FilaParaHuellaHistoria> = {}): FilaParaHuellaHistoria => ({
    clave,
    anios: [
      { anio: 2025, meses: [{ periodo: "2025-01", unidades: 10, atipico: false }, { periodo: "2025-02", unidades: 12, atipico: true }] },
      { anio: 2026, meses: [{ periodo: "2026-01", unidades: 11, atipico: false }] },
    ],
    vendido_y: 11,
    avance_y: 0.4,
    curva_origen: [{ agrupacion_id: "ag1", curva_id: "cv1", version: 2, peso: 1 }],
    factores_mes_y: [1, 1, 0.8],
    ...extra,
  });
  const base = [fila("k1"), fila("k2", { vendido_y: 50 })];
  const h = huellaHistoria(base);

  it("no depende del orden de las filas", () => {
    expect(huellaHistoria([base[1], base[0]])).toBe(h);
  });

  it("no cambia al decidir, aceptar la IA, poner un % propio ni pasar una fila de libre a fija (el estado no entra)", () => {
    const conEstado = base.map((f, i) => ({ ...f, estado: i === 0 ? "fija_decidida" : "libre", decidido: 999, crecimiento_pct: 12, decision_ia_fila_id: "x", propuesto: 1, vigente: 5 }));
    expect(huellaHistoria(conEstado)).toBe(h);
  });

  it("cambia con las unidades de un mes, un mes atípico, el vendido o el avance de 2026, curva_origen o factores_mes", () => {
    const cambia = (extra: Partial<FilaParaHuellaHistoria>) => huellaHistoria([fila("k1", extra), base[1]]);
    expect(cambia({ anios: [{ anio: 2025, meses: [{ periodo: "2025-01", unidades: 11, atipico: false }, { periodo: "2025-02", unidades: 12, atipico: true }] }, base[0].anios[1]] })).not.toBe(h);
    expect(cambia({ anios: [{ anio: 2025, meses: [{ periodo: "2025-01", unidades: 10, atipico: false }, { periodo: "2025-02", unidades: 12, atipico: false }] }, base[0].anios[1]] })).not.toBe(h);
    expect(cambia({ vendido_y: 12 })).not.toBe(h);
    expect(cambia({ avance_y: 0.41 })).not.toBe(h);
    expect(cambia({ curva_origen: [{ agrupacion_id: "ag1", curva_id: "cv2", version: 3, peso: 1 }] })).not.toBe(h);
    expect(cambia({ factores_mes_y: [1, 1, 0.9] })).not.toBe(h);
    expect(cambia({ factores_mes_y: null })).not.toBe(h);
  });

  it("cambia con el conjunto de filas activas (una fila nueva o una que sale)", () => {
    expect(huellaHistoria([...base, fila("k3")])).not.toBe(h);
    expect(huellaHistoria([base[0]])).not.toBe(h);
    expect(huellaHistoria([base[0], fila("k9", { vendido_y: 50 })])).not.toBe(h);
  });
});
