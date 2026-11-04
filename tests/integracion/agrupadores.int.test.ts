import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HAY_BASE,
  abrirConTransaccion,
  actor,
  asignarEntrega,
  cerrarConRollback,
  comprasDelPlan,
  contar,
  embarquesConRevision,
  escalar,
  filas,
  foto,
  movimientoAsignar,
  plan,
  revisionCompra,
  revisionEmbarque,
  rpc,
  sembrarBase,
  sembrarCompra,
  sembrarEmbarque,
  sembrarViaje,
  uid,
  type Base,
  type CompraSembrada,
  type Json,
} from "./ayudas";

/**
 * Agrupadores de compras (0032 y 0034) contra Postgres real: `aplicar_movimiento_agrupador` (revision y evento solo en las compras
 * tocadas), `importar_agrupadores` (todo o nada, idempotencia) y `asignar_viaje_compras` (ids repetidos, evento en el viaje de origen).
 */
describe.skipIf(!HAY_BASE)("agrupadores (Postgres real)", () => {
  let c: Client;
  let b: Base;

  const movimiento = (plan_: Json) => rpc(c, "aplicar_movimiento_agrupador", [plan_, actor(b.comprador1, "C1")], ["jsonb", "jsonb"]);

  /** Tres compras de 100 u en nov-2026, ya asignadas enteras al embarque E; la primera tiene ademas una linea extra de 50 u sin asignar. */
  async function escenarioM1() {
    const E = await sembrarEmbarque(c, b, "Embarque IT");
    const cs: CompraSembrada[] = [];
    for (let i = 1; i <= 3; i++) {
      const s = await sembrarCompra(c, b, { n: i, referencia: `M1-${i}`, estado: "confirmada", perfil: b.comprador1 });
      await asignarEntrega(c, s.entrega, E, 100);
      cs.push(s);
    }
    const linea = uid(b.ns, 31000);
    await c.query(
      "insert into public.compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario) values ($1, $2, 'especifica', $3, 50, date '2026-11-01', 10)",
      [linea, cs[0].compra, b.gml]
    );
    const en = await c.query<{ id: string }>(
      "insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen) values ($1, date '2026-11-01', 50, 'manual') returning id",
      [linea]
    );
    const extra: CompraSembrada = { compra: cs[0].compra, linea, entrega: en.rows[0].id };
    return { E, cs, extra };
  }

  async function planAsignarExtra(E: string, cs: CompraSembrada[], extra: CompraSembrada): Promise<Json> {
    return plan(
      "asignar",
      await embarquesConRevision(c, [E]),
      await comprasDelPlan(c, [E], [cs[0].compra]),
      [movimientoAsignar(extra, E, 50)],
      [{ linea_id: extra.linea, periodo: "2026-11", unidades: 50 }]
    );
  }

  beforeEach(async () => {
    c = await abrirConTransaccion();
    b = await sembrarBase(c, 21);
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  it("M1: asignar una linea con 3 compras en el plan sube la revision SOLO de la tocada y deja un solo evento", async () => {
    const { E, cs, extra } = await escenarioM1();
    const antes: number[] = [];
    for (const s of cs) antes.push(await revisionCompra(c, s.compra));
    const revE = await revisionEmbarque(c, E);
    const r = await movimiento(await planAsignarExtra(E, cs, extra));
    expect(r.error).toBeNull();
    expect(r.data?.ok).toBe(true);
    const comprasResp = r.data?.compras as { id: string; revision: number }[];
    expect(comprasResp).toHaveLength(1);
    expect(comprasResp[0]).toEqual({ id: cs[0].compra, revision: antes[0] + 1 });
    expect(await revisionCompra(c, cs[0].compra)).toBe(antes[0] + 1);
    expect(await revisionCompra(c, cs[1].compra)).toBe(antes[1]);
    expect(await revisionCompra(c, cs[2].compra)).toBe(antes[2]);
    expect(await revisionEmbarque(c, E)).toBe(revE + 1);
    expect(await contar(c, "compra_eventos", "accion = 'asignar_agrupador' and compra_id = any($1::uuid[])", [cs.map((s) => s.compra)])).toBe(1);
    const ev = await filas<{ compras: { compra_id: string }[] }>(c, "select compras from public.compra_agrupador_eventos where embarque_id = $1 and accion = 'asignar'", [E]);
    expect(ev).toHaveLength(1);
    expect(ev[0].compras.map((x) => x.compra_id)).toEqual([cs[0].compra]);
    expect(await escalar<string>(c, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
  });

  it("M1: una compra del plan que no se toca pero cambio de revision sigue dando compra_cambio, sin escribir nada", async () => {
    const { E, cs, extra } = await escenarioM1();
    const p = await planAsignarExtra(E, cs, extra);
    await c.query("update public.compras set revision = revision + 1 where id = $1", [cs[2].compra]);
    const antes = await foto(c);
    const r = await movimiento(p);
    expect(r.data).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(await foto(c)).toBe(antes);
  });

  it("M1: un plan que omite una compra con asignacion activa del embarque da compra_cambio", async () => {
    const { E, cs, extra } = await escenarioM1();
    const completo = await comprasDelPlan(c, [E], [cs[0].compra]);
    const incompleto = completo.filter((x) => x.id !== cs[2].compra);
    const antes = await foto(c);
    const r = await movimiento(plan("asignar", await embarquesConRevision(c, [E]), incompleto, [movimientoAsignar(extra, E, 50)], [{ linea_id: extra.linea, periodo: "2026-11", unidades: 50 }]));
    expect(r.data).toEqual({ ok: false, motivo: "compra_cambio" });
    expect(await foto(c)).toBe(antes);
  });

  it("agrupador_cambio: un embarque con la revision vencida rechaza el plan y no escribe nada", async () => {
    const { E, cs, extra } = await escenarioM1();
    const p = await planAsignarExtra(E, cs, extra);
    await c.query("update public.compra_embarques set revision = revision + 1 where id = $1", [E]);
    const antes = await foto(c);
    const r = await movimiento(p);
    expect(r.data).toEqual({ ok: false, motivo: "agrupador_cambio" });
    expect(await foto(c)).toBe(antes);
  });

  it("cambiar_fecha dentro del mismo mes no toca ninguna compra; a otro mes mueve las entregas de todas y suben todas", async () => {
    const { E, cs } = await escenarioM1();
    const eb = (await embarquesConRevision(c, [E])).map((e) => ({ ...e, fecha_llegada_estimada: "2026-11-25" }));
    const mismo = await movimiento(plan("cambiar_fecha", eb, [], [], [], {}));
    expect(mismo.data?.ok).toBe(true);
    expect(mismo.data?.compras).toEqual([]);
    expect(await escalar<string>(c, "select fecha_llegada_estimada::text from public.compra_embarques where id = $1", [E])).toBe("2026-11-25");

    const antes: number[] = [];
    for (const s of cs) antes.push(await revisionCompra(c, s.compra));
    const asign = await filas<{ id: string; entrega_id: string; unidades: number; linea_id: string; compra_id: string }>(
      c,
      "select a.id, a.entrega_id, a.unidades, e.linea_id, l.compra_id from public.compra_entrega_asignaciones a join public.compra_linea_entregas e on e.id = a.entrega_id join public.compra_lineas l on l.id = e.linea_id where a.embarque_id = $1",
      [E]
    );
    const movs = asign.map((a) => ({
      asignacion_id: a.id,
      entrega_id: a.entrega_id,
      linea_id: a.linea_id,
      compra_id: a.compra_id,
      unidades: a.unidades,
      destino: { periodo: "2026-12", embarque_id: E, paquete_id: null },
    }));
    const ents = asign.flatMap((a) => [
      { linea_id: a.linea_id, periodo: "2026-11", unidades: 0 },
      { linea_id: a.linea_id, periodo: "2026-12", unidades: a.unidades },
    ]);
    const eb2 = (await embarquesConRevision(c, [E])).map((e) => ({ ...e, fecha_llegada_estimada: "2026-12-10" }));
    const otro = await movimiento(plan("cambiar_fecha", eb2, await comprasDelPlan(c, [E]), movs, ents));
    expect(otro.error).toBeNull();
    expect(otro.data?.ok).toBe(true);
    expect((otro.data?.compras as unknown[]).length).toBe(3);
    for (let i = 0; i < cs.length; i++) expect(await revisionCompra(c, cs[i].compra)).toBe(antes[i] + 1);
    expect(await escalar<string>(c, "select count(*) from public.agrupadores_desalineados()")).toBe("0");
  });

  it("cambiar_fecha sin motivo: motivo_requerido y nada escrito", async () => {
    const { E } = await escenarioM1();
    const eb = (await embarquesConRevision(c, [E])).map((e) => ({ ...e, fecha_llegada_estimada: "2026-11-25" }));
    const antes = await foto(c);
    const r = await movimiento(plan("cambiar_fecha", eb, [], [], [], { motivo: null }));
    expect(r.data).toEqual({ ok: false, motivo: "motivo_requerido" });
    expect(await foto(c)).toBe(antes);
  });

  describe("importar_agrupadores", () => {
    const loteBase = (): Json => ({
      archivo_nombre: "agrupadores-it.csv",
      viajes: [
        { fila: 2, codigo: "261201", nombre: "Viaje diciembre", destino: "Lima", fecha_inicio: "2026-12-01", fecha_fin: "2026-12-10", responsable_id: b.comprador1, nota: null },
        { fila: 3, codigo: null, nombre: "Viaje sin codigo", destino: null, fecha_inicio: "2026-12-15", fecha_fin: null, responsable_id: b.admin, nota: null },
      ],
      embarques: [
        {
          fila: 4, codigo: "IMP-A", nombre: "Embarque A", tipo: "importacion", viaje_id: null, viaje_codigo: "261201", responsable_id: null,
          referencia_logistica: "BL-9", puerto_embarque: "Puerto Sur", fecha_salida_estimada: "2026-12-05", fecha_llegada_estimada: "2027-01-10", nota: null,
        },
      ],
      paquetes: [{ fila: 5, codigo: null, nombre: "Paquete A1", embarque_id: null, embarque_codigo: "IMP-A", responsable_id: b.comprador1, nota: null }],
    });
    const importar = (lote: Json) => rpc(c, "importar_agrupadores", [lote, actor(b.comprador1, "C1")], ["jsonb", "jsonb"]);

    it("crea viajes, embarques y paquetes en una transaccion con codigos autonumerados y un evento 'crear' por agrupador", async () => {
      const r = await importar(loteBase());
      expect(r.error).toBeNull();
      expect(r.data?.ok).toBe(true);
      const creados = r.data?.creados as { tipo: string; fila: number; codigo: string }[];
      expect(creados).toHaveLength(4);
      expect(creados.find((x) => x.tipo === "viaje" && x.fila === 3)?.codigo).toBe("261202");
      expect(creados.find((x) => x.tipo === "paquete")?.codigo).toBe("270101");
      expect(await escalar<string>(c, "select v.codigo from public.compra_embarques e join public.compra_viajes v on v.id = e.viaje_id where e.codigo = 'IMP-A'")).toBe("261201");
      expect(await contar(c, "compra_agrupador_eventos", "accion = 'crear' and motivo = 'Importado de agrupadores-it.csv'")).toBe(4);
    });

    it("idempotencia: aplicar el mismo lote dos veces da clave_existente en la segunda y no duplica nada", async () => {
      const primera = await importar(loteBase());
      expect(primera.data?.ok).toBe(true);
      const conteo = async () => [
        await contar(c, "compra_viajes"),
        await contar(c, "compra_embarques"),
        await contar(c, "compra_paquetes"),
        await contar(c, "compra_agrupador_eventos"),
      ];
      const antes = await conteo();
      const segunda = await importar(loteBase());
      expect(segunda.data).toMatchObject({ ok: false, motivo: "clave_existente", tipo: "viaje" });
      expect(await conteo()).toEqual(antes);
    });

    it("todo o nada: un embarque con responsable no asignable (un planner) deshace tambien los viajes ya creados del lote", async () => {
      const lote = loteBase() as { embarques: { responsable_id: string | null }[] } & Record<string, unknown>;
      lote.embarques[0].responsable_id = b.planner;
      const antes = await foto(c);
      const r = await importar(lote as Json);
      expect(r.data).toMatchObject({ ok: false, motivo: "responsable_no_asignable", tipo: "embarque" });
      expect(await foto(c)).toBe(antes);
      expect(await contar(c, "compra_agrupador_eventos", "motivo = 'Importado de agrupadores-it.csv'")).toBe(0);
    });
  });

  describe("asignar_viaje_compras", () => {
    const asignar = (viaje: string | null, compras: unknown[]) => rpc(c, "asignar_viaje_compras", [viaje, compras, actor(b.comprador1, "C1")], ["uuid", "jsonb", "jsonb"]);
    const cr = (id: string, revision: number) => ({ id, revision });

    it("B2/B3: un id repetido se procesa una vez, y mover de A a B deja evento en el viaje de origen", async () => {
      const VA = await sembrarViaje(c, b, "Viaje A");
      const VB = await sembrarViaje(c, b, "Viaje B", "2026-10-06");
      const s1 = await sembrarCompra(c, b, { n: 1, referencia: "V-1" });
      const s2 = await sembrarCompra(c, b, { n: 2, referencia: "V-2" });
      const r1 = await asignar(VA, [cr(s1.compra, 0), cr(s1.compra, 0), cr(s2.compra, 0)]);
      expect(r1.data?.ok).toBe(true);
      expect(r1.data?.compras).toHaveLength(2);
      expect(await revisionCompra(c, s1.compra)).toBe(1);
      expect(await contar(c, "compra_eventos", "compra_id = $1 and accion = 'asignar_viaje'", [s1.compra])).toBe(1);

      const r2 = await asignar(VB, [cr(s1.compra, 1), cr(s2.compra, 1)]);
      expect(r2.data?.ok).toBe(true);
      // Todos los eventos de la prueba comparten el `now()` de la transaccion: no se puede ordenar por created_at, se busca por contenido.
      const evA = await filas<{ resumen: string; compras: unknown[] }>(
        c,
        "select resumen, compras from public.compra_agrupador_eventos where viaje_id = $1 and accion = 'asignar_viaje'",
        [VA]
      );
      expect(evA).toHaveLength(2);
      const salida = evA.filter((x) => x.resumen.includes("pasadas a otro viaje"));
      expect(salida).toHaveLength(1);
      expect(salida[0].compras).toHaveLength(2);
      const evB = await filas<{ compras: unknown[] }>(c, "select compras from public.compra_agrupador_eventos where viaje_id = $1 and accion = 'asignar_viaje'", [VB]);
      expect(evB).toHaveLength(1);
      expect(evB[0].compras).toHaveLength(2);
    });

    it("revision vencida: compra_cambio sin escribir; el mismo id con dos revisiones tambien", async () => {
      const VA = await sembrarViaje(c, b, "Viaje A");
      const s1 = await sembrarCompra(c, b, { n: 1, referencia: "V-1" });
      await c.query("update public.compras set revision = 5 where id = $1", [s1.compra]);
      const antes = await foto(c);
      const vencida = await asignar(VA, [cr(s1.compra, 0)]);
      const doble = await asignar(VA, [cr(s1.compra, 5), cr(s1.compra, 6)]);
      expect(vencida.data).toEqual({ ok: false, motivo: "compra_cambio" });
      expect(doble.data).toEqual({ ok: false, motivo: "compra_cambio" });
      expect(await foto(c)).toBe(antes);
    });

    it("viaje cancelado bloquea; viaje cerrado acepta con aviso; compra cancelada es no_editable", async () => {
      const cancelado = await sembrarViaje(c, b, "Viaje cancelado");
      const cerrado = await sembrarViaje(c, b, "Viaje cerrado", "2026-10-07");
      await c.query("update public.compra_viajes set estado = 'cancelado' where id = $1", [cancelado]);
      await c.query("update public.compra_viajes set estado = 'cerrado' where id = $1", [cerrado]);
      const s1 = await sembrarCompra(c, b, { n: 1, referencia: "V-1" });
      const sc = await sembrarCompra(c, b, { n: 2, referencia: "V-2", estado: "cancelada" });
      expect((await asignar(cancelado, [cr(s1.compra, 0)])).data).toEqual({ ok: false, motivo: "viaje_cancelado" });
      const ok = await asignar(cerrado, [cr(s1.compra, 0)]);
      expect(ok.data?.ok).toBe(true);
      expect(ok.data?.avisos).toEqual([{ codigo: "viaje_cerrado", viaje: expect.any(String) }]);
      expect((await asignar(cerrado, [cr(sc.compra, 0)])).data).toEqual({ ok: false, motivo: "no_editable" });
    });
  });
});
