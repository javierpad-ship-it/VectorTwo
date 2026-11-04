import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pendientesPorEntrega } from "@/lib/compras/pendientes";
import type { NodoAlcance, RepartoParaLinea } from "@/lib/compras/reparto";
import type { EntregaRegistro } from "@/lib/compras/tipos";
import {
  aplicarMovimientos,
  clasificarAsignacion,
  estaDesalineada,
  estimarPendientesAsignaciones,
  huellaPlan,
  mesSiguiente,
  periodoLlegada,
  planAsignar,
  planCambiarFecha,
  planMoverAPaquete,
  planMoverPaquete,
  planPasarPendientes,
  planQuitar,
  planificarMovimiento,
  puedeReintentar,
  resumenDePlan,
  sha256Hex,
  verificarAlineacion,
  type ContextoMovimiento,
  type PlanAplicable,
  type ResultadoPlanMovimiento,
} from "@/lib/compras/agrupadores/movimiento";
import type { AsignacionRegistro } from "@/lib/compras/agrupadores/tipos";
import { MARCA_M8, NODO_M8, REPARTO_BETA_V2 } from "./compras.fixture";
import {
  ASIGNACION_AGR,
  COMPRA_AGR,
  EMBARQUE_AGR,
  ENTREGA_AGR,
  K_PRIMA_AGRUPADORES,
  LINEA_AGR,
  PAQUETE_AGR,
  VECTOR_REPARTO_V2,
  VIAJE_AGR,
  asignacionesCaso1,
  registrosAgrupadores,
  viaje261001,
} from "./agrupadores.fixture";

/**
 * R1 a R6, R12 y R20 de la ficha 08b: movimientos de entregas entre embarques, paquetes y meses (casos 1 a 5, 8, 11, 16 a 19). Todo
 * sobre `planificarMovimiento` y `aplicarMovimientos` con los registros sintéticos de `agrupadores.fixture.ts`, sin base.
 */

const NODOS = new Map<string, NodoAlcance>();
const ETIQUETAS = new Map([
  [LINEA_AGR.l1, "DENIM · ALFA"],
  [LINEA_AGR.l2, "BETA"],
  [LINEA_AGR.l102, "POLO · ALFA"],
  [LINEA_AGR.l103, "CAMISA · GAMMA"],
]);

/** Reparto v2 de BETA con los vectores del fixture (verano 50/30/20 · invierno 30/40/30); `sinInvierno` quita el de invierno (caso 5). */
function repartoV2(sinInvierno = false): RepartoParaLinea {
  const nodos = [NODO_M8.urbano, NODO_M8.polo, NODO_M8.sandalia];
  const fila = (temporada: "verano" | "invierno") => VECTOR_REPARTO_V2[temporada].map((pct, i) => ({ gml_id: nodos[i], equivalencia_id: null, temporada, participacion: pct / 100 }));
  return {
    reparto_id: REPARTO_BETA_V2,
    version: 2,
    modo: "por_temporada",
    error_reparto_pp: 8,
    temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } },
    filas: [...fila("verano"), ...(sinInvierno ? [] : fila("invierno"))],
  };
}

function ctx(cambios: Partial<ContextoMovimiento> = {}): ContextoMovimiento {
  const r = registrosAgrupadores();
  return {
    k_prima: K_PRIMA_AGRUPADORES,
    viajes: r.viajes,
    embarques: r.embarques,
    paquetes: r.paquetes,
    asignaciones: r.asignaciones,
    compras: r.compras,
    lineas: r.lineas,
    entregas: r.entregas,
    repartos: r.repartos,
    recepciones: r.recepciones,
    viaje_de_compra: r.viaje_de_compra,
    repartos_por_id: new Map([[REPARTO_BETA_V2, repartoV2()]]),
    nodos: NODOS,
    etiquetas_linea: ETIQUETAS,
    ...cambios,
  };
}

const conCaso1 = (cambios: Partial<ContextoMovimiento> = {}) => ctx({ asignaciones: asignacionesCaso1(), ...cambios });

function ok(r: ResultadoPlanMovimiento): Extract<ResultadoPlanMovimiento, { ok: true }> {
  if (!r.ok) throw new Error(`se esperaba un plan: ${r.motivo} ${r.detalle ?? ""}`);
  return r;
}
const motivo = (r: ResultadoPlanMovimiento) => (r.ok ? null : r.motivo);

/**
 * Ejecuta un plan sobre el contexto como lo haría `aplicar_movimiento_agrupador`: mueve entregas y asignaciones (`aplicarMovimientos`),
 * escribe los repartos de las entregas tocadas, sube la revisión de las compras con movimientos y de los embarques del plan, y pone la
 * fecha nueva. Es el espejo de la función SQL para encadenar casos; las entregas nuevas reciben el id `nueva-<línea>-<mes>`.
 */
function siguiente(c: ContextoMovimiento, plan: PlanAplicable): ContextoMovimiento {
  const res = aplicarMovimientos(c, plan.movimientos, plan.paquete_a_mover ? [plan.paquete_a_mover] : []);
  if (!res.ok) throw new Error(res.motivo);
  const idNuevo = (lineaId: string, periodo: string) => `nueva-${lineaId}-${periodo}`;
  let entregas: EntregaRegistro[] = [...c.entregas];
  for (const e of res.entregas) {
    const k = (x: EntregaRegistro) => x.linea_id === e.linea_id && x.periodo === e.periodo;
    entregas = e.borrada ? entregas.filter((x) => !k(x)) : e.nueva ? [...entregas, { id: idNuevo(e.linea_id, e.periodo), linea_id: e.linea_id, periodo: e.periodo, unidades: e.unidades, origen: "embarque" }] : entregas.map((x) => (k(x) ? { ...x, unidades: e.unidades } : x));
  }
  // Asignaciones: las que el plan toca se reemplazan por su estado final (ids nuevos para las filas nuevas).
  const idsTocados = new Set(res.asignaciones.filter((a) => a.id !== null).map((a) => a.id as string));
  const idEntrega = (linea: string, periodo: string) => entregas.find((x) => x.linea_id === linea && x.periodo === periodo)?.id as string;
  let n = 0;
  const finales: AsignacionRegistro[] = res.asignaciones
    .filter((a) => !a.borrada)
    .map((a) => ({ id: a.id ?? `nueva-asig-${n++}`, entrega_id: idEntrega(a.linea_id, a.periodo), embarque_id: a.embarque_id, paquete_id: a.paquete_id, unidades: a.unidades }));
  const arrastradas = c.asignaciones
    .filter((a) => !idsTocados.has(a.id))
    .map((a) => (plan.paquete_a_mover && a.paquete_id === plan.paquete_a_mover.paquete_id ? { ...a, embarque_id: plan.paquete_a_mover.embarque_destino_id } : a));
  const paquetes = c.paquetes.map((p) => (plan.paquete_a_mover?.paquete_id === p.id ? { ...p, embarque_id: plan.paquete_a_mover.embarque_destino_id } : p));
  // Repartos de las entregas tocadas de los lotes.
  let repartos = [...c.repartos];
  for (const rp of plan.repartos) {
    const id = idEntrega(rp.linea_id, rp.periodo);
    repartos = repartos.filter((x) => !(x.linea_id === rp.linea_id && x.entrega_id === id));
    repartos.push(...rp.filas.map((f) => ({ linea_id: rp.linea_id, entrega_id: id, ...f })));
  }
  for (const e of res.entregas) if (e.borrada && e.id) repartos = repartos.filter((x) => x.entrega_id !== e.id);
  const compraIds = new Set(plan.movimientos.map((m) => m.compra_id));
  return {
    ...c,
    entregas,
    asignaciones: [...arrastradas, ...finales],
    paquetes,
    repartos,
    compras: c.compras.map((x) => (compraIds.has(x.id) ? { ...x, revision: x.revision + 1 } : x)),
    embarques: c.embarques.map((e) => {
      const p = plan.embarques.find((x) => x.id === e.id);
      if (!p) return e;
      const fecha = p.fecha_llegada_estimada ?? e.fecha_llegada_estimada;
      return { ...e, revision: e.revision + 1, fecha_llegada_estimada: fecha, periodo_llegada: periodoLlegada(e.fecha_llegada_real, fecha) };
    }),
  };
}

const entregasDe = (c: ContextoMovimiento, lineaId: string) => c.entregas.filter((e) => e.linea_id === lineaId).sort((a, b) => (a.periodo < b.periodo ? -1 : 1));
const porMes = (c: ContextoMovimiento, lineaId: string) => Object.fromEntries(entregasDe(c, lineaId).map((e) => [e.periodo, e.unidades]));
const filasDe = (c: ContextoMovimiento, lineaId: string) => {
  const ids = new Map(entregasDe(c, lineaId).map((e) => [e.id, e.periodo]));
  return c.asignaciones
    .filter((a) => ids.has(a.entrega_id))
    .map((a) => ({ periodo: ids.get(a.entrega_id) as string, embarque: a.embarque_id, paquete: a.paquete_id, unidades: a.unidades }))
    .sort((a, b) => (a.periodo + a.embarque < b.periodo + b.embarque ? -1 : 1));
};

