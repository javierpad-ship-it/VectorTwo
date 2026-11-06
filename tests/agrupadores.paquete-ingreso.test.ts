import { describe, expect, it } from "vitest";
import { aammDe } from "@/lib/compras/agrupadores/codigos";
import {
  mesDeDestino,
  pisoDePaquete,
  planAsignar,
  planCambiarFechas,
  planIngresoPaquete,
  planMoverAPaquete,
  planMoverPaquete,
  planPasarPendientes,
  type ContextoMovimiento,
  type EntradaCambiarFechas,
} from "@/lib/compras/agrupadores/movimiento";
import { evaluarAgrupadoresDeFilaCompra } from "@/lib/compras/agrupadores/importar";
import { AHORA_F, ASIGNACION_F, COMPRA_AGR, EMBARQUE_F, LINEA_AGR, PAQUETE_F, paquetesTandas } from "./agrupadores.fixture";
import { ctxF, embarqueDe, entregasDeLinea, motivo, ok, paqueteDe, porMes, repartoV2, siguiente } from "./agrupadores.fechas.soporte";
import { REPARTO_BETA_V2 } from "./compras.fixture";

/**
 * 08b-1b §2.5 (lo al barrer): ingreso al stock por paquete, todo junto o por partes, y el mes de destino de cada asignación (F10, F11, F12,
 * F13, F34 a F38). Todo sobre el fixture de F (hoy 2026-11-12): el lote BETA de C-000101 (mar 600 en 270301; abr 400 sin embarque; reparto v2:
 * verano 50/30/20, invierno 30/40/30) y dos paquetes «tanda 1» y «tanda 2» del embarque 270301.
 */

const E = EMBARQUE_F.e270301;
const rev = (c: ContextoMovimiento, id = E) => embarqueDe(c, id).revision;
const revCompra = (c: ContextoMovimiento) => c.compras.find((x) => x.id === COMPRA_AGR.c101)?.revision as number;
const conTandas = () => ctxF({ paquetes: paquetesTandas() });
const MOTIVO = { motivo: "Programar lo al barrer", causa: "programacion" as const };

/** Fija el ingreso propio de un paquete (sin asignaciones, no mueve nada). */
function fijarIngreso(c: ContextoMovimiento, paquete: string, fecha: string | null): ContextoMovimiento {
  return siguiente(c, ok(planIngresoPaquete({ paquete_id: paquete, revision_embarque: rev(c), fecha_ingreso_stock: fecha, ...MOTIVO, ahora: AHORA_F }, c)).aplicable);
}
/** Mueve `unidades` de una asignación al paquete (nulo = sacarla del paquete). */
const moverA = (c: ContextoMovimiento, paquete: string | null, asignacion: string, unidades: number) =>
  planMoverAPaquete({ embarque_id: E, revision: rev(c), paquete_id: paquete, asignaciones: [{ id: asignacion, unidades }], ...MOTIVO }, c);

/** F11: tanda 1 (ingreso 04-abr) con 300 u y tanda 2 (ingreso 10-may) con 300 u. */
function estadoF11(): ContextoMovimiento {
  let c = conTandas();
  c = fijarIngreso(c, PAQUETE_F.tanda1, "2027-04-04");
  c = fijarIngreso(c, PAQUETE_F.tanda2, "2027-05-10");
  c = siguiente(c, ok(moverA(c, PAQUETE_F.tanda1, ASIGNACION_F.l2Mar, 300)).aplicable);
  c = siguiente(c, ok(moverA(c, PAQUETE_F.tanda2, ASIGNACION_F.l2Mar, 300)).aplicable);
  return c;
}

const filasRepartoDe = (c: ContextoMovimiento, lineaId: string, periodo: string) => {
  const entrega = entregasDeLinea(c, lineaId).find((e) => e.periodo === periodo);
  return c.repartos.filter((r) => r.entrega_id === entrega?.id);
};
const porGml = (c: ContextoMovimiento, lineaId: string, periodo: string) => filasRepartoDe(c, lineaId, periodo).map((r) => r.unidades).sort((a, b) => a - b);

