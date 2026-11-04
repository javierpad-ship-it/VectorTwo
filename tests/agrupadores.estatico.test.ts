import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Pruebas estáticas de los agrupadores de compras (ficha 08b, T3b; R15, R16, R22 y la regla de independencia): lo que se rompe por descuido
 * y no por un caso de uso se vigila leyendo el código. Guards por ruta y método, solo `.rpc(` para escribir, datos solo en `consultas.ts`,
 * la cookie del viaje activo solo la escribe `PUT /api/compras/viaje-activo` y ninguna ruta la lee, una sola definición de su nombre, y
 * `src/lib/compras/agrupadores` sin importar `src/lib/flujo`.
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
const enDir = (dir: string) => src.filter((f) => f.ruta.startsWith(dir));
const archivo = (ruta: string) => {
  const f = src.find((x) => x.ruta === ruta);
  if (!f) throw new Error(`no existe ${ruta}`);
  return f;
};

const API = path.join(RAIZ, "src", "app", "api");
const esDeAgrupadores = (ruta: string) => /\/api\/compras\/(viajes|embarques|paquetes|agrupadores|viaje-activo)\//.test(ruta.split(path.sep).join("/"));
const rutasAgrupadores = rutasDeApi(path.join(API, "compras")).filter(esDeAgrupadores);
const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Esperada = { ruta: string; metodo: (typeof METODOS)[number]; guard: "requireUser" | "requirePlanner" };
/** R15: todo lo del comprador es `requireUser`; solo el estado del viaje y el del paquete son `requirePlanner` (el del embarque decide con el cuerpo). */
const ESPERADAS: Esperada[] = [
  { ruta: "compras/viajes/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/viajes/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/viajes/[id]/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/viajes/[id]/route.ts", metodo: "PATCH", guard: "requireUser" },
  { ruta: "compras/viajes/[id]/estado/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "compras/viajes/[id]/compras/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/embarques/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/route.ts", metodo: "PATCH", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/estado/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/paquetes/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/asignar/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/quitar/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/paquete/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/fecha/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/embarques/[id]/pasar-pendientes/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/paquetes/[id]/route.ts", metodo: "PATCH", guard: "requireUser" },
  { ruta: "compras/paquetes/[id]/estado/route.ts", metodo: "POST", guard: "requirePlanner" },
  { ruta: "compras/paquetes/[id]/mover/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/agrupadores/opciones/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/agrupadores/sin-asignar/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/agrupadores/historial/route.ts", metodo: "GET", guard: "requireUser" },
  { ruta: "compras/agrupadores/importar/route.ts", metodo: "POST", guard: "requireUser" },
  { ruta: "compras/viaje-activo/route.ts", metodo: "PUT", guard: "requireUser" },
];

