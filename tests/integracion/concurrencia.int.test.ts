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
   * HALLAZGO (ver informe): aplicar_movimiento_agrupador bloquea embarque -> compras y AL FINAL inserta eventos con `viaje_id` del
   * embarque (FK: FOR KEY SHARE sobre el viaje). asignar_viaje_compras bloquea viaje (FOR UPDATE) -> compras. Con un embarque DENTRO de
   * un viaje y una compra compartida, los dos pueden esperarse en cruz: Postgres detecta el interbloqueo (40P01) y aborta a UNO, que
   * no deja nada escrito; ni compras.revision ni los eventos quedan a medias. Lo que garantiza la prueba es esa seguridad (un perdedor
   * con 40P01 limpio y datos coherentes); NO que el interbloqueo no exista. El backend de agrupadores no traduce 40P01 (la API
   * respondera 500 generico); la aprobacion de lotes si lo traduce a `conflicto_reintentar`.
   *
   * Se fuerza la ventana: un tercer cliente (P) retiene una fila de asignacion que A necesita despues de tomar sus candados.
   */
  it("embarque dentro de un viaje: aplicar_movimiento_agrupador y asignar_viaje_compras sobre la misma compra pueden cruzarse; si pasa, Postgres aborta a UNO (40P01) sin dejar datos a medias", async () => {
    const P = await abrir();
    abiertas.push(P);
    try {
      const { b, viaje, embarque, compra } = await sembrar(async () => {
        const base = await sembrarBase(S, 78);
        const v = await sembrarViaje(S, base, "Viaje del embarque");
        const e = await sembrarEmbarque(S, base, "Embarque en viaje", "2026-11-15", { viaje_id: v });
        const s = await sembrarCompra(S, base, { n: 1, referencia: "DL-1", estado: "confirmada", perfil: base.comprador1 });
        await asignarEntrega(S, s.entrega, e, 100);
        return { b: base, viaje: v, embarque: e, compra: s };
      });
      const asignacion = await escalar<string>(S, "select id from public.compra_entrega_asignaciones where embarque_id = $1", [embarque]);
      const planQuitar = plan(
        "quitar",
        await embarquesConRevision(S, [embarque]),
        await comprasDelPlan(S, [embarque]),
        [{ asignacion_id: asignacion, entrega_id: compra.entrega, linea_id: compra.linea, compra_id: compra.compra, unidades: 100, destino: null }],
        [{ linea_id: compra.linea, periodo: "2026-11", unidades: 100 }]
      );
      const revCompra = await revisionCompra(S, compra.compra);
      const pidA = await pidDe(A);
      const pidB = await pidDe(B);

      // P retiene la fila de asignacion: A tomara embarque y compra y se parara al intentar quitarla.
      await P.query("begin");
      await P.query("select 1 from public.compra_entrega_asignaciones where id = $1 for update", [asignacion]);
      const pA = rpcEnTransaccion(A, "aplicar_movimiento_agrupador", [planQuitar, actor(b.comprador1, "C1")], TIPOS_C);
      await esperarBloqueo(M, pidA);
      // B toma el viaje (FOR UPDATE) y se queda esperando la compra que A ya tiene.
      const pB = rpcEnTransaccion(B, "asignar_viaje_compras", [viaje, [{ id: compra.compra, revision: revCompra }], actor(b.comprador2, "C2")], ["uuid", "jsonb", "jsonb"]);
      await esperarBloqueo(M, pidB);
      await P.query("rollback"); // A sigue: ahora necesita el viaje (FOR KEY SHARE) que B tiene (FOR UPDATE)

      const [rA, rB]: ResultadoRpc[] = await Promise.all([pA, pB]);
      const errores = [rA, rB].filter((r) => r.error !== null);
      const gano = (r: ResultadoRpc) => r.data?.ok === true;
      if (errores.length > 0) {
        // Interbloqueo: exactamente uno aborta con 40P01 y el otro termina bien.
        expect(errores).toHaveLength(1);
        expect(errores[0].error?.codigo).toBe("40P01");
        expect([rA, rB].filter(gano)).toHaveLength(1);
      }
      // Sea cual sea el resultado, el estado final es coherente: la revision de la compra sube solo por quien gano, sin desalineaciones.
      const ganadores = [rA, rB].filter(gano).length;
      const rev = await revisionCompra(S, compra.compra);
      expect(rev).toBeGreaterThanOrEqual(revCompra);
      expect(rev - revCompra).toBeLessThanOrEqual(2);
      expect(rev - revCompra).toBeGreaterThanOrEqual(ganadores > 0 ? 1 : 0);
      expect(await escalar<string>(S, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
      // Nada a medias: cada evento de compra corresponde a una operacion que se confirmo.
      const eventos = await filas<{ accion: string }>(S, "select accion from public.compra_eventos where compra_id = $1 and accion in ('asignar_agrupador', 'asignar_viaje')", [compra.compra]);
      expect(eventos.length).toBe(rev - revCompra);
    } finally {
      try {
        await P.query("rollback");
      } catch {
        // ya cerrada
      }
    }
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