describe("mesDeDestino y el piso de un paquete", () => {
  it("el ingreso propio del paquete manda; sin él, el mes del embarque", () => {
    const c = conTandas();
    const e = embarqueDe(c, E);
    expect(mesDeDestino(e, null)).toBe("2027-03");
    expect(mesDeDestino(e, paqueteDe(c, PAQUETE_F.tanda1))).toBe("2027-03");
    expect(mesDeDestino(e, { periodo_ingreso: "2027-05" })).toBe("2027-05");
    expect(mesDeDestino({ periodo_llegada: "2026-12" }, undefined)).toBe("2026-12");
  });
  it("el piso es el ingreso real si ya llegó; si no, el Ingreso CD", () => {
    expect(pisoDePaquete({ fecha_llegada_real: null, fecha_llegada_estimada: "2027-03-05" })).toBe("2027-03-05");
    expect(pisoDePaquete({ fecha_llegada_real: "2027-03-09", fecha_llegada_estimada: "2027-03-05" })).toBe("2027-03-09");
  });
});

describe("F10: todo junto, un paquete «Al barrer» con su ingreso", () => {
  it("con ingreso 04-abr, mover las 600 u de mar: la entrega de mar desaparece, abr queda con 1 000 repartidas con v2 e invierno, y avisa `cambia_temporada`", () => {
    const c = fijarIngreso(conTandas(), PAQUETE_F.tanda1, "2027-04-04");
    const r = ok(moverA(c, PAQUETE_F.tanda1, ASIGNACION_F.l2Mar, 600));
    expect(r.aplicable.causa).toBe("programacion");
    expect(r.vista.avisos.filter((a) => a.aviso === "cambia_temporada")).toEqual([{ aviso: "cambia_temporada", detalle: "BETA: verano → invierno" }]);
    expect(r.vista.avisos.some((a) => a.aviso === "entregas_fusionadas")).toBe(true);
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 1000 });
    expect(porGml(s, LINEA_AGR.l2, "2027-04")).toEqual([300, 300, 400]);
    expect(filasRepartoDe(s, LINEA_AGR.l2, "2027-04").every((f) => f.temporada === "invierno" && f.reparto_version === 2 && f.reparto_id === REPARTO_BETA_V2)).toBe(true);
    expect(s.asignaciones.find((a) => a.paquete_id === PAQUETE_F.tanda1)).toMatchObject({ unidades: 600, id: ASIGNACION_F.l2Mar });
    expect(revCompra(s)).toBe(revCompra(c) + 1);
  });

  it("sin el vector de invierno en v2: `reparto_sin_vector` y nada cambia", () => {
    const c = fijarIngreso(conTandas(), PAQUETE_F.tanda1, "2027-04-04");
    const sinInvierno = { ...c, repartos_por_id: new Map([[REPARTO_BETA_V2, repartoV2(true)]]) };
    expect(motivo(moverA(sinInvierno, PAQUETE_F.tanda1, ASIGNACION_F.l2Mar, 600))).toBe("reparto_sin_vector");
    expect(porMes(sinInvierno, LINEA_AGR.l2)).toEqual({ "2027-03": 600, "2027-04": 400 });
  });

  it("mover a un paquete de otro mes pide motivo y causa; sin cambiar de mes, no", () => {
    const c = fijarIngreso(conTandas(), PAQUETE_F.tanda1, "2027-04-04");
    expect(motivo(planMoverAPaquete({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda1, asignaciones: [ASIGNACION_F.l2Mar] }, c))).toBe("motivo_requerido");
    expect(motivo(planMoverAPaquete({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda1, asignaciones: [ASIGNACION_F.l2Mar], motivo: "Programar" }, c))).toBe("causa_requerida");
    // tanda 2 hereda el mes del embarque (mar): mover ahí no cambia de mes y no pide nada.
    const mismoMes = ok(planMoverAPaquete({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda2, asignaciones: [ASIGNACION_F.l2Mar] }, c));
    expect(mismoMes.aplicable.movimientos[0].destino.periodo).toBe("2027-03");
    expect(mismoMes.aplicable.causa).toBeUndefined();
    expect(mismoMes.aplicable.repartos).toEqual([]);
  });

  it("más unidades que las de la asignación: `excede_entrega`; una asignación ajena: `no_pertenece`", () => {
    const c = conTandas();
    expect(motivo(moverA(c, PAQUETE_F.tanda1, ASIGNACION_F.l2Mar, 601))).toBe("excede_entrega");
    expect(motivo(moverA(c, PAQUETE_F.tanda1, ASIGNACION_F.l1Nov, 10))).toBe("no_pertenece");
  });
});

