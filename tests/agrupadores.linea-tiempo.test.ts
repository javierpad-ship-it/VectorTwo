import { describe, expect, it } from "vitest";
import { lineaDeTiempo, proximoHito, textoEstadoHito, textoMesTramo, tramosConHitoVencido, type CompraParaLineaTiempo } from "@/lib/compras/agrupadores/hitos";
import { ASIGNACION_F, COMPRA_AGR, EMBARQUE_F, ENTREGA_AGR, HOY_F, PAQUETE_F, paquetesTandas } from "./agrupadores.fixture";
import { ctxF, embarqueDe, siguiente, ok } from "./agrupadores.fechas.soporte";
import { planIngresoPaquete } from "@/lib/compras/agrupadores/movimiento";
import { AHORA_F } from "./agrupadores.fixture";

/**
 * 08b-1b §3.4: línea de tiempo de la compra (un tramo por (embarque, paquete) más uno «Sin embarque» por mes) y su próximo hito (F-R13; F14,
 * F15, F25 y F39 en la compra). Hoy = 2026-11-12. Puro y sin base.
 */

const ENTREGAS_C101 = [
  { id: ENTREGA_AGR.l1Nov, periodo: "2026-11", unidades: 300 },
  { id: ENTREGA_AGR.l1Dic, periodo: "2026-12", unidades: 200 },
  { id: ENTREGA_AGR.l2Mar, periodo: "2027-03", unidades: 600 },
  { id: ENTREGA_AGR.l2Abr, periodo: "2027-04", unidades: 400 },
];
const C101: CompraParaLineaTiempo = { fecha_compra: "2026-07-06", entregas: ENTREGAS_C101 };

const tramos = (compra: CompraParaLineaTiempo, c = ctxF(), asignaciones = c.asignaciones) => lineaDeTiempo(compra, asignaciones, c.embarques, c.paquetes, HOY_F);
const resumen = (t: ReturnType<typeof tramos>) => t.map((x) => [x.embarque?.codigo ?? "Sin embarque", x.mes, x.unidades]);

describe("F25: línea de tiempo y próximo hito de C-000101 (fixture de partida)", () => {
  const t = tramos(C101);

  it("tramos: 261101 nov 300 · Sin embarque dic 200 · 270301 mar 600 · Sin embarque abr 400; Σ = 1 500 = Σ de sus líneas", () => {
    expect(resumen(t)).toEqual([
      ["261101", "2026-11", 300],
      ["Sin embarque", "2026-12", 200],
      ["270301", "2027-03", 600],
      ["Sin embarque", "2027-04", 400],
    ]);
    expect(t.reduce((s, x) => s + x.unidades, 0)).toBe(ENTREGAS_C101.reduce((s, e) => s + e.unidades, 0));
  });

  it("en 261101: la orden de compra `real` (06/07/2026), Zarpe 05-oct `real`, Arribo 08-nov `vencido`, Ingreso CD 15-nov `previsto`", () => {
    const h = Object.fromEntries(t[0].hitos.map((x) => [x.hito, x]));
    expect(t[0].hitos.map((x) => x.hito)).toEqual(["orden_compra", "zarpe", "arribo", "ingreso_cd", "inicio_operativo", "ingreso_stock"]);
    expect(h.orden_compra).toMatchObject({ fecha: "2026-07-06", estado: "real" });
    expect(h.zarpe).toMatchObject({ fecha: "2026-10-05", estado: "real" });
    expect(h.arribo).toMatchObject({ fecha: "2026-11-08", estado: "vencido" });
    expect(h.ingreso_cd).toMatchObject({ fecha: "2026-11-15", estado: "previsto" });
    expect(h.inicio_operativo).toMatchObject({ fecha: null, estado: "pendiente" });
    expect(h.ingreso_stock).toMatchObject({ fecha: "2026-11-15", estado: "previsto", manda_el_mes: true, igual_a_ingreso_cd: true });
    expect(t[0].embarque).toMatchObject({ codigo: "261101", origen: null });
  });

  it("próximo hito: el vencido más antiguo, «Arribo · 08-nov · Vencido (hace 4 días)», y los otros tres tramos siguen abiertos", () => {
    const p = proximoHito(t);
    expect(p).toEqual({ hito: "arribo", fecha: "2026-11-08", hora: null, estado: "vencido", embarque_codigo: "261101", tramos_mas: 3 });
    expect(textoEstadoHito(t[0].hitos[2], HOY_F)).toBe("08/11/2026 · Debía ocurrir hace 4 días");
    expect(tramosConHitoVencido(t)).toBe(true);
  });

  it("sin el Zarpe confirmado, el vencido más antiguo sería el Zarpe (por eso el fixture lo confirma)", () => {
    const c = ctxF({ embarques: ctxF().embarques.map((e) => (e.id === EMBARQUE_F.e261101 ? { ...e, hito_confirmado: null } : e)) });
    expect(proximoHito(tramos(C101, c))?.hito).toBe("zarpe");
  });
});

