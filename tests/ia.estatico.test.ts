import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Pruebas estáticas de la propuesta con IA (ficha 07e, R24, R25, R26 y las reglas de oro): leen el código como texto. Cuidan que la clave solo viva en el
 * adaptador, que ningún id de modelo esté cableado, que las tablas `ia_*` y sus funciones solo las nombre `consultas.ts`, que nada de lo enviado vaya a los
 * logs y que cada ruta tenga el guard que le toca.
 */

const RAIZ = path.resolve(__dirname, "..");
const SRC = path.join(RAIZ, "src");

function archivos(dir: string, filtro: (f: string) => boolean): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = path.join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "node_modules" || nombre === ".next") continue;
      salida.push(...archivos(ruta, filtro));
    } else if (filtro(ruta)) salida.push(ruta);
  }
  return salida;
}

/** Sin comentarios (de línea y de bloque): las menciones en la documentación del código no cuentan. */
const sinComentarios = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const leer = (f: string): string => sinComentarios(readFileSync(f, "utf8"));
const rel = (f: string): string => path.relative(RAIZ, f).split(path.sep).join("/");
const esTs = (f: string) => /\.(ts|tsx)$/.test(f);

const FUENTES = archivos(SRC, esTs);
const LIB_IA = FUENTES.filter((f) => rel(f).startsWith("src/lib/ia/"));
const aislar = (re: RegExp, permitidos: string[], universo = FUENTES): string[] => universo.filter((f) => re.test(leer(f)) && !permitidos.includes(rel(f))).map(rel);

