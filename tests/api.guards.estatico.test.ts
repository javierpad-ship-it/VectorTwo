import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DELEGADOS,
  analizarRuta,
  cuerpoDeFuncion,
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
    expect(escanearRutas(API, RAIZ)).toEqual([]);
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
    const delega = (f: string) => `export async function GET(request: Request) { return ${f}(cfg, request); }`;
    expect(analizarRuta("a", delega("listarCatalogo"))).toEqual([]);
    expect(analizarRuta("a", delega("listarTodoSinGuard"))).toHaveLength(1);
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