describe("el tramo «Sin embarque»", () => {
  const t = tramos(C101);
  it("lleva la orden de compra real y todo lo demás `pendiente`; el ingreso al stock muestra el mes («dic-26, sin embarque»)", () => {
    const sin = t[1];
    expect(sin.embarque).toBeNull();
    expect(sin.paquete).toBeNull();
    expect(sin.hitos.map((x) => [x.hito, x.estado])).toEqual([
      ["orden_compra", "real"],
      ["zarpe", "pendiente"],
      ["arribo", "pendiente"],
      ["ingreso_cd", "pendiente"],
      ["inicio_operativo", "pendiente"],
      ["ingreso_stock", "pendiente"],
    ]);
    expect(textoMesTramo(sin)).toBe("dic-26, sin embarque");
    expect(textoMesTramo(t[0])).toBe("nov-26");
  });

  it("es siempre `pendiente`, también cuando su mes ya pasó (no se duplica como vencido: lo cubre el «ingreso por confirmar» de M8)", () => {
    const pasado = tramos({ fecha_compra: "2026-07-06", entregas: [{ id: "e1", periodo: "2026-09", unidades: 80 }] }, ctxF(), []);
    expect(pasado).toHaveLength(1);
    expect(pasado[0].hitos.find((x) => x.hito === "ingreso_stock")?.estado).toBe("pendiente");
    expect(tramosConHitoVencido(pasado)).toBe(false);
  });

  it("sin ningún hito fechado, el próximo hito de una compra solo «Sin embarque» es su ingreso al stock (pendiente)", () => {
    const solo = tramos({ fecha_compra: "2026-07-06", entregas: [{ id: "e1", periodo: "2026-12", unidades: 500 }] }, ctxF(), []);
    expect(proximoHito(solo)).toEqual({ hito: "ingreso_stock", fecha: null, hora: null, estado: "pendiente", embarque_codigo: null, tramos_mas: 0 });
  });

  it("una compra sin entregas ni asignaciones no tiene tramos ni próximo hito", () => {
    const vacio = tramos({ fecha_compra: "2026-07-06", entregas: [] }, ctxF(), []);
    expect(vacio).toEqual([]);
    expect(proximoHito(vacio)).toBeNull();
  });
});

describe("F14 y F15: las compras de COTV sin embarque y repartidas en dos embarques", () => {
  const compra201: CompraParaLineaTiempo = { fecha_compra: "2026-07-06", entregas: [{ id: "n1", periodo: "2026-12", unidades: 300 }, { id: "n2", periodo: "2026-12", unidades: 200 }] };

  it("F14: C-000201 (500 u en dic-26 sin embarque): un tramo «Sin embarque · 500 u» con ⚪ 06/07/2026 Ocurrió, los otros pendientes", () => {
    const t = tramos(compra201, ctxF(), []);
    expect(resumen(t)).toEqual([["Sin embarque", "2026-12", 500]]);
    expect(textoEstadoHito(t[0].hitos[0], HOY_F)).toBe("06/07/2026 · Ocurrió ✓");
    expect(t[0].hitos.slice(1).map((x) => textoEstadoHito(x, HOY_F))).toEqual(["Pendiente", "Pendiente", "Pendiente", "Pendiente", "Pendiente"]);
  });

  it("F15: C-000202 con 250 en California (dic) y 250 en Nueva York (ene): dos tramos, uno por embarque, y nada queda sin embarque", () => {
    const base = ctxF();
    const california = { ...embarqueDe(base, EMBARQUE_F.e270401), id: "c0000000-0000-4000-8000-000000000001", codigo: "261201", nombre: "California", origen: "California", fecha_llegada_estimada: "2026-12-15", periodo_llegada: "2026-12" };
    const nuevaYork = { ...embarqueDe(base, EMBARQUE_F.e270601), id: "c0000000-0000-4000-8000-000000000002", codigo: "270101", nombre: "Nueva York", origen: "Nueva York", fecha_llegada_estimada: "2027-01-15", periodo_llegada: "2027-01" };
    const compra202: CompraParaLineaTiempo = { fecha_compra: "2026-07-10", entregas: [{ id: "d1", periodo: "2026-12", unidades: 250 }, { id: "d2", periodo: "2027-01", unidades: 250 }] };
    const t = lineaDeTiempo(
      compra202,
      [
        { entrega_id: "d1", embarque_id: california.id, paquete_id: null, unidades: 250 },
        { entrega_id: "d2", embarque_id: nuevaYork.id, paquete_id: null, unidades: 250 },
      ],
      [california, nuevaYork],
      [],
      HOY_F,
    );
    expect(resumen(t)).toEqual([["261201", "2026-12", 250], ["270101", "2027-01", 250]]);
    expect(t.map((x) => x.embarque?.origen)).toEqual(["California", "Nueva York"]);
    expect(t.some((x) => x.embarque === null)).toBe(false);
  });

  it("varias asignaciones de un mismo (embarque, paquete) suman en un solo tramo", () => {
    const c = ctxF();
    const compra: CompraParaLineaTiempo = { fecha_compra: "2026-07-06", entregas: [{ id: "a", periodo: "2026-11", unidades: 100 }, { id: "b", periodo: "2026-11", unidades: 50 }] };
    const t = lineaDeTiempo(compra, [{ entrega_id: "a", embarque_id: EMBARQUE_F.e261101, paquete_id: null, unidades: 100 }, { entrega_id: "b", embarque_id: EMBARQUE_F.e261101, paquete_id: null, unidades: 50 }], c.embarques, c.paquetes, HOY_F);
    expect(resumen(t)).toEqual([["261101", "2026-11", 150]]);
  });
});

