import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Regla 19 de la ficha 12 (pruebas estáticas): lo que se rompe por descuido y no por un caso de uso se vigila leyendo el código.
 * Más la prueba de `modalidad_tratamiento` de 6.1 (la `mixta` es `por_gml` + `resto_al_barrer`: nadie fuera de las reglas lee la
 * columna sola).
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
const lib = src.filter((f) => f.ruta.startsWith("src/lib/marcas-barrer/"));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const archivo = (ruta: string) => {
  const f = src.find((x) => x.ruta === ruta);
  if (!f) throw new Error(`no existe ${ruta}`);
  return f;
};

/** Los módulos de servidor de M12: leen datos o los escriben. El resto de `src/lib/marcas-barrer/` es lógica pura. */
const DE_SERVIDOR = ["src/lib/marcas-barrer/consultas.ts", "src/lib/marcas-barrer/servicio.ts", "src/lib/marcas-barrer/rutas.ts"];
const PUROS = lib.filter((f) => !DE_SERVIDOR.includes(f.ruta));

describe("datos solo en consultas.ts", () => {
  it("solo consultas.ts nombra las dos funciones SQL y las dos tablas de repartos", () => {
    const ofensores = src
      .filter((f) => /venta_marca_gml|venta_marca_gml_resumen|repartos_marca_barrido|reparto_marca_barrido_gml/.test(sinComentarios(f.texto)))
      .map((f) => f.ruta)
      .filter((r) => r !== "src/lib/marcas-barrer/consultas.ts" && r !== "src/lib/supabase/database.types.ts");
    expect(ofensores).toEqual([]);
    expect(sinComentarios(archivo("src/lib/marcas-barrer/consultas.ts").texto)).toContain("venta_marca_gml_resumen");
  });
  it("consultas.ts y servicio.ts importan server-only; ningún módulo de M12 abre el cliente: supabaseAdmin solo en los route handlers", () => {
    for (const r of ["src/lib/marcas-barrer/consultas.ts", "src/lib/marcas-barrer/servicio.ts"]) {
      expect(archivo(r).texto, r).toMatch(/^import "server-only";/m);
    }
    expect(lib.filter((f) => /supabase\/admin|supabaseAdmin|supabase\/server/.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
    const handlers = src.filter((f) => f.ruta.startsWith("src/app/api/marcas-barrer/"));
    expect(handlers.length).toBe(4);
  });
  it("las escrituras de repartos viven solo en consultas.ts y las llaman solo aprobarReparto (ninguna lectura escribe)", () => {
    const escritoras = ["insertarVersion", "insertarFilasVersion", "fijarVigente", "eliminarVersion"];
    const servicio = limpiar(archivo("src/lib/marcas-barrer/servicio.ts").texto);
    for (const lectora of ["cargarContextoBarrer", "analizarMarcaServicio", "leerRepartos", "leerRepartosVigentes", "listarMarcasBarrer", "leerFilasCerrada"]) {
      const cuerpo = cuerpoDeFuncion(servicio, lectora);
      expect(cuerpo, `no se encontró ${lectora}`).not.toBeNull();
      for (const e of escritoras) expect(cuerpo ?? "", `${lectora} llama a ${e}`).not.toContain(`${e}(`);
    }
    const aprobar = cuerpoDeFuncion(servicio, "aprobarReparto") ?? "";
    for (const e of escritoras) expect(aprobar).toContain(`${e}(`);
  });
});

describe("la lógica pura no toca la base ni los componentes", () => {
  it("ningún módulo puro de src/lib/marcas-barrer importa @supabase/*, componentes ni supabase/*", () => {
    expect(PUROS.length).toBeGreaterThan(10);
    const malos = PUROS.filter((f) => /from "(@supabase\/|@\/components|@\/lib\/supabase|react|next\/)/.test(f.texto)).map((f) => f.ruta);
    expect(malos).toEqual([]);
  });
  it("tipos-api.ts es autocontenido: solo importa tipos de marcas/tipos-api", () => {
    const imports = [...archivo("src/lib/marcas-barrer/tipos-api.ts").texto.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/marcas/tipos-api"]);
  });
  it("lo que la pantalla importa de la lógica pura (reparto, resto, temporadas, tipos) no trae node:crypto ni módulos de servidor", () => {
    for (const f of ["reparto", "resto", "temporadas", "tipos-api", "tipos"]) {
      const texto = archivo(`src/lib/marcas-barrer/${f}.ts`).texto;
      expect(texto, f).not.toMatch(/node:|server-only|from "\.\/(huellas|consultas|servicio|modelo)"/);
    }
  });
  it("VERSION_METODO_BARRER es 2 y M7 sigue en el método 4", () => {
    expect(archivo("src/lib/marcas-barrer/tipos-api.ts").texto).toMatch(/VERSION_METODO_BARRER = 2;/);
    expect(archivo("src/lib/proyeccion/tipos-api.ts").texto).toMatch(/export const VERSION_METODO = 4;/);
  });
});

describe("rutas: toda ruta es requirePlanner y ningún GET escribe", () => {
  const API = path.join(RAIZ, "src", "app", "api", "marcas-barrer");
  const rutas = rutasDeApi(API);

  it("hay cuatro archivos de ruta y cada handler abre con requirePlanner (ni requireUser ni requireAdmin)", () => {
    expect(rutas.map((r) => path.relative(API, r).split(path.sep).join("/")).sort()).toEqual([
      "[marcaId]/repartos/route.ts",
      "[marcaId]/route.ts",
      "route.ts",
      "vigentes/route.ts",
    ]);
    const metodos: string[] = [];
    for (const r of rutas) {
      const limpio = limpiar(readFileSync(r, "utf8"));
      for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const cuerpo = cuerpoDeFuncion(limpio, m);
        if (cuerpo === null) continue;
        const primera = primeraSentencia(cuerpo);
        expect(primera, `${rel(r)} ${m}`).toMatchObject({ tipo: "guard", guard: "requirePlanner" });
        metodos.push(`${path.relative(API, r).split(path.sep).join("/")} ${m}`);
      }
      expect(limpio).not.toMatch(/requireUser|requireAdmin/);
    }
    expect(metodos.sort()).toEqual(["[marcaId]/repartos/route.ts GET", "[marcaId]/repartos/route.ts POST", "[marcaId]/route.ts GET", "route.ts GET", "vigentes/route.ts GET"]);
  });
  it("los GET no llaman a aprobarReparto ni exportan otro método de escritura; solo el POST de repartos escribe", () => {
    for (const r of rutas) {
      const limpio = limpiar(readFileSync(r, "utf8"));
      const get = cuerpoDeFuncion(limpio, "GET");
      if (get !== null) expect(get, rel(r)).not.toMatch(/aprobarReparto|insert|update|delete|upsert/);
      for (const m of ["PUT", "PATCH", "DELETE"]) expect(cuerpoDeFuncion(limpio, m), `${rel(r)} ${m}`).toBeNull();
    }
    const repartos = limpiar(readFileSync(path.join(API, "[marcaId]", "repartos", "route.ts"), "utf8"));
    expect(cuerpoDeFuncion(repartos, "POST") ?? "").toMatch(/leerCuerpo\(/);
  });
});

describe("6.1: nadie lee modalidad_tratamiento fuera de las reglas de marcas", () => {
  const nombra = (f: { texto: string }) => /\bmodalidad_tratamiento\b/.test(sinComentarios(f.texto));

  it("ningún archivo bajo src/components ni src/app/(app) nombra modalidad_tratamiento (todos leen modalidad_efectiva)", () => {
    const ofensores = src.filter((f) => (f.ruta.startsWith("src/components/") || f.ruta.startsWith("src/app/(app)/")) && nombra(f)).map((f) => f.ruta);
    expect(ofensores, `Estos archivos de pantalla leen la columna cruda en vez de modalidad_efectiva:\n${ofensores.join("\n")}`).toEqual([]);
  });
  it("bajo src/lib solo la nombran las reglas de marcas, los esquemas, las consultas, las importaciones y las vistas de 02b", () => {
    const permitidos = new Set([
      "src/lib/marcas/reglas.ts",
      "src/lib/marcas/modalidad.ts",
      "src/lib/marcas/filas.ts",
      "src/lib/marcas/esquemas.ts",
      "src/lib/marcas/consultas.ts",
      "src/lib/marcas/importar.ts",
      "src/lib/marcas/tipos-api.ts",
      "src/lib/marcas/conjuntos/reglas.ts",
      "src/lib/marcas/conjuntos/vista.ts",
      "src/lib/marcas/gml/reglas.ts",
      "src/lib/marcas/gml/vista.ts",
      "src/lib/marcas/gml/asignar.ts",
      "src/lib/marcas/gml/importar.ts",
      "src/lib/supabase/database.types.ts",
    ]);
    const ofensores = src.filter((f) => f.ruta.startsWith("src/lib/") && nombra(f)).map((f) => f.ruta).filter((r) => !permitidos.has(r));
    expect(ofensores).toEqual([]);
    // Y los handlers de marcas solo la usan para escribir el par (modalidad + resto_al_barrer).
    for (const f of src.filter((x) => x.ruta.startsWith("src/app/api/") && nombra(x))) {
      expect(f.ruta, f.ruta).toMatch(/^src\/app\/api\/marcas\/(route|\[id\]\/route|importar\/route|gml-especial\/route)\.ts$/);
    }
  });
});
