import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 06c, regla 74 (estático): lo que se rompe por descuido se vigila leyendo el código. Complementa a
 * `curvas.estatico.test.ts` (M6b) y a `api.guards.estatico.test.ts` (guard como primera sentencia).
 */

const RAIZ = path.resolve(__dirname, "..");
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(nombre) ? [p] : [];
  });
}
const src = archivos(path.join(RAIZ, "src")).map((p) => ({ ruta: rel(p), texto: readFileSync(p, "utf8") }));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
const fuente = (ruta: string) => src.find((f) => f.ruta === ruta)?.texto ?? "";

const PURAS = ["src/lib/curvas/composicion.ts", "src/lib/curvas/curva-usuario.ts", "src/lib/curvas/avanzada.ts", "src/lib/curvas/backtest-foto.ts"];

describe("06c · lógica pura", () => {
  for (const ruta of PURAS) {
    it(`${ruta} existe y no importa de @supabase/* ni de React`, () => {
      expect(existsSync(path.join(RAIZ, ruta))).toBe(true);
      const imports = importsDe(sinComentarios(fuente(ruta)));
      expect(imports.filter((i) => i.startsWith("@supabase/") || i === "react" || i.startsWith("react/") || i.startsWith("react-dom") || i === "next" || i.startsWith("next/"))).toEqual([]);
      expect(imports.filter((i) => i.includes("consultas") || i.includes("supabase/"))).toEqual([]);
    });
  }
  it("avanzada.ts no usa Math.random, Date ni node:", () => {
    const t = sinComentarios(fuente("src/lib/curvas/avanzada.ts"));
    expect(t).not.toMatch(/Math\.random/);
    expect(t).not.toMatch(/\bDate\b/);
    expect(t).not.toMatch(/node:/);
    expect(importsDe(t).some((i) => i.startsWith("node:"))).toBe(false);
  });
  it("curva-usuario.ts y composicion.ts son deterministas (sin Math.random ni Date)", () => {
    for (const ruta of ["src/lib/curvas/curva-usuario.ts", "src/lib/curvas/composicion.ts"]) {
      const t = sinComentarios(fuente(ruta));
      expect(t, ruta).not.toMatch(/Math\.random|\bDate\b/);
    }
  });
});

describe("06c · base de datos y rutas", () => {
  it("solo consultas.ts nombra venta_composicion_agrupacion (y los tipos generados)", () => {
    const usan = src.filter((f) => sinComentarios(f.texto).includes("venta_composicion_agrupacion") && f.ruta !== "src/lib/supabase/database.types.ts" && f.ruta !== "src/lib/curvas/consultas.ts").map((f) => f.ruta);
    expect(usan).toEqual([]);
    expect(sinComentarios(fuente("src/lib/curvas/consultas.ts"))).toContain('db.rpc("venta_composicion_agrupacion"');
  });
  it("existe …/composicion/route.ts con requirePlanner como primera sentencia y solo exporta POST", () => {
    const ruta = "src/app/api/curvas/agrupaciones/[id]/composicion/route.ts";
    const t = sinComentarios(fuente(ruta));
    expect(t).toBeTruthy();
    expect(t).toMatch(/export async function POST\([^)]*\)\s*\{\s*const \{ response \} = await requirePlanner\(\);\s*if \(response\) return response;/);
    expect([...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1])).toEqual(["POST"]);
    // p_red y p_hasta nunca vienen del cliente: el esquema del cuerpo es el de `calcular` (estricto) y la ruta los arma.
    expect(t).toContain("calcularAgrupacionSchema");
    expect(t).toContain("armarRedPorAnio(");
    expect(t).not.toMatch(/datos\.p_red|datos\.p_hasta|request\.nextUrl/);
  });
  it("la composición no escribe: la ruta no inserta, actualiza ni borra", () => {
    const t = sinComentarios(fuente("src/app/api/curvas/agrupaciones/[id]/composicion/route.ts"));
    expect(t).not.toMatch(/insertar|actualizar|borrar|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });
  it("la migración 0022 no contiene drop, delete, truncate ni update fuera de comentarios", () => {
    const sql = readFileSync(path.join(RAIZ, "supabase/migrations/0022_composicion_y_curva_usuario.sql"), "utf8");
    const limpio = sql.replace(/--.*$/gm, "");
    for (const palabra of ["drop", "delete", "truncate", "update"]) expect(limpio, palabra).not.toMatch(new RegExp(`\\b${palabra}\\b`, "i"));
    expect(limpio).not.toMatch(/\bdo\s+\$\$/i);
    expect(limpio).toMatch(/security invoker/);
    expect(limpio).toMatch(/set search_path = ''/);
  });
  it("ningún archivo de src escribe `origen = 'usuario'` ni `'avanzada'` (la columna origen sigue siendo propia o prestada)", () => {
    const usan = src.filter((f) => /\borigen\s*(=|:)\s*["'](usuario|avanzada)["']/.test(sinComentarios(f.texto)) && f.ruta !== "src/lib/supabase/database.types.ts").map((f) => f.ruta);
    expect(usan).toEqual([]);
  });
  it("sin dependencias nuevas", () => {
    const paquete = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(paquete.dependencies).sort()).toEqual(["@supabase/ssr", "@supabase/supabase-js", "next", "papaparse", "react", "react-dom", "server-only", "xlsx", "zod"]);
  });
  it("cache-composicion.ts tiene su propio mapa: no importa de cache-venta.ts ni de @supabase/*", () => {
    const imports = importsDe(sinComentarios(fuente("src/lib/curvas/cache-composicion.ts")));
    expect(imports.filter((i) => i.includes("cache-venta") || i.startsWith("@supabase/"))).toEqual([]);
    const t = sinComentarios(fuente("src/lib/curvas/cache-composicion.ts"));
    expect(t).toMatch(/new Map</);
    expect(t).toContain("MAX_ENTRADAS_CACHE_COMPOSICION = 10");
    expect(t).toContain("MAX_LECTURAS_COMPOSICION = 2");
    expect(t).toContain("TTL_CACHE_COMPOSICION_MS = 120_000");
  });
  it("el script del backtest offline es de solo lectura y no escribe en el repo ni en la base", () => {
    const t = sinComentarios(readFileSync(path.join(RAIZ, "scripts/backtest-fotos.ts"), "utf8"));
    expect(t).not.toMatch(/\.(insert|delete|upsert)\(/);
    expect(t).not.toMatch(/\.from\([^)]*\)\s*\.update\(/);
    expect(t).not.toMatch(/\.rpc\(/);
    // Solo escribe el archivo que se le pida con --salida (en el scratchpad), nunca nombres de agrupaciones.
    expect([...t.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim())).toEqual(["salida"]);
    expect(t).toContain("ofuscar");
  });
  it("F, U y la composición no dependen de nada de Lukers: los archivos nuevos de src no traen datos reales (sin nombres de marcas ni tiendas)", () => {
    for (const ruta of PURAS) expect(fuente(ruta)).not.toMatch(/lukers/i);
  });
});
