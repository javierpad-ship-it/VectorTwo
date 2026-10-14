import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { analizarRuta } from "./api.guards.analizador";
import { armarUnidadesMensuales, UNIDADES_MENSUALES_VACIAS } from "@/lib/reportes/unidades-mensuales";
import { MAX_EQUIVALENCIAS_UNIDADES, unidadesMensualesSchema } from "@/lib/reportes/esquemas";

/**
 * M11 · unidades vendidas por mes (histograma del Resumen). Casos sintéticos:
 * la función pura que arma la respuesta, el esquema del cuerpo y las reglas
 * que se vigilan leyendo el código de la ruta.
 */

describe("armarUnidadesMensuales", () => {
  it("convierte el periodo a YYYY-MM y ordena de más antiguo a más reciente", () => {
    const r = armarUnidadesMensuales(
      [
        { periodo: "2024-03-01", unidades: 30, venta_soles: 300 },
        { periodo: "2023-12-01", unidades: 10, venta_soles: 100 },
        { periodo: "2024-01-01", unidades: 20, venta_soles: 200 },
      ],
      null
    );
    expect(r.meses.map((m) => m.periodo)).toEqual(["2023-12", "2024-01", "2024-03"]);
    expect(r.meses.map((m) => m.unidades)).toEqual([10, 20, 30]);
  });

  it("calcula los totales de unidades y de soles", () => {
    const r = armarUnidadesMensuales(
      [
        { periodo: "2024-01-01", unidades: 12, venta_soles: 100.5 },
        { periodo: "2024-02-01", unidades: 8, venta_soles: 49.5 },
      ],
      3
    );
    expect(r.total_unidades).toBe(20);
    expect(r.total_venta_soles).toBe(150);
    expect(r.equivalencias).toBe(3);
  });

  it("convierte bigint y numeric que llegan como texto", () => {
    const r = armarUnidadesMensuales(
      [
        { periodo: "2024-01-01", unidades: "1234567", venta_soles: "98765.43" },
        { periodo: "2024-02-01", unidades: "-5", venta_soles: "-10.10" },
      ],
      null
    );
    expect(r.meses).toEqual([
      { periodo: "2024-01", unidades: 1234567, venta_soles: 98765.43 },
      { periodo: "2024-02", unidades: -5, venta_soles: -10.1 },
    ]);
    expect(r.total_unidades).toBe(1234562);
    expect(r.total_venta_soles).toBe(98755.33);
  });

  it("suma los soles en céntimos: sin ruido de coma flotante", () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({
      periodo: `2024-${String(i + 1).padStart(2, "0")}-01`,
      unidades: 1,
      venta_soles: 0.1,
    }));
    const r = armarUnidadesMensuales(filas, null);
    expect(r.total_venta_soles).toBe(1);
    expect(r.total_unidades).toBe(10);
  });

  it("junta dos filas del mismo mes", () => {
    const r = armarUnidadesMensuales(
      [
        { periodo: "2024-05-01", unidades: 5, venta_soles: 10.1 },
        { periodo: "2024-05-01", unidades: 7, venta_soles: 20.2 },
      ],
      null
    );
    expect(r.meses).toEqual([{ periodo: "2024-05", unidades: 12, venta_soles: 30.3 }]);
  });

  it("sin filas: meses vacíos y totales en cero (equivalencias se conserva)", () => {
    expect(armarUnidadesMensuales([], null)).toEqual({ meses: [], total_unidades: 0, total_venta_soles: 0, equivalencias: null });
    expect(armarUnidadesMensuales([], 4).equivalencias).toBe(4);
  });

  it("la respuesta de la lista vacía no consulta nada y es cero", () => {
    expect(UNIDADES_MENSUALES_VACIAS).toEqual({ meses: [], total_unidades: 0, total_venta_soles: 0, equivalencias: 0 });
  });

  it("rechaza periodos y números ilegibles en vez de mostrarlos como cero", () => {
    expect(() => armarUnidadesMensuales([{ periodo: "enero", unidades: 1, venta_soles: 1 }], null)).toThrow();
    expect(() => armarUnidadesMensuales([{ periodo: "2024-13-01", unidades: 1, venta_soles: 1 }], null)).toThrow();
    expect(() => armarUnidadesMensuales([{ periodo: "2024-01-01", unidades: "abc", venta_soles: 1 }], null)).toThrow();
    expect(() => armarUnidadesMensuales([{ periodo: "2024-01-01", unidades: 1, venta_soles: "" }], null)).toThrow();
  });
});