describe("F11: por partes, dos paquetes con fechas distintas", () => {
  const c = estadoF11();

  it("l2 queda abr 700 (300 de la tanda 1 + 400 sin embarque) · may 300, cada una con el vector de invierno; Σ = 1 000 (I3)", () => {
    expect(porMes(c, LINEA_AGR.l2)).toEqual({ "2027-04": 700, "2027-05": 300 });
    expect(porGml(c, LINEA_AGR.l2, "2027-04")).toEqual([210, 210, 280]);
    expect(porGml(c, LINEA_AGR.l2, "2027-05")).toEqual([90, 90, 120]);
    expect(entregasDeLinea(c, LINEA_AGR.l2).reduce((s, e) => s + e.unidades, 0)).toBe(1000);
    expect(c.asignaciones.filter((a) => a.embarque_id === E).map((a) => [a.paquete_id, a.unidades]).sort()).toEqual([[PAQUETE_F.tanda1, 300], [PAQUETE_F.tanda2, 300]].sort());
  });

  it("F12: con una parte aún sin paquete, mover el Ingreso CD a 02-abr pasa lo que no está en paquete a abr y no mueve el paquete con ingreso propio", () => {
    let m = conTandas();
    m = fijarIngreso(m, PAQUETE_F.tanda1, "2027-04-10");
    m = siguiente(m, ok(moverA(m, PAQUETE_F.tanda1, ASIGNACION_F.l2Mar, 300)).aplicable);
    expect(porMes(m, LINEA_AGR.l2)).toEqual({ "2027-03": 300, "2027-04": 700 });
    const r = ok(planCambiarFechas({ embarque_id: E, revision: rev(m), fecha_ingreso_cd: "2027-04-02", motivo: "La naviera lo atrasa", causa: "naviera", ahora: AHORA_F }, m));
    expect(r.aplicable.movimientos).toHaveLength(1);
    expect(r.aplicable.movimientos[0]).toMatchObject({ unidades: 300, destino: { periodo: "2027-04", paquete_id: null } });
    expect(r.vista.meses).toEqual([{ de: "2027-03", a: "2027-04", unidades: 300 }]);
    expect(r.aplicable.paquetes).toBeUndefined();
    const s = siguiente(m, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 1000 });
    expect(paqueteDe(s, PAQUETE_F.tanda1).fecha_ingreso_estimada).toBe("2027-04-10");
  });

  it("F13: con una recepción vinculada a la asignación de la tanda, cambiar su ingreso de mes da `asignacion_con_recepciones`", () => {
    const vinculada = { ...c, recepciones_vinculadas: new Map([[c.asignaciones.find((a) => a.paquete_id === PAQUETE_F.tanda1)?.id as string, 50]]) };
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: rev(c), fecha_ingreso_stock: "2027-05-20", ...MOTIVO }, vinculada))).toBe("asignacion_con_recepciones");
    // En el mismo mes se permite.
    expect(ok(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: rev(c), fecha_ingreso_stock: "2027-04-25", ...MOTIVO }, vinculada)).ok).toBe(true);
    // Mover esa asignación a otro mes también.
    const mover = planMoverAPaquete({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda2, asignaciones: [vinculada.asignaciones.find((a) => a.paquete_id === PAQUETE_F.tanda1)?.id as string], ...MOTIVO }, vinculada);
    expect(motivo(mover)).toBe("asignacion_con_recepciones");
  });

  it("F34: «Agregar compras» a la tanda 2: 100 u de la entrega abr sin embarque van a may-27 (el mes de la tanda), no a mar-27", () => {
    const r = ok(planAsignar({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda2, items: [{ entrega_id: entregasDeLinea(c, LINEA_AGR.l2).find((e) => e.periodo === "2027-04")?.id as string, unidades: 100, compra_revision: revCompra(c) }] }, c));
    expect(r.aplicable.movimientos[0].destino).toMatchObject({ periodo: "2027-05", paquete_id: PAQUETE_F.tanda2 });
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 600, "2027-05": 400 });
    expect(porGml(s, LINEA_AGR.l2, "2027-05")).toEqual([120, 120, 160]);
    expect(entregasDeLinea(s, LINEA_AGR.l2).reduce((x, e) => x + e.unidades, 0)).toBe(1000);
  });

  it("sin paquete, «Agregar compras» sigue yendo al mes del embarque", () => {
    const r = ok(planAsignar({ embarque_id: E, revision: rev(c), paquete_id: null, items: [{ entrega_id: entregasDeLinea(c, LINEA_AGR.l2).find((e) => e.periodo === "2027-04")?.id as string, unidades: 100, compra_revision: revCompra(c) }] }, c));
    expect(r.aplicable.movimientos[0].destino).toMatchObject({ periodo: "2027-03", paquete_id: null });
  });

  it("F36: mover la tanda 2 (ingreso 10-may) a 270401 (Ingreso CD 20-abr) conserva el 10-may y no cambia ninguna entrega de mes", () => {
    const r = ok(planMoverPaquete({ paquete_id: PAQUETE_F.tanda2, revision: rev(c), embarque_destino_id: EMBARQUE_F.e270401, revision_destino: rev(c, EMBARQUE_F.e270401), motivo: "Sale antes" }, c));
    expect(r.aplicable.paquetes).toBeUndefined();
    expect(r.vista.avisos.some((a) => a.aviso === "ingreso_paquete_ajustado")).toBe(false);
    expect(r.aplicable.entregas).toEqual([]);
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 700, "2027-05": 300 });
    expect(paqueteDe(s, PAQUETE_F.tanda2)).toMatchObject({ embarque_id: EMBARQUE_F.e270401, fecha_ingreso_estimada: "2027-05-10" });
    expect(s.asignaciones.find((a) => a.paquete_id === PAQUETE_F.tanda2)?.embarque_id).toBe(EMBARQUE_F.e270401);

    // Moverla después a 270601 (Ingreso CD 15-jun): el ingreso sube al 15-jun con aviso; may → jun y se reparte de nuevo (invierno, misma versión).
    const r2 = ok(planMoverPaquete({ paquete_id: PAQUETE_F.tanda2, revision: rev(s, EMBARQUE_F.e270401), embarque_destino_id: EMBARQUE_F.e270601, revision_destino: rev(s, EMBARQUE_F.e270601), motivo: "Sale después" }, s));
    expect(r2.vista.avisos.filter((a) => a.aviso === "ingreso_paquete_ajustado")).toHaveLength(1);
    expect(r2.vista.avisos.find((a) => a.aviso === "ingreso_paquete_ajustado")?.detalle).toContain("10-may");
    expect(r2.vista.avisos.find((a) => a.aviso === "ingreso_paquete_ajustado")?.detalle).toContain("15-jun");
    expect(r2.aplicable.paquetes).toEqual([{ id: PAQUETE_F.tanda2, embarque_id: EMBARQUE_F.e270601, fecha_ingreso_estimada: "2027-06-15", ajustado: true }]);
    const s2 = siguiente(s, r2.aplicable);
    expect(paqueteDe(s2, PAQUETE_F.tanda2)).toMatchObject({ embarque_id: EMBARQUE_F.e270601, fecha_ingreso_estimada: "2027-06-15", periodo_ingreso: "2027-06" });
    expect(porMes(s2, LINEA_AGR.l2)).toEqual({ "2027-04": 700, "2027-06": 300 });
    expect(filasRepartoDe(s2, LINEA_AGR.l2, "2027-06").every((f) => f.temporada === "invierno" && f.reparto_version === 2)).toBe(true);
    expect(porGml(s2, LINEA_AGR.l2, "2027-06")).toEqual([90, 90, 120]);
  });

  it("F38 (b): atrasar el Ingreso CD a 20-abr sube la tanda 1 (04-abr) al 20-abr con aviso y sigue en abr; la tanda 2 (10-may) no se mueve", () => {
    const r = ok(planCambiarFechas({ embarque_id: E, revision: rev(c), fecha_ingreso_cd: "2027-04-20", motivo: "Naviera", causa: "naviera", ahora: AHORA_F }, c));
    expect(r.aplicable.paquetes).toEqual([{ id: PAQUETE_F.tanda1, embarque_id: E, fecha_ingreso_estimada: "2027-04-20", ajustado: true }]);
    expect(r.vista.avisos.filter((a) => a.aviso === "ingreso_paquete_ajustado")).toHaveLength(1);
    expect(r.aplicable.movimientos.filter((m) => m.destino.paquete_id === PAQUETE_F.tanda1)).toEqual([]);
    expect(r.aplicable.movimientos).toEqual([]);
    expect(r.vista.cambios.filter((x) => x.hito === "ingreso_paquete")).toEqual([{ hito: "ingreso_paquete", paquete: { id: PAQUETE_F.tanda1, codigo: "270301" }, antes: "2027-04-04", despues: "2027-04-20", dias: 16 }]);
    const s = siguiente(c, r.aplicable);
    expect(paqueteDe(s, PAQUETE_F.tanda1).fecha_ingreso_estimada).toBe("2027-04-20");
    expect(paqueteDe(s, PAQUETE_F.tanda2).fecha_ingreso_estimada).toBe("2027-05-10");
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 700, "2027-05": 300 });
    // No se deshace solo: si el Ingreso CD vuelve a adelantarse, la tanda se queda en la fecha ajustada.
    const vuelve = siguiente(s, ok(planCambiarFechas({ embarque_id: E, revision: rev(s), fecha_ingreso_cd: "2027-04-08", motivo: "Vuelve", causa: "naviera", ahora: AHORA_F }, s)).aplicable);
    expect(paqueteDe(vuelve, PAQUETE_F.tanda1).fecha_ingreso_estimada).toBe("2027-04-20");
  });

  it("F38 (c): moverlo a 12-may sube las dos tandas al 12-may (dos avisos) y todo queda en may; el plan lleva un solo motivo", () => {
    const r = ok(planCambiarFechas({ embarque_id: E, revision: rev(c), fecha_ingreso_cd: "2027-05-12", motivo: "Se atrasa mucho", causa: "naviera", ahora: AHORA_F }, c));
    expect(r.aplicable.paquetes?.map((p) => [p.id, p.fecha_ingreso_estimada, p.ajustado]).sort()).toEqual([[PAQUETE_F.tanda1, "2027-05-12", true], [PAQUETE_F.tanda2, "2027-05-12", true]].sort());
    expect(r.vista.avisos.filter((a) => a.aviso === "ingreso_paquete_ajustado")).toHaveLength(2);
    expect(r.aplicable.motivo).toBe("Se atrasa mucho");
    expect(r.aplicable.causa).toBe("naviera");
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-04": 400, "2027-05": 600 });
    expect(embarqueDe(s, E).periodo_llegada).toBe("2027-05");
  });

  it("que un paquete suba a su piso como consecuencia del cambio del Ingreso CD no pide otro motivo (va en el del Ingreso CD)", () => {
    expect(motivo(planCambiarFechas({ embarque_id: E, revision: rev(c), fecha_ingreso_cd: "2027-04-20", ahora: AHORA_F }, c))).toBe("motivo_requerido");
  });
});

