import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { huellaCuerpoLote, huellaCuerpoReversion, huellaSimulacion } from "@/lib/aprobacion/huella";
import { loteSchema, type LoteCuerpo } from "@/lib/aprobacion/esquemas";
import type { EfectoGMApi, ResultadoFilaLoteApi } from "@/lib/aprobacion/tipos-api";
import { uuid } from "./aprobacion.fixture";

/** D8, D10 y R22 · las huellas del lote: de la simulación (el servidor la recalcula y compara) y del cuerpo (idempotencia). */

const fila = (n: number, extra: Partial<ResultadoFilaLoteApi> = {}): ResultadoFilaLoteApi => ({
  fila_id: uuid(`f${n}`),
  anio: 2027,
  gm_clave: n % 2 ? "gm-a" : "gm-b",
  fuente: "ia",
  resultado: "aplicada",
  codigo: null,
  valor: 1000 + n,
  valor_actual: null,
  brecha_u: n,
  ...extra,
});
const efecto = (gm: string, extra: Partial<EfectoGMApi> = {}): EfectoGMApi => ({
  gm_clave: gm,
  total_antes: 26066,
  total_despues: 26006,
  crecimiento_implicito_antes_pct: 8.248,
  crecimiento_implicito_despues_pct: 7.998,
  meta_antes: 26006,
  meta_despues: 26006,
  desvio_antes_u: 60,
  desvio_despues_u: 0,
  libres_antes: 3,
  libres_despues: 0,
  ...extra,
});
const sim = (filas = [fila(1), fila(2), fila(3)], ef = [efecto("gm-a"), efecto("gm-b")]) => huellaSimulacion({ filas, efecto_gm: ef });

describe("huellaSimulacion (D8)", () => {
  it("es un sha-256 hexadecimal y es estable", () => {
    expect(sim()).toMatch(/^[0-9a-f]{64}$/);
    expect(sim()).toBe(sim());
    // vector fijo: si cambia, cambió el formato canónico y todas las simulaciones en vuelo se invalidan
    expect(sim()).toBe("144d81cc90ee4006446459cf82bef17892e9036f9733ec2ddfcc1f1da5c1428d");
  });

  it("no depende del orden en que se calcularon las filas ni los GM", () => {
    expect(sim([fila(3), fila(1), fila(2)], [efecto("gm-b"), efecto("gm-a")])).toBe(sim());
  });

  it("cambia si cambia una fila: valor, código, fuente, resultado, valor_actual o brecha", () => {
    const base = sim();
    for (const cambio of [{ valor: 1 }, { codigo: "ya_decidida" as const }, { fuente: "metodo" as const }, { resultado: "rechazada" as const }, { valor_actual: 5 }, { brecha_u: 99 }]) {
      expect(sim([fila(1, cambio), fila(2), fila(3)])).not.toBe(base);
    }
    expect(sim([fila(1), fila(2)])).not.toBe(base);
  });

  it("cambia si cambia el efecto por GM", () => {
    const base = sim();
    for (const cambio of [{ total_despues: 1 }, { desvio_despues_u: 5 }, { meta_despues: 1 }, { libres_despues: 2 }, { crecimiento_implicito_despues_pct: 1 }]) {
      expect(sim([fila(1), fila(2), fila(3)], [efecto("gm-a", cambio), efecto("gm-b")])).not.toBe(base);
    }
  });

  it("los nulos y los números no finitos dan la misma huella estable", () => {
    const a = huellaSimulacion({ filas: [fila(1, { valor: null })], efecto_gm: [efecto("g", { meta_despues: null, desvio_despues_u: null })] });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const nan = huellaSimulacion({ filas: [fila(1, { valor: Number.NaN })], efecto_gm: [] });
    expect(nan).toBe(huellaSimulacion({ filas: [fila(1, { valor: null })], efecto_gm: [] }));
  });
});

