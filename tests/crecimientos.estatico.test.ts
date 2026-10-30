import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 06d y 06e (estático): lo que se rompe por descuido se vigila leyendo el código. Complementa a `api.guards.estatico.test.ts` (guard como
 * primera sentencia) y a `proyeccion.estatico.test.ts` (solo `proyeccion/consultas.ts` toca las tablas de M7). 06e: R26 (el umbral de
 * materialidad vive en `correccionMaterial`) y R27 (todo `insert` en `crecimientos_genero_mundo` lleva `sobre_base`).
 */

const RAIZ = path.resolve(__dirname, "..");

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(nombre) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");
const src = archivos(path.join(RAIZ, "src")).map((p) => ({ ruta: rel(p), texto: readFileSync(p, "utf8") }));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1] as string);
const fuente = (ruta: string) => src.find((f) => f.ruta === ruta)?.texto ?? "";

const LIB = "src/lib/crecimientos/";
const CONSULTAS = `${LIB}consultas.ts`;
const CONSULTAS_VIGENTES = `${LIB}consultas-vigentes.ts`;
const TIPOS_DB = "src/lib/supabase/database.types.ts";
const DELA_LIB = src.filter((f) => f.ruta.startsWith(LIB));
const RUTAS = src.filter((f) => f.ruta.startsWith("src/app/api/curvas/genero-mundo/") && f.ruta.endsWith("route.ts"));

