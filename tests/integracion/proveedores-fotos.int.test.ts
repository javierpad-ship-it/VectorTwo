import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAY_BASE,
  abrir,
  abrirConTransaccion,
  cerrarConRollback,
  comoRol,
  contar,
  escalar,
  esperarBloqueo,
  filas,
  pendiente,
  pidDe,
  revisionCompra,
  rpc,
  rpcEnTransaccion,
  sembrarBase,
  sembrarCompra,
  uid,
  type Json,
  type ResultadoRpc,
} from "./ayudas";

/**
 * 08c E1 (migracion 0039) contra Postgres real: permisos de las tablas y funciones nuevas, inmutabilidad de `proveedor_eventos` y,
 * sobre todo, la CONCURRENCIA que un humo (una sola sesion) no puede probar:
 *
 *   * maximo 3 fotos activas por linea con 2 conexiones (una espera el candado de la linea de la otra) y con 5 a la vez;
 *   * el orden de candados compra -> linea de las funciones de fotos y de la ficha de la linea: una funcion que tiene la compra
 *     `FOR UPDATE` y quiere la linea NO se interbloquea con ellas (la ficha 08c decia que bastaba el candado de la linea; la FK a
 *     `compras` toma `FOR KEY SHARE` y cerraba un ciclo);
 *   * `editar_ficha_linea`: dos pestañas con el mismo `antes` (la segunda recibe linea_cambio) y sin 409 falso cuando la revision de la
 *     compra cambia entre medias (R7b);
 *   * `guardar_proveedor`: dos ediciones con la misma revision (proveedor_cambio), dos altas del mismo nombre (nombre_repetido por la
 *     ruta de unique_violation) y dos cargas con la misma clave_origen (ya_cargado).
 *
 * Las que CONFIRMAN datos (concurrencia) viven en la base clonada que borra `global-setup.ts`; cada prueba usa su propio `ns`.
 */
const actorRol = (perfil: string, nombre: string, rol?: string): Json => (rol ? { perfil_id: perfil, nombre, rol } : { perfil_id: perfil, nombre });
const T_FOTO = ["uuid", "uuid", "jsonb", "jsonb"];
const T_QUITAR = ["uuid", "uuid", "uuid", "jsonb"];
const T_FICHA = ["uuid", "uuid", "jsonb", "text", "text", "jsonb"];
const T_PROV = ["uuid", "integer", "jsonb", "jsonb", "jsonb"];
const foto = (id: string, extra: Record<string, Json> = {}): Json => ({ id, ancho: 800, alto: 600, bytes: 150000, bytes_miniatura: 20000, ...extra });

