import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Regla 12 de la ficha 13 (pruebas estáticas): lo que se rompe por descuido y no por un caso de uso se vigila leyendo el código.
 * El item de `nav.ts` es de la pantalla y lo cubre la prueba del frontend.
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
const archivo = (ruta: string) => {
  const f = src.find((x) => x.ruta === ruta);
  if (!f) throw new Error(`no existe ${ruta}`);
  return f;
};
const lib = src.filter((f) => f.ruta.startsWith("src/lib/intercompany/"));
const DE_SERVIDOR = ["src/lib/intercompany/consultas.ts", "src/lib/intercompany/servicio.ts", "src/lib/intercompany/rutas.ts"];
const PUROS = lib.filter((f) => !DE_SERVIDOR.includes(f.ruta));

describe("rutas: todo /api/intercompany es de requirePlanner (el comprador no accede)", () => {
  const rutas = rutasDeApi(path.join(RAIZ, "src", "app", "api", "intercompany"));
  it("hay cuatro archivos de ruta", () => {
    expect(rutas.map((r) => rel(r)).sort()).toEqual([
      "src/app/api/intercompany/aplicabilidad/route.ts",
      "src/app/api/intercompany/reglas/[id]/route.ts",
      "src/app/api/intercompany/reglas/route.ts",
      "src/app/api/intercompany/vigentes/route.ts",
    ]);
  });
  it("cada handler exportado abre con requirePlanner como PRIMERA sentencia (ni requireUser ni nada antes)", () => {
    let handlers = 0;
    for (const archivoRuta of rutas) {
      const limpio = limpiar(readFileSync(archivoRuta, "utf8"));
      for (const metodo of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        const cuerpo = cuerpoDeFuncion(limpio, metodo);
        if (cuerpo === null) continue;
        handlers += 1;
        const primera = primeraSentencia(cuerpo);
        expect({ ruta: rel(archivoRuta), metodo, tipo: primera.tipo, guard: primera.tipo === "guard" ? primera.guard : null }).toEqual({
          ruta: rel(archivoRuta),
          metodo,
          tipo: "guard",
          guard: "requirePlanner",
        });
      }
    }
    expect(handlers).toBe(6);
  });
  it("las rutas no importan requireUser ni requireAdmin", () => {
    for (const archivoRuta of rutas) expect(readFileSync(archivoRuta, "utf8")).not.toMatch(/requireUser|requireAdmin/);
  });
});

describe("datos solo en consultas.ts; supabaseAdmin solo en los route handlers", () => {
  it("solo consultas.ts nombra la tabla `intercompany_reglas` y la vista", () => {
    const ofensores = src
      .filter((f) => /intercompany_reglas|intercompany_vigente/.test(sinComentarios(f.texto)))
      .map((f) => f.ruta)
      .filter((r) => r !== "src/lib/intercompany/consultas.ts" && r !== "src/lib/supabase/database.types.ts" && r !== "src/lib/api/errores-db.ts");
    expect(ofensores).toEqual([]);
    expect(sinComentarios(archivo("src/lib/intercompany/consultas.ts").texto)).toContain('"intercompany_reglas"');
  });
  it("consultas.ts y servicio.ts importan server-only; ningún módulo de src/lib/intercompany abre el cliente", () => {
    for (const r of ["src/lib/intercompany/consultas.ts", "src/lib/intercompany/servicio.ts"]) expect(archivo(r).texto, r).toMatch(/^import "server-only";/m);
    expect(lib.filter((f) => /supabase\/admin|supabaseAdmin|supabase\/server/.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
    const handlers = src.filter((f) => f.ruta.startsWith("src/app/api/intercompany/"));
    expect(handlers).toHaveLength(4);
    for (const h of handlers) expect(h.texto, h.ruta).toMatch(/supabaseAdmin\(\)/);
  });
  it("solo crearRegla, editarRegla y eliminarRegla escriben; ninguna lectura llama a las escrituras", () => {
    const escritoras = ["insertarRegla", "actualizarRegla", "eliminarReglaDb"];
    const servicio = limpiar(archivo("src/lib/intercompany/servicio.ts").texto);
    for (const lectora of ["listarReglas", "leerVigentes", "leerAplicabilidad", "leerParticipacionesCerrada"]) {
      const cuerpo = cuerpoDeFuncion(servicio, lectora);
      expect(cuerpo, `no se encontró ${lectora}`).not.toBeNull();
      for (const e of escritoras) expect(cuerpo ?? "", `${lectora} llama a ${e}`).not.toContain(`${e}(`);
    }
    expect(cuerpoDeFuncion(servicio, "crearRegla") ?? "").toContain("insertarRegla(");
    expect(cuerpoDeFuncion(servicio, "editarRegla") ?? "").toContain("actualizarRegla(");
    expect(cuerpoDeFuncion(servicio, "eliminarRegla") ?? "").toContain("eliminarReglaDb(");
  });
});

describe("la lógica pura no toca la base ni los componentes", () => {
  it("ningún módulo puro de src/lib/intercompany importa @supabase/*, componentes, supabase/*, react ni next", () => {
    expect(PUROS.map((f) => f.ruta).sort()).toEqual([
      "src/lib/intercompany/esquemas.ts",
      "src/lib/intercompany/reglas.ts",
      "src/lib/intercompany/subflujo.ts",
      "src/lib/intercompany/tipos-api.ts",
    ]);
    const malos = PUROS.filter((f) => /from "(@supabase\/|@\/components|@\/lib\/supabase|react|next\/|node:)|server-only/.test(f.texto)).map((f) => f.ruta);
    expect(malos).toEqual([]);
  });
  it("tipos-api.ts es autocontenido (la pantalla lo importa): no importa nada", () => {
    expect([...archivo("src/lib/intercompany/tipos-api.ts").texto.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1])).toEqual([]);
  });
  it("subflujo.ts y reglas.ts no usan el reloj (reciben el mes)", () => {
    for (const f of ["reglas", "subflujo"]) expect(sinComentarios(archivo(`src/lib/intercompany/${f}.ts`).texto), f).not.toMatch(/new Date|Date\.now|hoyLima/);
  });
});

describe("el contrato de M7 y M8 sigue intacto", () => {
  it("VERSION_METODO sigue en 4 y M13 no toca proyeccion ni marcas-barrer/vigentes", () => {
    expect(archivo("src/lib/proyeccion/tipos-api.ts").texto).toMatch(/VERSION_METODO\s*=\s*4\b/);
    for (const f of lib) expect(sinComentarios(f.texto), f.ruta).not.toMatch(/VERSION_METODO/);
    // M13 solo LEE la cerrada (leerParticipacionesDeCerrada): no importa nada que la escriba.
    expect(sinComentarios(archivo("src/lib/intercompany/servicio.ts").texto)).not.toMatch(/servicio-edicion|cerrarProyeccion|calcularProyeccion/);
  });
});
