import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAY_BASE, abrirConTransaccion, actor, cargaImportar, cerrarConRollback, comoRol, contar, escalar, rpc, sembrarViaje, type Base } from "./ayudas";
import { sembrarProyeccion, type Escenario } from "./fixture-proyeccion";

/**
 * Triggers de inmutabilidad contra Postgres real: las tablas de historial (eventos de compras y agrupadores, lotes de proyeccion, IA)
 * rechazan UPDATE, DELETE y TRUNCATE tambien para el dueño y para `service_role`. TRUNCATE no se puede probar dentro del mismo `insert
 * ... select`, pero si dentro de una transaccion con savepoint (aqui).
 *
 * Dos barreras: el PERMISO (desde la 0035 service_role solo tiene select e insert en las 8 tablas) y el TRIGGER (la unica que vale para
 * el dueño). La prueba comprueba las dos: como llegan hoy los roles y, devolviendole todos los privilegios a service_role dentro de
 * la transaccion, que el trigger solo basta.
 */

type Caso = {
  tabla: string;
  /** Sentencia de cada tipo; `where true` afecta a toda la tabla (basta con que haya una fila). */
  update: string;
  delete: string;
  /** El trigger por sentencia (no hay una fila de la que depender). */
  truncate: string;
};

const CASOS: Caso[] = [
  { tabla: "compra_eventos", update: "update public.compra_eventos set resumen = 'x'", delete: "delete from public.compra_eventos", truncate: "truncate table public.compra_eventos" },
  { tabla: "compra_agrupador_eventos", update: "update public.compra_agrupador_eventos set resumen = 'x'", delete: "delete from public.compra_agrupador_eventos", truncate: "truncate table public.compra_agrupador_eventos" },
  { tabla: "proyeccion_lotes", update: "update public.proyeccion_lotes set nota = 'x'", delete: "delete from public.proyeccion_lotes", truncate: "truncate table public.proyeccion_lotes cascade" },
  { tabla: "proyeccion_lote_filas", update: "update public.proyeccion_lote_filas set gm_clave = 'x'", delete: "delete from public.proyeccion_lote_filas", truncate: "truncate table public.proyeccion_lote_filas" },
  { tabla: "ia_entradas", update: "update public.ia_entradas set bytes = 999", delete: "delete from public.ia_entradas", truncate: "truncate table public.ia_entradas cascade" },
  { tabla: "ia_llamadas", update: "update public.ia_llamadas set duracion_ms = 999", delete: "delete from public.ia_llamadas", truncate: "truncate table public.ia_llamadas cascade" },
  { tabla: "ia_propuestas_gm", update: "update public.ia_propuestas_gm set filas_validas = 0", delete: "delete from public.ia_propuestas_gm", truncate: "truncate table public.ia_propuestas_gm cascade" },
  { tabla: "proveedor_eventos", update: "update public.proveedor_eventos set resumen = 'x'", delete: "delete from public.proveedor_eventos", truncate: "truncate table public.proveedor_eventos" },
  { tabla: "ia_propuestas_filas", update: "update public.ia_propuestas_filas set razon = 'x'", delete: "delete from public.ia_propuestas_filas", truncate: "truncate table public.ia_propuestas_filas cascade" },
];

