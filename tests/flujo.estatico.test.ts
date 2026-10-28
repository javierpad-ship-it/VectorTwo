import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Regla 21 de la ficha 08 (pruebas estáticas de M8, T3b): lo que se rompe por descuido y no por un caso de uso se vigila leyendo el código.
 * Guards de las rutas, independencia compras ↔ flujo, lectura de M7, M12 y M13 solo por sus servicios, la API nunca escribe tablas de
 * compras (solo `.rpc(`), la caché se llave por `flujo_huella_base()` y la migración `0025` no tiene sentencias destructivas.
 */

const RAIZ = path.resolve(__dirname, "..");
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
const libFlujo = enDir("src/lib/flujo/");
const libCompras = enDir("src/lib/compras/");
const importaciones = (texto: string) => [...sinComentarios(texto).matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

// ─── Rutas ───

type Esperada = { ruta: string; metodo: string; guard: "requireUser" | "requirePlanner" };
const ESPERADAS: Esperada[] = [
  { ruta: "flujo/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "flujo/fila/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "flujo/huecos/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "flujo/conciliacion/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "flujo/conciliacion/aceptar/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "flujo/parametros/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "flujo/parametros/route.ts", metodo: "PUT", guard: "requirePlanner" },
  { ruta: "compras/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/[id]/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/[id]/historial/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/[id]/recibir/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "compras/[id]/recepciones/[recepcionId]/route.ts", metodo: "DELETE", guard: "requirePlanner" },
  { ruta: "compras/[id]/cancelar/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "compras/proveedores/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/importar/route.ts", metodo: "POST", guard: "requirePlanner" },
];
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const API = path.join(RAIZ, "src", "app", "api");
const rutasM8 = [...rutasDeApi(path.join(API, "flujo")), ...rutasDeApi(path.join(API, "compras"))];

describe("rutas de M8: guards de la ficha (sección 7)", () => {
  it("son exactamente las 15 de 0.13.0 (sin DELETE de compras: se cancelan; sin POST de compras ni de proveedores hasta 0.13.1 y M9a)", () => {
    const encontradas: string[] = [];
    for (const r of rutasM8) {
      const limpio = limpiar(readFileSync(r, "utf8"));
      for (const m of METODOS) if (cuerpoDeFuncion(limpio, m) !== null) encontradas.push(`${rel(r).replace("src/app/api/", "")} ${m}`);
    }
    expect(encontradas.sort()).toEqual(ESPERADAS.map((e) => `${e.ruta} ${e.metodo}`).sort());
  });

  it("cada handler abre con SU guard como PRIMERA sentencia: lecturas requireUser, escrituras requirePlanner", () => {
    for (const e of ESPERADAS) {
      const limpio = limpiar(readFileSync(path.join(API, e.ruta), "utf8"));
      const primera = primeraSentencia(cuerpoDeFuncion(limpio, e.metodo) ?? "");
      expect({ ruta: e.ruta, metodo: e.metodo, tipo: primera.tipo, guard: primera.tipo === "guard" ? primera.guard : null }).toEqual({ ruta: e.ruta, metodo: e.metodo, tipo: "guard", guard: e.guard });
    }
  });

  it("en M8 ninguna escritura usa requireUser (la lista blanca de M9a no existe todavía) y las rutas no usan requireAdmin", () => {
    for (const e of ESPERADAS.filter((x) => x.metodo !== "GET")) {
      const limpio = limpiar(readFileSync(path.join(API, e.ruta), "utf8"));
      const cuerpo = cuerpoDeFuncion(limpio, e.metodo) ?? "";
      expect(cuerpo, `${e.ruta} ${e.metodo}`).not.toMatch(/requireUser|requireAdmin/);
    }
    for (const r of rutasM8) expect(sinComentarios(readFileSync(r, "utf8")), rel(r)).not.toMatch(/requireAdmin/);
  });

  it("los handlers no hablan con la base: ni .from( ni .rpc( ni escrituras; solo llaman a los servicios (supabaseAdmin() se pasa a ellos)", () => {
    for (const r of rutasM8) {
      const texto = sinComentarios(readFileSync(r, "utf8"));
      expect(texto, rel(r)).not.toMatch(/\.(from|rpc|insert|update|upsert|delete)\s*\(/);
      expect(texto, rel(r)).not.toMatch(/supabaseServer/);
    }
  });

  it("los GET no escriben nada: no llaman a ninguna función de escritura de los servicios", () => {
    const escritoras = /confirmarIngreso|quitarIngreso|cancelarCompra|importarCompras|guardarParametros|registrarSugerenciaAceptada/;
    for (const e of ESPERADAS.filter((x) => x.metodo === "GET")) {
      const limpio = limpiar(readFileSync(path.join(API, e.ruta), "utf8"));
      expect(cuerpoDeFuncion(limpio, "GET") ?? "", e.ruta).not.toMatch(escritoras);
    }
  });

  it("GET /api/flujo y las demás lecturas no seleccionan venta_soles ni costo_vendido (el flujo entrega unidades)", () => {
    for (const f of [...libFlujo, ...enDir("src/app/api/flujo/"), ...libCompras, ...enDir("src/app/api/compras/")]) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/venta_soles|costo_vendido/);
    }
  });

  it("ningún archivo de src nombra no_es_tuya (no hay propiedad: decisión 28)", () => {
    expect(src.filter((f) => /no_es_tuya/.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
  });
});

// ─── Datos solo por los servicios y solo en consultas.ts ───

describe("datos: solo en consultas.ts, solo por los servicios de M7, M12 y M13", () => {
  it("src/lib/flujo y src/lib/compras no importan @supabase/* ni los clientes fuera de consultas.ts", () => {
    const permitidos = ["src/lib/flujo/consultas.ts", "src/lib/compras/consultas.ts"];
    const ofensores: string[] = [];
    for (const f of [...libFlujo, ...libCompras]) {
      if (permitidos.includes(f.ruta)) continue;
      for (const origen of importaciones(f.texto)) {
        if (/^@supabase\//.test(origen) || /supabase\/(admin|server|client)$/.test(origen)) ofensores.push(`${f.ruta} importa ${origen}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it("consultas.ts y servicio.ts de cada carpeta importan server-only; el cliente solo se abre en los handlers", () => {
    for (const r of ["src/lib/flujo/consultas.ts", "src/lib/flujo/servicio.ts", "src/lib/compras/consultas.ts", "src/lib/compras/servicio.ts"]) {
      expect(archivo(r).texto, r).toMatch(/^import "server-only";/m);
    }
    expect([...libFlujo, ...libCompras].filter((f) => /supabaseAdmin|supabaseServer/.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
    const sinCliente = enDir("src/app/api/flujo/").concat(enDir("src/app/api/compras/")).filter((f) => !/supabaseAdmin\(\)/.test(f.texto));
    expect(sinCliente.map((f) => f.ruta), "todo handler de M8 abre su cliente con supabaseAdmin()").toEqual([]);
  });

  it("src/lib/flujo y src/lib/compras no nombran las tablas de M12 y M13 ni las de M7 y M5: leen por sus servicios y por stock_flujo", () => {
    const prohibidas = /intercompany_reglas|intercompany_vigente|repartos_marca_barrido|reparto_marca_barrido_gml|proyeccion_filas|venta_stock_vigente/;
    expect([...libFlujo, ...libCompras].filter((f) => prohibidas.test(sinComentarios(f.texto))).map((f) => f.ruta)).toEqual([]);
    // y las llaman por sus servicios: nunca por sus rutas (requirePlanner)
    const flujo = sinComentarios(archivo("src/lib/flujo/servicio.ts").texto);
    expect(flujo).toMatch(/leerCerradaParaFlujo\(/);
    expect(flujo).toMatch(/leerRepartosVigentes\(/);
    expect(flujo).toMatch(/leerVigentes\(/);
    for (const f of [...libFlujo, ...libCompras]) expect(sinComentarios(f.texto), f.ruta).not.toMatch(/\/api\/(proyeccion|marcas-barrer|intercompany)/);
  });

  it("el flujo no define su propia subflujoIntercompany ni su propio temporadaDe (los importa), y VERSION_METODO_MIN_M8 solo se define en proyeccion/tipos-api.ts", () => {
    for (const f of libFlujo) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/(function|const|let)\s+(subflujoIntercompany|temporadaDe|motivoTemporadasInvalidas)\b/);
    }
    const definiciones = src.filter((f) => /(?:const|let|var)\s+VERSION_METODO_MIN_M8\s*=/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(definiciones).toEqual(["src/lib/proyeccion/tipos-api.ts"]);
  });

  it("la cerrada para el flujo se lee con una exportación ADITIVA de M7 (leerProyeccionCerrada y su ruta no cambian)", () => {
    const m7 = sinComentarios(archivo("src/lib/proyeccion/servicio.ts").texto);
    expect(m7).toMatch(/export async function leerCerradaParaFlujo\(/);
    expect(m7).toMatch(/export async function leerProyeccionCerrada\(anio: number\)/);
    expect(m7).toMatch(/armarFilasCerradas\(planas, \[anio\]\)/);
  });

  it("M12 lee las temporadas de flujo_parametros (y no las del defecto) al armar su contexto", () => {
    const m12 = sinComentarios(archivo("src/lib/marcas-barrer/servicio.ts").texto);
    expect(m12).toMatch(/leerTemporadasDb\(/);
    expect(m12).not.toMatch(/temporadas:\s*temporadasPorDefecto\(\)/);
  });
});

// ─── La API nunca escribe tablas de compras ───

describe("la API nunca escribe las tablas de compras: solo .rpc( de las funciones de 0025", () => {
  const TABLAS = ["compras", "compra_lineas", "compra_linea_entregas", "compra_linea_repartos", "compra_linea_recepciones", "compra_eventos", "proveedores"];
  const DESDE_TABLA = new RegExp(`\\.from\\(\\s*["'\`](${TABLAS.join("|")})["'\`]\\s*\\)`, "g");

  it("ningún archivo de src llama .insert(, .update(, .upsert( ni .delete( sobre esas tablas", () => {
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

  it("el recorrido ve las lecturas de esas tablas (la prueba no está vacía)", () => {
    const ficheros = src.filter((f) => DESDE_TABLA.test(sinComentarios(f.texto))).map((f) => f.ruta);
    DESDE_TABLA.lastIndex = 0;
    expect(ficheros).toEqual(expect.arrayContaining(["src/lib/compras/consultas.ts", "src/lib/flujo/consultas.ts"]));
  });

  it("las cuatro funciones de escritura se llaman con .rpc( y SOLO desde src/lib/compras/consultas.ts", () => {
    const funciones = ["importar_compra", "registrar_recepciones", "quitar_recepcion", "cancelar_compra"];
    const llamadas = src.filter((f) => new RegExp(`\\.rpc\\(\\s*["'\`](${funciones.join("|")})["'\`]`).test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(llamadas).toEqual(["src/lib/compras/consultas.ts"]);
    const texto = sinComentarios(archivo("src/lib/compras/consultas.ts").texto);
    for (const nombre of funciones) expect(texto, nombre).toContain(`.rpc("${nombre}"`);
  });

  it("flujo_parametros es la única tabla que M8 escribe, con un upsert de una fila (clave global)", () => {
    const texto = sinComentarios(archivo("src/lib/flujo/consultas.ts").texto);
    expect(texto).toMatch(/\.from\("flujo_parametros"\)\s*\.upsert\(\{ clave: "global"/);
    expect([...texto.matchAll(/\.(insert|update|delete)\s*\(/g)]).toHaveLength(0);
  });
});

// ─── Independencia entre compras y flujo ───

describe("independencia compras ↔ flujo (ficha 08, §0.8)", () => {
  it("src/lib/compras/** no importa src/lib/flujo/** (ni el servicio ni las consultas)", () => {
    const ofensores: string[] = [];
    for (const f of libCompras) for (const o of importaciones(f.texto)) if (/(^|\/)flujo(\/|$)/.test(o)) ofensores.push(`${f.ruta} importa ${o}`);
    expect(ofensores).toEqual([]);
  });

  it("src/lib/flujo/** solo importa de src/lib/compras/ pendientes.ts y los tipos*.ts", () => {
    const ofensores: string[] = [];
    for (const f of libFlujo) {
      for (const o of importaciones(f.texto)) {
        if (!/^@\/lib\/compras\//.test(o) && !/^\.\.\/compras\//.test(o)) continue;
        if (!/^@\/lib\/compras\/(pendientes|tipos|tipos-api)$/.test(o)) ofensores.push(`${f.ruta} importa ${o}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it("las rutas son el único lugar donde se juntan: el aviso exceso y las sugerencias viajan por parámetro, no por import", () => {
    const servicioCompras = sinComentarios(archivo("src/lib/compras/servicio.ts").texto);
    expect(servicioCompras).toMatch(/CalculoExceso/);
    expect(servicioCompras).toMatch(/ContextoFlujo/);
    const importar = sinComentarios(archivo("src/app/api/compras/importar/route.ts").texto);
    expect(importar).toMatch(/excesoDeLineasNuevas/);
  });
});

// ─── La caché se llave por flujo_huella_base() ───

describe("caché por huella (regla 24): flujo_huella_base() gobierna todas las claves", () => {
  const servicio = sinComentarios(archivo("src/lib/flujo/servicio.ts").texto);
  const cache = sinComentarios(archivo("src/lib/flujo/cache.ts").texto);
  const consultas = sinComentarios(archivo("src/lib/flujo/consultas.ts").texto);

  it("la función de la base se llama desde consultas.ts y el servicio la lee primero, en cada GET, sin caché propia", () => {
    expect(consultas).toContain('.rpc("flujo_huella_base")');
    const cuerpo = cuerpoDeFuncion(limpiar(archivo("src/lib/flujo/servicio.ts").texto), "obtenerFlujo") ?? "";
    expect(cuerpo).toMatch(/leerHuellaBase\(d\)/);
    expect(cuerpo.indexOf("leerHuellaBase(")).toBeLessThan(cuerpo.indexOf("cacheResultado"));
    expect(cuerpo).toMatch(/huellaCalculoFlujo\(huellaBase, mesLima\)/);
    expect(servicio).toMatch(/clavesCache\(huellaBase\)/);
  });

  it("cada lectura cacheada se llave por una parte de la huella (claves.*), nunca por tiempo", () => {
    const lecturas = [...servicio.matchAll(/lecturaCacheada<[^>]*(?:<[^>]*>)?[^>]*>\(\s*"(\w+)",\s*([^,]+?),\s*async/g)];
    expect(lecturas.map((m) => m[1]).sort()).toEqual(["cerrada", "compras", "configuracion", "parametros", "reglas", "repartos"]);
    for (const m of lecturas) expect(m[2], m[1]).toMatch(/claves\./);
    expect(servicio).toMatch(/claveStockFilas\(claves, kPrima\)/);
    expect(servicio).toMatch(/cacheStock\.obtener\(`\$\{cargaId\}\|\$\{claveStock\}`/);
  });

  it("la caché no usa el reloj ni temporizadores: se invalida sola con la huella (single-flight, LRU de 26 meses por carga)", () => {
    expect(cache).not.toMatch(/Date\.now|new Date|setTimeout|setInterval|ttl|expira/i);
    expect(cache).toMatch(/MESES_CACHE_STOCK/);
    expect(cache).toMatch(/vuelo/);
  });

  it("el cálculo no lee el reloj: k', k y hoy entran por la huella y el reloj de cada llamada", () => {
    // solo `obtenerFlujo` lee «hoy» (hoyLima) para formar la huella; calcularFlujo y las funciones puras no
    expect(servicio.match(/hoyLima\(/g)?.length).toBe(1);
  });
});

// ─── Migración 0025 ───

describe("migración 0025: sin sentencias destructivas a nivel de migración (§0.12)", () => {
  const sql = readFileSync(path.join(RAIZ, "supabase", "migrations", "0025_flujo_y_compras.sql"), "utf8");
  /** Quita comentarios, cuerpos `$$ … $$`, cadenas, `revoke`, `on delete …` y los `before update [or delete] on` de los triggers: lo que no es una sentencia de la migración. */
  const sentencias = sql
    .replace(/--.*$/gm, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "$$ $$")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\brevoke\b[^;]*;/gi, "")
    .replace(/\bon\s+delete\s+(restrict|cascade|set\s+null|no\s+action)\b/gi, "")
    .replace(/\bbefore\s+update(?:\s+or\s+delete)?\s+on\b/gi, "");

  it("no tiene drop, delete, truncate ni update fuera de los cuerpos de sus funciones", () => {
    expect(sentencias.match(/\b(drop|delete|truncate|update)\b/gi) ?? []).toEqual([]);
  });

  it("crea las cuatro funciones de escritura de 0.13.0 y el trigger de eventos inmutables", () => {
    for (const f of ["importar_compra", "registrar_recepciones", "quitar_recepcion", "cancelar_compra", "stock_flujo", "flujo_huella_base"]) {
      expect(sql, f).toMatch(new RegExp(`create or replace function public\\.${f}\\(`));
    }
    expect(sql).toMatch(/compra_eventos_inmutable/);
  });
});
