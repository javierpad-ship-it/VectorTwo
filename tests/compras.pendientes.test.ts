import { describe, expect, it } from "vitest";
import { esEntregaVencida, pendientesPorEntrega } from "@/lib/compras/pendientes";
import type { EntregaParaPendientes, RecepcionParaPendientes } from "@/lib/compras/tipos";

/** Regla 4 (parte FIFO) y regla 31 (cancelar cierra el saldo) de la ficha 08. */

const e = (id: string, periodo: string, unidades: number): EntregaParaPendientes => ({ id, periodo, unidades });
const r = (id: string, recibida_periodo: string, unidades: number, fecha_recepcion?: string): RecepcionParaPendientes => ({ id, recibida_periodo, unidades, fecha_recepcion });

const pendientes = (res: ReturnType<typeof pendientesPorEntrega>) => res.entregas.map((x) => x.pendiente);

describe("pendientesPorEntrega: FIFO (regla 4)", () => {
  const entregas = [e("nov", "2026-11", 300), e("dic", "2026-12", 200)];

  it("sin recepciones, cada entrega queda pendiente entera", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, []);
    expect(pendientes(res)).toEqual([300, 200]);
    expect(res.pendiente).toBe(500);
    expect(res.recibidas).toBe(0);
    expect(res.asignaciones).toEqual([]);
  });

  it("100 recibidas en oct: nov queda en 200 y dic en 200", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, [r("r1", "2026-10", 100)]);
    expect(pendientes(res)).toEqual([200, 200]);
    expect(res.entregas.map((x) => x.asignadas)).toEqual([100, 0]);
    expect(res.asignaciones).toEqual([{ recepcion_id: "r1", entrega_id: "nov", unidades: 100 }]);
  });

  it("350 recibidas: nov en 0 y dic en 150 (la recepción se reparte entre las dos entregas)", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, [r("r1", "2026-10", 350)]);
    expect(pendientes(res)).toEqual([0, 150]);
    expect(res.asignaciones).toEqual([
      { recepcion_id: "r1", entrega_id: "nov", unidades: 300 },
      { recepcion_id: "r1", entrega_id: "dic", unidades: 50 },
    ]);
  });

  it("todo recibido deja todo en cero", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, [r("r1", "2026-10", 200), r("r2", "2026-11", 300)]);
    expect(pendientes(res)).toEqual([0, 0]);
    expect(res.pendiente).toBe(0);
    expect(res.recibidas).toBe(500);
  });

  it("una recepción adelantada (de un mes anterior a toda entrega) consume la primera entrega", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, [r("r1", "2026-08", 300)]);
    expect(pendientes(res)).toEqual([0, 200]);
  });

  it("ordena las entregas por periodo aunque lleguen desordenadas y las recepciones por mes, fecha e id", () => {
    const desordenadas = [e("dic", "2026-12", 200), e("nov", "2026-11", 300)];
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, desordenadas, [
      r("b", "2026-10", 150, "2026-10-20"),
      r("a", "2026-10", 200, "2026-10-05"),
    ]);
    expect(res.entregas.map((x) => x.id)).toEqual(["nov", "dic"]);
    expect(res.asignaciones).toEqual([
      { recepcion_id: "a", entrega_id: "nov", unidades: 200 },
      { recepcion_id: "b", entrega_id: "nov", unidades: 100 },
      { recepcion_id: "b", entrega_id: "dic", unidades: 50 },
    ]);
    expect(pendientes(res)).toEqual([0, 150]);
  });

  it("ignora recepciones de cero o negativas y no muta sus argumentos", () => {
    const rec = [r("a", "2026-10", 0), r("b", "2026-10", -5), r("c", "2026-10", 100)];
    const antes = JSON.stringify([entregas, rec]);
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, rec);
    expect(res.recibidas).toBe(100);
    expect(res.asignaciones.map((x) => x.recepcion_id)).toEqual(["c"]);
    expect(JSON.stringify([entregas, rec])).toBe(antes);
  });

  it("recepciones que superan las entregas quedan como sin_asignar (datos incoherentes) y nada es negativo", () => {
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 0 }, entregas, [r("r1", "2026-10", 600)]);
    expect(pendientes(res)).toEqual([0, 0]);
    expect(res.sin_asignar).toBe(100);
  });

  it("una línea sin entregas devuelve todo vacío", () => {
    const res = pendientesPorEntrega({ unidades: 0, unidades_canceladas: 0 }, [], [r("r1", "2026-10", 10)]);
    expect(res.entregas).toEqual([]);
    expect(res.pendiente).toBe(0);
    expect(res.sin_asignar).toBe(10);
  });
});