/** Invariantes I1 e I3 sobre todo el contexto (R3, R4). */
function verificarInvariantes(c: ContextoMovimiento, unidadesDeLinea: Record<string, number>) {
  for (const e of c.entregas) {
    const asignadas = c.asignaciones.filter((a) => a.entrega_id === e.id).reduce((s, a) => s + a.unidades, 0);
    expect(asignadas, `I1 en la entrega ${e.id}`).toBeLessThanOrEqual(e.unidades);
    expect(e.unidades, "una entrega nunca queda en 0").toBeGreaterThan(0);
  }
  for (const [lineaId, unidades] of Object.entries(unidadesDeLinea)) {
    const es = entregasDe(c, lineaId);
    expect(es.reduce((s, e) => s + e.unidades, 0), `I3: Σ entregas de ${lineaId}`).toBe(unidades);
    expect(es.length).toBeGreaterThanOrEqual(1);
    expect(es.length).toBeLessThanOrEqual(24);
    expect(new Set(es.map((e) => e.periodo)).size, "una entrega por (línea, mes)").toBe(es.length);
  }
  const claves = c.asignaciones.map((a) => `${a.entrega_id}|${a.embarque_id}|${a.paquete_id ?? ""}`);
  expect(new Set(claves).size, "índice único (entrega, embarque, paquete)").toBe(claves.length);
  for (const a of c.asignaciones) {
    if (a.paquete_id) expect(c.paquetes.find((p) => p.id === a.paquete_id)?.embarque_id, "R1: el paquete es del embarque de la asignación").toBe(a.embarque_id);
  }
}
const UNIDADES = { [LINEA_AGR.l1]: 500, [LINEA_AGR.l2]: 1000, [LINEA_AGR.l102]: 400, [LINEA_AGR.l103]: 120 };

const asignarL1 = (c: ContextoMovimiento) =>
  planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 300, compra_revision: 3 }] }, c);

// ─── periodoLlegada (revisión B2) ───

describe("periodoLlegada: la misma regla que la columna generada", () => {
  it("es el mes de coalesce(fecha real, fecha estimada)", () => {
    expect(periodoLlegada(null, "2026-11-20")).toBe("2026-11");
    expect(periodoLlegada(undefined, "2026-12-31")).toBe("2026-12");
    expect(periodoLlegada("2026-12-02", "2026-11-20")).toBe("2026-12");
  });
  it("mesSiguiente cruza el año", () => {
    expect(mesSiguiente("2026-09")).toBe("2026-10");
    expect(mesSiguiente("2026-12")).toBe("2027-01");
  });
});

// ─── Caso 1: asignar sin mover nada ───

describe("caso 1: l1 nov 300 → 261101 / P261101 y dic 200 → 261201 (ya alineadas)", () => {
  it("no mueve ninguna entrega: solo asigna dentro del mismo mes", () => {
    const r = ok(asignarL1(ctx()));
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.aplicable.repartos).toEqual([]);
    expect(r.aplicable.movimientos).toEqual([
      { asignacion_id: null, entrega_id: ENTREGA_AGR.l1Nov, linea_id: LINEA_AGR.l1, compra_id: COMPRA_AGR.c101, unidades: 300, destino: { periodo: "2026-11", embarque_id: EMBARQUE_AGR.e261101, paquete_id: PAQUETE_AGR.p261101 } },
    ]);
    expect(r.vista).toMatchObject({ operacion: "asignar", compras_afectadas: 1, lineas: 1, unidades_movidas: 300 });
    expect(r.vista.movimientos[0]).toMatchObject({ compra_numero: "C-000101", linea: "DENIM · ALFA", unidades: 300, de: { periodo: "2026-11", embarque: null, paquete: null }, a: { periodo: "2026-11", embarque: { codigo: "261101" }, paquete: { codigo: "261101" } } });
    expect(r.vista.avisos).toEqual([]);
    expect(r.aplicable.accion).toBe("asignar");
    expect(r.aplicable.compras).toEqual([{ id: COMPRA_AGR.c101, revision: 3 }]);
    expect(r.aplicable.embarques).toEqual([{ id: EMBARQUE_AGR.e261101, revision: 1 }]);
  });

  it("deja las dos asignaciones del caso y las entregas intactas", () => {
    let c = ctx();
    c = siguiente(c, ok(asignarL1(c)).aplicable);
    c = siguiente(c, ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Dic, unidades: 200, compra_revision: 4 }] }, c)).aplicable);
    expect(porMes(c, LINEA_AGR.l1)).toEqual({ "2026-11": 300, "2026-12": 200 });
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([
      { periodo: "2026-11", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 300 },
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 200 },
    ]);
    // los ids de las entregas no cambian
    expect(entregasDe(c, LINEA_AGR.l1).map((e) => e.id)).toEqual([ENTREGA_AGR.l1Nov, ENTREGA_AGR.l1Dic]);
    verificarInvariantes(c, UNIDADES);
  });
});

// ─── Caso 2 ───

describe("caso 2: un comprador asigna C-000102 (nov) a 261201 (dic)", () => {
  it("la entrega pasa a dic: la de nov se borra y la de dic nace con origen embarque", () => {
    const c = ctx();
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] }, c));
    expect(r.aplicable.entregas).toEqual([
      { linea_id: LINEA_AGR.l102, periodo: "2026-11", unidades: 0 },
      { linea_id: LINEA_AGR.l102, periodo: "2026-12", unidades: 400 },
    ]);
    expect(r.vista.movimientos[0]).toMatchObject({ de: { periodo: "2026-11" }, a: { periodo: "2026-12", embarque: { codigo: "261201" } }, unidades: 400 });
    expect(r.aplicable.compras).toEqual([{ id: COMPRA_AGR.c102, revision: 1 }]);
    const despues = siguiente(c, r.aplicable);
    expect(porMes(despues, LINEA_AGR.l102)).toEqual({ "2026-12": 400 });
    expect(despues.entregas.find((e) => e.linea_id === LINEA_AGR.l102)?.origen).toBe("embarque");
    expect(despues.compras.find((x) => x.id === COMPRA_AGR.c102)?.revision).toBe(2);
    verificarInvariantes(despues, UNIDADES);
  });

  it("C-000102 no tiene viaje y el embarque sí: no es viaje_distinto", () => {
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] }, ctx()));
    expect(r.vista.avisos.map((a) => a.aviso)).not.toContain("viaje_distinto");
  });
});

// ─── Casos 3 y 4: cambiar la fecha y devolverla ───

describe("casos 3 y 4: cambiar la llegada de 261101 al 03-dic y devolverla al 18-nov", () => {
  it("caso 3: l1 queda en dic 500 con dos asignaciones y avisa entregas_fusionadas", () => {
    const c = conCaso1();
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "El proveedor se retrasó" }, c));
    expect(r.aplicable.accion).toBe("cambiar_fecha");
    expect(r.aplicable.motivo).toBe("El proveedor se retrasó");
    expect(r.aplicable.embarques).toEqual([{ id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03" }]);
    expect(r.aplicable.movimientos).toEqual([
      { asignacion_id: ASIGNACION_AGR.l1NovP261101, entrega_id: ENTREGA_AGR.l1Nov, linea_id: LINEA_AGR.l1, compra_id: COMPRA_AGR.c101, unidades: 300, destino: { periodo: "2026-12", embarque_id: EMBARQUE_AGR.e261101, paquete_id: PAQUETE_AGR.p261101 } },
    ]);
    expect(r.aplicable.entregas).toEqual([
      { linea_id: LINEA_AGR.l1, periodo: "2026-11", unidades: 0 },
      { linea_id: LINEA_AGR.l1, periodo: "2026-12", unidades: 500 },
    ]);
    expect(r.vista.avisos).toContainEqual({ aviso: "entregas_fusionadas", detalle: "En dic-2026, C-000101 queda con una sola entrega de 500 u." });
    expect(r.vista.compras_afectadas).toBe(1);
    expect(resumenDePlan(r.vista)).toBe("Mueve 1 línea de 1 compra de nov-2026 a dic-2026");
    // dos asignaciones en la entrega de dic
    const despues = siguiente(c, r.aplicable);
    expect(porMes(despues, LINEA_AGR.l1)).toEqual({ "2026-12": 500 });
    expect(filasDe(despues, LINEA_AGR.l1)).toEqual([
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 300 },
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 200 },
    ]);
    verificarInvariantes(despues, UNIDADES);
  });

  it("caso 4: devolverla al 18-nov deja nov 300 · dic 200 y la entrega que sobrevive (dic) conserva su id", () => {
    let c = conCaso1();
    c = siguiente(c, ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "Retraso" }, c)).aplicable);
    expect(c.embarques.find((e) => e.id === EMBARQUE_AGR.e261101)?.revision).toBe(2);
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 2, fecha_llegada_estimada: "2026-11-18", motivo: "Vuelve a la fecha original" }, c));
    expect(r.vista.avisos.map((a) => a.aviso)).not.toContain("entregas_fusionadas");
    c = siguiente(c, r.aplicable);
    expect(porMes(c, LINEA_AGR.l1)).toEqual({ "2026-11": 300, "2026-12": 200 });
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([
      { periodo: "2026-11", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 300 },
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 200 },
    ]);
    // La de dic sobrevive todo el tiempo y no cambia de id; la de nov se recrea (se borró al quedar en 0 sin asignaciones).
    expect(entregasDe(c, LINEA_AGR.l1).find((e) => e.periodo === "2026-12")?.id).toBe(ENTREGA_AGR.l1Dic);
    verificarInvariantes(c, UNIDADES);
  });

  it("la asignación que se mueve entera a una clave libre conserva su id", () => {
    const c = conCaso1();
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2027-01-15", motivo: "Se pasa a enero" }, c));
    const res = aplicarMovimientos(c, r.aplicable.movimientos);
    if (!res.ok) throw new Error("debía aplicar");
    expect(res.asignaciones.find((a) => a.id === ASIGNACION_AGR.l1NovP261101)).toMatchObject({ periodo: "2027-01", unidades: 300, nueva: false });
    // la entrega de enero es nueva y la de nov se borra
    expect(res.entregas.find((e) => e.periodo === "2027-01")).toMatchObject({ id: null, nueva: true, unidades: 300 });
    expect(res.entregas.find((e) => e.periodo === "2026-11")).toMatchObject({ borrada: true });
  });
});