describe.skipIf(!HAY_BASE)("0039 · permisos e inmutabilidad (Postgres real)", () => {
  let c: Client;
  beforeEach(async () => {
    c = await abrirConTransaccion();
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  const NUEVAS = ["proveedor_contactos", "proveedor_eventos", "compra_linea_fotos"];
  const FUNCIONES = [
    "proveedor_foto",
    "guardar_proveedor",
    "cambiar_activo_proveedor",
    "eliminar_proveedor",
    "agregar_foto_linea",
    "quitar_foto_linea",
    "traer_fotos_linea",
    "editar_ficha_linea",
    "fotos_huerfanas",
  ];

  it("las 3 tablas nuevas tienen RLS y los privilegios exactos de service_role (eventos: select e insert; fotos: sin delete ni truncate; contactos: sin truncate); anon y authenticated, ninguno", async () => {
    const rls = await filas<{ relname: string; relrowsecurity: boolean }>(c, "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1::text[]) order by 1", [NUEVAS]);
    expect(rls).toEqual(NUEVAS.slice().sort().map((relname) => ({ relname, relrowsecurity: true })));
    const sr = await filas<{ tabla: string; privilegios: string }>(
      c,
      `select g.table_name as tabla, string_agg(g.privilege_type, ',' order by g.privilege_type) as privilegios
         from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.grantee = 'service_role' and g.table_name = any($1::text[]) group by g.table_name`,
      [NUEVAS]
    );
    expect(Object.fromEntries(sr.map((x) => [x.tabla, x.privilegios]))).toEqual({
      proveedor_contactos: "DELETE,INSERT,SELECT,UPDATE",
      proveedor_eventos: "INSERT,SELECT",
      compra_linea_fotos: "INSERT,SELECT,UPDATE",
    });
    const otros = await filas(
      c,
      `select g.table_name, g.grantee from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = any($1::text[]) and g.grantee in ('anon', 'authenticated', 'PUBLIC')`,
      [NUEVAS]
    );
    expect(otros).toEqual([]);
  });

  it("las 9 funciones nuevas: security invoker, search_path vacio, solo service_role las ejecuta y ningun cuerpo lleva comentarios --", async () => {
    const f = await filas<{ proname: string; prosecdef: boolean; proconfig: string[] | null; anon: boolean; auth: boolean; sr: boolean; guiones: boolean }>(
      c,
      `select p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as sr, p.prosrc like '%--%' as guiones
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[]) order by p.proname`,
      [FUNCIONES]
    );
    expect(f.map((x) => x.proname)).toEqual(FUNCIONES.slice().sort());
    for (const x of f) {
      expect(x.prosecdef, `${x.proname} security definer`).toBe(false);
      expect(x.proconfig ?? [], `${x.proname} search_path`).toContain('search_path=""');
      expect([x.anon, x.auth, x.sr, x.guiones], `${x.proname}: anon, authenticated, service_role, comentarios`).toEqual([false, false, true, false]);
    }
  });

  it("proveedor_eventos: UPDATE, DELETE y TRUNCATE los rechaza el trigger (dueño y service_role con todos los privilegios); anon, authenticated y service_role sin ellos, el permiso", async () => {
    const r = await rpc(c, "guardar_proveedor", [null, null, { nombre: "Proveedor Inmutable IT" }, [], { nombre: "IT" }], T_PROV);
    expect(r.data).toMatchObject({ ok: true, accion: "crear" });
    expect(await contar(c, "proveedor_eventos", "proveedor_id = $1", [r.data?.proveedor_id])).toBe(1);
    const SENT = { update: "update public.proveedor_eventos set resumen = 'x'", delete: "delete from public.proveedor_eventos", truncate: "truncate table public.proveedor_eventos" };
    for (const [accion, sql] of Object.entries(SENT)) {
      const dueno = await comoRol(c, null, sql);
      expect(dueno.ok, `${accion} como dueño`).toBe(false);
      expect(dueno.error?.codigo).toBe("23001");
      const sr = await comoRol(c, "service_role", sql);
      expect(sr.error?.codigo, `${accion} como service_role (permiso)`).toBe("42501");
      for (const rol of ["anon", "authenticated"]) expect((await comoRol(c, rol, sql)).error?.codigo, `${accion} como ${rol}`).toBe("42501");
    }
    await c.query("grant all on public.proveedor_eventos to service_role");
    for (const [accion, sql] of Object.entries(SENT)) {
      const sr = await comoRol(c, "service_role", sql);
      expect(sr.error?.codigo, `${accion} como service_role con todos los privilegios`).toBe("23001");
    }
    const mezcla = await comoRol(c, "service_role", "update public.proveedor_eventos set perfil_id = null, resumen = 'cambiado'");
    expect(mezcla.error?.codigo).toBe("23001");
    expect(await contar(c, "proveedor_eventos", "proveedor_id = $1", [r.data?.proveedor_id])).toBe(1);
  });

  it("las FK on delete set null siguen funcionando: borrar un proveedor sin compras o un perfil deja los eventos con el vinculo nulo (la unica modificacion que admite el trigger)", async () => {
    const b = await sembrarBase(c, 100);
    const a = actorRol(b.comprador1, "IT C1", "comprador");
    const p = await rpc(c, "guardar_proveedor", [null, null, { nombre: "Se borra IT100" }, [{ nombre: "Contacto" }], a], T_PROV);
    expect(p.data?.ok).toBe(true);
    expect(await contar(c, "proveedor_eventos", "usuario_nombre = 'IT C1' and perfil_id = $1", [b.comprador1])).toBe(1);
    await c.query("delete from auth.users where id = $1", [b.comprador1]);
    expect(await contar(c, "proveedor_eventos", "perfil_id = $1", [b.comprador1])).toBe(0);
    expect(await contar(c, "proveedor_eventos", "proveedor_nombre = 'Se borra IT100' and perfil_id is null and usuario_nombre = 'IT C1'")).toBe(1);
    const del = await rpc(c, "eliminar_proveedor", [p.data?.proveedor_id, actorRol(b.admin, "IT Admin", "admin")], ["uuid", "jsonb"]);
    expect(del.data).toMatchObject({ ok: true, accion: "borrado" });
    expect(await contar(c, "proveedores", "id = $1", [p.data?.proveedor_id])).toBe(0);
    expect(await contar(c, "proveedor_eventos", "proveedor_nombre = 'Se borra IT100' and proveedor_id is null")).toBe(2);
  });

  it("anon y authenticated reciben 42501 al llamar las funciones nuevas o leer las tablas nuevas, y no ven ningun objeto de Storage (RLS sin politicas); service_role llama a fotos_huerfanas", async () => {
    await c.query("insert into storage.objects (bucket_id, name, created_at) values ('compras-fotos', 'compras/it/huerfano.jpg', now() - interval '48 hours')");
    for (const rol of ["anon", "authenticated"]) {
      expect((await comoRol(c, rol, "select public.guardar_proveedor(null, null, '{\"nombre\":\"X\"}', null, '{}')")).error?.codigo, `${rol} guardar_proveedor`).toBe("42501");
      expect((await comoRol(c, rol, "select public.fotos_huerfanas(24)")).error?.codigo, `${rol} fotos_huerfanas`).toBe("42501");
      expect((await comoRol(c, rol, "select count(*) from public.compra_linea_fotos")).error?.codigo, `${rol} fotos`).toBe("42501");
      const objetos = await comoRol(c, rol, "select count(*)::int as n from storage.objects");
      expect(objetos.ok, `${rol} leyendo storage.objects`).toBe(true);
      expect(objetos.filas[0].n, `${rol} no ve ningun objeto`).toBe(0);
      expect((await comoRol(c, rol, "insert into storage.objects (bucket_id, name) values ('compras-fotos', 'compras/x/y/z.jpg')")).error?.codigo, `${rol} subiendo`).toBe("42501");
    }
    const r = await rpc(c, "fotos_huerfanas", [24, 10], ["integer", "integer"]);
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ sin_fila: ["compras/it/huerfano.jpg"], quitadas: [] });
  });

  it("Storage: el bucket compras-fotos es privado y NO hay ninguna politica en el esquema storage", async () => {
    const b = await filas<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(c, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'compras-fotos'");
    expect(b).toEqual([{ public: false, file_size_limit: "409600", allowed_mime_types: ["image/jpeg"] }]);
    expect(Number(await escalar<string>(c, "select count(*) from pg_policies where schemaname = 'storage'"))).toBe(0);
  });
});

describe.skipIf(!HAY_BASE)("0039 · concurrencia de fotos, ficha de la linea y proveedores (Postgres real, varias conexiones)", () => {
  let S: Client; // siembra y consulta (autocommit)
  let A: Client;
  let B: Client;
  let M: Client; // monitor de pg_stat_activity
  const extra: Client[] = [];

  beforeEach(async () => {
    S = await abrir();
    A = await abrir();
    B = await abrir();
    M = await abrir();
  });
  afterEach(async () => {
    for (const x of [A, B]) {
      try {
        await x.query("rollback");
      } catch {
        // sin transaccion abierta
      }
    }
    for (const x of [S, A, B, M, ...extra.splice(0)]) await x.end().catch(() => undefined);
  });

  async function sembrar<T>(fn: () => Promise<T>): Promise<T> {
    await S.query("begin");
    try {
      const r = await fn();
      await S.query("commit");
      return r;
    } catch (e) {
      await S.query("rollback");
      throw e;
    }
  }

  async function activas(linea: string): Promise<number> {
    return contar(S, "compra_linea_fotos", "linea_id = $1 and activo", [linea]);
  }

  it("maximo 3 fotos: con la linea en 2, A agrega la tercera (transaccion abierta) y B espera el candado de la linea; al confirmar A, B recibe max_fotos y quedan 3", async () => {
    const { b, c1 } = await sembrar(async () => {
      const base = await sembrarBase(S, 101);
      const compra = await sembrarCompra(S, base, { n: 1, referencia: "F-1" });
      for (const i of [1, 2]) {
        const r = await rpc(S, "agregar_foto_linea", [compra.compra, compra.linea, foto(uid(101, 5000 + i)), actorRol(base.comprador1, "C1", "comprador")], T_FOTO);
        expect(r.data?.ok).toBe(true);
      }
      return { b: base, c1: compra };
    });
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "agregar_foto_linea", [c1.compra, c1.linea, foto(uid(101, 5003)), actorRol(b.comprador1, "C1", "comprador")], T_FOTO, false);
    expect(rA.data).toMatchObject({ ok: true, activas: 3 });

    const pB = rpcEnTransaccion(B, "agregar_foto_linea", [c1.compra, c1.linea, foto(uid(101, 5004)), actorRol(b.comprador2, "C2", "comprador")], T_FOTO);
    const estadoB = pendiente(pB);
    await esperarBloqueo(M, pidB);
    expect(estadoB.esPendiente()).toBe(true);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "max_fotos" });
    expect(await activas(c1.linea)).toBe(3);
    expect(await contar(S, "compra_linea_fotos", "id = $1", [uid(101, 5004)])).toBe(0);
    expect(await revisionCompra(S, c1.compra)).toBe(0);
  });

  it("maximo 3 fotos con CINCO conexiones a la vez sobre una linea vacia: exactamente 3 entran y 2 reciben max_fotos", async () => {
    const { b, c1 } = await sembrar(async () => {
      const base = await sembrarBase(S, 102);
      return { b: base, c1: await sembrarCompra(S, base, { n: 1, referencia: "F-2" }) };
    });
    const clientes = await Promise.all([1, 2, 3, 4, 5].map(() => abrir()));
    extra.push(...clientes);
    const resultados: ResultadoRpc[] = await Promise.all(
      clientes.map((cl, i) => rpcEnTransaccion(cl, "agregar_foto_linea", [c1.compra, c1.linea, foto(uid(102, 5100 + i)), actorRol(b.comprador1, "C1", "comprador")], T_FOTO))
    );
    expect(resultados.every((x) => x.error === null)).toBe(true);
    expect(resultados.filter((x) => x.data?.ok === true)).toHaveLength(3);
    expect(resultados.filter((x) => x.data?.motivo === "max_fotos")).toHaveLength(2);
    expect(await activas(c1.linea)).toBe(3);
    expect(await contar(S, "compra_linea_fotos", "compra_id = $1", [c1.compra])).toBe(3);
  });

  it("dos cargas de la MISMA clave_origen de foto a la vez (lineas distintas): la segunda espera el indice unico y recibe ya_cargada, sin foto repetida", async () => {
    const { b, c1, c2 } = await sembrar(async () => {
      const base = await sembrarBase(S, 103);
      return { b: base, c1: await sembrarCompra(S, base, { n: 1, referencia: "K-1" }), c2: await sembrarCompra(S, base, { n: 2, referencia: "K-2" }) };
    });
    const pidB = await pidDe(B);
    const clave = { clave_origen: "cotv:photo:it103" };
    const rA = await rpcEnTransaccion(A, "agregar_foto_linea", [c1.compra, c1.linea, foto(uid(103, 5000), clave), actorRol(b.admin, "Admin", "admin")], T_FOTO, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "agregar_foto_linea", [c2.compra, c2.linea, foto(uid(103, 5001), clave), actorRol(b.admin, "Admin", "admin")], T_FOTO);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "ya_cargada", foto_id: uid(103, 5000) });
    expect(await contar(S, "compra_linea_fotos", "clave_origen = 'cotv:photo:it103'")).toBe(1);
  });

  it("orden de candados compra -> linea: quien tiene la compra FOR UPDATE y luego toca la linea NO se interbloquea con agregar_foto_linea, quitar_foto_linea ni editar_ficha_linea", async () => {
    const { b, c1 } = await sembrar(async () => {
      const base = await sembrarBase(S, 104);
      const compra = await sembrarCompra(S, base, { n: 1, referencia: "L-1" });
      const r = await rpc(S, "agregar_foto_linea", [compra.compra, compra.linea, foto(uid(104, 5000)), actorRol(base.comprador1, "C1", "comprador")], T_FOTO);
      expect(r.data?.ok).toBe(true);
      return { b: base, c1: compra };
    });
    const pidB = await pidDe(B);
    const casos: { nombre: string; llamar: () => Promise<ResultadoRpc>; ok: (r: ResultadoRpc) => void }[] = [
      {
        nombre: "agregar_foto_linea",
        llamar: () => rpcEnTransaccion(B, "agregar_foto_linea", [c1.compra, c1.linea, foto(uid(104, 5001)), actorRol(b.comprador1, "C1", "comprador")], T_FOTO),
        ok: (r) => expect(r.data).toMatchObject({ ok: true }),
      },
      {
        nombre: "quitar_foto_linea",
        llamar: () => rpcEnTransaccion(B, "quitar_foto_linea", [c1.compra, c1.linea, uid(104, 5000), actorRol(b.comprador1, "C1", "comprador")], T_QUITAR),
        ok: (r) => expect(r.data).toMatchObject({ ok: true }),
      },
      {
        nombre: "editar_ficha_linea",
        llamar: () => rpcEnTransaccion(B, "editar_ficha_linea", [c1.compra, c1.linea, { descripcion: null, modelo: null }, "Jean", null, actorRol(b.comprador1, "C1", "comprador")], T_FICHA),
        ok: (r) => expect(r.data).toMatchObject({ ok: true }),
      },
    ];
    for (const caso of casos) {
      // A: como `editar_linea` de 0.13.1 o `registrar_recepciones`: compra FOR UPDATE y despues la linea.
      await A.query("begin");
      await A.query("select 1 from public.compras where id = $1 for update", [c1.compra]);
      const pB = caso.llamar();
      const estadoB = pendiente(pB);
      await esperarBloqueo(M, pidB).catch((e: Error) => {
        throw new Error(`${caso.nombre}: ${e.message}`);
      });
      expect(estadoB.esPendiente(), `${caso.nombre} debe esperar la compra`).toBe(true);
      // Con el orden linea -> compra, esta sentencia esperaria la linea que B ya tendria y habria 40P01.
      await A.query("update public.compra_lineas set nota = $2 where id = $1", [c1.linea, `nota ${caso.nombre}`]);
      await A.query("commit");
      const r = await pB;
      expect(r.error, `${caso.nombre}: sin interbloqueo`).toBeNull();
      caso.ok(r);
    }
  });

  it("editar_ficha_linea: dos pestañas con el mismo antes (la segunda espera y recibe linea_cambio); y sin 409 falso si la revision de la compra cambio entre medias", async () => {
    const { b, c1 } = await sembrar(async () => {
      const base = await sembrarBase(S, 105);
      return { b: base, c1: await sembrarCompra(S, base, { n: 1, referencia: "E-1" }) };
    });
    const pidB = await pidDe(B);
    const antes = { descripcion: null, modelo: null };
    const rA = await rpcEnTransaccion(A, "editar_ficha_linea", [c1.compra, c1.linea, antes, "Primera", "M-1", actorRol(b.comprador1, "C1", "comprador")], T_FICHA, false);
    expect(rA.data).toMatchObject({ ok: true, sin_cambios: false });
    const pB = rpcEnTransaccion(B, "editar_ficha_linea", [c1.compra, c1.linea, antes, "Segunda", null, actorRol(b.comprador2, "C2", "comprador")], T_FICHA);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.data).toMatchObject({ ok: false, motivo: "linea_cambio", actual: { descripcion: "Primera", modelo: "M-1" } });
    expect(await escalar<string>(S, "select descripcion from public.compra_lineas where id = $1", [c1.linea])).toBe("Primera");

    // Otra pestaña asigna la compra a un viaje (sube la revision de la compra, transaccion abierta): el antes correcto edita igual, sin
    // 409 falso y SIN esperar: un UPDATE de `revision` toma FOR NO KEY UPDATE sobre la compra y la funcion solo pide FOR KEY SHARE
    // (compatibles), asi que no lee ni espera la revision de la compra.
    await A.query("begin");
    await A.query("update public.compras set revision = revision + 1 where id = $1", [c1.compra]);
    const rB2 = await rpcEnTransaccion(B, "editar_ficha_linea", [c1.compra, c1.linea, { descripcion: "Primera", modelo: "M-1" }, "Tercera", "M-1", actorRol(b.comprador2, "C2", "comprador")], T_FICHA);
    expect(rB2.error).toBeNull();
    expect(rB2.data).toMatchObject({ ok: true, descripcion: "Tercera" });
    await A.query("commit");
    expect(await revisionCompra(S, c1.compra)).toBe(1);
    expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'editar_linea'", [c1.compra])).toBe(2);
  });

  it("guardar_proveedor: dos ediciones con la MISMA revision: la segunda espera la fila y recibe proveedor_cambio sin escribir; el historial tiene un solo evento editar", async () => {
    const { b, p } = await sembrar(async () => {
      const base = await sembrarBase(S, 106);
      const r = await rpc(S, "guardar_proveedor", [null, null, { nombre: "Proveedor Carrera IT106", pais: "Perú" }, [{ nombre: "Ana" }], actorRol(base.comprador1, "C1", "comprador")], T_PROV);
      expect(r.data?.ok).toBe(true);
      return { b: base, p: r.data?.proveedor_id as string };
    });
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "guardar_proveedor", [p, 0, { nombre: "Proveedor Carrera IT106", pais: "Perú", ciudad: "Lima" }, null, actorRol(b.comprador1, "C1", "comprador")], T_PROV, false);
    expect(rA.data).toMatchObject({ ok: true, revision: 1 });
    const pB = rpcEnTransaccion(B, "guardar_proveedor", [p, 0, { nombre: "Proveedor Carrera IT106", pais: "Perú", ciudad: "Cusco" }, null, actorRol(b.comprador2, "C2", "comprador")], T_PROV);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.data).toEqual({ ok: false, motivo: "proveedor_cambio", revision: 1 });
    expect(await escalar<string>(S, "select ciudad from public.proveedores where id = $1", [p])).toBe("Lima");
    expect(await contar(S, "proveedor_eventos", "proveedor_id = $1 and accion = 'editar'", [p])).toBe(1);
  });

  it("guardar_proveedor: dos altas del mismo nombre (o de la misma clave_origen) a la vez: la segunda espera el indice unico y recibe nombre_repetido (o ya_cargado), sin duplicar ni dejar contactos", async () => {
    const b = await sembrar(() => sembrarBase(S, 107));
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "guardar_proveedor", [null, null, { nombre: "Alta Doble IT107" }, [{ nombre: "A" }], actorRol(b.comprador1, "C1", "comprador")], T_PROV, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "guardar_proveedor", [null, null, { nombre: "ALTA DOBLE it107" }, [{ nombre: "B" }], actorRol(b.comprador2, "C2", "comprador")], T_PROV);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toMatchObject({ ok: false, motivo: "nombre_repetido", conflicto: { id: rA.data?.proveedor_id, nombre: "Alta Doble IT107", activo: true } });
    expect(await contar(S, "proveedores", "upper(nombre) = 'ALTA DOBLE IT107'")).toBe(1);
    expect(await contar(S, "proveedor_contactos", "proveedor_id = $1", [rA.data?.proveedor_id])).toBe(1);
    expect(await contar(S, "proveedor_eventos", "proveedor_nombre ilike 'alta doble it107'")).toBe(1);

    const carga = (nombre: string): unknown[] => [null, null, { nombre, pais: "Perú", clave_origen: "cotv:supplier:it107" }, [{ nombre: "X" }], { nombre: "Carga desde COTV", rol: "admin", origen: "carga_cotv" }];
    const cA = await rpcEnTransaccion(A, "guardar_proveedor", carga("Carga Uno IT107"), T_PROV, false);
    expect(cA.data).toMatchObject({ ok: true, accion: "importar" });
    const pC = rpcEnTransaccion(B, "guardar_proveedor", carga("Carga Dos IT107"), T_PROV);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const cB = await pC;
    expect(cB.data).toEqual({ ok: false, motivo: "ya_cargado", proveedor_id: cA.data?.proveedor_id });
    expect(await contar(S, "proveedores", "clave_origen = 'cotv:supplier:it107'")).toBe(1);
    expect(await contar(S, "proveedor_eventos", "accion = 'importar' and proveedor_id = $1", [cA.data?.proveedor_id])).toBe(1);
  });
});
