import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * M6 paso 2, regla 31 (estático): lo que se rompe por descuido se vigila leyendo
 * el código. Complementa a `periodos.estatico.test.ts` (guards, `supabaseAdmin`,
 * `traducirErrorDb`) y a `api.guards.estatico.test.ts` (guard como primera sentencia).
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
const fuente = (ruta: string) => src.find((f) => f.ruta === ruta)?.texto ?? "";

const CONSULTAS = "src/lib/curvas/consultas.ts";
const TIPOS_DB = "src/lib/supabase/database.types.ts";

describe("M6 paso 2: solo consultas.ts nombra la vista, las funciones y las tablas del agregado", () => {
  const NOMBRES = [
    "venta_mensual_estacionalidad",
    "refrescar_y_leer_agregado_estacionalidad",
    "refrescar_venta_mensual_estacionalidad",
    "venta_mensual_tienda",
  ];
  for (const nombre of NOMBRES) {
    it(`${nombre} solo aparece en consultas.ts (y en los tipos generados)`, () => {
      // `consultas.ts` puede no nombrarla (p. ej. la vista solo se toca por dentro de la función); lo que importa es que ningún otro archivo lo haga.
      const usan = src.filter((f) => f.texto.includes(nombre) && f.ruta !== TIPOS_DB && f.ruta !== CONSULTAS).map((f) => f.ruta);
      expect(usan).toEqual([]);
    });
  }
  it("solo consultas.ts lee corridas_estacionalidad y curvas_estacionalidad", () => {
    for (const tabla of ["corridas_estacionalidad", "curvas_estacionalidad"]) {
      const usan = src.filter((f) => new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]`).test(f.texto)).map((f) => f.ruta);
      expect(usan, tabla).toEqual([CONSULTAS]);
    }
  });
  it("ningún archivo de src llama a leerTodo sobre la vista materializada", () => {
    for (const f of src) {
      expect(f.texto, f.ruta).not.toMatch(/leerTodo[\s\S]{0,200}venta_mensual_estacionalidad/);
    }
  });
  it("el agregado se lee con la función jsonb: la consulta no pagina la vista", () => {
    const c = fuente(CONSULTAS);
    expect(c).toContain('db.rpc("refrescar_y_leer_agregado_estacionalidad")');
    expect(c).not.toMatch(/from\(\s*["'`]venta_mensual_estacionalidad/);
  });
  it("solo calcular lee el agregado: ningún otro handler importa refrescarYLeerAgregado", () => {
    const usan = src.filter((f) => /\brefrescarYLeerAgregado\b/.test(f.texto)).map((f) => f.ruta);
    expect(usan.sort()).toEqual([CONSULTAS, "src/app/api/curvas/calcular/route.ts"].sort());
  });
});

describe("M6 paso 2: pureza de la lógica", () => {
  for (const nombre of ["grafico", "red", "modelo", "obsolescencia", "anios", "candidatas", "backtesting", "liquidacion", "efecto", "estado", "entrada", "agregado"]) {
    it(`${nombre}.ts no importa de @supabase/*, de React ni de next`, () => {
      const f = fuente(`src/lib/curvas/${nombre}.ts`);
      expect(f.length, nombre).toBeGreaterThan(0);
      for (const origen of importsDe(f)) {
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/^(@supabase\/|react|next(\/|$))/);
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/supabase\/(admin|server)/);
      }
      expect(sinComentarios(f), nombre).not.toContain("supabaseAdmin");
    });
  }
  it("la lógica pura no usa Date.now ni Math.random (el modelo es determinista)", () => {
    for (const nombre of ["modelo", "red", "candidatas", "backtesting", "efecto", "anios", "obsolescencia", "atipicos"]) {
      expect(sinComentarios(fuente(`src/lib/curvas/${nombre}.ts`)), nombre).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    }
  });
  it("no se usa `any` en M6", () => {
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/curvas/") || x.ruta.startsWith("src/app/api/curvas/") || x.ruta.startsWith("src/app/api/periodos-atipicos/"))) {
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});

