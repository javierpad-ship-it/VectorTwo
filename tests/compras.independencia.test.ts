import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T2b es lógica pura (ficha 08, §0.8): los archivos de lógica de `src/lib/compras/` no importan `src/lib/flujo/`, ni Supabase, ni
 * `next`, y no escriben tablas. (`consultas.ts` y `servicio.ts`, de T3b, son los únicos que podrán tocar la base: no se miran aquí.)
 */

const DIR = path.resolve(__dirname, "../src/lib/compras");
const PUROS = ["reparto", "recepciones", "cancelar", "eventos", "reglas", "permisos", "importar", "proveedores", "pendientes"];

const leer = (nombre: string) => readFileSync(path.join(DIR, `${nombre}.ts`), "utf8");
const sinComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const importaciones = (src: string) => [...src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

describe("independencia de la lógica pura de compras", () => {
  it("los archivos puros existen", () => {
    const archivos = readdirSync(DIR);
    for (const p of PUROS) expect(archivos).toContain(`${p}.ts`);
  });

  it.each(PUROS)("%s no importa flujo, Supabase, next ni react", (nombre) => {
    for (const origen of importaciones(leer(nombre))) {
      expect(origen).not.toMatch(/(^|\/)flujo(\/|$)/);
      expect(origen).not.toMatch(/^@supabase\//);
      expect(origen).not.toMatch(/supabase\/(admin|server|client)/);
      expect(origen).not.toMatch(/^next(\/|$)/);
      expect(origen).not.toMatch(/^react/);
    }
  });

  it.each(PUROS)("%s no escribe tablas de compras (solo las funciones SQL escriben)", (nombre) => {
    const src = sinComentarios(leer(nombre));
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/supabaseAdmin|supabaseServer/);
  });

  it.each(PUROS)("%s no usa el reloj ni azar (determinista: `ahora` y `k'` entran como parámetros)", (nombre) => {
    const src = sinComentarios(leer(nombre));
    expect(src).not.toMatch(/new Date\(\)/);
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).not.toMatch(/Math\.random\(/);
  });
});