describe("pendientesPorEntrega: saldo cerrado (regla 31)", () => {
  it("500 en oct 300 · nov 200 con 300 recibidas y 200 canceladas: pendiente 0, lo cancelado cae en la última entrega", () => {
    const res = pendientesPorEntrega(
      { unidades: 500, unidades_canceladas: 200 },
      [e("oct", "2026-10", 300), e("nov", "2026-11", 200)],
      [r("r1", "2026-08", 100), r("r2", "2026-10", 200)],
    );
    expect(res.entregas.map((x) => x.asignadas)).toEqual([300, 0]);
    expect(res.entregas.map((x) => x.canceladas)).toEqual([0, 200]);
    expect(pendientes(res)).toEqual([0, 0]);
    expect(res.pendiente).toBe(0);
    expect(res.canceladas).toBe(200);
  });

  it("lo cancelado se descuenta desde la última entrega hacia atrás, sobre lo que las recepciones no ocuparon", () => {
    const entregas = [e("a", "2026-10", 100), e("b", "2026-11", 100), e("c", "2026-12", 100)];
    const res = pendientesPorEntrega({ unidades: 300, unidades_canceladas: 150 }, entregas, [r("r1", "2026-10", 50)]);
    expect(res.entregas.map((x) => x.asignadas)).toEqual([50, 0, 0]);
    expect(res.entregas.map((x) => x.canceladas)).toEqual([0, 50, 100]);
    expect(pendientes(res)).toEqual([50, 50, 0]);
    expect(res.pendiente).toBe(300 - 50 - 150);
    expect(res.sin_asignar).toBe(0);
  });

  it("un ingreso tardío sobre el saldo cerrado pasa de cancelado a recibido (la nueva recepción ocupa lo que estaba cancelado)", () => {
    const entregas = [e("oct", "2026-10", 300), e("nov", "2026-11", 200)];
    // Antes: 300 recibidas, 200 canceladas. Después: llegan 50 más y quedan 150 canceladas.
    const res = pendientesPorEntrega({ unidades: 500, unidades_canceladas: 150 }, entregas, [r("r1", "2026-10", 300), r("r2", "2026-11", 50)]);
    expect(res.entregas.map((x) => x.asignadas)).toEqual([300, 50]);
    expect(res.entregas.map((x) => x.canceladas)).toEqual([0, 150]);
    expect(res.recibidas).toBe(350);
    expect(res.pendiente).toBe(0);
  });
});

describe("pendientesPorEntrega: invariantes", () => {
  it("Σ pendiente = unidades − recibidas − canceladas con datos coherentes (barrido determinista)", () => {
    let semilla = 12345;
    const azar = (n: number) => {
      semilla = (Math.imul(semilla, 1103515245) + 12345) & 0x7fffffff;
      return semilla % n;
    };
    for (let caso = 0; caso < 300; caso++) {
      const n = 1 + azar(6);
      const entregas = Array.from({ length: n }, (_, i) => e(`e${i}`, `2026-${String(i + 1).padStart(2, "0")}`, 1 + azar(400)));
      const total = entregas.reduce((a, x) => a + x.unidades, 0);
      const recibidasTotal = azar(total + 1);
      const canceladas = azar(total - recibidasTotal + 1);
      const recepciones: RecepcionParaPendientes[] = [];
      let resto = recibidasTotal;
      while (resto > 0) {
        const u = Math.min(resto, 1 + azar(300));
        recepciones.push(r(`r${recepciones.length}`, `2026-${String(1 + azar(12)).padStart(2, "0")}`, u));
        resto -= u;
      }
      const res = pendientesPorEntrega({ unidades: total, unidades_canceladas: canceladas }, entregas, recepciones);
      expect(res.pendiente).toBe(total - recibidasTotal - canceladas);
      expect(res.sin_asignar).toBe(0);
      expect(res.recibidas).toBe(recibidasTotal);
      for (const x of res.entregas) {
        expect(x.pendiente).toBeGreaterThanOrEqual(0);
        expect(x.asignadas + x.canceladas + x.pendiente).toBe(x.unidades);
      }
      const asignado = res.asignaciones.reduce((a, x) => a + x.unidades, 0);
      expect(asignado).toBe(recibidasTotal);
    }
  });
});

describe("esEntregaVencida", () => {
  it("vencida solo si el periodo es ≤ k' y queda pendiente", () => {
    expect(esEntregaVencida({ periodo: "2026-09", pendiente: 500 }, "2026-09")).toBe(true);
    expect(esEntregaVencida({ periodo: "2026-08", pendiente: 1 }, "2026-09")).toBe(true);
    expect(esEntregaVencida({ periodo: "2026-10", pendiente: 500 }, "2026-09")).toBe(false);
    expect(esEntregaVencida({ periodo: "2026-09", pendiente: 0 }, "2026-09")).toBe(false);
  });

  it("acepta periodos como fecha (aaaa-mm-dd) y k' con día", () => {
    expect(esEntregaVencida({ periodo: "2026-09-01", pendiente: 5 }, "2026-09-01")).toBe(true);
    expect(esEntregaVencida({ periodo: "2026-10-01", pendiente: 5 }, "2026-09")).toBe(false);
  });
});
