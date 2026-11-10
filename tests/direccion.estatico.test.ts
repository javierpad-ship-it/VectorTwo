import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_HUELLA } from "@/lib/direccion/tipos-api";
import { cuerpoDeFuncion, limpiar, primeraSentencia } from "./api.guards.analizador";

/**
 * Ficha 14 · pruebas estáticas del tablero de dirección: guard primero y sin `requireUser` (decisión 113); un solo archivo nombra las funciones y la
 * tabla de la migración 0041; solo lectura (R24); sin copia del predicado de cierre (R23, D12); qué columnas nombra `tablero_venta` y la versión de la
 * fórmula de la huella en la migración.
 */

const RAIZ = path.resolve(__dirname, "..");
const LIB = path.join(RAIZ, "src", "lib", "direccion");
const API = path.join(RAIZ, "src", "app", "api", "direccion");
const MIGRACIONES = path.join(RAIZ, "supabase", "migrations");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const leer = (p: string) => ({ ruta: path.relative(RAIZ, p).split(path.sep).join("/"), texto: sinComentarios(readFileSync(p, "utf8")) });
const lib = archivos(LIB).map(leer);
const api = archivos(API).map(leer);
const src = archivos(path.join(RAIZ, "src")).map(leer);
const CONSULTAS = "src/lib/direccion/consultas.ts";

