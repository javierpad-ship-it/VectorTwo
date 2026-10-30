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

describe("0.14.0 F1: los meses del periodo que se comparan en un factor salen de UNA sola función", () => {
  const sin = (ruta: string) => sinComentarios(fuente(ruta));

  it("M7 (estadosFactoresDeY) y GM (hoyFactor) llaman a mesesPeriodoPublicados; ninguno cuenta los meses del periodo por su cuenta", () => {
    const desactualizado = sin(`${LIB}desactualizado.ts`);
    const gm = sin("src/lib/crecimientos/servicio.ts");
    expect(desactualizado).toMatch(/meses_periodo_publicados:\s*mesesPeriodoPublicados\(/);
    expect(gm).toMatch(/meses_periodo_publicados:\s*mesesPeriodoPublicados\(/);
    expect(gm).toMatch(/import \{[^}]*mesesPeriodoPublicados[^}]*\} from "@\/lib\/proyeccion\/desactualizado"/);
    // Ningún otro sitio de src/ arma `meses_periodo_publicados` (la proyección y el contexto de M7 pasan por estadosFactoresDeY).
    const arman = src.filter((f) => /meses_periodo_publicados\s*:/.test(sinComentarios(f.texto)) && !/^src\/lib\/proyeccion\/factor-nino\.ts$/.test(f.ruta)).map((f) => f.ruta).sort();
    expect(arman).toEqual(["src/lib/crecimientos/servicio.ts", `${LIB}desactualizado.ts`]);
    // El recuento a mano que causó F1: filtrar los meses atípicos por «publicado» sin tope de mes cerrado.
    for (const t of [desactualizado.replace(/export function mesesPeriodoPublicados[\s\S]*?\n\}\n/, ""), gm]) expect(t).not.toMatch(/meses_atipicos\)?\.filter\([^)]*\.has\(m\)\)\.length|publicados\.has\(m\)\)\.length/);
  });

  it("la función mide con el mismo tope que sincronizarFactores: hastaPorDefecto(publicados, hoyLima)", () => {
    const fn = sin(`${LIB}desactualizado.ts`).match(/export function mesesPeriodoPublicados[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(fn).toContain("hastaPorDefecto(");
    expect(fn).toMatch(/m <= hasta/);
    // sincronizar mide con calcularEfectoNino (lectura.ts), que fija `hasta` con el mismo criterio y el reloj de Lima.
    expect(sin("src/lib/curvas/lectura.ts")).toMatch(/hastaPorDefecto\(venta\.data\.meses_publicados,\s*hoyLima\(\)\)/);
    expect(sin(`${LIB}servicio.ts`)).toMatch(/calcularEfectoNino\(d, null\)/);
    // y el contexto de M7 le pasa el reloj de Lima de la misma lectura (nunca un `new Date`).
    expect(sin(`${LIB}contexto.ts`)).toMatch(/hoy_lima:\s*ctx\.hoy/);
  });
});

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
    // 06e: el método 5 y el mínimo de M8 suben juntos (la cerrada de método 4 sigue sirviendo a M8 con aviso).
    expect(fuente(`${LIB}tipos-api.ts`)).toMatch(/export const VERSION_METODO = 5;/);
    expect(fuente(`${LIB}tipos-api.ts`)).toMatch(/export const VERSION_METODO_MIN_M8 = 5;/);
  });
});

