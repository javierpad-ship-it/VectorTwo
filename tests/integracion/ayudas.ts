import { Client } from "pg";
import { inject } from "vitest";

/**
 * Ayudas de las pruebas de integracion contra Postgres real (ver vitest.integracion.config.ts).
 *
 * Convenciones:
 *   * Cada prueba abre su conexion como el rol dueño (superusuario en la base local), empieza una transaccion (`begin`) y la termina
 *     con `rollback`: no deja nada escrito. Las pruebas de concurrencia son la excepcion: confirman datos propios, en la base clonada
 *     que `global-setup.ts` borra al terminar.
 *   * Las funciones de negocio se llaman con `rpc(...)`, que corre `set local role service_role` (el rol con el que la API las llama
 *     de verdad) dentro de un savepoint: un error de Postgres no aborta la transaccion de la prueba y se devuelve como dato.
 *   * Todo dato es inventado (`@example.invalid`); nada de Lukers.
 */

export const URL_PRUEBAS: string = inject("urlPruebas");
export const HAY_BASE: boolean = Boolean(URL_PRUEBAS);

export type Json = null | boolean | number | string | Json[] | { [clave: string]: Json };
/** Lo que devuelve una funcion de negocio: `{ ok: true, ... }` o `{ ok: false, motivo }`. */
export type Respuesta = { ok?: boolean; motivo?: string; [clave: string]: unknown };
export type ErrorBase = { codigo: string; mensaje: string };
export type ResultadoRpc = { data: Respuesta | null; error: ErrorBase | null };

export async function abrir(): Promise<Client> {
  if (!URL_PRUEBAS) throw new Error("No hay base de pruebas (DATABASE_URL).");
  const c = new Client({ connectionString: URL_PRUEBAS });
  await c.connect();
  // Una prueba que se cuelga esperando un candado debe fallar con un mensaje, no agotar el tiempo de la suite.
  await c.query("set statement_timeout = '30s'; set lock_timeout = '25s'");
  return c;
}

/** Abre una conexion con una transaccion en curso. */
export async function abrirConTransaccion(): Promise<Client> {
  const c = await abrir();
  await c.query("begin");
  return c;
}

export async function cerrarConRollback(c: Client | null | undefined): Promise<void> {
  if (!c) return;
  try {
    await c.query("rollback");
  } catch {
    // la conexion ya estaba cerrada o sin transaccion
  }
  await c.end();
}

function valorParametro(v: unknown, tipo: string): unknown {
  if (v === undefined) return null;
  if (tipo.endsWith("[]")) return v;
  if (tipo === "jsonb" || tipo === "json") return v === null ? null : JSON.stringify(v);
  return v;
}

function errorDe(e: unknown): ErrorBase {
  const x = e as { code?: string; message?: string };
  return { codigo: x.code ?? "?", mensaje: x.message ?? String(e) };
}

/**
 * Llama `public.<nombre>(...)` como `service_role`. `tipos` son los casts de los parametros, en orden (`["jsonb", "jsonb"]`).
 * Devuelve el jsonb de la funcion o el error de Postgres (codigo SQLSTATE y mensaje); la transaccion de la prueba sigue sana.
 */
export async function rpc(c: Client, nombre: string, args: unknown[], tipos: string[]): Promise<ResultadoRpc> {
  const marcadores = tipos.map((t, i) => `$${i + 1}::${t}`).join(", ");
  const params = args.map((a, i) => valorParametro(a, tipos[i]));
  await c.query("savepoint rpc_sp");
  try {
    await c.query("set local role service_role");
    const r = await c.query<{ r: Respuesta }>(`select public.${nombre}(${marcadores}) as r`, params);
    await c.query("reset role");
    await c.query("release savepoint rpc_sp");
    return { data: r.rows[0].r, error: null };
  } catch (e) {
    await c.query("rollback to savepoint rpc_sp");
    await c.query("release savepoint rpc_sp");
    await c.query("reset role");
    return { data: null, error: errorDe(e) };
  }
}

/**
 * Como `rpc`, pero para una conexion SIN transaccion propia (concurrencia): abre y cierra la suya. Se llama sin `await` para dejar
 * la llamada esperando un candado mientras otra conexion sigue con su transaccion abierta.
 */
export async function rpcEnTransaccion(c: Client, nombre: string, args: unknown[], tipos: string[], confirmar = true): Promise<ResultadoRpc> {
  const marcadores = tipos.map((t, i) => `$${i + 1}::${t}`).join(", ");
  const params = args.map((a, i) => valorParametro(a, tipos[i]));
  await c.query("begin");
  try {
    await c.query("set local role service_role");
    const r = await c.query<{ r: Respuesta }>(`select public.${nombre}(${marcadores}) as r`, params);
    if (confirmar) await c.query("commit");
    return { data: r.rows[0].r, error: null };
  } catch (e) {
    await c.query("rollback");
    return { data: null, error: errorDe(e) };
  }
}

