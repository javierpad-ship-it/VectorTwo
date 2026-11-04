import path from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HAY_BASE, abrir } from "./ayudas";
import { categoriaPg, categoriaTs, esNuloTs, leerTipos, type TiposLeidos } from "./tipos-supabase";

/**
 * Deriva de tipos: `src/lib/supabase/database.types.ts` contra el esquema REAL del Postgres migrado.
 *
 * El archivo se mantuvo a mano durante meses; cada migracion es una oportunidad de que quede atras (o de que sobre algo). Este test
 * lee el archivo con el compilador de TypeScript y lo compara con `information_schema` y `pg_proc`: tablas, vistas, columnas,
 * nulabilidad, obligatoriedad al insertar, columnas generadas, categoria del tipo y funciones (nombre, argumentos con su
 * obligatoriedad y retorno). Si falla, regenera el archivo con el generador oficial (`generate_typescript_types` del MCP de Supabase
 * o `supabase gen types typescript`) y vuelve a correr; o, si falla por una migracion nueva, corrige la migracion o el archivo.
 *
 * Diferencias entre el generador oficial y el archivo del repo que NO son deriva (lista corta, a conciencia; ver la nota de la
 * cabecera de database.types.ts):
 *   * TABLAS_SOLO_EN_PRODUCCION: tablas que existen en el proyecto Vector2 pero ninguna migracion crea (se hicieron a mano).
 *     `prueba_conexion` es la unica conocida (ver 0013).
 *   * Columnas generadas (`compra_embarques.periodo_llegada`): `?: never` en el archivo a mano, `?: string | null` en el generador; el
 *     test solo exige que sean opcionales al insertar.
 *   * `Args: never` frente a `Record<PropertyKey, never>`, `__InternalSupabase` y los `;` no importan: se compara la estructura.
 *   * Los argumentos que la funcion admite nulos (`p_revision: number | null`) frente a `number`: la nulabilidad de los argumentos no se compara.
 */
// VT_TIPOS_RUTA permite probar otro archivo (p. ej. uno recien generado en una carpeta temporal) sin tocar el del repo.
const RUTA_TIPOS = process.env.VT_TIPOS_RUTA ? path.resolve(process.env.VT_TIPOS_RUTA) : path.resolve(__dirname, "../../src/lib/supabase/database.types.ts");
const TABLAS_SOLO_EN_PRODUCCION = new Set(["prueba_conexion"]);

type FilaColumna = { tabla: string; columna: string; es_nulo: string; udt: string; por_defecto: string | null; generada: string; identidad: string; tipo_tabla: string };
type FilaFuncion = { nombre: string; args: { nombre: string; udt: string }[]; con_defecto: number; retorna_conjunto: boolean; retorna: string };