// ─── R5: mismo mes ───

describe("R5: cambiar la fecha dentro del mismo mes no toca compras ni revisiones", () => {
  it("20-nov → 28-nov: solo cambia el embarque", () => {
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-11-28", motivo: "Ajuste de días" }, conCaso1()));
    expect(r.aplicable.movimientos).toEqual([]);
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.aplicable.compras).toEqual([]);
    expect(r.vista).toMatchObject({ compras_afectadas: 0, lineas: 0, unidades_movidas: 0, movimientos: [] });
    expect(r.aplicable.embarques).toEqual([{ id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-11-28" }]);
    expect(resumenDePlan(r.vista)).toBe("No mueve ninguna entrega.");
  });

  it("con fecha real (08b-2) el mes lo manda la real: cambiar la estimada no mueve nada", () => {
    const c = conCaso1();
    const embarques = c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261101 ? { ...e, fecha_llegada_real: "2026-11-22", periodo_llegada: "2026-11" } : e));
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2027-02-01", motivo: "Solo la estimada" }, { ...c, embarques }));
    expect(r.aplicable.movimientos).toEqual([]);
  });

  it("el motivo es obligatorio y la salida no puede ser posterior a la llegada", () => {
    const c = conCaso1();
    expect(motivo(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "   " }, c))).toBe("motivo_requerido");
    expect(motivo(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-10-01", motivo: "Adelantar" }, c))).toBe("salida_despues_de_llegada");
  });
});

// ─── Caso 5: lote al barrer (R6) ───

describe("caso 5: un lote cambia de temporada al mover su mes (R6)", () => {
  const asignarMar = (c: ContextoMovimiento) =>
    planAsignar({ embarque_id: EMBARQUE_AGR.e270301, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l2Mar, unidades: 600, compra_revision: 3 }] }, c);

  it("asignar l2 mar 600 a 270301 (mismo mes) no mueve ni reparte nada", () => {
    const r = ok(asignarMar(ctx()));
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.aplicable.repartos).toEqual([]);
  });

  it("llevar 270301 a abr-27: la entrega de abr queda en 1 000 repartida con v2 e invierno y la de mar desaparece", () => {
    let c = ctx();
    c = siguiente(c, ok(asignarMar(c)).aplicable);
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e270301, revision: 2, fecha_llegada_estimada: "2027-04-10", motivo: "Sale más tarde" }, c));
    expect(r.aplicable.entregas).toEqual([
      { linea_id: LINEA_AGR.l2, periodo: "2027-03", unidades: 0 },
      { linea_id: LINEA_AGR.l2, periodo: "2027-04", unidades: 1000 },
    ]);
    expect(r.aplicable.repartos).toHaveLength(1);
    const rep = r.aplicable.repartos[0];
    expect(rep).toMatchObject({ linea_id: LINEA_AGR.l2, periodo: "2027-04" });
    // invierno 30 / 40 / 30 sobre 1 000, con la MISMA versión v2
    const porGml = Object.fromEntries(rep.filas.map((f) => [f.genero_mundo_linea_id, f.unidades]));
    expect(porGml).toEqual({ [NODO_M8.urbano]: 300, [NODO_M8.polo]: 400, [NODO_M8.sandalia]: 300 });
    expect(rep.filas.every((f) => f.reparto_id === REPARTO_BETA_V2 && f.reparto_version === 2 && f.temporada === "invierno" && f.marca_id === MARCA_M8.beta)).toBe(true);
    expect(rep.filas.reduce((s, f) => s + f.unidades, 0)).toBe(1000);
    expect(r.vista.avisos).toContainEqual({ aviso: "cambia_temporada", detalle: "BETA: verano → invierno" });
    expect(resumenDePlan(r.vista)).toContain("1 lote cambia de temporada (BETA: verano → invierno)");
    const despues = siguiente(c, r.aplicable);
    expect(porMes(despues, LINEA_AGR.l2)).toEqual({ "2027-04": 1000 });
    verificarInvariantes(despues, UNIDADES);
  });

  it("si v2 no tiene vector de invierno: reparto_sin_vector, y nunca se cambia de versión", () => {
    let c = ctx();
    c = siguiente(c, ok(asignarMar(c)).aplicable);
    const sin = { ...c, repartos_por_id: new Map([[REPARTO_BETA_V2, repartoV2(true)]]) };
    const r = planCambiarFecha({ embarque_id: EMBARQUE_AGR.e270301, revision: 2, fecha_llegada_estimada: "2027-04-10", motivo: "Sale más tarde" }, sin);
    expect(r).toMatchObject({ ok: false, motivo: "reparto_sin_vector" });
  });

  it("sin la versión guardada en M12 también da reparto_sin_vector", () => {
    let c = ctx();
    c = siguiente(c, ok(asignarMar(c)).aplicable);
    const r = planCambiarFecha({ embarque_id: EMBARQUE_AGR.e270301, revision: 2, fecha_llegada_estimada: "2027-04-10", motivo: "x" }, { ...c, repartos_por_id: new Map() });
    expect(motivo(r)).toBe("reparto_sin_vector");
  });

  it("un movimiento parcial de un lote reparte de nuevo origen y destino, completos", () => {
    // 200 de la entrega de mar (600) van a un embarque que llega en abr: mar queda en 400 y abr en 600, las dos repartidas.
    const c = ctx({ embarques: ctx().embarques.map((e) => (e.id === EMBARQUE_AGR.e270301 ? { ...e, fecha_llegada_estimada: "2027-04-15", periodo_llegada: "2027-04" } : e)) });
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e270301, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l2Mar, unidades: 200, compra_revision: 3 }] }, c));
    expect(r.aplicable.entregas).toEqual([
      { linea_id: LINEA_AGR.l2, periodo: "2027-03", unidades: 400 },
      { linea_id: LINEA_AGR.l2, periodo: "2027-04", unidades: 600 },
    ]);
    const totales = Object.fromEntries(r.aplicable.repartos.map((x) => [x.periodo, x.filas.reduce((s, f) => s + f.unidades, 0)]));
    expect(totales).toEqual({ "2027-03": 400, "2027-04": 600 });
    const mar = r.aplicable.repartos.find((x) => x.periodo === "2027-03")?.filas.map((f) => f.temporada);
    const abr = r.aplicable.repartos.find((x) => x.periodo === "2027-04")?.filas.map((f) => f.temporada);
    expect(new Set(mar)).toEqual(new Set(["verano"]));
    expect(new Set(abr)).toEqual(new Set(["invierno"]));
  });

  it("una línea específica no lleva reparto", () => {
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 100, compra_revision: 3 }] }, ctx()));
    expect(r.aplicable.repartos).toEqual([]);
  });

  it("un lote de varias marcas (M9a) se reparte con la proporción que ya tiene el lote", () => {
    const base = ctx();
    const lineas = base.lineas.map((l) => (l.id === LINEA_AGR.l2 ? { ...l, tipo: "barrer_mezcla" as const, marca_id: null } : l));
    const fila = (entrega_id: string, marca_id: string, gml: string, unidades: number) => ({ linea_id: LINEA_AGR.l2, entrega_id, marca_id, genero_mundo_linea_id: gml, equivalencia_id: null, unidades, reparto_id: null, reparto_version: null, temporada: null, error_reparto_pp: null });
    // mezcla 50 / 50: BETA en DENIM y ALFA en POLO, en las dos entregas del lote
    const repartos = [
      ...base.repartos.filter((r) => r.linea_id !== LINEA_AGR.l2),
      fila(ENTREGA_AGR.l2Mar, MARCA_M8.beta, NODO_M8.urbano, 300),
      fila(ENTREGA_AGR.l2Mar, MARCA_M8.alfa, NODO_M8.polo, 300),
      fila(ENTREGA_AGR.l2Abr, MARCA_M8.beta, NODO_M8.urbano, 200),
      fila(ENTREGA_AGR.l2Abr, MARCA_M8.alfa, NODO_M8.polo, 200),
    ];
    const c = { ...base, lineas, repartos, embarques: base.embarques.map((e) => (e.id === EMBARQUE_AGR.e270301 ? { ...e, fecha_llegada_estimada: "2027-04-15", periodo_llegada: "2027-04" } : e)) };
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e270301, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l2Mar, unidades: 300, compra_revision: 3 }] }, c));
    const abr = r.aplicable.repartos.find((x) => x.periodo === "2027-04");
    // abr queda en 400 + 300 = 700, repartida 350 / 350 por los porcentajes del lote; mar queda en 300, 150 / 150
    expect(abr?.filas.map((f) => f.unidades)).toEqual([350, 350]);
    expect(abr?.filas.every((f) => f.reparto_id === null && f.temporada === null)).toBe(true);
    expect(r.aplicable.repartos.find((x) => x.periodo === "2027-03")?.filas.map((f) => f.unidades)).toEqual([150, 150]);
  });
});