describe("huellaCuerpoLote (D10)", () => {
  const cuerpo = (extra: Record<string, unknown> = {}): LoteCuerpo =>
    loteSchema.parse({
      lote_id: uuid("1"),
      confirmacion_id: uuid("2"),
      anio: 2027,
      huella_simulacion: "b".repeat(64),
      filas: [
        { fila_id: uuid("f2"), fuente: "ia", valor_esperado: 6677, propuesta_fila_id: uuid("e2") },
        { fila_id: uuid("f1"), fuente: "ia", valor_esperado: 10961, propuesta_fila_id: uuid("e1") },
      ],
      ...extra,
    });

  it("el mismo cuerpo da la misma huella aunque las filas lleguen en otro orden (un reintento)", () => {
    const a = cuerpo();
    const b = cuerpo({ filas: [...a.filas].reverse() });
    expect(huellaCuerpoLote(b)).toBe(huellaCuerpoLote(a));
    expect(huellaCuerpoLote(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("otro cuerpo con el mismo lote_id da otra huella (lote_ajeno)", () => {
    const base = huellaCuerpoLote(cuerpo());
    const filas = (valor: number) => [
      { fila_id: uuid("f2"), fuente: "ia", valor_esperado: valor, propuesta_fila_id: uuid("e2") },
      { fila_id: uuid("f1"), fuente: "ia", valor_esperado: 10961, propuesta_fila_id: uuid("e1") },
    ];
    expect(huellaCuerpoLote(cuerpo({ filas: filas(6678) }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ nota: "otra" }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ revision_confirmada: true }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ huella_simulacion: "c".repeat(64) }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ confirmacion_id: uuid("3") }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ lote_id: uuid("4") }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ anio: 2026, filas: [{ fila_id: uuid("f1"), fuente: "metodo", valor_esperado: 5 }] }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ tipo: "reaprobar", filas: filas(6677).map((f) => ({ ...f, decidido_esperado: 1 })) }))).not.toBe(base);
    expect(huellaCuerpoLote(cuerpo({ filtro: { generos: ["HOMBRE"] } }))).not.toBe(base);
  });

  it("`simular` no entra: solo se guardan los lotes aplicados", () => {
    expect(huellaCuerpoLote(cuerpo({ simular: true }))).toBe(huellaCuerpoLote(cuerpo()));
  });

  it("la huella del cuerpo de una reversión depende del lote revertido, las filas marcadas (sin importar el orden) y la nota", () => {
    const a = { lote_id: uuid("9"), confirmacion_id: uuid("8"), revierte_lote_id: uuid("1") };
    const base = huellaCuerpoReversion(a);
    expect(huellaCuerpoReversion({ ...a, filas: [uuid("f2"), uuid("f1")] })).toBe(huellaCuerpoReversion({ ...a, filas: [uuid("f1"), uuid("f2")] }));
    expect(huellaCuerpoReversion({ ...a, filas: [uuid("f1")] })).not.toBe(base);
    expect(huellaCuerpoReversion({ ...a, revierte_lote_id: uuid("2") })).not.toBe(base);
    expect(huellaCuerpoReversion({ ...a, nota: "x" })).not.toBe(base);
    expect(huellaCuerpoReversion({ ...a, lote_id: uuid("7") })).not.toBe(base);
  });
});

describe("dónde vive cada huella", () => {
  const RAIZ = path.resolve(__dirname, "..");
  const DIR = path.join(RAIZ, "src/lib/aprobacion");
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importsDe = (f: string) => [...sinComentarios(readFileSync(path.join(DIR, f), "utf8")).matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const archivos = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".ts")) : [];

  it("solo huella.ts usa node:crypto; tipos-api, esquemas, reglas, plan y trocear (que importa la pantalla) no lo tocan ni importan huella.ts", () => {
    expect(importsDe("huella.ts")).toContain("node:crypto");
    for (const f of ["tipos-api.ts", "esquemas.ts", "reglas.ts", "plan.ts", "trocear.ts"]) {
      expect(archivos).toContain(f);
      const imports = importsDe(f);
      expect(imports.filter((i) => i.startsWith("node:") || i.endsWith("/huella") || i === "./huella"), f).toEqual([]);
    }
  });

  it("tipos-api.ts y esquemas.ts no importan nada de servidor (base, Next, React, calculo, huellas)", () => {
    for (const f of ["tipos-api.ts", "esquemas.ts"]) {
      const malos = importsDe(f).filter((i) => /supabase|^next|^react|server-only|consultas|servicio|calculo|huellas|\/ia\/(?!tipos-api)/.test(i));
      expect(malos, f).toEqual([]);
    }
  });

  it("src/lib/proyeccion/ no importa src/lib/aprobacion/", () => {
    const dir = path.join(RAIZ, "src/lib/proyeccion");
    const malos = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /@\/lib\/aprobacion|\.\.\/aprobacion/.test(sinComentarios(readFileSync(path.join(dir, f), "utf8"))));
    expect(malos).toEqual([]);
  });
});
