import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * M6 paso 2, regla 31 (estático): lo que se rompe por descuido se vigila leyendo
 * el código. Complementa a `periodos.estatico.test.ts` (guards, `supabaseAdmin`,
 * `traducirErrorDb`) y a `api.guards.estatico.test.ts` (guard como primera sentencia).
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
const importsDe = (texto: string) => [...texto.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
const fuente = (ruta: string) => src.find((f) => f.ruta === ruta)?.texto ?? "";

const CONSULTAS = "src/lib/curvas/consultas.ts";
const TIPOS_DB = "src/lib/supabase/database.types.ts";
const BACKEND = src.filter((f) => f.ruta.startsWith("src/lib/curvas/") || f.ruta.startsWith("src/app/api/"));

describe("M6b regla 46: solo consultas.ts nombra la función de venta y las tablas de M6", () => {
  for (const nombre of ["venta_mensual_estacionalidad", "refrescar_y_leer_agregado_estacionalidad", "refrescar_venta_mensual_estacionalidad"]) {
    it(`${nombre} no aparece en ningún archivo de src (salvo los tipos generados)`, () => {
      const usan = src.filter((f) => sinComentarios(f.texto).includes(nombre) && f.ruta !== TIPOS_DB).map((f) => f.ruta);
      expect(usan).toEqual([]);
    });
  }
  for (const nombre of ["venta_estacionalidad_agrupacion", "venta_mensual_tienda"]) {
    it(`${nombre} solo aparece en consultas.ts (y en los tipos generados)`, () => {
      const usan = src.filter((f) => sinComentarios(f.texto).includes(nombre) && f.ruta !== TIPOS_DB && f.ruta !== CONSULTAS).map((f) => f.ruta);
      expect(usan).toEqual([]);
    });
  }
  it("solo consultas.ts lee corridas_estacionalidad y curvas_estacionalidad", () => {
    for (const tabla of ["corridas_estacionalidad", "curvas_estacionalidad"]) {
      const usan = src.filter((f) => new RegExp(`from\\(\\s*["'\`]${tabla}["'\`]`).test(f.texto)).map((f) => f.ruta);
      expect(usan, tabla).toEqual([CONSULTAS]);
    }
  });
  it("la venta se lee con la función jsonb: una llamada rpc, sin paginar ninguna vista", () => {
    const c = fuente(CONSULTAS);
    expect(c).toContain('db.rpc("venta_estacionalidad_agrupacion"');
    expect(c).not.toMatch(/from\(\s*["'`]venta_mensual_estacionalidad/);
  });
  it("lo retirado ya no existe: resolverCorrida, refrescarYLeerAgregado, marcarReferencia, quitarReferencia, corridaDeReferencia, planificarReferencia", () => {
    for (const nombre of ["resolverCorrida", "refrescarYLeerAgregado", "marcarReferencia", "quitarReferencia", "corridaDeReferencia", "planificarReferencia", "leerCorridasLista", "leerMarcasDeCorridas", "leerCorridaReferencia", "leerUltimaCorrida", "motivoRechazoElegir", "elegirCurvaSchema", "marcarReferenciaSchema"]) {
      const usan = BACKEND.filter((f) => new RegExp(`\\b${nombre}\\b`).test(sinComentarios(f.texto))).map((f) => f.ruta);
      expect(usan, nombre).toEqual([]);
    }
  });
  it("ningún archivo de la API ni de lib/curvas lee o escribe `referencia` de las corridas", () => {
    const delasCorridas = ["consultas", "reglas", "estado", "lectura", "trabajo", "esquemas", "tipos-api", "cache-venta", "prerrequisitos", "huellas"].map((n) => `src/lib/curvas/${n}.ts`);
    const usan = BACKEND.filter((f) => (delasCorridas.includes(f.ruta) || f.ruta.startsWith("src/app/api/curvas/")) && /\breferencia\b/.test(sinComentarios(f.texto))).map((f) => f.ruta);
    expect(usan).toEqual([]);
  });
  it("«Ver foto» es la única ruta de corridas que nombran los componentes", () => {
    const usan = src
      .filter((f) => f.ruta.startsWith("src/app/(app)/") && /\/api\/curvas\/corridas(?!\/\$\{[^}]+\}\/agrupaciones\/)/.test(f.texto))
      .map((f) => f.ruta);
    expect(usan).toEqual([]);
  });
});

describe("M6b: pureza de la lógica", () => {
  for (const nombre of ["grafico", "red", "modelo", "obsolescencia", "anios", "candidatas", "backtesting", "liquidacion", "efecto", "estado", "entrada", "agregado", "prerrequisitos", "huellas", "cache-venta", "trabajo"]) {
    it(`${nombre}.ts no importa de @supabase/*, de React ni de next`, () => {
      const f = fuente(`src/lib/curvas/${nombre}.ts`);
      expect(f.length, nombre).toBeGreaterThan(0);
      for (const origen of importsDe(f)) {
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/^(@supabase\/|react|next(\/|$))/);
        expect(origen, `${nombre}.ts importa ${origen}`).not.toMatch(/supabase\/(admin|server)/);
      }
      expect(sinComentarios(f), nombre).not.toContain("supabaseAdmin");
    });
  }
  it("la lógica pura no usa Date.now ni Math.random (el modelo es determinista y no lee el reloj)", () => {
    for (const nombre of ["modelo", "red", "candidatas", "backtesting", "efecto", "anios", "obsolescencia", "atipicos", "prerrequisitos", "huellas", "entrada", "trabajo", "estado", "reglas"]) {
      expect(sinComentarios(fuente(`src/lib/curvas/${nombre}.ts`)), nombre).not.toMatch(/Date\.now|Math\.random|new Date\(/);
    }
  });
  it("VERSION_MODELO entra en la huella (huellas.ts) y se guarda en el resumen de la foto (trabajo.ts)", () => {
    expect(fuente("src/lib/curvas/huellas.ts")).toContain("VERSION_MODELO");
    expect(fuente("src/lib/curvas/trabajo.ts")).toMatch(/version_modelo:\s*VERSION_MODELO/);
    expect(fuente("src/lib/curvas/modelo.ts")).toMatch(/export const VERSION_MODELO\s*=\s*\d+/);
  });
  it("no se usa `any` en M6", () => {
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/curvas/") || x.ruta.startsWith("src/app/api/curvas/") || x.ruta.startsWith("src/app/api/periodos-atipicos/"))) {
      expect(sinComentarios(f.texto).replace(/["'`][^"'`\n]*["'`]/g, ""), f.ruta).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });
});

describe("M6b: rutas", () => {
  const rutas = src.filter((f) => f.ruta.startsWith("src/app/api/curvas/") && f.ruta.endsWith("route.ts"));
  it("existen exactamente las rutas de la ficha con sus métodos", () => {
    const metodos = (t: string) => [...t.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]).sort();
    const esperado: Record<string, string[]> = {
      "src/app/api/curvas/route.ts": ["GET"],
      "src/app/api/curvas/agrupaciones/[id]/calcular/route.ts": ["POST"],
      "src/app/api/curvas/agrupaciones/[id]/route.ts": ["DELETE", "PUT"],
      "src/app/api/curvas/agrupaciones/[id]/versiones/route.ts": ["GET"],
      "src/app/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]/route.ts": ["GET"],
      "src/app/api/curvas/red-comparable/route.ts": ["GET"],
      "src/app/api/curvas/anios-atipicos/route.ts": ["GET"],
      "src/app/api/curvas/vigentes/route.ts": ["GET"],
    };
    expect(rutas.map((r) => r.ruta).sort()).toEqual(Object.keys(esperado).sort());
    for (const r of rutas) expect(metodos(r.texto), r.ruta).toEqual(esperado[r.ruta]);
  });
  it("regla 31b · no existen las rutas retiradas", () => {
    for (const ruta of ["src/app/api/curvas/calcular", "src/app/api/curvas/corridas/route.ts", "src/app/api/curvas/corridas/[id]/route.ts", "src/app/api/curvas/aprobar", "src/app/api/curvas/anios-atipicos/cruda"]) {
      expect(existsSync(path.join(RAIZ, ruta)), ruta).toBe(false);
    }
    for (const f of src) expect(f.texto, f.ruta).not.toMatch(/aprobarSchema\b/);
  });
  it("ninguna ruta de M6 usa otro guard que requirePlanner, y todas empiezan con él", () => {
    for (const r of [...rutas, ...src.filter((f) => f.ruta.startsWith("src/app/api/periodos-atipicos/"))]) {
      expect(r.texto, r.ruta).toContain("requirePlanner");
      expect(r.texto, r.ruta).not.toMatch(/requireUser|requireAdmin/);
    }
  });
  it("calcular no escribe: no importa ninguna función de alta, cambio ni borrado", () => {
    const c = sinComentarios(fuente("src/app/api/curvas/agrupaciones/[id]/calcular/route.ts"));
    expect(c).not.toMatch(/insertar|actualizar|borrar|cambiarEstado|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    expect(c).toContain("requirePlanner");
    expect(c).toContain("leerContextoTrabajo");
  });
  it("PUT usa traducirErrorDb para lo que el usuario puede provocar y no vuelve a llamar a venta_mensual_tienda", () => {
    const c = fuente("src/app/api/curvas/agrupaciones/[id]/route.ts");
    expect(c).toContain("traducirErrorDb");
    expect(c).not.toContain("leerVentaMensualTienda");
  });
  it("calcular y PUT leen lo mismo (leerContextoTrabajo) y esa lectura no usa venta_mensual_tienda ni leerCargasPublicadas fuera de la clave de la caché", () => {
    const l = sinComentarios(fuente("src/lib/curvas/lectura.ts"));
    expect(l).not.toContain("leerVentaMensualTienda");
  });
  it("todos los handlers nuevos responden con ok()/error() (Cache-Control: no-store)", () => {
    for (const r of rutas) expect(r.texto, r.ruta).toMatch(/\b(ok|error|errorConCodigo)\(|return (contexto|evaluadas|calculo|preparado)\.respuesta|return response/);
  });
});

describe("M6 paso 2: `alcance` heredado y contrato con M7", () => {
  it("fuera de consultas.ts, atipicos.ts (temporadasDePeriodo, alcanceEspejo y resolverTemporadas) y esquemas.ts nadie lee `alcance`", () => {
    const permitidos = new Set([CONSULTAS, "src/lib/curvas/atipicos.ts", "src/lib/curvas/esquemas.ts", "src/lib/curvas/tipos-api.ts", "src/lib/curvas/tipos.ts", TIPOS_DB, "src/lib/api/errores-db.ts"]);
    const lectura = /\.alcance\b|\balcance\s*[=!]==|\{\s*alcance\b|\[\s*"alcance"\s*\]/;
    for (const f of src.filter((x) => x.ruta.startsWith("src/lib/curvas/") || x.ruta.startsWith("src/app/api/"))) {
      if (permitidos.has(f.ruta)) continue;
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(lectura);
    }
  });
  it("en atipicos.ts solo temporadasDePeriodo, alcanceEspejo y resolverTemporadas tocan alcance", () => {
    const texto = sinComentarios(fuente("src/lib/curvas/atipicos.ts"));
    // Cada aparición de `.alcance`/`alcance:` debe estar dentro de una de esas tres funciones.
    const tres = ["temporadasDePeriodo", "alcanceEspejo", "resolverTemporadas"].map((n) => {
      const i = texto.indexOf(`export function ${n}`);
      return texto.slice(i, texto.indexOf("\n}\n", i));
    });
    const resto = tres.reduce((t, bloque) => t.replace(bloque, ""), texto);
    expect(resto).not.toMatch(/\.alcance\b/);
  });
  it("tipos-api.ts documenta que M7 lee `temporadas` y no el espejo `alcance`", () => {
    const t = fuente("src/lib/curvas/tipos-api.ts").replace(/\s*\n\s*\*\s*/g, " ");
    expect(t).toMatch(/M7 lee `periodos\[\]\.temporadas`/);
    expect(t).toMatch(/`alcance` es un espejo heredado/);
    expect(t).toMatch(/NO debe usarse/);
  });
});

describe("M6b: migraciones 0016 y 0017", () => {
  const dir = path.join(RAIZ, "supabase", "migrations");
  const m0016 = readdirSync(dir).filter((n) => n.startsWith("0016") || n.startsWith("0017"));
  it("si existen, no contienen drop, delete, truncate ni update fuera de comentarios", () => {
    expect(m0016.length).toBe(2);
    for (const nombre of m0016) {
      const texto = readFileSync(path.join(dir, nombre), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
      // `on delete restrict` de la FK no es un borrado.
      expect(texto.replace(/on delete (restrict|cascade|no action|set null)/gi, ""), nombre).not.toMatch(/\b(drop|delete|truncate|update)\b/i);
    }
  });
});

describe("M6b pantallas (frontend): nada de lo retirado, y los contratos de la vista de trabajo", () => {
  const DIR = "src/app/(app)/planificacion/curvas-estacionalidad/";
  const pantalla = src.filter((f) => f.ruta.startsWith(DIR) || f.ruta.startsWith("src/components/curvas/"));

  it("se retiró lo legado de la 0.9.6: los tipos, la tarjeta Calcular y el formulario global", () => {
    for (const ruta of ["src/lib/curvas/tipos-legado.ts", `${DIR}calcular-card.tsx`, `${DIR}parametros-form.ts`]) expect(existsSync(path.join(RAIZ, ruta)), ruta).toBe(false);
    for (const f of pantalla) expect(f.texto, f.ruta).not.toMatch(/tipos-legado|CalcularCuerpoLegado|CorridaDetalleApi/);
  });

  it("la pantalla habla con /api (nunca Supabase) y no nombra las rutas retiradas", () => {
    for (const f of pantalla) {
      expect(f.texto, f.ruta).not.toMatch(/@\/lib\/supabase|@supabase\//);
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/\/api\/curvas\/calcular|\/api\/curvas\/aprobar|corrida_id=/);
    }
  });

  it("sin textos de la corrida global: ni «Calcular todo», ni referencia, ni «próxima corrida», ni «llega en el paso 2»", () => {
    const textos = [...pantalla, ...src.filter((f) => f.ruta === "src/app/(app)/page.tsx")];
    for (const f of textos) {
      expect(sinComentarios(f.texto), f.ruta).not.toMatch(/Calcular todo|Marcar como referencia|corrida de referencia|próxima corrida|llega en el paso 2|Corrida que se ve|Seleccionar todas|en bloque/i);
    }
  });

  it("el primer cálculo parte de la vigente y el PUT lleva version_vigente, huella_calculo y hasta_periodo explícito", () => {
    expect(fuente(`${DIR}trabajo-vista.ts`)).toMatch(/partir_de_vigente:\s*true/);
    const c = fuente(`${DIR}trabajo-vista.ts`);
    expect(c).toMatch(/version_vigente:\s*t\.vigente\?\.version \?\? null/);
    expect(c).toContain("huella_calculo: t.huella_calculo");
    expect(c).toMatch(/hasta_periodo:\s*hasta/);
    const d = fuente(`${DIR}detalle-agrupacion.tsx`);
    expect(d).toContain("api.put<AprobarCurvaRespuesta>(`/api/curvas/agrupaciones/${agrupacionId}`");
    expect(d).toContain("confirm(texto)");
    expect(d).toContain("api.delete(`/api/curvas/agrupaciones/${agrupacionId}`)");
  });

  it("«Calcular hasta» no se hereda: el hook arranca siempre en el defecto y la apertura no manda hasta_periodo", () => {
    const h = fuente(`${DIR}use-trabajo.ts`);
    expect(h).toMatch(/hasta:\s*apertura \? "" : e\.hasta/);
    expect(h).toMatch(/hasta:\s*""\s*\}/);
    expect(h).toContain("AbortController");
    expect(h).toMatch(/DEMORA_RECALCULO_MS\s*=\s*300/);
  });

  it("la agrupación abierta vive en la URL (?agrupacion=&modelo=) y la página envuelve el panel en Suspense", () => {
    const p = fuente(`${DIR}curvas-panel.tsx`);
    expect(p).toContain('parametros.get("agrupacion")');
    expect(p).toContain('parametros.get("modelo")');
    expect(p).toMatch(/history\.pushState/);
    expect(fuente(`${DIR}page.tsx`)).toMatch(/<Suspense[\s\S]*<CurvasPanel/);
  });

  it("solo hay una versión: 0.9.7 · M6", () => {
    expect(fuente("src/lib/version.ts")).toContain('APP_VERSION = "0.9.7 · M6"');
  });
});