describe("planificarMovimiento despacha cada solicitud a su plan", () => {
  it("da lo mismo que llamar a la función de la operación", () => {
    const c = conCaso1();
    const asignar = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 50, compra_revision: 1 }] };
    expect(planificarMovimiento({ operacion: "asignar", ...asignar }, c)).toEqual(planAsignar(asignar, c));
    const quitar = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 3 }] };
    expect(planificarMovimiento({ operacion: "quitar", ...quitar }, c)).toEqual(planQuitar(quitar, c));
    const fecha = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "x" };
    expect(planificarMovimiento({ operacion: "cambiar_fecha", ...fecha }, c)).toEqual(planCambiarFecha(fecha, c));
    const paquete = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261102, asignaciones: [ASIGNACION_AGR.l1NovP261101] };
    expect(planificarMovimiento({ operacion: "mover_a_paquete", ...paquete }, c)).toEqual(planMoverAPaquete(paquete, c));
    const mover = { paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, motivo: "x" };
    expect(planificarMovimiento({ operacion: "mover_paquete", ...mover }, c)).toEqual(planMoverPaquete(mover, c));
    const pasar = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, paquete_destino_id: null, motivo: "x" };
    expect(planificarMovimiento({ operacion: "pasar_pendientes", ...pasar }, c)).toEqual(planPasarPendientes(pasar, c));
  });
});

// ─── Caso 17: asignar parcialmente a otro mes ───

describe("caso 17: asignar 300 de una entrega nov de 500 a 261201 (dic) con 100 sin embarque en dic", () => {
  it("quedan nov 200 y dic 400 (300 en el embarque y 100 sin embarque)", () => {
    const base = ctx();
    const entregas = base.entregas.map((e) => (e.id === ENTREGA_AGR.l1Nov ? { ...e, unidades: 500 } : e.id === ENTREGA_AGR.l1Dic ? { ...e, unidades: 100 } : e));
    const c = { ...base, entregas };
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 300, compra_revision: 3 }] }, c));
    expect(r.aplicable.entregas).toEqual([
      { linea_id: LINEA_AGR.l1, periodo: "2026-11", unidades: 200 },
      { linea_id: LINEA_AGR.l1, periodo: "2026-12", unidades: 400 },
    ]);
    expect(r.vista.avisos.map((a) => a.aviso)).toContain("entregas_fusionadas");
    const despues = siguiente(c, r.aplicable);
    expect(porMes(despues, LINEA_AGR.l1)).toEqual({ "2026-11": 200, "2026-12": 400 });
    expect(filasDe(despues, LINEA_AGR.l1)).toEqual([{ periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 300 }]);
    verificarInvariantes(despues, { ...UNIDADES, [LINEA_AGR.l1]: 600 });
  });
});

// ─── R3: I1 y fusión ───

describe("R3: I1 (Σ asignaciones ≤ entrega) con fusión de asignaciones", () => {
  it("asignar más de lo que queda sin asignar da excede_entrega", () => {
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 301, compra_revision: 3 }] }, ctx()))).toBe("excede_entrega");
    // con 200 ya asignadas, solo quedan 100
    const c = ctx({ asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, entrega_id: ENTREGA_AGR.l1Nov, embarque_id: EMBARQUE_AGR.e261101, paquete_id: null, unidades: 200 }] });
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 101, compra_revision: 3 }] }, c))).toBe("excede_entrega");
    expect(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 100, compra_revision: 3 }] }, c).ok).toBe(true);
  });

  it("asignar dos veces lo mismo suma a la misma fila en vez de crear otra", () => {
    let c = ctx();
    c = siguiente(c, ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 100, compra_revision: 3 }] }, c)).aplicable);
    c = siguiente(c, ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 2, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 150, compra_revision: 4 }] }, c)).aplicable);
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([{ periodo: "2026-11", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 250 }]);
    verificarInvariantes(c, UNIDADES);
  });

  it("dos ítems de la misma entrega suman y el segundo ve lo que dejó el primero", () => {
    const r = planAsignar(
      { embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 200, compra_revision: 3 }, { entrega_id: ENTREGA_AGR.l1Nov, unidades: 101, compra_revision: 3 }] },
      ctx(),
    );
    expect(motivo(r)).toBe("excede_entrega");
  });

  it("mover a paquete que ya tiene filas con la misma clave las funde", () => {
    // 100 en el paquete 261101 y 200 sin paquete, de la misma entrega: pasar las 200 al paquete da una sola fila de 300.
    const asig: AsignacionRegistro[] = [
      { id: "a-con", entrega_id: ENTREGA_AGR.l1Nov, embarque_id: EMBARQUE_AGR.e261101, paquete_id: PAQUETE_AGR.p261101, unidades: 100 },
      { id: "a-sin", entrega_id: ENTREGA_AGR.l1Nov, embarque_id: EMBARQUE_AGR.e261101, paquete_id: null, unidades: 200 },
    ];
    const c = ctx({ asignaciones: asig });
    const r = ok(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261101, asignaciones: ["a-sin"] }, c));
    expect(r.aplicable.entregas).toEqual([]);
    const despues = siguiente(c, r.aplicable);
    expect(filasDe(despues, LINEA_AGR.l1)).toEqual([{ periodo: "2026-11", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 300 }]);
    verificarInvariantes(despues, UNIDADES);
  });
});

// ─── R4 e I3: máximo de entregas ───

describe("R4 e I3: conservan Σ entregas y respetan MAX_ENTREGAS (caso 18)", () => {
  /** La línea l1 con una entrega en cada uno de 24 meses (2026-11 … 2028-10), de 10 u cada una. */
  function lineaDe24() {
    const meses = Array.from({ length: 24 }, (_, i) => `${2026 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}`);
    const entregas = meses.map((periodo, i) => ({ id: `e24-${i}`, linea_id: LINEA_AGR.l1, periodo, unidades: 10, origen: "manual" as const }));
    const base = ctx();
    return {
      meses,
      c: {
        ...base,
        lineas: base.lineas.map((l) => (l.id === LINEA_AGR.l1 ? { ...l, unidades: 240 } : l)),
        entregas: [...base.entregas.filter((e) => e.linea_id !== LINEA_AGR.l1), ...entregas],
        embarques: [...base.embarques, { ...base.embarques[0], id: "emb-nov-28", codigo: "281101", fecha_llegada_estimada: "2028-11-10", fecha_salida_estimada: null, periodo_llegada: "2028-11" }],
      },
    };
  }

  it("la línea que alcanza 25 entregas da max_entregas", () => {
    const { c } = lineaDe24();
    const r = planAsignar({ embarque_id: "emb-nov-28", revision: 1, paquete_id: null, items: [{ entrega_id: "e24-0", unidades: 4, compra_revision: 3 }] }, c);
    expect(r).toMatchObject({ ok: false, motivo: "max_entregas" });
  });

  it("con 24 entregas, mover una entera a un mes nuevo deja 24 y es válido", () => {
    const { c } = lineaDe24();
    const r = ok(planAsignar({ embarque_id: "emb-nov-28", revision: 1, paquete_id: null, items: [{ entrega_id: "e24-0", unidades: 10, compra_revision: 3 }] }, c));
    const despues = siguiente(c, r.aplicable);
    expect(entregasDe(despues, LINEA_AGR.l1)).toHaveLength(24);
    verificarInvariantes(despues, { [LINEA_AGR.l1]: 240 });
  });

  it("mover entregas a un mes que ya existe las funde y baja la cuenta", () => {
    const { c } = lineaDe24();
    const emb = { ...c.embarques[0], id: "emb-dic", codigo: "261299", fecha_llegada_estimada: "2026-12-15", fecha_salida_estimada: null, periodo_llegada: "2026-12" };
    const c2 = { ...c, embarques: [...c.embarques, emb] };
    const r = ok(planAsignar({ embarque_id: "emb-dic", revision: 1, paquete_id: null, items: [{ entrega_id: "e24-0", unidades: 10, compra_revision: 3 }] }, c2));
    const despues = siguiente(c2, r.aplicable);
    expect(entregasDe(despues, LINEA_AGR.l1)).toHaveLength(23);
    expect(porMes(despues, LINEA_AGR.l1)["2026-12"]).toBe(20);
    verificarInvariantes(despues, { [LINEA_AGR.l1]: 240 });
  });
});