describe("F38 (a): fijar el ingreso de un paquete antes de la llegada", () => {
  it("la tanda 1 con ingreso 01-mar y el Ingreso CD 05-mar: queda el 05-mar con aviso y el mes es mar", () => {
    const c = conTandas();
    const r = ok(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: rev(c), fecha_ingreso_stock: "2027-03-01", ...MOTIVO }, c));
    expect(r.aplicable.paquetes).toEqual([{ id: PAQUETE_F.tanda1, embarque_id: E, fecha_ingreso_estimada: "2027-03-05", ajustado: true }]);
    expect(r.vista.avisos.find((a) => a.aviso === "ingreso_paquete_ajustado")?.detalle).toBe(
      "Al barrer · tanda 1 estaba para el 01-mar, pero el embarque llega al CD el 05-mar: queda el 05-mar. Reprográmalo si quieres otra fecha.",
    );
    const s = siguiente(c, r.aplicable);
    expect(paqueteDe(s, PAQUETE_F.tanda1)).toMatchObject({ fecha_ingreso_estimada: "2027-03-05", periodo_ingreso: "2027-03" });
  });

  it("con el ingreso real del embarque, el piso es el real", () => {
    const base = conTandas();
    const c = { ...base, embarques: base.embarques.map((e) => (e.id === E ? { ...e, fecha_llegada_real: "2027-03-12" } : e)) };
    const r = ok(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: 1, fecha_ingreso_stock: "2027-03-08", ...MOTIVO }, c));
    expect(r.aplicable.paquetes?.[0].fecha_ingreso_estimada).toBe("2027-03-12");
  });

  it("igualar el ingreso del paquete (`null`) hereda el del embarque: sus asignaciones vuelven al mes del embarque", () => {
    const c = estadoF11();
    const r = ok(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda2, revision_embarque: rev(c), fecha_ingreso_stock: null, ...MOTIVO }, c));
    expect(r.aplicable.paquetes).toEqual([{ id: PAQUETE_F.tanda2, embarque_id: E, fecha_ingreso_estimada: null, ajustado: false }]);
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-03": 300, "2027-04": 700 });
  });

  it("un paquete cancelado: `no_editable`; uno que no existe: `no_encontrado`; la revisión vieja: `agrupador_cambio`", () => {
    const c = ctxF({ paquetes: paquetesTandas().map((p) => (p.id === PAQUETE_F.tanda1 ? { ...p, estado: "cancelado" as const } : p)) });
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: 1, fecha_ingreso_stock: "2027-04-04", ...MOTIVO }, c))).toBe("no_editable");
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda2, revision_embarque: 1, fecha_ingreso_stock: "2027-04-04", ...MOTIVO }, ctxF()))).toBe("no_encontrado");
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda2, revision_embarque: 0, fecha_ingreso_stock: "2027-04-04", ...MOTIVO }, conTandas()))).toBe("agrupador_cambio");
  });

  it("un paquete que ya no es del embarque del plan: `agrupador_cambio`", () => {
    const c = conTandas();
    const entrada: EntradaCambiarFechas = { embarque_id: EMBARQUE_F.e270401, revision: 1, paquetes: [{ id: PAQUETE_F.tanda1, fecha_ingreso: "2027-04-25" }], motivo: "x", causa: "otro", ahora: AHORA_F };
    expect(motivo(planCambiarFechas(entrada, c))).toBe("agrupador_cambio");
  });

  it("fijar el ingreso por primera vez pide motivo y causa (cambia el ingreso del paquete)", () => {
    const c = conTandas();
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: 1, fecha_ingreso_stock: "2027-04-04" }, c))).toBe("motivo_requerido");
    expect(motivo(planIngresoPaquete({ paquete_id: PAQUETE_F.tanda1, revision_embarque: 1, fecha_ingreso_stock: "2027-04-04", motivo: "Soltar" }, c))).toBe("causa_requerida");
  });
});

