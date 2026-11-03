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
// Las rutas de IA (`/ia/`) y de aprobación en bloque (`/aprobacion/`, 07g) tienen sus propias pruebas estáticas (`ia.estatico`, `aprobacion.estatico`).
const RUTAS = src.filter((f) => f.ruta.startsWith("src/app/api/proyeccion/") && f.ruta.endsWith("route.ts") && !f.ruta.includes("/ia/") && !f.ruta.includes("/aprobacion/"));
/** Lógica pura: ni base ni HTTP ni pantalla. */
const PURAS = [
  "apertura-linea", "bloques", "calculo", "calendario", "cierre", "cierres-tienda", "composicion", "crecimientos", "curva-fila", "decision", "desactualizado", "esquemas", "excel",
  "explicar", "cola-larga", "resumen", "matriz", "mensual", "meta-gm", "modelo", "nino", "participaciones", "persistencia", "reglas", "reparto", "siguiente", "tendencia", "tiendas-nuevas", "tipos", "tipos-api", "universo",
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

describe("07e R24: M7 no depende de la IA (ni en el código ni en las lecturas del cálculo, el cierre, la Matriz, la mensual y la cerrada)", () => {
  const sin = (ruta: string) => sinComentarios(fuente(ruta));
  const delModulo = src.filter((f) => f.ruta.startsWith(LIB));
  /** Nombra una tabla `ia_*` como cadena (`from("ia_…")`, `"ia_propuestas_filas"`, …); `decision_ia_fila_id` no cuenta (es una columna de M7). */
  const NOMBRA_TABLA_IA = /["'`]ia_[a-z_]+["'`]|\bia_(propuestas|corridas?|configuraciones|evaluaciones|entradas|llamadas)[a-z_]*\b/;

  it("nada de src/lib/proyeccion/ importa de src/lib/ia/ (la Matriz usa proyeccion/meta-gm.ts)", () => {
    for (const f of delModulo) for (const origen of importsDe(sinComentarios(f.texto))) expect(origen, `${f.ruta} importa ${origen}`).not.toMatch(/(^|\/)lib\/ia(\/|$)|^\.\.?\/.*\bia\//);
    expect(importsDe(fuente(`${LIB}matriz.ts`))).toContain("./meta-gm");
    expect(importsDe(fuente(`${LIB}meta-gm.ts`)).every((o) => o === "./tipos-api")).toBe(true);
  });

  it("ningún archivo de M7 nombra una tabla ia_* salvo servicio-lectura.ts (lectura de la traza, solo para mostrar)", () => {
    const nombran = delModulo.filter((f) => NOMBRA_TABLA_IA.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(nombran).toEqual([`${LIB}servicio-lectura.ts`]);
    // Y esa lectura solo ocurre en leerDecisionesIa, por los ids de las trazas que ya traen las filas.
    const lectura = sin(`${LIB}servicio-lectura.ts`);
    expect(lectura.match(/from\(\s*["']ia_[a-z_]+["']/g)).toEqual(['from("ia_propuestas_filas"']);
    expect(lectura).toMatch(/export async function leerDecisionesIa[\s\S]*?if \(ids\.length === 0\) return listo/);
  });

  it("calcular, cerrar, matriz, mensual y cerrada: ni sus servicios ni sus rutas nombran tablas ia_* ni importan de la IA", () => {
    const servicios = ["servicio", "servicio-base", "servicio-crecimientos", "consultas", "calculo", "modelo", "cierre", "mensual", "matriz", "desactualizado", "reglas", "contexto"].map((n) => `${LIB}${n}.ts`);
    for (const ruta of servicios) {
      expect(fuente(ruta).length, ruta).toBeGreaterThan(0);
      expect(NOMBRA_TABLA_IA.test(sin(ruta)), ruta).toBe(false);
    }
    const rutas = src.filter((f) => /^src\/app\/api\/proyeccion\/(cerrada|proyecciones\/\[id\]\/(calcular|cerrar|matriz|mensual))\/route\.ts$/.test(f.ruta));
    expect(rutas.map((r) => r.ruta).length).toBe(5);
    for (const r of rutas) {
      expect(NOMBRA_TABLA_IA.test(sinComentarios(r.texto)), r.ruta).toBe(false);
      for (const origen of importsDe(r.texto)) expect(origen, `${r.ruta} importa ${origen}`).not.toMatch(/\/lib\/ia(\/|$)/);
    }
  });

  it("decision_ia_fila_id: el cálculo no la escribe (payloadAnioCalculo), el PUT de decisión no pasa opciones y solo servicio-edicion la decide", () => {
    const calculo = sin(`${LIB}persistencia.ts`).match(/export function payloadAnioCalculo[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(calculo.length).toBeGreaterThan(100);
    expect(calculo).not.toContain("decision_ia_fila_id");
    const put = sinComentarios(fuente("src/app/api/proyeccion/proyecciones/[id]/filas/[filaId]/anios/[anio]/route.ts"));
    expect(put).toMatch(/decidirFila\(s\.valores\.id, s\.valores\.filaId, s\.anio, datos, \{ id: perfil\.id, nombre: perfil\.nombre \}\)/);
    expect(put).not.toContain("decision_ia");
    // La firma de la ficha (contrato con Backend A).
    expect(sin(`${LIB}servicio-edicion.ts`)).toMatch(/export async function decidirFila\(\s*id: string,\s*filaId: string,\s*anio: number,\s*cuerpo: DecisionCuerpo,\s*actor: Actor,\s*opciones\?: \{ decision_ia_fila_id\?: string \}\s*\)/);
    // Quien nombra la columna: persistencia (payload y lectura de trazas), servicio-edicion (decidir) y, desde 07g, consultas (la pide en las columnas ligeras para que la IA
    // distinga `libre_en_bloque`; solo la selecciona). `copiar_de` (servicio.ts) la copia solo por `trazasIaDe` + `payloadAnioDecision`.
    const escriben = delModulo.filter((f) => /decision_ia_fila_id/.test(sinComentarios(f.texto))).map((f) => f.ruta).sort();
    expect(escriben).toEqual([CONSULTAS, `${LIB}persistencia.ts`, `${LIB}servicio-edicion.ts`]);
    const servicio = sin(`${LIB}servicio.ts`);
    expect(servicio).toMatch(/trazasIa = trazasIaDe\(f\.data\)/);
    expect(servicio).toMatch(/payloadAnioDecision\(filaId, r, undefined, traza\)/);
  });

  it("VERSION_METODO sigue en 5 y la cerrada no menciona la IA (contrato de M8 intacto)", () => {
    expect(fuente(`${LIB}tipos-api.ts`)).toMatch(/export const VERSION_METODO = 5;/);
    for (const ruta of [`${LIB}cierre.ts`, `${LIB}mensual.ts`, "src/app/api/proyeccion/cerrada/route.ts"]) expect(sin(ruta), ruta).not.toMatch(/decision_ia|meta_siguiente/);
  });
});

describe("07g R2: filaBloqueaCierre es la única definición de «bloquea el cierre»", () => {
  const sin = (ruta: string) => sinComentarios(fuente(ruta));

  it("reglas.ts la exporta una sola vez y motivoRechazoCerrar la llama; nadie más compara `propuesto >= umbral` ni `revision_cola_larga` para decidir el bloqueo", () => {
    const reglas = sin(`${LIB}reglas.ts`);
    expect(reglas.match(/export function filaBloqueaCierre\(/g)).toHaveLength(1);
    const cerrar = reglas.slice(reglas.indexOf("export function motivoRechazoCerrar"), reglas.indexOf("export function puedeEliminar"));
    expect(cerrar).toMatch(/filaBloqueaCierre\(r, umbral\)/);
    // El bucle que decide qué fila queda sin decidir no repite el predicado.
    const bucle = cerrar.slice(cerrar.indexOf("const sinDecidir"), cerrar.indexOf("if (sinDecidir.length > 0)"));
    expect(bucle.length).toBeGreaterThan(50);
    expect(bucle).not.toMatch(/revision_cola_larga|>=\s*umbral/);
    // Ni el servicio del cierre ni la aprobación en bloque tienen su propia copia (`cola-larga.ts` pone el aviso con otro propósito: no decide el bloqueo).
    for (const f of src.filter((x) => x.ruta === `${LIB}servicio.ts` || x.ruta.startsWith("src/lib/aprobacion/"))) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/propuesto\s*>=\s*(umbral|[a-z.]*umbral[a-z_]*)/i);
    }
  });
});

describe("07g R14: la función SQL escribe las mismas columnas que payloadAnioDecision (sin activo) más decision_lote_id", () => {
  const dir = path.join(RAIZ, "supabase", "migrations");
  const archivo = existsSync(dir) ? readdirSync(dir).find((n) => /^\d{4}_lotes_proyeccion\.sql$/.test(n)) : undefined;

  it("la lista de columnas permitidas de aplicar_lote_proyeccion = claves de payloadAnioDecision − activo − fila_id − anio + decision_lote_id", async () => {
    expect(archivo, "migración de lotes").toBeDefined();
    const sql = readFileSync(path.join(dir, archivo as string), "utf8");
    const lista = /v_permitidas text\[\] := array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? "";
    const enSql = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enSql.length).toBeGreaterThan(20);
    const { payloadAnioDecision } = await import("@/lib/proyeccion/persistencia");
    const registro = {
      anio: 2027, bloque: "mismas", subbloque: null, vendido: 0, propuesto: 100, metodo: "avance", referencia_alternativa: null, referencia_tres_meses: null, explicacion: "",
      crecimiento_pct: null, decidido: 100, origen: "manual", propuesta_al_decidir: 100, vigente: 100, nota: null, decidido_por_nombre: "x", decidido_at: "2026-11-03T10:00:00.000Z",
      meses: null, meses_propuestos: null, origen_meses: null, avance: null, avisos: [], curva_origen_usada: [], curva_origen_propuesta: null,
    } as unknown as Parameters<typeof payloadAnioDecision>[1];
    const claves = Object.keys(payloadAnioDecision("fila", registro, "perfil", "traza", "lote"))
      .filter((k) => !["activo", "fila_id", "anio"].includes(k))
      .sort();
    expect(claves).toContain("decision_lote_id");
    expect(enSql).toEqual(claves);
    // Nunca id, fila_id, anio ni activo (un lote no reactiva un registro).
    for (const prohibida of ["id", "fila_id", "anio", "activo"]) expect(enSql).not.toContain(prohibida);
  });

  it("el registro que solo se recalcula (payloadAnioRecalculo) no lleva ninguna columna de decisión ni activo", async () => {
    const { payloadAnioRecalculo } = await import("@/lib/proyeccion/persistencia");
    const registro = {
      anio: 2027, bloque: "mismas", subbloque: null, vendido: 0, propuesto: 100, metodo: "avance", referencia_alternativa: null, referencia_tres_meses: null, explicacion: "",
      crecimiento_pct: 5, decidido: 100, origen: "manual", propuesta_al_decidir: 100, vigente: 100, nota: "n", decidido_por_nombre: "x", decidido_at: "2026-11-03T10:00:00.000Z",
      meses: null, meses_propuestos: null, origen_meses: null, avance: null, avisos: [], curva_origen_usada: [], curva_origen_propuesta: null,
    } as unknown as Parameters<typeof payloadAnioRecalculo>[1];
    const claves = Object.keys(payloadAnioRecalculo("fila", registro));
    for (const decision of ["decidido", "origen", "nota", "propuesta_al_decidir", "decidido_at", "decidido_por_id", "decidido_por_nombre", "decision_ia_fila_id", "decision_lote_id", "crecimiento_pct", "activo", "fila_id", "anio"]) {
      expect(claves, decision).not.toContain(decision);
    }
  });
});

describe("07g: M7 y la aprobación en bloque", () => {
  const sin = (ruta: string) => sinComentarios(fuente(ruta));
  const delModulo = src.filter((f) => f.ruta.startsWith(LIB));

  it("R21: nada de src/lib/proyeccion/ importa de src/lib/aprobacion/", () => {
    for (const f of delModulo) for (const origen of importsDe(sinComentarios(f.texto))) expect(origen, `${f.ruta} importa ${origen}`).not.toMatch(/(^|\/)lib\/aprobacion(\/|$)|^\.\.?\/.*\baprobacion\//);
  });

  it("las tablas de lotes solo se LEEN desde consultas.ts (la escritura es la función SQL de la aprobación)", () => {
    const nombran = delModulo.filter((f) => /proyeccion_lotes|proyeccion_lote_filas/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(nombran).toEqual([CONSULTAS]);
    const c = sin(CONSULTAS);
    expect(c).not.toMatch(/from\(\s*["']proyeccion_lote(s|_filas)["']\)\s*\.(insert|update|upsert|delete)/);
    expect(c).not.toContain("aplicar_lote_proyeccion");
  });

  it("decision_lote_id: el cálculo no la escribe, solo servicio-edicion la limpia al decidir y copiar_de no la copia", () => {
    const calculo = sin(`${LIB}persistencia.ts`).match(/export function payloadAnioCalculo[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(calculo.length).toBeGreaterThan(100);
    expect(calculo).not.toContain("decision_lote_id");
    const escriben = delModulo.filter((f) => /decision_lote_id/.test(sinComentarios(f.texto))).map((f) => f.ruta).sort();
    expect(escriben).toEqual([CONSULTAS, `${LIB}persistencia.ts`, `${LIB}servicio-edicion.ts`, `${LIB}servicio-lectura.ts`].sort());
    // `copiar_de` (servicio.ts) escribe la decisión con `payloadAnioDecision(filaId, r, undefined, traza)`: sin quinto parámetro, la columna no se escribe y queda `null`.
    expect(sin(`${LIB}servicio.ts`)).toMatch(/payloadAnioDecision\(filaId, r, undefined, traza\)/);
    // Toda decisión individual la pasa en `null` (salvo el crecimiento propio, que no toca la decisión).
    expect(sin(`${LIB}servicio-edicion.ts`)).toMatch(/decision_lote_id: soloCrecimiento \? undefined : null/);
  });

  it("§3.6: la base de Y+1 que B2 recalcula se escribe con update condicional por updated_at y solo por guardarRecalculados", () => {
    const edicion = sin(`${LIB}servicio-edicion.ts`);
    expect(edicion).toMatch(/async function guardarRecalculados\(/);
    expect(edicion.match(/actualizarAnioCondicional\(/g)).toHaveLength(1);
    // propagarTienda ya no guarda la base de Y+1 con `guardarRegistros` (que escribe la decisión).
    const propagar = edicion.slice(edicion.indexOf("async function propagarTienda"), edicion.indexOf("// ─── PUT /tiendas/[tiendaId]/anios/[anio]"));
    expect(propagar).toMatch(/guardarRecalculados\(d, recalculados\)/);
    expect(propagar).not.toMatch(/guardarRegistros\(d, nuevasBases/);
    // El update condicional va por id y updated_at, nunca por clave sola.
    const consultas = sin(CONSULTAS);
    expect(consultas).toMatch(/\.update\(cambio\)\.eq\("id", id\)\.eq\("updated_at", updatedAtLeido\)/);
  });

  it("las columnas ligeras traen updated_at, decision_lote_id y decision_ia_fila_id y siguen sin historico; existe el modo `decision` (sin historico)", () => {
    const c = fuente(CONSULTAS);
    const anio = /export const COLUMNAS_ANIO_LIGERA =\s*"([^"]*)"/.exec(c)?.[1] ?? "";
    for (const col of ["updated_at", "decision_lote_id", "decision_ia_fila_id"]) expect(anio.split(",").map((x) => x.trim())).toContain(col);
    expect(anio).not.toContain("historico");
    const decision = /decision: `\$\{COLUMNAS_FILA_LIGERA\}, ([^`]*)`/.exec(c)?.[1] ?? "";
    expect(decision.length).toBeGreaterThan(10);
    expect(decision).not.toContain("historico");
    expect(c).toMatch(/export type ColumnasFilas = [^;]*"decision"/);
  });
});