describe("tramos de paquetes con ingreso propio", () => {
  it("el ingreso al stock del tramo es el del paquete, con su nota «del paquete», y el mes es el de destino", () => {
    let c = ctxF({ paquetes: paquetesTandas() });
    c = siguiente(c, ok(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: 1, fecha_ingreso_stock: "2027-04-04", motivo: "Programar", causa: "programacion", ahora: AHORA_F }, c)).aplicable);
    const asignaciones = [{ id: ASIGNACION_F.l2Mar, entrega_id: ENTREGA_AGR.l2Abr, embarque_id: EMBARQUE_F.e270301, paquete_id: PAQUETE_F.tanda1, unidades: 600 }];
    const t = lineaDeTiempo(C101, asignaciones, c.embarques, c.paquetes, HOY_F);
    const tramo = t.find((x) => x.paquete !== null)!;
    expect(tramo.mes).toBe("2027-04");
    expect(tramo.paquete).toMatchObject({ codigo: "270301", nombre: "Al barrer · tanda 1" });
    const ingreso = tramo.hitos.find((x) => x.hito === "ingreso_stock")!;
    expect(ingreso).toMatchObject({ fecha: "2027-04-04", estado: "previsto", del_paquete: { codigo: "270301", nombre: "Al barrer · tanda 1" } });
    expect(ingreso.igual_a_ingreso_cd).toBeUndefined();
    // El Ingreso CD del embarque sigue siendo el suyo.
    expect(tramo.hitos.find((x) => x.hito === "ingreso_cd")?.fecha).toBe("2027-03-05");
  });
});

describe("F39 en la compra: un ingreso `por_confirmar` no es hito vencido", () => {
  const c = ctxF({
    embarques: ctxF().embarques.map((e) => (e.id === EMBARQUE_F.eJavier ? { ...e, estado: "en_transito" as const, fecha_ingreso_estimada: "2026-11-08", hito_confirmado: "ingreso_cd" as const, periodo_llegada: "2026-11" } : e)),
  });
  const compra: CompraParaLineaTiempo = { fecha_compra: "2026-10-20", entregas: [{ id: "x", periodo: "2026-11", unidades: 120 }] };
  const t = lineaDeTiempo(compra, [{ entrega_id: "x", embarque_id: EMBARQUE_F.eJavier, paquete_id: null, unidades: 120 }], c.embarques, c.paquetes, HOY_F);

  it("la compra no sale en «Con hitos vencidos» y su próximo hito es el ingreso «Por confirmar»", () => {
    expect(tramosConHitoVencido(t)).toBe(false);
    expect(proximoHito(t)).toEqual({ hito: "ingreso_stock", fecha: "2026-11-08", hora: null, estado: "por_confirmar", embarque_codigo: "261102", tramos_mas: 0 });
  });
});

describe("tramos de una compra con asignaciones históricas y orden", () => {
  it("ordena por mes y luego por código de embarque, y los embarques no leídos no inventan tramos", () => {
    const c = ctxF();
    const compra: CompraParaLineaTiempo = { fecha_compra: "2026-07-06", entregas: [{ id: "a", periodo: "2026-11", unidades: 10 }, { id: "b", periodo: "2027-03", unidades: 20 }, { id: "z", periodo: "2027-03", unidades: 5 }] };
    const t = lineaDeTiempo(
      compra,
      [
        { entrega_id: "b", embarque_id: EMBARQUE_F.e270301, paquete_id: null, unidades: 20 },
        { entrega_id: "a", embarque_id: EMBARQUE_F.e261101, paquete_id: null, unidades: 10 },
        { entrega_id: "z", embarque_id: "e0000000-0000-4000-8000-0000000000ff", paquete_id: null, unidades: 5 },
      ],
      c.embarques,
      c.paquetes,
      HOY_F,
    );
    // `z` tiene una asignación a un embarque que no se leyó: su unidad no se reparte en un tramo nuevo (se cuenta como asignada, sin tramo).
    expect(resumen(t)).toEqual([["261101", "2026-11", 10], ["270301", "2027-03", 20]]);
  });
  it("COMPRA_AGR existe en el fixture (control del import)", () => {
    expect(COMPRA_AGR.c101).toBeTruthy();
  });
});
