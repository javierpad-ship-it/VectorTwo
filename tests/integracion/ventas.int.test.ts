import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HAY_BASE, abrirConTransaccion, cerrarConRollback, comoRol, contar, escalar, filas, rpc, sembrarBase, type Base } from "./ayudas";

/**
 * M5 `publicar_carga_venta_stock` (0007) y M7 `venta_tienda_nodos` (0033) contra Postgres real: conciliacion, reemplazo de la carga
 * publicada del mismo mes (indice unico parcial), y la lectura por tienda con un documento de mas de 1 000 series (el corte de
 * PostgREST es por FILAS; la funcion devuelve UN jsonb).
 */
describe.skipIf(!HAY_BASE)("ventas (Postgres real)", () => {
  let c: Client;
  let b: Base;
  let marca: string;
  let talla: string;
  let eq: string[];

  const publicar = (carga: string, f: number, u: number, v: number, costo: number, su: number, sv: number) =>
    rpc(c, "publicar_carga_venta_stock", [carga, f, u, v, costo, su, sv], ["uuid", "bigint", "bigint", "numeric", "numeric", "bigint", "numeric"]);

  async function tienda(codigo: string, tipo = "Tienda"): Promise<string> {
    const r = await c.query<{ id: string }>("insert into public.tiendas (codigo, nombre, tipo) values ($1, $2, $3) returning id", [codigo, `TIENDA ${codigo}`, tipo]);
    return r.rows[0].id;
  }
  async function carga(periodo: string, estado = "en_curso"): Promise<string> {
    const r = await c.query<{ id: string }>(
      "insert into public.cargas_venta_stock (periodo, estado, publicada_at) values ($1, $2, case when $2 = 'publicada' then now() else null end) returning id",
      [periodo, estado]
    );
    return r.rows[0].id;
  }
  async function hecho(cargaId: string, tiendaId: string, e: string, unidades: number, soles: number, stockU = 0, stockV = 0, costo = 0) {
    await c.query(
      "insert into public.venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles, costo_vendido, stock_unidades, stock_valorizado) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [cargaId, tiendaId, e, marca, talla, unidades, soles, costo, stockU, stockV]
    );
  }

  beforeEach(async () => {
    c = await abrirConTransaccion();
    b = await sembrarBase(c, 41);
    marca = (await c.query<{ id: string }>("with a as (insert into public.agrupaciones_marca (codigo, nombre) values ('AG41', 'AG 41') returning id) insert into public.marcas (codigo, nombre, agrupacion_marca_id) select 'MA41', 'MARCA 41', id from a returning id")).rows[0].id;
    talla = (await c.query<{ id: string }>("insert into public.agrupaciones_talla (codigo, nombre) values ('TA41', 'TALLA 41') returning id")).rows[0].id;
    eq = [];
    for (const n of [1, 2, 3]) {
      eq.push((await c.query<{ id: string }>("insert into public.equivalencias (genero_mundo_linea_id, codigo, nombre) values ($1, $2, $3) returning id", [b.gml, `EQ41${n}`, `EQUIV ${n} IT41`])).rows[0].id);
    }
  });
  afterEach(async () => {
    await cerrarConRollback(c);
  });

  describe("publicar_carga_venta_stock", () => {
    it("concilia contra lo realmente cargado y publica: totales medidos por la base, estado publicada", async () => {
      const t1 = await tienda("T41A");
      const t2 = await tienda("T41B");
      const k = await carga("2026-09-01");
      await hecho(k, t1, eq[0], 10, 700.5, 4, 40, 300);
      await hecho(k, t2, eq[0], 5, 350.25, 2, 20, 150);
      const r = await publicar(k, 2, 15, 1050.75, 450, 6, 60);
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ ok: true, reemplaza: null, medido: { filas: 2, unidades: 15, venta_soles: 1050.75, stock_unidades: 6 } });
      const f = await filas<{ estado: string; filas: number; unidades: string; publicada_at: string | null }>(
        c,
        "select estado, filas, unidades::text, publicada_at from public.cargas_venta_stock where id = $1",
        [k]
      );
      expect(f[0]).toMatchObject({ estado: "publicada", filas: 2, unidades: "15" });
      expect(f[0].publicada_at).not.toBeNull();
    });

    it("no_concilia: si algun total declarado difiere, devuelve esperado y medido y NO cambia nada (la carga sigue en_curso)", async () => {
      const t1 = await tienda("T41A");
      const k = await carga("2026-09-01");
      await hecho(k, t1, eq[0], 10, 700.5);
      const r = await publicar(k, 1, 11, 700.5, 0, 0, 0);
      expect(r.data).toMatchObject({ ok: false, motivo: "no_concilia", esperado: { unidades: 11 }, medido: { unidades: 10 } });
      expect(await escalar<string>(c, "select estado from public.cargas_venta_stock where id = $1", [k])).toBe("en_curso");
    });

    it("no_en_curso: una carga que no existe o ya publicada no se publica otra vez", async () => {
      const t1 = await tienda("T41A");
      const k = await carga("2026-09-01");
      await hecho(k, t1, eq[0], 10, 700.5);
      expect((await publicar(k, 1, 10, 700.5, 0, 0, 0)).data?.ok).toBe(true);
      expect((await publicar(k, 1, 10, 700.5, 0, 0, 0)).data).toEqual({ ok: false, motivo: "no_en_curso" });
      expect((await publicar("00000000-0000-4000-8000-00000000abcd", 0, 0, 0, 0, 0, 0)).data).toEqual({ ok: false, motivo: "no_en_curso" });
    });

    it("recarga del mismo mes: la publicada anterior pasa a reemplazada y queda UNA sola publicada", async () => {
      const t1 = await tienda("T41A");
      const vieja = await carga("2026-09-01");
      await hecho(vieja, t1, eq[0], 10, 700.5);
      expect((await publicar(vieja, 1, 10, 700.5, 0, 0, 0)).data?.ok).toBe(true);
      const nueva = await carga("2026-09-01");
      await hecho(nueva, t1, eq[0], 12, 840.6);
      await hecho(nueva, t1, eq[1], 3, 210.15);
      const r = await publicar(nueva, 2, 15, 1050.75, 0, 0, 0);
      expect(r.data).toMatchObject({ ok: true, reemplaza: { id: vieja, filas: 1 } });
      expect(await escalar<string>(c, "select estado from public.cargas_venta_stock where id = $1", [vieja])).toBe("reemplazada");
      expect(await contar(c, "cargas_venta_stock", "periodo = '2026-09-01' and estado = 'publicada'")).toBe(1);
      const vigente = await escalar<string>(c, "select sum(unidades)::text from public.venta_stock_vigente where periodo = '2026-09-01'");
      expect(vigente).toBe("15");
    });

    it("los indices unicos parciales impiden dos publicadas o dos en_curso del mismo mes (23505)", async () => {
      await carga("2026-09-01", "publicada");
      const dosPublicadas = await comoRol(c, null, "insert into public.cargas_venta_stock (periodo, estado) values ('2026-09-01', 'publicada')");
      expect(dosPublicadas.error?.codigo).toBe("23505");
      await carga("2026-10-01", "en_curso");
      const dosEnCurso = await comoRol(c, null, "insert into public.cargas_venta_stock (periodo, estado) values ('2026-10-01', 'en_curso')");
      expect(dosEnCurso.error?.codigo).toBe("23505");
    });
  });

  describe("venta_tienda_nodos", () => {
    const nodos = (gml: string[] | null, desde: string, hasta: string) =>
      rpc(c, "venta_tienda_nodos", [gml, desde, hasta], ["uuid[]", "date", "date"]);
    type Serie = { t: string; p: string; u: number; s: number };

    it("devuelve series por (tienda, mes) con unidades netas y soles, solo tipo Tienda (jamas el CD), solo cargas publicadas, rango inclusivo y orden estable", async () => {
      const t1 = await tienda("T41A");
      const t2 = await tienda("T41B");
      const cd = await tienda("CD41", "Centro de Distribución");
      const k1 = await carga("2026-01-01", "publicada");
      const k2 = await carga("2026-02-01", "publicada");
      const k3 = await carga("2026-03-01", "publicada");
      const retirada = await carga("2026-02-01", "retirada");
      await hecho(k1, t1, eq[0], 100, 7000);
      await hecho(k1, t1, eq[1], 50, 3500);
      await hecho(k2, t1, eq[0], -10, -700);
      await hecho(k2, t2, eq[0], 40, 2800);
      await hecho(k2, cd, eq[0], 9999, 1);
      await hecho(k3, t1, eq[0], 1, 70);
      await hecho(retirada, t1, eq[0], 777, 777);
      const r = await nodos([b.gml], "2026-01-01", "2026-02-01");
      expect(r.error).toBeNull();
      const series = r.data?.series as Serie[];
      expect(series).toHaveLength(3);
      expect(series.find((x) => x.t === t1 && x.p === "2026-01")).toMatchObject({ u: 150, s: 10500 });
      expect(series.find((x) => x.t === t1 && x.p === "2026-02")).toMatchObject({ u: -10, s: -700 });
      expect(series.find((x) => x.t === t2 && x.p === "2026-02")).toMatchObject({ u: 40, s: 2800 });
      expect(series.some((x) => x.t === cd)).toBe(false);
      expect(series.some((x) => x.p === "2026-03")).toBe(false);
      expect(Object.keys(r.data?.cargas as object)).toEqual(["2026-01", "2026-02"]);
      const orden = series.map((x) => `${x.t}|${x.p}`);
      expect(orden).toEqual([...orden].sort());
      for (const s of series) expect(Object.keys(s).sort()).toEqual(["p", "s", "t", "u"]);
    });

    it("cuadra con la fuente: la suma del documento = la suma de venta_stock_vigente de las equivalencias del nodo en tiendas Tienda", async () => {
      const ts = [await tienda("T41A"), await tienda("T41B"), await tienda("T41C")];
      for (const periodo of ["2025-11-01", "2025-12-01", "2026-01-01"]) {
        const k = await carga(periodo, "publicada");
        for (const t of ts) for (const e of eq) await hecho(k, t, e, 7, 491.75);
      }
      const r = await nodos([b.gml], "2025-11-01", "2026-01-01");
      const series = r.data?.series as Serie[];
      const sumaDoc = series.reduce((a, x) => a + x.u, 0);
      const sumaSoles = series.reduce((a, x) => a + Number(x.s), 0);
      const directo = await filas<{ u: string; s: string }>(
        c,
        "select sum(v.unidades)::text as u, sum(v.venta_soles)::text as s from public.venta_stock_vigente v join public.tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda' join public.equivalencias e on e.id = v.equivalencia_id where e.genero_mundo_linea_id = $1",
        [b.gml]
      );
      expect(sumaDoc).toBe(Number(directo[0].u));
      expect(sumaSoles).toBeCloseTo(Number(directo[0].s), 2);
      expect(series).toHaveLength(9);
    });

    it("nodos nulos o vacios o rango nulo dan series = []; un nodo ajeno no suma nada", async () => {
      const t1 = await tienda("T41A");
      const k = await carga("2026-01-01", "publicada");
      await hecho(k, t1, eq[0], 5, 100);
      expect((await nodos(null, "2026-01-01", "2026-01-01")).data?.series).toEqual([]);
      expect((await nodos([], "2026-01-01", "2026-01-01")).data?.series).toEqual([]);
      expect((await nodos([b.gml], null as unknown as string, "2026-01-01")).data).toEqual({ series: [], cargas: {} });
      expect((await nodos(["00000000-0000-4000-8000-00000000abcd"], "2026-01-01", "2026-01-01")).data?.series).toEqual([]);
    });

    it("limite de PostgREST: un nodo con mas de 1 000 series sale en UN documento (una fila) y dentro de un presupuesto de tiempo", async () => {
      // 40 tiendas x 36 meses = 1 440 series (> 1 000 filas) y 4 320 hechos.
      await c.query(
        "insert into public.tiendas (codigo, nombre, tipo) select 'TX' || g, 'TIENDA X' || g, 'Tienda' from generate_series(1, 40) g"
      );
      await c.query(
        "insert into public.cargas_venta_stock (periodo, estado, publicada_at) select (date '2023-01-01' + (g || ' month')::interval)::date, 'publicada', now() from generate_series(0, 35) g"
      );
      await c.query(
        `insert into public.venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles)
         select k.id, t.id, e.id, $2, $3, 3, 210.75
           from public.cargas_venta_stock k, public.tiendas t, public.equivalencias e
          where t.codigo like 'TX%' and e.id = any($1::uuid[])`,
        [eq, marca, talla]
      );
      const t0 = Date.now();
      const r = await nodos([b.gml], "2023-01-01", "2025-12-01");
      const ms = Date.now() - t0;
      expect(r.error).toBeNull();
      expect((r.data?.series as Serie[]).length).toBe(1440);
      expect(Object.keys(r.data?.cargas as object)).toHaveLength(36);
      // PostgREST corta a los 8 s; el presupuesto de la ficha 07f es <= 3 s en frio. Holgura amplia para una CI lenta.
      expect(ms).toBeLessThan(5000);
    });
  });
});
