import { describe, expect, it } from "vitest";
import { avisosEmbarque, avisosPaquete } from "@/lib/compras/agrupadores/avisos";
import { estaDesalineada, mesDeDestino, periodoLlegada, planAsignar, planCambiarFechas, planMoverAPaquete, verificarAlineacion } from "@/lib/compras/agrupadores/movimiento";
import { responsableEfectivo } from "@/lib/compras/agrupadores/responsable";
import { AHORA_F, ASIGNACION_F, COMPRA_AGR, EMBARQUE_F, ENTREGA_AGR, LINEA_AGR, PAQUETE_F, paquetesTandas, perfilesAgrupadores } from "./agrupadores.fixture";
import { ctxF, embarqueDe, motivo, ok, siguiente } from "./agrupadores.fechas.soporte";

/**
 * 08b-1b F-R1 y §2.4 bis: el mes del flujo es el del ingreso al stock y el mes de una asignación es `mesDeDestino(embarque, paquete)`; la
 * misma regla en los planes, los avisos y la alineación (F1, F34 a F38 están en `agrupadores.paquete-ingreso.test.ts`).
 */

describe("periodoLlegada: mes de coalesce(real, ingreso al stock, Ingreso CD)", () => {
  it("el real manda; si no, el ingreso fijado; si no, el Ingreso CD", () => {
    expect(periodoLlegada(null, null, "2026-11-15")).toBe("2026-11");
    expect(periodoLlegada(null, "2026-12-02", "2026-11-15")).toBe("2026-12");
    expect(periodoLlegada("2027-01-03", "2026-12-02", "2026-11-15")).toBe("2027-01");
    expect(periodoLlegada(undefined, undefined, "2026-12-31")).toBe("2026-12");
  });
  it("F1: sin ingreso al stock fijado el mes es el del Ingreso CD (nov); con ingreso 02-dic, dic", () => {
    expect(periodoLlegada(null, null, "2026-11-15")).toBe("2026-11");
    expect(periodoLlegada(null, "2026-12-02", "2026-11-15")).toBe("2026-12");
  });
});

describe("mesDeDestino(embarque, paquete) = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)", () => {
  it("la misma regla para cualquier combinación", () => {
    const e = { periodo_llegada: "2026-11" };
    expect(mesDeDestino(e, null)).toBe("2026-11");
    expect(mesDeDestino(e, undefined)).toBe("2026-11");
    expect(mesDeDestino(e, { periodo_ingreso: null })).toBe("2026-11");
    expect(mesDeDestino(e, { periodo_ingreso: "2027-01" })).toBe("2027-01");
  });
});

describe("avisos: `desalineada` contra el mes de destino de cada asignación", () => {
  const perfiles = perfilesAgrupadores();
  const responsable = responsableEfectivo({ propio: perfiles[0].id }, perfiles);
  const embarque = { estado: "planificado" as const, fecha_llegada_estimada: "2027-03-05", periodo_llegada: "2027-03" };
  const activa = { historica: false, linea_recibida: false };

  it("una asignación de un paquete con ingreso propio, alineada a su paquete, no está desalineada aunque el embarque sea de otro mes", () => {
    const asignaciones = [{ ...activa, periodo: "2027-05", paquete_id: "p", periodo_destino: "2027-05" }];
    expect(avisosEmbarque({ embarque, viaje: null, responsable, asignaciones, hoy: "2026-11-12" })).not.toContain("desalineada");
    expect(avisosPaquete({ paquete: { estado: "abierto" }, embarque, responsable, asignaciones })).not.toContain("desalineada");
  });
  it("la que no está en su mes de destino sí; sin `periodo_destino` se compara con el mes del embarque (08b-1)", () => {
    const mala = [{ ...activa, periodo: "2027-03", paquete_id: "p", periodo_destino: "2027-05" }];
    expect(avisosEmbarque({ embarque, viaje: null, responsable, asignaciones: mala, hoy: "2026-11-12" })).toContain("desalineada");
    expect(avisosPaquete({ paquete: { estado: "abierto" }, embarque, responsable, asignaciones: mala })).toContain("desalineada");
    expect(avisosEmbarque({ embarque, viaje: null, responsable, asignaciones: [{ ...activa, periodo: "2027-05" }], hoy: "2026-11-12" })).toContain("desalineada");
    expect(avisosEmbarque({ embarque, viaje: null, responsable, asignaciones: [{ ...activa, periodo: "2027-03" }], hoy: "2026-11-12" })).not.toContain("desalineada");
  });
  it("una histórica no cuenta", () => {
    expect(avisosEmbarque({ embarque, viaje: null, responsable, asignaciones: [{ historica: true, linea_recibida: false, periodo: "2025-01", periodo_destino: "2027-03" }], hoy: "2026-11-12" })).not.toContain("desalineada");
  });
  it("estaDesalineada compara contra el mes de destino que se le pasa", () => {
    expect(estaDesalineada("2027-05-01", "2027-05")).toBe(false);
    expect(estaDesalineada("2027-03", "2027-05")).toBe(true);
  });
});