export type ResultadoSql = { ok: boolean; filas: Record<string, unknown>[]; filasAfectadas: number; error: ErrorBase | null };

/** Ejecuta una sentencia con el rol dado y DESHACE sus efectos (savepoint): sirve para probar permisos y triggers sin ensuciar. */
export async function comoRol(c: Client, rol: string | null, sql: string, params: unknown[] = []): Promise<ResultadoSql> {
  await c.query("savepoint rol_sp");
  try {
    if (rol) await c.query(`set local role ${rol}`);
    const r = await c.query(sql, params);
    return { ok: true, filas: r.rows as Record<string, unknown>[], filasAfectadas: r.rowCount ?? 0, error: null };
  } catch (e) {
    return { ok: false, filas: [], filasAfectadas: 0, error: errorDe(e) };
  } finally {
    await c.query("rollback to savepoint rol_sp");
    await c.query("release savepoint rol_sp");
    await c.query("reset role");
  }
}

export async function filas<T extends Record<string, unknown> = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await c.query(sql, params);
  return r.rows as T[];
}

export async function escalar<T = unknown>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  const r = await c.query(sql, params);
  return Object.values(r.rows[0] ?? {})[0] as T;
}

export async function contar(c: Client, tabla: string, donde = "true", params: unknown[] = []): Promise<number> {
  return Number(await escalar<string>(c, `select count(*) from public.${tabla} where ${donde}`, params));
}

// ---------------------------------------------------------------------------------------------------------------------
// Fixture comun (datos inventados). Cada `ns` (espacio de nombres) da ids y codigos propios: los que confirman datos (concurrencia)
// no chocan entre si ni con las pruebas que hacen rollback.
// ---------------------------------------------------------------------------------------------------------------------

export function uid(ns: number, n: number): string {
  return `00000000-0000-4000-8000-${String(ns * 100000 + n).padStart(12, "0")}`;
}

export type Base = {
  ns: number;
  admin: string;
  planner: string;
  comprador1: string;
  comprador2: string;
  proveedor: string;
  proveedorNombre: string;
  gml: string;
};

export function actor(perfil: string, nombre: string, restringido?: boolean): Json {
  return restringido === undefined ? { perfil_id: perfil, nombre } : { perfil_id: perfil, nombre, restringido };
}

/** Perfiles (admin, planner, dos compradores), un proveedor y un nodo genero x mundo x linea. */
export async function sembrarBase(c: Client, ns: number): Promise<Base> {
  const p = (n: number) => uid(ns, n);
  const e = `it${ns}`;
  await c.query("insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6), ($7, $8)", [
    p(1), `${e}a@example.invalid`, p(2), `${e}p@example.invalid`, p(3), `${e}c1@example.invalid`, p(4), `${e}c2@example.invalid`,
  ]);
  await c.query(
    "insert into public.perfiles (id, email, nombre, rol, activo) values ($1, $2, 'IT Admin', 'admin', true), ($3, $4, 'IT Planner', 'planner', true), ($5, $6, 'IT Comprador 1', 'comprador', true), ($7, $8, 'IT Comprador 2', 'comprador', true)",
    [p(1), `${e}a@example.invalid`, p(2), `${e}p@example.invalid`, p(3), `${e}c1@example.invalid`, p(4), `${e}c2@example.invalid`]
  );
  const proveedorNombre = `FERIA SUR IT${ns}`;
  const prov = await c.query<{ id: string }>("insert into public.proveedores (nombre) values ($1) returning id", [proveedorNombre]);
  await c.query("insert into public.generos (codigo, nombre) values ($1, $2)", [`G${e}`, `GENERO ${e}`]);
  await c.query("insert into public.mundos (codigo, nombre) values ($1, $2)", [`M${e}`, `MUNDO ${e}`]);
  await c.query("insert into public.lineas (codigo, nombre, temporada) values ($1, $2, 'Todo el año')", [`L${e}`, `LINEA ${e}`]);
  const gml = await c.query<{ id: string }>(
    "insert into public.genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion) select g.id, m.id, l.id, 'GML' from public.generos g, public.mundos m, public.lineas l where g.codigo = $1 and m.codigo = $2 and l.codigo = $3 returning id",
    [`G${e}`, `M${e}`, `L${e}`]
  );
  return {
    ns,
    admin: p(1),
    planner: p(2),
    comprador1: p(3),
    comprador2: p(4),
    proveedor: prov.rows[0].id,
    proveedorNombre,
    gml: gml.rows[0].id,
  };
}

