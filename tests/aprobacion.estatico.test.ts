import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 07g (estático): lo que se rompe por descuido se vigila leyendo el código. R13 (los bloqueos no dependen de `src/lib/ia/`), R21 (quién nombra la función y las
 * tablas, quién importa a quién, el guard de cada ruta) y la forma de las rutas de `…/aprobacion`.
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
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
const fuente = (ruta: string) => src.find((f) => f.ruta === ruta)?.texto ?? "";

const LIB = "src/lib/aprobacion/";
const CONSULTAS = `${LIB}consultas.ts`;
const TIPOS_DB = "src/lib/supabase/database.types.ts";
const RUTAS = src.filter((f) => f.ruta.startsWith("src/app/api/proyeccion/proyecciones/[id]/aprobacion/") && f.ruta.endsWith("route.ts"));

describe("R21 · quién nombra la función y las tablas de los lotes", () => {
  it("solo consultas.ts nombra `aplicar_lote_proyeccion` (y los tipos generados)", () => {
    const usan = src.filter((f) => sinComentarios(f.texto).includes("aplicar_lote_proyeccion") && f.ruta !== TIPOS_DB && f.ruta !== CONSULTAS).map((f) => f.ruta);
    expect(usan).toEqual([]);
    expect(sinComentarios(fuente(CONSULTAS))).toContain('db.rpc("aplicar_lote_proyeccion"');
  });

  it("solo consultas.ts ESCRIBE `proyeccion_lotes` y `proyeccion_lote_filas`; `proyeccion/consultas.ts` puede leerlas (solo select) para `decision_lote`", () => {
    for (const tabla of ["proyeccion_lotes", "proyeccion_lote_filas"]) {
      const re = new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]\\s*\\)`);
      const nombran = src.filter((f) => re.test(sinComentarios(f.texto)) && f.ruta !== TIPOS_DB).map((f) => f.ruta);
      expect(nombran.every((r) => r === CONSULTAS || r === "src/lib/proyeccion/consultas.ts"), `${tabla}: ${nombran.join(", ")}`).toBe(true);
      for (const f of src.filter((x) => re.test(sinComentarios(x.texto)) && x.ruta !== TIPOS_DB)) {
        const t = sinComentarios(f.texto);
        for (const m of t.matchAll(new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]\\s*\\)([^;]*)`, "g"))) {
          expect(m[1], `${f.ruta} escribe ${tabla}`).not.toMatch(/\.(insert|update|upsert|delete)\(/);
        }
      }
    }
    const escriben = src.filter((f) => f.ruta !== CONSULTAS && f.ruta !== TIPOS_DB && /from\(\s*["'`]proyeccion_lote(s|_filas)["'`]\s*\)\s*\.(insert|update|upsert|delete)/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(escriben).toEqual([]);
    expect(sinComentarios(fuente(CONSULTAS))).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("`src/lib/proyeccion/` no importa `src/lib/aprobacion/`", () => {
    const importan = src.filter((f) => f.ruta.startsWith("src/lib/proyeccion/") && importsDe(f.texto).some((o) => /^@\/lib\/aprobacion(\/|$)/.test(o) || /\/aprobacion\//.test(o))).map((f) => f.ruta);
    expect(importan).toEqual([]);
  });

  it("las tablas de M7 solo se leen por `proyeccion/consultas.ts`: la aprobación no las nombra", () => {
    for (const f of src.filter((x) => x.ruta.startsWith(LIB) || x.ruta.startsWith("src/app/api/proyeccion/proyecciones/[id]/aprobacion/"))) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/from\(\s*["'`](proyecciones|proyeccion_filas|proyeccion_fila_anios|proyeccion_tiendas|ia_[a-z_]+)["'`]/);
    }
  });
});

describe("rutas de …/aprobacion", () => {
  const B = "src/app/api/proyeccion/proyecciones/[id]/aprobacion/";
  const metodos = (t: string) => [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();

  it("existen exactamente las rutas de la ficha con sus métodos", () => {
    const esperado: Record<string, string[]> = {
      [`${B}route.ts`]: ["GET"],
      [`${B}lotes/route.ts`]: ["GET", "POST"],
      [`${B}lotes/[loteId]/route.ts`]: ["GET"],
      [`${B}lotes/[loteId]/revertir/route.ts`]: ["POST"],
      [`${B}confirmaciones/[confirmacionId]/revertir/route.ts`]: ["POST"],
    };
    expect(RUTAS.map((r) => r.ruta).sort()).toEqual(Object.keys(esperado).sort());
    for (const r of RUTAS) expect(metodos(r.texto), r.ruta).toEqual(esperado[r.ruta]);
  });

  it("toda ruta usa requirePlanner como primera sentencia de cada handler y ningún otro guard", () => {
    for (const r of RUTAS) {
      const t = sinComentarios(r.texto);
      expect(t, r.ruta).toContain("requirePlanner");
      expect(t, r.ruta).not.toMatch(/requireUser|requireAdmin/);
      for (const m of t.matchAll(/export async function (?:GET|POST)\([^)]*\)\s*\{\s*([^\n]*)/g)) expect(m[1], r.ruta).toMatch(/requirePlanner\(\)/);
    }
  });

  it("los handlers no tocan la base ni leen el cuerpo por su cuenta; los GET no escriben; las respuestas pasan por ok()", () => {
    for (const r of RUTAS) {
      const t = sinComentarios(r.texto);
      expect(t, r.ruta).not.toMatch(/supabaseAdmin|supabaseServer|\.from\(|\.rpc\(|request\.(json|text|formData)\(/);
      expect(importsDe(r.texto).filter((o) => /database\.types|@supabase\//.test(o)), r.ruta).toEqual([]);
      expect(t, r.ruta).toMatch(/\bok\(/);
    }
    for (const r of RUTAS.filter((x) => !/revertir/.test(x.ruta))) {
      const t = sinComentarios(r.texto);
      const gets = t.slice(t.indexOf("export async function GET("));
      const fin = gets.indexOf("export async function POST(");
      const cuerpo = fin > 0 ? gets.slice(0, fin) : gets;
      if (t.includes("export async function GET(")) expect(cuerpo, r.ruta).not.toMatch(/\b(aplicar|revertir|crear|editar|eliminar|guardar)[A-Za-z]*\(/);
    }
  });

  it("los POST con cuerpo lo leen con leerCuerpo y su esquema zod", () => {
    for (const r of RUTAS.filter((x) => /export async function POST\(/.test(x.texto))) expect(sinComentarios(r.texto), r.ruta).toMatch(/leerCuerpo\(request, \w+Schema\)/);
  });
});

describe("R13 · los bloqueos no dependen de src/lib/ia/", () => {
  it("servicio.ts importa de la IA solo `ia/servicio` y `leerBloqueos` no nombra nada de la IA", () => {
    const servicio = fuente(`${LIB}servicio.ts`);
    expect(importsDe(servicio).filter((o) => /^@\/lib\/ia(\/|$)/.test(o)).filter((o) => o !== "@/lib/ia/servicio")).toEqual([]);
    const t = sinComentarios(servicio);
    const i = t.indexOf("async function leerBloqueos(");
    const cuerpo = t.slice(i, t.indexOf("\n}\n", i));
    expect(i).toBeGreaterThan(0);
    expect(cuerpo).not.toMatch(/evaluarServicio|valoresIa|cargarProyeccionIa|fuenteMetaDe|CAPACIDAD_Y1|aceptarPermitido|@\/lib\/ia/);
    expect(cuerpo).toContain("bloqueosDeLote(");
    expect(cuerpo).toContain("desactualizadaDe(");
  });

  it("revertir usa `bloqueoDeReversion` (solo en trabajo y sin cálculo), nunca `bloqueosDeLote`", () => {
    const t = sinComentarios(fuente(`${LIB}servicio.ts`));
    const i = t.indexOf("async function revertirUnLote(");
    const cuerpo = t.slice(i, t.indexOf("\nexport async function revertirLote(", i));
    expect(cuerpo).toContain("bloqueoDeReversion(");
    expect(cuerpo).not.toMatch(/bloqueosDeLote|leerBloqueos/);
  });

  it("`valoresIaParaAprobacion` es la única función nueva de IA de la aprobación y no escribe", () => {
    const t = sinComentarios(fuente("src/lib/ia/servicio.ts"));
    const i = t.indexOf("export async function valoresIaParaAprobacion(");
    const cuerpo = t.slice(i, t.indexOf("\n}\n", i));
    expect(i).toBeGreaterThan(0);
    expect(cuerpo).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|insertar|actualizar|decidirFila/);
  });
});

describe("pureza y estilo", () => {
  it("ningún archivo de la aprobación ni de sus rutas usa `any`", () => {
    for (const f of src.filter((x) => x.ruta.startsWith(LIB) || x.ruta.startsWith("src/app/api/proyeccion/proyecciones/[id]/aprobacion/"))) {
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });

  it("los timestamps viajan como texto: la aprobación no pasa `updated_at` ni `calculado_at` por `Date`", () => {
    for (const nombre of ["servicio.ts", "consultas.ts"]) {
      const t = sinComentarios(fuente(`${LIB}${nombre}`));
      expect(t, nombre).not.toMatch(/new Date\([^)]*(updated_at|calculado_at)|Date\.parse\([^)]*(updated_at|calculado_at)/);
    }
  });

  it("la lista de columnas de `set` no incluye `activo`, `id`, `fila_id` ni `anio` y el objetivo lleva `decision_lote_id`", () => {
    const t = sinComentarios(fuente(`${LIB}servicio.ts`));
    expect(t).toMatch(/COLUMNAS_FUERA_DEL_SET = \["fila_id", "anio", "activo"\]/);
    expect(t).toContain('"decision_lote_id"');
  });
});