describe("la clave del proveedor (R25)", () => {
  it("solo el adaptador de OpenAI nombra OPENAI_API_KEY", () => {
    expect(aislar(/OPENAI_API_KEY/, ["src/lib/ia/proveedor-openai.ts"])).toEqual([]);
  });

  it("nadie nombra ANTHROPIC_API_KEY ni importa @anthropic-ai/sdk (el adaptador de Claude es futuro)", () => {
    expect(aislar(/ANTHROPIC_API_KEY|@anthropic-ai\/sdk/, [])).toEqual([]);
  });

  it("ningún archivo importa un SDK de OpenAI (el adaptador usa fetch)", () => {
    expect(aislar(/from\s+["']openai["']|require\(["']openai["']\)/, [])).toEqual([]);
    const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("openai");
  });

  it("solo entorno.ts lee IA_PROVEEDOR, IA_MODELO e IA_DESACTIVADA del entorno", () => {
    expect(aislar(/process\.env\.IA_|env\.IA_|env\[["']IA_/, ["src/lib/ia/entorno.ts"])).toEqual([]);
    const entorno = leer(path.join(SRC, "lib/ia/entorno.ts"));
    for (const v of ["IA_PROVEEDOR", "IA_MODELO", "IA_DESACTIVADA"]) expect(entorno).toContain(v);
  });

  it("solo proveedor-openai.ts lee process.env.OPENAI_*; ningún NEXT_PUBLIC_ de la IA", () => {
    expect(aislar(/process\.env\.OPENAI_/, ["src/lib/ia/proveedor-openai.ts"])).toEqual([]);
    expect(aislar(/NEXT_PUBLIC_[A-Z_]*(IA|OPENAI|PROVEEDOR|MODELO)/, [])).toEqual([]);
    expect(readFileSync(path.join(RAIZ, ".env.local.example"), "utf8")).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(IA_|OPENAI)/);
  });

  it(".env.local.example trae las variables de la IA vacías (sin ningún valor real)", () => {
    const t = readFileSync(path.join(RAIZ, ".env.local.example"), "utf8");
    for (const v of ["IA_PROVEEDOR", "IA_MODELO", "OPENAI_API_KEY", "IA_DESACTIVADA"]) expect(t).toMatch(new RegExp(`^${v}=$`, "m"));
  });

  it("solo proveedores.ts importa el adaptador y los componentes de cliente no importan nada del servidor de la IA", () => {
    expect(aislar(/proveedor-openai/, ["src/lib/ia/proveedores.ts"])).toEqual([]);
    const prohibidos = /from\s+["']@\/lib\/ia\/(proveedor|proveedores|proveedor-openai|servicio|servicio-pasos|servicio-evaluacion|consultas|entorno|registro|limites|contexto-gm|lectura-gm|propuesta|servicio-estimacion)["']/;
    const clientes = FUENTES.filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")));
    expect(clientes.length).toBeGreaterThan(0);
    expect(clientes.filter((f) => prohibidos.test(leer(f))).map(rel)).toEqual([]);
  });
});

describe("ningún id de modelo ni precio cableado (R25)", () => {
  it("el código no trae ids de modelos de ningún proveedor", () => {
    expect(aislar(/\bgpt[-_ ]?\d|\bgpt-|\bclaude[-_ ]|\bo[134]-(mini|preview|pro)\b|text-davinci|\bgemini-/i, [], FUENTES.filter((f) => !rel(f).startsWith("src/app/(app)/") && f !== path.join(SRC, "lib/supabase/database.types.ts")))).toEqual([]);
  });

  it("el adaptador y el servicio no fijan precios: llegan de la configuración o de la evaluación", () => {
    for (const f of ["proveedor-openai.ts", "servicio-pasos.ts", "servicio.ts", "costo.ts"]) {
      expect(leer(path.join(SRC, "lib/ia", f)), f).not.toMatch(/(entrada|salida|entrada_cache)\s*:\s*[1-9]/);
    }
  });
});

describe("las tablas `ia_*` y sus funciones (R25)", () => {
  const NOMBRES = /\bia_(configuraciones|evaluaciones|corridas|corrida_gms|entradas|llamadas|propuestas_gm|propuestas_filas)\b|venta_lineas_ia|registrar_propuesta_ia_gm/;
  // M7 muestra la traza de «Aceptar IA» leyendo `ia_propuestas_filas` por los ids que sus filas ya traen (Backend B; sin esas lecturas, M7 no toca la IA).
  const PERMITIDOS = ["src/lib/ia/consultas.ts", "src/lib/supabase/database.types.ts", "src/lib/proyeccion/servicio-lectura.ts"];

  it("solo consultas.ts las nombra en el código (más la lectura de la traza de M7 y los tipos de la base)", () => {
    const fuera = aislar(NOMBRES, PERMITIDOS, FUENTES.filter((f) => !rel(f).startsWith("src/app/(app)/")));
    // Los tipos y comentarios de M7 pueden mencionarlas como texto: lo que importa es que ningún archivo de la IA, salvo consultas.ts, las use.
    expect(fuera.filter((f) => f.startsWith("src/lib/ia/") || f.startsWith("src/app/api/"))).toEqual([]);
  });

  it("la única columna con lo enviado es ia_entradas.contenido_gz (R26)", () => {
    const tipos = readFileSync(path.join(SRC, "lib/supabase/database.types.ts"), "utf8");
    const tablas = [...tipos.matchAll(/^\s{6}(ia_[a-z_]+): \{\s*\n\s{8}Row: \{([\s\S]*?)\n\s{8}\};/gm)];
    expect(tablas.length).toBe(8);
    const sospechosas = /^(contenido|entrada|bloque|sufijo|respuesta|texto|prompt|salida|payload|cuerpo)(_gz)?$/;
    const encontradas: string[] = [];
    for (const [, tabla, cuerpo] of tablas) for (const c of cuerpo.matchAll(/^\s{10}([a-z_0-9]+):/gm)) if (sospechosas.test(c[1])) encontradas.push(`${tabla}.${c[1]}`);
    expect(encontradas).toEqual(["ia_entradas.contenido_gz"]);
  });
});

describe("nada de lo enviado ni lo recibido a los logs (R26)", () => {
  it("src/lib/ia/ no tiene console.* salvo registro.ts", () => {
    expect(LIB_IA.filter((f) => /\bconsole\./.test(leer(f)) && rel(f) !== "src/lib/ia/registro.ts").map(rel)).toEqual([]);
  });

  it("las rutas de la IA no escriben en la consola ni devuelven el cuerpo del proveedor", () => {
    const rutas = FUENTES.filter((f) => rel(f).startsWith("src/app/api/ia/") || /^src\/app\/api\/proyeccion\/proyecciones\/\[id\]\/ia\//.test(rel(f)));
    expect(rutas.length).toBe(15);
    expect(rutas.filter((f) => /\bconsole\./.test(leer(f))).map(rel)).toEqual([]);
  });

  it("registro.ts solo registra la forma permitida", () => {
    const t = leer(path.join(SRC, "lib/ia/registro.ts"));
    expect(t.match(/console\.[a-z]+\(/g)).toEqual(["console.info("]);
    expect(t).toContain("sanearRegistro");
  });
});

describe("guards y estructura de las rutas (R18, R25)", () => {
  const rutasAdmin = FUENTES.filter((f) => rel(f).startsWith("src/app/api/ia/") && rel(f).endsWith("route.ts"));
  const rutasPlanner = FUENTES.filter((f) => /^src\/app\/api\/proyeccion\/proyecciones\/\[id\]\/ia\/.*route\.ts$/.test(rel(f)));

  it("toda ruta de /api/ia usa requireAdmin y toda ruta …/ia de la proyección, requirePlanner (como primera sentencia)", () => {
    expect(rutasAdmin).toHaveLength(8);
    expect(rutasPlanner).toHaveLength(7);
    for (const f of rutasAdmin) {
      const t = leer(f);
      expect(t, rel(f)).toMatch(/await requireAdmin\(\)/);
      expect(t, rel(f)).not.toMatch(/requirePlanner|requireUser/);
      for (const m of t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\)\s*\{\s*\n\s*const \{[^}]*\} = await (\w+)\(\);/g)) expect(m[2], rel(f)).toBe("requireAdmin");
    }
    for (const f of rutasPlanner) {
      const t = leer(f);
      expect(t, rel(f)).toMatch(/await requirePlanner\(\)/);
      expect(t, rel(f)).not.toMatch(/requireAdmin|requireUser/);
    }
  });

  it("cada handler abre con su guard y los cuerpos pasan por leerCuerpo", () => {
    for (const f of [...rutasAdmin, ...rutasPlanner]) {
      const t = leer(f);
      const handlers = [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      const guards = [...t.matchAll(/const \{[^}]*response[^}]*\} = await require(Admin|Planner)\(\);\s*\n\s*if \(response\) return response;/g)];
      expect(guards.length, rel(f)).toBe(handlers.length);
      if (handlers.includes("POST")) expect(/leerCuerpo\(/.test(t) || /POST\(_request/.test(t), rel(f)).toBe(true);
      expect(t, rel(f)).not.toMatch(/\.(json|text|formData)\s*\(\)/);
    }
  });

  it("las rutas de los pasos piden margen de tiempo a la plataforma (maxDuration)", () => {
    const pasos = [...rutasAdmin, ...rutasPlanner].filter((f) => rel(f).endsWith("/paso/route.ts") || rel(f).endsWith("/preparar/route.ts"));
    expect(pasos).toHaveLength(3);
    for (const f of pasos) expect(leer(f), rel(f)).toMatch(/export const maxDuration = \d+/);
  });
});

describe("M7 no depende de la IA (R24)", () => {
  it("ningún archivo de src/lib/proyeccion importa nada de src/lib/ia", () => {
    const importan = archivos(path.join(SRC, "lib/proyeccion"), esTs).filter((f) => /from\s+["']@\/lib\/ia\//.test(leer(f)));
    expect(importan.map(rel)).toEqual([]);
  });

  it("calcular, cerrar, matriz, mensual y cerrada no leen tablas ia_* (solo la traza de la decisión, por ids que traen las filas)", () => {
    const calculo = ["servicio.ts", "matriz.ts", "mensual.ts", "cierre.ts", "calculo.ts"].map((f) => path.join(SRC, "lib/proyeccion", f));
    for (const f of calculo) expect(leer(f), rel(f)).not.toMatch(/from\(["']ia_/);
  });
});

describe("las pruebas no llaman al proveedor real (R35)", () => {
  const PRUEBAS = archivos(path.join(RAIZ, "tests"), (f) => f.endsWith(".ts"));

  it("ninguna prueba lee las claves de los proveedores", () => {
    const quienes = PRUEBAS.filter((f) => rel(f) !== "tests/ia.estatico.test.ts" && /process\.env\.(OPENAI|ANTHROPIC)_API_KEY|env\[["'](OPENAI|ANTHROPIC)_API_KEY/.test(readFileSync(f, "utf8")));
    expect(quienes.map(rel)).toEqual([]);
  });

  it("solo ia.proveedor-openai.test.ts importa el adaptador de OpenAI", () => {
    const quienes = PRUEBAS.filter((f) => /from\s+["']@\/lib\/ia\/proveedor-openai["']/.test(readFileSync(f, "utf8")) && rel(f) !== "tests/ia.estatico.test.ts");
    expect(quienes.map(rel)).toEqual(["tests/ia.proveedor-openai.test.ts"]);
  });

  it("vitest instala el bloqueo de red", () => {
    expect(readFileSync(path.join(RAIZ, "vitest.config.ts"), "utf8")).toContain("tests/setup-sin-red.ts");
    expect(readFileSync(path.join(RAIZ, "tests/setup-sin-red.ts"), "utf8")).toMatch(/openai/);
  });
});
