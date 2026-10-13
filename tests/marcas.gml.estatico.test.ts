import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Regla 19 de 02b (test estático) y guards de las rutas nuevas: reglas que se
 * rompen por descuido y no por un caso de uso, así que se vigilan leyendo el
 * código.
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
const archivo = (ruta: string) => {
  const f = src.find((x) => x.ruta === ruta);
  if (!f) throw new Error(`no existe ${ruta}`);
  return f;
};
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const metodos = (texto: string) =>
  [...texto.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
/** Para cada handler, el guard con el que empieza. */
function guards(texto: string): { metodo: string; guard: string | null }[] {
  return [...texto.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{\s*(?:const \{[^}]*\} = await (\w+)\(\);)?/g)].map(
    (m) => ({ metodo: m[1], guard: m[2] ?? null })
  );
}

const rutasEn = (dir: string) => src.filter((f) => f.ruta.startsWith(dir) && f.ruta.endsWith("route.ts"));

const GML = "src/app/api/marcas/gml-especial/";
const CONJUNTOS = "src/app/api/marcas/conjuntos/";
const NIVEL = "src/app/api/arbol/nodos/nivel/";

describe("rutas nuevas de 02b: existen con los métodos de la ficha", () => {
  it("marcas relevantes por GML", () => {
    expect(rutasEn(GML).map((f) => f.ruta).sort()).toEqual([
      `${GML}[id]/route.ts`,
      `${GML}asignar/route.ts`,
      `${GML}importar/route.ts`,
      `${GML}route.ts`,
      `${GML}sugerencias/route.ts`,
      `${GML}vigentes/route.ts`,
    ]);
    expect(metodos(archivo(`${GML}route.ts`).texto)).toEqual(["GET", "POST"]);
    expect(metodos(archivo(`${GML}[id]/route.ts`).texto)).toEqual(["DELETE", "PATCH"]);
    expect(metodos(archivo(`${GML}asignar/route.ts`).texto)).toEqual(["POST"]);
    expect(metodos(archivo(`${GML}sugerencias/route.ts`).texto)).toEqual(["GET"]);
    expect(metodos(archivo(`${GML}vigentes/route.ts`).texto)).toEqual(["GET"]);
    expect(metodos(archivo(`${GML}importar/route.ts`).texto)).toEqual(["POST"]);
  });
  it("conjuntos de marcas", () => {
    expect(rutasEn(CONJUNTOS).map((f) => f.ruta).sort()).toEqual([
      `${CONJUNTOS}importar/route.ts`,
      `${CONJUNTOS}miembros/route.ts`,
      `${CONJUNTOS}route.ts`,
      `${CONJUNTOS}sugerencias/route.ts`,
    ]);
    expect(metodos(archivo(`${CONJUNTOS}route.ts`).texto)).toEqual(["GET"]);
    expect(metodos(archivo(`${CONJUNTOS}miembros/route.ts`).texto)).toEqual(["POST"]);
    expect(metodos(archivo(`${CONJUNTOS}sugerencias/route.ts`).texto)).toEqual(["GET"]);
    expect(metodos(archivo(`${CONJUNTOS}importar/route.ts`).texto)).toEqual(["POST"]);
  });
  it("nivel de planificación", () => {
    expect(rutasEn(NIVEL).map((f) => f.ruta).sort()).toEqual([`${NIVEL}importar/route.ts`, `${NIVEL}route.ts`]);
    expect(metodos(archivo(`${NIVEL}route.ts`).texto)).toEqual(["POST"]);
    expect(metodos(archivo(`${NIVEL}importar/route.ts`).texto)).toEqual(["POST"]);
  });
});