describe.skipIf(!HAY_BASE)("deriva de tipos: database.types.ts vs el esquema real", () => {
  let c: Client;
  let ts: TiposLeidos;
  let columnas: FilaColumna[];
  let funciones: FilaFuncion[];

  beforeAll(async () => {
    c = await abrir();
    ts = leerTipos(RUTA_TIPOS);
    columnas = (
      await c.query<FilaColumna>(
        `select c.table_name as tabla, c.column_name as columna, c.is_nullable as es_nulo, c.udt_name as udt, c.column_default as por_defecto,
                c.is_generated as generada, c.is_identity as identidad, t.table_type as tipo_tabla
           from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public'
          order by c.table_name, c.ordinal_position`
      )
    ).rows;
    // `information_schema` no lista las vistas materializadas; el generador de Supabase las trata como vistas.
    columnas.push(
      ...(
        await c.query<FilaColumna>(
          `select cl.relname as tabla, a.attname as columna, 'YES' as es_nulo, ty.typname as udt, null as por_defecto, 'NEVER' as generada, 'NO' as identidad, 'VIEW' as tipo_tabla
             from pg_class cl
             join pg_namespace n on n.oid = cl.relnamespace
             join pg_attribute a on a.attrelid = cl.oid and a.attnum > 0 and not a.attisdropped
             join pg_type ty on ty.oid = a.atttypid
            where n.nspname = 'public' and cl.relkind = 'm'
            order by cl.relname, a.attnum`
        )
      ).rows
    );
    funciones = (
      await c.query<FilaFuncion>(
        `select p.proname as nombre,
                (select coalesce(json_agg(json_build_object('nombre', coalesce(p.proargnames[x.pos], 'arg_' || x.pos), 'udt', ty.typname) order by x.pos), '[]'::json)
                   from unnest(p.proargtypes::oid[]) with ordinality as x(oid, pos) join pg_type ty on ty.oid = x.oid) as args,
                p.pronargdefaults as con_defecto,
                p.proretset as retorna_conjunto,
                rt.typname as retorna
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           join pg_type rt on rt.oid = p.prorettype
          where n.nspname = 'public' and p.prokind = 'f' and rt.typname <> 'trigger'
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          order by p.proname`
      )
    ).rows;
  });
  afterAll(async () => {
    await c?.end();
  });

  const porRelacion = (tipoTabla: "BASE TABLE" | "VIEW") => {
    const mapa = new Map<string, FilaColumna[]>();
    for (const col of columnas.filter((x) => x.tipo_tabla === tipoTabla)) {
      const lista = mapa.get(col.tabla) ?? [];
      lista.push(col);
      mapa.set(col.tabla, lista);
    }
    return mapa;
  };

  const diferencia = (a: Iterable<string>, b: Iterable<string>): string[] => {
    const sb = new Set(b);
    return [...a].filter((x) => !sb.has(x)).sort();
  };

  it("el lector ve el archivo entero (hay decenas de tablas y de funciones)", () => {
    expect(ts.tablas.size).toBeGreaterThan(50);
    expect(ts.funciones.size).toBeGreaterThan(30);
    expect(ts.vistas.size).toBeGreaterThanOrEqual(4);
  });

  it("las TABLAS del archivo son exactamente las de la base (ni faltan ni sobran)", () => {
    const enBase = [...porRelacion("BASE TABLE").keys()];
    const enTipos = [...ts.tablas.keys()].filter((t) => !TABLAS_SOLO_EN_PRODUCCION.has(t));
    expect({ faltanEnTipos: diferencia(enBase, enTipos), sobranEnTipos: diferencia(enTipos, enBase) }).toEqual({ faltanEnTipos: [], sobranEnTipos: [] });
  });

  it("las VISTAS del archivo son exactamente las de la base, con las mismas columnas", () => {
    const vistas = porRelacion("VIEW");
    expect({ faltanEnTipos: diferencia(vistas.keys(), ts.vistas.keys()), sobranEnTipos: diferencia(ts.vistas.keys(), vistas.keys()) }).toEqual({ faltanEnTipos: [], sobranEnTipos: [] });
    const problemas: string[] = [];
    for (const [nombre, cols] of vistas) {
      const t = ts.vistas.get(nombre);
      if (!t) continue;
      const falta = diferencia(cols.map((x) => x.columna), t.Row.keys());
      const sobra = diferencia(t.Row.keys(), cols.map((x) => x.columna));
      if (falta.length) problemas.push(`vista ${nombre}: faltan columnas ${falta.join(", ")}`);
      if (sobra.length) problemas.push(`vista ${nombre}: sobran columnas ${sobra.join(", ")}`);
    }
    expect(problemas).toEqual([]);
  });

  it("las COLUMNAS de cada tabla: mismo conjunto, misma nulabilidad y misma categoria de tipo (string, number, boolean, Json, arreglos)", () => {
    const problemas: string[] = [];
    for (const [nombre, cols] of porRelacion("BASE TABLE")) {
      const t = ts.tablas.get(nombre);
      if (!t) continue;
      const falta = diferencia(cols.map((x) => x.columna), t.Row.keys());
      const sobra = diferencia(t.Row.keys(), cols.map((x) => x.columna));
      if (falta.length) problemas.push(`${nombre}: faltan en Row ${falta.join(", ")}`);
      if (sobra.length) problemas.push(`${nombre}: sobran en Row ${sobra.join(", ")}`);
      for (const col of cols) {
        const m = t.Row.get(col.columna);
        if (!m) continue;
        const nuloBase = col.es_nulo === "YES";
        if (esNuloTs(m.tipo) !== nuloBase) problemas.push(`${nombre}.${col.columna}: nulabilidad distinta (base ${nuloBase ? "null" : "not null"}, tipos ${m.tipo})`);
        const cat = categoriaPg(col.udt);
        if (!cat.startsWith("?") && categoriaTs(m.tipo) !== cat) problemas.push(`${nombre}.${col.columna}: tipo distinto (base ${col.udt} -> ${cat}, tipos ${m.tipo})`);
      }
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("INSERT y UPDATE: obligatorias solo las not null sin default; las generadas son `never`; en Update todo es opcional", () => {
    const problemas: string[] = [];
    for (const [nombre, cols] of porRelacion("BASE TABLE")) {
      const t = ts.tablas.get(nombre);
      if (!t) continue;
      const faltaIns = diferencia(cols.map((x) => x.columna), t.Insert.keys());
      const sobraIns = diferencia(t.Insert.keys(), cols.map((x) => x.columna));
      const faltaUpd = diferencia(cols.map((x) => x.columna), t.Update.keys());
      const sobraUpd = diferencia(t.Update.keys(), cols.map((x) => x.columna));
      if (faltaIns.length || sobraIns.length) problemas.push(`${nombre}: Insert difiere (faltan ${faltaIns.join(", ") || "-"}; sobran ${sobraIns.join(", ") || "-"})`);
      if (faltaUpd.length || sobraUpd.length) problemas.push(`${nombre}: Update difiere (faltan ${faltaUpd.join(", ") || "-"}; sobran ${sobraUpd.join(", ") || "-"})`);
      for (const col of cols) {
        const generada = col.generada === "ALWAYS" || col.identidad === "YES";
        const ins = t.Insert.get(col.columna);
        const upd = t.Update.get(col.columna);
        if (ins) {
          if (col.generada === "ALWAYS") {
            // Nunca obligatoria al insertar: el archivo a mano la marca `?: never`; el generador oficial, `?: string | null`.
            if (!ins.opcional) problemas.push(`${nombre}.${col.columna}: columna generada, Insert no puede ser obligatorio (es ${ins.tipo})`);
          } else {
            const obligatoria = col.es_nulo === "NO" && col.por_defecto === null && !generada;
            if (ins.opcional === obligatoria) problemas.push(`${nombre}.${col.columna}: Insert ${ins.opcional ? "opcional" : "obligatorio"} pero la base lo ${obligatoria ? "exige" : "permite omitir"}`);
          }
        }
        if (upd && !upd.opcional) problemas.push(`${nombre}.${col.columna}: Update deberia ser opcional`);
      }
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("las FUNCIONES del archivo son exactamente las de la base (sin triggers): ni faltan ni sobran", () => {
    const enBase = [...new Set(funciones.map((f) => f.nombre))];
    const enTipos = [...ts.funciones.keys()];
    expect({ faltanEnTipos: diferencia(enBase, enTipos), sobranEnTipos: diferencia(enTipos, enBase) }).toEqual({ faltanEnTipos: [], sobranEnTipos: [] });
  });

  it("los ARGUMENTOS de cada funcion: mismos nombres, misma categoria de tipo, opcionales los que tienen valor por defecto; y el tipo de retorno", () => {
    const problemas: string[] = [];
    for (const f of funciones) {
      const candidatas = ts.funciones.get(f.nombre) ?? [];
      if (candidatas.length === 0) continue;
      const nombresBase = f.args.map((a) => a.nombre);
      // Una sobrecarga se reconoce por el conjunto de nombres de argumentos.
      const t = candidatas.find((x) => diferencia(nombresBase, x.args.keys()).length === 0 && diferencia(x.args.keys(), nombresBase).length === 0);
      if (!t) {
        problemas.push(`${f.nombre}(${nombresBase.join(", ")}): ninguna firma del archivo tiene esos argumentos (el archivo tiene ${candidatas.map((x) => `(${[...x.args.keys()].join(", ")})`).join(" | ") || "ninguna"})`);
        continue;
      }
      f.args.forEach((a, i) => {
        const m = t.args.get(a.nombre);
        if (!m) return;
        const conDefecto = i >= f.args.length - f.con_defecto;
        if (m.opcional !== conDefecto) problemas.push(`${f.nombre}.${a.nombre}: ${m.opcional ? "opcional" : "obligatorio"} en el archivo, pero la base ${conDefecto ? "le da valor por defecto" : "lo exige"}`);
        const cat = categoriaPg(a.udt);
        if (!cat.startsWith("?") && categoriaTs(m.tipo) !== cat) problemas.push(`${f.nombre}.${a.nombre}: tipo distinto (base ${a.udt} -> ${cat}, archivo ${m.tipo})`);
      });
      const retorno = t.retorno.trim();
      if (f.retorna_conjunto) {
        if (!/\[\]$/.test(retorno)) problemas.push(`${f.nombre}: devuelve un conjunto de filas pero el archivo dice ${retorno}`);
      } else if (f.retorna === "void") {
        if (retorno !== "undefined") problemas.push(`${f.nombre}: devuelve void, el archivo dice ${retorno}`);
      } else {
        const cat = categoriaPg(f.retorna);
        if (!cat.startsWith("?") && categoriaTs(retorno) !== cat) problemas.push(`${f.nombre}: retorno distinto (base ${f.retorna} -> ${cat}, archivo ${retorno})`);
      }
    }
    expect(problemas, problemas.join("\n")).toEqual([]);
  });

  it("no hay enums en la base ni en el archivo (el proyecto usa text con check)", async () => {
    const enBase = await c.query("select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'");
    expect(enBase.rows).toEqual([]);
    expect([...ts.enums.keys()]).toEqual([]);
  });
});