export type CompraSembrada = { compra: string; linea: string; entrega: string };

/**
 * Una compra con UNA linea especifica y UNA entrega (insert directo, como los humos). `n` identifica la compra dentro del `ns`.
 */
export async function sembrarCompra(
  c: Client,
  b: Base,
  o: { n: number; referencia: string; estado?: string; perfil?: string | null; canceladaAt?: boolean; unidades?: number; periodo?: string; origen?: string; proveedor?: string }
): Promise<CompraSembrada> {
  const estado = o.estado ?? "confirmada";
  const unidades = o.unidades ?? 100;
  const periodo = o.periodo ?? "2026-11-01";
  const compra = uid(b.ns, 10000 + o.n);
  const linea = uid(b.ns, 20000 + o.n);
  await c.query(
    "insert into public.compras (id, proveedor_id, origen, estado, fecha_compra, referencia, confirmada_at, perfil_id, cancelada_at) values ($1, $2, $3, $4, date '2026-09-10', $5, $6, $7, $8)",
    [
      compra,
      o.proveedor ?? b.proveedor,
      o.origen ?? (estado === "borrador" ? "comprador" : "carga_inicial"),
      estado,
      o.referencia,
      estado === "borrador" ? null : new Date().toISOString(),
      o.perfil === undefined ? b.admin : o.perfil,
      o.canceladaAt ? new Date().toISOString() : null,
    ]
  );
  await c.query(
    "insert into public.compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario) values ($1, $2, 'especifica', $3, $4, $5, 10)",
    [linea, compra, b.gml, unidades, periodo]
  );
  const en = await c.query<{ id: string }>(
    "insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen) values ($1, $2, $3, 'manual') returning id",
    [linea, periodo, unidades]
  );
  return { compra, linea, entrega: en.rows[0].id };
}

export async function revisionCompra(c: Client, compra: string): Promise<number> {
  return Number(await escalar<number>(c, "select revision from public.compras where id = $1", [compra]));
}

export async function revisionEmbarque(c: Client, embarque: string): Promise<number> {
  return Number(await escalar<number>(c, "select revision from public.compra_embarques where id = $1", [embarque]));
}

/** Crea un embarque con `guardar_embarque` (como la API). Devuelve su id. */
export async function sembrarEmbarque(c: Client, b: Base, nombre: string, llegada = "2026-11-15", extra: Record<string, unknown> = {}): Promise<string> {
  const r = await rpc(c, "guardar_embarque", [{ nombre, tipo: "importacion", fecha_llegada_estimada: llegada, ...extra }, null, actor(b.admin, "IT Admin")], ["jsonb", "integer", "jsonb"]);
  if (!r.data?.ok) throw new Error(`guardar_embarque fallo: ${JSON.stringify(r)}`);
  return r.data.embarque_id as string;
}

/** Crea un viaje con `guardar_viaje`. Devuelve su id. */
export async function sembrarViaje(c: Client, b: Base, nombre: string, inicio = "2026-10-05"): Promise<string> {
  const r = await rpc(c, "guardar_viaje", [{ nombre, fecha_inicio: inicio, responsable_id: b.comprador1 }, null, actor(b.admin, "IT Admin")], ["jsonb", "integer", "jsonb"]);
  if (!r.data?.ok) throw new Error(`guardar_viaje fallo: ${JSON.stringify(r)}`);
  return r.data.viaje_id as string;
}

/** Asigna la entrega entera al embarque (insert directo, como el humo). */
export async function asignarEntrega(c: Client, entrega: string, embarque: string, unidades: number): Promise<string> {
  const r = await c.query<{ id: string }>(
    "insert into public.compra_entrega_asignaciones (entrega_id, embarque_id, unidades) values ($1, $2, $3) returning id",
    [entrega, embarque, unidades]
  );
  return r.rows[0].id;
}

/** Lo que arma `comprasAfectadas` en TypeScript: compras con asignacion ACTIVA en los embarques, mas las `extra`, con su revision. */
export async function comprasDelPlan(c: Client, embarques: string[], extra: string[] = []): Promise<{ id: string; revision: number }[]> {
  return filas<{ id: string; revision: number }>(
    c,
    `select c.id, c.revision
       from public.compras c
      where c.id in (
        select l.compra_id
          from public.compra_entrega_asignaciones a
          join public.compra_linea_entregas e on e.id = a.entrega_id
          join public.compra_lineas l on l.id = e.linea_id
          join public.compras cc on cc.id = l.compra_id
         where a.embarque_id = any($1::uuid[])
           and public.agrupador_es_activa(cc.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
        union
        select unnest($2::uuid[])
      )
      order by c.id`,
    [embarques, extra]
  );
}