describe("unidadesMensualesSchema", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("acepta un cuerpo sin equivalencia_ids (todas)", () => {
    const r = unidadesMensualesSchema.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data.equivalencia_ids).toBeUndefined();
  });

  it("acepta una lista vacía y una lista de uuid", () => {
    expect(unidadesMensualesSchema.parse({ equivalencia_ids: [] }).equivalencia_ids).toEqual([]);
    expect(unidadesMensualesSchema.parse({ equivalencia_ids: [id(1), id(2)] }).equivalencia_ids).toEqual([id(1), id(2)]);
  });

  it("quita los repetidos conservando el orden", () => {
    expect(unidadesMensualesSchema.parse({ equivalencia_ids: [id(2), id(1), id(2)] }).equivalencia_ids).toEqual([id(2), id(1)]);
  });

  it("rechaza un uuid inválido con un mensaje en castellano", () => {
    const r = unidadesMensualesSchema.safeParse({ equivalencia_ids: [id(1), "no-es-uuid"] });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toBe("Identificador inválido.");
  });

  it("rechaza lo que no es una lista", () => {
    expect(unidadesMensualesSchema.safeParse({ equivalencia_ids: id(1) }).success).toBe(false);
    expect(unidadesMensualesSchema.safeParse({ equivalencia_ids: null }).success).toBe(false);
  });

  it("acepta exactamente 5 000 y rechaza 5 001", () => {
    expect(MAX_EQUIVALENCIAS_UNIDADES).toBe(5000);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => id(i + 1));
    expect(unidadesMensualesSchema.safeParse({ equivalencia_ids: ids(5000) }).success).toBe(true);
    const r = unidadesMensualesSchema.safeParse({ equivalencia_ids: ids(5001) });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toContain("5000");
  });

  it("el tope cuenta lo que llega, no lo que queda tras quitar repetidos", () => {
    const r = unidadesMensualesSchema.safeParse({ equivalencia_ids: Array.from({ length: 5001 }, () => id(1)) });
    expect(r.success).toBe(false);
  });
});

// ─── Estático: la ruta ───

const RAIZ = path.resolve(__dirname, "..");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(nombre) ? [p] : [];
  });
}

const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");
const src = archivos(path.join(RAIZ, "src")).map((p) => ({ ruta: rel(p), texto: readFileSync(p, "utf8") }));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const RUTA = "src/app/api/reportes/agrupacion-gmle/unidades-mensuales/route.ts";
const ruta = src.find((f) => f.ruta === RUTA)?.texto ?? "";

describe("ruta POST /api/reportes/agrupacion-gmle/unidades-mensuales", () => {
  it("existe", () => {
    expect(ruta).not.toBe("");
  });

  it("exporta solo POST", () => {
    const exportados = [...sinComentarios(ruta).matchAll(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g)].map((m) => m[1]);
    expect(exportados).toEqual(["POST"]);
    expect(sinComentarios(ruta)).not.toMatch(/export\s*\{/);
  });

  it("abre con requirePlanner (el analizador de guards la acepta)", () => {
    expect(analizarRuta(RUTA, ruta)).toEqual([]);
    const cuerpo = sinComentarios(ruta).slice(sinComentarios(ruta).indexOf("export async function POST"));
    expect(cuerpo).toMatch(/\{\s*const\s*\{\s*response\s*\}\s*=\s*await\s+requirePlanner\(\);\s*if\s*\(response\)\s*return response;/);
    expect(cuerpo).not.toMatch(/requireUser|requireAdmin/);
  });

  it("valida el cuerpo con leerCuerpo y el esquema zod", () => {
    expect(ruta).toMatch(/leerCuerpo\(\s*request\s*,\s*unidadesMensualesSchema\s*\)/);
  });

  it("no nombra tablas ni vistas ni la función SQL, ni usa .from/.rpc", () => {
    const t = sinComentarios(ruta);
    expect(t).not.toMatch(/venta_stock|unidades_mensuales/);
    expect(t).not.toMatch(/\.from\(|\.rpc\(/);
  });

  it("solo consultas.ts llama a la función SQL y ningún otro archivo de src/lib/reportes nombra las tablas", () => {
    const usos = src.filter((f) => /\.rpc\(\s*["'`]unidades_mensuales["'`]/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(usos).toEqual(["src/lib/reportes/consultas.ts"]);
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/reportes/"))) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/venta_stock_(mensual|vigente)/);
    }
  });

  it("la lógica pura y el esquema no importan nada de servidor", () => {
    for (const r of ["src/lib/reportes/unidades-mensuales.ts", "src/lib/reportes/esquemas.ts", "src/lib/reportes/tipos-unidades.ts"]) {
      const t = src.find((f) => f.ruta === r)?.texto ?? "";
      expect(t, r).not.toBe("");
      expect(sinComentarios(t), r).not.toMatch(/supabase|next\/server|:\s*any\b|\bas any\b/);
    }
  });
});