describe("M6 paso 2: rutas", () => {
  const rutas = src.filter((f) => f.ruta.startsWith("src/app/api/curvas/") && f.ruta.endsWith("route.ts"));
  it("existen las rutas de la ficha con sus métodos", () => {
    const metodos = (t: string) => [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
    const esperado: Record<string, string[]> = {
      "src/app/api/curvas/route.ts": ["GET"],
      "src/app/api/curvas/calcular/route.ts": ["POST"],
      "src/app/api/curvas/corridas/route.ts": ["GET"],
      "src/app/api/curvas/corridas/[id]/route.ts": ["GET", "PATCH"],
      "src/app/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]/route.ts": ["GET"],
      "src/app/api/curvas/red-comparable/route.ts": ["GET"],
      "src/app/api/curvas/anios-atipicos/route.ts": ["GET"],
      "src/app/api/curvas/agrupaciones/[id]/route.ts": ["DELETE", "PUT"],
      "src/app/api/curvas/vigentes/route.ts": ["GET"],
    };
    expect(rutas.map((r) => r.ruta).sort()).toEqual(Object.keys(esperado).sort());
    for (const r of rutas) expect(metodos(r.texto), r.ruta).toEqual(esperado[r.ruta]);
  });
  it("ninguna ruta de M6 usa otro guard que requirePlanner", () => {
    for (const r of [...rutas, ...src.filter((f) => f.ruta.startsWith("src/app/api/periodos-atipicos/"))]) {
      expect(r.texto, r.ruta).toContain("requirePlanner");
      expect(r.texto, r.ruta).not.toMatch(/requireUser|requireAdmin/);
    }
  });
  it("no existe POST /api/curvas/aprobar ni anios-atipicos/cruda ni aprobarSchema (recortes)", () => {
    expect(existsSync(path.join(RAIZ, "src/app/api/curvas/aprobar"))).toBe(false);
    expect(existsSync(path.join(RAIZ, "src/app/api/curvas/anios-atipicos/cruda"))).toBe(false);
    for (const f of src) expect(f.texto, f.ruta).not.toMatch(/aprobarSchema/);
  });
  it("calcular usa traducirErrorDb y el código del lock; el 409 sale con código calculo_en_curso", () => {
    const c = fuente("src/app/api/curvas/calcular/route.ts");
    expect(c).toContain("traducirErrorDb");
    expect(c).toContain("calculo_en_curso");
    expect(c).toContain("CODIGO_BLOQUEO");
  });
});

describe("M6 paso 2: `alcance` heredado y contrato con M7", () => {
  it("fuera de consultas.ts, atipicos.ts (temporadasDePeriodo, alcanceEspejo y resolverTemporadas) y esquemas.ts nadie lee `alcance`", () => {
    const permitidos = new Set([CONSULTAS, "src/lib/curvas/atipicos.ts", "src/lib/curvas/esquemas.ts", "src/lib/curvas/tipos-api.ts", "src/lib/curvas/tipos.ts", TIPOS_DB, "src/lib/api/errores-db.ts"]);
    const lectura = /\.alcance\b|\balcance\s*[=!]==|\{\s*alcance\b|\[\s*"alcance"\s*\]/;
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/curvas/") || x.ruta.startsWith("src/app/api/"))) {
      if (permitidos.has(f.ruta)) continue;
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(lectura);
    }
  });
  it("en atipicos.ts solo temporadasDePeriodo, alcanceEspejo y resolverTemporadas tocan alcance", () => {
    const texto = sinComentarios(fuente("src/lib/curvas/atipicos.ts"));
    // Cada aparición de `.alcance`/`alcance:` debe estar dentro de una de esas tres funciones.
    const tres = ["temporadasDePeriodo", "alcanceEspejo", "resolverTemporadas"].map((n) => {
      const i = texto.indexOf(`export function ${n}`);
      return texto.slice(i, texto.indexOf("\n}\n", i));
    });
    const resto = tres.reduce((t, bloque) => t.replace(bloque, ""), texto);
    expect(resto).not.toMatch(/\.alcance\b/);
  });
  it("tipos-api.ts documenta que M7 lee `temporadas` y no el espejo `alcance`", () => {
    const t = fuente("src/lib/curvas/tipos-api.ts").replace(/\s*\n\s*\*\s*/g, " ");
    expect(t).toMatch(/M7 lee `periodos\[\]\.temporadas`/);
    expect(t).toMatch(/`alcance` es un espejo heredado/);
    expect(t).toMatch(/NO debe usarse/);
  });
});

describe("M6 paso 2: migración 0016", () => {
  const dir = path.join(RAIZ, "supabase", "migrations");
  const m0016 = readdirSync(dir).filter((n) => n.startsWith("0016"));
  it("si existe, no contiene drop, delete, truncate ni update fuera de comentarios", () => {
    for (const nombre of m0016) {
      const texto = readFileSync(path.join(dir, nombre), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
      expect(texto, nombre).not.toMatch(/\b(drop|delete|truncate|update)\b/i);
    }
  });
});
