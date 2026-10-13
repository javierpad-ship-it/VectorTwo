import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { crearAgrupacionesConGeneros } from "@/lib/estacionalidad/consultas";
import { mensajeFalloCrearAgrupaciones, type AgrupacionACrear } from "@/lib/estacionalidad/importar-agrupaciones";

/**
 * Doble de la base para `crearAgrupacionesConGeneros`: registra cada upsert,
 * insert y delete y permite fallar llamadas concretas. Todo sintético.
 */

type Db = Parameters<typeof crearAgrupacionesConGeneros>[0];
const errorFx = (message: string): PostgrestError => ({
  message,
  details: "",
  hint: "",
  code: "XX000",
  name: "PostgrestError",
  toJSON: () => ({ message, details: "", hint: "", code: "XX000", name: "PostgrestError" }),
});

type Opciones = {
  /** Nombres que ya existen: el upsert con ignoreDuplicates no los inserta ni los devuelve. */
  yaExisten?: Set<string>;
  /** Falla el N-ésimo (1 = primero) upsert de agrupaciones. */
  fallaUpsertNumero?: number;
  /** Falla el N-ésimo insert de vínculos. */
  fallaInsertVinculosNumero?: number;
  /** Falla todo delete (la compensación). */
  fallaDelete?: boolean;
};

