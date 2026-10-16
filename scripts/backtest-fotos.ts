/**
 * Backtest OFFLINE de las fotos de aprobación (docs/modulos/06c-curvas-composicion-y-curva-usuario.md,
 * "Backtest offline reproducible", regla 87). Condición de aceptación de la 06c: el sistema es HONESTO
 * (la `A` recalculada coincide con la de la foto, `F` y `T` no se recomiendan sin ganar a `A` por más del
 * margen y `ρ` y `λ` de cada pliegue no ven el año de prueba). No exige que `F` gane.
 *
 * SOLO LECTURA. Dos orígenes de fotos:
 *   - la base (`vector-two`, `service_role`): lee cada curva vigente y la foto con la que se aprobó;
 *   - un volcado local sintético: `--volcado archivo.json` con un arreglo de
 *     `{ id, resultado: ResultadoCorrida, parametros: ParametrosCurvas }` (nada real de Lukers en el repo).
 *
 * NO escribe nombres ni cifras por agrupación: imprime una tabla con ids ofuscados y la tabla agregada; con
 * `--salida ruta.json` deja el resultado (también ofuscado) en el archivo indicado (usa el scratchpad, no el repo).
 *
 * Cómo se corre (fuera de CI; no hace falta compilar nada):
 *   JITI_ALIAS='{"@/":"./src/"}' npx jiti scripts/backtest-fotos.ts [--volcado fotos.json] [--salida resultado.json]
 *   Con la base: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno o en `.env.local`.
 *
 * Sale con código 1 si falla (a), (b) o (c).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { backtestDeFoto, resumirBacktest, type FotoParaBacktest, type ResultadoBacktestFoto } from "../src/lib/curvas/backtest-foto";
import { PARAMETROS_POR_DEFECTO, type ParametrosCurvas, type ResultadoCorrida } from "../src/lib/curvas/tipos-api";

type FotoLeida = { id: string; resultado: ResultadoCorrida; parametros: Partial<ParametrosCurvas> | null; agrupacion_id: string | null };

function argumento(nombre: string): string | null {
  const i = process.argv.indexOf(nombre);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

/** Variables de `.env.local` si no están en el entorno (sin dependencias: líneas `CLAVE=valor`). */
function cargarEnv(): void {
  const archivo = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function fotosDeLaBase(): Promise<FotoLeida[]> {
  cargarEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (entorno o .env.local), o usa --volcado.");
  const db = createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });

  const vigentes = await db.from("curvas_estacionalidad").select("id, agrupacion_estacionalidad_id, corrida_id").eq("estado", "vigente").order("agrupacion_estacionalidad_id");
  if (vigentes.error) throw new Error(`Leer las curvas vigentes: ${vigentes.error.message}`);
  const salida: FotoLeida[] = [];
  for (const v of vigentes.data ?? []) {
    const foto = await db.from("corridas_estacionalidad").select("id, resultado, parametros").eq("id", v.corrida_id).maybeSingle();
    if (foto.error) throw new Error(`Leer una foto: ${foto.error.message}`);
    if (!foto.data) continue;
    salida.push({
      id: v.agrupacion_estacionalidad_id,
      agrupacion_id: v.agrupacion_estacionalidad_id,
      resultado: foto.data.resultado as unknown as ResultadoCorrida,
      parametros: foto.data.parametros as unknown as Partial<ParametrosCurvas> | null,
    });
  }
  return salida;
}

function fotosDeVolcado(ruta: string): FotoLeida[] {
  const crudo = JSON.parse(readFileSync(ruta, "utf8")) as { id: string; agrupacion_id?: string; resultado: ResultadoCorrida; parametros?: Partial<ParametrosCurvas> | null }[];
  return crudo.map((f) => ({ id: f.id, agrupacion_id: f.agrupacion_id ?? null, resultado: f.resultado, parametros: f.parametros ?? null }));
}

