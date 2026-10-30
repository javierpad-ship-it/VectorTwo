import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { leerVigentes } from "@/lib/crecimientos/consultas-vigentes";
import { matrizDeVigentes, sobreBaseDe } from "@/lib/crecimientos/vigentes";

/** 06d §3.1: `leerVigentes` con un doble de la base que anota la consulta (sintético). */

type Llamada = { tabla: string; columnas: string; filtros: [string, unknown][]; orden: string[]; rango: [number, number][] };

function dobleDb(filas: Record<string, unknown>[], error: { message: string } | null = null) {
  const llamadas: Llamada[] = [];
  const db = {
    from(tabla: string) {
      const l: Llamada = { tabla, columnas: "", filtros: [], orden: [], rango: [] };
      llamadas.push(l);
      const q = {
        select: (c: string) => ((l.columnas = c), q),
        eq: (c: string, v: unknown) => (l.filtros.push([`eq:${c}`, v]), q),
        in: (c: string, v: unknown) => (l.filtros.push([`in:${c}`, v]), q),
        order: (c: string) => (l.orden.push(c), q),
        range: (d: number, h: number) => (l.rango.push([d, h]), Promise.resolve({ data: error ? null : filas.slice(d, h + 1), error })),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, llamadas };
}

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "i1",
  anio_aplicacion: 2027,
  alcance: "gm",
  genero_id: "g",
  mundo_id: "m",
  version: 1,
  pct: "12.50",
  sobre_base: "corregida",
  usuario_nombre: "Javier",
  aprobada_at: "2026-10-27T10:00:00Z",
  ...extra,
});

describe("leerVigentes", () => {
  it("sin años no consulta", async () => {
    const { db, llamadas } = dobleDb([]);
    expect(await leerVigentes(db, [])).toEqual({ data: [], error: null });
    expect(llamadas).toHaveLength(0);
  });

  it("una sola lectura para varios años: solo vigentes, años sin repetir y orden estable", async () => {
    const { db, llamadas } = dobleDb([fila()]);
    await leerVigentes(db, [2028, 2027, 2027]);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.tabla).toBe("crecimientos_genero_mundo");
    expect(llamadas[0]?.filtros).toEqual([["eq:estado", "vigente"], ["in:anio_aplicacion", [2027, 2028]]]);
    expect(llamadas[0]?.orden.at(-1)).toBe("id");
  });

  it("normaliza pct a número", async () => {
    const { db } = dobleDb([fila()]);
    const r = await leerVigentes(db, [2027]);
    expect(r.error).toBeNull();
    expect(r.data[0]?.pct).toBe(12.5);
  });

  it("pagina por encima de 1000 filas", async () => {
    const filas = Array.from({ length: 1500 }, (_, i) => fila({ id: `i${i}` }));
    const { db, llamadas } = dobleDb(filas);
    const r = await leerVigentes(db, [2027]);
    expect(r.data).toHaveLength(1500);
    expect(llamadas).toHaveLength(2);
  });

  it("devuelve el error de la base", async () => {
    const { db } = dobleDb([], { message: "falla" });
    const r = await leerVigentes(db, [2027]);
    expect(r.error?.message).toBe("falla");
    expect(r.data).toEqual([]);
  });

  it("06e §2.1 · lee sobre_base y la devuelve; una fila sin el dato queda null y se lee bruta", async () => {
    const sinColumna = fila({ id: "i2", mundo_id: "m2" });
    delete (sinColumna as Record<string, unknown>).sobre_base;
    const { db, llamadas } = dobleDb([fila(), sinColumna, fila({ id: "i3", mundo_id: "m3", sobre_base: "bruta" })]);
    const r = await leerVigentes(db, [2027]);
    expect(llamadas[0]?.columnas.split(",")).toContain("sobre_base");
    expect(r.data.map((v) => v.sobre_base)).toEqual(["corregida", null, "bruta"]);
    expect(r.data.map((v) => sobreBaseDe(v))).toEqual(["corregida", "bruta", "bruta"]);
  });

  it("06e R4 · la matriz de vigentes lleva el sobre_base de cada GM y el del Resto (sin Resto aprobado, el provisional es corregida)", async () => {
    const resto = fila({ id: "r1", alcance: "resto", genero_id: null, mundo_id: null, sobre_base: null });
    const { db } = dobleDb([fila({ genero_id: "g", mundo_id: "m1", sobre_base: "corregida" }), fila({ id: "i2", genero_id: "g", mundo_id: "m2", sobre_base: "bruta" }), resto]);
    const { data } = await leerVigentes(db, [2027]);
    const m = matrizDeVigentes(data, ["g"], 2027);
    expect(m.sobre?.get("g|m1")).toBe("corregida");
    expect(m.sobre?.get("g|m2")).toBe("bruta");
    expect(m.resto.sobre_base).toBe("bruta");
    expect(matrizDeVigentes(data.filter((v) => v.alcance !== "resto"), ["g"], 2027).resto.sobre_base).toBe("corregida");
  });
});
