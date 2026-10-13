import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reglas que se rompen por descuido en el importador masivo de agrupaciones de
 * estacionalidad, vigiladas leyendo el código: guard de la ruta, acceso a datos
 * solo desde `consultas.ts`, lógica pura y contrato de tipos autocontenido.
 */

const RAIZ = path.resolve(__dirname, "..");
const leer = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

const RUTA = "src/app/api/agrupaciones-estacionalidad/importar/route.ts";
const LOGICA = "src/lib/estacionalidad/importar-agrupaciones.ts";
const CONTRATO = "src/lib/estacionalidad/tipos-api.ts";

describe("ruta POST /api/agrupaciones-estacionalidad/importar", () => {
  const ruta = leer(RUTA);
  const codigo = sinComentarios(ruta);

  it("exporta solo POST y su primera sentencia es el guard requirePlanner", () => {
    expect([...codigo.matchAll(/export async function (\w+)\(/g)].map((m) => m[1])).toEqual(["POST"]);
    expect(codigo).toMatch(
      /export async function POST\(request: NextRequest\)\s*\{\s*const \{ response \} = await requirePlanner\(\);\s*if \(response\) return response;/
    );
    expect(codigo).not.toMatch(/requireUser|requireAdmin/);
  });

  it("lee el cuerpo con leerCuerpo y su esquema, y traduce los errores de base", () => {
    expect(codigo).toContain("leerCuerpo(request, importarAgrupacionesSchema)");
    expect(codigo).toContain("traducirErrorDb");
  });

  it("los datos salen de supabaseAdmin, nunca de supabaseServer, y la ruta no nombra tablas", () => {
    expect(codigo).toContain("supabaseAdmin()");
    expect(codigo).not.toContain("supabaseServer");
    expect(codigo).not.toMatch(/\.from\(/);
  });
});

describe("lógica y contrato", () => {
  it("la lógica pura no toca la base ni el cliente de Next", () => {
    const logica = leer(LOGICA);
    expect(logica).not.toMatch(/supabaseAdmin|supabaseServer|\.from\(|^\s*["']use client["']/m);
    for (const origen of importsDe(logica)) {
      expect(origen, origen).not.toMatch(/^@supabase\//);
      expect(origen, origen).not.toMatch(/supabase\/(admin|server)/);
      expect(origen, origen).not.toMatch(/components|^next\//);
    }
  });

  it("solo consultas.ts escribe las tablas de agrupaciones para esta carga", () => {
    for (const ruta of [RUTA, LOGICA]) {
      // Los tipos `Tables<"...">` son de compilación; lo que no puede haber es acceso a datos (`.from(...)`).
      const sinTipos = sinComentarios(leer(ruta)).replace(/Tables<"[a-z_]+">/g, "");
      expect(sinTipos, ruta).not.toMatch(/agrupaciones_estacionalidad|agrupacion_estacionalidad_genero/);
    }
    const consultas = leer("src/lib/estacionalidad/consultas.ts");
    expect(consultas).toContain("crearAgrupacionesConGeneros");
    expect(consultas).toContain("cargarEstadoImportacionAgrupaciones");
  });

  it("tipos-api.ts es contrato puro: sin 'use client', sin base de datos y solo imports de tipos", () => {
    const contrato = leer(CONTRATO);
    expect(contrato).not.toMatch(/^\s*["']use client["']/m);
    expect(contrato).not.toMatch(/supabaseAdmin|supabaseServer/);
    for (const linea of contrato.split("\n").filter((l) => /^import\s/.test(l))) expect(linea).toMatch(/^import type /);
    for (const origen of importsDe(contrato)) expect(origen, origen).not.toMatch(/^@supabase\/|supabase\/(admin|server)/);
  });
});
