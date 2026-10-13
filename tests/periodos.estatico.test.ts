import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * M6 paso 1, reglas que se rompen por descuido y se vigilan leyendo el código
 * (regla 31 de la ficha): guards de las rutas, acceso a datos, pureza de la
 * lógica y contrato de tipos autocontenido.
 */

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
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
const metodos = (texto: string) => [...texto.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();

const DIRS_M6 = ["src/app/api/periodos-atipicos/", "src/app/api/curvas/"];
const rutasM6 = src.filter((f) => DIRS_M6.some((d) => f.ruta.startsWith(d)) && f.ruta.endsWith("route.ts"));
const rutaPeriodos = (r: string) => src.find((f) => f.ruta === `src/app/api/periodos-atipicos/${r}`);

describe("M6 paso 1: rutas de periodos atípicos", () => {
  it("existen las tres rutas con sus métodos", () => {
    expect(rutasM6.map((f) => f.ruta).filter((r) => r.startsWith("src/app/api/periodos-atipicos/")).sort()).toEqual([
      "src/app/api/periodos-atipicos/[id]/route.ts",
      "src/app/api/periodos-atipicos/anios/route.ts",
      "src/app/api/periodos-atipicos/route.ts",
    ]);
    expect(metodos(rutaPeriodos("route.ts")?.texto ?? "")).toEqual(["GET", "POST"]);
    expect(metodos(rutaPeriodos("[id]/route.ts")?.texto ?? "")).toEqual(["DELETE", "PATCH"]);
    expect(metodos(rutaPeriodos("anios/route.ts")?.texto ?? "")).toEqual(["GET"]);
  });

  it("todo handler de M6 empieza con requirePlanner (lecturas incluidas; nunca requireUser ni requireAdmin)", () => {
    for (const f of rutasM6) {
      const handlers =
        f.texto.match(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{\s*(?:const \{[^}]*\} = await (\w+)\(\);)?/g) ?? [];
      expect(handlers.length, f.ruta).toBeGreaterThan(0);
      for (const h of handlers) expect(h, `${f.ruta}: ${h}`).toContain("await requirePlanner()");
      expect(f.texto, f.ruta).not.toMatch(/requireUser|requireAdmin/);
    }
  });

  it("los datos salen de supabaseAdmin, nunca de supabaseServer", () => {
    for (const f of rutasM6) {
      expect(f.texto, f.ruta).toContain("supabaseAdmin");
      expect(f.texto, f.ruta).not.toContain("supabaseServer");
    }
  });

  it("los errores de Postgres pasan por traducirErrorDb", () => {
    for (const f of rutasM6) expect(f.texto, f.ruta).toContain("traducirErrorDb");
  });
});

describe("M6 paso 1: acceso a datos", () => {
  it("solo src/lib/curvas/consultas.ts lee o escribe la tabla periodos_atipicos", () => {
    const usan = src.filter((f) => /from\(\s*["'`]periodos_atipicos["'`]/.test(f.texto)).map((f) => f.ruta);
    expect(usan).toEqual(["src/lib/curvas/consultas.ts"]);
    const permitidos = new Set(["src/lib/curvas/consultas.ts", "src/lib/supabase/database.types.ts", "src/lib/api/errores-db.ts"]);
    for (const f of src) {
      if (permitidos.has(f.ruta)) continue;
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/\bperiodos_atipicos\b/);
    }
  });

  it("errores-db.ts solo nombra constraints de periodos_atipicos (`periodos_atipicos_*`)", () => {
    const errores = src.find((f) => f.ruta === "src/lib/api/errores-db.ts")?.texto ?? "";
    const menciones = errores.match(/periodos_atipicos\w*/g) ?? [];
    expect(menciones.length).toBeGreaterThan(0);
    for (const m of menciones) expect(m).toMatch(/^periodos_atipicos_\w+$/);
  });

  it("la lógica de M6 no lee el histórico de ventas (ni la tabla de hechos ni la vista)", () => {
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/curvas/") || DIRS_M6.some((d) => x.ruta.startsWith(d)))) {
      expect(f.texto, f.ruta).not.toMatch(/venta_stock_mensual|venta_stock_vigente/);
    }
  });

  it("solo consultas.ts nombra la vista materializada del paso 2", () => {
    const infractores = src
      .filter((f) => /venta_mensual_estacionalidad/.test(f.texto) && f.ruta !== "src/lib/curvas/consultas.ts" && f.ruta !== "src/lib/supabase/database.types.ts")
      .map((f) => f.ruta);
    expect(infractores).toEqual([]);
  });
});

describe("M6 paso 1: lógica pura y contrato", () => {
  const dirCurvas = src.filter((f) => f.ruta.startsWith("src/lib/curvas/"));

  it("ningún archivo de src/lib/curvas importa de src/components ni es de cliente", () => {
    expect(dirCurvas.length).toBeGreaterThan(0);
    for (const f of dirCurvas) {
      for (const origen of importsDe(f.texto)) expect(origen, `${f.ruta} importa ${origen}`).not.toMatch(/components/);
      expect(f.texto, f.ruta).not.toMatch(/^\s*["']use client["']/m);
    }
  });

  it("atipicos, esquemas, tipos y tipos-api no tocan la base (ni @supabase/* ni supabaseAdmin/Server)", () => {
    for (const nombre of ["atipicos", "esquemas", "tipos", "tipos-api"]) {
      const ruta = `src/lib/curvas/${nombre}.ts`;
      const f = src.find((x) => x.ruta === ruta);
      expect(f, ruta).toBeDefined();
      for (const origen of importsDe(f?.texto ?? "")) {
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/^@supabase\//);
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/supabase\/(admin|server|database)/);
      }
      expect(f?.texto, ruta).not.toContain("supabaseAdmin");
    }
  });

  it("tipos-api.ts es autocontenido: no importa nada", () => {
    const f = src.find((x) => x.ruta === "src/lib/curvas/tipos-api.ts");
    expect(importsDe(f?.texto ?? "")).toEqual([]);
    expect(f?.texto).not.toMatch(/^import\s/m);
  });

  it("las constantes de temporada y alcance se definen en un único lugar (tipos-api.ts)", () => {
    const defs = (nombre: string) => src.filter((f) => new RegExp(`export const ${nombre}\\b`).test(f.texto)).map((f) => f.ruta);
    expect(defs("TEMPORADAS_AGRUPACION")).toEqual(["src/lib/curvas/tipos-api.ts"]);
    expect(defs("ALCANCES_PERIODO")).toEqual(["src/lib/curvas/tipos-api.ts"]);
  });
});
