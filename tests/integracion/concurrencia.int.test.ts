import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAY_BASE,
  abrir,
  actor,
  asignarEntrega,
  cargaImportar,
  comprasDelPlan,
  contar,
  embarquesConRevision,
  escalar,
  esperarBloqueo,
  filas,
  movimientoAsignar,
  pendiente,
  pidDe,
  plan,
  revisionCompra,
  revisionEmbarque,
  rpc,
  rpcEnTransaccion,
  sembrarBase,
  sembrarCompra,
  sembrarEmbarque,
  sembrarViaje,
  uid,
  type CompraSembrada,
  type Json,
  type ResultadoRpc,
} from "./ayudas";
import { iso, sembrarProyeccion } from "./fixture-proyeccion";

/**
 * Concurrencia REAL con dos (o tres) conexiones contra Postgres: lo que los espejos en memoria y los humos (una sola transaccion)
 * no pueden probar. Patron: la conexion A toma los candados y deja su transaccion ABIERTA; B arranca, se comprueba en
 * `pg_stat_activity` que B esta esperando un candado (no que termino antes de tiempo), se confirma A y se mira que resultado recibe B.
 *
 * Estas pruebas CONFIRMAN datos (a diferencia del resto): viven en la base clonada que borra `global-setup.ts`. Cada prueba usa su
 * propio `ns`, asi que no chocan entre si.
 */