describe("guards: toda ruta nueva de 02b empieza con requirePlanner", () => {
  for (const dir of [GML, CONJUNTOS, NIVEL]) {
    it(`todo handler bajo ${dir} usa requirePlanner (lecturas incluidas) y supabaseAdmin, nunca supabaseServer`, () => {
      const rutas = rutasEn(dir);
      expect(rutas.length).toBeGreaterThanOrEqual(2);
      for (const f of rutas) {
        const gs = guards(f.texto);
        expect(gs.length, f.ruta).toBeGreaterThan(0);
        for (const g of gs) expect(g.guard, `${f.ruta} ${g.metodo}`).toBe("requirePlanner");
        expect(f.texto, f.ruta).not.toMatch(/requireUser|requireAdmin|supabaseServer/);
        expect(f.texto, f.ruta).toContain("supabaseAdmin");
      }
    });
  }
  it("GET /api/marcas oculta la configuración de planificación a quien no edita maestros", () => {
    const f = archivo("src/app/api/marcas/route.ts").texto;
    expect(f).toContain("puedeEditarMaestros(rol)");
    expect(f).toContain("sinConfiguracionDePlanificacion");
  });
  it("GET /api/marcas/conjuntos no cuenta hechos: usa una existencia (limit 1)", () => {
    const f = archivo("src/app/api/marcas/conjuntos/route.ts").texto;
    expect(f).toContain("existenHechosDeMarca");
    expect(f).not.toContain("contarHechos");
  });
  it("lo que ya existía conserva su guard: GET /api/arbol y GET /api/marcas (requireUser); PATCH del nodo y escrituras de marcas (requirePlanner)", () => {
    expect(guards(archivo("src/app/api/arbol/route.ts").texto)).toEqual([{ metodo: "GET", guard: "requireUser" }]);
    expect(guards(archivo("src/app/api/marcas/route.ts").texto)).toEqual([
      { metodo: "GET", guard: "requireUser" },
      { metodo: "POST", guard: "requirePlanner" },
    ]);
    for (const g of guards(archivo("src/app/api/marcas/[id]/route.ts").texto)) expect(g.guard).toBe("requirePlanner");
    for (const g of guards(archivo("src/app/api/arbol/nodos/[id]/route.ts").texto)) expect(g.guard).toBe("requirePlanner");
    for (const g of guards(archivo("src/app/api/marcas/importar/route.ts").texto)) expect(g.guard).toBe("requirePlanner");
  });
});