describe("rutas de los agrupadores: guards de la ficha (§3, R15)", () => {
  it("son exactamente las de 08b-1 (sin `recibir` ni `revertir-recepcion`, que son de 08b-2; sin DELETE: nada se borra, se cancela)", () => {
    const encontradas: string[] = [];
    for (const r of rutasAgrupadores) {
      const limpio = limpiar(readFileSync(r, "utf8"));
      for (const m of METODOS) if (cuerpoDeFuncion(limpio, m) !== null) encontradas.push(`${rel(r).replace("src/app/api/", "")} ${m}`);
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

  it("ninguna ruta usa requireAdmin (admin y planner comparten lo que no es del comprador) y las escrituras del comprador no piden más que sesión", () => {
    for (const r of rutasAgrupadores) expect(sinComentarios(readFileSync(r, "utf8")), rel(r)).not.toMatch(/requireAdmin/);
    expect(ESPERADAS.filter((e) => e.metodo !== "GET" && e.guard === "requirePlanner").map((e) => e.ruta).sort()).toEqual(["compras/paquetes/[id]/estado/route.ts", "compras/viajes/[id]/estado/route.ts"]);
  });

  it("el estado de un embarque decide el permiso con el cuerpo: cancelar exige admin o planner (403 antes de tocar nada)", () => {
    const texto = sinComentarios(readFileSync(path.join(API, "compras/embarques/[id]/estado/route.ts"), "utf8"));
    expect(texto).toMatch(/puedeCambiarEstado\(rol, datos\.accion\)/);
    expect(texto.indexOf("puedeCambiarEstado")).toBeLessThan(texto.indexOf("cambiarEstadoEmbarque("));
  });

  it("los handlers no hablan con la base: ni .from( ni .rpc( ni escrituras; solo llaman al servicio (supabaseAdmin() se pasa a él)", () => {
    for (const r of rutasAgrupadores) {
      const texto = sinComentarios(readFileSync(r, "utf8"));
      expect(texto, rel(r)).not.toMatch(/\.(from|rpc|insert|update|upsert|delete)\s*\(/);
      expect(texto, rel(r)).not.toMatch(/supabaseServer/);
      expect(texto, rel(r)).toMatch(/supabaseAdmin\(\)/);
    }
  });

  it("todo cuerpo pasa por leerCuerpo (tope de 6 MB) y los GET no escriben", () => {
    for (const e of ESPERADAS) {
      const limpio = limpiar(readFileSync(path.join(API, e.ruta), "utf8"));
      const cuerpo = cuerpoDeFuncion(limpio, e.metodo) ?? "";
      if (e.metodo === "GET") expect(cuerpo, e.ruta).not.toMatch(/guardar|cambiarEstado|asignarCompras|moverEntregas|importar|cancelarPaquete/);
      else expect(cuerpo, `${e.ruta} ${e.metodo}`).toMatch(/\bleerCuerpo\s*\(/);
    }
  });
});

describe("datos: solo `.rpc(` para escribir (R16) y solo en consultas.ts", () => {
  const FUNCIONES = ["guardar_viaje", "guardar_embarque", "guardar_paquete", "cambiar_estado_agrupador", "asignar_viaje_compras", "aplicar_movimiento_agrupador", "importar_agrupadores"];

  it("ningún archivo de acceso a datos de src/lib/compras ni de src/app/api/compras escribe una tabla con .insert, .update, .upsert o .delete", () => {
    // Un `.update(` de un hash o un `.delete(` de un Map no son escrituras: se miran los archivos que hablan con la base (`.from(` o `.rpc(`).
    const conBase = [...enDir("src/lib/compras/"), ...enDir("src/app/api/compras/")].filter((f) => /\.(from|rpc)\s*\(/.test(sinComentarios(f.texto)));
    expect(conBase.map((f) => f.ruta).sort()).toEqual(["src/lib/compras/agrupadores/consultas.ts", "src/lib/compras/consultas.ts"]);
    const ofensores = conBase.filter((f) => /\.(insert|update|upsert|delete)\s*\(/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(ofensores).toEqual([]);
  });

  it("las únicas funciones `rpc` de agrupadores son las siete de `0032` y se llaman solo desde consultas.ts", () => {
    const usadas = [...sinComentarios(archivo("src/lib/compras/agrupadores/consultas.ts").texto).matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(usadas.sort()).toEqual([...FUNCIONES].sort());
    const fuera = enDir("src/lib/compras/agrupadores/").filter((f) => f.ruta !== "src/lib/compras/agrupadores/consultas.ts" && /\.(rpc|from)\s*\(/.test(sinComentarios(f.texto)));
    expect(fuera.map((f) => f.ruta)).toEqual([]);
  });

  it("el cliente de la base solo se abre en los handlers (supabaseAdmin) y consultas.ts y servicio.ts importan server-only", () => {
    for (const r of ["src/lib/compras/agrupadores/consultas.ts", "src/lib/compras/agrupadores/servicio.ts"]) expect(archivo(r).texto, r).toMatch(/^import "server-only";/m);
    const conCliente = enDir("src/lib/compras/agrupadores/").filter((f) => /supabaseAdmin|supabaseServer/.test(sinComentarios(f.texto)));
    expect(conCliente.map((f) => f.ruta)).toEqual([]);
  });

  it("los agrupadores no importan el flujo (el flujo y los huecos son globales: el viaje es contexto, nunca presupuesto, decisión 2)", () => {
    for (const f of enDir("src/lib/compras/agrupadores/")) expect(sinComentarios(f.texto), f.ruta).not.toMatch(/from\s+["']@\/lib\/flujo/);
  });

  it("las respuestas de error usan `errorConCodigo` con el texto en castellano de `MENSAJE_ERROR_AGRUPADOR`", () => {
    const servicio = sinComentarios(archivo("src/lib/compras/agrupadores/servicio.ts").texto);
    expect(servicio).toMatch(/MENSAJE_ERROR_AGRUPADOR\[codigo\]/);
    expect(servicio).toMatch(/ESTADO_HTTP_ERROR_AGRUPADOR\[codigo\]/);
  });
});

describe("viaje activo (R22): la cookie solo la escribe PUT /api/compras/viaje-activo; ninguna ruta ni servicio la lee; un solo nombre", () => {
  it("ninguna ruta de la API lee cookies: ni `cookies()`, ni `request.cookies`, ni el nombre de la cookie, salvo escribirla en viaje-activo", () => {
    for (const r of rutasDeApi(path.join(API, "compras"))) {
      const texto = sinComentarios(readFileSync(r, "utf8"));
      if (r.endsWith(path.join("viaje-activo", "route.ts"))) {
        expect(texto).not.toMatch(/cookies\(\)|request\.cookies|\.cookies\.get|\.cookies\.getAll/);
        expect(texto).toMatch(/\.cookies\.set\(COOKIE_VIAJE_ACTIVO/);
      } else {
        expect(texto, rel(r)).not.toMatch(/cookies|COOKIE_VIAJE_ACTIVO|v2_viaje_activo/);
      }
    }
  });

  it("el servicio y las consultas de agrupadores (y los de compras) no tocan cookies", () => {
    for (const r of ["src/lib/compras/agrupadores/servicio.ts", "src/lib/compras/agrupadores/consultas.ts", "src/lib/compras/servicio.ts", "src/lib/compras/consultas.ts"]) {
      expect(sinComentarios(archivo(r).texto), r).not.toMatch(/cookies|COOKIE_VIAJE_ACTIVO|v2_viaje_activo/);
    }
  });

  it("el nombre `v2_viaje_activo` se define en un solo lugar (viaje-activo.ts); lo demás lo importa o lo re-exporta", () => {
    const definen = src.filter((f) => /["']v2_viaje_activo["']/.test(sinComentarios(f.texto)) && !f.ruta.startsWith("tests/"));
    expect(definen.map((f) => f.ruta)).toEqual(["src/lib/compras/agrupadores/viaje-activo.ts"]);
    const vista = sinComentarios(archivo("src/components/compras/agrupadores/vista-agrupadores.ts").texto);
    expect(vista).toMatch(/export \{ COOKIE_VIAJE_ACTIVO \} from "@\/lib\/compras\/agrupadores\/viaje-activo"/);
  });
});

describe("cambios aditivos de M8 (§3.3, §3.9)", () => {
  it("la ruta de importar compras usa el esquema con las columnas VIAJE, EMBARQUE y PAQUETE y engancha los agrupadores; usa requireUser y decide el rol con puedeImportar (la carga inicial es de admin y planner)", () => {
    const texto = sinComentarios(archivo("src/app/api/compras/importar/route.ts").texto);
    expect(texto).toMatch(/importarComprasConAgrupadoresSchema/);
    expect(texto).toMatch(/ganchosAgrupadoresCompras\(/);
    expect(texto).toMatch(/requireUser/);
    expect(texto).not.toMatch(/requirePlanner/);
  });

  it("el servicio de compras no importa el de agrupadores (se engancha con `GanchosAgrupadoresCompras`: sin ciclo y compras sigue independiente)", () => {
    expect(sinComentarios(archivo("src/lib/compras/servicio.ts").texto)).not.toMatch(/from\s+["']\.\/agrupadores\/servicio["']/);
  });

  it("GET /api/compras acepta viaje_id y embarque_id sin leer la cookie", () => {
    const esquema = sinComentarios(archivo("src/lib/compras/esquemas.ts").texto);
    expect(esquema).toMatch(/viaje_id:/);
    expect(esquema).toMatch(/embarque_id:/);
    expect(sinComentarios(archivo("src/app/api/compras/route.ts").texto)).not.toMatch(/cookies/);
  });
});