describe("guards de `/api/direccion/*`", () => {
  const ESPERADO: Record<string, Record<string, string>> = {
    "opciones/route.ts": { GET: "requirePlanner" },
    "tablero/route.ts": { GET: "requirePlanner" },
    "bloqueos/route.ts": { GET: "requirePlanner" },
    "aprobaciones/route.ts": { GET: "requirePlanner", POST: "requireAdmin" },
    "estado/route.ts": { GET: "requirePlanner" },
  };

  it("son cinco archivos de ruta con seis handlers; ninguno exporta `PUT`, `PATCH` ni `DELETE`", () => {
    expect(api.map((f) => f.ruta.replace("src/app/api/direccion/", "")).sort()).toEqual(Object.keys(ESPERADO).sort());
    for (const archivo of archivos(API)) {
      const limpio = limpiar(readFileSync(archivo, "utf8"));
      for (const metodo of ["PUT", "PATCH", "DELETE"]) expect(cuerpoDeFuncion(limpio, metodo), `${archivo} ${metodo}`).toBeNull();
    }
  });

  it("la primera sentencia de cada handler es su guard: `requirePlanner` en las lecturas y `requireAdmin` en aprobar", () => {
    for (const [ruta, metodos] of Object.entries(ESPERADO)) {
      const limpio = limpiar(readFileSync(path.join(API, ruta), "utf8"));
      for (const metodo of ["GET", "POST"]) {
        const cuerpo = cuerpoDeFuncion(limpio, metodo);
        if (!(metodo in metodos)) {
          expect(cuerpo, `${ruta} ${metodo}`).toBeNull();
          continue;
        }
        expect(cuerpo, `${ruta} ${metodo}`).not.toBeNull();
        expect(primeraSentencia(cuerpo ?? ""), `${ruta} ${metodo}`).toMatchObject({ tipo: "guard", guard: metodos[metodo] });
      }
    }
  });

  it("ninguna ruta usa `requireUser` (el comprador no entra) ni toca la base: delega en el servicio", () => {
    for (const f of api) {
      expect(f.texto, f.ruta).not.toMatch(/requireUser/);
      expect(f.texto, f.ruta).not.toMatch(/supabaseAdmin|supabaseServer|\.from\(|\.rpc\(/);
    }
  });
});

describe("un solo archivo nombra las funciones y la tabla de la 0041", () => {
  const NOMBRES = /\b(tablero_venta|tablero_proyeccion|huella_proyeccion|registrar_aprobacion_direccion|aprobaciones_direccion)\b/;
  // Los tipos generados los nombrarán cuando se regeneren con la migración aplicada.
  const PERMITIDOS = new Set([CONSULTAS, "src/lib/supabase/database.types.ts"]);

  it("fuera de `consultas.ts`, ningún archivo de `src/` las nombra en su código", () => {
    const infractores = src.filter((f) => !PERMITIDOS.has(f.ruta) && NOMBRES.test(f.texto)).map((f) => f.ruta);
    expect(infractores).toEqual([]);
  });

  it("`consultas.ts` llama a las cuatro funciones y lee la tabla", () => {
    const consultas = lib.find((f) => f.ruta === CONSULTAS)?.texto ?? "";
    for (const nombre of ["tablero_venta", "tablero_proyeccion", "huella_proyeccion", "registrar_aprobacion_direccion"]) expect(consultas).toContain(`.rpc("${nombre}"`);
    expect(consultas).toContain('.from("aprobaciones_direccion")');
  });
});

describe("R24 · solo lectura", () => {
  const todos = [...lib, ...api];

  it("solo `consultas.ts` accede a la base (`.from(\"…\")` o `.rpc(`), y sus `rpc` son los cuatro de la 0041", () => {
    const conAcceso = todos.filter((f) => /\.from\(\s*["'`]|\.rpc\(/.test(f.texto)).map((f) => f.ruta);
    expect(conAcceso).toEqual([CONSULTAS]);
    const consultas = lib.find((f) => f.ruta === CONSULTAS)?.texto ?? "";
    const llamados = [...consultas.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect([...new Set(llamados)]).toEqual(["huella_proyeccion", "registrar_aprobacion_direccion", "tablero_proyeccion", "tablero_venta"]);
    // El único que escribe es el de registro, y va sin plazo de cliente (abortar una escritura dejaría el resultado ambiguo).
    const registro = consultas.match(/\.rpc\(\s*"registrar_aprobacion_direccion"[^;]*;/)?.[0] ?? "";
    expect(registro).not.toBe("");
    expect(registro).not.toMatch(/abortSignal/);
  });

  it("ningún `insert`, `update`, `upsert` ni `delete` sobre tablas", () => {
    // Las dos excepciones no son tablas: el `Map` de la caché (`delete`) y el `createHash(...).update(...)` de la huella de maestros.
    const NO_SON_TABLAS: Record<string, RegExp> = {
      "src/lib/direccion/cache.ts": /\b(guardado|enCurso)\.delete\(/g,
      "src/lib/direccion/contexto.ts": /createHash\("md5"\)\.update\(/g,
    };
    for (const f of todos) {
      const texto = NO_SON_TABLAS[f.ruta] ? f.texto.replace(NO_SON_TABLAS[f.ruta], "") : f.texto;
      expect(texto, f.ruta).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });

  it("no importa ninguna función de escritura de otros módulos", () => {
    const ESCRITURA = /^(insertar|actualizar|upsert|borrar|eliminar|guardar|escribir|desactivar|cambiar|tomar|soltar|reemplazar|restaurar|registrar|aplicar|publicar|importar)/;
    let revisados = 0;
    for (const f of lib.filter((x) => x.ruta !== CONSULTAS)) {
      for (const m of f.texto.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"(@\/lib\/(?!direccion\/)[^"]+)"/g)) {
        const nombres = m[1].split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);
        for (const n of nombres) {
          revisados += 1;
          expect(ESCRITURA.test(n), `${f.ruta} importa ${n} de ${m[2]}`).toBe(false);
        }
      }
    }
    // La prueba mira de verdad los imports (el servicio y el cierre traen decenas de lecturas de otros módulos).
    expect(revisados).toBeGreaterThan(40);
    expect(lib.length).toBeGreaterThan(12);
    // Dentro del módulo, la única escritura es `registrarAprobacion`, y solo la llama el servicio.
    const quienRegistra = lib.filter((f) => /\bregistrarAprobacion\b/.test(f.texto)).map((f) => f.ruta).sort();
    expect(quienRegistra).toEqual([CONSULTAS, "src/lib/direccion/servicio.ts"]);
  });

  it("no nombra las tablas de la IA (`ia_*`) ni la función `venta_proyeccion`", () => {
    for (const f of todos) {
      expect(f.texto, f.ruta).not.toMatch(/\bia_[a-z]/);
      expect(f.texto, f.ruta).not.toMatch(/\bventa_proyeccion\b/);
    }
  });

  it("la caché no importa nada de `@supabase/*` y los contratos no importan nada", () => {
    expect(lib.find((f) => f.ruta === "src/lib/direccion/cache.ts")?.texto).not.toMatch(/@supabase|supabase/);
    expect(lib.find((f) => f.ruta === "src/lib/direccion/tipos-api.ts")?.texto).not.toMatch(/^\s*import\s/m);
    // La lógica pura no abre clientes: solo el servicio y el cierre.
    const conCliente = lib.filter((f) => /supabaseAdmin\(/.test(f.texto)).map((f) => f.ruta).sort();
    expect(conCliente).toEqual(["src/lib/direccion/cierre.ts", "src/lib/direccion/servicio.ts"]);
    for (const f of todos) expect(f.texto, f.ruta).not.toMatch(/supabaseServer/);
  });
});

describe("R23 · lo que bloquearía el cierre no copia las reglas de M7", () => {
  const cierre = lib.find((f) => f.ruta === "src/lib/direccion/cierre.ts")?.texto ?? "";

  it("`cierre.ts` usa `motivoRechazoCerrar`, `filaBloqueaCierre` y `bloqueosNinoDeCierre` de M7; nadie importa `bloqueosDeLote`", () => {
    expect(cierre).toMatch(/import \{[^}]*\bfilaBloqueaCierre\b[^}]*\bmotivoRechazoCerrar\b[^}]*\} from "@\/lib\/proyeccion\/reglas"/);
    expect(cierre).toContain("bloqueosNinoDeCierre(");
    for (const f of lib) expect(f.texto, f.ruta).not.toMatch(/bloqueosDeLote|@\/lib\/aprobacion\//);
  });

  it("arma los argumentos con las mismas funciones que `cerrarProyeccion`", () => {
    for (const nombre of ["cargarContextoCalculo(d, { conEat: false, conFlujo: true })", "leerVigentes(", "desactualizadaDe(", 'leerFilasConAnios(d, p.id, { columnas: "ligeras", tiendaId: null, soloActivas: true })', "leerTiendasProyeccion(", "crecimientosDeHoy(", "ninoDeFilas(", "bloqueosNinoDe(", "esMetodoVigente(", "comoAvisos("]) {
      expect(cierre, nombre).toContain(nombre);
    }
    expect(cierre).toContain("forzar: false");
  });

  it("no reimplementa el predicado: ni mira los avisos de cola larga ni compara la propuesta con el umbral", () => {
    for (const f of lib) {
      expect(f.texto, f.ruta).not.toMatch(/includes\(\s*["'`]revision_cola_larga/);
      expect(f.texto, f.ruta).not.toMatch(/propuesto\s*>=|>=\s*umbral/);
      // El umbral solo se lee de los parámetros para pasarlo como argumento.
      for (const m of f.texto.matchAll(/.{0,30}umbral_cola_larga/g)) expect(m[0], f.ruta).toMatch(/parametros\.umbral_cola_larga$/);
    }
    // `revision_cola_larga` aparece solo como clave del conteo por motivo (el motivo lo da `filaBloqueaCierre`).
    const conClave = lib.filter((f) => /revision_cola_larga/.test(f.texto)).map((f) => f.ruta).filter((r) => !r.endsWith("/excel.ts")).sort();
    expect(conClave).toEqual(["src/lib/direccion/cierre.ts", "src/lib/direccion/tipos-api.ts"]);
  });
});

describe("la migración que define las funciones", () => {
  /** La última migración (por nombre) que define una función, y el cuerpo de esa función (entre `as $$` y `$$;`). */
  function cuerpoDe(funcion: string): string {
    const candidatas = readdirSync(MIGRACIONES)
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .filter((n) => readFileSync(path.join(MIGRACIONES, n), "utf8").includes(`create or replace function public.${funcion}(`));
    expect(candidatas.length, funcion).toBeGreaterThan(0);
    const sql = readFileSync(path.join(MIGRACIONES, candidatas[candidatas.length - 1]), "utf8");
    const desde = sql.lastIndexOf(`create or replace function public.${funcion}(`);
    const inicio = sql.indexOf("as $$", desde);
    const fin = sql.indexOf("$$;", inicio);
    expect(inicio).toBeGreaterThan(desde);
    expect(fin).toBeGreaterThan(inicio);
    return sql.slice(inicio, fin);
  }

  it("`tablero_venta` no nombra `costo_vendido` ni `stock_valorizado`; de los hechos solo lee unidades, soles de venta y stock en unidades", () => {
    const cuerpo = cuerpoDe("tablero_venta");
    expect(cuerpo).not.toMatch(/costo_vendido|stock_valorizado|costo/);
    for (const columna of ["unidades", "venta_soles", "stock_unidades"]) expect(cuerpo, columna).toContain(columna);
    expect(cuerpo).toContain("venta_stock_vigente");
    // Solo lectura: ninguna sentencia de escritura.
    expect(cuerpo).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|truncate)\b/i);
  });

  it("`tablero_proyeccion` y `huella_proyeccion` son de solo lectura y no leen el histórico ni las tablas de la IA", () => {
    for (const funcion of ["tablero_proyeccion", "huella_proyeccion"]) {
      const cuerpo = cuerpoDe(funcion);
      expect(cuerpo, funcion).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|truncate)\b/i);
      expect(cuerpo, funcion).not.toMatch(/\bia_[a-z]|\.historico\b/);
    }
  });

  it("la primera línea del texto canónico de la huella es `v|<VERSION_HUELLA>`", () => {
    const cuerpo = cuerpoDe("huella_proyeccion");
    const version = cuerpo.match(/concat_ws\('\|', 'v', '(\d+)'\)/);
    expect(version, "la huella debe empezar con concat_ws('|', 'v', '<versión>')").not.toBeNull();
    expect(Number(version?.[1])).toBe(VERSION_HUELLA);
    // Es lo primero que entra en el md5.
    expect(cuerpo.replace(/\s+/g, " ")).toMatch(/select md5\(concat_ws\(E'\\n', concat_ws\('\|', 'v', '\d+'\),/);
  });

  it("`registrar_aprobacion_direccion` es la única que inserta y solo en su tabla", () => {
    const cuerpo = cuerpoDe("registrar_aprobacion_direccion");
    const inserciones = [...cuerpo.matchAll(/insert\s+into\s+([a-z_.]+)/gi)].map((m) => m[1]);
    expect(inserciones).toEqual(["public.aprobaciones_direccion"]);
    expect(cuerpo).not.toMatch(/\b(update\s+public|delete\s+from|truncate)\b/i);
    expect(cuerpo).toContain("for share");
    expect(cuerpo).toContain("not v_proy.activo");
  });
});