// ─── R1: el paquete pertenece a un solo embarque ───

describe("R1: el paquete pertenece a un único embarque", () => {
  it("asignar con el paquete de otro embarque da paquete_de_otro_embarque", () => {
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Dic, unidades: 10, compra_revision: 3 }] }, ctx()))).toBe("paquete_de_otro_embarque");
  });
  it("mover a paquete: el paquete debe ser del embarque (paquete_de_otro_embarque) y la asignación también (no_pertenece)", () => {
    const c = conCaso1();
    expect(motivo(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: PAQUETE_AGR.p261101, asignaciones: [ASIGNACION_AGR.l1Dic261201] }, c))).toBe("paquete_de_otro_embarque");
    expect(motivo(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, asignaciones: [ASIGNACION_AGR.l1NovP261101] }, c))).toBe("no_pertenece");
    expect(motivo(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: "00000000-0000-4000-8000-000000000000", asignaciones: [ASIGNACION_AGR.l1NovP261101] }, c))).toBe("no_pertenece");
  });
  it("mover a paquete cambia el paquete sin mover meses y se puede sacar del paquete", () => {
    let c = conCaso1();
    const r = ok(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261102, asignaciones: [ASIGNACION_AGR.l1NovP261101] }, c));
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.aplicable.accion).toBe("mover_a_paquete");
    c = siguiente(c, r.aplicable);
    expect(filasDe(c, LINEA_AGR.l1)[0]).toMatchObject({ paquete: PAQUETE_AGR.p261102, unidades: 300 });
    const sacar = ok(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 2, paquete_id: null, asignaciones: [ASIGNACION_AGR.l1NovP261101] }, c));
    c = siguiente(c, sacar.aplicable);
    expect(filasDe(c, LINEA_AGR.l1)[0]).toMatchObject({ paquete: null, unidades: 300 });
    verificarInvariantes(c, UNIDADES);
  });
  it("mover un paquete a otro embarque arrastra sus asignaciones y las lleva al mes del destino", () => {
    let c = conCaso1();
    const r = ok(planMoverPaquete({ paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, motivo: "Se consolida con diciembre" }, c));
    expect(r.aplicable.paquete_a_mover).toEqual({ paquete_id: PAQUETE_AGR.p261101, embarque_destino_id: EMBARQUE_AGR.e261201 });
    expect(r.aplicable.embarques.map((e) => e.id).sort()).toEqual([EMBARQUE_AGR.e261101, EMBARQUE_AGR.e261201].sort());
    expect(r.aplicable.accion).toBe("mover_paquete");
    c = siguiente(c, r.aplicable);
    expect(c.paquetes.find((p) => p.id === PAQUETE_AGR.p261101)?.embarque_id).toBe(EMBARQUE_AGR.e261201);
    expect(porMes(c, LINEA_AGR.l1)).toEqual({ "2026-12": 500 });
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 200 },
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: PAQUETE_AGR.p261101, unidades: 300 },
    ]);
    verificarInvariantes(c, UNIDADES);
  });
  it("mover un paquete exige motivo, otro embarque distinto y estados en curso", () => {
    const c = conCaso1();
    expect(motivo(planMoverPaquete({ paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, motivo: "" }, c))).toBe("motivo_requerido");
    expect(motivo(planMoverPaquete({ paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261101, revision_destino: 1, motivo: "x" }, c))).toBe("no_pertenece");
    const cancelado = { ...c, embarques: c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261201 ? { ...e, estado: "cancelado" as const } : e)) };
    expect(motivo(planMoverPaquete({ paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, motivo: "x" }, cancelado))).toBe("embarque_no_editable");
  });
  it("con recepciones vinculadas (08b-2) ni el paquete ni el embarque cambian", () => {
    const c = conCaso1({ recepciones_vinculadas: new Map([[ASIGNACION_AGR.l1NovP261101, 250]]) });
    expect(motivo(planMoverPaquete({ paquete_id: PAQUETE_AGR.p261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, motivo: "x" }, c))).toBe("asignacion_con_recepciones");
    expect(motivo(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-03", motivo: "x" }, c))).toBe("embarque_con_recepciones");
    expect(motivo(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 3 }] }, c))).toBe("asignacion_con_recepciones");
    // mover a otro paquete del mismo embarque sí se permite
    expect(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261102, asignaciones: [ASIGNACION_AGR.l1NovP261101] }, c).ok).toBe(true);
  });
});

// ─── Quitar (B1) ───

describe("quitar: las unidades quedan sin embarque en el mismo mes, en cualquier estado del embarque", () => {
  it("quita la asignación y deja la entrega como estaba", () => {
    let c = conCaso1();
    const r = ok(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 3 }] }, c));
    expect(r.aplicable.entregas).toEqual([]);
    expect(r.vista.movimientos[0]).toMatchObject({ de: { embarque: { codigo: "261101" } }, a: { periodo: "2026-11", embarque: null, paquete: null }, unidades: 300 });
    c = siguiente(c, r.aplicable);
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([{ periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 200 }]);
    expect(porMes(c, LINEA_AGR.l1)).toEqual({ "2026-11": 300, "2026-12": 200 });
  });

  it("se permite en un embarque cancelado y en uno recibido", () => {
    for (const estado of ["cancelado", "recibido"] as const) {
      const c = conCaso1();
      const embarques = c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261101 ? { ...e, estado } : e));
      expect(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 3 }] }, { ...c, embarques }).ok, estado).toBe(true);
      expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 10, compra_revision: 1 }] }, { ...c, embarques })), estado).toBe("embarque_no_editable");
    }
  });

  it("una asignación de otro embarque o una revisión vieja de la compra se rechazan", () => {
    const c = conCaso1();
    expect(motivo(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1Dic261201, compra_revision: 3 }] }, c))).toBe("no_pertenece");
    expect(motivo(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, asignaciones: [{ id: ASIGNACION_AGR.l1NovP261101, compra_revision: 2 }] }, c))).toBe("compra_cambio");
  });
});

// ─── Caso 11: concurrencia ───

