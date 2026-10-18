import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DELEGADOS,
  analizarRuta,
  cuerpoDeFuncion,
  describirViolaciones,
  escanearRutas,
  limpiar,
  primeraSentencia,
  rutasDeApi,
} from "./api.guards.analizador";

/**
 * M-7: cada handler exportado de `src/app/api/**\/route.ts` debe abrir con el
 * guard. Si alguien añade una ruta sin `requireUser` / `requirePlanner` /
 * `requireAdmin` (o delega en algo que no está en la lista blanca), este test
 * falla. El analizador vive en `api.guards.analizador.ts` y también se prueba
 * con casos sintéticos y con una ruta falsa en un directorio temporal.
 */

const RAIZ = path.resolve(__dirname, "..");
const API = path.join(RAIZ, "src", "app", "api");

const leerFuente = (rel: string) => limpiar(readFileSync(path.join(RAIZ, rel), "utf8"));

describe("rutas reales de la API", () => {
  it("hay rutas que revisar (el recorrido no está vacío)", () => {
    expect(rutasDeApi(API).length).toBeGreaterThan(40);
  });

  it("todos los handlers exportados empiezan con un guard o delegan en una función con guard", () => {
    const violaciones = escanearRutas(API, RAIZ);
    expect(
      violaciones,
      `Estos handlers no abren con requireUser / requirePlanner / requireAdmin como PRIMERA sentencia:\n${describirViolaciones(violaciones)}\n`
    ).toEqual([]);
  });

  it("ninguna ruta lee el cuerpo por su cuenta: todo pasa por leerCuerpo (tope de 6 MB)", () => {
    const sueltas: string[] = [];
    for (const archivo of rutasDeApi(API)) {
      const limpio = limpiar(readFileSync(archivo, "utf8"));
      if (/\.(json|text|formData|arrayBuffer|blob)\s*\(|\.body\b/.test(limpio.replace(/NextResponse\.json|Response\.json/g, ""))) {
        sueltas.push(path.relative(RAIZ, archivo));
      }
    }
    expect(sueltas, `Rutas que leen el cuerpo sin leerCuerpo (sin tope de tamaño):\n${sueltas.join("\n")}`).toEqual([]);
  });

  it("cada ruta que recibe cuerpo (POST/PUT/PATCH) lo lee con leerCuerpo, directamente o vía la lista blanca", () => {
    const sin: string[] = [];
    for (const archivo of rutasDeApi(API)) {
      const limpio = limpiar(readFileSync(archivo, "utf8"));
      for (const metodo of ["POST", "PUT", "PATCH"]) {
        const cuerpo = cuerpoDeFuncion(limpio, metodo);
        if (cuerpo === null) continue;
        const primera = primeraSentencia(cuerpo);
        if (primera.tipo === "delegado" || /\bleerCuerpo\s*\(/.test(cuerpo)) continue;
        // POST sin cuerpo (p. ej. acciones como "calcular") es válido si no usa `request`.
        if (!/\brequest\b/.test(cuerpo)) continue;
        sin.push(`${path.relative(RAIZ, archivo)} ${metodo}`);
      }
    }
    expect(sin, `Handlers con petición que no usan leerCuerpo:\n${sin.join("\n")}`).toEqual([]);
  });
});

describe('módulos con service role marcados con import "server-only"', () => {
  const MARCADOS = [
    "src/lib/supabase/admin.ts",
    "src/lib/supabase/server.ts",
    "src/lib/auth/guard.ts",
    "src/lib/api/catalogo.ts",
    "src/lib/estacionalidad/agrupaciones.ts",
    "src/lib/arbol/consultas.ts",
    "src/lib/arbol/nivel/consultas.ts",
    "src/lib/marcas/consultas.ts",
    "src/lib/marcas/gml/consultas.ts",
    "src/lib/marcas/gml/estado.ts",
    "src/lib/marcas-barrer/consultas.ts",
    "src/lib/marcas-barrer/servicio.ts",
    "src/lib/estacionalidad/consultas.ts",
    "src/lib/reportes/consultas.ts",
    "src/lib/responsables/consultas.ts",
    "src/lib/ventas/consultas.ts",
  ];

  for (const rel of MARCADOS) {
    it(`${rel} importa "server-only"`, () => {
      expect(readFileSync(path.join(RAIZ, rel), "utf8")).toMatch(/^import "server-only";/m);
    });
  }

  it("ningún componente cliente importa supabase/admin, supabase/server ni el guard (ni directamente ni los módulos marcados)", () => {
    const prohibidos = MARCADOS.map((m) => "@/" + m.replace(/^src\//, "").replace(/\.ts$/, ""));
    const ofensores: string[] = [];
    const recorrer = (d: string) => {
      for (const nombre of readdirSync(d)) {
        const p = path.join(d, nombre);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (/\.(ts|tsx)$/.test(nombre)) {
          const texto = readFileSync(p, "utf8");
          if (!/^\s*["']use client["']/.test(texto)) continue;
          for (const m of prohibidos) if (texto.includes(`"${m}"`)) ofensores.push(`${path.relative(RAIZ, p)} importa ${m}`);
        }
      }
    };
    recorrer(path.join(RAIZ, "src"));
    expect(ofensores).toEqual([]);
  });
});

describe("funciones de la lista blanca (catalogo.ts y agrupaciones.ts)", () => {
  for (const [funcion, archivo] of Object.entries(DELEGADOS)) {
    it(`${funcion} (${archivo}) abre con el guard`, () => {
      const cuerpo = cuerpoDeFuncion(leerFuente(archivo), funcion);
      expect(cuerpo, `no se encontró ${funcion}`).not.toBeNull();
      const primera = primeraSentencia(cuerpo ?? "", true);
      expect(primera.tipo).toBe("guard");
    });
  }

  it("cada configuración de catálogo asigna a guardLectura y guardEscritura un guard real", () => {
    const configuraciones = ["src/lib/arbol/catalogos.ts", "src/lib/marcas/catalogos.ts", "src/lib/estacionalidad/catalogos.ts"];
    let total = 0;
    for (const archivo of configuraciones) {
      for (const m of leerFuente(archivo).matchAll(/guard(Lectura|Escritura)\s*:\s*([\w$.]+)/g)) {
        total++;
        expect(m[2], `${archivo}: guard${m[1]}`).toMatch(/^(requireUser|requirePlanner|requireAdmin)$/);
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe("analizador (casos sintéticos)", () => {
  const ok = `
    import { requireUser } from "@/lib/auth/guard";
    export async function GET(request: NextRequest) {
      const { response } = await requireUser();
      if (response) return response;
      return ok([]);
    }
  `;

  it("acepta los tres guards y la desestructuración con más campos", () => {
    expect(analizarRuta("a", ok)).toEqual([]);
    expect(analizarRuta("a", ok.replace("requireUser();", "requirePlanner();"))).toEqual([]);
    expect(analizarRuta("a", ok.replace("{ response }", "{ perfil: actor, response }").replace("requireUser();", "requireAdmin();"))).toEqual([]);
  });

  it("falla si el handler no tiene guard", () => {
    const sin = `export async function POST(request: Request) { return ok(await hacer(request)); }`;
    expect(analizarRuta("api/falsa/route.ts", sin)).toEqual([
      { archivo: "api/falsa/route.ts", metodo: "POST", motivo: expect.stringContaining("lista blanca") },
    ]);
  });

  it("falla si el guard no es lo primero", () => {
    const tarde = `
      export async function DELETE(request: Request, { params }: Params) {
        const { id } = await params;
        const { response } = await requireAdmin();
        if (response) return response;
        return ok({ id });
      }
    `;
    expect(analizarRuta("a", tarde)).toHaveLength(1);
  });

  it("falla si se obtiene el guard pero no se corta con la respuesta", () => {
    const olvida = `export async function GET() { const { response } = await requireUser(); return ok([]); }`;
    expect(analizarRuta("a", olvida)).toHaveLength(1);
  });

  it("una mención en un comentario o en una cadena no cuenta como guard", () => {
    const comentario = `
      /** Lista (requireUser). */
      export async function GET() {
        // const { response } = await requireUser(); if (response) return response;
        const texto = "const { response } = await requireAdmin(); if (response) return response;";
        return ok(texto);
      }
    `;
    expect(analizarRuta("a", comentario)).toHaveLength(1);
  });

  it("revisa cada método exportado por separado", () => {
    const mixto = `${ok}\nexport async function PATCH() { return ok(1); }`;
    expect(analizarRuta("a", mixto).map((v) => v.metodo)).toEqual(["PATCH"]);
  });

  it("falla ante formas de export que no sabe leer", () => {
    expect(analizarRuta("a", `export const GET = async () => ok([]);`)).toHaveLength(1);
    expect(analizarRuta("a", `async function GET() {}\nexport { GET };`)).toHaveLength(1);
  });

  it("delegar solo vale hacia la lista blanca", () => {
    const delega = (f: string) => `import { ${f} } from "@/lib/api/catalogo";\nexport async function GET(request: Request) { return ${f}(cfg, request); }`;
    expect(analizarRuta("a", delega("listarCatalogo"))).toEqual([]);
    expect(analizarRuta("a", delega("listarTodoSinGuard"))).toHaveLength(1);
  });

  it("delegar exige importar la función del módulo de la lista blanca (no una copia local)", () => {
    const local = `function listarCatalogo() { return ok([]); }\nexport async function GET(request: Request) { return listarCatalogo(cfg, request); }`;
    expect(analizarRuta("a", local)).toEqual([expect.objectContaining({ metodo: "GET", motivo: expect.stringContaining("no la importa") })]);
    const otroModulo = `import { listarCatalogo } from "./mio";\nexport async function GET(request: Request) { return listarCatalogo(cfg, request); }`;
    expect(analizarRuta("a", otroModulo)).toHaveLength(1);
  });

  it("falla ante re-exports y exports con desestructuración o generadores", () => {
    expect(analizarRuta("a", `export { GET } from "./otro";`)).toHaveLength(1);
    expect(analizarRuta("a", `export { handler as POST };`)).toHaveLength(1);
    expect(analizarRuta("a", `export * from "./otro";`).length).toBeGreaterThan(0);
    expect(analizarRuta("a", `export const { GET, POST } = handlers;`)).toHaveLength(1);
    expect(analizarRuta("a", `export let DELETE = () => ok(1);`)).toHaveLength(1);
  });

  it("falla si el route.ts no exporta ningún método", () => {
    expect(analizarRuta("a", `export const dynamic = "force-dynamic";`)).toEqual([
      expect.objectContaining({ metodo: "*", motivo: expect.stringContaining("ningún método") }),
    ]);
  });

  it("falla si el handler llama a otra función antes del guard, aunque luego lo tenga", () => {
    const antes = `
      export async function PATCH(request: Request) {
        await registrarAcceso(request);
        const { response } = await requirePlanner();
        if (response) return response;
        return ok(1);
      }
    `;
    expect(analizarRuta("a", antes)).toHaveLength(1);
    const delegaTarde = `export async function GET() { const x = 1; return listarCatalogo(cfg); }`;
    expect(analizarRuta("a", delegaTarde)).toHaveLength(1);
  });

  it("lee bien un handler con tipo de retorno literal y con plantillas anidadas", () => {
    const conTipo = `
      export async function GET(request: Request): Promise<Response | { x: 1 }> {
        const { response } = await requireUser();
        if (response) return response;
        return ok(\`a\${\`b\${"}"}\`}\`);
      }
    `;
    expect(analizarRuta("a", conTipo)).toEqual([]);
    const sinGuard = `export async function GET(): Promise<{ a: 1 }> { return ok(\`\${"requireUser"}\`); }`;
    expect(analizarRuta("a", sinGuard)).toHaveLength(1);
  });

  it("si las llaves no cuadran tras limpiar, no se fía del análisis y falla", () => {
    const regexConComilla = `
      export async function GET() {
        const { response } = await requireUser();
        if (response) return response;
        const r = /"/g; return ok(r.source + "{");
      }
    `;
    expect(analizarRuta("a", regexConComilla)).toHaveLength(1);
  });

  it("describirViolaciones da un mensaje claro", () => {
    const v = analizarRuta("src/app/api/falsa/route.ts", `export async function POST() { const x = 1; return ok(x); }`);
    expect(describirViolaciones(v)).toBe(
      "  - src/app/api/falsa/route.ts -> POST: la primera sentencia no es el guard (requireUser / requirePlanner / requireAdmin)"
    );
  });

  it("no se despista con llaves dentro de cadenas ni con parámetros desestructurados", () => {
    const raro = `
      export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
        const { response } = await requirePlanner();
        if (response) return response;
        return ok("}}}");
      }
    `;
    expect(analizarRuta("a", raro)).toEqual([]);
  });
});

describe("ruta falsa en un directorio temporal", () => {
  it("el escáner la detecta; con guard no hay violaciones", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vector2-guards-"));
    try {
      mkdirSync(path.join(dir, "falsa"), { recursive: true });
      mkdirSync(path.join(dir, "buena"), { recursive: true });
      writeFileSync(path.join(dir, "falsa", "route.ts"), `export async function GET() { return Response.json({ secreto: 1 }); }\n`);
      writeFileSync(
        path.join(dir, "buena", "route.ts"),
        `export async function GET() {\n  const { response } = await requireUser();\n  if (response) return response;\n  return Response.json({});\n}\n`
      );
      const violaciones = escanearRutas(dir);
      expect(violaciones.map((v) => `${v.archivo}:${v.metodo}`)).toEqual(["falsa/route.ts:GET"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
