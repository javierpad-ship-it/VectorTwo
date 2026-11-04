import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARALELO } from "@/lib/proyeccion/tipos-api";

const RAIZ = path.resolve(__dirname, "..");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = archivos(path.join(RAIZ, "src")).map((p) => ({ ruta: path.relative(RAIZ, p), texto: sinComentarios(readFileSync(p, "utf8")) }));

/** Las lecturas pesadas con plazo (informe de rendimiento, §4). */
const LECTURAS = new Set([
  "venta_proyeccion",
  "venta_tienda_nodos",
  "venta_genero_mundo",
  "venta_mensual_tienda",
  "venta_estacionalidad_agrupacion",
  "venta_composicion_agrupacion",
  "venta_lineas_ia",
  "venta_marca_gml",
  "venta_marca_gml_resumen",
  "unidades_mensuales",
  "stock_flujo",
]);

describe("plazo de 7,5 s: solo en lecturas", () => {
  it("cada `.abortSignal(` cuelga de un `.rpc(` de la lista de lecturas, y las 11 la llevan", () => {
    const usados = new Set<string>();
    let total = 0;
    for (const f of src) {
      total += (f.texto.match(/\.abortSignal\(/g) ?? []).length;
      for (const m of f.texto.matchAll(/\.rpc\(\s*"([a-z_]+)"[^;]*?\.abortSignal\(/g)) {
        expect(LECTURAS.has(m[1]), `${f.ruta}: ${m[1]}`).toBe(true);
        usados.add(m[1]);
      }
    }
    expect(total).toBe(11); // una por función
    expect([...usados].sort()).toEqual([...LECTURAS].sort());
  });
  it("ninguna escritura lleva plazo ni `AbortSignal.timeout` (solo la IA lo usa, fuera de la base)", () => {
    for (const f of src) {
      if (!/\.(insert|update|upsert|delete)\(/.test(f.texto) && !/\.rpc\(\s*"(registrar_|aplicar_|guardar_|importar_|publicar_|cancelar_|quitar_|cambiar_|asignar_)/.test(f.texto)) continue;
      for (const m of f.texto.matchAll(/\.rpc\(\s*"(registrar_|aplicar_|guardar_|importar_|publicar_|cancelar_|quitar_|cambiar_|asignar_)[a-z_]*"[^;]*?;/g)) {
        expect(m[0], f.ruta).not.toMatch(/abortSignal|AbortSignal/);
      }
    }
    const conTimeout = src.filter((f) => /AbortSignal\.timeout\(/.test(f.texto)).map((f) => f.ruta);
    expect(conTimeout.sort()).toEqual(["src/lib/api/plazos.ts", "src/lib/ia/proveedor-openai.ts"]);
  });
});

describe("tandas de venta_proyeccion", () => {
  it("PARALELO es 2 (con 3 la media por llamada subía a 4,4 s) y el cálculo y la IA lo usan", () => {
    expect(PARALELO).toBe(2);
    expect(src.find((f) => f.ruta === "src/lib/proyeccion/servicio.ts")?.texto).toMatch(/enParalelo\(tandas, PARALELO,/);
    expect(src.find((f) => f.ruta === "src/lib/ia/servicio-evaluacion.ts")?.texto).toMatch(/enTandas\(tandas, PARALELO\)/);
  });
});