describe("06d: la base solo se nombra en consultas", () => {
  it("crecimientos_genero_mundo y venta_genero_mundo solo aparecen en consultas.ts y consultas-vigentes.ts (y los tipos generados)", () => {
    for (const nombre of ["crecimientos_genero_mundo", "venta_genero_mundo"]) {
      const usan = src.filter((f) => sinComentarios(f.texto).includes(nombre) && f.ruta !== TIPOS_DB && f.ruta !== CONSULTAS && f.ruta !== CONSULTAS_VIGENTES).map((f) => f.ruta);
      expect(usan, nombre).toEqual([]);
    }
    expect(sinComentarios(fuente(CONSULTAS))).toContain('db.rpc("venta_genero_mundo"');
    expect(sinComentarios(fuente(CONSULTAS))).toContain('.from("crecimientos_genero_mundo")');
  });

  it("la venta se lee con la función jsonb, sin paginar ninguna vista", () => {
    expect(sinComentarios(fuente(CONSULTAS))).not.toMatch(/from\(\s*["'`]venta_/);
  });

  it("nada de src/lib/crecimientos ni de las rutas escribe .from() de las tablas de M7: se lee con proyeccion/consultas.ts", () => {
    for (const f of [...DELA_LIB, ...RUTAS]) {
      for (const tabla of ["proyecciones", "proyeccion_filas", "proyeccion_fila_anios", "proyeccion_tiendas", "proyeccion_crecimientos", "factores_volumen_atipico"]) {
        expect(f.texto, `${f.ruta} · ${tabla}`).not.toMatch(new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]`));
      }
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/\.from\(\s*["'`]proyeccion/);
    }
  });

  it("solo consultas.ts y consultas-vigentes.ts llaman a db.from(), db.rpc(), .insert(), .update({…}) o .upsert()", () => {
    for (const f of [...DELA_LIB, ...RUTAS]) {
      // huellas.ts usa `createHash().update()` (md5), que no es la base.
      if (f.ruta === CONSULTAS || f.ruta === CONSULTAS_VIGENTES || f.ruta === `${LIB}huellas.ts`) continue;
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/\bdb\.(from|rpc)\(|\.(insert|upsert)\(|\.update\(\s*\{/);
    }
  });

  it("aprobar no escribe en proyecciones: servicio.ts solo importa de consultas.ts las funciones de versiones", () => {
    const t = sinComentarios(fuente(`${LIB}servicio.ts`));
    expect(t).toMatch(/insertarVersion\(/);
    expect(t).not.toMatch(/actualizarProyeccionDb|upsertCrecimientos|borrarCrecimientos|upsertFilas|upsertAnios|cambiarEstadoProyeccion|guardarResultadoCalculo|escribirFotoCrecimientos/);
  });
});

describe("06d: pureza de la lógica", () => {
  for (const nombre of ["comparables", "series", "referencias", "reglas", "huellas", "cache", "vigentes", "tipos-api", "esquemas", "cierre-curva"]) {
    it(`${nombre}.ts no importa de @supabase/*, de React ni de next, ni nombra supabaseAdmin`, () => {
      const f = fuente(`${LIB}${nombre}.ts`);
      expect(f.length, nombre).toBeGreaterThan(0);
      for (const origen of importsDe(f)) {
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/^(@supabase\/|react|next(\/|$))/);
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/supabase\/(admin|server)/);
      }
      expect(sinComentarios(f), nombre).not.toContain("supabaseAdmin");
    });
  }

  it("las reglas, las cifras y las series no usan el reloj ni el azar", () => {
    for (const nombre of ["comparables", "series", "referencias", "reglas", "huellas", "cierre-curva"]) {
      expect(sinComentarios(fuente(`${LIB}${nombre}.ts`)), nombre).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    }
  });

  it("los handlers calculan las reglas con reglas.ts: no las reimplementan", () => {
    const s = sinComentarios(fuente(`${LIB}servicio.ts`));
    for (const nombre of ["motivoRechazoAprobar", "motivoRechazoGeneroMundo", "motivoRechazoAnio", "motivoRechazoReferencia", "motivoRechazoBaseAnio", "motivoRechazoAnioSiguienteAtipico", "evaluarObsoleto", "siguienteVersion", "aniosPermitidos"]) {
      expect(s, nombre).toContain(`${nombre}(`);
    }
    expect(s).not.toMatch(/0[.,]5\b|UMBRAL_OBSOLETO|TOLERANCIA_NOTA/);
  });

  it("R26 · hay_nino sale de correccionMaterial: servicio.ts y cierre-curva.ts la llaman y ninguno define su propio umbral", () => {
    for (const nombre of ["servicio", "cierre-curva"]) {
      const t = sinComentarios(fuente(`${LIB}${nombre}.ts`));
      expect(t, nombre).toContain("correccionMaterial(");
      expect(t, nombre).not.toMatch(/UMBRAL_CORRECCION_NINO|\b0[.,]005\b/);
    }
    // La función vive en proyeccion/factor-nino.ts y es la única que lee el umbral.
    expect(sinComentarios(fuente("src/lib/proyeccion/factor-nino.ts"))).toMatch(/export function correccionMaterial\(/);
  });

  it("R27 · todo insert en crecimientos_genero_mundo lleva sobre_base explícito (y es corregida)", () => {
    const usos = DELA_LIB.flatMap((f) => [...sinComentarios(f.texto).matchAll(/insertarVersion\(\s*db,\s*\{([\s\S]*?)\}\);/g)].map((m) => ({ ruta: f.ruta, cuerpo: m[1] as string })));
    expect(usos.length).toBeGreaterThan(0);
    for (const u of usos) expect(u.cuerpo, u.ruta).toMatch(/sobre_base:\s*"corregida"/);
    // consultas.ts solo define el insert genérico; ningún otro archivo de la lib ni de las rutas lo escribe a mano.
    for (const f of [...DELA_LIB, ...RUTAS]) {
      if (f.ruta === CONSULTAS) continue;
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/crecimientos_genero_mundo["'`]\)\s*\.insert/);
    }
  });

  it("no se usa `any`", () => {
    for (const f of [...DELA_LIB, ...RUTAS]) {
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});

describe("06d: las rutas", () => {
  it("existen exactamente dos rutas con sus métodos", () => {
    const metodos = (t: string) => [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
    const esperado: Record<string, string[]> = {
      "src/app/api/curvas/genero-mundo/route.ts": ["GET"],
      "src/app/api/curvas/genero-mundo/[clave]/route.ts": ["GET", "POST"],
    };
    expect(RUTAS.map((r) => r.ruta).sort()).toEqual(Object.keys(esperado).sort());
    for (const r of RUTAS) expect(metodos(r.texto), r.ruta).toEqual(esperado[r.ruta]);
  });

  it("GET /api/curvas/genero-mundo/vigentes no existe (se quitó de 0.12.1)", () => {
    expect(existsSync(path.join(RAIZ, "src/app/api/curvas/genero-mundo/vigentes"))).toBe(false);
  });

  it("todas abren con requirePlanner (ningún otro guard) y responden con ok(), error() o errorConCodigo()", () => {
    for (const r of RUTAS) {
      expect(r.texto, r.ruta).toContain("requirePlanner");
      expect(r.texto, r.ruta).not.toMatch(/requireUser|requireAdmin/);
      expect(sinComentarios(r.texto), r.ruta).toMatch(/\b(ok|error|errorConCodigo)\(|return contexto\.respuesta|return response|return aprobarCrecimiento/);
    }
  });

  it("cada handler empieza con el guard como primera sentencia", () => {
    for (const r of RUTAS) {
      const t = sinComentarios(r.texto);
      for (const m of t.matchAll(/export async function (GET|POST)\([^)]*\)\s*\{\s*([^\n]*)/g)) {
        expect(m[2], `${r.ruta} ${m[1]}`).toMatch(/await requirePlanner\(\)/);
      }
    }
  });

  it("el POST lee el cuerpo con leerCuerpo, responde base_retirada con esBaseRetirada y revalida con el esquema estricto", () => {
    const t = sinComentarios(fuente("src/app/api/curvas/genero-mundo/[clave]/route.ts"));
    expect(t).toMatch(/leerCuerpo\(request, aprobarCrecimientoSchema\)/);
    expect(t).toMatch(/esBaseRetirada\(/);
    expect(t).toContain("MENSAJE_BASE_RETIRADA");
    expect(t).toContain('"base_retirada"');
    expect(t).toContain("aprobarCrecimientoSchemaEstricto");
    // `base_retirada` se responde justo después de leer el cuerpo, antes de llamar al servicio.
    expect(t.indexOf("esBaseRetirada(")).toBeGreaterThan(t.indexOf("leerCuerpo("));
    expect(t.indexOf("esBaseRetirada(")).toBeLessThan(t.indexOf("aprobarCrecimiento(supabaseAdmin()"));
    expect(t).not.toMatch(/request\.(json|text)\(/);
    expect(sinComentarios(fuente(`${LIB}esquemas.ts`))).toMatch(/\.strict\(\)\s*\.superRefine/);
  });

  it("los datos solo pasan por supabaseAdmin(): ninguna ruta nombra supabaseServer", () => {
    for (const r of RUTAS) expect(sinComentarios(r.texto), r.ruta).not.toContain("supabaseServer");
  });
});