describe.skipIf(!HAY_BASE)("concurrencia (Postgres real, dos conexiones)", () => {
  const abiertas: Client[] = [];
  let S: Client; // siembra y consulta (autocommit)
  let A: Client;
  let B: Client;
  let M: Client; // monitor de pg_stat_activity

  beforeEach(async () => {
    S = await abrir();
    A = await abrir();
    B = await abrir();
    M = await abrir();
    abiertas.push(S, A, B, M);
  });
  afterEach(async () => {
    for (const x of [A, B]) {
      try {
        await x.query("rollback");
      } catch {
        // sin transaccion abierta
      }
    }
    for (const x of [S, A, B, M]) await x.end();
    abiertas.length = 0;
  });
  afterAll(async () => {
    for (const x of abiertas) await x.end().catch(() => undefined);
  });

  /** Siembra con una transaccion corta (las ayudas que llaman funciones necesitan transaccion). */
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

  const TIPOS_C = ["jsonb", "jsonb"];

  it("importar_compra: el candado global serializa dos importaciones de la MISMA referencia nueva: la segunda agrega a la compra de la primera (no crea otra)", async () => {
    const b = await sembrar(() => sembrarBase(S, 71));
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "importar_compra", [cargaImportar(b, "R-CARRERA", "CAR-A"), actor(b.comprador1, "C1", true)], TIPOS_C, false);
    expect(rA.data).toMatchObject({ ok: true, creada: true });

    const pB = rpcEnTransaccion(B, "importar_compra", [cargaImportar(b, "R-CARRERA", "CAR-B"), actor(b.comprador1, "C1", true)], TIPOS_C);
    const estadoB = pendiente(pB);
    await esperarBloqueo(M, pidB);
    expect(estadoB.esPendiente()).toBe(true);

    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toMatchObject({ ok: true, creada: false, compra_id: rA.data?.compra_id, revision: 1 });
    expect(await contar(S, "compras", "referencia = 'R-CARRERA' and proveedor_id = $1", [b.proveedor])).toBe(1);
    expect(await contar(S, "compra_lineas", "compra_id = $1", [rA.data?.compra_id])).toBe(2);
    expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'importar'", [rA.data?.compra_id])).toBe(2);
  });

  it("importar_compra: el MISMO archivo importado a la vez dos veces: la segunda espera y recibe clave_existente (no duplica lineas)", async () => {
    const b = await sembrar(() => sembrarBase(S, 72));
    const pidB = await pidDe(B);
    const carga = cargaImportar(b, "R-MISMA", "MISMA-1");
    const rA = await rpcEnTransaccion(A, "importar_compra", [carga, actor(b.admin, "Admin")], TIPOS_C, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "importar_compra", [carga, actor(b.admin, "Admin")], TIPOS_C);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.data).toEqual({ ok: false, motivo: "clave_existente" });
    expect(await contar(S, "compra_lineas", "clave_importacion = 'MISMA-1'")).toBe(1);
  });

  it("asignar_viaje_compras: B espera el candado del viaje y, al confirmar A, recibe compra_cambio (su vista era vieja) sin escribir nada", async () => {
    const { b, viaje, c1, c2 } = await sembrar(async () => {
      const base = await sembrarBase(S, 73);
      return {
        b: base,
        viaje: await sembrarViaje(S, base, "Viaje carrera"),
        c1: await sembrarCompra(S, base, { n: 1, referencia: "V-1" }),
        c2: await sembrarCompra(S, base, { n: 2, referencia: "V-2" }),
      };
    });
    const pidB = await pidDe(B);
    const args = (cs: CompraSembrada[]): unknown[] => [viaje, cs.map((x) => ({ id: x.compra, revision: 0 })), actor(b.comprador1, "C1")];
    const T = ["uuid", "jsonb", "jsonb"];
    const rA = await rpcEnTransaccion(A, "asignar_viaje_compras", args([c1, c2]), T, false);
    expect(rA.data?.ok).toBe(true);

    const pB = rpcEnTransaccion(B, "asignar_viaje_compras", args([c1]), T);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(await revisionCompra(S, c1.compra)).toBe(1);
    expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'asignar_viaje'", [c1.compra])).toBe(1);
  });

  /** Escenario de agrupadores con datos confirmados: embarque(s), compras asignadas y una linea extra sin asignar en la compra 1. */
  async function escenarioAgrupadores(ns: number, nEmbarques = 1, extraEmbarque: Record<string, unknown> = {}) {
    return sembrar(async () => {
      const b = await sembrarBase(S, ns);
      const embarques: string[] = [];
      for (let i = 1; i <= nEmbarques; i++) embarques.push(await sembrarEmbarque(S, b, `Embarque ${i} ns${ns}`, "2026-11-15", i === 1 ? extraEmbarque : {}));
      const compras: CompraSembrada[] = [];
      for (let i = 1; i <= Math.max(2, nEmbarques); i++) {
        const s = await sembrarCompra(S, b, { n: i, referencia: `AG-${i}`, estado: "confirmada", perfil: b.comprador1 });
        await asignarEntrega(S, s.entrega, embarques[(i - 1) % nEmbarques], 100);
        compras.push(s);
      }
      const linea = uid(ns, 31000);
      await S.query(
        "insert into public.compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario) values ($1, $2, 'especifica', $3, 50, date '2026-11-01', 10)",
        [linea, compras[0].compra, b.gml]
      );
      const en = await S.query<{ id: string }>("insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen) values ($1, date '2026-11-01', 50, 'manual') returning id", [linea]);
      const extra: CompraSembrada = { compra: compras[0].compra, linea, entrega: en.rows[0].id };
      return { b, embarques, compras, extra };
    });
  }

  async function planAsignarExtra(embarque: string, compra: string, extra: CompraSembrada): Promise<Json> {
    return plan(
      "asignar",
      await embarquesConRevision(S, [embarque]),
      await comprasDelPlan(S, [embarque], [compra]),
      [movimientoAsignar(extra, embarque, 50)],
      [{ linea_id: extra.linea, periodo: "2026-11", unidades: 50 }]
    );
  }

  it("aplicar_movimiento_agrupador: dos planes sobre el MISMO embarque: B espera el candado del embarque y recibe agrupador_cambio", async () => {
    const { b, embarques, compras, extra } = await escenarioAgrupadores(74);
    const plan1 = await planAsignarExtra(embarques[0], compras[0].compra, extra);
    const plan2 = await planAsignarExtra(embarques[0], compras[0].compra, extra);
    const pidB = await pidDe(B);
    const T = TIPOS_C;
    const rA = await rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [plan1, actor(b.comprador1, "C1")], T, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [plan2, actor(b.comprador2, "C2")], T);
    const estadoB = pendiente(pB);
    await esperarBloqueo(M, pidB);
    expect(estadoB.esPendiente()).toBe(true);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
    expect(await contar(S, "compra_entrega_asignaciones", "embarque_id = $1", [embarques[0]])).toBe(3);
    expect(await contar(S, "compra_eventos", "accion = 'asignar_agrupador' and compra_id = $1", [compras[0].compra])).toBe(1);
  });

  it("aplicar_movimiento_agrupador: dos embarques DISTINTOS que comparten una compra: B espera el candado de la compra y recibe compra_cambio", async () => {
    const { b, embarques, compras, extra } = await escenarioAgrupadores(75, 2);
    // La compra 1 esta en el embarque 1; su linea extra se asigna al embarque 1 (A) y al embarque 2 (B) a la vez.
    const planA = await planAsignarExtra(embarques[0], compras[0].compra, extra);
    const planB = await planAsignarExtra(embarques[1], compras[0].compra, extra);
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planA, actor(b.comprador1, "C1")], TIPOS_C, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [planB, actor(b.comprador2, "C2")], TIPOS_C);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(await contar(S, "compra_entrega_asignaciones", "embarque_id = $1", [embarques[1]])).toBe(1);
  });

  it("orden de candados: planes cruzados (embarques y compras en orden inverso) lanzados A LA VEZ nunca se interbloquean: uno gana y el otro recibe un motivo, 8 rondas", async () => {
    const { b, embarques, compras, extra } = await escenarioAgrupadores(76, 2);
    const T = TIPOS_C;
    const resultados: string[] = [];
    for (let ronda = 0; ronda < 8; ronda++) {
      // Dos planes sobre el mismo par de embarques y compras, listados en orden contrario. Cada ronda alterna "asignar" y "quitar" la linea extra.
      const asignada = (await contar(S, "compra_entrega_asignaciones", "entrega_id = $1", [extra.entrega])) > 0;
      const movimientos = asignada
        ? [{ asignacion_id: await escalar<string>(S, "select id from public.compra_entrega_asignaciones where entrega_id = $1", [extra.entrega]), entrega_id: extra.entrega, linea_id: extra.linea, compra_id: extra.compra, unidades: 50, destino: null }]
        : [movimientoAsignar(extra, embarques[0], 50)];
      const op = asignada ? "quitar" : "asignar";
      const ents = [{ linea_id: extra.linea, periodo: "2026-11", unidades: 50 }];
      const construir = async (invertido: boolean): Promise<Json> => {
        const eb = await embarquesConRevision(S, embarques);
        const cs = await comprasDelPlan(S, embarques, [compras[0].compra]);
        return plan(op, invertido ? [...eb].reverse() : eb, invertido ? [...cs].reverse() : cs, movimientos, ents);
      };
      const [p1, p2] = [await construir(false), await construir(true)];
      const [r1, r2] = await Promise.all([
        rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [p1, actor(b.comprador1, "C1")], T),
        rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [p2, actor(b.comprador2, "C2")], T),
      ]);
      for (const r of [r1, r2]) {
        expect(r.error?.codigo, `ronda ${ronda}: ${JSON.stringify(r)}`).toBeUndefined();
        expect(r.error).toBeNull();
      }
      const oks = [r1, r2].filter((r) => r.data?.ok === true).length;
      resultados.push(`${oks}`);
      expect(oks, `ronda ${ronda}: exactamente uno debe ganar`).toBe(1);
      const otro = [r1, r2].find((r) => r.data?.ok !== true);
      expect(["agrupador_cambio", "compra_cambio"]).toContain(otro?.data?.motivo);
    }
    expect(resultados).toEqual(Array(8).fill("1"));
    expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
  });

  it("asignar_viaje_compras con compras en orden inverso, a la vez, hacia dos viajes distintos: sin interbloqueo (uno gana, el otro compra_cambio), 8 rondas", async () => {
    const { b, v1, v2, c1, c2 } = await sembrar(async () => {
      const base = await sembrarBase(S, 77);
      return {
        b: base,
        v1: await sembrarViaje(S, base, "Viaje 1"),
        v2: await sembrarViaje(S, base, "Viaje 2", "2026-10-06"),
        c1: await sembrarCompra(S, base, { n: 1, referencia: "X-1" }),
        c2: await sembrarCompra(S, base, { n: 2, referencia: "X-2" }),
      };
    });
    const T = ["uuid", "jsonb", "jsonb"];
    for (let ronda = 0; ronda < 8; ronda++) {
      // Cada ronda parte de compras sin viaje: si no, la que ya esta en el viaje destino no cambia y las dos pueden salir bien.
      await S.query("update public.compras set viaje_id = null where id = any($1::uuid[])", [[c1.compra, c2.compra]]);
      const rev = async (x: CompraSembrada) => ({ id: x.compra, revision: await revisionCompra(S, x.compra) });
      const orden1 = [await rev(c1), await rev(c2)];
      const orden2 = [await rev(c2), await rev(c1)];
      const [r1, r2] = await Promise.all([
        rpcEnTransaccion(A, "asignar_viaje_compras", [ronda % 2 === 0 ? v1 : v2, orden1, actor(b.comprador1, "C1")], T),
        rpcEnTransaccion(B, "asignar_viaje_compras", [ronda % 2 === 0 ? v2 : v1, orden2, actor(b.comprador2, "C2")], T),
      ]);
      expect(r1.error, `ronda ${ronda}`).toBeNull();
      expect(r2.error, `ronda ${ronda}`).toBeNull();
      expect([r1, r2].filter((r) => r.data?.ok === true)).toHaveLength(1);
      expect([r1, r2].find((r) => r.data?.ok !== true)?.data).toEqual({ ok: false, motivo: "compra_cambio" });
    }
  });

  /**
   * CANDADOS DE VIAJES Y EMBARQUES (migracion 0036). Contexto del hallazgo: `aplicar_movimiento_agrupador` y `cambiar_estado_agrupador`
   * sostienen un embarque (y una compra) y al final insertan eventos con `viaje_id` (FK: FOR KEY SHARE sobre el viaje); `importar_agrupadores`
   * inserta embarques y paquetes que apuntan a viajes y embarques por codigo (tampoco los bloquea). Si `guardar_embarque`,
   * `asignar_viaje_compras` o `importar_agrupadores` tomaban el viaje con FOR UPDATE, ese KEY SHARE chocaba con el y Postgres abortaba a
   * uno con 40P01. Desde la 0036 los viajes y los embarques se bloquean con FOR NO KEY UPDATE (solo cambian columnas no clave; el
   * KEY SHARE de las FK ya no choca, el exclusion entre escritores se mantiene) y las compras siguen con FOR UPDATE.
   *
   * Las pruebas usan una COMPUERTA: un cliente extra (P) retiene un candado de TABLA (SHARE) que bloquea solo los inserts en esa tabla, de modo
   * que la sesion A queda parada despues de tomar sus candados y antes de su insert con FK. Asi el cruce es determinista, no una carrera.
   */
  const T_GUARDAR = ["jsonb", "integer", "jsonb"];
  const T_CAMBIAR = ["text", "uuid", "text", "integer", "text", "jsonb"];
  const T_VIAJE_COMPRAS = ["uuid", "jsonb", "jsonb"];

  /** Un viaje V, un embarque E dentro de V, una compra confirmada asignada entera a E y un paquete en E. */
  async function escenarioViajeEmbarque(ns: number) {
    return sembrar(async () => {
      const b = await sembrarBase(S, ns);
      const viaje = await sembrarViaje(S, b, `Viaje ns${ns}`);
      const embarque = await sembrarEmbarque(S, b, `Embarque ns${ns}`, "2026-11-15", { viaje_id: viaje });
      const compra = await sembrarCompra(S, b, { n: 1, referencia: `LK-${ns}`, estado: "confirmada", perfil: b.comprador1 });
      const asignacion = await asignarEntrega(S, compra.entrega, embarque, 100);
      const p = await rpc(S, "guardar_paquete", [{ embarque_id: embarque, nombre: `Paquete ns${ns}` }, await revisionEmbarque(S, embarque), actor(b.admin, "IT Admin")], ["jsonb", "integer", "jsonb"]);
      if (!p.data?.ok) throw new Error(`guardar_paquete fallo: ${JSON.stringify(p)}`);
      return { b, viaje, embarque, compra, asignacion, paquete: p.data.paquete_id as string };
    });
  }
  type EscenarioLk = Awaited<ReturnType<typeof escenarioViajeEmbarque>>;

  async function revisionViaje(viaje: string): Promise<number> {
    return Number(await escalar<number>(S, "select revision from public.compra_viajes where id = $1", [viaje]));
  }

  function planQuitarEntrega(esc: EscenarioLk, embarques: unknown[], compras: unknown[]): Json {
    return plan(
      "quitar",
      embarques,
      compras,
      [{ asignacion_id: esc.asignacion, entrega_id: esc.compra.entrega, linea_id: esc.compra.linea, compra_id: esc.compra.compra, unidades: 100, destino: null }],
      [{ linea_id: esc.compra.linea, periodo: "2026-11", unidades: 100 }]
    );
  }

  /** Compuerta: P retiene `lock table <tabla> in share mode`; quien inserte en esa tabla espera hasta que P haga rollback. */
  async function abrirCompuerta(tabla: string): Promise<Client> {
    const P = await abrir();
    await P.query("begin");
    await P.query(`lock table public.${tabla} in share mode`);
    return P;
  }
  async function cerrarCompuerta(P: Client): Promise<void> {
    try {
      await P.query("rollback");
    } catch {
      // ya cerrada
    }
    await P.end().catch(() => undefined);
  }

  it("hallazgo original: embarque DENTRO de un viaje, aplicar_movimiento_agrupador (sostiene embarque y compra, luego KEY SHARE del viaje) y asignar_viaje_compras (viaje y luego compra) sobre la misma compra: SIN interbloqueo; gana el movimiento y el segundo recibe compra_cambio", async () => {
    const P = await abrir();
    try {
      const esc = await escenarioViajeEmbarque(78);
      const { b, viaje, embarque, compra } = esc;
      const planQuitar = planQuitarEntrega(esc, await embarquesConRevision(S, [embarque]), await comprasDelPlan(S, [embarque]));
      const revCompra = await revisionCompra(S, compra.compra);
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);

      // P retiene la fila de asignacion: A tomara embarque y compra y se parara al intentar quitarla.
      await P.query("begin");
      await P.query("select 1 from public.compra_entrega_asignaciones where id = $1 for update", [esc.asignacion]);
      const pA = rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planQuitar, actor(b.comprador1, "C1")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      // B toma el viaje (FOR NO KEY UPDATE) y se queda esperando la compra que A ya tiene.
      const pB = rpcEnTransaccion(B, "asignar_viaje_compras", [viaje, [{ id: compra.compra, revision: revCompra }], actor(b.comprador2, "C2")], T_VIAJE_COMPRAS);
      await esperarBloqueo(M, pidB);
      await P.query("rollback"); // A sigue: necesita el viaje (FOR KEY SHARE) que B tiene (NO KEY UPDATE): ya no chocan

      const [rA, rB]: ResultadoRpc[] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok).toBe(true);
      expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
      // Solo escribio A: la revision de la compra sube una vez, hay un evento de A y ninguno de B; el viaje de la compra sigue sin asignar.
      expect(await revisionCompra(S, compra.compra)).toBe(revCompra + 1);
      expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'asignar_agrupador'", [compra.compra])).toBe(1);
      expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'asignar_viaje'", [compra.compra])).toBe(0);
      expect(await escalar<string | null>(S, "select viaje_id from public.compras where id = $1", [compra.compra])).toBeNull();
      expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("cambiar_estado_agrupador(embarque) sostiene el embarque y necesita el KEY SHARE del viaje para su evento; guardar_embarque sostiene el viaje y espera el embarque: SIN interbloqueo, el segundo recibe agrupador_cambio", async () => {
    const esc = await escenarioViajeEmbarque(83);
    const { b, viaje, embarque } = esc;
    const rev = await revisionEmbarque(S, embarque);
    const P = await abrirCompuerta("compra_agrupador_eventos");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      // A: toma el embarque y se para en el insert del evento (la compuerta), ANTES de pedir el KEY SHARE del viaje.
      const pA = rpcEnTransaccion(A, "cambiar_estado_agrupador", ["embarque", embarque, "en_transito", rev, null, actor(b.comprador1, "C1")], T_CAMBIAR);
      await esperarBloqueo(M, pidA);
      // B: toma el viaje y espera el embarque de A.
      const pB = rpcEnTransaccion(
        B,
        "guardar_embarque",
        [{ id: embarque, nombre: "Embarque renombrado", tipo: "importacion", viaje_id: viaje }, rev, actor(b.comprador2, "C2")],
        T_GUARDAR
      );
      await esperarBloqueo(M, pidB);
      await cerrarCompuerta(P);
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data).toMatchObject({ ok: true, estado: "en_transito", revision: rev + 1 });
      expect(rB.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
      expect(await revisionEmbarque(S, embarque)).toBe(rev + 1);
      expect(await escalar<string>(S, "select nombre from public.compra_embarques where id = $1", [embarque])).toBe(`Embarque ns83`);
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("importar_agrupadores (embarque por viaje_codigo: sostiene el candado del codigo y pide el KEY SHARE del viaje) contra guardar_embarque (sostiene el viaje y pide el candado del codigo): SIN interbloqueo, los dos terminan bien", async () => {
    const esc = await escenarioViajeEmbarque(84);
    const { b, viaje } = esc;
    const codigoViaje = await escalar<string>(S, "select codigo from public.compra_viajes where id = $1", [viaje]);
    const lote = {
      archivo_nombre: "it-84.csv",
      viajes: [],
      embarques: [
        {
          fila: 1, codigo: null, nombre: "Embarque importado ns84", tipo: "importacion", viaje_id: null, viaje_codigo: codigoViaje, responsable_id: b.comprador1,
          referencia_logistica: null, puerto_embarque: null, fecha_salida_estimada: null, fecha_llegada_estimada: "2026-12-15", nota: null,
        },
      ],
      paquetes: [],
    };
    const P = await abrirCompuerta("compra_embarques");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      // A: toma el candado consultivo del codigo de embarques y se para en el insert del embarque (la compuerta).
      const pA = rpcEnTransaccion(A, "importar_agrupadores", [lote, actor(b.admin, "Admin")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      // B: toma el viaje y espera el candado del codigo, que tiene A.
      const pB = rpcEnTransaccion(
        B,
        "guardar_embarque",
        [{ nombre: "Embarque nuevo ns84", tipo: "importacion", viaje_id: viaje, fecha_llegada_estimada: "2026-12-20" }, null, actor(b.comprador2, "C2")],
        T_GUARDAR
      );
      await esperarBloqueo(M, pidB);
      await cerrarCompuerta(P);
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok).toBe(true);
      expect(rB.data).toMatchObject({ ok: true, creado: true });
      const codigos = await filas<{ codigo: string }>(S, "select codigo from public.compra_embarques where viaje_id = $1 and nombre like '%ns84' and nombre <> 'Embarque ns84' order by codigo", [viaje]);
      expect(codigos).toHaveLength(2);
      expect(new Set(codigos.map((x) => x.codigo)).size).toBe(2);
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("importar_agrupadores (paquete por embarque_codigo) contra guardar_paquete sobre ese embarque: SIN interbloqueo, los dos terminan bien", async () => {
    const esc = await escenarioViajeEmbarque(85);
    const { b, embarque } = esc;
    const codigoEmbarque = await escalar<string>(S, "select codigo from public.compra_embarques where id = $1", [embarque]);
    const lote = {
      archivo_nombre: "it-85.csv",
      viajes: [],
      embarques: [],
      paquetes: [{ fila: 1, codigo: null, nombre: "Paquete importado ns85", embarque_id: null, embarque_codigo: codigoEmbarque, responsable_id: null, nota: null }],
    };
    const rev = await revisionEmbarque(S, embarque);
    const P = await abrirCompuerta("compra_paquetes");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      const pA = rpcEnTransaccion(A, "importar_agrupadores", [lote, actor(b.admin, "Admin")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      const pB = rpcEnTransaccion(B, "guardar_paquete", [{ embarque_id: embarque, nombre: "Paquete nuevo ns85" }, rev, actor(b.comprador2, "C2")], ["jsonb", "integer", "jsonb"]);
      await esperarBloqueo(M, pidB);
      await cerrarCompuerta(P);
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok).toBe(true);
      expect(rB.data).toMatchObject({ ok: true, creado: true });
      expect(await contar(S, "compra_paquetes", "embarque_id = $1 and nombre like '%ns85'", [embarque])).toBe(3);
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("tres conexiones: aplicar_movimiento_agrupador (embarque y compra), asignar_viaje_compras (viaje, espera la compra) y guardar_embarque (espera el viaje) en cadena: SIN interbloqueo; gana el movimiento, la asignacion recibe compra_cambio y la edicion agrupador_cambio", async () => {
    const esc = await escenarioViajeEmbarque(86);
    const { b, viaje, embarque, compra } = esc;
    const planQuitar = planQuitarEntrega(esc, await embarquesConRevision(S, [embarque]), await comprasDelPlan(S, [embarque]));
    const revCompra = await revisionCompra(S, compra.compra);
    const revEmb = await revisionEmbarque(S, embarque);
    const C = await abrir();
    const P = await abrirCompuerta("compra_agrupador_eventos");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      const pidC = await pidDe(C);
      // A (movimiento): embarque y compra tomados; se para en el insert del evento del embarque (el que pide el KEY SHARE del viaje).
      const pA = rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planQuitar, actor(b.comprador1, "C1")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      // B (asignar viaje): toma el viaje y espera la compra de A.
      const pB = rpcEnTransaccion(B, "asignar_viaje_compras", [viaje, [{ id: compra.compra, revision: revCompra }], actor(b.comprador2, "C2")], T_VIAJE_COMPRAS);
      await esperarBloqueo(M, pidB);
      // C (editar embarque): espera el viaje que tiene B.
      const pC = rpcEnTransaccion(
        C,
        "guardar_embarque",
        [{ id: embarque, nombre: "Otro nombre", tipo: "importacion", viaje_id: viaje }, revEmb, actor(b.admin, "Admin")],
        T_GUARDAR
      );
      await esperarBloqueo(M, pidC);
      await cerrarCompuerta(P);
      const [rA, rB, rC] = await Promise.all([pA, pB, pC]);
      for (const [n, r] of [["A", rA], ["B", rB], ["C", rC]] as const) expect(r.error, `${n}: ${JSON.stringify(r)}`).toBeNull();
      expect(rA.data?.ok).toBe(true);
      expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
      expect(rC.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
      expect(await revisionCompra(S, compra.compra)).toBe(revCompra + 1);
      expect(await escalar<string>(S, "select nombre from public.compra_embarques where id = $1", [embarque])).toBe("Embarque ns86");
      expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
    } finally {
      await cerrarCompuerta(P);
      await C.end().catch(() => undefined);
    }
  });

  /**
   * Modo de cada candado, comprobado desde fuera con `nowait`: mientras la funcion tiene su transaccion abierta, otra sesion SI puede
   * tomar `for key share` (es lo que pide una FK) sobre el viaje o el embarque, y NO puede tomar `for no key update` (otro escritor).
   * Las compras se conservan con `for update` (revision y estado: nadie debe ni insertar lineas mientras se mueven).
   */
  type Probe = { tabla: "compra_viajes" | "compra_embarques" | "compras"; id: string; esperado: "no_key_update" | "for_update" };
  async function bloqueo(c: Client, tabla: string, id: string, modo: "for key share" | "for no key update"): Promise<"libre" | "bloqueado"> {
    try {
      await c.query(`select 1 from public.${tabla} where id = $1 ${modo} nowait`, [id]);
      return "libre";
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") return "bloqueado";
      throw e;
    }
  }

  it("modo de los candados: viajes y embarques con FOR NO KEY UPDATE (key share libre, otro escritor bloqueado), compras con FOR UPDATE", async () => {
    const esc = await escenarioViajeEmbarque(87);
    const { b, viaje, embarque, compra, paquete } = esc;
    const act = actor(b.admin, "Admin");
    const V = { tabla: "compra_viajes", id: viaje, esperado: "no_key_update" } as const;
    const E = { tabla: "compra_embarques", id: embarque, esperado: "no_key_update" } as const;
    const C = { tabla: "compras", id: compra.compra, esperado: "for_update" } as const;
    const casos: { nombre: string; args: () => Promise<unknown[]>; tipos: string[]; fn: string; probes: Probe[] }[] = [
      {
        nombre: "guardar_viaje (editar)", fn: "guardar_viaje", tipos: T_GUARDAR, probes: [V],
        args: async () => [{ id: viaje, nombre: "Viaje editado", fecha_inicio: "2026-10-05", responsable_id: b.comprador1 }, await revisionViaje(viaje), act],
      },
      {
        nombre: "cambiar_estado_agrupador (viaje)", fn: "cambiar_estado_agrupador", tipos: T_CAMBIAR, probes: [V],
        args: async () => ["viaje", viaje, "cerrar", await revisionViaje(viaje), null, act],
      },
      {
        nombre: "asignar_viaje_compras", fn: "asignar_viaje_compras", tipos: T_VIAJE_COMPRAS, probes: [V, C],
        args: async () => [viaje, [{ id: compra.compra, revision: await revisionCompra(S, compra.compra) }], act],
      },
      {
        nombre: "guardar_embarque (editar)", fn: "guardar_embarque", tipos: T_GUARDAR, probes: [V, E],
        args: async () => [{ id: embarque, nombre: "Embarque editado", tipo: "importacion", viaje_id: viaje }, await revisionEmbarque(S, embarque), act],
      },
      {
        nombre: "guardar_paquete (crear)", fn: "guardar_paquete", tipos: T_GUARDAR, probes: [E],
        args: async () => [{ embarque_id: embarque, nombre: "Paquete extra" }, await revisionEmbarque(S, embarque), act],
      },
      {
        nombre: "cambiar_estado_agrupador (embarque)", fn: "cambiar_estado_agrupador", tipos: T_CAMBIAR, probes: [E],
        args: async () => ["embarque", embarque, "en_transito", await revisionEmbarque(S, embarque), null, act],
      },
      {
        nombre: "cambiar_estado_agrupador (paquete)", fn: "cambiar_estado_agrupador", tipos: T_CAMBIAR, probes: [E],
        args: async () => ["paquete", paquete, "cancelar", await revisionEmbarque(S, embarque), "prueba de candados", act],
      },
      {
        nombre: "aplicar_movimiento_agrupador", fn: "aplicar_movimiento_agrupador", tipos: TIPOS_C, probes: [E, C],
        args: async () => [planQuitarEntrega(esc, await embarquesConRevision(S, [embarque]), await comprasDelPlan(S, [embarque])), act],
      },
      {
        nombre: "aplicar_movimiento_agrupador (cambiar_fecha: Arribo, 0038)", fn: "aplicar_movimiento_agrupador", tipos: TIPOS_C, probes: [E],
        args: async () => [plan("cambiar_fecha", [{ ...(await embarquesConRevision(S, [embarque]))[0], fecha_puerto_estimada: "2026-11-10" }], [], [], [], { causa: "naviera", paquetes: [] }), act],
      },
      {
        nombre: "editar_oc_compra (0038: la compra con FOR NO KEY UPDATE, no es clave)", fn: "editar_oc_compra", tipos: ["uuid", "text", "text", "text", "jsonb"],
        probes: [{ tabla: "compras", id: compra.compra, esperado: "no_key_update" }],
        args: async () => [compra.compra, null, "OC-87", null, act],
      },
      {
        nombre: "importar_agrupadores (viaje_id y embarque_id existentes)", fn: "importar_agrupadores", tipos: TIPOS_C, probes: [V, E],
        args: async () => [
          {
            archivo_nombre: "it-87.csv",
            viajes: [],
            embarques: [
              {
                fila: 1, codigo: null, nombre: "Emb imp ns87", tipo: "importacion", viaje_id: viaje, viaje_codigo: null, responsable_id: b.comprador1,
                referencia_logistica: null, puerto_embarque: null, fecha_salida_estimada: null, fecha_llegada_estimada: "2027-01-15", nota: null,
              },
            ],
            paquetes: [{ fila: 1, codigo: null, nombre: "Paq imp ns87", embarque_id: embarque, embarque_codigo: null, responsable_id: null, nota: null }],
          },
          act,
        ],
      },
    ];
    for (const caso of casos) {
      const r = await rpcEnTransaccion(A, caso.fn, await caso.args(), caso.tipos, false);
      try {
        expect(r.error, `${caso.nombre}: ${JSON.stringify(r)}`).toBeNull();
        expect(r.data?.ok, `${caso.nombre}: ${JSON.stringify(r)}`).toBe(true);
        for (const p of caso.probes) {
          expect(await bloqueo(S, p.tabla, p.id, "for no key update"), `${caso.nombre}: otro escritor sobre ${p.tabla} debe esperar`).toBe("bloqueado");
          const keyShare = await bloqueo(S, p.tabla, p.id, "for key share");
          expect(keyShare, `${caso.nombre}: el KEY SHARE de una FK sobre ${p.tabla} ${p.esperado === "no_key_update" ? "debe pasar" : "debe esperar"}`).toBe(
            p.esperado === "no_key_update" ? "libre" : "bloqueado"
          );
        }
      } finally {
        await A.query("rollback");
      }
    }
  });

  it("carrera general sobre un mismo viaje, embarque y compra (5 operaciones a la vez, 6 rondas): ninguna sesion recibe error de Postgres (ni 40P01); cada una gana o recibe un motivo", async () => {
    const esc = await escenarioViajeEmbarque(88);
    const { b, viaje, embarque, compra } = esc;
    const extras = [await abrir(), await abrir(), await abrir()];
    const [C, D, F] = extras;
    const motivosValidos = ["agrupador_cambio", "compra_cambio", "transicion_invalida"];
    try {
      for (let ronda = 0; ronda < 6; ronda++) {
        const asignada = (await contar(S, "compra_entrega_asignaciones", "entrega_id = $1", [compra.entrega])) > 0;
        const planMovimiento = asignada
          ? planQuitarEntrega(
              { ...esc, asignacion: await escalar<string>(S, "select id from public.compra_entrega_asignaciones where entrega_id = $1", [compra.entrega]) },
              await embarquesConRevision(S, [embarque]),
              await comprasDelPlan(S, [embarque])
            )
          : plan(
              "asignar",
              await embarquesConRevision(S, [embarque]),
              await comprasDelPlan(S, [embarque], [compra.compra]),
              [movimientoAsignar(compra, embarque, 100)],
              [{ linea_id: compra.linea, periodo: "2026-11", unidades: 100 }]
            );
        const revE = await revisionEmbarque(S, embarque);
        const estadoE = await escalar<string>(S, "select estado from public.compra_embarques where id = $1", [embarque]);
        const viajeDeCompra = await escalar<string | null>(S, "select viaje_id from public.compras where id = $1", [compra.compra]);
        const resultados = await Promise.all([
          rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planMovimiento, actor(b.comprador1, "C1")], TIPOS_C),
          rpcEnTransaccion(
            B,
            "asignar_viaje_compras",
            [viajeDeCompra ? null : viaje, [{ id: compra.compra, revision: await revisionCompra(S, compra.compra) }], actor(b.comprador2, "C2")],
            T_VIAJE_COMPRAS
          ),
          rpcEnTransaccion(C, "cambiar_estado_agrupador", ["embarque", embarque, estadoE === "planificado" ? "en_transito" : "volver_a_planificado", revE, null, actor(b.admin, "Admin")], T_CAMBIAR),
          rpcEnTransaccion(D, "guardar_embarque", [{ id: embarque, nombre: `Embarque ns88 r${ronda}`, tipo: "importacion", viaje_id: viaje }, revE, actor(b.admin, "Admin")], T_GUARDAR),
          rpcEnTransaccion(
            F,
            "guardar_viaje",
            [{ id: viaje, nombre: `Viaje ns88 r${ronda}`, fecha_inicio: "2026-10-05", responsable_id: b.comprador1 }, await revisionViaje(viaje), actor(b.admin, "Admin")],
            T_GUARDAR
          ),
        ]);
        resultados.forEach((r, i) => {
          expect(r.error, `ronda ${ronda}, operacion ${i}: ${JSON.stringify(r)}`).toBeNull();
          if (r.data?.ok !== true) expect(motivosValidos, `ronda ${ronda}, operacion ${i}: ${JSON.stringify(r)}`).toContain(r.data?.motivo);
        });
        expect(resultados.some((r) => r.data?.ok === true), `ronda ${ronda}: alguien debe ganar`).toBe(true);
      }
      expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
    } finally {
      for (const x of extras) await x.end().catch(() => undefined);
    }
  });

  /**
   * 08b-1b (migracion 0038): fechas logisticas, ingreso por paquete, `mover_a_paquete` por unidades y numero de OC. Casos (a) a (g) de la
   * ficha 08b-fechas-logisticas.md (seccion Concurrencia). Ninguno debe dar 40P01. Los que dependen de TypeScript (las rutas) quedan para
   * las pruebas de backend: aqui se llama a las funciones de la base con planes armados a mano, como los otros casos de este archivo.
   */
  const TIPOS_OC = ["uuid", "text", "text", "text", "jsonb"];

  /** Plan de `cambiar_fecha` de la 0038 sobre un embarque: `cambios` son las claves del embarque que cambian (clave presente = valor nuevo). */
  function planFechas(
    embarque: string,
    revision: number,
    cambios: Record<string, unknown>,
    o: { compras?: unknown[]; movimientos?: unknown[]; entregas?: unknown[]; paquetes?: unknown[]; causa?: string | null } = {}
  ): Json {
    return plan("cambiar_fecha", [{ id: embarque, revision, ...cambios }], o.compras ?? [], o.movimientos ?? [], o.entregas ?? [], {
      causa: o.causa === undefined ? "naviera" : o.causa,
      paquetes: o.paquetes ?? [],
    });
  }

  async function numeroCompra(compra: string): Promise<string> {
    return escalar<string>(S, "select numero from public.compras where id = $1", [compra]);
  }

  it("(a) cambiar_fecha que cambia el mes (embarque y compra) contra asignar_viaje_compras sobre la misma compra, con el embarque dentro de un viaje: SIN interbloqueo; gana el cambio de fechas y el segundo recibe compra_cambio", async () => {
    const P = await abrir();
    try {
      const esc = await escenarioViajeEmbarque(91);
      const { b, viaje, embarque, compra } = esc;
      const revE = await revisionEmbarque(S, embarque);
      const revCompra = await revisionCompra(S, compra.compra);
      const planFecha = planFechas(embarque, revE, { fecha_llegada_estimada: "2026-12-03" }, {
        causa: "aduana",
        compras: await comprasDelPlan(S, [embarque]),
        movimientos: [{ asignacion_id: esc.asignacion, entrega_id: compra.entrega, linea_id: compra.linea, compra_id: compra.compra, unidades: 100, destino: { periodo: "2026-12", embarque_id: embarque, paquete_id: null } }],
        entregas: [
          { linea_id: compra.linea, periodo: "2026-11", unidades: 0 },
          { linea_id: compra.linea, periodo: "2026-12", unidades: 100 },
        ],
      });
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      await P.query("begin");
      await P.query("select 1 from public.compra_entrega_asignaciones where id = $1 for update", [esc.asignacion]);
      const pA = rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planFecha, actor(b.comprador1, "C1")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      const pB = rpcEnTransaccion(B, "asignar_viaje_compras", [viaje, [{ id: compra.compra, revision: revCompra }], actor(b.comprador2, "C2")], T_VIAJE_COMPRAS);
      await esperarBloqueo(M, pidB);
      await P.query("rollback");
      const [rA, rB]: ResultadoRpc[] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok, JSON.stringify(rA)).toBe(true);
      expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
      expect(await revisionCompra(S, compra.compra)).toBe(revCompra + 1);
      expect(await escalar<string>(S, "select to_char(periodo_llegada, 'YYYY-MM') from public.compra_embarques where id = $1", [embarque])).toBe("2026-12");
      expect(await escalar<string | null>(S, "select viaje_id from public.compras where id = $1", [compra.compra])).toBeNull();
      expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
    } finally {
      await P.query("rollback").catch(() => undefined);
      await P.end().catch(() => undefined);
    }
  });

  it("(b) cambiar_fecha (sostiene el embarque y al final pide el KEY SHARE del viaje) contra guardar_embarque del mismo embarque (sostiene el viaje y espera el embarque): SIN interbloqueo; gana el cambio de fechas y el segundo recibe agrupador_cambio sin escribir", async () => {
    const esc = await escenarioViajeEmbarque(92);
    const { b, viaje, embarque } = esc;
    const rev = await revisionEmbarque(S, embarque);
    const P = await abrirCompuerta("compra_agrupador_eventos");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      const pA = rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planFechas(embarque, rev, { fecha_llegada_estimada: "2026-11-20" }), actor(b.comprador1, "C1")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      const pB = rpcEnTransaccion(
        B,
        "guardar_embarque",
        [{ id: embarque, nombre: "Embarque renombrado", tipo: "importacion", viaje_id: viaje }, rev, actor(b.comprador2, "C2")],
        T_GUARDAR
      );
      await esperarBloqueo(M, pidB);
      await cerrarCompuerta(P);
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok, JSON.stringify(rA)).toBe(true);
      expect(rB.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
      expect(await revisionEmbarque(S, embarque)).toBe(rev + 1);
      expect(await escalar<string>(S, "select nombre from public.compra_embarques where id = $1", [embarque])).toBe("Embarque ns92");
      expect(await escalar<string>(S, "select to_char(fecha_llegada_estimada, 'YYYY-MM-DD') from public.compra_embarques where id = $1", [embarque])).toBe("2026-11-20");
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("(c) ingreso de un paquete (cambiar_fecha con paquetes) contra guardar_paquete sobre el mismo embarque: SIN interbloqueo; gana el ingreso y guardar_paquete recibe agrupador_cambio sin crear el paquete", async () => {
    const esc = await escenarioViajeEmbarque(93);
    const { b, embarque, paquete } = esc;
    const rev = await revisionEmbarque(S, embarque);
    const P = await abrirCompuerta("compra_agrupador_eventos");
    try {
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);
      const pA = rpcEnTransaccion(
        A,
        "aplicar_movimiento_agrupador",
        [planFechas(embarque, rev, {}, { causa: "programacion", paquetes: [{ id: paquete, embarque_id: embarque, fecha_ingreso_estimada: "2026-11-25", ajustado: false }] }), actor(b.comprador1, "C1")],
        TIPOS_C
      );
      await esperarBloqueo(M, pidA);
      const pB = rpcEnTransaccion(B, "guardar_paquete", [{ embarque_id: embarque, nombre: "Paquete nuevo ns93" }, rev, actor(b.comprador2, "C2")], T_GUARDAR);
      await esperarBloqueo(M, pidB);
      await cerrarCompuerta(P);
      const [rA, rB] = await Promise.all([pA, pB]);
      expect(rA.error, `A: ${JSON.stringify(rA)}`).toBeNull();
      expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
      expect(rA.data?.ok, JSON.stringify(rA)).toBe(true);
      expect(rB.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
      expect(await escalar<string>(S, "select to_char(fecha_ingreso_estimada, 'YYYY-MM-DD') from public.compra_paquetes where id = $1", [paquete])).toBe("2026-11-25");
      expect(await contar(S, "compra_paquetes", "embarque_id = $1", [embarque])).toBe(1);
    } finally {
      await cerrarCompuerta(P);
    }
  });

  it("(d) mover_a_paquete por unidades contra «Agregar compras» (asignar a otro embarque) sobre la misma compra: B espera la compra de A y recibe compra_cambio; sin interbloqueo y sin escribir lo de B", async () => {
    const esc = await escenarioViajeEmbarque(94);
    const { b, embarque, paquete } = esc;
    const { c2, otro, asig2 } = await sembrar(async () => {
      const c2 = await sembrarCompra(S, b, { n: 2, referencia: "LK-94-2", estado: "confirmada", perfil: b.comprador1, unidades: 300 });
      return { c2, otro: await sembrarEmbarque(S, b, "Otro embarque ns94"), asig2: await asignarEntrega(S, c2.entrega, embarque, 200) };
    });
    const pidB = await pidDe(B);
    const revC2 = await revisionCompra(S, c2.compra);
    const planMover = plan(
      "mover_a_paquete",
      await embarquesConRevision(S, [embarque]),
      await comprasDelPlan(S, [embarque]),
      [{ asignacion_id: asig2, entrega_id: c2.entrega, linea_id: c2.linea, compra_id: c2.compra, unidades: 100, destino: { periodo: "2026-11", embarque_id: embarque, paquete_id: paquete } }],
      [{ linea_id: c2.linea, periodo: "2026-11", unidades: 300 }]
    );
    const rA = await rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planMover, actor(b.comprador1, "C1")], TIPOS_C, false);
    expect(rA.data?.ok, JSON.stringify(rA)).toBe(true);
    const planAgregar = plan(
      "asignar",
      await embarquesConRevision(S, [otro]),
      [{ id: c2.compra, revision: revC2 }],
      [movimientoAsignar(c2, otro, 100)],
      [{ linea_id: c2.linea, periodo: "2026-11", unidades: 300 }]
    );
    const pB = rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [planAgregar, actor(b.comprador2, "C2")], TIPOS_C);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(await revisionCompra(S, c2.compra)).toBe(revC2 + 1);
    expect(await escalar<string>(S, "select coalesce(sum(unidades), 0) from public.compra_entrega_asignaciones where entrega_id = $1 and paquete_id = $2", [c2.entrega, paquete])).toBe("100");
    expect(await contar(S, "compra_entrega_asignaciones", "entrega_id = $1 and embarque_id = $2", [c2.entrega, otro])).toBe(0);
    expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
  });

  it("(e) editar_oc_compra contra aplicar_movimiento_agrupador sobre la misma compra, en los dos ordenes: los dos terminan y el movimiento NO recibe compra_cambio (la OC no sube la revision)", async () => {
    const esc = await escenarioViajeEmbarque(95);
    const { b, embarque, compra } = esc;
    const act = actor(b.comprador1, "C1");
    const pidB = await pidDe(B);
    const rev0 = await revisionCompra(S, compra.compra);
    // Ronda 1: A pone la OC y B quita la entrega con un plan armado ANTES (revision rev0): B espera la compra y, al confirmar A, se aplica.
    const planQuitar = planQuitarEntrega(esc, await embarquesConRevision(S, [embarque]), await comprasDelPlan(S, [embarque]));
    const rA = await rpcEnTransaccion(A, "editar_oc_compra", [compra.compra, null, "OC-95-1", null, act], TIPOS_OC, false);
    expect(rA.data).toMatchObject({ ok: true, numero_oc: "OC-95-1" });
    const pB = rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [planQuitar, act], TIPOS_C);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
    expect(rB.data?.ok, `el movimiento no debe recibir compra_cambio: ${JSON.stringify(rB)}`).toBe(true);
    expect(await revisionCompra(S, compra.compra)).toBe(rev0 + 1);
    expect(await escalar<string>(S, "select numero_oc from public.compras where id = $1", [compra.compra])).toBe("OC-95-1");
    // Ronda 2: A asigna de nuevo (sostiene la compra) y B cambia la OC: B espera, al confirmar A se aplica (la OC no depende de la revision).
    const planAsignar = plan(
      "asignar",
      await embarquesConRevision(S, [embarque]),
      await comprasDelPlan(S, [embarque], [compra.compra]),
      [movimientoAsignar(compra, embarque, 100)],
      [{ linea_id: compra.linea, periodo: "2026-11", unidades: 100 }]
    );
    const rA2 = await rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planAsignar, act], TIPOS_C, false);
    expect(rA2.data?.ok, JSON.stringify(rA2)).toBe(true);
    const pB2 = rpcEnTransaccion(B, "editar_oc_compra", [compra.compra, "OC-95-1", "OC-95-2", "cambio de numero", actor(b.comprador2, "C2")], TIPOS_OC);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB2 = await pB2;
    expect(rB2.error, `B2: ${JSON.stringify(rB2)}`).toBeNull();
    expect(rB2.data).toMatchObject({ ok: true, numero_oc: "OC-95-2" });
    expect(await revisionCompra(S, compra.compra)).toBe(rev0 + 2);
    expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'editar_oc'", [compra.compra])).toBe(2);
  });

  it("(f) dos editar_oc_compra a la vez con la misma OC sobre dos compras del mismo proveedor: la segunda espera al indice unico y, al confirmar la primera, recibe oc_repetida con el numero de la compra que ya la tiene", async () => {
    const esc = await escenarioViajeEmbarque(96);
    const { b, compra } = esc;
    const c2 = await sembrar(() => sembrarCompra(S, b, { n: 2, referencia: "LK-96-2", estado: "confirmada", perfil: b.comprador1 }));
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "editar_oc_compra", [compra.compra, null, "4500096096", null, actor(b.comprador1, "C1")], TIPOS_OC, false);
    expect(rA.data).toMatchObject({ ok: true, numero_oc: "4500096096" });
    const pB = rpcEnTransaccion(B, "editar_oc_compra", [c2.compra, null, "4500096096", null, actor(b.comprador2, "C2")], TIPOS_OC);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "oc_repetida", compra: await numeroCompra(compra.compra) });
    expect(await escalar<string | null>(S, "select numero_oc from public.compras where id = $1", [c2.compra])).toBeNull();
    expect(await contar(S, "compra_eventos", "compra_id = $1 and accion = 'editar_oc'", [c2.compra])).toBe(0);
    expect(await contar(S, "compras", "upper(numero_oc) = '4500096096'")).toBe(1);
  });

  it("(g) ingreso de un paquete (cambiar_fecha con paquetes) contra mover_paquete del mismo paquete: el que llega segundo recibe agrupador_cambio y nunca queda un ingreso escrito en el embarque equivocado", async () => {
    const esc = await escenarioViajeEmbarque(97);
    const { b, viaje, embarque, paquete } = esc;
    const destino = await sembrar(() => sembrarEmbarque(S, b, "Embarque destino ns97", "2026-11-18", { viaje_id: viaje }));
    const pidB = await pidDe(B);
    const revE = await revisionEmbarque(S, embarque);
    const planMoverPaquete = plan("mover_paquete", await embarquesConRevision(S, [embarque, destino]), [], [], [], {
      paquete_a_mover: { paquete_id: paquete, embarque_destino_id: destino },
    });
    const rA = await rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planMoverPaquete, actor(b.comprador1, "C1")], TIPOS_C, false);
    expect(rA.data?.ok, JSON.stringify(rA)).toBe(true);
    const planIngreso = planFechas(embarque, revE, {}, { causa: "programacion", paquetes: [{ id: paquete, embarque_id: embarque, fecha_ingreso_estimada: "2026-11-25", ajustado: false }] });
    const pB = rpcEnTransaccion(B, "aplicar_movimiento_agrupador", [planIngreso, actor(b.comprador2, "C2")], TIPOS_C);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.error, `B: ${JSON.stringify(rB)}`).toBeNull();
    expect(rB.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
    expect(await escalar<string | null>(S, "select fecha_ingreso_estimada::text from public.compra_paquetes where id = $1", [paquete])).toBeNull();
    expect(await escalar<string>(S, "select embarque_id from public.compra_paquetes where id = $1", [paquete])).toBe(destino);
    expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
  });

  it("publicar_carga_venta_stock: dos publicaciones simultaneas de la misma carga se serializan: la segunda recibe no_en_curso y queda UNA publicada", async () => {
    const t = await sembrar(async () => {
      const base = await sembrarBase(S, 79);
      const tienda = await S.query<{ id: string }>("insert into public.tiendas (codigo, nombre, tipo) values ('T79', 'TIENDA 79', 'Tienda') returning id");
      const marca = await S.query<{ id: string }>("with a as (insert into public.agrupaciones_marca (codigo, nombre) values ('AG79', 'AG 79') returning id) insert into public.marcas (codigo, nombre, agrupacion_marca_id) select 'MA79', 'MARCA 79', id from a returning id");
      const talla = await S.query<{ id: string }>("insert into public.agrupaciones_talla (codigo, nombre) values ('TA79', 'TALLA 79') returning id");
      const eq = await S.query<{ id: string }>("insert into public.equivalencias (genero_mundo_linea_id, codigo, nombre) values ($1, 'EQ79', 'EQUIV 79') returning id", [base.gml]);
      const carga = await S.query<{ id: string }>("insert into public.cargas_venta_stock (periodo, estado) values ('2031-09-01', 'en_curso') returning id");
      await S.query(
        "insert into public.venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles) values ($1, $2, $3, $4, $5, 10, 700.5)",
        [carga.rows[0].id, tienda.rows[0].id, eq.rows[0].id, marca.rows[0].id, talla.rows[0].id]
      );
      return carga.rows[0].id;
    });
    const args = [t, 1, 10, 700.5, 0, 0, 0];
    const T = ["uuid", "bigint", "bigint", "numeric", "numeric", "bigint", "numeric"];
    const pidB = await pidDe(B);
    const rA = await rpcEnTransaccion(A, "publicar_carga_venta_stock", args, T, false);
    expect(rA.data?.ok).toBe(true);
    const pB = rpcEnTransaccion(B, "publicar_carga_venta_stock", args, T);
    await esperarBloqueo(M, pidB);
    await A.query("commit");
    const rB = await pB;
    expect(rB.data).toEqual({ ok: false, motivo: "no_en_curso" });
    expect(await contar(S, "cargas_venta_stock", "periodo = '2031-09-01' and estado = 'publicada'")).toBe(1);
  });

  describe("aplicar_lote_proyeccion", () => {
    async function preparar(ns: number) {
      const e = await sembrarProyeccion(S, ns);
      const fila = await escalar<string>(S, "select id from public.proyeccion_filas where proyeccion_id = $1 and clave = $2", [e.proy, `IT${ns}-F1`]);
      return { e, fila };
    }
    function carga(e: Awaited<ReturnType<typeof preparar>>["e"], fila: string, ns: number, loteId: string, proy: string, calculado: string): Json {
      const reg = e.registros.get(`IT${ns}-F1|2026`);
      if (!reg) throw new Error("sin registro");
      return {
        lote: {
          id: loteId, confirmacion_id: randomUUID(), proyeccion_id: proy, tipo: "aprobar", anio: 2026, huella_cuerpo: "a".repeat(64),
          calculado_at_esperado: calculado, filtro: {}, efecto_gm_previsto: [], revision_confirmada: true, propuestas_gm: [], nota: "it",
          perfil_id: e.b.admin, usuario_nombre: "IT",
        },
        grupos: [
          {
            tipo: "metodo", gm_clave: "GM-UNO", registros_lectura: [],
            filas: [
              {
                fila_id: fila, fila_clave: `IT${ns}-F1`, anio: 2026, fuente: "metodo", valor: 1000, valor_esperado: 1000,
                registros: [
                  {
                    id: reg.id, updated_at_esperado: reg.iso, objetivo: true,
                    set: {
                      decidido: 1000, origen: "propuesta", propuesta_al_decidir: 1000, nota: null, decidido_at: new Date().toISOString(),
                      decidido_por_id: e.b.admin, decidido_por_nombre: "IT", decision_ia_fila_id: null, decision_lote_id: loteId,
                    },
                  },
                ],
              },
            ],
          },
        ],
      } as Json;
    }

    it("el MISMO lote_id enviado dos veces a la vez: B espera el candado de la proyeccion y recibe repetido=true; el lote se escribe una sola vez", async () => {
      const { e, fila } = await preparar(81);
      const loteId = randomUUID();
      const p = carga(e, fila, 81, loteId, e.proy, e.calculadoIso);
      const pidB = await pidDe(B);
      const rA = await rpcEnTransaccion(A, "aplicar_lote_proyeccion", [p], ["jsonb"], false);
      expect(rA.error).toBeNull();
      expect(rA.data).toMatchObject({ repetido: false });
      const pB = rpcEnTransaccion(B, "aplicar_lote_proyeccion", [p], ["jsonb"]);
      await esperarBloqueo(M, pidB);
      await A.query("commit");
      const rB = await pB;
      expect(rB.error).toBeNull();
      expect(rB.data).toMatchObject({ repetido: true, lote_id: loteId });
      expect(await contar(S, "proyeccion_lotes", "id = $1", [loteId])).toBe(1);
      expect(await contar(S, "proyeccion_lote_filas", "lote_id = $1", [loteId])).toBe(1);
    });

    it("el mismo lote_id en OTRA proyeccion a la vez: B espera el indice unico, y al confirmar A recibe LP004 lote_ajeno por la ruta de unique_violation", async () => {
      const { e, fila } = await preparar(82);
      const loteId = randomUUID();
      // La segunda proyeccion necesita sus propios registros: se usa la fila de B creada por el fixture solo si existe; se arma una.
      const filaB = (
        await S.query<{ id: string }>(
          "insert into public.proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, clave, nivel_proyectado, historico) select $1, gml_id, agrupacion_marca_id, 'IT82-B1', 'GML', '{}'::jsonb from public.proyeccion_filas where id = $2 returning id",
          [e.proyB, fila]
        )
      ).rows[0].id;
      await S.query("insert into public.proyeccion_fila_anios (fila_id, anio, bloque, vendido, propuesto, metodo) values ($1, 2026, 'mismas', 100, 1000, 'avance')", [filaB]);
      const regB = await S.query<{ id: string; iso: string }>(`select id, ${iso("updated_at")} as iso from public.proyeccion_fila_anios where fila_id = $1`, [filaB]);
      const pA = carga(e, fila, 82, loteId, e.proy, e.calculadoIso);
      const pBase = carga(e, fila, 82, loteId, e.proyB, e.calculadoIsoB) as { lote: Record<string, Json>; grupos: { filas: { fila_id: string; fila_clave: string; registros: { id: string; updated_at_esperado: string }[] }[] }[] };
      pBase.grupos[0].filas[0].fila_id = filaB;
      pBase.grupos[0].filas[0].fila_clave = "IT82-B1";
      pBase.grupos[0].filas[0].registros[0].id = regB.rows[0].id;
      pBase.grupos[0].filas[0].registros[0].updated_at_esperado = regB.rows[0].iso;
      const pidB = await pidDe(B);

      const rA = await rpcEnTransaccion(A, "aplicar_lote_proyeccion", [pA], ["jsonb"], false);
      expect(rA.error).toBeNull();
      const pB = rpcEnTransaccion(B, "aplicar_lote_proyeccion", [pBase], ["jsonb"]);
      await esperarBloqueo(M, pidB);
      await A.query("commit");
      const rB = await pB;
      expect(rB.data).toBeNull();
      expect(rB.error).toMatchObject({ codigo: "LP004", mensaje: "lote_ajeno" });
      expect(await contar(S, "proyeccion_lotes", "id = $1", [loteId])).toBe(1);
      expect(await escalar<string>(S, "select proyeccion_id from public.proyeccion_lotes where id = $1", [loteId])).toBe(e.proy);
      // Lo que B habia escrito antes de chocar (su fila) quedo deshecho.
      expect(await escalar<number | null>(S, "select decidido from public.proyeccion_fila_anios where fila_id = $1", [filaB])).toBeNull();
    });
  });
});
