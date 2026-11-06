import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DELEGADOS,
  ESCRITURAS_ABIERTAS_A_COMPRADOR,
  LECTURAS_ABIERTAS_A_COMPRADOR,
  analizarAperturas,
  analizarRuta,
  cuerpoDeFuncion,
  describirViolaciones,
  escanearAperturas,
  escanearRutas,
  limpiar,
  metodosConRequireUser,
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

describe("el comprador solo escribe lo decidido (requireUser en escrituras y lecturas)", () => {
  const listas = { escrituras: ESCRITURAS_ABIERTAS_A_COMPRADOR, lecturas: LECTURAS_ABIERTAS_A_COMPRADOR };

  it("toda escritura con requireUser está en ESCRITURAS_ABIERTAS_A_COMPRADOR y toda lectura en LECTURAS_ABIERTAS_A_COMPRADOR (y las listas no tienen entradas muertas)", () => {
    const violaciones = escanearAperturas(API, RAIZ, listas);
    expect(violaciones, `Aperturas al comprador sin registrar o listas obsoletas:\n${describirViolaciones(violaciones)}\n`).toEqual([]);
  });

  it("las 19 escrituras abiertas (decisiones 92 y 108) son exactamente las de compras: viajes, embarques, paquetes, agrupadores, viaje activo e importar", () => {
    expect(ESCRITURAS_ABIERTAS_A_COMPRADOR.size).toBe(19);
    for (const clave of ESCRITURAS_ABIERTAS_A_COMPRADOR) {
      expect(clave, clave).toMatch(/^src\/app\/api\/compras\/(?:agrupadores|embarques|paquetes|viajes|viaje-activo|importar)(?:\/|\/route\.ts)/);
      expect(clave, clave).toMatch(/#(?:POST|PUT|PATCH|DELETE)$/);
    }
  });

  it("ninguna lectura abierta es de un método de escritura y viceversa", () => {
    for (const clave of LECTURAS_ABIERTAS_A_COMPRADOR) expect(clave, clave).toMatch(/#(?:GET|HEAD|OPTIONS)$/);
    for (const clave of ESCRITURAS_ABIERTAS_A_COMPRADOR) expect(clave, clave).not.toMatch(/#(?:GET|HEAD|OPTIONS)$/);
  });

  it("solo ESCRITURAS de compras llevan requireUser: el resto de escrituras exige planner o admin", () => {
    const fueraDeLista: string[] = [];
    for (const archivo of rutasDeApi(API)) {
      const rel = path.relative(RAIZ, archivo).split(path.sep).join("/");
      for (const metodo of metodosConRequireUser(readFileSync(archivo, "utf8"))) {
        if (["POST", "PUT", "PATCH", "DELETE"].includes(metodo) && !rel.startsWith("src/app/api/compras/")) fueraDeLista.push(`${rel}#${metodo}`);
      }
    }
    expect(fueraDeLista).toEqual([]);
  });

  it("los catálogos (delegados) solo abren la lectura al comprador: guardEscritura nunca es requireUser", () => {
    const configuraciones = ["src/lib/arbol/catalogos.ts", "src/lib/marcas/catalogos.ts", "src/lib/estacionalidad/catalogos.ts"];
    const escrituras: string[] = [];
    for (const archivo of configuraciones) {
      for (const m of leerFuente(archivo).matchAll(/guardEscritura\s*:\s*([\w$.]+)/g)) escrituras.push(`${archivo}: ${m[1]}`);
    }
    expect(escrituras.length).toBeGreaterThan(0);
    expect(escrituras.filter((e) => e.endsWith("requireUser"))).toEqual([]);
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
    "src/lib/intercompany/consultas.ts",
    "src/lib/intercompany/servicio.ts",
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

describe("analizador de aperturas al comprador (casos sintéticos)", () => {
  const ruta = (metodo: string, guard: string) =>
    `export async function ${metodo}(request: Request) {\n  const { response } = await ${guard}();\n  if (response) return response;\n  return ok(1);\n}\n`;
  const vacias = { escrituras: new Set<string>(), lecturas: new Set<string>() };
  const ARCHIVO = "src/app/api/nueva/route.ts";

  it("una escritura nueva con requireUser falla", () => {
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
      const v = analizarAperturas(ARCHIVO, ruta(metodo, "requireUser"), vacias);
      expect(v, metodo).toEqual([{ archivo: ARCHIVO, metodo, motivo: expect.stringContaining("escritura con requireUser sin registrar") }]);
    }
  });

  it("la misma escritura registrada en la lista pasa", () => {
    const listas = { ...vacias, escrituras: new Set([`${ARCHIVO}#POST`]) };
    expect(analizarAperturas(ARCHIVO, ruta("POST", "requireUser"), listas)).toEqual([]);
  });

  it("registrar el POST no cubre un PATCH de la misma ruta", () => {
    const listas = { ...vacias, escrituras: new Set([`${ARCHIVO}#POST`]) };
    const texto = ruta("POST", "requireUser") + ruta("PATCH", "requireUser");
    expect(analizarAperturas(ARCHIVO, texto, listas).map((v) => v.metodo)).toEqual(["PATCH"]);
  });

  it("la lista de lecturas no vale para una escritura (ni al revés)", () => {
    const soloLecturas = { ...vacias, lecturas: new Set([`${ARCHIVO}#POST`]) };
    expect(analizarAperturas(ARCHIVO, ruta("POST", "requireUser"), soloLecturas)).toHaveLength(1);
    const soloEscrituras = { ...vacias, escrituras: new Set([`${ARCHIVO}#GET`]) };
    expect(analizarAperturas(ARCHIVO, ruta("GET", "requireUser"), soloEscrituras)).toHaveLength(1);
  });

  it("una lectura nueva con requireUser falla hasta registrarla", () => {
    expect(analizarAperturas(ARCHIVO, ruta("GET", "requireUser"), vacias)).toEqual([
      { archivo: ARCHIVO, metodo: "GET", motivo: expect.stringContaining("lectura con requireUser sin registrar") },
    ]);
    expect(analizarAperturas(ARCHIVO, ruta("GET", "requireUser"), { ...vacias, lecturas: new Set([`${ARCHIVO}#GET`]) })).toEqual([]);
  });

  it("requirePlanner y requireAdmin no necesitan registro", () => {
    for (const guard of ["requirePlanner", "requireAdmin"]) {
      for (const metodo of ["GET", "POST", "PATCH", "DELETE"]) expect(analizarAperturas(ARCHIVO, ruta(metodo, guard), vacias), `${guard} ${metodo}`).toEqual([]);
    }
  });

  it("una mención de requireUser en un comentario no cuenta", () => {
    const texto = `// requireUser\n${ruta("POST", "requirePlanner")}`;
    expect(metodosConRequireUser(texto)).toEqual([]);
  });

  it("en un directorio temporal: la escritura nueva con requireUser falla, la registrada pasa y la entrada muerta se señala", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vector2-aperturas-"));
    try {
      mkdirSync(path.join(dir, "api", "nueva"), { recursive: true });
      writeFileSync(path.join(dir, "api", "nueva", "route.ts"), ruta("POST", "requireUser"));
      const clave = "api/nueva/route.ts#POST";
      const api = path.join(dir, "api");
      expect(escanearAperturas(api, dir, vacias).map((v) => `${v.archivo}#${v.metodo}`)).toEqual([clave]);
      expect(escanearAperturas(api, dir, { ...vacias, escrituras: new Set([clave]) })).toEqual([]);
      const muerta = escanearAperturas(api, dir, { ...vacias, escrituras: new Set([clave, "api/borrada/route.ts#POST"]) });
      expect(muerta).toEqual([expect.objectContaining({ archivo: "api/borrada/route.ts", metodo: "POST", motivo: expect.stringContaining("obsoleta") })]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
