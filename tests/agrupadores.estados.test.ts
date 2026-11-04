import { describe, expect, it } from "vitest";
import { avisoViajeCerrado, avisosEmbarque, avisosPaquete, avisosViaje } from "@/lib/compras/agrupadores/avisos";
import {
  accionAdmitidaPorTipo,
  embarqueAdmiteComoDestino,
  embarqueAdmiteOperacion,
  embarqueAdmitePaquetes,
  embarqueEditable,
  paqueteEditable,
  transicionEmbarque,
  transicionPaquete,
  transicionViaje,
  validarGuardarEmbarque,
  viajeAdmiteCompras,
  viajeEditable,
} from "@/lib/compras/agrupadores/estados";
import { responsableEfectivo } from "@/lib/compras/agrupadores/responsable";
import { OPERACIONES_MOVIMIENTO, type AccionEstado, type EstadoEmbarque, type EstadoViaje } from "@/lib/compras/agrupadores/tipos";
import { PERFIL_AGR, perfilesAgrupadores, viaje261001 } from "./agrupadores.fixture";

/** R13 (estados), R12 y los avisos de lista · casos 7, 8, 10 y 19a. */

const sinNada = { compras_no_canceladas: 0, embarques_no_cancelados: 0 };
const fallo = (r: { ok: boolean; motivo?: string }) => (r.ok ? null : r.motivo);

describe("R13 · viaje: abierto ⇄ cerrado → cancelado", () => {
  it("cerrar y reabrir (cerrado no bloquea nada: es un estado informativo)", () => {
    expect(transicionViaje("abierto", "cerrar", sinNada)).toEqual({ ok: true, hacia: "cerrado" });
    expect(transicionViaje("cerrado", "reabrir", sinNada)).toEqual({ ok: true, hacia: "abierto" });
    expect(fallo(transicionViaje("cerrado", "cerrar", sinNada))).toBe("transicion_invalida");
    expect(fallo(transicionViaje("abierto", "reabrir", sinNada))).toBe("transicion_invalida");
  });

  it("cancelar solo sin compras no canceladas ni embarques no cancelados, y con motivo", () => {
    expect(transicionViaje("abierto", "cancelar", { ...sinNada, motivo: "Se canceló la feria" })).toEqual({ ok: true, hacia: "cancelado" });
    expect(transicionViaje("cerrado", "cancelar", { ...sinNada, motivo: "x" })).toEqual({ ok: true, hacia: "cancelado" });
    expect(fallo(transicionViaje("abierto", "cancelar", { compras_no_canceladas: 1, embarques_no_cancelados: 0, motivo: "x" }))).toBe("tiene_compras");
    expect(fallo(transicionViaje("abierto", "cancelar", { compras_no_canceladas: 0, embarques_no_cancelados: 2, motivo: "x" }))).toBe("tiene_compras");
    expect(fallo(transicionViaje("abierto", "cancelar", sinNada))).toBe("motivo_requerido");
    expect(fallo(transicionViaje("abierto", "cancelar", { ...sinNada, motivo: "   " }))).toBe("motivo_requerido");
  });

  it("cancelado es inmutable: ninguna acción", () => {
    for (const accion of ["cerrar", "reabrir", "cancelar"] as const) expect(fallo(transicionViaje("cancelado", accion, { ...sinNada, motivo: "x" })), accion).toBe("transicion_invalida");
  });

  it("las acciones de embarque no valen para un viaje", () => {
    expect(fallo(transicionViaje("abierto", "en_transito", sinNada))).toBe("transicion_invalida");
    expect(fallo(transicionViaje("abierto", "volver_a_planificado", sinNada))).toBe("transicion_invalida");
  });

  it("solo cancelado bloquea: un viaje cerrado admite cambios y compras (decisión 95)", () => {
    const estados: EstadoViaje[] = ["abierto", "cerrado", "cancelado"];
    expect(estados.map(viajeEditable)).toEqual([true, true, false]);
    expect(estados.map(viajeAdmiteCompras)).toEqual([true, true, false]);
  });
});