export async function embarquesConRevision(c: Client, ids: string[]): Promise<{ id: string; revision: number }[]> {
  return filas<{ id: string; revision: number }>(c, "select id, revision from public.compra_embarques where id = any($1::uuid[]) order by id", [ids]);
}

/** Plan de `aplicar_movimiento_agrupador` (la forma de `PlanAplicable` de TypeScript). */
export function plan(operacion: string, embarques: unknown[], compras: unknown[], movimientos: unknown[], entregas: unknown[] = [], extra: Record<string, unknown> = {}): Json {
  return {
    operacion,
    accion: operacion,
    motivo: "prueba de integracion",
    resumen: `it ${operacion}`,
    embarques,
    paquete_a_mover: null,
    compras,
    movimientos,
    entregas,
    repartos: [],
    ...extra,
  } as Json;
}

/** Movimiento "asignar `unidades` de la entrega al embarque" en el mes dado. */
export function movimientoAsignar(c: CompraSembrada, embarque: string, unidades: number, periodo = "2026-11", asignacion: string | null = null): Json {
  return {
    asignacion_id: asignacion,
    entrega_id: c.entrega,
    linea_id: c.linea,
    compra_id: c.compra,
    unidades,
    destino: { periodo, embarque_id: embarque, paquete_id: null },
  };
}

/** Huella del estado de las tablas de compras: un rechazo no debe cambiarla (compras, lineas, entregas, eventos, asignaciones...). */
export async function foto(c: Client): Promise<string> {
  return escalar<string>(
    c,
    `select md5(
      coalesce((select string_agg(x.id::text || ':' || x.revision || ':' || x.estado || ':' || coalesce(x.viaje_id::text, ''), ',' order by x.id) from public.compras x), '') || '|' ||
      coalesce((select string_agg(l.id::text || ':' || l.unidades, ',' order by l.id) from public.compra_lineas l), '') || '|' ||
      coalesce((select string_agg(e.id::text || ':' || e.unidades, ',' order by e.id) from public.compra_linea_entregas e), '') || '|' ||
      coalesce((select string_agg(a.id::text || ':' || a.entrega_id || ':' || a.embarque_id || ':' || a.unidades, ',' order by a.id) from public.compra_entrega_asignaciones a), '') || '|' ||
      coalesce((select string_agg(b.id::text || ':' || b.revision, ',' order by b.id) from public.compra_embarques b), '') || '|' ||
      (select count(*) from public.compra_eventos) || '|' || (select count(*) from public.compra_agrupador_eventos) || '|' ||
      (select count(*) from public.proveedores) || '|' || (select count(*) from public.compra_linea_repartos) || '|' ||
      (select count(*) from public.compra_viajes) || '|' || (select count(*) from public.compra_paquetes)
    )`
  );
}

/** Carga util de `importar_compra`: una linea especifica de `u` unidades en dic-2026 con una clave nueva. */
export function cargaImportar(b: Base, ref: string, clave: string, u = 10, extra: Record<string, unknown> = {}): Json {
  return {
    proveedor_nombre: b.proveedorNombre,
    referencia: ref,
    fecha_compra: "2026-10-01",
    moneda: "PEN",
    estado: "borrador",
    origen: "comprador",
    lineas: [
      {
        clave_importacion: clave,
        tipo: "especifica",
        genero_mundo_linea_id: b.gml,
        unidades: u,
        entregas: [{ periodo: "2026-12-01", unidades: u }],
      },
    ],
    ...extra,
  } as Json;
}

/** Espera (hasta `ms`) a que la sesion `pid` este bloqueada esperando un candado; falla si no lo esta. */
export async function esperarBloqueo(monitor: Client, pid: number, ms = 8000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const r = await monitor.query<{ espera: string | null }>("select wait_event_type as espera from pg_stat_activity where pid = $1", [pid]);
    if (r.rows[0]?.espera === "Lock") return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`La sesion ${pid} no quedo esperando un candado en ${ms} ms (el candado no se tomo o el orden cambio).`);
}

export async function pidDe(c: Client): Promise<number> {
  return Number(await escalar<number>(c, "select pg_backend_pid()"));
}

/** `true` mientras la promesa no se haya resuelto. */
export function pendiente<T>(p: Promise<T>): { esPendiente: () => boolean } {
  let listo = false;
  void p.then(
    () => {
      listo = true;
    },
    () => {
      listo = true;
    }
  );
  return { esPendiente: () => !listo };
}