/** De una foto leída a lo que recalcula el backtest; `null` si la foto no trae lo necesario (curva sin foto o de la 0.9.6). */
function paraBacktest(f: FotoLeida): FotoParaBacktest | null {
  const agrupacion = f.agrupacion_id ? f.resultado.agrupaciones.find((a) => a.agrupacion_id === f.agrupacion_id) : f.resultado.agrupaciones[0];
  if (!agrupacion) return null;
  const temporada = f.resultado.temporadas.find((t) => t.temporada === agrupacion.temporada) ?? null;
  return {
    agrupacion,
    temporada,
    parametros: {
      margen_ruido: typeof f.parametros?.margen_ruido === "number" ? f.parametros.margen_ruido : PARAMETROS_POR_DEFECTO.margen_ruido,
      recencia_f: typeof f.parametros?.recencia_f === "number" ? f.parametros.recencia_f : PARAMETROS_POR_DEFECTO.recencia_f,
    },
  };
}

const ofuscar = (id: string) => `G-${createHash("md5").update(id).digest("hex").slice(0, 6)}`;
const n1 = (x: number | null) => (x === null ? "—" : x.toFixed(1));
const si = (x: boolean | null) => (x === null ? "—" : x ? "sí" : "NO");

async function main() {
  const volcado = argumento("--volcado");
  const fotos = volcado ? fotosDeVolcado(volcado) : await fotosDeLaBase();
  console.log(`Fotos leídas: ${fotos.length}${volcado ? ` (volcado ${path.basename(volcado)})` : " (base)"}`);

  const filas: { id: string; r: ResultadoBacktestFoto }[] = [];
  let sinDatos = 0;
  for (const f of fotos) {
    const p = paraBacktest(f);
    if (!p) {
      sinDatos += 1;
      continue;
    }
    filas.push({ id: ofuscar(f.id), r: backtestDeFoto(p) });
  }
  if (sinDatos > 0) console.log(`Fotos sin la agrupación o sin datos para recalcular: ${sinDatos}`);

  console.log("\nid       años  ruido   A(eat)  F(eat)  T(eat)  margen  reco  a=foto  sin fuga  viola margen");
  for (const { id, r } of filas) {
    console.log(
      [
        id.padEnd(8),
        String(r.anios_ajuste.length).padStart(4),
        n1(r.ruido_normal).padStart(6),
        n1(r.eat_a).padStart(7),
        n1(r.eat_f).padStart(7),
        n1(r.eat_t).padStart(7),
        n1(r.margen).padStart(7),
        String(r.recomendada ?? "—").padStart(5),
        si(r.a_coincide === null || r.eat_a_coincide === null ? null : r.a_coincide && r.eat_a_coincide).padStart(7),
        si(r.sin_fuga).padStart(9),
        si(r.viola_margen).padStart(13),
      ].join(" ")
    );
  }

  const resumen = resumirBacktest(filas.map((f) => f.r));
  console.log("\nTabla agregada (para el CHANGELOG, sin nombres):");
  console.log(`  agrupaciones: ${resumen.fotos}`);
  console.log(`  recomendada A: ${resumen.gana_a} · F: ${resumen.gana_f} · T: ${resumen.gana_t} · otra: ${resumen.otra} · ninguna: ${resumen.sin_recomendacion}`);
  console.log(`  F con menor EAT que A: ${resumen.f_menor_que_a} · T con menor EAT que A: ${resumen.t_menor_que_a}`);
  console.log(`  ruido entre años normales: mínimo ${n1(resumen.ruido_minimo)} · máximo ${n1(resumen.ruido_maximo)} pp`);
  console.log(`  (a) A recalculada distinta de la de la foto: ${resumen.a_no_coincide}`);
  console.log(`  (b) F o T recomendada sin ganar por más del margen: ${resumen.violan_margen}`);
  console.log(`  (c) pliegues con fuga (ρ, λ o curva de F cambian al perturbar el año de prueba): ${resumen.con_fuga}`);
  console.log(`  Resultado: ${resumen.cumple ? "CUMPLE (a), (b) y (c)" : "NO CUMPLE"}`);

  const salida = argumento("--salida");
  if (salida) {
    writeFileSync(salida, JSON.stringify({ resumen, filas: filas.map((f) => ({ id: f.id, ...f.r })) }, null, 2));
    console.log(`\nResultado (ids ofuscados) guardado en ${salida}`);
  }
  if (!resumen.cumple) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