describe("R13 · embarque: planificado ⇄ en_transito; recibido solo al recibir; cancelar sin activas ni recepciones", () => {
  const libre = { asignaciones_activas: 0, recepciones_vinculadas: 0, motivo: "Ya no viene" };

  it("planificado ⇄ en_transito", () => {
    expect(transicionEmbarque("planificado", "en_transito", libre)).toEqual({ ok: true, hacia: "en_transito" });
    expect(transicionEmbarque("en_transito", "volver_a_planificado", libre)).toEqual({ ok: true, hacia: "planificado" });
    expect(fallo(transicionEmbarque("en_transito", "en_transito", libre))).toBe("transicion_invalida");
    expect(fallo(transicionEmbarque("planificado", "volver_a_planificado", libre))).toBe("transicion_invalida");
  });

  it("recibido solo se alcanza al recibir y se deshace al revertir: no hay acción de estado para eso", () => {
    expect(fallo(transicionEmbarque("recibido", "en_transito", libre))).toBe("transicion_invalida");
    expect(fallo(transicionEmbarque("recibido", "volver_a_planificado", libre))).toBe("transicion_invalida");
    expect(fallo(transicionEmbarque("planificado", "cerrar", libre))).toBe("transicion_invalida");
  });

  it("caso 7: cancelar si no quedan activas (las históricas no cuentan: el llamador pasa solo las activas)", () => {
    expect(transicionEmbarque("planificado", "cancelar", libre)).toEqual({ ok: true, hacia: "cancelado" });
    expect(fallo(transicionEmbarque("planificado", "cancelar", { ...libre, asignaciones_activas: 1 }))).toBe("tiene_asignaciones_activas");
    expect(fallo(transicionEmbarque("en_transito", "cancelar", { ...libre, recepciones_vinculadas: 3 }))).toBe("tiene_recepciones");
    expect(fallo(transicionEmbarque("planificado", "cancelar", { asignaciones_activas: 0, recepciones_vinculadas: 0 }))).toBe("motivo_requerido");
  });

  it("cancelado es inmutable", () => {
    for (const accion of ["en_transito", "volver_a_planificado", "cancelar"] as const) expect(fallo(transicionEmbarque("cancelado", accion, libre)), accion).toBe("transicion_invalida");
  });

  it("qué operaciones admite cada estado: en cancelado y recibido solo «Quitar» (y en recibido, otra llegada y pasar pendientes)", () => {
    const ops = Object.fromEntries(OPERACIONES_MOVIMIENTO.map((o) => [o, (["planificado", "en_transito", "recibido", "cancelado"] as EstadoEmbarque[]).map((e) => embarqueAdmiteOperacion(e, o))]));
    expect(ops.quitar).toEqual([true, true, true, true]);
    expect(ops.asignar).toEqual([true, true, false, false]);
    expect(ops.mover_a_paquete).toEqual([true, true, false, false]);
    expect(ops.cambiar_fecha).toEqual([true, true, false, false]);
    expect(ops.mover_paquete).toEqual([true, true, false, false]);
    expect(ops.pasar_pendientes).toEqual([true, true, true, false]);
    expect(ops.recibir).toEqual([true, true, false, false]);
    expect(ops.otra_llegada).toEqual([false, false, true, false]);
    expect(ops.revertir_recepcion).toEqual([false, false, true, false]);
  });

  it("destino de una asignación y paquetes nuevos: solo embarques en curso; editar: todo menos cancelado", () => {
    expect((["planificado", "en_transito", "recibido", "cancelado"] as EstadoEmbarque[]).map(embarqueAdmiteComoDestino)).toEqual([true, true, false, false]);
    expect((["planificado", "en_transito", "recibido", "cancelado"] as EstadoEmbarque[]).map(embarqueAdmitePaquetes)).toEqual([true, true, false, false]);
    expect((["planificado", "en_transito", "recibido", "cancelado"] as EstadoEmbarque[]).map(embarqueEditable)).toEqual([true, true, true, false]);
  });
});

