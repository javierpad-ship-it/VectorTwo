import { expect } from "vitest";
import {
  aplicarMovimientos,
  mesDeDestino,
  periodoLlegada,
  pisoDePaquete,
  type ContextoMovimiento,
  type PlanAplicable,
  type ResultadoPlanFechas,
  type ResultadoPlanMovimiento,
} from "@/lib/compras/agrupadores/movimiento";
import type { AsignacionRegistro, EmbarqueRegistro, PaqueteRegistro } from "@/lib/compras/agrupadores/tipos";
import { clasificarAsignacion } from "@/lib/compras/agrupadores/movimiento";
import type { NodoAlcance, RepartoParaLinea } from "@/lib/compras/reparto";
import type { EntregaRegistro } from "@/lib/compras/tipos";
import { REPARTO_BETA_V2, NODO_M8 } from "./compras.fixture";
import { K_PRIMA_AGRUPADORES, LINEA_AGR, VECTOR_REPARTO_V2, registrosFechas } from "./agrupadores.fixture";

/**
 * Soporte de las pruebas de 08b-1b (casos F1 a F46): el contexto de los planes con el fixture de F y un `siguiente` que aplica un plan como
 * lo haría `aplicar_movimiento_agrupador` de la 0038 (entregas, asignaciones, repartos, fechas del embarque, ingreso de los paquetes), para
 * encadenar casos. Sin base. El espejo comprueba además I2 generalizada e I9 después de cada paso.
 */

export const ETIQUETAS_F = new Map([
  [LINEA_AGR.l1, "DENIM · ALFA"],
  [LINEA_AGR.l2, "BETA"],
  [LINEA_AGR.l102, "POLO · ALFA"],
]);

/** Reparto v2 de BETA (verano 50/30/20 · invierno 30/40/30); `sinInvierno` quita el vector de invierno (F10). */
export function repartoV2(sinInvierno = false): RepartoParaLinea {
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

const NODOS = new Map<string, NodoAlcance>();

/** Contexto de los planes con el fixture de F: 261101 (l1 nov 300 y POLO nov 400), 270301 (lote BETA mar 600), 270401, 270601 y el de Javier. */
export function ctxF(cambios: Partial<ContextoMovimiento> = {}): ContextoMovimiento {
  const r = registrosFechas();
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
    etiquetas_linea: ETIQUETAS_F,
    ...cambios,
  };
}

type Resultado = { ok: boolean; motivo?: string; detalle?: string };
export function ok<R extends ResultadoPlanMovimiento | ResultadoPlanFechas>(r: R): Extract<R, { ok: true }> {
  if (!r.ok) throw new Error(`se esperaba un plan: ${(r as Resultado).motivo} ${(r as Resultado).detalle ?? ""}`);
  return r as Extract<R, { ok: true }>;
}
export const motivo = (r: ResultadoPlanMovimiento | ResultadoPlanFechas) => (r.ok ? null : r.motivo);

/** Embarque por id del contexto. */
export const embarqueDe = (c: ContextoMovimiento, id: string): EmbarqueRegistro => c.embarques.find((e) => e.id === id) as EmbarqueRegistro;
export const paqueteDe = (c: ContextoMovimiento, id: string): PaqueteRegistro => c.paquetes.find((p) => p.id === id) as PaqueteRegistro;

const mes = (fecha: string) => fecha.slice(0, 7);

/**
 * Ejecuta un plan sobre el contexto como `aplicar_movimiento_agrupador`: entregas y asignaciones (`aplicarMovimientos`), repartos de las
 * entregas tocadas, +1 de revisión a los embarques del plan y a las compras con movimientos, las claves de fecha de `embarques[0]`
 * (clave presente = valor nuevo, `null` incluido), el ingreso de `plan.paquetes` y el estado `en_transito` si se confirma un hito en un
 * embarque planificado. Después comprueba I2 generalizada e I9; lanza si no se cumplen.
 */