describe("caso 11: dos pestañas y huella del plan (R19)", () => {
  it("la segunda pestaña recibe agrupador_cambio (revisión del embarque vieja)", () => {
    expect(motivo(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261201, revision: 0, fecha_llegada_estimada: "2026-12-20", motivo: "x" }, conCaso1()))).toBe("agrupador_cambio");
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 7, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Dic, unidades: 1, compra_revision: 3 }] }, conCaso1()))).toBe("agrupador_cambio");
  });

  it("una compra que cambió después de la vista previa da compra_cambio; la huella no depende de las revisiones", () => {
    const c = ctx();
    const previa = ok(asignarL1(c));
    const cambiada = { ...c, compras: c.compras.map((x) => (x.id === COMPRA_AGR.c101 ? { ...x, revision: 4 } : x)) };
    expect(motivo(asignarL1(cambiada))).toBe("compra_cambio");
    // la API recalcula con la revisión nueva: misma huella ⇒ reintenta una vez
    const recalculada = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 300, compra_revision: 4 }] }, cambiada));
    expect(recalculada.vista.huella_plan).toBe(previa.vista.huella_plan);
    expect(puedeReintentar(previa.vista.huella_plan, recalculada.vista.huella_plan)).toBe(true);
  });

  it("si lo que se movería es distinto, la huella cambia y no se reintenta (plan_cambio); sin huella no hay reintento", () => {
    const c = ctx();
    const previa = ok(asignarL1(c));
    // alguien asignó 100 de esa entrega a otro embarque: ahora solo se pueden asignar 200
    const otra = ctx({ asignaciones: [{ id: "x", entrega_id: ENTREGA_AGR.l1Nov, embarque_id: EMBARQUE_AGR.e261201, paquete_id: null, unidades: 100 }] });
    const nueva = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, paquete_id: PAQUETE_AGR.p261101, items: [{ entrega_id: ENTREGA_AGR.l1Nov, unidades: 200, compra_revision: 3 }] }, otra));
    expect(nueva.vista.huella_plan).not.toBe(previa.vista.huella_plan);
    expect(puedeReintentar(previa.vista.huella_plan, nueva.vista.huella_plan)).toBe(false);
    expect(puedeReintentar(undefined, nueva.vista.huella_plan)).toBe(false);
  });

  it("la huella es SHA-256 en hex, estable y no cambia por el orden de los ítems", () => {
    const a = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Dic, unidades: 50, compra_revision: 3 }, { entrega_id: ENTREGA_AGR.c102Nov, unidades: 20, compra_revision: 1 }] }, ctx()));
    const b = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 20, compra_revision: 1 }, { entrega_id: ENTREGA_AGR.l1Dic, unidades: 50, compra_revision: 3 }] }, ctx()));
    expect(a.vista.huella_plan).toMatch(/^[0-9a-f]{64}$/);
    expect(a.vista.huella_plan).toBe(b.vista.huella_plan);
    expect(huellaPlan(a.vista)).toBe(a.vista.huella_plan);
  });

  it("sha256Hex da los vectores de prueba del estándar", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    expect(sha256Hex("ñandú · día")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Avisos del plan ───

describe("avisos del plan", () => {
  it("caso 16: una llegada en un mes ya cerrado (≤ k') avisa fecha_en_mes_cerrado", () => {
    const base = ctx();
    const c = { ...base, embarques: [...base.embarques, { ...base.embarques[1], id: "emb-ago", codigo: "260899", fecha_llegada_estimada: "2026-08-20", fecha_salida_estimada: null, periodo_llegada: "2026-08" }] };
    const r = ok(planAsignar({ embarque_id: "emb-ago", revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] }, c));
    expect(r.vista.avisos).toContainEqual({ aviso: "fecha_en_mes_cerrado", detalle: "ago-2026 ya está cerrado: el flujo espera lo pendiente en oct-2026." });
    // y ago es anterior a la fecha de la compra (oct-26)
    expect(r.vista.avisos.map((a) => a.aviso)).toContain("llegada_antes_de_compra");
  });

  it("sin k' no hay aviso de mes cerrado", () => {
    const base = ctx({ k_prima: null });
    const c = { ...base, embarques: [...base.embarques, { ...base.embarques[1], id: "emb-ago", codigo: "260899", fecha_llegada_estimada: "2026-08-20", fecha_salida_estimada: null, periodo_llegada: "2026-08" }] };
    const r = ok(planAsignar({ embarque_id: "emb-ago", revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] }, c));
    expect(r.vista.avisos.map((a) => a.aviso)).not.toContain("fecha_en_mes_cerrado");
  });

  it("viaje_distinto: la compra es de un viaje y el embarque de otro", () => {
    const base = ctx();
    const viajeOtro = { ...viaje261001(), id: "viaje-otro", codigo: "261002" };
    const c = {
      ...base,
      viajes: [...base.viajes, viajeOtro],
      embarques: base.embarques.map((e) => (e.id === EMBARQUE_AGR.e261201 ? { ...e, viaje_id: "viaje-otro" } : e)),
    };
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.l1Dic, unidades: 200, compra_revision: 3 }] }, c));
    expect(r.vista.avisos).toContainEqual({ aviso: "viaje_distinto", detalle: "C-000101 es del viaje 261001 y el embarque 261201 es del viaje 261002." });
  });

  it("caso 19a: operar sobre un embarque de un viaje cerrado se registra con el aviso viaje_cerrado", () => {
    const base = ctx();
    const c = { ...base, viajes: [viaje261001({ estado: "cerrado" })] };
    const r = ok(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 400, compra_revision: 1 }] }, c));
    expect(r.vista.avisos).toContainEqual({ aviso: "viaje_cerrado", detalle: "El viaje 261001 está cerrado: igual se registra." });
    expect(VIAJE_AGR.v261001).toBeTruthy();
  });
});

// ─── Compra no asignable ───

describe("§3.4: qué compras se pueden asignar", () => {
  const asignar = (c: ContextoMovimiento) => planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 100, compra_revision: 1 }] }, c);
  const conCompra = (cambios: Record<string, unknown>) => {
    const c = ctx();
    return { ...c, compras: c.compras.map((x) => (x.id === COMPRA_AGR.c102 ? { ...x, ...cambios } : x)) };
  };
  it("borrador y confirmada sí", () => {
    expect(asignar(ctx()).ok).toBe(true);
    expect(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c103Nov, unidades: 100, compra_revision: 1 }] }, ctx()).ok).toBe(true);
  });
  it("recibida o cancelada: compra_no_asignable; con el saldo cerrado: saldo_cerrado", () => {
    expect(motivo(asignar(conCompra({ estado: "recibida" })))).toBe("compra_no_asignable");
    expect(motivo(asignar(conCompra({ estado: "cancelada" })))).toBe("compra_no_asignable");
    expect(motivo(asignar(conCompra({ estado: "recibida", cancelada_at: "2026-10-30T10:00:00Z" })))).toBe("saldo_cerrado");
  });
  it("una línea inactiva o recibida al 100 % tampoco", () => {
    const c = ctx();
    expect(motivo(asignar({ ...c, lineas: c.lineas.map((l) => (l.id === LINEA_AGR.l102 ? { ...l, activo: false } : l)) }))).toBe("compra_no_asignable");
    expect(motivo(asignar({ ...c, lineas: c.lineas.map((l) => (l.id === LINEA_AGR.l102 ? { ...l, unidades_recibidas: 400 } : l)) }))).toBe("compra_no_asignable");
  });
  it("una entrega que no existe da no_pertenece y una revisión vieja de la compra, compra_cambio", () => {
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: "00000000-0000-4000-8000-000000000000", unidades: 1, compra_revision: 1 }] }, ctx()))).toBe("no_pertenece");
    expect(motivo(planAsignar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 1, compra_revision: 0 }] }, ctx()))).toBe("compra_cambio");
  });
  it("un embarque inexistente da no_encontrado", () => {
    expect(motivo(planAsignar({ embarque_id: "00000000-0000-4000-8000-000000000000", revision: 1, paquete_id: null, items: [{ entrega_id: ENTREGA_AGR.c102Nov, unidades: 1, compra_revision: 1 }] }, ctx()))).toBe("no_encontrado");
  });
});

// ─── R12: asignaciones históricas ───

describe("R12: asignaciones históricas", () => {
  it("clasificarAsignacion: compra recibida o cancelada, línea inactiva o recibida al 100 %", () => {
    const linea = { activo: true, unidades: 500, unidades_recibidas: 0, unidades_canceladas: 0 };
    expect(clasificarAsignacion({ estado: "confirmada" }, linea)).toEqual({ historica: false, linea_recibida: false });
    expect(clasificarAsignacion({ estado: "borrador" }, linea).historica).toBe(false);
    expect(clasificarAsignacion({ estado: "recibida" }, linea).historica).toBe(true);
    expect(clasificarAsignacion({ estado: "cancelada" }, linea).historica).toBe(true);
    expect(clasificarAsignacion({ estado: "confirmada" }, { ...linea, activo: false }).historica).toBe(true);
    // línea recibida al 100 % en una compra todavía confirmada: histórica y con aviso linea_recibida
    expect(clasificarAsignacion({ estado: "confirmada" }, { ...linea, unidades_recibidas: 500 })).toEqual({ historica: true, linea_recibida: true });
    expect(clasificarAsignacion({ estado: "confirmada" }, { ...linea, unidades_recibidas: 300, unidades_canceladas: 200 })).toEqual({ historica: true, linea_recibida: true });
    expect(clasificarAsignacion({ estado: "recibida" }, { ...linea, unidades_recibidas: 500 }).linea_recibida).toBe(false);
  });

  /** C-000102 cancelada con su asignación a 261201 (caso 7) y C-000101 activa en el mismo embarque. */
  function ctxCaso7() {
    const base = ctx({ asignaciones: asignacionesCaso1() });
    const entregas = base.entregas.map((e) => (e.id === ENTREGA_AGR.c102Nov ? { ...e, periodo: "2026-12" } : e));
    return {
      ...base,
      entregas,
      compras: base.compras.map((x) => (x.id === COMPRA_AGR.c102 ? { ...x, estado: "cancelada" as const } : x)),
      asignaciones: [...base.asignaciones, { id: "a-102", entrega_id: ENTREGA_AGR.c102Nov, embarque_id: EMBARQUE_AGR.e261201, paquete_id: null, unidades: 400 }],
    };
  }

  it("no se mueve al cambiar la fecha (aviso asignaciones_historicas) y no cuenta como activa", () => {
    const c = ctxCaso7();
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, fecha_llegada_estimada: "2027-01-12", motivo: "Enero" }, c));
    expect(r.aplicable.movimientos.map((m) => m.asignacion_id)).toEqual([ASIGNACION_AGR.l1Dic261201]);
    expect(r.vista.avisos.map((a) => a.aviso)).toContain("asignaciones_historicas");
    expect(r.aplicable.compras.map((x) => x.id)).toEqual([COMPRA_AGR.c101]);
  });

  it("quitarla se rechaza (no se mueve) y pasar pendientes la ignora", () => {
    const c = ctxCaso7();
    expect(motivo(planQuitar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, asignaciones: [{ id: "a-102", compra_revision: 1 }] }, c))).toBe("compra_no_asignable");
    const pend = estimarPendientesAsignaciones(c);
    expect(pend.get("a-102")).toMatchObject({ historica: true, pendiente: 0 });
    expect(pend.get(ASIGNACION_AGR.l1Dic261201)).toMatchObject({ historica: false, pendiente: 200 });
  });

  it("caso 8: una línea que vuelve a ser activa en un embarque cancelado se puede quitar", () => {
    const c = ctxCaso7();
    const activa = { ...c, compras: c.compras.map((x) => (x.id === COMPRA_AGR.c102 ? { ...x, estado: "confirmada" as const } : x)), embarques: c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261201 ? { ...e, estado: "cancelado" as const } : e)) };
    const r = ok(planQuitar({ embarque_id: EMBARQUE_AGR.e261201, revision: 1, asignaciones: [{ id: "a-102", compra_revision: 1 }] }, activa));
    const despues = siguiente(activa, r.aplicable);
    expect(despues.asignaciones.some((a) => a.id === "a-102")).toBe(false);
  });
});