describe("R13 · paquete: abierto → cancelado solo sin asignaciones activas", () => {
  it("cancelar con motivo y sin activas", () => {
    expect(transicionPaquete("abierto", "cancelar", { asignaciones_activas: 0, motivo: "Se unió a otro" })).toEqual({ ok: true, hacia: "cancelado" });
    expect(fallo(transicionPaquete("abierto", "cancelar", { asignaciones_activas: 2, motivo: "x" }))).toBe("tiene_asignaciones_activas");
    expect(fallo(transicionPaquete("abierto", "cancelar", { asignaciones_activas: 0 }))).toBe("motivo_requerido");
    expect(fallo(transicionPaquete("cancelado", "cancelar", { asignaciones_activas: 0, motivo: "x" }))).toBe("transicion_invalida");
  });
  it("el paquete solo admite cancelar", () => {
    const acciones: AccionEstado[] = ["cerrar", "reabrir", "en_transito", "volver_a_planificado"];
    for (const a of acciones) expect(fallo(transicionPaquete("abierto", a, { asignaciones_activas: 0, motivo: "x" })), a).toBe("transicion_invalida");
    expect(accionAdmitidaPorTipo("paquete", "cancelar")).toBe(true);
    expect(accionAdmitidaPorTipo("paquete", "cerrar")).toBe(false);
    expect(accionAdmitidaPorTipo("viaje", "cerrar")).toBe(true);
    expect(accionAdmitidaPorTipo("embarque", "cerrar")).toBe(false);
    expect(paqueteEditable("abierto")).toBe(true);
    expect(paqueteEditable("cancelado")).toBe(false);
  });
});

describe("caso 10: un embarque que se guarda", () => {
  it("un local con viaje da local_con_viaje y la salida posterior a la llegada, salida_despues_de_llegada", () => {
    expect(validarGuardarEmbarque({ tipo: "local", viaje_id: "v1", fecha_llegada_estimada: "2026-11-05" }, null)).toBe("local_con_viaje");
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: "v1", fecha_salida_estimada: "2026-11-10", fecha_llegada_estimada: "2026-11-05" }, null)).toBe("salida_despues_de_llegada");
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: "v1", fecha_salida_estimada: "2026-11-05", fecha_llegada_estimada: "2026-11-05" }, null)).toBeNull();
    expect(validarGuardarEmbarque({ tipo: "local", viaje_id: null, fecha_llegada_estimada: "2026-11-05" }, null)).toBeNull();
  });
  it("al editar no se manda la llegada (fecha_por_movimiento) y la salida se compara con la llegada vigente", () => {
    const vigente = { fecha_llegada_estimada: "2026-11-20" };
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: null, fecha_llegada_estimada: "2026-12-01" }, vigente)).toBe("fecha_por_movimiento");
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: null, fecha_salida_estimada: "2026-11-21" }, vigente)).toBe("salida_despues_de_llegada");
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: null, fecha_salida_estimada: "2026-11-19" }, vigente)).toBeNull();
    expect(validarGuardarEmbarque({ tipo: "importacion", viaje_id: null, fecha_salida_estimada: null }, vigente)).toBeNull();
  });
});