export function siguiente(c: ContextoMovimiento, plan: PlanAplicable): ContextoMovimiento {
  const res = aplicarMovimientos(c, plan.movimientos, plan.paquete_a_mover ? [plan.paquete_a_mover] : []);
  if (!res.ok) throw new Error(res.motivo);
  const idNuevo = (lineaId: string, periodo: string) => `nueva-${lineaId}-${periodo}`;
  let entregas: EntregaRegistro[] = [...c.entregas];
  for (const e of res.entregas) {
    const k = (x: EntregaRegistro) => x.linea_id === e.linea_id && x.periodo === e.periodo;
    entregas = e.borrada ? entregas.filter((x) => !k(x)) : e.nueva ? [...entregas, { id: idNuevo(e.linea_id, e.periodo), linea_id: e.linea_id, periodo: e.periodo, unidades: e.unidades, origen: "embarque" }] : entregas.map((x) => (k(x) ? { ...x, unidades: e.unidades } : x));
  }
  const idsTocados = new Set(res.asignaciones.filter((a) => a.id !== null).map((a) => a.id as string));
  const idEntrega = (linea: string, periodo: string) => entregas.find((x) => x.linea_id === linea && x.periodo === periodo)?.id as string;
  let n = 0;
  const finales: AsignacionRegistro[] = res.asignaciones
    .filter((a) => !a.borrada)
    .map((a) => ({ id: a.id ?? `nueva-asig-${n++}`, entrega_id: idEntrega(a.linea_id, a.periodo), embarque_id: a.embarque_id, paquete_id: a.paquete_id, unidades: a.unidades }));
  const arrastradas = c.asignaciones
    .filter((a) => !idsTocados.has(a.id))
    .map((a) => (plan.paquete_a_mover && a.paquete_id === plan.paquete_a_mover.paquete_id ? { ...a, embarque_id: plan.paquete_a_mover.embarque_destino_id } : a));

  let repartos = [...c.repartos];
  for (const rp of plan.repartos) {
    const id = idEntrega(rp.linea_id, rp.periodo);
    repartos = repartos.filter((x) => !(x.linea_id === rp.linea_id && x.entrega_id === id));
    repartos.push(...rp.filas.map((f) => ({ linea_id: rp.linea_id, entrega_id: id, ...f })));
  }
  for (const e of res.entregas) if (e.borrada && e.id) repartos = repartos.filter((x) => x.entrega_id !== e.id);

  const compraIds = new Set(plan.movimientos.map((m) => m.compra_id));
  const ingresoDe = new Map((plan.paquetes ?? []).map((p) => [p.id, p]));
  const paquetes = c.paquetes.map((p) => {
    const cambio = ingresoDe.get(p.id);
    const embarque_id = plan.paquete_a_mover?.paquete_id === p.id ? plan.paquete_a_mover.embarque_destino_id : p.embarque_id;
    return cambio ? { ...p, embarque_id, fecha_ingreso_estimada: cambio.fecha_ingreso_estimada, periodo_ingreso: cambio.fecha_ingreso_estimada === null ? null : mes(cambio.fecha_ingreso_estimada) } : { ...p, embarque_id };
  });
  const embarques = c.embarques.map((e) => {
    const p = plan.embarques.find((x) => x.id === e.id);
    if (!p) return e;
    const { id: _id, revision: _revision, ...claves } = p;
    void _id;
    void _revision;
    const nuevo: EmbarqueRegistro = { ...e, ...claves, revision: e.revision + 1 };
    if (claves.fecha_inicio_operativo_estimada === null) nuevo.hora_inicio_operativo = null;
    if (claves.hito_confirmado && e.estado === "planificado") nuevo.estado = "en_transito";
    nuevo.periodo_llegada = periodoLlegada(nuevo.fecha_llegada_real, nuevo.fecha_ingreso_estimada, nuevo.fecha_llegada_estimada);
    return nuevo;
  });
  const sig: ContextoMovimiento = {
    ...c,
    entregas,
    asignaciones: [...arrastradas, ...finales],
    paquetes,
    repartos,
    compras: c.compras.map((x) => (compraIds.has(x.id) ? { ...x, revision: x.revision + 1 } : x)),
    embarques,
  };
  verificarI2I9(sig);
  return sig;
}

/** I2 generalizada (todas las asignaciones activas en `mesDeDestino`) e I9 (ningún paquete abierto antes del piso de su embarque). */
export function verificarI2I9(c: ContextoMovimiento) {
  for (const a of c.asignaciones) {
    const entrega = c.entregas.find((e) => e.id === a.entrega_id);
    if (!entrega) throw new Error(`asignación ${a.id} sin entrega`);
    const linea = c.lineas.find((l) => l.id === entrega.linea_id);
    const compra = linea ? c.compras.find((x) => x.id === linea.compra_id) : undefined;
    if (!linea || !compra || clasificarAsignacion(compra, linea).historica) continue;
    const e = embarqueDe(c, a.embarque_id);
    const p = a.paquete_id ? paqueteDe(c, a.paquete_id) : null;
    expect(entrega.periodo, `I2: asignación ${a.id} (paquete ${p?.codigo ?? "—"}) en el embarque ${e.codigo}`).toBe(mesDeDestino(e, p));
  }
  for (const p of c.paquetes) {
    if (p.estado !== "abierto" || p.fecha_ingreso_estimada === null) continue;
    const e = embarqueDe(c, p.embarque_id);
    expect(p.fecha_ingreso_estimada >= pisoDePaquete(e), `I9: ${p.nombre} antes de la llegada de ${e.codigo}`).toBe(true);
  }
}

export const entregasDeLinea = (c: ContextoMovimiento, lineaId: string) => c.entregas.filter((e) => e.linea_id === lineaId).sort((a, b) => (a.periodo < b.periodo ? -1 : 1));
export const porMes = (c: ContextoMovimiento, lineaId: string) => Object.fromEntries(entregasDeLinea(c, lineaId).map((e) => [e.periodo, e.unidades]));
