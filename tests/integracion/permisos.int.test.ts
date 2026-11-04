import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAY_BASE, abrirConTransaccion, actor, cargaImportar, cerrarConRollback, comoRol, escalar, filas, rpc, sembrarBase, type Base } from "./ayudas";

/**
 * Permisos contra Postgres real. La base local simula los privilegios por defecto de Supabase (scripts/validar-migraciones-local.sh
 * los fija ANTES de las migraciones): todo objeto nuevo de `public` nace con permisos para anon y authenticated, y cada migracion
 * tiene que revocarlos. Un `revoke` olvidado deja una puerta abierta a la clave anonima; aqui se comprueba el catalogo completo, no
 * una lista a mano de tablas y funciones.
 *
 * Excepciones conocidas: ninguna. Si una migracion nueva necesita una funcion publica, la prueba falla hasta que se decida a conciencia.
 */
describe.skipIf(!HAY_BASE)("permisos (Postgres real)", () => {
  let c: Client;
  let b: Base;

  beforeEach(async () => {
    c = await abrirConTransaccion();
    b = await sembrarBase(c, 61);
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  const FUNCIONES_PROPIAS = `
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as firma, p.prosecdef, p.proconfig, p.prokind, p.prorettype::regtype::text as retorna
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

  it("hay funciones propias que revisar (el catalogo no esta vacio)", async () => {
    const n = await filas(c, `select count(*) as n from (${FUNCIONES_PROPIAS}) f`);
    expect(Number(n[0].n)).toBeGreaterThan(40);
  });

  it("ninguna funcion de public es ejecutable por anon, authenticated ni PUBLIC; service_role ejecuta todas", async () => {
    const f = await filas<{ firma: string; proname: string; anon: boolean; auth: boolean; publico: boolean; sr: boolean }>(
      c,
      `select f.proname, f.firma,
              has_function_privilege('anon', f.oid, 'execute') as anon,
              has_function_privilege('authenticated', f.oid, 'execute') as auth,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), true) as publico,
              has_function_privilege('service_role', f.oid, 'execute') as sr
         from (${FUNCIONES_PROPIAS}) f join pg_proc p on p.oid = f.oid
        order by f.proname`
    );
    const abiertas = f.filter((x) => x.anon || x.auth || x.publico).map((x) => `${x.proname}(${x.firma})`);
    expect(abiertas, `Funciones ejecutables por anon/authenticated/PUBLIC:\n${abiertas.join("\n")}`).toEqual([]);
    const sinService = f.filter((x) => !x.sr).map((x) => `${x.proname}(${x.firma})`);
    expect(sinService, `Funciones que service_role no puede ejecutar:\n${sinService.join("\n")}`).toEqual([]);
  });

  it("todas las funciones de public son security invoker y fijan search_path vacio (nada de security definer ni rutas de busqueda abiertas)", async () => {
    const f = await filas<{ proname: string; firma: string; prosecdef: boolean; proconfig: string[] | null }>(c, `select proname, firma, prosecdef, proconfig from (${FUNCIONES_PROPIAS}) f`);
    const definer = f.filter((x) => x.prosecdef).map((x) => `${x.proname}(${x.firma})`);
    expect(definer, `Funciones security definer:\n${definer.join("\n")}`).toEqual([]);
    const sinRuta = f
      .filter((x) => !(x.proconfig ?? []).some((cfg) => cfg === 'search_path=""' || cfg === "search_path="))
      .map((x) => `${x.proname}(${x.firma})`);
    expect(sinRuta, `Funciones sin search_path vacio:\n${sinRuta.join("\n")}`).toEqual([]);
  });

  it("anon y authenticated no tienen NINGUN privilegio sobre tablas, vistas ni secuencias de public (ni sobre el esquema, para crear)", async () => {
    const t = await filas<{ relname: string; relkind: string }>(
      c,
      `select c.relname, c.relkind
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
            or has_table_privilege('authenticated', c.oid, 'select, insert, update, delete, truncate, references, trigger'))
        order by 1`
    );
    expect(t.map((x) => `${x.relname} (${x.relkind})`), "Relaciones con privilegios para anon/authenticated").toEqual([]);
    const s = await filas<{ relname: string }>(
      c,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S'
          and (has_sequence_privilege('anon', c.oid, 'usage, select, update') or has_sequence_privilege('authenticated', c.oid, 'usage, select, update'))`
    );
    expect(s.map((x) => x.relname), "Secuencias con privilegios para anon/authenticated").toEqual([]);
    expect(await escalar<boolean>(c, "select has_schema_privilege('anon', 'public', 'create') or has_schema_privilege('authenticated', 'public', 'create')")).toBe(false);
  });

  it("los privilegios por defecto de public (los de los objetos FUTUROS) tampoco abren nada a anon ni authenticated", async () => {
    const r = await filas<{ rol: string; tipo: string }>(
      c,
      `select pg_get_userbyid(d.defaclrole) as rol, d.defaclobjtype as tipo
         from pg_default_acl d, aclexplode(d.defaclacl) a
        where d.defaclnamespace = 'public'::regnamespace
          and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))`
    );
    expect(r, "Privilegios por defecto que abren objetos nuevos a anon/authenticated").toEqual([]);
  });

  it("toda tabla de public tiene RLS activo y no hay ninguna politica (solo entra el backend con service_role); las vistas son security_invoker", async () => {
    const sinRls = await filas<{ relname: string }>(
      c,
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1"
    );
    expect(sinRls.map((x) => x.relname), "Tablas sin RLS").toEqual([]);
    expect(Number(await escalar<string>(c, "select count(*) from pg_policies where schemaname = 'public'"))).toBe(0);
    const vistas = await filas<{ relname: string; opciones: string[] | null }>(
      c,
      "select c.relname, c.reloptions as opciones from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' order by 1"
    );
    expect(vistas.length).toBeGreaterThan(0);
    const inseguras = vistas.filter((v) => !(v.opciones ?? []).includes("security_invoker=true")).map((v) => v.relname);
    expect(inseguras, "Vistas sin security_invoker=true (saltarian el RLS)").toEqual([]);
  });

  it("en la practica: anon y authenticated reciben 42501 al leer, escribir o llamar una funcion; service_role si puede (y lee con RLS gracias a BYPASSRLS)", async () => {
    await c.query("insert into public.compras (proveedor_id, origen, estado, fecha_compra) values ($1, 'comprador', 'borrador', date '2026-09-10')", [b.proveedor]);
    for (const rol of ["anon", "authenticated"]) {
      const lee = await comoRol(c, rol, "select count(*) from public.compras");
      expect(lee.error?.codigo, `${rol} leyendo compras`).toBe("42501");
      const escribe = await comoRol(c, rol, "insert into public.compra_eventos (compra_id, accion, resumen) select id, 'x', 'x' from public.compras limit 1");
      expect(escribe.error?.codigo, `${rol} escribiendo en compra_eventos`).toBe("42501");
      const llama = await comoRol(c, rol, "select public.importar_compra('{}'::jsonb, '{}'::jsonb)");
      expect(llama.error?.codigo, `${rol} llamando importar_compra`).toBe("42501");
      const vista = await comoRol(c, rol, "select count(*) from public.venta_stock_vigente");
      expect(vista.error?.codigo, `${rol} leyendo la vista`).toBe("42501");
    }
    const sr = await comoRol(c, "service_role", "select count(*) as n from public.compras");
    expect(sr.ok).toBe(true);
    expect(Number(sr.filas[0].n)).toBeGreaterThan(0);
    const llamada = await rpc(c, "importar_compra", [cargaImportar(b, "R-PERM", "PERM-1"), actor(b.admin, "Admin")], ["jsonb", "jsonb"]);
    expect(llamada.data?.ok).toBe(true);
  });

  it("las 8 tablas de solo insercion: service_role solo tiene select e insert (0035); el resto de las tablas conserva el patron de la 0013", async (ctx) => {
    const hay0035 = await escalar<boolean>(c, "select to_regclass('public.migraciones_aplicadas') is not null");
    if (!hay0035) ctx.skip();
    const SOLO_INSERCION = ["compra_eventos", "compra_agrupador_eventos", "ia_entradas", "ia_llamadas", "ia_propuestas_gm", "ia_propuestas_filas", "proyeccion_lotes", "proyeccion_lote_filas", "migraciones_aplicadas"];
    const privilegios = await filas<{ tabla: string; privilegios: string }>(
      c,
      `select g.table_name as tabla, string_agg(g.privilege_type, ',' order by g.privilege_type) as privilegios
         from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.grantee = 'service_role' and g.table_name = any($1::text[])
        group by g.table_name`,
      [SOLO_INSERCION]
    );
    expect(Object.fromEntries(privilegios.map((x) => [x.tabla, x.privilegios])), "privilegios de service_role en las tablas de solo insercion").toEqual(
      Object.fromEntries(SOLO_INSERCION.map((t) => [t, "INSERT,SELECT"]))
    );
    // Las tablas de IA que SI se actualizan mientras la corrida esta en curso conservan update, pero ya no truncate.
    const truncate = await filas<{ tabla: string }>(
      c,
      "select g.table_name as tabla from information_schema.role_table_grants g where g.table_schema = 'public' and g.grantee = 'service_role' and g.privilege_type = 'TRUNCATE' and g.table_name in ('ia_evaluaciones', 'ia_corridas', 'ia_corrida_gms')"
    );
    expect(truncate).toEqual([]);
  });

  it("service_role tiene BYPASSRLS (como en Supabase) y anon/authenticated no", async () => {
    const r = await filas<{ rolname: string; rolbypassrls: boolean }>(c, "select rolname, rolbypassrls from pg_roles where rolname in ('anon', 'authenticated', 'service_role') order by 1");
    expect(Object.fromEntries(r.map((x) => [x.rolname, x.rolbypassrls]))).toEqual({ anon: false, authenticated: false, service_role: true });
  });
});
