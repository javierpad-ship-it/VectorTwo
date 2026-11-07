import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Pruebas estáticas de 08c E1 (proveedores y fotos de línea): guards de las rutas nuevas, Storage solo desde `almacen.ts`, escrituras solo
 * por `.rpc(` de las funciones de `0039`, nada de rutas ni claves de origen en las respuestas, y el bucket privado sin políticas en la
 * migración. Lo que se rompe por descuido y no por un caso de uso se vigila leyendo el código.
 */

const RAIZ = path.resolve(__dirname, "..");
const API = path.join(RAIZ, "src", "app", "api");
const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(nombre) ? [p] : [];
  });
}
const src = archivos(path.join(RAIZ, "src")).map((p) => ({ ruta: rel(p), texto: readFileSync(p, "utf8") }));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const archivo = (ruta: string) => {
  const f = src.find((x) => x.ruta === ruta);
  if (!f) throw new Error(`no existe ${ruta}`);
  return f;
};
const enDir = (dir: string) => src.filter((f) => f.ruta.startsWith(dir));
const importaciones = (texto: string) => [...sinComentarios(texto).matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

type Esperada = { ruta: string; metodo: string; guard: "requireUser" | "requirePlanner" | "requireAdmin" };
const ESPERADAS: Esperada[] = [
  { ruta: "compras/proveedores/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/proveedores/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/proveedores/[id]/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/proveedores/[id]/route.ts", metodo: "PATCH", guard: "requireUser" },
  { ruta: "compras/proveedores/[id]/route.ts", metodo: "DELETE", guard: "requirePlanner" },
  { ruta: "compras/proveedores/[id]/activo/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "compras/proveedores/[id]/historial/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/[id]/lineas/[lineaId]/fotos/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/[id]/lineas/[lineaId]/fotos/[fotoId]/route.ts", metodo: "DELETE", guard: "requireUser" },
  { ruta: "compras/[id]/lineas/[lineaId]/fotos/traer/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/[id]/lineas/[lineaId]/ficha/route.ts", metodo: "PATCH", guard: "requireUser" },
  { ruta: "compras/fotos/[fotoId]/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/fotos/[fotoId]/miniatura/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/fotos/limpiar/route.ts", metodo: "GET", guard: "requireAdmin" },
  { ruta: "compras/fotos/limpiar/route.ts", metodo: "POST", guard: "requireAdmin" },
];
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const es08c = (ruta: string) => /^compras\/(proveedores|fotos|\[id\]\/lineas)\//.test(ruta);
const rutas08c = rutasDeApi(API).filter((r) => es08c(path.relative(API, r).split(path.sep).join("/")));

describe("rutas de 08c E1: guards", () => {
  it("son exactamente las de la ficha (§3.2 y §3.3), con el historial del proveedor (P4)", () => {
    const encontradas: string[] = [];
    for (const r of rutas08c) {
      const limpio = limpiar(readFileSync(r, "utf8"));
      for (const m of METODOS) if (cuerpoDeFuncion(limpio, m) !== null) encontradas.push(`${path.relative(API, r).split(path.sep).join("/")} ${m}`);
    }
    expect(encontradas.sort()).toEqual(ESPERADAS.map((e) => `${e.ruta} ${e.metodo}`).sort());
  });

  it("cada handler abre con SU guard como PRIMERA sentencia", () => {
    for (const e of ESPERADAS) {
      const limpio = limpiar(readFileSync(path.join(API, e.ruta), "utf8"));
      const primera = primeraSentencia(cuerpoDeFuncion(limpio, e.metodo) ?? "");
      expect({ ruta: e.ruta, metodo: e.metodo, tipo: primera.tipo, guard: primera.tipo === "guard" ? primera.guard : null }).toEqual({ ruta: e.ruta, metodo: e.metodo, tipo: "guard", guard: e.guard });
    }
  });

  it("los handlers no hablan con la base ni con Storage: solo llaman a los servicios (supabaseAdmin() se les pasa)", () => {
    for (const r of rutas08c) {
      const texto = sinComentarios(readFileSync(r, "utf8"));
      expect(texto, rel(r)).not.toMatch(/\.(from|rpc|insert|update|upsert|delete|storage|upload|remove|copy|download|createSignedUrl)\s*\(/);
      expect(texto, rel(r)).not.toMatch(/supabaseServer/);
      expect(texto, rel(r)).toMatch(/supabaseAdmin\(\)/);
    }
  });

  it("ningún handler lee el cuerpo por su cuenta: JSON con leerCuerpo; la subida multipart lo lee en src/lib/fotos/validar.ts", () => {
    for (const r of rutas08c) {
      const texto = sinComentarios(readFileSync(r, "utf8"));
      expect(texto, rel(r)).not.toMatch(/\.(json|text|formData|arrayBuffer|blob)\s*\(|\.body\b/);
    }
    const subida = sinComentarios(readFileSync(path.join(API, "compras/[id]/lineas/[lineaId]/fotos/route.ts"), "utf8"));
    expect(subida).not.toMatch(/leerCuerpo/);
    const validar = sinComentarios(archivo("src/lib/fotos/validar.ts").texto);
    expect(validar).not.toMatch(/request\.formData\(/);
    expect(validar).toMatch(/new Response\(crudo[^)]*\)\.formData\(\)/);
    expect(validar).toMatch(/longitud_requerida/);
    expect(validar).toMatch(/origen_invalido/);
  });
});

describe("Storage solo desde el servidor y solo desde almacen.ts (R9)", () => {
  it(".upload(, .remove(, .copy(, .download( y .createSignedUrl( solo aparecen en src/lib/fotos/almacen.ts", () => {
    const patron = /\.(upload|remove|copy|download|createSignedUrl|createSignedUrls)\s*\(/;
    const ofensores = src.filter((f) => f.ruta !== "src/lib/fotos/almacen.ts" && patron.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(ofensores).toEqual([]);
    const almacen = sinComentarios(archivo("src/lib/fotos/almacen.ts").texto);
    for (const m of ["upload", "remove", "copy", "download", "createSignedUrl"]) expect(almacen, m).toContain(`.${m}(`);
  });

  it("ningún componente cliente toca Storage ni importa @/lib/supabase/* en las secciones de Compras (la foto nunca va del navegador a Storage)", () => {
    const clientes = src.filter((f) => /^\s*["']use client["']/m.test(f.texto.slice(0, 200)));
    expect(clientes.filter((f) => /\.storage\b|storage\.from/.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
    const deCompras = clientes.filter((f) => /^src\/(components\/(fotos|proveedores|compras)|app\/\(app\)\/compras|lib\/(fotos|proveedores))\//.test(f.ruta));
    expect(deCompras.filter((f) => importaciones(f.texto).some((o) => /^@\/lib\/supabase\//.test(o))).map((f) => f.ruta)).toEqual([]);
  });

  it("src/lib/fotos y src/lib/proveedores no abren clientes de Supabase: reciben `Db` por parámetro", () => {
    for (const f of [...enDir("src/lib/fotos/"), ...enDir("src/lib/proveedores/")]) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/supabaseAdmin|supabaseServer/);
      for (const o of importaciones(f.texto)) expect(o, f.ruta).not.toMatch(/supabase\/(admin|server|browser)$/);
    }
  });

  it("almacen, consultas y servicio de las dos carpetas importan server-only", () => {
    for (const r of ["almacen", "consultas", "servicio"].map((n) => `src/lib/fotos/${n}.ts`).concat(["consultas", "servicio"].map((n) => `src/lib/proveedores/${n}.ts`))) {
      expect(archivo(r).texto, r).toMatch(/^import "server-only";/m);
    }
  });
});

describe("escrituras: solo .rpc( de las funciones de 0039, desde consultas.ts", () => {
  const TABLAS = ["proveedores", "proveedor_contactos", "proveedor_eventos", "compra_lineas", "compra_linea_fotos", "compras", "compra_eventos"];
  const DESDE_TABLA = new RegExp(`\\.from\\(\\s*["'\`](${TABLAS.join("|")})["'\`]\\s*\\)`, "g");

  it("ningún archivo de src llama .insert(, .update(, .upsert( ni .delete( sobre esas tablas (también las nuevas)", () => {
    const ofensores: string[] = [];
    for (const f of src) {
      const texto = sinComentarios(f.texto);
      for (const m of texto.matchAll(DESDE_TABLA)) {
        const resto = texto.slice((m.index ?? 0) + m[0].length);
        const cadena = resto.slice(0, resto.indexOf(";") < 0 ? resto.length : resto.indexOf(";"));
        if (/\.(insert|update|upsert|delete)\s*\(/.test(cadena)) ofensores.push(`${f.ruta}: ${m[1]}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it("las funciones de 0039 se llaman con .rpc( solo desde consultas.ts de su carpeta", () => {
    const fotos = ["agregar_foto_linea", "quitar_foto_linea", "traer_fotos_linea", "editar_ficha_linea", "fotos_huerfanas"];
    const proveedores = ["guardar_proveedor", "cambiar_activo_proveedor", "eliminar_proveedor"];
    const llama = (nombres: string[]) => src.filter((f) => new RegExp(`\\.rpc\\(\\s*["'\`](${nombres.join("|")})["'\`]`).test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(llama(fotos)).toEqual(["src/lib/fotos/consultas.ts"]);
    expect(llama(proveedores)).toEqual(["src/lib/proveedores/consultas.ts"]);
    for (const n of fotos) expect(sinComentarios(archivo("src/lib/fotos/consultas.ts").texto), n).toContain(`.rpc("${n}"`);
    for (const n of proveedores) expect(sinComentarios(archivo("src/lib/proveedores/consultas.ts").texto), n).toContain(`.rpc("${n}"`);
  });
});

describe("lo que no sale por la API (R8, R17, decisión 106)", () => {
  it("los contratos de la API no declaran ruta, ruta_miniatura, clave_origen ni datos bancarios", () => {
    for (const r of ["src/lib/fotos/tipos-api.ts", "src/lib/proveedores/tipos-api.ts"]) {
      const texto = sinComentarios(archivo(r).texto).replace(/MENSAJE_ERROR_[A-Z]+[\s\S]*$/, "");
      expect(texto, r).not.toMatch(/\bruta(_miniatura)?\s*[:?]|clave_origen\s*[:?]|\b(banco|cuenta|bank_name|bank_account)\b/);
    }
  });

  it("el mapeo a la API de proveedores nunca copia clave_origen, perfil_id ni usa spread de la fila", () => {
    const api = sinComentarios(archivo("src/lib/proveedores/api.ts").texto);
    expect(api).not.toMatch(/\.\.\.\s*p\b|\.\.\.\s*fila\b|clave_origen\s*:/);
    expect(sinComentarios(archivo("src/lib/proveedores/consultas.ts").texto)).not.toMatch(/banco|bank_/);
  });

  it("las respuestas de fotos arman cada campo a mano (sin devolver la fila de compra_linea_fotos)", () => {
    const servicio = sinComentarios(archivo("src/lib/fotos/servicio.ts").texto);
    expect(servicio).not.toMatch(/listo\(\s*foto\.data\s*\)|listo\(\s*f\.datos\s*\)/);
  });
});

describe("migración 0039: bucket privado y sin políticas (M3)", () => {
  const sql = readFileSync(path.join(RAIZ, "supabase", "migrations", "0039_proveedores_y_fotos.sql"), "utf8").replace(/--.*$/gm, "");

  it("crea el bucket compras-fotos con public = false, solo JPEG y 400 KB, y no crea ninguna política", () => {
    expect(sql).toMatch(/values\s*\(\s*'compras-fotos'\s*,\s*'compras-fotos'\s*,\s*false\s*,\s*409600\s*,\s*array\['image\/jpeg'\]\s*\)/);
    expect(sql).not.toMatch(/create\s+policy/i);
  });
});