describe.skipIf(!HAY_BASE)("inmutabilidad (Postgres real)", () => {
  let c: Client;
  let b: Base;
  let e: Escenario;

  async function sembrarHistorial() {
    // compra_eventos y compra_agrupador_eventos: los deja la propia API (importar una compra, crear un viaje).
    const imp = await rpc(c, "importar_compra", [cargaImportar(b, "R-INM", "INM-1"), actor(b.admin, "Admin")], ["jsonb", "jsonb"]);
    expect(imp.data?.ok).toBe(true);
    await sembrarViaje(c, b, "Viaje inmutable");
    // proveedor_eventos (0039): lo deja guardar_proveedor al crear un proveedor.
    const prov = await rpc(c, "guardar_proveedor", [null, null, { nombre: "Proveedor inmutable IT" }, [], actor(b.admin, "Admin")], ["uuid", "integer", "jsonb", "jsonb", "jsonb"]);
    expect(prov.data?.ok).toBe(true);
    // lotes de proyeccion: una cabecera y una linea, con insert directo (la funcion ya se prueba en proyeccion-lotes).
    await c.query(
      "insert into public.proyeccion_lotes (id, confirmacion_id, proyeccion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, perfil_id) values ('00000000-0000-4000-8000-0000000d0001', gen_random_uuid(), $1, 'aprobar', 2026, repeat('a', 64), now(), '{}'::jsonb, $2)",
      [e.proy, b.admin]
    );
    await c.query(
      "insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values ('00000000-0000-4000-8000-0000000d0001', 'IT-F1', 'GM-UNO', 2026, 'metodo', 'aplicada')"
    );
    // IA: entradas y llamadas de la corrida que ya trae el fixture (propuesta y filas ya estan).
    const corrida = await escalar<string>(c, "select id from public.ia_corridas where proyeccion_id = $1", [e.proy]);
    const cgm = await escalar<string>(c, "select id from public.ia_corrida_gms where corrida_id = $1", [corrida]);
    await c.query("insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario) values ($1, 'historia', repeat('b', 64), '\\x00'::bytea, 1, '{}'::jsonb)", [corrida]);
    await c.query(
      "insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms) values ($1, $2, 'p', 't', 1, repeat('c', 64), 'ok', 1, 1, 1)",
      [corrida, cgm]
    );
    // Las FK diferibles dejan eventos pendientes en la transaccion y Postgres rechaza un TRUNCATE (55006) ANTES de llegar al trigger:
    // se resuelven ya, para que lo que se pruebe sea el trigger (mismo motivo que `set constraints all immediate` en humo-0030).
    await c.query("set constraints all immediate");
  }

  beforeEach(async () => {
    c = await abrirConTransaccion();
    e = await sembrarProyeccion(c, 51);
    b = e.b;
    await sembrarHistorial();
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  for (const caso of CASOS) {
    it(`${caso.tabla}: UPDATE, DELETE y TRUNCATE los rechaza el trigger (dueño y service_role, aun con todos los privilegios); anon y authenticated, el permiso`, async () => {
      const antes = await contar(c, caso.tabla);
      expect(antes).toBeGreaterThan(0);

      // 1. Como llega hoy cada rol, sin tocar privilegios.
      for (const accion of ["update", "delete", "truncate"] as const) {
        const dueno = await comoRol(c, null, caso[accion]);
        expect(dueno.ok, `${caso.tabla} ${accion} como dueño debia fallar`).toBe(false);
        expect(dueno.error?.codigo, `${caso.tabla} ${accion} como dueño`).toBe("23001");
        expect(dueno.error?.mensaje).toMatch(/inmutable|vaciad|no admite/i);

        // service_role: o el permiso (42501, desde la 0035 solo tiene select e insert) o, si lo tuviera, el trigger (23001). Nunca se ejecuta.
        const sr = await comoRol(c, "service_role", caso[accion]);
        expect(sr.ok, `${caso.tabla} ${accion} como service_role debia fallar`).toBe(false);
        expect(["23001", "42501"], `${caso.tabla} ${accion} como service_role: ${sr.error?.mensaje}`).toContain(sr.error?.codigo);

        for (const rol of ["anon", "authenticated"]) {
          const otro = await comoRol(c, rol, caso[accion]);
          expect(otro.ok, `${caso.tabla} ${accion} como ${rol}`).toBe(false);
          expect(otro.error?.codigo).toBe("42501");
        }
      }

      // 2. Segunda barrera: aunque alguien le devolviera TODOS los privilegios a service_role (la 0035 avisa que reaplicar la 0013, 0025
      // o 0030 suelta los devuelve), el trigger sigue rechazando. El grant se deshace con el rollback de la prueba.
      await c.query("grant all on all tables in schema public to service_role");
      for (const accion of ["update", "delete", "truncate"] as const) {
        const sr = await comoRol(c, "service_role", caso[accion]);
        expect(sr.ok, `${caso.tabla} ${accion} como service_role con todos los privilegios`).toBe(false);
        expect(sr.error?.codigo, `${caso.tabla} ${accion} como service_role con todos los privilegios`).toBe("23001");
      }
      expect(await contar(c, caso.tabla)).toBe(antes);
    });
  }

  it("las FK `on delete set null` siguen funcionando: borrar el perfil deja el historial con perfil_id nulo (la unica modificacion que se admite)", async () => {
    const eventos = await contar(c, "compra_eventos", "perfil_id = $1", [b.admin]);
    expect(eventos).toBeGreaterThan(0);
    await c.query("delete from auth.users where id = $1", [b.admin]);
    expect(await contar(c, "compra_eventos", "perfil_id = $1", [b.admin])).toBe(0);
    expect(await contar(c, "compra_eventos", "perfil_id is null")).toBeGreaterThanOrEqual(eventos);
  });

  it("modificar cualquier otra columna de un evento (resumen) sigue prohibido incluso poniendo perfil_id en NULL a la vez", async () => {
    await c.query("grant all on all tables in schema public to service_role");
    const r = await comoRol(c, "service_role", "update public.compra_eventos set perfil_id = null, resumen = 'cambiado'");
    expect(r.ok).toBe(false);
    expect(r.error?.codigo).toBe("23001");
  });
});