function dobleDb(opciones: Opciones = {}) {
  const upserts: { nombres: string[]; opts: unknown }[] = [];
  const inserts: { agrupacion_estacionalidad_id: string; genero_id: string }[][] = [];
  const deletes: string[][] = [];
  let contador = 0;
  const idDe = new Map<string, string>();

  const db = {
    from(tabla: string) {
      return {
        upsert(filas: { nombre: string }[], opts: unknown) {
          expect(tabla).toBe("agrupaciones_estacionalidad");
          upserts.push({ nombres: filas.map((f) => f.nombre), opts });
          const falla = opciones.fallaUpsertNumero === upserts.length;
          return {
            select: async () => {
              if (falla) return { data: null, error: errorFx("falla el upsert") };
              const nuevas = filas.filter((f) => !opciones.yaExisten?.has(f.nombre));
              const data = nuevas.map((f) => {
                const id = `id-${++contador}`;
                idDe.set(id, f.nombre);
                return { id, nombre: f.nombre };
              });
              return { data, error: null };
            },
          };
        },
        insert: async (filas: { agrupacion_estacionalidad_id: string; genero_id: string }[]) => {
          expect(tabla).toBe("agrupacion_estacionalidad_genero");
          inserts.push(filas);
          return { error: opciones.fallaInsertVinculosNumero === inserts.length ? errorFx("fallan los vínculos") : null };
        },
        delete() {
          expect(tabla).toBe("agrupaciones_estacionalidad");
          return {
            in: async (_columna: string, ids: string[]) => {
              deletes.push(ids);
              return { error: opciones.fallaDelete ? errorFx("falla el borrado") : null };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Db, upserts, inserts, deletes, idDe };
}

const agrupacion = (n: number, generos = ["g-h", "g-m"]): AgrupacionACrear => ({
  nombre: `AGRUPACION ${n}`,
  codigo: `AGRUPACION_${n}`,
  descripcion: null,
  orden: n * 10,
  temporada: "todo_el_ano",
  genero_ids: generos,
});
const lote = (cantidad: number, generos?: string[]) => Array.from({ length: cantidad }, (_, i) => agrupacion(i + 1, generos));

describe("crearAgrupacionesConGeneros: tandas y vínculos", () => {
  it("sin agrupaciones no escribe nada", async () => {
    const d = dobleDb();
    expect(await crearAgrupacionesConGeneros(d.db, [])).toEqual({ creadas: 0, error: null, errorCompensacion: null, sinGenero: 0 });
    expect(d.upserts).toHaveLength(0);
  });

  it("escribe en tandas de 500 con upsert por nombre ignorando duplicados", async () => {
    const d = dobleDb();
    const r = await crearAgrupacionesConGeneros(d.db, lote(1_200, ["g-h"]));
    expect(r).toEqual({ creadas: 1_200, error: null, errorCompensacion: null, sinGenero: 0 });
    expect(d.upserts.map((u) => u.nombres.length)).toEqual([500, 500, 200]);
    expect(d.upserts[0].opts).toEqual({ onConflict: "nombre", ignoreDuplicates: true });
    expect(d.inserts.reduce((n, l) => n + l.length, 0)).toBe(1_200);
    expect(d.deletes).toEqual([]);
  });

  it("los vínculos también van en lotes de 500 como máximo y llevan los géneros de cada agrupación", async () => {
    const d = dobleDb();
    await crearAgrupacionesConGeneros(d.db, lote(600, ["g-h", "g-m"]));
    expect(d.inserts.every((l) => l.length <= 500)).toBe(true);
    expect(d.inserts.reduce((n, l) => n + l.length, 0)).toBe(1_200);
    const todos = d.inserts.flat();
    const primera = todos.filter((v) => d.idDe.get(v.agrupacion_estacionalidad_id) === "AGRUPACION 1").map((v) => v.genero_id);
    expect(primera).toEqual(["g-h", "g-m"]);
  });

  it("solo escribe vínculos de las agrupaciones realmente insertadas (las que ya existían no se tocan)", async () => {
    const yaExisten = new Set(["AGRUPACION 2", "AGRUPACION 3"]);
    const d = dobleDb({ yaExisten });
    const r = await crearAgrupacionesConGeneros(d.db, lote(5));
    expect(r.creadas).toBe(3);
    expect(r.error).toBeNull();
    const nombres = new Set(d.inserts.flat().map((v) => d.idDe.get(v.agrupacion_estacionalidad_id)));
    expect(nombres).toEqual(new Set(["AGRUPACION 1", "AGRUPACION 4", "AGRUPACION 5"]));
    expect(d.inserts.flat()).toHaveLength(6);
  });
});

describe("crearAgrupacionesConGeneros: fallos", () => {
  it("si fallan los vínculos de una tanda se borran solo las agrupaciones de esa tanda y las anteriores quedan", async () => {
    const d = dobleDb({ fallaInsertVinculosNumero: 2 }); // 1 agrupación × 1 género por lote de 500: el 2.º insert es de la tanda 2
    const nuevas = lote(900, ["g-h"]);
    const r = await crearAgrupacionesConGeneros(d.db, nuevas);
    expect(r.creadas).toBe(500);
    expect(r.error?.message).toBe("fallan los vínculos");
    expect(r.errorCompensacion).toBeNull();
    expect(r.sinGenero).toBe(0);
    const borrados = d.deletes.flat();
    expect(borrados).toHaveLength(400);
    expect(d.deletes.every((ids) => ids.length <= 100)).toBe(true);
    const nombresBorrados = new Set(borrados.map((id) => d.idDe.get(id)));
    expect(nombresBorrados.has("AGRUPACION 1")).toBe(false);
    expect(nombresBorrados.has("AGRUPACION 501")).toBe(true);
    expect(d.upserts).toHaveLength(2); // no sigue con más tandas
  });

  it("si el borrado de compensación también falla, devuelve ambos errores y cuántas quedaron sin género", async () => {
    const d = dobleDb({ fallaInsertVinculosNumero: 1, fallaDelete: true });
    const r = await crearAgrupacionesConGeneros(d.db, lote(250));
    expect(r.creadas).toBe(0);
    expect(r.error?.message).toBe("fallan los vínculos");
    expect(r.errorCompensacion?.message).toBe("falla el borrado");
    expect(r.sinGenero).toBe(250);
    expect(d.deletes.map((ids) => ids.length)).toEqual([100, 100, 50]); // intenta todos los lotes aunque falle
  });

  it("creadas parcial: si falla el upsert de la segunda tanda, la primera ya cuenta", async () => {
    const d = dobleDb({ fallaUpsertNumero: 2 });
    const r = await crearAgrupacionesConGeneros(d.db, lote(700));
    expect(r.creadas).toBe(500);
    expect(r.error?.message).toBe("falla el upsert");
    expect(r.errorCompensacion).toBeNull();
    expect(r.sinGenero).toBe(0);
    expect(d.deletes).toEqual([]);
  });

  it("los ya existentes no cuentan como sin género al fallar la compensación", async () => {
    const d = dobleDb({ fallaInsertVinculosNumero: 1, fallaDelete: true, yaExisten: new Set(["AGRUPACION 1", "AGRUPACION 2"]) });
    const r = await crearAgrupacionesConGeneros(d.db, lote(10));
    expect(r.sinGenero).toBe(8);
  });
});

describe("mensajeFalloCrearAgrupaciones", () => {
  it("informa cuántas se crearon antes y que reimportar completa", () => {
    const m = mensajeFalloCrearAgrupaciones("Error inesperado en la base de datos.", 500, 0);
    expect(m).toContain("Error inesperado en la base de datos.");
    expect(m).toContain("Se crearon 500 agrupaciones antes de fallar.");
    expect(m).toContain("Vuelve a importar el mismo archivo");
    expect(m).not.toContain("sin género");
  });

  it("singular, cero y el aviso de las que quedaron sin género", () => {
    expect(mensajeFalloCrearAgrupaciones("X.", 1, 0)).toContain("Se creó 1 agrupación antes de fallar.");
    expect(mensajeFalloCrearAgrupaciones("X.", 0, 0)).toContain("Se crearon 0 agrupaciones");
    expect(mensajeFalloCrearAgrupaciones("X.", 0, 250)).toContain("250 agrupaciones quedaron sin género: asígnalas en Agrupaciones");
    expect(mensajeFalloCrearAgrupaciones("X.", 0, 1)).toContain("1 agrupación quedó sin género");
  });
});