// ─── Pasar pendientes ───

describe("pasar pendientes (§3.5): lo pendiente de cada asignación sale al destino", () => {
  /** l1 con 250 u ya recibidas en nov (C-000101 confirmada; la entrega de nov es de 300 y de dic de 200). */
  function conRecibidas(): ContextoMovimiento {
    const base = conCaso1();
    return {
      ...base,
      lineas: base.lineas.map((l) => (l.id === LINEA_AGR.l1 ? { ...l, unidades_recibidas: 250 } : l)),
      recepciones: [{ id: "r1", linea_id: LINEA_AGR.l1, recibida_periodo: "2026-11", unidades: 250, fecha_recepcion: "2026-11-22", origen: "manual" as const }],
    };
  }

  it("estima lo recibido con el FIFO de M8 y lo rotula como estimado", () => {
    const pend = estimarPendientesAsignaciones(conRecibidas());
    expect(pend.get(ASIGNACION_AGR.l1NovP261101)).toMatchObject({ unidades: 300, recibidas: 250, pendiente: 50, estimada: true });
    expect(pend.get(ASIGNACION_AGR.l1Dic261201)).toMatchObject({ recibidas: 0, pendiente: 200 });
  });

  it("pasar 50 a 261201 deja nov 250 · dic 250 y el origen conserva lo recibido", () => {
    let c = conRecibidas();
    const r = ok(planPasarPendientes({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, paquete_destino_id: null, motivo: "Llegó incompleto" }, c));
    expect(r.aplicable.movimientos).toHaveLength(1);
    expect(r.aplicable.movimientos[0]).toMatchObject({ asignacion_id: ASIGNACION_AGR.l1NovP261101, unidades: 50, destino: { periodo: "2026-12", embarque_id: EMBARQUE_AGR.e261201, paquete_id: null } });
    expect(r.aplicable.accion).toBe("pasar_pendientes");
    c = siguiente(c, r.aplicable);
    expect(porMes(c, LINEA_AGR.l1)).toEqual({ "2026-11": 250, "2026-12": 250 });
    expect(filasDe(c, LINEA_AGR.l1)).toEqual([
      { periodo: "2026-11", embarque: EMBARQUE_AGR.e261101, paquete: PAQUETE_AGR.p261101, unidades: 250 },
      { periodo: "2026-12", embarque: EMBARQUE_AGR.e261201, paquete: null, unidades: 250 },
    ]);
    verificarInvariantes(c, UNIDADES);
  });

  it("sin pendientes da sin_pendientes; el destino debe estar en curso y ser otro embarque", () => {
    const c = conCaso1();
    const base = { embarque_id: EMBARQUE_AGR.e261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, paquete_destino_id: null, motivo: "x" };
    const sinRecibir = { ...c, lineas: c.lineas.map((l) => (l.id === LINEA_AGR.l1 ? { ...l, unidades_recibidas: 300 } : l)), recepciones: [{ id: "r1", linea_id: LINEA_AGR.l1, recibida_periodo: "2026-11", unidades: 300, fecha_recepcion: "2026-11-22", origen: "manual" as const }] };
    expect(motivo(planPasarPendientes(base, sinRecibir))).toBe("sin_pendientes");
    expect(motivo(planPasarPendientes({ ...base, embarque_destino_id: EMBARQUE_AGR.e261101, revision_destino: 1 }, c))).toBe("no_pertenece");
    const cancelado = { ...c, embarques: c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261201 ? { ...e, estado: "cancelado" as const } : e)) };
    expect(motivo(planPasarPendientes(base, cancelado))).toBe("embarque_no_editable");
    expect(motivo(planPasarPendientes({ ...base, motivo: "" }, c))).toBe("motivo_requerido");
    expect(motivo(planPasarPendientes({ ...base, paquete_destino_id: PAQUETE_AGR.p261101 }, c))).toBe("paquete_de_otro_embarque");
  });

  it("desde un embarque recibido sí se pueden pasar pendientes", () => {
    const c = conRecibidas();
    const recibido = { ...c, embarques: c.embarques.map((e) => (e.id === EMBARQUE_AGR.e261101 ? { ...e, estado: "recibido" as const } : e)) };
    expect(planPasarPendientes({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, embarque_destino_id: EMBARQUE_AGR.e261201, revision_destino: 1, paquete_destino_id: null, motivo: "x" }, recibido).ok).toBe(true);
  });
});

// ─── R2: alineación ───

describe("R2: I2 sobre lo que toca el plan", () => {
  it("verificarAlineacion detecta una asignación fuera del mes de llegada y estaDesalineada lo dice", () => {
    expect(verificarAlineacion([{ embarque_id: "e", periodo: "2026-11", unidades: 5 }], new Map([["e", "2026-12"]]))).toEqual([{ embarque_id: "e", periodo: "2026-11", esperado: "2026-12" }]);
    expect(verificarAlineacion([{ embarque_id: "e", periodo: "2026-12", unidades: 5 }], new Map([["e", "2026-12"]]))).toEqual([]);
    expect(verificarAlineacion([{ embarque_id: "e", periodo: "2026-11", unidades: 0 }], new Map([["e", "2026-12"]]))).toEqual([]);
    expect(estaDesalineada("2026-11-01", "2026-12")).toBe(true);
    expect(estaDesalineada("2026-12", "2026-12")).toBe(false);
  });

  it("cambiar la fecha realinea también una asignación que estaba desalineada", () => {
    // 261101 llega en nov pero su asignación está en una entrega de dic (se desalineó por fuera): al mover la fecha a nov-dic queda alineada
    const base = conCaso1();
    const asig = base.asignaciones.filter((a) => a.id === ASIGNACION_AGR.l1NovP261101).map((a) => ({ ...a, entrega_id: ENTREGA_AGR.l1Dic, unidades: 150 }));
    const c = { ...base, asignaciones: asig };
    const r = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-12-01", motivo: "Dic" }, c));
    // el mes cambia (nov → dic) y la fila ya estaba en dic: no hay nada que mover, pero no queda desalineada
    expect(r.aplicable.movimientos).toEqual([]);
    const r2 = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2026-11-25", motivo: "Nov" }, c));
    // mismo mes: no toca compras (R5), aunque la fila siga desalineada: se avisa `desalineada` en la lista
    expect(r2.aplicable.movimientos).toEqual([]);
    const r3 = ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2027-01-05", motivo: "Ene" }, c));
    expect(r3.aplicable.movimientos).toHaveLength(1);
    expect(r3.aplicable.movimientos[0].destino.periodo).toBe("2027-01");
  });
});

// ─── R3, R4: pruebas con muchas operaciones encadenadas ───

