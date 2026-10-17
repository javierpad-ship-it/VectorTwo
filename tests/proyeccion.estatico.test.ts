import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * M7 regla 44 (estático): lo que se rompe por descuido se vigila leyendo el código. Complementa a `api.guards.estatico.test.ts`
 * (el guard como primera sentencia de cada handler).
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

const LIB = "src/lib/proyeccion/";
const CONSULTAS = `${LIB}consultas.ts`;
const TIPOS_DB = "src/lib/supabase/database.types.ts";
const RUTAS = src.filter((f) => f.ruta.startsWith("src/app/api/proyeccion/") && f.ruta.endsWith("route.ts"));
/** Lógica pura: ni base ni HTTP ni pantalla. */
const PURAS = [
  "apertura-linea", "bloques", "calculo", "calendario", "cierre", "cierres-tienda", "composicion", "crecimientos", "curva-fila", "decision", "desactualizado", "esquemas", "excel",
  "explicar", "cola-larga", "resumen", "matriz", "mensual", "modelo", "nino", "participaciones", "persistencia", "reglas", "reparto", "siguiente", "tendencia", "tiendas-nuevas", "tipos", "tipos-api", "universo",
];

describe("M7 regla 44: la lectura de venta y las tablas", () => {
  it("solo consultas.ts nombra venta_proyeccion (y los tipos generados)", () => {
    const usan = src.filter((f) => sinComentarios(f.texto).includes("venta_proyeccion") && f.ruta !== TIPOS_DB && f.ruta !== CONSULTAS).map((f) => f.ruta);
    expect(usan).toEqual([]);
    expect(sinComentarios(fuente(CONSULTAS))).toContain('db.rpc("venta_proyeccion"');
  });

  it("solo consultas.ts lee o escribe las tablas de M7", () => {
    for (const tabla of ["proyecciones", "proyeccion_filas", "proyeccion_fila_anios", "proyeccion_tiendas", "proyeccion_crecimientos", "factores_volumen_atipico"]) {
      const usan = src.filter((f) => new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]`).test(f.texto) && f.ruta !== CONSULTAS).map((f) => f.ruta);
      expect(usan, tabla).toEqual([]);
    }
  });

  it("los handlers de /api/proyeccion no tocan la base: ni supabaseAdmin ni .from()", () => {
    expect(RUTAS.length).toBeGreaterThan(10);
    for (const r of RUTAS) {
      const t = sinComentarios(r.texto);
      expect(t, r.ruta).not.toMatch(/supabaseAdmin|supabaseServer|\.from\(|\.rpc\(/);
      expect(importsDe(r.texto).filter((o) => /database\.types|@supabase\//.test(o)), r.ruta).toEqual([]);
    }
  });

  it("matriz y mensual no seleccionan historico: columnas ligeras", () => {
    const c = fuente(CONSULTAS);
    const ligera = /export const COLUMNAS_FILA_LIGERA =\s*"([^"]*)"/.exec(c)?.[1] ?? "historico";
    expect(ligera).not.toContain("historico");
    expect(c).not.toMatch(/COLUMNAS_ANIO_LIGERA =\s*"[^"]*historico/);
    const lectura = sinComentarios(fuente(`${LIB}servicio-lectura.ts`));
    // `planas()` (lo que usan matriz y mensual) pide columnas ligeras; `completas` solo en la línea abierta, la fila y las tiendas.
    expect(lectura).toMatch(/async function planas\([^)]*columnas: "ligeras" \| "cerrada" = "ligeras"/);
    const matriz = lectura.slice(lectura.indexOf("export async function leerMatriz"), lectura.indexOf("export async function leerTiendasDeProyeccion"));
    expect(matriz).not.toContain("completas");
    expect(matriz).not.toContain("historico");
    const ligeras = sinComentarios(c).slice(sinComentarios(c).indexOf("const COLUMNAS_FILA"), sinComentarios(c).indexOf("export type OpcionesFilas"));
    expect(ligeras.match(/historico/g) ?? []).toHaveLength(0);
  });
});

describe("M7: pureza de la lógica", () => {
  for (const nombre of PURAS) {
    it(`${nombre}.ts no importa de @supabase/*, supabase/admin|server, React, next ni de componentes`, () => {
      const f = fuente(`${LIB}${nombre}.ts`);
      expect(f.length, nombre).toBeGreaterThan(0);
      for (const origen of importsDe(f)) {
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/^(@supabase\/|react|next(\/|$))/);
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/supabase\/(admin|server|browser)/);
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/^@\/components/);
      }
      expect(sinComentarios(f), nombre).not.toContain("supabaseAdmin");
    });
  }

  it("el método no lee el reloj ni usa azar (recibe k y hoy)", () => {
    for (const nombre of PURAS) {
      expect(sinComentarios(fuente(`${LIB}${nombre}.ts`)), nombre).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    }
  });

  it("no se usa `any` en M7", () => {
    for (const f of src.filter((x) => x.ruta.startsWith(LIB) || x.ruta.startsWith("src/app/api/proyeccion/"))) {
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });

  it("VERSION_METODO vive en tipos-api.ts y entra en el resumen del cálculo", () => {
    expect(fuente(`${LIB}tipos-api.ts`)).toMatch(/export const VERSION_METODO\s*=\s*\d+/);
    expect(fuente(`${LIB}calculo.ts`)).toMatch(/version_metodo:\s*VERSION_METODO/);
  });
});

describe("M7 regla 45: sin canibalización (0.10.1, decisión 20)", () => {
  const nombra = (f: { ruta: string; texto: string }) => /canibaliz/i.test(f.texto);
  it("ningún archivo de la lógica ni de la API de M7 nombra la canibalización; AvisoFila no la admite", () => {
    const usan = src.filter((f) => (f.ruta.startsWith(LIB) || f.ruta.startsWith("src/app/api/proyeccion/")) && nombra(f)).map((f) => f.ruta);
    expect(usan).toEqual([]);
    expect(fuente(`${LIB}tipos-api.ts`)).not.toMatch(/canibaliz/i);
  });
  it("tampoco la pantalla de la proyección", () => {
    const usan = src.filter((f) => f.ruta.startsWith("src/app/(app)/planificacion/proyeccion/") && nombra(f)).map((f) => f.ruta);
    expect(usan).toEqual([]);
  });
  it("`zona` solo es una etiqueta: ninguna función del método la lee para calcular ni avisar", () => {
    for (const f of src.filter((x) => x.ruta.startsWith(LIB))) {
      if (["bloques.ts", "contexto.ts", "tipos-api.ts"].some((n) => f.ruta.endsWith(`/${n}`))) continue; // la guardan y la copian, no la usan
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/\.zona\b/);
    }
  });
});

describe("M7: rutas", () => {
  it("existen exactamente las rutas de la ficha con sus métodos", () => {
    const metodos = (t: string) => [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
    const B = "src/app/api/proyeccion/";
    const esperado: Record<string, string[]> = {
      [`${B}route.ts`]: ["GET"],
      [`${B}proyecciones/route.ts`]: ["POST"],
      [`${B}proyecciones/[id]/route.ts`]: ["DELETE", "GET", "PATCH"],
      [`${B}proyecciones/[id]/calcular/route.ts`]: ["POST"],
      [`${B}proyecciones/[id]/lineas/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/filas/[filaId]/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/filas/[filaId]/anios/[anio]/route.ts`]: ["PUT"],
      [`${B}proyecciones/[id]/aplicar-curva/route.ts`]: ["POST"],
      [`${B}proyecciones/[id]/tiendas/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/tiendas/[tiendaId]/anios/[anio]/route.ts`]: ["PUT"],
      [`${B}proyecciones/[id]/tiendas/[tiendaId]/filas/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/matriz/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/crecimientos/route.ts`]: ["GET", "PUT"],
      [`${B}proyecciones/[id]/mensual/route.ts`]: ["GET"],
      [`${B}proyecciones/[id]/cerrar/route.ts`]: ["POST"],
      [`${B}proyecciones/[id]/archivar/route.ts`]: ["POST"],
      [`${B}factores/route.ts`]: ["GET", "PUT"],
      [`${B}factores/sincronizar/route.ts`]: ["POST"],
      [`${B}cerrada/route.ts`]: ["GET"],
    };
    expect(RUTAS.map((r) => r.ruta).sort()).toEqual(Object.keys(esperado).sort());
    for (const r of RUTAS) expect(metodos(r.texto), r.ruta).toEqual(esperado[r.ruta]);
  });

  it("toda ruta usa requirePlanner y ningún otro guard", () => {
    for (const r of RUTAS) {
      expect(r.texto, r.ruta).toContain("requirePlanner");
      expect(r.texto, r.ruta).not.toMatch(/requireUser|requireAdmin/);
    }
  });

  it("ningún GET escribe: no llama a funciones de alta, cambio, cálculo, cierre ni borrado", () => {
    for (const r of RUTAS) {
      const t = sinComentarios(r.texto);
      const inicio = t.indexOf("export async function GET(");
      if (inicio < 0) continue;
      const resto = t.slice(inicio + 10);
      const siguiente = resto.search(/export async function /);
      const cuerpo = siguiente < 0 ? resto : resto.slice(0, siguiente);
      expect(cuerpo, r.ruta).not.toMatch(/\b(crear|editar|eliminar|calcular|cerrar|archivar|guardar|sincronizar|decidir|aplicar)[A-Za-z]*\(/);
      expect(cuerpo, r.ruta).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    }
  });

  it("sincronizar y calcular son POST (nunca un GET con efectos)", () => {
    expect(fuente("src/app/api/proyeccion/factores/sincronizar/route.ts")).toMatch(/export async function POST/);
    expect(fuente("src/app/api/proyeccion/factores/sincronizar/route.ts")).not.toMatch(/export async function GET/);
    expect(fuente("src/app/api/proyeccion/factores/route.ts")).not.toMatch(/sincronizar/);
  });

  it("todos los handlers responden con ok()/error() (Cache-Control: no-store)", () => {
    for (const r of RUTAS) expect(r.texto, r.ruta).toMatch(/\bok\(|return r\.respuesta|return response/);
    expect(fuente("src/lib/api/respuestas.ts")).toContain('"Cache-Control": "no-store"');
    // Los errores con código (409) también salen sin caché.
    expect(fuente("src/lib/curvas/lectura.ts")).toMatch(/errorConCodigo[\s\S]*Cache-Control": "no-store"/);
    expect(fuente(`${LIB}servicio.ts`)).toMatch(/Cache-Control": "no-store"/);
  });

  it("los errores de la base que el usuario puede provocar pasan por traducirErrorDb", () => {
    expect(fuente(`${LIB}servicio-base.ts`)).toContain("traducirErrorDb");
  });

  it("nav.ts ofrece «Proyección de unidades» en la sección de planificación", () => {
    const nav = fuente("src/lib/nav.ts");
    expect(nav).toContain("/planificacion/proyeccion");
    expect(nav).toContain("Proyección de unidades");
  });
});

describe("M7: la pantalla exporta con SheetJS cargado bajo demanda y sin rutas nuevas", () => {
  const pantalla = src.filter((f) => f.ruta.startsWith("src/app/(app)/planificacion/proyeccion/"));
  it("si existe el componente de descarga, importa xlsx con import() dinámico", () => {
    const descarga = pantalla.find((f) => /descarga/.test(f.ruta));
    if (!descarga) return;
    expect(descarga.texto).toMatch(/import\(\s*["']xlsx["']\s*\)/);
    expect(descarga.texto).not.toMatch(/^import .* from ["']xlsx["']/m);
  });
  it("la pantalla habla con /api (nunca Supabase)", () => {
    for (const f of pantalla) expect(f.texto, f.ruta).not.toMatch(/@\/lib\/supabase|@supabase\//);
  });
});

describe("M7: migración 0018", () => {
  const dir = path.join(RAIZ, "supabase", "migrations");
  const m0018 = existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith("0018")) : [];
  it("si existe, no contiene drop, delete, truncate ni update fuera de comentarios", () => {
    expect(m0018.length).toBe(1);
    const texto = readFileSync(path.join(dir, m0018[0]), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
    // `on delete restrict` de una FK y `before update on` de un trigger no son sentencias.
    expect(texto.replace(/on delete (restrict|cascade|no action|set null)/gi, "").replace(/before update on/gi, ""), m0018[0]).not.toMatch(/\b(drop|delete|truncate|update)\b/i);
  });
});

describe("M7: humo SQL de la migración 0018", () => {
  it("scripts/humo-0018.sql existe, explica cómo correrlo y nunca deja nada escrito", () => {
    const ruta = path.join(RAIZ, "scripts", "humo-0018.sql");
    expect(existsSync(ruta)).toBe(true);
    const t = readFileSync(ruta, "utf8");
    expect(t).toMatch(/CÓMO CORRERLO/);
    expect(t).toMatch(/venta_proyeccion/);
    // Todo `begin` se cierra con `rollback`; ningún `commit`.
    expect(t.match(/^\s*begin;/gim)?.length ?? 0).toBeGreaterThan(5);
    expect((t.match(/\brollback;/gi) ?? []).length).toBeGreaterThanOrEqual(t.match(/\bbegin;/gi)?.length ?? 0);
    expect(t).not.toMatch(/\bcommit\b/i);
  });
});