describe("F35: pasar pendientes a un paquete con ingreso propio", () => {
  it("las 400 u de C-000102 (POLO) de 261101 a 270301 / tanda 2 (10-may) quedan en may-27, el mes de la tanda, no en mar-27", () => {
    const c = fijarIngreso(conTandas(), PAQUETE_F.tanda2, "2027-05-10");
    const r = ok(planPasarPendientes({ embarque_id: EMBARQUE_F.e261101, revision: rev(c, EMBARQUE_F.e261101), embarque_destino_id: E, revision_destino: rev(c), paquete_destino_id: PAQUETE_F.tanda2, asignaciones: [ASIGNACION_F.c102Nov], motivo: "Se pasa al lote de mayo" }, c));
    expect(r.aplicable.movimientos).toHaveLength(1);
    expect(r.aplicable.movimientos[0]).toMatchObject({ unidades: 400, destino: { periodo: "2027-05", embarque_id: E, paquete_id: PAQUETE_F.tanda2 } });
    const s = siguiente(c, r.aplicable);
    expect(porMes(s, LINEA_AGR.l102)).toEqual({ "2027-05": 400 });
  });

  it("sin paquete destino, al mes del embarque destino (mar-27)", () => {
    const c = conTandas();
    const r = ok(planPasarPendientes({ embarque_id: EMBARQUE_F.e261101, revision: rev(c, EMBARQUE_F.e261101), embarque_destino_id: E, revision_destino: rev(c), paquete_destino_id: null, asignaciones: [ASIGNACION_F.c102Nov], motivo: "Se pasa" }, c));
    expect(r.aplicable.movimientos[0].destino.periodo).toBe("2027-03");
  });
});