describe("verificarAlineacion por asignación (I2 generalizada)", () => {
  const asignaciones = [
    { embarque_id: "e", paquete_id: null, periodo: "2027-03", unidades: 5 },
    { embarque_id: "e", paquete_id: "p", periodo: "2027-05", unidades: 5 },
    { embarque_id: "e", paquete_id: "p", periodo: "2027-03", unidades: 5 },
    { embarque_id: "e", paquete_id: "p", periodo: "2027-01", unidades: 0 },
  ];
  const mesDe = (a: { paquete_id?: string | null }) => (a.paquete_id ? "2027-05" : "2027-03");
  it("devuelve solo las asignaciones con unidades que no están en su mes de destino", () => {
    expect(verificarAlineacion(asignaciones, mesDe)).toEqual([{ embarque_id: "e", periodo: "2027-03", esperado: "2027-05" }]);
  });
  it("sin mes esperado (`undefined`) no se verifica", () => {
    expect(verificarAlineacion(asignaciones, () => undefined)).toEqual([]);
  });
});

describe("los planes calculan el mes con la misma regla", () => {
  it("planAsignar con paquete destino de ingreso propio lleva las unidades al mes del paquete (y a un paquete heredero, al del embarque)", () => {
    const base = ctxF({ paquetes: paquetesTandas() });
    const c = siguiente(base, ok(planCambiarFechas({ embarque_id: EMBARQUE_F.e270301, revision: 1, paquetes: [{ id: PAQUETE_F.tanda2, fecha_ingreso: "2027-05-10" }], motivo: "Soltar en mayo", causa: "programacion", ahora: AHORA_F }, base)).aplicable);
    const item = { entrega_id: ENTREGA_AGR.l2Abr, unidades: 50, compra_revision: c.compras.find((x) => x.id === COMPRA_AGR.c101)?.revision as number };
    const entrada = (paquete: string | null) => ({ embarque_id: EMBARQUE_F.e270301, revision: embarqueDe(c, EMBARQUE_F.e270301).revision, paquete_id: paquete, items: [item] });
    expect(ok(planAsignar(entrada(PAQUETE_F.tanda2), c)).aplicable.movimientos[0].destino.periodo).toBe("2027-05");
    expect(ok(planAsignar(entrada(PAQUETE_F.tanda1), c)).aplicable.movimientos[0].destino.periodo).toBe("2027-03");
    expect(ok(planAsignar(entrada(null), c)).aplicable.movimientos[0].destino.periodo).toBe("2027-03");
  });

  it("mover a paquete de otro mes y sacar del paquete de vuelta al mes del embarque (con motivo y causa)", () => {
    const base = ctxF({ paquetes: paquetesTandas() });
    const c = siguiente(base, ok(planCambiarFechas({ embarque_id: EMBARQUE_F.e270301, revision: 1, paquetes: [{ id: PAQUETE_F.tanda1, fecha_ingreso: "2027-04-04" }], motivo: "Abril", causa: "programacion", ahora: AHORA_F }, base)).aplicable);
    const dentro = siguiente(c, ok(planMoverAPaquete({ embarque_id: EMBARQUE_F.e270301, revision: embarqueDe(c, EMBARQUE_F.e270301).revision, paquete_id: PAQUETE_F.tanda1, asignaciones: [ASIGNACION_F.l2Mar], motivo: "m", causa: "programacion" }, c)).aplicable);
    expect(dentro.entregas.filter((e) => e.linea_id === LINEA_AGR.l2).map((e) => e.periodo).sort()).toEqual(["2027-04"]);
  });

  it("una asignación que no es del embarque o con un paquete de otro embarque se rechaza", () => {
    const c = ctxF({ paquetes: paquetesTandas() });
    expect(motivo(planMoverAPaquete({ embarque_id: EMBARQUE_F.e270401, revision: 1, paquete_id: PAQUETE_F.tanda1, asignaciones: [] }, c))).toBe("paquete_de_otro_embarque");
  });
});

describe("`llegada_antes_de_compra` dice contra qué compara", () => {
  it("«El ingreso al stock (mes del flujo: mar-27) es anterior al mes de la orden de compra de C-000101 (jul-26): el ingreso se rechazará»", () => {
    const c = ctxF({ compras: ctxF().compras.map((x) => (x.id === COMPRA_AGR.c101 ? { ...x, fecha_compra: "2027-07-06" } : x)) });
    const r = ok(planAsignar({ embarque_id: EMBARQUE_F.e270301, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l2Abr, unidades: 10, compra_revision: 3 }] }, c));
    expect(r.vista.avisos.find((a) => a.aviso === "llegada_antes_de_compra")?.detalle).toBe(
      "El ingreso al stock (mes del flujo: mar-27) es anterior al mes de la orden de compra de C-000101 (jul-27): el ingreso se rechazará.",
    );
  });
});