describe("avisos de lista y detalle (R12, R13)", () => {
  const perfiles = perfilesAgrupadores();
  const activa = { periodo: "2026-11", historica: false, linea_recibida: false };
  const resp = (propio: string | null, viaje: string | null = null) => responsableEfectivo({ propio, viaje }, perfiles);
  const emb = (cambios: Partial<{ estado: EstadoEmbarque; fecha_llegada_estimada: string; periodo_llegada: string }> = {}) => ({ estado: "planificado" as EstadoEmbarque, fecha_llegada_estimada: "2026-11-20", periodo_llegada: "2026-11", ...cambios });

  it("sin_responsable: sin efectivo o con uno no asignable", () => {
    expect(avisosViaje(resp(PERFIL_AGR.c1))).toEqual([]);
    expect(avisosViaje(resp(null))).toEqual(["sin_responsable"]);
    expect(avisosEmbarque({ embarque: emb(), viaje: null, responsable: resp(null), asignaciones: [], hoy: "2026-11-01" })).toContain("sin_responsable");
    expect(avisosEmbarque({ embarque: emb(), viaje: null, responsable: resp(PERFIL_AGR.c3), asignaciones: [], hoy: "2026-11-01" })).toContain("sin_responsable");
    expect(avisosEmbarque({ embarque: emb(), viaje: null, responsable: resp(null, PERFIL_AGR.c1), asignaciones: [], hoy: "2026-11-01" })).toEqual([]);
  });

  it("atrasado: sin recibir y con la llegada estimada ya pasada", () => {
    const base = { viaje: null, responsable: resp(PERFIL_AGR.c1), asignaciones: [], hoy: "2026-11-21" };
    expect(avisosEmbarque({ ...base, embarque: emb() })).toEqual(["atrasado"]);
    expect(avisosEmbarque({ ...base, embarque: emb({ estado: "en_transito" }) })).toEqual(["atrasado"]);
    expect(avisosEmbarque({ ...base, embarque: emb({ estado: "recibido" }) })).toEqual([]);
    expect(avisosEmbarque({ ...base, embarque: emb({ estado: "cancelado" }) })).toEqual([]);
    expect(avisosEmbarque({ ...base, embarque: emb(), hoy: "2026-11-20" })).toEqual([]);
  });

  it("caso 19a: viaje_cerrado en el embarque de un viaje cerrado", () => {
    const base = { responsable: resp(PERFIL_AGR.c1), asignaciones: [], hoy: "2026-11-01", embarque: emb() };
    expect(avisosEmbarque({ ...base, viaje: { estado: "cerrado" } })).toEqual(["viaje_cerrado"]);
    expect(avisosEmbarque({ ...base, viaje: { estado: "abierto" } })).toEqual([]);
    expect(avisoViajeCerrado(viaje261001({ estado: "cerrado" }))).toEqual({ aviso: "viaje_cerrado", detalle: "El viaje 261001 está cerrado: igual se registra." });
    expect(avisoViajeCerrado(viaje261001())).toBeNull();
  });

  it("caso 8: en_embarque_cancelado, con asignaciones activas en un embarque cancelado; no con solo históricas", () => {
    const base = { viaje: null, responsable: resp(PERFIL_AGR.c1), hoy: "2026-11-01", embarque: emb({ estado: "cancelado" }) };
    expect(avisosEmbarque({ ...base, asignaciones: [activa] })).toEqual(["en_embarque_cancelado"]);
    expect(avisosEmbarque({ ...base, asignaciones: [{ ...activa, historica: true }] })).toEqual(["asignaciones_historicas"]);
  });

  it("desalineada: una asignación activa fuera del mes de llegada; las históricas no", () => {
    const base = { viaje: null, responsable: resp(PERFIL_AGR.c1), hoy: "2026-11-01", embarque: emb() };
    expect(avisosEmbarque({ ...base, asignaciones: [{ ...activa, periodo: "2026-12" }] })).toEqual(["desalineada"]);
    expect(avisosEmbarque({ ...base, asignaciones: [{ ...activa, periodo: "2026-12", historica: true }] })).toEqual(["asignaciones_historicas"]);
    expect(avisosEmbarque({ ...base, asignaciones: [activa] })).toEqual([]);
  });

  it("asignaciones_historicas y linea_recibida", () => {
    const base = { viaje: null, responsable: resp(PERFIL_AGR.c1), hoy: "2026-11-01", embarque: emb() };
    expect(avisosEmbarque({ ...base, asignaciones: [activa, { ...activa, historica: true, linea_recibida: true }] })).toEqual(["asignaciones_historicas", "linea_recibida"]);
  });

  it("los avisos salen en el orden del catálogo y sin repetir", () => {
    const r = avisosEmbarque({ viaje: { estado: "cerrado" }, responsable: resp(null), hoy: "2026-12-30", embarque: emb(), asignaciones: [{ ...activa, periodo: "2026-12" }, { ...activa, historica: true }] });
    expect(r).toEqual(["viaje_cerrado", "atrasado", "sin_responsable", "desalineada", "asignaciones_historicas"]);
    expect(new Set(r).size).toBe(r.length);
  });

  it("avisos de paquete: responsable faltante, desalineada e históricas", () => {
    const base = { paquete: { estado: "abierto" as const }, embarque: { periodo_llegada: "2026-11" } };
    expect(avisosPaquete({ ...base, responsable: resp(PERFIL_AGR.c2), asignaciones: [activa] })).toEqual([]);
    expect(avisosPaquete({ ...base, responsable: resp(null), asignaciones: [{ ...activa, periodo: "2026-12" }, { ...activa, historica: true }] })).toEqual(["sin_responsable", "desalineada", "asignaciones_historicas"]);
  });
});
