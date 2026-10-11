import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Regla 33 (test estático) y el tope de `.in(...)` de la regla 32: reglas
 * que se rompen por descuido y no por un caso de uso, así que se vigilan
 * leyendo el código.
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

// Los únicos que nombran la tabla de hechos: sus consultas, el tipo generado y los nombres de FK.
const PERMITIDOS = new Set(["src/lib/ventas/consultas.ts", "src/lib/supabase/database.types.ts", "src/lib/api/errores-db.ts"]);

describe("regla 33: la tabla de hechos solo se toca desde consultas.ts", () => {
  it("ningún otro archivo menciona la tabla (leerla sin la vista cuenta doble los meses recargados)", () => {
    const infractores = src.filter((f) => f.texto.includes("venta_stock_mensual") && !PERMITIDOS.has(f.ruta)).map((f) => f.ruta);
    expect(infractores).toEqual([]);
  });

  it("errores-db.ts solo nombra constraints (`venta_stock_mensual_*_fkey`), nunca la tabla", () => {
    const f = src.find((x) => x.ruta === "src/lib/api/errores-db.ts");
    const menciones = f?.texto.match(/venta_stock_mensual\w*/g) ?? [];
    expect(menciones.length).toBeGreaterThan(0);
    for (const m of menciones) expect(m).toMatch(/^venta_stock_mensual_\w+_fkey$/);
  });

  it("consultas.ts es el único que la usa con `.from(...)`", () => {
    const f = src.filter((x) => /from\(\s*["'`]venta_stock_mensual["'`]/.test(x.texto)).map((x) => x.ruta);
    expect(f).toEqual(["src/lib/ventas/consultas.ts"]);
  });

  it("ningún archivo de src hace `leerTodo` sobre las tablas de hechos, de cargas ni sobre la vista", () => {
    for (const f of src) {
      if (!f.texto.includes("leerTodo")) continue;
      const lecturas = f.texto.match(/leerTodo[\s\S]{0,400}?\.from\(\s*["'`](\w+)["'`]/g) ?? [];
      for (const l of lecturas) {
        expect(l, f.ruta).not.toMatch(/venta_stock_mensual|venta_stock_vigente/);
      }
    }
  });

  it("la vista solo se lee con conteos, nunca para traer filas a Node", () => {
    const usos = src.filter((x) => x.texto.includes("venta_stock_vigente") && !PERMITIDOS.has(x.ruta));
    expect(usos.map((u) => u.ruta)).toEqual([]);
    const consultas = src.find((x) => x.ruta === "src/lib/ventas/consultas.ts")?.texto ?? "";
    for (const m of consultas.matchAll(/from\(\s*["'`]venta_stock_vigente["'`]\)([\s\S]{0,200})/g)) {
      expect(m[1]).toMatch(/count:\s*["']exact["'],\s*head:\s*true/);
    }
  });
});

describe("regla 32: ninguna ruta de M5 pasa más de 150 ids a `.in(...)`", () => {
  const ventas = src.filter((f) => f.ruta.startsWith("src/lib/ventas/") || f.ruta.startsWith("src/app/api/ventas/"));

  it("cada `.in(...)` de M5 recibe una lista literal corta", () => {
    for (const f of ventas) {
      for (const m of f.texto.matchAll(/\.in\(\s*([^,]+),\s*([^)]*)\)/g)) {
        expect(m[2].trim().startsWith("["), `${f.ruta}: ${m[0]}`).toBe(true);
        expect(m[2].split(",").length, `${f.ruta}: ${m[0]}`).toBeLessThanOrEqual(150);
      }
    }
  });

  it("todo ruta de M5 empieza con requirePlanner", () => {
    const rutas = src.filter((f) => f.ruta.startsWith("src/app/api/ventas/") && f.ruta.endsWith("route.ts"));
    expect(rutas.length).toBeGreaterThanOrEqual(7);
    for (const f of rutas) {
      const handlers = f.texto.match(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{\s*(?:const \{[^}]*\} = await (\w+)\(\);)?/g) ?? [];
      expect(handlers.length, f.ruta).toBeGreaterThan(0);
      for (const h of handlers) expect(h, `${f.ruta}: ${h}`).toContain("await requirePlanner()");
    }
  });

  it("ninguna ruta de M5 usa supabaseServer para datos", () => {
    for (const f of ventas) expect(f.texto, f.ruta).not.toContain("supabaseServer");
  });
});