describe("06e: un solo umbral de materialidad y sobre_base siempre explícito", () => {
  it("R26: calculo.ts decide `gm_con_nino` con correccionMaterial (la misma función que la pantalla de GM) y no define su propio umbral; el servicio pasa por ninoPorGM", () => {
    const calculo = sinComentarios(fuente(`${LIB}calculo.ts`));
    expect(calculo).toMatch(/import \{ correccionMaterial \} from "\.\/factor-nino"/);
    expect(calculo).toMatch(/correccionMaterial\(x\.b, x\.bc\)/);
    // Ni el umbral ni un 0,005 / 0,5 % escritos a mano en la lógica del método ni en el servicio.
    for (const nombre of ["calculo", "servicio", "servicio-crecimientos", "desactualizado", "reglas"]) {
      const t = sinComentarios(fuente(`${LIB}${nombre}.ts`));
      expect(t, nombre).not.toMatch(/UMBRAL_CORRECCION_NINO|\b0\.005\b|\b0\.5\s*%/);
    }
    // Quien lee las filas de hoy (cerrar) usa la misma función de calculo.ts.
    const servicio = sinComentarios(fuente(`${LIB}servicio.ts`));
    expect(servicio).toMatch(/import \{ calcularProyeccion, ninoPorGM \} from "\.\/calculo"/);
    expect(servicio).toMatch(/return ninoPorGM\(/);
  });

  it("R27: la foto de lo aplicado (`proyeccion_crecimientos`) se escribe con `sobre_base` explícito en cada celda; ningún otro archivo arma esas filas", () => {
    const servicio = sinComentarios(fuente(`${LIB}servicio.ts`));
    const push = /foto\.push\(\{[\s\S]*?\}\);/.exec(servicio)?.[0] ?? "";
    expect(push).toContain("sobre_base:");
    expect(push).toMatch(/sobre_base:\s*matriz\.sobre\?\.get\(clave\)\s*\?\?\s*"bruta"/);
    // La única escritura de la tabla es `escribirFotoCrecimientos` (upsert de las filas que arma `calcularYGuardar`).
    const escrituras = src.filter((f) => /from\(\s*["'`]proyeccion_crecimientos["'`]\)\s*\.(insert|upsert)/.test(f.texto)).map((f) => f.ruta);
    expect(escrituras).toEqual([CONSULTAS]);
    const armadas = src.filter((f) => /TablesInsert<"proyeccion_crecimientos">/.test(f.texto) && f.ruta !== TIPOS_DB).map((f) => f.ruta).sort();
    expect(armadas).toEqual([CONSULTAS, `${LIB}servicio.ts`].sort());
  });

  it("el Resto que se aplicó guarda su sobre_base en parametros.crecimiento_resto_usado (lo arma restoEfectivo y parametrosDe lo deja pasar)", () => {
    expect(sinComentarios(fuente(`${LIB}servicio.ts`))).toMatch(/crecimiento_resto_usado:\s*resto/);
    expect(sinComentarios(fuente(`${LIB}servicio-base.ts`))).toMatch(/crecimiento_resto_usado:\s*o\.crecimiento_resto_usado/);
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

  it("0.12.1 (06d): PUT …/crecimientos solo responde 410 crecimientos_globales: requirePlanner primero, sin leer el cuerpo ni llamar al servicio", () => {
    const t = sinComentarios(fuente("src/app/api/proyeccion/proyecciones/[id]/crecimientos/route.ts"));
    const put = t.slice(t.indexOf("export async function PUT("));
    expect(put.indexOf("requirePlanner")).toBeGreaterThan(-1);
    expect(put).toContain('errorConCodigo(MENSAJE_CRECIMIENTOS_GLOBALES, 410, "crecimientos_globales")');
    expect(put).not.toMatch(/leerCuerpo|request\.json|\.formData\(|\.text\(|guardar[A-Za-z]*\(/);
    expect(put.indexOf("requirePlanner")).toBeLessThan(put.indexOf("errorConCodigo"));
    expect(t).not.toMatch(/guardarCrecimientosSchema|guardarCrecimientos\b/);
    // Lo retirado en backend: choques, pisar, guardar la matriz y su huella.
    for (const f of src.filter((x) => x.ruta.startsWith(LIB))) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/filasEnChoque|huellaChoque|huellaMatriz|pisarRegistros|guardarCrecimientos\b/);
    }
  });

  it("0.12.1 (06d): solo consultas.ts escribe la foto de los crecimientos y ningún archivo de M7 nombra el global (crecimientos_genero_mundo)", () => {
    const nombranGlobal = src.filter((f) => f.ruta.startsWith(LIB) && /crecimientos_genero_mundo|venta_genero_mundo/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(nombranGlobal).toEqual([]);
    expect(sinComentarios(fuente(CONSULTAS))).toContain("escribirFotoCrecimientos");
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