describe("F37 y F17: la regla 3 del importador de compras compara con el mes de destino", () => {
  const catalogo = (periodoIngreso: string | null) => ({
    viajes: [],
    embarques: [{ id: E, codigo: "270301", estado: "planificado" as const, viaje_id: null, periodo_llegada: "2027-03" }],
    paquetes: [{ id: PAQUETE_F.tanda2, codigo: "270302", embarque_id: E, estado: "abierto" as const, periodo_ingreso: periodoIngreso }],
  });
  const fila = (llegada: string, paquete = "270302") => ({
    fila: 1,
    viaje: "",
    embarque: "270301",
    paquete,
    clasificacion: "nueva" as const,
    entregas: [{ periodo: llegada, unidades: 100 }],
    compra_viaje_id: null,
    embarques_asignados: [],
  });

  it("F37: con EMBARQUE 270301 y PAQUETE tanda 2 (may-27), `LLEGADA = 2027-03` es `llegada_distinta_del_embarque`; con `2027-05` entra", () => {
    const malo = evaluarAgrupadoresDeFilaCompra(fila("2027-03"), catalogo("2027-05"));
    expect(malo?.omite_fila).toBe(true);
    expect(malo?.api.motivo).toBe("llegada_distinta_del_embarque");
    const bueno = evaluarAgrupadoresDeFilaCompra(fila("2027-05"), catalogo("2027-05"));
    expect(bueno?.omite_fila).toBe(false);
    expect(bueno?.aplicar).toEqual({ viaje_id: null, embarque_id: E, paquete_id: PAQUETE_F.tanda2 });
  });

  it("un paquete sin ingreso propio, o una fila sin paquete, comparan con el mes del embarque", () => {
    expect(evaluarAgrupadoresDeFilaCompra(fila("2027-03"), catalogo(null))?.omite_fila).toBe(false);
    expect(evaluarAgrupadoresDeFilaCompra(fila("2027-05"), catalogo(null))?.api.motivo).toBe("llegada_distinta_del_embarque");
    expect(evaluarAgrupadoresDeFilaCompra(fila("2027-03", ""), catalogo("2027-05"))?.omite_fila).toBe(false);
  });

  it("F37: lo que entra en may se asigna a la tanda 2 en may y el plan no deja desalineadas (sin AG002)", () => {
    const c = fijarIngreso(conTandas(), PAQUETE_F.tanda2, "2027-05-10");
    const entregaAbr = entregasDeLinea(c, LINEA_AGR.l2).find((e) => e.periodo === "2027-04")?.id as string;
    const s = siguiente(c, ok(planAsignar({ embarque_id: E, revision: rev(c), paquete_id: PAQUETE_F.tanda2, items: [{ entrega_id: entregaAbr, unidades: 400, compra_revision: revCompra(c) }] }, c)).aplicable);
    expect(porMes(s, LINEA_AGR.l2)).toEqual({ "2027-03": 600, "2027-05": 400 });
  });
});

describe("F46: el código de un paquete toma el mes del Ingreso CD de su embarque, no el del ingreso al stock", () => {
  it("embarque con Ingreso CD 15-nov e ingreso al stock 02-dic: el embarque cuenta en dic y su código `2611##`; el paquete, también `2611##`", () => {
    const c = ctxF();
    const e = { ...embarqueDe(c, EMBARQUE_F.e261101), fecha_ingreso_estimada: "2026-12-02", periodo_llegada: "2026-12" };
    expect(e.periodo_llegada).toBe("2026-12");
    expect(aammDe(e.fecha_llegada_estimada)).toBe("2611");
    expect(aammDe(e.periodo_llegada)).toBe("2612");
    // El código del paquete usa el Ingreso CD (`mesPaquete` del importador de agrupadores; `guardar_paquete` en SQL), no `periodo_llegada`.
    expect(aammDe(e.fecha_llegada_estimada)).toBe(aammDe("2026-11-15"));
  });
});