describe("la lógica pura no depende de la base ni de la pantalla", () => {
  const PURAS = [
    "src/lib/marcas/gml/flujo.ts",
    "src/lib/marcas/gml/curva.ts",
    "src/lib/marcas/gml/reglas.ts",
    "src/lib/marcas/gml/vista.ts",
    "src/lib/marcas/gml/asignar.ts",
    "src/lib/marcas/gml/importar.ts",
    "src/lib/marcas/gml/sugerencias.ts",
    "src/lib/marcas/gml/esquemas.ts",
    "src/lib/marcas/conjuntos/reglas.ts",
    "src/lib/marcas/conjuntos/vista.ts",
    "src/lib/marcas/conjuntos/importar.ts",
    "src/lib/marcas/conjuntos/similitud.ts",
    "src/lib/marcas/conjuntos/esquemas.ts",
    "src/lib/marcas/filas.ts",
    "src/lib/arbol/nivel/reglas.ts",
    "src/lib/arbol/nivel/indice.ts",
    "src/lib/arbol/nivel/resolver.ts",
    "src/lib/arbol/nivel/importar.ts",
    "src/lib/arbol/nivel/esquemas.ts",
  ];
  it("gml/flujo.ts y gml/curva.ts (y el resto) no importan de @supabase/*, de src/components/ ni de supabaseAdmin", () => {
    for (const ruta of PURAS) {
      const f = archivo(ruta);
      const imports = [...f.texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const origen of imports) {
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/^@supabase\//);
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/components/);
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/supabase\/(admin|server|browser)/);
        expect(origen, `${ruta} importa ${origen}`).not.toMatch(/\/consultas$/);
      }
      expect(sinComentarios(f.texto), ruta).not.toContain("supabaseAdmin");
      expect(f.texto, ruta).not.toMatch(/^\s*["']use client["']/m);
    }
  });
  it("los tipos de contrato (marcas y árbol) son autocontenidos: solo `import type` de tipos puros", () => {
    for (const ruta of ["src/lib/marcas/tipos-api.ts", "src/lib/arbol/tipos-api.ts", "src/lib/arbol/tipos.ts"]) {
      const f = archivo(ruta);
      const imports = [...f.texto.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)];
      for (const m of imports) {
        expect(m[0], ruta).toMatch(/^import type /);
        expect(m[1], `${ruta} importa ${m[1]}`).toMatch(/^(\.\/|@\/lib\/arbol\/tipos$|@\/lib\/marcas\/tipos-api$)/);
      }
      expect(f.texto, ruta).not.toMatch(/supabase|use client/);
    }
  });
  it("ningún archivo nuevo usa `any`", () => {
    for (const ruta of PURAS) {
      expect(sinComentarios(archivo(ruta).texto), ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});

describe("regla 19: un solo archivo toca cada tabla y nombra cada vista o función", () => {
  const PERMITIDOS = new Set(["src/lib/supabase/database.types.ts", "src/lib/api/errores-db.ts"]);

  it("gml/consultas.ts es el único archivo de src/ que nombra las vistas y la función SQL", () => {
    const nombres = /marca_gml_especial_vigente|marcas_unidad|sugerir_marcas_relevantes/;
    const infractores = src.filter((f) => !PERMITIDOS.has(f.ruta) && nombres.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(infractores).toEqual(["src/lib/marcas/gml/consultas.ts"]);
  });
  it("las sugerencias llaman a la v2 con medida, mínimo y tope (todo se aplica en SQL)", () => {
    const consultas = sinComentarios(archivo("src/lib/marcas/gml/consultas.ts").texto);
    expect(consultas).toContain('"sugerir_marcas_relevantes_v2"');
    for (const p of ["p_desde", "p_hasta", "p_top", "p_excluir", "p_medida", "p_min_participacion"]) expect(consultas).toContain(p);
    expect(consultas).not.toMatch(/"sugerir_marcas_relevantes"/);
  });
  it("solo gml/consultas.ts lee o escribe la tabla marca_gml_especial", () => {
    const usos = src.filter((f) => /from\(\s*["'`]marca_gml_especial["'`]/.test(f.texto)).map((f) => f.ruta);
    expect(usos).toEqual(["src/lib/marcas/gml/consultas.ts"]);
  });
  it("errores-db.ts solo nombra constraints de la tabla (marca_gml_especial_*), nunca la tabla sola", () => {
    const errores = archivo("src/lib/api/errores-db.ts").texto;
    for (const m of errores.match(/marca_gml_especial\w*/g) ?? []) expect(m).toMatch(/^marca_gml_especial_\w+$/);
  });
  it("la función de sugerencias solo se llama con rpc desde consultas.ts", () => {
    const usos = src.filter((f) => /\.rpc\(\s*["'`]sugerir_marcas_relevantes/.test(f.texto)).map((f) => f.ruta);
    expect(usos).toEqual(["src/lib/marcas/gml/consultas.ts"]);
  });
  it("conjuntos/similitud.ts importa `similitud` de src/lib/ventas/ (05b) y no la reimplementa", () => {
    const f = archivo("src/lib/marcas/conjuntos/similitud.ts").texto;
    expect(f).toMatch(/import\s*\{[^}]*\bsimilitud\b[^}]*\}\s*from\s*["']@\/lib\/ventas\/sugerir-mapeo["']/);
    expect(sinComentarios(f)).not.toMatch(/function\s+(similitud|bigramas|dice)/i);
    expect(sinComentarios(f)).not.toMatch(/bigram/i);
  });
});

describe("un solo `resolverGml` para los dos importadores", () => {
  it("los importadores de niveles y de marcas relevantes lo importan de arbol/nivel/resolver", () => {
    for (const ruta of ["src/lib/arbol/nivel/importar.ts", "src/lib/marcas/gml/importar.ts"]) {
      expect(archivo(ruta).texto, ruta).toMatch(/import\s*\{[^}]*\bresolverGml\b[^}]*\}\s*from\s*["']@?[./\w-]*nivel\/resolver["']|from\s*["']\.\/resolver["']/);
    }
    const definiciones = src.filter((f) => /export function resolverGml\b/.test(f.texto)).map((f) => f.ruta);
    expect(definiciones).toEqual(["src/lib/arbol/nivel/resolver.ts"]);
  });
});