describe("R3 y R4: las invariantes se cumplen tras cualquier secuencia de operaciones", () => {
  /** Generador pseudoaleatorio determinista (LCG): la prueba es reproducible. */
  function azar(semilla: number) {
    let s = semilla >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("300 operaciones con tres semillas conservan Σ entregas, I1, el índice único y el paquete de cada embarque", () => {
    let aplicadas = 0;
    for (const semilla of [1, 7, 42]) {
      const rnd = azar(semilla);
      let c = ctx();
      for (let paso = 0; paso < 100; paso++) {
        const eleccion = Math.floor(rnd() * 5);
        const embarques = c.embarques.filter((e) => e.estado === "planificado");
        const e = embarques[Math.floor(rnd() * embarques.length)];
        if (eleccion === 0) {
          const libres = c.entregas.filter((x) => x.linea_id === LINEA_AGR.l1 || x.linea_id === LINEA_AGR.l2 || x.linea_id === LINEA_AGR.l102);
          const en = libres[Math.floor(rnd() * libres.length)];
          const asignadas = c.asignaciones.filter((a) => a.entrega_id === en.id).reduce((s, a) => s + a.unidades, 0);
          const libre = en.unidades - asignadas;
          if (libre <= 0) continue;
          const linea = c.lineas.find((l) => l.id === en.linea_id)!;
          const compra = c.compras.find((x) => x.id === linea.compra_id)!;
          const unidades = 1 + Math.floor(rnd() * libre);
          const paqueteId = c.paquetes.find((p) => p.embarque_id === e.id && rnd() < 0.5)?.id ?? null;
          const r = planAsignar({ embarque_id: e.id, revision: e.revision, paquete_id: paqueteId, items: [{ entrega_id: en.id, unidades, compra_revision: compra.revision }] }, c);
          if (r.ok) {
            c = siguiente(c, r.aplicable);
            aplicadas += 1;
          }
        } else if (eleccion === 1) {
          const dias = 1 + Math.floor(rnd() * 400);
          const fecha = new Date(Date.UTC(2026, 10, 1) + dias * 86_400_000).toISOString().slice(0, 10);
          const r = planCambiarFecha({ embarque_id: e.id, revision: e.revision, fecha_llegada_estimada: fecha, motivo: "azar" }, c);
          if (r.ok) {
            c = siguiente(c, r.aplicable);
            aplicadas += 1;
          }
        } else if (eleccion === 2) {
          const propias = c.asignaciones.filter((a) => a.embarque_id === e.id);
          if (propias.length === 0) continue;
          const a = propias[Math.floor(rnd() * propias.length)];
          const compra = c.compras.find((x) => x.id === c.lineas.find((l) => l.id === c.entregas.find((en) => en.id === a.entrega_id)!.linea_id)!.compra_id)!;
          const r = planQuitar({ embarque_id: e.id, revision: e.revision, asignaciones: [{ id: a.id, compra_revision: compra.revision }] }, c);
          if (r.ok) {
            c = siguiente(c, r.aplicable);
            aplicadas += 1;
          }
        } else if (eleccion === 3) {
          const propias = c.asignaciones.filter((a) => a.embarque_id === e.id);
          if (propias.length === 0) continue;
          const paquetes = c.paquetes.filter((p) => p.embarque_id === e.id);
          const destino = rnd() < 0.5 || paquetes.length === 0 ? null : paquetes[Math.floor(rnd() * paquetes.length)].id;
          const r = planMoverAPaquete({ embarque_id: e.id, revision: e.revision, paquete_id: destino, asignaciones: [propias[Math.floor(rnd() * propias.length)].id] }, c);
          if (r.ok) {
            c = siguiente(c, r.aplicable);
            aplicadas += 1;
          }
        } else {
          const destinos = embarques.filter((x) => x.id !== e.id);
          const d = destinos[Math.floor(rnd() * destinos.length)];
          const r = planPasarPendientes({ embarque_id: e.id, revision: e.revision, embarque_destino_id: d.id, revision_destino: d.revision, paquete_destino_id: null, motivo: "azar" }, c);
          if (r.ok) {
            c = siguiente(c, r.aplicable);
            aplicadas += 1;
          }
        }
        verificarInvariantes(c, UNIDADES);
      }
    }
    expect(aplicadas, "la secuencia debe aplicar de verdad muchas operaciones").toBeGreaterThan(120);
  });
});

// ─── R20: el flujo no cambia de cifras con agrupadores ───

describe("R20: sin recepciones vinculadas, las asignaciones no cambian lo que lee el flujo", () => {
  const pendientesLinea = (c: ContextoMovimiento, lineaId: string) => {
    const l = c.lineas.find((x) => x.id === lineaId)!;
    return pendientesPorEntrega({ unidades: l.unidades, unidades_canceladas: l.unidades_canceladas }, entregasDe(c, lineaId), c.recepciones.filter((r) => r.linea_id === lineaId));
  };

  it("asignar, quitar y mover de paquete en el mismo mes deja las entregas y sus pendientes idénticos", () => {
    const inicial = ctx();
    let c = inicial;
    c = siguiente(c, ok(asignarL1(c)).aplicable);
    c = siguiente(c, ok(planMoverAPaquete({ embarque_id: EMBARQUE_AGR.e261101, revision: 2, paquete_id: PAQUETE_AGR.p261102, asignaciones: ["nueva-asig-0"] }, c)).aplicable);
    const a = c.asignaciones[0];
    c = siguiente(c, ok(planQuitar({ embarque_id: EMBARQUE_AGR.e261101, revision: 3, asignaciones: [{ id: a.id, compra_revision: 5 }] }, c)).aplicable);
    for (const l of [LINEA_AGR.l1, LINEA_AGR.l2, LINEA_AGR.l102]) {
      expect(pendientesLinea(c, l)).toEqual(pendientesLinea(inicial, l));
      expect(entregasDe(c, l)).toEqual(entregasDe(inicial, l));
    }
  });

  it("mover meses solo cambia el mes, no el total: Σ pendiente de la línea es el mismo", () => {
    const inicial = conCaso1();
    const c = siguiente(inicial, ok(planCambiarFecha({ embarque_id: EMBARQUE_AGR.e261101, revision: 1, fecha_llegada_estimada: "2027-02-10", motivo: "Febrero" }, inicial)).aplicable);
    expect(pendientesLinea(c, LINEA_AGR.l1).pendiente).toBe(pendientesLinea(inicial, LINEA_AGR.l1).pendiente);
    expect(pendientesLinea(c, LINEA_AGR.l1).entregas.map((e) => [e.periodo, e.pendiente])).toEqual([["2026-12", 200], ["2027-02", 300]]);
  });

  it("el flujo y la lógica de pendientes no importan los agrupadores (independencia)", () => {
    const raiz = path.resolve(__dirname, "../src/lib");
    const leer = (r: string) => readFileSync(path.join(raiz, r), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(leer("compras/pendientes.ts")).not.toMatch(/agrupadores/);
    for (const f of ["flujo/consultas.ts", "flujo/modelo.ts", "flujo/ingresos.ts", "flujo/filas.ts", "flujo/conciliacion.ts"]) expect(leer(f), f).not.toMatch(/agrupadores/);
  });
});

// ─── Independencia de la lógica de agrupadores ───

describe("la lógica de agrupadores es pura", () => {
  const dir = path.resolve(__dirname, "../src/lib/compras/agrupadores");
  const puros = ["codigos", "movimiento", "responsable", "estados", "avisos", "permisos", "viaje-activo", "excel", "importar", "plantilla"];
  const limpiar = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it.each(puros)("%s no importa flujo, Supabase, next, react ni node: y no usa reloj ni azar", (nombre) => {
    const src = limpiar(readFileSync(path.join(dir, `${nombre}.ts`), "utf8"));
    for (const m of src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
      expect(m[1]).not.toMatch(/(^|\/)flujo(\/|$)/);
      expect(m[1]).not.toMatch(/^@supabase\//);
      expect(m[1]).not.toMatch(/supabase\/(admin|server|client)/);
      expect(m[1]).not.toMatch(/^(next|react|node:)/);
    }
    expect(src).not.toMatch(/\.from\(|\.rpc\(|supabaseAdmin|supabaseServer/);
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(|Math\.random\(/);
    expect(src).not.toMatch(/repartos_marca_barrido|reparto_marca_barrido_gml/);
  });

  it("leerRepartosPorId es aditivo: se exporta de servicio.ts, lee por id sin filtrar por vigente ni por activo y vive en consultas.ts", () => {
    const raiz = path.resolve(__dirname, "../src/lib/marcas-barrer");
    const servicio = limpiar(readFileSync(path.join(raiz, "servicio.ts"), "utf8"));
    const consultas = limpiar(readFileSync(path.join(raiz, "consultas.ts"), "utf8"));
    expect(servicio).toMatch(/export async function leerRepartosPorId\(/);
    expect(servicio).toMatch(/export async function leerRepartosVigentes\(/);
    const cuerpo = consultas.slice(consultas.indexOf("export async function leerVersionesPorId"), consultas.indexOf("export async function leerVersionesDeMarca"));
    expect(cuerpo).toMatch(/\.in\("id"/);
    expect(cuerpo).not.toMatch(/vigente|activo/);
  });
});
